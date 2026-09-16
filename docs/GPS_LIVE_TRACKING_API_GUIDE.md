# Live GPS Tracking API Integration Guide

This guide provides technical specifications, endpoints, request parameters, response schemas, and code integration examples for third-party applications consuming Pydah Transport's Live GPS Vehicle Tracking API.

---

## 1. Base Information

- **Base URL (Production)**: `https://transport.pydah.edu.in/api/gps`
- **Base URL (Local/Development)**: `http://localhost:5000/api/gps`
- **Data Format**: `JSON`
- **Recommended Polling Interval**: **2 to 5 seconds** (Live coordinates update continuously)

---

## 2. API Endpoints

### Endpoint 1: Get Live Location by Bus Number / Plate Number

Retrieve real-time GPS coordinates, speed, ignition status, heading angle, and driver details for a specific bus.

- **HTTP Method**: `GET`
- **URL Path**: `/live-location/:busNumber`  OR  `/live-location?busNumber=:busNumber`

#### Path / Query Parameters:
| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `busNumber` | `string` | **Yes** | Bus Number, License Plate, or Route ID stored in DB | `AP-39-WS-0357` or `AP39WS0357` or `R03` |

#### Example Request:
```http
GET /api/gps/live-location/AP39WS0357 HTTP/1.1
Host: transport.pydah.edu.in
Accept: application/json
```

#### Example Success Response (`200 OK`):
```json
{
  "success": true,
  "timestamp": "2026-09-16T12:25:00.000Z",
  "query": {
    "busNumber": "AP39WS0357"
  },
  "data": {
    "busNumber": "AP-39-WS-0357",
    "plateKey": "ap39ws0357",
    "routeId": "R03",
    "routeName": "Kakinada Local - Vakalapudi",
    "tggVehicleName": "R03_AP39WS0357",
    "location": {
      "latitude": 16.985421,
      "longitude": 82.241235,
      "speed": 34,
      "speedUnit": "km/h",
      "heading": 185,
      "ignition": true,
      "status": "Moving",
      "lastUpdated": "2026-09-16T12:24:45.000Z"
    },
    "busDetails": {
      "busId": "66487291a82e9b0012345678",
      "capacity": 76,
      "driverName": "P. Rambabu",
      "driverPhone": "9876543210",
      "campus": "Kakinada Campus"
    }
  }
}
```

---

### Endpoint 2: Get Live Locations for All Active Buses

Retrieve real-time GPS locations for the entire active bus fleet in a single call.

- **HTTP Method**: `GET`
- **URL Path**: `/live-location`

#### Query Parameters (Optional Filters):
| Parameter | Type | Required | Description | Example |
| :--- | :--- | :--- | :--- | :--- |
| `routeId` | `string` | No | Filter fleet by specific Route ID | `R03` |

#### Example Request:
```http
GET /api/gps/live-location HTTP/1.1
Host: transport.pydah.edu.in
Accept: application/json
```

#### Example Success Response (`200 OK`):
```json
{
  "success": true,
  "timestamp": "2026-09-16T12:25:00.000Z",
  "count": 32,
  "data": [
    {
      "busNumber": "AP-39-WS-0357",
      "plateKey": "ap39ws0357",
      "routeId": "R03",
      "routeName": "Kakinada Local - Vakalapudi",
      "tggVehicleName": "R03_AP39WS0357",
      "location": {
        "latitude": 16.985421,
        "longitude": 82.241235,
        "speed": 34,
        "speedUnit": "km/h",
        "heading": 185,
        "ignition": true,
        "status": "Moving",
        "lastUpdated": "2026-09-16T12:24:45.000Z"
      },
      "busDetails": {
        "busId": "66487291a82e9b0012345678",
        "capacity": 76,
        "driverName": "P. Rambabu",
        "driverPhone": "9876543210",
        "campus": "Kakinada Campus"
      }
    }
  ]
}
```

---

## 3. Data Field Definitions

| Field Name | Type | Description |
| :--- | :--- | :--- |
| `busNumber` | `string` | Official formatted bus/vehicle registration number |
| `plateKey` | `string` | Cleaned alphanumeric license plate identifier used for matching |
| `routeId` | `string` | Assigned route code (e.g., `R03`, `R20`) |
| `routeName` | `string` | Full human-readable route title |
| `location.latitude` | `number` | Real-time GPS Latitude coordinate (WGS84 decimal degrees) |
| `location.longitude` | `number` | Real-time GPS Longitude coordinate (WGS84 decimal degrees) |
| `location.speed` | `number` | Current vehicle movement speed in km/h |
| `location.heading` | `number` | Compass bearing angle in degrees (`0°` = North, `90°` = East, `180°` = South, `270°` = West) |
| `location.ignition` | `boolean` | `true` if vehicle engine/ACC status is active; `false` if turned off |
| `location.status` | `string` | Vehicle state: `Moving` (speed > 3 km/h), `Idle` (ignition ON, stationary), `Stopped` (ignition OFF) |
| `location.lastUpdated` | `string` | UTC ISO-8601 timestamp of last GPS telemetry transmission |
| `busDetails.driverName` | `string` | Assigned driver's name |
| `busDetails.driverPhone` | `string` | Assigned driver's contact mobile number |

---

## 4. Integration Code Examples

### A. JavaScript (Fetch / Async/Await)
```javascript
async function getBusLocation(busNumber) {
  try {
    const response = await fetch(`https://transport.pydah.edu.in/api/gps/live-location/${encodeURIComponent(busNumber)}`);
    const result = await response.json();
    
    if (result.success && result.data) {
      const { latitude, longitude, status, speed } = result.data.location;
      console.log(`Bus ${busNumber} is at [${latitude}, ${longitude}], Status: ${status}, Speed: ${speed} km/h`);
      return result.data;
    } else {
      console.warn('Bus location not found:', result.message);
    }
  } catch (error) {
    console.error('Error fetching live location:', error);
  }
}

// Usage:
getBusLocation('AP-39-WS-0357');
```

### B. Map Display Integration (Leaflet / Google Maps)
```javascript
// Example updating a Leaflet map marker
let busMarker = null;

async function updateMapMarker(map, busNumber) {
  const busData = await getBusLocation(busNumber);
  if (!busData) return;

  const { latitude, longitude, status } = busData.location;
  const latLng = [latitude, longitude];

  if (!busMarker) {
    busMarker = L.marker(latLng).addTo(map);
    busMarker.bindPopup(`<b>${busData.busNumber}</b><br>Route: ${busData.routeName}<br>Status: ${status}`);
  } else {
    busMarker.setLatLng(latLng);
  }

  map.panTo(latLng);
}

// Poll location every 3 seconds
setInterval(() => updateMapMarker(myMap, 'AP-39-WS-0357'), 3000);
```

### C. cURL Example
```bash
curl -X GET "https://transport.pydah.edu.in/api/gps/live-location/AP39WS0357" \
     -H "Accept: application/json"
```

---

## 5. Error Handling & Status Codes

| Status Code | Description | Cause / Action |
| :--- | :--- | :--- |
| `200 OK` | Success | Valid coordinates returned |
| `404 Not Found` | Bus Not Found | The requested bus number is not active or not in GPS tracking |
| `502 Bad Gateway` | Telemetry Unavailable | GPS provider server issue; retry after 2 seconds |
| `500 Internal Error` | Server Error | Internal backend exception |
