const Route = require('../models/Route');
const Bus = require('../models/Bus');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const GpsFinalDestination = require('../models/GpsFinalDestination');
const {
    resolveStageForAcademicYear,
    normalizeStagesForSave,
    normalizeAcademicYear,
    calculateDistanceKm,
} = require('../utils/stageFare');
const campusService = require('../services/campusService');

async function enrichStagesDistanceToDestination(stages, campusId, routeTotalDistance = 0) {
    if (!Array.isArray(stages) || stages.length === 0) return stages;

    let destLat = null;
    let destLng = null;

    if (campusId != null) {
        const parsedCampus = typeof campusId === 'object' ? (campusId._id || campusId.code) : campusId;
        const dest = await GpsFinalDestination.findOne({ campus: Number(parsedCampus), isActive: true }).lean();
        if (dest && Number.isFinite(dest.latitude) && Number.isFinite(dest.longitude)) {
            destLat = dest.latitude;
            destLng = dest.longitude;
        }
    }

    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        for (let i = stages.length - 1; i >= 0; i--) {
            const st = stages[i];
            if (Number.isFinite(st?.latitude) && Number.isFinite(st?.longitude)) {
                destLat = st.latitude;
                destLng = st.longitude;
                break;
            }
        }
    }

    const lastStageFromStart = Number(stages[stages.length - 1]?.distanceFromStart) || 0;
    const totalDist = Number(routeTotalDistance) || lastStageFromStart;

    // Precalculate cumulative distances along stage coordinates (or linear fallback)
    let cumulativeDistances = [0];
    let runningDist = 0;
    for (let i = 1; i < stages.length; i++) {
        const prev = stages[i - 1];
        const curr = stages[i];
        const pLat = Number(prev?.latitude);
        const pLng = Number(prev?.longitude);
        const cLat = Number(curr?.latitude);
        const cLng = Number(curr?.longitude);

        if (Number.isFinite(pLat) && Number.isFinite(pLng) && Number.isFinite(cLat) && Number.isFinite(cLng)) {
            runningDist += calculateDistanceKm(pLat, pLng, cLat, cLng);
        } else if (totalDist > 0 && stages.length > 1) {
            runningDist += totalDist / (stages.length - 1);
        }
        cumulativeDistances.push(Math.round(runningDist * 100) / 100);
    }

    return stages.map((st, index) => {
        const lat = Number(st.latitude);
        const lng = Number(st.longitude);

        const fromStart = index === 0 ? 0 : (cumulativeDistances[index] ?? Number(st.distanceFromStart) ?? 0);

        let computedDist = null;
        if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(destLat) && Number.isFinite(destLng)) {
            computedDist = calculateDistanceKm(lat, lng, destLat, destLng);
        }

        if (computedDist === null) {
            if (Number.isFinite(totalDist) && Number.isFinite(fromStart)) {
                computedDist = Math.max(0, Math.round((totalDist - fromStart) * 100) / 100);
            }
        }

        return {
            ...st,
            distanceFromStart: fromStart,
            distanceToDestination: computedDist != null ? computedDist : st.distanceToDestination,
        };
    });
}

function serializeRoute(route, academicYear = null) {
    const plain = route.toObject ? route.toObject() : route;
    const normalizedYear = normalizeAcademicYear(academicYear);
    if (!normalizedYear) return plain;

    return {
        ...plain,
        academicYear: normalizedYear,
        stages: (plain.stages || []).map((stage) => resolveStageForAcademicYear(stage, normalizedYear)),
    };
}

