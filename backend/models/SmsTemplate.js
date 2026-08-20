const mongoose = require('mongoose');

const varMappingSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ['field', 'custom'],
    default: 'field',
  },
  field: {
    type: String,
    default: '',
    trim: true,
  },
  value: {
    type: String,
    default: '',
    trim: true,
  },
}, { _id: false });

const smsTemplateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true,
  },
  dltTemplateId: {
    type: String,
    required: true,
    trim: true,
  },
  body: {
    type: String,
    required: true,
    trim: true,
  },
  description: {
    type: String,
    default: '',
    trim: true,
  },
  varMappings: {
    type: [varMappingSchema],
    default: [],
  },
  unicode: {
    type: Boolean,
    default: false,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdBy: {
    type: String,
    default: null,
  },
}, {
  timestamps: true,
});

module.exports = mongoose.model('SmsTemplate', smsTemplateSchema);
