require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const readline = require('readline');
const { connectDB } = require('../config/db');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

const askQuestion = (query) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });
    return new Promise(resolve => rl.question(query, answer => {
        rl.close();
        resolve(answer.trim());
    }));
};

(async () => {
    console.log('Select passenger type to check:');
    console.log('1. Students Only');
    console.log('2. Employees Only');
    console.log('3. Both Students and Employees');
    const choice = await askQuestion('Enter choice (1, 2, or 3) [Default: 3]: ');

    let checkStudents = true;
    let checkEmployees = true;
    if (choice === '1') {
        checkEmployees = false;
    } else if (choice === '2') {
        checkStudents = false;
    }

    console.log('\nConnecting to database...');
    await connectDB();

    console.log('Loading buses, routes, and passenger requests for 2026-2027...');
    const buses = await Bus.find({}).lean();
    const routes = await Route.find({}).lean();

    let unassignedStudents = [];
    if (checkStudents) {
        unassignedStudents = await TransportRequest.find({
            status: 'approved',
            academic_year: '2026-2027',
            $or: [
                { bus_id: null },
                { bus_id: '' }
            ]
        }).lean();
    }

    let unassignedEmployees = [];
    if (checkEmployees) {
        try {
            unassignedEmployees = await EmployeeTransportRequest.find({
                status: 'approved',
                academic_year: '2026-2027',
                $or: [
                    { bus_id: null },
                    { bus_id: '' }
                ]
            }).lean();
        } catch (e) {
            console.error('Error fetching employee transport requests:', e.message);
        }
    }

    const routeMap = Object.fromEntries(routes.map(r => [r.routeId, r]));
    const busesPerRoute = {};
    buses.forEach(b => {
        if (b.assignedRouteId) {
            if (!busesPerRoute[b.assignedRouteId]) {
                busesPerRoute[b.assignedRouteId] = [];
            }
            busesPerRoute[b.assignedRouteId].push(b.busNumber);
        }
    });

    console.log('\n==================================================');
    console.log(`UNASSIGNED PASSENGERS REPORT (2026-2027)`);
    console.log('==================================================\n');

    if (checkStudents) {
        console.log(`Total Unassigned Students: ${unassignedStudents.length}`);
        if (unassignedStudents.length > 0) {
            console.log('\n--- UNASSIGNED STUDENTS ---\n');
            unassignedStudents.forEach((s, idx) => {
                const routeInfo = routeMap[s.route_id];
                const busesAvailable = busesPerRoute[s.route_id] || [];
                console.log(`[${idx + 1}] ${s.student_name} (${s.admission_number})`);
                console.log(`    Route: ${s.route_name} (${s.route_id})`);
                console.log(`    Stage: ${s.stage_name || 'N/A'}`);
                console.log(`    Buses Available on Route: ${busesAvailable.length > 0 ? busesAvailable.join(', ') : 'NONE'}`);
                console.log('--------------------------------------------------');
            });
        }
    }

    if (checkEmployees) {
        console.log(`\nTotal Unassigned Employees: ${unassignedEmployees.length}`);
        if (unassignedEmployees.length > 0) {
            console.log('\n--- UNASSIGNED EMPLOYEES ---\n');
            unassignedEmployees.forEach((e, idx) => {
                const routeInfo = routeMap[e.route_id];
                const busesAvailable = busesPerRoute[e.route_id] || [];
                console.log(`[${idx + 1}] ${e.employee_name} (${e.emp_no})`);
                console.log(`    Route: ${e.route_name} (${e.route_id})`);
                console.log(`    Stage: ${e.stage_name || 'N/A'}`);
                console.log(`    Buses Available on Route: ${busesAvailable.length > 0 ? busesAvailable.join(', ') : 'NONE'}`);
                console.log('--------------------------------------------------');
            });
        }
    }

    console.log('\n==================================================');
    const totalUnassigned = (checkStudents ? unassignedStudents.length : 0) + (checkEmployees ? unassignedEmployees.length : 0);
    console.log(`TOTAL UNASSIGNED PASSENGERS: ${totalUnassigned}`);
    console.log('==================================================\n');

    if (totalUnassigned === 0) {
        console.log('✅ All passengers are assigned to buses!');
    } else {
        console.log('⚠️  Run cleanupBusDiscrepancies.js to auto-assign these passengers to available buses on their routes.');
    }

    await mongoose.connection.close();
})().catch(async (err) => {
    console.error('An error occurred during execution:', err);
    await mongoose.connection.close();
    process.exit(1);
});
