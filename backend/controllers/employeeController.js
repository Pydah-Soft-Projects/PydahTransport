const { getEmployeeConnection } = require('../config/db');
const Bus = require('../models/Bus');

const normalizeAssignedStaffName = (name) =>
    String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

const getUnassignedStaffList = async (employees, assignedField) => {
    const assignedNames = new Set();

    const assignedRecords = await Bus.find({
        [assignedField]: { $exists: true, $ne: '' }
    }).select([assignedField]).lean();

    assignedRecords.forEach((record) => {
        const rawValue = record[assignedField];
        if (rawValue) {
            assignedNames.add(normalizeAssignedStaffName(rawValue));
        }
    });

    return employees.filter((employee) => {
        const employeeName = normalizeAssignedStaffName(employee.employee_name || employee.name || '');
        return employeeName && !assignedNames.has(employeeName);
    });
};

// @desc    Get all unassigned employees with designation 'DRIVER' from HRMS
// @route   GET /api/employees/drivers
// @access  Private/Admin
const getDrivers = async (req, res) => {
    try {
        const conn = getEmployeeConnection();
        if (!conn) {
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }

        const designationsCollection = conn.collection('designations');
        const employeesCollection = conn.collection('employees');

        const driverDesignation = await designationsCollection.findOne({ 
            name: { $regex: /^DRIVER$/i } 
        });

        if (!driverDesignation) {
            return res.json([]);
        }

        const drivers = await employeesCollection.find({
            designation_id: driverDesignation._id,
            is_active: true
        }).project({
            emp_no: 1,
            employee_name: 1,
            phone_number: 1,
            is_active: 1
        }).toArray();

        const unassignedDrivers = await getUnassignedStaffList(drivers, 'driverName');
        res.json(unassignedDrivers);
    } catch (error) {
        console.error('Error fetching drivers:', error);
        res.status(500).json({ message: 'Failed to fetch drivers' });
    }
};

// @desc    Get all unassigned employees with designation 'CLEANER' from HRMS
// @route   GET /api/employees/cleaners
// @access  Private/Admin
const getCleaners = async (req, res) => {
    try {
        const conn = getEmployeeConnection();
        if (!conn) {
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }

        const designationsCollection = conn.collection('designations');
        const employeesCollection = conn.collection('employees');

        const cleanerDesignation = await designationsCollection.findOne({ 
            name: { $regex: /^CLEANER$/i } 
        });

        if (!cleanerDesignation) {
            return res.json([]);
        }

        const cleaners = await employeesCollection.find({
            designation_id: cleanerDesignation._id,
            is_active: true
        }).project({
            emp_no: 1,
            employee_name: 1,
            phone_number: 1,
            is_active: 1
        }).toArray();

        const unassignedCleaners = await getUnassignedStaffList(cleaners, 'attendantName');
        res.json(unassignedCleaners);
    } catch (error) {
        console.error('Error fetching cleaners:', error);
        res.status(500).json({ message: 'Failed to fetch cleaners' });
    }
};

// @desc    Search employees from HRMS
// @route   GET /api/employees/search
// @access  Private/Admin
const searchEmployees = async (req, res) => {
    const { q } = req.query;
    if (!q) {
        return res.status(400).json({ message: 'Search query is required' });
    }

    try {
        const conn = getEmployeeConnection();
        if (!conn) {
            return res.status(503).json({ message: 'Employee DB connection not available' });
        }

        const employeesCollection = conn.collection('employees');
        const searchRegex = new RegExp(q, 'i');
        const employees = await employeesCollection.find({
            $or: [
                { employee_name: { $regex: searchRegex } },
                { emp_no: { $regex: searchRegex } }
            ],
            is_active: true
        }).project({
            emp_no: 1,
            employee_name: 1,
            phone_number: 1,
            email: 1
        }).limit(20).toArray();

        res.json(employees);
    } catch (error) {
        console.error('Error searching employees:', error);
        res.status(500).json({ message: 'Failed to search employees' });
    }
};

module.exports = { getDrivers, getCleaners, searchEmployees };
