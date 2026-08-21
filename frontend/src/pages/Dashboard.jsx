import React, { useState, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import {
    Bus,
    Map as MapIcon,
    Users,
    MoreVertical,
    ArrowUp,
    IndianRupee,
    GraduationCap,
    MapPin,
    Activity,
    RefreshCw,
    CheckCircle2,
    AlertTriangle
} from 'lucide-react';
import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions, getPreviousAcademicYear } from '../utils/academicYear';
import { filterCampusesForUser, getCampusId } from '../utils/campus';

const buildRenewalsPath = ({ expiredYear, targetYear, course = '', status = '' } = {}) => {
    const params = new URLSearchParams();
    if (expiredYear) params.set('expiredYear', expiredYear);
    if (targetYear) params.set('targetYear', targetYear);
    if (course) params.set('course', course);
    if (status) params.set('status', status);
    const qs = params.toString();
    return qs ? `/renewals?${qs}` : '/renewals';
};

const Dashboard = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState({
        buses: 0,
        routes: 0,
        totalDistance: 0,
        totalPassengers: 0,
        routeBreakdown: [],
        stageBreakdown: [],
        courseBreakdown: []
    });
    const [selectedRouteId, setSelectedRouteId] = useState(null);
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear());
    const [campuses, setCampuses] = useState([]);
    const [selectedCampus, setSelectedCampus] = useState('');
    const [occupancyMode, setOccupancyMode] = useState('live');
    const [renewalStats, setRenewalStats] = useState({
        expiredYear: '',
        targetYear: '',
        totalExpired: 0,
        totalRenewed: 0,
        totalNotRenewed: 0,
        courseBreakdown: [],
        loading: true,
        error: null,
    });

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));

    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);

    const filteredStages = useMemo(() => {
        const stages = stats.stageBreakdown || [];
        if (!selectedRouteId) return stages;
        return stages.filter((s) => String(s.route_id) === String(selectedRouteId));
    }, [stats.stageBreakdown, selectedRouteId]);

    const selectedRouteLabel = useMemo(() => {
        if (!selectedRouteId) return null;
        const match = (stats.routeBreakdown || []).find((r) => String(r.route_id) === String(selectedRouteId));
        return match ? (match.route_name || match.route_id) : selectedRouteId;
    }, [stats.routeBreakdown, selectedRouteId]);

    useEffect(() => {
        const fetchCampuses = async () => {
            try {
                const res = await apiFetch(`${import.meta.env.VITE_API_URL}/campuses`);
                const data = await res.json();
                setCampuses(Array.isArray(data) ? data : []);
            } catch (err) {
                console.error('Error fetching campuses:', err);
            }
        };
        fetchCampuses();
    }, []);

    useEffect(() => {
        if (allowedCampuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampus(String(userCampuses[0]));
        }
    }, [campuses]);

    useEffect(() => {
        const fetchStats = async () => {
            setLoading(true);
            try {
                const busUrl = selectedCampus 
                    ? `${import.meta.env.VITE_API_URL}/buses?campus=${selectedCampus}`
                    : `${import.meta.env.VITE_API_URL}/buses`;
                const routeUrl = selectedCampus
                    ? `${import.meta.env.VITE_API_URL}/routes?campus=${selectedCampus}`
                    : `${import.meta.env.VITE_API_URL}/routes`;

                const statsParams = new URLSearchParams({ occupancyMode });
                if (occupancyMode !== 'live') {
                    statsParams.append('academicYear', academicYear);
                }
                if (selectedCampus) {
                    statsParams.append('campus', selectedCampus);
                }
                const statsUrl = `${import.meta.env.VITE_API_URL}/transport-requests/stats?${statsParams.toString()}`;

                const [busRes, routeRes, statsRes] = await Promise.all([
                    apiFetch(busUrl),
                    apiFetch(routeUrl),
                    apiFetch(statsUrl)
                ]);

                const buses = await busRes.json();
                const routes = await routeRes.json();
                const passengerStats = await statsRes.json();

                const totalDist = routes.reduce((acc, curr) => acc + (curr.totalDistance || 0), 0);

                setStats({
                    buses: buses.length,
                    routes: routes.length,
                    totalDistance: totalDist,
                    totalPassengers: passengerStats.totalPassengers || 0,
                    routeBreakdown: passengerStats.routeBreakdown || [],
                    stageBreakdown: passengerStats.stageBreakdown || [],
                    courseBreakdown: passengerStats.courseBreakdown || []
                });
                setSelectedRouteId(null);
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [academicYear, occupancyMode, selectedCampus]);

    useEffect(() => {
        const fetchRenewalStats = async () => {
            const targetYear = getDefaultAcademicYear();
            const expiredYear = getPreviousAcademicYear(targetYear);
            setRenewalStats((prev) => ({ ...prev, loading: true, error: null, expiredYear, targetYear }));

            try {
                const [expiredRes, targetRes] = await Promise.all([
                    apiFetch(`${API_BASE}/transport-requests?status=expired&academicYear=${encodeURIComponent(expiredYear)}`),
                    apiFetch(`${API_BASE}/transport-requests?academicYear=${encodeURIComponent(targetYear)}`),
                ]);

                if (!expiredRes.ok) {
                    const errBody = await expiredRes.json().catch(() => ({}));
                    throw new Error(errBody.message || `Failed to load expired renewals (${expiredRes.status})`);
                }
                if (!targetRes.ok) {
                    const errBody = await targetRes.json().catch(() => ({}));
                    throw new Error(errBody.message || `Failed to load target-year renewals (${targetRes.status})`);
                }

                const expiredRaw = await expiredRes.json();
                const targetRaw = await targetRes.json();
                const expiredList = Array.isArray(expiredRaw) ? expiredRaw : [];
                const targetList = Array.isArray(targetRaw) ? targetRaw : [];

                const renewedSet = new Set();
                targetList.forEach((r) => {
                    if (r.admission_number && ['pending', 'approved'].includes(String(r.status || '').toLowerCase())) {
                        renewedSet.add(String(r.admission_number).trim());
                    }
                });

                const totalExpired = expiredList.length;
                const totalRenewed = expiredList.filter((r) => renewedSet.has(String(r.admission_number || '').trim())).length;

                const courseMap = new Map();
                expiredList.forEach((r) => {
                    const course = (r.course && String(r.course).trim()) || 'N/A';
                    const isRenewed = renewedSet.has(String(r.admission_number || '').trim());
                    if (!courseMap.has(course)) {
                        courseMap.set(course, { course, expired: 0, renewed: 0, notRenewed: 0 });
                    }
                    const row = courseMap.get(course);
                    row.expired += 1;
                    if (isRenewed) row.renewed += 1;
                    else row.notRenewed += 1;
                });

                const courseBreakdown = Array.from(courseMap.values()).sort((a, b) => b.expired - a.expired);

                setRenewalStats({
                    expiredYear,
                    targetYear,
                    totalExpired,
                    totalRenewed,
                    totalNotRenewed: Math.max(0, totalExpired - totalRenewed),
                    courseBreakdown,
                    loading: false,
                    error: null,
                });
            } catch (error) {
                console.error('Error fetching renewal stats:', error);
                setRenewalStats((prev) => ({
                    ...prev,
                    totalExpired: 0,
                    totalRenewed: 0,
                    totalNotRenewed: 0,
                    courseBreakdown: [],
                    loading: false,
                    error: error.message || 'Failed to load renewal stats',
                }));
            }
        };

        fetchRenewalStats();
    }, []);

    const mockDues = {
        total: "2,45,860",
        collected: "1,92,340",
        pending: "53,520"
    };

    return (
        <Layout>
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                <div>
                    <h2 className="text-xl font-bold text-slate-900 tracking-tight">Dashboard Overview</h2>
                    <p className="text-slate-500 text-xs mt-0.5">Welcome back, Super Admin! Here's what's happening today.</p>
                </div>
                <div className="flex flex-wrap items-center gap-2 bg-[#EAF3FF] p-1.5 rounded-xl border border-slate-200 shadow-sm">
                    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                        <button
                            type="button"
                            onClick={() => setOccupancyMode('live')}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${occupancyMode === 'live'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            Live
                        </button>
                        <button
                            type="button"
                            onClick={() => setOccupancyMode('academicYear')}
                            className={`px-3 py-1 rounded-md text-[10px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${occupancyMode === 'academicYear'
                                ? 'bg-blue-600 text-white shadow-sm'
                                : 'text-slate-500 hover:bg-slate-50'
                                }`}
                        >
                            AY
                        </button>
                    </div>
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Academic Year</span>
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            disabled={occupancyMode === 'live'}
                            className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer disabled:opacity-50"
                        >
                            {getAcademicYearOptions().map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </div>
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1 shadow-sm">
                        <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Campus</span>
                        <select
                            value={selectedCampus}
                            onChange={(e) => setSelectedCampus(e.target.value)}
                            className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer"
                        >
                            <option value="">All Campuses</option>
                            {campuses.map((campus) => (
                                <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                    {campus.name}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="min-h-[300px] flex items-center justify-center">
                    <Loader size={36} text="Loading dashboard analytics..." />
                </div>
            ) : (
                <>
                    {/* TOP CARDS */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        {/* Total Buses Card */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm">
                                        <Bus size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Buses</h3>
                                        <div className="text-2xl font-black text-slate-900 leading-none mt-1">{stats.buses || 30}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={16} /></button>
                            </div>
                            <div className="flex items-center text-emerald-600 text-[11px] font-bold mt-1">
                                <ArrowUp size={12} className="mr-1" /> 5% <span className="text-slate-400 font-medium ml-1">from last month</span>
                            </div>
                        </div>

                        {/* Total Routes Card */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-sm">
                                        <MapIcon size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Total Routes</h3>
                                        <div className="text-2xl font-black text-slate-900 leading-none mt-1">{stats.routes || 29}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={16} /></button>
                            </div>
                            <div className="text-blue-600 text-[11px] font-bold mt-1 flex items-center">
                                {stats.totalDistance || 1696} km Total Coverage
                            </div>
                        </div>

                        {/* Passengers Card */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
                            <div className="flex justify-between items-start">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-purple-600 text-white flex items-center justify-center shadow-sm">
                                        <Users size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Passengers</h3>
                                        <div className="text-2xl font-black text-slate-900 leading-none mt-1">{stats.totalPassengers || 0}</div>
                                        <span className="text-[9px] font-bold text-purple-700 bg-purple-50 border border-purple-100 rounded px-1.5 py-0.5 mt-1 inline-block">
                                            {occupancyMode === 'live' ? 'LIVE' : `AY ${academicYear}`}
                                        </span>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={16} /></button>
                            </div>
                        </div>

                        {/* Transport Dues Card */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col justify-between">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-lg bg-orange-500 text-white flex items-center justify-center shadow-sm">
                                        <IndianRupee size={20} />
                                    </div>
                                    <div>
                                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Transport Dues</h3>
                                        <div className="text-xl font-black text-slate-900 leading-none mt-1">₹ {mockDues.total}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={16} /></button>
                            </div>
                            <div className="flex items-center text-emerald-600 text-[11px] font-bold mt-1">
                                <ArrowUp size={12} className="mr-1" /> 8% <span className="text-slate-400 font-medium ml-1">from last month</span>
                            </div>
                        </div>
                    </div>

                    {/* MIDDLE SECTION */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
                        {/* Course Wise Section */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col h-[45vh] min-h-[320px]">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2">
                                    <GraduationCap className="text-blue-600" size={16} />
                                    <h3 className="font-bold text-slate-900 text-sm">Course Wise</h3>
                                </div>
                                <button className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">View All</button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                                {stats.courseBreakdown && stats.courseBreakdown.length > 0 ? (
                                    stats.courseBreakdown.map((item, idx) => {
                                        const maxCount = Math.max(...stats.courseBreakdown.map(c => c.count));
                                        const percentage = (item.count / maxCount) * 100;
                                        return (
                                            <div key={idx} className="flex flex-col gap-1">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs font-bold text-slate-800">{item.course}</span>
                                                    <div className="flex items-center gap-1 text-[10px]">
                                                        <span className="font-black text-slate-900">{item.count}</span>
                                                        <span className="text-slate-400 font-medium">Students</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1">
                                                    <div className="bg-blue-400 h-1 rounded-full" style={{ width: `${percentage}%` }}></div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    [
                                        { course: "Diploma", count: 357, pct: 100 },
                                        { course: "B.Tech", count: 32, pct: 15 },
                                        { course: "B.Pharm", count: 16, pct: 8 },
                                        { course: "B.Sc", count: 10, pct: 5 },
                                        { course: "DAP-PTV", count: 4, pct: 2 }
                                    ].map((item, idx) => (
                                        <div key={idx} className="flex flex-col gap-1">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-bold text-slate-800">{item.course}</span>
                                                <div className="flex items-center gap-1 text-[10px]">
                                                    <span className="font-black text-slate-900">{item.count}</span>
                                                    <span className="text-slate-400 font-medium">Students</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-1">
                                                <div className="bg-blue-300 h-1 rounded-full" style={{ width: `${item.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            
                            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-1.5">
                                    <Users size={12} />
                                    <span className="text-[11px] font-medium">Total Students</span>
                                </div>
                                <span className="text-sm font-black text-blue-600">{stats.totalPassengers || 419}</span>
                            </div>
                        </div>

                        {/* Route Analytics Section */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col h-[45vh] min-h-[320px]">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2">
                                    <MapIcon className="text-blue-600" size={16} />
                                    <h3 className="font-bold text-slate-900 text-sm">Route Analytics</h3>
                                </div>
                                {selectedRouteId ? (
                                    <button
                                        type="button"
                                        onClick={() => setSelectedRouteId(null)}
                                        className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded hover:bg-slate-200 transition-colors"
                                    >
                                        Clear
                                    </button>
                                ) : (
                                    <span className="text-[10px] text-slate-400">Click a route to view stages</span>
                                )}
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                                {stats.routeBreakdown && stats.routeBreakdown.length > 0 ? (
                                    stats.routeBreakdown.map((route, idx) => {
                                        const isSelected = String(selectedRouteId) === String(route.route_id);
                                        return (
                                            <button
                                                type="button"
                                                key={`${route.route_id}-${idx}`}
                                                onClick={() => setSelectedRouteId(isSelected ? null : route.route_id)}
                                                className={`w-full text-left flex items-start justify-between gap-2 pb-2 border-b border-slate-50 last:border-0 rounded-lg px-1.5 py-1 transition-colors ${
                                                    isSelected ? 'bg-blue-50 ring-1 ring-blue-200' : 'hover:bg-slate-50'
                                                }`}
                                            >
                                                <div className={`text-[10px] font-bold py-0.5 px-1.5 rounded ${isSelected ? 'bg-blue-600 text-white' : 'bg-blue-100 text-blue-600'}`}>
                                                    #{idx + 1}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h4 className="text-[11px] font-bold text-slate-800 leading-tight pr-1 truncate whitespace-normal line-clamp-1">{route.route_name}</h4>
                                                    <span className="text-[9px] text-slate-400 font-medium">ID: {route.route_id}</span>
                                                </div>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-[11px] font-black text-slate-900 leading-none">{route.count}</span>
                                                    <span className="text-[9px] text-slate-400 font-medium">Passengers</span>
                                                </div>
                                            </button>
                                        );
                                    })
                                ) : (
                                    <p className="text-xs text-slate-400 italic py-6 text-center">No route passenger data available.</p>
                                )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-1.5">
                                    <Activity size={12} />
                                    <span className="text-[11px] font-medium">Total Coverage</span>
                                </div>
                                <span className="text-sm font-black text-blue-600">{stats.totalDistance || 0} km</span>
                            </div>
                        </div>

                        {/* Stage Breakdown Section */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col h-[45vh] min-h-[320px]">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2 min-w-0">
                                    <MapPin className="text-blue-600 shrink-0" size={16} />
                                    <div className="min-w-0">
                                        <h3 className="font-bold text-slate-900 text-sm">Stage Breakdown</h3>
                                        {selectedRouteLabel && (
                                            <p className="text-[10px] text-blue-600 truncate">{selectedRouteLabel}</p>
                                        )}
                                    </div>
                                </div>
                                <span className="text-[10px] text-slate-400 shrink-0">
                                    {selectedRouteId ? `${filteredStages.length} stages` : 'All routes'}
                                </span>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                                {filteredStages.length > 0 ? (
                                    (selectedRouteId ? filteredStages : filteredStages.slice(0, 8)).map((stage, idx) => {
                                        const maxCount = Math.max(...filteredStages.map((s) => s.count), 1);
                                        const percentage = (stage.count / maxCount) * 100;
                                        return (
                                            <div key={`${stage.route_id}-${stage.stage_name}-${idx}`} className="flex flex-col gap-1">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1 pr-2">
                                                        <h4 className="text-[11px] font-bold text-slate-800 leading-tight uppercase truncate whitespace-normal line-clamp-1">{stage.stage_name}</h4>
                                                        <p className="text-[9px] text-slate-400 truncate whitespace-normal line-clamp-1">{stage.route_name}</p>
                                                    </div>
                                                    <div className="flex flex-col items-end shrink-0">
                                                        <span className="text-[11px] font-black text-slate-900 leading-none">{stage.count}</span>
                                                        <span className="text-[9px] text-slate-400 font-medium">Students</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1">
                                                    <div className="bg-blue-300 h-1 rounded-full" style={{ width: `${percentage}%` }}></div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    <p className="text-xs text-slate-400 italic py-6 text-center">
                                        {selectedRouteId ? 'No stages found for this route.' : 'No stage data available.'}
                                    </p>
                                )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-1.5">
                                    <Users size={12} />
                                    <span className="text-[11px] font-medium">{selectedRouteId ? 'Route Stages' : 'Total Stages'}</span>
                                </div>
                                <span className="text-sm font-black text-blue-600">{filteredStages.length}</span>
                            </div>
                        </div>
                    </div>

                    {/* Renewals Overview Section */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <RefreshCw className="text-blue-600" size={16} />
                                <div>
                                    <h3 className="font-bold text-slate-900 text-sm">Renewals Overview</h3>
                                    <p className="text-[10px] text-slate-400">
                                        Expired {renewalStats.expiredYear || '—'} → Target {renewalStats.targetYear || '—'}
                                    </p>
                                </div>
                            </div>
                            <Link
                                to={buildRenewalsPath({
                                    expiredYear: renewalStats.expiredYear,
                                    targetYear: renewalStats.targetYear,
                                })}
                                className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors"
                            >
                                Open Renewals
                            </Link>
                        </div>

                        {renewalStats.error && (
                            <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700 font-medium">
                                {renewalStats.error}
                            </div>
                        )}

                        {renewalStats.loading ? (
                            <div className="py-6 flex justify-center">
                                <Loader size={20} text="" className="p-2" />
                            </div>
                        ) : (
                            <div className="space-y-4">
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    <button
                                        type="button"
                                        onClick={() => navigate(buildRenewalsPath({
                                            expiredYear: renewalStats.expiredYear,
                                            targetYear: renewalStats.targetYear,
                                        }))}
                                        className="rounded-xl border border-slate-100 bg-slate-50/70 p-4 flex items-center gap-3 text-left hover:border-blue-200 hover:bg-blue-50/40 transition-colors cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shrink-0">
                                            <Users size={18} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Total Expired</p>
                                            <p className="text-xl font-black text-slate-900 leading-none mt-1">{renewalStats.totalExpired}</p>
                                            <p className="text-[10px] text-slate-400 mt-1">Passengers needing renewal</p>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => navigate(buildRenewalsPath({
                                            expiredYear: renewalStats.expiredYear,
                                            targetYear: renewalStats.targetYear,
                                            status: 'renewed',
                                        }))}
                                        className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 flex items-center gap-3 text-left hover:border-emerald-300 hover:bg-emerald-50 transition-colors cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center shrink-0">
                                            <CheckCircle2 size={18} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-emerald-600/80">Renewed</p>
                                            <p className="text-xl font-black text-emerald-700 leading-none mt-1">{renewalStats.totalRenewed}</p>
                                            <p className="text-[10px] text-emerald-700/70 mt-1">
                                                {renewalStats.totalExpired > 0
                                                    ? `${Math.round((renewalStats.totalRenewed / renewalStats.totalExpired) * 100)}% completed`
                                                    : 'No expired records'}
                                            </p>
                                        </div>
                                    </button>

                                    <button
                                        type="button"
                                        onClick={() => navigate(buildRenewalsPath({
                                            expiredYear: renewalStats.expiredYear,
                                            targetYear: renewalStats.targetYear,
                                            status: 'not_renewed',
                                        }))}
                                        className="rounded-xl border border-amber-100 bg-amber-50/50 p-4 flex items-center gap-3 text-left hover:border-amber-300 hover:bg-amber-50 transition-colors cursor-pointer"
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center shrink-0">
                                            <AlertTriangle size={18} />
                                        </div>
                                        <div>
                                            <p className="text-[10px] font-bold uppercase tracking-wide text-amber-600/80">Not Renewed</p>
                                            <p className="text-xl font-black text-amber-700 leading-none mt-1">{renewalStats.totalNotRenewed}</p>
                                            <p className="text-[10px] text-amber-700/70 mt-1">Still pending renewal</p>
                                        </div>
                                    </button>
                                </div>

                                <div>
                                    <div className="flex items-center gap-2 mb-2">
                                        <GraduationCap className="text-blue-600" size={14} />
                                        <h4 className="text-xs font-bold text-slate-800">Course-wise Renewals</h4>
                                        <span className="text-[10px] text-slate-400">Click a row to open filtered renewals</span>
                                    </div>
                                    {renewalStats.courseBreakdown?.length > 0 ? (
                                        <div className="overflow-x-auto rounded-xl border border-slate-100">
                                            <table className="w-full text-left border-collapse min-w-[480px]">
                                                <thead>
                                                    <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                                                        <th className="px-3 py-2.5">Course</th>
                                                        <th className="px-3 py-2.5 text-right">Expired</th>
                                                        <th className="px-3 py-2.5 text-right text-emerald-600">Renewed</th>
                                                        <th className="px-3 py-2.5 text-right text-amber-600">Not Renewed</th>
                                                        <th className="px-3 py-2.5 text-right">Progress</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-50">
                                                    {renewalStats.courseBreakdown.map((row) => {
                                                        const pct = row.expired > 0 ? Math.round((row.renewed / row.expired) * 100) : 0;
                                                        return (
                                                            <tr
                                                                key={row.course}
                                                                role="button"
                                                                tabIndex={0}
                                                                onClick={() => navigate(buildRenewalsPath({
                                                                    expiredYear: renewalStats.expiredYear,
                                                                    targetYear: renewalStats.targetYear,
                                                                    course: row.course,
                                                                }))}
                                                                onKeyDown={(e) => {
                                                                    if (e.key === 'Enter' || e.key === ' ') {
                                                                        e.preventDefault();
                                                                        navigate(buildRenewalsPath({
                                                                            expiredYear: renewalStats.expiredYear,
                                                                            targetYear: renewalStats.targetYear,
                                                                            course: row.course,
                                                                        }));
                                                                    }
                                                                }}
                                                                className="text-xs hover:bg-blue-50/70 cursor-pointer transition-colors"
                                                            >
                                                                <td className="px-3 py-2.5 font-bold text-slate-800 max-w-[220px] truncate" title={row.course}>
                                                                    {row.course}
                                                                </td>
                                                                <td className="px-3 py-2.5 text-right font-semibold text-slate-700">{row.expired}</td>
                                                                <td className="px-3 py-2.5 text-right font-semibold text-emerald-700">{row.renewed}</td>
                                                                <td className="px-3 py-2.5 text-right font-semibold text-amber-700">{row.notRenewed}</td>
                                                                <td className="px-3 py-2.5">
                                                                    <div className="flex items-center justify-end gap-2">
                                                                        <div className="w-16 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                                                                            <div className="bg-emerald-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                                                                        </div>
                                                                        <span className="text-[10px] font-bold text-slate-500 w-8 text-right">{pct}%</span>
                                                                    </div>
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 italic py-4 text-center border border-dashed border-slate-200 rounded-xl">
                                            No expired passengers found for course-wise stats.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </Layout>
    );
};

export default Dashboard;
