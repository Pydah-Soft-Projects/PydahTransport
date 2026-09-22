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

/**
 * Smart matching helper to map a local Bus model object (or busNumber string)
 * to a TGG vehicle object from the TGG API vehicles list.
 *
 * Handles:
 * 1. Exact vehicle name match: v.name === input
 * 2. Exact plate key match: extractPlateKey(v.name) === extractPlateKey(input)
 * 3. Series + 4-digit number match: e.g. "up8071" in "ap05up8071" matches "ap39up8071" (handles RTO code mismatches like AP05 vs AP39)
 * 4. Route ID match: e.g. assignedRouteId "R21" matches "R21_AP39UP8071"
 * 5. Last 4 digits match: e.g. "8071"
 */
const findMatchingTggVehicle = (busOrName, tggVehicles = []) => {
  if (!busOrName || !Array.isArray(tggVehicles) || tggVehicles.length === 0) return null;

  const busObj = typeof busOrName === 'object' ? busOrName : { busNumber: String(busOrName) };
  const rawBusNumber = busObj.busNumber || busObj.registrationNumber || busObj.name || String(busOrName);
  const cleanInput = String(rawBusNumber).trim();
  const routeId = busObj.assignedRouteId || extractRouteIdFromVehicleName(cleanInput);
  const targetPlateKey = extractPlateKey(cleanInput); // e.g. "ap05up8071"

  // 1. Exact string match
  const exact = tggVehicles.find(v => String(v.name || '').trim() === cleanInput);
  if (exact) return exact;

  // 2. Exact plate key match
  if (targetPlateKey) {
    const tier1 = tggVehicles.find(v => extractPlateKey(v.name) === targetPlateKey);
    if (tier1) return tier1;
  }

  // 3. Series + 4-digit number match (ignoring RTO state code e.g. AP05 vs AP39)
  // e.g. "ap05up8071" -> series+digits "up8071"
  if (targetPlateKey) {
    const seriesDigitMatch = targetPlateKey.match(/([a-z]{1,3}\d{3,4})$/i);
    if (seriesDigitMatch) {
      const suffixKey = seriesDigitMatch[1].toLowerCase(); // "up8071"
      const tier2 = tggVehicles.find(v => {
        const vKey = extractPlateKey(v.name);
        return vKey.endsWith(suffixKey);
      });
      if (tier2) return tier2;
    }
  }

  // 4. Assigned Route ID match (e.g. assignedRouteId "R21" -> "R21_AP39UP8071")
  if (routeId) {
    const cleanRoute = String(routeId).trim().toUpperCase();
    const tier3 = tggVehicles.find(v => {
      const vRoute = extractRouteIdFromVehicleName(v.name);
      return vRoute && vRoute === cleanRoute;
    });
    if (tier3) return tier3;
  }

  // 5. Last 4 digits match (e.g. "8071")
  const digitsMatch = cleanInput.replace(/\D/g, '').slice(-4);
  if (digitsMatch && digitsMatch.length === 4) {
    const tier4 = tggVehicles.find(v => {
      const vDigits = String(v.name).replace(/\D/g, '').slice(-4);
      return vDigits === digitsMatch;
    });
    if (tier4) return tier4;
  }

  return null;
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
const CACHE_TTL_MS = 2000; // 2 seconds cache TTL for live GPS tracking (prevents 10-minute coordinate freezes)

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

  // Ensure lat, long, speed are numbers & normalize status
  return vehicleList.map(v => {
    if (!v || typeof v !== 'object') return null;
    const speed = parseFloat(v.speed || v.sp || 0);

    const rawStatus = v.status || v.vehicle_status || v.state || v.motion_status || '';
    let status = 'Stopped';

    if (rawStatus) {
      const sLower = String(rawStatus).toLowerCase();
      if (sLower.includes('move') || sLower.includes('running') || sLower.includes('moving')) {
        status = 'Moving';
      } else if (sLower.includes('idle')) {
        status = 'Idle';
      } else if (sLower.includes('stop')) {
        status = 'Stopped';
      } else if (sLower.includes('off') || sLower.includes('disconnect')) {
        status = 'Offline';
      } else {
        status = String(rawStatus);
      }
    } else if (speed > 0) {
      status = 'Moving';
    } else {
      const isEngineOn = v.ignition === true || v.ignition === 1 || String(v.ignition).toLowerCase() === 'on' ||
                         v.engine === true || v.engine === 1 || String(v.engine).toLowerCase() === 'on';
      status = isEngineOn ? 'Idle' : 'Stopped';
    }

    return {
      ...v,
      name: v.name || v.vehicle_name || v.unit || 'Unknown Vehicle',
      units: v.units || v.unit_id || v.unit || '',
      latitude: parseFloat(v.latitude || v.lat || v.y || 0),
      longitude: parseFloat(v.longitude || v.lng || v.lon || v.x || 0),
      speed,
      status,
      timestamp: v.timestamp || v.time || v.date || '',
      uiiframe: v.uiiframe || v.iframe || ''
    };
  }).filter(Boolean);
};

