/**
 * Revert a transport semester sync run using its console output.
 *
 * Usage:
 *   node scripts/revertTransportSemesterSync.js --log "path/to/sync-output.txt" --dry-run
 *   node scripts/revertTransportSemesterSync.js --log "path/to/sync-output.txt"
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { mysqlPool } = require('../config/db');

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const allowMultiple = args.includes('--allow-multiple');
const logArgIndex = args.indexOf('--log');
const logPath = logArgIndex >= 0 ? args[logArgIndex + 1] : null;

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return month >= 5 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function parseNullableValue(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed || trimmed.toLowerCase() === 'null') return null;
    return trimmed;
}

function parseNullableNumber(value) {
    const parsed = parseNullableValue(value);
    if (parsed == null) return null;
    const numberValue = Number(parsed);
    return Number.isNaN(numberValue) ? null : numberValue;
}

function parseSyncLog(content) {
    const lines = content.split(/\r?\n/);
    const updates = [];
    const seen = new Set();

    for (let i = 0; i < lines.length; i += 1) {
        const headerMatch = lines[i].match(/^\[PENDING UPDATE\]\s+(\S+)\s+-\s+(.+?)\s+\((.+)\):$/);
        if (!headerMatch) continue;

        const semesterLine = lines[i + 1] || '';
        const yearLine = lines[i + 2] || '';
        const expiryLine = lines[i + 3] || '';

        const semesterMatch = semesterLine.match(/Semester ID:\s+(.+?)\s+->\s+(.+)$/);
        const yearMatch = yearLine.match(/Year of Study:\s+(.+?)\s+->\s+(.+)$/);
        const expiryMatch = expiryLine.match(/Expiry Date:\s+(.+?)\s+->\s+(.+?)\s+\((.+)\)$/);
        if (!semesterMatch || !yearMatch || !expiryMatch) continue;

        const label = expiryMatch[3] || '';
        const academicYearMatch = label.match(/\((\d{4}-\d{4}),/);

        const update = {
            admissionNumber: headerMatch[1],
            studentName: headerMatch[2],
            course: headerMatch[3],
            oldSemesterId: parseNullableNumber(semesterMatch[1]),
            newSemesterId: parseNullableNumber(semesterMatch[2]),
            oldYearOfStudy: parseNullableNumber(yearMatch[1]),
            newYearOfStudy: parseNullableNumber(yearMatch[2]),
            oldExpiryDate: parseNullableValue(expiryMatch[1]),
            newExpiryDate: parseNullableValue(expiryMatch[2]),
            academicYear: academicYearMatch?.[1] || null,
        };

        const signature = [
            update.admissionNumber,
            update.oldSemesterId,
            update.newSemesterId,
            update.oldYearOfStudy,
            update.newYearOfStudy,
            update.oldExpiryDate,
            update.newExpiryDate,
            update.academicYear,
        ].join('|');

        if (seen.has(signature)) continue;
        seen.add(signature);
        updates.push(update);
    }

    return updates;
}

async function selectMatchingRows(update, fallbackAcademicYear) {
    const params = [
        update.admissionNumber,
        update.newSemesterId,
        update.newYearOfStudy,
        update.newExpiryDate,
    ];
    let academicYearSql = '';
    if (update.academicYear) {
        academicYearSql = 'AND COALESCE(academic_year, ?) = ?';
        params.push(fallbackAcademicYear, update.academicYear);
    }

    const [rows] = await mysqlPool.query(
        `SELECT id, admission_number, student_name, academic_year, semester_id, year_of_study, expiry_date
         FROM transport_requests
         WHERE admission_number = ?
           AND status = 'approved'
           AND semester_id <=> ?
           AND year_of_study <=> ?
           AND expiry_date <=> ?
           ${academicYearSql}`,
        params
    );
    return rows;
}

async function revertUpdate(update, matchingRows) {
    const ids = matchingRows.map((row) => row.id);
    if (!ids.length) return 0;

    const placeholders = ids.map(() => '?').join(',');
    const [result] = await mysqlPool.query(
        `UPDATE transport_requests
         SET semester_id = ?, year_of_study = ?, expiry_date = ?
         WHERE id IN (${placeholders})`,
        [update.oldSemesterId, update.oldYearOfStudy, update.oldExpiryDate, ...ids]
    );
    return result.affectedRows || 0;
}

async function main() {
    if (!logPath) {
        console.error('Missing --log path. Run with --dry-run first.');
        process.exit(1);
    }
    if (!mysqlPool) {
        console.error('MySQL connection not available. Check backend/.env.');
        process.exit(1);
    }

    const resolvedLogPath = path.resolve(logPath);
    const content = fs.readFileSync(resolvedLogPath, 'utf8');
    const updates = parseSyncLog(content);
    const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

    console.log('--- Transport Semester Sync Rollback ---');
    console.log(`Log: ${resolvedLogPath}`);
    console.log(`Mode: ${dryRun ? 'DRY-RUN' : 'APPLY'}`);
    console.log(`Allow multiple matches: ${allowMultiple ? 'yes' : 'no'}`);
    console.log(`Parsed updates: ${updates.length}`);

    let matched = 0;
    let reverted = 0;
    let skippedNoMatch = 0;
    let skippedMultiple = 0;

    for (const update of updates) {
        const matchingRows = await selectMatchingRows(update, fallbackAcademicYear);

        if (matchingRows.length === 0) {
            skippedNoMatch += 1;
            console.log(`[SKIP no match] ${update.admissionNumber} - ${update.studentName}`);
            continue;
        }

        if (matchingRows.length > 1 && !allowMultiple) {
            skippedMultiple += 1;
            console.log(`[SKIP multiple matches] ${update.admissionNumber} - ${update.studentName}: ids=${matchingRows.map((row) => row.id).join(',')}`);
            continue;
        }

        matched += matchingRows.length;
        console.log(`[${dryRun ? 'WOULD REVERT' : 'REVERT'}] ids=${matchingRows.map((row) => row.id).join(',')} ${update.admissionNumber} - ${update.studentName}`);
        console.log(`  - Semester ID: ${update.newSemesterId ?? 'null'} -> ${update.oldSemesterId ?? 'null'}`);
        console.log(`  - Year of Study: ${update.newYearOfStudy ?? 'null'} -> ${update.oldYearOfStudy ?? 'null'}`);
        console.log(`  - Expiry Date: ${update.newExpiryDate ?? 'null'} -> ${update.oldExpiryDate ?? 'null'}`);

        if (!dryRun) {
            reverted += await revertUpdate(update, matchingRows);
        }
    }

    console.log('\n--- Rollback Summary ---');
    console.log(`Parsed Updates:        ${updates.length}`);
    console.log(`Matched Rows:          ${matched}`);
    console.log(`Reverted Rows:         ${reverted}`);
    console.log(`Skipped No Match:      ${skippedNoMatch}`);
    console.log(`Skipped Multiple Match:${skippedMultiple}`);
    if (dryRun) {
        console.log('\nDry-run complete. No database updates were made.');
    }

    process.exit(0);
}

main().catch((error) => {
    console.error('Rollback failed:', error);
    process.exit(1);
});
