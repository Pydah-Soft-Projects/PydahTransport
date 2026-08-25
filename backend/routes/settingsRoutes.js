const express = require('express');
const router = express.Router();
const {
  getRequestEligibilitySettings,
  putRequestEligibilitySettings,
  getFeeHeads,
  checkRequestEligibility,
} = require('../controllers/settingsController');

router.get('/request-eligibility', getRequestEligibilitySettings);
router.put('/request-eligibility', putRequestEligibilitySettings);
router.get('/request-eligibility/check', checkRequestEligibility);
router.get('/fee-heads', getFeeHeads);

module.exports = router;
