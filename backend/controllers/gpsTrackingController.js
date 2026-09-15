const {
  getTggConfig,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts,
  fetchDailyKilometersFromTgg,
  extractPlateKey,
  extractRouteIdFromVehicleName,
  cleanVehicleName,
} = require('../services/tggGpsService');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const GpsFinalDestination = require('../models/GpsFinalDestination');
const campusService = require('../services/campusService');

/**
 * Resolves allowed bus query filter based on logged in user campus permissions & query params
 */
const getCampusBusQueryFilter = async (req) => {
  const user = req.user;
  const isSuperAdmin = !user || (
    Boolean(user.username && !user.emp_no) || 
    (Array.isArray(user.roles) && (
      user.roles.includes('SuperAdmin') || 
      user.roles.includes('Super Admin') || 
      user.roles.includes('admin')
    ))
  );

  const hasCampusRestriction = user && !isSuperAdmin && Array.isArray(user.campuses) && user.campuses.length > 0;
  
  let targetCampusIds = null;
  const queryCampusId = campusService.normalizeCampusId(req.query?.campus);

  if (queryCampusId !== null) {
    if (hasCampusRestriction) {
      const allowedIds = campusService.normalizeCampusIds(user.campuses);
      targetCampusIds = allowedIds.includes(queryCampusId) ? [queryCampusId] : allowedIds;
    } else {
      targetCampusIds = [queryCampusId];
    }
  } else if (hasCampusRestriction) {
    targetCampusIds = campusService.normalizeCampusIds(user.campuses);
  }

  if (!targetCampusIds || targetCampusIds.length === 0) {
    return { query: { status: 'Active' }, isRestricted: false, targetCampusIds: [], matchingRouteIds: [] };
  }

  // Find routes matching target campus IDs
  const matchingRoutes = await Route.find({ campus: { $in: targetCampusIds } }).select('routeId').lean();
  const matchingRouteIds = matchingRoutes.map(r => r.routeId);

  return {
    query: {
      status: 'Active',
      $or: [
        { campus: { $in: targetCampusIds } },
        { assignedRouteId: { $in: matchingRouteIds } }
      ]
    },
    isRestricted: true,
    targetCampusIds,
    matchingRouteIds
  };
};

/**
 * Resolve the exact TGG vehicle_name for API calls.
 * Accepts either a full TGG name (R23_AP39UW4611) or a local bus plate (AP39UW4611).
 */
const resolveTggVehicleName = async (inputName) => {
  const raw = cleanVehicleName(inputName);
  if (!raw) return '';

  try {
    const vehiclesRes = await fetchVehiclesListFromTgg();
    if (vehiclesRes.success && Array.isArray(vehiclesRes.data) && vehiclesRes.data.length > 0) {
      const inputKey = extractPlateKey(raw);
      const exact = vehiclesRes.data.find((v) => String(v.name || '').trim() === raw);
      if (exact?.name) return exact.name;

      if (inputKey) {
        const byPlate = vehiclesRes.data.find((v) => extractPlateKey(v.name) === inputKey);
        if (byPlate?.name) return byPlate.name;
      }
    }
  } catch (err) {
    console.warn('[GPS] resolveTggVehicleName fallback:', err.message);
  }

  return raw;
};

const resolveVehicleRoute = (vehName, buses, routeMap) => {
  const plateKey = extractPlateKey(vehName);
  const matchedBus = buses.find((b) => extractPlateKey(b.busNumber) === plateKey);

  let routeIdVal = 'Unassigned';
  let routeNameVal = 'Unassigned';

  if (matchedBus && matchedBus.assignedRouteId) {
    routeIdVal = matchedBus.assignedRouteId;
    const routeObj = routeMap[matchedBus.assignedRouteId];
    if (routeObj) routeNameVal = routeObj.routeName;
  } else {
    const routeFromName = extractRouteIdFromVehicleName(vehName);
    if (routeFromName && routeMap[routeFromName]) {
      routeIdVal = routeFromName;
      routeNameVal = routeMap[routeFromName].routeName || routeFromName;
    } else if (routeFromName) {
      routeIdVal = routeFromName;
      routeNameVal = routeFromName;
    }
  }

  return { matchedBus, routeId: routeIdVal, routeName: routeNameVal };
};

/**
 * Controller to fetch live vehicles list from TGG API
 */
const fetchLiveVehicles = async (req, res) => {
  try {
    const result = await fetchVehiclesListFromTgg(req.query);
    if (!result.success || !Array.isArray(result.data)) {
      return res.status(200).json(result);
    }

    const { query: busQueryFilter, isRestricted, matchingRouteIds } = await getCampusBusQueryFilter(req);
    const buses = await Bus.find(busQueryFilter).lean();
    const routes = await Route.find({}).lean();
    const routeMap = {};
    routes.forEach(r => {
      routeMap[r.routeId] = r;
    });

    const mappedData = result.data.map(veh => {
      const { routeId, routeName } = resolveVehicleRoute(veh.name, buses, routeMap);

      return {
        ...veh,
        routeId,
        routeName
      };
    });

    const allowedBusPlateKeys = new Set(buses.map(b => extractPlateKey(b.busNumber)).filter(Boolean));
    const filteredMappedData = isRestricted
      ? mappedData.filter(veh => {
          const plate = extractPlateKey(veh.name);
          const route = extractRouteIdFromVehicleName(veh.name);
          return allowedBusPlateKeys.has(plate) || (route && matchingRouteIds.includes(route));
        })
      : mappedData;

    return res.status(200).json({
      success: true,
      isMock: result.isMock,
      message: result.message || 'Vehicles list retrieved successfully',
      data: filteredMappedData
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch vehicle list'
    });
  }
};

