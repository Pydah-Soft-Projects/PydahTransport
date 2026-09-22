/**
 * gpsSyncService.js
 *
 * Core service module responsible for syncing historical GPS reports (Day In/Out, Fuel Day, Night Stay)
 * from Trans Global Geomatics (TGG) API into MongoDB database collections (GpsDailyReport, GpsFuelReport, GpsNightStayReport).
 *
 * Designed with rate-limiting protection (batched execution & delay throttling), idempotency, and high performance.
 */

const {
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  parseFuelDayReportFromTgg,
  parseDailyKilometersFromTggReport,
  parseGeofencesFromTgg,
  parseNightStayFromTggReport,
  extractPlateKey,
  getTggConfig,
  cleanVehicleName,
  findMatchingTggVehicle
} = require('./tggGpsService');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const GpsDailyReport = require('../models/GpsDailyReport');
const GpsFuelReport = require('../models/GpsFuelReport');
const GpsNightStayReport = require('../models/GpsNightStayReport');

/**
 * Calculates Haversine distance in meters between two lat/lng coordinates
 */
const calculateDistanceMeters = (lat1, lon1, lat2, lon2) => {
  if (!Number.isFinite(lat1) || !Number.isFinite(lon1) || !Number.isFinite(lat2) || !Number.isFinite(lon2)) return Infinity;
  const R = 6371e3; // metres
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

const normalizeDateStr = (rawStr) => {
  if (!rawStr) return null;
  const clean = String(rawStr).trim();
  const datePart = clean.includes(' ') ? clean.split(' ')[0] : clean;
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;

  const dMy = datePart.match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (dMy) {
    const [, d, m, y] = dMy;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }
  const yMd = datePart.match(/^(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})$/);
  if (yMd) {
    const [, y, m, d] = yMd;
    return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const d = new Date(clean);
  if (isNaN(d.getTime())) return null;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

/**
 * Utility delay helper
 */
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to resolve assigned route for a bus
 */
const resolveVehicleRoute = (busNumber, buses, routeMap) => {
  const matchedBus = buses.find(b => b.busNumber === busNumber);
  let routeId = matchedBus?.assignedRouteId || null;
  let routeName = routeId && routeMap[routeId] ? routeMap[routeId].routeName : null;

  if (!routeId) {
    const rawPlate = extractPlateKey(busNumber);
    for (const b of buses) {
      if (b.assignedRouteId && extractPlateKey(b.busNumber) === rawPlate) {
        routeId = b.assignedRouteId;
        routeName = routeMap[routeId]?.routeName || null;
        break;
      }
    }
  }

  return { matchedBus, routeId, routeName };
};

/**
 * Sync Day In/Out Reports for a given date range into MongoDB GpsDailyReport
 */
const syncDayInOutReportForDates = async (dates, forceRefresh = false, targetBusNumber = null) => {
  if (!Array.isArray(dates) || dates.length === 0) return { success: true, count: 0 };

  const todayStr = new Date().toISOString().split('T')[0];

  const allBuses = await Bus.find({ status: 'Active' }).lean();
  let buses = allBuses;
  if (targetBusNumber) {
    const tKey = extractPlateKey(targetBusNumber);
    const tDigits = String(targetBusNumber).replace(/\D/g, '').slice(-4);
    const filtered = buses.filter(b => {
      const bKey = extractPlateKey(b.busNumber);
      const rKey = extractPlateKey(b.registrationNumber || '');
      const bDigits = String(b.busNumber).replace(/\D/g, '').slice(-4);
      return (bKey && tKey && bKey === tKey) || (rKey && tKey && rKey === tKey) || (tDigits && bDigits === tDigits) || b.busNumber === targetBusNumber;
    });
    buses = filtered.length > 0 ? filtered : [{ busNumber: targetBusNumber, campus: null }];
  }

  // Filter datesToSync: If not forceRefresh, skip past dates where all buses already have COMPLETE non-blank records in DB
  let datesToSync = dates;
  if (!forceRefresh) {
    const existingDocs = await GpsDailyReport.find({ date: { $in: dates } }).lean();
    datesToSync = dates.filter(dateStr => {
      if (dateStr === todayStr) return true; // Always check live data for today
      for (const bus of buses) {
        const busPlateKey = extractPlateKey(bus.busNumber);
        const doc = existingDocs.find(d => d.date === dateStr && (
          d.busNumber === bus.busNumber ||
          extractPlateKey(d.busNumber) === busPlateKey ||
          extractPlateKey(d.tggVehicleName) === busPlateKey
        ));
        if (!doc || doc.syncStatus !== 'COMPLETE' || (doc.firstInTime === '—' && doc.lastOutTime === '—')) {
          return true; // Missing or incomplete record for a bus, sync this date
        }
      }
      return false; // All buses have COMPLETE record for this past date, skip API query
    });
  }

  if (datesToSync.length === 0) {
    console.log(`[GpsSyncService] All requested past dates (${dates.join(', ')}) are already COMPLETE in DB. Skipping TGG API query.`);
    return { success: true, count: 0 };
  }

  const routes = await Route.find({}).lean();
  const routeMap = {};
  routes.forEach(r => { routeMap[r.routeId] = r; });

  const vehiclesRes = await fetchVehiclesListFromTgg();
  const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

  const dateFromStr = `${datesToSync[0]} 00:00:00`;
  const dateToStr = `${datesToSync[datesToSync.length - 1]} 23:59:59`;

  const BATCH_SIZE = 2;
  let totalSaved = 0;

  for (let i = 0; i < buses.length; i += BATCH_SIZE) {
    const batch = buses.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (bus) => {
      const { routeId, routeName } = resolveVehicleRoute(bus.busNumber, allBuses, routeMap);
      const routeObj = routeMap[routeId];

      let stayPointStage = routeObj?.nightStayPoint;
      if (!stayPointStage || !Number.isFinite(Number(stayPointStage.latitude)) || !Number.isFinite(Number(stayPointStage.longitude)) || Number(stayPointStage.latitude) === 0) {
        if (routeObj && Array.isArray(routeObj.stages) && routeObj.stages.length > 0) {
          stayPointStage = routeObj.stages.find(s => s.isNightStayPoint) || null;
        }
      }

      const stageLat = Number(stayPointStage?.latitude);
      const stageLng = Number(stayPointStage?.longitude);
      const hasStageCoords = Number.isFinite(stageLat) && Number.isFinite(stageLng) && stageLat !== 0 && stageLng !== 0;

      const matchedTgg = findMatchingTggVehicle(bus, tggVehicles);
      if (!matchedTgg) {
        console.log(`[GpsSync] No matching TGG vehicle found for bus ${bus.busNumber}. Skipping TGG sync.`);
        return;
      }
      const tggVehicleName = matchedTgg.name;

      const daysMap = {};
      datesToSync.forEach(d => {
        daysMap[d] = { firstIn: '—', lastOut: '—', kilometers: 0 };
      });

      const stayRadius = Number(stayPointStage?.radius) || 300;

      // 1. Fetch TGG Daily Report per vehicle (Geofences + Mileage Summary)
      try {
        const tggReport = await fetchReportsFromTgg({
          vehicle_name: tggVehicleName,
          date_from: dateFromStr,
          date_to: dateToStr,
          template: 'Daily Report'
        });

        if (tggReport.success && tggReport.data && !tggReport.data.Unitid_err) {
          const gfLogs = parseGeofencesFromTgg(tggReport.data, tggVehicleName);

          gfLogs.forEach(log => {
            if (log.timeIn && log.timeIn !== '—') {
              const normInDate = normalizeDateStr(log.timeIn);
              const inTime = log.timeIn.split(' ')[1]?.substring(0, 5); // HH:mm
              if (normInDate && daysMap[normInDate] && inTime) {
                if (daysMap[normInDate].firstIn === '—' || inTime < daysMap[normInDate].firstIn) {
                  daysMap[normInDate].firstIn = inTime;
                }
              }
            }

            if (log.timeOut && log.timeOut !== '—') {
              const normOutDate = normalizeDateStr(log.timeOut);
              const outTime = log.timeOut.split(' ')[1]?.substring(0, 5); // HH:mm
              if (normOutDate && daysMap[normOutDate] && outTime) {
                if (daysMap[normOutDate].lastOut === '—' || outTime > daysMap[normOutDate].lastOut) {
                  daysMap[normOutDate].lastOut = outTime;
                }
              }
            }

            if (log.mileage && log.mileage !== '—') {
              const mMatch = String(log.mileage).match(/([\d.]+)/);
              if (mMatch) {
                const mVal = Math.round(parseFloat(mMatch[1]) * 10) / 10;
                const logDate = normalizeDateStr(log.timeIn || log.timeOut);
                if (logDate && daysMap[logDate] && mVal > 0) {
                  daysMap[logDate].kilometers = Math.max(daysMap[logDate].kilometers, mVal);
                }
              }
            }
          });

          const parsedKms = parseDailyKilometersFromTggReport(tggReport.data, tggVehicleName);
          Object.keys(parsedKms).forEach(dStr => {
            if (daysMap[dStr] && parsedKms[dStr] > 0) {
              daysMap[dStr].kilometers = Math.max(daysMap[dStr].kilometers, parsedKms[dStr]);
            }
          });
        }
      } catch (err) {
        console.warn(`[GpsSync] Daily report fetch failed for ${tggVehicleName}:`, err.message);
      }

      // Upsert into GpsDailyReport MongoDB collection with safe non-destructive update
      for (const dStr of datesToSync) {
        const dData = daysMap[dStr];
        const isLate = dData.firstIn !== '—' && dData.firstIn > '09:00';
        const isToday = (dStr === todayStr);

        const existingDoc = await GpsDailyReport.findOne({ date: dStr, busNumber: bus.busNumber }).lean();
        const hasValidExistingIn = existingDoc && existingDoc.firstInTime && existingDoc.firstInTime !== '—';
        const hasValidExistingOut = existingDoc && existingDoc.lastOutTime && existingDoc.lastOutTime !== '—';
        const hasValidExistingKm = existingDoc && typeof existingDoc.totalKms === 'number' && existingDoc.totalKms > 0;

        const updateFields = {
          tggVehicleName,
          routeId: routeId || null,
          routeName: routeName || null,
          campus: bus.campus || null,
          syncStatus: isToday ? 'INCOMPLETE' : 'COMPLETE',
          lastSyncedAt: new Date()
        };

        if (dData.firstIn && dData.firstIn !== '—') {
          updateFields.firstInTime = dData.firstIn;
          updateFields.isLateArrival = isLate;
        } else if (!hasValidExistingIn) {
          updateFields.firstInTime = '—';
        }

        if (dData.lastOut && dData.lastOut !== '—') {
          updateFields.lastOutTime = dData.lastOut;
        } else if (!hasValidExistingOut) {
          updateFields.lastOutTime = '—';
        }

        if (dData.kilometers > 0) {
          updateFields.totalKms = dData.kilometers;
        } else if (!hasValidExistingKm) {
          updateFields.totalKms = 0;
        }

        await GpsDailyReport.updateOne(
          { date: dStr, busNumber: bus.busNumber },
          { $set: updateFields },
          { upsert: true }
        );
        totalSaved++;
      }
    }));

    // Delay between batch calls to prevent TGG API rate limits
    await sleep(250);
  }

  return { success: true, count: totalSaved };
};

