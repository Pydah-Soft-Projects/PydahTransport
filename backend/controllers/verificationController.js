const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const OfflineScanLog = require('../models/OfflineScanLog');
const {
    getPublicKeyInfo,
    buildSignedVerifyUrl,
    buildSignedToken,
    verifySignedToken,
    ensureKeyPair,
} = require('../utils/qrSigning');

function getDefaultAcademicYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    if (month >= 6) return `${year}-${year + 1}`;
    return `${year - 1}-${year}`;
}

function mapStudentRecord(r) {
    return {
        requestId: r.id != null ? String(r.id) : String(r._id),
        mongoId: String(r._id),
        studentId: r.admission_number || null,
        studentName: r.student_name || null,
        userType: 'student',
        transportStatus: r.status || 'pending',
        routeId: r.route_id || null,
        routeName: r.route_name || null,
        stageName: r.stage_name || null,
        busId: r.bus_id || null,
        academicYear: r.academic_year || null,
        applicationNumber: r.application_number || null,
        fare: r.fare != null ? Number(r.fare) : null,
        validUntil: r.expiry_date || r.semester_end_date || null,
        updatedAt: r.updated_at || r.request_date || null,
    };
}

function mapEmployeeRecord(r) {
    return {
        requestId: String(r._id),
        mongoId: String(r._id),
        studentId: r.emp_no || null,
        studentName: r.employee_name || null,
        userType: 'employee',
        transportStatus: r.status || 'pending',
        routeId: r.route_id ? String(r.route_id) : null,
        routeName: r.route_name || null,
        stageName: r.stage_name || null,
        busId: r.bus_id || null,
        academicYear: r.academic_year || null,
        applicationNumber: r.application_number || null,
        fare: r.fare != null ? Number(r.fare) : null,
        validUntil: null,
        updatedAt: r.updated_at || r.request_date || r.created_at || null,
    };
}

// @desc    Public key for offline signature verification
// @route   GET /api/verification/public-key
const getVerificationPublicKey = async (req, res) => {
    try {
        ensureKeyPair();
        res.json(getPublicKeyInfo());
    } catch (error) {
        console.error('Error loading QR public key:', error);
        res.status(500).json({ message: error.message || 'Failed to load public key' });
    }
};

// @desc    Minimal approved-passenger dataset for IndexedDB sync
// @route   GET /api/verification/sync
const syncVerificationData = async (req, res) => {
    try {
        const academicYear = req.query.academicYear
            || req.query.academic_year
            || process.env.CURRENT_ACADEMIC_YEAR
            || getDefaultAcademicYear();
        const since = req.query.since ? new Date(req.query.since) : null;
        const routeId = req.query.routeId || req.query.route_id || null;
        const busId = req.query.busId || req.query.bus_id || null;

        const studentQuery = { status: 'approved' };
        if (academicYear) {
            studentQuery.$or = [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ];
        }
        if (routeId) studentQuery.route_id = String(routeId);
        if (busId) studentQuery.bus_id = String(busId);
        if (since && !Number.isNaN(since.getTime())) {
            studentQuery.updated_at = { $gte: since };
        }

        const employeeQuery = { status: 'approved' };
        if (academicYear) {
            employeeQuery.$or = [
                { academic_year: academicYear },
                { academic_year: null },
                { academic_year: { $exists: false } },
            ];
        }
        if (routeId) employeeQuery.route_id = String(routeId);
        if (busId) employeeQuery.bus_id = String(busId);
        if (since && !Number.isNaN(since.getTime())) {
            employeeQuery.updated_at = { $gte: since };
        }

        const [students, employees] = await Promise.all([
            TransportRequest.find(studentQuery).lean(),
            EmployeeTransportRequest.find(employeeQuery).lean(),
        ]);

        const records = [
            ...students.map(mapStudentRecord),
            ...employees.map(mapEmployeeRecord),
        ];

        res.json({
            academicYear,
            syncedAt: new Date().toISOString(),
            count: records.length,
            incremental: Boolean(since),
            records,
        });
    } catch (error) {
        console.error('Error syncing verification data:', error);
        res.status(500).json({ message: error.message || 'Sync failed' });
    }
};

// @desc    Build signed QR content for a request (URL#token — public + PWA)
// @route   GET /api/verification/qr-content/:id
const getSignedQrContent = async (req, res) => {
    try {
        const requestId = req.params.id;
        let fields = null;

        const numericId = Number(requestId);
        if (!Number.isNaN(numericId)) {
            const student = await TransportRequest.findOne({ id: numericId }).lean();
            if (student) {
                fields = {
                    rid: student.id != null ? String(student.id) : String(student._id),
                    sid: student.admission_number || '',
                    ay: student.academic_year || null,
                    rid2: student.route_id || null,
                    bid: student.bus_id || null,
                    exp: student.expiry_date
                        ? new Date(student.expiry_date).toISOString().slice(0, 10)
                        : null,
                };
            }
        }

        if (!fields) {
            const employee = await EmployeeTransportRequest.findById(requestId).lean();
            if (employee) {
                fields = {
                    rid: String(employee._id),
                    sid: employee.emp_no || '',
                    ay: employee.academic_year || null,
                    rid2: employee.route_id ? String(employee.route_id) : null,
                    bid: employee.bus_id || null,
                    exp: null,
                };
            }
        }

        if (!fields) {
            const byMongo = await TransportRequest.findById(requestId).lean();
            if (byMongo) {
                fields = {
                    rid: byMongo.id != null ? String(byMongo.id) : String(byMongo._id),
                    sid: byMongo.admission_number || '',
                    ay: byMongo.academic_year || null,
                    rid2: byMongo.route_id || null,
                    bid: byMongo.bus_id || null,
                    exp: byMongo.expiry_date
                        ? new Date(byMongo.expiry_date).toISOString().slice(0, 10)
                        : null,
                };
            }
        }

        if (!fields) {
            return res.status(404).json({ message: 'Transport request not found' });
        }

        const publicSiteUrl = process.env.PUBLIC_SITE_URL || '';
        const qrContent = buildSignedVerifyUrl(fields.rid, fields, publicSiteUrl);
        const token = buildSignedToken(fields);

        res.json({
            requestId: fields.rid,
            qrContent,
            token,
            publicKey: getPublicKeyInfo(),
        });
    } catch (error) {
        console.error('Error building signed QR content:', error);
        res.status(500).json({ message: error.message || 'Failed to build QR content' });
    }
};

