const { mysqlPool, getFeeConnection } = require('../config/db');
const { getFeePortalModels } = require('../models/fee-portal-models');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const mongoose = require('mongoose');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const { validateStudentAcademicContext, getExpectedYearForBatch } = require('../utils/studentAcademicValidation');
const { assignTransportApplicationNumber, peekNextTransportApplicationNumber, formatApplicationCode } = require('../utils/transportApplicationNumber');
const { resolveApplicationNumberContext } = require('../utils/applicationNumberContext');
const { resolveRouteStageFare } = require('../utils/stageFare');
const { getCollegesForCampuses } = require('./campusController');
const campusService = require('../services/campusService');

const getRestrictedCollegesForUser = async (user, selectedCampusId = null) => {
    const isSuperAdmin = user && user.roles && user.roles.includes('superadmin');
    if (isSuperAdmin) return null;

    let campusIds = [];
    if (selectedCampusId) {
        const normalized = campusService.normalizeCampusId(selectedCampusId);
        campusIds = normalized !== null ? [normalized] : [];
    } else if (user && user.campuses && user.campuses.length > 0) {
        campusIds = campusService.normalizeCampusIds(user.campuses);
    }

    let campusColleges = [];
    if (campusIds.length > 0) {
        campusColleges = await getCollegesForCampuses(campusIds);
    }

    const hasCollegeRestriction = user && user.colleges && user.colleges.length > 0;

    if (hasCollegeRestriction) {
        if (campusColleges.length > 0) {
            return user.colleges.filter(c => campusColleges.includes(c));
        }
        return user.colleges;
    }

    if (campusColleges.length > 0) {
        return campusColleges;
    }

    return null;
};

const isMongoId = (id) => mongoose.Types.ObjectId.isValid(id) && String(new mongoose.Types.ObjectId(id)) === String(id);

const TRANSPORT_FEE_HEAD_CODE = 'TRN01';

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (month >= 5) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

function resolveAcademicYear(source) {
    const fromSource = source?.academicYear || source?.academic_year;
    return fromSource || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
}

const STUDENT_JOINS_SQL = `
    LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
    LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL`;

function getActivePassengerSqlParts(fallbackAcademicYear) {
    const fallback = fallbackAcademicYear || getDefaultAcademicYear();
    const academicYearEndExpr = `STR_TO_DATE(CONCAT(SUBSTRING_INDEX(ay_act.year_label, '-', -1), '-06-30'), '%Y-%m-%d')`;
    const strictExpiryExpr = `COALESCE(cte.expiry_date, sem.end_date)`;
    const isAcademicYearPastExpr = `(${strictExpiryExpr} IS NULL AND ${academicYearEndExpr} IS NOT NULL AND CURDATE() > ${academicYearEndExpr})`;
    // Match expiry only to the request's own academic year, batch, course, and year.
    return {
        academicYear: fallback,
        studentJoins: STUDENT_JOINS_SQL,
        expiryJoins: `
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
              AND sem.year_of_study = COALESCE(s1.current_year, s2.current_year, tr.year_of_study, 1)`,
        activeWhere: `(((${strictExpiryExpr} IS NULL OR CURDATE() <= ${strictExpiryExpr}) AND NOT ${isAcademicYearPastExpr}))`,
        effectiveExpiryExpr: strictExpiryExpr,
        isExpiredExpr: `(tr.status = 'approved' AND ((${strictExpiryExpr} IS NOT NULL AND CURDATE() > ${strictExpiryExpr}) OR ${isAcademicYearPastExpr}))`,
        expiryParams: [fallback],
    };
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

function parseRevisedFees(value) {
    if (Array.isArray(value)) return value;
    if (typeof value === 'string' && value.trim()) {
        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed : [];
        } catch {
            return [];
        }
    }
    return [];
}

function isTransportFeeRevision(fee, transportFeeHeadId = null) {
    if (!fee) return false;
    const feeHeadCode = fee.feeHeadCode ? String(fee.feeHeadCode).toUpperCase() : '';
    if (feeHeadCode === TRANSPORT_FEE_HEAD_CODE) return true;
    if (!fee.feeHeadId) return false;
    const feeHeadId = String(fee.feeHeadId);
    return feeHeadId === String(transportFeeHeadId || '')
        || feeHeadId === '6996aa36e247525e006623ca'
        || feeHeadId === '6996aa36e247525e006623b8';
}

function calculateTransportFareAdjustment(originalFare, studentYear, revisedFees, transportFeeHeadId = null) {
    const amount = Number(originalFare || 0);
    const match = revisedFees.find((fee) => (
        isTransportFeeRevision(fee, transportFeeHeadId)
        && Number(fee.studentYear) === Number(studentYear)
        && fee.revisedAmount !== undefined
        && fee.revisedAmount !== null
    ));

    if (!match) {
        return {
            original_fare: amount,
            payable_fare: amount,
            has_fare_adjustment: false,
            fare_adjustment_type: null,
            fare_adjustment_amount: null,
        };
    }

    const adjustmentAmount = Number(match.revisedAmount || 0);
    const type = String(match.concessionType || 'REVISED').toUpperCase();
    const payable = type === 'CONCESSION'
        ? Math.max(0, amount - adjustmentAmount)
        : adjustmentAmount;

    return {
        original_fare: amount,
        payable_fare: payable,
        has_fare_adjustment: payable !== amount,
        fare_adjustment_type: type,
        fare_adjustment_amount: adjustmentAmount,
    };
}

async function enrichTransportFareAdjustments(mysqlPool, rows = []) {
    const studentRows = rows.filter((row) => {
        const admissionNumber = row.admission_number || row.admission_no;
        return admissionNumber && row.user_type !== 'employee';
    });
    if (!studentRows.length) return rows;

    const admissionNumbers = [...new Set(studentRows.map((row) => String(row.admission_number || row.admission_no)))];
    let transportFeeHeadId = null;
    try {
        const feeModels = getFeePortalModels();
        if (feeModels?.FeeHead) {
            const transportFeeHead = await feeModels.FeeHead.findOne({ code: TRANSPORT_FEE_HEAD_CODE }).select('_id').lean();
            transportFeeHeadId = transportFeeHead?._id || null;
        }
    } catch {
        transportFeeHeadId = null;
    }

    let concessionRows = [];
    try {
        const [rows] = await mysqlPool.query(
            'SELECT admission_number, revised_fees FROM overall_concessions WHERE admission_number IN (?)',
            [admissionNumbers]
        );
        concessionRows = rows || [];
    } catch (error) {
        console.error('Error fetching fare adjustments from overall_concessions:', error.message);
        return rows.map((row) => ({
            ...row,
            ...calculateTransportFareAdjustment(row.fare, row.year_of_study),
        }));
    }

    const revisedFeeMap = new Map(
        concessionRows.map((row) => [String(row.admission_number), parseRevisedFees(row.revised_fees)])
    );

    return rows.map((row) => {
        if (row.user_type === 'employee') return row;
        const admissionNumber = String(row.admission_number || row.admission_no || '');
        const revisedFees = revisedFeeMap.get(admissionNumber) || [];
        return {
            ...row,
            ...calculateTransportFareAdjustment(row.fare, row.year_of_study, revisedFees, transportFeeHeadId),
        };
    });
}

// Last semester of the student's year within the transport request's academic session.
async function getLastSemesterForRequest(mysqlPool, transportRequest) {
    const admissionNumber = transportRequest.admission_number || transportRequest.admission_no;
    if (!admissionNumber) return null;

    const requestAcademicYear = transportRequest.academic_year
        || process.env.CURRENT_ACADEMIC_YEAR
        || getDefaultAcademicYear();
    const [studentRows] = await mysqlPool.query(
        'SELECT course, batch, current_year FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
        [admissionNumber, admissionNumber]
    );
    const student = studentRows[0];
    if (!student || !student.course) return null;

    const [courseRows] = await mysqlPool.query('SELECT id FROM courses WHERE name = ? LIMIT 1', [student.course]);
    const course = courseRows[0];
    if (!course) return null;

    let yearOfStudy = getExpectedYearForBatch(requestAcademicYear, student.batch);
    if (yearOfStudy == null || isNaN(yearOfStudy)) {
        yearOfStudy = student.current_year != null
            ? Number(student.current_year)
            : (transportRequest.year_of_study != null ? Number(transportRequest.year_of_study) : 1);
    }

    // Prefer course-level expiry configured for this academic year.
    const [cteRows] = await mysqlPool.query(
        `SELECT expiry_date FROM course_transport_expiry
         WHERE course_id = ? AND academic_year = ? AND year_of_study = ?
         LIMIT 1`,
        [course.id, requestAcademicYear, yearOfStudy]
    );
    if (cteRows[0]?.expiry_date) {
        const expiryDate = cteRows[0].expiry_date;
        return {
            id: null,
            college_id: null,
            course_id: course.id,
            academic_year_id: null,
            year_of_study: yearOfStudy,
            semester_number: null,
            start_date: null,
            end_date: expiryDate,
            expiry_date: expiryDate,
            label: `Course expiry (${requestAcademicYear}, Year ${yearOfStudy})`,
        };
    }

    const [academicYearRows] = await mysqlPool.query(
        'SELECT id FROM academic_years WHERE year_label = ? LIMIT 1',
        [requestAcademicYear]
    );
    const academicYear = academicYearRows[0];
    if (!academicYear) return null;

    const [semRows] = await mysqlPool.query(
        `SELECT id, college_id, course_id, academic_year_id, year_of_study, semester_number, start_date, end_date
         FROM semesters
         WHERE course_id = ?
           AND academic_year_id = ?
           AND CAST(batch AS CHAR) = CAST(? AS CHAR)
           AND year_of_study = ?
         ORDER BY semester_number DESC, id DESC
         LIMIT 1`,
        [course.id, academicYear.id, student.batch, yearOfStudy]
    );

    const row = semRows?.[0];
    if (!row) return null;

    return {
        id: row.id,
        college_id: row.college_id,
        course_id: row.course_id,
        academic_year_id: row.academic_year_id,
        year_of_study: row.year_of_study,
        semester_number: row.semester_number,
        start_date: row.start_date,
        end_date: row.end_date,
        expiry_date: row.end_date,
        label: `End of Year ${row.year_of_study}, Sem ${row.semester_number}`,
    };
}