/**
 * Sync Fuel Day Reports for a given date range into MongoDB GpsFuelReport
 */
const syncFuelDayReportForDates = async (dates, forceRefresh = false, targetBusNumber = null) => {
  if (!Array.isArray(dates) || dates.length === 0) return { success: true, count: 0 };

  const todayStr = new Date().toISOString().split('T')[0];

  let buses = await Bus.find({ status: 'Active', hasFuelSensor: true }).lean();
  if (targetBusNumber) {
    const tKey = extractPlateKey(targetBusNumber);
    const tDigits = String(targetBusNumber).replace(/\D/g, '').slice(-4);
    const filtered = buses.filter(b => {
      const bKey = extractPlateKey(b.busNumber);
      const rKey = extractPlateKey(b.registrationNumber || '');
      const bDigits = String(b.busNumber).replace(/\D/g, '').slice(-4);
      return (bKey && tKey && bKey === tKey) || (rKey && tKey && rKey === tKey) || (tDigits && bDigits === tDigits) || b.busNumber === targetBusNumber;
    });
    buses = filtered.length > 0 ? filtered : [{ busNumber: targetBusNumber, campus: null }];
  } else if (buses.length === 0) {
    const vehiclesRes = await fetchVehiclesListFromTgg();
    if (vehiclesRes.success && Array.isArray(vehiclesRes.data)) {
      buses = vehiclesRes.data.map(v => ({ busNumber: v.name, campus: null }));
    }
  }

  if (buses.length === 0) {
    console.log(`[GpsSyncService] No active buses available to sync fuel day report.`);
    return { success: true, count: 0 };
  }
  const routes = await Route.find({}).lean();
  const routeMap = {};
  routes.forEach(r => { routeMap[r.routeId] = r; });

  const vehiclesRes = await fetchVehiclesListFromTgg();
  const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

  // Filter datesToSync: If not forceRefresh, skip past dates where all buses already have COMPLETE non-blank records in DB
  let datesToSync = dates;
  if (!forceRefresh) {
    const existingFuelDocs = await GpsFuelReport.find({ date: { $in: dates } }).lean();
    datesToSync = dates.filter(dateStr => {
      if (dateStr === todayStr) return true; // Always check live data for today
      for (const bus of buses) {
        const busPlateKey = extractPlateKey(bus.busNumber);
        const doc = existingFuelDocs.find(d => d.date === dateStr && (
          d.busNumber === bus.busNumber ||
          extractPlateKey(d.busNumber) === busPlateKey ||
          extractPlateKey(d.tggVehicleName) === busPlateKey
        ));
        if (!doc || doc.syncStatus !== 'COMPLETE') {
          return true; // Missing or incomplete record for a bus, sync this date
        }
      }
      return false; // All buses have COMPLETE record for this past date, skip API query
    });
  }

  if (datesToSync.length === 0) {
    console.log(`[GpsSyncService] All requested past fuel dates (${dates.join(', ')}) are already COMPLETE in DB. Skipping TGG API query.`);
    return { success: true, count: 0 };
  }

  const dateFromStr = `${datesToSync[0]} 00:00:00`;
  const dateToStr = `${datesToSync[datesToSync.length - 1]} 23:59:59`;

  // Pre-fetch daily report docs from MongoDB for kilometers to avoid redundant API calls
  const dailyDocs = await GpsDailyReport.find({ date: { $in: datesToSync } }).lean();

  const BATCH_SIZE = 5;
  let totalSaved = 0;

  for (let i = 0; i < buses.length; i += BATCH_SIZE) {
    const batch = buses.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (bus) => {
      const { routeId, routeName } = resolveVehicleRoute(bus.busNumber, buses, routeMap);
      const matchedTgg = findMatchingTggVehicle(bus, tggVehicles);
      if (!matchedTgg) {
        console.log(`[GpsSync] No matching TGG vehicle found for bus ${bus.busNumber}. Skipping TGG fuel sync.`);
        return;
      }
      const tggVehicleName = matchedTgg.name;

      try {
        let fuelReportData = null;
        const reportRes = await fetchReportsFromTgg({
          vehicle_name: tggVehicleName,
          date_from: dateFromStr,
          date_to: dateToStr,
          template: 'Fuel Day Report',
          timeoutMs: 25000
        });
        if (reportRes.success && reportRes.data && !reportRes.data.Unitid_err) {
          fuelReportData = reportRes.data;
        }

        let initialFuel = 0;
        let finalFuel = 0;
        let fuelConsumption = 0;

        if (fuelReportData) {
          const parsedArray = parseFuelDayReportFromTgg(fuelReportData);
          const parsedFuel = Array.isArray(parsedArray)
            ? (parsedArray.find(p => extractPlateKey(p.tggVehicleName) === extractPlateKey(tggVehicleName)) || parsedArray[0] || {})
            : (parsedArray || {});
          initialFuel = parsedFuel.initialFuel || 0;
          finalFuel = parsedFuel.finalFuel || 0;
          fuelConsumption = parsedFuel.fuelConsumption || 0;
        }

        for (const dStr of datesToSync) {
          const isToday = (dStr === todayStr);

          const existingFuel = await GpsFuelReport.findOne({ date: dStr, busNumber: bus.busNumber }).lean();
          const dailyDoc = dailyDocs.find(d => d.date === dStr && (d.busNumber === bus.busNumber || extractPlateKey(d.busNumber) === extractPlateKey(bus.busNumber)));
          const kmsTravelled = dailyDoc?.totalKms || 0;

          const updateFuelFields = {
            tggVehicleName,
            routeId: routeId || null,
            routeName: routeName || null,
            campus: bus.campus || null,
            syncStatus: isToday ? 'INCOMPLETE' : 'COMPLETE',
            lastSyncedAt: new Date()
          };

          updateFuelFields.initialFuelLiters = initialFuel;
          updateFuelFields.finalFuelLiters = finalFuel;
          updateFuelFields.fuelConsumedLiters = fuelConsumption;
          if (kmsTravelled > 0 || !existingFuel) updateFuelFields.distanceTravelledKm = kmsTravelled;

          await GpsFuelReport.updateOne(
            { date: dStr, busNumber: bus.busNumber },
            { $set: updateFuelFields },
            { upsert: true }
          );
          totalSaved++;
        }
      } catch (err) {
        console.warn(`[GpsSync] Fuel report sync notice for ${tggVehicleName}:`, err.message);
      }
    }));

    await sleep(200);
  }

  return { success: true, count: totalSaved };
};

