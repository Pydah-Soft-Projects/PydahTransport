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
      params.append('vehicle_name', cleanVehicleName(historyQuery.vehicle_name));
    }

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
      throw new Error(`TGG Messages API status ${response.status}`);
    }

    const logs = parseTggResponse(rawText);
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

    const scanSection = (secObj) => {
      if (!secObj || typeof secObj !== 'object') return;
      const cList = extractAllCObjects(secObj);
      for (const cObj of cList) {
        if (!cObj || typeof cObj !== 'object') continue;
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

          // Parse Fuel levels & consumption (e.g. "287.61 l", "216.33 l")
          if (valLower.includes('l') && !valLower.includes('km') && !valLower.includes('/')) {
            const num = parseNumWithUnit(valStr);
            if (num !== null && num >= 0) {
              // TGG Fuel Data specific cell indices:
              // Index 1 = Initial Fuel, Index 3 = Fuel Consumption, Index 5 = Final Fuel
              if (k === '1' && initialFuel === null) initialFuel = num;
              else if (k === '3' && fuelConsumption === null) fuelConsumption = num;
              else if (k === '5' && finalFuel === null) finalFuel = num;
              else if (k === '4' && initialFuel === null) initialFuel = num;
              else if (k === '2' && finalFuel === null) finalFuel = num;
            }
          }
        }
      }
    };

    // 1. Scan "Total KMs Travelled" or "Mileage" or "Distance"
    if (vehObj["Total KMs Travelled"] || vehObj["Mileage"] || vehObj["Distance"]) {
      scanSection(vehObj["Total KMs Travelled"] || vehObj["Mileage"] || vehObj["Distance"]);
    }

    // 2. Scan "Fuel Data" or "Summary Report" or "Summary"
    if (vehObj["Fuel Data"] || vehObj["Summary Report"] || vehObj["Summary"]) {
      scanSection(vehObj["Fuel Data"] || vehObj["Summary Report"] || vehObj["Summary"]);
    }

    // 3. Scan "Trips details" or "Trips"
    if (vehObj["Trips details"] || vehObj["Trips"]) {
      scanSection(vehObj["Trips details"] || vehObj["Trips"]);
    }

    // 4. Fallback: Scan entire vehObj
    scanSection(vehObj);

    // Calculate fuel consumption if missing but initial & final exist
    if (initialFuel !== null && finalFuel !== null && (fuelConsumption === null || fuelConsumption === 0)) {
      if (initialFuel >= finalFuel) {
        fuelConsumption = Math.round((initialFuel - finalFuel) * 100) / 100;
      }
    }

    return {
      tggVehicleName: vName,
      kmsTravelled: kmsTravelled !== null ? Math.round(kmsTravelled * 10) / 10 : null,
      initialFuel: initialFuel !== null ? Math.round(initialFuel * 100) / 100 : null,
      finalFuel: finalFuel !== null ? Math.round(finalFuel * 100) / 100 : null,
      fuelConsumption: fuelConsumption !== null ? Math.round(fuelConsumption * 100) / 100 : null
    };
  };

  for (const key of Object.keys(tggData)) {
    const vehObj = tggData[key];
    if (vehObj && typeof vehObj === 'object') {
      const res = processVehicle(key, vehObj);
      if (res) results.push(res);
    }
  }

  return results;
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
  fetchDailyKilometersFromTgg,
  parseFuelDayReportFromTgg
};

