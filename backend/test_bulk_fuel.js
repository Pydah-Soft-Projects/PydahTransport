require('dotenv').config({ path: './.env' });
const { fetchReportsFromTgg, parseFuelDayReportFromTgg } = require('./services/tggGpsService');

async function testBulkFuel() {
  console.log('=== Testing Single Bulk Fuel Day Report API Call ===');
  const startTime = Date.now();

  const todayStr = new Date().toISOString().split('T')[0];
  const dfFrom = `${todayStr} 00:00:00`;
  const dfTo = `${todayStr} 23:59:59`;

  console.log(`Querying TGG Bulk Reports API (vehicle_name: "") for date ${todayStr}...`);

  const sampleVehicles = ['R23_AP39UW4611', 'R19_AP39WG5857', 'R07_AP39WH8273', 'R20_AP39VA1853'];
  console.log(`\nTesting ${sampleVehicles.length} sample vehicles with template 'Daily Report'...`);

  for (const veh of sampleVehicles) {
    const t0 = Date.now();
    const res = await fetchReportsFromTgg({
      vehicle_name: veh,
      date_from: dfFrom,
      date_to: dfTo,
      template: 'Daily Report',
      timeoutMs: 4000
    });
    const dt = Date.now() - t0;
    console.log(`\nVehicle: ${veh} (Took ${dt}ms, Success: ${res.success})`);
    if (res.success && res.data) {
      if (typeof res.data === 'object' && res.data !== null) {
        console.log(' - Top keys:', Object.keys(res.data));
      }
    } else {
      console.log(' - Failed / Timeout / Error:', res.error);
    }
  }

  process.exit(0);
}

testBulkFuel();
