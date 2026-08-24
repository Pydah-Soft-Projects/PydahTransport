const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
    getVerificationPublicKey,
    syncVerificationData,
    getSignedQrContent,
    verifyOnlinePayload,
    uploadOfflineScans,
} = require('../controllers/verificationController');

// Public — needed by offline PWA before/without login
router.get('/public-key', getVerificationPublicKey);

// Authenticated verifier device / staff
router.get('/sync', protect, syncVerificationData);
router.get('/qr-content/:id', protect, getSignedQrContent);
router.post('/verify', protect, verifyOnlinePayload);
router.post('/offline-scans', protect, uploadOfflineScans);

module.exports = router;
