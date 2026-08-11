const path = require('path');
const mongoose = require('mongoose');

// Load environment variables from the backend directory
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
    console.error('Error: MONGO_URI is not set in backend/.env');
    process.exit(1);
}

// Define Mongoose schemas/models inline to remain independent
const routeSchema = new mongoose.Schema({
    routeId: String,
    routeName: String,
    startPoint: String,
    endPoint: String,
}, { collection: 'routes' });

const busSchema = new mongoose.Schema({
    busNumber: String,
    capacity: Number,
    assignedRouteId: String,
    driverName: String,
    attendantName: String,
    status: String,
}, { collection: 'buses' });

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

const Route = mongoose.models.Route || mongoose.model('Route', routeSchema);
const Bus = mongoose.models.Bus || mongoose.model('Bus', busSchema);
const TransportRequest = mongoose.models.TransportRequest || mongoose.model('TransportRequest', studentRequestSchema);
const EmployeeTransportRequest = mongoose.models.EmployeeTransportRequest || mongoose.model('EmployeeTransportRequest', employeeRequestSchema);

async function run() {
    try {
        console.log('Connecting to MongoDB...');
        await mongoose.connect(MONGO_URI);
        console.log('Connected successfully.\n');

        const args = process.argv.slice(2);
        const selectedRouteId = args[0];

        if (!selectedRouteId) {
            // Display all routes for selection
            console.log('=== AVAILABLE ROUTES ===');
            const routes = await Route.find().sort({ routeId: 1 }).lean();
            if (routes.length === 0) {
                console.log('No routes found in the database.');
            } else {
                routes.forEach(r => {
                    console.log(`[${r.routeId}] - ${r.routeName} (${r.startPoint || 'Start'} -> ${r.endPoint || 'End'})`);
                });
                console.log('\n--------------------------------------------------------------');
                console.log('To view live count details for a route, run:');
                console.log('  node scripts/route_live_counts.js <RouteID>');
                console.log('Example:');
                console.log('  node scripts/route_live_counts.js R1');
                console.log('--------------------------------------------------------------');
            }
            await mongoose.connection.close();
            return;
        }

        // Fetch selected route details
        const route = await Route.findOne({ routeId: selectedRouteId }).lean();
        if (!route) {
            console.error(`Route with ID "${selectedRouteId}" not found.`);
            await mongoose.connection.close();
            process.exit(1);
        }

        console.log(`=== LIVE COUNT FOR ROUTE: [${route.routeId}] ${route.routeName} ===`);
        
        // Find assigned buses
        const buses = await Bus.find({ assignedRouteId: route.routeId, status: 'Active' }).lean();
        const busNumbers = buses.map(b => b.busNumber);
        
        console.log('\n--- Assigned Bus(es) ---');
        let totalCapacity = 0;
        if (buses.length === 0) {
            console.log('No active buses are assigned to this route.');
        } else {
            buses.forEach(b => {
                console.log(`- Bus Number: ${b.busNumber} (Capacity: ${b.capacity || 0} seats) | Driver: ${b.driverName || 'N/A'}`);
                totalCapacity += (b.capacity || 0);
            });
        }

        // Fetch approved student requests for this route
        const students = await TransportRequest.find({
            route_id: route.routeId,
            status: 'approved'
        }).lean();

        // Filter out expired students
        const now = new Date();
        const liveStudents = students.filter(r => {
            if (r.expiry_date && new Date(r.expiry_date) < now) return false;
            if (r.semester_end_date && new Date(r.semester_end_date) < now) return false;
            return true;
        });
        const expiredCount = students.length - liveStudents.length;

        // Fetch approved employee requests for this route
        const employees = await EmployeeTransportRequest.find({
            route_id: route.routeId,
            status: 'approved'
        }).lean();

        const liveEmployeesCount = employees.length;
        const totalLivePassengers = liveStudents.length + liveEmployeesCount;

        console.log('\n--- Live Occupancy Counts ---');
        console.log(`- Live Students (Active):  ${liveStudents.length}`);
        if (expiredCount > 0) {
            console.log(`  (Note: Excluded ${expiredCount} expired passes)`);
        }
        console.log(`- Live Employees (Active): ${liveEmployeesCount}`);
        console.log(`- Total Live Passengers:   ${totalLivePassengers}`);

        console.log('\n--- Seating Breakdown ---');
        console.log(`- Total Capacity:          ${totalCapacity} seats`);
        console.log(`- Occupied Seats:          ${totalLivePassengers}`);
        if (totalCapacity > 0) {
            const seatsAvailable = Math.max(0, totalCapacity - totalLivePassengers);
            const occupancyPercent = Math.min(100, Math.round((totalLivePassengers / totalCapacity) * 100));
            console.log(`- Available Seats:         ${seatsAvailable}`);
            console.log(`- Occupancy Rate:          ${occupancyPercent}%`);
        } else {
            console.log('- Available Seats:         N/A (No bus capacity configured)');
        }

        // Breakdown by bus allocations
        if (busNumbers.length > 0) {
            console.log('\n--- Bus-Wise Breakdown ---');
            for (const busNum of busNumbers) {
                const bus = buses.find(b => b.busNumber === busNum);
                const busStudents = liveStudents.filter(s => s.bus_id === busNum).length;
                const busEmployees = employees.filter(e => e.bus_id === busNum).length;
                const busTotal = busStudents + busEmployees;
                console.log(`* Bus ${busNum}: Total ${busTotal} passengers (Students: ${busStudents}, Employees: ${busEmployees}) | Capacity: ${bus.capacity || 0}`);
            }
            
            // Show unassigned count
            const unassignedStudents = liveStudents.filter(s => !s.bus_id || !busNumbers.includes(s.bus_id)).length;
            const unassignedEmployees = employees.filter(e => !e.bus_id || !busNumbers.includes(e.bus_id)).length;
            const totalUnassigned = unassignedStudents + unassignedEmployees;
            if (totalUnassigned > 0) {
                console.log(`* Unassigned to any specific Bus: ${totalUnassigned} passengers (Students: ${unassignedStudents}, Employees: ${unassignedEmployees})`);
            }
        }

        console.log('\n==============================================================');
        await mongoose.connection.close();
    } catch (error) {
        console.error('An error occurred:', error.message);
        try {
            await mongoose.connection.close();
        } catch {}
        process.exit(1);
    }
}

run();
