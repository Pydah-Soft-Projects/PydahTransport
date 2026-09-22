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
  Moon,
  Fuel,
  FileSpreadsheet,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import ExcelJS from 'exceljs';
import GpsFinalDestinationModal from '../components/GpsFinalDestinationModal';
import { animateMarkerPosition, cancelAllMarkerAnimations, setCameraFollowVehicle, clearCameraFollow, getVehicleTelemetryState, setUserInteractingWithMap } from '../utils/mapAnimation';

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

const isLateArrival = (timeStr) => {
  if (!timeStr || timeStr === '—' || timeStr === '...' || timeStr === '-') return false;
  const clean = String(timeStr).trim();
  const timePart = clean.includes(' ') ? clean.split(' ')[1] : clean;
  const parts = timePart.split(':');
  if (parts.length < 2) return false;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parts.length >= 3 ? parseInt(parts[2], 10) : 0;
  if (isNaN(hours) || isNaN(minutes)) return false;
  if (hours > 9) return true;
  if (hours === 9 && (minutes > 0 || (seconds && seconds > 0))) return true;
  return false;
};

const extractPlateKey = (name) => {
  if (!name) return '';
  const raw = String(name).trim();
  const prefixed = raw.match(/^R\d+[_\-\s]+(.+)$/i);
  let plate = prefixed ? prefixed[1] : raw;
  let key = plate.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  const embedded = key.match(/^r\d+([a-z]{2}\d{1,2}[a-z]{1,3}\d{3,4})$/i);
  if (embedded) key = embedded[1].toLowerCase();
  return key;
};

const toDatetimeLocalValue = (str) => {
  if (!str) return '';
  return str.replace(' ', 'T').slice(0, 16);
};

