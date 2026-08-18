/**
 * expireStaffTransportRequests.js
 *
 * Nightly job (runs at 2:00 AM IST) that automatically expires active employee
 * transport requests using two complementary strategies:
 *
 * Strategy A — HRMS Left Date:
 *   If the employee has a `leftDate` in the HRMS employees collection (at root
 *   level OR inside `dynamicFields`), and that date is in the past, all their
 *   active requests are expired immediately with reason 'employee_left'.
 *
 * Strategy B — Academic Year Expiry (fallback):
 *   If the employee has NO left date in HRMS (still active), their requests are
 *   checked against the request's `academic_year` field. If the academic year's
 *   end date (June 1 of the ending year) has passed, the request is expired
 *   with reason 'academic_year_ended'.
 *
 *   Examples:
 *     academic_year = '2025-2026'  →  expires on  2026-06-01
 *     academic_year = '2026-2027'  →  expires on  2027-06-01
 */

const { getEmployeeConnection } = require('../config/db');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the left-date value from a raw HRMS employee document.
 * Checks (in order): root `leftDate`, `dynamicFields.leftDate`, then broad key scan.
 *
 * @param {object} doc - Raw HRMS employee document
 * @returns {Date|null}
 */
function resolveLeftDate(doc) {
    if (!doc) return null;

    // 1. Primary: root-level leftDate (confirmed HRMS field name)
    if (doc.leftDate) {
        const d = new Date(doc.leftDate);
        if (!Number.isNaN(d.getTime())) return d;
    }

    // 2. Fallback: dynamicFields.leftDate
    const dynLeft = doc.dynamicFields?.leftDate;
    if (dynLeft) {
        const d = new Date(dynLeft);
        if (!Number.isNaN(d.getTime())) return d;
    }

    // 3. Broader fallback: any root key matching known patterns
    const fallbackKey = Object.keys(doc).find(
        (k) => k !== '_id' && /leav|exit|reliev|resign/i.test(k) && doc[k]
    );
    if (fallbackKey) {
        const d = new Date(doc[fallbackKey]);
        if (!Number.isNaN(d.getTime())) return d;
    }

    return null;
}

/**
 * Given an academic_year string like '2025-2026', return the expiry Date
 * (June 1 of the end year). Returns null if the string is not parseable.
 *
 * @param {string|null} academicYear
 * @returns {Date|null}
 */
function resolveAcademicYearExpiry(academicYear) {
    if (!academicYear) return null;
    const parts = String(academicYear).trim().split('-');
    if (parts.length !== 2) return null;
    const endYear = Number(parts[1]);
    if (Number.isNaN(endYear) || endYear < 2000) return null;
    // Academic year expires on June 1 of the ending year
    return new Date(`${endYear}-06-01T00:00:00.000Z`);
}

// ── Main Job ──────────────────────────────────────────────────────────────────

/**
 * Main expiry function. Runs both expiry strategies (HRMS left date + AY expiry)
 * and marks qualifying active employee transport requests as 'expired'.
 *
 * @returns {Promise<{
 *   scanned: number,
 *   expiredByLeftDate: number,
 *   expiredByAcademicYear: number,
 *   skipped: number,
 *   leftEmployees: string[],
 *   ayExpiredEmployees: string[]
 * }>}
 */
