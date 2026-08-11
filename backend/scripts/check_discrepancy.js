const path = require('path');
const mongoose = require('mongoose');

require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

const studentRequestSchema = new mongoose.Schema({
    admission_number: String,
    student_name: String,
    route_id: String,
    status: String,
    bus_id: String,
    expiry_date: Date,
    semester_end_date: Date,
}, { collection: 'transport_requests' });

const employeeRequestSchema = new mongoose.Schema({
    emp_no: String,
    employee_name: String,
    route_id: String,
    status: String,
    bus_id: String,
}, { collection: 'employee_transport_requests' });

const TransportRequest = mongoose.models.TransportRequest || mongoose.model('TransportRequest', studentRequestSchema);
const EmployeeTransportRequest = mongoose.models.EmployeeTransportRequest || mongoose.model('EmployeeTransportRequest', employeeRequestSchema);

async function run() {
    try {
        await mongoose.connect(MONGO_URI);
        const targetBus = 'AP-05-TD-4258';
        console.log(`Connecting to MongoDB...\n`);
        console.log(`=== DIAGNOSING DISCREPANCY FOR BUS: ${targetBus} ===`);

        const now = new Date();

        // 1. Fetch all student requests directly assigned to the bus in MongoDB
        const studentRequests = await TransportRequest.find({
            bus_id: targetBus,
            status: 'approved'
        }).lean();

        // 2. Filter for live occupancy (non-expired)
        const liveStudents = studentRequests.filter(r => {
            if (r.expiry_date && new Date(r.expiry_date) < now) return false;
            if (r.semester_end_date && new Date(r.semester_end_date) < now) return false;
            return true;
        });

        // 3. Fetch employee requests directly assigned to the bus
        const liveEmployees = await EmployeeTransportRequest.find({
            bus_id: targetBus,
            status: 'approved'
        }).lean();

        console.log(`\n--- Passengers assigned to Bus ${targetBus} in MongoDB (Live) ---`);
        console.log(`Total live students: ${liveStudents.length}`);
        console.log(`Total live employees: ${liveEmployees.length}`);
        console.log(`Combined Count on Fleet Page: ${liveStudents.length + liveEmployees.length}`);

        console.log('\n--- Student Passenger Details (including their route_id) ---');
        liveStudents.forEach((s, idx) => {
            console.log(`[${idx + 1}] Student: ${s.student_name} (${s.admission_number}) | Route ID: ${s.route_id} | Status: ${s.status}`);
        });

        console.log('\n--- Employee Passenger Details ---');
        liveEmployees.forEach((e, idx) => {
            console.log(`[${idx + 1}] Employee: ${e.employee_name} (${e.emp_no}) | Route ID: ${e.route_id} | Status: ${e.status}`);
        });

        await mongoose.connection.close();
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

run();
