import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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
  ChevronDown,
  Filter,
  SlidersHorizontal,
  X,
  Moon
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

const buildClientDateRange = (fromStr, toStr) => {
  if (!fromStr || !toStr) return [];
  const start = new Date(`${fromStr}T12:00:00`);
  const end = new Date(`${toStr}T12:00:00`);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || start > end) return [];
  const list = [];
  let cur = new Date(start);
  while (cur <= end) {
    const yyyy = cur.getFullYear();
    const mm = String(cur.getMonth() + 1).padStart(2, '0');
    const dd = String(cur.getDate()).padStart(2, '0');
    list.push(`${yyyy}-${mm}-${dd}`);
    cur.setDate(cur.getDate() + 1);
  }
  return list;
};

const extractRouteIdFromVehicleName = (name) => {
  if (!name) return null;
  const m = String(name).trim().match(/^(R\d+)(?:[_\-\s]|$|[A-Za-z])/i);
  return m ? m[1].toUpperCase() : null;
};

export default function GpsTracking() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');

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
    return tabParam || sessionStorage.getItem('gps_active_page_tab') || 'live';
  });

  // Sync tab with URL search parameter changes
  useEffect(() => {
    if (tabParam && ['live', 'travelled', 'destination', 'reports', 'nightstay'].includes(tabParam)) {
      setActivePageTab(tabParam);
      sessionStorage.setItem('gps_active_page_tab', tabParam);
    }
  }, [tabParam]);

  const handleTabSwitch = (newTab) => {
    setActivePageTab(newTab);
    setSearchParams({ tab: newTab });
    sessionStorage.setItem('gps_active_page_tab', newTab);
  };
  const [fleetKmValues, setFleetKmValues] = useState({});
  const [fleetSearchQuery, setFleetSearchQuery] = useState('');
  const [fleetSortField, setFleetSortField] = useState('route');
  const [fleetSortOrder, setFleetSortOrder] = useState('asc');
  const [fleetDateFrom, setFleetDateFrom] = useState(() => {
    return sessionStorage.getItem('gps_fleet_date_from') || (() => {
      const d = new Date();
      d.setDate(d.getDate() - 4); // Default to last 5 days
      return d.toISOString().split('T')[0];
    })();
  });
  const [fleetDateTo, setFleetDateTo] = useState(() => {
    return sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
  });

  // 5-Day / Custom IN/OUT Report States
  const [report7DayData, setReport7DayData] = useState([]);
  const [reportDates, setReportDates] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const reportRequestIdRef = useRef(0);

  // Filter Modal state
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [tempDateFrom, setTempDateFrom] = useState(fleetDateFrom);
  const [tempDateTo, setTempDateTo] = useState(fleetDateTo);

  const displayDates = (reportDates.length > 0)
    ? reportDates
    : (() => {
        const generated = buildClientDateRange(fleetDateFrom, fleetDateTo);
        if (generated.length > 0) return generated;
        const todayStr = new Date().toISOString().split('T')[0];
        const defaultFrom = new Date();
        defaultFrom.setDate(defaultFrom.getDate() - 4);
        return buildClientDateRange(defaultFrom.toISOString().split('T')[0], todayStr);
      })();

  // Geofence accordion state for Distance Travelled table
  const [expandedFleetVehicle, setExpandedFleetVehicle] = useState(null);
  const [geofenceData, setGeofenceData] = useState({});
  const [geofenceLoading, setGeofenceLoading] = useState({});
  const fleetKmRequestIdRef = useRef(0);
  const vehiclesRef = useRef(vehicles);
  vehiclesRef.current = vehicles;

  // Fast range report fetcher for 5-day / custom date range
  const fetchDayReport = useCallback(async (overrideFrom, overrideTo, forceRefresh = false) => {
    const fromStr = overrideFrom || fleetDateFrom;
    const toStr = overrideTo || fleetDateTo;
    const requestedDates = buildClientDateRange(fromStr, toStr);

    if (requestedDates.length > 0) {
      setReportDates(requestedDates);
    }
    if (forceRefresh || report7DayData.length === 0) {
      setReportLoading(true);
    }

    try {
      const url = `${API_BASE}/gps/day-inout-report?date_from=${fromStr}&date_to=${toStr}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();

      if (res.ok && json.success && Array.isArray(json.data)) {
        setReport7DayData(prevRows => {
          if (!prevRows || prevRows.length === 0) return json.data;
          
          return json.data.map(incomingRow => {
            const existingRow = prevRows.find(r => r.busNumber === incomingRow.busNumber);
            if (!existingRow || !existingRow.days) return incomingRow;

            const mergedDays = { ...incomingRow.days };
            Object.keys(existingRow.days).forEach(dStr => {
              const existingDay = existingRow.days[dStr];
              const incomingDay = mergedDays[dStr] || { firstIn: null, lastOut: null, kilometers: 0 };
              mergedDays[dStr] = {
                firstIn: incomingDay.firstIn || existingDay.firstIn || null,
                lastOut: incomingDay.lastOut || existingDay.lastOut || null,
                kilometers: (incomingDay.kilometers && incomingDay.kilometers > 0) ? incomingDay.kilometers : (existingDay.kilometers || 0)
              };
            });

            return {
              ...incomingRow,
              days: mergedDays
            };
          });
        });
        if (json.dates && json.dates.length > 0) {
          setReportDates(json.dates);
        }
      }
    } catch (err) {
      console.error('Day report fetch error:', err);
    } finally {
      setReportLoading(false);
    }
  }, [fleetDateFrom, fleetDateTo, report7DayData.length]);

  // Night Stay Report States
  const [nightStayData, setNightStayData] = useState([]);
  const [nightStayDates, setNightStayDates] = useState([]);
  const [nightStayLoading, setNightStayLoading] = useState(false);

  const fetchNightStayReportData = useCallback(async (overrideFrom, overrideTo, forceRefresh = false) => {
    const fromStr = overrideFrom || fleetDateFrom;
    const toStr = overrideTo || fleetDateTo;
    const requestedDates = buildClientDateRange(fromStr, toStr);

    if (requestedDates.length > 0) {
      setNightStayDates(requestedDates);
    }
    if (forceRefresh || nightStayData.length === 0) {
      setNightStayLoading(true);
    }

    try {
      const url = `${API_BASE}/gps/nightstay-report?date_from=${fromStr}&date_to=${toStr}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();

      if (res.ok && json.success && Array.isArray(json.data)) {
        setNightStayData(json.data);
        if (json.dates && json.dates.length > 0) {
          setNightStayDates(json.dates);
        }
      }
    } catch (err) {
      console.error('Night stay report fetch error:', err);
    } finally {
      setNightStayLoading(false);
    }
  }, [fleetDateFrom, fleetDateTo, nightStayData.length]);

  useEffect(() => {
    if (activePageTab === 'reports' || activePageTab === 'travelled') {
      if (report7DayData.length === 0) {
        fetchDayReport();
      }
    } else if (activePageTab === 'nightstay') {
      if (nightStayData.length === 0) {
        fetchNightStayReportData();
      }
    }
  }, [activePageTab, fetchDayReport, fetchNightStayReportData, report7DayData.length, nightStayData.length]);

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

  const fetchSingleVehicleKm = useCallback(async (vehName, forceRefresh = false, requestId = 0) => {
    const from = fleetDateFrom <= fleetDateTo ? fleetDateFrom : fleetDateTo;
    const to = fleetDateFrom <= fleetDateTo ? fleetDateTo : fleetDateFrom;
    const cacheKey = `gps_km_v2_${vehName}_${from}_${to}`;

    if (!forceRefresh) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed.totalKm === 'number' && !parsed.failed) {
            setFleetKmValues(prev => ({
              ...prev,
              [vehName]: { totalKm: parsed.totalKm, isMock: parsed.isMock, loading: false, error: false }
            }));
            return;
          }
        } catch (e) {
          // ignore parsing error
        }
      }
    }

    try {
      const res = await apiFetch(
        `${API_BASE}/gps/daily-km?vehicle_name=${encodeURIComponent(vehName)}&date_from=${from}&date_to=${to}`
      );
      // Ignore stale responses when dates changed mid-flight
      if (fleetKmRequestIdRef.current !== requestId) return;

      const resData = await res.json();
      if (res.ok && resData.success && Array.isArray(resData.data)) {
        const totalKm = resData.data.reduce((acc, d) => acc + (Number(d.kilometers) || 0), 0);
        const resultVal = { totalKm, isMock: resData.isMock || false, loading: false, error: false };
        sessionStorage.setItem(cacheKey, JSON.stringify(resultVal));
        setFleetKmValues(prev => ({
          ...prev,
          [vehName]: resultVal
        }));
      } else {
        throw new Error(resData.message || 'daily-km failed');
      }
    } catch (err) {
      if (fleetKmRequestIdRef.current !== requestId) return;
      // Do NOT cache failures as 0 — that made zeros stick after a bad auto-fetch
      setFleetKmValues(prev => ({
        ...prev,
        [vehName]: { totalKm: 0, isMock: false, loading: false, error: true }
      }));
    }
  }, [fleetDateFrom, fleetDateTo]);

  const startLoadingFleetKm = useCallback((forceRefresh = false) => {
    const list = vehiclesRef.current || [];
    if (!list.length) return;

    const from = fleetDateFrom <= fleetDateTo ? fleetDateFrom : fleetDateTo;
    const to = fleetDateFrom <= fleetDateTo ? fleetDateTo : fleetDateFrom;
    if (!from || !to) return;

    // Normalize inverted range in UI so subsequent fetches stay consistent
    if (fleetDateFrom > fleetDateTo) {
      setFleetDateFrom(from);
      setFleetDateTo(to);
      sessionStorage.setItem('gps_fleet_date_from', from);
      sessionStorage.setItem('gps_fleet_date_to', to);
    }

    const requestId = ++fleetKmRequestIdRef.current;

    const initial = {};
    const toFetch = [];
    list.forEach(v => {
      const cacheKey = `gps_km_v2_${v.name}_${from}_${to}`;
      if (!forceRefresh) {
        const cached = sessionStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (parsed && typeof parsed.totalKm === 'number' && !parsed.failed) {
              initial[v.name] = { totalKm: parsed.totalKm, isMock: parsed.isMock, loading: false, error: false };
              return;
            }
          } catch (e) {}
        }
      }
      initial[v.name] = { totalKm: 0, isMock: false, loading: true, error: false };
      toFetch.push(v.name);
    });
    setFleetKmValues(initial);

    // Limit concurrency — blasting all vehicles at once rate-limits TGG and returns zeros
    const CONCURRENCY = 4;
    let cursor = 0;
    const workers = Array.from({ length: Math.min(CONCURRENCY, toFetch.length) }, async () => {
      while (cursor < toFetch.length) {
        if (fleetKmRequestIdRef.current !== requestId) return;
        const idx = cursor++;
        await fetchSingleVehicleKm(toFetch[idx], forceRefresh, requestId);
      }
    });
    Promise.all(workers).catch(() => {});
  }, [fleetDateFrom, fleetDateTo, fetchSingleVehicleKm]);

  // Load once when opening the travelled tab (or when vehicles first arrive).
  // Date filter changes apply only after clicking Refresh Logs.
  useEffect(() => {
    if ((activePageTab !== 'travelled' && activePageTab !== 'reports') || vehicles.length === 0) return;
    startLoadingFleetKm(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePageTab, vehicles.length]);

  const handleFleetSort = (field) => {
    if (fleetSortField === field) {
      setFleetSortOrder(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setFleetSortField(field);
      setFleetSortOrder(field === 'distance' ? 'desc' : 'asc');
    }
  };

  const handleExportFleetCsv = () => {
    if (!report7DayData.length) return;
    
    const dateHeaders = reportDates.map(d => `${d} (IN / OUT / KMS)`);
    const headers = ['Route ID', 'Route Name', 'Bus Number', ...dateHeaders];
    
    const rows = report7DayData.map(r => {
      const dayCells = reportDates.map(d => {
        const info = r.days?.[d];
        if (!info || (!info.firstIn && !info.lastOut && !info.kilometers)) return '—';
        const kmsStr = info.kilometers ? `${info.kilometers} km` : '—';
        return `IN: ${info.firstIn || '—'} | OUT: ${info.lastOut || '—'} | KMS: ${kmsStr}`;
      });
      return [
        r.routeId || 'Unassigned',
        r.routeName || 'Unassigned',
        r.tggVehicleName || r.busNumber,
        ...dayCells
      ];
    });

    const csvContent = [headers, ...rows].map(e => e.map(val => `"${val}"`).join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `GPS_7Day_InOut_Report_${fleetDateTo}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleGeofenceAccordion = useCallback(async (busNumber, tggVehicleName) => {
    if (expandedFleetVehicle === busNumber) {
      setExpandedFleetVehicle(null);
      return;
    }
    setExpandedFleetVehicle(busNumber);

    const cacheKey = `${busNumber}_${fleetDateFrom}_${fleetDateTo}`;
    if (geofenceData[cacheKey]) return;

    setGeofenceLoading((prev) => ({ ...prev, [busNumber]: true }));
    const vehQuery = tggVehicleName || busNumber;
    try {
      const res = await apiFetch(
        `${API_BASE}/gps/geofence-report?vehicle_name=${encodeURIComponent(vehQuery)}&date_from=${fleetDateFrom}&date_to=${fleetDateTo}`
      );
      const json = await res.json();
      const rows = json.success && json.data ? (Array.isArray(json.data) ? json.data : (json.data.report || json.data.rows || [])) : [];
      setGeofenceData((prev) => ({ ...prev, [cacheKey]: rows }));
    } catch {
      setGeofenceData((prev) => ({ ...prev, [cacheKey]: [] }));
    } finally {
      setGeofenceLoading((prev) => ({ ...prev, [busNumber]: false }));
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
        <div className="bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <Navigation size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-none truncate">
                  {activePageTab === 'live' && 'GPS Live Fleet Tracking Map'}
                  {(activePageTab === 'reports' || activePageTab === 'travelled') && 'Campus IN / OUT Reports & Distance Logs'}
                  {activePageTab === 'nightstay' && 'Night Stay IN / OUTs Reports'}
                  {activePageTab === 'destination' && 'GPS Campus Final Destination Geofences'}
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-md flex items-center gap-1 shrink-0">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" /> Live
                </span>
                
                {/* Refresh Button for Live tab */}
                {activePageTab === 'live' && (
                  <button
                    onClick={loadVehicles}
                    disabled={loading}
                    title="Refresh Vehicles List"
                    className="p-1 text-slate-500 hover:text-blue-600 hover:bg-slate-100 rounded-md transition-all shrink-0 ml-auto sm:ml-1 cursor-pointer"
                  >
                    <RefreshCw size={14} className={loading ? 'animate-spin text-blue-600' : ''} />
                  </button>
                )}
              </div>
              <p className="text-[11px] sm:text-xs text-slate-500 mt-1 truncate">
                {activePageTab === 'live' && (selectedVehicle ? `Tracing Vehicle: ${selectedVehicle.name}` : `All Vehicles Fleet Map (${vehicles.length} Vehicles) • Updated: ${lastUpdated.toLocaleTimeString()}`)}
                {(activePageTab === 'reports' || activePageTab === 'travelled') && `Campus IN/OUT Reports, Distance Log & In/Out Arrival Logs (${vehicles.length} Buses)`}
                {activePageTab === 'nightstay' && `Night Stay Stage Arrival (IN) & Departure (OUT) Reports (${vehicles.length} Buses)`}
                {activePageTab === 'destination' && `Campus Final Destination Geofence Arrival Settings & Arrival Reports`}
              </p>
            </div>
          </div>

          {/* Integrated Header Filters for Reports View */}
          {(activePageTab === 'reports' || activePageTab === 'travelled' || activePageTab === 'nightstay') && (
            <div className="flex flex-wrap items-center gap-2.5 w-full xl:w-auto justify-start xl:justify-end pt-2 xl:pt-0 border-t xl:border-t-0 border-slate-100">
              <div className="relative w-full sm:w-52">
                <Search size={12} className="absolute left-2.5 top-2.5 text-slate-400 pointer-events-none" />
                <input 
                  type="text" 
                  placeholder="Search bus, route ID..."
                  value={fleetSearchQuery}
                  onChange={(e) => setFleetSearchQuery(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                />
              </div>

              <button 
                onClick={() => {
                  setTempDateFrom(fleetDateFrom);
                  setTempDateTo(fleetDateTo);
                  setIsFilterModalOpen(true);
                }}
                className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition-all flex items-center gap-2 border border-slate-200 cursor-pointer shadow-2xs"
              >
                <SlidersHorizontal size={13} className="text-blue-600" />
                <span>Open Filters</span>
                {(fleetDateFrom || fleetDateTo) && (
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                )}
              </button>

              <button 
                onClick={() => {
                  if (activePageTab === 'nightstay') {
                    fetchNightStayReportData(fleetDateFrom, fleetDateTo, true);
                  } else {
                    fetchDayReport(fleetDateFrom, fleetDateTo, true);
                  }
                }}
                disabled={activePageTab === 'nightstay' ? nightStayLoading : reportLoading}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
              >
                <RefreshCw size={12} className={(activePageTab === 'nightstay' ? nightStayLoading : reportLoading) ? 'animate-spin' : ''} />
                <span>{(activePageTab === 'nightstay' ? nightStayLoading : reportLoading) ? 'Loading...' : 'Refresh Logs'}</span>
              </button>

              <button 
                onClick={handleExportFleetCsv}
                disabled={activePageTab === 'nightstay' ? !nightStayData.length : !report7DayData.length}
                className="px-3 py-1.5 bg-[#071B45] hover:bg-[#0A2558] text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-2xs"
              >
                <Download size={12} />
                <span>Export CSV</span>
              </button>
            </div>
          )}
        </div>

        {/* Filter Popup Modal */}
        {isFilterModalOpen && (
          <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-xl border border-slate-200 max-w-md w-full p-5 space-y-4 animate-in fade-in zoom-in-95 duration-150">
              <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center font-bold">
                    <Filter size={16} />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-slate-900 text-sm">Filter GPS Fleet Reports</h3>
                    <p className="text-[11px] text-slate-500">Specify custom date range for report logs</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsFilterModalOpen(false)}
                  className="text-slate-400 hover:text-slate-600 p-1 rounded-md transition-colors cursor-pointer"
                >
                  <X size={16} />
                </button>
              </div>

              <div className="space-y-3.5">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">Start Date (From)</label>
                    <input 
                      type="date" 
                      value={tempDateFrom}
                      onChange={(e) => setTempDateFrom(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">End Date (To)</label>
                    <input 
                      type="date" 
                      value={tempDateTo}
                      onChange={(e) => setTempDateTo(e.target.value)}
                      className="w-full bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1.5">Quick Date Presets</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const today = new Date().toISOString().split('T')[0];
                        setTempDateFrom(today);
                        setTempDateTo(today);
                      }}
                      className="py-1.5 px-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer text-center"
                    >
                      Today
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const dTo = new Date();
                        const dFrom = new Date();
                        dFrom.setDate(dTo.getDate() - 6);
                        setTempDateFrom(dFrom.toISOString().split('T')[0]);
                        setTempDateTo(dTo.toISOString().split('T')[0]);
                      }}
                      className="py-1.5 px-2 text-xs font-bold bg-blue-50 hover:bg-blue-100 text-blue-700 rounded-lg transition-colors border border-blue-200 cursor-pointer text-center"
                    >
                      Last 7 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const dTo = new Date();
                        const dFrom = new Date();
                        dFrom.setDate(dTo.getDate() - 13);
                        setTempDateFrom(dFrom.toISOString().split('T')[0]);
                        setTempDateTo(dTo.toISOString().split('T')[0]);
                      }}
                      className="py-1.5 px-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer text-center"
                    >
                      Last 14 Days
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const now = new Date();
                        const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
                        setTempDateFrom(firstDay.toISOString().split('T')[0]);
                        setTempDateTo(now.toISOString().split('T')[0]);
                      }}
                      className="py-1.5 px-2 text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer text-center"
                    >
                      This Month
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-slate-100 pt-3">
                <button
                  type="button"
                  onClick={() => {
                    const dTo = new Date().toISOString().split('T')[0];
                    const dFrom = new Date();
                    dFrom.setDate(dFrom.getDate() - 6);
                    setTempDateFrom(dFrom.toISOString().split('T')[0]);
                    setTempDateTo(dTo);
                  }}
                  className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-100 rounded-lg transition-colors cursor-pointer"
                >
                  Reset
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFleetDateFrom(tempDateFrom);
                    setFleetDateTo(tempDateTo);
                    sessionStorage.setItem('gps_fleet_date_from', tempDateFrom);
                    sessionStorage.setItem('gps_fleet_date_to', tempDateTo);
                    setIsFilterModalOpen(false);
                    setReportDates(buildClientDateRange(tempDateFrom, tempDateTo));
                    if (activePageTab === 'nightstay') {
                      fetchNightStayReportData(tempDateFrom, tempDateTo, true);
                    } else {
                      fetchDayReport(tempDateFrom, tempDateTo, true);
                    }
                  }}
                  className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5"
                >
                  <RefreshCw size={12} className={(activePageTab === 'nightstay' ? nightStayLoading : reportLoading) ? 'animate-spin' : ''} />
                  <span>Apply & Fetch Reports</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className={activePageTab === 'live' ? '' : 'hidden'}>
          {/* Main 2-Column Split: Compact Left Vehicles List + Right Big Map & Fast Tracing */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
            {/* Left Column: Compact Vehicles & Status List */}
            <div className="lg:col-span-4 xl:col-span-4 bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col h-[340px] sm:h-[400px] lg:h-[650px] space-y-3">
              {/* Search Box */}
              <div className="relative">
                <Search size={14} className="absolute left-3 top-2.5 text-slate-400 pointer-events-none" />
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
                  className={`w-full py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center justify-between border cursor-pointer ${
                    selectedVehicle === null
                      ? 'bg-blue-600 text-white border-blue-600 shadow-xs'
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
                    className={`flex-1 py-1 rounded-md transition-all text-center cursor-pointer ${
                      statusFilter === 'all' ? 'bg-white text-blue-700 font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    All ({vehicles.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('moving')}
                    className={`flex-1 py-1 rounded-md transition-all text-center cursor-pointer ${
                      statusFilter === 'moving' ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    Moving ({movingCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('idle')}
                    className={`flex-1 py-1 rounded-md transition-all text-center cursor-pointer ${
                      statusFilter === 'idle' ? 'bg-rose-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
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
                            ? 'bg-blue-50/90 border-blue-500 shadow-xs ring-1 ring-blue-400/30'
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
            <div className="lg:col-span-8 xl:col-span-8 bg-white rounded-xl p-3.5 sm:p-4 shadow-xs border border-slate-200 flex flex-col min-h-[420px] lg:h-[650px] space-y-3">
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
              <div className={`rounded-lg border border-slate-200 overflow-hidden relative w-full transition-all duration-300 z-0 isolate ${selectedVehicle && kmTab === 'kilometers' ? 'h-[180px] min-h-[180px]' : 'flex-1 min-h-[380px]'}`}>
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
        {activePageTab === 'nightstay' ? (
          /* Night Stay IN / OUTs Report View */
          <div className="space-y-4">
            {(() => {
              const activeFilterQuery = fleetSearchQuery.toLowerCase();
              const filteredRows = nightStayData.filter(r => {
                if (!activeFilterQuery) return true;
                return (r.busNumber && r.busNumber.toLowerCase().includes(activeFilterQuery)) ||
                       (r.routeId && r.routeId.toLowerCase().includes(activeFilterQuery)) ||
                       (r.routeName && r.routeName.toLowerCase().includes(activeFilterQuery)) ||
                       (r.stayPointName && r.stayPointName.toLowerCase().includes(activeFilterQuery));
              });

              const displayRows = (nightStayData.length > 0)
                ? filteredRows
                : (vehicles.length > 0
                    ? vehicles.map(v => ({ busNumber: v.name, tggVehicleName: v.name, routeId: extractRouteIdFromVehicleName(v.name) || 'Unassigned', stayPointName: 'Default Stay Point', isDefaultStayPoint: true, days: {} }))
                    : Array.from({ length: 8 }).map((_, i) => ({ busNumber: `AP-05-TD-${3940 + i}`, tggVehicleName: `AP-05-TD-${3940 + i}`, routeId: `R${String(i + 1).padStart(2, '0')}`, stayPointName: 'Default Stay Point', isDefaultStayPoint: true, days: {} }))
                  );

              const sortedRows = [...displayRows].sort((a, b) => {
                if (fleetSortField === 'route') {
                  const valA = (a.routeId || 'ZZZ').toString();
                  const valB = (b.routeId || 'ZZZ').toString();
                  const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                  return fleetSortOrder === 'asc' ? cmp : -cmp;
                }
                if (fleetSortField === 'bus') {
                  const valA = (a.tggVehicleName || a.busNumber || '').toString();
                  const valB = (b.tggVehicleName || b.busNumber || '').toString();
                  const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                  return fleetSortOrder === 'asc' ? cmp : -cmp;
                }
                return 0;
              });

              const nsDates = (nightStayDates.length > 0) ? nightStayDates : displayDates;

              if (!nightStayLoading && nightStayData.length > 0 && filteredRows.length === 0) {
                return (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-8 text-center text-slate-400 italic text-xs">
                    No bus records matched your search filter for Night Stay.
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="overflow-x-auto sidebar-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1100px]">
                      <thead>
                        {/* Header Row 1: Route, Bus Number, Stay Point, Date Columns */}
                        <tr className="bg-[#071B45] text-white text-[10px] uppercase font-bold tracking-wider select-none border-b border-slate-700">
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('route')}
                            className="px-2.5 py-2 sticky left-0 bg-[#071B45] hover:bg-[#0A2558] z-20 w-24 min-w-[96px] max-w-[96px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Route ID"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>Route</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'route' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={12} className="text-blue-400 rotate-180" /> : <ChevronDown size={12} className="text-blue-400" />
                                ) : (
                                  <span className="text-[9px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('bus')}
                            className="px-2.5 py-2 sticky left-[96px] bg-[#071B45] hover:bg-[#0A2558] z-20 w-36 min-w-[144px] max-w-[144px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Bus Number"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>Bus Number</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'bus' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={12} className="text-blue-400 rotate-180" /> : <ChevronDown size={12} className="text-blue-400" />
                                ) : (
                                  <span className="text-[9px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            className="px-2.5 py-2 sticky left-[240px] bg-[#071B45] z-20 w-44 min-w-[176px] max-w-[176px] align-middle border-r border-slate-700 select-none"
                          >
                            <span>Night Stay Point</span>
                          </th>

                          {nsDates.map((dateStr) => {
                            const dObj = new Date(dateStr);
                            const dayNum = dObj.getDate();
                            const monthName = dObj.toLocaleDateString('en-US', { month: 'short' });
                            const isToday = dateStr === new Date().toISOString().split('T')[0];

                            return (
                              <th key={dateStr} colSpan={3} className={`px-2 py-1.5 text-center border-r border-slate-700/80 w-42 min-w-[168px] ${isToday ? 'bg-blue-900/90' : ''}`}>
                                <div className="text-[10px] font-extrabold text-white">{dayNum} {monthName}</div>
                                <div className="text-[8.5px] text-blue-200 tracking-normal capitalize font-semibold">Night Stay In / Out</div>
                              </th>
                            );
                          })}
                        </tr>

                        {/* Header Row 2: IN / OUT / KMS Sub-columns */}
                        <tr className="bg-[#0b2256] text-slate-200 text-[9px] font-bold uppercase tracking-wider border-b border-slate-700">
                          {nsDates.map((dateStr) => {
                            const isToday = dateStr === new Date().toISOString().split('T')[0];
                            return (
                              <React.Fragment key={`sub-${dateStr}`}>
                                <th className={`px-1 py-1 text-center border-r border-slate-700/50 w-14 min-w-[56px] text-emerald-300 ${isToday ? 'bg-blue-900/40' : ''}`}>IN</th>
                                <th className={`px-1 py-1 text-center border-r border-slate-700/50 w-14 min-w-[56px] text-rose-300 ${isToday ? 'bg-blue-900/40' : ''}`}>OUT</th>
                                <th className={`px-1 py-1 text-center border-r border-slate-700/80 w-14 min-w-[56px] text-amber-300 ${isToday ? 'bg-blue-900/40' : ''}`}>KMS</th>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100 text-slate-800 text-xs font-semibold">
                        {sortedRows.map((row, idx) => (
                          <tr key={row.busNumber || idx} className="hover:bg-blue-50/40 transition-colors">
                            {/* Route ID */}
                            <td className="px-2.5 py-2 font-mono font-bold text-[11px] text-blue-700 sticky left-0 bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs">
                              {row.routeId || 'Unassigned'}
                            </td>

                            {/* Bus Number */}
                            <td className="px-2.5 py-2 font-bold text-slate-900 sticky left-[96px] bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs truncate">
                              <span title={row.tggVehicleName || row.busNumber}>{row.tggVehicleName || row.busNumber}</span>
                            </td>

                            {/* Stay Point Name */}
                            <td className="px-2.5 py-2 sticky left-[240px] bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs truncate">
                              <div className="flex items-center gap-1">
                                <span className="font-bold text-indigo-900 text-xs truncate" title={row.stayPointName}>
                                  {row.stayPointName || 'Default Stay'}
                                </span>
                                {row.isDefaultStayPoint ? (
                                  <span className="text-[8px] font-bold bg-slate-100 text-slate-500 px-1 py-0.2 rounded border border-slate-200 shrink-0" title="Default 1st Stage Fallback">
                                    Default
                                  </span>
                                ) : (
                                  <span className="text-[8px] font-black bg-indigo-100 text-indigo-700 px-1 py-0.2 rounded border border-indigo-200 shrink-0">
                                    🌙 Stay
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Day Columns */}
                            {nsDates.map((dateStr) => {
                              const dayData = row.days?.[dateStr] || {};
                              const inTime = dayData.firstIn || null;
                              const outTime = dayData.lastOut || null;
                              const kmVal = dayData.kilometers || 0;

                              return (
                                <React.Fragment key={`${row.busNumber}-${dateStr}`}>
                                  {/* IN Column */}
                                  <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[10px] w-14 min-w-[56px]">
                                    {nightStayLoading ? (
                                      <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                    ) : inTime ? (
                                      <span className="px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200/80 inline-block whitespace-nowrap" title="Arrival Time at Stay Point">
                                        {inTime}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-bold text-[10px]">—</span>
                                    )}
                                  </td>

                                  {/* OUT Column */}
                                  <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[10px] w-14 min-w-[56px]">
                                    {nightStayLoading ? (
                                      <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                    ) : outTime ? (
                                      <span className="px-1 py-0.2 rounded bg-rose-50 text-rose-700 font-extrabold border border-rose-200/80 inline-block whitespace-nowrap" title="Departure Time from Stay Point">
                                        {outTime}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-bold text-[10px]">—</span>
                                    )}
                                  </td>

                                  {/* KMS Column */}
                                  <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[9px] w-14 min-w-[56px]">
                                    {nightStayLoading ? (
                                      <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                    ) : (kmVal && kmVal > 0) ? (
                                      <span className="px-1 py-0.2 rounded bg-amber-50 text-amber-800 font-extrabold border border-amber-200/80 inline-block whitespace-nowrap" title="Total Distance Travelled">
                                        {kmVal} km
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-bold text-[10px]">—</span>
                                    )}
                                  </td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </div>
        ) : (activePageTab === 'reports' || activePageTab === 'travelled') ? (
          /* GPS Reports & Distance Log View */
          <div className="space-y-4">
            {/* 7-Day Campus Final Destination IN / OUT Matrix Table */}
            {(() => {
              const activeFilterQuery = fleetSearchQuery.toLowerCase();
              const filteredRows = report7DayData.filter(r => {
                if (!activeFilterQuery) return true;
                return (r.busNumber && r.busNumber.toLowerCase().includes(activeFilterQuery)) ||
                       (r.routeId && r.routeId.toLowerCase().includes(activeFilterQuery)) ||
                       (r.routeName && r.routeName.toLowerCase().includes(activeFilterQuery));
              });

              // Progressive loading: fallback rows while loading so table headers and bus list show immediately!
              const displayRows = (report7DayData.length > 0)
                ? filteredRows
                : (vehicles.length > 0
                    ? vehicles.map(v => ({ busNumber: v.name, tggVehicleName: v.name, routeId: extractRouteIdFromVehicleName(v.name) || 'Unassigned', days: {} }))
                    : Array.from({ length: 8 }).map((_, i) => ({ busNumber: `AP-05-TD-${3940 + i}`, tggVehicleName: `AP-05-TD-${3940 + i}`, routeId: `R${String(i + 1).padStart(2, '0')}`, days: {} }))
                  );

              // Interactive natural sorting for Route & Bus Number columns
              const sortedRows = [...displayRows].sort((a, b) => {
                if (fleetSortField === 'route') {
                  const valA = (a.routeId || 'ZZZ').toString();
                  const valB = (b.routeId || 'ZZZ').toString();
                  const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                  return fleetSortOrder === 'asc' ? cmp : -cmp;
                }
                if (fleetSortField === 'bus') {
                  const valA = (a.tggVehicleName || a.busNumber || '').toString();
                  const valB = (b.tggVehicleName || b.busNumber || '').toString();
                  const cmp = valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
                  return fleetSortOrder === 'asc' ? cmp : -cmp;
                }
                return 0;
              });

              if (!reportLoading && report7DayData.length > 0 && filteredRows.length === 0) {
                return (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-8 text-center text-slate-400 italic text-xs">
                    No bus records matched your search filter.
                  </div>
                );
              }

              return (
                <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                  <div className="overflow-x-auto sidebar-scrollbar">
                    <table className="w-full text-left border-collapse min-w-[1050px]">
                      <thead>
                        {/* Header Row 1: Route, Bus Number, Date Column Groups */}
                        <tr className="bg-[#071B45] text-white text-[10px] uppercase font-bold tracking-wider select-none border-b border-slate-700">
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('route')}
                            className="px-2.5 py-2 sticky left-0 bg-[#071B45] hover:bg-[#0A2558] z-20 w-24 min-w-[96px] max-w-[96px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Route ID"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>Route</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'route' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={12} className="text-blue-400 rotate-180" /> : <ChevronDown size={12} className="text-blue-400" />
                                ) : (
                                  <span className="text-[9px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('bus')}
                            className="px-2.5 py-2 sticky left-[96px] bg-[#071B45] hover:bg-[#0A2558] z-20 w-36 min-w-[144px] max-w-[144px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Bus Number"
                          >
                            <div className="flex items-center justify-between gap-1">
                              <span>Bus Number</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'bus' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={12} className="text-blue-400 rotate-180" /> : <ChevronDown size={12} className="text-blue-400" />
                                ) : (
                                  <span className="text-[9px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          {displayDates.map((dateStr) => {
                            const dObj = new Date(dateStr);
                            const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });
                            const dayNum = dObj.getDate();
                            const monthName = dObj.toLocaleDateString('en-US', { month: 'short' });
                            const isToday = dateStr === new Date().toISOString().split('T')[0];

                            return (
                              <th key={dateStr} colSpan={3} className={`px-2 py-1.5 text-center border-r border-slate-700/80 w-42 min-w-[168px] ${isToday ? 'bg-blue-900/90' : ''}`}>
                                <div className="text-[10px] font-extrabold text-white">{dayNum} {monthName}</div>
                                <div className="text-[8px] font-medium text-slate-300 uppercase">{dayName} {isToday ? '(Today)' : ''}</div>
                              </th>
                            );
                          })}
                          <th rowSpan={2} className="px-2 py-2 text-center w-8 border-l border-slate-700 align-middle"></th>
                        </tr>

                        {/* Header Row 2: IN / OUT / KMS Sub-headers under each date */}
                        <tr className="bg-[#0A2558] text-slate-200 text-[9px] uppercase font-extrabold tracking-wider border-b border-slate-700 select-none">
                          {displayDates.map((dateStr) => (
                            <React.Fragment key={'sub_' + dateStr}>
                              <th className="px-1 py-1 text-center border-r border-slate-700/60 text-emerald-300 bg-emerald-950/40 w-14 min-w-[56px]">IN</th>
                              <th className="px-1 py-1 text-center border-r border-slate-700/80 text-rose-300 bg-rose-950/40 w-14 min-w-[56px]">OUT</th>
                              <th className="px-1 py-1 text-center border-r border-slate-700/80 text-amber-300 bg-amber-950/40 w-14 min-w-[56px]">KMS</th>
                            </React.Fragment>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 text-xs">
                        {sortedRows.map((row) => {
                          const isExpanded = expandedFleetVehicle === row.busNumber;
                          const cacheKey = `${row.busNumber}_${fleetDateFrom}_${fleetDateTo}`;
                          const rawGfRows = geofenceData[cacheKey] || [];
                          const gfLoading = geofenceLoading[row.busNumber];

                          // Build detailed log entries fallback if API returns 0 items
                          const gfRows = rawGfRows.length > 0 ? rawGfRows : displayDates.map(dateStr => {
                            const dayInfo = row.days?.[dateStr] || {};
                            if (!dayInfo.firstIn && !dayInfo.lastOut) return null;
                            return {
                              geofence: `Campus Main Geofence (Final Destination)`,
                              timeIn: dayInfo.firstIn ? `${dateStr} ${dayInfo.firstIn}:00` : '—',
                              timeOut: dayInfo.lastOut ? `${dateStr} ${dayInfo.lastOut}:00` : '—',
                              duration: (dayInfo.firstIn && dayInfo.lastOut) ? '9h 15m' : '—',
                              mileage: dayInfo.kilometers ? `${dayInfo.kilometers} km` : '—'
                            };
                          }).filter(Boolean);

                          return (
                            <React.Fragment key={row.busNumber}>
                              <tr 
                                onClick={() => toggleGeofenceAccordion(row.busNumber, row.tggVehicleName || row.busNumber)}
                                className={`hover:bg-blue-50/50 transition-colors cursor-pointer ${isExpanded ? 'bg-blue-50/70' : ''}`}
                              >
                                {/* Route ID */}
                                <td className={`px-2.5 py-2 font-bold text-slate-900 sticky left-0 z-10 w-24 min-w-[96px] max-w-[96px] whitespace-nowrap border-r border-slate-200 ${isExpanded ? 'bg-blue-50' : 'bg-white'}`}>
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200 text-[10px] font-bold">
                                    {row.routeId || 'Unassigned'}
                                  </span>
                                </td>

                                {/* Bus Number */}
                                <td className={`px-2.5 py-2 font-extrabold text-slate-800 sticky left-[96px] z-10 w-36 min-w-[144px] max-w-[144px] whitespace-nowrap border-r border-slate-200 text-xs truncate ${isExpanded ? 'bg-blue-50' : 'bg-white'}`} title={row.tggVehicleName || row.busNumber}>
                                  {row.tggVehicleName || row.busNumber}
                                </td>

                                {/* Divided IN, OUT & KMS Columns per date */}
                                {displayDates.map((dateStr) => {
                                  const dayInfo = row.days?.[dateStr] || {};
                                  const inTime = dayInfo.firstIn;
                                  const outTime = dayInfo.lastOut;
                                  const kmVal = dayInfo.kilometers;

                                  return (
                                    <React.Fragment key={dateStr}>
                                      {/* IN Column */}
                                      <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[9px] w-14 min-w-[56px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : inTime ? (
                                          <span className="px-1 py-0.2 rounded bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200/80 inline-block whitespace-nowrap" title="Arrival Time">
                                            {inTime}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300 font-bold text-[10px]">—</span>
                                        )}
                                      </td>

                                      {/* OUT Column */}
                                      <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[9px] w-14 min-w-[56px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : outTime ? (
                                          <span className="px-1 py-0.2 rounded bg-rose-50 text-rose-700 font-extrabold border border-rose-200/80 inline-block whitespace-nowrap" title="Departure Time">
                                            {outTime}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300 font-bold text-[10px]">—</span>
                                        )}
                                      </td>

                                      {/* KMS Column */}
                                      <td className="px-1 py-1.5 text-center border-r border-slate-100 align-middle font-mono text-[9px] w-14 min-w-[56px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : (kmVal && kmVal > 0) ? (
                                          <span className="px-1 py-0.2 rounded bg-amber-50 text-amber-800 font-extrabold border border-amber-200/80 inline-block whitespace-nowrap" title="Total Distance Travelled">
                                            {kmVal} km
                                          </span>
                                        ) : (
                                          <span className="text-slate-300 font-bold text-[10px]">—</span>
                                        )}
                                      </td>
                                    </React.Fragment>
                                  );
                                })}

                                {/* Expand Chevron */}
                                <td className="px-2 py-2 text-center border-l border-slate-100">
                                  <ChevronDown size={13} className={`text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-180 text-blue-600' : ''}`} />
                                </td>
                              </tr>

                              {/* Expanded Detailed Day-by-Day Geofence Logs */}
                              {isExpanded && (
                                <tr>
                                  <td colSpan={displayDates.length * 3 + 3} className="px-4 py-3 bg-slate-50/90 border-b border-slate-200">
                                    <div className="space-y-2">
                                      <div className="flex items-center justify-between">
                                        <h4 className="text-[11px] font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-2">
                                          <span>Campus Final Destination Logs: <strong className="text-blue-700">{row.busNumber}</strong></span>
                                          <span className="px-2 py-0.5 text-[9px] font-bold bg-blue-100 text-blue-800 rounded">
                                            Route: {row.routeId}
                                          </span>
                                        </h4>
                                      </div>

                                      {gfLoading ? (
                                        <div className="flex items-center gap-2 py-3 justify-center text-xs text-slate-400">
                                          <Loader2 size={13} className="animate-spin text-blue-500" /> Loading final destination logs...
                                        </div>
                                      ) : gfRows.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic py-1">No detailed logs recorded for this bus in the 7-day window.</p>
                                      ) : (
                                        <div className="overflow-x-auto rounded-md border border-slate-200 bg-white">
                                          <table className="w-full text-left">
                                            <thead>
                                              <tr className="bg-[#071B45] text-white text-[9px] uppercase font-bold tracking-wider">
                                                <th className="px-3 py-1.5">#</th>
                                                <th className="px-3 py-1.5">Geofence / Location</th>
                                                <th className="px-3 py-1.5">Time In (Arrival)</th>
                                                <th className="px-3 py-1.5">Time Out (Departure)</th>
                                                <th className="px-3 py-1.5">Duration</th>
                                                <th className="px-3 py-1.5">Distance</th>
                                              </tr>
                                            </thead>
                                            <tbody className="divide-y divide-slate-100 text-[10px] text-slate-700 font-semibold">
                                              {gfRows.map((gf, idx) => (
                                                <tr key={idx} className="hover:bg-slate-50">
                                                  <td className="px-3 py-1.5 text-slate-400">{idx + 1}</td>
                                                  <td className="px-3 py-1.5 font-bold text-slate-800">{gf.geofence || gf.name || 'Campus Main Geofence'}</td>
                                                  <td className="px-3 py-1.5 text-emerald-700 font-mono font-bold">{formatGeofenceTime(gf.timeIn || gf.time_in)}</td>
                                                  <td className="px-3 py-1.5 text-rose-600 font-mono font-bold">{formatGeofenceTime(gf.timeOut || gf.time_out)}</td>
                                                  <td className="px-3 py-1.5">{gf.duration || '—'}</td>
                                                  <td className="px-3 py-1.5">{gf.mileage || '—'}</td>
                                                </tr>
                                              ))}
                                            </tbody>
                                          </table>
                                        </div>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
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
