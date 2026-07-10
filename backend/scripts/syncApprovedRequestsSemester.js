/**
 * Synchronize semesters and expiration dates for approved transport requests (OPTIMIZED).
 * 
 * Usage:
 *   node scripts/syncApprovedRequestsSemester.js
 *   node scripts/syncApprovedRequestsSemester.js --dry-run
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { mysqlPool } = require('../config/db');

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (month >= 5) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

function academicYearDateRange(academicYear) {
    const ay = academicYear || getDefaultAcademicYear();
    const parts = String(ay).split('-').map((n) => Number(n));
    if (parts.length !== 2 || parts.some((n) => Number.isNaN(n))) {
        return null;
    }
    const [startYear, endYear] = parts;
    return {
        start: `${startYear}-07-01`,
        end: `${endYear}-06-30`,
    };
}

function formatDateString(d) {
    if (!d) return null;
    const date = new Date(d);
    if (isNaN(date.getTime())) return null;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function getExpectedYearForBatch(academicYearLabel, batch) {
    if (!academicYearLabel || !batch) return null;
    const startYear = Number(String(academicYearLabel).split('-')[0]);
    const batchYear = Number(String(batch).trim());
    if (Number.isNaN(startYear) || Number.isNaN(batchYear)) {
        return null;
    }
    return startYear - batchYear + 1;
}

function resolveExpiryInMemory(tr, studentsMap, coursesMap, academicYearsMap, expiryOverridesMap, semestersList) {
    const admissionNumber = tr.admission_number || tr.admission_no;
    if (!admissionNumber) return null;

    const student = studentsMap.get(String(admissionNumber).trim());
    if (!student || !student.course) return null;

    const courseId = coursesMap.get(student.course.toLowerCase().trim());
    if (!courseId) return null;

    const requestAcademicYear = tr.academic_year
        || process.env.CURRENT_ACADEMIC_YEAR
        || getDefaultAcademicYear();
    
    let yearOfStudy = getExpectedYearForBatch(requestAcademicYear, student.batch);
    if (yearOfStudy == null || isNaN(yearOfStudy)) {
        yearOfStudy = student.current_year != null
            ? Number(student.current_year)
            : (tr.year_of_study != null ? Number(tr.year_of_study) : 1);
    }

    // 1. Check Course Expiry override
    const overrideKey = `${courseId}-${requestAcademicYear}-${yearOfStudy}`;
    const overrideExpiry = expiryOverridesMap.get(overrideKey);
    if (overrideExpiry) {
        return {
            id: null,
            year_of_study: yearOfStudy,
            expiry_date: overrideExpiry,
            label: `Course expiry (${requestAcademicYear}, Year ${yearOfStudy})`,
        };
    }

    const academicYearId = academicYearsMap.get(requestAcademicYear);
    if (!academicYearId) return null;

    // 2. Check only the exact academic session, batch, course, and year.
    const matchedSems = semestersList.filter(sem =>
        Number(sem.course_id) === Number(courseId) &&
        Number(sem.academic_year_id) === Number(academicYearId) &&
        String(sem.batch || '') === String(student.batch || '') &&
        Number(sem.year_of_study) === Number(yearOfStudy)
    );

    if (!matchedSems.length) return null;

    matchedSems.sort((a, b) => {
        const semDiff = Number(b.semester_number || 0) - Number(a.semester_number || 0);
        if (semDiff) return semDiff;
        return Number(b.id || 0) - Number(a.id || 0);
    });
    const bestSem = matchedSems[0];

    return {
        id: bestSem.id,
        year_of_study: yearOfStudy,
        expiry_date: bestSem.end_date,
        label: `Strict calendar (${requestAcademicYear}, Batch ${student.batch}, Year ${bestSem.year_of_study}, Sem ${bestSem.semester_number})`,
    };
}

async function main() {
    if (!mysqlPool) {
        console.error('MySQL connection not available. Check your .env file.');
        process.exit(1);
    }

    console.log('--- Transport Requests Expiry Synchronizer (OPTIMIZED) ---');
    if (dryRun) {
        console.log('Running in DRY-RUN mode (no database updates will be made).\n');
    }

    console.log('Preloading metadata tables...');
    const startTime = Date.now();

    // 1. Preload academic years
    const [academicYearRows] = await mysqlPool.query('SELECT id, year_label FROM academic_years');
    const academicYearsMap = new Map();
    for (let ay of academicYearRows) {
        if (ay.year_label) {
            academicYearsMap.set(String(ay.year_label).trim(), ay.id);
        }
    }

    // 2. Preload courses
    const [courseRows] = await mysqlPool.query('SELECT id, name FROM courses');
    const coursesMap = new Map();
    for (let c of courseRows) {
        if (c.name) {
            coursesMap.set(c.name.toLowerCase().trim(), c.id);
        }
    }

    // 3. Preload students
    const [studentRows] = await mysqlPool.query(
        'SELECT admission_number, admission_no, course, batch, current_year FROM students'
    );
    const studentsMap = new Map();
    for (let s of studentRows) {
        if (s.admission_number) {
            studentsMap.set(String(s.admission_number).trim(), s);
        }
        if (s.admission_no) {
            studentsMap.set(String(s.admission_no).trim(), s);
        }
    }

    // 4. Preload course expiries
    const [expiryRows] = await mysqlPool.query(
        'SELECT course_id, academic_year, year_of_study, expiry_date FROM course_transport_expiry'
    );
    const expiryOverridesMap = new Map();
    for (let exp of expiryRows) {
        const key = `${exp.course_id}-${exp.academic_year}-${exp.year_of_study}`;
        expiryOverridesMap.set(key, exp.expiry_date);
    }

    // 5. Preload semesters
    const [semestersList] = await mysqlPool.query(
        'SELECT id, college_id, course_id, academic_year_id, batch, year_of_study, semester_number, start_date, end_date FROM semesters'
    );

    console.log(`Preload completed in ${Date.now() - startTime}ms.`);
    console.log(`- Academic Years Loaded: ${academicYearsMap.size}`);
    console.log(`- Courses Loaded: ${coursesMap.size}`);
    console.log(`- Students Loaded: ${studentsMap.size}`);
    console.log(`- Expiry Overrides Loaded: ${expiryOverridesMap.size}`);
    console.log(`- Semesters Loaded: ${semestersList.length}`);

    // Fetch all approved student requests
    const [requests] = await mysqlPool.query(
        "SELECT * FROM transport_requests WHERE status = 'approved' ORDER BY request_date DESC"
    );

    console.log(`\nProcessing ${requests.length} approved student transport requests...`);

    let updatedCount = 0;
    let unchangedCount = 0;
    let skippedCount = 0;

    const processStartTime = Date.now();

    for (let tr of requests) {
        const admissionNo = tr.admission_number || tr.admission_no;
        const studentName = tr.student_name;

        // Resolve new expiration & semester in-memory
        const semesterInfo = resolveExpiryInMemory(tr, studentsMap, coursesMap, academicYearsMap, expiryOverridesMap, semestersList);
        if (!semesterInfo) {
            skippedCount++;
            continue;
        }

        const newSemesterId = semesterInfo.id;
        const newExpiryDate = formatDateString(semesterInfo.expiry_date);
        const resolvedYear = semesterInfo.year_of_study;
        
        const oldSemesterId = tr.semester_id;
        const oldExpiryDate = formatDateString(tr.expiry_date);
        const oldYear = tr.year_of_study;

        const needsUpdate = 
            newSemesterId !== oldSemesterId || 
            newExpiryDate !== oldExpiryDate || 
            resolvedYear !== oldYear;

        if (needsUpdate) {
            const studentObj = studentsMap.get(String(admissionNo).trim());
            const courseName = studentObj ? studentObj.course : 'Unknown Course';
            console.log(`[PENDING UPDATE] ${admissionNo} - ${studentName} (${courseName}):`);
            console.log(`  - Semester ID: ${oldSemesterId} -> ${newSemesterId}`);
            console.log(`  - Year of Study: ${oldYear} -> ${resolvedYear}`);
            console.log(`  - Expiry Date: ${oldExpiryDate} -> ${newExpiryDate} (${semesterInfo.label})`);
            
            if (!dryRun) {
                await mysqlPool.query(
                    `UPDATE transport_requests 
                     SET semester_id = ?, year_of_study = ?, expiry_date = ? 
                     WHERE id = ?`,
                    [newSemesterId, resolvedYear, newExpiryDate, tr.id]
                );
            }
            updatedCount++;
        } else {
            unchangedCount++;
        }
    }

    console.log(`\nCalculation & Updates completed in ${Date.now() - processStartTime}ms.`);

    console.log('\n--- Sync Summary ---');
    console.log(`Total Requests Analyzed: ${requests.length}`);
    console.log(`Updated Requests:        ${updatedCount}`);
    console.log(`Unchanged Requests:      ${unchangedCount}`);
    console.log(`Skipped (No Config):     ${skippedCount}`);
    
    if (dryRun) {
        console.log('\nDry-run complete. No changes were committed.');
    } else {
        console.log('\nDatabase synchronization complete.');
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal Error during sync:', err);
    process.exit(1);
});