/**
 * Controller to fetch vehicle reports from TGG API
 */
const fetchVehicleReports = async (req, res) => {
  try {
    const reportQuery = {
      date_from: req.body.date_from || req.query.date_from,
      date_to: req.body.date_to || req.query.date_to,
      vehicle_name: req.body.vehicle_name || req.query.vehicle_name,
      template: req.body.template || req.query.template
    };

    const result = await fetchReportsFromTgg(reportQuery);
    return res.status(200).json({
      success: true,
      isMock: result.isMock,
      message: result.message || 'Vehicle reports retrieved successfully',
      data: result.data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch vehicle reports'
    });
  }
};

/**
 * Controller to fetch vehicle position history (Messages API)
 */
const fetchVehicleHistory = async (req, res) => {
  try {
    const historyQuery = {
      date_from: req.body.date_from || req.query.date_from,
      date_to: req.body.date_to || req.query.date_to,
      vehicle_name: req.body.vehicle_name || req.query.vehicle_name
    };

    const result = await fetchVehicleMessagesFromTgg(historyQuery);
    return res.status(200).json({
      success: true,
      isMock: result.isMock,
      message: result.message || 'Position history retrieved successfully',
      data: result.data
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch vehicle history'
    });
  }
};

/**
 * Webhook receiver controller for TGG Geofence Alerts
 * POST parameters: unit, time, location, message
 */
const receiveGeofenceAlert = async (req, res) => {
  try {
    const alertData = {
      unit: req.body.unit || req.query.unit,
      time: req.body.time || req.query.time,
      location: req.body.location || req.query.location,
      message: req.body.message || req.query.message
    };

    const savedAlert = registerIncomingAlert(alertData);
    return res.status(200).json({
      success: true,
      message: 'Geofence alert received and logged successfully',
      alert: savedAlert
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to process geofence alert'
    });
  }
};

/**
 * Controller to fetch logged geofence alerts
 */
const fetchRecentAlerts = async (req, res) => {
  try {
    const alerts = getRecentAlerts();
    return res.status(200).json({
      success: true,
      data: alerts
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch recent alerts'
    });
  }
};

/**
 * Controller to check environment configuration status
 */
const getGpsConfigStatus = (req, res) => {
  const config = getTggConfig();
  const isConfigured = Boolean(config.token && config.username && config.password);

  return res.status(200).json({
    success: true,
    isConfigured,
    baseUrl: config.baseUrl,
    hasToken: Boolean(config.token),
    hasUsername: Boolean(config.username),
    hasPassword: Boolean(config.password)
  });
};

/**
 * Controller to fetch day-wise kilometers for a specific vehicle in a date range
 */
const fetchDailyKilometers = async (req, res) => {
  try {
    const query = {
      vehicle_name: req.query.vehicle_name || req.body.vehicle_name,
      date_from: req.query.date_from || req.body.date_from,
      date_to: req.query.date_to || req.body.date_to
    };

    if (!query.vehicle_name) {
      return res.status(400).json({
        success: false,
        message: 'vehicle_name is required'
      });
    }

    query.vehicle_name = await resolveTggVehicleName(query.vehicle_name);

    // Default to last 7 days if date range is not specified
    if (!query.date_from || !query.date_to) {
      const today = new Date();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(today.getDate() - 7);

      query.date_from = query.date_from || sevenDaysAgo.toISOString().split('T')[0];
      query.date_to = query.date_to || today.toISOString().split('T')[0];
    }

    const result = await fetchDailyKilometersFromTgg(query);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch daily kilometers'
    });
  }
};

/**
 * Controller to fetch total kilometers travelled by all fleet vehicles in a date range
 */
const fetchFleetTravelled = async (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    if (!date_from || !date_to) {
      return res.status(400).json({ success: false, message: 'date_from and date_to are required parameters.' });
    }

    const vehiclesRes = await fetchVehiclesListFromTgg();
    if (!vehiclesRes.success) {
      return res.status(500).json({ success: false, message: 'Failed to fetch vehicles list from TGG.' });
    }

    const vehicles = vehiclesRes.data;
    const buses = await Bus.find({}).lean();
    const routes = await Route.find({}).lean();
    const routeMap = {};
    routes.forEach(r => {
      routeMap[r.routeId] = r;
    });
    
    // Process in chunks with concurrency limit of 2 to avoid flooding TGG API
    const results = [];
    const CONCURRENCY = 2;
    for (let i = 0; i < vehicles.length; i += CONCURRENCY) {
      const chunk = vehicles.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (veh) => {
        try {
          const kmRes = await fetchDailyKilometersFromTgg({
            vehicle_name: veh.name,
            date_from,
            date_to
          });
          
          let totalKm = 0;
          let isMock = false;
          if (kmRes.success && Array.isArray(kmRes.data)) {
            totalKm = kmRes.data.reduce((acc, d) => acc + d.kilometers, 0);
            isMock = kmRes.isMock;
          }

          const { routeId: routeIdVal, routeName: routeNameVal } = resolveVehicleRoute(veh.name, buses, routeMap);
          
          return {
            name: veh.name,
            units: veh.units,
            latitude: veh.latitude,
            longitude: veh.longitude,
            speed: veh.speed,
            routeId: routeIdVal,
            routeName: routeNameVal,
            totalKm: Math.round(totalKm * 10) / 10,
            isMock
          };
        } catch (err) {
          const { routeId: routeIdVal, routeName: routeNameVal } = resolveVehicleRoute(veh.name, buses, routeMap);

          return {
            name: veh.name,
            units: veh.units,
            latitude: veh.latitude,
            longitude: veh.longitude,
            speed: veh.speed,
            routeId: routeIdVal,
            routeName: routeNameVal,
            totalKm: 0,
            isMock: false
          };
        }
      }));
      results.push(...chunkResults);
    }

    return res.status(200).json({
      success: true,
      data: results
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch fleet travelled summary'
    });
  }
};

