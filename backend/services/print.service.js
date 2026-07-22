const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const mongoose = require('mongoose');
const QRCode = require('qrcode');

const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const TransportRequest = require('../models/TransportRequest');
const Bus = require('../models/Bus');
const OtherVehicle = require('../models/OtherVehicle');
const Route = require('../models/Route');
const InventoryAllocation = require('../models/InventoryAllocation');
const MaintenanceBill = require('../models/MaintenanceBill');
const Vendor = require('../models/Vendor');
const { mysqlPool } = require('../config/db');
const { resolveStudentPhoto } = require('../utils/studentPhoto');
const campusService = require('./campusService');

// Pre-load logo to inline as Base64 to handle cross-origin printing
const logoPath = path.join(__dirname, '../../frontend/public/PYDAH_LOGO_PHOTO.jpg');
let logoBase64 = '';
if (fs.existsSync(logoPath)) {
    const fileBuffer = fs.readFileSync(logoPath);
    logoBase64 = `data:image/jpeg;base64,${fileBuffer.toString('base64')}`;
}

const componentCache = new Map();

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    if (month >= 5) {
        return `${year}-${year + 1}`;
    }
    return `${year - 1}-${year}`;
}

function getActivePassengerSqlParts(fallbackAcademicYear) {
    return require('../controllers/transportRequestController').getActivePassengerSqlParts(fallbackAcademicYear);
}

async function getCampusRouteFilter(campusId) {
    const queryCampusId = campusService.normalizeCampusId(campusId);
    if (queryCampusId === null) return null;

    const campusRoutes = await Route.find({ campus: queryCampusId }).select('routeId').lean();
    const routeIds = campusRoutes.map((route) => route.routeId);
    if (routeIds.length === 0) {
        return { routeIds: [], sqlClause: ' AND 1=0', params: [] };
    }

    return {
        routeIds,
        sqlClause: ` AND tr.route_id IN (${routeIds.map(() => '?').join(',')})`,
        params: routeIds,
    };
}

// Map template names to their frontend source file paths
const TEMPLATE_PATHS = {
    'transport-admit': path.join(__dirname, '../../frontend/src/components/TransportAdmitCard.jsx'),
    'transport-bus-idcard-sheet': path.join(__dirname, '../../frontend/src/components/TransportBusIdCardSheet.jsx'),
    'passenger-report': path.join(__dirname, '../../frontend/src/components/PassengerReport.jsx'),
    'bill-print': path.join(__dirname, '../../frontend/src/components/BillPrint.jsx')
};

/**
 * On-the-fly ESM/JSX transpiler & bundler using esbuild
 */
function getTranspiledComponent(filePath) {
    if (!fs.existsSync(filePath)) {
        throw new Error(`Component file does not exist: ${filePath}`);
    }

    const mtimeMs = fs.statSync(filePath).mtimeMs;
    const cached = componentCache.get(filePath);
    if (cached && cached.mtimeMs === mtimeMs) {
        return cached.component;
    }
    
    const result = esbuild.buildSync({
        entryPoints: [filePath],
        bundle: true,
        write: false,
        format: 'cjs',
        platform: 'node',
        external: ['react', 'react-dom'],
        define: {
            'import.meta.env': 'process.env'
        }
    });

    const code = result.outputFiles[0].text;
    const m = new module.constructor();
    m.paths = module.paths;
    m._compile(code, filePath);
    
    const component = m.exports.default || m.exports;
    componentCache.set(filePath, { component, mtimeMs });
    return component;
}

/**
 * Fetch data for Transport Admit Card
 */
const fetchAdmitCardData = async (data) => {
    const id = data.studentId || data.requestId || data.admissionNumber || data.passengerId;
    if (!id) {
        const error = new Error('Missing studentId, admissionNumber, or requestId in data');
        error.statusCode = 400;
        throw error;
    }

    const isMongoId = mongoose.Types.ObjectId.isValid(id)
        && String(new mongoose.Types.ObjectId(id)) === String(id);
    if (isMongoId) {
        const reqRow = await EmployeeTransportRequest.findById(id).lean();
        if (reqRow) {
            return {
                ...reqRow,
                id: reqRow._id.toString(),
                admission_number: reqRow.emp_no,
                student_name: reqRow.employee_name,
                user_type: 'employee',
                course: 'Employee'
            };
        }
    }

    return fetchStudentTransportPrintData(id);
};

