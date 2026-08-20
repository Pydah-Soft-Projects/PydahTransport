const mongoose = require('mongoose');

const gpsFinalDestinationSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  campus: {
    type: Number,
    required: true,
    unique: true,
  },
  latitude: {
    type: Number,
    required: true,
  },
  longitude: {
    type: Number,
    required: true,
  },
  radius: {
    type: Number,
    required: true,
    default: 200,
  },
  morningStart: {
    type: String,
    default: '07:00',
  },
  morningEnd: {
    type: String,
    default: '09:30',
  },
  eveningStart: {
    type: String,
    default: '16:00',
  },
  eveningEnd: {
    type: String,
    default: '19:00',
  },
  isActive: {
    type: Boolean,
    default: true,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('GpsFinalDestination', gpsFinalDestinationSchema);
