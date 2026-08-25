const mongoose = require('mongoose');

/**
 * Singleton-style settings for student transport request eligibility.
 * Raise / renew is allowed only when paid amount for the selected fee head
 * in the request academic year is >= minPaidAmount (when enabled).
 */
const requestEligibilitySettingSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      default: 'default',
      unique: true,
      trim: true,
    },
    enabled: {
      type: Boolean,
      default: false,
    },
    feeHeadId: {
      type: String,
      default: '',
      trim: true,
    },
    feeHeadCode: {
      type: String,
      default: '',
      trim: true,
    },
    feeHeadName: {
      type: String,
      default: '',
      trim: true,
    },
    minPaidAmount: {
      type: Number,
      default: 0,
      min: 0,
    },
    updatedBy: {
      type: String,
      default: '',
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model('RequestEligibilitySetting', requestEligibilitySettingSchema);
