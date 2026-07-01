const Bus = require('../models/Bus');
const Route = require('../models/Route');
const BusRouteHistory = require('../models/BusRouteHistory');
const BusStaffHistory = require('../models/BusStaffHistory');
const BusTaxHistory = require('../models/BusTaxHistory');
const { mysqlPool } = require('../config/db');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const {
    resolveAcademicYear,
    getDefaultAcademicYear,
    getActivePassengerSqlParts,
    enrichTransportFareAdjustments,
} = require('./transportRequestController');

const LEGACY_CHANGED_BY = 'Existing assignment';

const getChangedByName = (req) =>
    req.user?.employee_name || req.user?.name || req.user?.username || 'Admin';

const getLegacyAssignedDate = (bus) => bus.registrationDate || bus.createdAt || bus.updatedAt || new Date();

const isLiveOccupancyMode = (source = {}) => {
    const mode = String(source.occupancyMode || source.occupancy_mode || '').toLowerCase();
    return mode === 'live';
};

/** Import route/driver/cleaner that were set before history tracking existed. */
const backfillLegacyBusHistory = async (bus) => {
    if (!bus?.busNumber) return;

    const legacyDate = getLegacyAssignedDate(bus);

    if (bus.assignedRouteId) {
        const routeHistoryCount = await BusRouteHistory.countDocuments({ busNumber: bus.busNumber });
        if (routeHistoryCount === 0) {
            const routeName = await resolveRouteName(bus.assignedRouteId);
            await BusRouteHistory.create({
                busId: bus._id,
                busNumber: bus.busNumber,
                routeId: bus.assignedRouteId,
                routeName,
                previousRouteId: null,
                previousRouteName: null,
                assignedAt: legacyDate,
                action: 'assigned',
                changedBy: LEGACY_CHANGED_BY,
            });
        }
    }

    const staffRoles = [
        { role: 'driver', name: bus.driverName },
        { role: 'cleaner', name: bus.attendantName },
    ];

    for (const { role, name } of staffRoles) {
        const staffName = (name || '').trim();
        if (!staffName) continue;

        const roleCount = await BusStaffHistory.countDocuments({ busNumber: bus.busNumber, role });
        if (roleCount === 0) {
            await BusStaffHistory.create({
                busId: bus._id,
                busNumber: bus.busNumber,
                role,
                staffName,
                entryDate: legacyDate,
                isCurrent: true,
                changedBy: LEGACY_CHANGED_BY,
            });
        }
    }
};

const resolveRouteName = async (routeId) => {
    if (!routeId) return null;
    const route = await Route.findOne({ routeId }).lean();
    return route?.routeName || routeId;
};

const recordRouteHistory = async (bus, previousRouteId, newRouteId, changedBy, dates = {}) => {
    if (previousRouteId === newRouteId) return;

    const [previousRouteName, routeName] = await Promise.all([
        resolveRouteName(previousRouteId),
        resolveRouteName(newRouteId),
    ]);

    let action = 'assigned';
    if (previousRouteId && newRouteId) action = 'changed';
    else if (previousRouteId && !newRouteId) action = 'removed';

    await BusRouteHistory.create({
        busId: bus._id,
        busNumber: bus.busNumber,
        routeId: newRouteId || null,
        routeName: routeName || null,
        previousRouteId: previousRouteId || null,
        previousRouteName: previousRouteName || null,
        previousRouteExitDate: dates.exitDate ? new Date(dates.exitDate) : null,
        assignedAt: dates.entryDate ? new Date(dates.entryDate) : new Date(),
        action,
        changedBy,
    });
};

