const express = require('express');
const router = express.Router();
const { getDrivers, getCleaners, searchEmployees } = require('../controllers/employeeController');
const { protect, requirePermission } = require('../middleware/authMiddleware');

router.get('/drivers', protect, requirePermission('bus_management'), getDrivers);
router.get('/cleaners', protect, requirePermission('bus_management'), getCleaners);
router.get('/search', protect, requirePermission('bus_management'), searchEmployees);

module.exports = router;