// @desc    Get all routes (optional academicYear resolves stage fares for that session)
// @route   GET /api/routes
// @access  Public
const getRoutes = async (req, res) => {
    try {
        const academicYear = normalizeAcademicYear(req.query.academicYear || req.query.academic_year || '');
        
        let query = {};
        if (req.user) {
            query = campusService.buildCampusFilter(req.user, req.query.campus);
        } else if (req.query.campus) {
            query.campus = campusService.normalizeCampusId(req.query.campus);
        }

        const routes = await Route.find(query);
        const routesWithCampus = await campusService.attachCampusToDocs(routes);
        res.json(routesWithCampus.map((route) => serializeRoute(route, academicYear || null)));
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Create a route
// @route   POST /api/routes
// @access  Private/Admin
const createRoute = async (req, res) => {
    try {
        const editingAcademicYear = normalizeAcademicYear(
            req.body.editingAcademicYear || req.body.academicYear || ''
        );
        const campusId = campusService.normalizeCampusId(req.body.campus);
        const normalizedStages = normalizeStagesForSave(req.body.stages, editingAcademicYear);
        const enrichedStages = await enrichStagesDistanceToDestination(normalizedStages, campusId, req.body.totalDistance);

        const payload = {
            ...req.body,
            campus: campusId,
            stages: enrichedStages,
        };
        delete payload.editingAcademicYear;
        delete payload.academicYear;

        const route = new Route(payload);
        const createdRoute = await route.save();
        const populatedRoute = await campusService.attachCampusToDoc(createdRoute);
        res.status(201).json(serializeRoute(populatedRoute, editingAcademicYear));
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Update a route
// @route   PUT /api/routes/:id
// @access  Private/Admin
const updateRoute = async (req, res) => {
    try {
        const route = await Route.findById(req.params.id);
        const editingAcademicYear = normalizeAcademicYear(
            req.body.editingAcademicYear || req.body.academicYear || ''
        );

        if (route) {
            const nameChanged = req.body.routeName && req.body.routeName !== route.routeName;
            const idChanged = req.body.routeId && req.body.routeId !== route.routeId;
            const oldRouteId = route.routeId;

            route.routeId = req.body.routeId || route.routeId;
            route.routeName = req.body.routeName || route.routeName;
            route.startPoint = req.body.startPoint || route.startPoint;
            route.endPoint = req.body.endPoint || route.endPoint;
            route.totalDistance = req.body.totalDistance || route.totalDistance;
            route.estimatedTime = req.body.estimatedTime || route.estimatedTime;
            route.campus = req.body.campus !== undefined
                ? campusService.normalizeCampusId(req.body.campus)
                : route.campus;
            route.zone = req.body.zone !== undefined ? req.body.zone : route.zone;
            if (req.body.stages) {
                const normalizedStages = normalizeStagesForSave(req.body.stages, editingAcademicYear);
                route.stages = await enrichStagesDistanceToDestination(normalizedStages, route.campus, route.totalDistance);
                route.markModified('stages');
            }

            const updatedRoute = await route.save();

            if (nameChanged || idChanged) {
                const updatePayload = {};
                if (nameChanged) updatePayload.route_name = route.routeName;
                if (idChanged) updatePayload.route_id = route.routeId;

                await TransportRequest.updateMany({ route_id: oldRouteId }, { $set: updatePayload });
                await EmployeeTransportRequest.updateMany({ route_id: oldRouteId }, { $set: updatePayload });
            }

            const populatedRoute = await campusService.attachCampusToDoc(updatedRoute);
            res.json(serializeRoute(populatedRoute, editingAcademicYear));
        } else {
            res.status(404).json({ message: 'Route not found' });
        }
    } catch (error) {
        res.status(400).json({ message: error.message });
    }
};

// @desc    Delete a route
// @route   DELETE /api/routes/:id
// @access  Private/Admin
const deleteRoute = async (req, res) => {
    try {
        const route = await Route.findById(req.params.id);

        if (route) {
            await route.deleteOne();
            res.json({ message: 'Route removed' });
        } else {
            res.status(404).json({ message: 'Route not found' });
        }
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get counts of affected passengers for stage transfer
// @route   GET /api/routes/transfer-preview
// @access  Private/Admin
const getTransferPreview = async (req, res) => {
    const { sourceRouteId, stageName, academicYear } = req.query;
    if (!sourceRouteId || !stageName) {
        return res.status(400).json({ message: 'sourceRouteId and stageName are required' });
    }

    try {
        const query = {
            route_id: sourceRouteId,
            stage_name: stageName,
            status: 'approved'
        };
        if (academicYear) {
            query.academic_year = academicYear;
        }

        const students = await TransportRequest.find(
            query, 
            'student_name admission_number status'
        ).lean();

        const employees = await EmployeeTransportRequest.find(
            query, 
            'employee_name emp_no status'
        ).lean();

        const passengers = [
            ...students.map(s => ({
                name: s.student_name,
                id: s.admission_number,
                status: s.status,
                type: 'student'
            })),
            ...employees.map(e => ({
                name: e.employee_name,
                id: e.emp_no,
                status: e.status,
                type: 'employee'
            }))
        ];

        res.json({
            studentCount: students.length,
            employeeCount: employees.length,
            passengers
        });
    } catch (error) {
        console.error('Error fetching stage transfer preview:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Transfer a stage and its associated passengers from one route to another
// @route   POST /api/routes/transfer-stage
// @access  Private/Admin
const transferStage = async (req, res) => {
    const { sourceRouteId, stageName, destinationRouteId, academicYear } = req.body;
    if (!sourceRouteId || !stageName || !destinationRouteId) {
        return res.status(400).json({ message: 'sourceRouteId, stageName, and destinationRouteId are required' });
    }

    if (sourceRouteId === destinationRouteId) {
        return res.status(400).json({ message: 'Source and destination routes must be different' });
    }

    try {
        const sourceRoute = await Route.findOne({ routeId: sourceRouteId });
        const destRoute = await Route.findOne({ routeId: destinationRouteId });

        if (!sourceRoute) {
            return res.status(404).json({ message: `Source route ${sourceRouteId} not found` });
        }
        if (!destRoute) {
            return res.status(404).json({ message: `Destination route ${destinationRouteId} not found` });
        }

        // Find stage in source route
        const stageIndex = sourceRoute.stages.findIndex(s => s.stageName.trim().toLowerCase() === stageName.trim().toLowerCase());
        if (stageIndex === -1) {
            return res.status(404).json({ message: `Stage "${stageName}" not found on source route ${sourceRouteId}` });
        }

        // Check if stage name already exists on destination route
        const destStageExists = destRoute.stages.some(s => s.stageName.trim().toLowerCase() === stageName.trim().toLowerCase());
        if (destStageExists) {
            return res.status(400).json({ message: `Stage "${stageName}" already exists on destination route ${destinationRouteId}` });
        }

        // Get stage subdocument and remove it from source
        const [stageToTransfer] = sourceRoute.stages.splice(stageIndex, 1);
        sourceRoute.markModified('stages');

        // Add stage to destination
        destRoute.stages.push(stageToTransfer);
        destRoute.markModified('stages');

        // Find available buses for destination route
        const availableBusesForDestRoute = await Bus.find({ assignedRouteId: destinationRouteId }).select('busNumber').lean();
        const targetBusId = availableBusesForDestRoute.length > 0 ? availableBusesForDestRoute[0].busNumber : null;

        // Fetch affected passengers for history logging BEFORE updating them
        const queryApproved = { route_id: sourceRouteId, stage_name: stageName, status: 'approved' };
        const queryPending = { route_id: sourceRouteId, stage_name: stageName, status: 'pending' };
        if (academicYear) {
            queryApproved.academic_year = academicYear;
            queryPending.academic_year = academicYear;
        }

        const approvedSts = await TransportRequest.find(queryApproved, 'student_name admission_number status');
        const pendingSts = await TransportRequest.find(queryPending, 'student_name admission_number status');
        const approvedEmps = await EmployeeTransportRequest.find(queryApproved, 'employee_name emp_no status');
        const pendingEmps = await EmployeeTransportRequest.find(queryPending, 'employee_name emp_no status');

        const passengersList = [
            ...approvedSts.map(s => ({ passengerId: s._id.toString(), name: s.student_name, admissionNumber: s.admission_number, type: 'student', status: s.status })),
            ...pendingSts.map(s => ({ passengerId: s._id.toString(), name: s.student_name, admissionNumber: s.admission_number, type: 'student', status: s.status })),
            ...approvedEmps.map(e => ({ passengerId: e._id.toString(), name: e.employee_name, admissionNumber: e.emp_no, type: 'employee', status: e.status })),
            ...pendingEmps.map(e => ({ passengerId: e._id.toString(), name: e.employee_name, admissionNumber: e.emp_no, type: 'employee', status: e.status }))
        ];

        // Save routes
        await sourceRoute.save();
        await destRoute.save();

        // Build query for approved passenger updates (sets new_id_card_needed = true)
        const approvedUpdateQuery = {
            route_id: sourceRouteId,
            stage_name: stageName,
            status: 'approved'
        };
        if (academicYear) approvedUpdateQuery.academic_year = academicYear;

        // Build query for pending passenger updates (leaves new_id_card_needed = false)
        const pendingUpdateQuery = {
            route_id: sourceRouteId,
            stage_name: stageName,
            status: 'pending'
        };
        if (academicYear) pendingUpdateQuery.academic_year = academicYear;

        // Update MongoDB student requests
        const studentApprovedResult = await TransportRequest.updateMany(
            approvedUpdateQuery,
            {
                $set: {
                    route_id: destinationRouteId,
                    route_name: destRoute.routeName,
                    stage_name: stageName, // ensure stage_name is updated for count aggregations
                    bus_id: targetBusId, // assign to available bus on destination route
                    new_id_card_needed: true // flag for reprint
                }
            }
        );
        const studentPendingResult = await TransportRequest.updateMany(
            pendingUpdateQuery,
            {
                $set: {
                    route_id: destinationRouteId,
                    route_name: destRoute.routeName,
                    stage_name: stageName, // ensure stage_name is updated for count aggregations
                    bus_id: targetBusId // assign to available bus on destination route
                }
            }
        );

        // Update MongoDB employee requests
        const employeeApprovedResult = await EmployeeTransportRequest.updateMany(
            approvedUpdateQuery,
            {
                $set: {
                    route_id: destinationRouteId,
                    route_name: destRoute.routeName,
                    stage_name: stageName, // ensure stage_name is updated for count aggregations
                    bus_id: targetBusId, // assign to available bus on destination route
                    new_id_card_needed: true
                }
            }
        );
        const employeePendingResult = await EmployeeTransportRequest.updateMany(
            pendingUpdateQuery,
            {
                $set: {
                    route_id: destinationRouteId,
                    route_name: destRoute.routeName,
                    stage_name: stageName, // ensure stage_name is updated for count aggregations
                    bus_id: targetBusId // assign to available bus on destination route
                }
            }
        );

        // Log to TransferHistory
        if (passengersList.length > 0) {
            const TransferHistory = require('../models/TransferHistory');
            const performedBy = req.user
                ? (req.user.employee_name || req.user.name || req.user.username || 'admin')
                : 'admin';

            await TransferHistory.create({
                type: 'stage',
                sourceRouteId,
                sourceRouteName: sourceRoute.routeName,
                sourceStageName: stageName,
                destinationRouteId,
                destinationRouteName: destRoute.routeName,
                destinationStageName: stageName,
                academicYear,
                passengersCount: passengersList.length,
                passengers: passengersList,
                performedBy
            });
        }

        res.json({
            message: `Stage "${stageName}" and its passengers successfully transferred to route "${destRoute.routeName}" (${destinationRouteId}).${targetBusId ? ` All passengers auto-assigned to bus "${targetBusId}".` : ' Note: No buses assigned to destination route. Passengers remain unassigned.'}`,
            affectedStudentsCount: (studentApprovedResult.modifiedCount || 0) + (studentPendingResult.modifiedCount || 0),
            affectedEmployeesCount: (employeeApprovedResult.modifiedCount || 0) + (employeePendingResult.modifiedCount || 0),
            busAssigned: targetBusId || null
        });

        // SMS runs in background after response — never blocks this action
        const { fireAutoNotification } = require('../services/autoNotificationService');
        fireAutoNotification('transfer_stage', () => ({
            students: passengersList
                .filter((p) => p.type === 'student')
                .map((p) => ({
                    name: p.name,
                    admissionNumber: p.admissionNumber,
                    new_route_id: destinationRouteId,
                    new_route_name: destRoute.routeName,
                    new_stage_name: stageName,
                    new_bus_id: targetBusId || '',
                    old_route_id: sourceRouteId,
                    old_route_name: sourceRoute.routeName,
                    old_stage_name: stageName,
                })),
            employees: passengersList
                .filter((p) => p.type === 'employee')
                .map((p) => ({
                    name: p.name,
                    admissionNumber: p.admissionNumber,
                    new_route_id: destinationRouteId,
                    new_route_name: destRoute.routeName,
                    new_stage_name: stageName,
                    new_bus_id: targetBusId || '',
                    old_route_id: sourceRouteId,
                    old_route_name: sourceRoute.routeName,
                    old_stage_name: stageName,
                })),
            extraParams: {
                old_route_id: sourceRouteId,
                new_route_id: destinationRouteId,
                old_route_name: sourceRoute.routeName,
                new_route_name: destRoute.routeName,
                old_stage_name: stageName,
                new_stage_name: stageName,
                new_bus_id: targetBusId || '',
            },
        }));
    } catch (error) {
        console.error('Error transferring stage:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get passenger list for a route and optional stage
// @route   GET /api/routes/passengers
// @access  Private/Admin
const getRoutePassengers = async (req, res) => {
    const { routeId, stageName, academicYear } = req.query;
    if (!routeId) {
        return res.status(400).json({ message: 'routeId is required' });
    }

    try {
        const query = {
            route_id: routeId,
            status: { $in: ['approved', 'pending'] }
        };
        if (stageName) {
            query.stage_name = stageName;
        }
        if (academicYear) {
            query.academic_year = academicYear;
        }

        const students = await TransportRequest.find(
            query,
            'student_name admission_number status route_id route_name stage_name bus_id new_id_card_needed'
        ).lean();

        const employees = await EmployeeTransportRequest.find(
            query,
            'employee_name emp_no status route_id route_name stage_name bus_id new_id_card_needed'
        ).lean();

        const passengers = [
            ...students.map(s => ({
                _id: s._id.toString(),
                name: s.student_name,
                admissionNumber: s.admission_number,
                type: 'student',
                status: s.status,
                route_id: s.route_id,
                route_name: s.route_name,
                stage_name: s.stage_name,
                bus_id: s.bus_id,
                new_id_card_needed: s.new_id_card_needed || false
            })),
            ...employees.map(e => ({
                _id: e._id.toString(),
                name: e.employee_name,
                admissionNumber: e.emp_no,
                type: 'employee',
                status: e.status,
                route_id: e.route_id,
                route_name: e.route_name,
                stage_name: e.stage_name,
                bus_id: e.bus_id,
                new_id_card_needed: e.new_id_card_needed || false
            }))
        ];

        res.json({ passengers });
    } catch (error) {
        console.error('Error fetching route passengers:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Transfer selected group of passengers to another route and stage
// @route   POST /api/routes/transfer-passengers
// @access  Private/Admin
const transferPassengers = async (req, res) => {
    const { passengers, destinationRouteId, destinationStageName, academicYear } = req.body;
    if (!passengers || !Array.isArray(passengers) || passengers.length === 0) {
        return res.status(400).json({ message: 'passengers array is required and must not be empty' });
    }
    if (!destinationRouteId || !destinationStageName) {
        return res.status(400).json({ message: 'destinationRouteId and destinationStageName are required' });
    }

    try {
        const destRoute = await Route.findOne({ routeId: destinationRouteId });
        if (!destRoute) {
            return res.status(404).json({ message: `Destination route ${destinationRouteId} not found` });
        }

        // Check if stage name exists on destination route and read the fare
        const destStage = destRoute.stages.find(s => s.stageName.trim().toLowerCase() === destinationStageName.trim().toLowerCase());
        if (!destStage) {
            return res.status(404).json({ message: `Stage "${destinationStageName}" not found on destination route ${destinationRouteId}` });
        }
        const newFare = destStage.fare || 0;

        let studentCount = 0;
        let employeeCount = 0;
        const passengersList = [];
        let sourceRouteId = '';
        let sourceRouteName = '';
        let sourceStageName = '';

        for (const p of passengers) {
            if (!p.id || !p.type) continue;

            if (p.type === 'student') {
                const doc = await TransportRequest.findById(p.id);
                if (doc) {
                    if (!sourceRouteId) {
                        sourceRouteId = doc.route_id;
                        sourceRouteName = doc.route_name;
                        sourceStageName = doc.stage_name;
                    }
                    passengersList.push({
                        passengerId: doc._id.toString(),
                        name: doc.student_name,
                        admissionNumber: doc.admission_number,
                        type: 'student',
                        status: doc.status
                    });

                    doc.route_id = destinationRouteId;
                    doc.route_name = destRoute.routeName;
                    doc.stage_name = destinationStageName;
                    doc.bus_id = null; // Clear old bus allocation
                    if (doc.status === 'approved') {
                        doc.fare = newFare;
                        doc.new_id_card_needed = true; // Mark for reprint
                    }
                    await doc.save();
                    studentCount++;
                }
            } else if (p.type === 'employee') {
                const doc = await EmployeeTransportRequest.findById(p.id);
                if (doc) {
                    if (!sourceRouteId) {
                        sourceRouteId = doc.route_id;
                        sourceRouteName = doc.route_name;
                        sourceStageName = doc.stage_name;
                    }
                    passengersList.push({
                        passengerId: doc._id.toString(),
                        name: doc.employee_name,
                        admissionNumber: doc.emp_no,
                        type: 'employee',
                        status: doc.status
                    });

                    doc.route_id = destinationRouteId;
                    doc.route_name = destRoute.routeName;
                    doc.stage_name = destinationStageName;
                    doc.bus_id = null; // Clear old bus allocation
                    if (doc.status === 'approved') {
                        doc.new_id_card_needed = true; // Mark for reprint
                    }
                    await doc.save();
                    employeeCount++;
                }
            }
        }

        // Log to TransferHistory
        if (passengersList.length > 0) {
            const TransferHistory = require('../models/TransferHistory');
            const performedBy = req.user
                ? (req.user.employee_name || req.user.name || req.user.username || 'admin')
                : 'admin';

            await TransferHistory.create({
                type: 'passenger',
                sourceRouteId: sourceRouteId || 'unknown',
                sourceRouteName: sourceRouteName || 'unknown',
                sourceStageName: sourceStageName || 'unknown',
                destinationRouteId,
                destinationRouteName: destRoute.routeName,
                destinationStageName,
                academicYear,
                passengersCount: passengersList.length,
                passengers: passengersList,
                performedBy
            });
        }

        res.json({
            message: `Successfully transferred ${studentCount + employeeCount} passenger(s) to route "${destRoute.routeName}" (${destinationRouteId}), stage "${destinationStageName}".`,
            transferredStudents: studentCount,
            transferredEmployees: employeeCount
        });

        // SMS runs in background after response — never blocks this action
        const { fireAutoNotification } = require('../services/autoNotificationService');
        fireAutoNotification('transfer_passengers', () => ({
            students: passengersList
                .filter((p) => p.type === 'student')
                .map((p) => ({
                    name: p.name,
                    admissionNumber: p.admissionNumber,
                    new_route_id: destinationRouteId,
                    new_route_name: destRoute.routeName,
                    new_stage_name: destinationStageName,
                    old_route_id: sourceRouteId || '',
                    old_route_name: sourceRouteName || '',
                    old_stage_name: sourceStageName || '',
                })),
            employees: passengersList
                .filter((p) => p.type === 'employee')
                .map((p) => ({
                    name: p.name,
                    admissionNumber: p.admissionNumber,
                    new_route_id: destinationRouteId,
                    new_route_name: destRoute.routeName,
                    new_stage_name: destinationStageName,
                    old_route_id: sourceRouteId || '',
                    old_route_name: sourceRouteName || '',
                    old_stage_name: sourceStageName || '',
                })),
            extraParams: {
                old_route_id: sourceRouteId || '',
                new_route_id: destinationRouteId,
                old_route_name: sourceRouteName || '',
                new_route_name: destRoute.routeName,
                old_stage_name: sourceStageName || '',
                new_stage_name: destinationStageName,
            },
        }));
    } catch (error) {
        console.error('Error transferring passengers:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get transfer history logs
// @route   GET /api/routes/transfer-history
// @access  Private/Admin
const getTransferHistory = async (req, res) => {
    try {
        const TransferHistory = require('../models/TransferHistory');
        const history = await TransferHistory.find().sort({ timestamp: -1 }).limit(100);
        res.json({ history });
    } catch (error) {
        console.error('Error fetching transfer history:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Get global bus route mapping history logs
// @route   GET /api/routes/mapping-history
// @access  Private/Admin
const getGlobalMappingHistory = async (req, res) => {
    try {
        const BusRouteHistory = require('../models/BusRouteHistory');
        const history = await BusRouteHistory.find().sort({ createdAt: -1 }).limit(100);
        res.json({ history });
    } catch (error) {
        console.error('Error fetching global mapping history:', error);
        res.status(500).json({ message: error.message });
    }
};

// @desc    Execute batch draft transfers (stage migrations and passenger transfers)
// @route   POST /api/routes/batch-transfer
// @access  Private/Admin
const batchTransfer = async (req, res) => {
    const { draftQueue, academicYear } = req.body;
    if (!draftQueue || !Array.isArray(draftQueue) || draftQueue.length === 0) {
        return res.status(400).json({ message: 'draftQueue array is required and must not be empty' });
    }

    try {
        const TransferHistory = require('../models/TransferHistory');
        const { fireAutoNotification, fireBusMappingNotification } = require('../services/autoNotificationService');
        const { syncPassengersToBusMapping, recordRouteHistory } = require('./busController');
        const performedBy = req.user
            ? (req.user.employee_name || req.user.name || req.user.username || 'admin')
            : (req.body.performedBy || 'admin');

        // 1. Perform overall capacity re-validation before executing any transfer using exact state simulation
        const affectedRouteIds = new Set();
        for (const item of draftQueue) {
            if (item.sourceRouteId) affectedRouteIds.add(item.sourceRouteId);
            if (item.destinationRouteId) affectedRouteIds.add(item.destinationRouteId);
        }

        const routeCapacityErrors = [];

        if (affectedRouteIds.size > 0) {
            const affectedRoutesList = Array.from(affectedRouteIds);
            const queryYear = academicYear ? { academic_year: academicYear } : {};

            // Fetch live buses
            const allBuses = await Bus.find({ status: 'Active' }).lean();

            // Fetch live passengers for affected routes
            const liveStudents = await TransportRequest.find({
                route_id: { $in: affectedRoutesList },
                status: { $in: ['approved', 'pending'] },
                ...queryYear
            }, '_id student_name admission_number route_id stage_name status').lean();

            const liveEmployees = await EmployeeTransportRequest.find({
                route_id: { $in: affectedRoutesList },
                status: { $in: ['approved', 'pending'] },
                ...queryYear
            }, '_id employee_name emp_no route_id stage_name status').lean();

            // Map passenger ID -> { routeId, stageName }
            const passengerSimMap = new Map();
            for (const s of liveStudents) {
                passengerSimMap.set(String(s._id), { routeId: s.route_id, stageName: s.stage_name || '' });
            }
            for (const e of liveEmployees) {
                passengerSimMap.set(String(e._id), { routeId: e.route_id, stageName: e.stage_name || '' });
            }

            // Map bus ID -> assignedRouteId
            const busSimMap = new Map();
            for (const b of allBuses) {
                busSimMap.set(String(b._id), b.assignedRouteId || null);
            }

            // Replay draftQueue actions sequentially to determine exact final state
            for (const item of draftQueue) {
                if (item.type === 'bus_attach') {
                    const targetBus = item.busId ? allBuses.find(b => String(b._id) === String(item.busId)) : allBuses.find(b => b.busNumber === item.busNumber);
                    if (targetBus) {
                        busSimMap.set(String(targetBus._id), item.destinationRouteId);
                    }
                } else if (item.type === 'bus_detach') {
                    const targetBus = item.busId ? allBuses.find(b => String(b._id) === String(item.busId)) : allBuses.find(b => b.busNumber === item.busNumber);
                    if (targetBus) {
                        busSimMap.set(String(targetBus._id), null);
                    }
                } else if (item.type === 'stage') {
                    const normStageName = (item.stageName || '').trim().toLowerCase();
                    for (const [pId, pData] of passengerSimMap.entries()) {
                        if (pData.routeId === item.sourceRouteId && pData.stageName.trim().toLowerCase() === normStageName) {
                            passengerSimMap.set(pId, { routeId: item.destinationRouteId, stageName: item.stageName });
                        }
                    }
                } else if (item.type === 'passenger') {
                    if (item.passengers && Array.isArray(item.passengers)) {
                        for (const p of item.passengers) {
                            const pId = String(p.id || p._id || p.passengerId);
                            if (pId) {
                                passengerSimMap.set(pId, { routeId: item.destinationRouteId, stageName: item.destinationStageName || '' });
                            }
                        }
                    }
                }
            }

            // Calculate final capacity & passenger count for each affected route
            for (const routeId of affectedRoutesList) {
                const routeObj = await Route.findOne({ routeId });
                const routeName = routeObj ? routeObj.routeName : routeId;

                // Total bus capacity for this route after simulation
                let effectiveCapacity = 0;
                for (const b of allBuses) {
                    if (busSimMap.get(String(b._id)) === routeId) {
                        effectiveCapacity += Number(b.capacity || 0);
                    }
                }

                // Total passengers for this route after simulation
                let projectedPassengers = 0;
                for (const pData of passengerSimMap.values()) {
                    if (pData.routeId === routeId) {
                        projectedPassengers++;
                    }
                }

                if (effectiveCapacity > 0 && projectedPassengers > effectiveCapacity) {
                    const excess = projectedPassengers - effectiveCapacity;
                    routeCapacityErrors.push(
                        `Route "${routeName}" (${routeId}) capacity exceeded by ${excess} seat(s)! (Bus Capacity: ${effectiveCapacity}, Projected Passengers: ${projectedPassengers})`
                    );
                }
            }
        }

        if (routeCapacityErrors.length > 0) {
            return res.status(400).json({
                message: `Batch validation failed: ${routeCapacityErrors.join('; ')}`,
                errors: routeCapacityErrors
            });
        }

        // 2. Execute all transfers in sequence
        let totalStagesTransferred = 0;
        let totalStudentsTransferred = 0;
        let totalEmployeesTransferred = 0;
        let totalBusesAttached = 0;
        let totalBusesDetached = 0;
        const executionLogs = [];

        for (const item of draftQueue) {
            if (item.type === 'stage') {
                const { sourceRouteId, stageName, destinationRouteId } = item;
                const sourceRoute = await Route.findOne({ routeId: sourceRouteId });
                const destRoute = await Route.findOne({ routeId: destinationRouteId });

                if (!sourceRoute || !destRoute) continue;

                // Move stage subdocument if present in source
                const stageIndex = sourceRoute.stages.findIndex(s => s.stageName.trim().toLowerCase() === stageName.trim().toLowerCase());
                if (stageIndex !== -1) {
                    const [stageToTransfer] = sourceRoute.stages.splice(stageIndex, 1);
                    sourceRoute.markModified('stages');

                    const destStageExists = destRoute.stages.some(s => s.stageName.trim().toLowerCase() === stageName.trim().toLowerCase());
                    if (!destStageExists) {
                        destRoute.stages.push(stageToTransfer);
                        destRoute.markModified('stages');
                    }

                    await sourceRoute.save();
                    await destRoute.save();
                }

                // Target bus for dest route
                const availableBuses = await Bus.find({ assignedRouteId: destinationRouteId }).select('busNumber').lean();
                const targetBusId = availableBuses.length > 0 ? availableBuses[0].busNumber : null;

                // Fetch passengers
                const queryApproved = { route_id: sourceRouteId, stage_name: stageName, status: 'approved' };
                const queryPending = { route_id: sourceRouteId, stage_name: stageName, status: 'pending' };
                if (academicYear) {
                    queryApproved.academic_year = academicYear;
                    queryPending.academic_year = academicYear;
                }

                const approvedSts = await TransportRequest.find(queryApproved, 'student_name admission_number status');
                const pendingSts = await TransportRequest.find(queryPending, 'student_name admission_number status');
                const approvedEmps = await EmployeeTransportRequest.find(queryApproved, 'employee_name emp_no status');
                const pendingEmps = await EmployeeTransportRequest.find(queryPending, 'employee_name emp_no status');

                const passengersList = [
                    ...approvedSts.map(s => ({ passengerId: s._id.toString(), name: s.student_name, admissionNumber: s.admission_number, type: 'student', status: s.status })),
                    ...pendingSts.map(s => ({ passengerId: s._id.toString(), name: s.student_name, admissionNumber: s.admission_number, type: 'student', status: s.status })),
                    ...approvedEmps.map(e => ({ passengerId: e._id.toString(), name: e.employee_name, admissionNumber: e.emp_no, type: 'employee', status: e.status })),
                    ...pendingEmps.map(e => ({ passengerId: e._id.toString(), name: e.employee_name, admissionNumber: e.emp_no, type: 'employee', status: e.status }))
                ];

                // Update passenger database records
                const approvedUpdateQuery = { route_id: sourceRouteId, stage_name: stageName, status: 'approved' };
                const pendingUpdateQuery = { route_id: sourceRouteId, stage_name: stageName, status: 'pending' };
                if (academicYear) {
                    approvedUpdateQuery.academic_year = academicYear;
                    pendingUpdateQuery.academic_year = academicYear;
                }

                const stApprovedRes = await TransportRequest.updateMany(approvedUpdateQuery, {
                    $set: { route_id: destinationRouteId, route_name: destRoute.routeName, stage_name: stageName, bus_id: targetBusId, new_id_card_needed: true }
                });
                const stPendingRes = await TransportRequest.updateMany(pendingUpdateQuery, {
                    $set: { route_id: destinationRouteId, route_name: destRoute.routeName, stage_name: stageName, bus_id: targetBusId }
                });
                const empApprovedRes = await EmployeeTransportRequest.updateMany(approvedUpdateQuery, {
                    $set: { route_id: destinationRouteId, route_name: destRoute.routeName, stage_name: stageName, bus_id: targetBusId, new_id_card_needed: true }
                });
                const empPendingRes = await EmployeeTransportRequest.updateMany(pendingUpdateQuery, {
                    $set: { route_id: destinationRouteId, route_name: destRoute.routeName, stage_name: stageName, bus_id: targetBusId }
                });

                totalStagesTransferred++;
                totalStudentsTransferred += (stApprovedRes.modifiedCount || 0) + (stPendingRes.modifiedCount || 0);
                totalEmployeesTransferred += (empApprovedRes.modifiedCount || 0) + (empPendingRes.modifiedCount || 0);

                if (passengersList.length > 0) {
                    await TransferHistory.create({
                        type: 'stage',
                        sourceRouteId,
                        sourceRouteName: sourceRoute.routeName,
                        sourceStageName: stageName,
                        destinationRouteId,
                        destinationRouteName: destRoute.routeName,
                        destinationStageName: stageName,
                        academicYear,
                        passengersCount: passengersList.length,
                        passengers: passengersList,
                        performedBy
                    });

                    fireAutoNotification('transfer_stage', () => ({
                        students: passengersList.filter(p => p.type === 'student').map(p => ({
                            name: p.name, admissionNumber: p.admissionNumber, new_route_id: destinationRouteId, new_route_name: destRoute.routeName, new_stage_name: stageName, new_bus_id: targetBusId || '', old_route_id: sourceRouteId, old_route_name: sourceRoute.routeName, old_stage_name: stageName
                        })),
                        employees: passengersList.filter(p => p.type === 'employee').map(p => ({
                            name: p.name, admissionNumber: p.admissionNumber, new_route_id: destinationRouteId, new_route_name: destRoute.routeName, new_stage_name: stageName, new_bus_id: targetBusId || '', old_route_id: sourceRouteId, old_route_name: sourceRoute.routeName, old_stage_name: stageName
                        })),
                        extraParams: { old_route_id: sourceRouteId, new_route_id: destinationRouteId, old_route_name: sourceRoute.routeName, new_route_name: destRoute.routeName, old_stage_name: stageName, new_stage_name: stageName, new_bus_id: targetBusId || '' }
                    }));
                }

                executionLogs.push(`Transferred stage "${stageName}" from ${sourceRoute.routeName} to ${destRoute.routeName}.`);
            } else if (item.type === 'passenger') {
                const { passengers, destinationRouteId, destinationStageName } = item;
                const destRoute = await Route.findOne({ routeId: destinationRouteId });
                if (!destRoute || !passengers || passengers.length === 0) continue;

                const destStage = destRoute.stages.find(s => s.stageName.trim().toLowerCase() === destinationStageName.trim().toLowerCase());
                const newFare = destStage ? (destStage.fare || 0) : 0;

                let stCount = 0;
                let empCount = 0;
                const passengersList = [];
                let sourceRouteId = '';
                let sourceRouteName = '';
                let sourceStageName = '';

                for (const p of passengers) {
                    const pId = p.id || p._id || p.passengerId;
                    if (!pId || !p.type) continue;

                    if (p.type === 'student') {
                        const doc = await TransportRequest.findById(pId);
                        if (doc) {
                            if (!sourceRouteId) {
                                sourceRouteId = doc.route_id;
                                sourceRouteName = doc.route_name;
                                sourceStageName = doc.stage_name;
                            }
                            passengersList.push({ passengerId: doc._id.toString(), name: doc.student_name, admissionNumber: doc.admission_number, type: 'student', status: doc.status });

                            doc.route_id = destinationRouteId;
                            doc.route_name = destRoute.routeName;
                            doc.stage_name = destinationStageName;
                            doc.bus_id = null;
                            if (doc.status === 'approved') {
                                doc.fare = newFare;
                                doc.new_id_card_needed = true;
                            }
                            await doc.save();
                            stCount++;
                        }
                    } else if (p.type === 'employee') {
                        const doc = await EmployeeTransportRequest.findById(pId);
                        if (doc) {
                            if (!sourceRouteId) {
                                sourceRouteId = doc.route_id;
                                sourceRouteName = doc.route_name;
                                sourceStageName = doc.stage_name;
                            }
                            passengersList.push({ passengerId: doc._id.toString(), name: doc.employee_name, admissionNumber: doc.emp_no, type: 'employee', status: doc.status });

                            doc.route_id = destinationRouteId;
                            doc.route_name = destRoute.routeName;
                            doc.stage_name = destinationStageName;
                            doc.bus_id = null;
                            if (doc.status === 'approved') {
                                doc.new_id_card_needed = true;
                            }
                            await doc.save();
                            empCount++;
                        }
                    }
                }

                totalStudentsTransferred += stCount;
                totalEmployeesTransferred += empCount;

                if (passengersList.length > 0) {
                    await TransferHistory.create({
                        type: 'passenger',
                        sourceRouteId: sourceRouteId || 'unknown',
                        sourceRouteName: sourceRouteName || 'unknown',
                        sourceStageName: sourceStageName || 'unknown',
                        destinationRouteId,
                        destinationRouteName: destRoute.routeName,
                        destinationStageName,
                        academicYear,
                        passengersCount: passengersList.length,
                        passengers: passengersList,
                        performedBy
                    });

                    fireAutoNotification('transfer_passengers', () => ({
                        students: passengersList.filter(p => p.type === 'student').map(p => ({
                            name: p.name, admissionNumber: p.admissionNumber, new_route_id: destinationRouteId, new_route_name: destRoute.routeName, new_stage_name: destinationStageName, old_route_id: sourceRouteId || '', old_route_name: sourceRouteName || '', old_stage_name: sourceStageName || ''
                        })),
                        employees: passengersList.filter(p => p.type === 'employee').map(p => ({
                            name: p.name, admissionNumber: p.admissionNumber, new_route_id: destinationRouteId, new_route_name: destRoute.routeName, new_stage_name: destinationStageName, old_route_id: sourceRouteId || '', old_route_name: sourceRouteName || '', old_stage_name: sourceStageName || ''
                        })),
                        extraParams: { old_route_id: sourceRouteId || '', new_route_id: destinationRouteId, old_route_name: sourceRouteName || '', new_route_name: destRoute.routeName, old_stage_name: sourceStageName || '', new_stage_name: destinationStageName }
                    }));
                }

                executionLogs.push(`Transferred ${stCount + empCount} passenger(s) to ${destRoute.routeName}, stage "${destinationStageName}".`);
            } else if (item.type === 'bus_attach') {
                const { busId, busNumber, destinationRouteId, entryDate } = item;
                const bus = await Bus.findOne({ $or: [{ _id: busId }, { busNumber: busNumber }] });
                if (bus) {
                    const previousRouteId = bus.assignedRouteId || null;
                    const newRouteIdVal = destinationRouteId || null;
                    if (newRouteIdVal !== previousRouteId) {
                        bus.assignedRouteId = newRouteIdVal;
                        if (typeof recordRouteHistory === 'function') {
                            await recordRouteHistory(bus, previousRouteId, newRouteIdVal, performedBy, {
                                entryDate: entryDate || new Date()
                            });
                        }
                        await bus.save();
                        fireBusMappingNotification({
                            routeIds: [previousRouteId, newRouteIdVal].filter(Boolean),
                            busNumber: bus.busNumber,
                            previousRouteId,
                            newRouteId: newRouteIdVal
                        });
                        totalBusesAttached++;
                        executionLogs.push(`Attached Bus ${bus.busNumber} to route ${destinationRouteId}.`);
                    }
                }
            } else if (item.type === 'bus_detach') {
                const { busId, busNumber, sourceRouteId, exitDate } = item;
                const bus = await Bus.findOne({ $or: [{ _id: busId }, { busNumber: busNumber }] });
                if (bus) {
                    const previousRouteId = bus.assignedRouteId || sourceRouteId || null;
                    if (previousRouteId) {
                        bus.assignedRouteId = null;
                        if (typeof recordRouteHistory === 'function') {
                            await recordRouteHistory(bus, previousRouteId, null, performedBy, {
                                exitDate: exitDate || new Date()
                            });
                        }
                        await bus.save();
                        fireBusMappingNotification({
                            routeIds: [previousRouteId].filter(Boolean),
                            busNumber: bus.busNumber,
                            previousRouteId,
                            newRouteId: null
                        });
                        totalBusesDetached++;
                        executionLogs.push(`Detached Bus ${bus.busNumber} from route ${previousRouteId}.`);
                    }
                }
            }
        }

        // 3. Re-sync active student and employee transport request bus allocations after bus mapping updates
        if (typeof syncPassengersToBusMapping === 'function') {
            await syncPassengersToBusMapping();
        }

        res.json({
            message: `Batch transfer completed successfully! Finalized ${draftQueue.length} queued action(s). (${totalStagesTransferred} stage(s), ${totalStudentsTransferred} student(s), ${totalEmployeesTransferred} employee(s) moved, ${totalBusesAttached} bus(es) attached, ${totalBusesDetached} bus(es) detached).`,
            transferredStages: totalStagesTransferred,
            transferredStudents: totalStudentsTransferred,
            transferredEmployees: totalEmployeesTransferred,
            attachedBuses: totalBusesAttached,
            detachedBuses: totalBusesDetached,
            logs: executionLogs
        });
    } catch (error) {
        console.error('Error executing batch transfer:', error);
        res.status(500).json({ message: error.message || 'Batch transfer execution failed' });
    }
};

module.exports = {
    getRoutes,
    createRoute,
    updateRoute,
    deleteRoute,
    getTransferPreview,
    transferStage,
    getRoutePassengers,
    transferPassengers,
    getTransferHistory,
    getGlobalMappingHistory,
    batchTransfer
};

