require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const Bus = require('./models/Bus');
const Route = require('./models/Route');
const { fetchVehiclesListFromTgg, fetchReportsFromTgg, parseFuelDayReportFromTgg, parseDailyKilometersFromTggReport, cleanVehicleName, extractPlateKey } = require('./services/tggGpsService');

async function testFuelReportScript() {
  console.log('====================================================');
  console.log('       PYDAH TRANSPORT - FUEL REPORT DIAGNOSTIC     ');
  console.log('====================================================');

  if (!process.env.MONGO_URI) {
    console.error('ERROR: MONGO_URI not set in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[1/3] Connected to MongoDB');

    const tggVehRes = await fetchVehiclesListFromTgg();
    const tggVehicles = tggVehRes.success && Array.isArray(tggVehRes.data) ? tggVehRes.data : [];
    console.log(`[TGG] Loaded ${tggVehicles.length} vehicles from TGG API.`);

    const cliTarget = process.argv[2];
    let buses = await Bus.find({ status: 'Active' }).lean();
    if (cliTarget) {
      const targetClean = cliTarget.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      buses = buses.filter(b => {
        const bNum = (b.busNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const rNum = (b.registrationNumber || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        const combo = `${bNum}${rNum}`;
        return bNum === targetClean || rNum === targetClean || combo === targetClean || rNum.includes(targetClean) || (bNum.length >= 6 && targetClean.includes(bNum));
      });
    }
    console.log(`[2/3] Loaded ${buses.length} active fleet buses matching '${cliTarget || 'all'}'.`);

    const todayStr = new Date().toISOString().split('T')[0];
    const dateFrom = `${todayStr} 00:00:00`;
    const dateTo = `${todayStr} 23:59:59`;

    console.log(`\n[3/3] Querying TGG GPS Reports API for Date: ${todayStr}...`);
    console.log('---------------------------------------------------------------------------------------------------');
    console.log(
      'BUS NUMBER'.padEnd(20) +
      'ROUTE'.padEnd(10) +
      'KMs TRAVELLED'.padEnd(18) +
      'START FUEL (L)'.padEnd(18) +
      'END FUEL (L)'.padEnd(18) +
      'CONSUMPTION (L)'
    );
    console.log('---------------------------------------------------------------------------------------------------');

    const CONCURRENCY = cliTarget ? 1 : 2;
    for (let i = 0; i < buses.length; i += CONCURRENCY) {
      const chunk = buses.slice(i, i + CONCURRENCY);
      await Promise.all(chunk.map(async (bus) => {
        const busKey = extractPlateKey(bus.registrationNumber || bus.busNumber);
        const matchedTgg = tggVehicles.find(v => {
          const vKey = extractPlateKey(v.name);
          return vKey && busKey && (vKey === busKey || vKey.includes(busKey) || busKey.includes(vKey));
        });
        const vehName = matchedTgg?.name || bus.busNumber;

        let kmsStr = '-';
        let initFuelStr = '-';
        let endFuelStr = '-';
        let consStr = '-';

        // 1. Attempt Fuel Day Report query
        try {
          const fuelRes = await fetchReportsFromTgg({
            vehicle_name: vehName,
            date_from: dateFrom,
            date_to: dateTo,
            template: 'Fuel Day Report',
            timeoutMs: 15000
          });

          if (fuelRes.success && fuelRes.data) {
            const parsed = parseFuelDayReportFromTgg(fuelRes.data);
            if (parsed.length > 0) {
              const r = parsed[0];
              if (r.kmsTravelled !== null && r.kmsTravelled !== undefined) kmsStr = `${r.kmsTravelled} km`;
              if (r.initialFuel !== null && r.initialFuel !== undefined) initFuelStr = `${r.initialFuel} L`;
              if (r.finalFuel !== null && r.finalFuel !== undefined) endFuelStr = `${r.finalFuel} L`;
              if (r.fuelConsumption !== null && r.fuelConsumption !== undefined) consStr = `${r.fuelConsumption} L`;
            }
          }
        } catch (e) {}

        // 2. Attempt Daily Report query for distance fallback if KMs missing
        if (kmsStr === '-') {
          try {
            const dRes = await fetchReportsFromTgg({
              vehicle_name: vehName,
              date_from: dateFrom,
              date_to: dateTo,
              template: 'Daily Report',
              timeoutMs: 15000
            });
            if (dRes.success && dRes.data) {
              const parsedKms = parseDailyKilometersFromTggReport(dRes.data, vehName);
              const vals = Object.values(parsedKms).filter(v => v > 0);
              if (vals.length > 0) {
                kmsStr = `${Math.max(...vals)} km`;
              }
            }
          } catch (e) {}
        }

        console.log(
          vehName.padEnd(20) +
          (bus.assignedRouteId || 'N/A').padEnd(10) +
          kmsStr.padEnd(18) +
          initFuelStr.padEnd(18) +
          endFuelStr.padEnd(18) +
          consStr
        );
      }));
    }

    console.log('---------------------------------------------------------------------------------------------------');
    console.log('\nDiagnostic Complete.');
  } catch (err) {
    console.error('Diagnostic error:', err.message);
  } finally {
    await mongoose.disconnect();
    process.exit(0);
  }
}

testFuelReportScript();