const isMongoId = (val) => Boolean(val) && mongoose.Types.ObjectId.isValid(val) && String(new mongoose.Types.ObjectId(val)) === String(val);

const fetchStudentTransportPrintData = async (id) => {
    let mongoReq = null;
    if (isMongoId(id)) {
        mongoReq = await TransportRequest.findById(id).lean();
    }
    if (!mongoReq && !isNaN(id)) {
        mongoReq = await TransportRequest.findOne({ id: Number(id) }).lean();
    }
    if (!mongoReq) {
        mongoReq = await TransportRequest.findOne({ admission_number: String(id) })
            .sort({ request_date: -1 })
            .lean();
    }

    if (mongoReq) {
        let studentInfo = {};
        const admNo = mongoReq.admission_number;
        if (mysqlPool && admNo) {
            const [rows] = await mysqlPool.query(
                `SELECT current_year, course, branch, student_photo, student_data, pin_no, student_mobile, parent_mobile1, student_address, father_name
                 FROM students
                 WHERE admission_number = ? OR admission_no = ?
                 LIMIT 1`,
                [admNo, admNo]
            );
            studentInfo = rows[0] || {};
        }

        const combinedRow = {
            ...mongoReq,
            id: mongoReq.id != null ? mongoReq.id : String(mongoReq._id),
            _id: String(mongoReq._id),
            year_of_study: mongoReq.year_of_study || studentInfo.current_year || 1,
            course: studentInfo.course || 'N/A',
            branch: studentInfo.branch || 'N/A',
            student_photo: studentInfo.student_photo || null,
            student_data: studentInfo.student_data || null,
            pin_no: studentInfo.pin_no || 'N/A',
            student_mobile: studentInfo.student_mobile || null,
            parent_mobile1: studentInfo.parent_mobile1 || null,
            student_address: studentInfo.student_address || null,
            father_name: studentInfo.father_name || null,
            user_type: 'student',
        };

        return {
            ...combinedRow,
            student_photo: resolveStudentPhoto(combinedRow),
        };
    }

    if (!mysqlPool) {
        const error = new Error(`Transport record not found for student/request ID: ${id}`);
        error.statusCode = 404;
        throw error;
    }

    let query = `
        SELECT tr.*, 
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
        WHERE tr.id = ?
    `;
    let [rows] = await mysqlPool.query(query, [id]);

    if (!rows[0]) {
        query = `
            SELECT tr.*, 
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
            WHERE tr.admission_number = ?
            ORDER BY tr.request_date DESC, tr.id DESC
            LIMIT 1
        `;
        [rows] = await mysqlPool.query(query, [id]);
    }

    if (!rows[0]) {
        const error = new Error(`Transport record not found for student/request ID: ${id}`);
        error.statusCode = 404;
        throw error;
    }

    const row = rows[0];
    return {
        ...row,
        student_photo: resolveStudentPhoto(row),
        user_type: 'student',
    };
};

/**
 * Helper to fetch active passengers for a bus
 */
