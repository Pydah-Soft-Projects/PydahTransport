/**
 * Service module for Trans Global Geomatics (TGG) GPS Tracking API
 * Documentation reference: https://pfmsledger.in/tggapi/
 */

const getTggConfig = (customConfig = {}) => {
  const baseUrl = customConfig.baseUrl || process.env.TGG_BASE_URL || 'https://pfmsledger.in/tggapi';
  const token = customConfig.token || process.env.TGG_API_TOKEN || '';
  const username = customConfig.username || process.env.TGG_USERNAME || '';
  const password = customConfig.password || process.env.TGG_PASSWORD || '';

  return { baseUrl, token, username, password };
};

// In-memory store for received Geofence alerts
const alertStore = [];

/**
 * Safe JSON parser that handles various PHP / TGG API response formats
 */
const parseTggResponse = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch (err) {
    // Handle malformed TGG example JSON like `{ [ ... ] }` or trailing commas
    try {
      let cleaned = trimmed.replace(/^\{\s*\[/, '[').replace(/\]\s*\}$/, ']');
      parsed = JSON.parse(cleaned);
    } catch (e) {
      console.error('[TGG Parser] JSON parse error:', err.message, 'Raw text sample:', trimmed.substring(0, 200));
      return [];
    }
  }

  // Convert object dictionary or wrapped array to flat list of vehicle objects
  let vehicleList = [];
  if (Array.isArray(parsed)) {
    vehicleList = parsed;
  } else if (parsed && typeof parsed === 'object') {
    if (Array.isArray(parsed.data)) {
      vehicleList = parsed.data;
    } else if (Array.isArray(parsed.vehicles)) {
      vehicleList = parsed.vehicles;
    } else {
      vehicleList = Object.values(parsed);
    }
  }

  // Ensure lat, long, speed are numbers
  return vehicleList.map(v => {
    if (!v || typeof v !== 'object') return null;
    return {
      ...v,
      name: v.name || v.vehicle_name || v.unit || 'Unknown Vehicle',
      units: v.units || v.unit_id || v.unit || '',
      latitude: parseFloat(v.latitude || v.lat || v.y || 0),
      longitude: parseFloat(v.longitude || v.lng || v.lon || v.x || 0),
      speed: parseFloat(v.speed || 0),
      timestamp: v.timestamp || v.time || v.date || '',
      uiiframe: v.uiiframe || v.iframe || ''
    };
  }).filter(Boolean);
};

/**
 * 1. Read Vehicle List
 * API Request: https://pfmsledger.in/tggapi/vehicleslist_api.php?token=TOKEN_ID
 * POST parameters: Username, Password (also username, password for safety)
 */
