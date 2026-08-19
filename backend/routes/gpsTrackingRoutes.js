const express = require('express');
const router = express.Router();
const {
  fetchLiveVehicles,
  fetchVehicleReports,
  fetchVehicleHistory,
  receiveGeofenceAlert,
  fetchRecentAlerts,
  getGpsConfigStatus,
  fetchDailyKilometers,
  fetchFleetTravelled
} = require('../controllers/gpsTrackingController');

// Configuration Status Route
router.get('/config-status', getGpsConfigStatus);

// 1. Read Vehicle List
router.get('/vehicles', fetchLiveVehicles);
router.post('/vehicles', fetchLiveVehicles);

// 2. Read Reports
router.get('/reports', fetchVehicleReports);
router.post('/reports', fetchVehicleReports);

// 3. Read Vehicle Latitude and Longitude (Messages API)
router.get('/history', fetchVehicleHistory);
router.post('/history', fetchVehicleHistory);

// 4. Geofence Alerts / Webhook Trigger
router.post('/alerts/webhook', receiveGeofenceAlert);
router.get('/alerts', fetchRecentAlerts);

// 5. Daily Kilometers
router.get('/daily-km', fetchDailyKilometers);
router.post('/daily-km', fetchDailyKilometers);

// 6. Fleet Travelled Summary
router.get('/fleet-travelled', fetchFleetTravelled);

module.exports = router;
