const Route = require('../models/Route');
const {
    resolveStageForAcademicYear,
    normalizeStagesForSave,
    normalizeAcademicYear,
} = require('../utils/stageFare');

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
            const isSuperAdmin = req.user.roles && req.user.roles.includes('superadmin');
            if (!isSuperAdmin && req.user.campuses && req.user.campuses.length > 0) {
                query.campus = { $in: req.user.campuses };
            }
        }

        const routes = await Route.find(query).populate('campus');
        res.json(routes.map((route) => serializeRoute(route, academicYear || null)));
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
            stages: normalizeStagesForSave(req.body.stages, editingAcademicYear),
        };
        delete payload.editingAcademicYear;
        delete payload.academicYear;

        const route = new Route(payload);
        const createdRoute = await route.save();
        const populatedRoute = await Route.findById(createdRoute._id).populate('campus');
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
            route.campus = req.body.campus !== undefined ? (req.body.campus || null) : route.campus;
            if (req.body.stages) {
                route.stages = normalizeStagesForSave(req.body.stages, editingAcademicYear);
                route.markModified('stages');
            }

            const updatedRoute = await route.save();
            const populatedRoute = await Route.findById(updatedRoute._id).populate('campus');
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

