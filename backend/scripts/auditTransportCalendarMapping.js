/**
 * Audit approved transport requests against strict batch/year-wise academic calendar.
 *
 * Usage:
 *   node scripts/auditTransportCalendarMapping.js
 *   node scripts/auditTransportCalendarMapping.js 2025-2026
 *   node scripts/auditTransportCalendarMapping.js 2025-2026 --course "B.Tech"
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { mysqlPool } = require('../config/db');

const args = process.argv.slice(2);
const academicYearArg = args.find((arg) => !arg.startsWith('--')) || '2025-2026';
const courseArgIndex = args.indexOf('--course');
const courseFilter = courseArgIndex >= 0 ? args[courseArgIndex + 1] : null;

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

function expectedYearForBatch(academicYear, batch) {
    const startYear = Number(String(academicYear || '').split('-')[0]);
    const batchYear = Number(String(batch || '').trim());
    if (Number.isNaN(startYear) || Number.isNaN(batchYear)) return null;
    return startYear - batchYear + 1;
}

function key(...parts) {
    return parts.map((part) => String(part ?? '').trim()).join('|');
}

function issueText(issues) {
    return issues.length ? issues.join(', ') : 'OK';
}

function printRow(row) {
    console.log([
        `request=${row.requestId}`,
        `adm=${row.admissionNumber}`,
        `name=${row.studentName}`,
        `course=${row.course}`,
        `batch=${row.batch}`,
        `expectedYear=${row.expectedYear ?? 'NULL'}`,
        `storedYear=${row.storedYear ?? 'NULL'}`,
        `storedSem=${row.storedSemesterId ?? 'NULL'}`,
        `correctSem=${row.correctSemesterIds || 'NULL'}`,
        `storedExpiry=${row.storedExpiryDate || 'NULL'}`,
        `correctExpiry=${row.correctExpiryDate || 'NULL'}`,
        `issues=${issueText(row.issues)}`,
    ].join(' | '));
}

async function main() {
    if (!mysqlPool) {
        console.error('MySQL connection not available. Check backend/.env.');
        process.exit(1);
    }

    const academicYear = academicYearArg;
    const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

    const [academicYearRows] = await mysqlPool.query(
        'SELECT id, year_label FROM academic_years WHERE year_label = ? LIMIT 1',
        [academicYear]
    );
    const academicYearRow = academicYearRows[0];
    if (!academicYearRow) {
        console.error(`Academic year not found: ${academicYear}`);
        process.exit(1);
    }

    const [courseRows] = await mysqlPool.query(
        `SELECT c.id, c.name, c.code, c.total_years, c.college_id, coll.name AS college_name
         FROM courses c
         LEFT JOIN colleges coll ON coll.id = c.college_id
         WHERE c.is_active = 1`
    );
    const courseByCollegeAndName = new Map();
    const coursesByName = new Map();
    for (const course of courseRows) {
        courseByCollegeAndName.set(key(course.college_name, course.name), course);
        if (!coursesByName.has(course.name)) coursesByName.set(course.name, []);
        coursesByName.get(course.name).push(course);
    }

    const [semesterRows] = await mysqlPool.query(
        `SELECT id, course_id, academic_year_id, batch, year_of_study, semester_number, start_date, end_date
         FROM semesters
         WHERE academic_year_id = ?`,
        [academicYearRow.id]
    );
    const semestersByStrictKey = new Map();
    for (const semester of semesterRows) {
        const strictKey = key(
            semester.course_id,
            semester.academic_year_id,
            semester.batch,
            semester.year_of_study
        );
        if (!semestersByStrictKey.has(strictKey)) semestersByStrictKey.set(strictKey, []);
        semestersByStrictKey.get(strictKey).push(semester);
    }
    for (const rows of semestersByStrictKey.values()) {
        rows.sort((a, b) => {
            const semDiff = Number(b.semester_number || 0) - Number(a.semester_number || 0);
            if (semDiff) return semDiff;
            return Number(b.id || 0) - Number(a.id || 0);
        });
    }

    const requestParams = [fallbackAcademicYear, academicYear];
    let courseSql = '';
    if (courseFilter) {
        courseSql = 'AND COALESCE(s1.course, s2.course) = ?';
        requestParams.push(courseFilter);
    }

    const [requestRows] = await mysqlPool.query(
        `SELECT tr.id, tr.admission_number, tr.student_name, tr.academic_year,
                tr.semester_id, tr.year_of_study, tr.expiry_date,
                COALESCE(s1.college, s2.college) AS college,
                COALESCE(s1.course, s2.course) AS course,
                COALESCE(s1.branch, s2.branch) AS branch,
                COALESCE(s1.batch, s2.batch) AS batch,
                COALESCE(s1.current_year, s2.current_year) AS student_current_year
         FROM transport_requests tr
         LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
         LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
         WHERE tr.status = 'approved'
           AND COALESCE(tr.academic_year, ?) = ?
           ${courseSql}
         ORDER BY COALESCE(s1.course, s2.course), COALESCE(s1.batch, s2.batch), tr.id`,
        requestParams
    );

    const [allStatusRows] = await mysqlPool.query(
        `SELECT COALESCE(s1.course, s2.course) AS course, tr.status, COUNT(*) AS count
         FROM transport_requests tr
         LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
         LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
         WHERE COALESCE(tr.academic_year, ?) = ?
         GROUP BY COALESCE(s1.course, s2.course), tr.status
         ORDER BY COALESCE(s1.course, s2.course), tr.status`,
        [fallbackAcademicYear, academicYear]
    );

    const reportRows = [];
    const summary = {
        totalRequests: requestRows.length,
        ok: 0,
        misconfigured: 0,
        missingStudentBatch: 0,
        invalidExpectedYear: 0,
        missingCourse: 0,
        missingCalendar: 0,
        nullCalendarDate: 0,
        wrongStoredYear: 0,
        wrongSemester: 0,
        wrongExpiry: 0,
    };

    for (const request of requestRows) {
        const expectedYear = expectedYearForBatch(academicYear, request.batch);
        const course = courseByCollegeAndName.get(key(request.college, request.course))
            || (coursesByName.get(request.course)?.length === 1 ? coursesByName.get(request.course)[0] : null);
        const issues = [];

        if (!request.batch) {
            issues.push('missing_student_batch');
            summary.missingStudentBatch += 1;
        }
        if (expectedYear == null || expectedYear < 1) {
            issues.push('invalid_expected_year');
            summary.invalidExpectedYear += 1;
        }
        if (!course) {
            issues.push('missing_or_ambiguous_course');
            summary.missingCourse += 1;
        }
        if (course?.total_years != null && expectedYear != null && expectedYear > Number(course.total_years)) {
            issues.push('expected_year_exceeds_course_duration');
        }

        const strictKey = course && expectedYear != null
            ? key(course.id, academicYearRow.id, request.batch, expectedYear)
            : null;
        const matchingSemesters = strictKey ? (semestersByStrictKey.get(strictKey) || []) : [];
        const correctSemester = matchingSemesters[0] || null;
        const correctExpiryDate = formatDate(correctSemester?.end_date);
        const storedExpiryDate = formatDate(request.expiry_date);

        if (!matchingSemesters.length && course && expectedYear != null) {
            issues.push('missing_calendar_for_course_batch_year');
            summary.missingCalendar += 1;
        }
        if (correctSemester && !correctExpiryDate) {
            issues.push('calendar_end_date_null');
            summary.nullCalendarDate += 1;
        }
        if (expectedYear != null && Number(request.year_of_study || 0) !== Number(expectedYear)) {
            issues.push('stored_year_mismatch');
            summary.wrongStoredYear += 1;
        }
        if (correctSemester && Number(request.semester_id || 0) !== Number(correctSemester.id)) {
            issues.push('stored_semester_mismatch');
            summary.wrongSemester += 1;
        }
        if (correctSemester && storedExpiryDate !== correctExpiryDate) {
            issues.push('stored_expiry_mismatch');
            summary.wrongExpiry += 1;
        }

        if (issues.length) summary.misconfigured += 1;
        else summary.ok += 1;

        reportRows.push({
            requestId: request.id,
            admissionNumber: request.admission_number,
            studentName: request.student_name,
            college: request.college,
            course: request.course,
            branch: request.branch,
            batch: request.batch,
            expectedYear,
            storedYear: request.year_of_study,
            storedSemesterId: request.semester_id,
            correctSemesterIds: matchingSemesters.map((semester) => semester.id).join(','),
            correctSemesterNumbers: matchingSemesters.map((semester) => semester.semester_number).join(','),
            storedExpiryDate,
            correctExpiryDate,
            issues,
        });
    }

    console.log('--- Transport Calendar Mapping Audit ---');
    console.log(`Academic Year: ${academicYear}`);
    console.log(`Course Filter: ${courseFilter || 'ALL'}`);
    console.log(`Approved Requests Checked: ${summary.totalRequests}`);
    console.log(`Calendar Rows Loaded: ${semesterRows.length}`);

    console.log('\n--- Summary ---');
    Object.entries(summary).forEach(([name, value]) => {
        console.log(`${name}: ${value}`);
    });

    console.log('\n--- All Request Status Counts By Course ---');
    allStatusRows.forEach((row) => {
        console.log(`course=${row.course || 'UNKNOWN'} | status=${row.status || 'NULL'} | count=${row.count}`);
    });

    console.log('\n--- Course/Batch/Expected-Year Calendar Dates ---');
    const calendarGroups = new Map();
    for (const row of reportRows) {
        const groupKey = key(row.course, row.batch, row.expectedYear);
        if (!calendarGroups.has(groupKey)) {
            calendarGroups.set(groupKey, {
                course: row.course,
                batch: row.batch,
                expectedYear: row.expectedYear,
                semesterIds: row.correctSemesterIds,
                semesterNumbers: row.correctSemesterNumbers,
                expiryDate: row.correctExpiryDate,
                count: 0,
            });
        }
        calendarGroups.get(groupKey).count += 1;
    }
    [...calendarGroups.values()]
        .sort((a, b) => String(a.course).localeCompare(String(b.course)) || Number(a.batch || 0) - Number(b.batch || 0))
        .forEach((group) => {
            console.log([
                `course=${group.course}`,
                `batch=${group.batch}`,
                `expectedYear=${group.expectedYear ?? 'NULL'}`,
                `requests=${group.count}`,
                `calendarSemesters=${group.semesterIds || 'NULL'}`,
                `semesterNumbers=${group.semesterNumbers || 'NULL'}`,
                `calendarExpiry=${group.expiryDate || 'NULL'}`,
            ].join(' | '));
        });

    console.log('\n--- Misconfigured Requests ---');
    const misconfiguredRows = reportRows.filter((row) => row.issues.length);
    if (!misconfiguredRows.length) {
        console.log('No misconfigured requests found.');
    } else {
        misconfiguredRows.forEach(printRow);
    }

    process.exit(0);
}

main().catch((error) => {
    console.error('Audit failed:', error);
    process.exit(1);
});
