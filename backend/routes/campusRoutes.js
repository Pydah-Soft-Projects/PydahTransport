const express = require('express');
const router = express.Router();
const { getCampuses, createCampus, deleteCampus, updateCampus } = require('../controllers/campusController');
const { protect, admin } = require('../middleware/authMiddleware');

router.route('/')
    .get(protect, getCampuses)
    .post(protect, admin, createCampus);

router.route('/:id')
    .put(protect, admin, updateCampus)
    .delete(protect, admin, deleteCampus);

module.exports = router;
