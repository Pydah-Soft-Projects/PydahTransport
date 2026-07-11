const mongoose = require('mongoose');

const inventoryAllocationSchema = new mongoose.Schema({
    busId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        refPath: 'vehicleType'
    },
    vehicleType: {
        type: String,
        required: true,
        enum: ['Bus', 'OtherVehicle'],
        default: 'Bus'
    },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true
    },
    variantName: {
        type: String,
        trim: true,
        default: ''
    },
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },
    quantity: {
        type: Number,
        required: true,
        min: 0.1,
        validate: {
            validator: function (v) {
                return Number.isFinite(v) && Math.round(v * 10) === v * 10;
            },
            message: 'Quantity can have at most 1 decimal place'
        }
    },
    price: {
        type: Number,
        default: 0
    },
    gstPercent: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    tyrePosition: {
        type: String,
        enum: ['front right', 'front left', 'back right', 'back left', 'rear left', 'rear right'],
        default: null
    },
    kmReading: {
        type: Number,
        default: null
    },
    allocatedDate: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['Allocated', 'Consumed', 'Returned'],
        default: 'Allocated'
    },
    remarks: {
        type: String,
        trim: true
    },
    adminName: {
        type: String
    },
    billNo: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('InventoryAllocation', inventoryAllocationSchema);