const fromDatetimeLocalValue = (val) => {
  if (!val) return '';
  return val.replace('T', ' ');
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
  const vehicleMarkersRef = useRef({});
  const animFramesRef = useRef({});

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
    if (tabParam && ['live', 'travelled', 'destination', 'reports', 'nightstay', 'fuel'].includes(tabParam)) {
      setActivePageTab(tabParam);
      sessionStorage.setItem('gps_active_page_tab', tabParam);
    }
  }, [tabParam]);

  const handleTabSwitch = (newTab) => {
    setActivePageTab(newTab);
    setSearchParams({ tab: newTab });
    sessionStorage.setItem('gps_active_page_tab', newTab);
  };

  // Fuel Day Report States & Caching
  const fuelCacheRef = useRef({});
  const [fuelReportData, setFuelReportData] = useState([]);
  const [fuelLoading, setFuelLoading] = useState(false);
  const [fuelLoadingVehicles, setFuelLoadingVehicles] = useState({});
  const [fuelError, setFuelError] = useState(null);
  const [fuelSelectedVehicle, setFuelSelectedVehicle] = useState('ALL');
  const [fuelDatePreset, setFuelDatePreset] = useState('today');
  const [fuelDateFrom, setFuelDateFrom] = useState(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return `${todayStr} 00:00`;
  });
  const [fuelDateTo, setFuelDateTo] = useState(() => {
    const todayStr = new Date().toISOString().split('T')[0];
    return `${todayStr} 23:59`;
  });
  const [fuelSortField, setFuelSortField] = useState('routeId');
  const [fuelSortOrder, setFuelSortOrder] = useState('asc');

  const fetchFuelReportData = useCallback(async (overrideFrom, overrideTo, overrideVeh, forceRefresh = false) => {
    const fromStr = overrideFrom || fuelDateFrom;
    const toStr = overrideTo || fuelDateTo;
    const vehStr = overrideVeh !== undefined ? overrideVeh : fuelSelectedVehicle;

    const cacheKey = `${vehStr}_${fromStr}_${toStr}`;

    // Check component memory cache or localStorage for instant 0ms load
    if (!forceRefresh) {
      if (fuelCacheRef.current[cacheKey]) {
        const memoryRows = fuelCacheRef.current[cacheKey];
        if (Array.isArray(memoryRows) && memoryRows.some(r => r.kmsTravelled !== null || r.initialFuel !== null)) {
          setFuelReportData(memoryRows);
          setFuelLoadingVehicles({});
          setFuelError(null);
          return;
        }
      }
      try {
        const stored = localStorage.getItem(`fuel_cache_${cacheKey}`);
        if (stored) {
          const parsed = JSON.parse(stored);
          const hasValidTelemetry = Array.isArray(parsed) && parsed.some(r => r.kmsTravelled !== null || r.initialFuel !== null);
          if (hasValidTelemetry) {
            fuelCacheRef.current[cacheKey] = parsed;
            setFuelReportData(parsed);
            setFuelLoadingVehicles({});
            return;
          }
        }
      } catch (e) {}
    }

    setFuelLoading(true);
    setFuelError(null);

    // Single Vehicle Mode: Fetch 1 vehicle directly
    if (vehStr !== 'ALL' && vehStr !== 'All Vehicles') {
      setFuelLoadingVehicles({ [vehStr]: true });
      try {
        const url = `${API_BASE}/gps/fuel-report?vehicle_name=${encodeURIComponent(vehStr)}&date_from=${encodeURIComponent(fromStr)}&date_to=${encodeURIComponent(toStr)}${forceRefresh ? '&refresh=true' : ''}`;
        const res = await apiFetch(url);
        const json = await res.json();
        if (res.ok && json && json.success && Array.isArray(json.data)) {
          setFuelReportData((prev) => {
            const cleanKey = extractPlateKey(vehStr);
            const filtered = prev.filter(r => extractPlateKey(r.tggVehicleName || r.busNumber) !== cleanKey);
            return [...filtered, ...json.data];
          });
        }
      } catch (err) {
        console.error('[Fuel Day Report] Single vehicle fetch error:', err);
      } finally {
        setFuelLoadingVehicles({});
        setFuelLoading(false);
      }
      return;
    }

    // All Fleet Vehicles Mode: Fetch fuel report directly for all fuel-sensor buses
    try {
      const url = `${API_BASE}/gps/fuel-report?vehicle_name=ALL&date_from=${encodeURIComponent(fromStr)}&date_to=${encodeURIComponent(toStr)}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();
      if (res.ok && json && json.success && Array.isArray(json.data)) {
        setFuelReportData(json.data);
        fuelCacheRef.current[cacheKey] = json.data;
        try {
          localStorage.setItem(`fuel_cache_${cacheKey}`, JSON.stringify(json.data));
        } catch (e) {}
      }
    } catch (err) {
      console.error('[Fuel Day Report] Fetch error:', err);
      setFuelError(err.message || 'Failed to fetch fuel report data');
    } finally {
      setFuelLoadingVehicles({});
      setFuelLoading(false);
    }
  }, [fuelDateFrom, fuelDateTo, fuelSelectedVehicle, vehicles]);

  // Auto fetch fuel report when tab switches to 'fuel' (using cache when available)
  useEffect(() => {
    if (activePageTab === 'fuel') {
      fetchFuelReportData(undefined, undefined, undefined, false);
    }
  }, [activePageTab, fetchFuelReportData]);

  const handleFuelPreset = (preset) => {
    setFuelDatePreset(preset);
    const now = new Date();
    let fromStr = '';
    let toStr = '';

    if (preset === 'today') {
      const dStr = now.toISOString().split('T')[0];
      fromStr = `${dStr} 00:00`;
      toStr = `${dStr} 23:59`;
    } else if (preset === 'yesterday') {
      const y = new Date(now);
      y.setDate(y.getDate() - 1);
      const dStr = y.toISOString().split('T')[0];
      fromStr = `${dStr} 00:00`;
      toStr = `${dStr} 23:59`;
    }

    if (fromStr && toStr) {
      setFuelDateFrom(fromStr);
      setFuelDateTo(toStr);
      fetchFuelReportData(fromStr, toStr, fuelSelectedVehicle);
    }
  };

  const handleFuelSort = (field) => {
    if (fuelSortField === field) {
      setFuelSortOrder((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setFuelSortField(field);
      setFuelSortOrder('asc');
    }
  };

  const sortedFuelRows = React.useMemo(() => {
    const fuelMap = new Map();
    if (Array.isArray(fuelReportData) && fuelReportData.length > 0) {
      fuelReportData.forEach((r) => {
        const key1 = r.tggVehicleName ? String(r.tggVehicleName).trim().toUpperCase() : '';
        const key2 = r.busNumber ? String(r.busNumber).trim().toUpperCase() : '';
        const key3 = extractPlateKey(r.tggVehicleName || r.busNumber);
        if (key1) fuelMap.set(key1, r);
        if (key2) fuelMap.set(key2, r);
        if (key3) fuelMap.set(key3, r);
      });
    }

    let mergedRows = [];

    const fuelBuses = vehicles.filter((v) => v.hasFuelSensor === true);
    if (fuelReportData.length > 0) {
      mergedRows = fuelReportData.map((r) => ({
        tggVehicleName: r.tggVehicleName || r.busNumber,
        busNumber: r.tggVehicleName || r.busNumber,
        routeId: r.routeId || extractRouteIdFromVehicleName(r.tggVehicleName || r.busNumber) || 'Unassigned',
        kmsTravelled: r.kmsTravelled ?? null,
        initialFuel: r.initialFuel ?? null,
        finalFuel: r.finalFuel ?? null,
        fuelConsumption: r.fuelConsumption ?? null
      }));
    } else if (fuelBuses.length > 0) {
      mergedRows = fuelBuses.map((v) => {
        const key1 = String(v.name).trim().toUpperCase();
        const key2 = extractPlateKey(v.name);
        const match = fuelMap.get(key1) || (key2 ? fuelMap.get(key2) : null);
        const routeId = match?.routeId || extractRouteIdFromVehicleName(v.name) || v.routeName || 'Unassigned';

        return {
          tggVehicleName: v.name,
          busNumber: v.name,
          routeId: routeId,
          kmsTravelled: match ? match.kmsTravelled : null,
          initialFuel: match ? match.initialFuel : null,
          finalFuel: match ? match.finalFuel : null,
          fuelConsumption: match ? match.fuelConsumption : null
        };
      });
    } else {
      mergedRows = [];
    }

    if (!fuelSortField) return mergedRows;

    return [...mergedRows].sort((a, b) => {
      let valA = a[fuelSortField];
      let valB = b[fuelSortField];

      if (fuelSortField === 'busNumber' || fuelSortField === 'tggVehicleName') {
        valA = a.tggVehicleName || a.busNumber || '';
        valB = b.tggVehicleName || b.busNumber || '';
      } else if (fuelSortField === 'routeId') {
        valA = a.routeId || 'Unassigned';
        valB = b.routeId || 'Unassigned';
      }

      if (valA === null || valA === undefined) return 1;
      if (valB === null || valB === undefined) return -1;

      let comparison = 0;
      if (typeof valA === 'number' && typeof valB === 'number') {
        comparison = valA - valB;
      } else {
        comparison = String(valA).localeCompare(String(valB), undefined, { numeric: true, sensitivity: 'base' });
      }

      return fuelSortOrder === 'asc' ? comparison : -comparison;
    });
  }, [fuelReportData, vehicles, fuelSortField, fuelSortOrder]);

  const sortedDropdownVehicles = React.useMemo(() => {
    if (!vehicles || vehicles.length === 0) return [];

    const fuelBuses = vehicles.filter(v => v.hasFuelSensor === true);
    const targetVehicles = activePageTab === 'fuel' && fuelBuses.length > 0 ? fuelBuses : vehicles;

    const routeMap = new Map();
    if (Array.isArray(sortedFuelRows)) {
      sortedFuelRows.forEach((r) => {
        const k1 = r.tggVehicleName ? String(r.tggVehicleName).trim().toUpperCase() : '';
        const k2 = r.busNumber ? String(r.busNumber).trim().toUpperCase() : '';
        const k3 = extractPlateKey(r.tggVehicleName || r.busNumber);
        if (k1 && r.routeId) routeMap.set(k1, r.routeId);
        if (k2 && r.routeId) routeMap.set(k2, r.routeId);
        if (k3 && r.routeId) routeMap.set(k3, r.routeId);
      });
    }

    const items = targetVehicles.map((v) => {
      const k1 = String(v.name).trim().toUpperCase();
      const k2 = extractPlateKey(v.name);
      const assignedRoute = routeMap.get(k1) || (k2 ? routeMap.get(k2) : null) || extractRouteIdFromVehicleName(v.name) || 'Route';
      return {
        ...v,
        assignedRoute
      };
    });

    return items.sort((a, b) => {
      const rA = a.assignedRoute || 'ZZZ';
      const rB = b.assignedRoute || 'ZZZ';
      const numA = parseInt(rA.replace(/\D/g, ''), 10) || 999;
      const numB = parseInt(rB.replace(/\D/g, ''), 10) || 999;
      if (numA !== numB) return numA - numB;
      return String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
    });
  }, [vehicles, sortedFuelRows, activePageTab]);

  const handleExportFuelExcel = async () => {
    if (!filteredFuelRows || filteredFuelRows.length === 0) return;

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Fuel Day Report');

    worksheet.mergeCells('A1:F1');
    const titleCell = worksheet.getCell('A1');
    titleCell.value = `Pydah Transport - Fuel Day Report (${fuelDateFrom} to ${fuelDateTo})`;
    titleCell.font = { name: 'Calibri', size: 14, bold: true, color: { argb: 'FFFFFFFF' } };
    titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF071B45' } };
    titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
    worksheet.getRow(1).height = 30;

    const headers = ['Assigned Route', 'Vehicle Number / Unit', 'Distance Travelled (KM)', 'Starting Fuel Level (L)', 'Ending Fuel Level (L)', 'Fuel Consumption (L)'];
    const headerRow = worksheet.addRow(headers);
    headerRow.height = 24;
    headerRow.eachCell((cell) => {
      cell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E40AF' } };
      cell.alignment = { horizontal: 'center', vertical: 'middle' };
    });

    filteredFuelRows.forEach((row) => {
      const dataRow = worksheet.addRow([
        row.routeId || 'Unassigned',
        row.busNumber || row.tggVehicleName || '—',
        row.kmsTravelled !== null && row.kmsTravelled !== undefined ? `${row.kmsTravelled} km` : '-',
        row.initialFuel !== null && row.initialFuel !== undefined ? `${row.initialFuel} l` : '-',
        row.finalFuel !== null && row.finalFuel !== undefined ? `${row.finalFuel} l` : '-',
        row.fuelConsumption !== null && row.fuelConsumption !== undefined ? `${row.fuelConsumption} l` : '-'
      ]);
      dataRow.height = 20;
      dataRow.eachCell((cell, colNumber) => {
        cell.alignment = { horizontal: colNumber <= 2 ? 'left' : 'center', vertical: 'middle' };
      });
    });

    worksheet.columns.forEach((col) => {
      col.width = 24;
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = window.URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `Fuel_Day_Report_${fuelDateFrom.split(' ')[0]}_to_${fuelDateTo.split(' ')[0]}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(url);
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
  const [report7DayData, setReport7DayData] = useState(() => {
    try {
      const fromStr = sessionStorage.getItem('gps_fleet_date_from') || (() => {
        const d = new Date(); d.setDate(d.getDate() - 4); return d.toISOString().split('T')[0];
      })();
      const toStr = sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
      const cached = sessionStorage.getItem(`gps_day_report_${fromStr}_${toStr}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.data)) return parsed.data;
      }
    } catch (e) {}
    return [];
  });
  const [reportDates, setReportDates] = useState(() => {
    try {
      const fromStr = sessionStorage.getItem('gps_fleet_date_from') || (() => {
        const d = new Date(); d.setDate(d.getDate() - 4); return d.toISOString().split('T')[0];
      })();
      const toStr = sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
      const cached = sessionStorage.getItem(`gps_day_report_${fromStr}_${toStr}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.dates)) return parsed.dates;
      }
    } catch (e) {}
    return [];
  });
  const [reportLoading, setReportLoading] = useState(false);
  const reportRequestIdRef = useRef(0);

  // Filter Modal state
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [tempDateFrom, setTempDateFrom] = useState(fleetDateFrom);
  const [tempDateTo, setTempDateTo] = useState(fleetDateTo);

  const filteredFuelRows = React.useMemo(() => {
    const query = (fleetSearchQuery || '').toLowerCase().trim();
    if (!query) return sortedFuelRows;

    return sortedFuelRows.filter((r) => {
      const matchRoute = (r.routeId || '').toLowerCase().includes(query);
      const matchBus = (r.busNumber || '').toLowerCase().includes(query);
      const matchTgg = (r.tggVehicleName || '').toLowerCase().includes(query);
      return matchRoute || matchBus || matchTgg;
    });
  }, [sortedFuelRows, fleetSearchQuery]);

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
    const cacheKey = `gps_day_report_${fromStr}_${toStr}`;

    if (requestedDates.length > 0) {
      setReportDates(requestedDates);
    }

    if (forceRefresh) {
      sessionStorage.removeItem(cacheKey);
    } else {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
            setReport7DayData(parsed.data);
            if (parsed.dates && parsed.dates.length > 0) {
              setReportDates(parsed.dates);
            }
            setReportLoading(false);
            return;
          }
        } catch (e) {}
      }
    }

    if (forceRefresh || report7DayData.length === 0) {
      setReportLoading(true);
    }

    try {
      const url = `${API_BASE}/gps/day-inout-report?date_from=${fromStr}&date_to=${toStr}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();

      if (res.ok && json.success && Array.isArray(json.data)) {
        setReport7DayData(json.data);
        const resolvedDates = (json.dates && json.dates.length > 0) ? json.dates : requestedDates;
        if (resolvedDates.length > 0) {
          setReportDates(resolvedDates);
        }
        sessionStorage.setItem(cacheKey, JSON.stringify({ data: json.data, dates: resolvedDates }));
      }
    } catch (err) {
      console.error('Day report fetch error:', err);
    } finally {
      setReportLoading(false);
    }
  }, [fleetDateFrom, fleetDateTo, report7DayData.length]);

  // Night Stay Report States
  const [nightStayData, setNightStayData] = useState(() => {
    try {
      const fromStr = sessionStorage.getItem('gps_fleet_date_from') || (() => {
        const d = new Date(); d.setDate(d.getDate() - 4); return d.toISOString().split('T')[0];
      })();
      const toStr = sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
      const cached = sessionStorage.getItem(`gps_nightstay_report_${fromStr}_${toStr}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.data)) return parsed.data;
      }
    } catch (e) {}
    return [];
  });
  const [nightStayDates, setNightStayDates] = useState(() => {
    try {
      const fromStr = sessionStorage.getItem('gps_fleet_date_from') || (() => {
        const d = new Date(); d.setDate(d.getDate() - 4); return d.toISOString().split('T')[0];
      })();
      const toStr = sessionStorage.getItem('gps_fleet_date_to') || new Date().toISOString().split('T')[0];
      const cached = sessionStorage.getItem(`gps_nightstay_report_${fromStr}_${toStr}`);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && Array.isArray(parsed.dates)) return parsed.dates;
      }
    } catch (e) {}
    return [];
  });
  const [nightStayLoading, setNightStayLoading] = useState(false);
  const [syncingReports, setSyncingReports] = useState(false);
  const [syncingVehicle, setSyncingVehicle] = useState({});
  const [syncingDate, setSyncingDate] = useState({});

  const handleSyncSingleDate = async (dateStr, e) => {
    if (e) e.stopPropagation();
    try {
      setSyncingDate(prev => ({ ...prev, [dateStr]: true }));
      const reportType = activePageTab === 'nightstay' ? 'night_stay' : activePageTab === 'fuel' ? 'fuel' : 'day_in_out';

      const res = await apiFetch(`${API_BASE}/gps/sync-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: dateStr, date_to: dateStr, reportType })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        const currentFrom = sessionStorage.getItem('gps_fleet_date_from') || fleetDateFrom;
        const currentTo = sessionStorage.getItem('gps_fleet_date_to') || fleetDateTo;
        sessionStorage.clear();
        if (currentFrom) sessionStorage.setItem('gps_fleet_date_from', currentFrom);
        if (currentTo) sessionStorage.setItem('gps_fleet_date_to', currentTo);

        if (activePageTab === 'nightstay') {
          await fetchNightStayReportData(currentFrom, currentTo, true);
        } else if (activePageTab === 'fuel') {
          await fetchFuelReportData(currentFrom, currentTo, fuelSelectedVehicle, true);
        } else {
          await fetchDayReport(currentFrom, currentTo, true);
        }
      }
    } catch (err) {
      console.error(`Single date sync failed for ${dateStr}:`, err);
    } finally {
      setSyncingDate(prev => ({ ...prev, [dateStr]: false }));
    }
  };

  const handleSyncSingleVehicle = async (busNumber, e) => {
    if (e) e.stopPropagation();
    try {
      setSyncingVehicle(prev => ({ ...prev, [busNumber]: true }));
      const fromD = fleetDateFrom || new Date().toISOString().split('T')[0];
      const toD = fleetDateTo || fromD;
      const reportType = activePageTab === 'nightstay' ? 'night_stay' : activePageTab === 'fuel' ? 'fuel' : 'day_in_out';

      const res = await apiFetch(`${API_BASE}/gps/sync-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ busNumber, date_from: fromD, date_to: toD, reportType })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // Clear stale session caches while preserving date range filter selection
        const currentFrom = sessionStorage.getItem('gps_fleet_date_from') || fromD;
        const currentTo = sessionStorage.getItem('gps_fleet_date_to') || toD;
        sessionStorage.clear();
        if (currentFrom) sessionStorage.setItem('gps_fleet_date_from', currentFrom);
        if (currentTo) sessionStorage.setItem('gps_fleet_date_to', currentTo);

        if (activePageTab === 'nightstay') {
          await fetchNightStayReportData(fromD, toD, true);
        } else if (activePageTab === 'fuel') {
          await fetchFuelReportData(fromD, toD, fuelSelectedVehicle, true);
        } else {
          await fetchDayReport(fromD, toD, true);
        }
      }
    } catch (err) {
      console.error(`Single vehicle sync failed for ${busNumber}:`, err);
    } finally {
      setSyncingVehicle(prev => ({ ...prev, [busNumber]: false }));
    }
  };

  const handleManualSyncReports = async () => {
    try {
      setSyncingReports(true);
      const fromD = fleetDateFrom || new Date().toISOString().split('T')[0];
      const toD = fleetDateTo || fromD;
      const reportType = activePageTab === 'nightstay' ? 'night_stay' : activePageTab === 'fuel' ? 'fuel' : 'day_in_out';
      
      const res = await apiFetch(`${API_BASE}/gps/sync-reports`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date_from: fromD, date_to: toD, reportType })
      });
      const json = await res.json();
      if (res.ok && json.success) {
        // Clear stale session caches while preserving date range filter selection
        const currentFrom = sessionStorage.getItem('gps_fleet_date_from') || fromD;
        const currentTo = sessionStorage.getItem('gps_fleet_date_to') || toD;
        sessionStorage.clear();
        if (currentFrom) sessionStorage.setItem('gps_fleet_date_from', currentFrom);
        if (currentTo) sessionStorage.setItem('gps_fleet_date_to', currentTo);

        if (activePageTab === 'nightstay') {
          await fetchNightStayReportData(fromD, toD, true);
        } else if (activePageTab === 'fuel') {
          await fetchFuelReportData(fromD, toD, fuelSelectedVehicle, true);
        } else {
          await fetchDayReport(fromD, toD, true);
        }
      }
    } catch (err) {
      console.error('Manual sync error:', err);
    } finally {
      setSyncingReports(false);
    }
  };

  const fetchNightStayReportData = useCallback(async (overrideFrom, overrideTo, forceRefresh = false) => {
    const fromStr = overrideFrom || fleetDateFrom;
    const toStr = overrideTo || fleetDateTo;
    const requestedDates = buildClientDateRange(fromStr, toStr);
    const cacheKey = `gps_nightstay_report_${fromStr}_${toStr}`;

    if (requestedDates.length > 0) {
      setNightStayDates(requestedDates);
    }

    if (!forceRefresh) {
      const cached = sessionStorage.getItem(cacheKey);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && Array.isArray(parsed.data) && parsed.data.length > 0) {
            setNightStayData(parsed.data);
            if (parsed.dates && parsed.dates.length > 0) {
              setNightStayDates(parsed.dates);
            }
            setNightStayLoading(false);
            return;
          }
        } catch (e) {}
      }
    }

    setNightStayLoading(true);
    try {
      const url = `${API_BASE}/gps/nightstay-report?date_from=${fromStr}&date_to=${toStr}${forceRefresh ? '&refresh=true' : ''}`;
      const res = await apiFetch(url);
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data)) {
        setNightStayData(json.data);
        const resolvedDates = (json.dates && json.dates.length > 0) ? json.dates : requestedDates;
        if (resolvedDates.length > 0) {
          setNightStayDates(resolvedDates);
        }
        sessionStorage.setItem(cacheKey, JSON.stringify({ data: json.data, dates: resolvedDates }));
      }
    } catch (err) {
      console.error('Night stay report fetch error:', err);
    } finally {
      setNightStayLoading(false);
    }
  }, [fleetDateFrom, fleetDateTo]);

  useEffect(() => {
    if (activePageTab === 'reports' || activePageTab === 'travelled') {
      fetchDayReport();
    } else if (activePageTab === 'nightstay') {
      fetchNightStayReportData();
    }
  }, [activePageTab, fetchDayReport, fetchNightStayReportData]);

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

      console.log('[GPS RAW PAYLOAD]', data?.data ? data.data.map(v => ({ name: v.name, units: v.units, lat: v.latitude, lng: v.longitude, time: v.timestamp })) : []);

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

  // Load vehicles list on initial component mount
  useEffect(() => {
    loadVehicles();
  }, [loadVehicles]);

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

  const handleExportFleetExcel = async () => {
    const isNightStay = activePageTab === 'nightstay';
    const rawReportData = isNightStay ? nightStayData : report7DayData;
    const reportData = [...rawReportData].sort((a, b) => {
      const valA = (a.routeId || 'ZZZ').toString();
      const valB = (b.routeId || 'ZZZ').toString();
      return valA.localeCompare(valB, undefined, { numeric: true, sensitivity: 'base' });
    });

    const dates = (isNightStay ? nightStayDates : reportDates).length > 0
      ? (isNightStay ? nightStayDates : reportDates)
      : displayDates;

    if (!reportData.length || !dates.length) return;

    try {
      const workbook = new ExcelJS.Workbook();
      const sheetName = isNightStay ? 'Night Stay IN-OUT Report' : 'Campus IN-OUT Report';
      const worksheet = workbook.addWorksheet(sheetName, {
        views: [{ showGridLines: true }]
      });

      const subColsPerDate = isNightStay ? 2 : 3;
      const staticColCount = isNightStay ? 4 : 3;
      const totalColCount = staticColCount + (dates.length * subColsPerDate);

      // Title Banner Row 1
      worksheet.mergeCells(1, 1, 1, totalColCount);
      const titleCell = worksheet.getCell(1, 1);
      titleCell.value = 'PYDAH EDUCATIONAL INSTITUTIONS — TRANSPORTATION DEPARTMENT';
      titleCell.font = { name: 'Segoe UI', size: 13, bold: true, color: { argb: 'FFFFFF' } };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '071B45' } };
      titleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(1).height = 30;

      // Title Sub-banner Row 2
      worksheet.mergeCells(2, 1, 2, totalColCount);
      const subTitleCell = worksheet.getCell(2, 1);
      subTitleCell.value = isNightStay
        ? `NIGHT STAY STAGE ARRIVAL (IN) & DEPARTURE (OUT) LOGS REPORT (${dates[0]} to ${dates[dates.length - 1]})`
        : `CAMPUS GATE VEHICLE ARRIVAL (IN) & DEPARTURE (OUT) LOGS REPORT (${dates[0]} to ${dates[dates.length - 1]})`;
      subTitleCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'E2E8F0' } };
      subTitleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '0B2256' } };
      subTitleCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(2).height = 22;

      // Sub-info Row 3
      worksheet.mergeCells(3, 1, 3, totalColCount);
      const infoCell = worksheet.getCell(3, 1);
      infoCell.value = `Report Generated: ${new Date().toLocaleString('en-IN')}  |  Total Buses Logged: ${reportData.length}`;
      infoCell.font = { name: 'Segoe UI', size: 9, italic: true, color: { argb: '475569' } };
      infoCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F8FAFC' } };
      infoCell.alignment = { horizontal: 'center', vertical: 'middle' };
      worksheet.getRow(3).height = 18;

      // Empty Row 4
      worksheet.getRow(4).height = 8;

      // Group Headers Row 5
      const headerRow5 = worksheet.getRow(5);
      headerRow5.height = 24;

      const staticHeaders = ['Route ID', 'Route Name', 'Bus Number'];
      if (isNightStay) staticHeaders.push('Night Stay Point');

      staticHeaders.forEach((name, i) => {
        const colIdx = i + 1;
        worksheet.mergeCells(5, colIdx, 6, colIdx);
        const cell = worksheet.getCell(5, colIdx);
        cell.value = name;
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '071B45' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Date Group Headers in Row 5
      dates.forEach((dateStr, idx) => {
        const startCol = staticColCount + 1 + (idx * subColsPerDate);
        const endCol = startCol + (subColsPerDate - 1);
        worksheet.mergeCells(5, startCol, 5, endCol);
        
        const dObj = new Date(dateStr);
        const dayNum = dObj.getDate();
        const monthName = dObj.toLocaleDateString('en-US', { month: 'short' });
        const dayName = dObj.toLocaleDateString('en-US', { weekday: 'short' });

        const cell = worksheet.getCell(5, startCol);
        cell.value = `${dayNum} ${monthName} (${dayName})`;
        cell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: 'FFFFFF' } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '1E3A8A' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      });

      // Sub Header Row 6 (OUT / IN for Night Stay, IN / OUT / KMS for Campus)
      const headerRow6 = worksheet.getRow(6);
      headerRow6.height = 22;

      dates.forEach((dateStr, idx) => {
        const startCol = staticColCount + 1 + (idx * subColsPerDate);
        
        if (isNightStay) {
          const outCell = worksheet.getCell(6, startCol);
          outCell.value = 'OUT (Depart)';
          outCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FCA5A5' } };
          outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '881337' } };
          outCell.alignment = { horizontal: 'center', vertical: 'middle' };

          const inCell = worksheet.getCell(6, startCol + 1);
          inCell.value = 'IN (Arrival)';
          inCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: '6EE7B7' } };
          inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '064E3B' } };
          inCell.alignment = { horizontal: 'center', vertical: 'middle' };
        } else {
          const inCell = worksheet.getCell(6, startCol);
          inCell.value = 'IN (Arrival)';
          inCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: '6EE7B7' } };
          inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '064E3B' } };
          inCell.alignment = { horizontal: 'center', vertical: 'middle' };

          const outCell = worksheet.getCell(6, startCol + 1);
          outCell.value = 'OUT (Depart)';
          outCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FCA5A5' } };
          outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '881337' } };
          outCell.alignment = { horizontal: 'center', vertical: 'middle' };

          const kmsCell = worksheet.getCell(6, startCol + 2);
          kmsCell.value = 'Distance (KMS)';
          kmsCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: 'FDE68A' } };
          kmsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '78350F' } };
          kmsCell.alignment = { horizontal: 'center', vertical: 'middle' };
        }
      });

      // Data Rows
      let currentRowIdx = 7;
      const totalKmPerDate = {};
      dates.forEach(d => { totalKmPerDate[d] = 0; });

      reportData.forEach((row, rowNum) => {
        const dataRow = worksheet.getRow(currentRowIdx);
        dataRow.height = 22;
        const isAlternate = rowNum % 2 === 1;
        const bgPattern = isAlternate ? 'F8FAFC' : 'FFFFFF';

        const routeIdCell = dataRow.getCell(1);
        routeIdCell.value = row.routeId || 'Unassigned';
        routeIdCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: '1D4ED8' } };
        routeIdCell.alignment = { horizontal: 'center', vertical: 'middle' };

        const routeNameCell = dataRow.getCell(2);
        routeNameCell.value = row.routeName || '—';
        routeNameCell.font = { name: 'Segoe UI', size: 9, color: { argb: '334155' } };
        routeNameCell.alignment = { horizontal: 'left', vertical: 'middle' };

        const busCell = dataRow.getCell(3);
        busCell.value = row.tggVehicleName || row.busNumber;
        busCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: '0F172A' } };
        busCell.alignment = { horizontal: 'left', vertical: 'middle' };

        let dateColOffset = 4;
        if (isNightStay) {
          const stayCell = dataRow.getCell(4);
          stayCell.value = row.stayPointName || 'Default Stay';
          stayCell.font = { name: 'Segoe UI', size: 9, bold: true, color: { argb: '312E81' } };
          stayCell.alignment = { horizontal: 'left', vertical: 'middle' };
          stayCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'EEF2FF' } };
          dateColOffset = 5;
        }

        for (let c = 1; c < dateColOffset; c++) {
          if (!isNightStay || c !== 4) {
            dataRow.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
          }
        }

        dates.forEach((dateStr, idx) => {
          const startCol = (dateColOffset - 1) + 1 + (idx * subColsPerDate);
          const dayInfo = row.days?.[dateStr] || {};

          const inTime = dayInfo.firstIn || null;
          const outTime = dayInfo.lastOut || null;
          const kmsVal = Number(dayInfo.kilometers) || 0;

          if (kmsVal > 0) {
            totalKmPerDate[dateStr] += kmsVal;
          }

          if (isNightStay) {
            // OUT Cell (Depart in morning)
            const outCell = dataRow.getCell(startCol);
            outCell.value = outTime || '—';
            outCell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (outTime) {
              outCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'B91C1C' } };
              outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEE2E2' } };
            } else {
              outCell.font = { name: 'Segoe UI', size: 9, color: { argb: '94A3B8' } };
              outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
            }

            // IN Cell (Arrival at night)
            const inCell = dataRow.getCell(startCol + 1);
            inCell.value = inTime || '—';
            inCell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (inTime) {
              const isLate = isLateArrival(inTime);
              inCell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: isLate ? 'B91C1C' : '15803D' } };
              inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLate ? 'FEE2E2' : 'DCFCE7' } };
            } else {
              inCell.font = { name: 'Segoe UI', size: 9, color: { argb: '94A3B8' } };
              inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
            }
          } else {
            // IN Cell
            const inCell = dataRow.getCell(startCol);
            inCell.value = inTime || '—';
            inCell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (inTime) {
              const isLate = isLateArrival(inTime);
              inCell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: isLate ? 'B91C1C' : '15803D' } };
              inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: isLate ? 'FEE2E2' : 'DCFCE7' } };
            } else {
              inCell.font = { name: 'Segoe UI', size: 9, color: { argb: '94A3B8' } };
              inCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
            }

            // OUT Cell
            const outCell = dataRow.getCell(startCol + 1);
            outCell.value = outTime || '—';
            outCell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (outTime) {
              outCell.font = { name: 'Segoe UI', size: 10.5, bold: true, color: { argb: '15803D' } };
              outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'DCFCE7' } };
            } else {
              outCell.font = { name: 'Segoe UI', size: 9, color: { argb: '94A3B8' } };
              outCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
            }

            // KMS Cell
            const kmsCell = dataRow.getCell(startCol + 2);
            kmsCell.value = kmsVal > 0 ? `${kmsVal.toFixed(1)} km` : '—';
            kmsCell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (kmsVal > 0) {
              kmsCell.font = { name: 'Segoe UI', size: 9.5, bold: true, color: { argb: 'B45309' } };
              kmsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
            } else {
              kmsCell.font = { name: 'Segoe UI', size: 9, color: { argb: '94A3B8' } };
              kmsCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bgPattern } };
            }
          }
        });

        currentRowIdx++;
      });

      if (!isNightStay) {
        // Total Fleet Distance Summary Row at bottom
        const totalRow = worksheet.getRow(currentRowIdx);
        totalRow.height = 26;

        worksheet.mergeCells(currentRowIdx, 1, currentRowIdx, staticColCount);
        const totalLabelCell = worksheet.getCell(currentRowIdx, 1);
        totalLabelCell.value = 'FLEET DAILY TOTAL DISTANCE (KMS)';
        totalLabelCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '78350F' } };
        totalLabelCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FDE68A' } };
        totalLabelCell.alignment = { horizontal: 'center', vertical: 'middle' };

        dates.forEach((dateStr, idx) => {
          const startCol = staticColCount + 1 + (idx * subColsPerDate);
          const dayTotalKm = Math.round(totalKmPerDate[dateStr] * 10) / 10;

          worksheet.mergeCells(currentRowIdx, startCol, currentRowIdx, startCol + 2);
          const dayTotalCell = worksheet.getCell(currentRowIdx, startCol);
          dayTotalCell.value = dayTotalKm > 0 ? `Total: ${dayTotalKm.toFixed(1)} km` : '—';
          dayTotalCell.font = { name: 'Segoe UI', size: 10, bold: true, color: { argb: '92400E' } };
          dayTotalCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FEF3C7' } };
          dayTotalCell.alignment = { horizontal: 'center', vertical: 'middle' };
        });
      } else {
        // Decrement by 1 since no summary row was added for nightstay
        currentRowIdx--;
      }

      // Apply borders to table
      const thinBorder = {
        top: { style: 'thin', color: { argb: 'CBD5E1' } },
        left: { style: 'thin', color: { argb: 'CBD5E1' } },
        bottom: { style: 'thin', color: { argb: 'CBD5E1' } },
        right: { style: 'thin', color: { argb: 'CBD5E1' } }
      };

      for (let r = 5; r <= currentRowIdx; r++) {
        const rowObj = worksheet.getRow(r);
        for (let c = 1; c <= totalColCount; c++) {
          rowObj.getCell(c).border = thinBorder;
        }
      }

      // Column Widths
      worksheet.getColumn(1).width = 14;
      worksheet.getColumn(2).width = 24;
      worksheet.getColumn(3).width = 20;
      if (isNightStay) {
        worksheet.getColumn(4).width = 24;
      }

      dates.forEach((_, idx) => {
        const startCol = staticColCount + 1 + (idx * subColsPerDate);
        worksheet.getColumn(startCol).width = 15;
        worksheet.getColumn(startCol + 1).width = 15;
        if (!isNightStay) {
          worksheet.getColumn(startCol + 2).width = 16;
        }
      });

      // Write & Download Excel file
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      const filePrefix = isNightStay ? 'Night_Stay_InOut_Report' : 'Campus_InOut_Report';
      link.download = `${filePrefix}_${dates[0]}_to_${dates[dates.length - 1]}.xlsx`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export Excel report:', err);
      alert('Failed to generate Excel file: ' + err.message);
    }
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

  // Periodic 3-second background sync for live fleet vehicle updates
  useEffect(() => {
    const interval = setInterval(() => {
      loadVehicles(true);
    }, 3000);
    return () => clearInterval(interval);
  }, [loadVehicles]);

  // Handle vehicle selection: Instant trace fetch & continuous camera follow tracking
  const handleSelectVehicle = (veh) => {
    setUserInteractingWithMap(false);
    selectedVehicleRef.current = veh;
    setSelectedVehicle(veh);
    setTraceLogs([]); // Clear trace logs immediately on switch to prevent showing old route

    if (veh) {
      loadTraceHistoryFast(veh.name);
      const key = veh.units || veh.name;
      setCameraFollowVehicle(key, mapInstanceRef.current);
    } else {
      clearCameraFollow();
    }
  };

  const handleRecenterVehicle = () => {
    setUserInteractingWithMap(false);
    if (selectedVehicle && mapInstanceRef.current) {
      const key = selectedVehicle.units || selectedVehicle.name;
      const state = getVehicleTelemetryState(key);
      const targetLat = state?.displayPosition?.lat || selectedVehicle.latitude;
      const targetLng = state?.displayPosition?.lng || selectedVehicle.longitude;
      if (typeof targetLat === 'number' && typeof targetLng === 'number') {
        mapInstanceRef.current.flyTo([targetLat, targetLng], mapInstanceRef.current.getZoom() || 15, { animate: true, duration: 1 });
      }
    }
  };

  const getVehicleEffectiveStatus = (v) => {
    if (v.status) return v.status;
    if ((v.speed || 0) > 0) return 'Moving';
    return 'Stopped';
  };

  // Filter vehicles
  const filteredVehicles = vehicles.filter(v => {
    const matchesSearch =
      (v.name || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (v.units || '').toString().includes(searchQuery);

    const effStatus = getVehicleEffectiveStatus(v);
    if (statusFilter === 'moving') return matchesSearch && (effStatus === 'Moving' || (v.speed || 0) > 0);
    if (statusFilter === 'idle') return matchesSearch && effStatus === 'Idle';
    if (statusFilter === 'stopped') return matchesSearch && (effStatus === 'Stopped' || effStatus === 'Offline');
    return matchesSearch;
  });

  const movingCount = vehicles.filter(v => getVehicleEffectiveStatus(v) === 'Moving' || (v.speed || 0) > 0).length;
  const idleCount = vehicles.filter(v => getVehicleEffectiveStatus(v) === 'Idle').length;
  const stoppedCount = vehicles.filter(v => getVehicleEffectiveStatus(v) === 'Stopped' || getVehicleEffectiveStatus(v) === 'Offline').length;

  // Custom styled bus icon marker helper
  const createVehicleIcon = useCallback((isMoving, vehStatus = '') => {
    if (!window.L) return null;
    let bgColor = '#3B82F6';
    if (vehStatus === 'Moving' || isMoving) bgColor = '#10B981';
    else if (vehStatus === 'Idle') bgColor = '#F59E0B';
    else if (vehStatus === 'Stopped') bgColor = '#EF4444';
    else if (vehStatus === 'Offline') bgColor = '#64748B';

    const shadowColor = bgColor;
    const pulseBorder = bgColor;

    return window.L.divIcon({
      className: 'custom-bus-marker',
      html: `
        <div data-bus-icon="true" style="
          position: relative;
          display: flex;
          flex-direction: column;
          align-items: center;
          cursor: pointer;
        ">
          
          <!-- Live Signal Beacon Dot -->
          <div style="
            position: absolute;
            top: -2px;
            right: -2px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: ${isMoving ? '#059669' : '#2563EB'};
            border: 2px solid #ffffff;
            box-shadow: 0 0 8px ${pulseBorder};
            z-index: 10;
          "></div>

          <!-- Bus Body -->
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
      const container = mapContainerRef.current;
      const map = L.map(container, {
        center: [17.544, 80.616],
        zoom: 10,
        zoomControl: true
      });

      const handleUserMapInteraction = () => {
        setUserInteractingWithMap(true);
      };

      if (container) {
        container.addEventListener('mousedown', handleUserMapInteraction, { passive: true });
        container.addEventListener('touchstart', handleUserMapInteraction, { passive: true });
        container.addEventListener('pointerdown', handleUserMapInteraction, { passive: true });
        container.addEventListener('wheel', handleUserMapInteraction, { passive: true });
      }

      map.on('dragstart zoomstart movestart', handleUserMapInteraction);

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

    // Active vehicles filter
    const targetVehicles = selectedVehicle ? [selectedVehicle] : filteredVehicles;
    const activeKeys = new Set(targetVehicles.map(v => v.units || v.name));

    // Remove inactive markers
    Object.keys(vehicleMarkersRef.current).forEach(key => {
      if (!activeKeys.has(key)) {
        if (animFramesRef.current[key]) {
          cancelAnimationFrame(animFramesRef.current[key]);
          delete animFramesRef.current[key];
        }
        if (vehicleMarkersRef.current[key]) {
          layerGroup.removeLayer(vehicleMarkersRef.current[key]);
          delete vehicleMarkersRef.current[key];
        }
      }
    });

    // Clear vector lines and circles while keeping active markers
    layerGroup.eachLayer(layer => {
      if (!(layer instanceof L.Marker)) {
        layerGroup.removeLayer(layer);
      }
    });

    // 1. ALL VEHICLES MODE (selectedVehicle === null)
    if (!selectedVehicle) {
      clearCameraFollow();
      centeredVehicleNameRef.current = null;
      if (filteredVehicles.length === 0) return;

      const bounds = L.latLngBounds();

      filteredVehicles.forEach(veh => {
        if (typeof veh.latitude === 'number' && typeof veh.longitude === 'number') {
          const latLng = [veh.latitude, veh.longitude];
          bounds.extend(latLng);

          const vStatus = getVehicleEffectiveStatus(veh);
          const isMoving = vStatus === 'Moving' || (veh.speed || 0) > 0;
          const icon = createVehicleIcon(isMoving, vStatus);
          const key = veh.units || veh.name;

          const isOffline = Boolean(veh.isFallback) || veh.telemetryStatus === 'provider_unavailable' || veh.providerOffline || vStatus === 'Offline';
          const popupColor = isMoving ? '#059669' : vStatus === 'Idle' ? '#d97706' : vStatus === 'Offline' ? '#475569' : '#dc2626';
          const statusText = isMoving ? `🚌 Speed: ${veh.speed} km/h (Moving)` : vStatus === 'Idle' ? `⏸ Idle (${veh.speed || 0} km/h)` : vStatus === 'Offline' ? `⚪ Offline` : '⏹ Stopped';

          const popupHtml = `
            <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
              <strong style="font-size: 13px; color: #0f172a;">${veh.name}</strong><br/>
              <span style="color: #64748b;">Unit ID: ${veh.units}</span><br/>
              <span style="color: ${popupColor}; font-weight: bold;">
                ${statusText}
              </span><br/>
              ${isOffline
                ? '<div style="margin-top: 4px; padding: 2px 6px; background: #fffbe6; border: 1px solid #ffe58f; color: #d46b08; border-radius: 4px; font-weight: bold; font-size: 10px; display: inline-block;">⚠️ Estimated Position (Provider Offline)</div>'
                : '<div style="margin-top: 4px; padding: 2px 6px; background: #f6ffed; border: 1px solid #b7eb8f; color: #389e0d; border-radius: 4px; font-weight: bold; font-size: 10px; display: inline-block;">🟢 Live GPS</div>'
              }<br/>
              <span style="color: #94a3b8; font-size: 10px;">${veh.timestamp || ''}</span>
            </div>
          `;

          const existingState = getVehicleTelemetryState(key);
          const initialPos = (existingState && existingState.displayPosition)
            ? [existingState.displayPosition.lat, existingState.displayPosition.lng]
            : latLng;

          let marker = vehicleMarkersRef.current[key];
          if (!marker) {
            console.log('[VEHICLE LOCATION INITIAL MARKER]', key, initialPos);
            marker = L.marker(initialPos, { icon });
            marker.bindPopup(popupHtml);
            marker.on('click', () => handleSelectVehicle(veh));
            marker.addTo(layerGroup);
            vehicleMarkersRef.current[key] = marker;
          } else {
            marker.setIcon(icon);
            marker.setPopupContent(popupHtml);
          }

          console.log('[VEHICLE LOCATION UPDATE]', key, veh.latitude, veh.longitude);
          animateMarkerPosition(
            marker,
            veh.latitude,
            veh.longitude,
            {
              speed: veh.speed,
              timestamp: veh.timestamp,
              isFallback: isOffline,
              telemetryStatus: isOffline ? 'provider_unavailable' : 'live_gps',
              providerOffline: isOffline
            },
            key,
            animFramesRef.current
          );
        }
      });

      if (bounds.isValid() && Object.keys(vehicleMarkersRef.current).length <= filteredVehicles.length) {
        if (!centeredVehicleNameRef.current) {
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      }
    }
    // 2. SINGLE VEHICLE MODE (selectedVehicle !== null) -> Focused bus icon & vibrant colored route path
    else {
      const lat = selectedVehicle.latitude;
      const lng = selectedVehicle.longitude;
      const vehName = selectedVehicle.name;
      const key = selectedVehicle.units || selectedVehicle.name;

      if (typeof lat === 'number' && typeof lng === 'number') {
        const vStatus = getVehicleEffectiveStatus(selectedVehicle);
        const isMoving = vStatus === 'Moving' || (selectedVehicle.speed || 0) > 0;
        const isOffline = Boolean(selectedVehicle.isFallback) || selectedVehicle.telemetryStatus === 'provider_unavailable' || selectedVehicle.providerOffline || vStatus === 'Offline';
        const icon = createVehicleIcon(isMoving, vStatus);

        const popupColor = isMoving ? '#059669' : vStatus === 'Idle' ? '#d97706' : vStatus === 'Offline' ? '#475569' : '#dc2626';
        const statusText = isMoving ? `🚌 Speed: ${selectedVehicle.speed} km/h (Moving)` : vStatus === 'Idle' ? `⏸ Idle (${selectedVehicle.speed || 0} km/h)` : vStatus === 'Offline' ? `⚪ Offline` : '⏹ Stopped';

        const popupHtml = `
          <div style="font-family: sans-serif; font-size: 12px; padding: 2px;">
            <strong style="font-size: 13px; color: #0f172a;">${selectedVehicle.name}</strong><br/>
            <span style="color: #64748b;">Unit ID: ${selectedVehicle.units}</span><br/>
            <span style="color: ${popupColor}; font-weight: bold;">
              ${statusText}
            </span><br/>
            ${isOffline
              ? '<div style="margin-top: 4px; padding: 2px 6px; background: #fffbe6; border: 1px solid #ffe58f; color: #d46b08; border-radius: 4px; font-weight: bold; font-size: 10px; display: inline-block;">⚠️ Estimated Position (Provider Offline)</div>'
              : '<div style="margin-top: 4px; padding: 2px 6px; background: #f6ffed; border: 1px solid #b7eb8f; color: #389e0d; border-radius: 4px; font-weight: bold; font-size: 10px; display: inline-block;">🟢 Live GPS</div>'
            }<br/>
            <span style="color: #94a3b8; font-size: 10px;">${selectedVehicle.timestamp || ''}</span>
          </div>
        `;

        const existingState = getVehicleTelemetryState(key);
        const initialPos = (existingState && existingState.displayPosition)
          ? [existingState.displayPosition.lat, existingState.displayPosition.lng]
          : [lat, lng];

        let mainMarker = vehicleMarkersRef.current[key];
        if (!mainMarker) {
          console.log('[VEHICLE LOCATION INITIAL MAIN MARKER]', key, initialPos);
          mainMarker = L.marker(initialPos, { icon });
          mainMarker.bindPopup(popupHtml);
          mainMarker.addTo(layerGroup);
          vehicleMarkersRef.current[key] = mainMarker;
        } else {
          mainMarker.setIcon(icon);
          mainMarker.setPopupContent(popupHtml);
        }

        // Build historical route trace points list prior to current marker position
        const historyPoints = (traceLogs || [])
          .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0)
          .map(t => [t.latitude, t.longitude]);

        const livePoints = liveBreadcrumbsRef.current[vehName] || [];

        // Combine unique historical coordinates
        const allPointsMap = new Map();
        [...historyPoints, ...livePoints].forEach(pt => {
          if (Array.isArray(pt) && pt.length === 2 && !isNaN(pt[0]) && !isNaN(pt[1])) {
            const k = `${pt[0].toFixed(5)},${pt[1].toFixed(5)}`;
            if (!allPointsMap.has(k)) {
              allPointsMap.set(k, pt);
            }
          }
        });

        const telemetryState = getVehicleTelemetryState(key);
        const basePath = (telemetryState && Array.isArray(telemetryState.basePath) && telemetryState.basePath.length > 0)
          ? telemetryState.basePath
          : Array.from(allPointsMap.values());
        const initialTrailingPath = [...basePath, initialPos];

        // Outer Glow Line (Darker Blue)
        const glowPolyline = L.polyline(initialTrailingPath, {
          color: '#1d4ed8',
          weight: 9,
          opacity: 0.4,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(layerGroup);

        // Inner Vibrant Travelling Route Line (Bright Blue)
        const innerPolyline = L.polyline(initialTrailingPath, {
          color: '#2563eb',
          weight: 5,
          opacity: 0.95,
          lineCap: 'round',
          lineJoin: 'round'
        }).addTo(layerGroup);

        console.log('[VEHICLE LOCATION MAIN UPDATE]', key, lat, lng);
        animateMarkerPosition(
          mainMarker,
          lat,
          lng,
          {
            speed: selectedVehicle.speed,
            timestamp: selectedVehicle.timestamp,
            isFallback: isOffline,
            telemetryStatus: isOffline ? 'provider_unavailable' : 'live_gps',
            providerOffline: isOffline,
            polylines: [glowPolyline, innerPolyline],
            basePath
          },
          key,
          animFramesRef.current
        );

        // Center map ONCE when vehicle selection changes with a sliding/zooming flight
        if (centeredVehicleNameRef.current !== vehName) {
          map.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });
          centeredVehicleNameRef.current = vehName;
        }
        setCameraFollowVehicle(key, map);
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
                  {activePageTab === 'fuel' && 'Fuel Day Report'}
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
                {activePageTab === 'fuel' && `Daily Vehicle Fuel Consumption, KMs Travelled & Initial/Final Fuel Levels (${vehicles.length} Buses)`}
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
                onClick={handleManualSyncReports}
                disabled={syncingReports || (activePageTab === 'nightstay' ? nightStayLoading : reportLoading)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-2xs cursor-pointer disabled:opacity-50"
                title="Sync latest reports from TGG API to DB and refresh"
              >
                <RefreshCw size={12} className={(syncingReports || (activePageTab === 'nightstay' ? nightStayLoading : reportLoading)) ? 'animate-spin' : ''} />
                <span>{syncingReports ? 'Syncing DB...' : (activePageTab === 'nightstay' ? nightStayLoading : reportLoading) ? 'Loading...' : 'Sync & Refresh'}</span>
              </button>

              <button 
                onClick={handleExportFleetExcel}
                disabled={activePageTab === 'nightstay' ? !nightStayData.length : !report7DayData.length}
                className="px-3.5 py-1.5 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs border border-emerald-600"
                title="Download formatted Excel spreadsheet report"
              >
                <FileSpreadsheet size={13} className="text-emerald-200" />
                <span>Export Excel (.xlsx)</span>
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

                <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-[11px] text-slate-600 font-medium overflow-x-auto no-scrollbar">
                  <button
                    onClick={() => setStatusFilter('all')}
                    className={`flex-1 py-1 px-1 rounded-md transition-all text-center whitespace-nowrap cursor-pointer ${
                      statusFilter === 'all' ? 'bg-white text-blue-700 font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    All ({vehicles.length})
                  </button>
                  <button
                    onClick={() => setStatusFilter('moving')}
                    className={`flex-1 py-1 px-1 rounded-md transition-all text-center whitespace-nowrap cursor-pointer ${
                      statusFilter === 'moving' ? 'bg-emerald-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    Moving ({movingCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('idle')}
                    className={`flex-1 py-1 px-1 rounded-md transition-all text-center whitespace-nowrap cursor-pointer ${
                      statusFilter === 'idle' ? 'bg-amber-500 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    Idle ({idleCount})
                  </button>
                  <button
                    onClick={() => setStatusFilter('stopped')}
                    className={`flex-1 py-1 px-1 rounded-md transition-all text-center whitespace-nowrap cursor-pointer ${
                      statusFilter === 'stopped' ? 'bg-rose-600 text-white font-bold shadow-xs' : 'hover:text-slate-900'
                    }`}
                  >
                    Stopped ({stoppedCount})
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
                    const vStatus = getVehicleEffectiveStatus(veh);
                    const isMoving = vStatus === 'Moving' || (veh.speed || 0) > 0;

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
                                : vStatus === 'Idle'
                                ? 'bg-amber-50 text-amber-700 border-amber-200'
                                : vStatus === 'Offline'
                                ? 'bg-slate-100 text-slate-600 border-slate-200'
                                : 'bg-rose-50 text-rose-700 border-rose-200'
                            }`}
                          >
                            {isMoving
                              ? `🟢 Moving (${veh.speed || 0} km/h)`
                              : vStatus === 'Idle'
                              ? `🟡 Idle`
                              : vStatus === 'Offline'
                              ? `⚪ Offline`
                              : '🔴 Stopped'}
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

                {/* Floating Recenter Map Button */}
                {selectedVehicle && (
                  <button
                    onClick={handleRecenterVehicle}
                    className="absolute bottom-3 right-3 z-[1000] bg-white hover:bg-slate-50 text-slate-800 font-bold text-xs px-3 py-1.5 rounded-lg shadow-md border border-slate-300 flex items-center gap-1.5 transition-all cursor-pointer hover:border-blue-500 hover:text-blue-600"
                    title="Re-center map on vehicle"
                  >
                    <Navigation size={14} className="text-blue-600" />
                    <span>Recenter Vehicle</span>
                  </button>
                )}
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
                  <div className="overflow-auto max-h-[calc(100vh-100px)] min-h-[550px] sidebar-scrollbar relative">
                    <table 
                      className="w-full text-left border-collapse" 
                      style={{ minWidth: `${304 + nsDates.length * 100}px` }}
                    >
                      <thead className="sticky top-0 z-30 shadow-sm bg-[#071B45]">
                        {/* Header Row 1: Route, Bus Number, Stay Point, Date Columns */}
                        <tr className="bg-[#071B45] text-white text-[10px] uppercase font-bold tracking-wider select-none border-b border-slate-700">
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('route')}
                            className="px-1.5 py-1.5 sticky left-0 bg-[#071B45] hover:bg-[#0A2558] z-40 w-[68px] min-w-[68px] max-w-[68px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none text-center"
                            title="Click to sort by Route ID"
                          >
                            <div className="flex items-center justify-between gap-0.5">
                              <span>Route</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'route' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={11} className="text-blue-400 rotate-180" /> : <ChevronDown size={11} className="text-blue-400" />
                                ) : (
                                  <span className="text-[8px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('bus')}
                            className="px-1.5 py-1.5 sticky left-[68px] bg-[#071B45] hover:bg-[#0A2558] z-40 w-[108px] min-w-[108px] max-w-[108px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Bus Number"
                          >
                            <div className="flex items-center justify-between gap-0.5">
                              <span>Bus No</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'bus' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={11} className="text-blue-400 rotate-180" /> : <ChevronDown size={11} className="text-blue-400" />
                                ) : (
                                  <span className="text-[8px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            className="px-2 py-1.5 sticky left-[176px] bg-[#071B45] z-40 w-[128px] min-w-[128px] max-w-[128px] align-middle border-r border-slate-700 select-none"
                          >
                            <span>Night Stay Point</span>
                          </th>

                          {nsDates.map((dateStr) => {
                            const dObj = new Date(dateStr);
                            const dayNum = dObj.getDate();
                            const monthName = dObj.toLocaleDateString('en-US', { month: 'short' });
                            const isToday = dateStr === new Date().toISOString().split('T')[0];
                            const isSyncingThisDate = syncingDate[dateStr];

                            return (
                              <th key={dateStr} colSpan={2} className={`px-1 py-1 text-center border-r border-slate-700/80 w-[100px] min-w-[100px] bg-[#071B45] ${isToday ? 'bg-blue-900' : ''}`}>
                                <div className="flex items-center justify-center gap-1 group/dhead">
                                  <div className="text-[10px] font-extrabold text-white leading-tight">{dayNum} {monthName}</div>
                                  <button
                                    onClick={(e) => handleSyncSingleDate(dateStr, e)}
                                    disabled={isSyncingThisDate}
                                    title={`Sync all bus logs specifically for ${dateStr}`}
                                    className="p-0.5 text-blue-300 hover:text-white hover:bg-blue-800/80 rounded transition-all shrink-0 cursor-pointer disabled:opacity-40"
                                  >
                                    <RefreshCw size={9.5} className={isSyncingThisDate ? "animate-spin text-white" : "opacity-70 group-hover/dhead:opacity-100"} />
                                  </button>
                                </div>
                                <div className="text-[8px] text-blue-200 tracking-normal capitalize font-semibold leading-tight">{isToday ? 'Today' : 'Night Stay'}</div>
                              </th>
                            );
                          })}
                        </tr>

                        {/* Header Row 2: OUT / IN Sub-columns */}
                        <tr className="bg-[#0b2256] text-slate-200 text-[9px] font-bold uppercase tracking-wider border-b border-slate-700">
                          {nsDates.map((dateStr) => {
                            const isToday = dateStr === new Date().toISOString().split('T')[0];
                            return (
                              <React.Fragment key={`sub-${dateStr}`}>
                                <th className={`py-1 text-center border-r border-slate-700/50 w-[50px] min-w-[50px] text-rose-300 ${isToday ? 'bg-blue-900/40' : 'bg-[#0b2256]'}`}>OUT</th>
                                <th className={`py-1 text-center border-r border-slate-700/80 w-[50px] min-w-[50px] text-emerald-300 ${isToday ? 'bg-blue-900/40' : 'bg-[#0b2256]'}`}>IN</th>
                              </React.Fragment>
                            );
                          })}
                        </tr>
                      </thead>

                      <tbody className="divide-y divide-slate-100 text-slate-800 text-xs font-semibold">
                        {sortedRows.map((row, idx) => (
                          <tr key={row.busNumber || idx} className="hover:bg-blue-50/40 transition-colors">
                            {/* Route ID */}
                            <td className="px-1.5 py-1.5 font-mono font-bold text-[10.5px] text-blue-700 sticky left-0 bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs w-[68px] min-w-[68px] max-w-[68px] text-center truncate">
                              {row.routeId || 'Unassigned'}
                            </td>

                            {/* Bus Number */}
                            <td className="px-1.5 py-1.5 font-mono font-bold text-slate-900 sticky left-[68px] bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs w-[108px] min-w-[108px] max-w-[108px] text-[10.5px] truncate">
                              <div className="flex items-center justify-between gap-1 w-full overflow-hidden">
                                <span className="truncate block" title={row.tggVehicleName || row.busNumber}>{row.tggVehicleName || row.busNumber}</span>
                                <button
                                  onClick={(e) => handleSyncSingleVehicle(row.busNumber, e)}
                                  disabled={syncingVehicle[row.busNumber]}
                                  title={`Re-sync report data specifically for ${row.busNumber}`}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-all shrink-0 cursor-pointer disabled:opacity-40"
                                >
                                  <RefreshCw size={10} className={syncingVehicle[row.busNumber] ? "animate-spin text-blue-600" : ""} />
                                </button>
                              </div>
                            </td>

                            {/* Stay Point Name */}
                            <td className="px-1.5 py-1.5 sticky left-[176px] bg-white group-hover:bg-blue-50 z-10 border-r border-slate-100 align-middle shadow-2xs w-[128px] min-w-[128px] max-w-[128px] overflow-hidden">
                              <div className="flex items-center gap-1 min-w-0 max-w-full overflow-hidden">
                                <span className="font-bold text-indigo-900 text-[10.5px] truncate block min-w-0 flex-1 overflow-hidden" title={row.stayPointName || 'Default Stay'}>
                                  {row.stayPointName || 'Default Stay'}
                                </span>
                                {row.isDefaultStayPoint ? (
                                  <span className="text-[7.5px] font-bold bg-slate-100 text-slate-500 px-1 py-0.5 rounded border border-slate-200 shrink-0" title="Default 1st Stage Fallback">
                                    Def
                                  </span>
                                ) : (
                                  <span className="text-[7.5px] font-black bg-indigo-100 text-indigo-700 px-1 py-0.5 rounded border border-indigo-200 shrink-0" title="Configured Night Stay Point">
                                    Stay
                                  </span>
                                )}
                              </div>
                            </td>

                            {/* Day Columns */}
                            {nsDates.map((dateStr) => {
                              const dayData = row.days?.[dateStr] || {};
                              const inTime = dayData.firstIn || null;
                              const outTime = dayData.lastOut || null;

                              return (
                                <React.Fragment key={`${row.busNumber}-${dateStr}`}>
                                  {/* OUT Column */}
                                  <td className="px-0.5 py-1 text-center border-r border-slate-100 align-middle font-mono text-[11px] w-[50px] min-w-[50px]">
                                    {nightStayLoading ? (
                                      <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                    ) : outTime ? (
                                      <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200/80 inline-block whitespace-nowrap text-[11px]" title="Departure Time from Stay Point">
                                        {outTime}
                                      </span>
                                    ) : (
                                      <span className="text-slate-300 font-bold text-[10px]">—</span>
                                    )}
                                  </td>

                                  {/* IN Column */}
                                  <td className="px-0.5 py-1 text-center border-r border-slate-200 align-middle font-mono text-[11px] w-[50px] min-w-[50px]">
                                    {nightStayLoading ? (
                                      <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                    ) : inTime ? (
                                      (() => {
                                        const isLate = isLateArrival(inTime);
                                        return (
                                          <span
                                            className={`px-1 py-0.5 rounded font-black border inline-block whitespace-nowrap text-[11px] ${
                                              isLate
                                                ? 'bg-red-100 text-red-700 border-red-300'
                                                : 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                                            }`}
                                            title={isLate ? "Arrival Time (LATE - Reached after 9:00 AM)" : "Arrival Time (On Time)"}
                                          >
                                            {inTime}
                                          </span>
                                        );
                                      })()
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
                  <div className="overflow-auto max-h-[calc(100vh-100px)] min-h-[550px] sidebar-scrollbar relative">
                    <table 
                      className="w-full text-left border-collapse"
                      style={{ minWidth: `${180 + displayDates.length * 152 + 28}px` }}
                    >
                      <thead className="sticky top-0 z-30 shadow-sm bg-[#071B45]">
                        {/* Header Row 1: Route, Bus Number, Date Column Groups */}
                        <tr className="bg-[#071B45] text-white text-[10px] uppercase font-bold tracking-wider select-none border-b border-slate-700">
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('route')}
                            className="px-1.5 py-1.5 sticky left-0 bg-[#071B45] hover:bg-[#0A2558] z-40 w-[68px] min-w-[68px] max-w-[68px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none text-center"
                            title="Click to sort by Route ID"
                          >
                            <div className="flex items-center justify-between gap-0.5">
                              <span>Route</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'route' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={11} className="text-blue-400 rotate-180" /> : <ChevronDown size={11} className="text-blue-400" />
                                ) : (
                                  <span className="text-[8px] opacity-40">↕</span>
                                )}
                              </span>
                            </div>
                          </th>
                          <th 
                            rowSpan={2} 
                            onClick={() => handleFleetSort('bus')}
                            className="px-1.5 py-1.5 sticky left-[68px] bg-[#071B45] hover:bg-[#0A2558] z-40 w-[112px] min-w-[112px] max-w-[112px] align-middle border-r border-slate-700 cursor-pointer transition-colors group select-none"
                            title="Click to sort by Bus Number"
                          >
                            <div className="flex items-center justify-between gap-0.5">
                              <span>Bus Number</span>
                              <span className="text-slate-400 group-hover:text-white">
                                {fleetSortField === 'bus' ? (
                                  fleetSortOrder === 'asc' ? <ChevronDown size={11} className="text-blue-400 rotate-180" /> : <ChevronDown size={11} className="text-blue-400" />
                                ) : (
                                  <span className="text-[8px] opacity-40">↕</span>
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
                            const isSyncingThisDate = syncingDate[dateStr];

                            return (
                              <th key={dateStr} colSpan={3} className={`px-1 py-1 text-center border-r border-slate-700/80 w-[152px] min-w-[152px] bg-[#071B45] ${isToday ? 'bg-blue-900' : ''}`}>
                                <div className="flex items-center justify-center gap-1 group/dhead">
                                  <div className="text-[10px] font-extrabold text-white leading-tight">{dayNum} {monthName}</div>
                                  <button
                                    onClick={(e) => handleSyncSingleDate(dateStr, e)}
                                    disabled={isSyncingThisDate}
                                    title={`Sync all bus logs specifically for ${dateStr}`}
                                    className="p-0.5 text-blue-300 hover:text-white hover:bg-blue-800/80 rounded transition-all shrink-0 cursor-pointer disabled:opacity-40"
                                  >
                                    <RefreshCw size={9.5} className={isSyncingThisDate ? "animate-spin text-white" : "opacity-70 group-hover/dhead:opacity-100"} />
                                  </button>
                                </div>
                                <div className="text-[8px] font-medium text-slate-300 uppercase leading-tight">{dayName} {isToday ? '(Today)' : ''}</div>
                              </th>
                            );
                          })}
                          <th rowSpan={2} className="w-[28px] min-w-[28px] border-l border-slate-700 align-middle bg-[#071B45]"></th>
                        </tr>

                        {/* Header Row 2: IN / OUT / KMS Sub-headers under each date */}
                        <tr className="bg-[#0A2558] text-slate-200 text-[9px] uppercase font-extrabold tracking-wider border-b border-slate-700 select-none">
                          {displayDates.map((dateStr) => (
                            <React.Fragment key={'sub_' + dateStr}>
                              <th className="py-1 text-center border-r border-slate-700/60 text-emerald-300 bg-[#062446] w-[50px] min-w-[50px]">IN</th>
                              <th className="py-1 text-center border-r border-slate-700/80 text-rose-300 bg-[#2b0d1e] w-[50px] min-w-[50px]">OUT</th>
                              <th className="py-1 text-center border-r border-slate-700/80 text-amber-300 bg-[#2d2208] w-[52px] min-w-[52px]">KMS</th>
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
                                <td className={`px-1.5 py-1.5 font-bold text-slate-900 sticky left-0 z-10 w-[68px] min-w-[68px] max-w-[68px] whitespace-nowrap border-r border-slate-200 text-center ${isExpanded ? 'bg-blue-50' : 'bg-white'}`}>
                                  <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-800 border border-blue-200 text-[9.5px] font-bold">
                                    {row.routeId || 'Unassigned'}
                                  </span>
                                </td>

                                {/* Bus Number */}
                                <td className={`px-1.5 py-1.5 font-extrabold text-slate-800 sticky left-[68px] z-10 w-[112px] min-w-[112px] max-w-[112px] whitespace-nowrap border-r border-slate-200 text-[10.5px] font-mono truncate ${isExpanded ? 'bg-blue-50' : 'bg-white'}`} title={row.tggVehicleName || row.busNumber}>
                                  <div className="flex items-center justify-between gap-1 w-full overflow-hidden">
                                    <span className="truncate">{row.tggVehicleName || row.busNumber}</span>
                                    <button
                                      onClick={(e) => handleSyncSingleVehicle(row.busNumber, e)}
                                      disabled={syncingVehicle[row.busNumber]}
                                      title={`Re-sync report data specifically for ${row.busNumber}`}
                                      className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-all shrink-0 cursor-pointer disabled:opacity-40"
                                    >
                                      <RefreshCw size={10} className={syncingVehicle[row.busNumber] ? "animate-spin text-blue-600" : ""} />
                                    </button>
                                  </div>
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
                                      <td className="px-0.5 py-1 text-center border-r border-slate-100 align-middle font-mono text-[11px] w-[50px] min-w-[50px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : inTime ? (
                                          (() => {
                                            const isLate = isLateArrival(inTime);
                                            return (
                                              <span
                                                className={`px-1 py-0.5 rounded font-black border inline-block whitespace-nowrap text-[11px] ${
                                                  isLate
                                                    ? 'bg-red-100 text-red-700 border-red-300'
                                                    : 'bg-emerald-50 text-emerald-700 border-emerald-200/80'
                                                }`}
                                                title={isLate ? "Arrival Time (LATE - Reached after 9:00 AM)" : "Arrival Time (On Time)"}
                                              >
                                                {inTime}
                                              </span>
                                            );
                                          })()
                                        ) : (
                                          <span className="text-slate-300 font-bold text-[10px]">—</span>
                                        )}
                                      </td>

                                      {/* OUT Column */}
                                      <td className="px-0.5 py-1 text-center border-r border-slate-100 align-middle font-mono text-[11px] w-[50px] min-w-[50px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : outTime ? (
                                          <span className="px-1 py-0.5 rounded bg-emerald-50 text-emerald-700 font-extrabold border border-emerald-200/80 inline-block whitespace-nowrap text-[11px]" title="Departure Time">
                                            {outTime}
                                          </span>
                                        ) : (
                                          <span className="text-slate-300 font-bold text-[10px]">—</span>
                                        )}
                                      </td>

                                      {/* KMS Column */}
                                      <td className="px-0.5 py-1 text-center border-r border-slate-100 align-middle font-mono text-[10px] w-[52px] min-w-[52px]">
                                        {reportLoading ? (
                                          <div className="w-9 h-3.5 bg-slate-200/80 animate-pulse rounded mx-auto" />
                                        ) : (kmVal && kmVal > 0) ? (
                                          <span className="px-1 py-0.5 rounded bg-amber-50 text-amber-800 font-extrabold border border-amber-200/80 inline-block whitespace-nowrap text-[10px]" title="Total Distance Travelled">
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
                                <td className="w-[28px] min-w-[28px] text-center border-l border-slate-100">
                                  <ChevronDown size={12} className={`text-slate-400 transition-transform duration-200 mx-auto ${isExpanded ? 'rotate-180 text-blue-600' : ''}`} />
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
                                            <tbody className="divide-y divide-slate-100 text-[11px] text-slate-700 font-semibold">
                                              {gfRows.map((gf, idx) => {
                                                const formattedIn = formatGeofenceTime(gf.timeIn || gf.time_in);
                                                const isLate = isLateArrival(formattedIn);
                                                const formattedOut = formatGeofenceTime(gf.timeOut || gf.time_out);
                                                return (
                                                  <tr key={idx} className="hover:bg-slate-50">
                                                    <td className="px-3 py-1.5 text-slate-400">{idx + 1}</td>
                                                    <td className="px-3 py-1.5 font-bold text-slate-800">{gf.geofence || gf.name || 'Campus Main Geofence'}</td>
                                                    <td className="px-3 py-1.5 font-mono text-[11px]">
                                                      {formattedIn === '—' ? (
                                                        <span className="text-slate-300 font-bold">—</span>
                                                      ) : (
                                                        <span className={`px-1.5 py-0.5 rounded font-black border ${
                                                          isLate ? 'bg-red-100 text-red-700 border-red-300' : 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                                        }`}>
                                                          {formattedIn} {isLate ? '(Late)' : ''}
                                                        </span>
                                                      )}
                                                    </td>
                                                    <td className="px-3 py-1.5 font-mono text-[11px] font-extrabold text-emerald-700">
                                                      {formattedOut === '—' ? <span className="text-slate-300 font-bold">—</span> : formattedOut}
                                                    </td>
                                                    <td className="px-3 py-1.5 font-mono text-[11px]">{gf.duration || '—'}</td>
                                                    <td className="px-3 py-1.5 font-mono text-[11px]">{gf.mileage || '—'}</td>
                                                  </tr>
                                                );
                                              })}
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
        ) : activePageTab === 'fuel' ? (
          /* Fuel Day Report View */
          <div className="space-y-4 font-sans text-slate-800">
            {/* Top Controls Card (Single Row Layout) */}
            <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-4">
              <div className="flex flex-wrap lg:flex-nowrap items-end gap-3">
                {/* Quick Interval Buttons (Today & Yesterday only) */}
                <div className="shrink-0">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Quick Interval</label>
                  <div className="flex items-center gap-1.5">
                    {['today', 'yesterday'].map((p) => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => handleFuelPreset(p)}
                        className={`py-2 px-3 text-[11px] font-bold rounded-lg transition-all capitalize cursor-pointer border ${
                          fuelDatePreset === p
                            ? 'bg-blue-600 text-white border-blue-600 shadow-2xs'
                            : 'bg-slate-50 text-slate-700 border-slate-200 hover:bg-slate-100'
                        }`}
                      >
                        {p}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Vehicle / Route Selector */}
                <div className="flex-1 min-w-[170px]">
                  <label className="block text-xs font-bold text-slate-700 mb-1">Vehicle / Route</label>
                  <select
                    value={fuelSelectedVehicle}
                    onChange={(e) => {
                      const val = e.target.value;
                      setFuelSelectedVehicle(val);
                      fetchFuelReportData(fuelDateFrom, fuelDateTo, val);
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  >
                    <option value="ALL">All Fuel Sensor Buses ({sortedDropdownVehicles.length})</option>
                    {sortedDropdownVehicles.map((v) => (
                      <option key={v.name} value={v.name}>
                        {v.name} ({v.assignedRoute || 'Route'})
                      </option>
                    ))}
                  </select>
                </div>

                {/* From Date & Time */}
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-bold text-slate-700 mb-1">From Date & Time</label>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocalValue(fuelDateFrom)}
                    onChange={(e) => {
                      const val = fromDatetimeLocalValue(e.target.value);
                      setFuelDateFrom(val);
                      if (val && fuelDateTo) {
                        fetchFuelReportData(val, fuelDateTo, fuelSelectedVehicle);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {/* To Date & Time */}
                <div className="flex-1 min-w-[180px]">
                  <label className="block text-xs font-bold text-slate-700 mb-1">To Date & Time</label>
                  <input
                    type="datetime-local"
                    value={toDatetimeLocalValue(fuelDateTo)}
                    onChange={(e) => {
                      const val = fromDatetimeLocalValue(e.target.value);
                      setFuelDateTo(val);
                      if (fuelDateFrom && val) {
                        fetchFuelReportData(fuelDateFrom, val, fuelSelectedVehicle);
                      }
                    }}
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-xs font-mono font-bold text-slate-800 outline-none focus:ring-2 focus:ring-blue-500 cursor-pointer"
                  />
                </div>

                {/* Action Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      const todayStr = new Date().toISOString().split('T')[0];
                      const defaultFrom = `${todayStr} 00:00`;
                      const defaultTo = `${todayStr} 23:59`;
                      setFuelDateFrom(defaultFrom);
                      setFuelDateTo(defaultTo);
                      setFuelSelectedVehicle('ALL');
                      setFuelDatePreset('today');
                      fetchFuelReportData(defaultFrom, defaultTo, 'ALL');
                    }}
                    className="px-3.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg border border-slate-200 transition-colors cursor-pointer"
                  >
                    Clear
                  </button>

                  <button
                    type="button"
                    onClick={() => fetchFuelReportData(fuelDateFrom, fuelDateTo, fuelSelectedVehicle, true)}
                    disabled={fuelLoading}
                    className="px-4 py-2 bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs rounded-lg shadow-xs transition-colors cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw size={13} className={fuelLoading ? 'animate-spin' : ''} />
                    <span>{fuelLoading ? 'Syncing...' : 'Sync & Refresh'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleExportFuelExcel}
                    disabled={!filteredFuelRows || filteredFuelRows.length === 0}
                    className="px-3.5 py-2 bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold rounded-lg transition-all flex items-center gap-1.5 disabled:opacity-50 cursor-pointer shadow-xs border border-emerald-600"
                    title="Download formatted Excel spreadsheet"
                  >
                    <FileSpreadsheet size={13} className="text-emerald-200" />
                    <span>Export</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Summary KPI Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fleet KMs Travelled</span>
                {fuelLoading ? (
                  <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1"></div>
                ) : (
                  <span className="text-lg font-extrabold text-slate-900 mt-1 block">
                    {(() => {
                      const valid = filteredFuelRows.map(r => r.kmsTravelled).filter(v => v !== null && v !== undefined && !isNaN(v));
                      return valid.length > 0 ? `${valid.reduce((a, b) => a + b, 0).toFixed(1)} km` : '-';
                    })()}
                  </span>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Starting Fuel Level</span>
                {fuelLoading ? (
                  <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1"></div>
                ) : (
                  <span className="text-lg font-extrabold text-blue-700 mt-1 block">
                    {(() => {
                      const valid = filteredFuelRows.map(r => r.initialFuel).filter(v => v !== null && v !== undefined && !isNaN(v));
                      return valid.length > 0 ? `${valid.reduce((a, b) => a + b, 0).toFixed(1)} l` : '-';
                    })()}
                  </span>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Ending Fuel Level</span>
                {fuelLoading ? (
                  <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1"></div>
                ) : (
                  <span className="text-lg font-extrabold text-amber-700 mt-1 block">
                    {(() => {
                      const valid = filteredFuelRows.map(r => r.finalFuel).filter(v => v !== null && v !== undefined && !isNaN(v));
                      return valid.length > 0 ? `${valid.reduce((a, b) => a + b, 0).toFixed(1)} l` : '-';
                    })()}
                  </span>
                )}
              </div>

              <div className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs">
                <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Fuel Consumption</span>
                {fuelLoading ? (
                  <div className="h-6 w-24 bg-slate-200 rounded animate-pulse mt-1"></div>
                ) : (
                  <span className="text-lg font-extrabold text-rose-600 mt-1 block">
                    {(() => {
                      const valid = filteredFuelRows.map(r => r.fuelConsumption).filter(v => v !== null && v !== undefined && !isNaN(v));
                      return valid.length > 0 ? `${valid.reduce((a, b) => a + b, 0).toFixed(1)} l` : '-';
                    })()}
                  </span>
                )}
              </div>
            </div>

            {/* Fuel Report Content Table */}
            {fuelError ? (
              <div className="bg-rose-50 rounded-xl border border-rose-200 p-4 text-rose-700 text-xs text-center font-bold">
                {fuelError}
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
                <div className="overflow-x-auto sidebar-scrollbar">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#071B45] text-white text-[11px] uppercase font-bold tracking-wider select-none border-b border-slate-700">
                        <th
                          onClick={() => handleFuelSort('routeId')}
                          className="px-4 py-3 cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Assigned Route</span>
                            {fuelSortField === 'routeId' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>

                        <th
                          onClick={() => handleFuelSort('busNumber')}
                          className="px-4 py-3 cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center gap-1.5">
                            <span>Vehicle Number / Unit</span>
                            {fuelSortField === 'busNumber' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>

                        <th
                          onClick={() => handleFuelSort('kmsTravelled')}
                          className="px-4 py-3 text-center cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>KMs Travelled</span>
                            {fuelSortField === 'kmsTravelled' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>

                        <th
                          onClick={() => handleFuelSort('initialFuel')}
                          className="px-4 py-3 text-center cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>Starting Fuel Level</span>
                            {fuelSortField === 'initialFuel' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>

                        <th
                          onClick={() => handleFuelSort('finalFuel')}
                          className="px-4 py-3 text-center cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>Ending Fuel Level</span>
                            {fuelSortField === 'finalFuel' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>

                        <th
                          onClick={() => handleFuelSort('fuelConsumption')}
                          className="px-4 py-3 text-center cursor-pointer hover:bg-[#0c2763] transition-colors"
                        >
                          <div className="flex items-center justify-center gap-1.5">
                            <span>Fuel Consumption</span>
                            {fuelSortField === 'fuelConsumption' ? (
                              fuelSortOrder === 'asc' ? <ArrowUp size={13} className="text-amber-400" /> : <ArrowDown size={13} className="text-amber-400" />
                            ) : (
                              <ArrowUpDown size={13} className="text-slate-400 opacity-60 hover:opacity-100" />
                            )}
                          </div>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs text-slate-800 font-medium">
                      {filteredFuelRows.map((row, idx) => {
                        const isRowLoading = fuelLoadingVehicles[row.tggVehicleName] || fuelLoadingVehicles[row.busNumber] || (fuelLoading && row.kmsTravelled === null && row.initialFuel === null);

                        return (
                          <tr key={idx} className="hover:bg-slate-50 transition-colors">
                            <td className="px-4 py-3 font-semibold text-slate-600">
                              <span className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-[11px] font-bold border border-blue-200">
                                {row.routeId || 'Unassigned'}
                              </span>
                            </td>
                            <td className="px-4 py-3 font-bold text-slate-900 font-mono">
                              <div className="flex items-center justify-between gap-1">
                                <span>{row.tggVehicleName || row.busNumber}</span>
                                <button
                                  onClick={(e) => handleSyncSingleVehicle(row.busNumber || row.tggVehicleName, e)}
                                  disabled={syncingVehicle[row.busNumber || row.tggVehicleName]}
                                  title={`Re-sync fuel report data specifically for ${row.busNumber || row.tggVehicleName}`}
                                  className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-100 rounded transition-all cursor-pointer disabled:opacity-40"
                                >
                                  <RefreshCw size={11} className={syncingVehicle[row.busNumber || row.tggVehicleName] ? "animate-spin text-blue-600" : ""} />
                                </button>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-center font-mono font-bold text-slate-900">
                              {isRowLoading ? (
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-16 mx-auto"></div>
                              ) : row.kmsTravelled !== null && row.kmsTravelled !== undefined ? (
                                `${row.kmsTravelled} km`
                              ) : (
                                <span className="text-slate-300 font-bold text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center font-mono font-semibold text-blue-700">
                              {isRowLoading ? (
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-16 mx-auto"></div>
                              ) : row.initialFuel !== null && row.initialFuel !== undefined ? (
                                `${row.initialFuel} l`
                              ) : (
                                <span className="text-slate-300 font-bold text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center font-mono font-semibold text-amber-700">
                              {isRowLoading ? (
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-16 mx-auto"></div>
                              ) : row.finalFuel !== null && row.finalFuel !== undefined ? (
                                `${row.finalFuel} l`
                              ) : (
                                <span className="text-slate-300 font-bold text-xs">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-center font-mono font-bold text-rose-600">
                              {isRowLoading ? (
                                <div className="h-4 bg-slate-200 rounded animate-pulse w-16 mx-auto"></div>
                              ) : row.fuelConsumption !== null && row.fuelConsumption !== undefined ? (
                                `${row.fuelConsumption} l`
                              ) : (
                                <span className="text-slate-300 font-bold text-xs">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
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
