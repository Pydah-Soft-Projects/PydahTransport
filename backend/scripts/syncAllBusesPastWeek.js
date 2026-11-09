/**
 * syncAllBusesPastWeek.js
 *
 * Bulk sync script to re-fetch and correct Day IN/OUT reports and running kilometers (KMS)
 * across all active fleet buses from Trans Global Geomatics (TGG) GPS API.
 *
 * Usage:
 *   node backend/scripts/syncAllBusesPastWeek.js
 *
 * Or specify custom dates:
 *   node backend/scripts/syncAllBusesPastWeek.js --from=2026-11-01 --to=2026-11-09
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const mongoose = require('mongoose');
const { connectDB } = require('../config/db');
const { syncDayInOutReportForDates } = require('../services/gpsSyncService');
const Bus = require('../models/Bus');
const GpsDailyReport = require('../models/GpsDailyReport');

// Helper to generate an array of YYYY-MM-DD date strings
function getDateRange(fromStr, toStr) {
  const dates = [];
  const current = new Date(`${fromStr}T12:00:00`);
  const end = new Date(`${toStr}T12:00:00`);

  while (current <= end) {
    const yyyy = current.getFullYear();
    const mm = String(current.getMonth() + 1).padStart(2, '0');
    const dd = String(current.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    current.setDate(current.getDate() + 1);
  }
  return dates;
}

// Parse optional CLI arguments: --from=YYYY-MM-DD --to=YYYY-MM-DD
function parseArgs() {
  const args = process.argv.slice(2);
  let from = null;
  let to = null;

  args.forEach(arg => {
    if (arg.startsWith('--from=')) from = arg.split('=')[1];
    if (arg.startsWith('--to=')) to = arg.split('=')[1];
  });

  if (!from || !to) {
    // Default to the past 7 days (today - 6 days up to today)
    const today = new Date();
    const past = new Date();
    past.setDate(today.getDate() - 6);

    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    from = from || fmt(past);
    to = to || fmt(today);
  }

  return { from, to };
}

async function run() {
  const startTime = Date.now();
  console.log('====================================================');
  console.log('     FLEET GPS BULK SYNC - DAY IN/OUT & KMS        ');
  console.log('====================================================');

  await connectDB();

  const { from, to } = parseArgs();
  const dates = getDateRange(from, to);

  const activeBuses = await Bus.find({ status: 'Active' }).select('busNumber assignedRouteId campus').lean();
  console.log(`\n📅 Date Range:  ${from} to ${to} (${dates.length} days)`);
  console.log(`🚌 Active Buses: ${activeBuses.length} vehicles found in database`);
  console.log(`📋 Target Dates: ${dates.join(', ')}\n`);
  console.log('Syncing in progress with rate-limiting throttling (batches of 2)...');
  console.log('Please wait, this may take a couple of minutes depending on vehicle count.\n');

  // Trigger sync with forceRefresh = true to overwrite any previous faulty 0.1km values
  const result = await syncDayInOutReportForDates(dates, true);

  console.log('\n====================================================');
  console.log('                 SYNC COMPLETE!                     ');
  console.log('====================================================');
  console.log(`✅ Status:           Success`);
  console.log(`📊 Records Updated:  ${result.count} record upserts completed`);
  console.log(`⏱️ Time Elapsed:     ${((Date.now() - startTime) / 1000).toFixed(1)} seconds`);

  // Print a quick sample of the updated database records
  const sampleDocs = await GpsDailyReport.find({ date: to, totalKms: { $gt: 0 } }).limit(5).lean();
  if (sampleDocs.length > 0) {
    console.log(`\n🔎 Sample verified records for ${to}:`);
    sampleDocs.forEach(d => {
      console.log(`   - Bus ${d.busNumber.padEnd(16)} | Route: ${(d.routeId || 'N/A').padEnd(6)} | IN: ${(d.firstInTime || '—').padEnd(5)} | OUT: ${(d.lastOutTime || '—').padEnd(5)} | KMS: ${d.totalKms} km`);
    });
  }

  console.log('\nDone! You can now check the GPS Tracking page in your browser.');
  process.exit(0);
}

run().catch(err => {
  console.error('\n❌ Bulk sync encountered an error:', err.message);
  process.exit(1);
});

