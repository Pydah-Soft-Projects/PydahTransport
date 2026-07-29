const express = require('express');
const router = express.Router();
const {
    getRoutes,
    createRoute,
    updateRoute,
    deleteRoute,
    getTransferPreview,
    transferStage
} = require('../controllers/routeController');

router.route('/').get(getRoutes).post(createRoute);
router.route('/transfer-preview').get(getTransferPreview);
router.route('/transfer-stage').post(transferStage);
router.route('/:id').put(updateRoute).delete(deleteRoute);

module.exports = router;
