const { mysqlPool } = require('../config/db');

/**
 * Resolves the academic year based on input source, env, or default helper.
 */
function resolveAcademicYear(academicYear) {
    if (academicYear) return String(academicYear).trim();
    return process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
}

/**
 * Returns default academic year (July to June split) based on current month.
 */
function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth(); // 0-indexed
    if (month >= 5) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

/**
 * Returns the end year from academic year label (e.g., '2025-2026' -> 2026).
 */
function getAcademicYearEndYear(academicYear) {
    if (!academicYear) return null;
    const parts = String(academicYear).split('-');
    if (parts.length !== 2) return null;
    const endYear = Number(parts[1]);
    return isNaN(endYear) ? null : endYear;
}

/**
 * Calculates the expected year of study based on academic year and student batch.
 */
function getExpectedYearForBatch(academicYearLabel, batch) {
    if (!academicYearLabel || !batch) return null;
    const startYear = Number(String(academicYearLabel).split('-')[0]);
    const batchYear = Number(String(batch).trim());
    if (Number.isNaN(startYear) || Number.isNaN(batchYear)) {
        return null;
    }
    return startYear - batchYear + 1;
}

/**
 * Helper to convert dates to JS Date objects safely.
 */
function toDate(d) {
    if (!d) return null;
    const date = new Date(d);
    return isNaN(date.getTime()) ? null : date;
}

/**
 * Dynamic Expiry Resolver for Student Transport Requests.
 * Resolves expiry dates and status dynamically from the SQL calendar and metadata.
 * Mutates requests in-place and adds/updates:
 *  - semester_end_date
 *  - expiry_date
 *  - effective_expiry_date
 *  - is_expired (boolean)
 *
 * @param {Array<object>} requests - Array of plain JS student transport request objects
 * @param {object} customPool - Optional custom mysqlPool (falls back to default)
 * @returns {Promise<Array<object>>} - Enriched requests array
 */
async function resolveStudentExpiries(requests, customPool = null) {
    if (!Array.isArray(requests) || requests.length === 0) {
        return requests;
    }

    const pool = customPool || mysqlPool;
    if (!pool) {
        console.warn('[expiryResolver] MySQL Pool not initialized. Skipping dynamic resolution.');
        return requests;
    }

    const now = new Date();

    // 1. Gather all unique admission numbers to look up student info
    const admissionNos = [...new Set(requests.map(r => r.admission_number).filter(Boolean))];
    const studentMap = new Map();

    if (admissionNos.length > 0) {
        try {
            const [studentRows] = await pool.query(
                `SELECT admission_number, admission_no, course, batch, current_year
                 FROM students
                 WHERE admission_number IN (?) OR admission_no IN (?)`,
                [admissionNos, admissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap.set(String(s.admission_number).trim(), s);
                if (s.admission_no) studentMap.set(String(s.admission_no).trim(), s);
            }
        } catch (err) {
            console.error('[expiryResolver] Error querying students table:', err);
        }
    }

    // 2. Preload SQL metadata (Courses, Academic Years, Semesters, Course Expiries)
    let coursesMap = new Map();
    let academicYearsMap = new Map();
    let semestersList = [];
    let expiryOverridesMap = new Map();

    try {
        const [courseRows] = await pool.query('SELECT id, name FROM courses');
        coursesMap = new Map(courseRows.map(c => [c.name.toLowerCase().trim(), c.id]));

        const [ayRows] = await pool.query('SELECT id, year_label FROM academic_years');
        academicYearsMap = new Map(ayRows.map(ay => [String(ay.year_label).trim(), ay.id]));

        const [semRows] = await pool.query(
            'SELECT id, course_id, academic_year_id, batch, year_of_study, semester_number, end_date FROM semesters'
        );
        semestersList = semRows;

        const [expRows] = await pool.query(
            'SELECT course_id, academic_year, year_of_study, expiry_date FROM course_transport_expiry'
        );
        for (const exp of expRows) {
            const key = `${exp.course_id}-${exp.academic_year}-${exp.year_of_study}`;
            expiryOverridesMap.set(key, exp.expiry_date);
        }
    } catch (err) {
        console.error('[expiryResolver] Error loading SQL metadata tables:', err);
    }

    // 3. Resolve each request dynamically in-memory
    for (const tr of requests) {
        const student = tr.admission_number ? studentMap.get(String(tr.admission_number).trim()) : null;
        const courseName = tr.course || (student ? student.course : null);
        const batch = student ? student.batch : null;
        
        const requestAcademicYear = resolveAcademicYear(tr.academic_year);
        
        let yearOfStudy = getExpectedYearForBatch(requestAcademicYear, batch);
        if (yearOfStudy == null || isNaN(yearOfStudy)) {
            yearOfStudy = student && student.current_year != null
                ? Number(student.current_year)
                : (tr.year_of_study != null ? Number(tr.year_of_study) : 1);
        }

        const courseId = courseName ? coursesMap.get(courseName.toLowerCase().trim()) : null;
        const academicYearId = academicYearsMap.get(requestAcademicYear);

        let resolvedSemEndDate = null;
        let resolvedExpiryDate = null;

        // A. Match linked semester_id from SQL
        if (tr.semester_id && semestersList.length > 0) {
            const linkedSem = semestersList.find(s => Number(s.id) === Number(tr.semester_id));
            if (linkedSem) {
                resolvedSemEndDate = toDate(linkedSem.end_date);
            }
        }

        // B. Fallback to latest configured semester matching (course, academic year, batch, year of study)
        if (!resolvedSemEndDate && courseId && academicYearId && semestersList.length > 0) {
            const matchedSems = semestersList.filter(sem => 
                Number(sem.course_id) === Number(courseId) &&
                Number(sem.academic_year_id) === Number(academicYearId) &&
                String(sem.batch || '') === String(batch || '') &&
                Number(sem.year_of_study) === Number(yearOfStudy)
            );

            if (matchedSems.length > 0) {
                // Sort descending by semester_number to find the latest
                matchedSems.sort((a, b) => Number(b.semester_number || 0) - Number(a.semester_number || 0));
                resolvedSemEndDate = toDate(matchedSems[0].end_date);
            }
        }

        // C. Fallback: Check if there is an explicit expiry override setting for this course
        if (courseId && expiryOverridesMap.size > 0) {
            const overrideKey = `${courseId}-${requestAcademicYear}-${yearOfStudy}`;
            const overrideExpiry = expiryOverridesMap.get(overrideKey);
            if (overrideExpiry) {
                resolvedExpiryDate = toDate(overrideExpiry);
            }
        }

        // D. Combine resolved end date & expiry date
        if (!resolvedExpiryDate) {
            resolvedExpiryDate = resolvedSemEndDate;
        }

        // E. Academic Year Fallback (June 30 of the ending year) if no calendar settings exist
        if (!resolvedExpiryDate) {
            const endYear = getAcademicYearEndYear(requestAcademicYear);
            if (endYear) {
                resolvedExpiryDate = new Date(`${endYear}-06-30T23:59:59.999Z`);
            }
        }

        // F. Set resolved values on the request object
        const finalSemEndDate = resolvedSemEndDate || resolvedExpiryDate;
        const finalExpiryDate = resolvedExpiryDate || resolvedSemEndDate;

        tr.semester_end_date = finalSemEndDate;
        tr.expiry_date = finalExpiryDate;
        tr.effective_expiry_date = finalExpiryDate;
        tr.is_expired = finalExpiryDate ? (finalExpiryDate < now) : false;
    }

    return requests;
}

module.exports = {
    resolveStudentExpiries,
    resolveAcademicYear,
    getDefaultAcademicYear
};