const fetchVehiclesListFromTgg = async (options = {}) => {
  const { baseUrl, token, username, password } = getTggConfig(options);

  if (!token || !username || !password) {
    console.warn('[TGG Service] Missing ENV variables! TGG_API_TOKEN:', Boolean(token), 'TGG_USERNAME:', Boolean(username), 'TGG_PASSWORD:', Boolean(password));
    return {
      success: false,
      message: 'TGG API credentials not configured in backend .env',
      data: []
    };
  }

  try {
    const url = `${baseUrl}/vehicleslist_api.php?token=${encodeURIComponent(token)}`;
    const params = new URLSearchParams();
    params.append('Username', username);
    params.append('Password', password);
    params.append('username', username);
    params.append('password', password);

    console.log(`[TGG Service] Sending POST request to: ${url}`);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`TGG API responded with status ${response.status}`);
    }

    const vehicles = parseTggResponse(rawText);
    console.log(`[TGG Service] Response 200 OK — Successfully fetched ${vehicles.length} vehicles.`);
    if (vehicles.length === 0) {
      console.log(`[TGG Service] Debug Raw Response: "${rawText}"`);
    }

    return {
      success: true,
      data: vehicles
    };
  } catch (error) {
    console.error('[TGG Service] Error fetching vehicles list:', error.message);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * 2. Read Reports
 * API Request: https://pfmsledger.in/tggapi/reports_api.php?token=TOKEN_ID
 * POST parameters: username, password, date_from, date_to, vehicle_name, template
 */
const fetchReportsFromTgg = async (reportQuery = {}) => {
  const { baseUrl, token, username, password } = getTggConfig(reportQuery);

  if (!token || !username || !password) {
    return {
      success: false,
      message: 'TGG API credentials missing.',
      data: null
    };
  }

  try {
    const url = `${baseUrl}/reports_api.php?token=${encodeURIComponent(token)}`;
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('Username', username);
    params.append('Password', password);
    params.append('date_from', reportQuery.date_from || '');
    params.append('date_to', reportQuery.date_to || '');
    params.append('vehicle_name', reportQuery.vehicle_name || '');
    if (reportQuery.template) {
      params.append('template', reportQuery.template);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`TGG Reports API responded with status ${response.status}`);
    }

    let parsed = null;
    try {
      parsed = JSON.parse(rawText);
    } catch (e) {
      parsed = rawText;
    }

    return {
      success: true,
      data: parsed
    };
  } catch (error) {
    console.error('[TGG Service] Error fetching reports:', error.message);
    return {
      success: false,
      error: error.message,
      data: null
    };
  }
};

/**
 * 3. Read Vehicle Latitude and Longitude (Messages API)
 * API Request: https://pfmsledger.in/tggapi/messages_api.php?token=TOKEN_ID
 * POST parameters: username, password, date_from, date_to, vehicle_name (Optional)
 */
const fetchVehicleMessagesFromTgg = async (historyQuery = {}) => {
  const { baseUrl, token, username, password } = getTggConfig(historyQuery);

  if (!token || !username || !password) {
    return {
      success: false,
      message: 'TGG API credentials missing.',
      data: []
    };
  }

  try {
    // Generate default today date range if not provided
    const now = new Date();
    const todayStr = now.toISOString().substring(0, 10);
    const defaultDateFrom = `${todayStr} 00:00:00`;
    const defaultDateTo = `${todayStr} 23:59:59`;

    const dateFrom = historyQuery.date_from || defaultDateFrom;
    const dateTo = historyQuery.date_to || defaultDateTo;

    const url = `${baseUrl}/messages_api.php?token=${encodeURIComponent(token)}`;
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('Username', username);
    params.append('Password', password);
    params.append('date_from', dateFrom);
    params.append('date_to', dateTo);
    if (historyQuery.vehicle_name) {
      params.append('vehicle_name', historyQuery.vehicle_name);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`TGG Messages API status ${response.status}`);
    }

    const logs = parseTggResponse(rawText);
    console.log(`[TGG Messages API] Fetched ${logs.length} position history logs for: ${historyQuery.vehicle_name || 'All'} (${dateFrom} to ${dateTo})`);
    return {
      success: true,
      data: logs
    };
  } catch (error) {
    console.error('[TGG Service] Error fetching position history:', error.message);
    return {
      success: false,
      error: error.message,
      data: []
    };
  }
};

/**
 * 4. Geofence Alerts Trigger / Receiver
 * Client Server URL: https://pfmsledger.in/tggapi/alerts.php
 * Endpoint parameters: unit, time, location, message
 */
const registerIncomingAlert = (alertPayload) => {
  const newAlert = {
    id: `alert-${Date.now()}`,
    unit: alertPayload.unit || 'UNKNOWN_UNIT',
    time: alertPayload.time || new Date().toISOString(),
    location: alertPayload.location || 'Unknown Location',
    message: alertPayload.message || 'Geofence Event Triggered',
    createdAt: new Date().toISOString()
  };

  alertStore.unshift(newAlert);
  if (alertStore.length > 50) {
    alertStore.pop();
  }
  return newAlert;
};

const getRecentAlerts = () => {
  return alertStore;
};

module.exports = {
  getTggConfig,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts
};
