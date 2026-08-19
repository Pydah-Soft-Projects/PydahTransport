const {
  getTggConfig,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts,
  fetchDailyKilometersFromTgg
} = require('../services/tggGpsService');
const Bus = require('../models/Bus');
const Route = require('../models/Route');

const cleanRegNo = (str) => {
  if (!str) return '';
  return str.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
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
      const cleanVehName = cleanRegNo(veh.name);
      const matchedBus = buses.find(b => cleanRegNo(b.busNumber) === cleanVehName);
      let routeIdVal = 'Unassigned';
      let routeNameVal = 'Unassigned';

      if (matchedBus && matchedBus.assignedRouteId) {
        routeIdVal = matchedBus.assignedRouteId;
        const routeObj = routeMap[matchedBus.assignedRouteId];
        if (routeObj) {
          routeNameVal = routeObj.routeName;
        }
      }

      return {
        ...veh,
        routeId: routeIdVal,
        routeName: routeNameVal
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

        const cleanVehName = cleanRegNo(veh.name);
        const matchedBus = buses.find(b => cleanRegNo(b.busNumber) === cleanVehName);
        let routeIdVal = 'Unassigned';
        let routeNameVal = 'Unassigned';

        if (matchedBus && matchedBus.assignedRouteId) {
          routeIdVal = matchedBus.assignedRouteId;
          const routeObj = routeMap[matchedBus.assignedRouteId];
          if (routeObj) {
            routeNameVal = routeObj.routeName;
          }
        }
        
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
        const cleanVehName = cleanRegNo(veh.name);
        const matchedBus = buses.find(b => cleanRegNo(b.busNumber) === cleanVehName);
        let routeIdVal = 'Unassigned';
        let routeNameVal = 'Unassigned';

        if (matchedBus && matchedBus.assignedRouteId) {
          routeIdVal = matchedBus.assignedRouteId;
          const routeObj = routeMap[matchedBus.assignedRouteId];
          if (routeObj) {
            routeNameVal = routeObj.routeName;
          }
        }

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

module.exports = {
  fetchLiveVehicles,
  fetchVehicleReports,
  fetchVehicleHistory,
  receiveGeofenceAlert,
  fetchRecentAlerts,
  getGpsConfigStatus,
  fetchDailyKilometers,
  fetchFleetTravelled
};
