require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB, mysqlPool } = require('../config/db');
const TransportRequest = require('../models/TransportRequest');

(async () => {
    console.log('Connecting to MongoDB...');
    await connectDB();

    const searchTerm = 'bhanu sri';
    console.log(`\nSearching MongoDB transport_requests for name containing "${searchTerm}"...`);
    const mongoResults = await TransportRequest.find({
        student_name: { $regex: new RegExp(searchTerm, 'i') }
    }).lean();

    console.log(`Found ${mongoResults.length} records in MongoDB:`);
    mongoResults.forEach((r, idx) => {
        console.log(`\n[Mongo Record #${idx + 1}]`);
        console.log(`  Name: ${r.student_name}`);
        console.log(`  Admission Number: ${r.admission_number}`);
        console.log(`  Application Number: ${r.application_number}`);
        console.log(`  Status: ${r.status}`);
        console.log(`  Academic Year: ${r.academic_year}`);
        console.log(`  Route ID: ${r.route_id}`);
        console.log(`  Route Name: ${r.route_name}`);
        console.log(`  Stage Name: ${r.stage_name}`);
        console.log(`  Request ID (Numeric): ${r.id}`);
        console.log(`  MongoDB ID (_id): ${r._id}`);
        console.log(`  Expiry Date: ${r.expiry_date}`);
        console.log(`  Updated At: ${r.updated_at}`);
    });

    if (mysqlPool) {
        console.log(`\nSearching MySQL students table for name containing "${searchTerm}"...`);
        try {
            const [mysqlRows] = await mysqlPool.query(
                `SELECT id, student_name, admission_number, admission_no, pin_no, course, branch, current_year
                 FROM students
                 WHERE student_name LIKE ?`,
                [`%${searchTerm}%`]
            );
            console.log(`Found ${mysqlRows.length} records in MySQL:`);
            mysqlRows.forEach((r, idx) => {
                console.log(`\n[MySQL Record #${idx + 1}]`);
                console.log(`  Name: ${r.student_name}`);
                console.log(`  Admission Number: ${r.admission_number}`);
                console.log(`  Admission No: ${r.admission_no}`);
                console.log(`  PIN Number: ${r.pin_no}`);
                console.log(`  Course: ${r.course}`);
                console.log(`  Branch: ${r.branch}`);
                console.log(`  Year: ${r.current_year}`);
            });
        } catch (mysqlErr) {
            console.error('MySQL search failed:', mysqlErr.message);
        }
    } else {
        console.log('\nMySQL Pool not initialized.');
    }

    await mongoose.connection.close();
    console.log('\nDone.');
})();
