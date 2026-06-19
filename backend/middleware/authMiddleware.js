const jwt = require('jsonwebtoken');
const UserRole = require('../models/UserRole');
const { getEmployeeModel } = require('../models/Employee');

const protect = async (req, res, next) => {
    let token;

    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            token = req.headers.authorization.split(' ')[1];

            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            const Employee = getEmployeeModel();
            if (Employee) {
                req.user = await Employee.findById(decoded.id).select('-password').lean();
            }

            // If not found in Employee DB, check Legacy Admin DB
            if (!req.user) {
                const Admin = require('../models/Admin');
                const adminUser = await Admin.findById(decoded.id).select('-password').lean();

                if (adminUser) {
                    req.user = {
                        ...adminUser,
                        roles: ['admin'], // Legacy admins are always admins
                        permissions: [] // or default permissions
                    };
                }
            }

            if (!req.user) {
                console.warn(`User not found for ID: ${decoded.id}`);
                return res.status(401).json({ message: 'Not authorized, user not found' });
            }

            // If it was an employee, attach roles from local DB
            if (!req.user.roles) {
                const userRole = await UserRole.findOne({ employeeId: req.user._id }).lean();
                req.user.roles = userRole ? userRole.roles : ['user'];
                req.user.permissions = userRole ? userRole.permissions : [];
                req.user.campuses = userRole ? (userRole.campuses || []) : [];
                req.user.colleges = userRole ? (userRole.colleges || []) : [];
                req.user.courses = userRole ? (userRole.courses || []) : [];
            }

            return next();
        } catch (error) {
            console.error('JWT Verification Error:', error);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    return res.status(401).json({ message: 'Not authorized, no token' });
};

const admin = (req, res, next) => {
    if (req.user && req.user.roles && req.user.roles.includes('admin')) {
        next();
    } else {
        console.warn(`Admin access denied for user: ${req.user ? req.user._id : 'Unknown'}. Roles: ${req.user ? JSON.stringify(req.user.roles) : 'none'}`);
        res.status(401).json({ message: 'Not authorized as an admin' });
    }
};

module.exports = { protect, admin };
