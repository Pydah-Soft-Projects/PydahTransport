import React, { useState, useEffect, useRef, useCallback } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { campusIdsMatch, filterCampusesForUser, getCampusId } from '../utils/campus';
import {
    Map,
    Edit,
    Trash2,
    Clock,
    Navigation,
    MapPin,
    Plus,
    ArrowRight,
    Milestone,
    IndianRupee,
    ChevronDown,
    ChevronUp,
    Search,
    AlertTriangle,
    Bus,
    Layers,
    GripVertical
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const resolveStageFareForYear = (stage, year) => {
    const overrides = Array.isArray(stage.academicYearFares) ? stage.academicYearFares : [];
    const match = overrides.find((item) => item.academicYear === year);
    if (match) return Number(match.fare);
    return Number(stage.baseFare ?? stage.fare ?? 0);
};

const hasStageCoordinateValue = (value) => (
    value !== '' && value !== null && value !== undefined
);

const getStageCoords = (stage) => {
    if (!hasStageCoordinateValue(stage?.latitude) || !hasStageCoordinateValue(stage?.longitude)) {
        return null;
    }
    const lat = Number(stage.latitude);
    const lng = Number(stage.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
};

const createLocalStageId = () => `stage-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

const DEFAULT_MAP_CENTER = { lat: 16.9891, lng: 82.2475 }; // Kakinada — map view default only

const focusMapOnStagePoints = (map, points, L) => {
    if (!map || !L || !Array.isArray(points) || points.length === 0) return;

    if (points.length === 1) {
        map.setView(points[0], 15, { animate: true });
        return;
    }

    const bounds = L.latLngBounds(points);
    // Expand bounds slightly so markers and radius circles are not clipped at the edges.
    bounds.pad(0.18);

    map.fitBounds(bounds, {
        padding: [36, 36],
        maxZoom: 16,
        animate: true,
    });
};

const RouteSummaryMap = ({ stages }) => {
    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null);

    useEffect(() => {
        if (!mapContainerRef.current || !window.L) return;

        const L = window.L;
        const validStages = (stages || []).map((stage) => getStageCoords(stage)).filter(Boolean);
        if (validStages.length === 0) return;

        const bounds = L.latLngBounds();
        validStages.forEach(({ lat, lng }) => {
            bounds.extend([lat, lng]);
        });

        if (!mapInstanceRef.current) {
            const map = L.map(mapContainerRef.current, {
                zoomControl: false,
                attributionControl: false
            });

            L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3']
            }).addTo(map);

            mapInstanceRef.current = map;
        }

        const map = mapInstanceRef.current;
        
        map.eachLayer((layer) => {
            if (layer instanceof L.Marker || layer instanceof L.Polyline) {
                map.removeLayer(layer);
            }
        });

        const lineCoords = [];
        (stages || []).forEach((stage, idx) => {
            const coords = getStageCoords(stage);
            if (!coords) return;
            const { lat: latVal, lng: lngVal } = coords;
            lineCoords.push([latVal, lngVal]);

            L.marker([latVal, lngVal], {
                icon: L.divIcon({
                    className: 'custom-stage-summary-marker',
                    html: `<div class="w-4 h-4 rounded-full bg-blue-600 border-2 border-white text-white flex items-center justify-center font-bold text-[8px] shadow-sm">${idx + 1}</div>`,
                    iconSize: [16, 16],
                    iconAnchor: [8, 8]
                })
            }).addTo(map).bindPopup(`<b>${idx + 1}. ${stage.stageName}</b>`);
        });

        if (lineCoords.length > 1) {
            L.polyline(lineCoords, {
                color: '#2563eb',
                weight: 2.5,
                opacity: 0.8
            }).addTo(map);
        }

        map.fitBounds(bounds, { padding: [15, 15] });

        return () => {
            if (mapInstanceRef.current) {
                try {
                    mapInstanceRef.current.remove();
                } catch (e) {}
                mapInstanceRef.current = null;
            }
        };
    }, [stages]);

    const hasPoints = (stages || []).some((stage) => Boolean(getStageCoords(stage)));
    if (!hasPoints) {
        return (
            <div className="bg-slate-55 bg-slate-50 border border-slate-200 rounded-xl p-4 text-center text-[10px] text-slate-400 italic">
                No stages have coordinates configured yet. Edit the route to plot them.
            </div>
        );
    }

    return (
        <div className="rounded-xl border border-slate-200 overflow-hidden relative w-full h-[220px]">
            <div ref={mapContainerRef} className="w-full h-full z-0" />
        </div>
    );
};

const RouteManagement = () => {
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saveMessage, setSaveMessage] = useState({ text: '', type: '' });
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const academicYearOptions = getAcademicYearOptions();
    const [searchQuery, setSearchQuery] = useState('');
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [expandedRouteId, setExpandedRouteId] = useState(null);

    const [formData, setFormData] = useState({
        routeId: '',
        routeName: '',
        startPoint: '',
        endPoint: '',
        totalDistance: '',
        estimatedTime: '',
        campus: '',
        zone: '',
        stages: []
    });

    // Modal Edit Mode Tabs & Interactive Stages map states
    const [modalActiveTab, setModalActiveTab] = useState('details');
    const [selectedStageIndex, setSelectedStageIndex] = useState(null);
    const [isLeafletReady, setIsLeafletReady] = useState(false);
    const modalMapContainerRef = useRef(null);
    const modalMapInstanceRef = useRef(null);
    const modalMarkerRef = useRef(null);
    const modalCircleRef = useRef(null);

    const destroyModalMap = useCallback(() => {
        if (modalMapInstanceRef.current) {
            try {
                modalMapInstanceRef.current.remove();
            } catch (e) {
                console.warn(e);
            }
            modalMapInstanceRef.current = null;
        }
        modalMarkerRef.current = null;
        modalCircleRef.current = null;
    }, []);

    const [isSuccessModalOpen, setIsSuccessModalOpen] = useState(false);
    const [successModalMessage, setSuccessModalMessage] = useState('');
    const [mapSearchQuery, setMapSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearchingLocation, setIsSearchingLocation] = useState(false);
    const [showAllStagesOnMap, setShowAllStagesOnMap] = useState(false);
    const [draggedStageIndex, setDraggedStageIndex] = useState(null);
    const [dragOverStageIndex, setDragOverStageIndex] = useState(null);

    // Dynamically load Leaflet library for route maps
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

    const updateActiveStageCoords = useCallback((lat, lng) => {
        if (selectedStageIndex === null || selectedStageIndex === undefined) return;
        setFormData(prev => {
            const nextStages = [...prev.stages];
            if (nextStages[selectedStageIndex]) {
                nextStages[selectedStageIndex].latitude = parseFloat(lat.toFixed(6));
                nextStages[selectedStageIndex].longitude = parseFloat(lng.toFixed(6));
            }
            return { ...prev, stages: nextStages };
        });
    }, [selectedStageIndex]);

    const handleLocationSearch = async () => {
        if (!mapSearchQuery.trim()) return;
        setIsSearchingLocation(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&q=${encodeURIComponent(mapSearchQuery)}`);
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data || []);
                if (!data || data.length === 0) {
                    alert('No matching locations found.');
                }
            } else {
                alert('Location search failed.');
            }
        } catch (error) {
            console.error('Error geocoding location:', error);
        } finally {
            setIsSearchingLocation(false);
        }
    };

    const handleSelectSearchResult = (result) => {
        const lat = parseFloat(result.lat);
        const lon = parseFloat(result.lon);
        updateActiveStageCoords(lat, lon);
        if (modalMapInstanceRef.current) {
            modalMapInstanceRef.current.flyTo([lat, lon], 15);
        }
        setSearchResults([]);
        setMapSearchQuery('');
    };

    const [isSavingStage, setIsSavingStage] = useState(false);
    const [isSavingStageOrder, setIsSavingStageOrder] = useState(false);
    const [hasPendingStageOrder, setHasPendingStageOrder] = useState(false);

    const buildRouteUpdatePayload = (routeForm, stages = routeForm.stages) => ({
        routeId: routeForm.routeId,
        routeName: routeForm.routeName,
        startPoint: routeForm.startPoint,
        endPoint: routeForm.endPoint,
        totalDistance: routeForm.totalDistance,
        estimatedTime: routeForm.estimatedTime,
        campus: routeForm.campus || null,
        zone: routeForm.zone || '',
        stages: stages.map((stage) => ({
            stageName: stage.stageName,
            distanceFromStart: Number(stage.distanceFromStart),
            fare: Number(stage.fare),
            baseFare: stage.baseFare,
            academicYearFares: stage.academicYearFares || [],
            latitude: stage.latitude !== '' && stage.latitude !== null ? Number(stage.latitude) : null,
            longitude: stage.longitude !== '' && stage.longitude !== null ? Number(stage.longitude) : null,
            radius: stage.radius !== '' && stage.radius !== null ? Number(stage.radius) : 100,
        })),
        editingAcademicYear: academicYear,
    });

    const persistRouteStages = async (stages, routeForm = formData) => {
        if (!editingId) return true;

        const response = await apiFetch(`${API}/routes/${editingId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(buildRouteUpdatePayload(routeForm, stages)),
        });

        if (!response.ok) {
            const data = await response.json().catch(() => ({}));
            throw new Error(data.message || 'Failed to save stage order');
        }

        await fetchRoutes(academicYear);
        return true;
    };

    const handleSaveStageOrder = async () => {
        if (!editingId || !hasPendingStageOrder) return;

        setIsSavingStageOrder(true);
        try {
            await persistRouteStages(formData.stages);
            setHasPendingStageOrder(false);
            setSuccessModalMessage('Route stage order saved successfully.');
            setIsSuccessModalOpen(true);
        } catch (error) {
            console.error('Error saving stage order:', error);
            setSaveMessage({ text: error.message || 'Failed to save route sorting', type: 'error' });
        } finally {
            setIsSavingStageOrder(false);
        }
    };

    const handleSaveStage = async () => {
        if (!editingId) return;
        setIsSavingStage(true);
        try {
            await persistRouteStages(formData.stages);
            const stageName = formData.stages[selectedStageIndex]?.stageName || `Stage ${selectedStageIndex + 1}`;
            setSuccessModalMessage(`Stage "${stageName}" details saved successfully.`);
            setIsSuccessModalOpen(true);
        } catch (error) {
            console.error('Error saving stage:', error);
            setSaveMessage({ text: error.message || 'Error saving stage details', type: 'error' });
        } finally {
            setIsSavingStage(false);
        }
    };

    // Destroy the Leaflet map when leaving the Stages tab so it can be recreated on return.
    useEffect(() => {
        if (modalActiveTab !== 'stages') {
            destroyModalMap();
        } else {
            setShowAllStagesOnMap(true);
            setSelectedStageIndex(null);
        }
    }, [modalActiveTab, destroyModalMap]);

    // Modal Map synchronization effect
    useEffect(() => {
        if (modalActiveTab !== 'stages' || !isLeafletReady || !modalMapContainerRef.current || !window.L) {
            return;
        }

        const L = window.L;
        const activeStage = selectedStageIndex !== null ? formData.stages[selectedStageIndex] : null;
        const activeStageCoords = getStageCoords(activeStage);
        
        let centerLat = DEFAULT_MAP_CENTER.lat;
        let centerLng = DEFAULT_MAP_CENTER.lng;
        let zoom = 12;

        // Collect all stages with coords for bounds fitting
        const allCoordsPoints = formData.stages
            .map((stage) => getStageCoords(stage))
            .filter(Boolean)
            .map(({ lat, lng }) => [lat, lng]);

        if (activeStageCoords) {
            centerLat = activeStageCoords.lat;
            centerLng = activeStageCoords.lng;
            zoom = 15;
        } else if (allCoordsPoints.length > 0) {
            // No coords on active stage => fly to neutral showing all points
            centerLat = allCoordsPoints.reduce((s, c) => s + c[0], 0) / allCoordsPoints.length;
            centerLng = allCoordsPoints.reduce((s, c) => s + c[1], 0) / allCoordsPoints.length;
            zoom = 12;
        }

        const existingMap = modalMapInstanceRef.current;
        const existingContainer = existingMap?.getContainer?.();
        if (existingMap && existingContainer !== modalMapContainerRef.current) {
            destroyModalMap();
        }

        if (!modalMapInstanceRef.current) {
            const map = L.map(modalMapContainerRef.current, {
                center: [centerLat, centerLng],
                zoom: zoom,
                zoomControl: false
            });

            L.control.zoom({ position: 'bottomleft' }).addTo(map);

            L.tileLayer('https://{s}.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
                maxZoom: 20,
                subdomains: ['mt0', 'mt1', 'mt2', 'mt3'],
                attribution: '© Google Maps'
            }).addTo(map);

            modalMapInstanceRef.current = map;
            // Invalidate size after layout settles when the Stages tab remounts the map container
            setTimeout(() => map.invalidateSize(), 250);
        }

        const map = modalMapInstanceRef.current;

        if (modalMarkerRef.current) {
            map.removeLayer(modalMarkerRef.current);
            modalMarkerRef.current = null;
        }
        if (modalCircleRef.current) {
            map.removeLayer(modalCircleRef.current);
            modalCircleRef.current = null;
        }

        map.eachLayer((layer) => {
            if (layer instanceof L.Marker || layer instanceof L.Circle || layer instanceof L.Polyline) {
                map.removeLayer(layer);
            }
        });

        const lineCoords = [];

        const bindStageMarker = (stage, idx, { draggable = false, isActive = false, showCircle = true } = {}) => {
            const coords = getStageCoords(stage);
            if (!coords) return null;
            const { lat: latVal, lng: lngVal } = coords;
            const radiusVal = Number(stage.radius) || 100;

            lineCoords.push([latVal, lngVal]);

            const marker = L.marker([latVal, lngVal], {
                draggable,
                icon: L.divIcon({
                    className: isActive ? 'custom-stage-marker-active' : 'custom-stage-marker-inactive',
                    html: isActive
                        ? `<div class="w-7 h-7 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center font-black text-xs shadow-lg">${idx + 1}</div>`
                        : `<div class="w-5 h-5 rounded-full bg-slate-500 border-2 border-white text-white flex items-center justify-center font-bold text-[9px] shadow-md">${idx + 1}</div>`,
                    iconSize: isActive ? [28, 28] : [20, 20],
                    iconAnchor: isActive ? [14, 14] : [10, 10]
                })
            }).addTo(map).bindPopup(
                `<b>Stage ${idx + 1}: ${stage.stageName || 'Unnamed'}</b><br/>Distance: ${stage.distanceFromStart || 0} km${showCircle ? `<br/>Radius: ${radiusVal} m` : ''}`
            );

            if (showCircle) {
                const circle = L.circle([latVal, lngVal], {
                    radius: radiusVal,
                    color: isActive ? '#ef4444' : '#3b82f6',
                    fillColor: isActive ? '#ef4444' : '#3b82f6',
                    fillOpacity: isActive ? 0.15 : 0.08,
                    weight: isActive ? 1.5 : 1
                }).addTo(map);

                if (isActive) {
                    modalCircleRef.current = circle;
                }
            }

            if (isActive) {
                modalMarkerRef.current = marker;
                if (draggable) {
                    marker.on('dragend', (e) => {
                        const { lat, lng } = e.target.getLatLng();
                        updateActiveStageCoords(lat, lng);
                    });
                }
            }

            return marker;
        };

        if (showAllStagesOnMap) {
            formData.stages.forEach((stage, idx) => {
                const isActive = selectedStageIndex !== null && idx === selectedStageIndex;
                bindStageMarker(stage, idx, {
                    draggable: isActive,
                    isActive,
                    showCircle: true
                });
            });

            if (lineCoords.length > 1) {
                L.polyline(lineCoords, {
                    color: '#2563eb',
                    weight: 3,
                    opacity: 0.75
                }).addTo(map);
            }
        } else {
            formData.stages.forEach((stage, idx) => {
                if (selectedStageIndex !== null && idx !== selectedStageIndex) {
                    bindStageMarker(stage, idx, { draggable: false, isActive: false, showCircle: false });
                }
            });

            if (lineCoords.length > 1) {
                L.polyline(lineCoords, {
                    color: '#64748b',
                    weight: 3,
                    dashArray: '5, 8',
                    opacity: 0.6
                }).addTo(map);
            }

            if (activeStageCoords && selectedStageIndex !== null) {
                bindStageMarker(activeStage, selectedStageIndex, { draggable: true, isActive: true, showCircle: true });
            }
        }

        // Wait for the modal layout to finish before sizing/zooming the map.
        const viewTimer = setTimeout(() => {
            map.invalidateSize();

            if (showAllStagesOnMap && allCoordsPoints.length > 0) {
                focusMapOnStagePoints(map, allCoordsPoints, L);
            } else if (activeStageCoords) {
                map.flyTo([activeStageCoords.lat, activeStageCoords.lng], 15, { duration: 0.8 });
            } else {
                map.flyTo([DEFAULT_MAP_CENTER.lat, DEFAULT_MAP_CENTER.lng], 13, { duration: 0.8 });
            }
        }, 220);

        const onMapClick = (e) => {
            if (selectedStageIndex === null || selectedStageIndex === undefined) return;
            const { lat, lng } = e.latlng;
            updateActiveStageCoords(lat, lng);
        };
        map.on('click', onMapClick);

        return () => {
            clearTimeout(viewTimer);
            map.off('click', onMapClick);
        };
    }, [modalActiveTab, isLeafletReady, selectedStageIndex, formData.stages, showAllStagesOnMap, updateActiveStageCoords, destroyModalMap]);

    // Sync active marker and circle with state changes (e.g. input fields, drag events, or first click on map)
    useEffect(() => {
        if (showAllStagesOnMap) return;
        if (modalActiveTab !== 'stages' || !modalMapInstanceRef.current || !window.L) return;
        if (selectedStageIndex === null || selectedStageIndex === undefined) return;
        const activeStage = formData.stages[selectedStageIndex];
        const activeStageCoords = getStageCoords(activeStage);
        if (!activeStageCoords) return;

        const L = window.L;
        const map = modalMapInstanceRef.current;
        const { lat: latVal, lng: lngVal } = activeStageCoords;
        const radVal = Number(activeStage.radius) || 100;

        // If marker doesn't exist yet (new stage just got coords via click), create it
        if (!modalMarkerRef.current) {
            const activeMarker = L.marker([latVal, lngVal], {
                draggable: true,
                icon: L.divIcon({
                    className: 'custom-stage-marker-active',
                    html: `<div class="w-7 h-7 rounded-full bg-red-600 border-2 border-white text-white flex items-center justify-center font-black text-xs shadow-lg">${selectedStageIndex + 1}</div>`,
                    iconSize: [28, 28],
                    iconAnchor: [14, 14]
                })
            }).addTo(map);

            activeMarker.on('dragend', (e) => {
                const { lat, lng } = e.target.getLatLng();
                updateActiveStageCoords(lat, lng);
            });

            modalMarkerRef.current = activeMarker;
        } else {
            const curLatLng = modalMarkerRef.current.getLatLng();
            if (curLatLng.lat !== latVal || curLatLng.lng !== lngVal) {
                modalMarkerRef.current.setLatLng([latVal, lngVal]);
            }
        }

        if (!modalCircleRef.current) {
            const activeCircle = L.circle([latVal, lngVal], {
                radius: radVal,
                color: '#ef4444',
                fillColor: '#ef4444',
                fillOpacity: 0.15,
                weight: 1.5
            }).addTo(map);
            modalCircleRef.current = activeCircle;
        } else {
            const curLatLng = modalCircleRef.current.getLatLng();
            if (curLatLng.lat !== latVal || curLatLng.lng !== lngVal) {
                modalCircleRef.current.setLatLng([latVal, lngVal]);
            }
            if (modalCircleRef.current.getRadius() !== radVal) {
                modalCircleRef.current.setRadius(radVal);
            }
        }
    }, [
        modalActiveTab,
        selectedStageIndex,
        formData.stages[selectedStageIndex]?.latitude ?? null,
        formData.stages[selectedStageIndex]?.longitude ?? null,
        formData.stages[selectedStageIndex]?.radius ?? null,
        showAllStagesOnMap,
        updateActiveStageCoords
    ]);

    // Route-to-Bus Mapping States
    const [buses, setBuses] = useState([]);
    const [expandedRouteEditId, setExpandedRouteEditId] = useState(null);
    const [routeWiseDrafts, setRouteWiseDrafts] = useState({});
    const [mappingPreview, setMappingPreview] = useState({});
    const [assigningBusId, setAssigningBusId] = useState(null);

    const fetchBuses = async () => {
        try {
            const response = await apiFetch(`${API}/buses`);
            if (response.ok) {
                const data = await response.json();
                setBuses(Array.isArray(data) ? data : []);
            }
        } catch (error) {
            console.error('Error fetching buses:', error);
        }
    };

    const todayDateInput = () => {
        const today = new Date();
        return today.toISOString().split('T')[0];
    };

    const buildRouteWiseDraft = (routeId) => {
        const currentBus = buses.find((b) => b.assignedRouteId === routeId);
        return {
            busId: currentBus ? currentBus._id : '',
            exitDate: todayDateInput(),
            entryDate: todayDateInput(),
        };
    };

    const handleRouteWiseDraftChange = (routeId, busId) => {
        setRouteWiseDrafts((prev) => ({
            ...prev,
            [routeId]: {
                ...(prev[routeId] || { exitDate: todayDateInput(), entryDate: todayDateInput() }),
                busId,
            },
        }));
        const selectedBus = buses.find((b) => b._id === busId);
        const selectedBusNumber = selectedBus ? selectedBus.busNumber : '';
        if (routeId) {
            fetchMappingPreview(routeId, 'route', selectedBusNumber, routeId);
        } else {
            setMappingPreview((prev) => { const n = { ...prev }; delete n[routeId]; return n; });
        }
    };

    const handleRouteWiseDraftDateChange = (routeId, field, value) => {
        setRouteWiseDrafts((prev) => ({
            ...prev,
            [routeId]: { ...prev[routeId], [field]: value },
        }));
    };

    const fetchMappingPreview = async (previewKey, mode, busNumber, routeId) => {
        setMappingPreview((prev) => ({ ...prev, [previewKey]: { ...(prev[previewKey] || {}), loading: true } }));
        try {
            const params = new URLSearchParams();
            if (mode) params.set('mode', mode);
            if (busNumber) params.set('busNumber', busNumber);
            if (routeId) params.set('routeId', routeId);
            const res = await apiFetch(`${API}/buses/mapping-preview?${params.toString()}`);
            if (res.ok) {
                const data = await res.json();
                setMappingPreview((prev) => ({
                    ...prev,
                    [previewKey]: { 
                        studentCount: data.studentCount || 0, 
                        employeeCount: data.employeeCount || 0, 
                        affectedPassengers: data.affectedPassengers || [],
                        busCapacityAlerts: data.busCapacityAlerts || [],
                        loading: false 
                    },
                }));
            } else {
                setMappingPreview((prev) => ({ ...prev, [previewKey]: { studentCount: 0, employeeCount: 0, affectedPassengers: [], busCapacityAlerts: [], loading: false } }));
            }
        } catch {
            setMappingPreview((prev) => ({ ...prev, [previewKey]: { studentCount: 0, employeeCount: 0, affectedPassengers: [], busCapacityAlerts: [], loading: false } }));
        }
    };

    const handleRouteWiseDetachClick = async (route, assignedBus) => {
        const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
        if (!draft.exitDate) {
            alert('Please set the exit date for detaching the bus.');
            return;
        }

        const confirmDetach = window.confirm(`Are you sure you want to detach Bus ${assignedBus.busNumber} from Route ${route.routeName}? This will clear bus assignments for all passengers on this route.`);
        if (!confirmDetach) return;

        setAssigningBusId(route._id);
        try {
            const res = await apiFetch(`${API}/buses/${assignedBus._id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routeChange: {
                        newRouteId: null,
                        exitDate: draft.exitDate,
                        entryDate: null,
                    },
                }),
            });

            if (res.ok) {
                await fetchBuses();
                await fetchRoutes();
                setExpandedRouteEditId(null);
            } else {
                const err = await res.json().catch(() => ({}));
                alert(err.message || 'Error detaching bus from route');
            }
        } catch (e) {
            console.error(e);
            alert('Error detaching bus from route');
        } finally {
            setAssigningBusId(null);
        }
    };

    const handleRouteWiseAttachClick = async (route) => {
        const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
        const newBusId = draft.busId || '';

        if (!newBusId) {
            alert('Please select a bus to attach.');
            return;
        }
        if (!draft.entryDate) {
            alert('Please set the assignment date.');
            return;
        }

        setAssigningBusId(route._id);
        try {
            const res = await apiFetch(`${API}/buses/${newBusId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    routeChange: {
                        newRouteId: route.routeId,
                        exitDate: null,
                        entryDate: draft.entryDate,
                    },
                }),
            });

            if (res.ok) {
                await fetchBuses();
                await fetchRoutes();
                setExpandedRouteEditId(null);
            } else {
                const err = await res.json().catch(() => ({}));
                alert(err.message || 'Error attaching bus to route');
            }
        } catch (e) {
            console.error(e);
            alert('Error attaching bus');
        } finally {
            setAssigningBusId(null);
        }
    };


    const [campuses, setCampuses] = useState([]);

    const [activeTab, setActiveTab] = useState('network'); // 'network' or 'transfer'
    const [transferData, setTransferData] = useState({
        sourceRouteId: '',
        stageName: '',
        destinationRouteId: ''
    });
    const [transferPreview, setTransferPreview] = useState({
        studentCount: 0,
        employeeCount: 0,
        passengers: [],
        loading: false
    });
    const [transferSubmitting, setTransferSubmitting] = useState(false);
    const [transferMessage, setTransferMessage] = useState({ text: '', type: '' });
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedCampusFilter, setSelectedCampusFilter] = useState('');
    const [destBuses, setDestBuses] = useState([]);
    const [destBusesLoading, setDestBusesLoading] = useState(false);

    // Student Transfer States
    const [studentTransferData, setStudentTransferData] = useState({
        sourceRouteId: '',
        stageName: '', // optional filter
        destinationRouteId: '',
        destinationStageName: ''
    });
    const [passengerList, setPassengerList] = useState([]);
    const [passengerListLoading, setPassengerListLoading] = useState(false);
    const [selectedPassengers, setSelectedPassengers] = useState([]); // Array of MongoDB _ids
    const [typeFilter, setTypeFilter] = useState('both'); // 'student' | 'employee' | 'both'
    const [studentTransferSubmitting, setStudentTransferSubmitting] = useState(false);
    const [studentTransferMessage, setStudentTransferMessage] = useState({ text: '', type: '' });
    const [isStudentConfirmModalOpen, setIsStudentConfirmModalOpen] = useState(false);
    const [studentDestBuses, setStudentDestBuses] = useState([]);
    const [studentDestBusesLoading, setStudentDestBusesLoading] = useState(false);

    // Transfer History States
    const [transferHistoryList, setTransferHistoryList] = useState([]);
    const [mappingHistoryList, setMappingHistoryList] = useState([]);
    const [historyLoading, setHistoryLoading] = useState(false);
    const [expandedHistoryId, setExpandedHistoryId] = useState(null);
    const [historySubTab, setHistorySubTab] = useState('transfers'); // 'transfers' | 'mappings'

    const fetchCampuses = async () => {
        try {
            const response = await apiFetch(`${API}/campuses`);
            const data = await response.json();
            setCampuses(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching campuses:', error);
        }
    };

    const fetchRoutes = async (year = academicYear) => {
        setLoading(true);
        try {
            const response = await apiFetch(
                `${API}/routes?academicYear=${encodeURIComponent(year)}&_=${Date.now()}`
            );
            const data = await response.json();
            setRoutes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching routes:', error);
            setSaveMessage({ text: 'Failed to load routes for the selected academic year.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({
            routeId: '', routeName: '', startPoint: '', endPoint: '',
            totalDistance: '', estimatedTime: '', campus: '', zone: '', stages: []
        });
        setExpandedRouteId(null);
        fetchRoutes(academicYear);
        fetchCampuses();
        fetchBuses();
    }, [academicYear]);

    useEffect(() => {
        if (routes.length) {
            setRouteWiseDrafts(
                Object.fromEntries(routes.map((r) => [r.routeId, buildRouteWiseDraft(r.routeId)]))
            );
        }
    }, [routes, buses]);

    const toggleRoute = (id) => {
        setExpandedRouteId(expandedRouteId === id ? null : id);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleStageChange = (index, e) => {
        const { name, value } = e.target;
        const newStages = [...formData.stages];
        newStages[index][name] = value;
        setFormData(prev => ({ ...prev, stages: newStages }));
    };

    const addStage = () => {
        setFormData(prev => {
            const nextStages = [...prev.stages, {
                _localId: createLocalStageId(),
                stageName: '',
                distanceFromStart: '',
                fare: 0,
                academicYearFares: [],
                latitude: null,
                longitude: null,
                radius: 100
            }];
            setSelectedStageIndex(nextStages.length - 1);
            return {
                ...prev,
                stages: nextStages
            };
        });
    };

    const reorderStages = (fromIndex, toIndex) => {
        if (fromIndex === toIndex) return;

        const nextStages = [...formData.stages];
        const [movedStage] = nextStages.splice(fromIndex, 1);
        nextStages.splice(toIndex, 0, movedStage);

        setFormData((prev) => ({ ...prev, stages: nextStages }));
        setSelectedStageIndex((prev) => {
            if (prev === fromIndex) return toIndex;
            if (fromIndex < toIndex && prev > fromIndex && prev <= toIndex) return prev - 1;
            if (fromIndex > toIndex && prev >= toIndex && prev < fromIndex) return prev + 1;
            return prev;
        });
        setHasPendingStageOrder(true);
    };

    const handleStageDragStart = (e, idx) => {
        setDraggedStageIndex(idx);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(idx));
    };

    const handleStageDragOver = (e, idx) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDragOverStageIndex(idx);
    };

    const handleStageDrop = (e, toIndex) => {
        e.preventDefault();
        const fromIndex = draggedStageIndex ?? Number(e.dataTransfer.getData('text/plain'));
        if (Number.isFinite(fromIndex)) {
            reorderStages(fromIndex, toIndex);
        }
        setDraggedStageIndex(null);
        setDragOverStageIndex(null);
    };

    const handleStageDragEnd = () => {
        setDraggedStageIndex(null);
        setDragOverStageIndex(null);
    };

    const removeStage = (index) => {
        const newStages = formData.stages.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, stages: newStages }));
        setSelectedStageIndex(prev => {
            if (newStages.length === 0) return null;
            if (prev === null) return null;
            return Math.max(0, Math.min(prev, newStages.length - 1));
        });
    };

    const handleEdit = (route, e) => {
        e.stopPropagation();
        setFormData({
            routeId: route.routeId,
            routeName: route.routeName,
            startPoint: route.startPoint,
            endPoint: route.endPoint,
            totalDistance: route.totalDistance,
            estimatedTime: route.estimatedTime,
            campus: getCampusId(route.campus) || '',
            zone: route.zone || '',
            stages: (route.stages || []).map((stage) => ({
                _localId: stage._localId || createLocalStageId(),
                stageName: stage.stageName,
                distanceFromStart: stage.distanceFromStart,
                fare: resolveStageFareForYear(stage, academicYear),
                baseFare: stage.baseFare ?? stage.fare,
                academicYearFares: stage.academicYearFares || [],
                latitude: stage.latitude !== undefined && stage.latitude !== null ? stage.latitude : '',
                longitude: stage.longitude !== undefined && stage.longitude !== null ? stage.longitude : '',
                radius: stage.radius !== undefined && stage.radius !== null ? stage.radius : 100,
            })),
        });
        setEditingId(route._id);
        setModalActiveTab('details');
        setSelectedStageIndex(null);
        setHasPendingStageOrder(false);
        setIsModalOpen(true);
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this route?')) return;

        try {
            const response = await apiFetch(`${API}/routes/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                fetchRoutes(academicYear);
            } else {
                alert('Failed to delete route');
            }
        } catch (error) {
            console.error('Error deleting route:', error);
            alert('Error deleting route');
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setModalActiveTab('details');
        setSelectedStageIndex(null);
        setShowAllStagesOnMap(false);
        setDraggedStageIndex(null);
        setDragOverStageIndex(null);
        setHasPendingStageOrder(false);
        destroyModalMap();
        setFormData({
            routeId: '', routeName: '', startPoint: '', endPoint: '',
            totalDistance: '', estimatedTime: '', campus: '', zone: '', stages: []
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editingId
                ? `${API}/routes/${editingId}`
                : `${API}/routes`;

            const method = editingId ? 'PUT' : 'POST';

            const payload = buildRouteUpdatePayload(formData);

            const response = await apiFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                handleCloseModal();
                await fetchRoutes(academicYear);
                setSuccessModalMessage(`Route ${editingId ? 'updated' : 'created'} for academic year ${academicYear} successfully.`);
                setIsSuccessModalOpen(true);
            } else {
                setSaveMessage({
                    text: data.message || `Failed to ${editingId ? 'update' : 'create'} route`,
                    type: 'error',
                });
            }
        } catch (error) {
            console.error(`Error ${editingId ? 'updating' : 'creating'} route:`, error);
            setSaveMessage({
                text: `Error ${editingId ? 'updating' : 'creating'} route`,
                type: 'error',
            });
        }
    };

    useEffect(() => {
        const fetchPreview = async () => {
            const { sourceRouteId, stageName } = transferData;
            if (!sourceRouteId || !stageName) {
                setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
                return;
            }

            setTransferPreview(prev => ({ ...prev, loading: true }));
            try {
                const response = await apiFetch(
                    `${API}/routes/transfer-preview?sourceRouteId=${encodeURIComponent(sourceRouteId)}&stageName=${encodeURIComponent(stageName)}&academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setTransferPreview({
                        studentCount: data.studentCount || 0,
                        employeeCount: data.employeeCount || 0,
                        passengers: data.passengers || [],
                        loading: false
                    });
                } else {
                    setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
                }
            } catch (error) {
                console.error('Error fetching stage transfer preview:', error);
                setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
            }
        };

        fetchPreview();
    }, [transferData.sourceRouteId, transferData.stageName, academicYear]);

    useEffect(() => {
        const fetchDestBuses = async () => {
            const { destinationRouteId } = transferData;
            if (!destinationRouteId) {
                setDestBuses([]);
                return;
            }

            setDestBusesLoading(true);
            try {
                const response = await apiFetch(
                    `${API}/transport-requests/route-buses?route_id=${encodeURIComponent(destinationRouteId)}&academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setDestBuses(data.busesOnRoute || []);
                } else {
                    setDestBuses([]);
                }
            } catch (error) {
                console.error('Error fetching destination route buses:', error);
                setDestBuses([]);
            } finally {
                setDestBusesLoading(false);
            }
        };

        fetchDestBuses();
    }, [transferData.destinationRouteId, academicYear]);

    const handleTransferSubmit = (e) => {
        e.preventDefault();
        const { sourceRouteId, stageName, destinationRouteId } = transferData;
        if (!sourceRouteId || !stageName || !destinationRouteId) {
            setTransferMessage({ text: 'Please fill in all route and stage details.', type: 'error' });
            return;
        }

        setIsConfirmModalOpen(true);
    };

    const executeStageTransfer = async () => {
        setIsConfirmModalOpen(false);
        setTransferSubmitting(true);
        setTransferMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API}/routes/transfer-stage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...transferData,
                    academicYear
                })
            });

            const data = await response.json();
            if (response.ok) {
                setTransferMessage({
                    text: (data.message || 'Stage transferred successfully.') + ' Note: ID cards must be reprinted for the affected passengers as their route has changed.',
                    type: 'success'
                });
                setTransferData({ sourceRouteId: '', stageName: '', destinationRouteId: '' });
                await fetchRoutes(academicYear); // Refresh routes
            } else {
                setTransferMessage({
                    text: data.message || 'Failed to transfer stage.',
                    type: 'error'
                });
            }
        } catch (error) {
            console.error('Error transferring stage:', error);
            setTransferMessage({ text: 'Error transferring stage. Please try again.', type: 'error' });
        } finally {
            setTransferSubmitting(false);
        }
    };

    const filteredRoutes = (selectedCampusFilter
        ? routes.filter((route) => campusIdsMatch(getCampusId(route.campus), selectedCampusFilter))
        : routes
    ).filter((route) => {
        const searchLower = searchQuery.toLowerCase();
        return (
            (route.routeId || '').toLowerCase().includes(searchLower) ||
            (route.routeName || '').toLowerCase().includes(searchLower)
        );
    }).slice().sort((a, b) =>
        (a.routeId || '').localeCompare(b.routeId || '', undefined, { numeric: true, sensitivity: 'base' })
    );

    // Student Transfer Fetch & Handlers
    useEffect(() => {
        const fetchRoutePassengers = async () => {
            const { sourceRouteId, stageName } = studentTransferData;
            if (!sourceRouteId) {
                setPassengerList([]);
                setSelectedPassengers([]);
                return;
            }

            setPassengerListLoading(true);
            try {
                let url = `${API}/routes/passengers?routeId=${encodeURIComponent(sourceRouteId)}&academicYear=${encodeURIComponent(academicYear)}`;
                if (stageName) {
                    url += `&stageName=${encodeURIComponent(stageName)}`;
                }
                const response = await apiFetch(url);
                const data = await response.json();
                if (response.ok) {
                    setPassengerList(data.passengers || []);
                    setSelectedPassengers([]);
                } else {
                    setPassengerList([]);
                    setSelectedPassengers([]);
                }
            } catch (error) {
                console.error('Error fetching route passengers:', error);
                setPassengerList([]);
                setSelectedPassengers([]);
            } finally {
                setPassengerListLoading(false);
            }
        };

        fetchRoutePassengers();
    }, [studentTransferData.sourceRouteId, studentTransferData.stageName, academicYear]);

    useEffect(() => {
        const fetchStudentDestBuses = async () => {
            const { destinationRouteId } = studentTransferData;
            if (!destinationRouteId) {
                setStudentDestBuses([]);
                return;
            }

            setStudentDestBusesLoading(true);
            try {
                const response = await apiFetch(
                    `${API}/transport-requests/route-buses?route_id=${encodeURIComponent(destinationRouteId)}&academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setStudentDestBuses(data.busesOnRoute || []);
                } else {
                    setStudentDestBuses([]);
                }
            } catch (error) {
                console.error('Error fetching student destination route buses:', error);
                setStudentDestBuses([]);
            } finally {
                setStudentDestBusesLoading(false);
            }
        };

        fetchStudentDestBuses();
    }, [studentTransferData.destinationRouteId, academicYear]);

    useEffect(() => {
        if (activeTab === 'history') {
            const fetchHistory = async () => {
                setHistoryLoading(true);
                try {
                    const [transferRes, mappingRes] = await Promise.all([
                        apiFetch(`${API}/routes/transfer-history`),
                        apiFetch(`${API}/routes/mapping-history`)
                    ]);
                    const transferData = await transferRes.json();
                    const mappingData = await mappingRes.json();
                    if (transferRes.ok) {
                        setTransferHistoryList(transferData.history || []);
                    }
                    if (mappingRes.ok) {
                        setMappingHistoryList(mappingData.history || []);
                    }
                } catch (error) {
                    console.error('Error fetching history logs:', error);
                } finally {
                    setHistoryLoading(false);
                }
            };
            fetchHistory();
        }
    }, [activeTab]);

    const getFilteredPassengers = () => {
        if (typeFilter === 'both') return passengerList;
        return passengerList.filter(p => p.type === typeFilter);
    };

    const toggleSelectPassenger = (id) => {
        setSelectedPassengers(prev => 
            prev.includes(id) ? prev.filter(pId => pId !== id) : [...prev, id]
        );
    };

    const handleSelectAllPassengers = (filteredList) => {
        const filteredIds = filteredList.map(p => p._id);
        const allSelected = filteredIds.length > 0 && filteredIds.every(id => selectedPassengers.includes(id));
        if (allSelected) {
            setSelectedPassengers(prev => prev.filter(id => !filteredIds.includes(id)));
        } else {
            setSelectedPassengers(prev => [...new Set([...prev, ...filteredIds])]);
        }
    };

    const handleStudentTransferSubmit = (e) => {
        e.preventDefault();
        const { sourceRouteId, destinationRouteId, destinationStageName } = studentTransferData;
        if (!sourceRouteId || !destinationRouteId || !destinationStageName) {
            setStudentTransferMessage({ text: 'Please select source route, destination route and destination stage.', type: 'error' });
            return;
        }
        if (selectedPassengers.length === 0) {
            setStudentTransferMessage({ text: 'Please select at least one passenger to transfer.', type: 'error' });
            return;
        }
        setIsStudentConfirmModalOpen(true);
    };

    const executeStudentTransfer = async () => {
        setIsStudentConfirmModalOpen(false);
        setStudentTransferSubmitting(true);
        setStudentTransferMessage({ text: '', type: '' });

        try {
            const passengersToSend = selectedPassengers.map(id => {
                const found = passengerList.find(p => p._id === id);
                return { id: found._id, type: found.type };
            });

            const response = await apiFetch(`${API}/routes/transfer-passengers`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    passengers: passengersToSend,
                    destinationRouteId: studentTransferData.destinationRouteId,
                    destinationStageName: studentTransferData.destinationStageName,
                    academicYear
                })
            });

            const data = await response.json();
            if (response.ok) {
                setStudentTransferMessage({
                    text: (data.message || 'Passengers transferred successfully.') + ' Note: ID cards must be reprinted for the affected passengers as their route has changed.',
                    type: 'success'
                });
                setStudentTransferData(prev => ({
                    ...prev,
                    destinationRouteId: '',
                    destinationStageName: ''
                }));
                // Re-fetch route passengers
                const sourceRouteId = studentTransferData.sourceRouteId;
                const stageName = studentTransferData.stageName;
                let url = `${API}/routes/passengers?routeId=${encodeURIComponent(sourceRouteId)}&academicYear=${encodeURIComponent(academicYear)}`;
                if (stageName) {
                    url += `&stageName=${encodeURIComponent(stageName)}`;
                }
                const refreshRes = await apiFetch(url);
                if (refreshRes.ok) {
                    const refreshData = await refreshRes.json();
                    setPassengerList(refreshData.passengers || []);
                }
                setSelectedPassengers([]);
                await fetchRoutes(academicYear);
            } else {
                setStudentTransferMessage({
                    text: data.message || 'Failed to transfer passengers.',
                    type: 'error'
                });
            }
        } catch (error) {
            console.error('Error executing student transfer:', error);
            setStudentTransferMessage({ text: 'Error transferring passengers. Please try again.', type: 'error' });
        } finally {
            setStudentTransferSubmitting(false);
        }
    };



    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));

    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);

    useEffect(() => {
        if (campuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampusFilter(String(userCampuses[0]));
        }
    }, [campuses]);

    return (
        <Layout>
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                        {activeTab === 'network' ? `Route Network (${filteredRoutes.length})` : activeTab === 'bus-mapping' ? `Bus–Route Mapping` : activeTab === 'transfer' ? 'Stage Migration' : activeTab === 'student-transfer' ? 'Student & Passenger Transfer' : 'Transfer History'}
                    </h2>
                    <p className="text-slate-500 text-xs mt-0.5">
                        {activeTab === 'network' 
                            ? 'Design routes, manage stages, and set fares per academic year.' 
                            : activeTab === 'bus-mapping'
                                ? 'Assign buses to routes, manage seating capacities, and preview passenger assignments.'
                                : activeTab === 'transfer'
                                    ? 'Transfer a route stage to another route network, remapping all linked passengers.'
                                    : activeTab === 'student-transfer'
                                        ? 'Transfer specific students/passengers to a different route and stage.'
                                        : 'Log history of all past stage and passenger transfers.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {(activeTab === 'network' || activeTab === 'bus-mapping') && (
                        <div className="relative flex-shrink-0 w-64">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                            <input
                                type="text"
                                placeholder="Search by route ID or name..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-9 pr-4 py-2 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-700 placeholder-slate-400 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all"
                            />
                        </div>
                    )}
                    {(activeTab === 'network' || activeTab === 'bus-mapping') && allowedCampuses.length > 1 && (
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                            <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Campus</span>
                            <select
                                value={selectedCampusFilter}
                                onChange={(e) => setSelectedCampusFilter(e.target.value)}
                                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer outline-none"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>{campus.name} ({campus.code})</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                        <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Academic Year</span>
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer outline-none"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    {activeTab === 'network' && (
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-900 hover:bg-blue-700 text-white px-6 py-3 rounded-lg text-sm font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                        >
                            <Plus className="mr-2 group-hover:rotate-90 transition-transform" size={18} />
                            Create Route
                        </button>
                    )}
                </div>
            </div>

            {/* Tab pill navigation */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-sm self-start mb-6 w-fit">
                <button
                    onClick={() => { setActiveTab('network'); setTransferMessage({ text: '', type: '' }); setStudentTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'network' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Route Network
                </button>
                <button
                    onClick={() => { setActiveTab('bus-mapping'); setTransferMessage({ text: '', type: '' }); setStudentTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'bus-mapping' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Bus–Route Mapping
                </button>
                <button
                    onClick={() => { setActiveTab('transfer'); setSaveMessage({ text: '', type: '' }); setStudentTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'transfer' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Transfer Stage
                </button>
                <button
                    onClick={() => { setActiveTab('student-transfer'); setSaveMessage({ text: '', type: '' }); setTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'student-transfer' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Transfer Students
                </button>
                <button
                    onClick={() => { setActiveTab('history'); setSaveMessage({ text: '', type: '' }); setTransferMessage({ text: '', type: '' }); setStudentTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'history' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    History Logs
                </button>
            </div>

            {activeTab === 'network' ? (
                <>
                    {saveMessage.text && (
                        <div className={`mb-6 p-4 rounded-xl border ${saveMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                            {saveMessage.text}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader size={40} text="Loading route data..." />
                        </div>
                    ) : filteredRoutes.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px] flex flex-col items-center justify-center p-8">
                            <div className="bg-slate-50 p-6 rounded-full mb-4">
                                <Map size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">No Routes Found</h3>
                            <p className="text-slate-500 text-center max-w-md mx-auto">
                                {selectedCampusFilter 
                                  ? "There are no routes matching the selected campus." 
                                  : "Define the pickup and drop points for your students. Create your first route to get started."}
                            </p>
                            {!selectedCampusFilter && (
                                <button onClick={() => setIsModalOpen(true)} className="mt-6 flex items-center text-blue-600 font-semibold hover:text-blue-800 hover:bg-blue-50 px-4 py-2 rounded-lg transition-all">
                                    <Plus size={20} className="mr-2" />
                                    Create first route
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2">Route Details</th>
                                            <th className="px-3 py-2">Path (Start → End)</th>
                                            <th className="px-3 py-2">Distance & Time</th>
                                            <th className="px-3 py-2">Stages</th>
                                            <th className="px-3 py-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredRoutes.map((route) => {
                                            const isExpanded = expandedRouteId === route._id;
                                            return (
                                                <React.Fragment key={route._id}>
                                                    <tr 
                                                        onClick={() => toggleRoute(route._id)}
                                                        className={`cursor-pointer transition-colors group ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded border border-blue-200 font-mono whitespace-nowrap">
                                                                        {route.routeId}
                                                                    </span>
                                                                    <span className="font-bold text-slate-800 text-xs">{route.routeName}</span>
                                                                </div>
                                                                <div className="flex flex-wrap gap-1.5 items-center mt-0.5">
                                                                    {route.campus && (
                                                                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-semibold rounded border border-blue-100">
                                                                            Campus: {route.campus.name || route.campus}
                                                                        </span>
                                                                    )}
                                                                    {route.zone && (
                                                                        <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-[9px] font-semibold rounded border border-purple-100">
                                                                            Zone: {route.zone}
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center text-xs text-slate-600 font-medium">
                                                                <span className="truncate max-w-[120px]" title={route.startPoint}>{route.startPoint}</span>
                                                                <ArrowRight size={12} className="mx-2 text-slate-300" />
                                                                <span className="truncate max-w-[120px]" title={route.endPoint}>{route.endPoint}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-xs font-bold text-slate-700">{route.totalDistance} <span className="text-[10px] text-slate-400 font-medium uppercase ml-0.5">KM</span></span>
                                                                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                                                                    <Clock size={10} />
                                                                    {route.estimatedTime}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${route.stages.length > 0 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                                                {route.stages.length}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <button
                                                                    onClick={(e) => handleEdit(route, e)}
                                                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                                    title="Edit"
                                                                >
                                                                    <Edit size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => handleDelete(route._id, e)}
                                                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                                <div className={`p-1 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-blue-600' : ''}`}>
                                                                    <ChevronDown size={14} />
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan="5" className="px-4 py-4 bg-slate-50/50 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                                                    {/* Left Side: Stages Block */}
                                                                    <div className="lg:col-span-2 bg-white rounded-xl border border-slate-100 shadow-sm p-5">
                                                                        <div className="flex items-center gap-2 mb-4">
                                                                            <Milestone size={14} className="text-blue-600" />
                                                                            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                                                Stages & Fare Distribution ({academicYear})
                                                                            </h4>
                                                                        </div>
                                                                        {route.stages.length === 0 ? (
                                                                            <p className="text-xs text-slate-400 italic py-2">No stages defined for this route network.</p>
                                                                        ) : (
                                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                                {route.stages.map((stage, index) => {
                                                                                    const displayFare = resolveStageFareForYear(stage, academicYear);
                                                                                    return (
                                                                                    <div key={index} className="bg-slate-50 p-3 rounded-lg border border-slate-100 flex items-center justify-between group/stage hover:border-blue-200 hover:bg-blue-50/30 transition-colors">
                                                                                        <div className="flex items-center gap-2">
                                                                                            <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[9px] group-hover/stage:bg-blue-600 group-hover/stage:text-white transition-colors">
                                                                                                {index + 1}
                                                                                            </span>
                                                                                            <div>
                                                                                                <p className="font-bold text-slate-800 text-xs">{stage.stageName}</p>
                                                                                                <p className="text-[9px] text-slate-400 font-medium">{stage.distanceFromStart} km</p>
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded border border-emerald-100 whitespace-nowrap ml-2">
                                                                                            ₹{displayFare}
                                                                                            {stage.hasYearOverride && stage.baseFare != null && stage.baseFare !== displayFare && (
                                                                                                <span className="block text-[8px] font-semibold text-slate-400 line-through">₹{stage.baseFare}</span>
                                                                                            )}
                                                                                            {!stage.hasYearOverride && (
                                                                                                <span className="block text-[8px] font-semibold text-slate-400">base</span>
                                                                                            )}
                                                                                        </div>
                                                                                    </div>
                                                                                );})}
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* Right Side: Route Details & Map */}
                                                                    <div className="lg:col-span-1 bg-white rounded-xl border border-slate-100 shadow-sm p-5 space-y-4">
                                                                        <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest flex items-center gap-2 pb-1 border-b border-slate-100">
                                                                            <Navigation size={12} className="text-blue-600" />
                                                                            Route Summary
                                                                        </h4>
                                                                        
                                                                        {/* Map Displays First */}
                                                                        <RouteSummaryMap stages={route.stages} />

                                                                        {/* Details below map */}
                                                                        <div className="space-y-3 pt-2">
                                                                            {/* Row: Route ID, Campus, Zone */}
                                                                            <div className="grid grid-cols-3 gap-2">
                                                                                <div>
                                                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Route ID</p>
                                                                                    <p className="text-xs font-bold text-slate-800 font-mono bg-blue-50 p-2 rounded border border-blue-100 text-center">{route.routeId}</p>
                                                                                </div>
                                                                                <div>
                                                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Campus</p>
                                                                                    <p className="text-xs font-bold text-slate-700 bg-slate-50 p-2 rounded border border-slate-100 truncate text-center" title={route.campus?.name || 'None'}>
                                                                                        {route.campus?.code || route.campus?.name || '—'}
                                                                                    </p>
                                                                                </div>
                                                                                <div>
                                                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Zone</p>
                                                                                    <p className="text-xs font-bold text-slate-700 bg-slate-50 p-2 rounded border border-slate-100 truncate text-center" title={route.zone || 'None'}>
                                                                                        {route.zone || '—'}
                                                                                    </p>
                                                                                </div>
                                                                            </div>

                                                                            {/* Route Name below */}
                                                                            <div>
                                                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider mb-1">Route Name</p>
                                                                                <p className="text-xs font-extrabold text-slate-800 bg-slate-50/50 p-2 rounded border border-slate-200">{route.routeName}</p>
                                                                            </div>
                                                                        </div>
                                                                    </div>
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
                    )}
                </>
            ) : activeTab === 'bus-mapping' ? (
                <>
                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader size={40} text="Loading route mapping..." />
                        </div>
                    ) : filteredRoutes.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px] flex flex-col items-center justify-center p-8">
                            <div className="bg-slate-50 p-6 rounded-full mb-4">
                                <Bus size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">No Routes Found</h3>
                            <p className="text-slate-500 text-center max-w-md mx-auto">
                                There are no routes matching the selected campus.
                            </p>
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2 w-72">Route Details</th>
                                            <th className="px-3 py-2">Path (Start → End)</th>
                                            <th className="px-3 py-2">Assigned Bus</th>
                                            <th className="px-3 py-2 w-36">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredRoutes.map((route) => {
                                            const assignedBus = buses.find((b) => b.assignedRouteId === route.routeId);
                                            return (
                                                <tr key={route._id} className="hover:bg-slate-50/50 transition-colors text-xs">
                                                    <td className="px-3 py-3">
                                                        <div className="flex flex-col gap-1">
                                                            <div className="flex items-center gap-2">
                                                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-bold rounded border border-blue-200 font-mono whitespace-nowrap">
                                                                    {route.routeId}
                                                                </span>
                                                                <span className="font-bold text-slate-800 text-xs">{route.routeName}</span>
                                                            </div>
                                                            <div className="flex flex-wrap gap-1.5 items-center mt-0.5">
                                                                {route.campus && (
                                                                    <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-semibold rounded border border-blue-100">
                                                                        Campus: {route.campus.name || route.campus}
                                                                    </span>
                                                                )}
                                                                {route.zone && (
                                                                    <span className="px-1.5 py-0.5 bg-purple-50 text-purple-700 text-[9px] font-semibold rounded border border-purple-100">
                                                                        Zone: {route.zone}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="px-3 py-3 text-slate-600 font-medium">
                                                        {route.startPoint} ➔ {route.endPoint}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        {assignedBus ? (
                                                            <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-800 font-bold border border-blue-200 px-2.5 py-1 rounded-lg text-xs shadow-sm">
                                                                <Bus size={13} className="text-blue-600" />
                                                                Bus {assignedBus.busNumber} ({assignedBus.type})
                                                            </span>
                                                        ) : (
                                                            <span className="text-xs text-slate-400 font-bold italic">Unassigned</span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-3">
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                setExpandedRouteEditId(route._id);
                                                                const draftBusId = assignedBus ? assignedBus._id : '';
                                                                setRouteWiseDrafts(prev => ({
                                                                    ...prev,
                                                                    [route.routeId]: {
                                                                        busId: draftBusId,
                                                                        exitDate: todayDateInput(),
                                                                        entryDate: todayDateInput()
                                                                    }
                                                                }));
                                                                fetchMappingPreview(route.routeId, 'route', assignedBus ? assignedBus.busNumber : '', route.routeId);
                                                            }}
                                                            className="flex items-center text-blue-900 font-bold hover:underline gap-1 text-xs"
                                                        >
                                                            <Edit size={13} />
                                                            Edit Mapping
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </>
            ) : activeTab === 'transfer' ? (
                <div className="flex flex-col lg:flex-row gap-6 items-start animate-in fade-in slide-in-from-top-2 duration-300 w-full">
                    {/* Left: Form */}
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                        <h3 className="text-lg font-bold text-slate-800 mb-2">Stage Migration Panel</h3>
                        <p className="text-slate-500 text-xs mb-6">Relocate a stage from a source route to a destination route. Passengers currently assigned to this stage will be automatically updated.</p>

                        {transferMessage.text && (
                            <div className={`mb-6 p-4 rounded-xl border text-xs font-semibold ${transferMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {transferMessage.text}
                            </div>
                        )}

                        <form onSubmit={handleTransferSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Source Route</label>
                                    <select
                                        value={transferData.sourceRouteId}
                                        onChange={(e) => setTransferData({ sourceRouteId: e.target.value, stageName: '', destinationRouteId: '' })}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white"
                                        required
                                    >
                                        <option value="">Select source route</option>
                                        {routes.map(r => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Stage to Transfer</label>
                                    <select
                                        value={transferData.stageName}
                                        onChange={(e) => setTransferData(prev => ({ ...prev, stageName: e.target.value }))}
                                        disabled={!transferData.sourceRouteId}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                        required
                                    >
                                        <option value="">Select stage</option>
                                        {transferData.sourceRouteId && routes.find(r => r.routeId === transferData.sourceRouteId)?.stages.map(s => (
                                            <option key={s.stageName} value={s.stageName}>{s.stageName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {transferData.sourceRouteId && transferData.stageName && (
                                <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3">Affected Passenger Summary</h4>
                                    {transferPreview.loading ? (
                                        <p className="text-xs text-blue-600">Calculating preview...</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-4 text-center">
                                            <div className="bg-white p-3 rounded-xl border border-blue-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase">Student Passengers</p>
                                                <span className="text-xl font-black text-blue-900">{transferPreview.studentCount}</span>
                                            </div>
                                            <div className="bg-white p-3 rounded-xl border border-blue-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase">Employee Passengers</p>
                                                <span className="text-xl font-black text-blue-900">{transferPreview.employeeCount}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Destination Route</label>
                                <select
                                    value={transferData.destinationRouteId}
                                    onChange={(e) => setTransferData(prev => ({ ...prev, destinationRouteId: e.target.value }))}
                                    disabled={!transferData.sourceRouteId || !transferData.stageName}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                    required
                                >
                                    <option value="">Select destination route</option>
                                    {routes.filter(r => r.routeId !== transferData.sourceRouteId).map(r => (
                                        <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                    ))}
                                </select>
                            </div>

                            {transferData.destinationRouteId && (
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Destination Route Bus Vacancy</h4>
                                    {destBusesLoading ? (
                                        <p className="text-xs text-slate-400">Loading vacancy details...</p>
                                    ) : destBuses.length === 0 ? (
                                        <p className="text-xs text-red-600 font-semibold italic">No buses assigned to destination route yet.</p>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {destBuses.map((bus) => (
                                                <div key={bus.busNumber} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-xs">
                                                    <div>
                                                        <span className="font-bold text-slate-800">Bus {bus.busNumber}</span>
                                                        <span className="ml-2 text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                                                            {bus.seatsAvailable} / {bus.capacity} seats free
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                                                            <div 
                                                                className={`h-full ${bus.seatsAvailable === 0 ? 'bg-red-500' : (bus.seatsAvailable < 5 ? 'bg-yellow-500' : 'bg-emerald-500')}`} 
                                                                style={{ width: `${(bus.seatsFilled / bus.capacity) * 100}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-black text-[10px] text-slate-500">
                                                            {Math.round((bus.seatsFilled / bus.capacity) * 100)}% filled
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={transferSubmitting || !transferData.sourceRouteId || !transferData.stageName || !transferData.destinationRouteId}
                                className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-xl disabled:opacity-50 transition-all shadow-md flex items-center justify-center gap-2"
                            >
                                {transferSubmitting ? 'Transferring...' : 'Execute Stage Migration'}
                            </button>
                        </form>
                    </div>

                    {/* Right: Passenger List Card */}
                    <div className="w-full lg:w-96 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col max-h-[580px]">
                        <h3 className="text-md font-bold text-slate-800">Passengers List</h3>
                        <p className="text-slate-400 text-[10px] mt-0.5">Active or pending passengers on the selected stage.</p>

                        {!transferData.sourceRouteId || !transferData.stageName ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-300">
                                <p className="text-xs font-semibold">Select a route and stage to load passenger list.</p>
                            </div>
                        ) : transferPreview.loading ? (
                            <div className="flex-1 flex items-center justify-center py-20">
                                <span className="text-xs text-slate-400">Loading list...</span>
                            </div>
                        ) : transferPreview.passengers.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400">
                                <p className="text-xs italic">No passengers found on this stage.</p>
                            </div>
                        ) : (
                            <div className="overflow-y-auto flex-1 pr-1 custom-scrollbar space-y-2.5 mt-4">
                                {transferPreview.passengers.map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                        <div className="min-w-0 flex-1 pr-2">
                                            <p className="font-bold text-slate-800 text-xs truncate" title={p.name}>{p.name}</p>
                                            <p className="text-[10px] text-slate-400 font-medium font-mono truncate">{p.id}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${p.type === 'student' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                                {p.type}
                                            </span>
                                            <span className={`text-[8px] font-bold ${p.status === 'approved' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                {p.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ) : activeTab === 'student-transfer' ? (
                <div className="flex flex-col lg:flex-row gap-6 items-start animate-in fade-in slide-in-from-top-2 duration-300 w-full">
                    {/* Left: Student Transfer Form */}
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                        <h3 className="text-lg font-bold text-slate-800 mb-2">Student & Passenger Transfer Panel</h3>
                        <p className="text-slate-500 text-xs mb-6">Select a source route and stage to view passengers, select the ones to move, and select the destination route and stage.</p>

                        {studentTransferMessage.text && (
                            <div className={`mb-6 p-4 rounded-xl border text-xs font-semibold ${studentTransferMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {studentTransferMessage.text}
                            </div>
                        )}

                        <form onSubmit={handleStudentTransferSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Source Route</label>
                                    <select
                                        value={studentTransferData.sourceRouteId}
                                        onChange={(e) => setStudentTransferData({ sourceRouteId: e.target.value, stageName: '', destinationRouteId: '', destinationStageName: '' })}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white"
                                        required
                                    >
                                        <option value="">Select source route</option>
                                        {routes.map(r => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Source Stage (Optional Filter)</label>
                                    <select
                                        value={studentTransferData.stageName}
                                        onChange={(e) => setStudentTransferData(prev => ({ ...prev, stageName: e.target.value }))}
                                        disabled={!studentTransferData.sourceRouteId}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                    >
                                        <option value="">All Stages</option>
                                        {studentTransferData.sourceRouteId && routes.find(r => r.routeId === studentTransferData.sourceRouteId)?.stages.map(s => (
                                            <option key={s.stageName} value={s.stageName}>{s.stageName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-slate-100 pt-5">
                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Destination Route</label>
                                    <select
                                        value={studentTransferData.destinationRouteId}
                                        onChange={(e) => setStudentTransferData(prev => ({ ...prev, destinationRouteId: e.target.value, destinationStageName: '' }))}
                                        disabled={!studentTransferData.sourceRouteId}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                        required
                                    >
                                        <option value="">Select destination route</option>
                                        {routes.filter(r => r.routeId !== studentTransferData.sourceRouteId).map(r => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Destination Stage</label>
                                    <select
                                        value={studentTransferData.destinationStageName}
                                        onChange={(e) => setStudentTransferData(prev => ({ ...prev, destinationStageName: e.target.value }))}
                                        disabled={!studentTransferData.destinationRouteId}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                        required
                                    >
                                        <option value="">Select destination stage</option>
                                        {studentTransferData.destinationRouteId && routes.find(r => r.routeId === studentTransferData.destinationRouteId)?.stages.map(s => (
                                            <option key={s.stageName} value={s.stageName}>{s.stageName} (Fare: ₹{s.fare})</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {studentTransferData.destinationRouteId && (
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Destination Route Bus Vacancy</h4>
                                    {studentDestBusesLoading ? (
                                        <p className="text-xs text-slate-400">Loading vacancy details...</p>
                                    ) : studentDestBuses.length === 0 ? (
                                        <p className="text-xs text-red-600 font-semibold italic">No buses assigned to destination route yet.</p>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {studentDestBuses.map((bus) => (
                                                <div key={bus.busNumber} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-xs">
                                                    <div>
                                                        <span className="font-bold text-slate-800">Bus {bus.busNumber}</span>
                                                        <span className="ml-2 text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                                                            {bus.seatsAvailable} / {bus.capacity} seats free
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                                                            <div 
                                                                className={`h-full ${bus.seatsAvailable === 0 ? 'bg-red-500' : (bus.seatsAvailable < 5 ? 'bg-yellow-500' : 'bg-emerald-500')}`} 
                                                                style={{ width: `${(bus.seatsFilled / bus.capacity) * 100}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-black text-[10px] text-slate-500">
                                                            {Math.round((bus.seatsFilled / bus.capacity) * 100)}% filled
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                            {(() => {
                                                const totalAvailable = studentDestBuses.reduce((sum, b) => sum + (b.seatsAvailable || 0), 0);
                                                if (selectedPassengers.length > totalAvailable) {
                                                    return (
                                                        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl text-xs flex items-start gap-2 animate-in fade-in duration-200">
                                                            <span className="text-sm shrink-0">⚠️</span>
                                                            <div className="font-semibold">
                                                                Note: Destination route has only {totalAvailable} seat(s) available, but you have selected {selectedPassengers.length} passenger(s) to transfer.
                                                            </div>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            })()}
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={
                                    studentTransferSubmitting || 
                                    !studentTransferData.sourceRouteId || 
                                    !studentTransferData.destinationRouteId || 
                                    !studentTransferData.destinationStageName || 
                                    selectedPassengers.length === 0 ||
                                    (studentDestBuses.length > 0 && selectedPassengers.length > studentDestBuses.reduce((sum, b) => sum + (b.seatsAvailable || 0), 0))
                                }
                                className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-xl disabled:opacity-50 transition-all shadow-md flex items-center justify-center gap-2"
                            >
                                {studentTransferSubmitting ? 'Transferring...' : `Transfer Selected Passengers (${selectedPassengers.length})`}
                            </button>
                        </form>
                    </div>

                    {/* Right: Passenger Checklist Card */}
                    <div className="w-full lg:w-96 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col max-h-[580px]">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                            <div>
                                <h3 className="text-md font-bold text-slate-800">Select Passengers</h3>
                                <p className="text-slate-400 text-[10px] mt-0.5">Choose passengers to transfer to the destination.</p>
                            </div>
                            <select
                                value={typeFilter}
                                onChange={(e) => { setTypeFilter(e.target.value); setSelectedPassengers([]); }}
                                className="text-[10px] font-bold text-slate-650 bg-slate-100 border border-slate-200 px-2 py-1 rounded-lg outline-none"
                            >
                                <option value="both">All Types</option>
                                <option value="student">Students</option>
                                <option value="employee">Employees</option>
                            </select>
                        </div>

                        {!studentTransferData.sourceRouteId ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-300">
                                <p className="text-xs font-semibold">Select a route to load passengers list.</p>
                            </div>
                        ) : passengerListLoading ? (
                            <div className="flex-1 flex items-center justify-center py-20">
                                <span className="text-xs text-slate-400">Loading list...</span>
                            </div>
                        ) : getFilteredPassengers().length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400">
                                <p className="text-xs italic">No passengers found matching filter.</p>
                            </div>
                        ) : (() => {
                            const filteredList = getFilteredPassengers();
                            const allSelected = filteredList.length > 0 && filteredList.every(p => selectedPassengers.includes(p._id));
                            return (
                                <>
                                    <div className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/80 mt-3 font-semibold text-xs text-slate-600">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input 
                                                type="checkbox"
                                                checked={allSelected}
                                                onChange={() => handleSelectAllPassengers(filteredList)}
                                                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
                                            />
                                            Select All Visible
                                        </label>
                                        <span className="text-[10px] text-slate-400 font-bold bg-white px-2 py-0.5 rounded-md border border-slate-100">
                                            {filteredList.filter(p => selectedPassengers.includes(p._id)).length} / {filteredList.length} Selected
                                        </span>
                                    </div>
                                    <div className="overflow-y-auto flex-1 pr-1 custom-scrollbar space-y-2 mt-3">
                                        {filteredList.map((p) => {
                                            const isChecked = selectedPassengers.includes(p._id);
                                            return (
                                                <div 
                                                    key={p._id}
                                                    onClick={() => toggleSelectPassenger(p._id)}
                                                    className={`flex items-center justify-between p-3 rounded-xl border transition-colors cursor-pointer select-none ${
                                                        isChecked 
                                                            ? 'border-blue-200 bg-blue-50/20 hover:bg-blue-50/30' 
                                                            : 'border-slate-100 bg-slate-50/50 hover:bg-slate-50'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3 min-w-0 flex-1 pr-2">
                                                        <input 
                                                            type="checkbox"
                                                            checked={isChecked}
                                                            onChange={() => {}} // handled by parent div onClick
                                                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5 shrink-0"
                                                        />
                                                        <div className="min-w-0">
                                                            <p className="font-bold text-slate-800 text-xs truncate" title={p.name}>{p.name}</p>
                                                            <p className="text-[10px] text-slate-400 font-medium font-mono truncate">{p.admissionNumber} {p.stage_name && `· ${p.stage_name}`}</p>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-col items-end gap-1 shrink-0">
                                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${p.type === 'student' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                                            {p.type}
                                                        </span>
                                                        <span className={`text-[8px] font-bold ${p.status === 'approved' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                            {p.status}
                                                        </span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </>
                            );
                        })()}
                    </div>
                </div>
            ) : (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8 animate-in fade-in slide-in-from-top-2 duration-300 w-full">
                    <div className="flex items-center justify-between border-b border-slate-100 pb-4 mb-6">
                        <div>
                            <h3 className="text-lg font-bold text-slate-800">Transfer Logs & History</h3>
                            <p className="text-slate-500 text-xs mt-0.5">Audit log of all past stage migrations and passenger transfers.</p>
                        </div>
                    </div>

                    {/* Sub-tab selection */}
                    <div className="flex border-b border-slate-200 mb-6 text-xs gap-6 font-bold">
                        <button
                            type="button"
                            onClick={() => setHistorySubTab('transfers')}
                            className={`pb-2.5 transition-all outline-none border-b-2 ${historySubTab === 'transfers' ? 'text-blue-900 border-blue-900 font-bold' : 'text-slate-400 hover:text-slate-600 border-transparent'}`}
                        >
                            Passenger Transfers
                        </button>
                        <button
                            type="button"
                            onClick={() => setHistorySubTab('mappings')}
                            className={`pb-2.5 transition-all outline-none border-b-2 ${historySubTab === 'mappings' ? 'text-blue-900 border-blue-900 font-bold' : 'text-slate-400 hover:text-slate-600 border-transparent'}`}
                        >
                            Bus–Route Assignments
                        </button>
                    </div>

                    {historyLoading ? (
                        <div className="flex items-center justify-center py-20">
                            <span className="text-xs text-slate-400">Loading history...</span>
                        </div>
                    ) : historySubTab === 'transfers' ? (
                        transferHistoryList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <p className="text-xs italic">No transfer logs found.</p>
                            </div>
                        ) : (
                            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar animate-in fade-in duration-200">
                                {transferHistoryList.map((log) => (
                                    <div key={log._id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/30 hover:bg-slate-50 transition-colors">
                                        <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase ${
                                                    log.type === 'stage' 
                                                        ? 'bg-blue-100 text-blue-800 border border-blue-200' 
                                                        : 'bg-purple-100 text-purple-800 border border-purple-200'
                                                }`}>
                                                    {log.type === 'stage' ? 'Stage Migration' : 'Passenger Transfer'}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-bold">
                                                    {new Date(log.timestamp).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-bold">
                                                By: <span className="text-slate-800">{log.performedBy || 'System'}</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-xs">
                                            <div>
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Source</p>
                                                <p className="font-bold text-slate-700 truncate" title={log.sourceRouteName}>
                                                    {log.sourceRouteName} ({log.sourceRouteId})
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate" title={log.sourceStageName}>
                                                    Stage: {log.sourceStageName || 'All'}
                                                </p>
                                            </div>
                                            <div className="flex justify-center text-slate-350 shrink-0 select-none">
                                                ➔
                                            </div>
                                            <div>
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Destination</p>
                                                <p className="font-bold text-slate-700 truncate" title={log.destinationRouteName}>
                                                    {log.destinationRouteName} ({log.destinationRouteId})
                                                </p>
                                                <p className="text-[10px] text-slate-400 font-semibold mt-0.5 truncate" title={log.destinationStageName}>
                                                    Stage: {log.destinationStageName || 'All'}
                                                </p>
                                            </div>
                                        </div>

                                        <div className="mt-3 flex items-center justify-between">
                                            <span className="text-[10px] font-bold text-slate-500">
                                                {log.passengersCount} passenger(s) affected
                                            </span>
                                            {log.passengers && log.passengers.length > 0 && (
                                                <button
                                                    type="button"
                                                    onClick={() => setExpandedHistoryId(expandedHistoryId === log._id ? null : log._id)}
                                                    className="text-[10px] font-black text-blue-900 hover:text-blue-700 underline focus:outline-none transition-colors"
                                                >
                                                    {expandedHistoryId === log._id ? 'Hide Passengers' : 'View Passengers'}
                                                </button>
                                            )}
                                        </div>

                                        {expandedHistoryId === log._id && log.passengers && (
                                            <div className="mt-3 pt-3 border-t border-slate-200/60 grid grid-cols-1 sm:grid-cols-2 gap-2 animate-in fade-in slide-in-from-top-1 duration-200">
                                                {log.passengers.map((p, idx) => (
                                                    <div key={idx} className="flex justify-between items-center bg-white p-2 rounded-lg border border-slate-100 text-[10px]">
                                                        <div className="min-w-0 pr-1 flex-1">
                                                            <p className="font-bold text-slate-800 truncate" title={p.name}>{p.name}</p>
                                                            <p className="text-[8px] text-slate-400 font-mono font-medium truncate">{p.admissionNumber}</p>
                                                        </div>
                                                        <span className={`px-1 rounded text-[7px] font-black uppercase shrink-0 ${p.type === 'student' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                                            {p.type}
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )
                    ) : (
                        mappingHistoryList.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                <p className="text-xs italic">No bus mapping history logs found.</p>
                            </div>
                        ) : (
                            <div className="space-y-4 max-h-[600px] overflow-y-auto pr-1 custom-scrollbar animate-in fade-in duration-200">
                                {mappingHistoryList.map((log) => (
                                    <div key={log._id} className="border border-slate-200 rounded-2xl p-4 bg-slate-50/30 hover:bg-slate-50 transition-colors">
                                        <div className="flex flex-wrap justify-between items-start gap-2 mb-3">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2 py-0.5 rounded-lg text-[10px] font-black uppercase border ${
                                                    log.action === 'assigned' 
                                                        ? 'bg-green-50 text-green-700 border-green-200' 
                                                        : log.action === 'changed'
                                                            ? 'bg-amber-50 text-amber-700 border-amber-200'
                                                            : 'bg-red-50 text-red-700 border-red-200'
                                                }`}>
                                                    {log.action === 'assigned' ? 'Bus Assigned' : log.action === 'changed' ? 'Assignment Changed' : 'Bus Detached'}
                                                </span>
                                                <span className="text-[10px] text-slate-400 font-bold">
                                                    {new Date(log.createdAt || log.assignedAt).toLocaleString()}
                                                </span>
                                            </div>
                                            <div className="text-[10px] text-slate-500 font-bold">
                                                By: <span className="text-slate-800">{log.changedBy || 'System'}</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-xs font-semibold">
                                            <div>
                                                <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Bus Number</p>
                                                <p className="font-bold text-slate-800 font-mono mt-0.5">
                                                    Bus {log.busNumber}
                                                </p>
                                            </div>
                                            
                                            {log.action === 'removed' ? (
                                                <div className="col-span-3">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Action Description</p>
                                                    <p className="text-slate-600 mt-0.5">
                                                        Detached from route <span className="font-bold text-slate-800">{log.previousRouteName || log.previousRouteId} ({log.previousRouteId})</span>
                                                        {log.previousRouteExitDate && <> (Exit Date: <span className="font-bold">{new Date(log.previousRouteExitDate).toLocaleDateString()}</span>)</>}.
                                                    </p>
                                                </div>
                                            ) : (
                                                <>
                                                    <div>
                                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Previous Route</p>
                                                        <p className="font-bold text-slate-500 truncate" title={log.previousRouteName || 'None'}>
                                                            {log.previousRouteName ? `${log.previousRouteName} (${log.previousRouteId})` : '—'}
                                                        </p>
                                                    </div>
                                                    <div className="flex justify-center text-slate-350 shrink-0 select-none">
                                                        ➔
                                                    </div>
                                                    <div>
                                                        <p className="text-[8px] font-black text-slate-400 uppercase tracking-wider">Assigned Route</p>
                                                        <p className="font-bold text-slate-800 truncate" title={log.routeName || 'None'}>
                                                            {log.routeName ? `${log.routeName} (${log.routeId})` : '—'}
                                                        </p>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    )}
                </div>
            )}
            <Modal 
                isOpen={isModalOpen} 
                onClose={handleCloseModal} 
                title={editingId ? (
                    <div className="flex items-center gap-4 flex-wrap">
                        <span className="text-lg font-bold text-slate-800">Edit Route</span>
                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 text-[10px] font-bold">
                            <button
                                type="button"
                                onClick={() => setModalActiveTab('details')}
                                className={`px-3 py-1 rounded transition-all ${
                                    modalActiveTab === 'details'
                                        ? 'bg-white text-blue-900 shadow-sm border border-slate-200'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                Route Details
                            </button>
                            <button
                                type="button"
                                onClick={() => setModalActiveTab('stages')}
                                className={`px-3 py-1 rounded transition-all ${
                                    modalActiveTab === 'stages'
                                        ? 'bg-white text-blue-900 shadow-sm border border-slate-200'
                                        : 'text-slate-500 hover:text-slate-800'
                                }`}
                            >
                                Stage Details
                            </button>
                        </div>
                        {hasPendingStageOrder && (
                            <button
                                type="button"
                                onClick={handleSaveStageOrder}
                                disabled={isSavingStageOrder}
                                className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold shadow-sm transition-all disabled:opacity-60"
                            >
                                {isSavingStageOrder ? 'Saving...' : 'Save Route Sorting'}
                            </button>
                        )}
                    </div>
                ) : "Create New Route"} 
                maxWidth={editingId && modalActiveTab === 'stages' ? 'max-w-[85vw]' : 'max-w-2xl'}
                fixedHeight={editingId && modalActiveTab === 'stages'}
            >
                {editingId ? (
                    /* Edit Mode: Tabbed interface */
                    <div className={`${modalActiveTab === 'stages' ? 'h-full flex flex-col' : 'space-y-4'}`}>

                        <form onSubmit={handleSubmit} className={`${modalActiveTab === 'stages' ? 'flex-1 flex flex-col overflow-hidden' : ''}`}>
                            {modalActiveTab === 'details' ? (
                                /* Tab 1: Route Details */
                                <div className="space-y-4 max-w-xl mx-auto py-4">
                                    <div className="grid grid-cols-3 gap-4">
                                        <div className="col-span-1">
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Route ID</label>
                                            <input type="text" name="routeId" required value={formData.routeId} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. R01" />
                                        </div>
                                        <div className="col-span-2">
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Route Name</label>
                                            <input type="text" name="routeName" required value={formData.routeName} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. Campus Express" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Start Point</label>
                                            <input type="text" name="startPoint" required value={formData.startPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">End Point</label>
                                            <input type="text" name="endPoint" required value={formData.endPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Total Distance (km)</label>
                                            <input type="number" name="totalDistance" value={formData.totalDistance} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Est. Time</label>
                                            <input type="text" name="estimatedTime" value={formData.estimatedTime} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. 45 mins" />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Campus</label>
                                            <select
                                                name="campus"
                                                value={formData.campus || ''}
                                                onChange={handleChange}
                                                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white text-sm font-semibold"
                                            >
                                                <option value="">Select Campus (Optional)</option>
                                                {allowedCampuses.map(campus => (
                                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                                        {campus.name} ({campus.code})
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1.5">Zone</label>
                                            <input type="text" name="zone" value={formData.zone} onChange={handleChange} placeholder="e.g., East, West, North" className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                        </div>
                                    </div>
                                    <button type="submit" className="w-full bg-blue-900 text-white font-bold py-3 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-4 text-sm">
                                        Update Route Details
                                    </button>
                                </div>
                            ) : (
                                /* Tab 2: Stages - 3-Column Layout */
                                <div className="flex gap-4 py-2 flex-1 overflow-hidden">
                                    {/* Column 1: All Stages List */}
                                    <div className="w-[200px] shrink-0 flex flex-col bg-slate-50 rounded-2xl border border-slate-200 overflow-hidden">
                                        <div className="flex justify-between items-center p-3 border-b border-slate-200 bg-white shrink-0">
                                            <div>
                                                <h4 className="font-bold text-slate-800 text-[11px]">Stages ({formData.stages.length})</h4>
                                                <p className="text-[9px] text-slate-400 mt-0.5">
                                                    {hasPendingStageOrder
                                                        ? 'Order changed — click Save Route Sorting in header'
                                                        : 'Drag to reorder route'}
                                                </p>
                                            </div>
                                            <button 
                                                type="button" 
                                                onClick={addStage} 
                                                className="text-[10px] bg-blue-50 hover:bg-blue-100 text-blue-600 px-2 py-1 rounded-lg font-bold transition-all"
                                            >
                                                + Add
                                            </button>
                                        </div>
                                        <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                                            {formData.stages.map((stage, idx) => (
                                                <div
                                                    key={stage._localId || `stage-${idx}`}
                                                    onDragOver={(e) => handleStageDragOver(e, idx)}
                                                    onDrop={(e) => handleStageDrop(e, idx)}
                                                    onDragLeave={() => setDragOverStageIndex(null)}
                                                    className={`rounded-xl border transition-all flex items-center gap-1.5 px-2 py-2.5 cursor-pointer ${
                                                        selectedStageIndex === idx
                                                            ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                                                            : 'bg-white text-slate-700 border-slate-100 hover:bg-blue-50 hover:border-blue-200'
                                                    } ${
                                                        dragOverStageIndex === idx && draggedStageIndex !== idx
                                                            ? 'border-blue-400 bg-blue-50 ring-2 ring-blue-200'
                                                            : draggedStageIndex === idx
                                                                ? 'opacity-50'
                                                                : ''
                                                    }`}
                                                    onClick={() => setSelectedStageIndex(idx)}
                                                >
                                                    <span
                                                        draggable
                                                        onDragStart={(e) => {
                                                            e.stopPropagation();
                                                            handleStageDragStart(e, idx);
                                                        }}
                                                        onDragEnd={handleStageDragEnd}
                                                        className={`shrink-0 cursor-grab active:cursor-grabbing p-0.5 rounded ${
                                                            selectedStageIndex === idx ? 'text-blue-100 hover:text-white' : 'text-slate-300 hover:text-slate-500'
                                                        }`}
                                                        title="Drag to reorder"
                                                        onClick={(e) => e.stopPropagation()}
                                                    >
                                                        <GripVertical size={14} />
                                                    </span>
                                                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 ${
                                                        selectedStageIndex === idx ? 'bg-white text-blue-600' : 'bg-slate-100 text-slate-500'
                                                    }`}>
                                                        {idx + 1}
                                                    </span>
                                                    <span className="truncate text-[11px] font-semibold flex-1">
                                                        {stage.stageName || `Stage ${idx + 1}`}
                                                    </span>
                                                </div>
                                            ))}
                                            {formData.stages.length === 0 && (
                                                <div className="text-center text-[10px] text-slate-400 py-8">
                                                    No stages yet.<br />Click "+ Add" above.
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Column 2: Selected Stage Detail Form */}
                                    <div className="w-[280px] shrink-0 flex flex-col">
                                        {selectedStageIndex !== null && formData.stages[selectedStageIndex] ? (
                                            <div className="bg-white p-4 rounded-2xl border border-slate-200 space-y-3 relative flex-1 overflow-y-auto custom-scrollbar">
                                                <button 
                                                    type="button" 
                                                    onClick={() => removeStage(selectedStageIndex)} 
                                                    className="absolute top-3 right-3 text-slate-400 hover:text-red-500 transition-colors"
                                                    title="Remove Stage"
                                                >
                                                    <Trash2 size={14} />
                                                </button>

                                                <div className="flex items-center gap-2 pb-2 border-b border-slate-100">
                                                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px]">
                                                        {selectedStageIndex + 1}
                                                    </span>
                                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Stage Config</span>
                                                </div>

                                                <div className="space-y-2.5">
                                                    <div>
                                                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Stage Name</label>
                                                        <input 
                                                            type="text" 
                                                            name="stageName" 
                                                            placeholder="Stage Name" 
                                                            value={formData.stages[selectedStageIndex].stageName} 
                                                            onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800" 
                                                            required 
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Distance (km)</label>
                                                        <input 
                                                            type="number" 
                                                            name="distanceFromStart" 
                                                            placeholder="Km from Start" 
                                                            value={formData.stages[selectedStageIndex].distanceFromStart} 
                                                            onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                            className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800" 
                                                            required 
                                                        />
                                                    </div>
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <div>
                                                            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Fare (₹)</label>
                                                            <div className="relative">
                                                                <IndianRupee size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                                                <input 
                                                                    type="number" 
                                                                    name="fare" 
                                                                    placeholder="Amount" 
                                                                    value={formData.stages[selectedStageIndex].fare} 
                                                                    onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                                    className="w-full pl-7 pr-2 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800" 
                                                                    required 
                                                                />
                                                            </div>
                                                        </div>
                                                        <div>
                                                            <label className="block text-[9px] font-bold text-slate-500 uppercase tracking-wider mb-1">Radius (m)</label>
                                                            <input 
                                                                type="number" 
                                                                name="radius" 
                                                                placeholder="100" 
                                                                value={formData.stages[selectedStageIndex].radius} 
                                                                onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs font-semibold focus:ring-2 focus:ring-blue-500 outline-none bg-white text-slate-800" 
                                                                required 
                                                            />
                                                        </div>
                                                    </div>

                                                    <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                                                        <div>
                                                            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Latitude</label>
                                                            <input 
                                                                type="number" 
                                                                step="any"
                                                                name="latitude" 
                                                                placeholder="Click map" 
                                                                value={formData.stages[selectedStageIndex].latitude ?? ''} 
                                                                onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                                className="w-full p-1.5 border border-slate-100 rounded text-[11px] font-semibold outline-none text-slate-600 bg-white" 
                                                            />
                                                        </div>
                                                        <div>
                                                            <label className="block text-[8px] font-black text-slate-400 uppercase tracking-wider mb-0.5">Longitude</label>
                                                            <input 
                                                                type="number" 
                                                                step="any"
                                                                name="longitude" 
                                                                placeholder="Click map" 
                                                                value={formData.stages[selectedStageIndex].longitude ?? ''} 
                                                                onChange={(e) => handleStageChange(selectedStageIndex, e)} 
                                                                className="w-full p-1.5 border border-slate-100 rounded text-[11px] font-semibold outline-none text-slate-600 bg-white" 
                                                            />
                                                        </div>
                                                    </div>
                                                </div>

                                                <button 
                                                    type="button" 
                                                    onClick={handleSaveStage}
                                                    disabled={isSavingStage}
                                                    className="w-full bg-blue-900 text-white font-bold py-2.5 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-3 text-xs disabled:opacity-50"
                                                >
                                                    {isSavingStage ? 'Saving...' : 'Save Stage Details'}
                                                </button>
                                            </div>
                                        ) : (
                                            <div className="flex-1 flex items-center justify-center bg-slate-50 rounded-2xl border border-dashed border-slate-200 text-center text-xs text-slate-400 p-6">
                                                Select or add a stage to edit its configuration.
                                            </div>
                                        )}
                                    </div>

                                    {/* Column 3: Leaflet Interactive Map with ALL stages */}
                                    <div className="flex-1 flex flex-col bg-white rounded-2xl border border-slate-200 overflow-hidden relative">
                                        <div className="absolute top-2 left-2 z-[1000] flex items-center gap-2">
                                            <button
                                                type="button"
                                                onClick={() => setShowAllStagesOnMap((prev) => !prev)}
                                                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-bold shadow-sm transition-all ${
                                                    showAllStagesOnMap
                                                        ? 'bg-blue-600 border-blue-600 text-white hover:bg-blue-700'
                                                        : 'bg-white/95 backdrop-blur-[2px] border-slate-200 text-slate-700 hover:bg-slate-50'
                                                }`}
                                                title={showAllStagesOnMap ? 'Zoom back to the selected stage' : 'Show every plotted stage on the map'}
                                            >
                                                <Layers size={12} />
                                                {showAllStagesOnMap ? 'Focus Selected' : 'Show All Stages'}
                                            </button>
                                            <div className="bg-white/95 backdrop-blur-[2px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-[10px] font-bold text-slate-700 shadow-sm pointer-events-none">
                                                {showAllStagesOnMap ? 'All stages + radius circles shown' : selectedStageIndex === null ? 'Select a stage to edit on map' : '📍 Click map or drag marker'}
                                            </div>
                                        </div>
                                        
                                        {/* Floating Location Search */}
                                        <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-[2px] p-2 rounded-xl border border-slate-200 z-[1000] shadow-md w-56 space-y-1.5">
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    placeholder="Search location..."
                                                    value={mapSearchQuery}
                                                    onChange={(e) => setMapSearchQuery(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            handleLocationSearch();
                                                        }
                                                    }}
                                                    className="flex-1 px-2 py-1 rounded border border-slate-300 text-[10px] font-semibold outline-none focus:border-blue-500 bg-white text-slate-800"
                                                />
                                                <button
                                                    type="button"
                                                    onClick={handleLocationSearch}
                                                    disabled={isSearchingLocation}
                                                    className="bg-blue-600 hover:bg-blue-700 text-white px-2.5 py-1 rounded font-bold text-[10px] transition-all whitespace-nowrap"
                                                >
                                                    {isSearchingLocation ? '...' : 'Search'}
                                                </button>
                                            </div>
                                            {searchResults.length > 0 && (
                                                <div className="bg-white border border-slate-200 rounded-lg overflow-hidden shadow-sm max-h-[120px] overflow-y-auto custom-scrollbar text-[9px] font-semibold">
                                                    {searchResults.map((result, idx) => (
                                                        <button
                                                            key={idx}
                                                            type="button"
                                                            onClick={() => handleSelectSearchResult(result)}
                                                            className="w-full text-left px-2 py-1 hover:bg-slate-50 border-b border-slate-100 last:border-0 block truncate text-slate-700"
                                                            title={result.display_name}
                                                        >
                                                            📍 {result.display_name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        <div ref={modalMapContainerRef} className="w-full h-full z-0" />
                                    </div>
                                </div>
                            )}
                        </form>
                    </div>
                ) : (
                    /* Create Mode: Only basic route details */
                    <form onSubmit={handleSubmit}>
                        <div className="space-y-4 max-w-xl mx-auto py-6">
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest mb-3">Route Details</h4>
                            <div className="grid grid-cols-3 gap-4">
                                <div className="col-span-1">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Route ID</label>
                                    <input type="text" name="routeId" required value={formData.routeId} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. R01" />
                                </div>
                                <div className="col-span-2">
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Route Name</label>
                                    <input type="text" name="routeName" required value={formData.routeName} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. Campus Express" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Point</label>
                                    <input type="text" name="startPoint" required value={formData.startPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Point</label>
                                    <input type="text" name="endPoint" required value={formData.endPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Distance (km)</label>
                                    <input type="number" name="totalDistance" value={formData.totalDistance} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Est. Time</label>
                                    <input type="text" name="estimatedTime" value={formData.estimatedTime} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" placeholder="e.g. 45 mins" />
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campus</label>
                                    <select
                                        name="campus"
                                        value={formData.campus || ''}
                                        onChange={handleChange}
                                        className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white text-sm font-semibold"
                                    >
                                        <option value="">Select Campus (Optional)</option>
                                        {allowedCampuses.map(campus => (
                                            <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                                {campus.name} ({campus.code})
                                            </option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-semibold text-slate-700 mb-1.5">Zone</label>
                                    <input type="text" name="zone" value={formData.zone} onChange={handleChange} placeholder="e.g., East, West, North" className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all text-sm font-semibold" />
                                </div>
                            </div>
                            <button type="submit" className="w-full bg-blue-900 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-6 text-sm">
                                Create Route Structure
                            </button>
                        </div>
                    </form>
                )}
            </Modal>

            <Modal isOpen={isConfirmModalOpen} onClose={() => setIsConfirmModalOpen(false)} title="Confirm Stage Migration">
                <div className="space-y-4">
                    <p className="text-sm text-slate-650 font-semibold leading-relaxed">
                        Are you sure you want to transfer stage <span className="font-bold text-slate-900">"{transferData.stageName}"</span> from route <span className="font-bold text-slate-900">{transferData.sourceRouteId}</span> to route <span className="font-bold text-slate-900">{transferData.destinationRouteId}</span>?
                    </p>
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 text-xs text-amber-800 font-bold space-y-1">
                        <p>This will relocate the stage network and update all associated passengers' routes.</p>
                        <p className="text-amber-900">⚠️ Affected passengers ({transferPreview.studentCount + transferPreview.employeeCount}) will need their transport ID cards reprinted.</p>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => setIsConfirmModalOpen(false)}
                            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={executeStageTransfer}
                            className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-md transition-all"
                        >
                            Confirm & Execute
                        </button>
                    </div>
                </div>
            </Modal>

            <Modal isOpen={isStudentConfirmModalOpen} onClose={() => setIsStudentConfirmModalOpen(false)} title="Confirm Student/Passenger Transfer">
                <div className="space-y-4">
                    <p className="text-sm text-slate-650 font-semibold leading-relaxed">
                        Are you sure you want to transfer the <span className="font-bold text-slate-900">{selectedPassengers.length}</span> selected passenger(s) to route <span className="font-bold text-slate-900">{studentTransferData.destinationRouteId}</span>, stage <span className="font-bold text-slate-900">"{studentTransferData.destinationStageName}"</span>?
                    </p>
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 text-xs text-amber-800 font-bold space-y-1">
                        <p>This will update the passenger(s)' assigned route and stage details.</p>
                        <p>Their old bus assignments will be cleared (set to none).</p>
                        <p className="text-amber-900">⚠️ Any approved passengers being transferred will have their status marked as needing new transport ID cards.</p>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => setIsStudentConfirmModalOpen(false)}
                            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={executeStudentTransfer}
                            className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-md transition-all"
                        >
                            Confirm & Execute
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Route-Wise Mapping Edit Modal */}
            {expandedRouteEditId && (() => {
                const route = routes.find(r => r._id === expandedRouteEditId);
                if (!route) return null;
                const assignedBus = buses.find((b) => b.assignedRouteId === route.routeId);
                const draft = routeWiseDrafts[route.routeId] || buildRouteWiseDraft(route.routeId);
                const routeWiseChanged = (draft.busId || '') !== (assignedBus ? assignedBus._id : '');
                const preview = mappingPreview[route.routeId];
                const total = preview ? (preview.studentCount + preview.employeeCount) : 0;
                const isOverCapacity = preview?.busCapacityAlerts?.some(alert => alert.isOverCapacity) || false;

                return (
                    <Modal
                        isOpen={!!expandedRouteEditId}
                        onClose={() => setExpandedRouteEditId(null)}
                        title={`Edit Bus Assignment: Route ${route.routeName}`}
                        maxWidth="max-w-2xl"
                    >
                        <div className="space-y-5">
                            {/* Preview & Loading State */}
                            {preview && preview.loading ? (
                                <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-slate-100 bg-slate-50/50 py-10">
                                    <div className="w-6 h-6 rounded-full border-2 border-blue-600 border-t-transparent animate-spin" />
                                    <p className="text-xs font-semibold text-slate-500">Checking seat vacancy & passenger reassignments…</p>
                                </div>
                            ) : (
                                <>
                                    {isOverCapacity && (
                                        <div className="flex items-center gap-2.5 p-3.5 rounded-xl border border-red-200 bg-red-50 text-red-800 text-xs font-bold shadow-sm">
                                            <AlertTriangle size={16} className="text-red-500 shrink-0" />
                                            <span>❌ Capacity Exceeded: Proposed assignment exceeds the bus seating capacity limit. Saving is blocked.</span>
                                        </div>
                                    )}

                                    {/* Live Seat Seating & Vacancy Preview */}
                                    {preview && preview.busCapacityAlerts && preview.busCapacityAlerts.length > 0 && (
                                        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 space-y-2">
                                            <p className="text-[10px] font-bold text-slate-700 uppercase tracking-wider">Live Bus Seating & Vacancy Preview</p>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                                                {preview.busCapacityAlerts.map(alert => {
                                                    const occupancyPercent = alert.capacity > 0 ? Math.min(100, Math.round((alert.proposedPassengers / alert.capacity) * 100)) : 0;
                                                    const progressColor = alert.isOverCapacity 
                                                        ? 'bg-red-600' 
                                                        : occupancyPercent > 85 
                                                        ? 'bg-amber-500' 
                                                        : 'bg-emerald-600';
                                                    
                                                    return (
                                                        <div key={alert.busNumber} className="bg-white border border-slate-200 rounded-lg p-3 space-y-2 shadow-sm">
                                                            <div className="flex items-center justify-between text-[11px] font-semibold">
                                                                <span className="text-slate-800 font-bold">Bus {alert.busNumber}</span>
                                                                <span className={alert.isOverCapacity ? 'text-red-600 font-bold' : 'text-slate-500'}>
                                                                    {alert.proposedPassengers} / {alert.capacity} seats filled
                                                                </span>
                                                            </div>
                                                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                                <div className={`h-full ${progressColor} transition-all duration-300`} style={{ width: `${occupancyPercent}%` }} />
                                                            </div>
                                                            <div className="flex justify-between items-center text-[10px] font-semibold">
                                                                <span className="text-slate-400 font-bold">Vacancy</span>
                                                                <span className={alert.proposedSeatsAvailable < 0 ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                                                                    {alert.proposedSeatsAvailable < 0 ? `${Math.abs(alert.proposedSeatsAvailable)} Overlimit` : `${alert.proposedSeatsAvailable} Available`}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}

                                    {/* Warning & Info */}
                                    {routeWiseChanged && preview && total > 0 && (
                                        <div className="flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
                                            <div className="flex items-start gap-2.5">
                                                <AlertTriangle size={15} className="text-amber-500 mt-0.5 shrink-0" />
                                                <div>
                                                    <p className="text-xs font-bold text-amber-800">Passenger Impact Warning</p>
                                                    <p className="text-xs text-amber-700 mt-0.5">
                                                        This mapping update affects <span className="font-bold">{preview.studentCount} student{preview.studentCount !== 1 ? 's' : ''}</span>
                                                        {preview.employeeCount > 0 && <> and <span className="font-bold">{preview.employeeCount} employee{preview.employeeCount !== 1 ? 's' : ''}</span></>}.
                                                        Their bus assignment will be automatically updated to match the new mapping.
                                                    </p>
                                                </div>
                                            </div>

                                            {/* Passenger Table */}
                                            {preview.affectedPassengers && preview.affectedPassengers.length > 0 && (
                                                <div className="mt-2 border border-amber-200 rounded-lg overflow-hidden max-h-48 overflow-y-auto bg-white shadow-sm">
                                                    <table className="w-full text-left border-collapse text-[10px]">
                                                        <thead>
                                                            <tr className="bg-slate-50 border-b border-slate-100 text-slate-500 font-bold uppercase tracking-wider text-[9px]">
                                                                <th className="px-3 py-1.5">Passenger</th>
                                                                <th className="px-3 py-1.5">Route</th>
                                                                <th className="px-3 py-1.5">Proposed Change</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                                                            {preview.affectedPassengers.map(p => (
                                                                <tr key={p.id} className="hover:bg-slate-50">
                                                                    <td className="px-3 py-1.5 whitespace-nowrap">
                                                                        <span className="font-bold text-slate-800">{p.name}</span>
                                                                        <span className="text-slate-400 text-[9px] ml-1 font-semibold">({p.identifier})</span>
                                                                        <span className="ml-1 text-[8px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded uppercase font-bold">{p.type}</span>
                                                                    </td>
                                                                    <td className="px-3 py-1.5 text-slate-600 whitespace-nowrap">
                                                                        <div className="font-semibold text-slate-800">{p.routeName}</div>
                                                                        {p.stageName && p.stageName !== 'N/A' && (
                                                                            <div className="text-[9px] text-slate-400 font-bold bg-slate-50 border border-slate-100 rounded px-1.5 py-0.5 inline-block mt-0.5">
                                                                                Stage: {p.stageName}
                                                                            </div>
                                                                        )}
                                                                    </td>
                                                                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-700">
                                                                        <span className="text-slate-500">{p.currentBus}</span>
                                                                        <span className="mx-1 text-slate-400">➔</span>
                                                                        <span className={p.proposedBus === 'Unassigned' ? 'text-red-600 font-bold' : 'text-emerald-700 font-bold'}>
                                                                            {p.proposedBus}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* Form Input fields */}
                            {assignedBus ? (
                                <div className="rounded-xl border border-red-200 bg-red-50/30 p-5 space-y-4 shadow-sm">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider">Currently Assigned Bus</p>
                                            <h4 className="text-base font-black text-slate-800 mt-1">Bus {assignedBus.busNumber}</h4>
                                            <p className="text-xs text-slate-500 font-medium mt-0.5">{assignedBus.type} • {assignedBus.capacity} seats</p>
                                        </div>
                                        <div className="bg-red-100 text-red-800 text-[10px] font-bold px-2.5 py-0.5 rounded-full border border-red-200">
                                            Assigned
                                        </div>
                                    </div>

                                    <div className="pt-2 max-w-xs">
                                        <label className="block text-xs font-semibold text-slate-750 mb-1">Exit Date (Detachment Date)</label>
                                        <input
                                            type="date"
                                            value={draft.exitDate}
                                            onChange={(e) => handleRouteWiseDraftDateChange(route.routeId, 'exitDate', e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg border border-slate-350 bg-white text-xs focus:ring-2 focus:ring-red-500 outline-none"
                                        />
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <button
                                            type="button"
                                            onClick={() => handleRouteWiseDetachClick(route, assignedBus)}
                                            disabled={assigningBusId === route._id}
                                            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-red-600 hover:bg-red-700 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1.5"
                                        >
                                            {assigningBusId === route._id ? 'Detaching…' : 'Detach Bus from Route'}
                                        </button>
                                    </div>
                                </div>
                            ) : (
                                <div className="rounded-xl border border-blue-200 bg-white p-5 space-y-4 shadow-sm">
                                    <div>
                                        <p className="text-[10px] font-bold text-blue-700 uppercase tracking-wider">Assign Bus to Route</p>
                                        <p className="text-xs text-slate-500 font-medium mt-0.5 font-bold">Choose an unassigned eligible bus for this route network.</p>
                                    </div>

                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-1">
                                            <label className="block text-xs font-semibold text-slate-650">Eligible Buses</label>
                                            <select
                                                value={draft.busId}
                                                onChange={(e) => handleRouteWiseDraftChange(route.routeId, e.target.value)}
                                                disabled={assigningBusId === route._id}
                                                className="w-full text-xs rounded-lg border border-slate-355 py-2.5 px-3 focus:ring-2 focus:ring-blue-500 outline-none bg-white font-medium text-slate-800 cursor-pointer"
                                            >
                                                <option value="">— Select Bus —</option>
                                                {buses.filter((b) => !b.assignedRouteId).map((b) => {
                                                    const isInactive = b.status === 'Inactive';
                                                    return (
                                                        <option key={b._id} value={b._id} disabled={isInactive}>
                                                            {b.busNumber} ({b.type} - {b.capacity} seats) {isInactive ? ' [Inactive]' : ''}
                                                        </option>
                                                    );
                                                })}
                                            </select>
                                        </div>

                                        {draft.busId && (
                                            <div className="space-y-1">
                                                <label className="block text-xs font-semibold text-slate-650">Assignment Date</label>
                                                <input
                                                    type="date"
                                                    value={draft.entryDate}
                                                    onChange={(e) => handleRouteWiseDraftDateChange(route.routeId, 'entryDate', e.target.value)}
                                                    className="w-full px-3 py-2.5 rounded-lg border border-blue-200 bg-white text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                                />
                                            </div>
                                        )}
                                    </div>

                                    <div className="flex justify-end pt-2">
                                        <button
                                            type="button"
                                            onClick={() => handleRouteWiseAttachClick(route)}
                                            disabled={assigningBusId === route._id || !draft.busId || isOverCapacity}
                                            className="px-5 py-2.5 rounded-xl text-xs font-bold bg-blue-900 hover:bg-blue-800 text-white shadow-md disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                                        >
                                            {assigningBusId === route._id ? 'Saving…' : 'Attach Bus to Route'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Modal Actions */}
                            <div className="flex justify-end pt-3 border-t border-slate-100">
                                <button
                                    type="button"
                                    onClick={() => setExpandedRouteEditId(null)}
                                    className="px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 text-slate-600 hover:bg-slate-100 transition-all"
                                >
                                    Close Modal
                                </button>
                            </div>
                        </div>
                    </Modal>
                );
            })()}

            <Modal isOpen={isSuccessModalOpen} onClose={() => setIsSuccessModalOpen(false)} title="Success" maxWidth="max-w-md">
                <div className="text-center p-6 space-y-4">
                    <div className="w-16 h-16 bg-green-55 bg-green-50 text-green-600 rounded-full flex items-center justify-center mx-auto shadow-md border border-green-100">
                        <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                        </svg>
                    </div>
                    <div>
                        <h3 className="text-base font-bold text-slate-800">Success!</h3>
                        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">{successModalMessage}</p>
                    </div>
                    <button 
                        type="button" 
                        onClick={() => setIsSuccessModalOpen(false)}
                        className="w-full bg-blue-900 text-white font-bold py-2.5 rounded-xl hover:bg-blue-800 transition-colors mt-2 text-xs"
                    >
                        Dismiss
                    </button>
                </div>
            </Modal>
        </Layout>
    );
};

export default RouteManagement;
