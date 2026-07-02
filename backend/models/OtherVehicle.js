const mongoose = require('mongoose');

const otherVehicleSchema = new mongoose.Schema({
    vehicleNumber: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    capacity: {
        type: Number,
        required: true
    },
    type: {
        type: String,
        enum: ['Car', 'Van', 'SUV', 'Other'],
        required: true
    },
    vehicleModel: {
        type: String,
        trim: true,
    },
    registrationDate: {
        type: Date,
    },
    driverName: {
        type: String,
        trim: true
    },
    attendantName: {
        type: String,
        trim: true
    },
    status: {
        type: String,
        enum: ['Active', 'In Maintenance', 'Retired'],
        default: 'Active'
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

module.exports = mongoose.model('OtherVehicle', otherVehicleSchema);
