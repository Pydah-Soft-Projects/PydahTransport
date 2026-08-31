const mongoose = require('mongoose');

const AUTO_NOTIFICATION_ACTIONS = [
  'transfer_stage',
  'transfer_passengers',
  'bus_route_mapping',
];

const autoNotificationSettingSchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    unique: true,
    enum: AUTO_NOTIFICATION_ACTIONS,
  },
  enabled: {
    type: Boolean,
    default: false,
  },
  templateId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SmsTemplate',
    default: null,
  },
  notifyStudents: {
    type: Boolean,
    default: true,
  },
  notifyEmployees: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('AutoNotificationSetting', autoNotificationSettingSchema);
module.exports.AUTO_NOTIFICATION_ACTIONS = AUTO_NOTIFICATION_ACTIONS;
