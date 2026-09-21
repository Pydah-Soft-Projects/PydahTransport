const mongoose = require('mongoose');

const gpsFuelReportSchema = new mongoose.Schema({
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
  initialFuelLiters: {
    type: Number,
    default: 0
  },
  finalFuelLiters: {
    type: Number,
    default: 0
  },
  fuelConsumedLiters: {
    type: Number,
    default: 0
  },
  distanceTravelledKm: {
    type: Number,
    default: 0
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
gpsFuelReportSchema.index({ date: 1, busNumber: 1 }, { unique: true });

module.exports = mongoose.model('GpsFuelReport', gpsFuelReportSchema);