let lastNetworkErrorTime = 0;
let hasLoggedOfflineNotice = false;
const ERROR_COOLDOWN_MS = 30000; // 30s cooldown during external API server outages to prevent log spam and socket flooding

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

  const now = Date.now();

  // Helper to return cached authoritative positions tagged as provider_unavailable during external API server outages
  const getSimulatedCachedVehicles = () => {
    if (!vehiclesCache || vehiclesCache.length === 0) return [];
    return vehiclesCache.map((v) => {
      return {
        ...v,
        isFallback: true,
        telemetryStatus: 'provider_unavailable',
        providerOffline: true
      };
    });
  };

  // Serve from cache if still fresh OR if in network error cooldown
  if (vehiclesCache && (now - lastCacheTime < CACHE_TTL_MS || now - lastNetworkErrorTime < ERROR_COOLDOWN_MS)) {
    const dataToSend = (now - lastNetworkErrorTime < ERROR_COOLDOWN_MS) ? getSimulatedCachedVehicles() : vehiclesCache;
    return {
      success: true,
      data: dataToSend
    };
  }

  try {
    const url = `${baseUrl}/vehicleslist_api.php?token=${encodeURIComponent(token)}`;
    const params = new URLSearchParams();
    params.append('Username', username);
    params.append('Password', password);
    params.append('username', username);
    params.append('password', password);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params,
      signal: AbortSignal.timeout(5000)
    });

    const rawText = await response.text();

    if (!response.ok) {
      throw new Error(`Status ${response.status}`);
    }

    const parsedVehicles = parseTggResponse(rawText);
    const vehicles = parsedVehicles.map(v => ({
      ...v,
      isFallback: false,
      telemetryStatus: 'live_gps',
      providerOffline: false
    }));
    
    if (vehicles.length > 0) {
      vehiclesCache = vehicles;
      lastCacheTime = Date.now();
      lastNetworkErrorTime = 0; // Reset network error tracker on success
      hasLoggedOfflineNotice = false;
      console.log(`[GPS BACKEND RAW] Fetched ${vehicles.length} vehicles live from TGG API. Sample:`, vehicles[0] ? { name: vehicles[0].name, lat: vehicles[0].latitude, lng: vehicles[0].longitude, time: vehicles[0].timestamp } : null);
      try {
        fs.writeFileSync(CACHE_FILE_PATH, JSON.stringify(vehicles, null, 2), 'utf8');
      } catch (e) {}
    } else {
      // Fallback: If API returned an error string or empty array but we have cached data, reuse cache
      if (vehiclesCache && (rawText.includes('Error') || rawText.includes('items') || rawText.includes('details'))) {
        return {
          success: true,
          data: getSimulatedCachedVehicles()
        };
      }
    }

    return {
      success: true,
      data: vehicles
    };
  } catch (error) {
    lastNetworkErrorTime = Date.now();
    if (!hasLoggedOfflineNotice) {
      console.warn(`[TGG Service] Third-party provider server (pfmsledger.in) is offline/unreachable (${error.message}). Active fallback telemetry enabled.`);
      hasLoggedOfflineNotice = true;
    }
    
    // Fallback: if network fails but we have a cache, return active simulated telemetry
    if (vehiclesCache) {
      return {
        success: true,
        data: getSimulatedCachedVehicles()
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

    const timeoutMs = reportQuery.timeoutMs || 25000;

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params,
      signal: AbortSignal.timeout(timeoutMs)
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

const messagesCacheStore = new Map();
const MESSAGES_CACHE_TTL = 30000; // 30s cache TTL for position history logs

/**
 * Helper to safely extract HH:mm time string from any TGG timestamp format (UNIX, ISO, space-separated)
 */
const formatTimestampToHHmm = (rawTime) => {
  if (!rawTime) return null;
  const str = String(rawTime).trim();
  // Case 1: UNIX timestamp in seconds (e.g. 1726588800) or milliseconds
  if (!isNaN(str) && Number(str) > 100000000) {
    const num = Number(str);
    const date = new Date(num > 10000000000 ? num : num * 1000);
    const hrs = String(date.getHours()).padStart(2, '0');
    const mins = String(date.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  }
  // Case 2: Space separated "2026-09-17 16:45:00"
  const spaceParts = str.split(' ');
  if (spaceParts.length >= 2 && spaceParts[1].includes(':')) {
    return spaceParts[1].substring(0, 5);
  }
  // Case 3: ISO string "2026-09-17T16:45:00.000Z"
  if (str.includes('T') && str.includes(':')) {
    const tParts = str.split('T');
    if (tParts[1]) return tParts[1].substring(0, 5);
  }
  // Case 4: Standard parseable date
  const parsedDate = new Date(str);
  if (!isNaN(parsedDate.getTime())) {
    const hrs = String(parsedDate.getHours()).padStart(2, '0');
    const mins = String(parsedDate.getMinutes()).padStart(2, '0');
    return `${hrs}:${mins}`;
  }
  return null;
};

/**
 * Recursive parser for TGG messages_api.php position history response
 */
const parseMessagesApiResponse = (rawText) => {
  if (!rawText || typeof rawText !== 'string') return [];
  const trimmed = rawText.trim();
  if (!trimmed) return [];

  let parsed = null;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    try {
      let cleaned = trimmed.replace(/^\{\s*\[/, '[').replace(/\]\s*\}$/, ']');
      parsed = JSON.parse(cleaned);
    } catch (err) {
      return [];
    }
  }

  const points = [];
  const extractPointsFromDict = (dict) => {
    if (!dict || typeof dict !== 'object') return;
    if (Array.isArray(dict)) {
      dict.forEach(item => extractPointsFromDict(item));
      return;
    }

    const latVal = dict.latitude ?? dict.lat ?? dict.y;
    const lngVal = dict.longitude ?? dict.lng ?? dict.lon ?? dict.x;
    const timeVal = dict.timestamp || dict.time || dict.date || dict.t || dict.dt;

    if (latVal != null && lngVal != null && timeVal) {
      const latitude = parseFloat(latVal);
      const longitude = parseFloat(lngVal);
      if (Number.isFinite(latitude) && Number.isFinite(longitude) && latitude !== 0 && longitude !== 0) {
        const timeStr = formatTimestampToHHmm(timeVal);
        points.push({
          timestamp: String(timeVal),
          time: String(timeVal),
          timeStr,
          latitude,
          longitude,
          lat: latitude,
          lng: longitude,
          speed: parseFloat(dict.speed || 0)
        });
        return;
      }
    }

    Object.values(dict).forEach(subVal => {
      if (subVal && typeof subVal === 'object') {
        extractPointsFromDict(subVal);
      }
    });
  };

  extractPointsFromDict(parsed);
  return points;
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

  const vehName = historyQuery.vehicle_name ? cleanVehicleName(historyQuery.vehicle_name) : 'ALL';
  const cacheKey = `${vehName}_${historyQuery.date_from || ''}_${historyQuery.date_to || ''}`;
  const now = Date.now();

  // Serve from cache if still fresh OR if external TGG API is in network error cooldown
  const cached = messagesCacheStore.get(cacheKey);
  if (cached && (now - cached.timestamp < MESSAGES_CACHE_TTL || now - lastNetworkErrorTime < ERROR_COOLDOWN_MS)) {
    return {
      success: true,
      data: cached.data
    };
  }

  try {
    // Generate default today date range if not provided
    const todayStr = new Date().toISOString().substring(0, 10);
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
      const vName = cleanVehicleName(historyQuery.vehicle_name);
      params.append('vehicle_name', vName);
      params.append('unit_name', vName);
      params.append('unit', vName);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params,
      signal: AbortSignal.timeout(10000)
    });

    const rawText = await response.text();
    if (!response.ok) {
      throw new Error(`TGG Messages API status ${response.status}`);
    }

    const logs = parseMessagesApiResponse(rawText);
    messagesCacheStore.set(cacheKey, { timestamp: now, data: logs });
    console.log(`[TGG Messages API] Fetched ${logs.length} position history logs for: ${historyQuery.vehicle_name || 'All'} (${dateFrom} to ${dateTo})`);
    return {
      success: true,
      data: logs
    };
  } catch (error) {
    lastNetworkErrorTime = Date.now();
    if (!hasLoggedOfflineNotice) {
      console.warn(`[TGG Service] Position history API unreachable (${error.message}). Returning cached history.`);
      hasLoggedOfflineNotice = true;
    }
    return {
      success: true,
      data: cached ? cached.data : []
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

// In-memory cache store for daily kilometer queries to eliminate high latency & rate-limiting
const dailyKmCacheStore = new Map();
const DAILY_KM_CACHE_TTL = 15 * 60 * 1000; // 15 minutes TTL

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

  // Check in-memory cache first to return instantly (0ms)
  const cacheKey = `${vehicleName}_${dateFromStr}_${dateToStr}`;
  const cachedEntry = dailyKmCacheStore.get(cacheKey);
  if (cachedEntry && (Date.now() - cachedEntry.timestamp < DAILY_KM_CACHE_TTL)) {
    return cachedEntry.result;
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

  // Helper to fetch report for a single date with timeout
  const fetchSingleDay = async (dateStr) => {
    if (!token || !username || !password) {
      return { date: dateStr, kilometers: 0, isMock: false };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 7000); // 7 sec timeout

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
        body: params,
        signal: controller.signal
      });
      clearTimeout(timeoutId);

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
          return { date: dateStr, kilometers: 0, isMock: false };
        }
      }

      let kilometers = 0;
      let foundData = false;
      if (parsed && typeof parsed === 'object') {
        for (const key of Object.keys(parsed)) {
          const vehReport = parsed[key];
          if (vehReport) {
            const distanceReport = vehReport["Mileage"] || vehReport["Total KMs Travelled"] || vehReport["Summary"] || vehReport["Distance"];
            if (distanceReport) {
              for (const subKey of Object.keys(distanceReport)) {
                const dataObj = distanceReport[subKey];
                const rows = Array.isArray(dataObj) ? dataObj : (dataObj && typeof dataObj === 'object' ? Object.values(dataObj) : []);
                for (const rowItem of rows) {
                  const cObj = rowItem?.c || rowItem;
                  if (cObj && typeof cObj === 'object') {
                    let distanceStr = "";
                    for (const cKey of Object.keys(cObj)) {
                      const val = String(cObj[cKey] || '');
                      if (val.toLowerCase().includes("km")) {
                        distanceStr = val;
                        break;
                      }
                    }
                    if (!distanceStr) {
                      distanceStr = cObj["2"] || cObj["1"] || cObj["3"] || cObj["5"] || "";
                    }

                    const match = String(distanceStr).match(/([\d.]+)/);
                    if (match) {
                      const valNum = parseFloat(match[1]);
                      if (!isNaN(valNum) && valNum > 0) {
                        kilometers = Math.max(kilometers, Math.round(valNum * 10) / 10);
                        foundData = true;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      return { date: dateStr, kilometers: foundData ? kilometers : 0, isMock: false };

    } catch (err) {
      clearTimeout(timeoutId);
      // Suppress repetitive abort/503 logs to prevent console noise
      if (process.env.NODE_ENV === 'development') {
        console.warn(`[TGG Reports API] Day ${dateStr}: ${err.message}`);
      }
      return { date: dateStr, kilometers: 0, isMock: false };
    }
  };

  // Process dates with maximum concurrency of 2 to avoid overwhelming TGG API
  const results = [];
  const CONCURRENCY_LIMIT = 2;
  for (let i = 0; i < dateList.length; i += CONCURRENCY_LIMIT) {
    const chunk = dateList.slice(i, i + CONCURRENCY_LIMIT);
    const chunkResults = await Promise.all(chunk.map(d => fetchSingleDay(d)));
    results.push(...chunkResults);
  }
  
  const hasMock = results.some(r => r.isMock);
  
  const finalResponse = {
    success: true,
    isMock: hasMock,
    data: results
  };

  dailyKmCacheStore.set(cacheKey, { timestamp: Date.now(), result: finalResponse });
  return finalResponse;
};

/**
 * Universal robust TGG Fuel Report parser
 */
const parseFuelDayReportFromTgg = (tggData) => {
  if (!tggData || typeof tggData !== 'object') return [];

  const results = [];

  const parseNumWithUnit = (valStr) => {
    if (valStr === null || valStr === undefined) return null;
    const str = String(valStr).trim();
    if (!str || str === '-' || str.toLowerCase() === 'n/a') return null;
    const m = str.match(/([0-9]+(?:\.[0-9]+)?)/);
    if (!m) return null;
    const num = parseFloat(m[1]);
    return isNaN(num) ? null : num;
  };

  const extractAllCObjects = (obj) => {
    const list = [];
    if (!obj || typeof obj !== 'object') return list;

    if (obj.c && typeof obj.c === 'object') {
      list.push(obj.c);
    } else {
      for (const k of Object.keys(obj)) {
        if (obj[k] && typeof obj[k] === 'object') {
          list.push(...extractAllCObjects(obj[k]));
        }
      }
    }
    return list;
  };

  const processVehicle = (vName, vehObj) => {
    if (!vehObj || typeof vehObj !== 'object') return null;

    let kmsTravelled = null;
    let initialFuel = null;
    let finalFuel = null;
    let fuelConsumption = null;
    let realVehName = null;

    const scanSection = (secObj) => {
      if (!secObj || typeof secObj !== 'object') return;
      const cList = extractAllCObjects(secObj);
      for (const cObj of cList) {
        if (!cObj || typeof cObj !== 'object') continue;

        // Label-value row format (Statistics table in TGG API)
        const labelText = String(cObj['1']?.t || cObj['1'] || cObj['0']?.t || cObj['0'] || '').toLowerCase().trim();
        const valueText = String(cObj['2']?.t || cObj['2'] || cObj['1']?.t || cObj['1'] || '').trim();

        if (labelText === 'unit' || labelText === 'vehicle' || labelText.includes('unit')) {
          if (valueText && valueText !== '—' && !realVehName) {
            realVehName = valueText;
          }
        }

        if (labelText.includes('initial') && labelText.includes('fuel')) {
          const num = parseNumWithUnit(valueText);
          if (num !== null) initialFuel = num;
        } else if (labelText.includes('final') && labelText.includes('fuel')) {
          const num = parseNumWithUnit(valueText);
          if (num !== null) finalFuel = num;
        } else if (labelText.includes('consumption') && labelText.includes('fuel')) {
          const num = parseNumWithUnit(valueText);
          if (num !== null) fuelConsumption = num;
        }

        for (const k of Object.keys(cObj)) {
          const raw = cObj[k];
          if (raw === null || raw === undefined) continue;
          const valStr = (typeof raw === 'object' && raw.t) ? String(raw.t) : String(raw);
          const valLower = valStr.toLowerCase();

          // Parse KMs Travelled (e.g. "606.41 km", "45.2 km")
          if (valLower.includes('km') && !valLower.includes('km/h') && !valLower.includes('km/l') && !valLower.includes('l/100')) {
            const num = parseNumWithUnit(valStr);
            if (num !== null && num >= 0) {
              if (kmsTravelled === null || num > kmsTravelled) {
                kmsTravelled = num;
              }
            }
          }

          // Parse Fuel levels & consumption (e.g. "9.52 l", "95.64 l", "86.12 l")
          if (valLower.includes('l') && !valLower.includes('km') && !valLower.includes('/')) {
            const num = parseNumWithUnit(valStr);
            if (num !== null && num >= 0) {
              if (k === '2' && fuelConsumption === null) fuelConsumption = num;
              else if (k === '4' && initialFuel === null) initialFuel = num;
              else if (k === '5' && finalFuel === null) finalFuel = num;
              else if (k === '1' && initialFuel === null) initialFuel = num;
              else if (k === '3' && fuelConsumption === null) fuelConsumption = num;
            }
          }
        }
      }
    };

    if (vehObj["Statistics"]) {
      scanSection(vehObj["Statistics"]);
    }
    if (vehObj["Total KMs Travelled"] || vehObj["Mileage"] || vehObj["Distance"]) {
      scanSection(vehObj["Total KMs Travelled"] || vehObj["Mileage"] || vehObj["Distance"]);
    }
    if (vehObj["Fuel Data"] || vehObj["Summary Report"] || vehObj["Summary"]) {
      scanSection(vehObj["Fuel Data"] || vehObj["Summary Report"] || vehObj["Summary"]);
    }
    scanSection(vehObj);

    // Calculate fuel consumption if missing but initial & final exist
    if (initialFuel !== null && finalFuel !== null && (fuelConsumption === null || fuelConsumption === 0)) {
      if (initialFuel >= finalFuel) {
        fuelConsumption = Math.round((initialFuel - finalFuel) * 100) / 100;
      }
    }

    return {
      tggVehicleName: realVehName || vName,
      kmsTravelled: kmsTravelled !== null ? Math.round(kmsTravelled * 10) / 10 : null,
      initialFuel: initialFuel !== null ? Math.round(initialFuel * 100) / 100 : null,
      finalFuel: finalFuel !== null ? Math.round(finalFuel * 100) / 100 : null,
      fuelConsumption: fuelConsumption !== null ? Math.round(fuelConsumption * 100) / 100 : null
    };
  };

  let activeData = tggData;
  if (tggData["Fuel Day Report"] && typeof tggData["Fuel Day Report"] === 'object') {
    activeData = tggData["Fuel Day Report"];
  } else if (tggData["Fuel Report"] && typeof tggData["Fuel Report"] === 'object') {
    activeData = tggData["Fuel Report"];
  }

  for (const key of Object.keys(activeData)) {
    const vehObj = activeData[key];
    if (vehObj && typeof vehObj === 'object') {
      const res = processVehicle(key, vehObj);
      if (res) results.push(res);
    }
  }

  return results;
};

const normalizeDateStrInTgg = (rawStr) => {
  if (!rawStr) return null;
  const cleaned = String(rawStr).trim();
  const datePart = cleaned.includes(' ') ? cleaned.split(' ')[0] : cleaned;
  
  const dMy = datePart.match(/^(\d{2})[\/\.](\d{2})[\/\.](\d{4})$/);
  if (dMy) {
    const [, d, m, y] = dMy;
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
 * Helper to extract daily kilometers dictionary ({ 'YYYY-MM-DD': kmValue }) from TGG report response
 */
const parseDailyKilometersFromTggReport = (tggData, vehName) => {
  const kmByDate = {};
  if (!tggData || typeof tggData !== 'object') return kmByDate;

  let vehObj = tggData[vehName] || null;
  if (!vehObj && vehName) {
    const targetKey = extractPlateKey(vehName);
    const targetDigits = String(vehName).replace(/\D/g, '').slice(-4);
    for (const k of Object.keys(tggData)) {
      if (extractPlateKey(k) === targetKey || (targetDigits.length === 4 && String(k).replace(/\D/g, '').slice(-4) === targetDigits)) {
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
        let kmVal = null;
        for (const key of Object.keys(cObj)) {
          const val = String(cObj[key] || '').trim();
          const normD = normalizeDateStrInTgg(val);
          if (normD) {
            rowDate = normD;
          } else if (val.toLowerCase().includes('km')) {
            const m = val.match(/([\d.]+)/);
            if (m) {
              const n = parseFloat(m[1]);
              if (!isNaN(n) && n >= 0 && n < 2000) {
                kmVal = Math.max(kmVal || 0, n);
              }
            }
          }
        }
        if (rowDate && kmVal === null) {
          for (const key of Object.keys(cObj)) {
            if (key === '0' || key === 'sno' || key === 's_no') continue;
            const val = String(cObj[key] || '').trim();
            if (val && val !== rowDate && /^\d+(\.\d+)?$/.test(val)) {
              const n = parseFloat(val);
              if (!isNaN(n) && n >= 0 && n < 2000) {
                kmVal = Math.max(kmVal || 0, n);
              }
            }
          }
        }

        if (rowDate && kmVal !== null && kmVal > 0) {
          kmByDate[rowDate] = Math.round(kmVal * 10) / 10;
        } else if (rowDate) {
          kmByDate[rowDate] = 0;
        }
      }
    });
  });

  return kmByDate;
};

/**
 * Helper to extract geofence logs (timeIn, timeOut, mileage) from TGG report response
 */
const parseGeofencesFromTgg = (tggData, vehName) => {
  if (!tggData || typeof tggData !== 'object') return [];

  let vehTarget = tggData[vehName] || null;
  if (!vehTarget && vehName) {
    const targetKey = extractPlateKey(vehName);
    const targetDigits = String(vehName).replace(/\D/g, '').slice(-4);
    for (const k of Object.keys(tggData)) {
      if (extractPlateKey(k) === targetKey || (targetDigits.length === 4 && String(k).replace(/\D/g, '').slice(-4) === targetDigits)) {
        vehTarget = tggData[k];
        break;
      }
    }
  }

  const activeContainer = vehTarget || tggData;
  let geofenceContainer = null;
  if (activeContainer.Geofences) {
    geofenceContainer = activeContainer.Geofences[vehName] || activeContainer.Geofences;
  } else if (tggData.Geofences?.[vehName]) {
    geofenceContainer = tggData.Geofences[vehName];
  } else if (tggData.Geofences) {
    geofenceContainer = tggData.Geofences;
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
 * Helper to extract Night Stay arrival (OUT) and departure (IN) times from TGG Report response
 */
const parseNightStayFromTggReport = (tggData, vehName, stageLat, stageLng, stayRadius = 1500) => {
  if (!tggData || typeof tggData !== 'object') return {};

  const daysResult = {}; // { 'YYYY-MM-DD': { firstIn: '07:30', lastOut: '17:15' } }

  // 1. Check Geofences entry/exit
  const gfLogs = parseGeofencesFromTgg(tggData, vehName);
  gfLogs.forEach(log => {
    const inLat = log.latIn;
    const inLng = log.lngIn;
    const outLat = log.latOut;
    const outLng = log.lngOut;

    const hasCoords = Number.isFinite(stageLat) && Number.isFinite(stageLng) && stageLat !== 0 && stageLng !== 0;

    const matchIn = hasCoords && inLat != null && inLng != null && calculateDistanceMeters(stageLat, stageLng, inLat, inLng) <= stayRadius;
    const matchOut = hasCoords && outLat != null && outLng != null && calculateDistanceMeters(stageLat, stageLng, outLat, outLng) <= stayRadius;
    const isStayGeofence = log.geofence && (String(log.geofence).toLowerCase().includes('stay') || String(log.geofence).toLowerCase().includes('night'));

    // Evening Arrival at Night Stay Point (OUT Column in UI)
    if (log.timeIn && log.timeIn !== '—') {
      const timeParts = String(log.timeIn).trim().split(' ');
      const dateStr = timeParts[0];
      const timeStr = timeParts[1]?.substring(0, 5);
      if (dateStr && timeStr && timeStr >= '15:00') {
        if (!daysResult[dateStr]) daysResult[dateStr] = { firstIn: '—', lastOut: '—' };
        if (matchIn || matchOut || isStayGeofence || !hasCoords) {
          if (daysResult[dateStr].lastOut === '—' || timeStr < daysResult[dateStr].lastOut) {
            daysResult[dateStr].lastOut = timeStr;
          }
        }
      }
    }

    // Morning Departure from Night Stay Point (IN Column in UI)
    if (log.timeOut && log.timeOut !== '—') {
      const timeParts = String(log.timeOut).trim().split(' ');
      const dateStr = timeParts[0];
      const timeStr = timeParts[1]?.substring(0, 5);
      if (dateStr && timeStr && timeStr >= '04:00' && timeStr <= '11:00') {
        if (!daysResult[dateStr]) daysResult[dateStr] = { firstIn: '—', lastOut: '—' };
        if (matchIn || matchOut || isStayGeofence || !hasCoords) {
          if (daysResult[dateStr].firstIn === '—' || timeStr > daysResult[dateStr].firstIn) {
            daysResult[dateStr].firstIn = timeStr;
          }
        }
      }
    }
  });

  // 2. Also check Stops / Trips / Movement dictionary in tggData if available
  const extractStops = (obj) => {
    if (!obj || typeof obj !== 'object') return;
    const entries = Array.isArray(obj) ? obj : Object.values(obj);
    entries.forEach(item => {
      if (!item || typeof item !== 'object') return;
      const c = item.c || item;

      const depTime = c['2']?.t || c.startTime || c.depTime;
      const depLat = c['2']?.y ?? c.lat;
      const depLng = c['2']?.x ?? c.lng;

      const arrTime = c['4']?.t || c.endTime || c.arrTime;
      const arrLat = c['4']?.y ?? c.lat;
      const arrLng = c['4']?.x ?? c.lng;

      const hasCoords = Number.isFinite(stageLat) && Number.isFinite(stageLng) && stageLat !== 0 && stageLng !== 0;

      // Morning departure from night stay stage
      if (depTime && typeof depTime === 'string') {
        const parts = depTime.trim().split(' ');
        const dateStr = parts[0];
        const timeStr = parts[1]?.substring(0, 5);
        if (dateStr && timeStr && timeStr >= '04:00' && timeStr <= '11:00') {
          const match = hasCoords && depLat != null && depLng != null && calculateDistanceMeters(stageLat, stageLng, parseFloat(depLat), parseFloat(depLng)) <= stayRadius;
          if (match || (!hasCoords && c['1'] && String(c['1']).toLowerCase().includes('stay'))) {
            if (!daysResult[dateStr]) daysResult[dateStr] = { firstIn: '—', lastOut: '—' };
            if (daysResult[dateStr].firstIn === '—' || timeStr < daysResult[dateStr].firstIn) {
              daysResult[dateStr].firstIn = timeStr;
            }
          }
        }
      }

      // Evening arrival at night stay stage
      if (arrTime && typeof arrTime === 'string') {
        const parts = arrTime.trim().split(' ');
        const dateStr = parts[0];
        const timeStr = parts[1]?.substring(0, 5);
        if (dateStr && timeStr && timeStr >= '15:00') {
          const match = hasCoords && arrLat != null && arrLng != null && calculateDistanceMeters(stageLat, stageLng, parseFloat(arrLat), parseFloat(arrLng)) <= stayRadius;
          if (match || (!hasCoords && c['3'] && String(c['3']).toLowerCase().includes('stay'))) {
            if (!daysResult[dateStr]) daysResult[dateStr] = { firstIn: '—', lastOut: '—' };
            if (daysResult[dateStr].lastOut === '—' || timeStr > daysResult[dateStr].lastOut) {
              daysResult[dateStr].lastOut = timeStr;
            }
          }
        }
      }
    });
  };

  if (tggData.Stops) extractStops(tggData.Stops);
  if (tggData.Trips) extractStops(tggData.Trips);
  if (tggData['Movement Report']) extractStops(tggData['Movement Report']);

  return daysResult;
};

module.exports = {
  getTggConfig,
  cleanVehicleName,
  extractPlateKey,
  extractRouteIdFromVehicleName,
  findMatchingTggVehicle,
  fetchVehiclesListFromTgg,
  fetchReportsFromTgg,
  fetchVehicleMessagesFromTgg,
  registerIncomingAlert,
  getRecentAlerts,
  fetchDailyKilometersFromTgg,
  parseFuelDayReportFromTgg,
  parseDailyKilometersFromTggReport,
  parseGeofencesFromTgg,
  parseNightStayFromTggReport,
  calculateDistanceMeters
};

