require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB, mysqlPool } = require('../config/db');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');

(async () => {
    console.log('Connecting to database...');
    await connectDB();
    const busNum = 'AP-39-WH-2173';

    const bus = await Bus.findOne({ busNumber: busNum });
    if (!bus) {
        console.log(`Bus ${busNum} not found.`);
        await mongoose.connection.close();
        return;
    }

    const studentMongoRequests = await TransportRequest.find({
        bus_id: busNum,
        status: 'approved'
    }).lean();

    const admissionNos = [...new Set(studentMongoRequests.map(r => r.admission_number).filter(Boolean))];
    let studentMap = {};
    if (mysqlPool && admissionNos.length > 0) {
        const [studentRows] = await mysqlPool.query(
            `SELECT admission_number, admission_no, course, branch, pin_no, current_year, student_photo, student_data
             FROM students
             WHERE admission_number IN (?) OR admission_no IN (?)`,
            [admissionNos, admissionNos]
        );
        for (const s of studentRows) {
            if (s.admission_number) studentMap[s.admission_number] = s;
            if (s.admission_no) studentMap[s.admission_no] = s;
        }
    }

    const now = new Date();
    const activeStudents = [];
    const expiredStudents = [];

    studentMongoRequests.forEach((r) => {
        const student = (r.admission_number && studentMap[r.admission_number]) || {};
        let isExpired = false;
        if (r.expiry_date) {
            isExpired = new Date(r.expiry_date) < now;
        } else if (r.semester_end_date) {
            isExpired = new Date(r.semester_end_date) < now;
        }

        const info = {
            name: r.student_name,
            admission: r.admission_number,
            route_name: r.route_name,
            route_id: r.route_id,
            expiry_date: r.expiry_date,
            semester_end_date: r.semester_end_date
        };

        if (isExpired) {
            expiredStudents.push(info);
        } else {
            activeStudents.push(info);
        }
    });

    const employees = await EmployeeTransportRequest.find({
        bus_id: busNum,
        status: 'approved'
    }).lean();

    console.log(`\n========================================`);
    console.log(`ACTIVE vs EXPIRED ANALYSIS FOR BUS ${busNum}`);
    console.log(`========================================`);
    console.log(`Total Approved Student Records in Mongo: ${studentMongoRequests.length}`);
    console.log(`Active Students: ${activeStudents.length}`);
    console.log(`Expired Students: ${expiredStudents.length}`);
    console.log(`Approved Employees: ${employees.length}`);
    console.log(`Total Active Seats Filled (Students + Employees): ${activeStudents.length + employees.length}`);

    // Group active by route_name
    const activeGroups = {};
    activeStudents.forEach(s => {
        const key = `${s.route_id} - ${s.route_name}`;
        activeGroups[key] = (activeGroups[key] || 0) + 1;
    });
    employees.forEach(e => {
        const key = `${e.route_id || 'R02'} - ${e.route_name || 'Staff'}`;
        activeGroups[key] = (activeGroups[key] || 0) + 1;
    });

    console.log(`\n--- Active Passenger Count by Route ---`);
    console.dir(activeGroups);

    if (expiredStudents.length > 0) {
        console.log(`\n--- Expired Student Records ---`);
        expiredStudents.forEach((s, idx) => {
            console.log(`[${idx+1}] ${s.name} (${s.admission}) - Route: ${s.route_name} - Expiry: ${s.expiry_date || s.semester_end_date}`);
        });
    }

    await mongoose.connection.close();
    console.log('\nDisconnected.');
})();