async function expireStaffTransportRequests() {
    const summary = {
        scanned: 0,
        expiredByLeftDate: 0,
        expiredByAcademicYear: 0,
        reactivatedCount: 0,
        skipped: 0,
        leftEmployees: [],
        ayExpiredEmployees: [],
        reactivatedEmployees: []
    };

    try {
        const hrmsConn = getEmployeeConnection();
        if (!hrmsConn) {
            console.warn('[Staff Expiry] HRMS connection unavailable. Skipping staff expiry job.');
            return summary;
        }

        const empCollection = hrmsConn.collection('employees');

        // ── Step 1: Load active requests and previously expired requests to check reactivation ──
        const activeRequests = await EmployeeTransportRequest.find({
            status: { $in: ['pending', 'approved'] },
        }).lean();

        const expiredLeftRequests = await EmployeeTransportRequest.find({
            status: 'expired',
            expiry_reason: 'employee_left'
        }).lean();

        summary.scanned = activeRequests.length;

        const allRequestsToCheck = [...activeRequests, ...expiredLeftRequests];
        if (!allRequestsToCheck.length) {
            console.log('[Staff Expiry] No staff transport requests found to process.');
            return summary;
        }

        const uniqueEmpNos = [...new Set(allRequestsToCheck.map((r) => r.emp_no).filter(Boolean))];
        if (!uniqueEmpNos.length) {
            console.warn('[Staff Expiry] Requests found but none have an emp_no. Skipping.');
            return summary;
        }

        console.log(`[Staff Expiry] Checking ${uniqueEmpNos.length} unique employee(s) against HRMS...`);

        // ── Step 2: Fetch HRMS records ────────────────────────────────────────
        const hrmsEmployees = await empCollection.find(
            { emp_no: { $in: uniqueEmpNos } },
            {
                projection: {
                    emp_no: 1,
                    employee_name: 1,
                    leftDate: 1,
                    dynamicFields: 1,
                    is_active: 1,
                    _id: 0,
                }
            }
        ).toArray();

        // Build a lookup map: emp_no → HRMS doc
        const hrmsMap = new Map();
        for (const emp of hrmsEmployees) {
            if (emp.emp_no) hrmsMap.set(String(emp.emp_no), emp);
        }

        // ── Step 3: Classify requests ─────────────────────────────────────────
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        // emp_nos to expire due to HRMS left date
        const leftDateEmpNos = new Set();
        // individual request _ids to expire due to academic year end
        const ayExpiredRequestIds = [];
        const ayExpiredEmpNos = new Set();

        // request _ids to reactivate (rejoined staff)
        const reactivateRequestIds = [];
        const reactivateEmpNos = new Set();

        // Check active requests for expiry
        for (const request of activeRequests) {
            const empNo = String(request.emp_no || '');
            const hrmsDoc = hrmsMap.get(empNo);

            // ── Strategy A: Check HRMS left date ──────────────────────────────
            const leftDate = hrmsDoc ? resolveLeftDate(hrmsDoc) : null;
            if (leftDate && leftDate < today) {
                leftDateEmpNos.add(empNo);
                console.log(
                    `[Staff Expiry] [LeftDate] emp_no=${empNo} (${hrmsDoc?.employee_name}) ` +
                    `left on ${leftDate.toISOString().split('T')[0]}`
                );
                continue;
            }

            // ── Strategy B: Academic Year expiry fallback ─────────────────────
            const ayExpiry = resolveAcademicYearExpiry(request.academic_year);
            if (ayExpiry && ayExpiry < today) {
                ayExpiredRequestIds.push(request._id);
                ayExpiredEmpNos.add(empNo);
                console.log(
                    `[Staff Expiry] [AY Expiry] emp_no=${empNo}, academic_year=${request.academic_year}, ` +
                    `expiry=${ayExpiry.toISOString().split('T')[0]}`
                );
            }
        }

        // Check expired requests for reactivation
        for (const request of expiredLeftRequests) {
            const empNo = String(request.emp_no || '');
            const hrmsDoc = hrmsMap.get(empNo);

            // If employee exists in HRMS and has rejoin indicator (no left date or future left date)
            if (hrmsDoc) {
                const leftDate = resolveLeftDate(hrmsDoc);
                if (!leftDate || leftDate >= today) {
                    reactivateRequestIds.push(request._id);
                    reactivateEmpNos.add(empNo);
                    console.log(
                        `[Staff Expiry] [Rejoined] emp_no=${empNo} (${hrmsDoc.employee_name}) ` +
                        `has rejoined / is active. Reactivating request.`
                    );
                }
            }
        }

        // ── Step 4: Apply Strategy A — Bulk expire by left date ──────────────
        if (leftDateEmpNos.size > 0) {
            const leftEmpNosArr = [...leftDateEmpNos];
            summary.leftEmployees = leftEmpNosArr;

            const resultA = await EmployeeTransportRequest.updateMany(
                {
                    emp_no: { $in: leftEmpNosArr },
                    status: { $in: ['pending', 'approved'] },
                },
                {
                    $set: {
                        status: 'expired',
                        expiry_reason: 'employee_left',
                    },
                }
            );
            summary.expiredByLeftDate = resultA.modifiedCount;
            console.log(`[Staff Expiry] [LeftDate] Expired ${summary.expiredByLeftDate} request(s) for ${leftEmpNosArr.length} employee(s).`);
        }

        // ── Step 5: Apply Strategy B — Expire by academic year ───────────────
        if (ayExpiredRequestIds.length > 0) {
            summary.ayExpiredEmployees = [...ayExpiredEmpNos];

            const resultB = await EmployeeTransportRequest.updateMany(
                {
                    _id: { $in: ayExpiredRequestIds },
                    status: { $in: ['pending', 'approved'] },
                },
                {
                    $set: {
                        status: 'expired',
                        expiry_reason: 'academic_year_ended',
                    },
                }
            );
            summary.expiredByAcademicYear = resultB.modifiedCount;
            console.log(`[Staff Expiry] [AY Expiry] Expired ${summary.expiredByAcademicYear} request(s) across ${ayExpiredEmpNos.size} employee(s).`);
        }

        // ── Step 6: Apply Reactivations for Rejoined Staff ────────────────────
        if (reactivateRequestIds.length > 0) {
            summary.reactivatedEmployees = [...reactivateEmpNos];

            const resultRejoined = await EmployeeTransportRequest.updateMany(
                {
                    _id: { $in: reactivateRequestIds },
                    status: 'expired'
                },
                {
                    $set: {
                        status: 'approved',
                        expiry_reason: null
                    }
                }
            );
            summary.reactivatedCount = resultRejoined.modifiedCount;
            console.log(`[Staff Expiry] [Rejoined] Reactivated ${summary.reactivatedCount} request(s) for ${reactivateEmpNos.size} employee(s).`);
        }

        // ── Summary ───────────────────────────────────────────────────────────
        const totalExpired = summary.expiredByLeftDate + summary.expiredByAcademicYear;
        summary.skipped = summary.scanned - totalExpired;

        console.log(
            `[Staff Expiry] ─────────────────────────────────────────────\n` +
            `  Scanned      : ${summary.scanned}\n` +
            `  By Left      : ${summary.expiredByLeftDate}\n` +
            `  By AY        : ${summary.expiredByAcademicYear}\n` +
            `  Reactivated  : ${summary.reactivatedCount}\n` +
            `  Skipped      : ${summary.skipped}\n` +
            `[Staff Expiry] ─────────────────────────────────────────────`
        );
    } catch (err) {
        console.error('[Staff Expiry] Error during staff transport expiry job:', err.message);
    }

    return summary;
}

module.exports = { expireStaffTransportRequests };
