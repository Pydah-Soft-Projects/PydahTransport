const { mysqlPool } = require('../config/db');
const TransportRequest = require('../models/TransportRequest');

/**
 * Nightly job (runs at 2:00 AM IST) that automatically expires active student
 * transport requests if their admission has been cancelled in MySQL.
 */
async function expireStudentTransportRequests() {
    const summary = {
        scanned: 0,
        expiredCount: 0,
        expiredAdmissionNos: []
    };

    try {
        if (!mysqlPool) {
            console.warn('[Student Expiry] MySQL Pool not initialized. Skipping student expiry job.');
            return summary;
        }

        // 1. Fetch all active student transport requests from MongoDB
        const activeRequests = await TransportRequest.find({
            status: { $in: ['pending', 'approved'] }
        }).lean();

        summary.scanned = activeRequests.length;
        if (!activeRequests.length) {
            console.log('[Student Expiry] No active student transport requests found.');
            return summary;
        }

        const uniqueAdmissionNos = [...new Set(activeRequests.map(r => r.admission_number).filter(Boolean))];
        if (!uniqueAdmissionNos.length) {
            console.log('[Student Expiry] Active requests found but none have an admission_number. Skipping.');
            return summary;
        }

        console.log(`[Student Expiry] Checking status for ${uniqueAdmissionNos.length} students in MySQL...`);

        // 2. Query MySQL students table for their student_status
        const [studentRows] = await mysqlPool.query(
            `SELECT admission_number, admission_no, student_status
             FROM students
             WHERE admission_number IN (?) OR admission_no IN (?)`,
            [uniqueAdmissionNos, uniqueAdmissionNos]
        );

        // Build status lookup map: admission_number (normalized) -> student_status
        const statusMap = new Map();
        for (const student of studentRows) {
            const statusVal = String(student.student_status || '').trim();
            if (student.admission_number) {
                statusMap.set(String(student.admission_number).trim().toLowerCase(), statusVal);
            }
            if (student.admission_no) {
                statusMap.set(String(student.admission_no).trim().toLowerCase(), statusVal);
            }
        }

        // 3. Filter requests where student_status is 'Admission Cancelled'
        const requestsToExpire = [];
        for (const req of activeRequests) {
            const admNo = String(req.admission_number || '').trim().toLowerCase();
            const currentStatus = statusMap.get(admNo);
            
            if (currentStatus && currentStatus.toLowerCase() === 'admission cancelled') {
                requestsToExpire.push(req._id);
                summary.expiredAdmissionNos.push(req.admission_number);
                console.log(`[Student Expiry] Student ${req.student_name} (${req.admission_number}) has status "${currentStatus}". Expiring transport request.`);
            }
        }

        // 4. Bulk update expired requests in MongoDB (Admission Cancelled)
        if (requestsToExpire.length > 0) {
            const result = await TransportRequest.updateMany(
                { _id: { $in: requestsToExpire } },
                {
                    $set: {
                        status: 'expired',
                        expiry_reason: 'admission_cancelled'
                    }
                }
            );
            summary.expiredCount = result.modifiedCount;
            console.log(`[Student Expiry] Successfully expired ${summary.expiredCount} student transport request(s).`);
        }

        // 5. Delete pending requests with zero payments made toward transport fee
        const { getEligibilitySettings, getPaidAmountForFeeHead } = require('../services/requestEligibilityService');
        const { getFeePortalModels } = require('../models/fee-portal-models');
        const mongoose = require('mongoose');

        const settings = await getEligibilitySettings();
        const models = getFeePortalModels();

        if (settings.enabled && settings.feeHeadId && models && mongoose.Types.ObjectId.isValid(settings.feeHeadId)) {
            const { Transaction, StudentFee } = models;
            const feeHeadObjectId = new mongoose.Types.ObjectId(settings.feeHeadId);

            const pendingUnpaidRequests = await TransportRequest.find({
                status: 'pending',
                $or: [{ application_number: null }, { application_number: '' }, { application_number: { $exists: false } }]
            }).lean();

            const requestsToDelete = [];
            for (const req of pendingUnpaidRequests) {
                if (!req.admission_number || !req.academic_year) continue;
                const paidInfo = await getPaidAmountForFeeHead({
                    Transaction,
                    StudentFee,
                    studentId: req.admission_number,
                    feeHeadObjectId,
                    academicYear: req.academic_year,
                });
                if (paidInfo.totalPaid === 0) {
                    requestsToDelete.push(req._id);
                    console.log(`[Nightly Cleanup] Request for student ${req.student_name} (${req.admission_number}) in ${req.academic_year} has zero payment. Deleting unpaid request.`);
                }
            }

            if (requestsToDelete.length > 0) {
                const deleteResult = await TransportRequest.deleteMany({ _id: { $in: requestsToDelete } });
                summary.deletedUnpaidCount = deleteResult.deletedCount || 0;
                console.log(`[Nightly Cleanup] Successfully deleted ${summary.deletedUnpaidCount} unpaid pending transport request(s).`);
            }
        }

        console.log(
            `[Student Expiry] ─────────────────────────────────────────────\n` +
            `  Scanned       : ${summary.scanned}\n` +
            `  Expired       : ${summary.expiredCount}\n` +
            `  Deleted Unpaid: ${summary.deletedUnpaidCount || 0}\n` +
            `[Student Expiry] ─────────────────────────────────────────────`
        );

    } catch (err) {
        console.error('[Student Expiry] Error during student transport expiry job:', err.message);
    }

    return summary;
}

module.exports = { expireStudentTransportRequests };
