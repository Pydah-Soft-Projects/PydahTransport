const {
  getTggConfig,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts
} = require('../services/tggGpsService');

/**
 * Controller to fetch live vehicles list from TGG API
 */
const fetchLiveVehicles = async (req, res) => {
  try {
    const result = await fetchVehiclesListFromTgg(req.query);
    return res.status(200).json({
      success: true,
      isMock: result.isMock,
      message: result.message || 'Vehicles list retrieved successfully',
      data: result.data
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

module.exports = {
  fetchLiveVehicles,
  fetchVehicleReports,
  fetchVehicleHistory,
  receiveGeofenceAlert,
  fetchRecentAlerts,
  getGpsConfigStatus
};
