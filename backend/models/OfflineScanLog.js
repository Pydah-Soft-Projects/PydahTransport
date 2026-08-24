const mongoose = require('mongoose');

const offlineScanLogSchema = new mongoose.Schema({
    scanId: { type: String, required: true, unique: true, trim: true },
    requestId: { type: String, default: null, trim: true },
    studentId: { type: String, default: null, trim: true },
    transportId: { type: String, default: null, trim: true },
    verificationResult: { type: String, required: true, trim: true },
    mode: { type: String, enum: ['ONLINE', 'OFFLINE'], default: 'OFFLINE' },
    scannedAt: { type: Date, required: true },
    deviceId: { type: String, default: null, trim: true },
    academicYear: { type: String, default: null, trim: true },
    rawPayload: { type: mongoose.Schema.Types.Mixed, default: null },
    uploadedAt: { type: Date, default: Date.now },
}, {
    timestamps: true,
    collection: 'offline_scan_logs',
});

offlineScanLogSchema.index({ deviceId: 1, scannedAt: -1 });
offlineScanLogSchema.index({ studentId: 1, scannedAt: -1 });

module.exports = mongoose.model('OfflineScanLog', offlineScanLogSchema);