/**
 * GET /api/gps/final-destination?campus=1
 */
const getFinalDestination = async (req, res) => {
  try {
    const campus = Number(req.query.campus);
    if (!Number.isFinite(campus)) {
      return res.status(400).json({ success: false, message: 'campus query parameter is required' });
    }

    const dest = await GpsFinalDestination.findOne({ campus });
    return res.status(200).json({ success: true, data: dest || null });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch final destination' });
  }
};

/**
 * GET /api/gps/final-destinations (all saved destinations)
 */
const getAllFinalDestinations = async (req, res) => {
  try {
    const destinations = await GpsFinalDestination.find({ isActive: true }).sort({ campus: 1 });
    return res.status(200).json({ success: true, data: destinations });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch destinations' });
  }
};

/**
 * GET /api/gps/geofence-report?vehicle_name=X&date_from=Y&date_to=Z
 * Fetches the "Geofences" section from the TGG Daily Report and normalises it
/**
 * Helper to extract geofence logs array from TGG reports API response
 */
const parseGeofencesFromTgg = (tggData, vehName) => {
  if (!tggData || typeof tggData !== 'object') return [];

  let geofenceContainer = null;
  if (tggData[vehName]?.Geofences?.[vehName]) {
    geofenceContainer = tggData[vehName].Geofences[vehName];
  } else if (tggData[vehName]?.Geofences) {
    geofenceContainer = tggData[vehName].Geofences;
  } else if (tggData.Geofences?.[vehName]) {
    geofenceContainer = tggData.Geofences[vehName];
  } else if (tggData.Geofences) {
    geofenceContainer = tggData.Geofences;
  } else {
    for (const key of Object.keys(tggData)) {
      const v = tggData[key];
      if (v?.Geofences) {
        for (const gKey of Object.keys(v.Geofences)) {
          geofenceContainer = v.Geofences[gKey];
          if (geofenceContainer) break;
        }
      }
      if (geofenceContainer) break;
    }
  }

  if (!geofenceContainer) return [];

  const rawEntries = Array.isArray(geofenceContainer) ? geofenceContainer : Object.values(geofenceContainer);

  return rawEntries.map((entry) => {
    const c = entry?.c || entry || {};
    const tIn = c['2']?.t || c.timeIn || c.time_in || '—';
    const tOut = c['3']?.t || c.timeOut || c.time_out || '—';
    return {
      geofence: c['1'] || c.name || c.geofence || 'Campus Main Geofence',
      timeIn: tIn,
      latIn: c['2']?.y ?? null,
      lngIn: c['2']?.x ?? null,
      timeOut: tOut,
      latOut: c['3']?.y ?? null,
      lngOut: c['3']?.x ?? null,
      duration: c['4'] || c.duration || '—',
      mileage: c['5'] || c.mileage || '—',
    };
  });
};

/**
 * Helper to extract daily kilometers dictionary ({ 'YYYY-MM-DD': kmValue }) from TGG report response
 */
const parseDailyKilometersFromTggReport = (tggData, vehName) => {
  const kmByDate = {};
  if (!tggData || typeof tggData !== 'object') return kmByDate;

  let vehObj = tggData[vehName] || null;
  if (!vehObj) {
    for (const k of Object.keys(tggData)) {
      if (tggData[k] && typeof tggData[k] === 'object' && (tggData[k].Mileage || tggData[k]["Total KMs Travelled"] || tggData[k].Summary || tggData[k].Distance)) {
        vehObj = tggData[k];
        break;
      }
    }
  }

  const sections = vehObj || tggData;
  const distanceReport = sections["Mileage"] || sections["Total KMs Travelled"] || sections["Summary"] || sections["Distance"];
  if (!distanceReport) return kmByDate;

  const subObjList = Array.isArray(distanceReport) ? [distanceReport] : Object.values(distanceReport);
  subObjList.forEach(subObj => {
    const rows = Array.isArray(subObj) ? subObj : (subObj && typeof subObj === 'object' ? Object.values(subObj) : []);
    rows.forEach(rowItem => {
      const cObj = rowItem?.c || rowItem;
      if (cObj && typeof cObj === 'object') {
        let rowDate = null;
        let kmVal = 0;
        for (const key of Object.keys(cObj)) {
          const val = String(cObj[key] || '');
          const normD = normalizeDateStr(val);
          if (normD) {
            rowDate = normD;
          }
          if (val.toLowerCase().includes('km') || /^\d+(\.\d+)?$/.test(val.trim())) {
            const m = val.match(/([\d.]+)/);
            if (m) {
              const n = parseFloat(m[1]);
              if (!isNaN(n) && n > 0 && n < 2000) {
                kmVal = Math.max(kmVal, n);
              }
            }
          }
        }
        if (rowDate && kmVal > 0) {
          kmByDate[rowDate] = Math.round(kmVal * 10) / 10;
        }
      }
    });
  });

  return kmByDate;
};