async function findExistingTransportRequestForYear({ admissionNumber, academicYear, userType = 'student' }) {
    if (!admissionNumber) return null;

    const resolvedYear = academicYear || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const fallbackYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

    if (userType === 'employee') {
        const rows = await EmployeeTransportRequest.find({
            emp_no: admissionNumber,
            status: { $in: ['pending', 'approved'] },
        }).lean();
        return rows.find((r) => (r.academic_year || fallbackYear) === resolvedYear) || null;
    }

    if (!mysqlPool) return null;

    const [rows] = await mysqlPool.query(
        `SELECT id, status, route_name, stage_name, academic_year, admission_number
         FROM transport_requests
         WHERE admission_number = ?
           AND status IN ('pending', 'approved')
           AND COALESCE(academic_year, ?) = ?
         ORDER BY request_date DESC
         LIMIT 1`,
        [admissionNumber, fallbackYear, resolvedYear]
    );
    return rows[0] || null;
}

function buildDuplicateRequestMessage(existing, academicYear, userType) {
    const label = userType === 'employee' ? 'employee' : 'student';
    const status = (existing.status || 'unknown').toLowerCase();
    const routeInfo =
        existing.route_name && existing.stage_name
            ? ` (${existing.route_name} – ${existing.stage_name})`
            : '';

    if (status === 'approved') {
        return `This ${label} already has an approved transport request for academic year ${academicYear}${routeInfo}. Use Route/Stage Change instead of raising a new request.`;
    }

    return `This ${label} already has a pending transport request for academic year ${academicYear}${routeInfo}. Approve, reject, or delete it before raising another.`;
}

// Get buses and their available capacities, combining counts from MySQL (students) and MongoDB (employees)
async function getBusesWithSeatsForRoute(routeId) {
    const buses = await Bus.find({ assignedRouteId: routeId }).lean();
    if (buses.length === 0) return [];

    const busNumbers = buses.map((b) => b.busNumber);
    let mysqlCountMap = {};

    if (mysqlPool) {
        const parts = getActivePassengerSqlParts(resolveAcademicYear({}));
        const placeholders = busNumbers.map(() => '?').join(',');
        const [countRows] = await mysqlPool.query(
            `SELECT tr.bus_id AS busNumber, COUNT(*) AS seatsFilled
             FROM transport_requests tr
             ${parts.studentJoins}
             ${parts.expiryJoins}
             WHERE tr.status = 'approved' AND ${parts.activeWhere} AND tr.bus_id IN (${placeholders})
             GROUP BY tr.bus_id`,
            [...parts.expiryParams, ...busNumbers]
        );
        mysqlCountMap = Object.fromEntries((countRows || []).map((r) => [r.busNumber, Number(r.seatsFilled)]));
    }

    const mongoCounts = await EmployeeTransportRequest.aggregate([
        { $match: { status: 'approved', bus_id: { $in: busNumbers } } },
        { $group: { _id: '$bus_id', count: { $sum: 1 } } }
    ]);
    const mongoCountMap = Object.fromEntries(mongoCounts.map(r => [r._id, r.count]));

    return buses.map((b) => {
        const capacity = b.capacity || 0;
        const seatsFilled = (mysqlCountMap[b.busNumber] || 0) + (mongoCountMap[b.busNumber] || 0);
        return {
            busNumber: b.busNumber,
            capacity,
            seatsFilled,
            seatsAvailable: Math.max(0, capacity - seatsFilled),
        };
    });
}

async function getApplicationNumberForApprovalPreview(mysqlPool, requestRow) {
    const academicYear = requestRow.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

    if (requestRow.application_number) {
        return {
            academic_year: academicYear,
            application_number: requestRow.application_number,
            application_serial: requestRow.application_serial != null ? Number(requestRow.application_serial) : null,
            college_code: requestRow.application_college_code || null,
            course_code: requestRow.application_course_code || null,
        };
    }

    try {
        const userType = requestRow.user_type || (requestRow.employee_name ? 'employee' : 'student');
        const admissionNumber = requestRow.admission_number || requestRow.admission_no || requestRow.emp_no;
        const context = await resolveApplicationNumberContext(mysqlPool, {
            admissionNumber,
            userType,
        });
        const next = await peekNextTransportApplicationNumber(mysqlPool, {
            academicYear,
            collegeCode: context.collegeCode,
            courseCode: context.courseCode,
        });
        return {
            academic_year: academicYear,
            college_code: context.collegeCode,
            course_code: context.courseCode,
            college_name: context.collegeName,
            course_name: context.courseName,
            next_application_number: next.application_number,
            next_application_serial: next.application_serial,
        };
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return { academic_year: academicYear };
        }
        throw error;
    }
}

// @desc    Get expiry for a transport request (last sem of student's year – for approve popup)
// @route   GET /api/transport-requests/:id/semester-options
// @access  Private/Admin
const getSemesterOptions = async (req, res) => {
    const requestId = req.params.id;
    
    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId).lean();
            if (!reqRow) return res.status(404).json({ message: 'Request not found' });
            
            const routeId = reqRow.route_id;
            let busesOnRoute = [];
            if (routeId) {
                busesOnRoute = await getBusesWithSeatsForRoute(routeId);
            }

            let applicationPreview = { academic_year: reqRow.academic_year || getDefaultAcademicYear() };
            if (mysqlPool) {
                applicationPreview = await getApplicationNumberForApprovalPreview(mysqlPool, reqRow);
            } else if (reqRow.application_number) {
                applicationPreview.application_number = reqRow.application_number;
            }

            return res.json({
                requestId: String(reqRow._id),
                studentName: reqRow.employee_name,
                admissionNumber: reqRow.emp_no,
                course: 'Employee',
                yearOfStudy: null,
                route_id: routeId,
                route_name: reqRow.route_name,
                stage_name: reqRow.stage_name,
                fare: Number(reqRow.fare) || 0,
                resolved_fare: 0,
                fare_mismatch: false,
                busesOnRoute,
                expiry: null,
                user_type: 'employee',
                ...applicationPreview,
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }
        const [reqRows] = await mysqlPool.query('SELECT * FROM transport_requests WHERE id = ?', [requestId]);
        const transportRequest = reqRows[0];
        if (!transportRequest) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        const admissionNumber = transportRequest.admission_number || transportRequest.admission_no;
        if (!admissionNumber) {
            return res.status(400).json({ message: 'Request has no admission number.' });
        }
        const lastSem = await getLastSemesterForRequest(mysqlPool, transportRequest);
        const [studentRows] = await mysqlPool.query(
            'SELECT course, current_year FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
            [admissionNumber, admissionNumber]
        );
        const student = studentRows[0] || {};
        const routeId = transportRequest.route_id;
        const routeName = transportRequest.route_name;
        let busesOnRoute = [];
        if (routeId) {
            busesOnRoute = await getBusesWithSeatsForRoute(routeId);
        }

        const applicationPreview = await getApplicationNumberForApprovalPreview(mysqlPool, transportRequest);
        const academicYear = transportRequest.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const resolvedFare = await resolveRouteStageFare(
            Route,
            transportRequest.route_id,
            transportRequest.stage_name,
            academicYear
        );
        const storedFare = Number(transportRequest.fare);

        return res.json({
            requestId: Number(requestId),
            studentName: transportRequest.student_name,
            admissionNumber,
            course: student.course,
            yearOfStudy: student.current_year != null ? Number(student.current_year) : 1,
            route_id: routeId,
            route_name: routeName,
            stage_name: transportRequest.stage_name,
            fare: storedFare,
            resolved_fare: resolvedFare,
            fare_mismatch: resolvedFare != null && storedFare !== Number(resolvedFare),
            busesOnRoute,
            ...applicationPreview,
            expiry: lastSem
                ? {
                    expiry_date: lastSem.end_date,
                    year_of_study: lastSem.year_of_study,
                    semester_number: lastSem.semester_number,
                    label: `End of Year ${lastSem.year_of_study}, Sem ${lastSem.semester_number}`,
                    semester_id: lastSem.id,
                    semester_start_date: lastSem.start_date,
                    semester_end_date: lastSem.end_date,
                    academic_year_id: lastSem.academic_year_id,
                }
                : null,
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE') {
            return res.status(503).json({ message: 'Semesters table not found. Please create it and run alter-transport-requests-semester.sql.' });
        }
        console.error('Error fetching semester options:', error);
        return res.status(500).json({ message: error.message || 'Failed to fetch expiry' });
    }
};