// @desc    Online verify of scanned payload / request id
// @route   POST /api/verification/verify
const verifyOnlinePayload = async (req, res) => {
    try {
        const { qrText, requestId } = req.body || {};
        let resolvedId = requestId ? String(requestId) : null;
        let signatureCheck = null;

        if (qrText) {
            signatureCheck = verifySignedToken(qrText);
            if (signatureCheck.ok) {
                resolvedId = String(signatureCheck.payload.rid);
            } else if (signatureCheck.reason === 'invalid_signature' || signatureCheck.reason === 'tampered') {
                return res.status(400).json({
                    valid: false,
                    reason: signatureCheck.reason,
                    message: 'QR signature is invalid.',
                });
            } else if (signatureCheck.reason === 'expired') {
                return res.status(400).json({
                    valid: false,
                    reason: 'expired',
                    message: 'QR code has expired.',
                    payload: signatureCheck.payload,
                });
            } else if (!resolvedId) {
                const urlMatch = String(qrText).match(/verify-transport\/([^/?#]+)/i);
                if (urlMatch) resolvedId = decodeURIComponent(urlMatch[1]);
            }
        }

        if (!resolvedId) {
            return res.status(400).json({
                valid: false,
                reason: 'missing_id',
                message: 'Could not resolve transport request from QR.',
            });
        }

        // Reuse public verify endpoint logic via internal HTTP is heavy —
        // call the same controller function pattern by requiring lookup here.
        const { verifyTransportPassenger } = require('./transportRequestController');
        const fakeReq = { params: { id: resolvedId } };
        let payload = null;
        const fakeRes = {
            statusCode: 200,
            status(code) {
                this.statusCode = code;
                return this;
            },
            json(body) {
                payload = body;
                return this;
            },
        };
        await verifyTransportPassenger(fakeReq, fakeRes);

        res.status(fakeRes.statusCode || 200).json({
            valid: Boolean(payload?.registered),
            mode: 'ONLINE',
            requestId: resolvedId,
            signature: signatureCheck?.ok
                ? 'valid'
                : (signatureCheck ? signatureCheck.reason : 'legacy_url'),
            data: payload,
        });
    } catch (error) {
        console.error('Error in online verification:', error);
        res.status(500).json({ message: error.message || 'Verification failed' });
    }
};

// @desc    Upload offline scan logs from PWA
// @route   POST /api/verification/offline-scans
const uploadOfflineScans = async (req, res) => {
    try {
        const scans = Array.isArray(req.body?.scans) ? req.body.scans : [];
        if (scans.length === 0) {
            return res.status(400).json({ message: 'No scans provided' });
        }

        let upserted = 0;
        let duplicate = 0;
        const errors = [];

        for (const scan of scans) {
            const scanId = String(scan.scanId || '').trim();
            if (!scanId || !scan.verificationResult) {
                errors.push({ scanId: scanId || null, message: 'scanId and verificationResult are required' });
                continue;
            }

            try {
                const existing = await OfflineScanLog.findOne({ scanId }).select('_id').lean();
                if (existing) {
                    duplicate += 1;
                    continue;
                }
                await OfflineScanLog.create({
                    scanId,
                    requestId: scan.requestId || scan.transportId || null,
                    studentId: scan.studentId || null,
                    transportId: scan.transportId || scan.requestId || null,
                    verificationResult: String(scan.verificationResult),
                    mode: scan.mode === 'ONLINE' ? 'ONLINE' : 'OFFLINE',
                    scannedAt: scan.scannedAt ? new Date(scan.scannedAt) : new Date(),
                    deviceId: scan.deviceId || null,
                    academicYear: scan.academicYear || null,
                    rawPayload: scan.rawPayload || null,
                });
                upserted += 1;
            } catch (err) {
                if (err.code === 11000) duplicate += 1;
                else errors.push({ scanId, message: err.message });
            }
        }

        res.json({
            message: 'Offline scans processed',
            received: scans.length,
            inserted: upserted,
            duplicates: duplicate,
            errors,
        });
    } catch (error) {
        console.error('Error uploading offline scans:', error);
        res.status(500).json({ message: error.message || 'Upload failed' });
    }
};

module.exports = {
    getVerificationPublicKey,
    syncVerificationData,
    getSignedQrContent,
    verifyOnlinePayload,
    uploadOfflineScans,
};
