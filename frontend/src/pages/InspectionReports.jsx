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
} from 'lucide-react';
import Layout from '../components/Layout';
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
                    }
                } catch {
                    // ignore
                }
            }
        } finally {
            setLoading(false);
        }
    }, [academicYear, loadInspectedData, selectedDate]);

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
        return Array.from(summary.values())
            .map((row) => ({
                ...row,
                buses: Array.from(row.buses.values()).map((bus) => ({
                    ...bus,
                    notScanned: Math.max(0, bus.occupied - bus.scanned),
                })),
            }))
            .sort((a, b) => b.inspectionCount - a.inspectionCount);
    }, [inspectionSessions]);

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
                if (pBusId && !target.assignedBuses.includes(pBusId)) {
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
                <div className="print:hidden bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-sm flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div className="hidden md:flex items-center gap-3">
                        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-600 to-blue-700 text-white flex items-center justify-center shadow-md shadow-indigo-500/20 shrink-0">
                            <FileText size={22} />
                        </div>
                        <div>
                            <h1 className="text-lg sm:text-xl font-black text-slate-900 tracking-tight leading-tight">
                                Transport Inspection Reports
                            </h1>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Real-time boarding attendance, route compliance, and verification audit logs.
                            </p>
                        </div>
                    </div>

                    {/* Date & Action Controls */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {/* Date Picker */}
                        <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-xl">
                            <Calendar size={14} className="text-slate-500" />
                            <input
                                type="date"
                                value={selectedDate}
                                onChange={(e) => setSelectedDate(e.target.value)}
                                className="text-xs font-bold text-slate-800 bg-transparent outline-none cursor-pointer"
                            />
                        </div>

                        {/* Academic Year */}
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="px-3 py-1.5 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>

                        {/* Export & Print */}
                        <button
                            type="button"
                            onClick={exportCsv}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                            title="Export to CSV"
                        >
                            <Download size={13} />
                            <span className="hidden sm:inline">Export CSV</span>
                        </button>

                        <button
                            type="button"
                            onClick={printReport}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-colors cursor-pointer shadow-sm shadow-blue-600/20"
                            title="Print Report"
                        >
                            <Printer size={13} />
                            <span className="hidden sm:inline">Print</span>
                        </button>
                    </div>
                </div>

                {/* KPI Metrics Cards */}
                <div className="print:hidden grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Total Expected</span>
                            <Users size={16} className="text-blue-600" />
                        </div>
                        <p className="text-2xl font-black text-slate-900 mt-1">{metrics.total}</p>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                            {metrics.students} Students • {metrics.faculty} Faculty
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Boarded / Inspected</span>
                            <CheckCircle2 size={16} className="text-emerald-600" />
                        </div>
                        <div className="flex items-baseline gap-1.5 mt-1">
                            <p className="text-2xl font-black text-emerald-700">{metrics.boarded}</p>
                            <span className="text-xs font-bold text-slate-500">({metrics.rate}%)</span>
                        </div>
                        <div className="w-full h-1.5 bg-slate-100 rounded-full mt-2 overflow-hidden">
                            <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${metrics.rate}%` }} />
                        </div>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Yet to Board</span>
                            <Clock size={16} className="text-rose-600" />
                        </div>
                        <p className="text-2xl font-black text-rose-700 mt-1">{metrics.pending}</p>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                            {metrics.total > 0 ? 100 - metrics.rate : 0}% remaining
                        </p>
                    </div>

                    <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs">
                        <div className="flex items-center justify-between text-slate-400">
                            <span className="text-[10px] font-bold uppercase tracking-wider">Route Overrides</span>
                            <ShieldAlert size={16} className="text-amber-600" />
                        </div>
                        <p className="text-2xl font-black text-amber-700 mt-1">{metrics.overrides}</p>
                        <p className="text-[11px] font-medium text-slate-500 mt-0.5">
                            Boarded other assigned bus
                        </p>
                    </div>
                </div>

                {/* Inspector-wise session summary */}
                <div className="print:hidden bg-white rounded-2xl border border-slate-200 shadow-2xs overflow-hidden">
                    <div className="p-4 sm:p-5 border-b border-slate-100">
                        <h2 className="text-sm font-bold text-slate-900">Inspector-wise Inspection Summary</h2>
                        <p className="text-xs text-slate-500 mt-0.5">Buses inspected and passenger scan progress for {selectedDate}.</p>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50/80 border-b border-slate-200 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                    <th className="py-3 px-4">Inspector</th>
                                    <th className="py-3 px-4">Buses</th>
                                    <th className="py-3 px-4">Inspection Details</th>
                                    <th className="py-3 px-4">Inspections Done</th>
                                    <th className="py-3 px-4">Latest Start</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {inspectorSummary.length === 0 ? (
                                    <tr><td colSpan={5} className="py-6 px-4 text-center text-slate-400">No inspection sessions recorded for this date.</td></tr>
                                ) : inspectorSummary.map((row) => (
                                    <tr key={row.inspectorName} className="hover:bg-slate-50/60">
                                        <td className="py-3 px-4 font-bold text-slate-900">{row.inspectorName}</td>
                                        <td className="py-3 px-4 align-top">
                                            <p className="font-black text-blue-700">{row.buses.length}</p>
                                            <p className="mt-1 text-[10px] font-semibold text-slate-500">
                                                {row.buses.map((bus) => `Bus ${bus.busNumber}`).join(', ')}
                                            </p>
                                        </td>
                                        <td className="py-3 px-4 align-top">
                                            <div className="space-y-1.5 min-w-[280px]">
                                                {row.buses.map((bus) => (
                                                    <div key={`${bus.routeId}-${bus.busNumber}`} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                                                        <div className="flex items-center justify-between gap-2">
                                                            <span className="font-bold text-slate-800">Route {bus.routeId} / Bus {bus.busNumber}</span>
                                                            <span className="text-[10px] font-bold text-slate-500">{bus.routeName}</span>
                                                        </div>
                                                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-semibold">
                                                            <span className="text-slate-600">Occupied: {bus.occupied}</span>
                                                            <span className="text-emerald-700">Scanned: {bus.scanned}</span>
                                                            <span className="text-rose-700">Not scanned: {bus.notScanned}</span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </td>
                                        <td className="py-3 px-4 align-top font-black text-blue-700">{row.inspectionCount}</td>
                                        <td className="py-3 px-4 text-slate-600">
                                            {row.latestStartedAt ? new Date(row.latestStartedAt).toLocaleString() : '—'}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="hidden print:block print:break-inside-auto">
                    <div className="mb-3 border-b border-slate-400 pb-2">
                        <h2 className="text-sm font-black uppercase tracking-wide text-slate-900">Inspector-wise Inspection Summary</h2>
                        <p className="mt-0.5 text-[10px] text-slate-600">Bus occupancy and QR scan status by inspector</p>
                    </div>
                    <table className="w-full table-fixed border-collapse text-[9px] text-slate-900">
                        <thead>
                            <tr className="bg-slate-100">
                                <th className="w-[16%] border border-slate-400 px-2 py-2 text-left font-black uppercase">Inspector</th>
                                <th className="w-[11%] border border-slate-400 px-2 py-2 text-left font-black uppercase">Route</th>
                                <th className="w-[20%] border border-slate-400 px-2 py-2 text-left font-black uppercase">Bus</th>
                                <th className="w-[13%] border border-slate-400 px-2 py-2 text-right font-black uppercase">Occupied</th>
                                <th className="w-[13%] border border-slate-400 px-2 py-2 text-right font-black uppercase">Scanned</th>
                                <th className="w-[14%] border border-slate-400 px-2 py-2 text-right font-black uppercase">Not Scanned</th>
                                <th className="w-[13%] border border-slate-400 px-2 py-2 text-right font-black uppercase">Sessions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inspectorSummary.flatMap((row) => row.buses.map((bus) => (
                                <tr key={`${row.inspectorName}-${bus.routeId}-${bus.busNumber}`} className="break-inside-avoid">
                                    <td className="border border-slate-300 px-2 py-2 align-top font-bold">{row.inspectorName}</td>
                                    <td className="border border-slate-300 px-2 py-2 align-top">{bus.routeId}</td>
                                    <td className="border border-slate-300 px-2 py-2 align-top font-semibold">{bus.busNumber}</td>
                                    <td className="border border-slate-300 px-2 py-2 text-right align-top">{bus.occupied}</td>
                                    <td className="border border-slate-300 px-2 py-2 text-right align-top font-bold">{bus.scanned}</td>
                                    <td className="border border-slate-300 px-2 py-2 text-right align-top">{bus.notScanned}</td>
                                    <td className="border border-slate-300 px-2 py-2 text-right align-top">{bus.sessions}</td>
                                </tr>
                            ))) }
                            {inspectorSummary.length === 0 && (
                                <tr><td colSpan={7} className="border border-slate-300 px-2 py-4 text-center">No inspection sessions recorded for this date.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Route-Wise Inspection Summary Breakdown */}
                <div className="print:hidden bg-white rounded-2xl p-4 sm:p-5 border border-slate-200 shadow-2xs space-y-3">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                            <h2 className="text-sm font-bold text-slate-900">Route Inspection Summary</h2>
                            <p className="text-xs text-slate-500">
                                Route-by-route boarding performance for {new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'short', day: 'numeric' })}
                            </p>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 pt-1">
                        {routesWithMetrics.map((r) => (
                            <div
                                key={r.routeId}
                                onClick={() => setSelectedRouteFilter(selectedRouteFilter === r.routeId ? 'all' : r.routeId)}
                                className={`p-3.5 rounded-xl border transition-all cursor-pointer ${
                                    selectedRouteFilter === r.routeId
                                        ? 'border-blue-500 bg-blue-50/40 shadow-xs'
                                        : 'border-slate-200 hover:border-slate-300 bg-slate-50/50'
                                }`}
                            >
                                <div className="flex items-start justify-between gap-1">
                                    <span className="px-2 py-0.5 rounded-md bg-blue-600 text-white font-extrabold text-[11px]">
                                        Route {r.routeId}
                                    </span>
                                    <span className="text-xs font-black text-slate-800">
                                        {r.boardedCount} / {r.totalCount} ({r.percent}%)
                                    </span>
                                </div>
                                <p className="text-xs font-bold text-slate-900 mt-1.5 truncate">{r.routeName}</p>
                                <p className="text-[11px] text-slate-500 font-medium truncate mt-0.5">
                                    Bus: {r.assignedBuses.join(', ') || 'None'}
                                </p>
                                <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2.5 overflow-hidden">
                                    <div
                                        className={`h-full ${r.percent === 100 ? 'bg-emerald-500' : r.percent > 0 ? 'bg-blue-600' : 'bg-slate-300'}`}
                                        style={{ width: `${r.percent}%` }}
                                    />
                                </div>
                            </div>
                        ))}
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
        </Layout>
    );
};

export default InspectionReports;
