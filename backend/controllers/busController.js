const Bus = require('../models/Bus');
const Route = require('../models/Route');
const BusRouteHistory = require('../models/BusRouteHistory');
const BusStaffHistory = require('../models/BusStaffHistory');
const BusTaxHistory = require('../models/BusTaxHistory');
const { mysqlPool } = require('../config/db');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const TransportRequest = require('../models/TransportRequest');
const {
    resolveAcademicYear,
    getDefaultAcademicYear,
    getActivePassengerSqlParts,
    enrichTransportFareAdjustments,
} = require('./transportRequestController');
const campusService = require('../services/campusService');
const { resolveStudentExpiries } = require('../utils/expiryResolver');

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
        const busDoc = await Bus.findById(req.params.id);
        if (!busDoc) {
            return res.status(404).json({ message: 'Bus not found' });
        }
        const bus = await campusService.attachCampusToDoc(busDoc);
        let route = null;
        if (bus.assignedRouteId) {
            const routeDoc = await Route.findOne({ routeId: bus.assignedRouteId });
            route = routeDoc ? await campusService.attachCampusToDoc(routeDoc) : null;
        }
        let mysqlPassengers = [];
        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const liveOccupancy = isLiveOccupancyMode(req.query);
        const studentMongoRequests = await TransportRequest.find({
            bus_id: bus.busNumber,
            status: 'approved'
        }).lean();
        const filteredStudentRequests = studentMongoRequests.filter((r) => (
            liveOccupancy ? true : (r.academic_year || fallbackAcademicYear) === academicYear
        ));

        // Resolve student request expiry details dynamically from SQL
        await resolveStudentExpiries(filteredStudentRequests, mysqlPool);

        const admissionNos = [...new Set(filteredStudentRequests.map(r => r.admission_number).filter(Boolean))];
        let studentMap = {};
        if (mysqlPool && admissionNos.length > 0) {
            const [studentRows] = await mysqlPool.query(
                `SELECT admission_number, admission_no, course, branch, pin_no
                 FROM students
                 WHERE admission_number IN (?) OR admission_no IN (?)`,
                [admissionNos, admissionNos]
            );
            for (const s of studentRows) {
                if (s.admission_number) studentMap[s.admission_number] = s;
                if (s.admission_no) studentMap[s.admission_no] = s;
            }
        }

        const formattedStudentRows = filteredStudentRequests.map((r) => {
            const student = (r.admission_number && studentMap[r.admission_number]) || {};
            const isExpired = r.is_expired;
            return {
                ...r,
                id: r.id != null ? r.id : String(r._id),
                user_type: 'student',
                course: student.course || 'N/A',
                branch: student.branch || 'N/A',
                pin_no: student.pin_no || 'N/A',
                academic_year: r.academic_year || (liveOccupancy ? fallbackAcademicYear : academicYear),
                year_of_study: r.year_of_study != null ? Number(r.year_of_study) : null,
                is_expired: isExpired,
            };
        });

        mysqlPassengers = await enrichTransportFareAdjustments(mysqlPool, formattedStudentRows);

        const mongoRequests = await EmployeeTransportRequest.find({
            bus_id: bus.busNumber,
            status: 'approved'
        }).lean();
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
                campus: bus.campus,
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

