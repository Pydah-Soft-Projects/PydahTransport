const mongoose = require('mongoose');
const dotenv = require('dotenv');
const GpsFinalDestination = require('../models/GpsFinalDestination');

dotenv.config();

async function run() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('Connected to MongoDB');
        const dests = await GpsFinalDestination.find({});
        console.log('Saved Final Destinations:', JSON.stringify(dests, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await mongoose.disconnect();
    }
}
run();