const recordStaffHistory = async (bus, role, change, changedBy) => {
    if (!change?.newName) return;

    const exitDate = change.exitDate ? new Date(change.exitDate) : null;
    const entryDate = change.entryDate ? new Date(change.entryDate) : new Date();

    if (change.previousName && exitDate) {
        await BusStaffHistory.updateMany(
            {
                busNumber: bus.busNumber,
                role,
                isCurrent: true,
            },
            {
                exitDate,
                isCurrent: false,
            }
        );
    }

    await BusStaffHistory.create({
        busId: bus._id,
        busNumber: bus.busNumber,
        role,
        staffName: change.newName,
        empNo: change.empNo || null,
        entryDate,
        isCurrent: true,
        changedBy,
    });
};

// @desc    Get bus details with assigned route, passenger list, seats filled
// @route   GET /api/buses/:id/details
// @access  Private/Admin
const getBusDetails = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id).populate('campus');
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }
        let route = null;
        if (bus.assignedRouteId) {
            route = await Route.findOne({ routeId: bus.assignedRouteId }).populate('campus');
        }
        let mysqlPassengers = [];
        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const liveOccupancy = isLiveOccupancyMode(req.query);
        if (mysqlPool) {
            const parts = getActivePassengerSqlParts(liveOccupancy ? fallbackAcademicYear : academicYear);
            const academicYearSql = liveOccupancy ? '' : 'AND COALESCE(tr.academic_year, ?) = ?';
            const academicYearParams = liveOccupancy ? [] : [fallbackAcademicYear, academicYear];
            const [rows] = await mysqlPool.query(
                `SELECT tr.id, tr.admission_number, tr.student_name, tr.route_name, tr.stage_name, tr.fare, tr.request_date, tr.bus_id,
                        COALESCE(s1.course, s2.course) as course,
                        COALESCE(s1.branch, s2.branch) as branch,
                        COALESCE(s1.current_year, s2.current_year, tr.year_of_study) as year_of_study,
                        tr.academic_year,
                        COALESCE(s1.pin_no, s2.pin_no) as pin_no,
                        ${parts.effectiveExpiryExpr} as effective_expiry_date,
                        ${parts.isExpiredExpr} as is_expired
                 FROM transport_requests tr
                 ${parts.studentJoins}
                 ${parts.expiryJoins}
                 WHERE tr.bus_id = ? AND tr.status = 'approved'
                   ${academicYearSql}
                   ${liveOccupancy ? `AND ${parts.activeWhere}` : ''}
                 ORDER BY tr.stage_name, tr.student_name`,
                [...parts.expiryParams, bus.busNumber, ...academicYearParams]
            );
            mysqlPassengers = await enrichTransportFareAdjustments(mysqlPool, rows.map(r => ({
                ...r,
                user_type: 'student',
                academic_year: r.academic_year || (liveOccupancy ? fallbackAcademicYear : academicYear),
                year_of_study: r.year_of_study != null ? Number(r.year_of_study) : null,
                is_expired: Boolean(r.is_expired),
            })));
        }

        const mongoRequests = await EmployeeTransportRequest.find({ bus_id: bus.busNumber, status: 'approved' }).lean();
        const mongoPassengers = mongoRequests.filter((r) => (
            liveOccupancy ? true : (r.academic_year || fallbackAcademicYear) === academicYear
        )).map(r => ({
            id: r._id.toString(),
            admission_number: r.emp_no,
            student_name: r.employee_name,
            route_name: r.route_name,
            stage_name: r.stage_name,
            fare: r.fare,
            request_date: r.request_date || r.created_at,
            user_type: 'employee',
            bus_id: r.bus_id,
            course: 'Employee',
            academic_year: r.academic_year || null,
            year_of_study: null,
        }));

        const activePassengers = mysqlPassengers.filter((p) => !p.is_expired);
        const expiredPassengers = mysqlPassengers.filter((p) => p.is_expired);
        const passengers = liveOccupancy
            ? [...activePassengers, ...mongoPassengers]
            : [...activePassengers, ...mongoPassengers, ...expiredPassengers];
        passengers.sort((a, b) => a.stage_name.localeCompare(b.stage_name) || a.student_name.localeCompare(b.student_name));
        const capacity = bus.capacity || 0;
        const seatsFilled = liveOccupancy
            ? activePassengers.length + mongoPassengers.length
            : mysqlPassengers.length + mongoPassengers.length;
        const seatsAvailable = Math.max(0, capacity - seatsFilled);
        const occupancyPercent = capacity > 0 ? Math.min(100, Math.round((seatsFilled / capacity) * 100)) : 0;

        res.json({
            bus: {
                _id: bus._id,
                busNumber: bus.busNumber,
                capacity: bus.capacity,
                type: bus.type,
                vehicleModel: bus.vehicleModel,
                registrationDate: bus.registrationDate,
                driverName: bus.driverName,
                attendantName: bus.attendantName,
                status: bus.status,
                assignedRouteId: bus.assignedRouteId,
            },
            route: route ? {
                _id: route._id,
                routeId: route.routeId,
                routeName: route.routeName,
                startPoint: route.startPoint,
                endPoint: route.endPoint,
                totalDistance: route.totalDistance,
                estimatedTime: route.estimatedTime,
                stages: route.stages,
            } : null,
            passengers,
            expiredPassengers,
            academicYear,
            occupancyMode: liveOccupancy ? 'live' : 'academicYear',
            seatsFilled,
            seatsAvailable,
            capacity,
            occupancyPercent,
        });
    } catch (error) {
        console.error('Error fetching bus details:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all buses with occupancy (for fleet / allocation page)
// @route   GET /api/buses/overview
// @access  Public
const getBusesOverview = async (req, res) => {
    try {
        let query = {};
        if (req.user) {
            const isSuperAdmin = req.user.roles && req.user.roles.includes('superadmin');
            if (!isSuperAdmin && req.user.campuses && req.user.campuses.length > 0) {
                if (req.query.campus) {
                    if (req.user.campuses.map(c => c.toString()).includes(req.query.campus)) {
                        query.campus = req.query.campus;
                    } else {
                        query.campus = null;
                    }
                } else {
                    query.campus = { $in: req.user.campuses };
                }
            } else if (req.query.campus) {
                query.campus = req.query.campus;
            }
        }
        const buses = await Bus.find(query).lean();
        const routeIds = [...new Set(buses.map((b) => b.assignedRouteId).filter(Boolean))];
        const routes = await Route.find({ routeId: { $in: routeIds } }).populate('campus').lean();
        const routeMap = Object.fromEntries(routes.map((r) => [r.routeId, r]));

        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const liveOccupancy = isLiveOccupancyMode(req.query);

        let counts = {};
        if (mysqlPool && buses.length > 0) {
            const busNumbers = buses.map((b) => b.busNumber);
            const placeholders = busNumbers.map(() => '?').join(',');
            const parts = getActivePassengerSqlParts(liveOccupancy ? fallbackAcademicYear : academicYear);
            const academicYearSql = liveOccupancy ? '' : 'AND COALESCE(tr.academic_year, ?) = ?';
            const academicYearParams = liveOccupancy ? [] : [fallbackAcademicYear, academicYear];
            const [rows] = await mysqlPool.query(
                `SELECT tr.bus_id AS busNumber, COUNT(*) AS seatsFilled
                 FROM transport_requests tr
                 ${liveOccupancy ? `${parts.studentJoins} ${parts.expiryJoins}` : ''}
                 WHERE tr.status = 'approved'
                   ${academicYearSql}
                   ${liveOccupancy ? `AND ${parts.activeWhere}` : ''}
                   AND tr.bus_id IS NOT NULL AND tr.bus_id != ''
                   AND tr.bus_id IN (${placeholders})
                 GROUP BY tr.bus_id`,
                [...(liveOccupancy ? parts.expiryParams : []), ...academicYearParams, ...busNumbers]
            );
            const mysqlCounts = Object.fromEntries((rows || []).map((r) => [r.busNumber, Number(r.seatsFilled)]));

            const mongoEmployees = await EmployeeTransportRequest.find({
                status: 'approved',
                bus_id: { $in: busNumbers },
            }).lean();
            const mongoCounts = {};
            mongoEmployees
                .filter((r) => liveOccupancy || (r.academic_year || fallbackAcademicYear) === academicYear)
                .forEach((r) => {
                    mongoCounts[r.bus_id] = (mongoCounts[r.bus_id] || 0) + 1;
                });

            busNumbers.forEach((bn) => {
                counts[bn] = (mysqlCounts[bn] || 0) + (mongoCounts[bn] || 0);
            });
        }

        const list = buses.map((bus) => {
            const capacity = bus.capacity || 0;
            const seatsFilled = counts[bus.busNumber] || 0;
            const seatsAvailable = Math.max(0, capacity - seatsFilled);
            const occupancyPercent = capacity > 0 ? Math.min(100, Math.round((seatsFilled / capacity) * 100)) : 0;
            const route = bus.assignedRouteId ? routeMap[bus.assignedRouteId] : null;
            return {
                bus: {
                    _id: bus._id,
                    busNumber: bus.busNumber,
                    capacity: bus.capacity,
                    type: bus.type,
                    status: bus.status,
                    assignedRouteId: bus.assignedRouteId,
                },
                route: route ? { routeId: route.routeId, routeName: route.routeName } : null,
                seatsFilled,
                seatsAvailable,
                capacity,
                occupancyPercent,
            };
        });
        res.json({ academicYear, occupancyMode: liveOccupancy ? 'live' : 'academicYear', buses: list });
    } catch (error) {
        console.error('Error fetching buses overview:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Auto-allocate approved transport requests for this bus's route to this bus up to capacity
// @route   POST /api/buses/:id/auto-allocate
// @access  Private/Admin
const autoAllocate = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }
        if (!bus.assignedRouteId) {
            return res.status(400).json({ message: 'Assign this bus to a route first.' });
        }
        if (!mysqlPool) {
            return res.status(500).json({ message: 'MySQL connection not established' });
        }

        const capacity = bus.capacity || 0;
        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const parts = getActivePassengerSqlParts(fallbackAcademicYear);
        const [current] = await mysqlPool.query(
            `SELECT COUNT(*) AS n
             FROM transport_requests tr
             ${parts.studentJoins}
             ${parts.expiryJoins}
             WHERE tr.bus_id = ? AND tr.status = 'approved' AND ${parts.activeWhere}`,
            [...parts.expiryParams, bus.busNumber]
        );
        const employeeFilled = await EmployeeTransportRequest.countDocuments({
            bus_id: bus.busNumber,
            status: 'approved',
        });
        const currentFilled = Number(current[0]?.n || 0) + Number(employeeFilled || 0);
        const slotsLeft = Math.max(0, capacity - currentFilled);
        if (slotsLeft === 0) {
            return res.json({ message: 'Bus is already full.', allocated: 0, seatsFilled: currentFilled, capacity });
        }

        const [unassigned] = await mysqlPool.query(
            `SELECT tr.id
             FROM transport_requests tr
             ${parts.studentJoins}
             ${parts.expiryJoins}
             WHERE tr.route_id = ? AND tr.status = 'approved' AND ${parts.activeWhere}
               AND COALESCE(tr.academic_year, ?) = ?
               AND (tr.bus_id IS NULL OR tr.bus_id = '')
             ORDER BY tr.request_date ASC, tr.id ASC
             LIMIT ?`,
            [...parts.expiryParams, bus.assignedRouteId, fallbackAcademicYear, academicYear, slotsLeft]
        );
        const toAssign = unassigned || [];
        for (const row of toAssign) {
            await mysqlPool.query('UPDATE transport_requests SET bus_id = ? WHERE id = ?', [bus.busNumber, row.id]);
        }
        const allocated = toAssign.length;
        res.json({
            message: allocated ? `Allocated ${allocated} passenger(s) to this bus.` : 'No unassigned approved requests for this route.',
            allocated,
            seatsFilled: currentFilled + allocated,
            capacity,
        });
    } catch (error) {
        console.error('Error auto-allocating:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get all buses
// @route   GET /api/buses
// @access  Public
const getBuses = async (req, res) => {
    try {
        let query = {};
        if (req.user) {
            const isSuperAdmin = req.user.roles && req.user.roles.includes('superadmin');
            if (!isSuperAdmin && req.user.campuses && req.user.campuses.length > 0) {
                if (req.query.campus) {
                    if (req.user.campuses.map(c => c.toString()).includes(req.query.campus)) {
                        query.campus = req.query.campus;
                    } else {
                        query.campus = null;
                    }
                } else {
                    query.campus = { $in: req.user.campuses };
                }
            } else if (req.query.campus) {
                query.campus = req.query.campus;
            }
        }
        const buses = await Bus.find(query).populate('campus');
        res.json(buses);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a bus
// @route   POST /api/buses
// @access  Private/Admin
const createBus = async (req, res) => {
    try {
        const bus = new Bus(req.body);
        const createdBus = await bus.save();
        res.status(201).json(createdBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a bus
// @route   PUT /api/buses/:id
// @access  Private/Admin
const updateBus = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);

        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        const previousRouteId = bus.assignedRouteId || null;
        const changedBy = getChangedByName(req);
        const { staffChanges } = req.body;

        bus.busNumber = req.body.busNumber || bus.busNumber;
        bus.capacity = req.body.capacity || bus.capacity;
        bus.type = req.body.type || bus.type;
        bus.amenities = req.body.amenities || bus.amenities;
        bus.status = req.body.status || bus.status;
        bus.campus = req.body.campus !== undefined ? (req.body.campus || null) : bus.campus;

        if (req.body.vehicleModel !== undefined) {
            bus.vehicleModel = req.body.vehicleModel;
        }
        if (req.body.registrationDate !== undefined) {
            bus.registrationDate = req.body.registrationDate ? new Date(req.body.registrationDate) : null;
        }

        const applyStaffChange = async (role, change, assignField) => {
            if (!change) return;
            const newName = (change.newName || '').trim();
            const previousName = (change.previousName || '').trim();

            if (newName) {
                bus[assignField] = newName;
                await recordStaffHistory(bus, role, change, changedBy);
                return;
            }

            bus[assignField] = '';
            if (previousName && change.exitDate) {
                await BusStaffHistory.updateMany(
                    { busNumber: bus.busNumber, role, isCurrent: true },
                    { exitDate: new Date(change.exitDate), isCurrent: false }
                );
            }
        };

        if (staffChanges?.driver) {
            await applyStaffChange('driver', staffChanges.driver, 'driverName');
        } else if (req.body.driverName !== undefined) {
            bus.driverName = req.body.driverName;
        }

        if (staffChanges?.cleaner) {
            await applyStaffChange('cleaner', staffChanges.cleaner, 'attendantName');
        } else if (req.body.attendantName !== undefined) {
            bus.attendantName = req.body.attendantName;
        }

        if (req.body.routeChange) {
            const newRouteId = req.body.routeChange.newRouteId || null;
            if (newRouteId !== previousRouteId) {
                bus.assignedRouteId = newRouteId;
                await recordRouteHistory(bus, previousRouteId, newRouteId, changedBy, {
                    exitDate: req.body.routeChange.exitDate,
                    entryDate: req.body.routeChange.entryDate,
                });
            }
        } else if (req.body.assignedRouteId !== undefined) {
            const newRouteId = req.body.assignedRouteId || null;
            if (newRouteId !== previousRouteId) {
                bus.assignedRouteId = newRouteId;
                await recordRouteHistory(bus, previousRouteId, newRouteId, changedBy);
            }
        }

        const updatedBus = await bus.save();
        res.json(updatedBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Get route assignment history for a bus
// @route   GET /api/buses/:id/history/route
// @access  Private/Admin
const getBusRouteHistory = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        await backfillLegacyBusHistory(bus);

        const history = await BusRouteHistory.find({ busNumber: bus.busNumber })
            .sort({ assignedAt: -1 })
            .lean();

        res.json(history);
    } catch (error) {
        console.error('Error fetching bus route history:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get driver/cleaner assignment history for a bus
// @route   GET /api/buses/:id/history/staff
// @access  Private/Admin
const getBusStaffHistory = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        await backfillLegacyBusHistory(bus);

        const history = await BusStaffHistory.find({ busNumber: bus.busNumber })
            .sort({ entryDate: -1 })
            .lean();

        res.json(history);
    } catch (error) {
        console.error('Error fetching bus staff history:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Delete a bus
// @route   DELETE /api/buses/:id
// @access  Private/Admin
const deleteBus = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);

        if (bus) {
            await bus.deleteOne();
            res.json({ message: 'Bus removed' });
        } else {
            res.status(404).json({ message: 'Bus not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Add a tax to a bus
// @route   POST /api/buses/:id/taxes
// @access  Private/Admin
const addBusTax = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        const { taxHeader, amount, endDate } = req.body;

        if (!taxHeader || amount === undefined || !endDate) {
            return res.status(400).json({ message: 'Tax header, amount, and end date are required' });
        }

        // Check if tax header already exists and is active (endDate not passed)
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const existingActiveTax = bus.taxes.find(tax => {
            const taxEndDate = new Date(tax.endDate);
            taxEndDate.setHours(0, 0, 0, 0);
            return tax.taxHeader.toLowerCase() === taxHeader.toLowerCase() && taxEndDate >= today;
        });

        if (existingActiveTax) {
            return res.status(400).json({ 
                message: `Tax header '${taxHeader}' is already active on this bus until ${new Date(existingActiveTax.endDate).toLocaleDateString()}. Please wait until the end date or update the existing tax.` 
            });
        }

        const newTax = {
            taxHeader: taxHeader.trim(),
            amount: parseFloat(amount),
            endDate: new Date(endDate),
            createdAt: new Date()
        };

        bus.taxes.push(newTax);
        const updatedBus = await bus.save();

        // Record history
        const endDateNorm = new Date(endDate);
        endDateNorm.setHours(0, 0, 0, 0);
        await BusTaxHistory.create({
            busId: bus._id,
            busNumber: bus.busNumber,
            taxHeader: taxHeader.trim(),
            action: 'added',
            amount: parseFloat(amount),
            endDate: new Date(endDate),
            previousAmount: null,
            previousEndDate: null,
            wasExpiredAtAction: endDateNorm < today,
            changedBy: getChangedByName(req),
        });

        res.status(201).json(updatedBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a tax for a bus
// @route   PUT /api/buses/:id/taxes/:taxId
// @access  Private/Admin
const updateBusTax = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        const tax = bus.taxes.id(req.params.taxId);
        if (!tax) {
            return res.status(404).json({ message: 'Tax not found' });
        }

        const { taxHeader, amount, endDate } = req.body;

        // If changing tax header, check for existing active tax with new header
        if (taxHeader && taxHeader.toLowerCase() !== tax.taxHeader.toLowerCase()) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const existingActiveTax = bus.taxes.find(t => {
                if (t._id.toString() === req.params.taxId) return false; // Exclude current tax
                const taxEndDate = new Date(t.endDate);
                taxEndDate.setHours(0, 0, 0, 0);
                return t.taxHeader.toLowerCase() === taxHeader.toLowerCase() && taxEndDate >= today;
            });

            if (existingActiveTax) {
                return res.status(400).json({ 
                    message: `Tax header '${taxHeader}' is already active on this bus until ${new Date(existingActiveTax.endDate).toLocaleDateString()}.` 
                });
            }
        }

        // Capture previous values before mutation
        const prevAmount = tax.amount;
        const prevEndDate = tax.endDate;
        const prevHeader = tax.taxHeader;

        if (taxHeader) tax.taxHeader = taxHeader.trim();
        if (amount !== undefined) tax.amount = parseFloat(amount);
        if (endDate) tax.endDate = new Date(endDate);

        const updatedBus = await bus.save();

        // Record history
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const newEndDate = endDate ? new Date(endDate) : prevEndDate;
        const newEndDateNorm = new Date(newEndDate);
        newEndDateNorm.setHours(0, 0, 0, 0);
        await BusTaxHistory.create({
            busId: bus._id,
            busNumber: bus.busNumber,
            taxHeader: (taxHeader || prevHeader).trim(),
            action: 'updated',
            amount: amount !== undefined ? parseFloat(amount) : prevAmount,
            endDate: newEndDate,
            previousAmount: prevAmount,
            previousEndDate: prevEndDate,
            wasExpiredAtAction: newEndDateNorm < today,
            changedBy: getChangedByName(req),
        });

        res.json(updatedBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a tax from a bus
// @route   DELETE /api/buses/:id/taxes/:taxId
// @access  Private/Admin
const deleteBusTax = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        const tax = bus.taxes.id(req.params.taxId);
        if (!tax) {
            return res.status(404).json({ message: 'Tax not found' });
        }

        // Capture snapshot before deleting
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const endDateNorm = new Date(tax.endDate);
        endDateNorm.setHours(0, 0, 0, 0);
        const taxSnapshot = {
            taxHeader: tax.taxHeader,
            amount: tax.amount,
            endDate: tax.endDate,
            wasExpired: endDateNorm < today,
        };

        tax.deleteOne();
        const updatedBus = await bus.save();

        // Record history
        await BusTaxHistory.create({
            busId: bus._id,
            busNumber: bus.busNumber,
            taxHeader: taxSnapshot.taxHeader,
            action: 'deleted',
            amount: taxSnapshot.amount,
            endDate: taxSnapshot.endDate,
            previousAmount: null,
            previousEndDate: null,
            wasExpiredAtAction: taxSnapshot.wasExpired,
            changedBy: getChangedByName(req),
        });

        res.json(updatedBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Get tax change history for a bus (optionally filtered by taxHeader)
// @route   GET /api/buses/:id/taxes/history?taxHeader=Insurance
// @access  Private/Admin
const getBusTaxHistory = async (req, res) => {
    try {
        const bus = await Bus.findById(req.params.id);
        if (!bus) {
            return res.status(404).json({ message: 'Bus not found' });
        }

        const { taxHeader } = req.query;
        const filter = { busId: bus._id };
        if (taxHeader) {
            filter.taxHeader = { $regex: new RegExp(`^${taxHeader.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') };
        }

        const history = await BusTaxHistory.find(filter)
            .sort({ actionAt: -1 })
            .lean();

        // Compute summary stats per taxHeader
        const statsMap = {};
        history.forEach(h => {
            const key = h.taxHeader.toLowerCase();
            if (!statsMap[key]) {
                statsMap[key] = { taxHeader: h.taxHeader, totalUpdates: 0, timesExpiredOnSave: 0, timesAdded: 0, timesDeleted: 0 };
            }
            if (h.action === 'added') statsMap[key].timesAdded++;
            if (h.action === 'updated') statsMap[key].totalUpdates++;
            if (h.action === 'deleted') statsMap[key].timesDeleted++;
            if (h.wasExpiredAtAction) statsMap[key].timesExpiredOnSave++;
        });

        res.json({
            busNumber: bus.busNumber,
            history,
            stats: Object.values(statsMap),
        });
    } catch (error) {
        console.error('Error fetching bus tax history:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getBuses,
    getBusesOverview,
    getBusDetails,
    getBusRouteHistory,
    getBusStaffHistory,
    getBusTaxHistory,
    autoAllocate,
    createBus,
    updateBus,
    deleteBus,
    addBusTax,
    updateBusTax,
    deleteBusTax
};