const fetchBusPassengers = async (busNumber, academicYear, liveOccupancy = true, campusId) => {
    const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const resolvedYear = academicYear || fallbackAcademicYear;
    let mysqlPassengers = [];
    const campusFilter = await getCampusRouteFilter(campusId);

    // Look up the bus to retrieve its assignedRouteId
    const busDoc = await Bus.findOne({ busNumber }).lean();
    const assignedRouteId = busDoc?.assignedRouteId;

    const passengerQuery = assignedRouteId
        ? { route_id: assignedRouteId, status: 'approved' }
        : { bus_id: busNumber, status: 'approved' };

    const studentMongoRequests = await TransportRequest.find(passengerQuery).lean();
    const filteredStudentRequests = studentMongoRequests.filter((r) => (
        liveOccupancy ? true : (r.academic_year || fallbackAcademicYear) === resolvedYear
    ));

    const admissionNos = [...new Set(filteredStudentRequests.map(r => r.admission_number).filter(Boolean))];
    let studentMap = {};
    if (mysqlPool && admissionNos.length > 0) {
        const [studentRows] = await mysqlPool.query(
            `SELECT admission_number, admission_no, course, branch, student_photo, student_data, pin_no
             FROM students
             WHERE admission_number IN (?) OR admission_no IN (?)`,
            [admissionNos, admissionNos]
        );
        for (const s of studentRows) {
            if (s.admission_number) studentMap[s.admission_number] = s;
            if (s.admission_no) studentMap[s.admission_no] = s;
        }
    }

    const now = new Date();
    mysqlPassengers = filteredStudentRequests.map((r) => {
        const student = (r.admission_number && studentMap[r.admission_number]) || {};
        let isExpired = false;
        if (r.expiry_date) {
            isExpired = new Date(r.expiry_date) < now;
        } else if (r.semester_end_date) {
            isExpired = new Date(r.semester_end_date) < now;
        }
        const combinedRow = {
            ...r,
            id: r.id != null ? r.id : String(r._id),
            user_type: 'student',
            course: student.course || 'N/A',
            branch: student.branch || 'N/A',
            student_photo: student.student_photo || null,
            student_data: student.student_data || null,
            pin_no: student.pin_no || 'N/A',
            is_expired: isExpired,
        };
        return {
            ...combinedRow,
            student_photo: resolveStudentPhoto(combinedRow),
        };
    });

    const mongoQuery = assignedRouteId
        ? { route_id: assignedRouteId, status: 'approved' }
        : { bus_id: busNumber, status: 'approved' };
    if (!liveOccupancy) {
        mongoQuery.$or = [
            { academic_year: resolvedYear },
            { academic_year: null },
            { academic_year: { $exists: false } },
        ];
    }
    if (campusFilter) {
        mongoQuery.route_id = { $in: campusFilter.routeIds };
    }
    const mongoRequests = await EmployeeTransportRequest.find(mongoQuery).lean();
    const mongoPassengers = mongoRequests.map((r) => ({
        ...r,
        id: r._id.toString(),
        admission_number: r.emp_no,
        student_name: r.employee_name,
        user_type: 'employee',
        course: 'Employee',
    }));

    const activePassengers = liveOccupancy
        ? mysqlPassengers.filter((p) => !p.is_expired)
        : mysqlPassengers;
    return [...activePassengers, ...mongoPassengers];
};

/**
 * Fetch data for ID Cards Sheet
 */
const fetchIdCardSheetData = async (data) => {
    const ids = data.studentIds || data.requestIds || [];
    const academicYear = data.academicYear || process.env.CURRENT_ACADEMIC_YEAR || '2025-2026';
    
    let passengers = [];

    if (ids.length > 0) {
        for (const id of ids) {
            try {
                const passenger = await fetchAdmitCardData({ requestId: id });
                passengers.push(passenger);
            } catch (err) {
                console.error(`Error fetching ID card data for ID ${id}:`, err.message);
            }
        }
    } else if (data.busId) {
        passengers = await fetchBusPassengers(data.busId, data.academicYear, true);
    } else {
        const error = new Error('Missing studentIds, requestIds, or busId in data');
        error.statusCode = 400;
        throw error;
    }

    if (passengers.length === 0) {
        const error = new Error('No valid passenger records found for ID card generation');
        error.statusCode = 404;
        throw error;
    }

    // Attach QR codes
    const verifyBase = process.env.CRM_BACKEND_URL || '';
    for (const passenger of passengers) {
        const pid = passenger.id || passenger._id;
        const verifyUrl = `${verifyBase}/verify-transport/${encodeURIComponent(pid)}`;
        try {
            passenger.qrDataUrl = await QRCode.toDataURL(verifyUrl, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 256,
                color: { dark: '#000000', light: '#ffffff' }
            });
        } catch (qrErr) {
            console.error('QR code generation failed:', qrErr.message);
            passenger.qrDataUrl = '';
        }
    }

    return {
        passengers,
        academicYear,
        cardsPerPage: data.cardsPerPage || 6,
        padToFullPage: data.padToFullPage !== undefined ? data.padToFullPage : false
    };
};

/**
 * Fetch data for Passenger Report
 */
