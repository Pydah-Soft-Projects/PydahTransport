const jwt = require('jsonwebtoken');
const UserRole = require('../models/UserRole');
const { getEmployeeModel } = require('../models/Employee');
const { normalizeUserRoles } = require('../utils/roleUtils');

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
                req.user.roles = userRole ? userRole.roles : ['office_staff'];
                req.user.permissions = userRole ? userRole.permissions : [];
                req.user.campuses = userRole ? (userRole.campuses || []) : [];
                req.user.colleges = userRole ? (userRole.colleges || []) : [];
                req.user.courses = userRole ? (userRole.courses || []) : [];
            }
            req.user = normalizeUserRoles(req.user);

            return next();
        } catch (error) {
            console.error('JWT Verification Error:', error);
            return res.status(401).json({ message: 'Not authorized, token failed' });
        }
    }

    return res.status(401).json({ message: 'Not authorized, no token' });
};

const hasAdministrativeAccess = (user) => {
    if (!user) return false;
    if (isLegacySuperAdmin(user)) return true;

    const roles = Array.isArray(user.roles) ? user.roles : [];
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];

    if (roles.includes('admin') || roles.includes('superadmin')) return true;
    if (permissions.includes('all') || permissions.includes('user_management')) return true;

    return false;
};

const admin = (req, res, next) => {
    if (hasAdministrativeAccess(req.user)) {
        next();
    } else {
        console.warn(`Admin access denied for user: ${req.user ? req.user._id : 'Unknown'}. Roles: ${req.user ? JSON.stringify(req.user.roles) : 'none'}`);
        res.status(401).json({ message: 'Not authorized as an admin' });
    }
};

const isLegacySuperAdmin = (user) => Boolean(user?.username && !user?.emp_no);

const userHasPermission = (user, permission) => {
    if (!user) return false;
    if (isLegacySuperAdmin(user)) return true;
    const roles = Array.isArray(user.roles) ? user.roles : [];
    const permissions = Array.isArray(user.permissions) ? user.permissions : [];
    if (roles.includes('admin') || roles.includes('superadmin')) return true;
    if (permissions.includes(permission)) return true;
    // Legacy: module access used to mean full inventory rights
    if (
        (permission === 'inventory_edit' || permission === 'inventory_delete')
        && permissions.includes('inventory')
    ) {
        return true;
    }
    return false;
};

const optionalAuth = async (req, res, next) => {
    if (
        req.headers.authorization &&
        req.headers.authorization.startsWith('Bearer')
    ) {
        try {
            const token = req.headers.authorization.split(' ')[1];
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            const Employee = getEmployeeModel();
            if (Employee) {
                req.user = await Employee.findById(decoded.id).select('-password').lean();
            }

            if (!req.user) {
                const Admin = require('../models/Admin');
                const adminUser = await Admin.findById(decoded.id).select('-password').lean();

                if (adminUser) {
                    req.user = {
                        ...adminUser,
                        roles: ['admin'],
                        permissions: []
                    };
                }
            }

            if (req.user && !req.user.roles) {
                const userRole = await UserRole.findOne({ employeeId: req.user._id }).lean();
                req.user.roles = userRole ? userRole.roles : ['office_staff'];
                req.user.permissions = userRole ? userRole.permissions : [];
                req.user.campuses = userRole ? (userRole.campuses || []) : [];
                req.user.colleges = userRole ? (userRole.colleges || []) : [];
                req.user.courses = userRole ? (userRole.courses || []) : [];
            }
            if (req.user) {
                req.user = normalizeUserRoles(req.user);
            }
        } catch (error) {
            // Ignore invalid/expired token in optional auth
        }
    }
    return next();
};

const requirePermission = (permission) => (req, res, next) => {
    if (userHasPermission(req.user, permission)) {
        return next();
    }
    return res.status(403).json({ message: 'You do not have permission to perform this action' });
};

module.exports = { protect, optionalAuth, admin, requirePermission, userHasPermission, isLegacySuperAdmin };
