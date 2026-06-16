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
    const { name, code, location } = req.body;
    if (!name || !code) {
        return res.status(400).json({ message: 'Campus name and code are required' });
    }

    try {
        const newCampus = new Campus({ name, code, location });
        await newCampus.save();
        res.status(201).json(newCampus);
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Campus name or code already exists' });
        }
        res.status(500).json({ message: error.message || 'Failed to create campus' });
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
    deleteCampus
};
