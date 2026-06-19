const mongoose = require('mongoose');

const busTaxHistorySchema = new mongoose.Schema({
    busId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Bus',
        required: true,
    },
    busNumber: {
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
    // Values at the time of this action
    amount: {
        type: Number,
        default: null,
    },
    endDate: {
        type: Date,
        default: null,
    },
    // Previous values (for updates)
    previousAmount: {
        type: Number,
        default: null,
    },
    previousEndDate: {
        type: Date,
        default: null,
    },
    // Whether the end date was already past at the time of this action
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

// Index for fast lookup by bus + taxHeader
busTaxHistorySchema.index({ busId: 1, taxHeader: 1, actionAt: -1 });

module.exports = mongoose.model('BusTaxHistory', busTaxHistorySchema);
