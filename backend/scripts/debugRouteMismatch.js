require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

(async () => {
    console.log('Connecting to database...');
    await connectDB();

    console.log('\n--- Fetching all Routes from Route Collection ---');
    const routes = await Route.find({}).lean();
    const routeMap = {}; // routeId -> routeName
    routes.forEach(r => {
        routeMap[r.routeId] = r.routeName;
        console.log(`Route ID: ${r.routeId} -> Name: "${r.routeName}"`);
    });

    const students = await TransportRequest.find({ status: 'approved' }).lean();
    const employees = await EmployeeTransportRequest.find({ status: 'approved' }).lean();

    console.log(`\nChecking passenger route name mismatches...`);
    let studentMismatchesCount = 0;
    let employeeMismatchesCount = 0;

    for (const s of students) {
        const correctName = routeMap[s.route_id];
        if (correctName && s.route_name !== correctName) {
            console.log(`[UPDATE] Student: ${s.student_name} (${s.admission_number || s.admission_no})`);
            console.log(`  Current Route Name: "${s.route_name}"`);
            console.log(`  Expected Route Name: "${correctName}" (Route ID: ${s.route_id})`);
            
            await TransportRequest.updateOne({ _id: s._id }, { $set: { route_name: correctName } });
            studentMismatchesCount++;
        }
    }

    for (const e of employees) {
        const correctName = routeMap[e.route_id];
        if (correctName && e.route_name !== correctName) {
            console.log(`[UPDATE] Employee: ${e.employee_name} (${e.emp_no})`);
            console.log(`  Current Route Name: "${e.route_name}"`);
            console.log(`  Expected Route Name: "${correctName}" (Route ID: ${e.route_id})`);
            
            await EmployeeTransportRequest.updateOne({ _id: e._id }, { $set: { route_name: correctName } });
            employeeMismatchesCount++;
        }
    }

    console.log(`\n--- Summary (Live Update) ---`);
    console.log(`Updated Student Mismatches: ${studentMismatchesCount}`);
    console.log(`Updated Employee Mismatches: ${employeeMismatchesCount}`);

    await mongoose.connection.close();
    console.log('\nDisconnected.');
})();
