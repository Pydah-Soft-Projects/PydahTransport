const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const { connectEmployeeDB } = require('./config/db');
const UserRole = require('./models/UserRole');
const { getEmployeeModel } = require('./models/Employee');

async function run() {
    try {
        console.log("Connecting to MongoDB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connecting to Employee MongoDB...");
        await connectEmployeeDB();
        
        const Employee = getEmployeeModel();
        if (!Employee) {
            console.error("Employee model not initialized.");
            process.exit(1);
        }

        console.log("Retrieving data...");
        // 1. Fetch all user roles from Main DB
        const userRoles = await UserRole.find({}).lean();
        const mappedEmployeeIds = new Set(userRoles.map(role => role.employeeId.toString()));
        
        // 2. Fetch all active employees from HRMS Employee DB
        const allEmployees = await Employee.find({ is_active: true }).lean();
        
        // 3. Separate mapped vs unmapped
        const mappedEmployees = allEmployees.filter(emp => mappedEmployeeIds.has(emp._id.toString()));
        const unmappedEmployees = allEmployees.filter(emp => !mappedEmployeeIds.has(emp._id.toString()));

        const employeeMap = {};
        allEmployees.forEach(emp => {
            employeeMap[emp._id.toString()] = emp;
        });

        // Collect all unique roles present in UserRoles
        const allRolesInDb = new Set();
        userRoles.forEach(role => {
            if (role.roles) {
                role.roles.forEach(r => allRolesInDb.add(r));
            }
        });

        console.log("\n==========================================");
        console.log("ALL ROLES ASSIGNED IN DATABASE");
        console.log("==========================================");
        if (allRolesInDb.size === 0) {
            console.log("No roles found.");
        } else {
            console.log(Array.from(allRolesInDb).map(role => ` - ${role}`).join('\n'));
        }

        console.log("\n==========================================");
        console.log("MAPPED USERS AND THEIR ASSIGNED ROLES");
        console.log("==========================================");
        if (userRoles.length === 0) {
            console.log("No users with roles registered.");
        } else {
            userRoles.forEach(role => {
                const emp = employeeMap[role.employeeId.toString()] || {};
                const name = emp.employee_name || "N/A";
                const empNo = emp.emp_no || "N/A";
                const roles = (role.roles && role.roles.length > 0) ? role.roles.join(', ') : 'No roles';
                
                console.log(`User: ${name} (ID: ${empNo})`);
                console.log(`  Assigned Roles: ${roles}`);
                console.log(`  Permissions:    ${role.permissions && role.permissions.length > 0 ? role.permissions.join(', ') : 'None'}`);
                console.log(`------------------------------------------`);
            });
        }

        console.log("\n==========================================");
        console.log("UNMAPPED ACTIVE EMPLOYEES (NO ROLES)");
        console.log("==========================================");
        if (unmappedEmployees.length === 0) {
            console.log("All active employees are mapped to a role.");
        } else {
            unmappedEmployees.forEach(emp => {
                console.log(` - ${emp.employee_name} (ID: ${emp.emp_no})`);
            });
            console.log(`------------------------------------------`);
            console.log(`Total Active Unmapped Employees: ${unmappedEmployees.length}`);
        }

        // Close mongoose connections
        await mongoose.disconnect();
        const { getEmployeeConnection } = require('./config/db');
        const empConn = getEmployeeConnection();
        if (empConn) {
            await empConn.close();
        }
        console.log("\nConnections closed successfully.");
        process.exit(0);
    } catch (e) {
        console.error("Error executing script:", e);
        process.exit(1);
    }
}

run();
