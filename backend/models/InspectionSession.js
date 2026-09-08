const mongoose = require('mongoose');

const inspectionSessionSchema = new mongoose.Schema({
    inspectorId: { type: mongoose.Schema.Types.ObjectId, default: null },
    inspectorName: { type: String, required: true, trim: true },
    inspectorUsername: { type: String, default: null, trim: true },
    academicYear: { type: String, default: null, trim: true },
    inspectionDate: { type: String, required: true, trim: true },
    busNumber: { type: String, required: true, trim: true },
    routeId: { type: String, required: true, trim: true },
    routeName: { type: String, default: null, trim: true },
    startedAt: { type: Date, required: true, default: Date.now },
    completedAt: { type: Date, default: null },
    inspectedCount: { type: Number, default: 0, min: 0 },
    totalCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['in_progress', 'completed'], default: 'in_progress' },
}, {
    timestamps: true,
    collection: 'inspection_sessions',
});

inspectionSessionSchema.index({ inspectionDate: 1, academicYear: 1 });
inspectionSessionSchema.index({ inspectorId: 1, inspectionDate: 1 });

module.exports = mongoose.model('InspectionSession', inspectionSessionSchema);
