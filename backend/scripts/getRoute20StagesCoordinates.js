const mongoose = require('mongoose');
const dotenv = require('dotenv');
const Route = require('../models/Route');
const Bus = require('../models/Bus');
const { getTggConfig } = require('../services/tggGpsService');

dotenv.config();

// Haversine formula to calculate distance in meters between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth radius in meters
    const phi1 = lat1 * Math.PI / 180;
    const phi2 = lat2 * Math.PI / 180;
    const deltaPhi = (lat2 - lat1) * Math.PI / 180;
    const deltaLambda = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
              Math.cos(phi1) * Math.cos(phi2) *
              Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // distance in meters
}

// Generate 2-hour intervals for a single day
function getTwoHourIntervals(dateStr) {
    const intervals = [];
    for (let hour = 5; hour <= 21; hour += 2) {
        const startHour = String(hour).padStart(2, '0');
        const endHour = String(Math.min(hour + 1, 23)).padStart(2, '0');
        
        intervals.push({
            start: `${dateStr} ${startHour}:00:00`,
            end: `${dateStr} ${endHour}:59:59`
        });
    }
    return intervals;
}

// Custom parser to flatten nested TGG Messages API response
function parseTggMessages(rawText) {
    if (!rawText || typeof rawText !== 'string') return [];
    const trimmed = rawText.trim();
    if (!trimmed) return [];

    try {
        const parsed = JSON.parse(trimmed);
        const points = [];

        for (const vehKey of Object.keys(parsed)) {
            const vehData = parsed[vehKey];
            if (vehData && typeof vehData === 'object') {
                for (const indexKey of Object.keys(vehData)) {
                    const log = vehData[indexKey];
                    if (log && log.y && log.x) {
                        points.push({
                            vehicle: vehKey,
                            timestamp: log.time,
                            latitude: parseFloat(log.y),
                            longitude: parseFloat(log.x),
                            speed: parseFloat(log.speed || 0)
                        });
                    }
                }
            }
        }
        return points;
    } catch (err) {
        console.error('[Parser Error] Failed to parse JSON:', err.message);
        return [];
    }
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function run() {
    const targetDate = process.argv[2] || '2026-08-20';
    console.log(`Target Date: ${targetDate}`);

    try {
        // 1. Connect to DB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('MongoDB Connected');

        // 2. Fetch Route R20
        const route = await Route.findOne({ routeId: "R20" });
        if (!route) {
            console.error('Route R20 not found in database.');
            return;
        }
        console.log(`Found Route: [${route.routeId}] ${route.routeName}`);
        const stages = route.stages || [];

        // 3. Find Bus assigned to Route R20
        const bus = await Bus.findOne({ assignedRouteId: "R20", status: 'Active' });
        if (!bus) {
            console.error('No active bus found assigned to Route R20.');
            return;
        }
        const cleanBusNo = bus.busNumber.replace(/[^a-zA-Z0-9]/g, '');
        console.log(`Active Bus: ${bus.busNumber} (${cleanBusNo})`);

        // 4. Fetch TGG GPS traces in 2-hour segments
        const { baseUrl, token, username, password } = getTggConfig();
        const intervals = getTwoHourIntervals(targetDate);
        let gpsTracePoints = [];

        console.log(`Querying TGG Messages API in 2-hour intervals for ${targetDate}...`);
        for (const interval of intervals) {
            const url = `${baseUrl}/messages_api.php?token=${encodeURIComponent(token)}`;
            const params = new URLSearchParams();
            params.append('username', username);
            params.append('password', password);
            params.append('date_from', interval.start);
            params.append('date_to', interval.end);
            params.append('vehicle_name', cleanBusNo);

            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: params
            });

            const rawText = await response.text();
            if (response.ok) {
                const parsedPoints = parseTggMessages(rawText);
                gpsTracePoints = gpsTracePoints.concat(parsedPoints);
                console.log(`- Segment [${interval.start.split(' ')[1]} to ${interval.end.split(' ')[1]}]: Fetched ${parsedPoints.length} points.`);
            } else {
                console.error(`- Segment [${interval.start} to ${interval.end}] failed with status ${response.status}`);
            }

            await delay(150); 
        }

        console.log(`\nGathered ${gpsTracePoints.length} total GPS trace points from TGG Messages API.`);

        // 5. Map each stage to the closest coordinates in the TGG GPS Trace
        console.log('\n========================================================================================');
        console.log('                 ROUTE 20 STAGES COORDINATES COMPARATIVE MAPPING');
        console.log('========================================================================================\n');

        const tableData = [];

        for (const stage of stages) {
            const dbLat = stage.latitude;
            const dbLng = stage.longitude;

            let closestPt = null;
            let minDistance = Infinity;

            for (const pt of gpsTracePoints) {
                const dist = calculateDistance(dbLat, dbLng, pt.latitude, pt.longitude);
                if (dist < minDistance) {
                    minDistance = dist;
                    closestPt = pt;
                }
            }

            const isMatched = closestPt && minDistance <= 500;

            tableData.push({
                stageName: stage.stageName,
                dbLat: dbLat ? dbLat.toFixed(6) : 'N/A',
                dbLng: dbLng ? dbLng.toFixed(6) : 'N/A',
                tggLat: closestPt ? closestPt.latitude.toFixed(6) : 'N/A',
                tggLng: closestPt ? closestPt.longitude.toFixed(6) : 'N/A',
                distance: closestPt ? `${minDistance.toFixed(0)}m` : 'N/A',
                status: isMatched ? '✓ Match' : (closestPt ? '⚠️ Far' : 'x No Data'),
                timestamp: closestPt ? closestPt.timestamp : '—'
            });
        }

        // Print final table
        console.table(tableData.map(row => ({
            'Stage Name': row.stageName,
            'Our Lat': row.dbLat,
            'Our Lng': row.dbLng,
            'TGG Lat': row.tggLat,
            'TGG Lng': row.tggLng,
            'Distance': row.distance,
            'Status': row.status,
            'TGG Time': row.timestamp
        })));

    } catch (err) {
        console.error('Error running script:', err);
    } finally {
        await mongoose.disconnect();
        console.log('\nMongoDB Disconnected');
    }
}

run();
