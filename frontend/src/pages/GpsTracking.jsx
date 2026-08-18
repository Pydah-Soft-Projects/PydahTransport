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
  Map as MapIcon
} from 'lucide-react';

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
  }, [isLeafletReady, selectedVehicle, filteredVehicles, traceLogs, createVehicleIcon]);

  return (
    <Layout>
      <div className="space-y-4 font-sans text-slate-800">
        {/* Compact Header matching site style */}
        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
              <Navigation size={18} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">
                  GPS Live Fleet Tracking
                </h1>
                <span className="px-2 py-0.5 text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200 rounded-md flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-ping" /> Live
                </span>
              </div>
              <p className="text-xs text-slate-500 mt-1">
                {selectedVehicle ? `Tracing Vehicle: ${selectedVehicle.name}` : `All Vehicles Fleet Map (${vehicles.length} Vehicles)`} • Updated: {lastUpdated.toLocaleTimeString()}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap text-xs">
            {/* Show All Vehicles Mode Switch Button */}
            <button
              onClick={() => handleSelectVehicle(null)}
              className={`flex items-center gap-1.5 px-3 py-1.5 font-bold rounded-lg transition-all border ${
                selectedVehicle === null
                  ? 'bg-blue-600 text-white border-blue-600 shadow-sm'
                  : 'bg-white hover:bg-slate-50 text-slate-700 border-slate-200'
              }`}
            >
              <Layers size={14} />
              <span>All Vehicles Map</span>
            </button>

            <button
              onClick={loadVehicles}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold rounded-lg border border-slate-200 transition-colors"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>
        </div>

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
            <div className="flex-1 rounded-lg border border-slate-200 overflow-hidden relative w-full h-full min-h-[440px]">
              <div ref={mapContainerRef} className="w-full h-full min-h-[440px] z-0" />
            </div>

            {/* Fast Trace Points Table when a vehicle is selected */}
            {selectedVehicle && (
              <div className="bg-slate-50 rounded-lg border border-slate-200 p-2.5 text-xs space-y-1.5 max-h-36 overflow-y-auto">
                <div className="flex items-center justify-between font-bold text-slate-700 border-b border-slate-200 pb-1">
                  <span className="flex items-center gap-1.5 text-blue-700">
                    <Zap size={13} className="text-amber-500" />
                    Fast Location History Points ({selectedVehicle.name})
                  </span>
                  {traceLoading && (
                    <span className="flex items-center gap-1 text-[11px] text-slate-500">
                      <RefreshCw size={12} className="animate-spin text-blue-600" /> Fetching points...
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  {traceLogs.length === 0 ? (
                    <p className="text-slate-400 italic text-[11px]">
                      {traceLoading ? 'Loading trace points...' : 'No historical position points recorded for this vehicle today.'}
                    </p>
                  ) : (
                    traceLogs.map((log, idx) => (
                      <div key={idx} className="flex items-center justify-between font-mono text-[11px] bg-white p-1 rounded border border-slate-200">
                        <span className="text-slate-600">{log.timestamp || `Point #${idx + 1}`}</span>
                        <span className="text-slate-800">
                          Lat: {log.latitude}, Long: {log.longitude}
                        </span>
                        <span className="font-semibold text-emerald-700">{log.speed} km/h</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
}