// @desc    Get all transport requests (optional filters: route_id, status, bus_id; bus_id=unassigned for null/empty)
// @route   GET /api/transport-requests
// @access  Private/Admin
const getTransportRequests = async (req, res) => {
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }
        const { route_id, status, bus_id, course, search } = req.query;
        const explicitAcademicYear = req.query.academicYear || req.query.academic_year;
        const parts = getActivePassengerSqlParts(resolveAcademicYear(req.query));
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const filterAcademicYear = explicitAcademicYear
            ? resolveAcademicYear(req.query)
            : null;

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCampusRestriction = req.user && !isSuperAdmin && req.user.campuses && req.user.campuses.length > 0;

        let sql = `
            SELECT tr.*,
                   COALESCE(tr.year_of_study, s1.current_year, s2.current_year) as year_of_study,
                   COALESCE(s1.course, s2.course) as course,
                   COALESCE(s1.branch, s2.branch) as branch,
                   COALESCE(s1.pin_no, s2.pin_no) as pin_no,
                   ${parts.effectiveExpiryExpr} as effective_expiry_date,
                   cte.expiry_date as course_expiry_date,
                   ${parts.isExpiredExpr} as is_expired
            FROM transport_requests tr
            ${parts.studentJoins}
            ${parts.expiryJoins}
        `;
        const params = [...parts.expiryParams];

        sql += ' WHERE 1=1';

        if (route_id) {
            sql += ' AND tr.route_id = ?';
            params.push(route_id);
        }
        if (status === 'expired') {
            sql += " AND tr.status = 'approved' AND " + parts.isExpiredExpr;
        } else if (status === 'active') {
            sql += " AND tr.status = 'approved' AND " + parts.activeWhere;
        } else if (status) {
            sql += ' AND tr.status = ?';
            params.push(status);
        }
        if (bus_id !== undefined) {
            if (bus_id === '' || bus_id === 'unassigned') {
                sql += ' AND (tr.bus_id IS NULL OR tr.bus_id = \'\')';
            } else {
                sql += ' AND tr.bus_id = ?';
                params.push(bus_id);
            }
        }
        if (course) {
            sql += ' AND COALESCE(s1.course, s2.course) = ?';
            params.push(course);
        }
        if (search) {
            sql += ' AND (tr.student_name LIKE ? OR tr.admission_number LIKE ?)';
            const searchPattern = `%${search}%`;
            params.push(searchPattern, searchPattern);
        }
        if (filterAcademicYear) {
            sql += ' AND COALESCE(tr.academic_year, ?) = ?';
            params.push(fallbackAcademicYear, filterAcademicYear);
        }
        let allowedRouteIds = [];
        let filterByCampusRoutes = false;
        let queryCampusId = campusService.normalizeCampusId(req.query.campus);
        if (queryCampusId === null && hasCampusRestriction) {
            const allowedCampusIds = campusService.normalizeCampusIds(req.user.campuses);
            const allowedRoutes = await Route.find({ campus: { $in: allowedCampusIds } }).select('routeId').lean();
            allowedRouteIds = allowedRoutes.map(r => r.routeId);
            filterByCampusRoutes = true;
        } else if (queryCampusId !== null) {
            const campusRoutes = await Route.find({ campus: queryCampusId }).select('routeId').lean();
            allowedRouteIds = campusRoutes.map(r => r.routeId);
            filterByCampusRoutes = true;
        }

        if (filterByCampusRoutes) {
            if (allowedRouteIds.length > 0) {
                const routePlaceholders = allowedRouteIds.map(() => '?').join(',');
                sql += ` AND tr.route_id IN (${routePlaceholders})`;
                params.push(...allowedRouteIds);
            } else {
                sql += ' AND 1=0';
            }
        }

        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        if (restrictedColleges !== null) {
            sql += ' AND COALESCE(s1.college, s2.college) IN (?)';
            params.push(restrictedColleges.length > 0 ? restrictedColleges : ['']);
        }
        if (hasCourseRestriction) {
            sql += ' AND COALESCE(s1.course, s2.course) IN (?)';
            params.push(req.user.courses);
        }

        sql += ' ORDER BY tr.request_date DESC';
        const [mysqlRows] = await mysqlPool.query(sql, params);

        // Fetch Employee requests from MongoDB
        const mongoQuery = {};
        if (route_id) mongoQuery.route_id = route_id;
        if (status) mongoQuery.status = status;
        if (bus_id !== undefined) {
            if (bus_id === '' || bus_id === 'unassigned') {
                mongoQuery.bus_id = null;
            } else {
                mongoQuery.bus_id = bus_id;
            }
        }
        if (search) {
            mongoQuery.$or = [
                { employee_name: { $regex: search, $options: 'i' } },
                { emp_no: { $regex: search, $options: 'i' } }
            ];
        }
        if (hasCampusRestriction) {
            if (allowedRouteIds.length > 0) {
                if (mongoQuery.route_id) {
                    if (!allowedRouteIds.includes(mongoQuery.route_id)) {
                        mongoQuery.route_id = '__NONE__';
                    }
                } else {
                    mongoQuery.route_id = { $in: allowedRouteIds };
                }
            } else {
                mongoQuery.route_id = '__NONE__';
            }
        }

        let mongoRows = [];
        // Employee requests don't have a course, if course filter is set, employees are typically excluded 
        // unless course exactly matches "Employee"
        if (!course || course === 'Employee') {
            const rawMongoRows = await EmployeeTransportRequest.find(mongoQuery).lean();
            const filteredMongoRows = filterAcademicYear
                ? rawMongoRows.filter(
                    (r) => (r.academic_year || fallbackAcademicYear) === filterAcademicYear
                )
                : rawMongoRows;
            mongoRows = filteredMongoRows.map(r => ({
                id: r._id.toString(),
                admission_number: r.emp_no,
                student_name: r.employee_name,
                route_id: r.route_id ? r.route_id.toString() : null,
                route_name: r.route_name,
                stage_name: r.stage_name,
                fare: r.fare,
                status: r.status,
                bus_id: r.bus_id,
                request_date: r.request_date || r.created_at,
                raised_by: r.raised_by,
                raised_by_id: r.raised_by_id,
                academic_year: r.academic_year || null,
                application_number: r.application_number || null,
                application_serial: r.application_serial || null,
                user_type: 'employee',
                course: 'Employee'
            }));
        }

        const enrichedMysqlRows = await enrichTransportFareAdjustments(mysqlPool, mysqlRows.map(r => ({
            ...r,
            user_type: 'student',
            is_expired: Boolean(r.is_expired),
        })));

        const combined = [...enrichedMysqlRows, ...mongoRows];
        combined.sort((a, b) => {
            const appA = a.application_number;
            const appB = b.application_number;
            if (appA && appB) {
                return appB.localeCompare(appA, undefined, { numeric: true, sensitivity: 'base' });
            }
            if (appA) return -1;
            if (appB) return 1;
            return new Date(b.request_date) - new Date(a.request_date);
        });

        res.json(combined);
    } catch (error) {
        console.error('Error fetching transport requests:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update a transport request (e.g. assign bus_id)
// @route   PATCH /api/transport-requests/:id
// @access  Private/Admin
const updateTransportRequest = async (req, res) => {
    const requestId = req.params.id;
    const { bus_id } = req.body || {};
    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (!reqRow) return res.status(404).json({ message: 'Request not found' });
            reqRow.bus_id = bus_id || null;
            await reqRow.save();
            return res.json({
                id: reqRow._id.toString(),
                admission_number: reqRow.emp_no,
                student_name: reqRow.employee_name,
                route_id: reqRow.route_id ? reqRow.route_id.toString() : null,
                route_name: reqRow.route_name,
                stage_name: reqRow.stage_name,
                fare: reqRow.fare,
                status: reqRow.status,
                bus_id: reqRow.bus_id,
                user_type: 'employee'
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }
        const [rows] = await mysqlPool.query('SELECT id FROM transport_requests WHERE id = ?', [requestId]);
        if (!rows[0]) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        await mysqlPool.query('UPDATE transport_requests SET bus_id = ? WHERE id = ?', [bus_id || null, requestId]);
        const [updated] = await mysqlPool.query('SELECT * FROM transport_requests WHERE id = ?', [requestId]);
        res.json(updated[0]);
    } catch (error) {
        console.error('Error updating transport request:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get full details for a passenger (including photo) for bus pass generation
// @route   GET /api/transport-requests/:id/full-details
// @access  Private/Admin
const getPassengerFullDetails = async (req, res) => {
    const requestId = req.params.id;
    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId).lean();
            if (!reqRow) return res.status(404).json({ message: 'Request not found' });
            return res.json({
                ...reqRow,
                id: reqRow._id.toString(),
                admission_number: reqRow.emp_no,
                student_name: reqRow.employee_name,
                user_type: 'employee',
                course: 'Employee'
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const { resolveStudentPhoto } = require('../utils/studentPhoto');

        const [rows] = await mysqlPool.query(
            `SELECT tr.*, 
                    COALESCE(tr.year_of_study, s1.current_year, s2.current_year) as year_of_study,
                    COALESCE(s1.course, s2.course) as course,
                    COALESCE(s1.branch, s2.branch) as branch,
                    COALESCE(s1.student_photo, s2.student_photo) as student_photo,
                    COALESCE(s1.student_data, s2.student_data) as student_data,
                    COALESCE(s1.pin_no, s2.pin_no) as pin_no,
                    COALESCE(s1.student_mobile, s2.student_mobile) as student_mobile,
                    COALESCE(s1.parent_mobile1, s2.parent_mobile1) as parent_mobile1,
                    COALESCE(s1.student_address, s2.student_address) as student_address,
                    COALESCE(s1.father_name, s2.father_name) as father_name
             FROM transport_requests tr 
             LEFT JOIN students s1 ON tr.admission_number = s1.admission_number 
             LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
             WHERE tr.id = ?`,
            [requestId]
        );

        if (!rows[0]) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const row = rows[0];
        res.json({
            ...row,
            student_photo: resolveStudentPhoto(row),
            user_type: 'student',
        });
    } catch (error) {
        console.error('Error fetching passenger full details:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Approve transport request and create Transport Fee (TRN01) in Fee Management
// @route   PATCH /api/transport-requests/:id/approve
// @access  Private/Admin
const approveTransportRequest = async (req, res) => {
    const requestId = req.params.id;
    const { academicYear } = req.body || {};

    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (!reqRow) return res.status(404).json({ message: 'Transport request not found' });
            if (reqRow.status === 'approved') return res.status(400).json({ message: 'Request is already approved' });
            if (reqRow.status === 'rejected') return res.status(400).json({ message: 'Request was rejected and cannot be approved' });

            const resolvedAcademicYear = academicYear || reqRow.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
            if (!mysqlPool) {
                return res.status(500).json({ message: 'MySQL connection not established' });
            }

            const context = await resolveApplicationNumberContext(mysqlPool, {
                admissionNumber: reqRow.emp_no,
                userType: 'employee',
            });
            const application = await assignTransportApplicationNumber(mysqlPool, {
                academicYear: resolvedAcademicYear,
                collegeCode: context.collegeCode,
                courseCode: context.courseCode,
                existingApplicationNumber: reqRow.application_number,
                existingApplicationSerial: reqRow.application_serial,
            });

            reqRow.status = 'approved';
            reqRow.academic_year = resolvedAcademicYear;
            reqRow.application_number = application.application_number;
            reqRow.application_serial = application.application_serial;
            reqRow.application_college_code = application.college_code;
            reqRow.application_course_code = application.course_code;
            if (req.body.bus_id) {
                reqRow.bus_id = req.body.bus_id;
            }
            await reqRow.save();
            return res.json({
                message: `Employee transport request approved. Application No: ${application.application_number}.`,
                requestId: String(reqRow._id),
                application_number: application.application_number,
                application_serial: application.application_serial,
                amount: 0,
                expiry_date: null,
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query(
            'SELECT * FROM transport_requests WHERE id = ?',
            [requestId]
        );
        const request = rows[0];
        if (!request) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        if (request.status === 'approved') {
            return res.status(400).json({ message: 'Request is already approved' });
        }
        if (request.status === 'rejected') {
            return res.status(400).json({ message: 'Request was rejected and cannot be approved' });
        }

        if (req.body.fare != null) {
            const overrideFare = Number(req.body.fare);
            if (Number.isFinite(overrideFare)) {
                await mysqlPool.query('UPDATE transport_requests SET fare = ? WHERE id = ?', [overrideFare, requestId]);
                request.fare = overrideFare;
            }
        }

        // Expiry = last semester of student's year (same regardless of which sem they applied in)
        const lastSem = await getLastSemesterForRequest(mysqlPool, request);

        const admissionNumber = request.admission_number || request.admission_no;
        if (!admissionNumber) {
            return res.status(400).json({
                message: 'Transport request has no admission number; cannot create fee in Fee Management.',
            });
        }

        const resolvedAcademicYear = academicYear || request.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        if (!resolvedAcademicYear) {
            return res.status(400).json({
                message: 'Academic year is required. Set CURRENT_ACADEMIC_YEAR in env or send academicYear in request body (e.g. "2024-2025").',
            });
        }

        // Fetch student from MySQL for course, branch, batch, year, semester, category
        let student = null;
        if (admissionNumber) {
            const [studentRows] = await mysqlPool.query(
                'SELECT course, branch, batch, current_year, current_semester, stud_type FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
                [admissionNumber, admissionNumber]
            );
            student = studentRows[0] || null;
        }

        const college = process.env.FEE_DEFAULT_COLLEGE || 'Default';
        const course = student?.course || 'N/A';
        const branch = student?.branch || 'N/A';
        const batch = student?.batch || 'N/A';
        const studentYear = student?.current_year != null ? Number(student.current_year) : 1;
        const semester = student?.current_semester != null ? Number(student.current_semester) : null;
        const category = student?.stud_type || 'Regular';
        const amount = Number(request.fare);
        const studentName = request.student_name || '';
        const remarks = 'Transport';

        const feeModels = getFeePortalModels();
        if (!feeModels) {
            return res.status(503).json({
                message: 'Fee Management database is not configured or not connected. Set FEE_MONGO_URI and ensure Fee DB is connected.',
            });
        }

        const { FeeHead, StudentFee, TransportConcession } = feeModels;
        const transportFeeHead = await FeeHead.findOne({
            $or: [
                { code: TRANSPORT_FEE_HEAD_CODE },
                { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
                { name: { $regex: /transport/i } }
            ]
        });
        if (!transportFeeHead) {
            return res.status(500).json({
                message: `Transport Fee Head (code: ${TRANSPORT_FEE_HEAD_CODE}) not found in Fee Management. Please seed Fee Heads.`,
            });
        }

        // Check for persistent concession
        let finalAmount = amount;
        if (TransportConcession) {
            const persistentConcession = await TransportConcession.findOne({
                studentId: String(admissionNumber),
                feeHead: transportFeeHead._id
            });
            if (persistentConcession && persistentConcession.yearConcessions) {
                const yearKey = String(studentYear);
                const concessionForYear = persistentConcession.yearConcessions.get(yearKey);
                if (concessionForYear !== undefined && concessionForYear !== null) {
                    finalAmount = concessionForYear;
                }
            }
        }

        // Overwrite with revised fee from overall_concessions if found
        try {
            const [overallConcessionRows] = await mysqlPool.query(
                'SELECT revised_fees FROM overall_concessions WHERE admission_number = ? LIMIT 1',
                [String(admissionNumber)]
            );
            if (overallConcessionRows && overallConcessionRows.length > 0) {
                const revisedFees = Array.isArray(overallConcessionRows[0].revised_fees)
                    ? overallConcessionRows[0].revised_fees
                    : (typeof overallConcessionRows[0].revised_fees === 'string'
                        ? JSON.parse(overallConcessionRows[0].revised_fees)
                        : []);
                const match = revisedFees.find(f => {
                    const isTransport = 
                        (f.feeHeadCode && String(f.feeHeadCode).toUpperCase() === 'TRN01') ||
                        (f.feeHeadId && (
                            String(f.feeHeadId) === String(transportFeeHead._id) || 
                            String(f.feeHeadId) === '6996aa36e247525e006623ca' ||
                            String(f.feeHeadId) === '6996aa36e247525e006623b8'
                        ));
                    return isTransport && Number(f.studentYear) === Number(studentYear);
                });
                if (match && match.revisedAmount !== undefined && match.revisedAmount !== null) {
                    if (match.concessionType && String(match.concessionType).toUpperCase() === 'CONCESSION') {
                        finalAmount = Math.max(0, amount - Number(match.revisedAmount));
                    } else {
                        finalAmount = Number(match.revisedAmount);
                    }
                }
            }
        } catch (err) {
            console.error('Error fetching overall concessions in approveTransportRequest:', err);
        }

        const existingFee = await StudentFee.findOne({
            studentId: String(admissionNumber),
            feeHead: transportFeeHead._id,
            academicYear: resolvedAcademicYear,
            studentYear,
            semester: semester || null,
            remarks,
        });
        if (existingFee) {
            if (lastSem) {
                await updateTransportRequestSemester(mysqlPool, requestId, {
                    semester_id: lastSem.id,
                    semester_start_date: lastSem.start_date,
                    semester_end_date: lastSem.end_date,
                    academic_year_id: lastSem.academic_year_id,
                    year_of_study: lastSem.year_of_study,
                    semester_number: lastSem.semester_number,
                });
            }
            const application = await markTransportRequestApproved(mysqlPool, requestId, {
                bus_id: req.body.bus_id,
                academicYear: resolvedAcademicYear,
                existingApplicationNumber: request.application_number,
                existingApplicationSerial: request.application_serial,
                admissionNumber,
                userType: 'student',
            });

            return res.json({
                message: `Request approved. Application No: ${application.application_number}. Transport fee for this student/year already exists in Fee Management.`,
                requestId: Number(requestId),
                application_number: application.application_number,
                application_serial: application.application_serial,
                expiry_date: lastSem?.end_date || null,
            });
        }

        await StudentFee.create({
            studentId: String(admissionNumber),
            studentName: studentName,
            feeHead: transportFeeHead._id,
            college,
            course,
            branch,
            academicYear: resolvedAcademicYear,
            studentYear,
            semester: semester || undefined,
            amount: finalAmount,
            remarks,
        });

        if (lastSem) {
            await updateTransportRequestSemester(mysqlPool, requestId, {
                semester_id: lastSem.id,
                semester_start_date: lastSem.start_date,
                semester_end_date: lastSem.end_date,
                academic_year_id: lastSem.academic_year_id,
                year_of_study: lastSem.year_of_study,
                semester_number: lastSem.semester_number,
            });
        }
        const application = await markTransportRequestApproved(mysqlPool, requestId, {
            bus_id: req.body.bus_id,
            academicYear: resolvedAcademicYear,
            existingApplicationNumber: request.application_number,
            existingApplicationSerial: request.application_serial,
            admissionNumber,
            userType: 'student',
        });

        res.json({
            message: `Transport request approved. Application No: ${application.application_number}. Transport Fee (TRN01) created in Fee Management.`,
            requestId: Number(requestId),
            academicYear: resolvedAcademicYear,
            application_number: application.application_number,
            application_serial: application.application_serial,
            amount,
            expiry_date: lastSem?.end_date || null,
        });
    } catch (error) {
        if (error.code === 'ER_NO_SUCH_TABLE' && (
            String(error.message).includes('transport_application_counters_v2')
            || String(error.message).includes('transport_application_counters')
        )) {
            return res.status(503).json({
                message: 'Transport application counter table not found. Run backend/mysql-schema/alter-transport-application-counter-course-wise.sql.',
            });
        }
        if (error.code === 'ER_BAD_FIELD_ERROR' && String(error.message).includes('application_number')) {
            return res.status(503).json({
                message: 'Column application_number not found on transport_requests. Run backend/mysql-schema/add-transport-application-number.sql.',
            });
        }
        console.error('Error approving transport request:', error);
        res.status(500).json({ message: error.message || 'Failed to approve request' });
    }
};

// @desc    Reject transport request
// @route   PATCH /api/transport-requests/:id/reject
// @access  Private/Admin
const rejectTransportRequest = async (req, res) => {
    const requestId = req.params.id;

    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (!reqRow) return res.status(404).json({ message: 'Transport request not found' });
            if (reqRow.status === 'rejected') {
                return res.json({ message: 'Request was already rejected.', requestId: String(requestId) });
            }
            if (reqRow.status === 'approved') {
                return res.status(400).json({ message: 'Cannot reject an approved request.' });
            }

            reqRow.status = 'rejected';
            await reqRow.save();
            return res.json({ message: 'Transport request rejected.', requestId: String(requestId) });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query('SELECT id, status FROM transport_requests WHERE id = ?', [requestId]);
        const request = rows[0];
        if (!request) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        if (request.status === 'rejected') {
            return res.json({ message: 'Request was already rejected.', requestId: Number(requestId) });
        }
        if (request.status === 'approved') {
            return res.status(400).json({ message: 'Cannot reject an approved request.' });
        }

        await mysqlPool.query('UPDATE transport_requests SET status = ? WHERE id = ?', ['rejected', requestId]);
        res.json({ message: 'Transport request rejected.', requestId: Number(requestId) });
    } catch (error) {
        console.error('Error rejecting transport request:', error);
        res.status(500).json({ message: error.message || 'Failed to reject request' });
    }
};

async function markTransportRequestApproved(mysqlPool, requestId, {
    bus_id,
    academicYear,
    existingApplicationNumber = null,
    existingApplicationSerial = null,
    admissionNumber,
    userType = 'student',
}) {
    const context = await resolveApplicationNumberContext(mysqlPool, {
        admissionNumber,
        userType,
    });
    const application = await assignTransportApplicationNumber(mysqlPool, {
        academicYear,
        collegeCode: context.collegeCode,
        courseCode: context.courseCode,
        existingApplicationNumber,
        existingApplicationSerial,
    });

    try {
        await mysqlPool.query(
            `UPDATE transport_requests
             SET status = 'approved',
                 bus_id = ?,
                 application_number = ?,
                 application_serial = ?,
                 application_college_code = ?,
                 application_course_code = ?
             WHERE id = ?`,
            [
                bus_id || null,
                application.application_number,
                application.application_serial,
                application.college_code,
                application.course_code,
                requestId,
            ]
        );
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR') {
            await mysqlPool.query(
                `UPDATE transport_requests
                 SET status = 'approved',
                     bus_id = ?,
                     application_number = ?,
                     application_serial = ?
                 WHERE id = ?`,
                [bus_id || null, application.application_number, application.application_serial, requestId]
            );
        } else {
            throw error;
        }
    }

    return {
        ...application,
        college_name: context.collegeName,
        course_name: context.courseName,
    };
}

async function updateTransportRequestSemester(mysqlPool, requestId, fields) {
    const {
        semester_id,
        semester_start_date,
        semester_end_date,
        academic_year_id,
        year_of_study,
        semester_number,
    } = fields || {};
    const hasAny =
        semester_id != null ||
        semester_start_date != null ||
        semester_end_date != null ||
        academic_year_id != null ||
        year_of_study != null ||
        semester_number != null;
    if (!hasAny) return;
    // expiry_date = semester end date (transport valid until end of that semester)
    const expiry_date = semester_end_date ?? null;
    await mysqlPool.query(
        `UPDATE transport_requests SET
      semester_id = ?, semester_start_date = ?, semester_end_date = ?,
      expiry_date = ?, academic_year_id = ?, year_of_study = ?, semester_number = ?
    WHERE id = ?`,
        [
            semester_id ?? null,
            semester_start_date ?? null,
            semester_end_date ?? null,
            expiry_date,
            academic_year_id ?? null,
            year_of_study ?? null,
            semester_number ?? null,
            requestId,
        ]
    );
}

// @desc    Create a transport request (Admin or Student)
// @route   POST /api/transport-requests
// @access  Private/Admin
const createTransportRequest = async (req, res) => {
    const {
        admission_number,
        student_name,
        route_id,
        route_name,
        stage_name,
        fare,
        raised_by = 'student',
        raised_by_id = null,
        user_type = 'student',
        academic_year,
        academicYear,
    } = req.body;

    const resolvedAcademicYear = resolveAcademicYear({ academic_year, academicYear });

    if (!admission_number) {
        return res.status(400).json({ message: 'Admission / employee number is required.' });
    }

    try {
        const existingRequest = await findExistingTransportRequestForYear({
            admissionNumber: admission_number,
            academicYear: resolvedAcademicYear,
            userType: user_type,
        });

        if (existingRequest) {
            return res.status(409).json({
                message: buildDuplicateRequestMessage(existingRequest, resolvedAcademicYear, user_type),
                existingRequest: {
                    id: existingRequest.id || String(existingRequest._id),
                    status: existingRequest.status,
                    route_name: existingRequest.route_name,
                    stage_name: existingRequest.stage_name,
                    academic_year: existingRequest.academic_year || resolvedAcademicYear,
                },
            });
        }

        if (user_type === 'employee') {
            const newReq = new EmployeeTransportRequest({
                emp_no: admission_number,
                employee_name: student_name,
                route_id,
                route_name,
                stage_name,
                fare: 0,
                status: 'pending',
                raised_by,
                raised_by_id,
                academic_year: resolvedAcademicYear,
            });
            await newReq.save();
            return res.status(201).json({
                id: newReq._id.toString(),
                admission_number: newReq.emp_no,
                student_name: newReq.employee_name,
                route_id: newReq.route_id ? newReq.route_id.toString() : null,
                route_name: newReq.route_name,
                stage_name: newReq.stage_name,
                fare: newReq.fare,
                status: newReq.status,
                academic_year: newReq.academic_year,
                user_type: 'employee',
                request_date: newReq.created_at
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [studentRows] = await mysqlPool.query(
            'SELECT batch, course, branch, current_year, current_semester FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
            [admission_number, admission_number]
        );
        const studentRecord = studentRows[0];
        if (!studentRecord) {
            return res.status(404).json({ message: 'Student not found in the student database.' });
        }

        const validation = await validateStudentAcademicContext(
            mysqlPool,
            studentRecord,
            resolvedAcademicYear
        );
        if (!validation.valid) {
            return res.status(400).json({
                message: validation.message,
                validation,
            });
        }

        const yearOfStudy = studentRecord.current_year != null
            ? Number(studentRecord.current_year)
            : 1;

        const sql = `
            INSERT INTO transport_requests 
            (admission_number, student_name, route_id, route_name, stage_name, fare, raised_by, raised_by_id, status, year_of_study, academic_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
        `;
        const [result] = await mysqlPool.query(sql, [
            admission_number,
            student_name,
            route_id,
            route_name,
            stage_name,
            fare,
            raised_by,
            raised_by_id,
            yearOfStudy,
            resolvedAcademicYear,
        ]);

        const [newRequest] = await mysqlPool.query('SELECT * FROM transport_requests WHERE id = ?', [result.insertId]);
        res.status(201).json(newRequest[0]);
    } catch (error) {
        if (error.code === 'ER_BAD_FIELD_ERROR' && String(error.message).includes('academic_year')) {
            return res.status(503).json({
                message: 'Column academic_year not found on transport_requests. Run: ALTER TABLE transport_requests ADD COLUMN academic_year VARCHAR(20) NULL AFTER year_of_study;',
            });
        }
        console.error('Error creating transport request:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get dashboard statistics
// @route   GET /api/transport-requests/stats
// @access  Private/Admin
const getDashboardStats = async (req, res) => {
    try {
        let totalPassengers = 0;
        let routeBreakdown = [];
        let stageBreakdown = [];
        let courseBreakdown = [];

        const resolvedAcademicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        let restrictedWhere = '';
        const restrictedParams = [];
        
        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        if (restrictedColleges !== null) {
            restrictedWhere += ' AND COALESCE(s1.college, s2.college) IN (?)';
            restrictedParams.push(restrictedColleges.length > 0 ? restrictedColleges : ['']);
        }
        if (hasCourseRestriction) {
            restrictedWhere += ' AND COALESCE(s1.course, s2.course) IN (?)';
            restrictedParams.push(req.user.courses);
        }

        let campusRouteIds = [];
        let filterByCampusRoutes = false;
        const queryCampusId = campusService.normalizeCampusId(req.query.campus);
        
        if (!queryCampusId && req.user && !isSuperAdmin && req.user.campuses && req.user.campuses.length > 0) {
            const allowedCampusIds = campusService.normalizeCampusIds(req.user.campuses);
            if (allowedCampusIds.length > 0) {
                const campusRoutes = await Route.find({ campus: { $in: allowedCampusIds } }).select('routeId').lean();
                campusRouteIds = campusRoutes.map(r => r.routeId);
                filterByCampusRoutes = true;
            }
        } else if (queryCampusId !== null) {
            const campusRoutes = await Route.find({ campus: queryCampusId }).select('routeId').lean();
            campusRouteIds = campusRoutes.map(r => r.routeId);
            filterByCampusRoutes = true;
        }

        if (filterByCampusRoutes) {
            if (campusRouteIds.length > 0) {
                restrictedWhere += ` AND tr.route_id IN (${campusRouteIds.map(() => '?').join(',')})`;
                restrictedParams.push(...campusRouteIds);
            } else {
                restrictedWhere += ' AND 1=0';
            }
        }

        if (mysqlPool) {
            const parts = getActivePassengerSqlParts(resolvedAcademicYear);
            const activeFrom = `FROM transport_requests tr ${parts.studentJoins}`;
            const activeWhere = `tr.status = 'approved' AND COALESCE(tr.academic_year, ?) = ?${restrictedWhere}`;
            const activeParams = [fallbackAcademicYear, resolvedAcademicYear, ...restrictedParams];

            const [totalRows] = await mysqlPool.query(
                `SELECT COUNT(*) as total ${activeFrom} WHERE ${activeWhere}`,
                activeParams
            );
            totalPassengers += totalRows[0].total;

            const [routeRows] = await mysqlPool.query(
                `SELECT tr.route_id, tr.route_name, COUNT(*) as count ${activeFrom} WHERE ${activeWhere} GROUP BY tr.route_id, tr.route_name`,
                activeParams
            );
            routeBreakdown = routeRows;

            const [stageRows] = await mysqlPool.query(
                `SELECT tr.route_id, tr.route_name, tr.stage_name, COUNT(*) as count ${activeFrom} WHERE ${activeWhere} GROUP BY tr.route_id, tr.route_name, tr.stage_name`,
                activeParams
            );
            stageBreakdown = stageRows;

            const [courseRows] = await mysqlPool.query(
                `SELECT COALESCE(s1.course, s2.course) as course, COUNT(tr.id) as count
                 ${activeFrom}
                 WHERE ${activeWhere}
                 GROUP BY COALESCE(s1.course, s2.course)`,
                activeParams
            );
            courseBreakdown = courseRows;
        }

        // Add MongoDB (Employee) Stats
        const mongoMatch = { status: 'approved' };
        if (resolvedAcademicYear === fallbackAcademicYear) {
            mongoMatch.$or = [
                { academic_year: resolvedAcademicYear },
                { academic_year: { $exists: false } },
                { academic_year: null },
                { academic_year: '' }
            ];
        } else {
            mongoMatch.academic_year = resolvedAcademicYear;
        }

        const mongoTotal = await EmployeeTransportRequest.countDocuments(mongoMatch);
        totalPassengers += mongoTotal;

        const mongoRouteRows = await EmployeeTransportRequest.aggregate([
            { $match: mongoMatch },
            { $group: { _id: { route_id: '$route_id', route_name: '$route_name' }, count: { $sum: 1 } } }
        ]);
        
        mongoRouteRows.forEach(mr => {
            const existing = routeBreakdown.find(r => String(r.route_id) === String(mr._id.route_id));
            if (existing) {
                existing.count += mr.count;
            } else {
                routeBreakdown.push({
                    route_id: mr._id.route_id,
                    route_name: mr._id.route_name,
                    count: mr.count
                });
            }
        });

        const mongoStageRows = await EmployeeTransportRequest.aggregate([
            { $match: mongoMatch },
            { $group: { _id: { route_id: '$route_id', route_name: '$route_name', stage_name: '$stage_name' }, count: { $sum: 1 } } }
        ]);

        mongoStageRows.forEach(ms => {
            const existing = stageBreakdown.find(s => String(s.route_id) === String(ms._id.route_id) && s.stage_name === ms._id.stage_name);
            if (existing) {
                existing.count += ms.count;
            } else {
                stageBreakdown.push({
                    route_id: ms._id.route_id,
                    route_name: ms._id.route_name,
                    stage_name: ms._id.stage_name,
                    count: ms.count
                });
            }
        });

        if (mongoTotal > 0) {
            courseBreakdown.push({
                course: 'Employee',
                count: mongoTotal
            });
        }

        // Sort descending
        routeBreakdown.sort((a, b) => b.count - a.count);
        stageBreakdown.sort((a, b) => b.count - a.count);
        courseBreakdown.sort((a, b) => b.count - a.count);

        res.json({
            totalPassengers,
            routeBreakdown,
            stageBreakdown,
            courseBreakdown
        });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get data for Concessions Management
// @route   GET /api/transport-requests/concessions
// @access  Private/Admin
const getConcessions = async (req, res) => {
    const { course, route_id, search } = req.query;
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const feeModels = getFeePortalModels();
        if (!feeModels) {
            return res.status(503).json({ message: 'Fee Management database connection not available' });
        }

        const { FeeHead } = feeModels;
        const transportFeeHead = await FeeHead.findOne({
            $or: [
                { code: TRANSPORT_FEE_HEAD_CODE },
                { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
                { name: { $regex: /transport/i } }
            ]
        });

        if (!transportFeeHead) {
            return res.status(500).json({ message: 'Transport Fee Head not found' });
        }

        const transportFeeHeadId = transportFeeHead._id.toString();

        const { page = 1, limit = 10 } = req.query;
        const offset = (Number(page) - 1) * Number(limit);
        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCollegeRestriction = req.user && !isSuperAdmin && req.user.colleges && req.user.colleges.length > 0;
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        // 1. Fetch total count for pagination
        let countSql = `
            SELECT COUNT(*) as total
            FROM overall_concessions oc
            LEFT JOIN transport_requests tr ON tr.id = (
                SELECT t.id FROM transport_requests t 
                WHERE t.admission_number = oc.admission_number AND t.status = 'approved'
                ORDER BY t.request_date DESC LIMIT 1
            )
            LEFT JOIN students s ON (oc.admission_number = s.admission_number OR oc.admission_number = s.admission_no)
            WHERE (JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', ?))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', '6996aa36e247525e006623ca'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', '6996aa36e247525e006623b8'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadCode', 'TRN01'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadCode', 'trn01'))
            )
        `;
        const countParams = [transportFeeHeadId];

        if (course) {
            countSql += ` AND oc.course = ?`;
            countParams.push(course);
        }

        if (route_id) {
            countSql += ` AND tr.route_id = ?`;
            countParams.push(route_id);
        }

        if (search) {
            countSql += ` AND (oc.student_name LIKE ? OR oc.admission_number LIKE ? OR oc.pin_no LIKE ?)`;
            countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (hasCollegeRestriction) {
            countSql += ` AND s.college IN (?)`;
            countParams.push(req.user.colleges);
        }

        if (hasCourseRestriction) {
            countSql += ` AND oc.course IN (?)`;
            countParams.push(req.user.courses);
        }

        const [[{ total }]] = await mysqlPool.query(countSql, countParams);

        // 2. Fetch concessions from MySQL overall_concessions, including course duration and filters
        let sql = `
            SELECT oc.*, 
                   tr.route_id, tr.route_name, tr.stage_name, tr.fare as original_fare, tr.year_of_study as student_year,
                   c.total_years as total_course_years
            FROM overall_concessions oc
            LEFT JOIN transport_requests tr ON tr.id = (
                SELECT t.id FROM transport_requests t 
                WHERE t.admission_number = oc.admission_number AND t.status = 'approved'
                ORDER BY t.request_date DESC LIMIT 1
            )
            LEFT JOIN students s ON (oc.admission_number = s.admission_number OR oc.admission_number = s.admission_no)
            LEFT JOIN colleges coll ON coll.name = s.college COLLATE utf8mb4_unicode_ci
            LEFT JOIN courses c ON s.course = c.name AND c.college_id = coll.id
            WHERE JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', ?))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', '6996aa36e247525e006623ca'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadId', '6996aa36e247525e006623b8'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadCode', 'TRN01'))
               OR JSON_CONTAINS(oc.revised_fees, JSON_OBJECT('feeHeadCode', 'trn01'))
        `;
        const params = [transportFeeHeadId];

        if (course) {
            sql += ` AND oc.course = ?`;
            params.push(course);
        }

        if (route_id) {
            sql += ` AND tr.route_id = ?`;
            params.push(route_id);
        }

        if (search) {
            sql += ` AND (oc.student_name LIKE ? OR oc.admission_number LIKE ? OR oc.pin_no LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }

        if (hasCollegeRestriction) {
            sql += ` AND s.college IN (?)`;
            params.push(req.user.colleges);
        }

        if (hasCourseRestriction) {
            sql += ` AND oc.course IN (?)`;
            params.push(req.user.courses);
        }

        sql += ` ORDER BY oc.created_at DESC LIMIT ? OFFSET ?`;
        params.push(Number(limit), offset);

        const [rows] = await mysqlPool.query(sql, params);

        if (rows.length === 0) {
            return res.json({ 
                data: [], 
                pagination: { 
                    total, 
                    pages: Math.ceil(total / limit), 
                    currentPage: Number(page),
                    limit: Number(limit)
                } 
            });
        }

        const data = rows.map(req => {
            const revisedFees = Array.isArray(req.revised_fees) 
                ? req.revised_fees 
                : (typeof req.revised_fees === 'string' ? JSON.parse(req.revised_fees) : []);

            const yearConcessions = {};
            revisedFees.forEach(fee => {
                const isTransport = 
                    (fee.feeHeadCode && String(fee.feeHeadCode).toUpperCase() === 'TRN01') ||
                    (fee.feeHeadId && (
                        String(fee.feeHeadId) === transportFeeHeadId || 
                        String(fee.feeHeadId) === '6996aa36e247525e006623ca' ||
                        String(fee.feeHeadId) === '6996aa36e247525e006623b8'
                    ));
                if (isTransport) {
                    yearConcessions[fee.studentYear] = {
                        amount: fee.revisedAmount,
                        concessionType: fee.concessionType || 'REVISED'
                    };
                }
            });

            return {
                id: req.id,
                admission_number: req.admission_number,
                student_name: req.student_name,
                route_id: req.route_id || null,
                route_name: req.route_name || 'N/A',
                stage_name: req.stage_name || 'N/A',
                original_fare: req.original_fare || 0,
                student_year: req.student_year || null,
                yearConcessions,
                total_course_years: req.total_course_years || 4,
                updated_at: req.updated_at
            };
        });

        res.json({
            data,
            pagination: {
                total,
                pages: Math.ceil(total / limit),
                currentPage: Number(page),
                limit: Number(limit)
            }
        });
    } catch (error) {
        console.error('Error fetching concessions:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Update fee concession (Read-only block)
// @route   PATCH /api/transport-requests/:id/concession
// @access  Private/Admin
const updateConcession = async (req, res) => {
    return res.status(403).json({
        message: 'Concessions are centrally managed and cannot be updated directly from the Transport application.'
    });
};

// @desc    Delete concession and associated student fee
// @route   DELETE /api/transport-requests/:id/concession
// @access  Private/Admin
const deleteConcession = async (req, res) => {
    const { id } = req.params; // transport_request id
    const { admin_name, admin_id } = req.body;

    try {
        if (isMongoId(id)) {
            const reqRow = await EmployeeTransportRequest.findById(id);
            if (!reqRow) {
                return res.status(404).json({ message: 'Transport request not found' });
            }
            await EmployeeTransportRequest.findByIdAndDelete(id);
            return res.json({ message: 'Transport request deleted successfully' });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query('SELECT * FROM transport_requests WHERE id = ?', [id]);
        const request = rows[0];

        if (!request) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const feeModels = getFeePortalModels();
        const { StudentFee, FeeHead, TransportConcession } = feeModels;
        const transportFeeHead = await FeeHead.findOne({
            $or: [
                { code: TRANSPORT_FEE_HEAD_CODE },
                { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
                { name: { $regex: /transport/i } }
            ]
        });

        const studentId = String(request.admission_number || request.admission_no);

        // 1. Delete persistent concession
        if (TransportConcession) {
            await TransportConcession.deleteOne({ studentId, feeHead: transportFeeHead._id });
        }

        // 2. Delete active StudentFee
        const fee = await StudentFee.findOne({
            studentId,
            feeHead: transportFeeHead._id
        });

        if (fee) {
            await fee.deleteOne();
        }

        // 3. Delete MySQL Transport Request
        await mysqlPool.query('DELETE FROM transport_requests WHERE id = ?', [id]);

        // Log to audit logs in MySQL
        const auditDetails = JSON.stringify({
            action: 'delete_concession',
            student_id: studentId,
            admin_name
        });

        await mysqlPool.query(
            'INSERT INTO audit_logs (action_type, entity_type, entity_id, admin_id, details) VALUES (?, ?, ?, ?, ?)',
            ['FEE_DELETION', 'TRANSPORT_REQUEST', String(id), admin_id || null, auditDetails]
        );

        res.json({ message: 'Concession, fee, and transport request deleted successfully' });

    } catch (error) {
        console.error('Error deleting concession:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get approved transport passengers for search
// @route   GET /api/transport-requests/approved-passengers
// @access  Private/Admin
const getApprovedPassengers = async (req, res) => {
    const { q, user_type } = req.query;
    
    try {
        if (user_type === 'employee') {
            const query = { status: 'approved' };
            if (q) {
                query.$or = [
                    { employee_name: { $regex: q, $options: 'i' } },
                    { emp_no: { $regex: q, $options: 'i' } }
                ];
            }
            const employees = await EmployeeTransportRequest.find(query).limit(50).lean();
            return res.json(employees.map(r => ({
                id: r._id.toString(),
                admission_number: r.emp_no,
                student_name: r.employee_name,
                route_id: r.route_id,
                route_name: r.route_name,
                stage_name: r.stage_name,
                fare: r.fare,
                user_type: 'employee'
            })));
        }

        // Default to Students (MySQL)
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const parts = getActivePassengerSqlParts(resolveAcademicYear(req.query));
        let sql = `
            SELECT tr.id, tr.admission_number, tr.student_name, tr.route_id, tr.route_name, tr.stage_name, tr.fare, tr.year_of_study, tr.academic_year,
                   COALESCE(s1.course, s2.course) as course,
                   COALESCE(s1.branch, s2.branch) as branch,
                   COALESCE(s1.pin_no, s2.pin_no) as pin_no
            FROM transport_requests tr
            ${parts.studentJoins}
            ${parts.expiryJoins}
            WHERE tr.status = 'approved' AND ${parts.activeWhere}
        `;
        const params = [...parts.expiryParams];

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        if (restrictedColleges !== null) {
            sql += ' AND COALESCE(s1.college, s2.college) IN (?)';
            params.push(restrictedColleges.length > 0 ? restrictedColleges : ['']);
        }
        if (hasCourseRestriction) {
            sql += ' AND COALESCE(s1.course, s2.course) IN (?)';
            params.push(req.user.courses);
        }

        if (q) {
            sql += ' AND (tr.student_name LIKE ? OR tr.admission_number LIKE ?)';
            const searchPattern = `%${q}%`;
            params.push(searchPattern, searchPattern);
        }

        sql += ' LIMIT 50';
        const [rows] = await mysqlPool.query(sql, params);
        res.json(rows.map(r => ({ ...r, user_type: 'student' })));
    } catch (error) {
        console.error('Error fetching approved passengers:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Submit a route/stage change request (Admin action)
// @route   POST /api/transport-requests/change-request
// @access  Private/Admin
const submitRouteChangeRequest = async (req, res) => {
    const {
        admission_number,
        new_route_id,
        new_route_name,
        new_stage_name,
        new_fare,
        admin_id,
        admin_name,
        user_type, // Optional, helps distinguish
        academic_year: requestAcademicYear,
    } = req.body;

    const resolvedAcademicYear = resolveAcademicYear({ academic_year: requestAcademicYear })
        || process.env.CURRENT_ACADEMIC_YEAR
        || getDefaultAcademicYear();

    try {
        let currentRequest;
        let oldFare = 0;
        let fareDiff = 0;

        if (user_type === 'employee') {
            // Find approved employee request, prefer matching academic year
            const empQuery = { emp_no: admission_number, status: 'approved' };
            if (resolvedAcademicYear) empQuery.academic_year = resolvedAcademicYear;
            currentRequest = await EmployeeTransportRequest.findOne(empQuery).lean();
            // Fallback: any approved request for this employee if year-filtered one not found
            if (!currentRequest) {
                currentRequest = await EmployeeTransportRequest.findOne({ emp_no: admission_number, status: 'approved' }).lean();
            }
            if (!currentRequest) {
                return res.status(404).json({ message: 'No approved transport request found for this employee.' });
            }
            oldFare = currentRequest.fare || 0;
            fareDiff = new_fare - oldFare;

            // Update MongoDB Record
            await EmployeeTransportRequest.findByIdAndUpdate(currentRequest._id, {
                route_id: new_route_id,
                route_name: new_route_name,
                stage_name: new_stage_name,
                fare: new_fare
            });
        } else {
            // Default to Students (MySQL)
            if (!mysqlPool) {
                return res.status(500).json({ message: 'MySQL connection not established' });
            }

            // Filter by academic_year when possible so we update the correct year's request
            let currentRows;
            if (resolvedAcademicYear) {
                [currentRows] = await mysqlPool.query(
                    'SELECT * FROM transport_requests WHERE admission_number = ? AND status = "approved" AND COALESCE(academic_year, ?) = ? ORDER BY id DESC LIMIT 1',
                    [admission_number, resolvedAcademicYear, resolvedAcademicYear]
                );
            }
            // Fallback: any approved request for this student if year-filtered one not found
            if (!currentRows || !currentRows[0]) {
                [currentRows] = await mysqlPool.query(
                    'SELECT * FROM transport_requests WHERE admission_number = ? AND status = "approved" ORDER BY id DESC LIMIT 1',
                    [admission_number]
                );
            }
            currentRequest = currentRows[0];
            if (!currentRequest) {
                return res.status(404).json({ message: 'No approved transport request found for this student.' });
            }

            oldFare = currentRequest.fare || 0;
            fareDiff = new_fare - oldFare;

            // Compute concession-aware fare difference if overall concessions are configured
            try {
                const { getFeePortalModels } = require('../models/fee-portal-models');
                const feeModels = getFeePortalModels();
                if (feeModels) {
                    const { FeeHead } = feeModels;
                    const transportFeeHead = await FeeHead.findOne({
                        $or: [
                            { code: TRANSPORT_FEE_HEAD_CODE },
                            { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
                            { name: { $regex: /transport/i } }
                        ]
                    });
                    if (transportFeeHead) {
                        const [overallConcessionRows] = await mysqlPool.query(
                            'SELECT revised_fees FROM overall_concessions WHERE admission_number = ? LIMIT 1',
                            [String(admission_number)]
                        );
                        if (overallConcessionRows && overallConcessionRows.length > 0) {
                            const revisedFees = Array.isArray(overallConcessionRows[0].revised_fees)
                                ? overallConcessionRows[0].revised_fees
                                : (typeof overallConcessionRows[0].revised_fees === 'string'
                                    ? JSON.parse(overallConcessionRows[0].revised_fees)
                                    : []);
                            const studentYear = currentRequest.year_of_study || 1;
                            const match = revisedFees.find(f => {
                                const isTransport = 
                                    (f.feeHeadCode && String(f.feeHeadCode).toUpperCase() === 'TRN01') ||
                                    (f.feeHeadId && (
                                        String(f.feeHeadId) === String(transportFeeHead._id) || 
                                        String(f.feeHeadId) === '6996aa36e247525e006623ca' ||
                                        String(f.feeHeadId) === '6996aa36e247525e006623b8'
                                    ));
                                return isTransport && Number(f.studentYear) === Number(studentYear);
                            });
                            if (match && match.revisedAmount !== undefined && match.revisedAmount !== null) {
                                let oldConcessionFare = oldFare;
                                let newConcessionFare = new_fare;
                                if (match.concessionType && String(match.concessionType).toUpperCase() === 'CONCESSION') {
                                    oldConcessionFare = Math.max(0, oldFare - Number(match.revisedAmount));
                                    newConcessionFare = Math.max(0, new_fare - Number(match.revisedAmount));
                                } else {
                                    oldConcessionFare = Number(match.revisedAmount);
                                    newConcessionFare = Number(match.revisedAmount);
                                }
                                fareDiff = newConcessionFare - oldConcessionFare;
                            }
                        }
                    }
                }
            } catch (err) {
                console.error('Error calculating concession route change difference:', err);
            }

            // Update MySQL Record
            await mysqlPool.query(
                'UPDATE transport_requests SET route_id = ?, route_name = ?, stage_name = ?, fare = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                [new_route_id, new_route_name, new_stage_name, new_fare, currentRequest.id]
            );
        }

        // 4. Update MongoDB Fee if fare exceeds (fareDiff > 0)
        if (fareDiff > 0) {
            const { getFeePortalModels } = require('../models/fee-portal-models');
            const { StudentFee, FeeHead } = await getFeePortalModels();

            // Find Transport Fee Head
            const transportFeeHead = await FeeHead.findOne({
                $or: [
                    { code: TRANSPORT_FEE_HEAD_CODE },
                    { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
                    { name: { $regex: /transport/i } }
                ]
            });
            if (!transportFeeHead) {
                console.error('Transport Fee Head (TRN01) not found for change request adjustment.');
            } else {
                // Find existing fee record for the student in current academic year
                // Note: approveTransportRequest uses resolvedAcademicYear. For simplicity, we assume same year.
                const academicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
                
                const fee = await StudentFee.findOne({
                    studentId: admission_number,
                    feeHead: transportFeeHead._id,
                    academicYear: academicYear
                });

                if (fee) {
                    const oldAmount = fee.amount;
                    fee.amount += fareDiff;
                    const changeRemark = ` | Change: ${currentRequest.stage_name} -> ${new_stage_name} (+₹${fareDiff})`;
                    fee.remarks = (fee.remarks || '') + changeRemark;
                    await fee.save();
                } else {
                    // This shouldn't typically happen if they have an approved request, but we handle it
                    console.warn(`No MongoDB fee record found for student ${admission_number} to adjust.`);
                }
            }
        }

        // Log to audit logs
        const auditDetails = JSON.stringify({
            action: 'route_change',
            admission_number,
            old_route: currentRequest.route_name,
            old_stage: currentRequest.stage_name,
            new_route: new_route_name,
            new_stage: new_stage_name,
            fare_diff: fareDiff
        });

        await mysqlPool.query(
            'INSERT INTO audit_logs (action_type, entity_type, entity_id, admin_id, details) VALUES (?, ?, ?, ?, ?)',
            ['ROUTE_CHANGE', 'TRANSPORT_REQUEST', String(currentRequest.id), admin_id || null, auditDetails]
        );

        res.json({
            message: 'Route change request processed successfully.',
            fareDifference: fareDiff,
            newFare: new_fare
        });

    } catch (error) {
        console.error('Error processing route change request:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get buses on a route with seat vacancy (for raise-request / allocation UI)
// @route   GET /api/transport-requests/route-buses?route_id=
// @access  Private/Admin
const getRouteBusVacancy = async (req, res) => {
    const routeId = req.query.route_id;
    if (!routeId) {
        return res.status(400).json({ message: 'route_id is required' });
    }
    try {
        const busesOnRoute = await getBusesWithSeatsForRoute(routeId);
        res.json({ route_id: routeId, busesOnRoute });
    } catch (error) {
        console.error('Error fetching route bus vacancy:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch bus vacancy' });
    }
};

// @desc    List approved transport application numbers for an academic year (ID card print picker)
// @route   GET /api/transport-requests/id-card-application-numbers?academicYear=2025-2026
// @access  Private/Admin
const getIdCardApplicationNumbers = async (req, res) => {
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const collegeCode = req.query.collegeCode || req.query.college_code || null;
        const courseCode = req.query.courseCode || req.query.course_code || null;

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        const hasCollegeRestriction = restrictedColleges !== null;

        let allowedCollegeCodes = [];
        if (hasCollegeRestriction) {
            const [rows] = await mysqlPool.query('SELECT code FROM colleges WHERE name IN (?)', [restrictedColleges.length > 0 ? restrictedColleges : ['']]);
            allowedCollegeCodes = rows.map(r => formatApplicationCode(r.code));
        }

        let allowedCourseCodes = [];
        if (hasCourseRestriction) {
            const [rows] = await mysqlPool.query('SELECT code FROM courses WHERE name IN (?)', [req.user.courses]);
            allowedCourseCodes = rows.map(r => formatApplicationCode(r.code));
        }

        const mysqlParams = [fallbackAcademicYear, academicYear];
        let mysqlFilterSql = '';
        if (collegeCode) {
            mysqlFilterSql += ' AND tr.application_college_code = ?';
            mysqlParams.push(collegeCode);
        }
        if (courseCode) {
            mysqlFilterSql += ' AND tr.application_course_code = ?';
            mysqlParams.push(courseCode);
        }

        if (hasCollegeRestriction) {
            mysqlFilterSql += ' AND COALESCE(s1.college, s2.college) IN (?)';
            mysqlParams.push(restrictedColleges.length > 0 ? restrictedColleges : ['']);
        }
        if (hasCourseRestriction) {
            mysqlFilterSql += ' AND COALESCE(s1.course, s2.course) IN (?)';
            mysqlParams.push(req.user.courses);
        }

        const [mysqlRows] = await mysqlPool.query(
            `SELECT tr.id,
                    tr.application_number,
                    tr.application_serial,
                    tr.application_college_code,
                    tr.application_course_code,
                    tr.student_name,
                    tr.admission_number
             FROM transport_requests tr
             LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
             LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
             WHERE tr.status = 'approved'
               AND tr.application_number IS NOT NULL
               AND tr.application_serial IS NOT NULL
               AND COALESCE(tr.academic_year, ?) = ?
               ${mysqlFilterSql}
             ORDER BY tr.application_college_code ASC, tr.application_course_code ASC, tr.application_serial ASC`,
            mysqlParams
        );

        const mongoQuery = {
            status: 'approved',
            application_number: { $ne: null },
            application_serial: { $ne: null },
            $or: [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ],
        };
        if (collegeCode) mongoQuery.application_college_code = collegeCode;
        if (courseCode) mongoQuery.application_course_code = courseCode;

        if (hasCollegeRestriction) {
            mongoQuery.application_college_code = { $in: allowedCollegeCodes };
        }
        if (hasCourseRestriction) {
            mongoQuery.application_course_code = { $in: allowedCourseCodes };
        }

        const mongoRows = await EmployeeTransportRequest.find(mongoQuery)
            .sort({ application_college_code: 1, application_course_code: 1, application_serial: 1 })
            .lean();

        const employeeApplications = mongoRows
            .filter((r) => (r.academic_year || fallbackAcademicYear) === academicYear)
            .map((r) => ({
                id: r._id.toString(),
                application_number: r.application_number,
                application_serial: Number(r.application_serial),
                college_code: r.application_college_code,
                course_code: r.application_course_code,
                student_name: r.employee_name,
                admission_number: r.emp_no,
                user_type: 'employee',
            }));

        const studentApplications = mysqlRows.map((r) => ({
            id: r.id,
            application_number: r.application_number,
            application_serial: Number(r.application_serial),
            college_code: r.application_college_code,
            course_code: r.application_course_code,
            student_name: r.student_name,
            admission_number: r.admission_number,
            user_type: 'student',
        }));

        const applications = [...studentApplications, ...employeeApplications].sort((a, b) => {
            const collegeCmp = String(a.college_code || '').localeCompare(String(b.college_code || ''));
            if (collegeCmp !== 0) return collegeCmp;
            const courseCmp = String(a.course_code || '').localeCompare(String(b.course_code || ''));
            if (courseCmp !== 0) return courseCmp;
            return a.application_serial - b.application_serial;
        });

        res.json({
            academic_year: academicYear,
            count: applications.length,
            applications,
        });
    } catch (error) {
        console.error('Error fetching ID card application numbers:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Batch fetch approved passengers for Bus ID card printing (by application serial range)
// @route   GET /api/transport-requests/id-cards-print?academicYear=2025-2026&fromSerial=1&toSerial=50
// @access  Private/Admin
const getIdCardsForPrint = async (req, res) => {
    try {
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const academicYear = resolveAcademicYear(req.query);
        const fromSerial = Number(req.query.fromSerial ?? req.query.from_serial ?? 1);
        const toSerial = Number(req.query.toSerial ?? req.query.to_serial ?? fromSerial);
        const collegeCode = req.query.collegeCode || req.query.college_code || null;
        const courseCode = req.query.courseCode || req.query.course_code || null;

        if (!Number.isFinite(fromSerial) || !Number.isFinite(toSerial) || fromSerial < 1 || toSerial < fromSerial) {
            return res.status(400).json({ message: 'Valid fromSerial and toSerial are required (fromSerial <= toSerial, both >= 1).' });
        }

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        const hasCollegeRestriction = restrictedColleges !== null;

        let allowedCollegeCodes = [];
        if (hasCollegeRestriction) {
            const [rows] = await mysqlPool.query('SELECT code FROM colleges WHERE name IN (?)', [restrictedColleges.length > 0 ? restrictedColleges : ['']]);
            allowedCollegeCodes = rows.map(r => formatApplicationCode(r.code));
        }

        let allowedCourseCodes = [];
        if (hasCourseRestriction) {
            const [rows] = await mysqlPool.query('SELECT code FROM courses WHERE name IN (?)', [req.user.courses]);
            allowedCourseCodes = rows.map(r => formatApplicationCode(r.code));
        }

        const { resolveStudentPhoto } = require('../utils/studentPhoto');
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();

        const mysqlParams = [fromSerial, toSerial, fallbackAcademicYear, academicYear];
        let mysqlFilterSql = '';
        if (collegeCode) {
            mysqlFilterSql += ' AND tr.application_college_code = ?';
            mysqlParams.push(collegeCode);
        }
        if (courseCode) {
            mysqlFilterSql += ' AND tr.application_course_code = ?';
            mysqlParams.push(courseCode);
        }

        if (hasCollegeRestriction) {
            mysqlFilterSql += ' AND COALESCE(s1.college, s2.college) IN (?)';
            mysqlParams.push(restrictedColleges.length > 0 ? restrictedColleges : ['']);
        }
        if (hasCourseRestriction) {
            mysqlFilterSql += ' AND COALESCE(s1.course, s2.course) IN (?)';
            mysqlParams.push(req.user.courses);
        }

        const [mysqlRows] = await mysqlPool.query(
            `SELECT tr.*,
                    COALESCE(s1.course, s2.course) as course,
                    COALESCE(s1.branch, s2.branch) as branch,
                    COALESCE(s1.student_photo, s2.student_photo) as student_photo,
                    COALESCE(s1.student_data, s2.student_data) as student_data,
                    COALESCE(s1.pin_no, s2.pin_no) as pin_no
             FROM transport_requests tr
             LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
             LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
             WHERE tr.status = 'approved'
               AND tr.application_serial IS NOT NULL
               AND tr.application_serial BETWEEN ? AND ?
               AND COALESCE(tr.academic_year, ?) = ?
               ${mysqlFilterSql}
             ORDER BY tr.application_college_code ASC, tr.application_course_code ASC, tr.application_serial ASC`,
            mysqlParams
        );

        const studentPassengers = mysqlRows.map((row) => ({
            ...row,
            student_photo: resolveStudentPhoto(row),
            user_type: 'student',
        }));

        const mongoQuery = {
            status: 'approved',
            application_serial: { $gte: fromSerial, $lte: toSerial },
            $or: [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ],
        };
        if (collegeCode) mongoQuery.application_college_code = collegeCode;
        if (courseCode) mongoQuery.application_course_code = courseCode;

        if (hasCollegeRestriction) {
            mongoQuery.application_college_code = { $in: allowedCollegeCodes };
        }
        if (hasCourseRestriction) {
            mongoQuery.application_course_code = { $in: allowedCourseCodes };
        }

        const mongoRows = await EmployeeTransportRequest.find(mongoQuery)
            .sort({ application_college_code: 1, application_course_code: 1, application_serial: 1 })
            .lean();

        const employeePassengers = mongoRows
            .filter((r) => (r.academic_year || fallbackAcademicYear) === academicYear)
            .map((r) => ({
                ...r,
                id: r._id.toString(),
                admission_number: r.emp_no,
                student_name: r.employee_name,
                user_type: 'employee',
                course: 'Employee',
            }));

        const combined = [...studentPassengers, ...employeePassengers].sort(
            (a, b) => Number(a.application_serial) - Number(b.application_serial)
        );

        res.json({
            academic_year: academicYear,
            from_serial: fromSerial,
            to_serial: toSerial,
            count: combined.length,
            passengers: combined,
        });
    } catch (error) {
        console.error('Error fetching ID cards for print:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Public verification for transport bus ID card QR scan
// @route   GET /api/transport-verify/:id
// @access  Public
const verifyTransportPassenger = async (req, res) => {
    const requestId = req.params.id;
    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId).lean();
            if (!reqRow) {
                return res.json({ registered: false, message: 'No transport registration found for this QR code.' });
            }
            if (reqRow.status !== 'approved') {
                return res.json({
                    registered: false,
                    message: `Transport record exists but is not active (status: ${reqRow.status}).`,
                    student_name: reqRow.employee_name,
                    admission_number: reqRow.emp_no,
                    status: reqRow.status,
                });
            }
            return res.json({
                registered: true,
                user_type: 'employee',
                student_name: reqRow.employee_name,
                admission_number: reqRow.emp_no,
                course: 'Employee',
                route_id: reqRow.route_id,
                route_name: reqRow.route_name,
                stage_name: reqRow.stage_name,
                bus_id: reqRow.bus_id,
                fare: reqRow.fare,
                academic_year: reqRow.academic_year,
                application_number: reqRow.application_number,
                application_serial: reqRow.application_serial,
                status: reqRow.status,
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'Service unavailable' });
        }

        const { resolveStudentPhoto } = require('../utils/studentPhoto');
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const parts = getActivePassengerSqlParts(fallbackAcademicYear);

        const [rows] = await mysqlPool.query(
            `SELECT tr.*,
                    COALESCE(s1.course, s2.course) as course,
                    COALESCE(s1.branch, s2.branch) as branch,
                    COALESCE(s1.student_photo, s2.student_photo) as student_photo,
                    COALESCE(s1.student_data, s2.student_data) as student_data,
                    COALESCE(s1.pin_no, s2.pin_no) as pin_no,
                    COALESCE(s1.student_mobile, s2.student_mobile) as student_mobile,
                    ${parts.effectiveExpiryExpr} as effective_expiry_date,
                    ${parts.isExpiredExpr} as is_expired
             FROM transport_requests tr
             LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
             LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
             ${parts.expiryJoins}
             WHERE tr.id = ?`,
            [...parts.expiryParams, requestId]
        );

        if (!rows[0]) {
            return res.json({ registered: false, message: 'No transport registration found for this QR code.' });
        }

        const row = rows[0];
        if (row.status !== 'approved') {
            return res.json({
                registered: false,
                message: `Transport record exists but is not active (status: ${row.status}).`,
                student_name: row.student_name,
                admission_number: row.admission_number,
                status: row.status,
            });
        }

        return res.json({
            registered: true,
            user_type: 'student',
            student_name: row.student_name,
            admission_number: row.admission_number,
            pin_no: row.pin_no,
            course: row.course,
            branch: row.branch,
            route_id: row.route_id,
            route_name: row.route_name,
            stage_name: row.stage_name,
            bus_id: row.bus_id,
            fare: row.fare,
            academic_year: row.academic_year,
            application_number: row.application_number,
            application_serial: row.application_serial,
            status: row.status,
            student_photo: resolveStudentPhoto(row),
            student_mobile: row.student_mobile,
            effective_expiry_date: row.effective_expiry_date,
            is_expired: Boolean(row.is_expired),
        });
    } catch (error) {
        console.error('Error verifying transport pass:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getTransportRequests,
    getRouteBusVacancy,
    getSemesterOptions,
    updateTransportRequest,
    approveTransportRequest,
    rejectTransportRequest,
    createTransportRequest,
    getConcessions,
    getDashboardStats,
    updateConcession,
    deleteConcession,
    getApprovedPassengers,
    submitRouteChangeRequest,
    getPassengerFullDetails,
    getIdCardApplicationNumbers,
    getIdCardsForPrint,
    verifyTransportPassenger,
    getDefaultAcademicYear,
    resolveAcademicYear,
    getActivePassengerSqlParts,
    enrichTransportFareAdjustments,
};
