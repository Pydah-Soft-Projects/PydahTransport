const mongoose = require('mongoose');

const tyreRegistrySchema = new mongoose.Schema({
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
    position: {
        type: String,
        required: true,
        enum: ['front right', 'front left', 'back right', 'back left', 'rear left', 'rear right']
    },
    tyreType: {
        type: String,
        required: true,
        enum: ['new tyre', 'old tyre']
    },
    installKm: {
        type: Number,
        required: true
    },
    status: {
        type: String,
        enum: ['Active', 'Replaced'],
        default: 'Active'
    },
    serialNumber: {
        type: String,
        trim: true
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('TyreRegistry', tyreRegistrySchema);
