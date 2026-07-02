const mongoose = require('mongoose');

const otherVehicleTaxHistorySchema = new mongoose.Schema({
    vehicleId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'OtherVehicle',
        required: true,
    },
    vehicleNumber: {
        type: String,
        required: true,
    },
    taxHeader: {
        type: String,
        required: true,
    },
    action: {
        type: String,
        enum: ['added', 'updated', 'deleted'],
        required: true,
    },
    amount: {
        type: Number,
        default: null,
    },
    endDate: {
        type: Date,
        default: null,
    },
    previousAmount: {
        type: Number,
        default: null,
    },
    previousEndDate: {
        type: Date,
        default: null,
    },
    wasExpiredAtAction: {
        type: Boolean,
        default: false,
    },
    changedBy: {
        type: String,
        default: 'Admin',
    },
    actionAt: {
        type: Date,
        default: Date.now,
    },
}, {
    timestamps: false,
});

otherVehicleTaxHistorySchema.index({ vehicleId: 1, taxHeader: 1, actionAt: -1 });

module.exports = mongoose.model('OtherVehicleTaxHistory', otherVehicleTaxHistorySchema);
