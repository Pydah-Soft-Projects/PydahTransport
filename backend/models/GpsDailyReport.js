const mongoose = require('mongoose');

const gpsDailyReportSchema = new mongoose.Schema({
  date: {
    type: String, // YYYY-MM-DD
    required: true,
    index: true
  },
  busNumber: {
    type: String,
    required: true,
    index: true
  },
  tggVehicleName: {
    type: String,
    default: ''
  },
  routeId: {
    type: String,
    default: null,
    index: true
  },
  routeName: {
    type: String,
    default: null
  },
  campus: {
    type: Number,
    default: null,
    index: true
  },
  firstInTime: {
    type: String,
    default: '—'
  },
  lastOutTime: {
    type: String,
    default: '—'
  },
  totalKms: {
    type: Number,
    default: 0
  },
  activeDurationMinutes: {
    type: Number,
    default: 0
  },
  isLateArrival: {
    type: Boolean,
    default: false
  },
  syncStatus: {
    type: String,
    enum: ['COMPLETE', 'INCOMPLETE'],
    default: 'COMPLETE'
  },
  lastSyncedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Compound unique index per vehicle per day
gpsDailyReportSchema.index({ date: 1, busNumber: 1 }, { unique: true });

module.exports = mongoose.model('GpsDailyReport', gpsDailyReportSchema);
