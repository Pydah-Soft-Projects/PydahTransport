require('dotenv').config({ path: './.env' });
const { fetchVehiclesListFromTgg, fetchReportsFromTgg } = require('./services/tggGpsService');

async function testTggNames() {
  console.log('=== Fetching live vehicles list from TGG API ===');
  const res = await fetchVehiclesListFromTgg({ force: true });
  console.log(`Success: ${res.success}, Count: ${res.data.length}`);

  if (res.data && res.data.length > 0) {
    console.log('\nFirst 10 vehicles in TGG API:');
    res.data.slice(0, 10).forEach(v => {
      console.log(` - name: "${v.name}", units: "${v.units}", speed: ${v.speed}`);
    });

    const testVehicles = res.data.slice(0, 10).map(v => v.name);
    console.log(`\nTesting fetchReportsFromTgg for 10 fleet vehicles...`);

    const todayStr = new Date().toISOString().split('T')[0];
    for (const veh of testVehicles) {
      const reportRes = await fetchReportsFromTgg({
        vehicle_name: veh,
        date_from: `${todayStr} 00:00:00`,
        date_to: `${todayStr} 23:59:59`,
        template: 'Daily Report',
        timeoutMs: 4000
      });

      if (reportRes.success && reportRes.data) {
        const vehData = reportRes.data[veh] || Object.values(reportRes.data)[0];
        const reportTypes = vehData ? Object.keys(vehData) : [];
        console.log(` - ${veh}: Available Report Modules: [${reportTypes.join(', ')}]`);
      } else {
        console.log(` - ${veh}: No response / Error`);
      }
    }
  }

  process.exit(0);
}

testTggNames();
