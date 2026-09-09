import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    FileText,
    Download,
    Printer,
    Search,
    Filter,
    Calendar,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Bus,
    Users,
    UserCheck,
    GraduationCap,
    Briefcase,
    ShieldAlert,
    RefreshCw,
    X,
    MapPin,
    Building2,
    Clock,
    ArrowUpDown,
    Check,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    WifiOff,
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import { idbGetAllPassengers, formatSyncTime } from '../utils/qrVerification';

const findInspectedRecord = (p, fastLookup) => {
    if (!fastLookup || !p) return null;

    const reqId = String(p.requestId || p.id || '').trim().toLowerCase();
    const stdId = String(p.studentId || p.admission_number || p.emp_no || '').trim().toLowerCase();
    const monId = String(p.mongoId || p._id || '').trim().toLowerCase();
    const pinNo = String(p.pinNo || p.pin_no || '').trim().toLowerCase();

    if (reqId && fastLookup.has(reqId)) return fastLookup.get(reqId);
    if (stdId && fastLookup.has(stdId)) return fastLookup.get(stdId);
    if (monId && fastLookup.has(monId)) return fastLookup.get(monId);
    if (pinNo && fastLookup.has(pinNo)) return fastLookup.get(pinNo);

    return null;
};

const changeDateDays = (dateStr, delta) => {
    if (!dateStr) return dateStr;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return dateStr;
    const dt = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    dt.setDate(dt.getDate() + delta);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
};

