const mongoose = require('mongoose');

const academicYearFareSchema = new mongoose.Schema({
    academicYear: { type: String, required: true },
    fare: { type: Number, required: true },
}, { _id: false });

const stageSchema = new mongoose.Schema({
    stageName: { type: String, required: true },
    distanceFromStart: { type: Number, required: true }, // in km
    fare: { type: Number, required: true },
    academicYearFares: {
        type: [academicYearFareSchema],
        default: [],
    },
});

const routeSchema = new mongoose.Schema({
    routeId: {
        type: String,
        required: true,
        unique: true
    },
    routeName: {
        type: String,
        required: true
    },
    startPoint: {
        type: String,
        required: true
    },
    endPoint: {
        type: String,
        required: true
    },
    totalDistance: {
        type: Number
    },
    estimatedTime: {
        type: String // e.g. "45 mins"
    },
    campus: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Campus',
        default: null
    },
    stages: [stageSchema]
}, {
    timestamps: true
});

module.exports = mongoose.model('Route', routeSchema);
