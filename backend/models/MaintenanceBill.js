const mongoose = require('mongoose');

const taxEntrySchema = new mongoose.Schema({
    name: { type: String, trim: true, default: 'GST' },
    rate: { type: Number, default: 0, min: 0 }
}, { _id: false });

const attachmentSchema = new mongoose.Schema({
    url: { type: String, required: true },
    fileName: { type: String, trim: true },
    mimeType: { type: String, trim: true },
    uploadedAt: { type: Date, default: Date.now }
});

const billLineSchema = new mongoose.Schema({
    allocationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryAllocation',
        default: null
    },
    itemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'InventoryItem',
        required: true
    },
    variantName: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    subDescriptions: [{ type: String, trim: true }],
    pricingMode: {
        type: String,
        enum: ['unitRate', 'lumpSum'],
        default: 'unitRate'
    },
    quantity: {
        type: Number,
        required: true,
        min: 0.1
    },
    unitPrice: { type: Number, default: 0 },
    amount: { type: Number, default: 0 },
    uom: { type: String, trim: true, default: 'Pcs' },
    discountAmount: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    gstPercent: { type: Number, default: 0, min: 0, max: 100 },
    taxes: [taxEntrySchema],
    taxableAmount: { type: Number, default: 0 },
    taxAmount: { type: Number, default: 0 },
    lineTotal: { type: Number, default: 0 },
    baseAmount: { type: Number, default: 0 },
    gstAmount: { type: Number, default: 0 },
    finalAmount: { type: Number, default: 0 },
    tyrePosition: {
        type: String,
        enum: ['front right', 'front left', 'back right', 'back left', 'rear left', 'rear right'],
        default: null
    },
    kmReading: { type: Number, default: null },
    tyreType: { type: String, trim: true, default: '' },
    remarks: { type: String, trim: true, default: '' }
}, { _id: true });

const maintenanceBillSchema = new mongoose.Schema({
    billNo: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    date: {
        type: Date,
        default: Date.now
    },
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
    vendorId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Vendor'
    },
    adminName: {
        type: String,
        trim: true,
        default: ''
    },
    taxMode: {
        type: String,
        enum: ['none', 'billLevel', 'lineLevel'],
        default: 'lineLevel'
    },
    discountMode: {
        type: String,
        enum: ['none', 'billLevel', 'lineLevel'],
        default: 'none'
    },
    taxes: [taxEntrySchema],
    discountAmount: { type: Number, default: 0, min: 0 },
    discountPercent: { type: Number, default: 0, min: 0, max: 100 },
    subtotal: { type: Number, default: 0 },
    discountTotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    computedGrandTotal: { type: Number, default: 0 },
    insuranceClaimAmount: { type: Number, default: 0 },
    grandTotalOverride: { type: Number, default: null },
    grandTotal: { type: Number, default: 0 },
    notes: { type: String, trim: true, default: '' },
    rawDescription: { type: String, trim: true, default: '' },
    lines: [billLineSchema],
    attachments: [attachmentSchema]
}, {
    timestamps: true
});

maintenanceBillSchema.index({ busId: 1, vehicleType: 1, date: -1 });
maintenanceBillSchema.index({ billNo: 1, busId: 1 });

module.exports = mongoose.model('MaintenanceBill', maintenanceBillSchema);
