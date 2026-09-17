require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');
const Route = require('./models/Route');
const Bus = require('./models/Bus');
const { fetchVehicleMessagesFromTgg, cleanVehicleName } = require('./services/tggGpsService');

const calculateDistance = (lat1, lon1, lat2, lon2) => {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return Infinity;
  const R = 6371e3;
  const phi1 = lat1 * Math.PI / 180;
  const phi2 = lat2 * Math.PI / 180;
  const deltaPhi = (lat2 - lat1) * Math.PI / 180;
  const deltaLambda = (lon2 - lon1) * Math.PI / 180;

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
};

async function testNightStayR20() {
  console.log('=== Night Stay Diagnostic for R20 (16 Sep 2026) ===');
  
  if (!process.env.MONGO_URI) {
    console.error('ERROR: MONGO_URI not found in backend/.env');
    process.exit(1);
  }

  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log('[1/4] Connected to MongoDB');

    // 1. Fetch Route R20
    const route = await Route.findOne({ routeId: 'R20' }).lean();
    if (!route) {
      console.error('ERROR: Route R20 not found in database');
      process.exit(1);
    }

    let stayPointStage = route.nightStayPoint;
    if (!stayPointStage || !Number.isFinite(Number(stayPointStage.latitude)) || Number(stayPointStage.latitude) === 0) {
      if (Array.isArray(route.stages) && route.stages.length > 0) {
        stayPointStage = route.stages.find(s => s.isNightStayPoint) || null;
      }
    }

    console.log('\n[2/4] Route R20 Night Stay Point Config:');
    console.log(' - Stage Name:', stayPointStage?.stageName || route.nightStayPoint?.stageName || 'Not Set');
    console.log(' - Latitude:', stayPointStage?.latitude);
    console.log(' - Longitude:', stayPointStage?.longitude);
    console.log(' - Radius (m):', stayPointStage?.radius || 300);

    const stageLat = Number(stayPointStage?.latitude);
    const stageLng = Number(stayPointStage?.longitude);
    const radius = Number(stayPointStage?.radius) || 300;

    if (!Number.isFinite(stageLat) || !Number.isFinite(stageLng) || stageLat === 0 || stageLng === 0) {
      console.warn('\nWARNING: Route R20 has invalid/unconfigured Night Stay coordinates (0,0 or null).');
      console.warn('Night Stay IN / OUT cannot be computed without valid coordinates.');
      process.exit(0);
    }

    // 2. Query TGG Messages API for 16 Sep 2026
    const vehicleName = 'R20_AP39VA1853';
    const dateFrom = '2026-09-16 00:00:00';
    const dateTo = '2026-09-16 23:59:59';

    console.log(`\n[3/4] Querying TGG Messages API for vehicle "${vehicleName}" from ${dateFrom} to ${dateTo}...`);
    const msgRes = await fetchVehicleMessagesFromTgg({
      vehicle_name: vehicleName,
      date_from: dateFrom,
      date_to: dateTo
    });

    if (!msgRes.success || !Array.isArray(msgRes.data) || msgRes.data.length === 0) {
      console.log('NO GPS position logs returned from TGG for 16 Sep 2026.');
      process.exit(0);
    }

    const logs = msgRes.data;
    console.log(`Fetched ${logs.length} raw GPS position logs for ${vehicleName} on 16 Sep 2026.`);

    // Sort chronologically
    logs.sort((a, b) => new Date(a.timestamp || a.time) - new Date(b.timestamp || b.time));

    // 3. Evaluate geofence
    console.log('\n[4/4] Geofence Evaluation Results:');
    let lastOut = null;
    let firstIn = null;
    const insideLogs = [];

    logs.forEach(pt => {
      const rawTime = pt.timestamp || pt.time;
      if (!rawTime) return;

      const timeParts = String(rawTime).trim().split(' ');
      const timeStr = timeParts[1] ? timeParts[1].substring(0, 5) : null;
      if (!timeStr) return;

      const pLat = parseFloat(pt.latitude || pt.lat || pt.y);
      const pLng = parseFloat(pt.longitude || pt.lng || pt.x);

      if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
        const dist = calculateDistance(stageLat, stageLng, pLat, pLng);
        const isInside = dist <= radius;

        if (isInside) {
          insideLogs.push({ time: timeStr, rawTime, dist: Math.round(dist) });

          // Morning departure OUT (04:00 to 12:00)
          if (timeStr >= '04:00' && timeStr < '12:00') {
            if (!lastOut || timeStr > lastOut) {
              lastOut = timeStr;
            }
          }

          // Evening arrival IN (>= 16:00)
          if (timeStr >= '16:00') {
            if (!firstIn || timeStr < firstIn) {
              firstIn = timeStr;
            }
          }
        }
      }
    });

    console.log(` - Points inside Geofence (${radius}m): ${insideLogs.length} of ${logs.length}`);
    console.log(' - Computed Morning Departure (OUT):', lastOut || '— (No departure log detected)');
    console.log(' - Computed Evening Arrival (IN):', firstIn || '— (No arrival log detected)');

    if (insideLogs.length > 0) {
      console.log('\nSample Inside Geofence Logs (First 5 and Last 5):');
      const sample = [...insideLogs.slice(0, 5), ...insideLogs.slice(-5)];
      sample.forEach(l => console.log(`   Time: ${l.rawTime} | Distance: ${l.dist}m`));
    }

  } catch (err) {
    console.error('Error running test script:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDone.');
    process.exit(0);
  }
}

testNightStayR20();
