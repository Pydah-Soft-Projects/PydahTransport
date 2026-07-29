const Route = require('../models/Route');
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
            route.routeId = req.body.routeId || route.routeId;
            route.routeName = req.body.routeName || route.routeName;
            route.startPoint = req.body.startPoint || route.startPoint;
            route.endPoint = req.body.endPoint || route.endPoint;
            route.totalDistance = req.body.totalDistance || route.totalDistance;
            route.estimatedTime = req.body.estimatedTime || route.estimatedTime;
            route.campus = req.body.campus !== undefined
                ? campusService.normalizeCampusId(req.body.campus)
                : route.campus;
            if (req.body.stages) {
                route.stages = normalizeStagesForSave(req.body.stages, editingAcademicYear);
                route.markModified('stages');
            }

            const updatedRoute = await route.save();
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
                    bus_id: null, // clear allocated bus
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
                    bus_id: null
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
                    bus_id: null,
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
                    bus_id: null
                }
            }
        );

        res.json({
            message: `Stage "${stageName}" and its passengers successfully transferred to route "${destRoute.routeName}" (${destinationRouteId}).`,
            affectedStudentsCount: (studentApprovedResult.modifiedCount || 0) + (studentPendingResult.modifiedCount || 0),
            affectedEmployeesCount: (employeeApprovedResult.modifiedCount || 0) + (employeePendingResult.modifiedCount || 0)
        });
    } catch (error) {
        console.error('Error transferring stage:', error);
        res.status(500).json({ message: error.message });
    }
};

module.exports = {
    getRoutes,
    createRoute,
    updateRoute,
    deleteRoute,
    getTransferPreview,
    transferStage
};

