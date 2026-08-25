const { mysqlPool, getFeeConnection } = require('../config/db');
const { getFeePortalModels } = require('../models/fee-portal-models');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const mongoose = require('mongoose');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const TransportRequest = require('../models/TransportRequest');
const { getEmployeeModel } = require('../models/Employee');
const { validateStudentAcademicContext, getExpectedYearForBatch } = require('../utils/studentAcademicValidation');
const { assignTransportApplicationNumber, peekNextTransportApplicationNumber, formatApplicationCode } = require('../utils/transportApplicationNumber');
const { resolveApplicationNumberContext } = require('../utils/applicationNumberContext');
const { resolveRouteStageFare } = require('../utils/stageFare');
const { getCollegesForCampuses } = require('./campusController');
const campusService = require('../services/campusService');
const { resolveStudentExpiries } = require('../utils/expiryResolver');
const { checkStudentRequestEligibility } = require('../services/requestEligibilityService');

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

const ACTIVE_STUDENT_FEE_FILTER = {
    $or: [{ isActive: true }, { isActive: { $exists: false } }],
};

async function getTransportFeeHead(FeeHead) {
    return FeeHead.findOne({
        $or: [
            { code: TRANSPORT_FEE_HEAD_CODE },
            { code: String(TRANSPORT_FEE_HEAD_CODE).toLowerCase() },
            { name: { $regex: /transport/i } },
        ],
    });
}

async function deactivateTransportFeeForCancellation({
    admissionNumber,
    academicYear,
    studentYear,
    semester,
    cancellationReason,
}) {
    const feeModels = getFeePortalModels();
    if (!feeModels || !admissionNumber || !academicYear) {
        return { updated: false, reason: 'fee_db_unavailable' };
    }

    const { FeeHead, StudentFee } = feeModels;
    const transportFeeHead = await getTransportFeeHead(FeeHead);
    if (!transportFeeHead) {
        return { updated: false, reason: 'fee_head_missing' };
    }

    const resolvedYear = String(academicYear);
    const studentId = String(admissionNumber);
    const feeQuery = {
        studentId,
        feeHead: transportFeeHead._id,
        academicYear: resolvedYear,
        ...ACTIVE_STUDENT_FEE_FILTER,
    };

    if (studentYear != null && studentYear !== '') {
        feeQuery.studentYear = Number(studentYear);
    }
    if (semester != null && semester !== '') {
        feeQuery.semester = Number(semester);
    }

    let fee = await StudentFee.findOne(feeQuery);

    if (!fee) {
        fee = await StudentFee.findOne({
            studentId,
            feeHead: transportFeeHead._id,
            academicYear: resolvedYear,
            remarks: { $regex: /^Transport/i },
            ...ACTIVE_STUDENT_FEE_FILTER,
        });
    }

    if (!fee) {
        return { updated: false, reason: 'fee_not_found' };
    }

    const cancelTag = `Cancelled: ${cancellationReason}`;
    const existingRemarks = String(fee.remarks || 'Transport').trim();
    fee.isActive = false;
    fee.remarks = existingRemarks.includes('Cancelled:')
        ? existingRemarks
        : `${existingRemarks} | ${cancelTag}`;
    await fee.save();

    return { updated: true, feeId: fee._id };
}

function resolveRequestAcademicYear(requestRow, fallbackAcademicYear) {
    return requestRow?.academic_year
        || fallbackAcademicYear
        || process.env.CURRENT_ACADEMIC_YEAR
        || getDefaultAcademicYear();
}

function getAcademicYearMismatchMessage(requestAcademicYear, requestedAcademicYear) {
    if (!requestedAcademicYear || !requestAcademicYear) return null;
    if (String(requestedAcademicYear) !== String(requestAcademicYear)) {
        return `This request belongs to academic year ${requestAcademicYear}, not ${requestedAcademicYear}.`;
    }
    return null;
}

