const express = require('express');
const router = express.Router();
const { getUsers, updateUserRole, deleteUserRole, searchEmployees, updateSuperAdmin } = require('../controllers/userController');

// Middleware to protect routes could be added here
const { protect, admin, requirePermission } = require('../middleware/authMiddleware');

router.get('/search', protect, requirePermission('user_management'), searchEmployees);
router.get('/', protect, requirePermission('user_management'), getUsers);
router.put('/superadmin/:id', protect, admin, updateSuperAdmin);
router.put('/:id/role', protect, requirePermission('user_management'), updateUserRole);
router.delete('/:id/role', protect, requirePermission('user_management'), deleteUserRole);

module.exports = router;
