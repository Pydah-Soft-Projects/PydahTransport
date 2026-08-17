const { getEmployeeModel } = require('../models/Employee');
const UserRole = require('../models/UserRole');
const campusService = require('../services/campusService');
const Admin = require('../models/Admin');

// @desc    Get all users (Employees + Roles)
// @route   GET /api/users
// @access  Private/Admin
// @desc    Get all users (Employees + Roles)
// @route   GET /api/users
// @access  Private/Admin
const extractEmployeePhone = (emp, roleData) => {
    if (emp.phone_number) return emp.phone_number;
    if (emp.phone) return emp.phone;
    if (emp.mobile) return emp.mobile;
    if (emp.mobile_no) return emp.mobile_no;
    if (emp.phone_no) return emp.phone_no;
    if (emp.alt_phone_number) return emp.alt_phone_number;

    // Check dynamicFields object from HRMS
    if (emp.dynamicFields && typeof emp.dynamicFields === 'object') {
        const fields = emp.dynamicFields;
        for (const key of Object.keys(fields)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('phone') || lowerKey.includes('mobile') || lowerKey.includes('contact') || lowerKey.includes('number')) {
                const val = fields[key];
                if (val && typeof val === 'string' && val.trim()) return val.trim();
                if (val && typeof val === 'number') return String(val);
            }
        }
    }

    return roleData?.phone || '';
};

const extractEmployeeEmail = (emp, roleData) => {
    if (emp.email) return emp.email;
    if (emp.official_email) return emp.official_email;
    if (emp.personal_email) return emp.personal_email;

    // Check dynamicFields object from HRMS
    if (emp.dynamicFields && typeof emp.dynamicFields === 'object') {
        const fields = emp.dynamicFields;
        for (const key of Object.keys(fields)) {
            const lowerKey = key.toLowerCase();
            if (lowerKey.includes('email') || lowerKey.includes('mail')) {
                const val = fields[key];
                if (val && typeof val === 'string' && val.trim()) return val.trim();
            }
        }
    }

    return roleData?.email || '';
};

// @desc    Get all users (Employees + Roles)
// @route   GET /api/users
// @access  Private/Admin
const getUsers = async (req, res) => {
    try {
        const Employee = getEmployeeModel();
        if (!Employee) {
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }

        // 1. Fetch all user roles from Local DB first
        const userRoles = await UserRole.find({}).lean();

        if (userRoles.length === 0) {
            return res.json([]);
        }

        // 2. Get list of employee IDs that have roles
        const employeeIds = userRoles.map(role => role.employeeId);

        // 3. Fetch specific employees from HRMS (fetching full document for email, phone, dynamicFields, etc.)
        const employees = await Employee.find({
            '_id': { $in: employeeIds }
        }).lean();

        // 4. Merge data
        const roleMap = {};
        userRoles.forEach(role => {
            roleMap[role.employeeId.toString()] = role;
        });

        const mergedUsers = employees.map(emp => {
            const roleData = roleMap[emp._id.toString()] || {};
            const email = extractEmployeeEmail(emp, roleData);
            const phone = extractEmployeePhone(emp, roleData);
            return {
                ...emp,
                roles: roleData.roles || ['user'],
                permissions: roleData.permissions || [],
                campuses: roleData.campuses || [],
                colleges: roleData.colleges || [],
                courses: roleData.courses || [],
                email,
                phone
            };
        });

        // 0. Fetch Super Admins
        const admins = await Admin.find({}).select('-password').lean();
        const formattedAdmins = admins.map(admin => ({
            _id: admin._id,
            emp_no: 'ADMIN',
            employee_name: admin.name || (admin.username === 'admin' ? 'Super Admin' : admin.username),
            name: admin.name || '',
            username: admin.username,
            email: admin.email || '',
            phone: admin.phone || '',
            roles: ['superadmin'],
            permissions: ['all'],
            is_active: true,
            is_superadmin: true // Flag for frontend
        }));

        const allUsers = [...formattedAdmins, ...mergedUsers];

        res.json(allUsers); // Return list
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ message: 'Failed to fetch users' });
    }
};

// @desc    Update user role & permissions
// @route   PUT /api/users/:id/role
// @access  Private/Admin
const updateUserRole = async (req, res) => {
    const { id } = req.params; // Employee ID (mongoose ObjectId from HRMS)
    const { roles, permissions, campuses, colleges, courses, email, phone } = req.body;
 
    try {
        console.log(`[Backend] Updating user ${id} role/permissions`);
        console.log(`[Backend] Received roles:`, roles);
        console.log(`[Backend] Received campuses:`, campuses);
        console.log(`[Backend] Received colleges:`, colleges);
        console.log(`[Backend] Received courses:`, courses);
 
        // Validation: Verify employee exists in HRMS
        const Employee = getEmployeeModel();
        if (!Employee) {
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }
 
        const employee = await Employee.findById(id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }
 
        // Update or Create UserRole in Local DB
        // Ensure roles is an array
        const rolesArray = Array.isArray(roles) ? roles : [roles];

        const updateFields = {
            roles: rolesArray,
            permissions: permissions || [],
            campuses: campusService.normalizeCampusIds(campuses || []),
            colleges: colleges || [],
            courses: courses || []
        };
        if (email !== undefined) updateFields.email = email;
        if (phone !== undefined) updateFields.phone = phone;
 
        const updatedRole = await UserRole.findOneAndUpdate(
            { employeeId: id },
            { $set: updateFields },
            { new: true, upsert: true, setDefaultsOnInsert: true }
        );

        console.log(`[Backend] Updated Role Result:`, updatedRole);

        res.json(updatedRole);

    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ message: 'Failed to update user role' });
    }
};

