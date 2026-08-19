import React, { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch, API_BASE } from '../utils/api';
import { Save, Loader2, Crosshair, MapPin, Eye } from 'lucide-react';

const DEFAULT_CENTER = { lat: 16.9891, lng: 82.2475 };
const DEFAULT_RADIUS = 200;

export default function GpsFinalDestinationModal({ campuses = [] }) {
  const [selectedCampus, setSelectedCampus] = useState('');
  const [name, setName] = useState('');
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [radius, setRadius] = useState(DEFAULT_RADIUS);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);

  const [savedDestinations, setSavedDestinations] = useState([]);
  const [destsLoading, setDestsLoading] = useState(false);

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
      color: '#dc2626',
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

  // Init map on mount + load destinations
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
        setLatitude(lat);
        setLongitude(lng);
        placeMarker(lat, lng, radius);
      });

      mapRef.current = map;
      loadAllDestinations();
    }, 250);

    return () => {
      clearTimeout(timer);
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (circleRef.current && Number.isFinite(Number(radius))) {
      circleRef.current.setRadius(Number(radius));
    }
  }, [radius]);

  // Fetch existing destination when campus changes
  useEffect(() => {
    if (!selectedCampus) return;

    setLoading(true);
    setMessage(null);
    setName('');
    setLatitude('');
    setLongitude('');
    setRadius(DEFAULT_RADIUS);
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
        }),
      });
      const json = await res.json();
      if (json.success) {
        setMessage({ type: 'success', text: 'Final destination saved!' });
        loadAllDestinations();
      } else {
        setMessage({ type: 'error', text: json.message || 'Save failed' });
      }
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Network error' });
    } finally {
      setSaving(false);
    }
  };

  const handleViewOnMap = (dest) => {
    setSelectedCampus(String(dest.campus));
    placeMarker(dest.latitude, dest.longitude, dest.radius);
  };

  const getCampusName = (campusId) => {
    const c = campuses.find((x) => String(x.campus_id ?? x._id ?? x.id) === String(campusId));
    return c ? (c.campus_name ?? c.name) : `Campus ${campusId}`;
  };

  return (
    <div className="space-y-4">
      {/* Form + Map Card */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-5 space-y-4">
        {/* Controls Row */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex-1 min-w-[180px]">
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

          <div className="flex-1 min-w-[180px]">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Location Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Main Gate, Campus Entrance"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="w-28">
            <label className="block text-xs font-semibold text-slate-600 mb-1">Radius (m)</label>
            <input
              type="number"
              value={radius}
              onChange={(e) => setRadius(e.target.value)}
              min={50}
              max={5000}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={saving || !selectedCampus}
            className="flex items-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-bold rounded-lg shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
            Save
          </button>
        </div>

        {/* Coordinate display + message */}
        <div className="flex items-center gap-4 flex-wrap">
          {latitude !== '' && longitude !== '' && (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Crosshair size={12} />
              <span>Lat: <strong className="text-slate-700">{latitude}</strong></span>
              <span>Lng: <strong className="text-slate-700">{longitude}</strong></span>
            </div>
          )}
          {message && (
            <div className={`text-xs font-medium px-3 py-1.5 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
              {message.text}
            </div>
          )}
        </div>

        {/* Map */}
        <div className="relative rounded-xl overflow-hidden border border-slate-200" style={{ height: '460px' }}>
          {loading && (
            <div className="absolute inset-0 z-10 bg-white/60 flex items-center justify-center">
              <Loader2 size={24} className="animate-spin text-blue-600" />
            </div>
          )}
          <div ref={mapContainerRef} className="w-full h-full" />
          <div className="absolute top-2 left-2 z-[500] bg-white/90 backdrop-blur rounded-lg px-3 py-1.5 text-[10px] text-slate-500 font-medium shadow-sm border border-slate-200 pointer-events-none">
            Click map to set destination
          </div>
        </div>
      </div>

      {/* Saved Destinations List */}
      <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
            <MapPin size={14} className="text-indigo-500" />
            Saved Destinations
          </h3>
          {destsLoading && <Loader2 size={14} className="animate-spin text-blue-500" />}
        </div>

        {savedDestinations.length === 0 && !destsLoading ? (
          <div className="px-5 py-8 text-center text-sm text-slate-400 italic">
            No destinations saved yet. Select a campus, click the map, and save.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                  <th className="px-5 py-3">Campus</th>
                  <th className="px-5 py-3">Location Name</th>
                  <th className="px-5 py-3">Latitude</th>
                  <th className="px-5 py-3">Longitude</th>
                  <th className="px-5 py-3">Radius</th>
                  <th className="px-5 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50 text-xs font-semibold text-slate-700">
                {savedDestinations.map((d) => (
                  <tr key={d._id} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-5 py-3 font-bold text-slate-900">{getCampusName(d.campus)}</td>
                    <td className="px-5 py-3">{d.name}</td>
                    <td className="px-5 py-3 font-mono text-slate-500">{d.latitude?.toFixed(6)}</td>
                    <td className="px-5 py-3 font-mono text-slate-500">{d.longitude?.toFixed(6)}</td>
                    <td className="px-5 py-3">{d.radius} m</td>
                    <td className="px-5 py-3 text-right">
                      <button
                        onClick={() => handleViewOnMap(d)}
                        className="inline-flex items-center gap-1 px-3 py-1 text-[10px] font-bold text-indigo-600 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 rounded-md transition-all"
                      >
                        <Eye size={11} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
