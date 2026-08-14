const Route = require('../models/Route');
const Bus = require('../models/Bus');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const {
    resolveStageForAcademicYear,
    normalizeStagesForSave,
    normalizeAcademicYear,
} = require('../utils/stageFare');
const campusService = require('../services/campusService');

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
        const payload = {
            ...req.body,
            campus: campusService.normalizeCampusId(req.body.campus),
            stages: normalizeStagesForSave(req.body.stages, editingAcademicYear),
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
                route.stages = normalizeStagesForSave(req.body.stages, editingAcademicYear);
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
    getGlobalMappingHistory
};