const fetchPassengerReportData = async (data) => {
    let passengers = [];
    const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
    const academicYear = data.academicYear || fallbackAcademicYear;
    const status = data.status || 'approved';
    const activeOnly = status === 'active';
    const campusFilter = await getCampusRouteFilter(data.campus);

    if (data.requestIds && data.requestIds.length > 0) {
        const ids = data.requestIds;
        const mysqlIds = ids.filter(id => !isNaN(Number(id))).map(Number);
        const mongoIds = ids.filter(id => typeof id === 'string' && isNaN(Number(id)));

        if (mysqlIds.length > 0 && mysqlPool) {
            const query = `
                SELECT tr.*, 
                       COALESCE(tr.year_of_study, s1.current_year, s2.current_year) as year_of_study,
                       COALESCE(s1.course, s2.course) as course,
                       COALESCE(s1.branch, s2.branch) as branch,
                       COALESCE(s1.student_photo, s2.student_photo) as student_photo,
                       COALESCE(s1.student_data, s2.student_data) as student_data,
                       COALESCE(s1.pin_no, s2.pin_no) as pin_no
                FROM transport_requests tr 
                LEFT JOIN students s1 ON tr.admission_number = s1.admission_number 
                LEFT JOIN students s2 ON tr.admission_number = s2.admission_no AND s1.id IS NULL
                WHERE tr.id IN (${mysqlIds.map(() => '?').join(',')})
            `;
            const [rows] = await mysqlPool.query(query, mysqlIds);
            passengers = (rows || []).map((r) => ({
                ...r,
                id: r.id,
                student_photo: resolveStudentPhoto(r),
                user_type: 'student',
            }));
        }

        if (mongoIds.length > 0) {
            const mongoRequests = await EmployeeTransportRequest.find({ _id: { $in: mongoIds } }).lean();
            const mongoPassengers = mongoRequests.map((r) => ({
                ...r,
                id: r._id.toString(),
                admission_number: r.emp_no,
                student_name: r.employee_name,
                user_type: 'employee',
                course: 'Employee',
            }));
            passengers = [...passengers, ...mongoPassengers];
        }
    } else if (data.busId) {
        passengers = await fetchBusPassengers(data.busId, academicYear, activeOnly, data.campus);
    } else {
        const studentMongoRequests = await TransportRequest.find({ status: 'approved' }).lean();
    const filteredStudentRequests = studentMongoRequests.filter((r) => (
        activeOnly ? true : (r.academic_year || fallbackAcademicYear) === academicYear
    ));

    const admissionNos = [...new Set(filteredStudentRequests.map(r => r.admission_number).filter(Boolean))];
    let studentMap = {};
    if (mysqlPool && admissionNos.length > 0) {
        const [studentRows] = await mysqlPool.query(
            `SELECT admission_number, admission_no, course, branch, student_photo, student_data, pin_no
             FROM students
             WHERE admission_number IN (?) OR admission_no IN (?)`,
            [admissionNos, admissionNos]
        );
        for (const s of studentRows) {
            if (s.admission_number) studentMap[s.admission_number] = s;
            if (s.admission_no) studentMap[s.admission_no] = s;
        }
    }

    const now = new Date();
    passengers = filteredStudentRequests.map((r) => {
        const student = (r.admission_number && studentMap[r.admission_number]) || {};
        let isExpired = false;
        if (r.expiry_date) {
            isExpired = new Date(r.expiry_date) < now;
        } else if (r.semester_end_date) {
            isExpired = new Date(r.semester_end_date) < now;
        }
        const combinedRow = {
            ...r,
            id: r.id != null ? r.id : String(r._id),
            user_type: 'student',
            course: student.course || 'N/A',
            branch: student.branch || 'N/A',
            student_photo: student.student_photo || null,
            student_data: student.student_data || null,
            pin_no: student.pin_no || 'N/A',
            is_expired: isExpired,
        };
        return {
            ...combinedRow,
            student_photo: resolveStudentPhoto(combinedRow),
        };
    });

        if (activeOnly) {
            passengers = passengers.filter((p) => !p.is_expired);
        }

        const mongoQuery = { status: 'approved' };
        if (!activeOnly) {
            mongoQuery.$or = [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ];
        }
        if (campusFilter) {
            mongoQuery.route_id = { $in: campusFilter.routeIds };
        }
        const mongoRequests = await EmployeeTransportRequest.find(mongoQuery).lean();
        const mongoPassengers = mongoRequests.map((r) => ({
            ...r,
            id: r._id.toString(),
            admission_number: r.emp_no,
            student_name: r.employee_name,
            user_type: 'employee',
            course: 'Employee',
        }));

        passengers = [...passengers, ...mongoPassengers];
    }
    
    // Sort passengers by stage_name and student_name
    passengers.sort((a, b) => {
        const stageA = a.stage_name || '';
        const stageB = b.stage_name || '';
        const nameA = a.student_name || '';
        const nameB = b.student_name || '';
        return stageA.localeCompare(stageB) || nameA.localeCompare(nameB);
    });
    
    return {
        passengers,
        includeAbstract: Boolean(data.includeAbstract),
        includeDetailed: data.includeDetailed !== false,
        occupancyMode: data.occupancyMode === 'academicYear' ? 'academicYear' : 'live',
        academicYear: academicYear,
        campusName: data.campusName || '',
        isRequestsReport: Boolean(data.isRequestsReport),
    };
};