const InspectionReports = () => {
    const academicYearOptions = getAcademicYearOptions();
    const todayStr = new Date().toISOString().slice(0, 10);

    const [selectedDate, setSelectedDate] = useState(todayStr);
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear());
    const [routes, setRoutes] = useState([]);
    const [buses, setBuses] = useState([]);
    const [allPassengers, setAllPassengers] = useState([]);
    const [inspectionSessions, setInspectionSessions] = useState([]);
    const [loading, setLoading] = useState(false);
    const [expandedInspector, setExpandedInspector] = useState(null);
    const [expandedBusKey, setExpandedBusKey] = useState(null);
    const [mismatchedModalData, setMismatchedModalData] = useState(null);

    // Filter states
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRouteFilter, setSelectedRouteFilter] = useState('all');
    const [selectedTypeFilter, setSelectedTypeFilter] = useState('all'); // 'all' | 'student' | 'employee'
    const [selectedStatusFilter, setSelectedStatusFilter] = useState('all'); // 'all' | 'boarded' | 'override' | 'pending'
    const [selectedStageFilter, setSelectedStageFilter] = useState('all');

    // Inspected map from localStorage for the selected date
    const [inspectedMap, setInspectedMap] = useState({});

    // Network connectivity tracking
    const [online, setOnline] = useState(navigator.onLine);
    useEffect(() => {
        const onOnline = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, []);

    // Load inspection records for the chosen date & academic year
    const loadInspectedData = useCallback(() => {
        try {
            const key = `pydah_inspected_${academicYear}_${selectedDate}`;
            const stored = localStorage.getItem(key);
            setInspectedMap(stored ? JSON.parse(stored) : {});
        } catch {
            setInspectedMap({});
        }
    }, [academicYear, selectedDate]);

    // Load all passengers & routes
    const loadReportData = useCallback(async () => {
        setLoading(true);
        try {
            loadInspectedData();
            const cached = await idbGetAllPassengers();
            setAllPassengers(cached || []);

            if (isAuthenticated()) {
                try {
                    const [routesRes, busesRes, sessionsRes] = await Promise.all([
                        apiFetch(`${API_BASE}/routes?academicYear=${encodeURIComponent(academicYear)}`).catch(() => null),
                        apiFetch(`${API_BASE}/buses`).catch(() => null),
                        apiFetch(`${API_BASE}/inspection-sessions?date=${selectedDate}&academicYear=${encodeURIComponent(academicYear)}`).catch(() => null),
                    ]);

                    if (routesRes && routesRes.ok) {
                        const rData = await routesRes.json().catch(() => []);
                        setRoutes(Array.isArray(rData) ? rData : []);
                    }
                    if (busesRes && busesRes.ok) {
                        const bData = await busesRes.json().catch(() => []);
                        setBuses(Array.isArray(bData) ? bData : []);
                    }
                    if (sessionsRes && sessionsRes.ok) {
                        const sessionData = await sessionsRes.json().catch(() => []);
                        setInspectionSessions(Array.isArray(sessionData) ? sessionData : []);
                        setInspectedMap((prev) => {
                            const merged = { ...prev };
                            if (Array.isArray(sessionData)) {
                                sessionData.forEach((s) => {
                                    if (s.scannedPassengers && typeof s.scannedPassengers === 'object') {
                                        Object.assign(merged, s.scannedPassengers);
                                    }
                                });
                            }
                            return merged;
                        });
                    }
                } catch {
                    // ignore
                }
            }
        } finally {
            setLoading(false);
        }
    }, [academicYear, loadInspectedData, selectedDate]);

    // Fast O(1) Inspected Records Lookup Map
    const fastInspectedLookup = useMemo(() => {
        const map = new Map();
        if (!inspectedMap || typeof inspectedMap !== 'object') return map;

        Object.entries(inspectedMap).forEach(([k, rec]) => {
            if (!rec || typeof rec !== 'object') return;
            const normKey = String(k || '').trim().toLowerCase();
            if (normKey) map.set(normKey, rec);

            const reqId = String(rec.requestId || '').trim().toLowerCase();
            const stdId = String(rec.studentId || '').trim().toLowerCase();
            const pinNo = String(rec.pinNo || '').trim().toLowerCase();
            if (reqId) map.set(reqId, rec);
            if (stdId) map.set(stdId, rec);
            if (pinNo) map.set(pinNo, rec);
        });

        return map;
    }, [inspectedMap]);

    // Master list of all passengers with their inspection status
    const allPassengerReports = useMemo(() => {
        return allPassengers.map((p) => {
            const pKey = String(p.requestId || p.studentId || p.mongoId);
            const inspectedRecord = findInspectedRecord(p, fastInspectedLookup);
            const isBoarded = Boolean(inspectedRecord);
            const isOverride = Boolean(inspectedRecord?.wrongRouteOverride);

            return {
                key: pKey,
                raw: p,
                studentName: p.studentName || p.student_name || p.employee_name || 'Passenger',
                studentId: p.studentId || p.admission_number || p.emp_no || '—',
                pinNo: p.pinNo || p.pin_no || null,
                userType: p.userType || p.user_type || 'student',
                routeId: p.routeId || p.route_id || 'Unassigned',
                routeName: p.routeName || p.route_name || '',
                busId: p.busId || p.bus_id || 'Unassigned',
                stageName: p.stageName || p.stage_name || '—',
                photo: normalizeStudentPhoto(p.studentPhoto || p.student_photo),
                isBoarded,
                isOverride,
                inspectedAt: inspectedRecord?.inspectedAt || null,
                method: inspectedRecord?.method || null,
            };
        });
    }, [allPassengers, fastInspectedLookup]);

    // Fast O(1) Passenger Lookup Map
    const passengerLookupMap = useMemo(() => {
        const map = new Map();
        allPassengerReports.forEach((p) => {
            if (p.key) map.set(p.key.toLowerCase(), p);
            if (p.studentId && p.studentId !== '—') map.set(p.studentId.toLowerCase(), p);
        });
        return map;
    }, [allPassengerReports]);

    const inspectorSummary = useMemo(() => {
        const summary = new Map();

        inspectionSessions.forEach((session) => {
            const key = session.inspectorName || session.inspectorUsername || 'Unknown user';
            const current = summary.get(key) || {
                inspectorName: key,
                inspectionCount: 0,
                inspectedCount: 0,
                latestStartedAt: null,
                buses: new Map(),
            };
            current.inspectionCount += 1;
            current.inspectedCount += Number(session.inspectedCount) || 0;

            const busKey = `${session.routeId || '—'}::${session.busNumber || '—'}`;
            const bus = current.buses.get(busKey) || {
                routeId: session.routeId || '—',
                routeName: session.routeName || '',
                busNumber: session.busNumber || '—',
                occupied: 0,
                scanned: 0,
                sessions: 0,
                mismatchedPassengers: [],
            };
            bus.occupied += Number(session.totalCount) || 0;
            bus.scanned += Number(session.inspectedCount) || 0;
            bus.sessions += 1;
            if (!bus.routeName && session.routeName) bus.routeName = session.routeName;

            // Extract mismatched/override scans directly from session.scannedPassengers
            if (session.scannedPassengers && typeof session.scannedPassengers === 'object') {
                Object.entries(session.scannedPassengers).forEach(([pKey, rec]) => {
                    if (rec && (rec.wrongRouteOverride || rec.isOverride || rec.wrong_route_override)) {
                        const sKey = pKey.toLowerCase();
                        const sStd = String(rec.studentId || '').toLowerCase();
                        const sReq = String(rec.requestId || '').toLowerCase();

                        const existingP = passengerLookupMap.get(sKey) || passengerLookupMap.get(sStd) || passengerLookupMap.get(sReq);

                        const passengerObj = existingP || {
                            key: pKey,
                            studentName: rec.studentName || rec.student_name || 'Passenger',
                            studentId: rec.studentId || rec.admission_number || rec.emp_no || '—',
                            pinNo: rec.pinNo || rec.pin_no || null,
                            userType: rec.userType || rec.user_type || 'student',
                            routeId: rec.originalRouteId || rec.routeId || 'Unassigned',
                            routeName: rec.originalRouteName || rec.routeName || '',
                            busId: rec.originalBusId || rec.busId || 'Unassigned',
                            stageName: rec.stageName || rec.stage_name || '—',
                            photo: normalizeStudentPhoto(rec.studentPhoto || rec.student_photo),
                            isBoarded: true,
                            isOverride: true,
                            inspectedAt: rec.inspectedAt || null,
                            method: rec.method || 'QR_SCAN',
                        };

                        if (!bus.mismatchedPassengers.some((m) => m.key === passengerObj.key)) {
                            bus.mismatchedPassengers.push(passengerObj);
                        }
                    }
                });
            }

            current.buses.set(busKey, bus);
            if (!current.latestStartedAt || new Date(session.startedAt) > new Date(current.latestStartedAt)) {
                current.latestStartedAt = session.startedAt;
            }
            summary.set(key, current);
        });

        // Fast lookup map for buses in summary
        if (allPassengerReports && allPassengerReports.length > 0) {
            const busLookup = new Map();
            summary.forEach((inspector) => {
                inspector.buses.forEach((bus) => {
                    const bNo = String(bus.busNumber || '').trim().toLowerCase();
                    const bRId = String(bus.routeId || '').trim().toLowerCase();
                    if (bNo) busLookup.set(bNo, bus);
                    if (bRId) busLookup.set(`route_${bRId}`, bus);
                });
            });

            allPassengerReports.forEach((p) => {
                if (p.isOverride) {
                    const rec = findInspectedRecord(p.raw || p, fastInspectedLookup);
                    const sBusId = String(rec?.scannedBusId || p.busId || '').trim().toLowerCase();
                    const sRouteId = String(rec?.scannedRouteId || p.routeId || '').trim().toLowerCase();

                    const matchedBus = busLookup.get(sBusId) || busLookup.get(`route_${sRouteId}`);
                    if (matchedBus && !matchedBus.mismatchedPassengers.some((m) => m.key === p.key)) {
                        matchedBus.mismatchedPassengers.push(p);
                    }
                }
            });
        }

        return Array.from(summary.values())
            .map((row) => {
                const busesList = Array.from(row.buses.values()).map((bus) => ({
                    ...bus,
                    notScanned: Math.max(0, bus.occupied - bus.scanned),
                    mismatchedCount: bus.mismatchedPassengers.length,
                }));
                const overallOccupied = busesList.reduce((acc, b) => acc + b.occupied, 0);
                const overallScanned = busesList.reduce((acc, b) => acc + b.scanned, 0);
                const overallNotScanned = Math.max(0, overallOccupied - overallScanned);
                const overallMismatched = busesList.reduce((acc, b) => acc + b.mismatchedCount, 0);

                return {
                    ...row,
                    buses: busesList,
                    overallOccupied,
                    overallScanned,
                    overallNotScanned,
                    overallMismatched,
                };
            })
            .sort((a, b) => b.inspectionCount - a.inspectionCount);
    }, [inspectionSessions, allPassengerReports, fastInspectedLookup, passengerLookupMap]);

    useEffect(() => {
        loadReportData();
    }, [loadReportData]);

    useEffect(() => {
        loadInspectedData();
    }, [selectedDate, academicYear, loadInspectedData]);

    // Build Master Routes with Assigned Buses
    const routesWithMetrics = useMemo(() => {
        const routeMap = new Map();

        routes.forEach((r) => {
            const rId = String(r.routeId || r._id || '').trim();
            if (!rId) return;
            routeMap.set(rId.toLowerCase(), {
                routeId: rId,
                routeName: r.routeName || r.name || `Route ${rId}`,
                assignedBuses: [],
                passengers: [],
            });
        });

        buses.forEach((b) => {
            if (b.status && b.status !== 'Active') return;
            const assignedRId = String(b.assignedRouteId || '').trim();
            if (assignedRId) {
                const existing = routeMap.get(assignedRId.toLowerCase());
                if (existing && b.busNumber && !existing.assignedBuses.includes(b.busNumber)) {
                    existing.assignedBuses.push(b.busNumber);
                }
            }
        });

        allPassengers.forEach((p) => {
            const pRouteId = String(p.routeId || p.route_id || '').trim();
            const pRouteName = String(p.routeName || p.route_name || '').trim();
            const pBusId = String(p.busId || p.bus_id || '').trim();

            let target = routeMap.get(pRouteId.toLowerCase());
            if (!target && pRouteName) {
                for (const r of routeMap.values()) {
                    if (r.routeName.toLowerCase() === pRouteName.toLowerCase()) {
                        target = r;
                        break;
                    }
                }
            }
            if (!target && pRouteId) {
                target = {
                    routeId: pRouteId,
                    routeName: pRouteName || `Route ${pRouteId}`,
                    assignedBuses: [],
                    passengers: [],
                };
                routeMap.set(pRouteId.toLowerCase(), target);
            }
            if (target) {
                target.passengers.push(p);
                // Only fallback to passenger busId if buses master collection is empty
                if (buses.length === 0 && pBusId && !target.assignedBuses.includes(pBusId)) {
                    target.assignedBuses.push(pBusId);
                }
            }
        });

        return Array.from(routeMap.values()).map((r) => {
            const students = r.passengers.filter((p) => (p.userType || p.user_type || 'student') === 'student');
            const faculty = r.passengers.filter((p) => (p.userType || p.user_type) === 'employee');
            const total = r.passengers.length;

            let boarded = 0;
            let overrides = 0;

            r.passengers.forEach((p) => {
                const rec = findInspectedRecord(p, fastInspectedLookup);
                if (rec) {
                    boarded += 1;
                    if (rec.wrongRouteOverride) overrides += 1;
                }
            });

            return {
                ...r,
                studentsCount: students.length,
                facultyCount: faculty.length,
                totalCount: total,
                boardedCount: boarded,
                overridesCount: overrides,
                percent: total > 0 ? Math.round((boarded / total) * 100) : 0,
            };
        });
    }, [routes, buses, allPassengers, fastInspectedLookup]);

    // KPIs / Metrics summary
    const metrics = useMemo(() => {
        const totalFromReports = allPassengerReports.length;
        const boardedFromReports = allPassengerReports.filter((p) => p.isBoarded).length;
        const overridesFromReports = allPassengerReports.filter((p) => p.isOverride).length;

        const totalFromSessions = inspectionSessions.reduce((acc, s) => acc + (Number(s.totalCount) || 0), 0);
        const boardedFromSessions = inspectionSessions.reduce((acc, s) => acc + (Number(s.inspectedCount) || 0), 0);
        const scannedMapCount = Object.keys(inspectedMap || {}).length;

        const total = totalFromReports || totalFromSessions || 0;
        const boarded = Math.max(boardedFromReports, scannedMapCount, boardedFromSessions);
        const overrides = Math.max(overridesFromReports, Object.values(inspectedMap || {}).filter((r) => r?.wrongRouteOverride).length);
        const students = allPassengerReports.filter((p) => p.userType === 'student').length;
        const faculty = allPassengerReports.filter((p) => p.userType === 'employee').length;
        const pending = Math.max(0, total - boarded);

        return {
            total,
            students,
            faculty,
            boarded,
            overrides,
            pending,
            rate: total > 0 ? Math.round((boarded / total) * 100) : 0,
        };
    }, [allPassengerReports, inspectionSessions, inspectedMap]);

    // Filtered report records for table
    const filteredReportList = useMemo(() => {
        return allPassengerReports.filter((p) => {
            // 1. Search Query
            if (searchQuery.trim()) {
                const q = searchQuery.toLowerCase().trim();
                const match = p.studentName.toLowerCase().includes(q)
                    || p.studentId.toLowerCase().includes(q)
                    || (p.pinNo && p.pinNo.toLowerCase().includes(q))
                    || String(p.routeId).toLowerCase().includes(q)
                    || p.routeName.toLowerCase().includes(q)
                    || p.busId.toLowerCase().includes(q)
                    || p.stageName.toLowerCase().includes(q);
                if (!match) return false;
            }

            // 2. Route Filter
            if (selectedRouteFilter !== 'all') {
                const rNorm = String(p.routeId).trim().toLowerCase();
                if (rNorm !== selectedRouteFilter.toLowerCase()) return false;
            }

            // 3. User Type Filter
            if (selectedTypeFilter !== 'all') {
                if (p.userType !== selectedTypeFilter) return false;
            }

            // 4. Status Filter
            if (selectedStatusFilter === 'boarded') {
                if (!p.isBoarded) return false;
            } else if (selectedStatusFilter === 'override') {
                if (!p.isOverride) return false;
            } else if (selectedStatusFilter === 'pending') {
                if (p.isBoarded) return false;
            }

            // 5. Stage Filter
            if (selectedStageFilter !== 'all') {
                if (p.stageName.toLowerCase() !== selectedStageFilter.toLowerCase()) return false;
            }

            return true;
        });
    }, [allPassengerReports, searchQuery, selectedRouteFilter, selectedTypeFilter, selectedStatusFilter, selectedStageFilter]);

    // Unique stages for filter
    const uniqueStages = useMemo(() => {
        const s = new Set();
        allPassengers.forEach((p) => {
            const st = String(p.stageName || p.stage_name || '').trim();
            if (st) s.add(st);
        });
        return Array.from(s).sort();
    }, [allPassengers]);

    // Export CSV of Inspector Summary in pure tabular format
    const exportCsv = () => {
        const headers = [
            'S.No',
            'Inspector Name',
            'Route ID',
            'Bus Number',
            'Route Name',
            'Occupied Passengers',
            'Scanned Passengers',
            'Not Scanned Passengers',
            'Mismatched Scans',
            'Inspection Status',
            'Inspection Date',
            'Academic Year',
        ];

        const statusStr = (selectedDate < todayStr || (selectedDate === todayStr && new Date().getHours() >= 19))
            ? 'Submitted'
            : 'In Progress';

        let index = 1;
        const rows = [];

        inspectorSummary.forEach((inspector) => {
            inspector.buses.forEach((bus) => {
                rows.push([
                    index++,
                    `"${inspector.inspectorName.replace(/"/g, '""')}"`,
                    `"${bus.routeId}"`,
                    `"${bus.busNumber}"`,
                    `"${(bus.routeName || '').replace(/"/g, '""')}"`,
                    bus.occupied,
                    bus.scanned,
                    bus.notScanned,
                    bus.mismatchedCount,
                    statusStr,
                    selectedDate,
                    academicYear,
                ]);
            });
        });

        // Add Overall Totals summary row
        const totalOccupied = inspectorSummary.reduce((acc, r) => acc + r.overallOccupied, 0);
        const totalScanned = inspectorSummary.reduce((acc, r) => acc + r.overallScanned, 0);
        const totalNotScanned = inspectorSummary.reduce((acc, r) => acc + r.overallNotScanned, 0);
        const totalMismatched = inspectorSummary.reduce((acc, r) => acc + r.overallMismatched, 0);

        rows.push([
            '""',
            '"OVERALL TOTALS"',
            '""',
            '""',
            '""',
            totalOccupied,
            totalScanned,
            totalNotScanned,
            totalMismatched,
            statusStr,
            selectedDate,
            academicYear,
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `inspector_transport_report_${selectedDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Print report
    const printReport = () => {
        window.print();
    };

    return (
        <Layout title="Inspection Reports">
            <div className="space-y-4 max-w-7xl mx-auto pb-12 print:p-0 print:space-y-3">
                {/* Dedicated Printable PDF Report Container (Only visible during print) */}
                <div className="hidden print:block space-y-4 font-sans text-slate-800 text-[10px]">
                    {/* Header */}
                    <div className="border-b border-slate-300 pb-2.5 text-center">
                        <h1 className="text-lg font-black uppercase tracking-wider text-slate-900">PYDAH GROUP OF INSTITUTIONS</h1>
                        <h2 className="mt-0.5 text-xs font-extrabold uppercase tracking-wide text-slate-700">INSPECTOR-WISE TRANSPORT ROUTE INSPECTION REPORT</h2>
                        <div className="flex justify-between items-center text-[10px] font-semibold text-slate-600 mt-1.5 px-1">
                            <span>Inspection Date: <strong>{selectedDate}</strong></span>
                            <span>Academic Year: <strong>{academicYear}</strong></span>
                            <span>Status: <strong>{selectedDate < todayStr || (selectedDate === todayStr && new Date().getHours() >= 19) ? 'Submitted' : 'In Progress'}</strong></span>
                        </div>
                    </div>

                    {/* Section 1: OVERALL INSPECTION SUMMARY */}
                    <div className="space-y-1">
                        <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-800 border-b border-slate-300 pb-1">
                            1. Overall Inspection Summary
                        </h3>
                        <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
                            <table className="w-full text-center text-[10px] border-collapse">
                                <thead>
                                    <tr className="bg-slate-100/80 border-b border-slate-200 text-[9px] font-bold text-slate-700 uppercase tracking-wider">
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Expected Students</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Boarded / Inspected</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Yet to Board</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Route Overrides</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Mismatched Students</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Total Inspectors</th>
                                        <th className="py-1.5 px-2">Total Buses Inspected</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr className="font-bold text-slate-800">
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold">{metrics.total}</td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold text-emerald-800">{metrics.boarded} ({metrics.rate}%)</td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold text-rose-800">{metrics.pending}</td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold text-amber-800">{metrics.overrides}</td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold text-amber-800">
                                            {inspectorSummary.reduce((acc, r) => acc + r.overallMismatched, 0)}
                                        </td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 font-extrabold">{inspectorSummary.length}</td>
                                        <td className="py-1.5 px-2 font-extrabold">
                                            {inspectorSummary.reduce((acc, r) => acc + r.buses.length, 0)}
                                        </td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Section 2: INSPECTOR-WISE INSPECTION REPORT */}
                    <div className="space-y-3 pt-1">
                        <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-800 border-b border-slate-300 pb-1">
                            2. Inspector-wise Inspection Report
                        </h3>

                        {inspectorSummary.length === 0 ? (
                            <div className="p-3 text-center text-slate-400 font-bold border border-slate-200 rounded-md text-[10px]">
                                No inspector records found for this date.
                            </div>
                        ) : (
                            inspectorSummary.map((row, inspectorIdx) => (
                                <div key={row.inspectorName} className="space-y-1.5 border border-slate-200 p-2.5 rounded-md bg-slate-50/40 page-break-inside-avoid">
                                    {/* Inspector Summary Header Table */}
                                    <div>
                                        <h4 className="text-[10px] font-black uppercase tracking-wider text-blue-800 mb-1">
                                            Inspector #{inspectorIdx + 1}: {row.inspectorName}
                                        </h4>
                                        <table className="w-full text-center text-[10px] border-collapse border border-slate-200 bg-white">
                                            <thead>
                                                <tr className="bg-slate-100/80 border-b border-slate-200 text-[9px] font-bold text-slate-700 uppercase">
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Inspector Name</th>
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Number of Buses Inspected</th>
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Total Occupied</th>
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Total Scanned</th>
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Total Not Scanned</th>
                                                    <th className="py-1.5 px-2 border-r border-slate-200">Total Mismatched</th>
                                                    <th className="py-1.5 px-2">Total Route Overrides</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr className="font-bold text-slate-800">
                                                    <td className="py-1.5 px-2 border-r border-slate-200 text-left font-extrabold">{row.inspectorName}</td>
                                                    <td className="py-1.5 px-2 border-r border-slate-200">
                                                        {row.buses.length} Bus{row.buses.length !== 1 ? 'es' : ''} ({row.buses.map((b) => b.busNumber).join(', ')})
                                                    </td>
                                                    <td className="py-1.5 px-2 border-r border-slate-200">{row.overallOccupied}</td>
                                                    <td className="py-1.5 px-2 border-r border-slate-200 text-emerald-800">{row.overallScanned}</td>
                                                    <td className="py-1.5 px-2 border-r border-slate-200 text-rose-800">{row.overallNotScanned}</td>
                                                    <td className="py-1.5 px-2 border-r border-slate-200 text-amber-800">{row.overallMismatched}</td>
                                                    <td className="py-1.5 px-2 text-amber-800">{row.overallMismatched}</td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* Section 3: BUS / ROUTE-WISE DETAILS */}
                    <div className="space-y-1.5 pt-2 page-break-inside-avoid">
                        <h3 className="text-[11px] font-black uppercase tracking-wider text-slate-800 border-b border-slate-300 pb-1">
                            3. Bus / Route-wise Details
                        </h3>
                        <div className="border border-slate-200 rounded-md overflow-hidden bg-white">
                            <table className="w-full text-left text-[10px] border-collapse">
                                <thead>
                                    <tr className="bg-slate-100/80 border-b border-slate-200 text-[9px] font-bold text-slate-700 uppercase tracking-wider">
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-8">S.No</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Inspector Name</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-14">Route ID</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-24">Bus Number</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200">Route Name</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-14">Occupied</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-14">Scanned</th>
                                        <th className="py-1.5 px-2 border-r border-slate-200 text-center w-16">Not Scanned</th>
                                        <th className="py-1.5 px-2 text-center w-20">Mismatched</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {inspectorSummary.length === 0 ? (
                                        <tr>
                                            <td colSpan={9} className="py-3 text-center text-slate-400 font-bold border border-slate-200 text-[10px]">
                                                No inspection sessions recorded for this date.
                                            </td>
                                        </tr>
                                    ) : (
                                        (() => {
                                            let sno = 1;
                                            const rows = [];
                                            inspectorSummary.forEach((inspector) => {
                                                inspector.buses.forEach((bus) => {
                                                    const hasMismatched = bus.mismatchedPassengers && bus.mismatchedPassengers.length > 0;
                                                    rows.push(
                                                        <React.Fragment key={`${inspector.inspectorName}-${bus.routeId}-${bus.busNumber}`}>
                                                            <tr className="page-break-inside-avoid hover:bg-slate-50/50">
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-bold">{sno++}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 font-bold text-slate-900">{inspector.inspectorName}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-bold text-blue-800">Route {bus.routeId}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-extrabold">{bus.busNumber}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-slate-600">{bus.routeName || '—'}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-bold">{bus.occupied}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-bold text-emerald-800">{bus.scanned}</td>
                                                                <td className="py-1.5 px-2 border-r border-slate-200 text-center font-bold text-rose-800">{bus.notScanned}</td>
                                                                <td className="py-1.5 px-2 text-center font-bold text-amber-800">{bus.mismatchedCount}</td>
                                                            </tr>

                                                            {/* Mismatched / Route Override sub-rows for Bus */}
                                                            {hasMismatched && (
                                                                <>
                                                                    <tr className="bg-amber-50/70 border-y border-amber-200 text-[8.5px] font-extrabold text-amber-900 uppercase page-break-inside-avoid">
                                                                        <td colSpan={9} className="py-1 px-3">
                                                                            Mismatched / Route Override Details — Bus {bus.busNumber} (Route {bus.routeId}) ({bus.mismatchedPassengers.length})
                                                                        </td>
                                                                    </tr>
                                                                    <tr className="bg-amber-100/50 text-[8px] font-bold text-amber-950 uppercase border-b border-amber-200 page-break-inside-avoid">
                                                                        <th className="py-1 px-1.5 border-r border-amber-200 text-center w-7">#</th>
                                                                        <th className="py-1 px-1.5 border-r border-amber-200" colSpan={2}>Student / Faculty Name & ADM ID</th>
                                                                        <th className="py-1 px-1.5 border-r border-amber-200 text-center">Assigned Route & Bus</th>
                                                                        <th className="py-1 px-1.5 border-r border-amber-200 text-center">Boarded Route & Bus</th>
                                                                        <th className="py-1 px-1.5 border-r border-amber-200" colSpan={2}>Stage</th>
                                                                        <th className="py-1 px-1.5 border-r border-amber-200 text-center">Scan Time</th>
                                                                        <th className="py-1 px-1.5 text-center">Mismatch Type</th>
                                                                    </tr>
                                                                    {bus.mismatchedPassengers.map((p, mIdx) => (
                                                                        <tr key={p.key || mIdx} className="bg-amber-50/20 text-[9px] border-b border-amber-100 page-break-inside-avoid">
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 text-center font-bold text-slate-700">{mIdx + 1}</td>
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 font-bold text-slate-900" colSpan={2}>
                                                                                {p.studentName}
                                                                                <span className="ml-1 text-[7px] font-extrabold uppercase px-1 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-200">
                                                                                    {p.userType === 'student' ? 'Student' : 'Faculty'}
                                                                                </span>
                                                                                <span className="ml-1 text-[8px] font-mono text-slate-600">({p.studentId}{p.pinNo ? ` · PIN: ${p.pinNo}` : ''})</span>
                                                                            </td>
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 text-center font-medium text-slate-600">Route {p.routeId} / Bus {p.busId}</td>
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 text-center font-extrabold text-amber-800">Route {bus.routeId} / Bus {bus.busNumber}</td>
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 text-slate-600" colSpan={2}>{p.stageName || '—'}</td>
                                                                            <td className="py-1 px-1.5 border-r border-amber-200 text-center font-medium tabular-nums text-slate-700">
                                                                                {p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                                            </td>
                                                                            <td className="py-1 px-1.5 text-center font-bold text-amber-800">
                                                                                {p.routeId === 'Unassigned' || p.busId === 'Unassigned' ? 'Unassigned Boarding' : 'Route Override'}
                                                                            </td>
                                                                        </tr>
                                                                    ))}
                                                                </>
                                                            )}
                                                        </React.Fragment>
                                                    );
                                                });
                                            });
                                            return rows;
                                        })()
                                    )}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100/90 border-t border-slate-300 font-extrabold text-[9px] text-slate-800">
                                        <td colSpan={5} className="py-1.5 px-2 border-r border-slate-200 text-right uppercase tracking-wider">
                                            OVERALL TOTALS
                                        </td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 text-center">
                                            {inspectorSummary.reduce((acc, r) => acc + r.overallOccupied, 0)}
                                        </td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 text-center text-emerald-800">
                                            {inspectorSummary.reduce((acc, r) => acc + r.overallScanned, 0)}
                                        </td>
                                        <td className="py-1.5 px-2 border-r border-slate-200 text-center text-rose-800">
                                            {inspectorSummary.reduce((acc, r) => acc + r.overallNotScanned, 0)}
                                        </td>
                                        <td className="py-1.5 px-2 text-center text-amber-800">
                                            {inspectorSummary.reduce((acc, r) => acc + r.overallMismatched, 0)}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                    {/* Section 4: SIGNATURES */}
                    <div className="pt-6 flex justify-between items-end text-[10px] font-bold text-slate-800 page-break-inside-avoid">
                        <div className="text-center border-t border-slate-400 pt-1.5 w-44">
                            Transport In-Charge Signature
                        </div>
                        <div className="text-center border-t border-slate-400 pt-1.5 w-44">
                            Principal / Director Signature
                        </div>
                    </div>
                </div>

                {/* Header Card */}
                <div className="print:hidden bg-white rounded-2xl p-3.5 sm:p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                    {/* Row 1 on Mobile / Left Side on Desktop */}
                    <div className="flex flex-wrap items-center justify-between md:justify-start gap-2 sm:gap-3 w-full md:w-auto">
                        {/* Icon (Hidden on Mobile, Visible on Desktop) */}
                        <div className="hidden md:flex w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 text-white items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
                            <FileText size={22} />
                        </div>

                        <div className="flex items-center gap-2">
                            <h1 className="hidden md:block text-base sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
                                Transport Inspection Reports
                            </h1>
                            <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase shrink-0 flex items-center gap-1.5 ${
                                selectedDate < new Date().toLocaleDateString('en-CA') || (selectedDate === new Date().toLocaleDateString('en-CA') && new Date().getHours() >= 19)
                                    ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                    : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}>
                                {loading && <RefreshCw size={10} className="animate-spin text-current" />}
                                {selectedDate < new Date().toLocaleDateString('en-CA') || (selectedDate === new Date().toLocaleDateString('en-CA') && new Date().getHours() >= 19)
                                    ? 'Submitted'
                                    : 'In Progress'}
                            </span>
                            {!online && (
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase bg-rose-100 text-rose-700 border border-rose-300 shrink-0 animate-pulse">
                                    <WifiOff size={9} />
                                    Offline
                                </span>
                            )}
                        </div>

                        {/* On Mobile: Inline Date Picker & Academic Year in Row 1 */}
                        <div className="flex md:hidden items-center gap-1.5 shrink-0">
                            {/* Date Picker */}
                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                                <button
                                    type="button"
                                    onClick={() => setSelectedDate(changeDateDays(selectedDate, -1))}
                                    className="px-1.5 py-1 text-slate-500 hover:text-blue-700 active:scale-95 transition-all cursor-pointer border-r border-slate-200 shrink-0"
                                    title="Previous Day"
                                >
                                    <ChevronLeft size={13} />
                                </button>
                                <input
                                    type="date"
                                    value={selectedDate}
                                    onChange={(e) => setSelectedDate(e.target.value)}
                                    className="text-[10px] font-bold text-slate-800 bg-transparent outline-none cursor-pointer text-center w-[92px]"
                                />
                                <button
                                    type="button"
                                    onClick={() => setSelectedDate(changeDateDays(selectedDate, 1))}
                                    className="px-1.5 py-1 text-slate-500 hover:text-blue-700 active:scale-95 transition-all cursor-pointer border-l border-slate-200 shrink-0"
                                    title="Next Day"
                                >
                                    <ChevronRight size={13} />
                                </button>
                            </div>

                            {/* Academic Year */}
                            <select
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                className="px-1.5 py-1 text-[10px] font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Controls Block (Row 2 on Mobile, Desktop Controls) */}
                    <div className="flex items-center gap-2 w-full md:w-auto">
                        {/* Desktop-only Date & Academic Year */}
                        <div className="hidden md:flex items-center gap-2">
                            <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl overflow-hidden shadow-xs">
                                <button
                                    type="button"
                                    onClick={() => setSelectedDate(changeDateDays(selectedDate, -1))}
                                    className="px-2 py-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-200/60 active:scale-95 transition-all cursor-pointer border-r border-slate-200 shrink-0"
                                    title="Previous Day"
                                >
                                    <ChevronLeft size={15} />
                                </button>
                                <div className="flex items-center gap-1.5 px-2 py-1.5 min-w-0 flex-1 justify-center">
                                    <Calendar size={13} className="text-slate-500 shrink-0" />
                                    <input
                                        type="date"
                                        value={selectedDate}
                                        onChange={(e) => setSelectedDate(e.target.value)}
                                        className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer text-center w-full min-w-0"
                                    />
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setSelectedDate(changeDateDays(selectedDate, 1))}
                                    className="px-2 py-1.5 text-slate-500 hover:text-blue-700 hover:bg-slate-200/60 active:scale-95 transition-all cursor-pointer border-l border-slate-200 shrink-0"
                                    title="Next Day"
                                >
                                    <ChevronRight size={15} />
                                </button>
                            </div>

                            <select
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                className="px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>

                        {/* Action Buttons: Export & Print (Full Width Row 2 on Mobile) */}
                        <div className="grid grid-cols-2 md:flex items-center gap-2 w-full md:w-auto">
                            <button
                                type="button"
                                onClick={exportCsv}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer col-span-1"
                                title="Export to CSV"
                            >
                                <Download size={13} />
                                <span>Export CSV</span>
                            </button>

                            <button
                                type="button"
                                onClick={printReport}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm shadow-blue-600/20 col-span-1"
                                title="Print Report"
                            >
                                <Printer size={13} />
                                <span>Print</span>
                            </button>
                        </div>
                    </div>
                </div>

                {/* KPI Metrics Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 print:hidden">
                    {loading ? (
                        Array.from({ length: 4 }).map((_, idx) => (
                            <div key={idx} className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs animate-pulse space-y-2.5">
                                <div className="flex items-center justify-between">
                                    <div className="h-2.5 bg-slate-200 rounded-md w-20"></div>
                                    <div className="w-4 h-4 bg-slate-200 rounded-full"></div>
                                </div>
                                <div className="h-7 bg-slate-200 rounded-md w-16"></div>
                                <div className="h-2.5 bg-slate-200 rounded-md w-28"></div>
                            </div>
                        ))
                    ) : (
                        <>
                            <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs print:border-slate-300">
                                <div className="flex items-center justify-between text-slate-400">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Total Expected</span>
                                    <Users size={15} className="text-blue-600 shrink-0 print:hidden" />
                                </div>
                                <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{metrics.total}</p>
                                <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                                    {metrics.students} Students • {metrics.faculty} Faculty
                                </p>
                            </div>

                            <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs print:border-slate-300">
                                <div className="flex items-center justify-between text-slate-400">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Boarded / Inspected</span>
                                    <CheckCircle2 size={15} className="text-emerald-600 shrink-0 print:hidden" />
                                </div>
                                <div className="flex items-baseline gap-1 mt-1">
                                    <p className="text-xl sm:text-2xl font-black text-emerald-700">{metrics.boarded}</p>
                                    <span className="text-[11px] sm:text-xs font-bold text-slate-500">({metrics.rate}%)</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden print:hidden">
                                    <div className="h-full bg-emerald-500 rounded-full transition-all duration-500" style={{ width: `${metrics.rate}%` }} />
                                </div>
                            </div>

                            <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs print:border-slate-300">
                                <div className="flex items-center justify-between text-slate-400">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Yet to Board</span>
                                    <Clock size={15} className="text-rose-600 shrink-0 print:hidden" />
                                </div>
                                <p className="text-xl sm:text-2xl font-black text-rose-700 mt-1">{metrics.pending}</p>
                                <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                                    {metrics.total > 0 ? 100 - metrics.rate : 0}% remaining
                                </p>
                            </div>

                            <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs print:border-slate-300">
                                <div className="flex items-center justify-between text-slate-400">
                                    <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Route Overrides</span>
                                    <ShieldAlert size={15} className="text-amber-600 shrink-0 print:hidden" />
                                </div>
                                <p className="text-xl sm:text-2xl font-black text-amber-700 mt-1">{metrics.overrides}</p>
                                <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                                    Boarded other bus
                                </p>
                            </div>
                        </>
                    )}
                </div>

                {/* Inspector-wise session summary (Expandable Mobile Cards & Printable Table) */}
                <div className="bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden print:hidden">
                    <div className="p-3.5 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <h2 className="text-sm sm:text-base font-extrabold text-slate-900 flex items-center gap-2">
                                Inspector-wise Inspection Summary
                                {loading && <RefreshCw size={14} className="animate-spin text-blue-600" />}
                            </h2>
                            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 print:hidden">Click any inspector row or card to view detailed bus inspection breakdowns and mismatched scan records for {selectedDate}.</p>
                        </div>
                    </div>

                    {/* Mobile Responsive Card List (Visible on < md screens, hidden when printing) */}
                    <div className="block md:hidden print:hidden divide-y divide-slate-100">
                        {loading ? (
                            Array.from({ length: 3 }).map((_, i) => (
                                <div key={i} className="p-3.5 space-y-3 animate-pulse">
                                    <div className="flex items-center justify-between">
                                        <div className="h-4 bg-slate-200 rounded-md w-36"></div>
                                        <div className="h-6 bg-slate-200 rounded-lg w-20"></div>
                                    </div>
                                    <div className="grid grid-cols-4 gap-1.5">
                                        <div className="h-10 bg-slate-200 rounded-lg"></div>
                                        <div className="h-10 bg-slate-200 rounded-lg"></div>
                                        <div className="h-10 bg-slate-200 rounded-lg"></div>
                                        <div className="h-10 bg-slate-200 rounded-lg"></div>
                                    </div>
                                </div>
                            ))
                        ) : inspectorSummary.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-xs font-semibold">No inspection sessions recorded for this date.</div>
                        ) : inspectorSummary.map((row) => {
                            const isExpanded = expandedInspector === row.inspectorName;
                            return (
                                <div key={row.inspectorName} className="p-3.5 space-y-3">
                                    <div
                                        onClick={() => setExpandedInspector(isExpanded ? null : row.inspectorName)}
                                        className="flex items-start justify-between gap-2 cursor-pointer"
                                    >
                                        <div className="space-y-1">
                                            <div className="flex items-center gap-2">
                                                <div className={`p-1 rounded-lg transition-transform ${isExpanded ? 'rotate-180 bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}`}>
                                                    <ChevronDown size={14} />
                                                </div>
                                                <h3 className="font-black text-slate-900 text-sm">{row.inspectorName}</h3>
                                            </div>
                                            <p className="text-[11px] font-bold text-blue-700 pl-6">
                                                {row.buses.length} Bus{row.buses.length !== 1 ? 'es' : ''}: {row.buses.map((b) => `Bus ${b.busNumber}`).join(', ')}
                                            </p>
                                        </div>

                                        <button
                                            type="button"
                                            className="px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-bold text-[11px] shrink-0"
                                        >
                                            {isExpanded ? 'Hide' : 'View Buses'}
                                        </button>
                                    </div>

                                    {/* Mobile Summary Pills Grid */}
                                    <div className="grid grid-cols-4 gap-1.5 text-center text-[10px] font-extrabold pt-1">
                                        <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                            <span className="text-slate-400 block text-[9px]">Occupied</span>
                                            <span className="text-slate-800 text-xs">{row.overallOccupied}</span>
                                        </div>
                                        <div className="bg-emerald-50 p-1.5 rounded-lg border border-emerald-100">
                                            <span className="text-emerald-600 block text-[9px]">Scanned</span>
                                            <span className="text-emerald-700 text-xs">{row.overallScanned}</span>
                                        </div>
                                        <div className="bg-rose-50 p-1.5 rounded-lg border border-rose-100">
                                            <span className="text-rose-600 block text-[9px]">Not Scanned</span>
                                            <span className="text-rose-700 text-xs">{row.overallNotScanned}</span>
                                        </div>
                                        <div className={`p-1.5 rounded-lg border ${row.overallMismatched > 0 ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-slate-50 border-slate-100 text-slate-500'}`}>
                                            <span className="block text-[9px]">Mismatched</span>
                                            <span className="text-xs">{row.overallMismatched}</span>
                                        </div>
                                    </div>

                                    {/* Expanded Bus Cards on Mobile */}
                                    {isExpanded && (
                                        <div className="pt-2 space-y-2.5 bg-slate-50/80 p-3 rounded-xl border border-slate-200">
                                            <h4 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-500">
                                                Buses under {row.inspectorName}
                                            </h4>
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                                {row.buses.map((bus) => (
                                                    <div
                                                        key={`${bus.routeId}-${bus.busNumber}`}
                                                        className="bg-white rounded-xl border border-slate-200 p-3 shadow-2xs space-y-2"
                                                    >
                                                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-1.5">
                                                            <div>
                                                                <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-black text-[9px]">
                                                                    Route {bus.routeId}
                                                                </span>
                                                                <div className="flex items-center gap-2 mt-1">
                                                                    <h5 className="font-extrabold text-slate-900 text-xs">Bus {bus.busNumber}</h5>
                                                                    {!online && (
                                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[7px] font-extrabold uppercase bg-rose-100 text-rose-700 border border-rose-300">
                                                                            <WifiOff size={9} />
                                                                            Offline
                                                                        </span>
                                                                    )}
                                                                </div>
                                                                <p className="text-[10px] text-slate-500 truncate max-w-[180px]">{bus.routeName}</p>
                                                            </div>
                                                        </div>

                                                        <div className="grid grid-cols-3 gap-1 text-center text-[9px] font-bold">
                                                            <div className="bg-slate-50 p-1 rounded-lg border border-slate-100">
                                                                <span className="text-slate-400 block text-[8px]">Occupied</span>
                                                                <span className="text-slate-800 font-extrabold text-xs">{bus.occupied}</span>
                                                            </div>
                                                            <div className="bg-emerald-50 p-1 rounded-lg border border-emerald-100">
                                                                <span className="text-emerald-600 block text-[8px]">Scanned</span>
                                                                <span className="text-emerald-700 font-extrabold text-xs">{bus.scanned}</span>
                                                            </div>
                                                            <div className="bg-rose-50 p-1 rounded-lg border border-rose-100">
                                                                <span className="text-rose-600 block text-[8px]">Not Scanned</span>
                                                                <span className="text-rose-700 font-extrabold text-xs">{bus.notScanned}</span>
                                                            </div>
                                                        </div>

                                                        <div
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                if (bus.mismatchedPassengers.length > 0) {
                                                                    setMismatchedModalData({
                                                                        bus,
                                                                        inspectorName: row.inspectorName,
                                                                        passengers: bus.mismatchedPassengers,
                                                                    });
                                                                }
                                                            }}
                                                            className={`p-2 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                                                                bus.mismatchedCount > 0
                                                                    ? 'bg-amber-50 border-amber-200 cursor-pointer text-amber-900'
                                                                    : 'bg-slate-50 border-slate-200 opacity-70 text-slate-500 cursor-default'
                                                            }`}
                                                        >
                                                            <div className="flex items-center gap-1.5">
                                                                <AlertTriangle size={13} className={bus.mismatchedCount > 0 ? 'text-amber-600' : 'text-slate-400'} />
                                                                <p className="text-[11px] font-extrabold">
                                                                    {bus.mismatchedCount} Mismatched
                                                                </p>
                                                            </div>
                                                            {bus.mismatchedCount > 0 && (
                                                                <span className="px-2 py-0.5 rounded bg-amber-600 text-white font-extrabold text-[9px]">
                                                                    View
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>

                    {/* Desktop Table View (Visible on >= md screens & when printing) */}
                    <div className="hidden md:block print:block overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th className="py-3 px-4">Inspector</th>
                                    <th className="py-3 px-4">Buses</th>
                                    <th className="py-3 px-4">Overall Occupied</th>
                                    <th className="py-3 px-4">Overall Scanned</th>
                                    <th className="py-3 px-4">Overall Not Scanned</th>
                                    <th className="py-3 px-4">Mismatched Scans</th>
                                    <th className="py-3 px-4 text-right print:hidden">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {loading ? (
                                    Array.from({ length: 3 }).map((_, idx) => (
                                        <tr key={idx} className="animate-pulse">
                                            <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded-md w-32"></div></td>
                                            <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded-md w-24"></div></td>
                                            <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded-md w-12"></div></td>
                                            <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded-md w-12"></div></td>
                                            <td className="py-4 px-4"><div className="h-4 bg-slate-200 rounded-md w-12"></div></td>
                                            <td className="py-4 px-4"><div className="h-5 bg-slate-200 rounded-full w-24"></div></td>
                                            <td className="py-4 px-4 text-right"><div className="h-4 bg-slate-200 rounded-md w-16 ml-auto"></div></td>
                                        </tr>
                                    ))
                                ) : inspectorSummary.length === 0 ? (
                                    <tr><td colSpan={7} className="py-6 px-4 text-center text-slate-400 font-semibold">No inspection sessions recorded for this date.</td></tr>
                                ) : inspectorSummary.map((row) => {
                                    const isExpanded = expandedInspector === row.inspectorName;
                                    return (
                                        <React.Fragment key={row.inspectorName}>
                                            {/* Top-level Summary Row */}
                                            <tr
                                                onClick={() => setExpandedInspector(isExpanded ? null : row.inspectorName)}
                                                className={`cursor-pointer transition-colors ${isExpanded ? 'bg-blue-50/50' : 'hover:bg-slate-50/70'}`}
                                            >
                                                <td className="py-3.5 px-4 font-extrabold text-slate-900 flex items-center gap-2">
                                                    <div className={`p-1 rounded-lg transition-transform print:hidden ${isExpanded ? 'rotate-180 bg-blue-100 text-blue-700' : 'text-slate-400'}`}>
                                                        <ChevronDown size={14} />
                                                    </div>
                                                    <span>{row.inspectorName}</span>
                                                </td>
                                                <td className="py-3.5 px-4 font-bold text-blue-700">
                                                    {row.buses.length} Bus{row.buses.length !== 1 ? 'es' : ''}
                                                    <p className="text-[10px] font-medium text-slate-500 mt-0.5 truncate max-w-[160px]">
                                                        {row.buses.map((b) => `Bus ${b.busNumber}`).join(', ')}
                                                    </p>
                                                </td>
                                                <td className="py-3.5 px-4 font-bold text-slate-800">{row.overallOccupied}</td>
                                                <td className="py-3.5 px-4 font-bold text-emerald-700">{row.overallScanned}</td>
                                                <td className="py-3.5 px-4 font-bold text-rose-700">{row.overallNotScanned}</td>
                                                <td className="py-3.5 px-4">
                                                    {row.overallMismatched > 0 ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-amber-100 text-amber-800 border border-amber-300">
                                                            <AlertTriangle size={11} className="text-amber-600" />
                                                            {row.overallMismatched} Mismatched
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-slate-100 text-slate-500">
                                                            <CheckCircle2 size={11} className="text-slate-400" />
                                                            0 Mismatched
                                                        </span>
                                                    )}
                                                </td>
                                                <td className="py-3.5 px-4 text-right print:hidden">
                                                    <button
                                                        type="button"
                                                        className="text-xs font-bold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                                                    >
                                                        <span>{isExpanded ? 'Hide Details' : 'View Buses'}</span>
                                                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* Expanded Detailed Bus Table View */}
                                            {isExpanded && (
                                                <tr className="bg-slate-50/90 border-b border-slate-200">
                                                    <td colSpan={7} className="p-3 sm:p-4">
                                                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs">
                                                            <div className="bg-slate-100/90 px-4 py-2.5 border-b border-slate-200 flex items-center justify-between">
                                                                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600">
                                                                    Bus Inspections handled by {row.inspectorName} ({row.buses.length} Bus{row.buses.length !== 1 ? 'es' : ''})
                                                                </h4>
                                                            </div>
                                                            <div className="overflow-x-auto">
                                                                <table className="w-full text-left text-xs border-collapse">
                                                                    <thead>
                                                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                                                            <th className="py-2.5 px-3.5">Route</th>
                                                                            <th className="py-2.5 px-3.5">Bus Number</th>
                                                                            <th className="py-2.5 px-3.5">Route Name</th>
                                                                            <th className="py-2.5 px-3.5 text-center">Occupied</th>
                                                                            <th className="py-2.5 px-3.5 text-center">Scanned</th>
                                                                            <th className="py-2.5 px-3.5 text-center">Not Scanned</th>
                                                                            <th className="py-2.5 px-3.5 text-center">Mismatched Scans</th>
                                                                            <th className="py-2.5 px-3.5 text-right print:hidden">Action</th>
                                                                        </tr>
                                                                    </thead>
                                                                    <tbody className="divide-y divide-slate-100">
                                                                        {row.buses.map((bus) => {
                                                                            const busKey = `${row.inspectorName}-${bus.routeId}-${bus.busNumber}`;
                                                                            const isBusExpanded = expandedBusKey === busKey;

                                                                            return (
                                                                                <React.Fragment key={busKey}>
                                                                                    <tr className={`transition-colors ${isBusExpanded ? 'bg-amber-50/50' : 'hover:bg-slate-50/80'}`}>
                                                                                        <td className="py-2.5 px-3.5 font-bold text-blue-700">
                                                                                            <span className="px-2 py-0.5 rounded bg-blue-100 text-blue-800 text-[10px] font-black">
                                                                                                Route {bus.routeId}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 font-extrabold text-slate-900 flex items-center gap-2">
                                                                                            Bus {bus.busNumber}
                                                                                            {!online && (
                                                                                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase bg-rose-100 text-rose-700 border border-rose-300">
                                                                                                    <WifiOff size={10} />
                                                                                                    Offline
                                                                                                </span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-slate-600 text-[11px] truncate max-w-[220px]">
                                                                                            {bus.routeName || '—'}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-center font-bold text-slate-800">
                                                                                            {bus.occupied}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-center font-bold text-emerald-700">
                                                                                            {bus.scanned}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-center font-bold text-rose-700">
                                                                                            {bus.notScanned}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-center">
                                                                                            {bus.mismatchedCount > 0 ? (
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setExpandedBusKey(isBusExpanded ? null : busKey);
                                                                                                    }}
                                                                                                    className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200 transition-colors cursor-pointer"
                                                                                                    title="Click to toggle mismatched student details"
                                                                                                >
                                                                                                    <AlertTriangle size={11} className="text-amber-600" />
                                                                                                    {bus.mismatchedCount} Mismatched
                                                                                                </button>
                                                                                            ) : (
                                                                                                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-400">
                                                                                                    0 Mismatched
                                                                                                </span>
                                                                                            )}
                                                                                        </td>
                                                                                        <td className="py-2.5 px-3.5 text-right print:hidden">
                                                                                            {bus.mismatchedCount > 0 ? (
                                                                                                <button
                                                                                                    type="button"
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setExpandedBusKey(isBusExpanded ? null : busKey);
                                                                                                    }}
                                                                                                    className={`px-2.5 py-1 rounded-lg font-extrabold text-[10px] transition-colors cursor-pointer inline-flex items-center gap-1 shadow-2xs ${
                                                                                                        isBusExpanded
                                                                                                            ? 'bg-slate-700 hover:bg-slate-800 text-white'
                                                                                                            : 'bg-amber-600 hover:bg-amber-700 text-white'
                                                                                                    }`}
                                                                                                >
                                                                                                    <span>{isBusExpanded ? 'Hide Students' : 'View Students'}</span>
                                                                                                    {isBusExpanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                                                                                </button>
                                                                                            ) : (
                                                                                                <span className="text-[10px] text-slate-400">—</span>
                                                                                            )}
                                                                                        </td>
                                                                                    </tr>

                                                                                    {/* Expandable Mismatched Students Sub-Table Row */}
                                                                                    {isBusExpanded && bus.mismatchedCount > 0 && (
                                                                                        <tr className="bg-amber-50/70 border-b border-amber-200/80">
                                                                                            <td colSpan={8} className="p-3">
                                                                                                <div className="bg-white rounded-xl border border-amber-200 overflow-hidden shadow-2xs">
                                                                                                    <div className="bg-amber-100/80 px-3.5 py-2 border-b border-amber-200 flex items-center justify-between">
                                                                                                        <span className="text-[11px] font-extrabold text-amber-950 flex items-center gap-1.5">
                                                                                                            <AlertTriangle size={13} className="text-amber-600 shrink-0" />
                                                                                                            Mismatched / Route Override Students — Route {bus.routeId} / Bus {bus.busNumber} ({bus.mismatchedPassengers.length})
                                                                                                        </span>
                                                                                                        <span className="text-[10px] text-amber-800 font-semibold">
                                                                                                            Inspector: {row.inspectorName}
                                                                                                        </span>
                                                                                                    </div>
                                                                                                    <div className="overflow-x-auto">
                                                                                                        <table className="w-full text-left text-xs border-collapse">
                                                                                                            <thead>
                                                                                                                <tr className="bg-amber-50/60 border-b border-amber-200 text-[10px] font-bold text-amber-900 uppercase tracking-wider">
                                                                                                                    <th className="py-2 px-3">Student / Faculty</th>
                                                                                                                    <th className="py-2 px-3">ADM / Emp ID</th>
                                                                                                                    <th className="py-2 px-3">Assigned Route & Bus</th>
                                                                                                                    <th className="py-2 px-3">Boarded Route & Bus</th>
                                                                                                                    <th className="py-2 px-3">Stage</th>
                                                                                                                    <th className="py-2 px-3">Scan Time</th>
                                                                                                                </tr>
                                                                                                            </thead>
                                                                                                            <tbody className="divide-y divide-amber-100/60">
                                                                                                                {bus.mismatchedPassengers.length === 0 ? (
                                                                                                                    <tr>
                                                                                                                        <td colSpan={6} className="py-4 text-center text-slate-400 text-xs">
                                                                                                                            No mismatched student records found.
                                                                                                                        </td>
                                                                                                                    </tr>
                                                                                                                ) : (
                                                                                                                    bus.mismatchedPassengers.map((p) => (
                                                                                                                        <tr key={p.key} className="hover:bg-amber-50/40 transition-colors">
                                                                                                                            <td className="py-2 px-3">
                                                                                                                                <div className="flex items-center gap-2">
                                                                                                                                    <div className="w-7 h-7 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                                                                                                                        {p.photo ? (
                                                                                                                                            <img src={p.photo} alt="" className="w-full h-full object-cover" />
                                                                                                                                        ) : (
                                                                                                                                            <Users size={12} className="text-slate-400" />
                                                                                                                                        )}
                                                                                                                                    </div>
                                                                                                                                    <div>
                                                                                                                                        <p className="font-bold text-slate-900 text-xs leading-tight">{p.studentName}</p>
                                                                                                                                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 rounded bg-amber-100 text-amber-900 border border-amber-300">
                                                                                                                                            {p.userType === 'student' ? 'Student' : 'Faculty'}
                                                                                                                                        </span>
                                                                                                                                    </div>
                                                                                                                                </div>
                                                                                                                            </td>
                                                                                                                            <td className="py-2 px-3 font-mono text-slate-700">
                                                                                                                                <div>{p.studentId}</div>
                                                                                                                                {p.pinNo && <div className="text-[10px] text-slate-400">PIN: {p.pinNo}</div>}
                                                                                                                            </td>
                                                                                                                            <td className="py-2 px-3 text-slate-700">
                                                                                                                                <span className="font-bold text-slate-800">Route {p.routeId}</span>
                                                                                                                                <div className="text-[10px] text-slate-500">Bus {p.busId}</div>
                                                                                                                            </td>
                                                                                                                            <td className="py-2 px-3 text-amber-800">
                                                                                                                                <span className="font-bold">Route {bus.routeId}</span>
                                                                                                                                <div className="text-[10px] text-amber-600 font-semibold">Bus {bus.busNumber}</div>
                                                                                                                            </td>
                                                                                                                            <td className="py-2 px-3 text-slate-700 font-medium">
                                                                                                                                <div className="flex items-center gap-1">
                                                                                                                                    <MapPin size={11} className="text-slate-400 shrink-0" />
                                                                                                                                    <span>{p.stageName}</span>
                                                                                                                                </div>
                                                                                                                            </td>
                                                                                                                            <td className="py-2 px-3 text-slate-600 font-medium tabular-nums">
                                                                                                                                {p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                                                                                            </td>
                                                                                                                        </tr>
                                                                                                                    ))
                                                                                                                )}
                                                                                                            </tbody>
                                                                                                        </table>
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

                {/* Passenger-level student list intentionally omitted from the reports view. */}
                <div className="hidden bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden space-y-3 p-4 sm:p-5">
                    {/* Filters Row */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-5 gap-2.5">
                        {/* Search Input */}
                        <div className="relative md:col-span-2">
                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search by name, ADM, PIN, bus, stage…"
                                className="w-full pl-9 pr-8 py-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20"
                            />
                            {searchQuery && (
                                <button
                                    type="button"
                                    onClick={() => setSearchQuery('')}
                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                >
                                    <X size={13} />
                                </button>
                            )}
                        </div>

                        {/* Route Filter */}
                        <select
                            value={selectedRouteFilter}
                            onChange={(e) => setSelectedRouteFilter(e.target.value)}
                            className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                        >
                            <option value="all">All Routes ({routesWithMetrics.length})</option>
                            {routesWithMetrics.map((r) => (
                                <option key={r.routeId} value={r.routeId}>
                                    Route {r.routeId} - {r.routeName}
                                </option>
                            ))}
                        </select>

                        {/* Status Filter */}
                        <select
                            value={selectedStatusFilter}
                            onChange={(e) => setSelectedStatusFilter(e.target.value)}
                            className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                        >
                            <option value="all">All Statuses</option>
                            <option value="boarded">Boarded ({metrics.boarded})</option>
                            <option value="override">Route Overrides ({metrics.overrides})</option>
                            <option value="pending">Pending / Not Boarded ({metrics.pending})</option>
                        </select>

                        {/* Type Filter */}
                        <select
                            value={selectedTypeFilter}
                            onChange={(e) => setSelectedTypeFilter(e.target.value)}
                            className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                        >
                            <option value="all">All Types</option>
                            <option value="student">Students ({metrics.students})</option>
                            <option value="employee">Faculty ({metrics.faculty})</option>
                        </select>
                    </div>

                    {/* Table */}
                    <div className="overflow-x-auto rounded-xl border border-slate-200 mt-3">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th className="py-3 px-3.5">Passenger</th>
                                    <th className="py-3 px-3.5">ADM / Emp ID</th>
                                    <th className="py-3 px-3.5">Assigned Route & Bus</th>
                                    <th className="py-3 px-3.5">Stage</th>
                                    <th className="py-3 px-3.5">Boarding Status</th>
                                    <th className="py-3 px-3.5">Boarded Time</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filteredReportList.length === 0 ? (
                                    <tr>
                                        <td colSpan={6} className="py-8 text-center text-slate-400">
                                            No passenger inspection records match the filter criteria.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredReportList.map((p) => (
                                        <tr key={p.key} className="hover:bg-slate-50/60 transition-colors">
                                            {/* Passenger Name & Type */}
                                            <td className="py-3 px-3.5 font-bold text-slate-900">
                                                <div className="flex items-center gap-2.5">
                                                    <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                                        {p.photo ? (
                                                            <img src={p.photo} alt="" className="w-full h-full object-cover" />
                                                        ) : (
                                                            <Users size={14} className="text-slate-400" />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <p className="font-bold text-slate-900 text-xs">{p.studentName}</p>
                                                        <span
                                                            className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                                                p.userType === 'student'
                                                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                                    : 'bg-teal-50 text-teal-700 border border-teal-200'
                                                            }`}
                                                        >
                                                            {p.userType === 'student' ? 'Student' : 'Faculty'}
                                                        </span>
                                                    </div>
                                                </div>
                                            </td>

                                            {/* ADM & PIN */}
                                            <td className="py-3 px-3.5 font-mono text-slate-700">
                                                <div>{p.studentId}</div>
                                                {p.pinNo && <div className="text-[10px] text-slate-400">PIN: {p.pinNo}</div>}
                                            </td>

                                            {/* Assigned Route & Bus */}
                                            <td className="py-3 px-3.5">
                                                <p className="font-bold text-slate-800">Route {p.routeId}</p>
                                                <p className="text-[10px] text-slate-500 font-medium">Bus: {p.busId}</p>
                                            </td>

                                            {/* Stage */}
                                            <td className="py-3 px-3.5 text-slate-700 font-medium">
                                                <div className="flex items-center gap-1">
                                                    <MapPin size={11} className="text-slate-400 shrink-0" />
                                                    <span>{p.stageName}</span>
                                                </div>
                                            </td>

                                            {/* Status Badge */}
                                            <td className="py-3 px-3.5">
                                                {p.isOverride ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200">
                                                        <AlertTriangle size={11} className="text-amber-600" /> Route Override
                                                    </span>
                                                ) : p.isBoarded ? (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-800 border border-emerald-200">
                                                        <CheckCircle2 size={11} className="text-emerald-600" /> Boarded
                                                    </span>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                                                        <Clock size={11} /> Not Boarded
                                                    </span>
                                                )}
                                            </td>

                                            {/* Boarded Time */}
                                            <td className="py-3 px-3.5 text-slate-600 font-medium tabular-nums">
                                                {p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                            </td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination / Count footer */}
                    <div className="flex justify-between items-center text-xs text-slate-500 pt-2">
                        <span>Showing {filteredReportList.length} of {allPassengerReports.length} records</span>
                        <span>Date: {selectedDate}</span>
                    </div>
                </div>
            </div>

            {/* Mismatched Passengers Modal */}
            <Modal
                isOpen={Boolean(mismatchedModalData)}
                onClose={() => setMismatchedModalData(null)}
                title={`Mismatched Scans — Route ${mismatchedModalData?.bus?.routeId} / Bus ${mismatchedModalData?.bus?.busNumber}`}
                maxWidth="max-w-3xl"
            >
                {mismatchedModalData && (
                    <div className="space-y-4">

                        {/* Mobile Card List View (Visible on < md screens) */}
                        <div className="block md:hidden space-y-2.5 max-h-[60vh] overflow-y-auto pr-1">
                            {mismatchedModalData.passengers.length === 0 ? (
                                <div className="py-6 text-center text-slate-400 text-xs">
                                    No mismatched scan records found.
                                </div>
                            ) : (
                                mismatchedModalData.passengers.map((p) => (
                                    <div key={p.key} className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2.5 text-xs">
                                        {/* Header: Photo & Name & Type */}
                                        <div className="flex items-center justify-between gap-2 border-b border-slate-200/80 pb-2">
                                            <div className="flex items-center gap-2.5">
                                                <div className="w-9 h-9 rounded-lg bg-white border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                                    {p.photo ? (
                                                        <img src={p.photo} alt="" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <Users size={15} className="text-slate-400" />
                                                    )}
                                                </div>
                                                <div>
                                                    <p className="font-extrabold text-slate-900 text-xs leading-tight">{p.studentName}</p>
                                                    <p className="font-mono text-[10px] text-slate-500">{p.studentId}{p.pinNo ? ` • PIN: ${p.pinNo}` : ''}</p>
                                                </div>
                                            </div>
                                            <span className="text-[9px] font-extrabold uppercase px-2 py-0.5 rounded bg-amber-100 text-amber-900 border border-amber-300 shrink-0">
                                                {p.userType === 'student' ? 'Student' : 'Faculty'}
                                            </span>
                                        </div>

                                        {/* Assigned vs Boarded Comparison */}
                                        <div className="grid grid-cols-2 gap-2 text-[10px] font-bold">
                                            <div className="bg-white p-2 rounded-lg border border-slate-200">
                                                <span className="text-slate-400 block text-[9px]">Assigned</span>
                                                <span className="font-bold text-slate-800">Route {p.routeId}</span>
                                                <div className="text-[10px] text-slate-500">Bus {p.busId}</div>
                                            </div>
                                            <div className="bg-amber-50 p-2 rounded-lg border border-amber-200">
                                                <span className="text-amber-700 block text-[9px]">Boarded</span>
                                                <span className="font-bold text-amber-900">Route {mismatchedModalData.bus.routeId}</span>
                                                <div className="text-[10px] text-amber-700 font-semibold">Bus {mismatchedModalData.bus.busNumber}</div>
                                            </div>
                                        </div>

                                        {/* Stage & Scan Time */}
                                        <div className="flex items-center justify-between text-[10px] text-slate-500 pt-0.5">
                                            <div className="flex items-center gap-1 font-medium truncate">
                                                <MapPin size={11} className="text-slate-400 shrink-0" />
                                                <span className="truncate">{p.stageName}</span>
                                            </div>
                                            <div className="font-semibold text-slate-700 shrink-0">
                                                {p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>

                        {/* Desktop Table View (Visible on >= md screens) */}
                        <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200">
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                        <th className="py-3 px-3.5">Student / Faculty</th>
                                        <th className="py-3 px-3.5">ADM / Emp ID</th>
                                        <th className="py-3 px-3.5">Assigned Route & Bus</th>
                                        <th className="py-3 px-3.5">Boarded Route & Bus</th>
                                        <th className="py-3 px-3.5">Stage</th>
                                        <th className="py-3 px-3.5">Scan Time</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {mismatchedModalData.passengers.length === 0 ? (
                                        <tr>
                                            <td colSpan={6} className="py-6 text-center text-slate-400">
                                                No mismatched scan records found.
                                            </td>
                                        </tr>
                                    ) : (
                                        mismatchedModalData.passengers.map((p) => (
                                            <tr key={p.key} className="hover:bg-slate-50">
                                                <td className="py-3 px-3.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-lg bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                                            {p.photo ? (
                                                                <img src={p.photo} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <Users size={14} className="text-slate-400" />
                                                            )}
                                                        </div>
                                                        <div>
                                                            <p className="font-bold text-slate-900 text-xs">{p.studentName}</p>
                                                            <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200">
                                                                {p.userType === 'student' ? 'Student' : 'Faculty'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3.5 font-mono text-slate-700">
                                                    <div>{p.studentId}</div>
                                                    {p.pinNo && <div className="text-[10px] text-slate-400">PIN: {p.pinNo}</div>}
                                                </td>
                                                <td className="py-3 px-3.5 text-slate-700">
                                                    <span className="font-bold text-slate-800">Route {p.routeId}</span>
                                                    <div className="text-[10px] text-slate-500">Bus {p.busId}</div>
                                                </td>
                                                <td className="py-3 px-3.5 text-amber-800">
                                                    <span className="font-bold">Route {mismatchedModalData.bus.routeId}</span>
                                                    <div className="text-[10px] text-amber-600 font-semibold">Bus {mismatchedModalData.bus.busNumber}</div>
                                                </td>
                                                <td className="py-3 px-3.5 text-slate-700 font-medium">
                                                    <div className="flex items-center gap-1">
                                                        <MapPin size={11} className="text-slate-400 shrink-0" />
                                                        <span>{p.stageName}</span>
                                                    </div>
                                                </td>
                                                <td className="py-3 px-3.5 text-slate-600 font-medium tabular-nums">
                                                    {p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—'}
                                                </td>
                                            </tr>
                                        ))
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </Modal>
        </Layout>
    );
};

export default InspectionReports;