// @desc    Get counts of affected passengers for bus-route mapping changes
// @route   GET /api/buses/mapping-preview
// @access  Private/Admin
const getMappingPreview = async (req, res) => {
    const { mode, busNumber, routeId, academicYear } = req.query;
    const resolvedAcademicYear = academicYear || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027';
    
    try {
        const TransportRequest = require('../models/TransportRequest');
        const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
        const Route = require('../models/Route');

        // 1. Fetch all buses in the system to compute the current mapping
        const buses = await Bus.find({}).lean();

        // 2. Build the simulated/proposed mapping map: routeId -> busNumber
        const currentRouteToBus = {};
        const proposedRouteToBus = {};
        
        buses.forEach(b => {
            if (b.assignedRouteId) {
                currentRouteToBus[b.assignedRouteId] = b.busNumber;
                proposedRouteToBus[b.assignedRouteId] = b.busNumber;
            }
        });

        // Track affected bus numbers to calculate capacity warnings
        const affectedBusNumbers = new Set();

        // 3. Apply the proposed change depending on mode
        if (mode === 'bus') {
            // We are changing the route assigned to busNumber
            const targetBus = buses.find(b => b.busNumber === busNumber);
            if (targetBus) {
                const oldRouteId = targetBus.assignedRouteId;
                const newRouteId = routeId && routeId !== 'unassigned' && routeId !== '' ? routeId : null;

                affectedBusNumbers.add(busNumber);

                // Remove from old route
                if (oldRouteId && proposedRouteToBus[oldRouteId] === busNumber) {
                    delete proposedRouteToBus[oldRouteId];
                }

                // If assigning to a new route, remove any bus already mapped to that route, and set new mapping
                if (newRouteId) {
                    const otherBus = buses.find(b => b.assignedRouteId === newRouteId && b.busNumber !== busNumber);
                    if (otherBus) {
                        affectedBusNumbers.add(otherBus.busNumber);
                    }
                    proposedRouteToBus[newRouteId] = busNumber;
                }
            }
        } else if (mode === 'route') {
            // We are changing the bus assigned to routeId
            const newBusNumber = busNumber && busNumber !== 'unassigned' && busNumber !== '' ? busNumber : null;

            // Bus previously on this route is affected
            const oldBus = buses.find(b => b.assignedRouteId === routeId);
            if (oldBus) {
                affectedBusNumbers.add(oldBus.busNumber);
            }

            // Remove proposed bus's mapping from its old route
            if (newBusNumber) {
                affectedBusNumbers.add(newBusNumber);
                const targetBus = buses.find(b => b.busNumber === newBusNumber);
                if (targetBus && targetBus.assignedRouteId) {
                    delete proposedRouteToBus[targetBus.assignedRouteId];
                }
                proposedRouteToBus[routeId] = newBusNumber;
            } else {
                // If unassigning the route
                delete proposedRouteToBus[routeId];
            }
        } else {
            // Legacy / fallback mode: check passengers currently assigned to the bus
            let busNumToCheck = busNumber;
            if (routeId && !busNumToCheck) {
                const bus = buses.find(b => b.assignedRouteId === routeId);
                if (bus) busNumToCheck = bus.busNumber;
            }
            if (busNumToCheck) {
                const query = { 
                    bus_id: busNumToCheck, 
                    status: 'approved'
                };
                const rawStudents = await TransportRequest.find(query).lean();
                await resolveStudentExpiries(rawStudents, mysqlPool);
                const studentCount = rawStudents.filter(s => {
                    const isSameYear = (s.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === resolvedAcademicYear;
                    return isSameYear || !s.is_expired;
                }).length;

                const rawEmployees = await EmployeeTransportRequest.find(query).lean();
                const employeeCount = rawEmployees.filter(e => {
                    const isSameYear = (e.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === resolvedAcademicYear;
                    return isSameYear || e.status === 'approved';
                }).length;

                return res.json({ studentCount, employeeCount, affectedPassengers: [], busCapacityAlerts: [] });
            }
            return res.json({ studentCount: 0, employeeCount: 0, affectedPassengers: [], busCapacityAlerts: [] });
        }

        // 4. Find all approved requests for students and employees
        const rawStudents = await TransportRequest.find({ status: 'approved' }).lean();
        await resolveStudentExpiries(rawStudents, mysqlPool);

        const rawEmployees = await EmployeeTransportRequest.find({ status: 'approved' }).lean();

        // Filter active passengers (current academic year, or any other academic year that is not expired)
        const activeStudents = rawStudents.filter(s => {
            const isSameYear = (s.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === resolvedAcademicYear;
            return isSameYear || !s.is_expired;
        });

        const activeEmployees = rawEmployees.filter(e => {
            const isSameYear = (e.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === resolvedAcademicYear;
            return isSameYear || e.status === 'approved';
        });

        const affectedPassengers = [];
        let studentCount = 0;
        let employeeCount = 0;

        // Fetch all routes to resolve route names efficiently
        const routes = await Route.find({}).lean();
        const routeNameMap = Object.fromEntries(routes.map(r => [r.routeId, r.routeName]));

        // Calculate proposed passenger counts per bus
        const proposedBusCounts = {};
        buses.forEach(b => {
            proposedBusCounts[b.busNumber] = 0;
        });

        const checkPassenger = (p, type) => {
            const currentBus = p.bus_id || null;
            const rId = p.route_id;
            const proposedBus = proposedRouteToBus[rId] || null;

            // Normalize values for comparison
            const currNorm = currentBus === '' ? null : currentBus;
            const propNorm = proposedBus === '' ? null : proposedBus;

            // Add to proposed bus counts if assigned
            if (propNorm && proposedBusCounts[propNorm] !== undefined) {
                proposedBusCounts[propNorm]++;
            }

            if (currNorm !== propNorm) {
                if (type === 'student') studentCount++;
                else employeeCount++;

                affectedPassengers.push({
                    id: p._id.toString(),
                    name: type === 'student' ? p.student_name : p.employee_name,
                    identifier: type === 'student' ? p.admission_number : p.emp_no,
                    type,
                    routeId: rId,
                    routeName: p.route_name || routeNameMap[rId] || rId,
                    stageName: p.stage_name || 'N/A',
                    currentBus: currNorm || 'Unassigned',
                    proposedBus: propNorm || 'Unassigned'
                });
            }
        };

        activeStudents.forEach(s => checkPassenger(s, 'student'));
        activeEmployees.forEach(e => checkPassenger(e, 'employee'));

        // Build vacancy warnings for affected buses
        const busCapacityAlerts = [];
        affectedBusNumbers.forEach(bNum => {
            const bus = buses.find(b => b.busNumber === bNum);
            if (bus) {
                const cap = bus.capacity || 0;
                const propPassengers = proposedBusCounts[bNum] || 0;
                const propSeatsAvail = cap - propPassengers;
                busCapacityAlerts.push({
                    busNumber: bNum,
                    capacity: cap,
                    proposedPassengers: propPassengers,
                    proposedSeatsAvailable: propSeatsAvail,
                    isOverCapacity: propSeatsAvail < 0
                });
            }
        });

        // Sort affected passengers
        affectedPassengers.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

        res.json({
            studentCount,
            employeeCount,
            affectedPassengers,
            busCapacityAlerts
        });
    } catch (error) {
        console.error('Error fetching mapping preview:', error);
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
            query = campusService.buildCampusFilter(req.user, req.query.campus);
        } else if (req.query.campus) {
            query.campus = campusService.normalizeCampusId(req.query.campus);
        }
        const buses = await Bus.find(query).lean();
        const routeIds = [...new Set(buses.map((b) => b.assignedRouteId).filter(Boolean))];
        const routeDocs = await Route.find({ routeId: { $in: routeIds } }).lean();
        const routes = await campusService.attachCampusToDocs(routeDocs);
        const routeMap = Object.fromEntries(routes.map((r) => [r.routeId, r]));

        const academicYear = resolveAcademicYear(req.query);
        const fallbackAcademicYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const liveOccupancy = isLiveOccupancyMode(req.query);

        let counts = {};
        let unassignedStudentsCount = 0;
        let unassignedEmployeesCount = 0;

        let studentQuery = { status: 'approved' };
        let employeeQuery = { status: 'approved' };

        // Handle Campus filtering for requests
        let allowedRouteIds = null;
        if (req.user || req.query.campus) {
            const campusFilter = campusService.buildCampusFilter(req.user || {}, req.query.campus);
            if (campusFilter.campus) {
                const campusRoutes = await Route.find({ campus: campusFilter.campus }).select('routeId').lean();
                allowedRouteIds = campusRoutes.map(r => r.routeId);
                studentQuery.route_id = { $in: allowedRouteIds };
                employeeQuery.route_id = { $in: allowedRouteIds };
            }
        }

        const mongoStudents = await TransportRequest.find(studentQuery).lean();
        // Resolve student request expiry details dynamically from SQL
        await resolveStudentExpiries(mongoStudents, mysqlPool);

        const activeStudents = mongoStudents.filter((r) => {
            if (liveOccupancy) {
                return !r.is_expired;
            }
            return (r.academic_year || fallbackAcademicYear) === academicYear;
        });

        const mongoEmployees = await EmployeeTransportRequest.find(employeeQuery).lean();
        const activeEmployees = mongoEmployees.filter((r) => 
            liveOccupancy || (r.academic_year || fallbackAcademicYear) === academicYear
        );

        const allUniqueRouteIds = [...new Set([
            ...activeStudents.map(s => s.route_id),
            ...activeEmployees.map(e => e.route_id)
        ].filter(Boolean))];
        const allRoutes = await Route.find({ routeId: { $in: allUniqueRouteIds } }).lean();
        const allRouteMap = Object.fromEntries(allRoutes.map(r => [r.routeId, r.routeName]));

        const studentCountsByBus = {};
        const employeeCountsByBus = {};
        const expectedRenewalsByBus = {};
        const unassignedRouteBreakdown = {};

        const targetYear = process.env.CURRENT_ACADEMIC_YEAR || getDefaultAcademicYear();
        const renewedDocs = await TransportRequest.find({
            academic_year: targetYear,
            status: { $in: ['pending', 'approved'] },
        }).select('admission_number').lean();
        const renewedSet = new Set(
            renewedDocs.map((r) => String(r.admission_number || '').trim()).filter(Boolean)
        );

        if (buses.length > 0) {
            const busNumbers = buses.map((b) => b.busNumber);

            activeStudents.forEach((r) => {
                if (r.bus_id && busNumbers.includes(r.bus_id)) {
                    studentCountsByBus[r.bus_id] = (studentCountsByBus[r.bus_id] || 0) + 1;
                } else {
                    unassignedStudentsCount++;
                    const rid = r.route_id || 'Unknown';
                    if (!unassignedRouteBreakdown[rid]) {
                        unassignedRouteBreakdown[rid] = { routeId: rid, routeName: allRouteMap[rid] || rid, students: 0, employees: 0, total: 0 };
                    }
                    unassignedRouteBreakdown[rid].students++;
                    unassignedRouteBreakdown[rid].total++;
                }
            });

            // Expected renewals: expired approved passengers still on a bus who have not renewed for target year
            mongoStudents.forEach((r) => {
                if (!r.is_expired) return;
                if (r.not_interested) return; // Exclude not interested
                const adm = String(r.admission_number || '').trim();
                if (!adm || renewedSet.has(adm)) return;
                if (r.bus_id && busNumbers.includes(r.bus_id)) {
                    expectedRenewalsByBus[r.bus_id] = (expectedRenewalsByBus[r.bus_id] || 0) + 1;
                }
            });

            activeEmployees.forEach((r) => {
                if (r.bus_id && busNumbers.includes(r.bus_id)) {
                    employeeCountsByBus[r.bus_id] = (employeeCountsByBus[r.bus_id] || 0) + 1;
                } else {
                    unassignedEmployeesCount++;
                    const rid = r.route_id || 'Unknown';
                    if (!unassignedRouteBreakdown[rid]) {
                        unassignedRouteBreakdown[rid] = { routeId: rid, routeName: allRouteMap[rid] || rid, students: 0, employees: 0, total: 0 };
                    }
                    unassignedRouteBreakdown[rid].employees++;
                    unassignedRouteBreakdown[rid].total++;
                }
            });

            busNumbers.forEach((bn) => {
                counts[bn] = (studentCountsByBus[bn] || 0) + (employeeCountsByBus[bn] || 0);
            });
        } else {
            activeStudents.forEach((r) => {
                unassignedStudentsCount++;
                const rid = r.route_id || 'Unknown';
                if (!unassignedRouteBreakdown[rid]) {
                    unassignedRouteBreakdown[rid] = { routeId: rid, routeName: allRouteMap[rid] || rid, students: 0, employees: 0, total: 0 };
                }
                unassignedRouteBreakdown[rid].students++;
                unassignedRouteBreakdown[rid].total++;
            });
            activeEmployees.forEach((r) => {
                unassignedEmployeesCount++;
                const rid = r.route_id || 'Unknown';
                if (!unassignedRouteBreakdown[rid]) {
                    unassignedRouteBreakdown[rid] = { routeId: rid, routeName: allRouteMap[rid] || rid, students: 0, employees: 0, total: 0 };
                }
                unassignedRouteBreakdown[rid].employees++;
                unassignedRouteBreakdown[rid].total++;
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
                route: route ? { routeId: route.routeId, routeName: route.routeName, zone: route.zone } : null,
                seatsFilled,
                seatsAvailable,
                capacity,
                occupancyPercent,
                expectedRenewals: expectedRenewalsByBus[bus.busNumber] || 0,
            };
        });
        res.json({ 
            academicYear, 
            occupancyMode: liveOccupancy ? 'live' : 'academicYear', 
            buses: list,
            unassignedPassengerCount: unassignedStudentsCount + unassignedEmployeesCount,
            unassignedStudentsCount,
            unassignedEmployeesCount,
            unassignedRouteBreakdown: Object.values(unassignedRouteBreakdown)
        });
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

        const studentFilled = await TransportRequest.countDocuments({
            bus_id: bus.busNumber,
            status: 'approved',
        });
        const employeeFilled = await EmployeeTransportRequest.countDocuments({
            bus_id: bus.busNumber,
            status: 'approved',
        });
        const currentFilled = Number(studentFilled || 0) + Number(employeeFilled || 0);
        const slotsLeft = Math.max(0, capacity - currentFilled);
        if (slotsLeft === 0) {
            return res.json({ message: 'Bus is already full.', allocated: 0, seatsFilled: currentFilled, capacity });
        }

        const unassignedMongoRequests = await TransportRequest.find({
            route_id: bus.assignedRouteId,
            status: 'approved',
            $or: [{ bus_id: null }, { bus_id: '' }],
        })
            .sort({ request_date: 1, _id: 1 })
            .limit(slotsLeft);

        for (const doc of unassignedMongoRequests) {
            doc.bus_id = bus.busNumber;
            await doc.save();
        }
        const allocated = unassignedMongoRequests.length;
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
            query = campusService.buildCampusFilter(req.user, req.query.campus);
        } else if (req.query.campus) {
            query.campus = campusService.normalizeCampusId(req.query.campus);
        }
        const buses = await Bus.find(query);
        const busesWithCampus = await campusService.attachCampusToDocs(buses);
        res.json(busesWithCampus);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a bus
// @route   POST /api/buses
// @access  Private/Admin
const createBus = async (req, res) => {
    try {
        if (req.body.status === 'Inactive' && req.body.assignedRouteId) {
            return res.status(400).json({ message: 'Inactive buses cannot be assigned to a route.' });
        }
        if (req.body.assignedRouteId) {
            const existingBus = await Bus.findOne({ assignedRouteId: req.body.assignedRouteId });
            if (existingBus) {
                return res.status(400).json({ message: `Route is already assigned to bus ${existingBus.busNumber}` });
            }
        }
        const bus = new Bus(req.body);
        const createdBus = await bus.save();
        res.status(201).json(createdBus);
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// Helper function to sync approved transport requests when bus-route mapping changes
const syncPassengersToBusMapping = async () => {
    try {
        const TransportRequest = require('../models/TransportRequest');
        const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
        const Route = require('../models/Route');

        // 1. Get all buses and their assignedRouteId
        const buses = await Bus.find({}).lean();
        
        // 2. Build a map of routeId -> busNumber
        const routeToBus = {};
        buses.forEach(b => {
            if (b.assignedRouteId) {
                routeToBus[b.assignedRouteId] = b.busNumber;
            }
        });

        // 3. Get all approved student requests and resolve expiries dynamically
        const rawStudents = await TransportRequest.find({ status: 'approved' }).lean();
        await resolveStudentExpiries(rawStudents, mysqlPool);
        
        // Match only active students (not expired)
        const activeStudents = rawStudents.filter(s => !s.is_expired);

        // Get all approved employee requests
        const activeEmployees = await EmployeeTransportRequest.find({ status: 'approved' }).lean();

        // 4. Reassign active student requests to their mapped bus
        for (const s of activeStudents) {
            const targetBusNum = routeToBus[s.route_id] || null;
            if (s.bus_id !== targetBusNum) {
                await TransportRequest.updateOne(
                    { _id: s._id },
                    { $set: { bus_id: targetBusNum } }
                );
            }
        }

        // 5. Reassign active employee requests to their mapped bus
        for (const e of activeEmployees) {
            const targetBusNum = routeToBus[e.route_id] || null;
            if (e.bus_id !== targetBusNum) {
                await EmployeeTransportRequest.updateOne(
                    { _id: e._id },
                    { $set: { bus_id: targetBusNum } }
                );
            }
        }

        // 6. For requests whose route_id is invalid (not in routes directory), set bus_id to null
        const routes = await Route.find({}).lean();
        const activeRouteIds = routes.map(r => r.routeId);
        await TransportRequest.updateMany(
            { status: 'approved', route_id: { $nin: activeRouteIds }, bus_id: { $ne: null } },
            { $set: { bus_id: null } }
        );
        await EmployeeTransportRequest.updateMany(
            { status: 'approved', route_id: { $nin: activeRouteIds }, bus_id: { $ne: null } },
            { $set: { bus_id: null } }
        );

        console.log('[Sync] Passenger bus allocations synced successfully to bus-route mapping.');
    } catch (error) {
        console.error('[Sync] Error syncing passengers to bus mapping:', error);
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
        let newRouteId = undefined;
        if (req.body.routeChange) {
            newRouteId = req.body.routeChange.newRouteId || null;
        } else if (req.body.assignedRouteId !== undefined) {
            newRouteId = req.body.assignedRouteId || null;
        }

        const targetStatus = req.body.status || bus.status;
        if (targetStatus === 'Inactive') {
            if (newRouteId) {
                return res.status(400).json({ message: 'Inactive buses cannot be assigned to a route.' });
            }
            if (previousRouteId && !req.body.routeChange && req.body.assignedRouteId === undefined) {
                req.body.assignedRouteId = null;
            }
        }

        if (newRouteId && newRouteId !== previousRouteId) {
            const existingBus = await Bus.findOne({ assignedRouteId: newRouteId, _id: { $ne: bus._id } });
            if (existingBus) {
                return res.status(400).json({ message: `Route is already assigned to bus ${existingBus.busNumber}` });
            }
        }

        const routeToCheck = newRouteId !== undefined ? newRouteId : (bus.assignedRouteId || null);
        if (routeToCheck) {
            const targetCapacity = req.body.capacity !== undefined ? Number(req.body.capacity) : (bus.capacity || 0);
            
            const rawStudents = await TransportRequest.find({ route_id: routeToCheck, status: 'approved' }).lean();
            await resolveStudentExpiries(rawStudents, mysqlPool);
            const activeStudentsCount = rawStudents.filter(s => {
                const isSameYear = (s.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === (process.env.CURRENT_ACADEMIC_YEAR || '2026-2027');
                return isSameYear || !s.is_expired;
            }).length;

            const rawEmployees = await EmployeeTransportRequest.find({ route_id: routeToCheck, status: 'approved' }).lean();
            const activeEmployeesCount = rawEmployees.filter(e => {
                const isSameYear = (e.academic_year || process.env.CURRENT_ACADEMIC_YEAR || '2026-2027') === (process.env.CURRENT_ACADEMIC_YEAR || '2026-2027');
                return isSameYear || e.status === 'approved';
            }).length;

            const totalRoutePassengers = activeStudentsCount + activeEmployeesCount;
            if (totalRoutePassengers > targetCapacity) {
                return res.status(400).json({ 
                    message: `Capacity exceeded: Bus capacity is ${targetCapacity}, but Route has ${totalRoutePassengers} passenger requests.` 
                });
            }
        }

        const changedBy = getChangedByName(req);
        const { staffChanges } = req.body;

        bus.busNumber = req.body.busNumber || bus.busNumber;
        bus.capacity = req.body.capacity || bus.capacity;
        bus.type = req.body.type || bus.type;
        bus.amenities = req.body.amenities || bus.amenities;
        bus.status = req.body.status || bus.status;
        bus.campus = req.body.campus !== undefined
            ? campusService.normalizeCampusId(req.body.campus)
            : bus.campus;

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
            const newRouteIdVal = req.body.routeChange.newRouteId || null;
            if (newRouteIdVal !== previousRouteId) {
                bus.assignedRouteId = newRouteIdVal;
                await recordRouteHistory(bus, previousRouteId, newRouteIdVal, changedBy, {
                    exitDate: req.body.routeChange.exitDate,
                    entryDate: req.body.routeChange.entryDate,
                });
            }
        } else if (req.body.assignedRouteId !== undefined) {
            const newRouteIdVal = req.body.assignedRouteId || null;
            if (newRouteIdVal !== previousRouteId) {
                bus.assignedRouteId = newRouteIdVal;
                await recordRouteHistory(bus, previousRouteId, newRouteIdVal, changedBy);
            }
        }

        const updatedBus = await bus.save();

        // If route assignment changed, run the passenger allocation sync to match the new mapping
        if (newRouteId !== undefined && newRouteId !== previousRouteId) {
            await syncPassengersToBusMapping();
        }

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
            const TransportRequest = require('../models/TransportRequest');
            const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
            
            // Clear passenger bus allocations for the deleted bus
            await TransportRequest.updateMany(
                { bus_id: bus.busNumber },
                { $set: { bus_id: null } }
            );
            await EmployeeTransportRequest.updateMany(
                { bus_id: bus.busNumber },
                { $set: { bus_id: null } }
            );

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
    getMappingPreview,
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