// @desc    Remove user role (revoke admin access)
// @route   DELETE /api/users/:id/role
// @access  Private/Admin
const deleteUserRole = async (req, res) => {
    const { id } = req.params; // Employee ID

    try {
        const deletedRole = await UserRole.findOneAndDelete({ employeeId: id });

        if (!deletedRole) {
            return res.status(404).json({ message: 'User role not found' });
        }

        res.json({ message: 'User access revoked', id });
    } catch (error) {
        console.error('Error deleting user role:', error);
        res.status(500).json({ message: 'Failed to revoke user access' });
    }
};

// @desc    Search employees from HRMS
// @route   GET /api/users/search?q=query
// @access  Private/Admin
const searchEmployees = async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ message: 'Search query is required' });
    }

    console.log(`[Search] Query: "${q}"`);

    try {
        const Employee = getEmployeeModel();
        if (!Employee) {
            console.error('[Search] Employee DB Not Connected');
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }

        // 1. Find employees matching the search query (fetching full document for email & phone)
        const employees = await Employee.find({
            $or: [
                { employee_name: { $regex: q, $options: 'i' } },
                { emp_no: { $regex: q, $options: 'i' } }
            ]
        }).limit(20).lean();

        console.log(`[Search] Raw matches from HRMS: ${employees.length}`);

        if (employees.length === 0) {
            return res.json([]);
        }

        // 2. Get the list of employee IDs found
        const employeeIds = employees.map(emp => emp._id);

        // 3. Find which of these employees already have a UserRole
        const existingRoles = await UserRole.find({
            employeeId: { $in: employeeIds }
        }).select('employeeId').lean();

        console.log(`[Search] Existing roles found: ${existingRoles.length}`);

        const existingEmployeeIds = new Set(existingRoles.map(role => role.employeeId.toString()));

        // 4. Filter out employees who already have a role
        const newCandidates = employees.filter(emp => !existingEmployeeIds.has(emp._id.toString()));

        const formattedCandidates = newCandidates.map(emp => ({
            ...emp,
            phone: extractEmployeePhone(emp, null),
            email: extractEmployeeEmail(emp, null)
        }));

        console.log(`[Search] Final candidates: ${formattedCandidates.length}`);

        res.json(formattedCandidates);
    } catch (error) {
        console.error('Error searching employees:', error);
        res.status(500).json({ message: 'Failed to search employees' });
    }
};

// @desc    Update Superadmin details
// @route   PUT /api/users/superadmin/:id
// @access  Private/Admin
const updateSuperAdmin = async (req, res) => {
    const { id } = req.params;
    const { name, username, email, phone, password } = req.body;

    try {
        const admin = await Admin.findById(id);
        if (!admin) {
            return res.status(404).json({ message: 'Superadmin not found' });
        }

        // Check if username is being changed and if it already exists elsewhere
        if (username && username !== admin.username) {
            const existingUsername = await Admin.findOne({ username, _id: { $ne: id } });
            if (existingUsername) {
                return res.status(400).json({ message: 'Username is already taken' });
            }
            admin.username = username;
        }

        // Check if email is being changed and if it already exists elsewhere
        if (email !== undefined && email !== admin.email) {
            if (email.trim() !== '') {
                const existingEmail = await Admin.findOne({ email, _id: { $ne: id } });
                if (existingEmail) {
                    return res.status(400).json({ message: 'Email is already taken' });
                }
            }
            admin.email = email.trim() || undefined;
        }

        if (name !== undefined) admin.name = name;
        if (phone !== undefined) admin.phone = phone;

        if (password && password.trim() !== '') {
            admin.password = password.trim();
        }

        await admin.save();

        const updatedAdmin = admin.toObject();
        delete updatedAdmin.password;

        res.json({
            message: 'Superadmin details updated successfully',
            user: {
                _id: updatedAdmin._id,
                emp_no: 'ADMIN',
                employee_name: updatedAdmin.name || (updatedAdmin.username === 'admin' ? 'Super Admin' : updatedAdmin.username),
                name: updatedAdmin.name || '',
                username: updatedAdmin.username,
                email: updatedAdmin.email || '',
                phone: updatedAdmin.phone || '',
                roles: ['superadmin'],
                permissions: ['all'],
                is_active: true,
                is_superadmin: true
            }
        });
    } catch (error) {
        console.error('Error updating superadmin:', error);
        res.status(500).json({ message: error.message || 'Failed to update superadmin details' });
    }
};

module.exports = {
    getUsers,
    updateUserRole,
    deleteUserRole,
    searchEmployees,
    updateSuperAdmin
};
