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
} = require('../services/tggGpsService');
const Bus = require('../models/Bus');
const Route = require('../models/Route');
const GpsFinalDestination = require('../models/GpsFinalDestination');

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

    const buses = await Bus.find({}).lean();
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

    return res.status(200).json({
      success: true,
      isMock: result.isMock,
      message: result.message || 'Vehicles list retrieved successfully',
      data: mappedData
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
    
    // Process in parallel
    const fetchPromises = vehicles.map(async (veh) => {
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
          totalKm,
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
          isMock: true
        };
      }
    });

    const results = await Promise.all(fetchPromises);

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
 * into a flat array of { geofence, timeIn, timeOut, duration, mileage, latIn, lngIn, latOut, lngOut }.
 */
const fetchGeofenceReport = async (req, res) => {
  try {
    const { vehicle_name, date_from, date_to } = req.query;
    if (!vehicle_name) {
      return res.status(400).json({ success: false, message: 'vehicle_name is required' });
    }

    const dfFrom = date_from ? `${date_from} 00:00` : '';
    const dfTo = date_to ? `${date_to} 23:59` : '';

    const result = await fetchReportsFromTgg({
      vehicle_name,
      date_from: dfFrom,
      date_to: dfTo,
      template: 'Daily Report',
    });

    if (!result.success || !result.data) {
      return res.status(200).json({ success: true, data: [] });
    }

    const vehData = result.data[vehicle_name] || result.data;
    const geofencesRaw = vehData?.Geofences?.[vehicle_name] || {};

    const rows = Object.values(geofencesRaw).map((entry) => {
      const c = entry.c || {};
      return {
        geofence: c['1'] || '—',
        timeIn: c['2']?.t || '—',
        latIn: c['2']?.y ?? null,
        lngIn: c['2']?.x ?? null,
        timeOut: c['3']?.t || '—',
        latOut: c['3']?.y ?? null,
        lngOut: c['3']?.x ?? null,
        duration: c['4'] || '—',
        mileage: c['5'] || '—',
      };
    });

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

    const reportRows = await Promise.all(buses.map(async (bus) => {
      const cleanBusName = bus.busNumber.replace(/[^a-zA-Z0-9]/g, '');
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
        params.append('vehicle_name', cleanBusName);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          const points = parseTggMessagesLocal(rawText, cleanBusName);
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
        params.append('vehicle_name', cleanBusName);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          const points = parseTggMessagesLocal(rawText, cleanBusName);
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

    const cleanBusNo = vehicle_name.replace(/[^a-zA-Z0-9]/g, '');

    const cacheKey = `${cleanBusNo}_${targetDate}`;
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
        params.append('vehicle_name', cleanBusNo);

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: params
        });

        if (response.ok) {
          const rawText = await response.text();
          return parseTggMessagesLocal(rawText, cleanBusNo);
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
  fetchDailyHistory
};
