const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Route = require('../models/Route');

dotenv.config();

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        const route = await Route.findOne({ routeId: 'R20' });
        console.log('Route R20:', JSON.stringify(route, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
run();
