/**
 * Find 2025-2026 transport requests that are not expired and fetch their course end dates from the academic calendar.
 *
 * Usage:
 *   node scripts/findActiveRequestsCalendarDates.js
 *   node scripts/findActiveRequestsCalendarDates.js --date 2026-05-01
 *   node scripts/findActiveRequestsCalendarDates.js --course "B.Tech"
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { mysqlPool } = require('../config/db');

const args = process.argv.slice(2);
const dateArgIndex = args.indexOf('--date');
const courseArgIndex = args.indexOf('--course');
const limitArgIndex = args.indexOf('--limit');

// Use custom date or default to today's local date
let comparisonDateStr = dateArgIndex >= 0 ? args[dateArgIndex + 1] : null;
const courseFilter = courseArgIndex >= 0 ? args[courseArgIndex + 1] : null;
const limitVal = limitArgIndex >= 0 ? parseInt(args[limitArgIndex + 1], 10) : 50;

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

async function main() {
    if (!mysqlPool) {
        console.error('MySQL connection not available. Check your backend/.env configuration.');
        process.exit(1);
    }

    const academicYear = '2025-2026';
    const todayStr = formatDate(new Date());

    // If today is past the end of 2025-2026 (i.e. > 2026-06-30) and no custom date is provided,
    // notify the user and default to a representative date within the academic year (e.g., 2026-05-01)
    // so they can see requests that were active then.
    if (!comparisonDateStr) {
        if (todayStr > '2026-06-30') {
            comparisonDateStr = '2026-05-01';
            console.log(`[INFO] Current system date (${todayStr}) is past the 2025-2026 academic year.`);
            console.log(`       Defaulting comparison date to '${comparisonDateStr}' to show active requests during the semester.`);
        } else {
            comparisonDateStr = todayStr;
        }
    }

    console.log('--- 2025-2026 Active Requests & Calendar Dates ---');
    console.log(`Comparison Date : ${comparisonDateStr}`);
    if (courseFilter) {
        console.log(`Course Filter   : ${courseFilter}`);
    }

    // 1. Fetch academic_years details
    const [academicYears] = await mysqlPool.query(
        'SELECT id, year_label, start_date, end_date FROM academic_years WHERE year_label = ?',
        [academicYear]
    );
    const ayRow = academicYears[0];
    if (!ayRow) {
        console.error(`Error: Academic year '${academicYear}' not found in academic_years table.`);
        process.exit(1);
    }
    const ayEndDate = formatDate(ayRow.end_date) || `${academicYear.split('-')[1]}-06-30`;

    // 2. Fetch all courses
    const [courses] = await mysqlPool.query('SELECT id, name, code, total_years FROM courses');
    const coursesMap = new Map();
    courses.forEach((c) => {
        coursesMap.set(c.name.toLowerCase().trim(), c);
    });

    // 3. Fetch all semesters for 2025-2026
    const [semesters] = await mysqlPool.query(
        `SELECT id, course_id, academic_year_id, batch, year_of_study, semester_number, start_date, end_date
         FROM semesters WHERE academic_year_id = ?`,
        [ayRow.id]
    );
    
    // Group semesters by strict key (course_id | batch | year_of_study)
    const semestersMap = new Map();
    semesters.forEach((sem) => {
        const key = `${sem.course_id}-${sem.batch}-${sem.year_of_study}`;
        if (!semestersMap.has(key)) {
            semestersMap.set(key, []);
        }
        semestersMap.get(key).push(sem);
    });

    // Sort semesters by semester_number descending to find the last active semester
    for (const [key, semsList] of semestersMap.entries()) {
        semsList.sort((a, b) => (b.semester_number || 0) - (a.semester_number || 0));
    }

    // 4. Fetch all course transport expiry overrides for 2025-2026
    const [expiryOverrides] = await mysqlPool.query(
        'SELECT course_id, academic_year, year_of_study, expiry_date FROM course_transport_expiry WHERE academic_year = ?',
        [academicYear]
    );
    const expiryMap = new Map();
    expiryOverrides.forEach((exp) => {
        const key = `${exp.course_id}-${exp.year_of_study}`;
        expiryMap.set(key, formatDate(exp.expiry_date));
    });

    // 5. Fetch approved transport requests for 2025-2026 joined with student info
    let courseSql = '';
    const queryParams = [academicYear];
    if (courseFilter) {
        courseSql = 'AND (LOWER(s1.course) = ? OR LOWER(s2.course) = ?)';
        queryParams.push(courseFilter.toLowerCase().trim(), courseFilter.toLowerCase().trim());
    }

    const [requests] = await mysqlPool.query(
        `SELECT tr.id, tr.admission_number, tr.student_name, tr.expiry_date as stored_expiry,
                tr.semester_id, tr.year_of_study,
                COALESCE(s1.college, s2.college) AS college,
                COALESCE(s1.course, s2.course) AS course,
                COALESCE(s1.batch, s2.batch) AS batch,
                COALESCE(s1.current_year, s2.current_year) AS student_current_year
         FROM transport_requests tr
         LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
         LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
         WHERE tr.status = 'approved'
           AND COALESCE(tr.academic_year, '2025-2026') = ?
           ${courseSql}
         ORDER BY tr.id ASC`,
        queryParams
    );

    console.log(`\nFound ${requests.length} total approved requests for ${academicYear}.`);

    const activeRequests = [];
    const expiredRequests = [];
    const missingConfigRequests = [];

    for (const tr of requests) {
        if (!tr.course) {
            missingConfigRequests.push({ request: tr, reason: 'No course assigned to student' });
            continue;
        }

        const courseObj = coursesMap.get(tr.course.toLowerCase().trim());
        if (!courseObj) {
            missingConfigRequests.push({ request: tr, reason: `Course '${tr.course}' not found in courses configuration` });
            continue;
        }

        // Calculate expected year of study based on student batch
        let yearOfStudy = expectedYearForBatch(academicYear, tr.batch);
        if (yearOfStudy == null || Number.isNaN(yearOfStudy)) {
            yearOfStudy = tr.student_current_year || tr.year_of_study || 1;
        }

        // 1. Resolve Effective Expiry Date
        let effectiveExpiry = null;
        let sourceUsed = 'None';

        // Check Course Expiry Override
        const overrideKey = `${courseObj.id}-${yearOfStudy}`;
        const overrideDate = expiryMap.get(overrideKey);
        if (overrideDate) {
            effectiveExpiry = overrideDate;
            sourceUsed = 'Course Override';
        } else {
            // Check Semesters Calendar
            const semKey = `${courseObj.id}-${tr.batch}-${yearOfStudy}`;
            const semsList = semestersMap.get(semKey) || [];
            const bestSem = semsList[0] || null; // sorted by sem number desc (last sem)
            const semEndDate = bestSem ? formatDate(bestSem.end_date) : null;

            if (semEndDate) {
                effectiveExpiry = semEndDate;
                sourceUsed = `Semester End (Sem ${bestSem.semester_number})`;
            } else {
                // Fallback to Academic Year End
                effectiveExpiry = ayEndDate;
                sourceUsed = 'Academic Year Fallback';
            }
        }

        // Determine if request is active (not expired) as of comparisonDateStr
        const isExpired = effectiveExpiry ? comparisonDateStr > effectiveExpiry : true;

        const info = {
            id: tr.id,
            admissionNumber: tr.admission_number,
            studentName: tr.student_name,
            courseName: tr.course,
            batch: tr.batch,
            yearOfStudy,
            effectiveExpiry,
            storedExpiry: formatDate(tr.stored_expiry),
            sourceUsed
        };

        if (isExpired) {
            expiredRequests.push(info);
        } else {
            activeRequests.push(info);
        }
    }

    console.log(`\n--- Expiry Status Summary (as of ${comparisonDateStr}) ---`);
    console.log(`Active (Not Expired): ${activeRequests.length}`);
    console.log(`Expired:             ${expiredRequests.length}`);
    console.log(`Missing Student/Course Config: ${missingConfigRequests.length}`);

    // Print active requests details
    console.log(`\n--- Active Requests List (Showing top ${limitVal}) ---`);
    if (activeRequests.length === 0) {
        console.log('No active requests found.');
    } else {
        const displayList = activeRequests.slice(0, limitVal);
        displayList.forEach((r) => {
            console.log(
                `Req ID: ${String(r.id).padEnd(5)} | Name: ${r.studentName.padEnd(25)} | ` +
                `Course: ${r.courseName.padEnd(10)} | Batch: ${r.batch} | Year: ${r.yearOfStudy} | ` +
                `Expiry: ${r.effectiveExpiry} (Source: ${r.sourceUsed})`
            );
        });
        if (activeRequests.length > limitVal) {
            console.log(`... and ${activeRequests.length - limitVal} more active requests.`);
        }
    }

    if (missingConfigRequests.length > 0) {
        console.log(`\n--- Missing Config Details (Showing top 10) ---`);
        missingConfigRequests.slice(0, 10).forEach(({ request, reason }) => {
            console.log(`Req ID: ${request.id} | Adm: ${request.admission_number} | Student: ${request.student_name} | Reason: ${reason}`);
        });
    }

    // Group active requests by course to show academic calendar details
    console.log('\n--- Year End Dates for Active Courses in Academic Calendar ---');
    const courseGroups = new Map();
    activeRequests.forEach((r) => {
        if (!courseGroups.has(r.courseName)) {
            courseGroups.set(r.courseName, new Map());
        }
        const yearGroups = courseGroups.get(r.courseName);
        if (!yearGroups.has(r.yearOfStudy)) {
            yearGroups.set(r.yearOfStudy, { count: 0, expiry: r.effectiveExpiry, source: r.sourceUsed });
        }
        yearGroups.get(r.yearOfStudy).count += 1;
    });

    for (const [courseName, yearGroups] of courseGroups.entries()) {
        console.log(`\nCourse: ${courseName}`);
        console.log('-'.repeat(courseName.length + 8));
        for (const [yearOfStudy, data] of yearGroups.entries()) {
            console.log(`  Year of Study: ${yearOfStudy} | Active Requests: ${data.count} | Calendar End Date: ${data.expiry} (${data.source})`);
        }
    }

    process.exit(0);
}

main().catch((err) => {
    console.error('Fatal error executing script:', err);
    process.exit(1);
});
