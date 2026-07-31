const mongoose = require('mongoose');

const transferHistorySchema = new mongoose.Schema({
    type: {
        type: String,
        required: true,
        enum: ['stage', 'passenger']
    },
    sourceRouteId: {
        type: String,
        required: true
    },
    sourceRouteName: {
        type: String,
        default: null
    },
    sourceStageName: {
        type: String,
        default: null
    },
    destinationRouteId: {
        type: String,
        required: true
    },
    destinationRouteName: {
        type: String,
        default: null
    },
    destinationStageName: {
        type: String,
        default: null
    },
    academicYear: {
        type: String,
        default: null
    },
    passengersCount: {
        type: Number,
        default: 0
    },
    passengers: [{
        passengerId: {
            type: String,
            required: true
        },
        name: {
            type: String,
            required: true
        },
        admissionNumber: {
            type: String,
            required: true
        },
        type: {
            type: String,
            enum: ['student', 'employee'],
            required: true
        },
        status: {
            type: String,
            required: true
        }
    }],
    performedBy: {
        type: String,
        required: true
    }
}, {
    timestamps: { createdAt: 'timestamp', updatedAt: false }
});

module.exports = mongoose.model('TransferHistory', transferHistorySchema);
