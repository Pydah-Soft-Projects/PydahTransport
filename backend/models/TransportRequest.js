const mongoose = require('mongoose');

const transportRequestSchema = new mongoose.Schema({
    id: {
        type: Number,
        unique: true,
        sparse: true,
        default: null
    },
    admission_number: {
        type: String,
        trim: true,
        default: null
    },
    student_name: {
        type: String,
        trim: true,
        default: null
    },
    route_id: {
        type: String,
        required: true,
        trim: true,
        default: null
    },
    route_name: {
        type: String,
        trim: true,
        default: null
    },
    stage_name: {
        type: String,
        trim: true,
        default: null
    },
    bus_id: {
        type: String,
        trim: true,
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
    request_date: {
        type: Date,
        default: Date.now
    },
    updated_at: {
        type: Date,
        default: Date.now
    },
    semester_id: {
        type: Number,
        default: null
    },
    semester_start_date: {
        type: Date,
        default: null
    },
    semester_end_date: {
        type: Date,
        default: null
    },
    expiry_date: {
        type: Date,
        default: null
    },
    academic_year_id: {
        type: Number,
        default: null
    },
    year_of_study: {
        type: Number,
        default: null
    },
    academic_year: {
        type: String,
        trim: true,
        default: null
    },
    application_number: {
        type: String,
        trim: true,
        default: null
    },
    application_serial: {
        type: Number,
        default: null
    },
    application_college_code: {
        type: String,
        trim: true,
        default: null
    },
    application_course_code: {
        type: String,
        trim: true,
        default: null
    },
    semester_number: {
        type: Number,
        default: null
    },
    raised_by: {
        type: String,
        trim: true,
        default: 'student'
    },
    raised_by_id: {
        type: Number,
        default: null
    },
    new_id_card_needed: {
        type: Boolean,
        default: false
    },
    expiry_reason: {
        type: String,
        default: null
    },
    not_interested: {
        type: Boolean,
        default: false
    },
    not_interested_reason: {
        type: String,
        default: null
    }
}, {
    timestamps: { createdAt: 'request_date', updatedAt: 'updated_at' },
    collection: 'transport_requests'
});

// Static helper to get the next sequential request id from MongoDB
transportRequestSchema.statics.getNextRequestId = async function () {
    const lastDoc = await this.findOne({ id: { $exists: true, $ne: null } })
        .sort({ id: -1 })
        .select('id')
        .lean();
    return lastDoc && lastDoc.id ? Number(lastDoc.id) + 1 : 1;
};

// Auto-increment numeric id in Mongo if not provided
transportRequestSchema.pre('save', async function (next) {
    if (this.isNew && (this.id === undefined || this.id === null)) {
        try {
            const nextId = await this.constructor.getNextRequestId();
            this.id = nextId;
        } catch (error) {
            console.error('Error assigning auto-increment ID to TransportRequest:', error);
        }
    }
    next();
});

// Create indexes for efficient querying
transportRequestSchema.index({ id: 1 });
transportRequestSchema.index({ admission_number: 1 });
transportRequestSchema.index({ status: 1 });
transportRequestSchema.index({ route_id: 1 });
transportRequestSchema.index({ bus_id: 1 });
transportRequestSchema.index({ academic_year: 1 });
transportRequestSchema.index({ application_number: 1 });
transportRequestSchema.index({ academic_year: 1, application_college_code: 1, application_course_code: 1, application_serial: -1 });

const TransportRequest = mongoose.model('TransportRequest', transportRequestSchema, 'transport_requests');

module.exports = TransportRequest;
