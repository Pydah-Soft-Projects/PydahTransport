const mongoose = require('mongoose');

const campusSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    code: {
        type: String,
        required: true,
        unique: true
    },
    location: {
        type: String,
        default: ''
    },
    colleges: [{
        type: String
    }]
}, {
    timestamps: true
});

module.exports = mongoose.model('Campus', campusSchema);
