const { mysqlPool } = require('../config/db');
const { getDefaultAcademicYear, resolveAcademicYear } = require('./transportRequestController');
const { resolveStudentPhoto } = require('../utils/studentPhoto');
const { validateStudentAcademicContext } = require('../utils/studentAcademicValidation');

const COURSE_EXPIRY_MIGRATION_MSG =
    'Remove the old course+academic-year-only unique key so each year can have its own date. Run: ' +
    'ALTER TABLE course_transport_expiry DROP INDEX uk_course_academic_year; ' +
    '(If year_of_study column is missing, add it first — see backend/mysql-schema/alter-transport-requests-semester.sql)';

let courseExpirySchemaOkCache = null;

const courseExpirySupportsYearOfStudy = async () => {
    if (courseExpirySchemaOkCache != null) return courseExpirySchemaOkCache;
    try {
        const [rows] = await mysqlPool.query(
            `SELECT INDEX_NAME, COLUMN_NAME
             FROM information_schema.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE()
               AND TABLE_NAME = 'course_transport_expiry'
               AND NON_UNIQUE = 0
               AND INDEX_NAME != 'PRIMARY'`
        );
        const indexColumns = {};
        for (const row of rows) {
            if (!indexColumns[row.INDEX_NAME]) indexColumns[row.INDEX_NAME] = new Set();
            indexColumns[row.INDEX_NAME].add(row.COLUMN_NAME);
        }
        const hasYearWiseKey = Object.values(indexColumns).some(
            (cols) => cols.has('course_id') && cols.has('academic_year') && cols.has('year_of_study')
        );
        const hasLegacyCourseYearKey = Object.values(indexColumns).some(
            (cols) =>
                cols.size === 2 &&
                cols.has('course_id') &&
                cols.has('academic_year') &&
                !cols.has('year_of_study')
        );
        courseExpirySchemaOkCache = hasYearWiseKey && !hasLegacyCourseYearKey;
    } catch {
        courseExpirySchemaOkCache = false;
    }
    return courseExpirySchemaOkCache;
};