/**
 * Fetch data for Bill/Invoice printing
 */
const fetchBillPrintData = async (data) => {
    const billNo = data.billNo || data.receiptId;
    const billId = data.billId || data._id;
    if (!billNo && !billId) {
        const error = new Error('Missing billNo in data');
        error.statusCode = 400;
        throw error;
    }

    let maintenanceBill = null;
    if (billId) {
        maintenanceBill = await MaintenanceBill.findById(billId)
            .populate('lines.itemId')
            .populate('vendorId')
            .populate('busId')
            .lean();
    }
    if (!maintenanceBill && billNo) {
        maintenanceBill = await MaintenanceBill.findOne({ billNo })
            .sort({ updatedAt: -1 })
            .populate('lines.itemId')
            .populate('vendorId')
            .populate('busId')
            .lean();
    }

    if (maintenanceBill) {
        const vendor = maintenanceBill.vendorId || null;
        const vehicle = maintenanceBill.busId || null;
        const items = (maintenanceBill.lines || []).map((line) => ({
            ...line,
            price: line.pricingMode === 'lumpSum'
                ? (line.quantity > 0 ? line.amount / line.quantity : line.amount)
                : line.unitPrice,
            itemId: line.itemId
        }));

        return {
            billData: {
                ...maintenanceBill,
                items,
                date: maintenanceBill.date,
                adminName: maintenanceBill.adminName || 'Admin',
                subtotal: maintenanceBill.subtotal,
                gstTotal: maintenanceBill.taxTotal,
                taxTotal: maintenanceBill.taxTotal,
                discountTotal: maintenanceBill.discountTotal,
                totalAmount: maintenanceBill.grandTotal,
                vendorId: vendor,
                busId: vehicle
            },
            vendor,
            bus: vehicle
        };
    }

    // Legacy fallback: allocations sharing billNo
    const allocations = await InventoryAllocation.find({ billNo })
        .populate('itemId')
        .lean();

    if (allocations.length === 0) {
        const error = new Error(`No allocations found for bill number ${billNo}`);
        error.statusCode = 404;
        throw error;
    }

    const first = allocations[0];
    const vendorId = data.vendorId || first.vendorId;
    const busId = data.busId || first.busId;

    const vendor = await Vendor.findById(vendorId).lean();
    
    let vehicle = await Bus.findById(busId).lean();
    if (!vehicle) {
        vehicle = await OtherVehicle.findById(busId).lean();
    }
    if (!vehicle && typeof busId === 'string') {
        vehicle = await Bus.findOne({ busNumber: busId }).lean();
    }
    if (!vehicle && typeof busId === 'string') {
        vehicle = await OtherVehicle.findOne({ vehicleNumber: busId }).lean();
    }

    const totals = allocations.reduce((acc, item) => {
        const subtotal = (item.quantity || 0) * (item.price || 0);
        const gstAmount = subtotal * ((item.gstPercent || 0) / 100);
        acc.subtotal += subtotal;
        acc.gstTotal += gstAmount;
        acc.grandTotal += subtotal + gstAmount;
        return acc;
    }, { subtotal: 0, gstTotal: 0, grandTotal: 0 });

    const billData = {
        billNo: first.billNo,
        date: first.createdAt || new Date(),
        adminName: first.adminName || 'Admin',
        taxMode: 'lineLevel',
        discountMode: 'none',
        subtotal: totals.subtotal,
        gstTotal: totals.gstTotal,
        totalAmount: totals.grandTotal,
        items: allocations,
        vendorId: vendor,
        busId: vehicle
    };

    return {
        billData,
        vendor,
        bus: vehicle
    };
};

/**
 * Compile and render a print template to HTML
 */
