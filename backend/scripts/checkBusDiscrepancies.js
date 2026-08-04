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

    let studentRequests = [];
    if (checkStudents) {
        studentRequests = await TransportRequest.find({ status: 'approved', academic_year: '2026-2027' }).lean();
    }

    let employeeRequests = [];
    if (checkEmployees) {
        try {
            employeeRequests = await EmployeeTransportRequest.find({ status: 'approved', academic_year: '2026-2027' }).lean();
        } catch (e) {
            console.error('Error fetching employee transport requests:', e.message);
        }
    }

    const busMap = Object.fromEntries(buses.map(b => [b.busNumber, b]));
    const routeMap = Object.fromEntries(routes.map(r => [r.routeId, r]));

    const discrepancies = [];

    // Helper to check a passenger's bus assignment
    const checkPassenger = (p, type) => {
        const busId = p.bus_id;
        const routeId = p.route_id;
        const name = p.student_name || p.employee_name || p.name || 'N/A';
        const idNo = p.admission_number || p.admission_no || p.emp_no || 'N/A';

        // Check if passenger has NO bus assignment
        if (!busId) {
            discrepancies.push({
                type,
                name,
                idNo,
                passengerRouteId: routeId,
                assignedBusNumber: null,
                issue: `NOT ASSIGNED to any bus.`
            });
            return;
        }

        const assignedBus = busMap[busId];
        if (!assignedBus) {
            discrepancies.push({
                type,
                name,
                idNo,
                passengerRouteId: routeId,
                assignedBusNumber: busId,
                issue: `Assigned bus "${busId}" does not exist in the system.`
            });
            return;
        }

        const busRouteId = assignedBus.assignedRouteId;
        if (!busRouteId) {
            discrepancies.push({
                type,
                name,
                idNo,
                passengerRouteId: routeId,
                assignedBusNumber: busId,
                issue: `Assigned bus "${busId}" is currently NOT assigned to any route.`
            });
        } else if (busRouteId !== routeId) {
            discrepancies.push({
                type,
                name,
                idNo,
                passengerRouteId: routeId,
                assignedBusNumber: busId,
                busRouteId: busRouteId,
                issue: `Bus route mismatch: passenger is on route "${routeId}" but bus "${busId}" is assigned to route "${busRouteId}".`
            });
        }
    };

    if (checkStudents) {
        studentRequests.forEach(student => checkPassenger(student, 'student'));
    }
    if (checkEmployees) {
        employeeRequests.forEach(employee => checkPassenger(employee, 'employee'));
    }

    console.log('\n==================================================');
    console.log(`DIAGNOSTIC REPORT: BUS-ROUTE PASSENGER DISCREPANCIES (2026-2027)`);
    console.log('==================================================');
    console.log(`Total Buses Checked: ${buses.length}`);
    if (checkStudents) {
        console.log(`Total Approved Students Checked: ${studentRequests.length}`);
    }
    if (checkEmployees) {
        console.log(`Total Approved Employees Checked: ${employeeRequests.length}`);
    }
    console.log(`Total Discrepancies Found: ${discrepancies.length}`);
    console.log('==================================================\n');

    if (discrepancies.length === 0) {
        console.log('✅ No discrepancies found for the selected type! All passenger bus assignments are aligned with their routes.');
    } else {
        console.log('List of affected passengers:\n');
        discrepancies.forEach((d, idx) => {
            console.log(`[${idx + 1}] ${d.type.toUpperCase()}: ${d.name} (${d.idNo})`);
            console.log(`    Passenger Route: ${d.passengerRouteId}`);
            console.log(`    Assigned Bus:    ${d.assignedBusNumber}`);
            if (d.busRouteId) {
                console.log(`    Bus Route:       ${d.busRouteId}`);
            }
            console.log(`    Issue:           ${d.issue}`);
            console.log('--------------------------------------------------');
        });
    }

    await mongoose.connection.close();
})().catch(async (err) => {
    console.error('An error occurred during execution:', err);
    await mongoose.connection.close();
    process.exit(1);
});
