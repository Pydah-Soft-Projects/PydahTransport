const Route = require('../models/Route');
const Bus = require('../models/Bus');
const OtherVehicle = require('../models/OtherVehicle');
const UserRole = require('../models/UserRole');
const campusService = require('../services/campusService');

const getCampuses = async (req, res) => {
    try {
        let campuses = await campusService.getAllCampuses();
        const isSuperAdmin = req.user?.roles?.includes('superadmin');
        if (!isSuperAdmin && req.user?.campuses?.length > 0) {
            const allowed = campusService.normalizeCampusIds(req.user.campuses);
            campuses = campuses.filter((campus) => allowed.includes(campus.id));
        }
        res.json(campuses);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch campuses' });
    }
};

const createCampus = async (req, res) => {
    const { name, code, description, location, colleges, collegeIds } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: 'Campus name and code are required' });
    }

    try {
        const campus = await campusService.createCampus({
            name,
            code,
            description: description || location || '',
            colleges: colleges || [],
            collegeIds: collegeIds || []
        });
        res.status(201).json(campus);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Campus name or code already exists' });
        }
        res.status(500).json({ message: error.message || 'Failed to create campus' });
    }
};

const updateCampus = async (req, res) => {
    const { id } = req.params;
    const { name, code, description, location, colleges, collegeIds } = req.body;

    if (!name || !code) {
        return res.status(400).json({ message: 'Campus name and code are required' });
    }

    try {
        const campus = await campusService.updateCampus(id, {
            name,
            code,
            description: description !== undefined ? description : location,
            colleges,
            collegeIds
        });

        if (!campus) {
            return res.status(404).json({ message: 'Campus not found' });
        }

        res.json(campus);
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({ message: 'Campus name or code already exists' });
        }
        res.status(500).json({ message: error.message || 'Failed to update campus' });
    }
};

const getCollegesForCampuses = async (campusIds) => campusService.getCollegesForCampuses(campusIds);

const deleteCampus = async (req, res) => {
    const campusId = campusService.normalizeCampusId(req.params.id);
    if (campusId === null) {
        return res.status(400).json({ message: 'Invalid campus id' });
    }

    try {
        const campus = await campusService.getCampusById(campusId);
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found' });
        }

        const [routeCount, busCount, vehicleCount, userCount] = await Promise.all([
            Route.countDocuments({ campus: campusId }),
            Bus.countDocuments({ campus: campusId }),
            OtherVehicle.countDocuments({ campus: campusId }),
            UserRole.countDocuments({ campuses: campusId })
        ]);

        if (routeCount > 0 || busCount > 0 || vehicleCount > 0 || userCount > 0) {
            return res.status(400).json({
                message: 'Cannot delete campus. It is mapped to existing routes, vehicles, or users.'
            });
        }

        await campusService.deleteCampus(campusId);
        res.json({ message: 'Campus deleted successfully' });
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to delete campus' });
    }
};

module.exports = {
    getCampuses,
    createCampus,
    deleteCampus,
    updateCampus,
    getCollegesForCampuses
};
