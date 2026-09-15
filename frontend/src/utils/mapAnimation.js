/**
 * Production-Quality Live Vehicle Movement System & Motion Engine
 *
 * Architecture Principles:
 * 1. Separates authoritative GPS data (`gpsPosition`) from visual map position (`displayPosition`).
 * 2. Silky Smooth Motion Engine: Exponential LERP damping (1 - e^(-3.5 * deltaSec)) for fluid 60 FPS movement
 *    without any micro-stuttering, shaking, or corner jerks.
 * 3. Trailing Route Line: Continuous 60 FPS update of trailing route line ending at displayPosition,
 *    so the route line grows behind the vehicle icon as it drives (never drawn ahead of the vehicle).
 * 4. Smart Camera Tracking: Auto-follows vehicle, but pauses auto-pan when user manually drags/adjusts map.
 * 5. Out-of-order & stale GPS packet filtering based on device timestamps.
 */

// Motion States per vehicle ID: Map<key, VehicleMotionState>
const vehicleStates = new Map();

// Global camera follow configuration & user interaction state
let cameraFollowKey = null;
let cameraMapInstance = null;
let isUserInteractingWithMap = false;

export const setCameraFollowVehicle = (key, mapInstance) => {
  cameraFollowKey = key;
  cameraMapInstance = mapInstance;
  if (key && mapInstance && vehicleStates.has(key) && !isUserInteractingWithMap) {
    const state = vehicleStates.get(key);
    if (state && state.displayPosition) {
      try {
        mapInstance.panTo([state.displayPosition.lat, state.displayPosition.lng], { animate: false });
      } catch (_) {}
    }
  }
};

export const clearCameraFollow = () => {
  cameraFollowKey = null;
  cameraMapInstance = null;
  isUserInteractingWithMap = false;
};

export const setUserInteractingWithMap = (interacting) => {
  isUserInteractingWithMap = Boolean(interacting);
};

export const getIsUserInteractingWithMap = () => isUserInteractingWithMap;

const isValidCoordinate = (lat, lng) => {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (isNaN(lat) || isNaN(lng) || !isFinite(lat) || !isFinite(lng)) return false;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return false;
  if (lat === 0 && lng === 0) return false;
  return true;
};

