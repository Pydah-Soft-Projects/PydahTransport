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

const cleanVehicleName = (name) => {
  // TGG vehicle names often look like "R23_AP39UW4611" — keep underscore and exact name for API calls
  if (!name) return '';
  return String(name).trim();
};

/**
 * Extract a comparable plate key from TGG vehicle names or local bus numbers.
 * Examples:
 *   R23_AP39UW4611 → ap39uw4611
 *   AP40KX3936     → ap40kx3936
 *   AP 39 UW 4611  → ap39uw4611
 *   R07AP39WH8273  → ap39wh8273
 */
const extractPlateKey = (name) => {
  if (!name) return '';
  const raw = String(name).trim();
  const prefixed = raw.match(/^R\d+[_\-\s]+(.+)$/i);
  let plate = prefixed ? prefixed[1] : raw;
  let key = plate.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  // Handle already-stripped forms like R23AP39UW4611
  const embedded = key.match(/^r\d+([a-z]{2}\d{1,2}[a-z]{1,3}\d{3,4})$/i);
  if (embedded) key = embedded[1].toLowerCase();
  return key;
};

/** Pull route id from names like R23_AP39UW4611 → R23 */
const extractRouteIdFromVehicleName = (name) => {
  if (!name) return null;
  const m = String(name).trim().match(/^(R\d+)(?:[_\-\s]|$|[A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
};

// In-memory store for received Geofence alerts
const alertStore = [];

// Persistent & in-memory cache for vehicles list to prevent rate-limiting and handle third-party server load gracefully
const fs = require('fs');
const path = require('path');
const os = require('os');
const CACHE_FILE_PATH = path.join(os.tmpdir(), 'pydah_transport_vehicles_cache.json');

let vehiclesCache = null;
try {
  if (fs.existsSync(CACHE_FILE_PATH)) {
    const raw = fs.readFileSync(CACHE_FILE_PATH, 'utf8');
    vehiclesCache = JSON.parse(raw);
    console.log(`[TGG Service] Loaded ${vehiclesCache.length} cached vehicles from persistent storage.`);
  }
} catch (e) {
  // ignore
}
let lastCacheTime = vehiclesCache ? Date.now() : 0;
const CACHE_TTL_MS = 6000; // 6 seconds cache TTL

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

  // Serve from cache if still fresh to prevent third-party rate limits/PHP crash errors
  const now = Date.now();
  if (vehiclesCache && (now - lastCacheTime < CACHE_TTL_MS)) {
    return {
      success: true,
      data: vehiclesCache
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
    
    if (vehicles.length > 0) {
      vehiclesCache = vehicles;
      lastCacheTime = Date.now();
      console.log(`[TGG Service] Response 200 OK — Successfully fetched and cached ${vehicles.length} vehicles.`);
      try {
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(vehicles, null, 2), 'utf8');
      } catch (e) {}
    } else {
      console.log(`[TGG Service] Debug Raw Response: "${rawText}"`);
      // Fallback: If API returned an error string or empty array but we have cached data, reuse cache
      if (vehiclesCache && (rawText.includes('Error') || rawText.includes('items') || rawText.includes('details'))) {
        console.log('[TGG Service] API returned error response. Falling back to active cached vehicles list.');
        return {
          success: true,
          data: vehiclesCache
        };
      }
    }

    return {
      success: true,
      data: vehicles
    };
  } catch (error) {
    console.error('[TGG Service] Error fetching vehicles list:', error.message);
    
    // Fallback: if network fails but we have a cache, return the cache
    if (vehiclesCache) {
      console.log('[TGG Service] Network exception. Falling back to cached vehicles list.');
      return {
        success: true,
        data: vehiclesCache
      };
    }

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
    params.append('date_from', reportQuery.date_from || '');
    params.append('date_to', reportQuery.date_to || '');
    params.append('vehicle_name', cleanVehicleName(reportQuery.vehicle_name) || '');
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
    params.append('date_from', dateFrom);
    params.append('date_to', dateTo);
    if (historyQuery.vehicle_name) {
      params.append('vehicle_name', cleanVehicleName(historyQuery.vehicle_name));
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

/**
 * Fetch daily kilometers by calling reports_api.php day-by-day in parallel
 */
const fetchDailyKilometersFromTgg = async (reportQuery = {}) => {
  const { baseUrl, token, username, password } = getTggConfig(reportQuery);
  const vehicleName = reportQuery.vehicle_name || '';
  const dateFromStr = reportQuery.date_from || '';
  const dateToStr = reportQuery.date_to || '';

  if (!vehicleName || !dateFromStr || !dateToStr) {
    throw new Error('vehicle_name, date_from, and date_to are required parameters.');
  }

  // Calculate dates in between (calendar YYYY-MM-DD — avoid UTC timezone shift)
  const parseYmd = (ymd) => {
    const parts = String(ymd).split('-').map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
    const [y, m, d] = parts;
    return { y, m, d };
  };
  const ymdToTime = ({ y, m, d }) => Date.UTC(y, m - 1, d);
  const timeToYmd = (t) => {
    const dt = new Date(t);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const d = String(dt.getUTCDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  let fromParts = parseYmd(dateFromStr);
  let toParts = parseYmd(dateToStr);
  if (!fromParts || !toParts) {
    throw new Error('date_from and date_to must be YYYY-MM-DD.');
  }

  let fromT = ymdToTime(fromParts);
  let toT = ymdToTime(toParts);
  if (fromT > toT) {
    const tmp = fromT;
    fromT = toT;
    toT = tmp;
  }

  const dateList = [];
  let current = fromT;
  let count = 0;
  while (current <= toT && count < 31) {
    dateList.push(timeToYmd(current));
    current += 24 * 60 * 60 * 1000;
    count++;
  }

  if (dateList.length === 0) {
    return { success: true, isMock: false, data: [] };
  }

  // Generate deterministic mock KM numbers
  const getMockKMForDate = (dateStr, vehName) => {
    const isSunday = new Date(dateStr).getDay() === 0;
    const isSaturday = new Date(dateStr).getDay() === 6;
    let kilometers = 0;
    if (!isSunday) {
      const seed = dateStr.split('-').reduce((acc, val) => acc + parseInt(val), 0) + 
                   String(vehName).split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
      const pseudoRand = Math.abs(Math.sin(seed));
      kilometers = isSaturday 
        ? Math.round(45 + pseudoRand * 25) 
        : Math.round(95 + pseudoRand * 45);
    }
    return { date: dateStr, kilometers, isMock: true };
  };

  // Helper to fetch report for a single date
  const fetchSingleDay = async (dateStr) => {
    // Check if credentials are missing. If so, generate mock
    if (!token || !username || !password) {
      return getMockKMForDate(dateStr, vehicleName);
    }

    try {
      const url = `${baseUrl}/reports_api.php?token=${encodeURIComponent(token)}`;
      const params = new URLSearchParams();
      params.append('username', username);
      params.append('password', password);
      params.append('date_from', `${dateStr} 00:00:00`);
      params.append('date_to', `${dateStr} 23:59:59`);
      params.append('vehicle_name', cleanVehicleName(vehicleName));
      params.append('template', 'Daily Report');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        body: params
      });

      const rawText = await response.text();
      if (!response.ok) {
        throw new Error(`Status ${response.status}`);
      }

      let parsed = null;
      try {
        parsed = JSON.parse(rawText.trim());
      } catch (err) {
        try {
          let cleaned = rawText.trim().replace(/^\{\s*\[/, '[').replace(/\]\s*\}$/, ']');
          parsed = JSON.parse(cleaned);
        } catch (e) {
          console.warn(`[TGG Reports Parser] Failed to parse day ${dateStr}, using mock fallback.`);
          return getMockKMForDate(dateStr, vehicleName);
        }
      }

      let kilometers = 0;
      let foundData = false;
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          const vehReport = parsed[key];
          if (vehReport) {
            const distanceReport = vehReport["Mileage"] || vehReport["Total KMs Travelled"];
            if (distanceReport) {
              for (const subKey of Object.keys(distanceReport)) {
                const dataObj = distanceReport[subKey];
                if (dataObj && dataObj["0"] && dataObj["0"].c) {
                  const cObj = dataObj["0"].c;
                  let distanceStr = "";
                  
                  // Dynamically scan cells to find the one containing "km" units
                  for (const cKey of Object.keys(cObj)) {
                    const val = String(cObj[cKey]);
                    if (val.toLowerCase().includes("km")) {
                      distanceStr = val;
                      break;
                    }
                  }
                  
                  if (!distanceStr) {
                    distanceStr = cObj["2"] || cObj["1"] || "";
                  }

                  const match = distanceStr.match(/([\d.]+)/);
                  if (match) {
                    kilometers = parseFloat(match[1]);
                    foundData = true;
                  }
                }
              }
            }
          }
        }
      }

      if (!foundData) {
        // If API responded but has no matching keys, it means vehicle was stationary (0 km)
        return { date: dateStr, kilometers: 0, isMock: false };
      }

      return { date: dateStr, kilometers, isMock: false };

    } catch (err) {
      console.warn(`[TGG Reports API] Error fetching day ${dateStr}, falling back to mock:`, err.message);
      return getMockKMForDate(dateStr, vehicleName);
    }
  };

  // Fetch all days in parallel
  const results = await Promise.all(dateList.map(date => fetchSingleDay(date)));
  
  const hasMock = results.some(r => r.isMock);
  
  return {
    success: true,
    isMock: hasMock,
    data: results
  };
};

module.exports = {
  getTggConfig,
  cleanVehicleName,
  extractPlateKey,
  extractRouteIdFromVehicleName,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts,
  fetchDailyKilometersFromTgg
};
