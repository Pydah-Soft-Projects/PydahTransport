require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { connectDB } = require('../config/db');
const { syncDayInOutReportForDates } = require('../services/gpsSyncService');
const GpsDailyReport = require('../models/GpsDailyReport');

async function run() {
  await connectDB();
  const dates = ['2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-09'];
  console.log(`Syncing dates: ${dates.join(', ')} for AP-39-UY-9054...`);
  
  await syncDayInOutReportForDates(dates, true, 'AP-39-UY-9054');

  const docs = await GpsDailyReport.find({
    busNumber: /9054/i,
    date: { $in: dates }
  }).sort({ date: 1 });

  console.log('\n=== Synced Records in GpsDailyReport ===');
  docs.forEach(d => {
    console.log(`${d.date} | IN: ${d.firstInTime.padEnd(5)} | OUT: ${d.lastOutTime.padEnd(5)} | KMS: ${String(d.totalKms).padEnd(6)} km`);
  });

  process.exit(0);
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
