import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, API_BASE } from '../utils/api';
import { Save, Loader2, Crosshair, MapPin, Eye, Plus, X, Clock, Calendar, AlertCircle } from 'lucide-react';

const DEFAULT_CENTER = { lat: 16.9891, lng: 82.2475 };
const DEFAULT_RADIUS = 200;

export default function GpsFinalDestinationModal({ campuses = [] }) {
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedCampus, setSelectedCampus] = useState('');
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [morningStart, setMorningStart] = useState('07:00');
  const [morningEnd, setMorningEnd] = useState('09:30');
  const [eveningStart, setEveningStart] = useState('16:00');
  const [eveningEnd, setEveningEnd] = useState('19:00');
  
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const [savedDestinations, setSavedDestinations] = useState([]);
  const [destsLoading, setDestsLoading] = useState(false);

  // In/Out Report States
  const [selectedReportCampus, setSelectedReportCampus] = useState(null);
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportDate, setReportDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportError, setReportError] = useState(null);

  const mapContainerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const circleRef = useRef(null);
  const allDestsLayerRef = useRef(null);

  const clearMapLayers = useCallback(() => {
    if (markerRef.current) { markerRef.current.remove(); markerRef.current = null; }
    if (circleRef.current) { circleRef.current.remove(); circleRef.current = null; }
  }, []);

  const placeMarker = useCallback((lat, lng, r, flyTo = true) => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    clearMapLayers();

    markerRef.current = L.marker([lat, lng], { draggable: true }).addTo(map);

    circleRef.current = L.circle([lat, lng], {
      radius: r || DEFAULT_RADIUS,
      color: '#ef4444',
      fillColor: '#ef4444',
      fillOpacity: 0.15,
      weight: 2,
      dashArray: '6 4',
    }).addTo(map);

    markerRef.current.on('dragend', (e) => {
      const pos = e.target.getLatLng();
      const newLat = parseFloat(pos.lat.toFixed(6));
      const newLng = parseFloat(pos.lng.toFixed(6));
      setLatitude(newLat);
      setLongitude(newLng);
      if (circleRef.current) circleRef.current.setLatLng([newLat, newLng]);
    });

    if (flyTo) map.flyTo([lat, lng], 15, { duration: 0.6 });
  }, [clearMapLayers]);

  const loadAllDestinations = useCallback(async () => {
    setDestsLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/gps/final-destinations`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setSavedDestinations(json.data);
      }
    } catch { /* ignore */ } finally {
      setDestsLoading(false);
    }
  }, []);

  // Show all saved destinations as translucent circles on the map
  useEffect(() => {
    const L = window.L;
    const map = mapRef.current;
    if (!L || !map) return;

    if (allDestsLayerRef.current) {
      allDestsLayerRef.current.clearLayers();
    } else {
      allDestsLayerRef.current = L.layerGroup().addTo(map);
    }

    savedDestinations.forEach((d) => {
      if (!Number.isFinite(d.latitude) || !Number.isFinite(d.longitude)) return;
      L.circle([d.latitude, d.longitude], {
        radius: d.radius || 200,
        color: '#6366f1',
        fillColor: '#818cf8',
        fillOpacity: 0.08,
        weight: 1.5,
        dashArray: '4 3',
      }).addTo(allDestsLayerRef.current);

      L.marker([d.latitude, d.longitude], {
        icon: L.divIcon({
          className: '',
          html: `<div style="background:#6366f1;color:#fff;font-size:9px;font-weight:700;padding:2px 6px;border-radius:6px;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.3)">${d.name}</div>`,
          iconAnchor: [0, 0],
        }),
      }).addTo(allDestsLayerRef.current);
    });
  }, [savedDestinations]);

  // Init map on mount
  useEffect(() => {
    const L = window.L;
    if (!L || !mapContainerRef.current) return;

    const timer = setTimeout(() => {
      if (mapRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [DEFAULT_CENTER.lat, DEFAULT_CENTER.lng],
        zoom: 13,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomleft' }).addTo(map);

      L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
        maxZoom: 20,
        subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
        attribution: '© Google Maps',
      }).addTo(map);

      map.on('click', (e) => {
        const lat = parseFloat(e.latlng.lat.toFixed(6));
        const lng = parseFloat(e.latlng.lng.toFixed(6));
        
        // Auto-open form on map click if not already open
        setIsFormOpen(true);
        setLatitude(lat);
        setLongitude(lng);
        placeMarker(lat, lng, radius);
      });

      mapRef.current = map;
      loadAllDestinations();
    }, 250);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Remove editing markers if form is closed
  useEffect(() => {
    if (!isFormOpen) {
      clearMapLayers();
    }
  }, [isFormOpen, clearMapLayers]);

  useEffect(() => {
    if (circleRef.current && Number.isFinite(Number(radius))) {
      circleRef.current.setRadius(Number(radius));
    }
  }, [radius]);

  // Fetch existing destination details when campus changes
  useEffect(() => {
    if (!selectedCampus) return;

    setLoading(true);
    setMessage(null);
    setName('');
    setLatitude('');
    setLongitude('');
    setRadius(DEFAULT_RADIUS);
    setMorningStart('07:00');
    setMorningEnd('09:30');
    setEveningStart('16:00');
    setEveningEnd('19:00');
    clearMapLayers();

    (async () => {
      try {
        const res = await apiFetch(`${API_BASE}/gps/final-destination?campus=${selectedCampus}`);
        const json = await res.json();
        if (json.success && json.data) {
          setName(json.data.name || '');
          setLatitude(json.data.latitude);
          setLongitude(json.data.longitude);
          setRadius(json.data.radius || DEFAULT_RADIUS);
          setMorningStart(json.data.morningStart || '07:00');
          setMorningEnd(json.data.morningEnd || '09:30');
          setEveningStart(json.data.eveningStart || '16:00');
          setEveningEnd(json.data.eveningEnd || '19:00');

          setTimeout(() => {
            placeMarker(json.data.latitude, json.data.longitude, json.data.radius || DEFAULT_RADIUS);
          }, 300);
        }
      } catch {
        // no saved destination yet
      } finally {
        setLoading(false);
      }
    })();
  }, [selectedCampus, clearMapLayers, placeMarker]);

  const handleSave = async () => {
    if (!selectedCampus) return setMessage({ type: 'error', text: 'Please select a campus' });
    if (!name.trim()) return setMessage({ type: 'error', text: 'Please enter a location name' });
    if (!Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude)) || latitude === '' || longitude === '') {
      return setMessage({ type: 'error', text: 'Click the map to set a location' });
    }

    setSaving(true);
    setMessage(null);
    try {
      const res = await apiFetch(`${API_BASE}/gps/final-destination`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          campus: Number(selectedCampus),
          latitude: Number(latitude),
          longitude: Number(longitude),
          radius: Number(radius) || DEFAULT_RADIUS,
          morningStart,
          morningEnd,
          eveningStart,
          eveningEnd
        }),
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ type: 'success', text: 'Final destination saved successfully!' });
        loadAllDestinations();
        setTimeout(() => {
          setIsFormOpen(false);
          setSelectedCampus('');
          setName('');
          setLatitude('');
          setLongitude('');
          setMessage(null);
        }, 1200);
      } else {
        setMessage({ type: 'error', text: json.message || 'Save failed' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (dest) => {
    setSelectedCampus(String(dest.campus));
    setName(dest.name);
    setLatitude(dest.latitude);
    setLongitude(dest.longitude);
    setRadius(dest.radius || DEFAULT_RADIUS);
    setMorningStart(dest.morningStart || '07:00');
    setMorningEnd(dest.morningEnd || '09:30');
    setEveningStart(dest.eveningStart || '16:00');
    setEveningEnd(dest.eveningEnd || '19:00');
    setIsFormOpen(true);
    
    // Zoom/Fly to marker location on map
    setTimeout(() => {
      placeMarker(dest.latitude, dest.longitude, dest.radius || DEFAULT_RADIUS);
    }, 100);
  };

  const handleViewOnMap = (dest) => {
    const map = mapRef.current;
    if (map && dest.latitude && dest.longitude) {
      map.flyTo([dest.latitude, dest.longitude], 15, { duration: 0.8 });
    }
  };

  // Load In/Out Report for selected campus destination
  const loadReport = useCallback(async (campusId, dateVal) => {
    setReportLoading(true);
    setReportError(null);
    try {
      const res = await apiFetch(`${API_BASE}/gps/final-destination/report?campus=${campusId}&date=${dateVal}`);
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setReportData(json.data);
      } else {
        setReportError(json.message || 'Failed to load geofence report.');
      }
    } catch (err) {
      setReportError(err.message || 'Network error loading report.');
    } finally {
      setReportLoading(false);
    }
  }, []);

  const handleOpenReport = (dest) => {
    setSelectedReportCampus(dest);
    setReportData([]);
    loadReport(dest.campus, reportDate);
  };

  useEffect(() => {
    if (selectedReportCampus) {
      loadReport(selectedReportCampus.campus, reportDate);
    }
  }, [reportDate, selectedReportCampus, loadReport]);

  const getCampusName = (campusId) => {
    const c = campuses.find((x) => String(x.campus_id ?? x._id ?? x.id) === String(campusId));
    return c ? (c.campus_name ?? c.name) : `Campus ${campusId}`;
  };

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Title Header Row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-slate-800">Campus Final Destinations</h2>
          <p className="text-xs text-slate-500">Configure final campus geofences and define morning/evening timeframes to track in/out logs.</p>
        </div>
        {!isFormOpen && (
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all"
          >
            <Plus size={14} />
            Create Destination
          </button>
        )}
      </div>

      {/* Creation/Edit Card Form */}
      {isFormOpen && (
        <div className="bg-white rounded-xl shadow-md border border-slate-200 p-5 space-y-4 animate-slideDown">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
              <MapPin size={16} className="text-blue-500" />
              Configure Campus Geofence
            </h3>
            <button
              onClick={() => {
                setIsFormOpen(false);
                setSelectedCampus('');
                setName('');
                setLatitude('');
                setLongitude('');
                setMessage(null);
              }}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-all"
            >
              <X size={16} />
            </button>
          </div>

          {/* Form Fields */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Campus</label>
              <select
                value={selectedCampus}
                onChange={(e) => setSelectedCampus(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Select Campus —</option>
                {campuses.map((c) => (
                  <option key={c._id ?? c.id ?? c.campus_id} value={c.campus_id ?? c._id ?? c.id}>
                    {c.campus_name ?? c.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Location Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Main Campus Gate"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Radius (meters)</label>
              <input
                type="number"
                value={radius}
                onChange={(e) => setRadius(e.target.value)}
                min={50}
                max={5000}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          {/* Time Frames Row */}
          <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 space-y-3">
            <h4 className="text-xs font-bold text-slate-700 flex items-center gap-1.5">
              <Clock size={13} className="text-blue-500" />
              TGG API History Query Time Frames
            </h4>
            <p className="text-[10px] text-slate-400 font-medium">Define active windows (max 2.5 hours recommended) to stay within TGG API rate limits when fetching logs.</p>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Morning From</label>
                  <input
                    type="time"
                    value={morningStart}
                    onChange={(e) => setMorningStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Morning To</label>
                  <input
                    type="time"
                    value={morningEnd}
                    onChange={(e) => setMorningEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Evening From</label>
                  <input
                    type="time"
                    value={eveningStart}
                    onChange={(e) => setEveningStart(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Evening To</label>
                  <input
                    type="time"
                    value={eveningEnd}
                    onChange={(e) => setEveningEnd(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Coordinate display + message */}
          <div className="flex items-center gap-4 flex-wrap justify-between">
            <div className="flex items-center gap-4">
              {latitude !== '' && longitude !== '' && (
                <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-100 px-3 py-1 rounded-lg border border-slate-200">
                  <Crosshair size={12} className="text-slate-600" />
                  <span>Lat: <strong className="text-slate-800">{latitude}</strong></span>
                  <span>Lng: <strong className="text-slate-800">{longitude}</strong></span>
                </div>
              )}
              {message && (
                <div className={`text-xs font-semibold px-3 py-1.5 rounded-lg border ${
                  message.type === 'success' ? 'bg-green-50 text-green-700 border-green-200' : 'bg-red-50 text-red-700 border-red-200'
                }`}>
                  {message.text}
                </div>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => {
                  setIsFormOpen(false);
                  setSelectedCampus('');
                  setName('');
                  setLatitude('');
                  setLongitude('');
                  setMessage(null);
                }}
                className="px-4 py-2 border border-slate-300 hover:bg-slate-50 text-slate-600 text-xs font-bold rounded-lg transition-all"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving || !selectedCampus}
                className="flex items-center gap-1.5 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                Save Geofence
              </button>
            </div>
          </div>
          <div className="text-[10px] text-amber-600 font-semibold bg-amber-50 border border-amber-100 px-3 py-2 rounded-lg">
            Tip: You can change the location coordinates by clicking anywhere on the map view below.
          </div>
        </div>
      )}

      {/* Saved Destinations List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <MapPin size={14} className="text-indigo-500" />
            Saved Campus Geofences
          </h3>
          {destsLoading && <Loader2 size={14} className="animate-spin text-blue-500" />}
        </div>

        {savedDestinations.length === 0 && !destsLoading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 italic">
            No campus destinations configured yet. Click "Create Destination" or click the map below to configure one.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                  <th className="px-5 py-3">Campus</th>
                  <th className="px-5 py-3">Location Name</th>
                  <th className="px-5 py-3">Coordinates</th>
                  <th className="px-5 py-3">Radius</th>
                  <th className="px-5 py-3">Morning Window</th>
                  <th className="px-5 py-3">Evening Window</th>
                  <th className="px-5 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-xs font-semibold text-slate-700">
                {savedDestinations.map((d) => (
                  <tr key={d._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-bold text-slate-900">{getCampusName(d.campus)}</td>
                    <td className="px-5 py-3">{d.name}</td>
                    <td className="px-5 py-3 font-mono text-slate-500">{d.latitude?.toFixed(5)}, {d.longitude?.toFixed(5)}</td>
                    <td className="px-5 py-3">{d.radius} m</td>
                    <td className="px-5 py-3 text-slate-600 bg-blue-50/50 px-2 py-1 rounded border border-blue-100 max-w-fit">{d.morningStart || '07:00'} - {d.morningEnd || '09:30'}</td>
                    <td className="px-5 py-3 text-slate-600 bg-indigo-50/50 px-2 py-1 rounded border border-indigo-100 max-w-fit">{d.eveningStart || '16:00'} - {d.eveningEnd || '19:00'}</td>
                    <td className="px-5 py-3 text-right space-x-1">
                      <button
                        onClick={() => handleViewOnMap(d)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-slate-600 bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-md transition-all"
                      >
                        <Eye size={11} />
                        Locate
                      </button>
                      <button
                        onClick={() => handleEdit(d)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 rounded-md transition-all"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleOpenReport(d)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-all"
                      >
                        <Clock size={11} />
                        In/Out Report
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Map Card View (Always Visible after list) */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-3">
        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <Clock size={16} className="text-emerald-500" />
            Geofences Map View
          </h3>
          <span className="text-[10px] text-slate-400 font-medium bg-slate-100 px-2 py-1 rounded">
            Click map to start placing a new geofence coordinates
          </span>
        </div>
        <div className="relative rounded-xl overflow-hidden border border-slate-200" style={{ height: '420px' }}>
          {loading && (
            <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          )}
          <div ref={mapContainerRef} className="w-full h-full" />
        </div>
      </div>

      {/* Geofence In/Out Report panel */}
      {selectedReportCampus && (
        <div className="bg-white rounded-xl shadow-md border border-slate-200 p-5 space-y-4 animate-fadeIn">
          <div className="flex items-center justify-between border-b border-slate-100 pb-3">
            <div>
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <Clock size={16} className="text-indigo-500" />
                Bus In / Out Logs: {getCampusName(selectedReportCampus.campus)} ({selectedReportCampus.name})
              </h3>
              <p className="text-[10px] text-slate-400 mt-0.5 font-medium">
                Calculated dynamically from TGG Messages trace using morning ({selectedReportCampus.morningStart || '07:00'} - {selectedReportCampus.morningEnd || '09:30'}) and evening ({selectedReportCampus.eveningStart || '16:00'} - {selectedReportCampus.eveningEnd || '19:00'}) geofence thresholds.
              </p>
            </div>
            <button
              onClick={() => setSelectedReportCampus(null)}
              className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100 transition-all"
            >
              <X size={16} />
            </button>
          </div>

          {/* Date Picker row */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Calendar size={13} className="text-slate-500" />
              <span className="text-xs font-semibold text-slate-600">Select Date:</span>
            </div>
            <input
              type="date"
              value={reportDate}
              onChange={(e) => setReportDate(e.target.value)}
              className="border border-slate-300 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Report Data display */}
          {reportLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-sm text-slate-500">
              <Loader2 size={18} className="animate-spin text-indigo-500" /> Calculating geofence crossings... please hold.
            </div>
          ) : reportError ? (
            <div className="flex items-center gap-2 py-4 justify-center text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg p-3">
              <AlertCircle size={14} />
              <span>{reportError}</span>
            </div>
          ) : reportData.length === 0 ? (
            <div className="text-center py-8 text-xs text-slate-400 italic">
              No active buses matched or no geofence logs detected for this campus.
            </div>
          ) : (
            <div className="overflow-x-auto border border-slate-100 rounded-lg">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                    <th className="px-5 py-3">Bus Number</th>
                    <th className="px-5 py-3">Assigned Route</th>
                    <th className="px-5 py-3">Morning Entry (In)</th>
                    <th className="px-5 py-3">Morning Exit (Out)</th>
                    <th className="px-5 py-3">Evening Entry (In)</th>
                    <th className="px-5 py-3">Evening Exit (Out)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50 text-xs font-semibold text-slate-700">
                  {reportData.map((row, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                      <td className="px-5 py-3 font-bold text-slate-900">{row.busNumber}</td>
                      <td className="px-5 py-3 text-slate-500">{row.routeName}</td>
                      <td className="px-5 py-3 text-emerald-700">{row.mrngIn === '—' ? '—' : row.mrngIn}</td>
                      <td className="px-5 py-3 text-rose-600">{row.mrngOut === '—' ? '—' : row.mrngOut}</td>
                      <td className="px-5 py-3 text-emerald-700">{row.evngIn === '—' ? '—' : row.evngIn}</td>
                      <td className="px-5 py-3 text-rose-600">{row.evngOut === '—' ? '—' : row.evngOut}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
