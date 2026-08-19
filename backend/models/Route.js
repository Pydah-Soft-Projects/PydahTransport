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
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    radius: { type: Number, default: 100 },
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
        type: Number,
        default: null
    },
    zone: {
        type: String,
        default: ''
    },
    stages: [stageSchema]
}, {
    timestamps: true
});

module.exports = mongoose.model('Route', routeSchema);
