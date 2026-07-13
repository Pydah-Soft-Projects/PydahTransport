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

        // 3. Fetch specific employees from HRMS (Updated fields based on user edits)
        const employees = await Employee.find({
            '_id': { $in: employeeIds }
        }, 'emp_no employee_name is_active').lean();

        // 4. Merge data
        const roleMap = {};
        userRoles.forEach(role => {
            roleMap[role.employeeId.toString()] = role;
        });

        const mergedUsers = employees.map(emp => {
            const roleData = roleMap[emp._id.toString()] || {};
            return {
                ...emp,
                roles: roleData.roles || ['user'],
                permissions: roleData.permissions || [],
                campuses: roleData.campuses || [],
                colleges: roleData.colleges || [],
                courses: roleData.courses || []
            };
        });

        // 0. Fetch Super Admins
        const admins = await Admin.find({}).select('-password').lean();
        const formattedAdmins = admins.map(admin => ({
            _id: admin._id,
            emp_no: 'ADMIN',
            employee_name: admin.username === 'admin' ? 'Super Admin' : admin.username,
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
    const { roles, permissions, campuses, colleges, courses } = req.body;
 
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
 
        const updatedRole = await UserRole.findOneAndUpdate(
            { employeeId: id },
            {
                $set: {
                    roles: rolesArray,
                    permissions: permissions || [],
                    campuses: campusService.normalizeCampusIds(campuses || []),
                    colleges: colleges || [],
                    courses: courses || []
                }
            },
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

        // 1. Find employees matching the search query (Updated fields)
        const employees = await Employee.find({
            $or: [
                { employee_name: { $regex: q, $options: 'i' } },
                { emp_no: { $regex: q, $options: 'i' } }
            ]
        }, 'emp_no employee_name').limit(20).lean();

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

        console.log(`[Search] Final candidates: ${newCandidates.length}`);

        res.json(newCandidates);
    } catch (error) {
        console.error('Error searching employees:', error);
        res.status(500).json({ message: 'Failed to search employees' });
    }
};

module.exports = {
    getUsers,
    updateUserRole,
    deleteUserRole,
    searchEmployees
};
