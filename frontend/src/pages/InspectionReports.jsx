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
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import { idbGetAllPassengers, formatSyncTime } from '../utils/qrVerification';

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
    const [mismatchedModalData, setMismatchedModalData] = useState(null);

    // Filter states
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRouteFilter, setSelectedRouteFilter] = useState('all');
    const [selectedTypeFilter, setSelectedTypeFilter] = useState('all'); // 'all' | 'student' | 'employee'
    const [selectedStatusFilter, setSelectedStatusFilter] = useState('all'); // 'all' | 'boarded' | 'override' | 'pending'
    const [selectedStageFilter, setSelectedStageFilter] = useState('all');

    // Inspected map from localStorage for the selected date
    const [inspectedMap, setInspectedMap] = useState({});

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

    // Master list of all passengers with their inspection status
    const allPassengerReports = useMemo(() => {
        return allPassengers.map((p) => {
            const pKey = String(p.requestId || p.studentId || p.mongoId);
            const inspectedRecord = inspectedMap[pKey];
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
    }, [allPassengers, inspectedMap]);

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
            current.buses.set(busKey, bus);
            if (!current.latestStartedAt || new Date(session.startedAt) > new Date(current.latestStartedAt)) {
                current.latestStartedAt = session.startedAt;
            }
            summary.set(key, current);
        });

        // Link override/mismatched passengers to inspectors & buses
        if (allPassengerReports && allPassengerReports.length > 0) {
            allPassengerReports.forEach((p) => {
                if (p.isOverride) {
                    const rec = inspectedMap[p.key];
                    const sBusId = String(rec?.scannedBusId || p.busId || '').trim().toLowerCase();
                    const sRouteId = String(rec?.scannedRouteId || p.routeId || '').trim().toLowerCase();

                    summary.forEach((inspector) => {
                        inspector.buses.forEach((bus) => {
                            const busNo = String(bus.busNumber || '').trim().toLowerCase();
                            const busRouteId = String(bus.routeId || '').trim().toLowerCase();

                            if ((busNo && sBusId === busNo) || (busRouteId && sRouteId === busRouteId)) {
                                if (!bus.mismatchedPassengers.some((m) => m.key === p.key)) {
                                    bus.mismatchedPassengers.push(p);
                                }
                            }
                        });
                    });
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
    }, [inspectionSessions, allPassengerReports]);

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
                const pKey = String(p.requestId || p.studentId || p.mongoId);
                const rec = inspectedMap[pKey];
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
    }, [routes, buses, allPassengers, inspectedMap]);



    // KPIs / Metrics summary
    const metrics = useMemo(() => {
        const total = allPassengerReports.length;
        const students = allPassengerReports.filter((p) => p.userType === 'student').length;
        const faculty = allPassengerReports.filter((p) => p.userType === 'employee').length;
        const boarded = allPassengerReports.filter((p) => p.isBoarded).length;
        const overrides = allPassengerReports.filter((p) => p.isOverride).length;
        const pending = total - boarded;

        return {
            total,
            students,
            faculty,
            boarded,
            overrides,
            pending,
            rate: total > 0 ? Math.round((boarded / total) * 100) : 0,
        };
    }, [allPassengerReports]);

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

    // Export CSV
    const exportCsv = () => {
        const headers = [
            'Passenger Name',
            'Admission / Emp No',
            'PIN No',
            'Type',
            'Assigned Route ID',
            'Assigned Route Name',
            'Assigned Bus',
            'Assigned Stage',
            'Boarding Status',
            'Inspection Time',
            'Date',
        ];

        const rows = filteredReportList.map((p) => [
            `"${p.studentName.replace(/"/g, '""')}"`,
            `"${p.studentId}"`,
            `"${p.pinNo || ''}"`,
            p.userType === 'employee' ? 'Faculty' : 'Student',
            `"${p.routeId}"`,
            `"${p.routeName.replace(/"/g, '""')}"`,
            `"${p.busId}"`,
            `"${p.stageName.replace(/"/g, '""')}"`,
            p.isOverride ? 'Route Override Allowed' : p.isBoarded ? 'Boarded' : 'Not Boarded',
            p.inspectedAt ? new Date(p.inspectedAt).toLocaleTimeString() : '—',
            selectedDate,
        ]);

        const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `inspection_report_${selectedDate}.csv`);
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
                <div className="hidden print:block border-b-2 border-slate-900 pb-3 text-center">
                    <h1 className="text-xl font-black uppercase tracking-wide text-slate-900">Pydah Group Of Institutions</h1>
                    <h2 className="mt-1 text-base font-bold text-slate-800">Inspector-wise Transport Inspection Report</h2>
                    <p className="mt-1 text-xs text-slate-600">
                        Inspection Date: {new Date(`${selectedDate}T00:00:00`).toLocaleDateString()} | Academic Year: {academicYear}
                    </p>
                </div>

                {/* Header Card */}
                <div className="print:hidden bg-white rounded-2xl p-3.5 sm:p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
                            <FileText size={20} className="sm:hidden" />
                            <FileText size={22} className="hidden sm:block" />
                        </div>
                        <div>
                            <div className="flex items-center flex-wrap gap-1.5 sm:gap-2">
                                <h1 className="text-base sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
                                    Transport Inspection Reports
                                </h1>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] sm:text-[10px] font-extrabold uppercase ${
                                    selectedDate < new Date().toLocaleDateString('en-CA') || (selectedDate === new Date().toLocaleDateString('en-CA') && new Date().getHours() >= 19)
                                        ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                }`}>
                                    {selectedDate < new Date().toLocaleDateString('en-CA') || (selectedDate === new Date().toLocaleDateString('en-CA') && new Date().getHours() >= 19)
                                        ? 'Submitted'
                                        : 'In Progress'}
                                </span>
                            </div>
                            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">
                                {selectedDate < new Date().toLocaleDateString('en-CA') || (selectedDate === new Date().toLocaleDateString('en-CA') && new Date().getHours() >= 19)
                                    ? 'Daily inspection closed at 7:00 PM. Submitted inspection report.'
                                    : 'Real-time dynamic inspection status updates (Closing daily at 7:00 PM).'}
                            </p>
                        </div>
                    </div>

                    {/* Date & Action Controls */}
                    <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full md:w-auto">
                        {/* Date Picker */}
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-2.5 sm:px-3 py-1.5 rounded-xl col-span-1">
                            <Calendar size={14} className="text-slate-500 shrink-0" />
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer w-full min-w-0"
                            />
                        </div>

                        {/* Academic Year */}
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="px-2.5 sm:px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer col-span-1"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>

                        {/* Export & Print */}
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

                {/* KPI Metrics Cards */}
                <div className="print:hidden grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
                    <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Total Expected</span>
                            <Users size={15} className="text-blue-600 shrink-0" />
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">{metrics.total}</p>
                        <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                            {metrics.students} Students • {metrics.faculty} Faculty
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Boarded / Inspected</span>
                            <CheckCircle2 size={15} className="text-emerald-600 shrink-0" />
                        </div>
                        <div className="flex items-baseline gap-1 mt-1">
                            <p className="text-xl sm:text-2xl font-black text-emerald-700">{metrics.boarded}</p>
                            <span className="text-[11px] sm:text-xs font-bold text-slate-500">({metrics.rate}%)</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${metrics.rate}%` }} />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Yet to Board</span>
                            <Clock size={15} className="text-rose-600 shrink-0" />
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-rose-700 mt-1">{metrics.pending}</p>
                        <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                            {metrics.total > 0 ? 100 - metrics.rate : 0}% remaining
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-3 sm:p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[9px] sm:text-[10px] font-bold uppercase tracking-wider">Route Overrides</span>
                            <ShieldAlert size={15} className="text-amber-600 shrink-0" />
                        </div>
                        <p className="text-xl sm:text-2xl font-black text-amber-700 mt-1">{metrics.overrides}</p>
                        <p className="text-[10px] sm:text-[11px] font-medium text-slate-500 mt-0.5 truncate">
                            Boarded other bus
                        </p>
                    </div>
                </div>

                {/* Inspector-wise session summary (Expandable Mobile Cards & Desktop Table) */}
                <div className="print:hidden bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                    <div className="p-3.5 sm:p-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-2">
                        <div>
                            <h2 className="text-sm sm:text-base font-extrabold text-slate-900">Inspector-wise Inspection Summary</h2>
                            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5">Click any inspector row or card to view detailed bus inspection breakdowns and mismatched scan records for {selectedDate}.</p>
                        </div>
                    </div>

                    {/* Mobile Responsive Card List (Visible on < md screens) */}
                    <div className="block md:hidden divide-y divide-slate-100">
                        {inspectorSummary.length === 0 ? (
                            <div className="p-6 text-center text-slate-400 text-xs">No inspection sessions recorded for this date.</div>
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
                                                                <h5 className="font-extrabold text-slate-900 text-xs mt-1">Bus {bus.busNumber}</h5>
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

                    {/* Desktop Table View (Visible on >= md screens) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th className="py-3 px-4">Inspector</th>
                                    <th className="py-3 px-4">Buses</th>
                                    <th className="py-3 px-4">Overall Occupied</th>
                                    <th className="py-3 px-4">Overall Scanned</th>
                                    <th className="py-3 px-4">Overall Not Scanned</th>
                                    <th className="py-3 px-4">Mismatched Scans</th>
                                    <th className="py-3 px-4 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {inspectorSummary.length === 0 ? (
                                    <tr><td colSpan={7} className="py-6 px-4 text-center text-slate-400">No inspection sessions recorded for this date.</td></tr>
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
                                                    <div className={`p-1 rounded-lg transition-transform ${isExpanded ? 'rotate-180 bg-blue-100 text-blue-700' : 'text-slate-400'}`}>
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
                                                <td className="py-3.5 px-4 text-right">
                                                    <button
                                                        type="button"
                                                        className="text-xs font-bold text-blue-600 hover:text-blue-800 inline-flex items-center gap-1"
                                                    >
                                                        <span>{isExpanded ? 'Hide Details' : 'View Buses'}</span>
                                                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                                                    </button>
                                                </td>
                                            </tr>

                                            {/* Expanded Detailed Bus Section */}
                                            {isExpanded && (
                                                <tr className="bg-slate-50/90 border-b border-slate-200">
                                                    <td colSpan={7} className="p-4 sm:p-5">
                                                        <div className="space-y-3">
                                                            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                                                                Bus Inspections handled by {row.inspectorName}
                                                            </h4>
                                                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                                                {row.buses.map((bus) => (
                                                                    <div
                                                                        key={`${bus.routeId}-${bus.busNumber}`}
                                                                        className="bg-white rounded-xl border border-slate-200 p-3.5 shadow-2xs space-y-2.5"
                                                                    >
                                                                        <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-2">
                                                                            <div>
                                                                                <span className="px-2 py-0.5 rounded bg-blue-600 text-white font-black text-[10px]">
                                                                                    Route {bus.routeId}
                                                                                </span>
                                                                                <h5 className="font-extrabold text-slate-900 text-sm mt-1">Bus {bus.busNumber}</h5>
                                                                                <p className="text-[11px] text-slate-500 truncate">{bus.routeName}</p>
                                                                            </div>
                                                                        </div>

                                                                        {/* Metrics breakdown */}
                                                                        <div className="grid grid-cols-3 gap-1.5 text-center text-[10px] font-bold">
                                                                            <div className="bg-slate-50 p-1.5 rounded-lg border border-slate-100">
                                                                                <span className="text-slate-400 block text-[9px]">Occupied</span>
                                                                                <span className="text-slate-800 font-extrabold text-xs">{bus.occupied}</span>
                                                                            </div>
                                                                            <div className="bg-emerald-50 p-1.5 rounded-lg border border-emerald-100">
                                                                                <span className="text-emerald-600 block text-[9px]">Scanned</span>
                                                                                <span className="text-emerald-700 font-extrabold text-xs">{bus.scanned}</span>
                                                                            </div>
                                                                            <div className="bg-rose-50 p-1.5 rounded-lg border border-rose-100">
                                                                                <span className="text-rose-600 block text-[9px]">Not Scanned</span>
                                                                                <span className="text-rose-700 font-extrabold text-xs">{bus.notScanned}</span>
                                                                            </div>
                                                                        </div>

                                                                        {/* Mismatched Card */}
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
                                                                            className={`p-2.5 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                                                                                bus.mismatchedCount > 0
                                                                                    ? 'bg-amber-50 border-amber-200 hover:bg-amber-100/90 cursor-pointer text-amber-900 shadow-2xs'
                                                                                    : 'bg-slate-50 border-slate-200 opacity-70 text-slate-500 cursor-default'
                                                                            }`}
                                                                        >
                                                                            <div className="flex items-center gap-2">
                                                                                <AlertTriangle size={14} className={bus.mismatchedCount > 0 ? 'text-amber-600' : 'text-slate-400'} />
                                                                                <div>
                                                                                    <p className="text-xs font-extrabold">
                                                                                        {bus.mismatchedCount} Mismatched Scan{bus.mismatchedCount !== 1 ? 's' : ''}
                                                                                    </p>
                                                                                    <p className="text-[10px] opacity-80">
                                                                                        {bus.mismatchedCount > 0 ? 'Click to view student list' : 'No route overrides'}
                                                                                    </p>
                                                                                </div>
                                                                            </div>
                                                                            {bus.mismatchedCount > 0 && (
                                                                                <span className="px-2 py-0.5 rounded-md bg-amber-600 text-white font-extrabold text-[10px]">
                                                                                    View
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                ))}
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
                        <div className="bg-amber-50 border border-amber-200 p-3.5 rounded-xl flex items-center gap-3">
                            <AlertTriangle size={22} className="text-amber-600 shrink-0" />
                            <div className="text-xs text-amber-900">
                                <p className="font-extrabold text-sm">Route Override Records</p>
                                <p className="mt-0.5">
                                    Students/Faculty who scanned pass on Route {mismatchedModalData.bus.routeId} (Bus {mismatchedModalData.bus.busNumber}) under inspector {mismatchedModalData.inspectorName}, but are registered for a different route.
                                </p>
                            </div>
                        </div>

                        <div className="overflow-x-auto rounded-xl border border-slate-200">
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
