/**
 * unassignLeftBusStaff.js
 *
 * Midnight background job (runs daily at 02:00 AM IST or triggered manually)
 * that checks assigned bus staff (drivers and cleaners) against HRMS employee records.
 *
 * If an assigned driver or cleaner has an HRMS leftDate on or before today (or is_active === false),
 * this job:
 *  1. Populates `exitDate` with their `leftDate` (or today) and sets `isCurrent: false` in `BusStaffHistory`.
 *  2. Unassigns them on the `Bus` record (resets `driverName` or `attendantName` to empty string).
 */

const { getEmployeeConnection } = require('../config/db');
const Bus = require('../models/Bus');
const BusStaffHistory = require('../models/BusStaffHistory');

/**
 * Resolve the left-date value from an HRMS employee document.
 * Checks root `leftDate`, `left_date`, `dynamicFields.leftDate`, or regex fallback.
 */
function resolveLeftDate(doc) {
    if (!doc) return null;

    if (doc.leftDate) {
        const d = new Date(doc.leftDate);
        if (!Number.isNaN(d.getTime())) return d;
    }
    if (doc.left_date) {
        const d = new Date(doc.left_date);
        if (!Number.isNaN(d.getTime())) return d;
    }

    const dynLeft = doc.dynamicFields?.leftDate || doc.dynamicFields?.left_date;
    if (dynLeft) {
        const d = new Date(dynLeft);
        if (!Number.isNaN(d.getTime())) return d;
    }

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
 * Main unassign job function.
 */
async function unassignLeftBusStaff() {
    const summary = {
        scannedBuses: 0,
        unassignedDrivers: 0,
        unassignedCleaners: 0,
        details: []
    };

    try {
        const hrmsConn = getEmployeeConnection();
        if (!hrmsConn) {
            console.warn('[Staff Auto-Unassign] HRMS DB connection unavailable. Skipping.');
            return summary;
        }

        const empCollection = hrmsConn.collection('employees');

        // Find all buses with a driver or attendant assigned
        const busesWithStaff = await Bus.find({
            $or: [
                { driverName: { $exists: true, $ne: '' } },
                { attendantName: { $exists: true, $ne: '' } }
            ]
        });

        summary.scannedBuses = busesWithStaff.length;
        if (!busesWithStaff.length) {
            console.log('[Staff Auto-Unassign] No buses with assigned staff found.');
            return summary;
        }

        // Collect all assigned names to batch fetch HRMS employee docs
        const assignedNames = new Set();
        busesWithStaff.forEach(bus => {
            if (bus.driverName) assignedNames.add(bus.driverName.trim());
            if (bus.attendantName) assignedNames.add(bus.attendantName.trim());
        });

        // Also fetch active staff history to get emp_no if available
        const activeHistory = await BusStaffHistory.find({ isCurrent: true }).lean();
        const empNoMap = new Map(); // staffName -> empNo
        activeHistory.forEach(h => {
            if (h.staffName && h.empNo) {
                empNoMap.set(h.staffName.trim().toLowerCase(), h.empNo);
            }
        });

        // Query HRMS employees matching by name or emp_no
        const nameRegexes = Array.from(assignedNames).map(n => new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i'));
        const empNos = Array.from(empNoMap.values());

        const queryOr = [{ employee_name: { $in: nameRegexes } }];
        if (empNos.length) queryOr.push({ emp_no: { $in: empNos } });

        const hrmsEmployees = await empCollection.find(
            { $or: queryOr },
            {
                projection: {
                    emp_no: 1,
                    employee_name: 1,
                    leftDate: 1,
                    left_date: 1,
                    dynamicFields: 1,
                    is_active: 1
                }
            }
        ).toArray();

        // Build lookup map by lowercased employee_name and by emp_no
        const hrmsByName = new Map();
        const hrmsByEmpNo = new Map();
        hrmsEmployees.forEach(emp => {
            if (emp.employee_name) hrmsByName.set(emp.employee_name.trim().toLowerCase(), emp);
            if (emp.emp_no) hrmsByEmpNo.set(String(emp.emp_no).trim().toLowerCase(), emp);
        });

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        for (const bus of busesWithStaff) {
            let busUpdated = false;

            // 1. Check Driver
            if (bus.driverName) {
                const driverNameLower = bus.driverName.trim().toLowerCase();
                const empNo = empNoMap.get(driverNameLower);
                const hrmsDoc = (empNo ? hrmsByEmpNo.get(empNo.toLowerCase()) : null) || hrmsByName.get(driverNameLower);

                if (hrmsDoc) {
                    const leftDate = resolveLeftDate(hrmsDoc);
                    const isInactive = hrmsDoc.is_active === false;

                    // If driver has left on or before today OR is inactive
                    if ((leftDate && leftDate <= today) || (isInactive && leftDate)) {
                        const exitDateToSet = leftDate && leftDate <= today ? leftDate : new Date();

                        // Update BusStaffHistory for driver
                        await BusStaffHistory.updateMany(
                            { busNumber: bus.busNumber, role: 'driver', isCurrent: true },
                            { exitDate: exitDateToSet, isCurrent: false }
                        );

                        summary.details.push({
                            busNumber: bus.busNumber,
                            role: 'driver',
                            staffName: bus.driverName,
                            leftDate: exitDateToSet
                        });

                        bus.driverName = '';
                        busUpdated = true;
                        summary.unassignedDrivers++;
                    }
                }
            }

            // 2. Check Cleaner / Attendant
            if (bus.attendantName) {
                const cleanerNameLower = bus.attendantName.trim().toLowerCase();
                const empNo = empNoMap.get(cleanerNameLower);
                const hrmsDoc = (empNo ? hrmsByEmpNo.get(empNo.toLowerCase()) : null) || hrmsByName.get(cleanerNameLower);

                if (hrmsDoc) {
                    const leftDate = resolveLeftDate(hrmsDoc);
                    const isInactive = hrmsDoc.is_active === false;

                    if ((leftDate && leftDate <= today) || (isInactive && leftDate)) {
                        const exitDateToSet = leftDate && leftDate <= today ? leftDate : new Date();

                        // Update BusStaffHistory for cleaner
                        await BusStaffHistory.updateMany(
                            { busNumber: bus.busNumber, role: 'cleaner', isCurrent: true },
                            { exitDate: exitDateToSet, isCurrent: false }
                        );

                        summary.details.push({
                            busNumber: bus.busNumber,
                            role: 'cleaner',
                            staffName: bus.attendantName,
                            leftDate: exitDateToSet
                        });

                        bus.attendantName = '';
                        busUpdated = true;
                        summary.unassignedCleaners++;
                    }
                }
            }

            if (busUpdated) {
                await bus.save();
            }
        }

        console.log(
            `[Staff Auto-Unassign] Scanned: ${summary.scannedBuses} buses. ` +
            `Unassigned Drivers: ${summary.unassignedDrivers}, Cleaners: ${summary.unassignedCleaners}`
        );
    } catch (err) {
        console.error('[Staff Auto-Unassign] Error during staff unassign job:', err);
    }

    return summary;
}

module.exports = { unassignLeftBusStaff };
