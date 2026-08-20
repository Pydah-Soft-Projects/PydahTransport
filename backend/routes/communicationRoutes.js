const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/authMiddleware');
const {
  getConfigStatus,
  getBalance,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewRecipients,
  sendSms,
} = require('../controllers/communicationController');

router.use(protect);

router.get('/config-status', getConfigStatus);
router.get('/balance', getBalance);

router.get('/templates', listTemplates);
router.post('/templates', createTemplate);
router.put('/templates/:id', updateTemplate);
router.delete('/templates/:id', deleteTemplate);

router.get('/recipients', previewRecipients);
router.post('/send', sendSms);

module.exports = router;
