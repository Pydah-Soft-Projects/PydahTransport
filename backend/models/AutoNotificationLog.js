const mongoose = require('mongoose');
const { AUTO_NOTIFICATION_ACTIONS } = require('./AutoNotificationSetting');

const messageEntrySchema = new mongoose.Schema({
  recipientName: { type: String, default: '' },
  recipientId: { type: String, default: '' },
  recipientType: { type: String, enum: ['student', 'employee', 'unknown'], default: 'unknown' },
  phone: { type: String, default: '' },
  message: { type: String, default: '' },
  status: { type: String, enum: ['sent', 'failed', 'no_phone', 'skipped'], default: 'skipped' },
  error: { type: String, default: '' },
}, { _id: false });

const autoNotificationLogSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: AUTO_NOTIFICATION_ACTIONS,
  },
  status: {
    type: String,
    enum: ['sent', 'partial', 'failed', 'skipped'],
    default: 'skipped',
  },
  skipReason: { type: String, default: '' },
  error: { type: String, default: '' },
  templateId: { type: mongoose.Schema.Types.ObjectId, ref: 'SmsTemplate', default: null },
  templateName: { type: String, default: '' },
  dltTemplateId: { type: String, default: '' },
  mode: { type: String, default: '' },
  sentCount: { type: Number, default: 0 },
  failedCount: { type: Number, default: 0 },
  noPhoneCount: { type: Number, default: 0 },
  totalRecipients: { type: Number, default: 0 },
  messages: [messageEntrySchema],
  extraParams: { type: mongoose.Schema.Types.Mixed, default: {} },
}, {
  timestamps: true,
});

autoNotificationLogSchema.index({ action: 1, createdAt: -1 });
autoNotificationLogSchema.index({ createdAt: -1 });

module.exports = mongoose.model('AutoNotificationLog', autoNotificationLogSchema);
