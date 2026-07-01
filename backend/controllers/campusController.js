const Campus = require('../models/Campus');
const Route = require('../models/Route');

// @desc    Get all campuses
// @route   GET /api/campuses
// @access  Private
const getCampuses = async (req, res) => {
    try {
        const campuses = await Campus.find().sort({ name: 1 });
        res.json(campuses);
    } catch (error) {
        res.status(500).json({ message: error.message || 'Failed to fetch campuses' });
    }
};

// @desc    Create a campus
// @route   POST /api/campuses
// @access  Private/Admin
const createCampus = async (req, res) => {
    const { name, code, location, colleges } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: 'Campus name and code are required' });
    }

    try {
        const newCampus = new Campus({ name, code, location, colleges: colleges || [] });
        await newCampus.save();
        res.status(201).json(newCampus);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Campus name or code already exists' });
        }
        res.status(500).json({ message: error.message || 'Failed to create campus' });
    }
};

// @desc    Update a campus
// @route   PUT /api/campuses/:id
// @access  Private/Admin
const updateCampus = async (req, res) => {
    const { id } = req.params;
    const { name, code, location, colleges } = req.body;

    if (!name || !code) {
        return res.status(400).json({ message: 'Campus name and code are required' });
    }

    try {
        const campus = await Campus.findById(id);
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found' });
        }

        campus.name = name;
        campus.code = code;
        campus.location = location !== undefined ? location : campus.location;
        campus.colleges = colleges !== undefined ? colleges : campus.colleges;

        await campus.save();
        res.json(campus);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Campus name or code already exists' });
        }
        res.status(500).json({ message: error.message || 'Failed to update campus' });
    }
};

// Helper to get colleges mapped to campus IDs
const getCollegesForCampuses = async (campusIds) => {
    if (!campusIds || campusIds.length === 0) return [];
    try {
        const campuses = await Campus.find({ _id: { $in: campusIds } });
        const colleges = [];
        campuses.forEach(c => {
            if (c.colleges && c.colleges.length > 0) {
                colleges.push(...c.colleges);
            }
        });
        return [...new Set(colleges)];
    } catch (error) {
        console.error('Error in getCollegesForCampuses:', error);
        return [];
    }
};

// @desc    Delete a campus
// @route   DELETE /api/campuses/:id
// @access  Private/Admin
const deleteCampus = async (req, res) => {
    const { id } = req.params;

    try {
        const campus = await Campus.findById(id);
        if (!campus) {
            return res.status(404).json({ message: 'Campus not found' });
        }

        // Check if any route maps to this campus
        const routeCount = await Route.countDocuments({ campus: id });
        if (routeCount > 0) {
            return res.status(400).json({ message: 'Cannot delete campus. It is mapped to existing route(s).' });
        }

        await campus.deleteOne();
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
