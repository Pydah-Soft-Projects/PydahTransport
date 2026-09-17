require('dotenv').config({ path: './.env' });
const { fetchReportsFromTgg, getTggConfig } = require('./services/tggGpsService');

async function deepFuelAudit() {
  console.log('=== Deep Audit of TGG Reports API for Fuel Data ===');

  const todayStr = new Date().toISOString().split('T')[0];
  const dfFrom = `${todayStr} 00:00:00`;
  const dfTo = `${todayStr} 23:59:59`;

  const cliVeh = process.argv[2];
  const sampleVehicles = cliVeh ? [cliVeh] : ['R01_AP39UP7549', 'R23_AP39UW4611', 'R19_AP39WG5857', 'R07_AP39WH8273', 'R20_AP39VA1853'];

  console.log(`\n[1/3] Testing templates with 25s timeout for: ${sampleVehicles.join(', ')}...`);

  for (const veh of sampleVehicles) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Vehicle: ${veh}`);

    // Try Fuel Day Report
    console.log(`Querying 'Fuel Day Report' template for ${veh}...`);
    const resFuel = await fetchReportsFromTgg({
      vehicle_name: veh,
      date_from: dfFrom,
      date_to: dfTo,
      template: 'Fuel Day Report',
      timeoutMs: 25000
    });
    console.log(` - Fuel Day Report: success=${resFuel.success}`);
    if (resFuel.success && resFuel.data) {
      console.log(`   Full Fuel Report Response Structure:`);
      console.log(JSON.stringify(resFuel.data, null, 2).substring(0, 1500));
    } else {
      console.log(`   Error/Failure:`, resFuel.message || resFuel.data);
    }

    // Try Daily Report
    console.log(`\nQuerying 'Daily Report' template for ${veh}...`);
    const resDaily = await fetchReportsFromTgg({
      vehicle_name: veh,
      date_from: dfFrom,
      date_to: dfTo,
      template: 'Daily Report',
      timeoutMs: 25000
    });
    console.log(` - Daily Report: success=${resDaily.success}`);
    if (resDaily.success && resDaily.data) {
      console.log(`   Full Daily Report Response Structure:`);
      console.log(JSON.stringify(resDaily.data, null, 2).substring(0, 1500));
    }
  }

  process.exit(0);
}

deepFuelAudit();
