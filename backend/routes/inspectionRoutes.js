const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    startInspection,
    completeInspection,
    listInspectionSessions,
    recordScan,
    syncInspectionSessions,
} = require('../controllers/inspectionController');

router.use(protect);
router.get('/', listInspectionSessions);
router.post('/sync', syncInspectionSessions);
router.post('/', startInspection);
router.put('/:id/complete', completeInspection);
router.put('/:id/scan', recordScan);

module.exports = router;

