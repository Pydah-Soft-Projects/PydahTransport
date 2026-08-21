import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
    Download,
    FileText,
    History,
    Users as UsersIcon,
    Package,
    Calendar,
    MapPin,
    UserCheck,
    AlertTriangle,
    Search,
    Armchair,
    User,
    MoreHorizontal,
    UserPlus,
    Milestone,
    Bus,
    Loader2,
    RefreshCw,
    Zap,
    ExternalLink,
    Activity,
    Layers,
    ChevronLeft,
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument, exportHtmlAsExcel } from '../utils/printHtml';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

const API = API_BASE;

const normalizeVehicleNumber = (num) => {
    if (!num) return '';
    return num.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
};

const getInventoryItemName = (item) => {
    if (!item) return 'Deleted Item';
    return item.variantName ? `${item.itemName} - ${item.variantName}` : item.itemName;
};

const getInventoryAllocationItemName = (record) => {
    if (!record?.itemId) return 'Deleted Item';
    return record.variantName
        ? `${record.itemId.itemName} - ${record.variantName}`
        : getInventoryItemName(record.itemId);
};

const formatFare = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const formatYearLabel = (year) => {
    const value = Number(year);
    if (!Number.isFinite(value) || value <= 0) return '—';
    const suffix = value === 1 ? 'st' : value === 2 ? 'nd' : value === 3 ? 'rd' : 'th';
    return `${value}${suffix} Year`;
};

const getPayableFare = (passenger) => {
    if (passenger?.user_type === 'employee') return 0;
    return passenger?.payable_fare ?? passenger?.original_fare ?? passenger?.fare ?? 0;
};

const DonutChart = ({ percent }) => {
    const radius = 32;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(100, percent) / 100) * circumference;

    return (
        <svg width="80" height="80" viewBox="0 0 100 100" className="shrink-0">
            <circle cx="50" cy="50" r={radius} fill="none" stroke="#e2e8f0" strokeWidth="10" />
            <circle
                cx="50"
                cy="50"
                r={radius}
                fill="none"
                stroke="#2563eb"
                strokeWidth="10"
                strokeDasharray={circumference}
                strokeDashoffset={offset}
                strokeLinecap="round"
                transform="rotate(-90 50 50)"
            />
            <text x="50" y="54" textAnchor="middle" fontSize="15" fontWeight="700" fill="#0f172a">
                {percent}%
            </text>
        </svg>
    );
};

const StatCard = ({ title, children, className = '', action = null }) => (
    <div className={`bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col min-h-0 p-4 ${className}`}>
        <div className="flex items-center justify-between mb-3 shrink-0 gap-2">
            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-0">{title}</p>
            {action}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
    </div>
);

const FareDisplay = ({ passenger, compact = false }) => {
    if (passenger?.user_type === 'employee') {
        return <span className="text-gray-500 text-sm">Free (₹0)</span>;
    }

    const normalFare = passenger?.original_fare ?? passenger?.fare;
    const payableFare = passenger?.payable_fare ?? normalFare;
    const hasAdjustment = Boolean(passenger?.has_fare_adjustment);
    const label = passenger?.fare_adjustment_type === 'CONCESSION' ? 'After concession' : 'Revised fee';

    if (compact) {
        return <span className="text-sm font-semibold text-slate-800">{formatFare(getPayableFare(passenger))}</span>;
    }

    return (
        <div className="space-y-0.5">
            <p className="text-sm font-semibold text-gray-800">Normal: {formatFare(normalFare)}</p>
            {hasAdjustment && (
                <p className="text-[11px] font-bold text-emerald-700">
                    {label}: {formatFare(payableFare)}
                </p>
            )}
        </div>
    );
};

// Interpolate intermediate coordinates for a fluid, high-frame-rate time-lapse glide animation
const interpolatePath = (path, stepsPerSegment = 8) => {
    if (path.length < 2) return path;
    const result = [];
    for (let i = 0; i < path.length - 1; i++) {
        const start = path[i];
        const end = path[i + 1];
        for (let step = 0; step < stepsPerSegment; step++) {
            const ratio = step / stepsPerSegment;
            const lat = start[0] + (end[0] - start[0]) * ratio;
            const lng = start[1] + (end[1] - start[1]) * ratio;
            result.push([lat, lng]);
        }
    }
    result.push(path[path.length - 1]);
    return result;
};