async function deleteTransportFeesForRequest({
    admissionNumber,
    academicYear,
    yearOfStudy,
    semester,
}) {
    const feeModels = getFeePortalModels();
    if (!feeModels || !admissionNumber || !academicYear) {
        return { feesDeleted: 0 };
    }

    const { StudentFee, FeeHead, TransportConcession } = feeModels;
    const transportFeeHead = await getTransportFeeHead(FeeHead);
    if (!transportFeeHead) {
        return { feesDeleted: 0 };
    }

    const studentId = String(admissionNumber);
    const resolvedYear = String(academicYear);
    const feeQuery = {
        studentId,
        feeHead: transportFeeHead._id,
        academicYear: resolvedYear,
        remarks: { $regex: /^Transport/i },
    };

    if (yearOfStudy != null && yearOfStudy !== '') {
        feeQuery.studentYear = Number(yearOfStudy);
    }
    if (semester != null && semester !== '') {
        feeQuery.semester = Number(semester);
    }

    const feeDeleteResult = await StudentFee.deleteMany(feeQuery);

    if (TransportConcession && yearOfStudy != null && yearOfStudy !== '') {
        const concession = await TransportConcession.findOne({
            studentId,
            feeHead: transportFeeHead._id,
        });
        const yearKey = String(Number(yearOfStudy));
        if (concession?.yearConcessions?.get?.(yearKey) != null) {
            concession.yearConcessions.delete(yearKey);
            concession.markModified('yearConcessions');
            if (concession.yearConcessions.size === 0) {
                await concession.deleteOne();
            } else {
                await concession.save();
            }
        }
    }

    return { feesDeleted: feeDeleteResult.deletedCount || 0 };
}

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
    const match = (revisedFees || []).find((fee) => (
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

    const rows = await TransportRequest.find({
        admission_number: admissionNumber,
        status: { $in: ['pending', 'approved'] },
    }).sort({ request_date: -1 }).lean();
    return rows.find((r) => (r.academic_year || fallbackYear) === resolvedYear) || null;
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
    const now = new Date();

    // Count live students from MongoDB TransportRequest (same source as fleet page)
    // Use expiry_date / semester_end_date for live filtering (mirrors getBusesOverview live mode)
    const studentDocs = await TransportRequest.find({
        status: 'approved',
        bus_id: { $in: busNumbers },
    }).select('bus_id admission_number academic_year year_of_study semester_id').lean();

    await resolveStudentExpiries(studentDocs, mysqlPool);

    const studentCountMap = {};
    studentDocs.forEach((r) => {
        if (!r.is_expired && r.bus_id) {
            studentCountMap[r.bus_id] = (studentCountMap[r.bus_id] || 0) + 1;
        }
    });

    // Count live employees from MongoDB EmployeeTransportRequest (no expiry mechanism)
    const empCounts = await EmployeeTransportRequest.aggregate([
        { $match: { status: 'approved', bus_id: { $in: busNumbers } } },
        { $group: { _id: '$bus_id', count: { $sum: 1 } } }
    ]);
    const empCountMap = Object.fromEntries(empCounts.map(r => [r._id, r.count]));

    return buses.map((b) => {
        const capacity = b.capacity || 0;
        const seatsFilled = (studentCountMap[b.busNumber] || 0) + (empCountMap[b.busNumber] || 0);
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
            userType,
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

async function findTransportRequest(requestId) {
    if (!requestId) return null;
    let doc = null;

    if (mongoose.isValidObjectId(requestId)) {
        doc = await TransportRequest.findById(requestId).lean();
        if (doc) return { doc, type: 'student' };

        doc = await EmployeeTransportRequest.findById(requestId).lean();
        if (doc) return { doc, type: 'employee' };
    }

    if (!isNaN(requestId)) {
        doc = await TransportRequest.findOne({ id: Number(requestId) }).lean();
        if (doc) return { doc, type: 'student' };
    }

    return null;
}

// @desc    Get expiry for a transport request (last sem of student's year – for approve popup)
// @route   GET /api/transport-requests/:id/semester-options
// @access  Private/Admin
const getSemesterOptions = async (req, res) => {
    const requestId = req.params.id;
    
    try {
        const reqMatch = await findTransportRequest(requestId);
        if (!reqMatch) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const { doc: transportRequest, type } = reqMatch;

        if (type === 'employee') {
            const routeId = transportRequest.route_id;
            let busesOnRoute = [];
            if (routeId) {
                busesOnRoute = await getBusesWithSeatsForRoute(routeId);
            }

            let applicationPreview = { academic_year: transportRequest.academic_year || getDefaultAcademicYear() };
            if (mysqlPool) {
                applicationPreview = await getApplicationNumberForApprovalPreview(mysqlPool, transportRequest);
            } else if (transportRequest.application_number) {
                applicationPreview.application_number = transportRequest.application_number;
            }

            return res.json({
                requestId: String(transportRequest._id),
                studentName: transportRequest.employee_name,
                admissionNumber: transportRequest.emp_no,
                course: 'Employee',
                yearOfStudy: null,
                route_id: routeId,
                route_name: transportRequest.route_name,
                stage_name: transportRequest.stage_name,
                fare: Number(transportRequest.fare) || 0,
                resolved_fare: 0,
                fare_mismatch: false,
                busesOnRoute,
                expiry: null,
                user_type: 'employee',
                ...applicationPreview,
            });
        }

        const admissionNumber = transportRequest.admission_number || transportRequest.admission_no;
        if (!admissionNumber) {
            return res.status(400).json({ message: 'Request has no admission number.' });
        }

        let student = {};
        let lastSem = null;
        if (mysqlPool) {
            lastSem = await getLastSemesterForRequest(mysqlPool, transportRequest);
            const [studentRows] = await mysqlPool.query(
                'SELECT course, current_year FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
                [admissionNumber, admissionNumber]
            );
            student = studentRows[0] || {};
        }

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
            requestId: transportRequest.id != null ? Number(transportRequest.id) : String(transportRequest._id),
            _id: String(transportRequest._id),
            studentName: transportRequest.student_name,
            admissionNumber,
            course: student.course || 'N/A',
            yearOfStudy: student.current_year != null ? Number(student.current_year) : (transportRequest.year_of_study || 1),
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
                    semester_id: lastSem.id,
                    semester_start_date: lastSem.start_date,
                    semester_end_date: lastSem.end_date,
                    academic_year_id: lastSem.academic_year_id,
                }
                : null,
            user_type: 'student'
        });
    } catch (error) {
        console.error('Error fetching semester options:', error);
        return res.status(500).json({ message: error.message || 'Failed to fetch expiry' });
    }
};

// @desc    Get all transport requests (optional filters: route_id, status, bus_id; bus_id=unassigned for null/empty)
// @route   GET /api/transport-requests
// @access  Private/Admin
const getTransportRequests = async (req, res) => {
    try {
        const { route_id, status, bus_id, course, search } = req.query;
        const explicitAcademicYear = req.query.academicYear || req.query.academic_year;
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const filterAcademicYear = explicitAcademicYear
            ? resolveAcademicYear(req.query)
            : null;

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCampusRestriction = req.user && !isSuperAdmin && req.user.campuses && req.user.campuses.length > 0;

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

        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;
        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);

        // Build MongoDB query for student transport requests
        const studentMongoQuery = {};
        if (route_id) studentMongoQuery.route_id = route_id;
        if (status === 'expired' || status === 'active') {
            studentMongoQuery.status = 'approved';
        } else if (status) {
            studentMongoQuery.status = status;
        }
        if (bus_id !== undefined) {
            if (bus_id === '' || bus_id === 'unassigned') {
                studentMongoQuery.$or = [{ bus_id: null }, { bus_id: '' }];
            } else {
                studentMongoQuery.bus_id = bus_id;
            }
        }
        if (search) {
            const searchRegex = new RegExp(search, 'i');
            const searchConditions = [
                { student_name: searchRegex },
                { admission_number: searchRegex }
            ];
            if (studentMongoQuery.$or) {
                studentMongoQuery.$and = [
                    { $or: studentMongoQuery.$or },
                    { $or: searchConditions }
                ];
                delete studentMongoQuery.$or;
            } else {
                studentMongoQuery.$or = searchConditions;
            }
        }

        if (filterByCampusRoutes) {
            if (allowedRouteIds.length > 0) {
                if (studentMongoQuery.route_id) {
                    if (!allowedRouteIds.includes(studentMongoQuery.route_id)) {
                        studentMongoQuery.route_id = '__NONE__';
                    }
                } else {
                    studentMongoQuery.route_id = { $in: allowedRouteIds };
                }
            } else {
                studentMongoQuery.route_id = '__NONE__';
            }
        }

        const rawStudentMongoRows = await TransportRequest.find(studentMongoQuery).lean();

        const filteredStudentMongoRows = filterAcademicYear
            ? rawStudentMongoRows.filter(
                (r) => (r.academic_year || fallbackAcademicYear) === filterAcademicYear
            )
            : rawStudentMongoRows;

        // Resolve student request expiry details dynamically from SQL
        await resolveStudentExpiries(filteredStudentMongoRows, mysqlPool);

        // Fetch student info from MySQL students table for course, branch, college, pin_no
        const admissionNos = [...new Set(filteredStudentMongoRows.map(r => r.admission_number).filter(Boolean))];
        let studentMap = {};
        if (mysqlPool && admissionNos.length > 0) {
            const [studentRows] = await mysqlPool.query(
                `SELECT admission_number, admission_no, course, branch, pin_no, college, current_year
                 FROM students
                 WHERE admission_number IN (?) OR admission_no IN (?)`,
                [admissionNos, admissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap[s.admission_number] = s;
                if (s.admission_no) studentMap[s.admission_no] = s;
            }
        }

        const formattedStudentRows = [];

        for (const r of filteredStudentMongoRows) {
            const admNo = r.admission_number;
            const student = (admNo && studentMap[admNo]) || {};

            const itemCourse = student.course || 'N/A';
            const itemBranch = student.branch || 'N/A';
            const itemCollege = student.college || null;
            const itemPinNo = student.pin_no || 'N/A';
            const itemYear = r.year_of_study || student.current_year || 1;

            if (course && itemCourse !== course) continue;
            if (restrictedColleges !== null && (!itemCollege || !restrictedColleges.includes(itemCollege))) continue;
            if (hasCourseRestriction && (!itemCourse || !req.user.courses.includes(itemCourse))) continue;

            const isExpired = r.is_expired;

            if (status === 'expired' && (!isExpired || r.status !== 'approved')) continue;
            if (status === 'active' && (isExpired || r.status !== 'approved')) continue;

            formattedStudentRows.push({
                ...r,
                id: r.id != null ? r.id : String(r._id),
                _id: String(r._id),
                user_type: 'student',
                year_of_study: itemYear,
                course: itemCourse,
                branch: itemBranch,
                college: itemCollege,
                pin_no: itemPinNo,
                effective_expiry_date: r.effective_expiry_date,
                is_expired: isExpired,
            });
        }

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
                cancellation_reason: r.cancellation_reason || null,
                cancelled_at: r.cancelled_at || null,
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

        const enrichedStudentRows = await enrichTransportFareAdjustments(mysqlPool, formattedStudentRows);

        const combined = [...enrichedStudentRows, ...mongoRows];
        combined.sort((a, b) => {
            const appA = a.application_number;
            const appB = b.application_number;
            if (appA && appB) {
                return appB.localeCompare(appA, undefined, { numeric: true, sensitivity: 'base' });
            }
            if (appA) return -1;
            if (appB) return 1;
            return new Date(b.request_date || 0) - new Date(a.request_date || 0);
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
    const { bus_id, new_id_card_needed } = req.body || {};
    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (reqRow) {
                if (bus_id !== undefined) reqRow.bus_id = bus_id || null;
                if (new_id_card_needed !== undefined) reqRow.new_id_card_needed = new_id_card_needed;
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
                    new_id_card_needed: reqRow.new_id_card_needed,
                    user_type: 'employee'
                });
            }
        }

        const studentReqQuery = { $or: [{ id: Number(requestId) }] };
        if (isMongoId(requestId)) studentReqQuery.$or.push({ _id: requestId });
        const studentReq = await TransportRequest.findOne(studentReqQuery);
        if (studentReq) {
            if (bus_id !== undefined) studentReq.bus_id = bus_id || null;
            if (new_id_card_needed !== undefined) studentReq.new_id_card_needed = new_id_card_needed;
            await studentReq.save();
            return res.json({
                ...studentReq.toObject(),
                id: studentReq.id != null ? studentReq.id : String(studentReq._id),
                user_type: 'student'
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
        const reqMatch = await findTransportRequest(requestId);
        if (!reqMatch) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const { doc: reqDoc, type } = reqMatch;
        const { resolveStudentPhoto } = require('../utils/studentPhoto');

        if (type === 'employee') {
            let profilePhoto = null;
            if (reqDoc.emp_no) {
                try {
                    const Employee = getEmployeeModel();
                    if (Employee) {
                        const emp = await Employee.findOne({ emp_no: reqDoc.emp_no }, 'profilePhoto').lean();
                        profilePhoto = emp?.profilePhoto || null;
                    }
                } catch (err) {
                    console.error(`Error fetching employee photo for ${reqDoc.emp_no}:`, err.message);
                }
            }
            return res.json({
                ...reqDoc,
                id: reqDoc._id.toString(),
                admission_number: reqDoc.emp_no,
                student_name: reqDoc.employee_name,
                user_type: 'employee',
                course: 'Employee',
                student_photo: profilePhoto
            });
        }

        let studentInfo = {};
        const admissionNumber = reqDoc.admission_number;
        if (mysqlPool && admissionNumber) {
            const [rows] = await mysqlPool.query(
                `SELECT s1.current_year as student_year, s1.course, s1.branch, s1.student_photo, s1.student_data, s1.pin_no, s1.student_mobile, s1.parent_mobile1, s1.student_address, s1.father_name
                 FROM students s1
                 WHERE s1.admission_number = ? OR s1.admission_no = ?
                 LIMIT 1`,
                [admissionNumber, admissionNumber]
            );
            studentInfo = rows[0] || {};
        }

        res.json({
            ...reqDoc,
            id: reqDoc.id != null ? reqDoc.id : String(reqDoc._id),
            year_of_study: reqDoc.year_of_study || studentInfo.student_year || 1,
            course: studentInfo.course || 'N/A',
            branch: studentInfo.branch || 'N/A',
            student_photo: resolveStudentPhoto({ ...reqDoc, ...studentInfo }),
            student_data: studentInfo.student_data || null,
            pin_no: studentInfo.pin_no || 'N/A',
            student_mobile: studentInfo.student_mobile || null,
            parent_mobile1: studentInfo.parent_mobile1 || null,
            student_address: studentInfo.student_address || null,
            father_name: studentInfo.father_name || null,
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
// ─── Bus Capacity Guard ──────────────────────────────────────────────────────
// Returns an error object { status, message } if the bus is full, else null.
async function checkBusCapacityGuard(busNumber) {
    if (!busNumber) return null; // no bus assigned yet — skip
    const bus = await Bus.findOne({ busNumber }).lean();
    if (!bus) return null; // bus not found — let the rest of the flow handle it
    const capacity = bus.capacity || 0;
    if (capacity === 0) return null; // unlimited / unconfigured capacity

    const now = new Date();

    // Count live students from MongoDB (same source as fleet page and getBusesWithSeatsForRoute)
    const studentDocs = await TransportRequest.find({
        status: 'approved',
        bus_id: busNumber,
    }).select('admission_number academic_year year_of_study semester_id').lean();

    await resolveStudentExpiries(studentDocs, mysqlPool);

    const studentCount = studentDocs.filter((r) => !r.is_expired).length;

    // Count live employees from MongoDB (no expiry mechanism)
    const [empAgg] = await EmployeeTransportRequest.aggregate([
        { $match: { status: 'approved', bus_id: busNumber } },
        { $count: 'cnt' }
    ]);
    const employeeCount = empAgg ? empAgg.cnt : 0;

    const seatsFilled = studentCount + employeeCount;
    if (seatsFilled >= capacity) {
        return {
            status: 409,
            message: `Bus ${busNumber} is at full capacity (${seatsFilled}/${capacity} seats filled). Cannot approve this request.`,
        };
    }
    return null;
}
// ─────────────────────────────────────────────────────────────────────────────

const approveTransportRequest = async (req, res) => {
    const requestId = req.params.id;
    const { academicYear } = req.body || {};

    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (!reqRow) return res.status(404).json({ message: 'Transport request not found' });
            if (reqRow.status === 'approved') return res.status(400).json({ message: 'Request is already approved' });
            if (reqRow.status === 'rejected') return res.status(400).json({ message: 'Request was rejected and cannot be approved' });
            if (reqRow.status === 'cancelled') return res.status(400).json({ message: 'Request was cancelled and cannot be approved' });

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
            // Hard capacity guard — block approval if bus is full
            const effectiveBusId = reqRow.bus_id;
            const capacityError = await checkBusCapacityGuard(effectiveBusId);
            if (capacityError) {
                return res.status(capacityError.status).json({ message: capacityError.message });
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
        }        // Student request handling (MongoDB)
        // Find the student transport request stored in MongoDB
        const studentReqQuery = { $or: [{ id: Number(requestId) }] };
        if (isMongoId(requestId)) studentReqQuery.$or.push({ _id: requestId });
        const studentReq = await TransportRequest.findOne(studentReqQuery).lean();
        if (!studentReq) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        if (studentReq.status === 'approved') return res.status(400).json({ message: 'Request is already approved' });
        if (studentReq.status === 'rejected') return res.status(400).json({ message: 'Request was rejected and cannot be approved' });
        if (studentReq.status === 'cancelled') return res.status(400).json({ message: 'Request was cancelled and cannot be approved' });

        const resolvedAcademicYear = academicYear || studentReq.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }
        // Optionally override fare if provided
        if (req.body.fare != null) {
            const overrideFare = Number(req.body.fare);
            if (Number.isFinite(overrideFare)) {
                await TransportRequest.updateOne({ _id: studentReq._id }, { $set: { fare: overrideFare } });
                studentReq.fare = overrideFare;
            }
        }
        // Resolve application number context and assign numbers
        const context = await resolveApplicationNumberContext(mysqlPool, {
            admissionNumber: studentReq.admission_number,
            userType: 'student',
        });
        const application = await assignTransportApplicationNumber(mysqlPool, {
            academicYear: resolvedAcademicYear,
            collegeCode: context.collegeCode,
            courseCode: context.courseCode,
            existingApplicationNumber: studentReq.application_number,
            existingApplicationSerial: studentReq.application_serial,
        });

        // Update Mongo document with approval data
        const updateFields = {
            status: 'approved',
            academic_year: resolvedAcademicYear,
            application_number: application.application_number,
            application_serial: application.application_serial,
            application_college_code: application.college_code,
            application_course_code: application.course_code,
        };
        if (req.body.bus_id) {
            updateFields.bus_id = req.body.bus_id;
        }
        // Hard capacity guard — block approval if bus is full
        const effectiveBusId = updateFields.bus_id || studentReq.bus_id;
        const capacityError = await checkBusCapacityGuard(effectiveBusId);
        if (capacityError) {
            return res.status(capacityError.status).json({ message: capacityError.message });
        }
        await TransportRequest.updateOne({ _id: studentReq._id }, { $set: updateFields });
        // Merge updates into request object for downstream processing
        const request = { ...studentReq, ...updateFields };

        const admissionNumber = request.admission_number || request.admission_no;
        if (!admissionNumber) {
            return res.status(400).json({
                message: 'Transport request has no admission number; cannot create fee in Fee Management.',
            });
        }

        // Duplicate resolvedAcademicYear block removed; using earlier definition.

        // Fetch student from MySQL for course, branch, batch, year, semester, category
        let student = null;
        if (admissionNumber) {
            const [studentRows] = await mysqlPool.query(
                'SELECT course, branch, batch, current_year, current_semester, stud_type FROM students WHERE admission_number = ? OR admission_no = ? LIMIT 1',
                [admissionNumber, admissionNumber]
            );
            student = studentRows[0] || null;
        }

        // Fetch last semester for expiry date and semester update (same as legacy path)
        let lastSem = null;
        try {
            lastSem = await getLastSemesterForRequest(mysqlPool, request);
        } catch (semErr) {
            console.error('Error fetching last semester for transport request:', semErr);
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
        const finalAmount = amount;

        const existingFee = await StudentFee.findOne({
            studentId: String(admissionNumber),
            feeHead: transportFeeHead._id,
            academicYear: resolvedAcademicYear,
            studentYear,
            semester: semester || null,
            remarks,
            ...ACTIVE_STUDENT_FEE_FILTER,
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
            const approvedApp = await markTransportRequestApproved(mysqlPool, requestId, {
                bus_id: req.body.bus_id,
                academicYear: resolvedAcademicYear,
                existingApplicationNumber: request.application_number,
                existingApplicationSerial: request.application_serial,
                admissionNumber,
                userType: 'student',
            });

            return res.json({
                message: `Request approved. Application No: ${approvedApp.application_number}. Transport fee for this student/year already exists in Fee Management.`,
                requestId: Number(requestId),
                application_number: approvedApp.application_number,
                application_serial: approvedApp.application_serial,
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
        const finalApprovedApp = await markTransportRequestApproved(mysqlPool, requestId, {
            bus_id: req.body.bus_id,
            academicYear: resolvedAcademicYear,
            existingApplicationNumber: request.application_number,
            existingApplicationSerial: request.application_serial,
            admissionNumber,
            userType: 'student',
        });

        res.json({
            message: `Transport request approved. Application No: ${finalApprovedApp.application_number}. Transport Fee (TRN01) created in Fee Management.`,
            requestId: Number(requestId),
            academicYear: resolvedAcademicYear,
            application_number: finalApprovedApp.application_number,
            application_serial: finalApprovedApp.application_serial,
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
            if (reqRow) {
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
        }

        const studentReqQuery = { $or: [{ id: Number(requestId) }] };
        if (isMongoId(requestId)) studentReqQuery.$or.push({ _id: requestId });
        const studentReq = await TransportRequest.findOne(studentReqQuery);
        if (studentReq) {
            if (studentReq.status === 'rejected') {
                return res.json({ message: 'Request was already rejected.', requestId: studentReq.id != null ? studentReq.id : String(studentReq._id) });
            }
            if (studentReq.status === 'approved') {
                return res.status(400).json({ message: 'Cannot reject an approved request.' });
            }

            studentReq.status = 'rejected';
            await studentReq.save();
            return res.json({ message: 'Transport request rejected.', requestId: studentReq.id != null ? studentReq.id : String(studentReq._id) });
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

// @desc    Cancel an approved transport request (keeps record; vacates seat)
// @route   PATCH /api/transport-requests/:id/cancel
// @access  Private/Admin
const cancelTransportRequest = async (req, res) => {
    const requestId = req.params.id;
    const reason = String(req.body?.reason || '').trim();

    if (!reason) {
        return res.status(400).json({ message: 'Cancellation reason is required.' });
    }

    try {
        if (isMongoId(requestId)) {
            const reqRow = await EmployeeTransportRequest.findById(requestId);
            if (reqRow) {
                if (reqRow.status === 'cancelled') {
                    return res.json({
                        message: 'Request is already cancelled.',
                        requestId: String(requestId),
                        cancellation_reason: reqRow.cancellation_reason || reason,
                    });
                }
                if (reqRow.status !== 'approved') {
                    return res.status(400).json({ message: 'Only approved requests can be cancelled.' });
                }

                reqRow.status = 'cancelled';
                reqRow.cancellation_reason = reason;
                reqRow.cancelled_at = new Date();
                await reqRow.save();

                return res.json({
                    message: 'Transport request cancelled. The seat has been vacated.',
                    requestId: String(requestId),
                    cancellation_reason: reason,
                });
            }
        }

        const studentReqQuery = { $or: [{ id: Number(requestId) }] };
        if (isMongoId(requestId)) studentReqQuery.$or.push({ _id: requestId });
        const mongoStudentReq = await TransportRequest.findOne(studentReqQuery);
        if (mongoStudentReq) {
            if (mongoStudentReq.status === 'cancelled') {
                return res.json({
                    message: 'Request is already cancelled.',
                    requestId: mongoStudentReq.id != null ? mongoStudentReq.id : String(mongoStudentReq._id),
                    cancellation_reason: mongoStudentReq.cancellation_reason || reason,
                });
            }
            if (mongoStudentReq.status !== 'approved') {
                return res.status(400).json({ message: 'Only approved requests can be cancelled.' });
            }

            mongoStudentReq.status = 'cancelled';
            mongoStudentReq.cancellation_reason = reason;
            mongoStudentReq.cancelled_at = new Date();
            await mongoStudentReq.save();

            const admissionNumber = mongoStudentReq.admission_number;
            const resolvedAcademicYear = mongoStudentReq.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
            const feeResult = await deactivateTransportFeeForCancellation({
                admissionNumber,
                academicYear: resolvedAcademicYear,
                studentYear: mongoStudentReq.year_of_study,
                semester: mongoStudentReq.semester_number,
                cancellationReason: reason,
            });

            let message = 'Transport request cancelled. The seat has been vacated.';
            if (feeResult.updated) {
                message += ' Transport fee (TRN01) marked inactive in Fee Management with cancellation remarks.';
            } else if (feeResult.reason === 'fee_db_unavailable') {
                message += ' Fee Management was not connected — transport fee was not updated.';
            } else if (feeResult.reason === 'fee_not_found') {
                message += ' No active transport fee record was found to deactivate.';
            }

            return res.json({
                message,
                requestId: mongoStudentReq.id != null ? mongoStudentReq.id : String(mongoStudentReq._id),
                cancellation_reason: reason,
                fee_deactivated: feeResult.updated,
            });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query(
            `SELECT tr.*,
                    COALESCE(tr.year_of_study, s1.current_year, s2.current_year) AS resolved_year_of_study,
                    COALESCE(s1.current_semester, s2.current_semester) AS resolved_semester
             FROM transport_requests tr
             LEFT JOIN students s1 ON tr.admission_number = s1.admission_number
             LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
             WHERE tr.id = ?`,
            [requestId]
        );
        const request = rows[0];
        if (!request) {
            return res.status(404).json({ message: 'Transport request not found' });
        }
        if (request.status === 'cancelled') {
            return res.json({
                message: 'Request is already cancelled.',
                requestId: Number(requestId),
                cancellation_reason: request.cancellation_reason || reason,
            });
        }
        if (request.status !== 'approved') {
            return res.status(400).json({ message: 'Only approved requests can be cancelled.' });
        }

        try {
            await mysqlPool.query(
                `UPDATE transport_requests
                 SET status = 'cancelled',
                     cancellation_reason = ?,
                     cancelled_at = CURRENT_TIMESTAMP
                 WHERE id = ?`,
                [reason, requestId]
            );
        } catch (error) {
            if (error.code === 'ER_BAD_FIELD_ERROR') {
                await mysqlPool.query(
                    "UPDATE transport_requests SET status = 'cancelled' WHERE id = ?",
                    [requestId]
                );
            } else {
                throw error;
            }
        }

        const admissionNumber = request.admission_number || request.admission_no;
        const resolvedAcademicYear = request.academic_year || process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const feeResult = await deactivateTransportFeeForCancellation({
            admissionNumber,
            academicYear: resolvedAcademicYear,
            studentYear: request.resolved_year_of_study ?? request.year_of_study,
            semester: request.resolved_semester,
            cancellationReason: reason,
        });

        let message = 'Transport request cancelled. The seat has been vacated.';
        if (feeResult.updated) {
            message += ' Transport fee (TRN01) marked inactive in Fee Management with cancellation remarks.';
        } else if (feeResult.reason === 'fee_db_unavailable') {
            message += ' Fee Management was not connected — transport fee was not updated.';
        } else if (feeResult.reason === 'fee_not_found') {
            message += ' No active transport fee record was found to deactivate.';
        }

        res.json({
            message,
            requestId: Number(requestId),
            cancellation_reason: reason,
            fee_deactivated: feeResult.updated,
        });
    } catch (error) {
        console.error('Error cancelling transport request:', error);
        if (error.code === 'ER_TRUNCATED_WRONG_VALUE' || error.code === 'WARN_DATA_TRUNCATED') {
            return res.status(503).json({
                message: 'Database is missing cancelled status support. Run backend/mysql-schema/alter-transport-requests-cancel.sql on MySQL.',
            });
        }
        res.status(500).json({ message: error.message || 'Failed to cancel request' });
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
        userType,
    });

    if (userType === 'employee') {
        const empReq = await EmployeeTransportRequest.findById(requestId);
        if (empReq) {
            empReq.status = 'approved';
            if (bus_id) empReq.bus_id = bus_id;
            empReq.application_number = application.application_number;
            empReq.application_serial = application.application_serial;
            empReq.application_college_code = application.college_code;
            empReq.application_course_code = application.course_code;
            await empReq.save();
        }
    } else {
        const queryConditions = [];
        if (!isNaN(requestId)) queryConditions.push({ id: Number(requestId) });
        if (isMongoId(requestId)) queryConditions.push({ _id: requestId });
        if (queryConditions.length === 0) queryConditions.push({ id: requestId });
        const query = queryConditions.length === 1 ? queryConditions[0] : { $or: queryConditions };
        const mongoReq = await TransportRequest.findOne(query);

        if (mongoReq) {
            mongoReq.status = 'approved';
            if (bus_id) mongoReq.bus_id = bus_id;
            mongoReq.application_number = application.application_number;
            mongoReq.application_serial = application.application_serial;
            mongoReq.application_college_code = application.college_code;
            mongoReq.application_course_code = application.course_code;
            await mongoReq.save();
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

    const queryConditions = [];
    if (!isNaN(requestId)) queryConditions.push({ id: Number(requestId) });
    if (isMongoId(requestId)) queryConditions.push({ _id: requestId });
    if (queryConditions.length === 0) queryConditions.push({ id: requestId });
    const query = queryConditions.length === 1 ? queryConditions[0] : { $or: queryConditions };
    const mongoReq = await TransportRequest.findOne(query);

    if (mongoReq) {
        if (semester_id != null) mongoReq.semester_id = semester_id;
        if (semester_start_date != null) mongoReq.semester_start_date = semester_start_date;
        // Dates are resolved dynamically from SQL; we set them to null in MongoDB to avoid stale data
        mongoReq.semester_end_date = null;
        mongoReq.expiry_date = null;
        if (academic_year_id != null) mongoReq.academic_year_id = academic_year_id;
        if (year_of_study != null) mongoReq.year_of_study = year_of_study;
        if (semester_number != null) mongoReq.semester_number = semester_number;
        await mongoReq.save();
    }
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

    const resolvedRaisedBy = req.user
        ? (req.user.employee_name || req.user.name || req.user.username || 'admin')
        : (raised_by || 'admin');

    let resolvedRaisedById = null;
    if (req.user) {
        if (req.user.emp_no && !isNaN(parseInt(req.user.emp_no, 10))) {
            resolvedRaisedById = parseInt(req.user.emp_no, 10);
        } else if (raised_by_id && !isNaN(parseInt(raised_by_id, 10))) {
            resolvedRaisedById = parseInt(raised_by_id, 10);
        } else {
            resolvedRaisedById = 1;
        }
    } else {
        resolvedRaisedById = parseInt(raised_by_id, 10) || null;
    }

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

        // Route-level capacity check: block early if ALL buses on this route are full
        // This prevents creating a dangling pending request that will fail at approval time
        if (route_id) {
            const routeBuses = await getBusesWithSeatsForRoute(route_id);
            if (routeBuses.length > 0) {
                const totalAvailable = routeBuses.reduce((sum, b) => sum + b.seatsAvailable, 0);
                if (totalAvailable <= 0) {
                    const busDetails = routeBuses.map(b => `${b.busNumber} (${b.seatsFilled}/${b.capacity})`).join(', ');
                    return res.status(409).json({
                        message: `All buses on this route are at full capacity. No seats available. Buses: ${busDetails}`,
                        routeFull: true,
                    });
                }
            }
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
                raised_by: resolvedRaisedBy,
                raised_by_id: resolvedRaisedById ? String(resolvedRaisedById) : null,
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

        const eligibility = await checkStudentRequestEligibility(admission_number, resolvedAcademicYear);
        if (!eligibility.ok) {
            return res.status(403).json({
                message: eligibility.message,
                eligibility,
            });
        }

        const yearOfStudy = studentRecord.current_year != null
            ? Number(studentRecord.current_year)
            : 1;

        let collegeCode = null;
        let courseCode = null;
        if (mysqlPool) {
            try {
                const context = await resolveApplicationNumberContext(mysqlPool, {
                    admissionNumber: admission_number,
                    userType: 'student',
                });
                collegeCode = context.collegeCode;
                courseCode = context.courseCode;
            } catch (err) {
                // Non-fatal
            }
        }

        const nextRequestId = await TransportRequest.getNextRequestId();

        const docData = {
            id: nextRequestId,
            admission_number,
            student_name,
            route_id,
            route_name,
            stage_name,
            fare: fare ? Number(fare) : 0,
            status: 'pending',
            raised_by: resolvedRaisedBy,
            raised_by_id: resolvedRaisedById ? String(resolvedRaisedById) : null,
            year_of_study: yearOfStudy,
            academic_year: resolvedAcademicYear,
        };

        const newReq = new TransportRequest(docData);
        await newReq.save();

        res.status(201).json({
            id: newReq.id || newReq._id.toString(),
            _id: newReq._id.toString(),
            admission_number: newReq.admission_number,
            student_name: newReq.student_name,
            route_id: newReq.route_id,
            route_name: newReq.route_name,
            stage_name: newReq.stage_name,
            fare: newReq.fare,
            status: newReq.status,
            academic_year: newReq.academic_year,
            request_date: newReq.request_date,
            year_of_study: newReq.year_of_study,
        });
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

        // Aggregate Student Transport Requests from MongoDB
        const studentMatch = { status: 'approved' };
        const liveOccupancy = String(req.query.occupancyMode || req.query.occupancy_mode || '').toLowerCase() === 'live';
        if (!liveOccupancy) {
            if (resolvedAcademicYear === fallbackAcademicYear) {
                studentMatch.$or = [
                    { academic_year: resolvedAcademicYear },
                    { academic_year: { $exists: false } },
                    { academic_year: null },
                    { academic_year: '' }
                ];
            } else {
                studentMatch.academic_year = resolvedAcademicYear;
            }
        } else {
            // Apply live occupancy expiration filter mirroring getBusesOverview
            const now = new Date();
            studentMatch.$or = [
                { expiry_date: { $gte: now } },
                {
                    $and: [
                        { $or: [{ expiry_date: null }, { expiry_date: { $exists: false } }] },
                        { semester_end_date: { $gte: now } }
                    ]
                },
                {
                    $and: [
                        { $or: [{ expiry_date: null }, { expiry_date: { $exists: false } }] },
                        { $or: [{ semester_end_date: null }, { semester_end_date: { $exists: false } }] }
                    ]
                }
            ];
        }

        if (filterByCampusRoutes) {
            if (campusRouteIds.length > 0) {
                studentMatch.route_id = { $in: campusRouteIds };
            } else {
                studentMatch.route_id = '__NONE__';
            }
        }

        const studentMongoTotal = await TransportRequest.countDocuments(studentMatch);
        totalPassengers += studentMongoTotal;

        const studentRouteRows = await TransportRequest.aggregate([
            { $match: studentMatch },
            { $group: { _id: { route_id: '$route_id', route_name: '$route_name' }, count: { $sum: 1 } } }
        ]);

        routeBreakdown = studentRouteRows.map(sr => ({
            route_id: sr._id.route_id,
            route_name: sr._id.route_name,
            count: sr.count
        }));

        const studentStageRows = await TransportRequest.aggregate([
            { $match: studentMatch },
            { $group: { _id: { route_id: '$route_id', route_name: '$route_name', stage_name: '$stage_name' }, count: { $sum: 1 } } }
        ]);

        stageBreakdown = studentStageRows.map(ss => ({
            route_id: ss._id.route_id,
            route_name: ss._id.route_name,
            stage_name: ss._id.stage_name,
            count: ss.count
        }));

        const approvedStudentDocs = await TransportRequest.find(studentMatch).select('admission_number').lean();
        const admNos = [...new Set(approvedStudentDocs.map(d => d.admission_number).filter(Boolean))];
        if (mysqlPool && admNos.length > 0) {
            const [studentCourseRows] = await mysqlPool.query(
                `SELECT course, COUNT(*) as count FROM students WHERE admission_number IN (?) OR admission_no IN (?) GROUP BY course`,
                [admNos, admNos]
            );
            courseBreakdown = studentCourseRows.map(c => ({ course: c.course || 'N/A', count: Number(c.count) }));
        }

        // Add MongoDB (Employee) Stats
        const mongoMatch = { status: 'approved' };
        if (!liveOccupancy) {
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
    const { admin_name, admin_id, academicYear: requestedAcademicYear } = req.body;

    try {
        if (isMongoId(id)) {
            const reqRow = await EmployeeTransportRequest.findById(id);
            if (!reqRow) {
                return res.status(404).json({ message: 'Transport request not found' });
            }
            const mismatch = getAcademicYearMismatchMessage(reqRow.academic_year, requestedAcademicYear);
            if (mismatch) {
                return res.status(400).json({ message: mismatch });
            }
            await EmployeeTransportRequest.findByIdAndDelete(id);
            return res.json({ message: 'Transport request deleted successfully' });
        }

        const studentReqQuery = { $or: [] };
        if (!Number.isNaN(Number(id))) studentReqQuery.$or.push({ id: Number(id) });
        if (isMongoId(id)) studentReqQuery.$or.push({ _id: id });

        if (studentReqQuery.$or.length > 0) {
            const studentReq = await TransportRequest.findOne(
                studentReqQuery.$or.length === 1 ? studentReqQuery.$or[0] : studentReqQuery
            );
            if (studentReq) {
                const requestAcademicYear = resolveRequestAcademicYear(studentReq, requestedAcademicYear);
                const mismatch = getAcademicYearMismatchMessage(studentReq.academic_year, requestedAcademicYear);
                if (mismatch) {
                    return res.status(400).json({ message: mismatch });
                }

                const admissionNumber = String(studentReq.admission_number || studentReq.admission_no || '');

                if (studentReq.status === 'approved' && admissionNumber) {
                    await deleteTransportFeesForRequest({
                        admissionNumber,
                        academicYear: requestAcademicYear,
                        yearOfStudy: studentReq.year_of_study,
                        semester: studentReq.semester_number,
                    });
                }

                const requestIdForAudit = studentReq.id != null ? String(studentReq.id) : String(studentReq._id);
                await TransportRequest.deleteOne({ _id: studentReq._id });

                if (mysqlPool) {
                    const auditDetails = JSON.stringify({
                        action: 'delete_transport_request',
                        student_id: admissionNumber,
                        admin_name,
                        status: studentReq.status,
                        academic_year: requestAcademicYear,
                    });
                    const adminIdForAudit = admin_id && !isNaN(parseInt(admin_id, 10)) ? parseInt(admin_id, 10) : null;
                    await mysqlPool.query(
                        'INSERT INTO audit_logs (action_type, entity_type, entity_id, admin_id, details) VALUES (?, ?, ?, ?, ?)',
                        ['FEE_DELETION', 'TRANSPORT_REQUEST', requestIdForAudit, adminIdForAudit, auditDetails]
                    );
                }

                const message = studentReq.status === 'approved'
                    ? 'Transport request and fees for this academic year deleted successfully'
                    : 'Transport request deleted successfully';
                return res.json({ message });
            }
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const [rows] = await mysqlPool.query('SELECT * FROM transport_requests WHERE id = ?', [id]);
        const request = rows[0];

        if (!request) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const requestAcademicYear = resolveRequestAcademicYear(request, requestedAcademicYear);
        const mismatch = getAcademicYearMismatchMessage(request.academic_year, requestedAcademicYear);
        if (mismatch) {
            return res.status(400).json({ message: mismatch });
        }

        const studentId = String(request.admission_number || request.admission_no);

        if (request.status === 'approved' && studentId) {
            await deleteTransportFeesForRequest({
                admissionNumber: studentId,
                academicYear: requestAcademicYear,
                yearOfStudy: request.year_of_study,
                semester: request.semester_number,
            });
        }

        // Delete MySQL Transport Request
        await mysqlPool.query('DELETE FROM transport_requests WHERE id = ?', [id]);

        // Log to audit logs in MySQL
        const auditDetails = JSON.stringify({
            action: 'delete_transport_request',
            student_id: studentId,
            admin_name,
            academic_year: requestAcademicYear,
        });

        // Only insert admin_id if it's a valid number (MySQL foreign key constraint)
        const adminIdForAudit = admin_id && !isNaN(parseInt(admin_id, 10)) ? parseInt(admin_id, 10) : null;

        await mysqlPool.query(
            'INSERT INTO audit_logs (action_type, entity_type, entity_id, admin_id, details) VALUES (?, ?, ?, ?, ?)',
            ['FEE_DELETION', 'TRANSPORT_REQUEST', String(id), adminIdForAudit, auditDetails]
        );

        const message = request.status === 'approved'
            ? 'Transport request and fees for this academic year deleted successfully'
            : 'Transport request deleted successfully';
        res.json({ message });

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

        // Fetch Approved Student Passengers from MongoDB
        const studentQuery = { status: 'approved' };
        if (q) {
            studentQuery.$or = [
                { student_name: { $regex: q, $options: 'i' } },
                { admission_number: { $regex: q, $options: 'i' } }
            ];
        }

        const studentDocs = await TransportRequest.find(studentQuery).limit(50).lean();
        const admissionNos = [...new Set(studentDocs.map(r => r.admission_number).filter(Boolean))];
        let studentMap = {};
        if (mysqlPool && admissionNos.length > 0) {
            const [studentRows] = await mysqlPool.query(
                `SELECT admission_number, admission_no, course, branch, pin_no FROM students WHERE admission_number IN (?) OR admission_no IN (?)`,
                [admissionNos, admissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap[s.admission_number] = s;
                if (s.admission_no) studentMap[s.admission_no] = s;
            }
        }

        const formattedStudents = studentDocs.map(r => {
            const student = (r.admission_number && studentMap[r.admission_number]) || {};
            return {
                ...r,
                id: r.id != null ? r.id : String(r._id),
                _id: String(r._id),
                user_type: 'student',
                course: student.course || 'N/A',
                branch: student.branch || 'N/A',
                pin_no: student.pin_no || 'N/A',
            };
        });

        res.json(formattedStudents);
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
            // Student route change via MongoDB TransportRequest
            const studentQuery = { admission_number: admission_number, status: 'approved' };
            if (resolvedAcademicYear) studentQuery.academic_year = resolvedAcademicYear;
            let mongoStudentReq = await TransportRequest.findOne(studentQuery).lean();
            if (!mongoStudentReq) {
                mongoStudentReq = await TransportRequest.findOne({ admission_number: admission_number, status: 'approved' }).sort({ request_date: -1 }).lean();
            }

            if (mongoStudentReq) {
                currentRequest = mongoStudentReq;
            } else if (mysqlPool) {
                let currentRows;
                if (resolvedAcademicYear) {
                    [currentRows] = await mysqlPool.query(
                        'SELECT * FROM transport_requests WHERE admission_number = ? AND status = "approved" AND COALESCE(academic_year, ?) = ? ORDER BY id DESC LIMIT 1',
                        [admission_number, resolvedAcademicYear, resolvedAcademicYear]
                    );
                }
                if (!currentRows || !currentRows[0]) {
                    [currentRows] = await mysqlPool.query(
                        'SELECT * FROM transport_requests WHERE admission_number = ? AND status = "approved" ORDER BY id DESC LIMIT 1',
                        [admission_number]
                    );
                }
                currentRequest = currentRows[0];
            }

            if (!currentRequest) {
                return res.status(404).json({ message: 'No approved transport request found for this student.' });
            }

            oldFare = currentRequest.fare || 0;
            fareDiff = new_fare - oldFare;

            // Compute concession-aware fare difference if overall concessions are configured
            try {
                const { getFeePortalModels } = require('../models/fee-portal-models');
                const feeModels = getFeePortalModels();
                if (feeModels && mysqlPool) {
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

            if (currentRequest._id) {
                await TransportRequest.updateOne({ _id: currentRequest._id }, {
                    $set: {
                        route_id: new_route_id,
                        route_name: new_route_name,
                        stage_name: new_stage_name,
                        fare: new_fare,
                        updated_at: new Date()
                    }
                });
            } else if (mysqlPool && currentRequest.id) {
                await mysqlPool.query(
                    'UPDATE transport_requests SET route_id = ?, route_name = ?, stage_name = ?, fare = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
                    [new_route_id, new_route_name, new_stage_name, new_fare, currentRequest.id]
                );
            }
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

        // Log to audit logs - Allow NULL admin_id if it's not a valid reference
        const auditDetails = JSON.stringify({
            action: 'route_change',
            admission_number,
            old_route: currentRequest.route_name,
            old_stage: currentRequest.stage_name,
            new_route: new_route_name,
            new_stage: new_stage_name,
            fare_diff: fareDiff,
            admin_name: admin_name
        });

        // Only insert admin_id if it's a valid number (MySQL foreign key constraint)
        const adminIdForAudit = admin_id && !isNaN(parseInt(admin_id, 10)) ? parseInt(admin_id, 10) : null;

        await mysqlPool.query(
            'INSERT INTO audit_logs (action_type, entity_type, entity_id, admin_id, details) VALUES (?, ?, ?, ?, ?)',
            ['ROUTE_CHANGE', 'TRANSPORT_REQUEST', String(currentRequest.id), adminIdForAudit, auditDetails]
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
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;

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

        // Build MongoDB query for student transport requests
        const studentQuery = {
            status: 'approved',
            application_number: { $ne: null },
            application_serial: { $ne: null },
            $or: [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ],
        };
        if (startDate || endDate) {
            const dateRange = {};
            if (startDate) dateRange.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            if (endDate) dateRange.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            studentQuery.request_date = dateRange;
        }
        if (collegeCode) studentQuery.application_college_code = collegeCode;
        if (courseCode) studentQuery.application_course_code = courseCode;

        if (hasCollegeRestriction) {
            studentQuery.application_college_code = { $in: allowedCollegeCodes };
        }
        if (hasCourseRestriction) {
            studentQuery.application_course_code = { $in: allowedCourseCodes };
        }

        const studentMongoRows = await TransportRequest.find(studentQuery).lean();

        const studentApplications = studentMongoRows
            .filter((r) => (r.academic_year || fallbackAcademicYear) === academicYear)
            .map((r) => ({
                id: r.id != null ? r.id : r._id.toString(),
                application_number: r.application_number,
                application_serial: Number(r.application_serial),
                college_code: r.application_college_code,
                course_code: r.application_course_code,
                student_name: r.student_name,
                admission_number: r.admission_number,
                user_type: 'student',
            }));

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
        if (startDate || endDate) {
            const dateRange = {};
            if (startDate) dateRange.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            if (endDate) dateRange.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            mongoQuery.request_date = dateRange;
        }
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
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;

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

        // Build MongoDB query for student transport requests
        const studentQuery = {
            status: 'approved',
            application_serial: { $gte: fromSerial, $lte: toSerial },
            $or: [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ],
        };
        if (startDate || endDate) {
            const dateRange = {};
            if (startDate) dateRange.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            if (endDate) dateRange.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            studentQuery.request_date = dateRange;
        }
        if (collegeCode) studentQuery.application_college_code = collegeCode;
        if (courseCode) studentQuery.application_course_code = courseCode;

        if (hasCollegeRestriction) {
            studentQuery.application_college_code = { $in: allowedCollegeCodes };
        }
        if (hasCourseRestriction) {
            studentQuery.application_course_code = { $in: allowedCourseCodes };
        }

        const studentMongoRows = await TransportRequest.find(studentQuery).lean();
        const filteredStudentMongoRows = studentMongoRows.filter((r) => (r.academic_year || fallbackAcademicYear) === academicYear);

        const studentAdmissionNos = [...new Set(filteredStudentMongoRows.map(r => r.admission_number).filter(Boolean))];
        let studentMap = {};
        if (mysqlPool && studentAdmissionNos.length > 0) {
            const [studentRows] = await mysqlPool.query(
                `SELECT admission_number, admission_no, course, branch, student_photo, student_data, pin_no, college
                 FROM students
                 WHERE admission_number IN (?) OR admission_no IN (?)`,
                [studentAdmissionNos, studentAdmissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap[s.admission_number] = s;
                if (s.admission_no) studentMap[s.admission_no] = s;
            }
        }

        const studentPassengers = filteredStudentMongoRows.map((r) => {
            const student = (r.admission_number && studentMap[r.admission_number]) || {};
            const combinedRow = {
                ...r,
                id: r.id != null ? r.id : String(r._id),
                _id: String(r._id),
                user_type: 'student',
                course: student.course || 'N/A',
                branch: student.branch || 'N/A',
                student_photo: student.student_photo || null,
                student_data: student.student_data || null,
                pin_no: student.pin_no || 'N/A',
            };
            return {
                ...combinedRow,
                student_photo: resolveStudentPhoto(combinedRow),
            };
        });

        const mongoQuery = {
            status: 'approved',
            application_serial: { $gte: fromSerial, $lte: toSerial },
            $or: [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ],
        };
        if (startDate || endDate) {
            const dateRange = {};
            if (startDate) dateRange.$gte = new Date(new Date(startDate).setHours(0, 0, 0, 0));
            if (endDate) dateRange.$lte = new Date(new Date(endDate).setHours(23, 59, 59, 999));
            mongoQuery.request_date = dateRange;
        }
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

        const filteredMongoRows = mongoRows.filter((r) => (r.academic_year || fallbackAcademicYear) === academicYear);
        const empNos = [...new Set(filteredMongoRows.map(r => r.emp_no).filter(Boolean))];
        let employeePhotoMap = {};
        if (empNos.length > 0) {
            try {
                const Employee = getEmployeeModel();
                if (Employee) {
                    const empDocs = await Employee.find({ emp_no: { $in: empNos } }, 'emp_no profilePhoto').lean();
                    for (const emp of empDocs) {
                        if (emp.emp_no && emp.profilePhoto) {
                            employeePhotoMap[emp.emp_no] = emp.profilePhoto;
                        }
                    }
                }
            } catch (err) {
                console.error('Error fetching employee photos in batch:', err.message);
            }
        }

        const employeePassengers = filteredMongoRows.map((r) => ({
            ...r,
            id: r._id.toString(),
            admission_number: r.emp_no,
            student_name: r.employee_name,
            user_type: 'employee',
            course: 'Employee',
            student_photo: r.emp_no ? (employeePhotoMap[r.emp_no] || null) : null,
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
    cancelTransportRequest,
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
    triggerStaffExpiry,
    getAttendanceRecords,
    getStudentAttendanceDetails,
};

// @route   GET /api/transport-requests/attendance
// @access  Private
async function getAttendanceRecords(req, res) {
    try {
        const academicYear = resolveAcademicYear(req.query);
        const { startDate, endDate, course, route, search } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate parameters are required.' });
        }

        const isSuperAdmin = req.user && req.user.roles && req.user.roles.includes('superadmin');
        const hasCourseRestriction = req.user && !isSuperAdmin && req.user.courses && req.user.courses.length > 0;

        const restrictedColleges = await getRestrictedCollegesForUser(req.user, req.query.campus);
        const hasCollegeRestriction = restrictedColleges !== null;

        let allowedCollegeCodes = [];
        if (hasCollegeRestriction && mysqlPool) {
            const [rows] = await mysqlPool.query('SELECT code FROM colleges WHERE name IN (?)', [restrictedColleges.length > 0 ? restrictedColleges : ['']]);
            allowedCollegeCodes = rows.map(r => formatApplicationCode(r.code));
        }

        let allowedCourseCodes = [];
        if (hasCourseRestriction && mysqlPool) {
            const [rows] = await mysqlPool.query('SELECT code FROM courses WHERE name IN (?)', [req.user.courses]);
            allowedCourseCodes = rows.map(r => formatApplicationCode(r.code));
        }

        // Build MongoDB query for student transport requests
        const studentQuery = { status: 'approved' };
        if (academicYear) {
            studentQuery.academic_year = academicYear;
        }
        if (route) {
            studentQuery.$or = [
                { route_name: route },
                { route_id: route }
            ];
        }
        if (hasCollegeRestriction) {
            studentQuery.application_college_code = { $in: allowedCollegeCodes };
        }
        if (hasCourseRestriction) {
            studentQuery.application_course_code = { $in: allowedCourseCodes };
        }

        const studentDocs = await TransportRequest.find(studentQuery).lean();
        const admissionNos = [...new Set(studentDocs.map(r => r.admission_number).filter(Boolean))];

        let studentMap = {};
        if (mysqlPool && admissionNos.length > 0) {
            const [studentRows] = await mysqlPool.query(
                `SELECT admission_number, admission_no, course, branch, student_name FROM students WHERE admission_number IN (?) OR admission_no IN (?)`,
                [admissionNos, admissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap[s.admission_number] = s;
                if (s.admission_no) studentMap[s.admission_no] = s;
            }
        }

        let attendanceMap = {};
        if (mysqlPool && admissionNos.length > 0) {
            const [attendanceRows] = await mysqlPool.query(
                `SELECT admission_number, attendance_date, status, remarks, holiday_reason FROM attendance_records WHERE attendance_date BETWEEN ? AND ? AND (admission_number IN (?))`,
                [startDate, endDate, admissionNos]
            );
            for (const row of attendanceRows) {
                const adm = row.admission_number;
                if (!attendanceMap[adm]) {
                    attendanceMap[adm] = [];
                }
                attendanceMap[adm].push(row);
            }
        }

        const summary = studentDocs.map(doc => {
            const adm = doc.admission_number;
            const mysqlStudent = studentMap[adm] || {};
            const records = attendanceMap[adm] || [];

            const present_days = records.filter(r => r.status === 'present').length;
            const absent_days = records.filter(r => r.status === 'absent').length;
            const holiday_days = records.filter(r => r.status === 'holiday').length;
            const total_days = records.length;

            const presentAndAbsent = present_days + absent_days;
            const attendance_percentage = presentAndAbsent > 0
                ? Number(((present_days / presentAndAbsent) * 100).toFixed(2))
                : 0;

            return {
                admission_number: adm,
                student_name: doc.student_name || mysqlStudent.student_name || 'N/A',
                course: mysqlStudent.course || doc.application_course_code || 'N/A',
                branch: mysqlStudent.branch || 'N/A',
                route_name: doc.route_name || 'N/A',
                stage_name: doc.stage_name || 'N/A',
                total_days,
                present_days,
                absent_days,
                holiday_days,
                attendance_percentage
            };
        });

        let filteredSummary = summary;
        if (course) {
            filteredSummary = filteredSummary.filter(item =>
                String(item.course).toLowerCase().includes(course.toLowerCase())
            );
        }
        if (search) {
            const queryLower = search.toLowerCase();
            filteredSummary = filteredSummary.filter(item =>
                String(item.student_name).toLowerCase().includes(queryLower) ||
                String(item.admission_number).toLowerCase().includes(queryLower)
            );
        }

        return res.json({ summary: filteredSummary });
    } catch (err) {
        console.error('getAttendanceRecords error:', err);
        return res.status(500).json({ message: 'Failed to load attendance summary records.' });
    }
}

// @route   GET /api/transport-requests/attendance/:admission_number
// @access  Private
async function getStudentAttendanceDetails(req, res) {
    try {
        const { admission_number } = req.params;
        const { startDate, endDate } = req.query;

        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'startDate and endDate parameters are required.' });
        }

        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established.' });
        }

        const [rows] = await mysqlPool.query(
            `SELECT attendance_date, status, remarks, holiday_reason FROM attendance_records WHERE admission_number = ? AND attendance_date BETWEEN ? AND ? ORDER BY attendance_date ASC`,
            [admission_number, startDate, endDate]
        );

        return res.json({
            admission_number,
            records: rows.map(r => ({
                attendance_date: r.attendance_date,
                status: r.status,
                remarks: r.remarks || '',
                holiday_reason: r.holiday_reason || ''
            }))
        });
    } catch (error) {
        console.error('getStudentAttendanceDetails error:', error);
        return res.status(500).json({ message: 'Failed to fetch student attendance details.' });
    }
}

// ── Manual Admin Trigger: Staff Transport Expiry ──────────────────────────────
// @route   POST /api/transport-requests/expire-staff-requests
// @access  Private/Admin
// Allows an administrator to manually trigger the staff expiry check
// without waiting for the nightly cron job.
async function triggerStaffExpiry(req, res) {
    try {
        const { expireStaffTransportRequests } = require('../jobs/expireStaffTransportRequests');
        const summary = await expireStaffTransportRequests();
        return res.json({
            message: `Staff expiry check completed. ${summary.expired} request(s) were expired.`,
            scanned: summary.scanned,
            expired: summary.expired,
            skipped: summary.skipped,
            leftEmployees: summary.leftEmployees,
        });
    } catch (err) {
        console.error('triggerStaffExpiry error:', err);
        return res.status(500).json({ message: 'Failed to run staff expiry check.' });
    }
}
