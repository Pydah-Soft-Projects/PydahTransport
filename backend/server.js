const express = require('express');
const dotenv = require('dotenv');
dotenv.config();
const cors = require('cors');
const { connectDB, connectFeeDB, connectEmployeeDB } = require('./config/db');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const { protect } = require('./middleware/authMiddleware');
const busRoutes = require('./routes/busRoutes');
const routeRoutes = require('./routes/routeRoutes');
const authRoutes = require('./routes/authRoutes');
const employeeRoutes = require('./routes/employeeRoutes');
const campusRoutes = require('./routes/campusRoutes');
const taxHeaderRoutes = require('./routes/taxHeaderRoutes');

const { verifyTransportPassenger } = require('./controllers/transportRequestController');

// Public routes
app.use('/api/auth', authRoutes);
app.get('/api/transport-verify/:id', verifyTransportPassenger);
app.use('/api/buses', protect, busRoutes);
app.use('/api/other-vehicles', protect, require('./routes/otherVehicleRoutes'));
app.use('/api/routes', protect, routeRoutes);
app.use('/api/tax-headers', protect, taxHeaderRoutes);
app.use('/api/campuses', campusRoutes);
app.use('/api/employees', employeeRoutes);
app.use('/api/transport-requests', protect, require('./routes/transportRequestRoutes'));
app.use('/api/transport-dues', protect, require('./routes/transportDuesRoutes'));
app.use('/api/users', require('./routes/userRoutes'));
app.use('/api/students', protect, require('./routes/studentRoutes'));
app.use('/api/inventory', protect, require('./routes/inventoryRoutes'));

app.get('/', (req, res) => {
    res.json({ message: 'Pydah Transport API is running🎉' });
});

const PORT = process.env.PORT || 5000;

const startDbs = async () => {
    await connectDB();
    await connectEmployeeDB();
    await connectFeeDB();
};

startDbs()
    .then(() => {
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch((err) => {
        console.error('Failed to start:', err);
        process.exit(1);
    });
