/**
 * Explain why a transport request is shown as expired.
 *
 * Usage:
 *   node scripts/explainTransportExpiry.js "MERUGU NIKHIL" 2026-2027
 *   node scripts/explainTransportExpiry.js 2026XXXX 2026-2027
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { mysqlPool } = require('../config/db');

const searchText = process.argv[2];
const academicYearArg = process.argv[3] || null;

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    return month >= 5 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

function formatDate(value) {
    if (!value) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function academicYearDateRange(academicYear) {
    const parts = String(academicYear || '').split('-').map(Number);
    if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
    return {
        start: `${parts[0]}-07-01`,
        end: `${parts[1]}-06-30`,
    };
}

function expectedYearForBatch(academicYear, batch) {
    const startYear = Number(String(academicYear || '').split('-')[0]);
    const batchYear = Number(String(batch || '').trim());
    if (Number.isNaN(startYear) || Number.isNaN(batchYear)) return null;
    return startYear - batchYear + 1;
}

function printObject(title, obj) {
    console.log(`\n${title}`);
    console.log('-'.repeat(title.length));
    Object.entries(obj || {}).forEach(([key, value]) => {
        console.log(`${key}: ${value instanceof Date ? formatDate(value) : value ?? 'NULL'}`);
    });
}

async function tableColumns(tableName) {
    const [columns] = await mysqlPool.query(`SHOW COLUMNS FROM ${tableName}`);
    return columns.map((column) => column.Field);
}

function formatRowDates(row) {
    return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => {
        if (value instanceof Date || /date$/i.test(key)) {
            return [key, formatDate(value)];
        }
        return [key, value];
    }));
}

async function findStudents(search) {
    const columns = await tableColumns('students');
    const nameColumns = columns.filter((column) => /name/i.test(column));
    const admissionColumns = columns.filter((column) => ['admission_number', 'admission_no', 'pin_no'].includes(column));
    const searchableColumns = [...new Set([...nameColumns, ...admissionColumns])];
    if (!searchableColumns.length) return [];

    const where = searchableColumns.map((column) => `LOWER(CAST(${column} AS CHAR)) LIKE ?`).join(' OR ');
    const params = searchableColumns.map(() => `%${String(search).toLowerCase()}%`);
    const [rows] = await mysqlPool.query(
        `SELECT * FROM students WHERE ${where} LIMIT 10`,
        params
    );
    return rows;
}

async function findRequests(search, admissionNumbers, academicYear) {
    const params = [];
    const clauses = ['LOWER(student_name) LIKE ?'];
    params.push(`%${String(search).toLowerCase()}%`);

    if (admissionNumbers.length) {
        clauses.push(`admission_number IN (${admissionNumbers.map(() => '?').join(',')})`);
        params.push(...admissionNumbers);
    }

    let yearSql = '';
    if (academicYear) {
        yearSql = 'AND COALESCE(academic_year, ?) = ?';
        params.push(process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear(), academicYear);
    }

    const [rows] = await mysqlPool.query(
        `SELECT *
         FROM transport_requests
         WHERE (${clauses.join(' OR ')})
           ${yearSql}
         ORDER BY request_date DESC
         LIMIT 10`,
        params
    );
    return rows;
}

async function printAcademicCalendar({ courseId, academicYear, batch, yearOfStudy }) {
    console.log('\nAcademic Calendar Check');
    console.log('-----------------------');

    const ayColumns = await tableColumns('academic_years');
    const aySelect = ['id', 'year_label', 'start_date', 'end_date', 'is_active']
        .filter((column) => ayColumns.includes(column))
        .join(', ');
    const [academicYearRows] = await mysqlPool.query(
        `SELECT ${aySelect || '*'} FROM academic_years WHERE year_label = ? LIMIT 5`,
        [academicYear]
    );
    const academicYearRow = academicYearRows[0] || null;

    if (!academicYearRow) {
        console.log(`No academic_years row found for ${academicYear}.`);
    } else {
        console.log('academic_years row:');
        console.log(JSON.stringify(formatRowDates(academicYearRow), null, 2));
    }

    const semColumns = await tableColumns('semesters');
    const usefulColumns = [
        's.id',
        's.college_id',
        's.course_id',
        's.academic_year_id',
        's.batch',
        's.year_of_study',
        's.semester_number',
        's.start_date',
        's.end_date',
    ].filter((column) => semColumns.includes(column.replace('s.', '')));
    const semSelect = usefulColumns.length
        ? `${usefulColumns.join(', ')}, ay.year_label AS academic_year_label`
        : 's.*, ay.year_label AS academic_year_label';
    const hasBatch = semColumns.includes('batch');
    const hasAcademicYearId = semColumns.includes('academic_year_id');

    let strictRows = [];
    if (courseId && academicYearRow?.id && hasAcademicYearId && hasBatch) {
        [strictRows] = await mysqlPool.query(
            `SELECT ${semSelect}
             FROM semesters s
             LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
             WHERE s.course_id = ? AND s.academic_year_id = ? AND s.batch = ?
             ORDER BY s.year_of_study ASC, s.semester_number ASC, s.start_date ASC`,
            [courseId, academicYearRow.id, batch]
        );
    }

    console.log('\nStrict Calendar Rows (course + academic_year_id + batch)');
    console.log('-------------------------------------------------------');
    if (!hasAcademicYearId || !hasBatch) {
        console.log('Cannot run strict check because semesters.academic_year_id or semesters.batch column is missing.');
    } else if (!strictRows.length) {
        console.log('No strict semester rows found for this course, academic year, and batch.');
    } else {
        strictRows.forEach((row) => console.log(JSON.stringify(formatRowDates(row), null, 2)));
    }

    const ayRange = academicYearDateRange(academicYear);
    const [looseRows] = courseId && ayRange
        ? await mysqlPool.query(
            `SELECT ${semSelect}
             FROM semesters s
             LEFT JOIN academic_years ay ON ay.id = s.academic_year_id
             WHERE s.course_id = ? AND s.year_of_study = ? AND s.end_date >= ? AND s.end_date <= ?
             ORDER BY s.end_date DESC`,
            [courseId, yearOfStudy, ayRange.start, ayRange.end]
        )
        : [[]];

    console.log('\nLoose Expiry Fallback Rows (course + year_of_study + date range)');
    console.log('----------------------------------------------------------------');
    if (!looseRows.length) {
        console.log('No loose semester rows found in the academic-year date range.');
    } else {
        looseRows.forEach((row) => console.log(JSON.stringify(formatRowDates(row), null, 2)));
    }
}

async function explainRequest(request, student) {
    const academicYear = request.academic_year || academicYearArg || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const fallbackYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const expectedYear = expectedYearForBatch(academicYear, student?.batch);
    const resolvedYear = expectedYear || student?.current_year || request.year_of_study || 1;
    const ayRange = academicYearDateRange(academicYear);

    printObject('Transport Request', {
        id: request.id,
        student_name: request.student_name,
        admission_number: request.admission_number,
        status: request.status,
        request_academic_year: request.academic_year,
        resolved_academic_year: academicYear,
        request_year_of_study: request.year_of_study,
        semester_id: request.semester_id,
        semester_end_date: request.semester_end_date,
        stored_expiry_date: formatDate(request.expiry_date),
    });

    printObject('Student Row', {
        admission_number: student?.admission_number,
        admission_no: student?.admission_no,
        pin_no: student?.pin_no,
        college: student?.college,
        course: student?.course,
        branch: student?.branch,
        batch: student?.batch,
        current_year: student?.current_year,
        expected_year_for_request_ay: expectedYear,
        resolved_year_used_for_expiry: resolvedYear,
    });

    printObject('Batch First Calculation', {
        selected_academic_year: academicYear,
        student_batch: student?.batch,
        formula: 'academic_year_start - batch + 1',
        calculation: `${String(academicYear).split('-')[0]} - ${student?.batch} + 1`,
        expected_year_from_batch: expectedYear,
        student_current_year: student?.current_year,
        request_year_of_study: request.year_of_study,
        final_year_used: resolvedYear,
    });

    const [courseRows] = await mysqlPool.query(
        `SELECT c.id, c.name, c.code, c.college_id, coll.name AS college_name, coll.code AS college_code
         FROM courses c
         LEFT JOIN colleges coll ON coll.id = c.college_id
         WHERE c.name = ?
            OR (? LIKE CONCAT(c.name, ' %'))
         ORDER BY LENGTH(c.name) DESC`,
        [student?.course || '', student?.course || '']
    );

    console.log('\nCourse Matches');
    console.log('--------------');
    if (!courseRows.length) {
        console.log('No matching course rows found.');
    } else {
        courseRows.forEach((course) => {
            console.log(`course_id=${course.id} | ${course.name} (${course.code}) | college=${course.college_name || 'NULL'} (${course.college_code || 'NULL'})`);
        });
    }

    const exactCourse = courseRows.find((course) => course.name === student?.course) || courseRows[0];
    const courseId = exactCourse?.id || null;

    printObject('Selected Course For Expiry Lookup', {
        course_id: exactCourse?.id,
        course_name: exactCourse?.name,
        course_code: exactCourse?.code,
        college_id: exactCourse?.college_id,
        college_name: exactCourse?.college_name,
        college_code: exactCourse?.college_code,
    });

    await printAcademicCalendar({
        courseId,
        academicYear,
        batch: student?.batch,
        yearOfStudy: resolvedYear,
    });

    const [courseExpiryRows] = courseId
        ? await mysqlPool.query(
            `SELECT id, course_id, academic_year, year_of_study, expiry_date
             FROM course_transport_expiry
             WHERE course_id = ? AND academic_year = ? AND year_of_study = ?`,
            [courseId, academicYear, resolvedYear]
        )
        : [[]];

    console.log('\nCourse Expiry Rows');
    console.log('------------------');
    if (!courseExpiryRows.length) {
        console.log('No course_transport_expiry row for this course/year/year_of_study.');
    } else {
        courseExpiryRows.forEach((row) => console.log(JSON.stringify({ ...row, expiry_date: formatDate(row.expiry_date) }, null, 2)));
    }

    const [semByStoredId] = request.semester_id
        ? await mysqlPool.query(
            `SELECT id, course_id, year_of_study, semester_number, start_date, end_date
             FROM semesters WHERE id = ?`,
            [request.semester_id]
        )
        : [[]];

    const [semInAyRows] = courseId && ayRange
        ? await mysqlPool.query(
            `SELECT id, course_id, year_of_study, semester_number, start_date, end_date
             FROM semesters
             WHERE course_id = ? AND year_of_study = ? AND end_date >= ? AND end_date <= ?
             ORDER BY end_date DESC`,
            [courseId, resolvedYear, ayRange.start, ayRange.end]
        )
        : [[]];

    console.log('\nSemester From Stored semester_id');
    console.log('-------------------------------');
    if (!semByStoredId.length) {
        console.log('No semester found from request.semester_id.');
    } else {
        semByStoredId.forEach((row) => console.log(JSON.stringify({
            ...row,
            start_date: formatDate(row.start_date),
            end_date: formatDate(row.end_date),
        }, null, 2)));
    }

    console.log('\nLegacy Loose Semester Rows (old fallback behavior)');
    console.log('-------------------------------------------------');
    if (!semInAyRows.length) {
        console.log('No semester rows match the request academic year range/course/year.');
    } else {
        semInAyRows.forEach((row) => console.log(JSON.stringify({
            ...row,
            start_date: formatDate(row.start_date),
            end_date: formatDate(row.end_date),
        }, null, 2)));
    }

    const [effectiveRows] = await mysqlPool.query(
        `SELECT tr.id,
                cte.expiry_date AS course_expiry_date,
                sem.end_date AS joined_semester_end_date,
                tr.expiry_date AS stored_request_expiry_date,
                STR_TO_DATE(CONCAT(SUBSTRING_INDEX(ay_act.year_label, '-', -1), '-06-30'), '%Y-%m-%d') AS academic_year_end_date,
                COALESCE(cte.expiry_date, sem.end_date) AS effective_expiry_date,
                CASE
                  WHEN tr.status = 'approved'
                   AND (
                     (
                       COALESCE(cte.expiry_date, sem.end_date) IS NOT NULL
                       AND CURDATE() > COALESCE(cte.expiry_date, sem.end_date)
                     )
                     OR (
                       COALESCE(cte.expiry_date, sem.end_date) IS NULL
                       AND STR_TO_DATE(CONCAT(SUBSTRING_INDEX(ay_act.year_label, '-', -1), '-06-30'), '%Y-%m-%d') IS NOT NULL
                       AND CURDATE() > STR_TO_DATE(CONCAT(SUBSTRING_INDEX(ay_act.year_label, '-', -1), '-06-30'), '%Y-%m-%d')
                     )
                   )
                  THEN 1 ELSE 0
                END AS is_expired
         FROM transport_requests tr
         LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
         LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
         LEFT JOIN colleges coll ON coll.name = COALESCE(s1.college, s2.college) COLLATE utf8mb4_unicode_ci
         LEFT JOIN courses c_act ON c_act.name = COALESCE(s1.course, s2.course) AND c_act.college_id = coll.id
         LEFT JOIN academic_years ay_act ON ay_act.year_label = COALESCE(tr.academic_year, ?)
         LEFT JOIN course_transport_expiry cte ON cte.course_id = c_act.id
           AND cte.academic_year = ay_act.year_label
           AND cte.year_of_study = COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1)
         LEFT JOIN semesters sem ON sem.id = tr.semester_id
           AND sem.course_id = c_act.id
           AND sem.academic_year_id = ay_act.id
           AND CAST(sem.batch AS CHAR) = CAST(COALESCE(s1.batch, s2.batch) AS CHAR)
           AND sem.year_of_study = COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1)
         WHERE tr.id = ?`,
        [fallbackYear, request.id]
    );

    const effective = effectiveRows[0] || {};
    printObject('Actual App Expiry Evaluation', {
        course_expiry_date: formatDate(effective.course_expiry_date),
        joined_semester_end_date: formatDate(effective.joined_semester_end_date),
        stored_request_expiry_date: formatDate(effective.stored_request_expiry_date),
        academic_year_end_date: formatDate(effective.academic_year_end_date),
        effective_expiry_date: formatDate(effective.effective_expiry_date),
        is_expired: Boolean(effective.is_expired),
        source_used: effective.course_expiry_date
            ? 'course_transport_expiry.expiry_date'
            : effective.joined_semester_end_date
                ? 'strict semesters.end_date via request.semester_id'
                : Boolean(effective.is_expired)
                    ? 'academic year already ended, no strict date configured'
                    : 'none',
    });
}

async function main() {
    if (!searchText) {
        console.error('Search text required. Example: node scripts/explainTransportExpiry.js "MERUGU NIKHIL" 2026-2027');
        process.exit(1);
    }
    if (!mysqlPool) {
        console.error('MySQL connection not available. Check backend/.env.');
        process.exit(1);
    }

    const academicYear = academicYearArg || null;
    console.log(`Searching for: ${searchText}`);
    if (academicYear) console.log(`Academic year filter: ${academicYear}`);

    const students = await findStudents(searchText);
    const admissionNumbers = students
        .flatMap((student) => [student.admission_number, student.admission_no])
        .filter(Boolean)
        .map(String);

    console.log(`\nMatched students: ${students.length}`);
    students.forEach((student, index) => {
        console.log(`${index + 1}. ${student.student_name || student.name || student.full_name || 'Name column unknown'} | admission=${student.admission_number || student.admission_no || 'NULL'} | course=${student.course || 'NULL'} | batch=${student.batch || 'NULL'}`);
    });

    const requests = await findRequests(searchText, admissionNumbers, academicYear);
    console.log(`\nMatched transport requests: ${requests.length}`);
    if (!requests.length) {
        process.exit(0);
    }

    for (const request of requests) {
        const student = students.find((row) => (
            String(row.admission_number || '') === String(request.admission_number || '')
            || String(row.admission_no || '') === String(request.admission_number || '')
        ));
        await explainRequest(request, student);
    }

    process.exit(0);
}

main().catch((error) => {
    console.error('Error:', error);
    process.exit(1);
});
