const EARTH_RADIUS_METERS = 6371000;

function toRadians(value) {
  return (value * Math.PI) / 180;
}

function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_METERS * c;
}

function isPointInsideGeofence(lat, lng, centerLat, centerLng, radiusMeters) {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (!Number.isFinite(centerLat) || !Number.isFinite(centerLng)) return false;
  const radius = Number(radiusMeters) || 0;
  if (radius <= 0) return false;
  return getDistanceMeters(lat, lng, centerLat, centerLng) <= radius;
}

function getLocalDateKey(date = new Date()) {
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(date.getTime() + istOffsetMs);
  return istDate.toISOString().slice(0, 10);
}

module.exports = {
  getDistanceMeters,
  isPointInsideGeofence,
  getLocalDateKey,
};
