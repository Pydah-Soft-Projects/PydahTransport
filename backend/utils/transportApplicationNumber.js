const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

function normalizeApplicationCode(value, fallback = 'UNK') {
    const text = String(value || '').trim().toUpperCase();
    if (!text) return fallback;
    return text.replace(/\s+/g, '').replace(/[^A-Z0-9.-]/g, '') || fallback;
}

/** Use official DB code as-is (trim + uppercase only). */
function formatApplicationCode(value, fallback = 'UNK') {
    const text = String(value || '').trim().toUpperCase();
    return text || fallback;
}

function formatTransportApplicationNumber(collegeCode, courseCode, serial) {
    const college = formatApplicationCode(collegeCode, 'UNK');
    const course = formatApplicationCode(courseCode, 'GEN');
    const sequence = String(serial).padStart(4, '0');
    return `${college}-${course}-${sequence}`;
}

function parseLegacyApplicationNumber(applicationNumber) {
    if (!applicationNumber) return null;
    const text = String(applicationNumber).trim();
    if (/^\d{4}$/.test(text)) {
        return { collegeCode: null, courseCode: null, serial: Number(text) };
    }
    const match = text.match(/^([A-Z0-9.-]+)-([A-Z0-9.-]+)-(\d{4,})$/i);
    if (!match) return null;
    return {
        collegeCode: formatApplicationCode(match[1]),
        courseCode: formatApplicationCode(match[2]),
        serial: Number(match[3]),
    };
}

/**
 * Fetch the last/highest application serial for a specific college and course in an academic year.
 * Checks MongoDB TransportRequest collection only.
 */
async function getLastTransportApplicationSerial(mysqlPool, { academicYear, collegeCode, courseCode, userType = 'student' }) {
    let maxSerial = 0;
    const normalizedCollege = formatApplicationCode(collegeCode, 'UNK');
    const normalizedCourse = formatApplicationCode(courseCode, 'GEN');

    const isEmployee = userType === 'employee' || normalizedCourse === 'EMP';
    const Model = isEmployee ? EmployeeTransportRequest : TransportRequest;

    try {
        const lastMongoReq = await Model.findOne({
            academic_year: academicYear,
            application_college_code: normalizedCollege,
            application_course_code: normalizedCourse,
            application_serial: { $ne: null }
        })
            .sort({ application_serial: -1 })
            .select('application_serial')
            .lean();

        if (lastMongoReq && lastMongoReq.application_serial != null) {
            maxSerial = Math.max(maxSerial, Number(lastMongoReq.application_serial));
        }
    } catch (err) {
        console.error('Error fetching last transport application serial from Mongo:', err);
    }

    return maxSerial;
}

/**
 * Assign next application number for academic year + college + course by fetching the last request serial from MongoDB.
 */
async function assignTransportApplicationNumber(
    mysqlPool,
    {
        academicYear,
        collegeCode,
        courseCode,
        existingApplicationNumber = null,
        existingApplicationSerial = null,
        userType = 'student',
    }
) {
    if (existingApplicationNumber) {
        const parsed = parseLegacyApplicationNumber(existingApplicationNumber);
        return {
            application_number: existingApplicationNumber,
            application_serial: existingApplicationSerial != null
                ? Number(existingApplicationSerial)
                : (parsed?.serial ?? null),
            college_code: parsed?.collegeCode || formatApplicationCode(collegeCode),
            course_code: parsed?.courseCode || formatApplicationCode(courseCode),
        };
    }

    if (!academicYear) {
        throw new Error('Academic year is required to generate a transport application number.');
    }

    const normalizedCollege = formatApplicationCode(collegeCode, 'UNK');
    const normalizedCourse = formatApplicationCode(courseCode, 'GEN');

    const lastSerial = await getLastTransportApplicationSerial(mysqlPool, {
        academicYear,
        collegeCode: normalizedCollege,
        courseCode: normalizedCourse,
        userType,
    });

    const nextSerial = lastSerial + 1;

    return {
        application_number: formatTransportApplicationNumber(
            normalizedCollege,
            normalizedCourse,
            nextSerial
        ),
        application_serial: nextSerial,
        college_code: normalizedCollege,
        course_code: normalizedCourse,
    };
}

/** Read-only preview of the next serial for a college/course in an academic year based on last MongoDB request. */
async function peekNextTransportApplicationNumber(
    mysqlPool,
    { academicYear, collegeCode, courseCode, userType = 'student' }
) {
    if (!academicYear) {
        throw new Error('Academic year is required to preview a transport application number.');
    }

    const normalizedCollege = formatApplicationCode(collegeCode, 'UNK');
    const normalizedCourse = formatApplicationCode(courseCode, 'GEN');

    const lastSerial = await getLastTransportApplicationSerial(mysqlPool, {
        academicYear,
        collegeCode: normalizedCollege,
        courseCode: normalizedCourse,
        userType,
    });

    const nextSerial = lastSerial + 1;

    return {
        application_number: formatTransportApplicationNumber(
            normalizedCollege,
            normalizedCourse,
            nextSerial
        ),
        application_serial: nextSerial,
        college_code: normalizedCollege,
        course_code: normalizedCourse,
        academic_year: academicYear,
    };
}

module.exports = {
    normalizeApplicationCode,
    formatApplicationCode,
    formatTransportApplicationNumber,
    parseLegacyApplicationNumber,
    getLastTransportApplicationSerial,
    assignTransportApplicationNumber,
    peekNextTransportApplicationNumber,
};