const BusDetails = () => {
    const { id } = useParams();
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [assignModalOpen, setAssignModalOpen] = useState(false);
    const [unassignedPassengers, setUnassignedPassengers] = useState([]);
    const [assignLoading, setAssignLoading] = useState(false);
    const [selectedIds, setSelectedIds] = useState(new Set());
    const [fetchingPass, setFetchingPass] = useState(false);
    const [inventoryHistory, setInventoryHistory] = useState([]);
    const [routeHistory, setRouteHistory] = useState([]);
    const [staffHistory, setStaffHistory] = useState([]);
    const [activeTab, setActiveTab] = useState('passengers');
    const [historySubTab, setHistorySubTab] = useState('inventory');
    const [inventoryLoading, setInventoryLoading] = useState(false);
    const [routeHistoryLoading, setRouteHistoryLoading] = useState(false);
    const [staffHistoryLoading, setStaffHistoryLoading] = useState(false);
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const [occupancyMode, setOccupancyMode] = useState('live');
    const [passengersLoading, setPassengersLoading] = useState(false);
    const academicYearOptions = getAcademicYearOptions();
    
    // For expired taxes warning
    const [expiredTaxesWarning, setExpiredTaxesWarning] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCourse, setFilterCourse] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterStage, setFilterStage] = useState('');
    const [filterType, setFilterType] = useState('');
    const [isPrinting, setIsPrinting] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportOptions, setReportOptions] = useState({ abstract: true, detailed: true });
    const [reportModalError, setReportModalError] = useState('');
    const [reportLoadingAction, setReportLoadingAction] = useState(null);

    // GPS Daily Kilometer Tracking States
    const [kmData, setKmData] = useState([]);
    const [kmLoading, setKmLoading] = useState(false);
    const [kmError, setKmError] = useState(null);
    const [kmDateFrom, setKmDateFrom] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });
    const [kmDateTo, setKmDateTo] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });
    const [selectedDate, setSelectedDate] = useState(() => {
        return new Date().toISOString().split('T')[0];
    });
    const [kmIsMock, setKmIsMock] = useState(false);

    // GPS States and Refs
    const [isLeafletReady, setIsLeafletReady] = useState(false);
    const [gpsVehicle, setGpsVehicle] = useState(null);
    const [gpsTraceLogs, setGpsTraceLogs] = useState([]);
    const [morningTrace, setMorningTrace] = useState([]);
    const [eveningTrace, setEveningTrace] = useState([]);
    const [finalDestination, setFinalDestination] = useState(null);
    const [gpsLoading, setGpsLoading] = useState(false);
    const [gpsError, setGpsError] = useState(null);
    const [mapTab, setMapTab] = useState('live');
    const [highlightsTab, setHighlightsTab] = useState('in');
    const [animatingIndex, setAnimatingIndex] = useState(null);
    const [snappedRoutePath, setSnappedRoutePath] = useState([]);
    const [snappedMissedPaths, setSnappedMissedPaths] = useState([]); // road-snapped paths for missed stage runs
    const [hasCenteredFirstTime, setHasCenteredFirstTime] = useState(false);
    const gpsLiveBreadcrumbsRef = useRef([]);
    const isFirstLoadRef = useRef(true);
    const hasCenteredRouteRef = useRef(false);

    const mapContainerRef = useRef(null);
    const mapInstanceRef = useRef(null);
    const layerGroupRef = useRef(null);
    const centeredVehicleNameRef = useRef(null);

    // Destructure data object at the top so it is available to all hooks
    const { bus, route, passengers, seatsFilled, seatsAvailable, capacity, occupancyPercent } = data || {
        bus: null,
        route: null,
        passengers: [],
        seatsFilled: 0,
        seatsAvailable: 0,
        capacity: 0,
        occupancyPercent: 0
    };

    const routeStops = (() => {
        if (!route) return [];
        if (Array.isArray(route.stages) && route.stages.length > 0) {
            return route.stages
                .map((stage) => stage.stageName || stage.name || stage.stage_name)
                .filter(Boolean);
        }
        const stops = [];
        if (route.startPoint) stops.push(route.startPoint);
        if (route.endPoint && route.endPoint !== route.startPoint) stops.push(route.endPoint);
        return stops;
    })();

    const stagesWithCoords = useMemo(() => {
        if (!route) return [];
        let items = [];
        if (Array.isArray(route.stages) && route.stages.length > 0) {
            items = [...route.stages];
        } else {
            items = [
                { stageName: route.startPoint, latitude: 16.989, longitude: 82.247, radius: 200 },
                { stageName: route.endPoint, latitude: 16.989, longitude: 82.247, radius: 200 }
            ];
        }

        // Always show the final destination at the end of Route Highlights
        if (finalDestination) {
            items.push({
                stageName: finalDestination.name,
                latitude: finalDestination.latitude,
                longitude: finalDestination.longitude,
                radius: finalDestination.radius,
                isFinalDest: true
            });
        } else if (route.endPoint) {
            // Fallback if finalDestination configuration is still loading or not configured
            // Use correct Patavala campus coordinates as default fallback instead of previous stage coordinates
            items.push({
                stageName: route.endPoint,
                latitude: 16.839153,
                longitude: 82.224924,
                radius: 200,
                isFinalDest: true
            });
        }

        return items;
    }, [route, finalDestination]);

    // Calculate the path to use for animation, falling back to stage coordinates if road snapping is loading or failed
    const animationPath = useMemo(() => {
        let baseCoords = [];
        if (snappedRoutePath && snappedRoutePath.length > 0) {
            baseCoords = snappedRoutePath;
        } else {
            baseCoords = stagesWithCoords
                .filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude !== 0 && s.longitude !== 0)
                .map(s => [s.latitude, s.longitude]);
        }
        // Interpolate intermediate coordinates for a fluid, high-frame-rate time-lapse glide animation
        return interpolatePath(baseCoords, 8);
    }, [stagesWithCoords, snappedRoutePath]);

    // Calculate total distance travelled today from GPS trace logs (Haversine sum)
    const distanceTravelledKm = useMemo(() => {
        const pts = (gpsTraceLogs || []).filter(t =>
            typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0
        );
        if (pts.length < 2) return null;
        const haversine = (lat1, lon1, lat2, lon2) => {
            const R = 6371;
            const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
            const dp = (lat2 - lat1) * Math.PI / 180;
            const dl = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            const d = haversine(pts[i - 1].latitude, pts[i - 1].longitude, pts[i].latitude, pts[i].longitude);
            if (d < 5) total += d; // ignore teleports > 5km between two pings
        }
        return total > 0 ? total.toFixed(1) : null;
    }, [gpsTraceLogs]);

    // Dynamically load Leaflet library for fast interactive map & polyline tracing
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

    // Custom styled bus icon marker helper
    const createVehicleIcon = useCallback((isMoving) => {
        if (!window.L) return null;
        const L = window.L;
        const bgColor = isMoving ? '#10B981' : '#EF4444'; // High-contrast neon green / rose red
        const shadowColor = isMoving ? 'rgba(16, 185, 129, 0.6)' : 'rgba(239, 68, 68, 0.6)';
        return L.divIcon({
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
                        width: 34px;
                        height: 34px;
                        border-radius: 50%;
                        border: 2px solid #ffffff;
                        box-shadow: 0 4px 10px rgba(0, 0, 0, 0.35), 0 0 10px ${shadowColor};
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    ">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 18px; height: 18px;">
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
                        border-left: 5px solid transparent;
                        border-right: 5px solid transparent;
                        border-top: 6px solid ${bgColor};
                        margin-top: -2px;
                        filter: drop-shadow(0 2px 2px rgba(0,0,0,0.2));
                    "></div>
                </div>
            `,
            iconSize: [34, 40],
            iconAnchor: [17, 40],
            popupAnchor: [0, -40]
        });
    }, []);

    // Reset map state when bus ID changes
    useEffect(() => {
        gpsLiveBreadcrumbsRef.current = [];
        setGpsTraceLogs([]);
        setGpsVehicle(null);
        setGpsError(null);
        centeredVehicleNameRef.current = null;
        setHasCenteredFirstTime(false);
        hasCenteredRouteRef.current = false;
        isFirstLoadRef.current = true;
        
        return () => {
            if (mapInstanceRef.current) {
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
                layerGroupRef.current = null;
            }
        };
    }, [id]);

    // Auto-zoom when switching Live ↔ Route (separate from render loop so animation ticks don't cancel fitBounds)
    useEffect(() => {
        if (!isLeafletReady || !mapInstanceRef.current || !window.L) return;
        const L = window.L;
        const map = mapInstanceRef.current;
        const timers = [];

        const schedule = (fn, ms) => {
            timers.push(setTimeout(fn, ms));
        };

        if (mapTab === 'route') {
            hasCenteredRouteRef.current = false;
            centeredVehicleNameRef.current = null;

            const points = [];
            (stagesWithCoords || []).forEach((s) => {
                if (typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude !== 0 && s.longitude !== 0) {
                    points.push([s.latitude, s.longitude]);
                }
            });
            (animationPath || []).forEach((p) => {
                if (Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])) {
                    points.push([p[0], p[1]]);
                }
            });

            if (points.length === 0) return undefined;

            const fitAllPoints = () => {
                if (!mapInstanceRef.current || mapTab !== 'route') return;
                mapInstanceRef.current.invalidateSize();
                mapInstanceRef.current.fitBounds(L.latLngBounds(points), {
                    padding: [48, 48],
                    maxZoom: 15,
                    animate: true,
                });
                hasCenteredRouteRef.current = true;
            };

            // First fit after tab paint, then again after layout/tiles settle
            schedule(() => {
                map.invalidateSize();
                fitAllPoints();
            }, 80);
            schedule(fitAllPoints, 280);
        } else {
            // Switching to Live — re-center on bus once
            hasCenteredRouteRef.current = false;
            centeredVehicleNameRef.current = null;

            schedule(() => {
                if (!mapInstanceRef.current || mapTab !== 'live') return;
                mapInstanceRef.current.invalidateSize();

                const hasGpsCoords = gpsVehicle
                    && typeof gpsVehicle.latitude === 'number'
                    && typeof gpsVehicle.longitude === 'number'
                    && gpsVehicle.latitude !== 0
                    && gpsVehicle.longitude !== 0;

                if (hasGpsCoords) {
                    mapInstanceRef.current.flyTo(
                        [gpsVehicle.latitude, gpsVehicle.longitude],
                        15,
                        { animate: true, duration: 1.2 }
                    );
                    centeredVehicleNameRef.current = gpsVehicle.name;
                    setHasCenteredFirstTime(true);
                } else {
                    const stagePoints = (stagesWithCoords || [])
                        .filter((s) => typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude !== 0)
                        .map((s) => [s.latitude, s.longitude]);
                    if (stagePoints.length > 0) {
                        mapInstanceRef.current.fitBounds(L.latLngBounds(stagePoints), { padding: [48, 48], maxZoom: 15 });
                    }
                }
            }, 100);
        }

        return () => {
            timers.forEach(clearTimeout);
        };
    // Intentionally omit gpsVehicle continuous updates — only re-fit on tab/route geometry changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mapTab, isLeafletReady, stagesWithCoords, animationPath]);

    const fetchGpsData = useCallback(async () => {
        if (!data?.bus?.busNumber) return;
        const normalizedBusNumber = normalizeVehicleNumber(data.bus.busNumber);

        try {
            const response = await apiFetch(`${API}/gps/vehicles`);
            if (!response.ok) throw new Error('Failed to fetch vehicle list');
            const resData = await response.json();

            if (resData.success && Array.isArray(resData.data)) {
                const matched = resData.data.find(
                    v => normalizeVehicleNumber(v.name) === normalizedBusNumber
                );

                if (matched) {
                    setGpsVehicle(matched);
                    setGpsError(null);

                    // Accumulate breadcrumbs with signal timestamps for precise chronological sorting
                    if (typeof matched.latitude === 'number' && typeof matched.longitude === 'number' && matched.latitude !== 0 && matched.longitude !== 0) {
                        const currentPath = gpsLiveBreadcrumbsRef.current;
                        const lastCoord = currentPath[currentPath.length - 1];

                        if (!lastCoord || lastCoord.latitude !== matched.latitude || lastCoord.longitude !== matched.longitude) {
                            currentPath.push({
                                latitude: matched.latitude,
                                longitude: matched.longitude,
                                timestamp: matched.timestamp || new Date().toISOString()
                            });
                        }
                    }
                } else {
                    setGpsVehicle(null);
                    setGpsError(`Vehicle '${normalizedBusNumber}' not found in active GPS tracking list.`);
                }
            }
        } catch (err) {
            console.warn('GPS Live Fetch Error:', err);
        }
    }, [data?.bus?.busNumber]);

    // Fetch final destination geofence configuration for the campus
    useEffect(() => {
        if (!data?.route?.campus) return;
        const campusId = typeof data.route.campus === 'object'
            ? (data.route.campus.id || data.route.campus._id || data.route.campus)
            : data.route.campus;

        if (!campusId) return;

        (async () => {
            try {
                const res = await apiFetch(`${API}/gps/final-destination?campus=${campusId}`);
                const json = await res.json();
                if (json.success && json.data) {
                    setFinalDestination(json.data);
                }
            } catch (err) {
                console.warn('Failed to load final destination:', err);
            }
        })();
    }, [data?.route?.campus]);

    const fetchGpsHistory = useCallback(async () => {
        if (!data?.bus?.busNumber) return;
        const normalizedBusNumber = normalizeVehicleNumber(data.bus.busNumber);

        try {
            const targetDate = selectedDate || new Date().toISOString().split('T')[0];

            // 1. Fetch consolidated Daily History (which contains all raw coordinates logged throughout the day)
            const resDaily = await apiFetch(`${API}/gps/daily-history?vehicle_name=${normalizedBusNumber}&date=${targetDate}`);

            if (resDaily.ok) {
                const json = await resDaily.json();
                if (json.success && Array.isArray(json.data)) {
                    // Only update traces if we received coordinate data points, preserving existing times during temporary API rate-limits/failures
                    if (json.data.length > 0) {
                        const morningPts = [];
                        const eveningPts = [];

                        json.data.forEach(pt => {
                            if (!pt.timestamp) return;
                            const timePart = pt.timestamp.split(' ')[1];
                            if (timePart) {
                                if (timePart < '12:00:00') {
                                    morningPts.push(pt);
                                } else {
                                    eveningPts.push(pt);
                                }
                            }
                        });

                        setMorningTrace(morningPts);
                        setEveningTrace(eveningPts);
                        setGpsTraceLogs(json.data); // Set full daily path to be traced on map
                    }
                }
            }
        } catch (err) {
            console.warn('GPS History Fetch Error:', err);
        } finally {
            setGpsLoading(false);
        }
    }, [data?.bus?.busNumber, finalDestination, selectedDate]);

    // Clear GPS traces immediately when date changes and show In/Out loaders
    useEffect(() => {
        setMorningTrace([]);
        setEveningTrace([]);
        setGpsTraceLogs([]);
        setGpsLoading(true);
    }, [selectedDate]);

    const fetchDailyKm = useCallback(async () => {
        if (!data?.bus?.busNumber) return;
        setKmLoading(true);
        setKmError(null);
        try {
            const res = await apiFetch(
                `${API}/gps/daily-km?vehicle_name=${encodeURIComponent(data.bus.busNumber)}&date_from=${kmDateFrom}&date_to=${kmDateTo}`
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
    }, [data?.bus?.busNumber, kmDateFrom, kmDateTo]);

    useEffect(() => {
        if (activeTab === 'kilometers') {
            fetchDailyKm();
        }
    }, [activeTab, fetchDailyKm]);

    const handleDownloadKmCsv = () => {
        if (!kmData.length) return;
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
        link.setAttribute('download', `Bus_${data?.bus?.busNumber}_GPS_Distance_Log.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Set up polling intervals
    useEffect(() => {
        if (!data?.bus?.busNumber) return;

        fetchGpsData();
        fetchGpsHistory();

        const liveInterval = setInterval(fetchGpsData, 5000);
        const historyInterval = setInterval(fetchGpsHistory, 20000);

        return () => {
            clearInterval(liveInterval);
            clearInterval(historyInterval);
        };
    }, [data?.bus?.busNumber, fetchGpsData, fetchGpsHistory]);

    // Fetch road-snapped path from Open Source Routing Machine (OSRM) to snap points to roads
    useEffect(() => {
        const coords = stagesWithCoords
            .filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude !== 0 && s.longitude !== 0)
            .map(s => [s.latitude, s.longitude]);

        if (coords.length < 2) {
            setSnappedRoutePath([]);
            return;
        }

        const fetchRoadSnappedPath = async (pts) => {
            const coordString = pts.map(c => `${c[1]},${c[0]}`).join(';');
            try {
                // Query OSRM routing service
                const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson&continue_straight=false`;
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    if (data.routes && data.routes[0]) {
                        const geom = data.routes[0].geometry;
                        if (geom && geom.coordinates) {
                            // Convert back to [lat, lng]
                            return geom.coordinates.map(c => [c[1], c[0]]);
                        }
                    }
                }
            } catch (err) {
                console.warn('[OSRM Snapping] Failed to snap stages to road:', err);
            }
            return pts; // fallback to straight lines if API fails
        };

        (async () => {
            const snapped = await fetchRoadSnappedPath(coords);
            setSnappedRoutePath(snapped);
        })();
    }, [stagesWithCoords]);

    // Compute OSRM-snapped paths for missed stage runs in Live View
    useEffect(() => {
        if (!stagesWithCoords.length || !gpsTraceLogs.length) {
            setSnappedMissedPaths([]);
            return;
        }

        const calcDist = (lat1, lon1, lat2, lon2) => {
            const R = 6371e3;
            const p1 = lat1 * Math.PI / 180, p2 = lat2 * Math.PI / 180;
            const dp = (lat2 - lat1) * Math.PI / 180;
            const dl = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        const tracePts = gpsTraceLogs.filter(t =>
            typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0
        );
        if (tracePts.length < 5) { setSnappedMissedPaths([]); return; }

        const visitedFlags = stagesWithCoords.map(stage => {
            const r = Math.max(stage.radius || 200, 500);
            return tracePts.some(pt => calcDist(stage.latitude, stage.longitude, pt.latitude, pt.longitude) <= r);
        });

        // Build runs of consecutive missed stages, bookended by the stage before and after
        const missedRuns = [];
        let i = 0;
        while (i < stagesWithCoords.length) {
            if (!visitedFlags[i]) {
                // Found start of a missed run
                const runStart = i;
                while (i < stagesWithCoords.length && !visitedFlags[i]) i++;
                const runEnd = i - 1; // inclusive

                // Collect waypoints: stage before run (if any) + all missed stages + stage after run (if any)
                const waypoints = [];
                if (runStart > 0) {
                    const prev = stagesWithCoords[runStart - 1];
                    if (prev.latitude && prev.longitude) waypoints.push([prev.latitude, prev.longitude]);
                }
                for (let j = runStart; j <= runEnd; j++) {
                    const s = stagesWithCoords[j];
                    if (s.latitude && s.longitude) waypoints.push([s.latitude, s.longitude]);
                }
                if (i < stagesWithCoords.length) {
                    const next = stagesWithCoords[i];
                    if (next.latitude && next.longitude) waypoints.push([next.latitude, next.longitude]);
                }

                if (waypoints.length >= 2) missedRuns.push(waypoints);
            } else {
                i++;
            }
        }

        if (!missedRuns.length) { setSnappedMissedPaths([]); return; }

        // OSRM-snap each missed run
        const snapPath = async (pts) => {
            const coordStr = pts.map(c => `${c[1]},${c[0]}`).join(';');
            try {
                const url = `https://router.project-osrm.org/route/v1/driving/${coordStr}?overview=full&geometries=geojson&continue_straight=false`;
                const res = await fetch(url);
                if (res.ok) {
                    const json = await res.json();
                    if (json.routes?.[0]?.geometry?.coordinates) {
                        return json.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
                    }
                }
            } catch (_) { /* fallback below */ }
            return pts; // fallback to straight line
        };

        (async () => {
            const results = await Promise.all(missedRuns.map(run => snapPath(run)));
            setSnappedMissedPaths(results);
        })();
    }, [stagesWithCoords, gpsTraceLogs]);

    // Time-lapse bus traveling animation along the snapped route path (loops direction-based)
    useEffect(() => {
        if (mapTab !== 'route' || animationPath.length === 0) {
            setAnimatingIndex(null);
            return;
        }

        let currentIndex = highlightsTab === 'in' ? 0 : animationPath.length - 1;
        const stepVal = highlightsTab === 'in' ? 10 : -10; // faster animation
        const targetIndex = highlightsTab === 'in' ? animationPath.length - 1 : 0;

        setAnimatingIndex(currentIndex);

        const interval = setInterval(() => {
            const isFinished = highlightsTab === 'in'
                ? currentIndex >= targetIndex
                : currentIndex <= targetIndex;

            if (isFinished) {
                // Loop: reset to start point
                currentIndex = highlightsTab === 'in' ? 0 : animationPath.length - 1;
            } else {
                currentIndex += stepVal;
                // Clamp index to boundaries
                if (currentIndex < 0) currentIndex = 0;
                if (currentIndex >= animationPath.length) currentIndex = animationPath.length - 1;
            }
            setAnimatingIndex(currentIndex);
        }, 20); // 20ms = ~50 FPS buttery-smooth glide!

        return () => {
            clearInterval(interval);
        };
    }, [mapTab, highlightsTab, animationPath]);

    // Render/Update Leaflet Map
    useEffect(() => {
        if (!isLeafletReady || !mapContainerRef.current || !window.L) return;
        const L = window.L;

        // Initialize Map if not yet initialized
        if (!mapInstanceRef.current) {
            const initialCenter = [17.544, 80.616];
            const initialZoom = 13;

            const map = L.map(mapContainerRef.current, {
                center: initialCenter,
                zoom: initialZoom,
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

        // Invalidate size immediately to ensure container dimensions are calculated correctly
        map.invalidateSize();

        let timer = null;

        // 1. Draw stage markers (ALWAYS — both Route Map and Live View)
        const stageCoords = stagesWithCoords
            .filter(s => typeof s.latitude === 'number' && typeof s.longitude === 'number' && s.latitude !== 0 && s.longitude !== 0)
            .map(s => [s.latitude, s.longitude]);

        // Helper: check if GPS trace has any point within a stage's radius
        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371e3;
            const phi1 = lat1 * Math.PI / 180, phi2 = lat2 * Math.PI / 180;
            const dPhi = (lat2 - lat1) * Math.PI / 180;
            const dLam = (lon2 - lon1) * Math.PI / 180;
            const a = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2;
            return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        };

        const allTracePts = (gpsTraceLogs || []).filter(t =>
            typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0
        );
        const hasEnoughHistory = allTracePts.length > 5; // only show visit status when we have data

        stagesWithCoords.forEach((stage, idx) => {
            if (typeof stage.latitude !== 'number' || typeof stage.longitude !== 'number' || stage.latitude === 0 || stage.longitude === 0) return;
            const isFinal = stage.isFinalDest;
            const searchRadius = Math.max(stage.radius || 200, 500);

            // Determine visit status for live tab coloring
            let visited = false;
            if (mapTab === 'live' && hasEnoughHistory) {
                visited = allTracePts.some(pt =>
                    calculateDistance(stage.latitude, stage.longitude, pt.latitude, pt.longitude) <= searchRadius
                );
            }

            let iconHtml;
            if (mapTab === 'route') {
                // Route Map: standard numbered blue badges
                iconHtml = isFinal ? `
                    <div class="relative flex items-center justify-center">
                        <span class="absolute inline-flex h-5 w-5 rounded-full bg-blue-400 opacity-75 animate-ping"></span>
                        <div class="relative flex items-center justify-center rounded-full h-4.5 w-4.5 bg-blue-600 border border-white shadow-md">
                            <span class="text-[7px]">🏁</span>
                        </div>
                    </div>
                ` : `
                    <div class="flex items-center justify-center rounded-full h-4.5 w-4.5 bg-blue-600 border border-white shadow-md text-white font-extrabold text-[8px]">
                        ${idx + 1}
                    </div>
                `;
            } else {
                // Live View: numbered badges colored by visit status — always show the number
                // Blue = visited, Amber = missed, Grey = no data yet
                const bgColor = !hasEnoughHistory ? '#64748b' : (isFinal ? '#4f46e5' : (visited ? '#2563eb' : '#d97706'));
                // Small status dot in corner: green tick or red cross
                const statusDot = hasEnoughHistory && !isFinal
                    ? `<span style="position:absolute;top:-3px;right:-3px;width:7px;height:7px;border-radius:50%;background:${visited ? '#22c55e' : '#ef4444'};border:1px solid white;"></span>`
                    : '';
                iconHtml = isFinal ? `
                    <div class="relative flex items-center justify-center">
                        <div class="relative flex items-center justify-center rounded-full h-5 w-5 border-2 border-white shadow-md" style="background:${bgColor}">
                            <span class="text-[8px]">🏁</span>
                        </div>
                    </div>
                ` : `
                    <div style="position:relative;display:inline-flex;">
                        <div class="flex items-center justify-center rounded-full border-2 border-white shadow-lg text-white font-extrabold" style="width:20px;height:20px;font-size:8px;background:${bgColor};">
                            ${idx + 1}
                        </div>
                        ${statusDot}
                    </div>
                `;
            }

            const icon = L.divIcon({
                html: iconHtml,
                className: 'custom-stage-marker-icon',
                iconSize: [20, 20],
                iconAnchor: [10, 10]
            });

            const visitLabel = !hasEnoughHistory ? 'No GPS data yet' : (isFinal ? (visited ? '✓ Arrived' : '⏳ Not yet reached') : (visited ? '✓ Visited' : '⚠ Missed'));
            const popupHtml = `
                <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
                    <strong style="font-size: 12px; color: #1d4ed8;">${stage.stageName}</strong><br/>
                    <span style="color: #64748b;">${isFinal ? '🏁 Final Destination' : `📍 Stage #${idx + 1}`}</span><br/>
                    ${mapTab === 'live' ? `<span style="color:${!hasEnoughHistory ? '#94a3b8' : (visited ? '#059669' : '#d97706')}; font-weight:bold;">${visitLabel}</span>` : ''}
                </div>
            `;
            const marker = L.marker([stage.latitude, stage.longitude], { icon });
            marker.bindPopup(popupHtml);
            marker.addTo(layerGroup);
        });

        // Draw dashed yellow path for missed stage runs using pre-snapped road paths (Live View only)
        if (mapTab === 'live' && hasEnoughHistory && snappedMissedPaths.length > 0) {
            snappedMissedPaths.forEach(pts => {
                if (pts.length < 2) return;
                // outer glow
                L.polyline(pts, {
                    color: '#fbbf24',
                    weight: 7,
                    opacity: 0.25,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(layerGroup);
                // inner dashed line
                L.polyline(pts, {
                    color: '#f59e0b',
                    weight: 2.5,
                    opacity: 0.9,
                    dashArray: '8, 6',
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(layerGroup);
            });
        } else if (mapTab === 'live' && hasEnoughHistory && snappedMissedPaths.length === 0) {
            // Fallback: draw straight dashed lines while OSRM snapping is in progress
            for (let i = 0; i < stagesWithCoords.length - 1; i++) {
                const s1 = stagesWithCoords[i];
                const s2 = stagesWithCoords[i + 1];
                if (typeof s1.latitude !== 'number' || typeof s2.latitude !== 'number') continue;
                if (s1.latitude === 0 || s2.latitude === 0) continue;
                const r2 = Math.max(s2.radius || 200, 500);
                const visited2 = allTracePts.some(pt => calculateDistance(s2.latitude, s2.longitude, pt.latitude, pt.longitude) <= r2);
                if (!visited2) {
                    L.polyline([[s1.latitude, s1.longitude], [s2.latitude, s2.longitude]], {
                        color: '#f59e0b', weight: 2, opacity: 0.5, dashArray: '8, 6', lineCap: 'round'
                    }).addTo(layerGroup);
                }
            }
        }

        // 2. Draw connecting route lines (dynamic growth for Route Map, live coordinates trail for Live View)
        let linePoints = [];
        if (mapTab === 'route') {
            if (animatingIndex !== null && animationPath.length > 0) {
                if (highlightsTab === 'in') {
                    linePoints = animationPath.slice(0, animatingIndex + 1);
                } else {
                    linePoints = animationPath.slice(animatingIndex, animationPath.length);
                }
            }
        } else {
            // Live View tab: show ONLY the current active trip segment (not the full day round-trip)
            const historyPoints = (gpsTraceLogs || [])
                .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0);

            const livePoints = (gpsLiveBreadcrumbsRef.current || [])
                .filter(t => typeof t.latitude === 'number' && typeof t.longitude === 'number' && t.latitude !== 0 && t.longitude !== 0);
            
            // Add current active bus position to line if available
            const hasGpsCoords = gpsVehicle && 
                                typeof gpsVehicle.latitude === 'number' && 
                                typeof gpsVehicle.longitude === 'number' && 
                                gpsVehicle.latitude !== 0 && 
                                gpsVehicle.longitude !== 0;
            const currentPos = hasGpsCoords ? [{
                latitude: gpsVehicle.latitude,
                longitude: gpsVehicle.longitude,
                timestamp: gpsVehicle.timestamp || new Date().toISOString()
            }] : [];

            const allPointsMap = new Map();
            [...historyPoints, ...livePoints, ...currentPos].forEach(pt => {
                if (pt && typeof pt.latitude === 'number' && typeof pt.longitude === 'number') {
                    const key = `${pt.latitude.toFixed(5)},${pt.longitude.toFixed(5)}`;
                    if (!allPointsMap.has(key)) {
                        allPointsMap.set(key, pt);
                    }
                }
            });

            // Sort all points chronologically
            const sortedPoints = Array.from(allPointsMap.values())
                .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            // Split into trip segments at ≥90 min gaps (bus parked between runs)
            const GAP_MS = 90 * 60 * 1000;
            const tripSegments = [];
            let currentSegment = [];

            for (let i = 0; i < sortedPoints.length; i++) {
                if (i === 0) {
                    currentSegment.push(sortedPoints[i]);
                } else {
                    const prev = new Date(sortedPoints[i - 1].timestamp).getTime();
                    const curr = new Date(sortedPoints[i].timestamp).getTime();
                    if (!isNaN(prev) && !isNaN(curr) && (curr - prev) >= GAP_MS) {
                        // Gap detected — save current segment and start a new one
                        if (currentSegment.length > 0) tripSegments.push(currentSegment);
                        currentSegment = [sortedPoints[i]];
                    } else {
                        currentSegment.push(sortedPoints[i]);
                    }
                }
            }
            if (currentSegment.length > 0) tripSegments.push(currentSegment);

            const today = new Date().toISOString().split('T')[0];
            const isToday = (selectedDate || today) === today;

            // For today: only draw the LAST segment (active trip). For past dates: draw ALL segments.
            const segmentsToDraw = isToday ? tripSegments.slice(-1) : tripSegments;

            // Draw each trip segment as its own independent polyline (no connecting line between trips)
            segmentsToDraw.forEach(seg => {
                const pts = seg.map(pt => [pt.latitude, pt.longitude]);
                if (pts.length < 2) return;
                // outer glow
                L.polyline(pts, {
                    color: '#1d4ed8',
                    weight: 7,
                    opacity: 0.35,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(layerGroup);
                // inner route
                L.polyline(pts, {
                    color: '#2563eb',
                    weight: 3.5,
                    opacity: 0.95,
                    lineCap: 'round',
                    lineJoin: 'round'
                }).addTo(layerGroup);
            });

            // linePoints stays [] so the shared polyline block below is skipped for live view
        }

        if (linePoints.length >= 2) {
            // outer glow
            L.polyline(linePoints, {
                color: '#1d4ed8',
                weight: 7,
                opacity: 0.35,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(layerGroup);

            // inner route
            L.polyline(linePoints, {
                color: '#2563eb',
                weight: 3.5,
                opacity: 0.95,
                lineCap: 'round',
                lineJoin: 'round'
            }).addTo(layerGroup);
        }

        // 3. Render tab-specific controls
        if (mapTab === 'route') {
            // Draw animating bus marker overlay representing the simulated bus ride
            const activeAnimPos = (animatingIndex !== null && animationPath[animatingIndex]) || null;
            if (activeAnimPos && activeAnimPos.length === 2) {
                const icon = createVehicleIcon(true); // green active bus icon
                const movingMarker = L.marker(activeAnimPos, { icon, zIndexOffset: 1000 });
                movingMarker.bindPopup(`
                    <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
                        <strong style="color: #2563eb;">Time-Lapse Simulation</strong><br/>
                        <span style="color: #64748b; font-weight: bold;">
                            🚌 Direction: ${highlightsTab === 'in' ? 'Morning Campus Inward' : 'Evening Home Outward'}
                        </span>
                    </div>
                `);
                movingMarker.addTo(layerGroup);
            }
        } else {
            // LIVE VIEW TAB: Draw live vehicle marker overlay on top of route, and center/pan on it
            const hasGpsCoords = gpsVehicle && 
                                typeof gpsVehicle.latitude === 'number' && 
                                typeof gpsVehicle.longitude === 'number' && 
                                gpsVehicle.latitude !== 0 && 
                                gpsVehicle.longitude !== 0;

            if (hasGpsCoords) {
                const lat = gpsVehicle.latitude;
                const lng = gpsVehicle.longitude;
                const isMoving = (gpsVehicle.speed || 0) > 0;
                const icon = createVehicleIcon(isMoving);

                const marker = L.marker([lat, lng], { icon });
                const popupHtml = `
                    <div style="font-family: sans-serif; font-size: 11px; padding: 2px;">
                        <strong style="font-size: 12px; color: #0f172a;">${gpsVehicle.name}</strong><br/>
                        <span style="color: #64748b;">Unit ID: ${gpsVehicle.units}</span><br/>
                        <span style="color: ${isMoving ? '#059669' : '#dc2626'}; font-weight: bold;">
                            ${isMoving ? `🚌 Speed: ${gpsVehicle.speed} km/h` : '⏹ Stopped'}
                        </span><br/>
                        <span style="color: #94a3b8; font-size: 10px;">${gpsVehicle.timestamp || ''}</span>
                    </div>
                `;
                marker.bindPopup(popupHtml);
                marker.addTo(layerGroup);

                // Follow live bus only after initial center (tab-switch zoom is handled separately)
                if (centeredVehicleNameRef.current === gpsVehicle.name) {
                    timer = setTimeout(() => {
                        if (mapInstanceRef.current && mapTab === 'live') {
                            mapInstanceRef.current.panTo([lat, lng], { animate: true });
                        }
                    }, 50);
                } else if (!centeredVehicleNameRef.current) {
                    timer = setTimeout(() => {
                        if (mapInstanceRef.current && mapTab === 'live') {
                            mapInstanceRef.current.invalidateSize();
                            mapInstanceRef.current.flyTo([lat, lng], 15, { animate: true, duration: 1.5 });
                            centeredVehicleNameRef.current = gpsVehicle.name;
                            setHasCenteredFirstTime(true);
                        }
                    }, 150);
                }
            }
        }

        return () => {
            if (timer) clearTimeout(timer);
        };
    }, [isLeafletReady, gpsVehicle, gpsTraceLogs, createVehicleIcon, mapTab, stagesWithCoords, snappedRoutePath, animatingIndex, animationPath, highlightsTab, snappedMissedPaths]);

    const handlePrint = async (options = reportOptions) => {
        if (!data?.bus?.busNumber) return;
        setIsPrinting(true);
        setReportLoadingAction('pdf');
        try {
            const response = await apiFetch(`${API}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'passenger-report',
                    data: {
                        busId: data.bus.busNumber,
                        academicYear,
                        occupancyMode,
                        status: occupancyMode === 'live' ? 'active' : 'approved',
                        includeAbstract: options.abstract,
                        includeDetailed: options.detailed,
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Transport-Passenger-Report-${data.bus.busNumber}`);
                setReportModalOpen(false);
            } else {
                const err = await response.json().catch(() => ({}));
                const errorText = err.message || 'Failed to generate passenger report.';
                setReportModalError(errorText);
            }
        } catch (error) {
            console.error('Error printing passenger report:', error);
            setReportModalError(error?.message ? `Error: ${error.message}` : 'Error preparing passenger report.');
        } finally {
            setIsPrinting(false);
            setReportLoadingAction(null);
        }
    };

    const handleDownloadExcelReport = async (options = reportOptions) => {
        if (!data?.bus?.busNumber) return;
        setIsPrinting(true);
        setReportLoadingAction('excel');
        try {
            const response = await apiFetch(`${API}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'passenger-report',
                    data: {
                        busId: data.bus.busNumber,
                        academicYear,
                        occupancyMode,
                        status: occupancyMode === 'live' ? 'active' : 'approved',
                        includeAbstract: options.abstract,
                        includeDetailed: options.detailed,
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                exportHtmlAsExcel(html, `Transport-Passenger-Report-${data.bus.busNumber}`);
                setReportModalOpen(false);
            } else {
                const err = await response.json().catch(() => ({}));
                const errorText = err.message || 'Failed to generate passenger report.';
                setReportModalError(errorText);
            }
        } catch (error) {
            console.error('Error exporting passenger report to Excel:', error);
            setReportModalError(error?.message ? `Error: ${error.message}` : 'Error preparing passenger report.');
        } finally {
            setIsPrinting(false);
            setReportLoadingAction(null);
        }
    };

    const openReportModal = () => {
        setReportModalError('');
        setReportOptions({ abstract: true, detailed: true });
        setReportModalOpen(true);
    };

    const toggleReportOption = (key) => {
        setReportOptions((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            if (!next.abstract && !next.detailed) {
                return prev;
            }
            return next;
        });
        setReportModalError('');
    };

    const handlePrintAdmitCardClick = async (p) => {
        if (fetchingPass) return;
        setFetchingPass(true);
        try {
            const response = await apiFetch(`${API}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'transport-admit',
                    data: { requestId: p.id }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Transport-Admit-Card-${p.admission_number || p.emp_no || p.id}`);
            } else {
                alert('Failed to generate admit card.');
            }
        } catch (error) {
            console.error('Error fetching admit card details:', error);
            alert('Error preparing admit card.');
        } finally {
            setFetchingPass(false);
        }
    };

    useEffect(() => {
        const fetchInventory = async () => {
            if (!data?.bus?.busNumber) return;
            setInventoryLoading(true);
            try {
                const response = await apiFetch(`${API}/inventory/history/${data.bus.busNumber}`);
                if (response.ok) {
                    const json = await response.json();
                    setInventoryHistory(json);
                }
            } catch (e) {
                console.error(e);
            } finally {
                setInventoryLoading(false);
            }
        };

        if (activeTab === 'history' && historySubTab === 'inventory') {
            fetchInventory();
        }
    }, [data?.bus?.busNumber, activeTab, historySubTab]);

    useEffect(() => {
        const fetchRouteHistory = async () => {
            if (!id) return;
            setRouteHistoryLoading(true);
            try {
                const response = await apiFetch(`${API}/buses/${id}/history/route`);
                if (response.ok) {
                    setRouteHistory(await response.json());
                }
            } catch (e) {
                console.error(e);
            } finally {
                setRouteHistoryLoading(false);
            }
        };

        if (activeTab === 'history' && historySubTab === 'route') {
            fetchRouteHistory();
        }
    }, [id, activeTab, historySubTab]);

    useEffect(() => {
        const fetchStaffHistory = async () => {
            if (!id) return;
            setStaffHistoryLoading(true);
            try {
                const response = await apiFetch(`${API}/buses/${id}/history/staff`);
                if (response.ok) {
                    setStaffHistory(await response.json());
                }
            } catch (e) {
                console.error(e);
            } finally {
                setStaffHistoryLoading(false);
            }
        };

        if (activeTab === 'history' && historySubTab === 'staff') {
            fetchStaffHistory();
        }
    }, [id, activeTab, historySubTab]);

    useEffect(() => {
        const fetchDetails = async () => {
            if (!id) return;
            if (isFirstLoadRef.current) {
                setLoading(true);
                isFirstLoadRef.current = false;
            } else {
                setPassengersLoading(true);
            }
            try {
                const params = new URLSearchParams({ occupancyMode });
                if (occupancyMode !== 'live') params.append('academicYear', academicYear);
                const response = await apiFetch(
                    `${API}/buses/${id}/details?${params.toString()}`
                );
                if (response.ok) {
                    const json = await response.json();
                    setData(json);
                } else {
                    setData(null);
                }
            } catch (e) {
                console.error(e);
                setData(null);
            } finally {
                setLoading(false);
                setPassengersLoading(false);
            }
        };
        fetchDetails();
    }, [id, academicYear, occupancyMode]);

    // Check for expired taxes whenever bus data changes
    useEffect(() => {
        if (data?.bus?.taxes && data.bus.taxes.length > 0) {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const expired = data.bus.taxes
                .filter(tax => {
                    const taxEndDate = new Date(tax.endDate);
                    taxEndDate.setHours(0, 0, 0, 0);
                    return taxEndDate < today;
                })
                .map(tax => ({
                    ...tax,
                    formattedEndDate: new Date(tax.endDate).toLocaleDateString()
                }));
                
            setExpiredTaxesWarning(expired);
        } else {
            setExpiredTaxesWarning([]);
        }
    }, [data]);

    const openAssignModal = async () => {
        setAssignModalOpen(true);
        setSelectedIds(new Set());
        if (!data?.bus?.assignedRouteId) {
            setUnassignedPassengers([]);
            return;
        }
        try {
            const response = await apiFetch(
                `${API}/transport-requests?route_id=${encodeURIComponent(data.bus.assignedRouteId)}&status=active&bus_id=unassigned`
            );
            const list = await response.json();
            setUnassignedPassengers(Array.isArray(list) ? list : []);
        } catch (e) {
            setUnassignedPassengers([]);
        }
    };

    const handleAssignSelected = async () => {
        if (!data?.bus?.busNumber || selectedIds.size === 0) return;
        setAssignLoading(true);
        try {
            for (const reqId of selectedIds) {
                await apiFetch(`${API}/transport-requests/${reqId}`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ bus_id: data.bus.busNumber }),
                });
            }
            setAssignModalOpen(false);
            const params = new URLSearchParams({ occupancyMode });
            if (occupancyMode !== 'live') params.append('academicYear', academicYear);
            const res = await apiFetch(
                `${API}/buses/${id}/details?${params.toString()}`
            );
            if (res.ok) setData(await res.json());
        } catch (e) {
            console.error(e);
        } finally {
            setAssignLoading(false);
        }
    };

    const toggleSelect = (reqId) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            if (next.has(reqId)) next.delete(reqId);
            else next.add(reqId);
            return next;
        });
    };

    if (loading) {
        return (
            <Layout>
                <div className="py-20">
                    <Loader text="Loading bus details..." />
                </div>
            </Layout>
        );
    }

    if (!data?.bus) {
        return (
            <Layout>
                <div className="text-center py-20">
                    <p className="text-gray-500 mb-4">Bus not found.</p>
                    <Link to="/fleet" className="text-blue-600 hover:underline">← Back to Fleet & Passengers</Link>
                </div>
            </Layout>
        );
    }

    const occupancyLabel = occupancyMode === 'live' ? 'Live' : academicYear;
    const studentCount = (passengers || []).filter((p) => !p.user_type || p.user_type === 'student').length;
    const employeeCount = (passengers || []).filter((p) => p.user_type === 'employee').length;

    const getStageGpsStatus = (stage, isFirstStage, isFinalDest) => {
        const calculateDistance = (lat1, lon1, lat2, lon2) => {
            const R = 6371e3; // meters
            const phi1 = lat1 * Math.PI / 180;
            const phi2 = lat2 * Math.PI / 180;
            const deltaPhi = (lat2 - lat1) * Math.PI / 180;
            const deltaLambda = (lon2 - lon1) * Math.PI / 180;

            const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
                      Math.cos(phi1) * Math.cos(phi2) *
                      Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
            const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

            return R * c; // in meters
        };

        let morningTime = '—';
        let eveningTime = '—';
        const searchRadius = Math.max(stage.radius || 200, 500);

        // 1. Morning check ("In")
        const morningInside = morningTrace
            .filter(pt => calculateDistance(stage.latitude, stage.longitude, pt.latitude, pt.longitude) <= searchRadius)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (morningInside.length > 0) {
            if (isFinalDest) {
                // Morning final campus stop: enters the campus (first point inside radius)
                const firstPt = morningInside[0];
                morningTime = firstPt.timestamp ? firstPt.timestamp.split(' ')[1].substring(0, 5) : '—';
            } else {
                // Morning boarding stages: leaving the stage radius (last point inside radius)
                const lastPt = morningInside[morningInside.length - 1];
                morningTime = lastPt.timestamp ? lastPt.timestamp.split(' ')[1].substring(0, 5) : '—';
            }
        }

        // 2. Evening check ("Out")
        const eveningInside = eveningTrace
            .filter(pt => calculateDistance(stage.latitude, stage.longitude, pt.latitude, pt.longitude) <= searchRadius)
            .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

        if (eveningInside.length > 0) {
            if (isFinalDest) {
                // Evening campus start: leaving the campus (last point inside radius)
                const lastPt = eveningInside[eveningInside.length - 1];
                eveningTime = lastPt.timestamp ? lastPt.timestamp.split(' ')[1].substring(0, 5) : '—';
            } else {
                // Evening drop-off stages: enters the stage radius (first point inside radius)
                const firstPt = eveningInside[0];
                eveningTime = firstPt.timestamp ? firstPt.timestamp.split(' ')[1].substring(0, 5) : '—';
            }
        }

        return { morningTime, eveningTime };
    };

    const routePathLabel = routeStops.length > 0
        ? routeStops.join(' → ')
        : route
            ? `${route.startPoint || route.routeName || '—'}${route.endPoint ? ` → ${route.endPoint}` : ''}`
            : 'No route assigned';

    const getPassengerCourse = (passenger) => (
        passenger.user_type === 'employee' ? 'Employee' : (passenger.course || 'Unassigned')
    );

    const courseOptions = [...new Set((passengers || []).map(getPassengerCourse))].sort();
    const yearOptions = [...new Set((passengers || []).map((p) => String(p.year_of_study ?? '')).filter(Boolean))].sort((a, b) => Number(a) - Number(b));
    const stageOptions = [...new Set((passengers || []).map((p) => p.stage_name).filter(Boolean))].sort();
    const typeOptions = [...new Set((passengers || []).map((p) => p.user_type || 'student'))].sort();

    const filteredPassengers = (passengers || []).filter((passenger) => {
        const name = (passenger.student_name || passenger.employee_name || '').toLowerCase();
        const id = (passenger.admission_number || passenger.emp_no || '').toLowerCase();
        const query = searchQuery.trim().toLowerCase();

        if (query && !name.includes(query) && !id.includes(query)) return false;
        if (filterCourse && getPassengerCourse(passenger) !== filterCourse) return false;
        if (filterYear && String(passenger.year_of_study ?? '') !== filterYear) return false;
        if (filterStage && passenger.stage_name !== filterStage) return false;
        if (filterType && (passenger.user_type || 'student') !== filterType) return false;
        return true;
    });

    return (
        <Layout>
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between bg-white p-3 rounded-xl border border-slate-200/80 shadow-sm">
                <div className="flex items-center gap-3">
                    <Link 
                        to="/fleet" 
                        title="Back to Fleet & Passengers"
                        className="p-1.5 hover:bg-slate-50 border border-slate-200 rounded-lg text-slate-600 transition-colors flex items-center justify-center"
                    >
                        <ChevronLeft size={18} />
                    </Link>
                    <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                            <h1 className="text-lg font-black text-slate-900 tracking-tight leading-none">{bus.busNumber}</h1>
                            {route && (
                                <span className="text-xs font-bold bg-blue-50 text-blue-700 px-2.5 py-1 rounded-lg border border-blue-100 leading-none">
                                    {route.routeName || route.routeId} ({route.routeId})
                                </span>
                            )}
                            <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider leading-none ${
                                String(bus.status || 'active').toLowerCase() === 'active' ? 'bg-green-100 text-green-800 border border-green-200' :
                                String(bus.status || 'active').toLowerCase() === 'inactive' ? 'bg-slate-100 text-slate-800 border border-slate-200' :
                                'bg-red-100 text-red-800 border border-red-200'
                            }`}>
                                {bus.status || 'active'}
                            </span>
                        </div>
                        <div className="text-[10px] text-slate-500 font-semibold leading-none pl-0.5 mt-0.5">
                            {bus.type || 'Standard'}{bus.vehicleModel ? ` · ${bus.vehicleModel}` : ''}
                        </div>
                    </div>
                </div>

                <div className="flex items-center gap-2.5">
                    {/* Date filter dropdown */}
                    <div className="inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 hover:border-slate-300 rounded-lg px-2.5 py-1.5 shadow-sm transition-all">
                        <Calendar size={13} className="text-blue-500 shrink-0" />
                        <span className="text-[9px] font-extrabold text-slate-400 uppercase tracking-wide">Date:</span>
                        <input
                            type="date"
                            value={selectedDate}
                            onChange={(e) => setSelectedDate(e.target.value)}
                            max={new Date().toISOString().split('T')[0]}
                            className="bg-transparent text-xs font-bold text-slate-700 focus:outline-none cursor-pointer outline-none w-[110px]"
                        />
                    </div>

                    <button
                        type="button"
                        onClick={openReportModal}
                        disabled={isPrinting}
                        className="inline-flex items-center text-xs bg-white text-slate-700 px-3.5 py-1.5 rounded-lg font-semibold hover:bg-slate-50 transition-all border border-slate-200 shadow-sm disabled:opacity-50"
                    >
                        <Download size={14} className="mr-1.5 text-blue-600" />
                        Download Report
                    </button>
                </div>
            </div>

            <Modal
                isOpen={reportModalOpen}
                onClose={() => !isPrinting && setReportModalOpen(false)}
                title="Download Bus Report"
                maxWidth="max-w-md"
            >
                <p className="text-sm text-slate-600 mb-4">
                    Choose which sections to include in the report.
                </p>

                <div className="space-y-3">
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={reportOptions.abstract}
                            onChange={() => toggleReportOption('abstract')}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Abstract</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                                Route-wise summary table with totals for students and employees.
                            </span>
                        </span>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={reportOptions.detailed}
                            onChange={() => toggleReportOption('detailed')}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Detailed</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                                Stage-wise passenger list with names, IDs, course, and bus details.
                            </span>
                        </span>
                    </label>
                </div>

                {reportModalError && (
                    <p className="mt-3 text-sm font-medium text-red-600">{reportModalError}</p>
                )}

                <div className="mt-5 flex flex-col sm:flex-row sm:justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setReportModalOpen(false)}
                        disabled={isPrinting}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => handleDownloadExcelReport(reportOptions)}
                        disabled={isPrinting || (!reportOptions.abstract && !reportOptions.detailed)}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center"
                    >
                        {reportLoadingAction === 'excel' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
                        Excel
                    </button>
                    <button
                        type="button"
                        onClick={() => handlePrint(reportOptions)}
                        disabled={isPrinting || (!reportOptions.abstract && !reportOptions.detailed)}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
                    >
                        {reportLoadingAction === 'pdf' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
                        PDF
                    </button>
                </div>
            </Modal>

            {/* Title space refactored into top bar */}

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-12 gap-4 mb-6 xl:items-stretch xl:h-[min(560px,calc(100vh-10rem))]">
                {/* Column 1: Occupancy & Crew — narrower */}
                <div className="min-w-0 md:col-span-1 xl:col-span-3 h-full min-h-0">
                    <StatCard title="Occupancy & Crew Details" className="h-full overflow-y-auto custom-scrollbar p-4">
                            <div className="flex flex-col gap-3">
                                <div className="flex items-center gap-3">
                                    <DonutChart percent={occupancyPercent} />
                                    <div className="space-y-1 text-xs font-semibold text-slate-500">
                                        <div className="flex items-baseline gap-1 text-slate-900 mb-1">
                                            <span className="text-xl font-black">{seatsFilled}</span>
                                            <span className="text-[10px] text-slate-400 font-bold">/ {capacity} Seats</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-blue-600" />
                                            <span>{seatsFilled} Occupied</span>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-slate-200" />
                                            <span>{seatsAvailable} Available</span>
                                        </div>
                                    </div>
                                </div>

                                <div className="border-t border-slate-100"></div>

                                <div className="flex flex-col gap-2">
                                    <div>
                                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-700 mb-1">
                                            <span>{studentCount} STUDENTS</span>
                                            <span>{passengers.length > 0 ? Math.round((studentCount / passengers.length) * 100) : 0}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-blue-600 h-full rounded-full" style={{ width: `${passengers.length > 0 ? (studentCount / passengers.length) * 100 : 0}%` }}></div>
                                        </div>
                                    </div>
                                    <div>
                                        <div className="flex items-center justify-between text-[10px] font-bold text-slate-700 mb-1">
                                            <span>{employeeCount} STAFF</span>
                                            <span>{passengers.length > 0 ? Math.round((employeeCount / passengers.length) * 100) : 0}%</span>
                                        </div>
                                        <div className="w-full bg-slate-100 h-1.5 rounded-full overflow-hidden">
                                            <div className="bg-slate-300 h-full rounded-full" style={{ width: `${passengers.length > 0 ? (employeeCount / passengers.length) * 100 : 0}%` }}></div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 my-3"></div>

                            {/* Bus Staff Section */}
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Bus Staff</p>
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between border border-slate-100 rounded-xl p-2 bg-slate-50/30">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                                <User size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Driver</p>
                                                <p className={`text-xs font-bold truncate ${bus.driverName ? 'text-slate-800' : 'text-red-500'}`}>
                                                    {bus.driverName || 'Not Assigned'}
                                                </p>
                                            </div>
                                        </div>
                                        {!bus.driverName ? (
                                            <Link to="/buses" className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-slate-50 shadow-sm whitespace-nowrap">
                                                + Assign
                                            </Link>
                                        ) : (
                                            <span className="text-[9px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">Assigned</span>
                                        )}
                                    </div>
                                    <div className="flex items-center justify-between border border-slate-100 rounded-xl p-2 bg-slate-50/30">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <div className="w-7 h-7 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400 shrink-0">
                                                <UserCheck size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-bold uppercase tracking-wide text-slate-600">Attendant</p>
                                                <p className={`text-xs font-bold truncate ${bus.attendantName ? 'text-slate-800' : 'text-red-500'}`}>
                                                    {bus.attendantName || 'Not Assigned'}
                                                </p>
                                            </div>
                                        </div>
                                        {!bus.attendantName ? (
                                            <Link to="/buses" className="px-2 py-1 bg-white border border-slate-200 rounded-lg text-[10px] font-bold text-blue-600 hover:bg-slate-50 shadow-sm whitespace-nowrap">
                                                + Assign
                                            </Link>
                                        ) : (
                                            <span className="text-[9px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">Assigned</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-slate-100 my-3"></div>

                            {/* Live Status & Academic Year Section */}
                            <div>
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">Live Status & Academic Year</p>
                                <div className="flex flex-col gap-2.5">
                                    <div>
                                        <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5 w-full">
                                            <button
                                                type="button"
                                                onClick={() => setOccupancyMode('live')}
                                                className={`flex-1 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide transition-colors ${occupancyMode === 'live' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}
                                            >
                                                Live
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setOccupancyMode('academicYear')}
                                                className={`flex-1 py-1 rounded-md text-[9px] font-bold uppercase tracking-wide transition-colors ${occupancyMode === 'academicYear' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:bg-white'}`}
                                            >
                                                AY
                                            </button>
                                        </div>
                                    </div>

                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase mb-1.5">Academic Year</p>
                                        <div className="relative">
                                            <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" size={14} />
                                            <select
                                                value={academicYear}
                                                onChange={(e) => setAcademicYear(e.target.value)}
                                                disabled={occupancyMode === 'live'}
                                                className="w-full rounded-xl border border-slate-200 pl-8 pr-3 py-1.5 text-xs font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 appearance-none"
                                            >
                                                {academicYearOptions.map((year) => (
                                                    <option key={year} value={year}>{year}</option>
                                                ))}
                                            </select>
                                            <div className="absolute right-3.5 top-1/2 -translate-y-1/2 pointer-events-none border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-500 w-0 h-0" />
                                        </div>
                                    </div>

                                    {occupancyMode !== 'live' && (
                                        <div className="border-t border-slate-100 pt-2 flex items-center gap-2">
                                            <span className="relative flex h-2 w-2 shrink-0">
                                                <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500" />
                                            </span>
                                            <div>
                                                <p className="text-xs font-bold text-blue-700 uppercase tracking-wide">AY Mode</p>
                                                <p className="text-[9px] text-slate-400 font-semibold leading-none">Showing {academicYear} occupancy.</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                    </StatCard>
                </div>

                {/* Column 2: Route Highlights */}
                <div className="min-w-0 md:col-span-1 xl:col-span-4 h-full min-h-0">
                        <StatCard 
                            className="h-full overflow-hidden p-4"
                            title="Route Highlights"
                            action={
                                <div className="flex items-center gap-2 shrink-0">
                                    {distanceTravelledKm && (
                                        <div className="flex items-center gap-1 bg-blue-50 border border-blue-100 rounded-lg px-2 py-0.5">
                                            <span className="text-[9px] font-bold text-blue-500 uppercase tracking-wide">total travelled</span>
                                            <span className="text-[10px] font-extrabold text-blue-700">{distanceTravelledKm} km</span>
                                        </div>
                                    )}
                                    {mapTab === 'route' && (
                                        <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shadow-sm">
                                            <button
                                                type="button"
                                                onClick={() => setHighlightsTab('in')}
                                                className={`px-2.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider transition-all ${
                                                    highlightsTab === 'in'
                                                        ? 'bg-white text-blue-600 shadow-sm'
                                                        : 'text-slate-500 hover:text-slate-700'
                                                }`}
                                            >
                                                In
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setHighlightsTab('out')}
                                                className={`px-2.5 py-0.5 rounded-md text-[9px] font-extrabold uppercase tracking-wider transition-all ${
                                                    highlightsTab === 'out'
                                                        ? 'bg-white text-blue-600 shadow-sm'
                                                        : 'text-slate-500 hover:text-slate-700'
                                                }`}
                                            >
                                                Out
                                            </button>
                                        </div>
                                    )}
                                </div>
                            }
                        >
                            {route ? (
                                <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-1">
                                    <div className="relative pl-4 border-l-2 border-blue-100 ml-2 py-1 space-y-3">
                                        {stagesWithCoords.map((stage, index) => {
                                            const isFirst = index === 0;
                                            const isLast = index === stagesWithCoords.length - 1;
                                            const isFinal = stage.isFinalDest;
                                            const status = getStageGpsStatus(stage, isFirst, isFinal);
                                            // A stage is 'missed' if both In and Out times are blank
                                            const isMissed = !gpsLoading && !isFinal && status.morningTime === '—' && status.eveningTime === '—' && (morningTrace.length > 0 || eveningTrace.length > 0);

                                            return (
                                                <div key={index} className="relative flex flex-col justify-center pl-1">
                                                    {/* Bullet point indicator — amber when missed */}
                                                    <div className={`absolute -left-[21px] w-3.5 h-3.5 rounded-full border-2 bg-white flex items-center justify-center ${
                                                        isFinal ? 'border-indigo-600 ring-2 ring-indigo-100' : isMissed ? 'border-amber-400 ring-2 ring-amber-100' : 'border-blue-500'
                                                    }`}>
                                                        <div className={`w-1.5 h-1.5 rounded-full ${isFinal ? 'bg-indigo-600' : isMissed ? 'bg-amber-400' : 'bg-blue-500'}`} />
                                                    </div>
                                                    
                                                    <div className="flex items-center justify-between gap-2">
                                                        <div className="flex items-center gap-1 min-w-0">
                                                            {isMissed && (
                                                                <span className="shrink-0 text-[8px] font-extrabold text-amber-600 bg-amber-50 border border-amber-200 rounded px-1 py-0.5 uppercase tracking-wide">Missed</span>
                                                            )}
                                                            <span className={`text-[11px] font-extrabold truncate max-w-[140px] ${
                                                                isFinal ? 'text-indigo-800' : isMissed ? 'text-amber-700' : 'text-slate-700'
                                                            }`} title={stage.stageName}>
                                                                {stage.stageName}
                                                            </span>
                                                        </div>
                                                        <div className="flex gap-2 shrink-0">
                                                            {/* Morning "In" status */}
                                                            <div className="flex flex-col items-center">
                                                                <span className="text-[7px] text-slate-400 font-bold uppercase leading-none mb-0.5">In</span>
                                                                {gpsLoading ? (
                                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-blue-600 flex items-center justify-center min-w-[36px]">
                                                                        <Loader2 size={10} className="animate-spin" />
                                                                    </span>
                                                                ) : (
                                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                                        status.morningTime !== '—' && status.morningTime !== '...' ? 'bg-green-100 text-green-800' : isMissed ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
                                                                    }`}>
                                                                        {status.morningTime}
                                                                    </span>
                                                                )}
                                                            </div>
                                                            {/* Evening "Out" status */}
                                                            <div className="flex flex-col items-center">
                                                                <span className="text-[7px] text-slate-400 font-bold uppercase leading-none mb-0.5">Out</span>
                                                                {gpsLoading ? (
                                                                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-blue-600 flex items-center justify-center min-w-[36px]">
                                                                        <Loader2 size={10} className="animate-spin" />
                                                                    </span>
                                                                ) : (
                                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${
                                                                        status.eveningTime !== '—' && status.eveningTime !== '...' ? 'bg-rose-100 text-rose-800' : isMissed ? 'bg-amber-100 text-amber-600' : 'bg-slate-100 text-slate-400'
                                                                    }`}>
                                                                        {status.eveningTime}
                                                                    </span>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            ) : (
                                <p className="text-xs text-slate-400 italic">No route assigned</p>
                            )}
                        </StatCard>
                </div>

                {/* Column 3: GPS Map Card — wider */}
                <div className="min-w-0 md:col-span-2 xl:col-span-5 h-full min-h-[360px]">
                    <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm flex flex-col h-full min-h-0 space-y-3">
                        <div className="flex items-center justify-between border-b border-slate-100 pb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-xs shrink-0">
                                    <Activity size={15} />
                                </div>
                                <div className="min-w-0">
                                    <h2 className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                        Live GPS Tracking
                                        {gpsVehicle && (
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                                        )}
                                    </h2>
                                    <p className="text-[9px] text-slate-400 font-mono truncate">
                                        {gpsVehicle ? `Unit: ${gpsVehicle.units}` : `Reg: ${normalizeVehicleNumber(bus.busNumber)}`}
                                    </p>
                                </div>
                            </div>

                            {gpsVehicle && (
                                <div className="hidden sm:flex items-center gap-3 text-[10px] font-mono border-l border-slate-100 pl-3 mr-auto ml-3">
                                    <div>
                                        <span className="text-slate-400 block text-[8px] uppercase leading-none">Speed</span>
                                        <span className="font-bold text-slate-700">
                                            {(gpsVehicle.speed || 0) > 0 ? `🟢 ${gpsVehicle.speed} km/h` : '🔴 Stopped'}
                                        </span>
                                    </div>
                                    <div>
                                        <span className="text-slate-400 block text-[8px] uppercase leading-none">Last Signal</span>
                                        <span className="font-bold text-slate-700">
                                            {gpsVehicle.timestamp ? gpsVehicle.timestamp.split(' ')[1] || gpsVehicle.timestamp : '—'}
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* View toggle tabs */}
                            <div className="flex bg-slate-100 p-0.5 rounded-lg border border-slate-200 shadow-sm shrink-0 mr-1.5">
                                <button
                                    type="button"
                                    onClick={() => setMapTab('live')}
                                    className={`px-2.5 py-1 rounded-md text-[9px] font-extrabold uppercase tracking-wider transition-all ${
                                        mapTab === 'live'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    Live
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setMapTab('route')}
                                    className={`px-2.5 py-1 rounded-md text-[9px] font-extrabold uppercase tracking-wider transition-all ${
                                        mapTab === 'route'
                                            ? 'bg-white text-blue-600 shadow-sm'
                                            : 'text-slate-500 hover:text-slate-700'
                                    }`}
                                >
                                    Route Map
                                </button>
                            </div>

                            <div className="flex items-center gap-1">
                                {gpsVehicle && gpsVehicle.uiiframe && (
                                    <a
                                        href={gpsVehicle.uiiframe}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors"
                                        title="Direct Frame Link"
                                    >
                                        <ExternalLink size={13} />
                                    </a>
                                )}
                                <button
                                    onClick={() => {
                                        fetchGpsData();
                                        fetchGpsHistory();
                                    }}
                                    disabled={gpsLoading}
                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-slate-50 rounded transition-colors disabled:opacity-50"
                                    title="Refresh GPS"
                                >
                                    <RefreshCw size={13} className={gpsLoading ? 'animate-spin' : ''} />
                                </button>
                            </div>
                        </div>

                        {/* Map or Error Display */}
                        <div className="flex-1 rounded-xl border border-slate-200 overflow-hidden relative bg-slate-50 min-h-0 flex flex-col w-full">
                            {/* Map element is kept in DOM at all times to prevent Leaflet container initialization errors */}
                            <div 
                                ref={mapContainerRef} 
                                className="absolute inset-0 w-full h-full z-0"
                            />
                            
                            {/* Error Overlay */}
                            {mapTab === 'live' && gpsError && (
                                <div className="absolute inset-0 flex flex-col justify-center items-center bg-slate-50 p-6 text-center z-10">
                                    <AlertTriangle size={24} className="text-amber-500 mb-2" />
                                    <p className="text-xs font-bold text-slate-800 mb-1">GPS Not Connected</p>
                                    <p className="text-[10px] text-slate-400 leading-normal">{gpsError}</p>
                                </div>
                            )}

                            {/* Loading Overlay */}
                            {(mapTab === 'route' ? !isLeafletReady : (!gpsError && (!isLeafletReady || !gpsVehicle || !hasCenteredFirstTime))) && (
                                <div className="absolute inset-0 flex flex-col justify-center items-center bg-slate-50 z-10">
                                    <Loader2 size={24} className="animate-spin text-blue-600 mb-2" />
                                    <p className="text-[10px] text-slate-400 font-medium">
                                        {!isLeafletReady ? 'Initializing Map Layers...' : 'Locating Bus Position...'}
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {expiredTaxesWarning.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-2xl p-5 mb-6">
                    <div className="flex items-start gap-3">
                        <AlertTriangle size={22} className="text-red-500 shrink-0 mt-0.5" />
                        <div className="flex-1">
                            <h3 className="text-sm font-bold text-red-800 mb-2">Warning: Expired Taxes Detected</h3>
                            <div className="space-y-2">
                                {expiredTaxesWarning.map((tax, index) => (
                                    <div key={index} className="bg-white rounded-lg p-3 border border-red-100 flex justify-between gap-3">
                                        <div>
                                            <p className="font-medium text-slate-800 text-sm">{tax.taxHeader}</p>
                                            <p className="text-xs text-red-600">Expired on: {tax.formattedEndDate}</p>
                                        </div>
                                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700 h-fit">EXPIRED</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="border-b border-slate-200 flex">
                    <button
                        onClick={() => setActiveTab('passengers')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'passengers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <UsersIcon size={18} /> Passenger List ({filteredPassengers.length})
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <History size={18} /> History
                    </button>
                    <button
                        onClick={() => setActiveTab('kilometers')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'kilometers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <Activity size={18} /> GPS Distance Log
                    </button>
                </div>

                {activeTab === 'passengers' && (
                    <div className="relative">
                        {passengersLoading && (
                            <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-10 transition-all">
                                <div className="flex items-center gap-2 px-3.5 py-2 rounded-xl bg-white border border-slate-200 shadow-md">
                                    <Loader2 size={16} className="animate-spin text-blue-600" />
                                    <span className="text-xs font-bold text-slate-600 tracking-wide">Loading passenger table...</span>
                                </div>
                            </div>
                        )}
                        <div className="p-3 border-b border-slate-100 flex flex-col md:flex-row gap-2 items-center">
                            <div className="relative flex-1 w-full">
                                <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search by name, ID number..."
                                    className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-slate-200 text-xs outline-none focus:ring-2 focus:ring-blue-500 font-medium"
                                />
                            </div>
                            <div className="flex flex-wrap gap-1.5 w-full md:w-auto">
                                <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                                    <option value="">Course</option>
                                    {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
                                </select>
                                <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                                    <option value="">Year</option>
                                    {yearOptions.map((year) => <option key={year} value={year}>{formatYearLabel(year)}</option>)}
                                </select>
                                <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                                    <option value="">Stage</option>
                                    {stageOptions.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                                </select>
                                <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white">
                                    <option value="">Type</option>
                                    {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                                </select>
                            </div>
                        </div>

                        {passengers.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">
                                <p>No passengers for {occupancyMode === 'live' ? 'live occupancy' : `academic year ${academicYear}`} on this bus.</p>
                                {route && (
                                    <button type="button" onClick={openAssignModal} className="mt-3 text-blue-600 hover:underline font-semibold text-sm">
                                        Assign from approved requests for this route
                                    </button>
                                )}
                            </div>
                        ) : filteredPassengers.length === 0 ? (
                            <div className="p-12 text-center text-slate-500">
                                <p>No passengers match the selected filters.</p>
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse min-w-[980px]">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2 w-16">Seat No</th>
                                            <th className="px-3 py-2">ID Number</th>
                                            <th className="px-3 py-2">Name</th>
                                            <th className="px-3 py-2">Type</th>
                                            <th className="px-3 py-2">Course</th>
                                            <th className="px-3 py-2">Year</th>
                                            <th className="px-3 py-2">Stage</th>
                                            <th className="px-3 py-2">Fare (₹)</th>
                                            <th className="px-3 py-2 text-center">Admit Card</th>
                                            <th className="px-3 py-2">Status</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredPassengers.map((passenger, index) => (
                                            <tr key={passenger.id} className={`hover:bg-slate-50/80 ${passenger.is_expired ? 'opacity-70' : ''}`}>
                                                <td className="px-3 py-2 text-xs font-semibold text-slate-450">{String(index + 1).padStart(2, '0')}</td>
                                                <td className="px-3 py-2 text-xs font-medium text-slate-700">{passenger.admission_number || passenger.emp_no || '—'}</td>
                                                <td className="px-3 py-2 text-xs font-semibold text-slate-900">{passenger.student_name || passenger.employee_name}</td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${passenger.user_type === 'employee' ? 'bg-slate-50 text-slate-600 border-slate-200' : 'bg-blue-50 text-blue-700 border-blue-100'}`}>
                                                        {passenger.user_type || 'student'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-700">
                                                    {passenger.user_type === 'employee' ? 'Employee' : (
                                                        <>
                                                            {passenger.course || '—'}
                                                            {passenger.branch ? <span className="block text-[10px] text-slate-500">{passenger.branch}</span> : null}
                                                        </>
                                                    )}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-700">
                                                    {passenger.user_type === 'employee' ? '—' : formatYearLabel(passenger.year_of_study)}
                                                </td>
                                                <td className="px-3 py-2 text-xs text-slate-700">{passenger.stage_name || '—'}</td>
                                                <td className="px-3 py-2">
                                                    <FareDisplay passenger={passenger} compact />
                                                </td>
                                                <td className="px-3 py-2 text-center">
                                                    <button
                                                        type="button"
                                                        disabled={fetchingPass}
                                                        onClick={() => handlePrintAdmitCardClick(passenger)}
                                                        className="inline-flex items-center justify-center p-1 rounded-md text-blue-700 bg-blue-50 hover:bg-blue-100 border border-blue-100 transition-all disabled:opacity-50"
                                                        title="Print Admit Card"
                                                    >
                                                        <FileText size={14} />
                                                    </button>
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase border ${passenger.is_expired ? 'bg-red-50 text-red-700 border-red-100' : 'bg-emerald-50 text-emerald-700 border-emerald-100'}`}>
                                                        {passenger.is_expired ? 'Expired' : 'Boarded'}
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

                {activeTab === 'history' && (
                    <div>
                        <div className="px-6 pt-4 border-b border-gray-100 flex flex-wrap gap-2">
                            {[
                                { id: 'inventory', label: 'Inventory History', icon: Package },
                                { id: 'route', label: 'Route History', icon: MapPin },
                                { id: 'staff', label: 'Driver & Cleaner History', icon: UserCheck },
                            ].map(({ id, label, icon: Icon }) => (
                                <button
                                    key={id}
                                    type="button"
                                    onClick={() => setHistorySubTab(id)}
                                    className={`px-4 py-2 rounded-lg text-xs font-bold flex items-center gap-2 transition-all ${historySubTab === id ? 'bg-blue-600 text-white shadow-sm' : 'bg-gray-50 text-gray-600 hover:bg-gray-100'}`}
                                >
                                    <Icon size={14} />
                                    {label}
                                </button>
                            ))}
                        </div>

                        <div className="p-6">
                            {historySubTab === 'inventory' && (
                                inventoryLoading ? (
                                    <div className="py-20 flex justify-center"><Loader text="Loading inventory history..." /></div>
                                ) : inventoryHistory.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-gray-50 border-b border-gray-100 text-[11px] uppercase text-gray-400 font-black tracking-widest">
                                                    <th className="px-6 py-4">Date</th>
                                                    <th className="px-6 py-4">Item</th>
                                                    <th className="px-6 py-4">Quantity</th>
                                                    <th className="px-6 py-4">Remarks</th>
                                                    <th className="px-6 py-4">Allocated By</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {inventoryHistory.map(record => (
                                                    <tr key={record._id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-bold">
                                                            <div className="flex items-center gap-2">
                                                                <Calendar size={14} className="text-gray-400" />
                                                                {new Date(record.allocatedDate).toLocaleDateString()}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <div className="flex items-center gap-2">
                                                                <Package size={14} className="text-blue-400" />
                                                                <span className="font-bold text-gray-800 text-sm">{getInventoryAllocationItemName(record)}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className="font-black text-blue-700">{record.quantity} {record.itemId?.unit || ''}</span>
                                                        </td>
                                                        <td className="px-6 py-4 text-xs text-gray-500 italic">
                                                            {record.remarks || '—'}
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-500 font-medium">
                                                            {record.adminName}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-20 text-center text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                        <History className="mx-auto mb-3 opacity-20" size={48} />
                                        <p className="font-medium text-sm">No items have been allocated to this bus yet.</p>
                                        <Link to="/inventory" className="mt-4 inline-block text-blue-600 font-bold hover:underline">Go to Inventory Management</Link>
                                    </div>
                                )
                            )}

                            {historySubTab === 'route' && (
                                routeHistoryLoading ? (
                                    <div className="py-20 flex justify-center"><Loader text="Loading route history..." /></div>
                                ) : routeHistory.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-gray-50 border-b border-gray-100 text-[11px] uppercase text-gray-400 font-black tracking-widest">
                                                    <th className="px-6 py-4">Action</th>
                                                    <th className="px-6 py-4">Previous Route</th>
                                                    <th className="px-6 py-4">Exit Date</th>
                                                    <th className="px-6 py-4">New Route</th>
                                                    <th className="px-6 py-4">Assigned At</th>
                                                    <th className="px-6 py-4">Changed By</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {routeHistory.map(record => (
                                                    <tr key={record._id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <span className="px-2 py-1 rounded text-[10px] font-bold uppercase bg-blue-50 text-blue-700">
                                                                {record.action}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-600">
                                                            {record.previousRouteName || record.previousRouteId || '—'}
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-700">
                                                            {record.previousRouteExitDate
                                                                ? new Date(record.previousRouteExitDate).toLocaleDateString()
                                                                : '—'}
                                                        </td>
                                                        <td className="px-6 py-4 text-sm font-semibold text-gray-900">
                                                            {record.routeName || record.routeId || '—'}
                                                        </td>
                                                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-800 font-bold">
                                                            <div className="flex items-center gap-2">
                                                                <Calendar size={14} className="text-gray-400" />
                                                                {record.assignedAt
                                                                    ? new Date(record.assignedAt).toLocaleDateString()
                                                                    : '—'}
                                                            </div>
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-500">
                                                            {record.changedBy || '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-20 text-center text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                        <MapPin className="mx-auto mb-3 opacity-20" size={48} />
                                        <p className="font-medium text-sm">No route assignment history yet.</p>
                                        <p className="text-xs mt-1">History is recorded when a route is assigned or changed from Bus Management.</p>
                                    </div>
                                )
                            )}

                            {historySubTab === 'staff' && (
                                staffHistoryLoading ? (
                                    <div className="py-20 flex justify-center"><Loader text="Loading staff history..." /></div>
                                ) : staffHistory.length > 0 ? (
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-left border-collapse">
                                            <thead>
                                                <tr className="bg-gray-50 border-b border-gray-100 text-[11px] uppercase text-gray-400 font-black tracking-widest">
                                                    <th className="px-6 py-4">Role</th>
                                                    <th className="px-6 py-4">Name</th>
                                                    <th className="px-6 py-4">Entry Date</th>
                                                    <th className="px-6 py-4">Exit Date</th>
                                                    <th className="px-6 py-4">Status</th>
                                                    <th className="px-6 py-4">Changed By</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-50">
                                                {staffHistory.map(record => (
                                                    <tr key={record._id} className="hover:bg-gray-50 transition-colors">
                                                        <td className="px-6 py-4">
                                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${record.role === 'driver' ? 'bg-blue-50 text-blue-700' : 'bg-amber-50 text-amber-700'}`}>
                                                                {record.role}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-sm font-bold text-gray-900">{record.staffName}</td>
                                                        <td className="px-6 py-4 text-sm text-gray-700">
                                                            {record.entryDate ? new Date(record.entryDate).toLocaleDateString() : '—'}
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-700">
                                                            {record.exitDate ? new Date(record.exitDate).toLocaleDateString() : '—'}
                                                        </td>
                                                        <td className="px-6 py-4">
                                                            <span className={`text-xs font-bold ${record.isCurrent ? 'text-green-700' : 'text-gray-500'}`}>
                                                                {record.isCurrent ? 'Current' : 'Past'}
                                                            </span>
                                                        </td>
                                                        <td className="px-6 py-4 text-sm text-gray-500">
                                                            {record.changedBy || '—'}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                ) : (
                                    <div className="py-20 text-center text-gray-400 bg-gray-50 rounded-2xl border-2 border-dashed border-gray-100">
                                        <UserCheck className="mx-auto mb-3 opacity-20" size={48} />
                                        <p className="font-medium text-sm">No driver or cleaner history yet.</p>
                                        <p className="text-xs mt-1">History is recorded when staff is changed from Edit Bus Details.</p>
                                    </div>
                                )
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'kilometers' && (
                    <div className="p-5 space-y-6">
                        {/* Filters and Actions */}
                        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 bg-slate-50 p-4 rounded-xl border border-slate-100">
                            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
                                <div>
                                    <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">From Date</label>
                                    <input 
                                        type="date" 
                                        value={kmDateFrom} 
                                        onChange={(e) => setKmDateFrom(e.target.value)}
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                </div>
                                <div>
                                    <label className="block text-[8px] font-bold text-slate-500 uppercase mb-1">To Date</label>
                                    <input 
                                        type="date" 
                                        value={kmDateTo} 
                                        onChange={(e) => setKmDateTo(e.target.value)}
                                        className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-700 font-semibold outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                                    />
                                </div>
                                <div className="pt-4">
                                    <button 
                                        onClick={fetchDailyKm}
                                        disabled={kmLoading}
                                        className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 shadow-sm disabled:opacity-50"
                                    >
                                        <RefreshCw size={12} className={kmLoading ? 'animate-spin' : ''} />
                                        Fetch Data
                                    </button>
                                </div>
                            </div>

                            <button 
                                onClick={handleDownloadKmCsv}
                                disabled={!kmData.length || kmLoading}
                                className="w-full sm:w-auto px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                <Download size={13} />
                                Download Log (CSV)
                            </button>
                        </div>

                        {kmLoading ? (
                            <div className="py-20 flex flex-col justify-center items-center gap-2">
                                <Loader2 size={32} className="animate-spin text-blue-600" />
                                <span className="text-xs font-bold text-slate-500">Querying daily GPS reporting database...</span>
                            </div>
                        ) : kmError ? (
                            <div className="py-16 text-center bg-red-50 rounded-xl border border-red-200 p-6">
                                <AlertTriangle className="text-red-500 mx-auto mb-2" size={32} />
                                <p className="text-xs font-bold text-slate-800 mb-1">Failed to Load Logs</p>
                                <p className="text-[10px] text-red-600">{kmError}</p>
                            </div>
                        ) : kmData.length === 0 ? (
                            <div className="py-20 text-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-200">
                                <Activity className="mx-auto mb-3 opacity-20" size={48} />
                                <p className="font-bold text-sm text-slate-600">No distance records found</p>
                                <p className="text-xs text-slate-400 mt-1">Select a valid date range and verify the vehicle's GPS configuration status.</p>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Summary KPIs */}
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
                                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Total Distance</span>
                                            <span className="text-xl font-black text-slate-900 mt-1 block">
                                                {kmData.reduce((acc, r) => acc + r.kilometers, 0).toFixed(1)} <span className="text-xs font-bold text-slate-500">km</span>
                                            </span>
                                        </div>
                                        <div className="w-10 h-10 rounded-lg bg-blue-50 text-blue-600 flex items-center justify-center font-bold text-lg">
                                            📊
                                        </div>
                                    </div>
                                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between">
                                        <div>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Daily Average</span>
                                            <span className="text-xl font-black text-slate-900 mt-1 block">
                                                {(kmData.reduce((acc, r) => acc + r.kilometers, 0) / kmData.length).toFixed(1)} <span className="text-xs font-bold text-slate-500">km</span>
                                            </span>
                                        </div>
                                        <div className="w-10 h-10 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center font-bold text-lg">
                                            ⚡
                                        </div>
                                    </div>
                                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex items-center justify-between sm:col-span-2 lg:col-span-1">
                                        <div>
                                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Max Run / Day</span>
                                            <span className="text-xl font-black text-slate-900 mt-1 block">
                                                {Math.max(...kmData.map(r => r.kilometers)).toFixed(1)} <span className="text-xs font-bold text-slate-500">km</span>
                                            </span>
                                        </div>
                                        <div className="w-10 h-10 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center font-bold text-lg">
                                            🏆
                                        </div>
                                    </div>
                                </div>

                                {/* Source Warning */}
                                {kmIsMock && (
                                    <div className="bg-amber-50/50 border border-amber-200 rounded-lg p-3 text-amber-800 text-[10px] font-semibold flex items-center gap-2">
                                        <Zap size={14} className="text-amber-500 shrink-0" />
                                        <span>Showing simulated daily logs for testing and demo purposes (no live GPS distance readings exist for this date range).</span>
                                    </div>
                                )}

                                {/* Visual Chart and Table Row */}
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                                    {/* Chart */}
                                    <div className="lg:col-span-5 bg-white border border-slate-200 rounded-xl p-4 shadow-sm flex flex-col justify-between">
                                        <h3 className="text-xs font-bold text-slate-800 mb-4 flex items-center gap-1">
                                            📈 Distance Run Chart (km)
                                        </h3>
                                        
                                        <div className="flex items-end justify-between h-48 border-b border-slate-200 pb-2 pt-4 px-2 bg-slate-50/50 rounded-xl">
                                            {kmData.map((day, idx) => {
                                                const maxVal = Math.max(...kmData.map(r => r.kilometers));
                                                const heightPercent = maxVal > 0 ? (day.kilometers / maxVal) * 100 : 0;
                                                const dateObj = new Date(day.date);
                                                const dayStr = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                                                const dateNum = dateObj.getDate();
                                                return (
                                                    <div key={idx} className="flex flex-col items-center flex-1 group relative mx-0.5">
                                                        <div className="absolute bottom-full mb-2 bg-slate-900 text-white text-[9px] font-bold py-1 px-2 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap z-20 pointer-events-none shadow-md">
                                                            {day.date}: {day.kilometers.toFixed(1)} km
                                                        </div>
                                                        <div 
                                                            style={{ height: `${Math.max(heightPercent, 4)}%` }} 
                                                            className={`w-full max-w-[20px] rounded-t transition-all duration-300 ${day.kilometers > 0 ? 'bg-blue-600 hover:bg-blue-700' : 'bg-slate-200'}`}
                                                        />
                                                        <span className="text-[8px] text-slate-500 font-bold mt-1.5">{dayStr}</span>
                                                        <span className="text-[8px] text-slate-400 font-bold">{dateNum}</span>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                        <div className="text-[9px] text-slate-400 italic text-center mt-3">
                                            Hover over bars to inspect distance readings.
                                        </div>
                                    </div>

                                    {/* Table */}
                                    <div className="lg:col-span-7 bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
                                        <div className="overflow-x-auto">
                                            <table className="w-full text-left border-collapse">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                                                        <th className="px-5 py-3.5">Date</th>
                                                        <th className="px-5 py-3.5">Day</th>
                                                        <th className="px-5 py-3.5">Distance</th>
                                                        <th className="px-5 py-3.5">Status</th>
                                                        <th className="px-5 py-3.5 text-right">Source</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50 text-xs font-semibold text-slate-700">
                                                    {kmData.map((day, idx) => {
                                                        const dateObj = new Date(day.date);
                                                        const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
                                                        const isSunday = dateObj.getDay() === 0;
                                                        return (
                                                            <tr key={idx} className="hover:bg-slate-50/50 transition-colors">
                                                                <td className="px-5 py-3 font-mono">{day.date}</td>
                                                                <td className="px-5 py-3 text-slate-500">{dayName}</td>
                                                                <td className="px-5 py-3 text-slate-900 font-black">{day.kilometers.toFixed(1)} km</td>
                                                                <td className="px-5 py-3">
                                                                    <span className={`px-2 py-0.5 rounded text-[9px] font-bold uppercase ${day.kilometers > 0 ? 'bg-emerald-50 text-emerald-700 border border-emerald-100' : 'bg-slate-100 text-slate-500 border border-slate-100'}`}>
                                                                        {day.kilometers > 0 ? 'Active Run' : isSunday ? 'Sunday Holiday' : 'Stationary'}
                                                                    </span>
                                                                </td>
                                                                <td className="px-5 py-3 text-right">
                                                                    <span className={`text-[10px] font-bold ${day.isMock ? 'text-amber-600' : 'text-blue-600'}`}>
                                                                        {day.isMock ? 'Demo Log' : 'Live GPS'}
                                                                    </span>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>

            <Modal isOpen={assignModalOpen} onClose={() => setAssignModalOpen(false)} title="Assign passengers to this bus">
                {!data?.bus?.assignedRouteId ? (
                    <p className="text-gray-500">Assign this bus to a route first (from Bus Fleet).</p>
                ) : unassignedPassengers.length === 0 ? (
                    <p className="text-gray-500">No unassigned approved passengers for this route.</p>
                ) : (
                    <>
                        <p className="text-sm text-gray-600 mb-4">Select approved passengers for route <strong>{route?.routeName}</strong> to assign to this bus.</p>
                        <div className="max-h-80 overflow-y-auto border border-gray-200 rounded-xl divide-y divide-gray-100">
                            {unassignedPassengers.map((req) => (
                                <label
                                    key={req.id}
                                    className={`flex items-center gap-3 p-3 cursor-pointer hover:bg-gray-50 ${selectedIds.has(req.id) ? 'bg-blue-50' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={selectedIds.has(req.id)}
                                        onChange={() => toggleSelect(req.id)}
                                        className="rounded text-blue-600"
                                    />
                                    <span className="font-medium">{req.student_name}</span>
                                    <span className="text-gray-500 text-sm">{req.admission_number}</span>
                                    <span className="text-gray-400 text-sm">{req.stage_name}</span>
                                </label>
                            ))}
                        </div>
                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                onClick={handleAssignSelected}
                                disabled={assignLoading || selectedIds.size === 0}
                                className="flex-1 py-3 rounded-xl bg-blue-600 text-white font-semibold hover:bg-blue-700 disabled:opacity-50"
                            >
                                {assignLoading ? 'Assigning…' : `Assign ${selectedIds.size} passenger(s)`}
                            </button>
                            <button
                                type="button"
                                onClick={() => setAssignModalOpen(false)}
                                className="px-4 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            {/* Download Modal */}
            <Modal isOpen={reportModalOpen} onClose={() => setReportModalOpen(false)} title="Download Report">
                <div className="space-y-4">
                    <p className="text-sm text-slate-600 font-medium">Choose format to download passenger report:</p>
                    <div className="flex gap-3">
                        <button
                            onClick={() => handlePrint()}
                            disabled={reportLoadingAction !== null}
                            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-3 rounded-lg font-semibold transition-all disabled:opacity-50"
                        >
                            {reportLoadingAction === 'pdf' ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <FileText size={16} />
                            )}
                            {reportLoadingAction === 'pdf' ? 'Generating PDF...' : 'PDF (Print)'}
                        </button>
                        <button
                            onClick={() => handleDownloadExcelReport()}
                            disabled={reportLoadingAction !== null}
                            className="flex-1 flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white px-4 py-3 rounded-lg font-semibold transition-all disabled:opacity-50"
                        >
                            {reportLoadingAction === 'excel' ? (
                                <Loader2 size={16} className="animate-spin" />
                            ) : (
                                <Download size={16} />
                            )}
                            {reportLoadingAction === 'excel' ? 'Generating Excel...' : 'Excel'}
                        </button>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
};

export default BusDetails;
