require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const GpsDailyReport = require('./models/GpsDailyReport');
const GpsFuelReport = require('./models/GpsFuelReport');
const GpsNightStayReport = require('./models/GpsNightStayReport');

async function checkDb() {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('Connected to DB');

    const totalDailyDocs = await GpsDailyReport.countDocuments();
    const totalFuelDocs = await GpsFuelReport.countDocuments();
    const totalNightDocs = await GpsNightStayReport.countDocuments();
    console.log(`Counts -> Daily: ${totalDailyDocs}, Fuel: ${totalFuelDocs}, NightStay: ${totalNightDocs}`);

    const sampleDaily = await GpsDailyReport.find({}).limit(5).lean();
    console.log('Sample GpsDailyReport docs:\n', JSON.stringify(sampleDaily, null, 2));

    process.exit(0);
  } catch (err) {
    console.error('Check error:', err);
    process.exit(1);
  }
}

checkDb();
