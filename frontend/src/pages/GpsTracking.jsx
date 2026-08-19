import React, { useState, useEffect, useCallback, useRef } from 'react';
import Layout from '../components/Layout';
import { apiFetch, API_BASE } from '../utils/api';
import {
  Navigation,
  MapPin,
  RefreshCw,
  Search,
  Clock,
  ExternalLink,
  Activity,
  Layers,
  Zap,
  Map as MapIcon,
  Loader2,
  Download,
  ChevronDown
} from 'lucide-react';
import GpsFinalDestinationModal from '../components/GpsFinalDestinationModal';

const formatGeofenceTime = (val) => {
  if (!val) return '—';
  const d = new Date(val.replace(' ', 'T'));
  if (isNaN(d.getTime())) return val;
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}:${mi}:${ss}  ${dd}-${mm}-${yyyy}`;
};

export default function GpsTracking() {
  const [vehicles, setVehicles] = useState([]);
  const [selectedVehicle, setSelectedVehicle] = useState(null); // null means "All Vehicles Mode"
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all'); // 'all' | 'moving' | 'idle'
  const [loading, setLoading] = useState(false);

  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Tracing mode state & fast points
  const [traceLogs, setTraceLogs] = useState([]);
  const [traceLoading, setTraceLoading] = useState(false);
  const [isLeafletReady, setIsLeafletReady] = useState(false);

  // Leaflet Map & Tracking Refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupRef = useRef(null);
  const polylineRef = useRef(null);
  const liveBreadcrumbsRef = useRef({});
  const centeredVehicleNameRef = useRef(null);

  // GPS Daily Kilometer Tracking States
  const [kmTab, setKmTab] = useState('history');
  const [kmData, setKmData] = useState([]);
  const [kmLoading, setKmLoading] = useState(false);
  const [kmError, setKmError] = useState(null);
  const [kmDateFrom, setKmDateFrom] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [kmDateTo, setKmDateTo] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [kmIsMock, setKmIsMock] = useState(false);

  // Travelled Tab States
  const [activePageTab, setActivePageTab] = useState(() => {
    return sessionStorage.getItem('gps_active_page_tab') || 'live';
  });
  const [fleetKmValues, setFleetKmValues] = useState({});
  const [fleetSearchQuery, setFleetSearchQuery] = useState('');
  const [fleetSortField, setFleetSortField] = useState('route');
  const [fleetSortOrder, setFleetSortOrder] = useState('asc');
  const [fleetDateFrom, setFleetDateFrom] = useState(() => {
    return sessionStorage.getItem('gps_fleet_date_from') || new Date().toISOString().split('T')[0];
  });
  const [fleetDateTo, setFleetDateTo] = useState(() => {
    return sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
  });

  // Geofence accordion state for Distance Travelled table
  const [expandedFleetVehicle, setExpandedFleetVehicle] = useState(null);
  const [geofenceData, setGeofenceData] = useState({});
  const [geofenceLoading, setGeofenceLoading] = useState({});

  // Final Destination modal
  const [campuses, setCampuses] = useState([]);

  // Load campuses once
  useEffect(() => {
    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/campuses`);
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) setCampuses(json.data);
        else if (Array.isArray(json)) setCampuses(json);
      } catch { /* ignore */ }
    })();
  }, []);

  // Dynamically load Leaflet library for fast interactive multi-marker map & polyline tracing
  useEffect(() => {
    if (!document.getElementById('leaflet-css')) {
      const css = document.createElement('link');
      css.id = 'leaflet-css';
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(css);
    }

    if (!window.L && !document.getElementById('leaflet-js')) {
      const script = document.createElement('script');
      script.id = 'leaflet-js';
      script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      script.onload = () => setIsLeafletReady(true);
      document.head.appendChild(script);
    } else if (window.L) {
      setIsLeafletReady(true);
    }
  }, []);

  // Fetch Live Vehicles List
  const loadVehicles = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      setLoading(true);
    }
    try {
      const response = await apiFetch(`${API_BASE}/gps/vehicles`);
      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        setVehicles(data.data);
      } else {
        setVehicles([]);
      }
    } catch (err) {
      console.warn('API fetch notice:', err);
      setVehicles([]);
    } finally {
      if (!isBackground) {
        setLoading(false);
      }
      setLastUpdated(new Date());
    }
  }, []);

  // Ref tracking current selected vehicle to prevent race conditions when switching vehicles
  const selectedVehicleRef = useRef(selectedVehicle);
  useEffect(() => {
    selectedVehicleRef.current = selectedVehicle;
  }, [selectedVehicle]);

  // Fast trace history fetch for a specific vehicle
  const fetchDailyKm = useCallback(async (vehName) => {
    const targetVeh = vehName || (selectedVehicle ? selectedVehicle.name : null);
    if (!targetVeh) return;
    
    setKmLoading(true);
    setKmError(null);
    try {
      const res = await apiFetch(
        `${API_BASE}/gps/daily-km?vehicle_name=${encodeURIComponent(targetVeh)}&date_from=${kmDateFrom}&date_to=${kmDateTo}`
      );
      const resData = await res.json();
      if (resData.success && Array.isArray(resData.data)) {
        setKmData(resData.data);
        setKmIsMock(resData.isMock || false);
      } else {
        throw new Error(resData.message || 'Failed to fetch kilometer data');
      }
    } catch (err) {
      console.error('Error fetching daily KM tracking:', err);
      setKmError(err.message || 'Something went wrong. Please try again.');
    } finally {
      setKmLoading(false);
    }
  }, [selectedVehicle?.name, kmDateFrom, kmDateTo]);

  useEffect(() => {
    if (selectedVehicle && kmTab === 'kilometers') {
      fetchDailyKm(selectedVehicle.name);
    }
  }, [selectedVehicle?.name, kmTab, fetchDailyKm]);

  const handleDownloadKmCsv = () => {
    if (!kmData.length || !selectedVehicle) return;
    const headers = ['Date', 'Day', 'Distance (km)', 'Status', 'Data Source'];
    const rows = kmData.map(r => {
      const dateObj = new Date(r.date);
      const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
      const status = r.kilometers > 0 ? 'Active Route Run' : 'Stationary';
      const source = r.isMock ? 'Demo/Fallback Data' : 'Live GPS';
      return [r.date, dayName, `${r.kilometers} km`, status, source];
    });
    
    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Vehicle_${selectedVehicle.name}_GPS_Distance_Log.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const fetchSingleVehicleKm = useCallback(async (vehName, forceRefresh = false) => {
    const cacheKey = `gps_km_${vehName}_${fleetDateFrom}_${fleetDateTo}`;
    if (!forceRefresh) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          setFleetKmValues(prev => ({
            ...prev,
            [vehName]: { totalKm: parsed.totalKm, isMock: parsed.isMock, loading: false }
          }));
          return;
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    try {
      const res = await apiFetch(
        `${API_BASE}/gps/daily-km?vehicle_name=${encodeURIComponent(vehName)}&date_from=${fleetDateFrom}&date_to=${fleetDateTo}`
      );
      const resData = await res.json();
      if (resData.success && Array.isArray(resData.data)) {
        const totalKm = resData.data.reduce((acc, d) => acc + d.kilometers, 0);
        const resultVal = { totalKm, isMock: resData.isMock || false, loading: false };
        sessionStorage.setItem(cacheKey, JSON.stringify(resultVal));
        setFleetKmValues(prev => ({
          ...prev,
          [vehName]: resultVal
        }));
      } else {
        throw new Error();
      }
    } catch (err) {
      const resultVal = { totalKm: 0, isMock: true, loading: false };
      sessionStorage.setItem(cacheKey, JSON.stringify(resultVal));
      setFleetKmValues(prev => ({
        ...prev,
        [vehName]: resultVal
      }));
    }
  }, [fleetDateFrom, fleetDateTo]);

  const startLoadingFleetKm = useCallback((forceRefresh = false) => {
    if (!vehicles.length) return;
    
    // Initialize loading states for each vehicle
    const initial = {};
    vehicles.forEach(v => {
      const cacheKey = `gps_km_${v.name}_${fleetDateFrom}_${fleetDateTo}`;
      if (!forceRefresh) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            initial[v.name] = { totalKm: parsed.totalKm, isMock: parsed.isMock, loading: false };
            return;
          } catch (e) {}
        }
      }
      initial[v.name] = { totalKm: 0, isMock: false, loading: true };
    });
    setFleetKmValues(initial);
    
    // Fetch in parallel
    vehicles.forEach(v => {
      const cacheKey = `gps_km_${v.name}_${fleetDateFrom}_${fleetDateTo}`;
      if (!forceRefresh && sessionStorage.getItem(cacheKey)) {
        // Already loaded via initial state setting
        return;
      }
      fetchSingleVehicleKm(v.name, forceRefresh);
    });
  }, [vehicles, fleetDateFrom, fleetDateTo, fetchSingleVehicleKm]);

  useEffect(() => {
    if (activePageTab === 'travelled' && vehicles.length > 0) {
      startLoadingFleetKm(false);
    }
  }, [activePageTab, vehicles.length, startLoadingFleetKm]);

  const handleFleetSort = (field) => {
    if (fleetSortField === field) {
      setFleetSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setFleetSortField(field);
      setFleetSortOrder(field === 'distance' ? 'desc' : 'asc');
    }
  };

  const handleExportFleetCsv = () => {
    if (!vehicles.length) return;
    
    // Sort and filter exactly like the rendered table
    const filtered = vehicles.filter(v => {
      if (!fleetSearchQuery) return true;
      return v.name.toLowerCase().includes(fleetSearchQuery.toLowerCase()) ||
             (v.routeId && v.routeId.toLowerCase().includes(fleetSearchQuery.toLowerCase())) ||
             (v.routeName && v.routeName.toLowerCase().includes(fleetSearchQuery.toLowerCase()));
    });

    const sorted = [...filtered].sort((a, b) => {
      if (fleetSortField === 'route') {
        const valA = a.routeId || '';
        const valB = b.routeId || '';
        if (fleetSortOrder === 'asc') {
          return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
        } else {
          return valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
        }
      } else if (fleetSortField === 'distance') {
        const kmA = (fleetKmValues[a.name] || { totalKm: 0 }).totalKm;
        const kmB = (fleetKmValues[b.name] || { totalKm: 0 }).totalKm;
        return fleetSortOrder === 'asc' ? kmA - kmB : kmB - kmA;
      }
      return 0;
    });

    const headers = ['Route ID', 'Route Name', 'Vehicle Name', 'Unit ID', 'Live Status', 'Latitude', 'Longitude', 'Total Distance (km)', 'Data Source'];
    const rows = sorted.map(v => {
      const isMoving = (v.speed || 0) > 0;
      const status = isMoving ? 'Moving' : 'Stopped';
      
      const kmInfo = fleetKmValues[v.name] || { totalKm: 0, isMock: false, loading: false };
      const source = kmInfo.isMock ? 'Demo/Fallback Data' : 'Live GPS';
      return [
        v.routeId || 'Unassigned',
        v.routeName || 'Unassigned',
        v.name,
        v.units,
        status,
        v.latitude,
        v.longitude,
        `${kmInfo.totalKm.toFixed(1)} km`,
        source
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `Fleet_Travelled_Report_${fleetDateFrom}_to_${fleetDateTo}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleGeofenceAccordion = useCallback(async (vehicleName) => {
    if (expandedFleetVehicle === vehicleName) {
      setExpandedFleetVehicle(null);
      return;
    }
    setExpandedFleetVehicle(vehicleName);

    const cacheKey = `${vehicleName}_${fleetDateFrom}_${fleetDateTo}`;
    if (geofenceData[cacheKey]) return;

    setGeofenceLoading((prev) => ({ ...prev, [vehicleName]: true }));
    try {
      const res = await apiFetch(
        `${API_BASE}/gps/geofence-report?vehicle_name=${encodeURIComponent(vehicleName)}&date_from=${fleetDateFrom}&date_to=${fleetDateTo}`
      );
      const json = await res.json();
      const rows = json.success && json.data ? (Array.isArray(json.data) ? json.data : (json.data.report || json.data.rows || [])) : [];
      setGeofenceData((prev) => ({ ...prev, [cacheKey]: rows }));
    } catch {
      setGeofenceData((prev) => ({ ...prev, [cacheKey]: [] }));
    } finally {
      setGeofenceLoading((prev) => ({ ...prev, [vehicleName]: false }));
    }
  }, [expandedFleetVehicle, fleetDateFrom, fleetDateTo, geofenceData]);

  useEffect(() => {
    if (mapInstanceRef.current) {
      setTimeout(() => {
        mapInstanceRef.current.invalidateSize();
      }, 350);
    }
  }, [kmTab, activePageTab]);

  const loadTraceHistoryFast = useCallback(async (vehName) => {
    if (!vehName) {
      setTraceLogs([]);
      return;
    }
    setTraceLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/gps/history`, {
        method: 'POST',
        body: JSON.stringify({ vehicle_name: vehName })
      });
      const data = await res.json();

      // Guard: Only update trace logs if user is still viewing this vehicle
      if (selectedVehicleRef.current?.name === vehName) {
        if (data.success && Array.isArray(data.data)) {
          setTraceLogs(data.data);
        } else {
          setTraceLogs([]);
        }
      }
    } catch (err) {
      console.warn('Fast trace fetch warning:', err);
      if (selectedVehicleRef.current?.name === vehName) {
        setTraceLogs([]);
      }
    } finally {
      if (selectedVehicleRef.current?.name === vehName) {
        setTraceLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    loadVehicles(false);
  }, [loadVehicles]);

  // Periodic 30-second background sync for fleet vehicles
  useEffect(() => {
    const interval = setInterval(() => {
      loadVehicles(true);
    }, 30000);
    return () => clearInterval(interval);
  }, [loadVehicles]);

  // Handle vehicle selection: Instant trace fetch on selection
  const handleSelectVehicle = (veh) => {
    selectedVehicleRef.current = veh;
    setSelectedVehicle(veh);
    setTraceLogs([]); // Clear trace logs immediately on switch to prevent showing old route

    if (veh) {
      loadTraceHistoryFast(veh.name);
    }
  };

  // Filter vehicles
  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch =
      (v.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.units || '').toString().includes(searchQuery);

    if (statusFilter === 'moving') return matchesSearch && (v.speed || 0) > 0;
    if (statusFilter === 'idle') return matchesSearch && (!v.speed || v.speed === 0);
    return matchesSearch;
  });

  const movingCount = vehicles.filter(v => (v.speed || 0) > 0).length;
  const idleCount = vehicles.filter(v => (!v.speed || v.speed === 0)).length;

  // Custom styled bus icon marker helper (Green for Moving, Red for Stopped)
  const createVehicleIcon = useCallback((isMoving) => {
    if (!window.L) return null;
    const bgColor = isMoving ? '#10B981' : '#EF4444'; // High-contrast neon green / rose red
    const shadowColor = isMoving ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)';
    return window.L.divIcon({
      className: 'custom-bus-marker',
      html: `
        <div style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        ">
          <div style="
            background: ${bgColor};
            color: #ffffff;
            width: 38px;
            height: 38px;
            border-radius: 50%;
            border: 2px solid #ffffff;
            box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35), 0 0 10px ${shadowColor};
            display: flex;
            align-items: center;
            justify-content: center;
          ">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;">
                <path d="M4 6 2 7" />
                <path d="M10 6h4" />
                <path d="m22 7-2-1" />
                <rect width="16" height="16" x="4" y="3" rx="2" fill="currentColor" fill-opacity="0.1" />
                <path d="M4 11h16" />
                <path d="M8 15h.01" stroke-width="3" />
                <path d="M16 15h.01" stroke-width="3" />
                <path d="M6 19v2" />
                <path d="M18 21v-2" />
            </svg>
          </div>
          <div style="
            width: 0;
            height: 0;
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 7px solid ${bgColor};
            margin-top: -2px;
            filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
          "></div>
        </div>
      `,
      iconSize: [38, 45],
      iconAnchor: [19, 45],
      popupAnchor: [0, -45]
    });
  }, []);

  // Fast live tracking & trace polling for single selected vehicle (500ms interval)
  useEffect(() => {
    if (!selectedVehicle) {
      centeredVehicleNameRef.current = null;
      return;
    }

    const vehicleName = selectedVehicle.name;

    const pollSelectedVehicle = async () => {
      // Guard: Only poll if vehicle selection hasn't changed
      if (selectedVehicleRef.current?.name !== vehicleName) return;

      try {
        // Fetch vehicles list AND trace history in parallel for maximum speed!
        const [vehiclesRes, historyRes] = await Promise.all([
          apiFetch(`${API_BASE}/gps/vehicles`),
          apiFetch(`${API_BASE}/gps/history`, {
            method: 'POST',
            body: JSON.stringify({ vehicle_name: vehicleName })
          })
        ]);

        const [vehiclesData, historyData] = await Promise.all([
          vehiclesRes.json(),
          historyRes.json()
        ]);

        // Guard: Ensure user hasn't switched vehicles while fetch was in-flight
        if (selectedVehicleRef.current?.name === vehicleName) {
          if (historyData.success && Array.isArray(historyData.data)) {
            setTraceLogs(historyData.data);
          }

          if (vehiclesData.success && Array.isArray(vehiclesData.data)) {
            setVehicles(vehiclesData.data);

            const updatedVeh = vehiclesData.data.find(v => v.name === vehicleName);
            if (updatedVeh && typeof updatedVeh.latitude === 'number' && typeof updatedVeh.longitude === 'number') {
              setSelectedVehicle(updatedVeh);

              // Accumulate live travelling coordinates into breadcrumbs path
              if (!liveBreadcrumbsRef.current[vehicleName]) {
                liveBreadcrumbsRef.current[vehicleName] = [];
              }
              const currentPath = liveBreadcrumbsRef.current[vehicleName];
              const lastCoord = currentPath[currentPath.length - 1];

              // Add new point if it moved or if path is empty
              if (!lastCoord || lastCoord[0] !== updatedVeh.latitude || lastCoord[1] !== updatedVeh.longitude) {
                if (updatedVeh.latitude !== 0 && updatedVeh.longitude !== 0) {
                  currentPath.push([updatedVeh.latitude, updatedVeh.longitude]);
                }
              }
            }
          }
        }
      } catch (err) {
        // quiet error
      }
    };

    pollSelectedVehicle();
    const interval = setInterval(pollSelectedVehicle, 5000);

    return () => clearInterval(interval);
  }, [selectedVehicle?.name, loadTraceHistoryFast]);

  // Recalculate map size and re-fit bounds when switching back to the live tab
  useEffect(() => {
    if (activePageTab === 'live' && mapInstanceRef.current && window.L) {
      const map = mapInstanceRef.current;
      const L = window.L;

      setTimeout(() => {
        map.invalidateSize({ animate: false });

        // Re-fit bounds so the view isn't stuck on a blank area
        if (selectedVehicle) {
          const lat = selectedVehicle.latitude;
          const lng = selectedVehicle.longitude;
          if (typeof lat === 'number' && typeof lng === 'number') {
            map.setView([lat, lng], map.getZoom(), { animate: false });
          }
        } else if (filteredVehicles.length > 0) {
          const bounds = L.latLngBounds();
          filteredVehicles.forEach(v => {
            if (typeof v.latitude === 'number' && typeof v.longitude === 'number') {
              bounds.extend([v.latitude, v.longitude]);
            }
          });
          if (bounds.isValid()) {
            map.fitBounds(bounds, { padding: [50, 50], animate: false });
          }
        }
      }, 300);
    }
  }, [activePageTab]); // eslint-disable-line react-hooks/exhaustive-deps

  // Initialize & Update Leaflet Map when vehicles or selectedVehicle or traceLogs change
  useEffect(() => {
    if (!isLeafletReady || !mapContainerRef.current || !window.L) return;

    const L = window.L;

    // Initialize map if not yet initialized
    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [17.544, 80.616],
        zoom: 10,
        zoomControl: true
      });

      L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps'
      }).addTo(map);

      layerGroupRef.current = L.layerGroup().addTo(map);
      mapInstanceRef.current = map;
    }

    const map = mapInstanceRef.current;
    const layerGroup = layerGroupRef.current;
    layerGroup.clearLayers();

    // 1. ALL VEHICLES MODE (selectedVehicle === null)
    if (!selectedVehicle) {
      centeredVehicleNameRef.current = null;
      if (filteredVehicles.length === 0) return;

      const bounds = L.latLngBounds();

      filteredVehicles.forEach(veh => {
        if (typeof veh.latitude === 'number' && typeof veh.longitude === 'number') {
          const latLng = [veh.latitude, veh.longitude];
          bounds.extend(latLng);

          const isMoving = (veh.speed || 0) > 0;
          const icon = createVehicleIcon(isMoving);

          // Custom Vehicle Icon Marker
          const marker = L.marker(latLng, { icon });

          const popupHtml = `
            <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
              <strong style="font-size: 13px; color: #0f172a;">${veh.name}</strong><br/>
              <span style="color: #64748b;">Unit ID: ${veh.units}</span><br/>
              <span style="color: ${isMoving ? '#059669' : '#dc2626'}; font-weight: bold;">
                ${isMoving ? `🚌 Speed: ${veh.speed} km/h` : '⏹ Stopped'}
              </span><br/>
              <span style="color: #94a3b8; font-size: 10px;">${veh.timestamp || ''}</span>
            </div>
          `;

          marker.bindPopup(popupHtml);
          marker.on('click', () => handleSelectVehicle(veh));
          marker.addTo(layerGroup);
        }
      });

      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
    // 2. SINGLE VEHICLE MODE (selectedVehicle !== null) -> Focused bus icon & vibrant colored route path
    else {
      const lat = selectedVehicle.latitude;
      const lng = selectedVehicle.longitude;
      const vehName = selectedVehicle.name;

      if (typeof lat === 'number' && typeof lng === 'number') {
        const isMoving = (selectedVehicle.speed || 0) > 0;
        const icon = createVehicleIcon(isMoving);

        const mainMarker = L.marker([lat, lng], { icon });

        mainMarker.bindPopup(`<b>${selectedVehicle.name}</b><br/>Unit: ${selectedVehicle.units}<br/>Speed: ${selectedVehicle.speed} km/h`);
        mainMarker.addTo(layerGroup);

        // Center map ONCE when vehicle selection changes with a sliding/zooming flight, then pan smoothly without zooming in/out
        if (centeredVehicleNameRef.current !== vehName) {
          map.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });
          centeredVehicleNameRef.current = vehName;
        } else {
          map.panTo([lat, lng], { animate: true });
        }

        // Build route trace points list combining Messages API history + live breadcrumbs
        const historyPoints = (traceLogs || [])
          .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0)
          .map(t => [t.latitude, t.longitude]);

        const livePoints = liveBreadcrumbsRef.current[vehName] || [];

        // Combine unique coordinates
        const allPointsMap = new Map();
        [...historyPoints, ...livePoints, [lat, lng]].forEach(pt => {
          if (Array.isArray(pt) && pt.length === 2 && !isNaN(pt[0]) && !isNaN(pt[1])) {
            const key = `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`;
            if (!allPointsMap.has(key)) {
              allPointsMap.set(key, pt);
            }
          }
        });

        const latLngs = Array.from(allPointsMap.values());

        if (latLngs.length >= 2) {
          // Outer Glow Line (Darker Blue)
          L.polyline(latLngs, {
            color: '#1d4ed8',
            weight: 9,
            opacity: 0.4,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(layerGroup);

          // Inner Vibrant Travelling Route Line (Bright Blue)
          L.polyline(latLngs, {
            color: '#2563eb',
            weight: 5,
            opacity: 0.95,
            lineCap: 'round',
            lineJoin: 'round'
          }).addTo(layerGroup);

          // Add small route breadcrumb dots along the travelling line
          latLngs.forEach((point, idx) => {
            if (idx < latLngs.length - 1) {
              L.circleMarker(point, {
                radius: 4,
                fillColor: '#60a5fa',
                color: '#ffffff',
                weight: 1.5,
                fillOpacity: 1
              }).addTo(layerGroup);
            }
          });
        }
      }
    }
  }, [isLeafletReady, selectedVehicle, filteredVehicles, traceLogs, createVehicleIcon, activePageTab]);

  return (
    <Layout>
      <div className="space-y-4 font-sans text-slate-800">
        {/* Compact Header matching site style */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Navigation size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">
                  GPS Live Fleet Tracking
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" /> Live
                </span>
                
                {/* Refresh Button placed right after header text live */}
                <button
                  onClick={loadVehicles}
                  disabled={loading}
                  title="Refresh Vehicles List"
                  className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md transition-all shrink-0 ml-1"
                >
                  <RefreshCw size={14} className={loading ? 'animate-spin text-blue-600' : ''} />
                </button>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selectedVehicle ? `Tracing Vehicle: ${selectedVehicle.name}` : `All Vehicles Fleet Map (${vehicles.length} Vehicles)`} • Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            </div>
          </div>

          {/* Page-level Tab Switching in Main Header */}
          <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs text-slate-650 font-semibold gap-1 shrink-0">
            <button
              onClick={() => {
                setActivePageTab('live');
                sessionStorage.setItem('gps_active_page_tab', 'live');
              }}
              className={`px-4 py-1.5 rounded-md transition-all ${
                activePageTab === 'live'
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50'
              }`}
            >
              Live Tracking Map
            </button>
            <button
              onClick={() => {
                setActivePageTab('travelled');
                sessionStorage.setItem('gps_active_page_tab', 'travelled');
              }}
              className={`px-4 py-1.5 rounded-md transition-all ${
                activePageTab === 'travelled'
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50'
              }`}
            >
              Distance Travelled Summary
            </button>
            <button
              onClick={() => {
                setActivePageTab('destination');
                sessionStorage.setItem('gps_active_page_tab', 'destination');
              }}
              className={`px-4 py-1.5 rounded-md transition-all ${
                activePageTab === 'destination'
                  ? 'bg-blue-600 text-white font-bold shadow-sm'
                  : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50/50'
              }`}
            >
              Final Destination
            </button>
          </div>
        </div>

        <div className={activePageTab === 'live' ? '' : 'hidden'}>
          {/* Main 2-Column Split: Compact Left Vehicles List + Right Big Map & Fast Tracing */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left Column: Compact Vehicles & Status List */}
            <div className="lg:col-span-4 xl:col-span-4 bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col h-[650px] space-y-3">
              {/* Search Box */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search vehicle or unit ID..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                />
              </div>

              {/* Status-wise List Filter Buttons & All Vehicles Selector */}
              <div className="space-y-1.5">
                <button
                  onClick={() => handleSelectVehicle(null)}
                  className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-between border ${
                    selectedVehicle === null
                      ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                      : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <MapIcon size={14} />
                    View All Vehicles on Map
                  </span>
                  <span className="text-[10px] bg-white/20 px-1.5 py-0.5 rounded font-mono">
                    {vehicles.length} Total
                  </span>
                </button>

                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs text-slate-600 font-medium">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`flex-1 py-1 rounded-md transition-all text-center ${
                      statusFilter === 'all' ? 'bg-white text-blue-700 font-bold shadow-sm' : 'hover:text-slate-900'
                    }`}
                  >
                    All ({vehicles.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('moving')}
                    className={`flex-1 py-1 rounded-md transition-all text-center ${
                      statusFilter === 'moving' ? 'bg-emerald-600 text-white font-bold shadow-sm' : 'hover:text-slate-900'
                    }`}
                  >
                    Moving ({movingCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('idle')}
                    className={`flex-1 py-1 rounded-md transition-all text-center ${
                      statusFilter === 'idle' ? 'bg-rose-600 text-white font-bold shadow-sm' : 'hover:text-slate-900'
                    }`}
                  >
                    Stopped ({idleCount})
                  </button>
                </div>
              </div>

              {/* Vehicles Cards List */}
              <div className="flex-1 overflow-y-auto space-y-2 pr-1 sidebar-scrollbar">
                {filteredVehicles.length === 0 ? (
                  <div className="text-center py-16 text-slate-400 text-xs">
                    {loading ? 'Loading vehicles list...' : 'No vehicles found.'}
                  </div>
                ) : (
                  filteredVehicles.map(veh => {
                    const isSelected = selectedVehicle && selectedVehicle.name === veh.name;
                    const isMoving = (veh.speed || 0) > 0;

                    return (
                      <div
                        key={veh.name + veh.units}
                        onClick={() => handleSelectVehicle(veh)}
                        className={`p-3 rounded-lg border cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-blue-50/90 border-blue-500 shadow-sm ring-1 ring-blue-400/30'
                            : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="font-bold text-slate-900 text-xs truncate">
                            {veh.name}
                          </span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold rounded-md border ${
                              isMoving
                                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {isMoving ? `🟢 Moving (${veh.speed} km/h)` : '🔴 Stopped'}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-500 flex items-center justify-between font-mono">
                          <span>Unit: <strong className="text-slate-700">{veh.units}</strong></span>
                          <span className="flex items-center gap-1 text-slate-400">
                            <MapPin size={11} className="text-slate-400" />
                            {veh.latitude?.toFixed(3)}, {veh.longitude?.toFixed(3)}
                          </span>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Right Column: Big Interactive Map & Fast Trace Points View */}
            <div className="lg:col-span-8 xl:col-span-8 bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col h-[650px] space-y-3">
              {/* Map Header Bar */}
              <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-md bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs">
                    <MapPin size={15} />
                  </div>
                  <div>
                    {selectedVehicle ? (
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          Tracing Vehicle: <span className="text-blue-700">{selectedVehicle.name}</span>
                          <span className="text-xs font-mono font-normal text-slate-500">
                            (Unit #{selectedVehicle.units})
                          </span>
                        </h2>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Speed: <span className="font-semibold text-slate-800">{selectedVehicle.speed} km/h</span> • Coordinates: {selectedVehicle.latitude}, {selectedVehicle.longitude}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <h2 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                          All Vehicles Fleet Map
                        </h2>
                        <p className="text-[11px] text-slate-500 font-mono">
                          Showing all {filteredVehicles.length} vehicles on interactive map pins. Click any vehicle to trace route.
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {selectedVehicle && selectedVehicle.uiiframe && (
                  <a
                    href={selectedVehicle.uiiframe}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg border border-blue-200 transition-colors"
                  >
                    <ExternalLink size={12} /> Direct TGG Frame
                  </a>
                )}
              </div>

              {/* Interactive Leaflet Big Map Container */}
              <div className={`rounded-lg border border-slate-200 overflow-hidden relative w-full transition-all duration-300 ${selectedVehicle && kmTab === 'kilometers' ? 'h-[180px] min-h-[180px]' : 'flex-1 min-h-[380px]'}`}>
                <div ref={mapContainerRef} className="w-full h-full z-0" />
              </div>

              {/* Fast Trace Points Table when a vehicle is selected */}
              {selectedVehicle && (
                <div className={`bg-slate-50 rounded-lg border border-slate-200 p-3 text-xs space-y-3 overflow-y-auto flex flex-col transition-all duration-300 ${kmTab === 'kilometers' ? 'flex-1' : 'max-h-[160px]'}`}>
                  <div className="flex border-b border-slate-200 pb-1.5 justify-between items-center shrink-0">
                    <div className="flex gap-2">
                      <button
                        onClick={() => setKmTab('history')}
                        className={`pb-1 font-bold text-xs border-b-2 transition-all ${
                          kmTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Location History
                      </button>
                      <button
                        onClick={() => setKmTab('kilometers')}
                        className={`pb-1 font-bold text-xs border-b-2 transition-all ${
                          kmTab === 'kilometers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700'
                        }`}
                      >
                        Distance Log (Daily km)
                      </button>
                    </div>
                    
                    {kmTab === 'history' && traceLoading && (
                      <span className="flex items-center gap-1 text-[10px] text-slate-500 font-semibold">
                        <RefreshCw size={11} className="animate-spin text-blue-600" /> Tracing...
                      </span>
                    )}

                    {kmTab === 'kilometers' && (
                      <button
                        onClick={handleDownloadKmCsv}
                        disabled={!kmData.length || kmLoading}
                        className="px-2 py-0.5 bg-slate-800 text-white font-bold rounded hover:bg-slate-900 transition-colors disabled:opacity-50 text-[10px]"
                      >
                        CSV Export
                      </button>
                    )}
                  </div>

                  {kmTab === 'history' ? (
                    <div className="space-y-1 flex-1 overflow-y-auto custom-scrollbar">
                      {traceLogs.length === 0 ? (
                        <p className="text-slate-400 italic text-[11px] py-4 text-center">
                          {traceLoading ? 'Loading trace points...' : 'No historical position points recorded for this vehicle today.'}
                        </p>
                      ) : (
                        traceLogs.map((log, idx) => (
                          <div key={idx} className="flex items-center justify-between font-mono text-[10px] bg-white p-1 rounded border border-slate-200">
                            <span className="text-slate-600">{log.timestamp || `Point #${idx + 1}`}</span>
                            <span className="text-slate-800">
                              Lat: {log.latitude}, Long: {log.longitude}
                            </span>
                            <span className="font-semibold text-emerald-700">{log.speed} km/h</span>
                          </div>
                        ))
                      )}
                    </div>
                  ) : (
                    <div className="space-y-3 flex-1 overflow-y-auto custom-scrollbar">
                      {/* Date Selector Row */}
                      <div className="flex flex-wrap items-center gap-2 bg-white p-2 rounded-lg border border-slate-200 shrink-0">
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">From:</span>
                          <input 
                            type="date" 
                            value={kmDateFrom} 
                            onChange={(e) => setKmDateFrom(e.target.value)}
                            className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-700 font-semibold outline-none"
                          />
                        </div>
                        <div className="flex items-center gap-1">
                          <span className="text-[10px] text-slate-400 font-bold uppercase">To:</span>
                          <input 
                            type="date" 
                            value={kmDateTo} 
                            onChange={(e) => setKmDateTo(e.target.value)}
                            className="rounded border border-slate-200 px-2 py-1 text-[10px] text-slate-700 font-semibold outline-none"
                          />
                        </div>
                        <button 
                          onClick={() => fetchDailyKm(selectedVehicle.name)}
                          disabled={kmLoading}
                          className="px-2 py-1 bg-blue-600 text-white rounded text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50"
                        >
                          {kmLoading ? 'Loading…' : 'Fetch'}
                        </button>
                      </div>

                      {kmLoading ? (
                        <div className="py-8 text-center text-slate-400 font-bold text-[11px] flex items-center justify-center gap-1.5">
                          <RefreshCw size={12} className="animate-spin text-blue-600" />
                          Querying GPS reports API...
                        </div>
                      ) : kmError ? (
                        <p className="text-red-600 text-[11px] py-4 text-center">{kmError}</p>
                      ) : kmData.length === 0 ? (
                        <p className="text-slate-400 italic text-[11px] py-4 text-center">No distance records found.</p>
                      ) : (
                        <div className="space-y-3">
                          {/* Summary KPI Row */}
                          <div className="grid grid-cols-3 gap-2 text-center text-[10px] shrink-0">
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-400 font-bold block text-[8px] uppercase">Total km</span>
                              <span className="font-extrabold text-slate-800 text-xs">
                                {kmData.reduce((acc, r) => acc + r.kilometers, 0).toFixed(1)} km
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-400 font-bold block text-[8px] uppercase">Daily Avg</span>
                              <span className="font-extrabold text-slate-800 text-xs">
                                {(kmData.reduce((acc, r) => acc + r.kilometers, 0) / kmData.length).toFixed(1)} km
                              </span>
                            </div>
                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                              <span className="text-slate-400 font-bold block text-[8px] uppercase">Max Run</span>
                              <span className="font-extrabold text-slate-800 text-xs">
                                {Math.max(...kmData.map(r => r.kilometers)).toFixed(1)} km
                              </span>
                            </div>
                          </div>

                          {/* Warnings */}
                          {kmIsMock && (
                            <div className="bg-amber-50 border border-amber-200 text-amber-700 text-[9px] p-2 rounded leading-normal">
                              ⚠️ Showing simulated logs for testing/demo (no live readings exist for this range).
                            </div>
                          )}

                          {/* Table */}
                          <div className="bg-white border border-slate-200 rounded-lg overflow-hidden">
                            <table className="w-full text-left text-[10px]">
                              <thead>
                                <tr className="bg-slate-50 border-b border-slate-100 text-slate-400 font-bold">
                                  <th className="px-3 py-2">Date</th>
                                  <th className="px-3 py-2">Distance</th>
                                  <th className="px-3 py-2 text-right">Source</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-50 text-slate-700 font-medium">
                                {kmData.map((day, idx) => (
                                  <tr key={idx} className="hover:bg-slate-50/50">
                                    <td className="px-3 py-1.5 font-mono">{day.date}</td>
                                    <td className="px-3 py-1.5 font-bold text-slate-900">{day.kilometers.toFixed(1)} km</td>
                                    <td className="px-3 py-1.5 text-right font-bold text-[9px]">
                                      <span className={day.isMock ? 'text-amber-600' : 'text-blue-600'}>
                                        {day.isMock ? 'Demo Log' : 'Live GPS'}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        {activePageTab === 'travelled' ? (
          /* Distance Travelled Summary View */
          <div className="space-y-4">
            {/* Date Filters, Search Box & Export */}
            <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                <div className="relative w-full sm:w-48">
                  <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">Search Bus / Route</label>
                  <div className="relative">
                    <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input 
                      type="text" 
                      placeholder="Search bus, route ID..."
                      value={fleetSearchQuery}
                      onChange={(e) => setFleetSearchQuery(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-705 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">From Date</label>
                  <input 
                    type="date" 
                    value={fleetDateFrom} 
                    onChange={(e) => {
                      setFleetDateFrom(e.target.value);
                      sessionStorage.setItem('gps_fleet_date_from', e.target.value);
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div>
                  <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">To Date</label>
                  <input 
                    type="date" 
                    value={fleetDateTo} 
                    onChange={(e) => {
                      setFleetDateTo(e.target.value);
                      sessionStorage.setItem('gps_fleet_date_to', e.target.value);
                    }}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                  />
                </div>
                <div className="pt-4">
                  <button 
                    onClick={() => startLoadingFleetKm(true)}
                    className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm"
                  >
                    <RefreshCw size={12} />
                    Refresh Logs
                  </button>
                </div>
              </div>

              <button 
                onClick={handleExportFleetCsv}
                disabled={!vehicles.length}
                className="w-full md:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Download size={13} />
                Export Fleet Report (CSV)
              </button>
            </div>

            {/* Summary KPI Cards */}
            {vehicles.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Fleet Distance</span>
                    <span className="text-xl font-black text-slate-900 mt-1 block">
                      {(() => {
                        let total = 0;
                        Object.values(fleetKmValues).forEach(val => {
                          total += val.totalKm || 0;
                        });
                        return total.toFixed(1);
                      })()} <span className="text-xs font-bold text-slate-500">km</span>
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
                    🚚
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Average per Vehicle</span>
                    <span className="text-xl font-black text-slate-900 mt-1 block">
                      {(() => {
                        let total = 0;
                        let count = 0;
                        Object.values(fleetKmValues).forEach(val => {
                          total += val.totalKm || 0;
                          count++;
                        });
                        return count > 0 ? (total / count).toFixed(1) : '0.0';
                      })()} <span className="text-xs font-bold text-slate-500">km</span>
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg">
                    ⚡
                  </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
                  <div>
                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Most Active Vehicle</span>
                    <span className="text-sm font-black text-slate-900 mt-1 block truncate max-w-[150px]">
                      {(() => {
                        let maxKm = -1;
                        let maxVeh = 'None';
                        Object.keys(fleetKmValues).forEach(key => {
                          if (fleetKmValues[key].totalKm > maxKm) {
                            maxKm = fleetKmValues[key].totalKm;
                            maxVeh = key;
                          }
                        });
                        return maxKm > -1 ? `${maxVeh} (${maxKm.toFixed(1)} km)` : 'N/A';
                      })()}
                    </span>
                  </div>
                  <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-lg">
                    🏆
                  </div>
                </div>
              </div>
            )}

            {/* Fleet Table */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider select-none">
                      <th 
                        onClick={() => handleFleetSort('route')}
                        className="px-6 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Route</span>
                          {fleetSortField === 'route' && (
                            <span className="text-[10px] text-blue-600 font-bold">{fleetSortOrder === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </div>
                      </th>
                      <th className="px-6 py-4">Bus / Vehicle</th>
                      <th className="px-6 py-4">Live Status</th>
                      <th className="px-6 py-4">Coordinates</th>
                      <th 
                        onClick={() => handleFleetSort('distance')}
                        className="px-6 py-4 cursor-pointer hover:bg-slate-100/50 transition-colors"
                      >
                        <div className="flex items-center gap-1">
                          <span>Distance Travelled</span>
                          {fleetSortField === 'distance' && (
                            <span className="text-[10px] text-blue-600 font-bold">{fleetSortOrder === 'asc' ? '▲' : '▼'}</span>
                          )}
                        </div>
                      </th>
                      <th className="px-6 py-4 text-right">Data Source</th>
                      <th className="px-4 py-4 w-10"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50 text-xs text-slate-700">
                    {(() => {
                      const filtered = vehicles.filter(v => {
                        if (!fleetSearchQuery) return true;
                        return v.name.toLowerCase().includes(fleetSearchQuery.toLowerCase()) ||
                               (v.routeId && v.routeId.toLowerCase().includes(fleetSearchQuery.toLowerCase())) ||
                               (v.routeName && v.routeName.toLowerCase().includes(fleetSearchQuery.toLowerCase()));
                      });

                      const sorted = [...filtered].sort((a, b) => {
                        if (fleetSortField === 'route') {
                          const valA = a.routeId || '';
                          const valB = b.routeId || '';
                          if (fleetSortOrder === 'asc') {
                            return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                          } else {
                            return valB.localeCompare(valA, undefined, { numeric: true, sensitivity: 'base' });
                          }
                        } else if (fleetSortField === 'distance') {
                          const kmA = (fleetKmValues[a.name] || { totalKm: 0 }).totalKm;
                          const kmB = (fleetKmValues[b.name] || { totalKm: 0 }).totalKm;
                          return fleetSortOrder === 'asc' ? kmA - kmB : kmB - kmA;
                        }
                        return 0;
                      });

                      if (sorted.length === 0) {
                        return (
                          <tr>
                            <td colSpan="7" className="px-6 py-12 text-center text-slate-400 italic">
                              No vehicles matched your search filter.
                            </td>
                          </tr>
                        );
                      }

                      return sorted.map((veh) => {
                        const isMoving = (veh.speed || 0) > 0;
                        const kmInfo = fleetKmValues[veh.name] || { totalKm: 0, isMock: false, loading: false };
                        const isExpanded = expandedFleetVehicle === veh.name;
                        const cacheKey = `${veh.name}_${fleetDateFrom}_${fleetDateTo}`;
                        const gfRows = geofenceData[cacheKey] || [];
                        const gfLoading = geofenceLoading[veh.name];
                        return (
                          <React.Fragment key={veh.name}>
                          <tr
                            onClick={() => toggleGeofenceAccordion(veh.name)}
                            className={`hover:bg-slate-50/50 transition-colors cursor-pointer select-none ${isExpanded ? 'bg-blue-50/40' : ''}`}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span className="text-slate-900 font-semibold">{veh.routeId || 'Unassigned'}</span>
                              <span className="text-[10px] text-slate-400 ml-1.5">{veh.routeName || 'No Route'}</span>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap text-slate-900 font-semibold">{veh.name}</td>
                            <td className="px-6 py-4">
                              <span className={`px-2 py-0.5 rounded text-[9px] font-medium uppercase ${isMoving ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-rose-50 text-rose-700 border-rose-200'}`}>
                                {isMoving ? 'Moving' : 'Stopped'}
                              </span>
                            </td>
                            <td className="px-6 py-4 font-mono text-slate-450">
                              {veh.latitude?.toFixed(4)}, {veh.longitude?.toFixed(4)}
                            </td>
                            <td className="px-6 py-4">
                              {kmInfo.loading ? (
                                <span className="flex items-center gap-1.5 text-[11px] text-slate-400">
                                  <Loader2 size={12} className="animate-spin text-blue-500" /> loading...
                                </span>
                              ) : (
                                <span className="text-sm font-semibold text-blue-700">
                                  {kmInfo.totalKm.toFixed(1)} km
                                </span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              {kmInfo.loading ? (
                                <span className="text-[10px] text-slate-400 italic">pending</span>
                              ) : (
                                <span className={`text-[10px] font-medium ${kmInfo.isMock ? 'text-amber-600' : 'text-blue-600'}`}>
                                  {kmInfo.isMock ? 'Demo Log' : 'Live GPS'}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-4 text-center">
                              <ChevronDown size={14} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`} />
                            </td>
                          </tr>
                          {isExpanded && (
                            <tr>
                              <td colSpan="7" className="px-6 py-0 bg-slate-50/80">
                                <div className="py-3">
                                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Geofence In / Out Report</p>
                                  {gfLoading ? (
                                    <div className="flex items-center gap-2 py-4 justify-center text-xs text-slate-400">
                                      <Loader2 size={14} className="animate-spin text-blue-500" /> Loading geofence data...
                                    </div>
                                  ) : gfRows.length === 0 ? (
                                    <p className="text-xs text-slate-400 italic py-3 text-center">No geofence records found for this date range.</p>
                                  ) : (
                                    <table className="w-full text-left border border-slate-200 rounded-lg overflow-hidden">
                                      <thead>
                                        <tr className="bg-slate-100 text-[9px] uppercase text-slate-400 font-bold tracking-wider">
                                          <th className="px-4 py-2">#</th>
                                          <th className="px-4 py-2">Geofence</th>
                                          <th className="px-4 py-2">Time In</th>
                                          <th className="px-4 py-2">Time Out</th>
                                          <th className="px-4 py-2">Duration</th>
                                          <th className="px-4 py-2">Mileage</th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-100 text-[11px] text-slate-700 font-semibold">
                                        {gfRows.map((row, idx) => (
                                          <tr key={idx} className="hover:bg-white/60">
                                            <td className="px-4 py-2 text-slate-400">{idx + 1}</td>
                                            <td className="px-4 py-2 font-bold text-slate-800">{row.geofence || row.Geofence || row.name || '—'}</td>
                                            <td className="px-4 py-2 text-emerald-700">{formatGeofenceTime(row.time_in || row['Time in'] || row.timeIn)}</td>
                                            <td className="px-4 py-2 text-rose-600">{formatGeofenceTime(row.time_out || row['Time out'] || row.timeOut)}</td>
                                            <td className="px-4 py-2">{row.duration_in || row['Duration in'] || row.duration || '—'}</td>
                                            <td className="px-4 py-2">{row.mileage || row.Mileage || '—'}</td>
                                          </tr>
                                        ))}
                                      </tbody>
                                    </table>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                          </React.Fragment>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        ) : activePageTab === 'destination' ? (
          <GpsFinalDestinationModal
            isInline
            campuses={campuses}
          />
        ) : null}
      </div>
    </Layout>
  );
}