// @desc    Search students from MySQL
// @route   GET /api/students/search
// @access  Private/Admin
const searchStudents = async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ message: 'Search query is required' });
    }

    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        // Search by name, admission number, or PIN number
        const sql = `
            SELECT id, admission_number, admission_no, pin_no, student_name, course, branch, batch, current_year, current_semester, stud_type
            FROM students
            WHERE student_name LIKE ? OR admission_number LIKE ? OR admission_no LIKE ? OR pin_no LIKE ?
            LIMIT 50
        `;
        const searchTerm = `%${q}%`;
        const [rows] = await mysqlPool.query(sql, [searchTerm, searchTerm, searchTerm, searchTerm]);

        res.json(rows);
    } catch (error) {
        console.error('Error searching students:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all courses from MySQL
// @route   GET /api/students/courses
// @access  Private/Admin
const getCourses = async (req, res) => {
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query('SELECT id, name, code, total_years FROM courses WHERE is_active = 1 ORDER BY name ASC');
        res.json(rows);
    } catch (error) {
        console.error('Error fetching courses:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    List course-level transport expiry dates for an academic year
// @route   GET /api/students/course-expiry?academicYear=2024-2025
const getCourseExpiry = async (req, res) => {
    const academicYear = resolveAcademicYear(req.query);
    const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query(
            `SELECT c.id AS course_id, c.name AS course_name, c.code AS course_code, c.total_years,
                    yrs.year_of_study,
                    cte.id AS expiry_id, cte.expiry_date, cte.academic_year,
                    CASE
                        WHEN cte.expiry_date IS NOT NULL AND CURDATE() > cte.expiry_date THEN 1
                        ELSE 0
                    END AS is_past,
                    COALESCE(pc.passenger_count, 0) AS passenger_count,
                    COALESCE(pc.active_passenger_count, 0) AS active_passenger_count,
                    COALESCE(pc.expired_passenger_count, 0) AS expired_passenger_count
             FROM courses c
             JOIN (
               SELECT 1 AS year_of_study UNION ALL SELECT 2 UNION ALL SELECT 3
               UNION ALL SELECT 4 UNION ALL SELECT 5 UNION ALL SELECT 6
             ) yrs ON yrs.year_of_study <= c.total_years
             LEFT JOIN course_transport_expiry cte
               ON cte.course_id = c.id
              AND cte.academic_year = ?
              AND cte.year_of_study = yrs.year_of_study
             LEFT JOIN (
               SELECT
                 c2.id AS course_id,
                 COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1) AS year_of_study,
                 COUNT(*) AS passenger_count,
                 SUM(CASE
                   WHEN COALESCE(cte2.expiry_date, sem2.end_date, tr.expiry_date) IS NULL
                     OR CURDATE() <= COALESCE(cte2.expiry_date, sem2.end_date, tr.expiry_date)
                   THEN 1 ELSE 0
                 END) AS active_passenger_count,
                 SUM(CASE
                   WHEN COALESCE(cte2.expiry_date, sem2.end_date, tr.expiry_date) IS NOT NULL
                     AND CURDATE() > COALESCE(cte2.expiry_date, sem2.end_date, tr.expiry_date)
                   THEN 1 ELSE 0
                 END) AS expired_passenger_count
               FROM transport_requests tr
               LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
               LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
               INNER JOIN courses c2 ON c2.name = COALESCE(s1.course, s2.course) AND c2.is_active = 1
               LEFT JOIN course_transport_expiry cte2
                 ON cte2.course_id = c2.id
                AND cte2.academic_year = ?
                AND cte2.year_of_study = COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1)
               LEFT JOIN semesters sem2 ON sem2.id = tr.semester_id
               WHERE tr.status = 'approved'
                 AND COALESCE(tr.academic_year, ?) = ?
               GROUP BY c2.id, COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1)
             ) pc ON pc.course_id = c.id AND pc.year_of_study = yrs.year_of_study
             WHERE c.is_active = 1
             ORDER BY c.name ASC, yrs.year_of_study ASC`,
            [academicYear, academicYear, fallbackAcademicYear, academicYear]
        );

        const yearWiseKeyOk = await courseExpirySupportsYearOfStudy();
        res.json({
            academicYear,
            courses: rows.map((row) => ({
                ...row,
                year_of_study: Number(row.year_of_study),
            })),
            yearWiseKeyOk,
            ...(yearWiseKeyOk ? {} : { migrationHint: COURSE_EXPIRY_MIGRATION_MSG }),
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                message: 'Table course_transport_expiry not found. Run the SQL migration first.',
            });
        }
        console.error('Error fetching course expiry:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Set or update course-level transport expiry (overrides semester expiry for that course)
// @route   PUT /api/students/course-expiry
const setCourseExpiry = async (req, res) => {
    const { course_id, academic_year, expiry_date, year_of_study } = req.body || {};
    const academicYear = academic_year || resolveAcademicYear(req.body);
    const yearOfStudy = Number(year_of_study);

    if (!course_id || !expiry_date || !yearOfStudy || yearOfStudy < 1) {
        return res.status(400).json({ message: 'course_id, year_of_study, and expiry_date are required.' });
    }

    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [courseRows] = await mysqlPool.query(
            'SELECT id, name, total_years FROM courses WHERE id = ? AND is_active = 1 LIMIT 1',
            [course_id]
        );
        if (!courseRows[0]) {
            return res.status(404).json({ message: 'Course not found.' });
        }
        if (yearOfStudy > courseRows[0].total_years) {
            return res.status(400).json({
                message: `Year ${yearOfStudy} is invalid for ${courseRows[0].name} (max ${courseRows[0].total_years} years).`,
            });
        }

        const yearWiseKeyOk = await courseExpirySupportsYearOfStudy();
        if (!yearWiseKeyOk) {
            return res.status(503).json({ message: COURSE_EXPIRY_MIGRATION_MSG });
        }

        const [updateResult] = await mysqlPool.query(
            `UPDATE course_transport_expiry
             SET expiry_date = ?, updated_at = CURRENT_TIMESTAMP
             WHERE course_id = ? AND academic_year = ? AND year_of_study = ?`,
            [expiry_date, course_id, academicYear, yearOfStudy]
        );

        if (updateResult.affectedRows === 0) {
            try {
                await mysqlPool.query(
                    `INSERT INTO course_transport_expiry (course_id, academic_year, year_of_study, expiry_date)
                     VALUES (?, ?, ?, ?)`,
                    [course_id, academicYear, yearOfStudy, expiry_date]
                );
            } catch (insertError) {
                if (insertError.code === 'ER_DUP_ENTRY') {
                    return res.status(409).json({ message: COURSE_EXPIRY_MIGRATION_MSG });
                }
                throw insertError;
            }
        }

        const [saved] = await mysqlPool.query(
            `SELECT id, course_id, academic_year, year_of_study, expiry_date FROM course_transport_expiry
             WHERE course_id = ? AND academic_year = ? AND year_of_study = ? LIMIT 1`,
            [course_id, academicYear, yearOfStudy]
        );

        if (!saved[0]) {
            return res.status(500).json({
                message: `Saved expiry for Year ${yearOfStudy} but could not read it back. Check database constraints.`,
            });
        }

        res.json({
            message: `Transport expiry set for ${courseRows[0].name} Year ${yearOfStudy} (${academicYear}). Passes expire on ${expiry_date}, regardless of semester dates.`,
            ...saved[0],
            year_of_study: Number(saved[0].year_of_study),
            course_name: courseRows[0].name,
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                message: 'Table course_transport_expiry not found. Run the SQL migration first.',
            });
        }
        console.error('Error setting course expiry:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Remove course-level transport expiry (falls back to per-request semester expiry)
// @route   DELETE /api/students/course-expiry/:courseId?academicYear=2024-2025
const deleteCourseExpiry = async (req, res) => {
    const courseId = req.params.courseId;
    const academicYear = resolveAcademicYear(req.query);
    const yearOfStudy = Number(req.query.yearOfStudy);

    if (!yearOfStudy || yearOfStudy < 1) {
        return res.status(400).json({ message: 'Query parameter yearOfStudy is required (e.g. 1, 2, 3).' });
    }

    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [result] = await mysqlPool.query(
            'DELETE FROM course_transport_expiry WHERE course_id = ? AND academic_year = ? AND year_of_study = ?',
            [courseId, academicYear, yearOfStudy]
        );

        if (result.affectedRows === 0) {
            return res.status(404).json({
                message: 'No course expiry record found for this course, academic year, and year of study.',
            });
        }

        res.json({
            message: 'Course transport expiry removed.',
            course_id: Number(courseId),
            academic_year: academicYear,
            year_of_study: yearOfStudy,
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({
                message: 'Table course_transport_expiry not found. Run the SQL migration first.',
            });
        }
        console.error('Error deleting course expiry:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get single student profile (includes photo from students.student_photo)
// @route   GET /api/students/profile
// @access  Private/Admin
const getStudentProfile = async (req, res) => {
    const { id, admission_number, admission_no } = req.query;
    if (!id && !admission_number && !admission_no) {
        return res.status(400).json({ message: 'id or admission_number is required' });
    }

    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const profileFields = `id, admission_number, admission_no, pin_no, student_name, course, branch, batch,
                    current_year, current_semester, stud_type, student_photo, student_data,
                    student_mobile, parent_mobile1, parent_mobile2, father_name, student_address,
                    city_village, district, college, email`;

        let rows;
        if (id) {
            [rows] = await mysqlPool.query(
                `SELECT ${profileFields} FROM students WHERE id = ? LIMIT 1`,
                [id]
            );
        } else {
            const adm = admission_number || admission_no;
            [rows] = await mysqlPool.query(
                `SELECT ${profileFields} FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1`,
                [adm, adm]
            );
        }

        if (!rows[0]) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const row = rows[0];

        // Fetch overall concessions for the student
        const admNo = row.admission_number || row.admission_no;
        let overallConcession = null;
        try {
            const [concessionRows] = await mysqlPool.query(
                'SELECT * FROM overall_concessions WHERE admission_number = ? LIMIT 1',
                [admNo]
            );
            if (concessionRows && concessionRows.length > 0) {
                overallConcession = concessionRows[0];
            }
        } catch (err) {
            console.error('Error fetching overall concession for profile:', err);
        }

        // Fetch transport fee head ID
        let transportFeeHeadId = null;
        try {
            const { getFeePortalModels } = require('../models/fee-portal-models');
            const feeModels = getFeePortalModels();
            if (feeModels) {
                const { FeeHead } = feeModels;
                const transportFeeHead = await FeeHead.findOne({
                    $or: [
                        { code: 'TRN01' },
                        { code: 'trn01' },
                        { name: { $regex: /transport/i } }
                    ]
                });
                if (transportFeeHead) {
                    transportFeeHeadId = transportFeeHead._id.toString();
                }
            }
        } catch (err) {
            console.error('Error resolving transport fee head ID for profile:', err);
        }

        res.json({
            ...row,
            student_photo: resolveStudentPhoto(row),
            overallConcession,
            transportFeeHeadId
        });
    } catch (error) {
        console.error('Error fetching student profile:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    List configured academic years from MySQL
// @route   GET /api/students/academic-years
// @access  Private/Admin
const getAcademicYears = async (req, res) => {
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query(
            `SELECT id, year_label, start_date, end_date, is_active
             FROM academic_years
             WHERE is_active = 1
             ORDER BY year_label DESC`
        );
        res.json(rows);
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({ message: 'Table academic_years not found in student database.' });
        }
        console.error('Error fetching academic years:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Validate student batch, current year, and academic year alignment
// @route   GET /api/students/academic-validation
// @access  Private/Admin
const getAcademicValidation = async (req, res) => {
    const { id, admission_number, admission_no } = req.query;
    const academicYear = resolveAcademicYear(req.query);

    if (!id && !admission_number && !admission_no) {
        return res.status(400).json({ message: 'id or admission_number is required' });
    }

    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        let rows;
        if (id) {
            [rows] = await mysqlPool.query(
                'SELECT batch, course, branch, current_year, current_semester, student_name FROM students WHERE id = ? LIMIT 1',
                [id]
            );
        } else {
            const adm = admission_number || admission_no;
            [rows] = await mysqlPool.query(
                'SELECT batch, course, branch, current_year, current_semester, student_name FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
                [adm, adm]
            );
        }

        if (!rows[0]) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const result = await validateStudentAcademicContext(mysqlPool, rows[0], academicYear);
        res.json(result);
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({ message: 'Semesters or academic_years table not found in student database.' });
        }
        console.error('Error validating student academic context:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    searchStudents,
    getStudentProfile,
    getCourses,
    getCourseExpiry,
    setCourseExpiry,
    deleteCourseExpiry,
    getAcademicYears,
    getAcademicValidation,
};
