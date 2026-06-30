const mongoose = require('mongoose');

const busSchema = new mongoose.Schema({
    busNumber: {
        type: String,
        required: true,
        unique: true
    },
    capacity: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['Standard', 'Mini-bus', 'Van'],
        default: 'Standard'
    },
    vehicleModel: {
        type: String,
        trim: true,
    },
    registrationDate: {
        type: Date,
    },
    amenities: [{
        type: String
    }],
    driverName: {
        type: String
    },
    attendantName: {
        type: String
    },
    status: {
        type: String,
        enum: ['Active', 'In Maintenance', 'Retired'],
        default: 'Active'
    },
    assignedRouteId: {
        type: String,
        default: null
    },
    campus: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campus',
        default: null
    },
    taxes: [{
        taxHeader: {
            type: String,
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        endDate: {
            type: Date,
            required: true
        },
        createdAt: {
            type: Date,
            default: Date.now
        }
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Bus', busSchema);