const parseGpsTimestampMs = (ts) => {
  if (!ts) return null;
  if (typeof ts === 'number' && ts > 0) return ts;
  if (typeof ts === 'string') {
    const cleaned = ts.trim().replace(' ', 'T');
    const parsed = Date.parse(cleaned);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return null;
};

/**
 * Ensures a persistent 60 FPS silky smooth animation loop for a vehicle
 */
const ensureVehicleLoopRunning = (key) => {
  const state = vehicleStates.get(key);
  if (!state || state.rafId !== null) return;

  let lastFrameTime = performance.now();

  const loop = (now) => {
    if (!vehicleStates.has(key)) return;

    const deltaSec = Math.min(0.1, Math.max(0.001, (now - lastFrameTime) / 1000));
    lastFrameTime = now;

    try {
      const {
        marker,
        displayPosition,
        targetLat,
        targetLng,
        polylines,
        basePath,
        telemetryStatus
      } = state;

      if (marker && typeof marker.setLatLng === 'function') {
        // -------------------------------------------------------------
        // TIME-INDEPENDENT EXPONENTIAL LERP SMOOTHING (Zero Shaking)
        // -------------------------------------------------------------
        if (telemetryStatus === 'live_gps') {
          const lerpRate = 1 - Math.exp(-3.5 * deltaSec);
          
          displayPosition.lat += (targetLat - displayPosition.lat) * lerpRate;
          displayPosition.lng += (targetLng - displayPosition.lng) * lerpRate;
        }

        // Direct Leaflet Marker Update (60 FPS)
        marker.setLatLng([displayPosition.lat, displayPosition.lng]);

        // -------------------------------------------------------------
        // TRAILING ROUTE LINE UPDATE (Grows right behind the vehicle icon)
        // -------------------------------------------------------------
        if (Array.isArray(polylines) && polylines.length > 0) {
          const currentPath = [...(basePath || []), [displayPosition.lat, displayPosition.lng]];
          polylines.forEach(pl => {
            if (pl && typeof pl.setLatLngs === 'function') {
              try {
                pl.setLatLngs(currentPath);
              } catch (_) {}
            }
          });
        }

        // -------------------------------------------------------------
        // SMART CAMERA AUTO-FOLLOW (Pauses when user manually drags map)
        // -------------------------------------------------------------
        if (!isUserInteractingWithMap && cameraFollowKey === key && cameraMapInstance && typeof cameraMapInstance.panTo === 'function') {
          try {
            cameraMapInstance.panTo([displayPosition.lat, displayPosition.lng], { animate: false });
          } catch (_) {}
        }
      }
    } catch (err) {
      console.warn('[ANIMATION LOOP ERROR]', key, err);
    }

    state.rafId = requestAnimationFrame(loop);
  };

  state.rafId = requestAnimationFrame(loop);
};

/**
 * Main telemetry update function called when new API data arrives
 */
export const animateMarkerPosition = (
  marker,
  targetLat,
  targetLng,
  durationOrOptions = {},
  key = 'default',
  animStore = {}
) => {
  if (!marker || typeof marker.getLatLng !== 'function' || typeof marker.setLatLng !== 'function') {
    return;
  }

  if (!isValidCoordinate(targetLat, targetLng)) {
    return;
  }

  const nowWall = Date.now();

  let options = {};
  if (typeof durationOrOptions === 'object' && durationOrOptions !== null) {
    options = durationOrOptions;
  } else if (typeof durationOrOptions === 'number') {
    options = { duration: durationOrOptions };
  }

  const isProviderUnavailable =
    Boolean(options.isFallback) ||
    options.telemetryStatus === 'provider_unavailable' ||
    options.providerOffline === true;

  const incomingTimestampMs = parseGpsTimestampMs(options.timestamp || options.time || options.date);

  // Retrieve or create per-vehicle motion state
  let state = vehicleStates.get(key);
  if (!state) {
    const currentMarkerPos = marker.getLatLng();
    const initialLat = (currentMarkerPos && isValidCoordinate(currentMarkerPos.lat, currentMarkerPos.lng)) ? currentMarkerPos.lat : targetLat;
    const initialLng = (currentMarkerPos && isValidCoordinate(currentMarkerPos.lat, currentMarkerPos.lng)) ? currentMarkerPos.lng : targetLng;

    state = {
      key,
      marker,
      gpsPosition: { lat: targetLat, lng: targetLng, timestampMs: incomingTimestampMs || nowWall },
      startLat: initialLat,
      startLng: initialLng,
      targetLat,
      targetLng,
      displayPosition: { lat: initialLat, lng: initialLng },
      polylines: options.polylines || [],
      basePath: options.basePath || [],
      telemetryStatus: isProviderUnavailable ? 'provider_unavailable' : 'live_gps',
      lastGpsTimestampMs: incomingTimestampMs || nowWall,
      rafId: null
    };
    vehicleStates.set(key, state);

    ensureVehicleLoopRunning(key);
    return;
  }

  // Update marker reference & polylines
  state.marker = marker;
  if (options.polylines) state.polylines = options.polylines;

  // Safely merge incoming base points into state.basePath without erasing accumulated driven trail
  if (options.basePath && Array.isArray(options.basePath)) {
    if (!state.basePath || state.basePath.length === 0) {
      state.basePath = [...options.basePath];
    } else {
      options.basePath.forEach(pt => {
        if (Array.isArray(pt) && pt.length === 2) {
          const lastPt = state.basePath[state.basePath.length - 1];
          if (!lastPt || Math.abs(lastPt[0] - pt[0]) > 0.00001 || Math.abs(lastPt[1] - pt[1]) > 0.00001) {
            state.basePath.push(pt);
          }
        }
      });
    }
  }

  // -------------------------------------------------------------
  // OUT-OF-ORDER & STALE GPS PACKET FILTERING
  // -------------------------------------------------------------
  if (incomingTimestampMs && state.lastGpsTimestampMs && incomingTimestampMs < state.lastGpsTimestampMs) {
    return;
  }

  // -------------------------------------------------------------
  // UPDATE TARGET POSITION FOR SMOOTH EXPONENTIAL LERP
  // -------------------------------------------------------------
  if (!isProviderUnavailable) {
    state.telemetryStatus = 'live_gps';

    // Commit previous start coordinate to basePath (passed points)
    if (state.basePath && Array.isArray(state.basePath)) {
      const lastPt = state.basePath[state.basePath.length - 1];
      if (!lastPt || Math.abs(lastPt[0] - state.targetLat) > 0.00001 || Math.abs(lastPt[1] - state.targetLng) > 0.00001) {
        state.basePath.push([state.targetLat, state.targetLng]);
      }
    }

    state.startLat = state.displayPosition.lat;
    state.startLng = state.displayPosition.lng;
    state.targetLat = targetLat;
    state.targetLng = targetLng;
    state.gpsPosition = { lat: targetLat, lng: targetLng, timestampMs: incomingTimestampMs || nowWall };
    state.lastGpsTimestampMs = incomingTimestampMs || nowWall;

  } else {
    state.telemetryStatus = 'provider_unavailable';
  }

  ensureVehicleLoopRunning(key);
};

export const driveMarkerAlongRoad = animateMarkerPosition;

export const cancelMarkerAnimation = (key, animStore) => {
  if (animStore && animStore[key]) {
    cancelAnimationFrame(animStore[key]);
    delete animStore[key];
  }
  if (vehicleStates.has(key)) {
    const state = vehicleStates.get(key);
    if (state && state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    vehicleStates.delete(key);
  }
};

export const cancelAllMarkerAnimations = (animStore) => {
  if (animStore) {
    Object.keys(animStore).forEach((k) => {
      if (animStore[k]) {
        cancelAnimationFrame(animStore[k]);
        delete animStore[k];
      }
    });
  }
  vehicleStates.forEach((state) => {
    if (state && state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
  });
  vehicleStates.clear();
};

export const getVehicleTelemetryState = (key) => {
  return vehicleStates.get(key) || null;
};