const renderTemplate = async (template, data) => {
    const componentPath = TEMPLATE_PATHS[template];
    if (!componentPath) {
        const error = new Error(`Unsupported template: ${template}`);
        error.statusCode = 400;
        throw error;
    }

    // 1. Fetch template-specific data
    let templateData = {};
    let title = 'Print Document';

    switch (template) {
        case 'transport-admit': {
            const passenger = await fetchAdmitCardData(data);
            templateData = { passenger };
            title = passenger.student_name 
                ? `Transport-Admit-Card-${passenger.admission_number || passenger.emp_no || passenger.admission_no}`
                : 'Transport-Admit-Card';
            break;
        }
        case 'transport-bus-idcard-sheet': {
            const sheetData = await fetchIdCardSheetData(data);
            templateData = sheetData;
            title = `Bus-ID-Cards-${sheetData.academicYear}`;
            break;
        }
        case 'passenger-report': {
            const reportData = await fetchPassengerReportData(data);
            templateData = reportData;
            title = data.busId ? `Transport-Passenger-Report-${data.busId}` : 'Transport-Passenger-Report';
            break;
        }
        case 'bill-print': {
            const billPrintData = await fetchBillPrintData(data);
            templateData = billPrintData;
            title = `Transport-Maintenance-Bill-${billPrintData.billData.billNo}`;
            break;
        }
    }

    // 2. Transpile and load the React component dynamically
    const Component = getTranspiledComponent(componentPath);

    // 3. Render React element to static markup string
    const element = React.createElement(Component, templateData);
    let htmlMarkup = ReactDOMServer.renderToStaticMarkup(element);

    // 4. Inline Pydah Logo
    if (logoBase64) {
        htmlMarkup = htmlMarkup.replaceAll('/PYDAH_LOGO_PHOTO.jpg', logoBase64);
    }

    // 5. Wrap inside standard print-friendly HTML Shell
    const fullHtml = `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${title}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
    <script src="https://cdn.tailwindcss.com"></script>
    <style>
        body {
            font-family: 'Outfit', 'Inter', sans-serif;
            margin: 0;
            padding: 0;
            background-color: #ffffff;
        }
        
        /* Show layout cleanly inside browser screen previews */
        @media screen {
            body {
                background-color: #f1f5f9;
                padding: 20px;
            }
            .admit-card-print-host, .bus-id-print-host {
                visibility: visible !important;
                position: relative !important;
                z-index: auto !important;
                width: 210mm !important;
                margin: 0 auto 20px auto !important;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
                background-color: #ffffff !important;
                pointer-events: auto !important;
            }
            #printable-bill {
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
                border: 1px solid #e2e8f0;
                margin-top: 20px;
                margin-bottom: 20px;
            }
            #printable-passenger-report,
            .print-container {
                visibility: visible !important;
                position: relative !important;
                top: auto !important;
                left: auto !important;
                overflow: visible !important;
                width: 210mm !important;
                margin: 0 auto 20px auto !important;
                box-shadow: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1) !important;
                background-color: #ffffff !important;
            }
        }

        /* Native browser page printing configuration */
        @media print {
            body {
                background-color: #ffffff !important;
                padding: 0 !important;
            }
            .admit-card-print-host, .bus-id-print-host {
                visibility: visible !important;
                position: static !important;
                z-index: auto !important;
                width: 100% !important;
                box-shadow: none !important;
                background-color: #ffffff !important;
            }
            #printable-bill,
            #printable-bill * {
                visibility: visible !important;
            }
            #printable-bill {
                box-shadow: none !important;
                border: none !important;
                padding: 0 !important;
                margin: 0 !important;
                position: static !important;
                width: 100% !important;
            }
            #printable-passenger-report,
            #printable-passenger-report *,
            .print-container,
            .print-container * {
                visibility: visible !important;
            }
            #printable-passenger-report,
            .print-container {
                position: static !important;
                top: auto !important;
                left: auto !important;
                overflow: visible !important;
                width: 100% !important;
                box-shadow: none !important;
                margin: 0 !important;
            }
        }
    </style>
</head>
<body>
    ${htmlMarkup}
</body>
</html>`;

    return {
        html: fullHtml,
        title
    };
};

module.exports = {
    renderTemplate,
    fetchAdmitCardData,
    fetchStudentTransportPrintData,
    fetchBusPassengers,
    fetchIdCardSheetData,
    fetchPassengerReportData,
    fetchBillPrintData,
};