/**
 * GET /api/gps/geofence-report?vehicle_name=X&date_from=Y&date_to=Z
 * Fetches the "Geofences" section from the TGG Daily Report and normalises it
 * into a flat array of { geofence, timeIn, timeOut, duration, mileage, latIn, lngIn, latOut, lngOut }.
 */
const fetchGeofenceReport = async (req, res) => {
  try {
    const { vehicle_name, date_from, date_to } = req.query;
    if (!vehicle_name) {
      return res.status(400).json({ success: false, message: 'vehicle_name is required' });
    }

    const tggVehicleName = await resolveTggVehicleName(vehicle_name);
    const dfFrom = date_from ? `${date_from} 00:00:00` : '';
    const dfTo = date_to ? `${date_to} 23:59:59` : '';

    const result = await fetchReportsFromTgg({
      vehicle_name: tggVehicleName,
      date_from: dfFrom,
      date_to: dfTo,
      template: 'Daily Report',
    });

    if (!result.success || !result.data) {
      return res.status(200).json({ success: true, data: [] });
    }

    const rows = parseGeofencesFromTgg(result.data, tggVehicleName);
    return res.status(200).json({ success: true, data: rows });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch geofence report' });
  }
};

/**
 * PUT /api/gps/final-destination
 */
const saveFinalDestination = async (req, res) => {
  try {
    const { name, campus, latitude, longitude, radius, morningStart, morningEnd, eveningStart, eveningEnd } = req.body;

    if (!name || campus === undefined || campus === null) {
      return res.status(400).json({ success: false, message: 'name and campus are required' });
    }
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) {
      return res.status(400).json({ success: false, message: 'Valid latitude and longitude are required' });
    }

    const dest = await GpsFinalDestination.findOneAndUpdate(
      { campus: Number(campus) },
      {
        name: String(name).trim(),
        campus: Number(campus),
        latitude: Number(latitude),
        longitude: Number(longitude),
        radius: Number(radius) || 200,
        morningStart: morningStart || '07:00',
        morningEnd: morningEnd || '09:30',
        eveningStart: eveningStart || '16:00',
        eveningEnd: eveningEnd || '19:00',
        isActive: true,
      },
      { upsert: true, new: true, runValidators: true }
    );

    return res.status(200).json({ success: true, message: 'Final destination saved successfully', data: dest });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to save final destination' });
  }
};

/**
 * GET /api/gps/final-destination/report?campus=1&date=2026-08-20
 * Calculates active bus geofence in/out times locally from Messages API for the defined time frames.
 */