/**
 * Sync Night Stay Reports for a given date range into MongoDB GpsNightStayReport
 */
const syncNightStayReportForDates = async (dates, forceRefresh = false, targetBusNumber = null) => {
  if (!Array.isArray(dates) || dates.length === 0) return { success: true, count: 0 };

  let buses = await Bus.find({ status: 'Active' }).lean();
  if (targetBusNumber) {
    const tKey = extractPlateKey(targetBusNumber);
    const tDigits = String(targetBusNumber).replace(/\D/g, '').slice(-4);
    const filtered = buses.filter(b => {
      const bKey = extractPlateKey(b.busNumber);
      const rKey = extractPlateKey(b.registrationNumber || '');
      const bDigits = String(b.busNumber).replace(/\D/g, '').slice(-4);
      return (bKey && tKey && bKey === tKey) || (rKey && tKey && rKey === tKey) || (tDigits && bDigits === tDigits) || b.busNumber === targetBusNumber;
    });
    buses = filtered.length > 0 ? filtered : [{ busNumber: targetBusNumber, campus: null }];
  }
  const routes = await Route.find({}).lean();
  const routeMap = {};
  routes.forEach(r => { routeMap[r.routeId] = r; });

  // Only sync buses whose assigned route has an explicitly configured Night Stay Point
  const configuredBuses = buses.filter(bus => {
    const { routeId } = resolveVehicleRoute(bus.busNumber, buses, routeMap);
    const routeObj = routeMap[routeId];
    if (!routeObj) return false;
    const hasDirectStayPoint = Boolean(routeObj.nightStayPoint?.stageName) || (Number.isFinite(Number(routeObj.nightStayPoint?.latitude)) && Number(routeObj.nightStayPoint?.latitude) !== 0);
    const hasStageStayPoint = Array.isArray(routeObj.stages) && routeObj.stages.some(s => s.isNightStayPoint);
    return hasDirectStayPoint || hasStageStayPoint;
  });

  // Purge any default unconfigured docs from MongoDB for these dates
  await GpsNightStayReport.deleteMany({
    date: { $in: dates },
    $or: [
      { nightStayLocation: 'Campus / Assigned Night Stay' },
      { nightStayLocation: 'Night Stay Point' },
      { routeId: null }
    ]
  });

  const vehiclesRes = await fetchVehiclesListFromTgg();
  const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

  const dateFromStr = `${dates[0]} 00:00:00`;
  const dateToStr = `${dates[dates.length - 1]} 23:59:59`;

  const todayStr = new Date().toISOString().split('T')[0];
  const BATCH_SIZE = 3;
  let totalSaved = 0;

  for (let i = 0; i < configuredBuses.length; i += BATCH_SIZE) {
    const batch = configuredBuses.slice(i, i + BATCH_SIZE);

    await Promise.all(batch.map(async (bus) => {
      const { routeId, routeName } = resolveVehicleRoute(bus.busNumber, configuredBuses, routeMap);
      const routeObj = routeMap[routeId];

      let stayPointStage = routeObj?.nightStayPoint;
      if (!stayPointStage || !Number.isFinite(Number(stayPointStage.latitude)) || !Number.isFinite(Number(stayPointStage.longitude)) || Number(stayPointStage.latitude) === 0) {
        if (routeObj && Array.isArray(routeObj.stages) && routeObj.stages.length > 0) {
          stayPointStage = routeObj.stages.find(s => s.isNightStayPoint) || null;
        }
      }

      const stayPointName = stayPointStage?.stageName || routeObj?.nightStayPoint?.stageName || 'Night Stay Point';
      const stageLat = Number(stayPointStage?.latitude ?? routeObj?.nightStayPoint?.latitude) || null;
      const stageLng = Number(stayPointStage?.longitude ?? routeObj?.nightStayPoint?.longitude) || null;
      const stayRadius = Number(stayPointStage?.radius ?? routeObj?.nightStayPoint?.radius) || 1500;

      const matchedTgg = findMatchingTggVehicle(bus, tggVehicles);
      if (!matchedTgg) {
        console.log(`[GpsSync] No matching TGG vehicle found for bus ${bus.busNumber}. Skipping TGG night stay sync.`);
        return;
      }
      const tggVehicleName = matchedTgg.name;

      // Primary Engine: Fetch TGG Daily Report (Geofences + Movement/Stops)
      let reportStayData = {};
      try {
        const reportRes = await fetchReportsFromTgg({
          vehicle_name: tggVehicleName,
          date_from: dateFromStr,
          date_to: dateToStr,
          template: 'Daily Report',
          timeoutMs: 15000
        });
        if (reportRes.success && reportRes.data && !reportRes.data.Unitid_err) {
          reportStayData = parseNightStayFromTggReport(reportRes.data, tggVehicleName, stageLat, stageLng, stayRadius);
        }
      } catch (err) {
        console.warn(`[GpsSync] Daily report fetch for night stay failed for ${tggVehicleName}:`, err.message);
      }

      for (const dStr of dates) {
        const isToday = (dStr === todayStr);
        let firstInTime = reportStayData[dStr]?.firstIn || '—';
        let lastOutTime = reportStayData[dStr]?.lastOut || '—';

        // Secondary Fallback Engine: Scan position history (Messages API) if primary report returned empty
        if ((firstInTime === '—' || lastOutTime === '—') && Number.isFinite(stageLat) && Number.isFinite(stageLng) && stageLat !== 0 && stageLng !== 0) {
          try {
            const msgRes = await fetchVehicleMessagesFromTgg({
              vehicle_name: tggVehicleName,
              date_from: `${dStr} 04:00:00`,
              date_to: `${dStr} 23:00:00`
            });

            if (msgRes.success && Array.isArray(msgRes.data) && msgRes.data.length > 0) {
              const insideLogs = [];

              msgRes.data.forEach(log => {
                const pLat = parseFloat(log.latitude || log.lat || log.y);
                const pLng = parseFloat(log.longitude || log.lng || log.x);
                const timeStr = log.timeStr || (log.timestamp && log.timestamp.includes(' ') ? log.timestamp.split(' ')[1]?.substring(0, 5) : null);

                if (Number.isFinite(pLat) && Number.isFinite(pLng) && timeStr) {
                  const dist = calculateDistanceMeters(stageLat, stageLng, pLat, pLng);
                  if (dist <= stayRadius) {
                    insideLogs.push({ timeStr, rawTime: log.timestamp });
                  }
                }
              });

              if (insideLogs.length > 0) {
                // Evening Arrival at Night Stay Point (OUT column in UI)
                if (lastOutTime === '—') {
                  const eveLogs = insideLogs.filter(l => l.timeStr >= '15:00');
                  if (eveLogs.length > 0) {
                    lastOutTime = eveLogs[0].timeStr;
                  }
                }

                // Morning Departure from Night Stay Point (IN column in UI)
                if (firstInTime === '—') {
                  const mornLogs = insideLogs.filter(l => l.timeStr >= '04:00' && l.timeStr <= '11:00');
                  if (mornLogs.length > 0) {
                    firstInTime = mornLogs[mornLogs.length - 1].timeStr;
                  }
                }
              }
            }
          } catch (e) {
            console.warn(`[GpsSync] Night stay position calculation error for ${bus.busNumber}:`, e.message);
          }
        }

        await GpsNightStayReport.updateOne(
          { date: dStr, busNumber: bus.busNumber },
          {
            $set: {
              tggVehicleName,
              routeId: routeId || null,
              routeName: routeName || null,
              campus: bus.campus || null,
              nightStayLocation: stayPointName,
              lat: stageLat,
              lng: stageLng,
              stopDurationMinutes: 480, // Default overnight stay 8 hrs
              firstInTime,
              lastOutTime,
              syncStatus: isToday ? 'INCOMPLETE' : 'COMPLETE',
              lastSyncedAt: new Date()
            }
          },
          { upsert: true }
        );
        totalSaved++;
      }
    }));

    await sleep(300);
  }

  return { success: true, count: totalSaved };
};

