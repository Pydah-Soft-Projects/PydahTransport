const jwt = require('jsonwebtoken');
const { getEmployeeModel } = require('../models/Employee');

module.exports = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const configApiKey = process.env.PRINT_API_KEY;

        // 1. Check if the token matches the configured Internal Print API Key
        if (configApiKey && token === configApiKey) {
            req.isInternalApp = true;
            req.callingApp = req.headers['x-source-application'] || 'unknown';
            req.loggedInUser = req.headers['x-user-name'] || req.headers['x-user-id'] || null;
            return next();
        }

        // 2. Fall back to checking standard user session JWT token
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            let user = null;

            // Fetch user from Employee DB
            const Employee = getEmployeeModel();
            if (Employee) {
                user = await Employee.findById(decoded.id).select('-password').lean();
            }

            // Fallback to legacy Admin DB
            if (!user) {
                const Admin = require('../models/Admin');
                const adminUser = await Admin.findById(decoded.id).select('-password').lean();
                if (adminUser) {
                    user = {
                        ...adminUser,
                        roles: ['admin'],
                        permissions: []
                    };
                }
            }

            if (!user) {
                return res.status(401).json({ message: 'Unauthorized: User not found' });
            }

            req.isInternalApp = false;
            req.callingApp = 'transport-frontend';
            req.loggedInUser = user.employee_name || user.name || user.username || 'local-user';
            req.user = user;
            return next();
        } catch (jwtErr) {
            console.error('Print Auth - JWT Validation failed:', jwtErr.message);
            return res.status(401).json({ message: 'Unauthorized: Invalid token or API key' });
        }
    } catch (error) {
        console.error('Print Authentication error:', error);
        return res.status(500).json({ message: 'Internal server error during authentication' });
    }
};
