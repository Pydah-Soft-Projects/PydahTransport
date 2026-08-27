const mongoose = require('mongoose');

const employeeTransportRequestSchema = new mongoose.Schema({
    emp_no: {
        type: String,
        required: true
    },
    employee_name: {
        type: String,
        required: true
    },
    route_id: {
        type: String,
        required: true
    },
    route_name: {
        type: String,
        required: true
    },
    stage_name: {
        type: String,
        required: true
    },
    bus_id: {
        type: String,
        default: null
    },
    fare: {
        type: Number,
        default: 0
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'cancelled', 'expired'],
        default: 'pending'
    },
    cancellation_reason: {
        type: String,
        default: null
    },
    cancelled_at: {
        type: Date,
        default: null
    },
    raised_by: {
        type: String,
        default: 'employee'
    },
    raised_by_id: {
        type: String,
        default: null
    },
    academic_year: {
        type: String,
        default: null
    },
    application_number: {
        type: String,
        default: null
    },
    application_serial: {
        type: Number,
        default: null
    },
    application_college_code: {
        type: String,
        default: null
    },
    application_course_code: {
        type: String,
        default: null
    },
    new_id_card_needed: {
        type: Boolean,
        default: false
    },
    expiry_reason: {
        type: String,
        enum: ['employee_left', 'academic_year_ended', 'manual', null],
        default: null
    },
    not_interested: {
        type: Boolean,
        default: false
    },
    not_interested_reason: {
        type: String,
        default: null
    },
    request_date: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' }
});

const EmployeeTransportRequest = mongoose.model('EmployeeTransportRequest', employeeTransportRequestSchema);

module.exports = EmployeeTransportRequest;
