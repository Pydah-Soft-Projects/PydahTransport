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
  getAutoNotificationSettings,
  updateAutoNotificationSettings,
  getAutoNotificationLogs,
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

router.get('/auto-notifications', getAutoNotificationSettings);
router.put('/auto-notifications', updateAutoNotificationSettings);
router.get('/auto-notifications/logs', getAutoNotificationLogs);

module.exports = router;
