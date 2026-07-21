const express = require('express');
const router = express.Router();
const { getDrivers, getCleaners, searchEmployees } = require('../controllers/employeeController');
const { protect, admin } = require('../middleware/authMiddleware');

router.get('/drivers', protect, admin, getDrivers);
router.get('/cleaners', protect, admin, getCleaners);
router.get('/search', protect, searchEmployees);

module.exports = router;
