const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const mongoose = require('mongoose');
const { connectEmployeeDB, getEmployeeConnection } = require('./config/db');
const UserRole = require('./models/UserRole');
const Admin = require('./models/Admin');
const { getEmployeeModel } = require('./models/Employee');

async function run() {
    try {
        console.log("Connecting to main MongoDB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("Connecting to Employee MongoDB...");
        await connectEmployeeDB();

        const dbConnection = mongoose.connection;
        console.log("\n==========================================");
        console.log("MAIN DATABASE COLLECTIONS");
        console.log("==========================================");
        const collections = await dbConnection.db.listCollections().toArray();
        console.log(collections.map(c => ` - ${c.name}`).join('\n'));

        // Check if there is a 'users' collection in the main database
        const mainHasUsers = collections.some(c => c.name === 'users');
        let mainUsersCount = 0;
        let mainUsers = [];
        if (mainHasUsers) {
            mainUsers = await dbConnection.db.collection('users').find({}).toArray();
            mainUsersCount = mainUsers.length;
        }

        // Fetch Legacy Admins from Main DB
        const legacyAdmins = await Admin.find({}).lean();

        // Fetch UserRoles
        const userRoles = await UserRole.find({}).lean();
        const roleEmployeeIds = new Set(userRoles.map(r => r.employeeId.toString()));

        // Fetch all active employees
        const Employee = getEmployeeModel();
        let employees = [];
        if (Employee) {
            employees = await Employee.find({ is_active: true }).lean();
        }
        const employeeMap = {};
        employees.forEach(emp => {
            employeeMap[emp._id.toString()] = emp;
        });

        console.log("\n==========================================");
        console.log("LEGACY ADMINS (Admin Collection in Main DB)");
        console.log("==========================================");
        console.log(`Total Legacy Admins: ${legacyAdmins.length}`);
        legacyAdmins.forEach(admin => {
            console.log(`- Username: ${admin.username}, Name: ${admin.name || 'N/A'}, Email: ${admin.email || 'N/A'}`);
        });

        if (mainHasUsers) {
            console.log("\n==========================================");
            console.log("USERS COLLECTION IN MAIN DB");
            console.log("==========================================");
            console.log(`Total users in main db collection 'users': ${mainUsersCount}`);
            
            // Check which main db users are associated with roles in UserRole
            let unmappedMainUsersCount = 0;
            mainUsers.forEach(u => {
                // Check if this user matches any employee ID or email in UserRole
                const isMapped = userRoles.some(r => {
                    const matchId = r.employeeId && r.employeeId.toString() === (u.employeeId || u.employeeRef || u._id).toString();
                    const matchEmail = r.email && u.email && r.email.toLowerCase() === u.email.toLowerCase();
                    return matchId || matchEmail;
                });
                
                if (!isMapped) {
                    unmappedMainUsersCount++;
                    console.log(` - Username: ${u.username || u.name || 'N/A'}, Email: ${u.email || 'N/A'}, Role field: ${u.role || 'N/A'}`);
                }
            });
            console.log(`------------------------------------------`);
            console.log(`Total Main DB Users NOT in UserRole: ${unmappedMainUsersCount}`);
        } else {
            console.log("\nNo 'users' collection exists in the main Transport DB. (Only 'admins' is present).");
        }

        // Close connections
        await mongoose.disconnect();
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
