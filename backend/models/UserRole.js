const mongoose = require('mongoose');

const userRoleSchema = new mongoose.Schema({
    employeeId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
        ref: 'Employee', // Reference to the Employee model (even if in another DB, good for clarity)
        unique: true
    },
    roles: [{
        type: String,
        default: ['user']
    }],
    permissions: [{
        type: String
    }],
    campuses: [{
        type: Number
    }],
    colleges: [{
        type: String
    }],
    courses: [{
        type: String
    }]
}, { timestamps: true });

const UserRole = mongoose.model('UserRole', userRoleSchema);

module.exports = UserRole;
