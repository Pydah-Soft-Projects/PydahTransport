const Route = require('../models/Route');
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

module.exports = {
    getRoutes,
    createRoute,
    updateRoute,
    deleteRoute
};