/**
 * Master sync function to run GPS report syncs based on requested reportType
 * reportType options: 'day_in_out' (or 'day'), 'night_stay' (or 'night'), 'fuel', or 'all'
 */
const syncAllReportsForDates = async (dates, forceRefresh = false, targetBusNumber = null, reportType = 'day_in_out') => {
  const rType = String(reportType || 'day_in_out').toLowerCase();
  console.log(`[GpsSyncService] Starting sync for dates: ${dates.join(', ')} (Type: ${rType})${targetBusNumber ? ` (Bus: ${targetBusNumber})` : ''}...`);
  const t0 = Date.now();

  let dayRes = { success: true, count: 0 };
  let fuelRes = { success: true, count: 0 };
  let nightRes = { success: true, count: 0 };

  if (rType === 'all') {
    // Run sequentially instead of Promise.all to prevent overloading TGG API rate limits
    dayRes = await syncDayInOutReportForDates(dates, forceRefresh, targetBusNumber);
    fuelRes = await syncFuelDayReportForDates(dates, forceRefresh, targetBusNumber);
    nightRes = await syncNightStayReportForDates(dates, forceRefresh, targetBusNumber);
  } else if (rType === 'fuel') {
    fuelRes = await syncFuelDayReportForDates(dates, forceRefresh, targetBusNumber);
  } else if (rType === 'night_stay' || rType === 'night') {
    nightRes = await syncNightStayReportForDates(dates, forceRefresh, targetBusNumber);
  } else {
    // Default to day_in_out
    dayRes = await syncDayInOutReportForDates(dates, forceRefresh, targetBusNumber);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[GpsSyncService] Sync finished in ${elapsed}s! Saved ${dayRes.count} day records, ${fuelRes.count} fuel records, ${nightRes.count} night stay records.`);

  return {
    success: true,
    elapsedSeconds: Number(elapsed),
    dayRecords: dayRes.count,
    fuelRecords: fuelRes.count,
    nightStayRecords: nightRes.count
  };
};

module.exports = {
  syncDayInOutReportForDates,
  syncFuelDayReportForDates,
  syncNightStayReportForDates,
  syncAllReportsForDates
};