const fetchFinalDestinationReport = async (req, res) => {
  try {
    const campus = Number(req.query.campus);
    const date = req.query.date || new Date().toISOString().split('T')[0];

    if (!Number.isFinite(campus)) {
      return res.status(400).json({ success: false, message: 'campus query parameter is required' });
    }

    const dest = await GpsFinalDestination.findOne({ campus });
    if (!dest) {
      return res.status(200).json({ success: true, data: [], message: 'No final destination geofence configured for this campus.' });
    }

    const { latitude, longitude, radius, morningStart, morningEnd, eveningStart, eveningEnd } = dest;

    const routes = await Route.find({ campus }).lean();
    const routeIds = routes.map(r => r.routeId);
    const routeMap = {};
    routes.forEach(r => {
      routeMap[r.routeId] = r.routeName;
    });

    const buses = await Bus.find({ assignedRouteId: { $in: routeIds }, status: 'Active' }).lean();
    if (buses.length === 0) {
      return res.status(200).json({ success: true, data: [], message: 'No active buses assigned to routes for this campus.' });
    }

    const calculateDistance = (lat1, lon1, lat2, lon2) => {
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

    const parseTggMessagesLocal = (rawText) => {
      if (!rawText) return [];
      try {
        const parsed = JSON.parse(rawText.trim());
        const points = [];
        for (const vehKey of Object.keys(parsed)) {
          const vehData = parsed[vehKey];
          if (vehData && typeof vehData === 'object') {
            for (const logKey of Object.keys(vehData)) {
              const log = vehData[logKey];
              if (log && log.y && log.x) {
                points.push({
                  timestamp: log.time || log.timestamp || '',
                  latitude: parseFloat(log.y),
                  longitude: parseFloat(log.x)
                });
              }
            }
          }
        }
        return points;
      } catch (e) {
        return [];
      }
    };

    // Resolve TGG names once for all buses (plate → R##_PLATE)
    const vehiclesRes = await fetchVehiclesListFromTgg();
    const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

    const reportRows = await Promise.all(buses.map(async (bus) => {
      const plateKey = extractPlateKey(bus.busNumber);
      const matchedTgg = tggVehicles.find((v) => extractPlateKey(v.name) === plateKey);
      const tggVehicleName = matchedTgg?.name || cleanVehicleName(bus.busNumber);
      const routeName = routeMap[bus.assignedRouteId] || bus.assignedRouteId;

      let mrngIn = '—';
      let mrngOut = '—';
      let evngIn = '—';
      let evngOut = '—';

      // 1. Morning Geofence Check
      try {
        const { baseUrl, token, username, password } = getTggConfig();
        const url = `${baseUrl}/messages_api.php?token=${encodeURIComponent(token)}`;
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        params.append('date_from', `${date} ${morningStart}:00`);
        params.append('date_to', `${date} ${morningEnd}:00`);
        params.append('vehicle_name', tggVehicleName);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          const points = parseTggMessagesLocal(rawText);
          const insidePoints = points.filter(pt => calculateDistance(latitude, longitude, pt.latitude, pt.longitude) <= radius);
          
          if (insidePoints.length > 0) {
            insidePoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            mrngIn = insidePoints[0].timestamp.split(' ')[1] || insidePoints[0].timestamp;
            mrngOut = insidePoints[insidePoints.length - 1].timestamp.split(' ')[1] || insidePoints[insidePoints.length - 1].timestamp;
          }
        }
      } catch (err) {
        console.error(`Error calculating morning geofence for bus ${bus.busNumber}:`, err.message);
      }

      // 2. Evening Geofence Check
      try {
        const { baseUrl, token, username, password } = getTggConfig();
        const url = `${baseUrl}/messages_api.php?token=${encodeURIComponent(token)}`;
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        params.append('date_from', `${date} ${eveningStart}:00`);
        params.append('date_to', `${date} ${eveningEnd}:00`);
        params.append('vehicle_name', tggVehicleName);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          const points = parseTggMessagesLocal(rawText);
          const insidePoints = points.filter(pt => calculateDistance(latitude, longitude, pt.latitude, pt.longitude) <= radius);
          
          if (insidePoints.length > 0) {
            insidePoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
            evngIn = insidePoints[0].timestamp.split(' ')[1] || insidePoints[0].timestamp;
            evngOut = insidePoints[insidePoints.length - 1].timestamp.split(' ')[1] || insidePoints[insidePoints.length - 1].timestamp;
          }
        }
      } catch (err) {
        console.error(`Error calculating evening geofence for bus ${bus.busNumber}:`, err.message);
      }

      return {
        busNumber: bus.busNumber,
        routeId: bus.assignedRouteId,
        routeName,
        mrngIn,
        mrngOut,
        evngIn,
        evngOut
      };
    }));

    return res.status(200).json({
      success: true,
      data: reportRows
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Failed to fetch final destination geofence report' });
  }
};

const dailyHistoryCache = {};

/**
 * GET /api/gps/daily-history?vehicle_name=AP39VA1853&date=2026-08-20
 * Queries the TGG Messages API in parallel 2-hour segments to fetch raw 10-second coordinates for the entire day.
 */
const fetchDailyHistory = async (req, res) => {
  try {
    const { vehicle_name, date } = req.query;
    if (!vehicle_name) {
      return res.status(400).json({ success: false, message: 'vehicle_name is required' });
    }
    const targetDate = date || new Date().toISOString().split('T')[0];

    // Define 2-hour segments from 05:00 to 21:00 (covers all possible bus runs)
    const segments = [];
    for (let hour = 5; hour <= 19; hour += 2) {
      const startHour = String(hour).padStart(2, '0');
      const endHour = String(hour + 2).padStart(2, '0');
      segments.push({
        start: `${targetDate} ${startHour}:00:00`,
        end: `${targetDate} ${endHour}:00:00`
      });
    }

    const tggVehicleName = await resolveTggVehicleName(vehicle_name);
    const cacheKeyBase = extractPlateKey(tggVehicleName) || tggVehicleName.replace(/[^a-zA-Z0-9]/g, '');

    const cacheKey = `${cacheKeyBase}_${targetDate}`;
    const cached = dailyHistoryCache[cacheKey];
    const now = Date.now();
    const isToday = targetDate === new Date().toISOString().split('T')[0];
    const cacheTTL = isToday ? 2 * 60 * 1000 : 24 * 60 * 60 * 1000; // 2 mins for today, 24 hrs for past dates

    if (cached && (now - cached.timestamp < cacheTTL)) {
      return res.status(200).json({
        success: true,
        data: cached.data
      });
    }

    const parseTggMessagesLocal = (rawText) => {
      if (!rawText) return [];
      try {
        const parsed = JSON.parse(rawText.trim());
        const points = [];
        for (const vehKey of Object.keys(parsed)) {
          const vehData = parsed[vehKey];
          if (vehData && typeof vehData === 'object') {
            for (const logKey of Object.keys(vehData)) {
              const log = vehData[logKey];
              if (log && log.y && log.x) {
                points.push({
                  timestamp: log.time || log.timestamp || '',
                  latitude: parseFloat(log.y),
                  longitude: parseFloat(log.x)
                });
              }
            }
          }
        }
        return points;
      } catch (e) {
        return [];
      }
    };

    // Query TGG Messages API in parallel for all segments
    const promises = segments.map(async (seg) => {
      try {
        const { baseUrl, token, username, password } = getTggConfig();
        const url = `${baseUrl}/messages_api.php?token=${encodeURIComponent(token)}`;
        const params = new URLSearchParams();
        params.append('username', username);
        params.append('password', password);
        params.append('date_from', seg.start);
        params.append('date_to', seg.end);
        params.append('vehicle_name', tggVehicleName);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          return parseTggMessagesLocal(rawText);
        }
        return [];
      } catch (e) {
        return [];
      }
    });

    const results = await Promise.all(promises);
    let allPoints = [];
    results.forEach(pts => {
      allPoints = allPoints.concat(pts);
    });

    // Sort chronologically
    allPoints.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    // Save to cache
    dailyHistoryCache[cacheKey] = {
      timestamp: Date.now(),
      data: allPoints
    };

    return res.status(200).json({
      success: true,
      data: allPoints
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to fetch daily history'
    });
  }
};

