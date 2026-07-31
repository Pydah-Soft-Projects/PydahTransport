const express = require('express');
const router = express.Router();
const {
    getRoutes,
    createRoute,
    updateRoute,
    deleteRoute,
    getTransferPreview,
    transferStage,
    getRoutePassengers,
    transferPassengers,
    getTransferHistory
} = require('../controllers/routeController');

router.route('/').get(getRoutes).post(createRoute);
router.route('/passengers').get(getRoutePassengers);
router.route('/transfer-preview').get(getTransferPreview);
router.route('/transfer-stage').post(transferStage);
router.route('/transfer-passengers').post(transferPassengers);
router.route('/transfer-history').get(getTransferHistory);
router.route('/:id').put(updateRoute).delete(deleteRoute);

module.exports = router;
