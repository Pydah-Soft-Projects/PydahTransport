const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    startInspection,
    completeInspection,
    listInspectionSessions,
} = require('../controllers/inspectionController');

router.use(protect);
router.get('/', listInspectionSessions);
router.post('/', startInspection);
router.put('/:id/complete', completeInspection);

module.exports = router;