const buildDateRangeArray = (fromStr, toStr) => {
  if (!fromStr || !toStr) return [];
  const start = new Date(`${fromStr}T12:00:00`);
  const end = new Date(`${toStr}T12:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];

  const dates = [];
  let cur = new Date(start);
  while (cur <= end) {
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    dates.push(`${yyyy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
};

const normalizeDateStr = (rawStr) => {
  if (!rawStr || typeof rawStr !== 'string') return null;
  const cleaned = rawStr.trim();
  const datePart = cleaned.split(' ')[0].split('T')[0];
  
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return datePart;
  }
  const dmY = datePart.match(/^(\d{2})[\/\-\.](\d{2})[\/\-\.](\d{4})$/);
  if (dmY) {
    const [, d, m, y] = dmY;
    return `${y}-${m}-${d}`;
  }
  const yMd = datePart.match(/^(\d{4})[\/\.](\d{2})[\/\.](\d{2})$/);
  if (yMd) {
    const [, y, m, d] = yMd;
    return `${y}-${m}-${d}`;
  }
  
  const dt = new Date(cleaned);
  if (!isNaN(dt.getTime())) {
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
};

/**
 * GET /api/gps/day-inout-report
 * Returns bus IN and OUT times table report for a specified date range
 */
const fetchDayInOutReport = async (req, res) => {
  try {
    const dateToParam = req.query.date_to || new Date().toISOString().split('T')[0];
    const dateFromParam = req.query.date_from || null;
    const forceRefresh = req.query.refresh === 'true';
    
    let dates = buildDateRangeArray(dateFromParam, dateToParam);

    if (dates.length === 0) {
      // Default array of 5 dates ending on dateToParam
      const end = new Date(`${dateToParam}T12:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - 4);
      const yFrom = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const yTo = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      dates = buildDateRangeArray(yFrom, yTo);
    }

    const userIdStr = req.user?._id ? String(req.user._id) : 'anon';
    const cacheKey = `day_inout_${userIdStr}_${dateFromParam || 'default'}_${dateToParam}_${req.query.campus || 'all'}`;
    // Use in-memory cache if fresh (10-minute TTL) unless forceRefresh is true
    if (!forceRefresh && global._7dayInOutCache && global._7dayInOutCache[cacheKey] && (Date.now() - global._7dayInOutCache[cacheKey].timestamp < 600000)) {
      return res.status(200).json(global._7dayInOutCache[cacheKey].data);
    }

    const { query: busQueryFilter } = await getCampusBusQueryFilter(req);
    const buses = await Bus.find(busQueryFilter).lean();
    const routes = await Route.find({}).lean();
    const routeMap = {};
    routes.forEach(r => {
      routeMap[r.routeId] = r;
    });

    const vehiclesRes = await fetchVehiclesListFromTgg();
    const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

    const dateFromStr = `${dates[0]} 00:00:00`;
    const dateToStr = `${dates[dates.length - 1]} 23:59:59`;
    const todayStr = new Date().toISOString().split('T')[0];
    const nowHHMM = new Date().toTimeString().substring(0, 5);

    // Process buses concurrently in fast chunks of 6
    const CONCURRENCY = 6;
    const reportRows = [];
    for (let i = 0; i < buses.length; i += CONCURRENCY) {
      const chunk = buses.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (bus) => {
        const { routeId, routeName } = resolveVehicleRoute(bus.busNumber, buses, routeMap);
        const plateKey = extractPlateKey(bus.busNumber);
        const matchedTgg = tggVehicles.find((v) => extractPlateKey(v.name) === plateKey);
        const tggVehicleName = matchedTgg?.name || cleanVehicleName(bus.busNumber);

        const daysMap = {};
        dates.forEach(d => {
          daysMap[d] = { firstIn: null, lastOut: null, kilometers: 0 };
        });

        // 1. Fetch IN/OUT Geofence logs and daily mileage from single TGG range report
        try {
          const tggReport = await fetchReportsFromTgg({
            vehicle_name: tggVehicleName,
            date_from: dateFromStr,
            date_to: dateToStr,
            template: 'Daily Report'
          });

          if (tggReport.success && tggReport.data) {
            const gfLogs = parseGeofencesFromTgg(tggReport.data, tggVehicleName);
            
            // Group TGG geofence logs by normalized date for IN/OUT and log mileage
            gfLogs.forEach(log => {
              if (log.timeIn && log.timeIn !== '—') {
                const normInDate = normalizeDateStr(log.timeIn);
                const inTime = log.timeIn.split(' ')[1]?.substring(0, 5); // HH:mm
                if (normInDate && daysMap[normInDate] && inTime) {
                  if (!daysMap[normInDate].firstIn || inTime < daysMap[normInDate].firstIn) {
                    daysMap[normInDate].firstIn = inTime;
                  }
                }
              }

              if (log.timeOut && log.timeOut !== '—') {
                const normOutDate = normalizeDateStr(log.timeOut);
                const outTime = log.timeOut.split(' ')[1]?.substring(0, 5); // HH:mm
                if (normOutDate && daysMap[normOutDate] && outTime) {
                  if (!daysMap[normOutDate].lastOut || outTime > daysMap[normOutDate].lastOut) {
                    daysMap[normOutDate].lastOut = outTime;
                  }
                }
              }

              // Extract mileage from geofence row if available
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

            // Extract daily kilometers directly from Mileage/Summary section in single tggReport
            const parsedKms = parseDailyKilometersFromTggReport(tggReport.data, tggVehicleName);
            Object.keys(parsedKms).forEach(dStr => {
              if (daysMap[dStr] && parsedKms[dStr] > 0) {
                daysMap[dStr].kilometers = Math.max(daysMap[dStr].kilometers, parsedKms[dStr]);
              }
            });
          }
        } catch (err) {
          console.warn(`[GPS] geofence report fetch failed for ${tggVehicleName}:`, err.message);
        }

        // 3. Validation for dates (suppress future OUT times for Today, no mock data)
        dates.forEach(dateStr => {
          const dayObj = daysMap[dateStr];
          const isToday = dateStr === todayStr;

          // For TODAY, if recorded lastOut is in the future relative to current time, reset to null
          if (isToday && dayObj.lastOut && dayObj.lastOut > nowHHMM) {
            dayObj.lastOut = null;
          }
        });

        return {
          busNumber: bus.busNumber,
          tggVehicleName,
          routeId,
          routeName,
          days: daysMap
        };
      }));

      reportRows.push(...chunkResults);
    }

    // Merge with previous cache to preserve valid historical readings if TGG API temporarily returned empty
    const previousCache = global._7dayInOutCache?.[cacheKey]?.data?.data;
    if (previousCache && Array.isArray(previousCache)) {
      reportRows.forEach(row => {
        const prevRow = previousCache.find(p => p.busNumber === row.busNumber);
        if (prevRow && prevRow.days) {
          Object.keys(row.days).forEach(dStr => {
            const currentDay = row.days[dStr];
            const prevDay = prevRow.days[dStr];
            if (prevDay) {
              if (!currentDay.firstIn && prevDay.firstIn) currentDay.firstIn = prevDay.firstIn;
              if (!currentDay.lastOut && prevDay.lastOut) currentDay.lastOut = prevDay.lastOut;
              if ((!currentDay.kilometers || currentDay.kilometers === 0) && prevDay.kilometers > 0) {
                currentDay.kilometers = prevDay.kilometers;
              }
            }
          });
        }
      });
    }

    const responsePayload = {
      success: true,
      dates,
      data: reportRows
    };

    if (!global._7dayInOutCache) global._7dayInOutCache = {};
    global._7dayInOutCache[cacheKey] = {
      timestamp: Date.now(),
      data: responsePayload
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate 7-day IN/OUT report'
    });
  }
};

/**
 * GET /api/gps/nightstay-report
 * Returns Night Stay IN and OUT times table report for each route's designated night stay point
 */
const fetchNightStayReport = async (req, res) => {
  try {
    const dateToParam = req.query.date_to || new Date().toISOString().split('T')[0];
    const dateFromParam = req.query.date_from || null;
    const forceRefresh = req.query.refresh === 'true';
    
    let dates = buildDateRangeArray(dateFromParam, dateToParam);

    if (dates.length === 0) {
      const end = new Date(`${dateToParam}T12:00:00`);
      const start = new Date(end);
      start.setDate(start.getDate() - 4);
      const yFrom = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      const yTo = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
      dates = buildDateRangeArray(yFrom, yTo);
    }

    const userIdStr = req.user?._id ? String(req.user._id) : 'anon';
    const cacheKey = `nightstay_${userIdStr}_${dateFromParam || 'default'}_${dateToParam}_${req.query.campus || 'all'}`;

    if (!global._nightStayCache) {
      global._nightStayCache = {};
    }

    if (!forceRefresh && global._nightStayCache[cacheKey] && (Date.now() - global._nightStayCache[cacheKey].timestamp < 600000)) {
      return res.status(200).json(global._nightStayCache[cacheKey].data);
    }

    const { query: busQueryFilter } = await getCampusBusQueryFilter(req);
    const buses = await Bus.find(busQueryFilter).lean();
    const routes = await Route.find({}).lean();
    const routeMap = {};
    routes.forEach(r => {
      routeMap[r.routeId] = r;
    });

    const vehiclesRes = await fetchVehiclesListFromTgg();
    const tggVehicles = (vehiclesRes.success && Array.isArray(vehiclesRes.data)) ? vehiclesRes.data : [];

    const dateFromStr = `${dates[0]} 00:00:00`;
    const dateToStr = `${dates[dates.length - 1]} 23:59:59`;
    const todayStr = new Date().toISOString().split('T')[0];
    const nowHHMM = new Date().toTimeString().substring(0, 5);

    const CONCURRENCY = 6;
    const reportRows = [];

    for (let i = 0; i < buses.length; i += CONCURRENCY) {
      const chunk = buses.slice(i, i + CONCURRENCY);
      const chunkResults = await Promise.all(chunk.map(async (bus) => {
        const { routeId, routeName } = resolveVehicleRoute(bus.busNumber, buses, routeMap);
        const routeObj = routeMap[routeId];

        // Resolve Stay Point: explicit isNightStayPoint stage OR stages[0] fallback
        let stayPointStage = null;
        if (routeObj && Array.isArray(routeObj.stages) && routeObj.stages.length > 0) {
          stayPointStage = routeObj.stages.find(s => s.isNightStayPoint) || routeObj.stages[0];
        }

        const stayPointName = stayPointStage?.stageName || routeObj?.startPoint || 'Default Stay Point';
        const isDefaultStayPoint = !routeObj?.stages?.some(s => s.isNightStayPoint);

        const plateKey = extractPlateKey(bus.busNumber);
        const matchedTgg = tggVehicles.find((v) => extractPlateKey(v.name) === plateKey);
        const tggVehicleName = matchedTgg?.name || cleanVehicleName(bus.busNumber);

        const daysMap = {};
        dates.forEach(d => {
          daysMap[d] = { firstIn: null, lastOut: null, kilometers: 0 };
        });

        try {
          const tggReport = await fetchReportsFromTgg({
            vehicle_name: tggVehicleName,
            date_from: dateFromStr,
            date_to: dateToStr,
            template: 'Daily Report'
          });

          if (tggReport.success && tggReport.data) {
            const gfLogs = parseGeofencesFromTgg(tggReport.data, tggVehicleName);

            gfLogs.forEach(log => {
              if (log.timeIn && log.timeIn !== '—') {
                const normInDate = normalizeDateStr(log.timeIn);
                const inTime = log.timeIn.split(' ')[1]?.substring(0, 5);
                if (normInDate && daysMap[normInDate] && inTime) {
                  if (!daysMap[normInDate].firstIn || inTime < daysMap[normInDate].firstIn) {
                    daysMap[normInDate].firstIn = inTime;
                  }
                }
              }

              if (log.timeOut && log.timeOut !== '—') {
                const normOutDate = normalizeDateStr(log.timeOut);
                const outTime = log.timeOut.split(' ')[1]?.substring(0, 5);
                if (normOutDate && daysMap[normOutDate] && outTime) {
                  if (!daysMap[normOutDate].lastOut || outTime > daysMap[normOutDate].lastOut) {
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
          console.warn(`[GPS] nightstay report fetch failed for ${tggVehicleName}:`, err.message);
        }

        dates.forEach(dateStr => {
          const dayObj = daysMap[dateStr];
          const isToday = dateStr === todayStr;
          if (isToday && dayObj.lastOut && dayObj.lastOut > nowHHMM) {
            dayObj.lastOut = null;
          }
        });

        return {
          busNumber: bus.busNumber,
          tggVehicleName,
          routeId,
          routeName,
          stayPointName,
          isDefaultStayPoint,
          days: daysMap
        };
      }));

      reportRows.push(...chunkResults);
    }

    const previousCache = global._nightStayCache?.[cacheKey]?.data?.data;
    if (previousCache && Array.isArray(previousCache)) {
      reportRows.forEach(row => {
        const prevRow = previousCache.find(p => p.busNumber === row.busNumber);
        if (prevRow && prevRow.days) {
          Object.keys(row.days).forEach(dStr => {
            const currentDay = row.days[dStr];
            const prevDay = prevRow.days[dStr];
            if (prevDay) {
              if (!currentDay.firstIn && prevDay.firstIn) currentDay.firstIn = prevDay.firstIn;
              if (!currentDay.lastOut && prevDay.lastOut) currentDay.lastOut = prevDay.lastOut;
              if ((!currentDay.kilometers || currentDay.kilometers === 0) && prevDay.kilometers > 0) {
                currentDay.kilometers = prevDay.kilometers;
              }
            }
          });
        }
      });
    }

    const responsePayload = {
      success: true,
      dates,
      data: reportRows
    };

    global._nightStayCache[cacheKey] = {
      timestamp: Date.now(),
      data: responsePayload
    };

    return res.status(200).json(responsePayload);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: error.message || 'Failed to generate Night Stay IN/OUT report'
    });
  }
};

module.exports = {
  fetchLiveVehicles,
  fetchVehicleReports,
  fetchVehicleHistory,
  receiveGeofenceAlert,
  fetchRecentAlerts,
  getGpsConfigStatus,
  fetchDailyKilometers,
  fetchFleetTravelled,
  getFinalDestination,
  getAllFinalDestinations,
  saveFinalDestination,
  fetchGeofenceReport,
  fetchFinalDestinationReport,
  fetchDailyHistory,
  fetchDayInOutReport,
  fetch7DayInOutReport: fetchDayInOutReport,
  fetchNightStayReport
};
