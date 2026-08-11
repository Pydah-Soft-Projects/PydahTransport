require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const readline = require('readline');
const { connectDB } = require('../config/db');
const Bus = require('../models/Bus');
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
    console.log('Select passenger type to cleanup/correct:');
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

    console.log('Loading buses, routes, and passenger requests...');
    const buses = await Bus.find({}).lean();
    
    let studentRequests = [];
    if (checkStudents) {
        studentRequests = await TransportRequest.find({ status: 'approved' }).lean();
    }
    
    let employeeRequests = [];
    if (checkEmployees) {
        try {
            employeeRequests = await EmployeeTransportRequest.find({ status: 'approved' }).lean();
        } catch (e) {
            console.error('Error loading employee transport requests:', e.message);
        }
    }

    const busMap = Object.fromEntries(buses.map(b => [b.busNumber, b]));

    // Build map of Route ID -> Array of Bus Numbers currently assigned to that route
    const routeToBusesMap = {};
    buses.forEach(b => {
        if (b.assignedRouteId) {
            if (!routeToBusesMap[b.assignedRouteId]) {
                routeToBusesMap[b.assignedRouteId] = [];
            }
            routeToBusesMap[b.assignedRouteId].push(b.busNumber);
        }
    });

    const studentsToUpdate = [];
    const employeesToUpdate = [];

    // Helper to identify mismatches and find target bus
    const checkPassenger = (p, type, listToPush) => {
        const busId = p.bus_id;
        const routeId = p.route_id;

        const assignedBus = busMap[busId];
        const hasBusExist = !!assignedBus;
        const busRouteId = assignedBus ? assignedBus.assignedRouteId : null;

        // Include passengers with no bus assignment OR mismatched bus assignments
        if (!busId || !hasBusExist || !busRouteId || busRouteId !== routeId) {
            // Get active bus(es) mapped to this route
            const activeBusesForRoute = routeToBusesMap[routeId] || [];
            const targetBusNumber = activeBusesForRoute.length > 0 ? activeBusesForRoute[0] : null;

            listToPush.push({
                _id: p._id,
                name: p.student_name || p.employee_name || p.name || 'N/A',
                idNo: p.admission_number || p.admission_no || p.emp_no || 'N/A',
                oldBusId: busId || 'UNASSIGNED',
                newBusId: targetBusNumber,
                routeId: routeId
            });
        }
    };

    if (checkStudents) {
        studentRequests.forEach(s => checkPassenger(s, 'student', studentsToUpdate));
    }
    if (checkEmployees) {
        employeeRequests.forEach(e => checkPassenger(e, 'employee', employeesToUpdate));
    }

    console.log('\n==================================================');
    console.log(`CORRECTION REPORT STATS`);
    console.log('==================================================');
    if (checkStudents) {
        console.log(`Mismatched Students to correct: ${studentsToUpdate.length}`);
    }
    if (checkEmployees) {
        console.log(`Mismatched Employees to correct: ${employeesToUpdate.length}`);
    }
    console.log('==================================================\n');

    if (studentsToUpdate.length === 0 && employeesToUpdate.length === 0) {
        console.log('✅ No mismatched passenger allocations found. Database is already clean.');
    } else {
        console.log('Updating database allocations...');

        if (studentsToUpdate.length > 0) {
            console.log('\nUpdating Student Bus allocations...');
            for (const s of studentsToUpdate) {
                await TransportRequest.updateOne(
                    { _id: s._id },
                    { $set: { bus_id: s.newBusId } }
                );
                console.log(`[UPDATED] Student: ${s.name} (${s.idNo}) on Route "${s.routeId}": Bus "${s.oldBusId}" -> "${s.newBusId || 'None (No active bus assigned to route)'}"`);
            }
        }

        if (employeesToUpdate.length > 0) {
            console.log('\nUpdating Employee Bus allocations...');
            for (const e of employeesToUpdate) {
                await EmployeeTransportRequest.updateOne(
                    { _id: e._id },
                    { $set: { bus_id: e.newBusId } }
                );
                console.log(`[UPDATED] Employee: ${e.name} (${e.idNo}) on Route "${e.routeId}": Bus "${e.oldBusId}" -> "${e.newBusId || 'None (No active bus assigned to route)'}"`);
            }
        }

        console.log('\n🎉 Re-allocation complete! All mismatched passenger bus assignments have been updated to match their routes.');
    }

    await mongoose.connection.close();
})().catch(async (err) => {
    console.error('An error occurred during execution:', err);
    await mongoose.connection.close();
    process.exit(1);
});
