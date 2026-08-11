import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import {
    Bus,
    Map,
    Users,
    Bell,
    Zap,
    MoreVertical,
    ArrowUp,
    IndianRupee,
    GraduationCap,
    MapPin,
    Activity,
    Clock
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { filterCampusesForUser, getCampusId, campusIdsMatch } from '../utils/campus';

const Dashboard = () => {
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

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));

    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);

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
            } catch (error) {
                console.error('Error fetching dashboard stats:', error);
            } finally {
                setLoading(false);
            }
        };

        fetchStats();
    }, [academicYear, occupancyMode, selectedCampus]);

    const mockDues = {
        total: "2,45,860",
        collected: "1,92,340",
        pending: "53,520"
    };

    const mockActivity = [
        { icon: <Bus size={18} />, color: "bg-blue-600", title: "New Bus Added", desc: "Bus AP-05-1234 added to fleet", time: "2 mins ago" },
        { icon: <Map size={18} />, color: "bg-emerald-500", title: "New Route Created", desc: "Route R29 created successfully", time: "15 mins ago" },
        { icon: <Users size={18} />, color: "bg-purple-600", title: "Passenger Request", desc: "18 new passenger requests", time: "35 mins ago" },
        { icon: <IndianRupee size={18} />, color: "bg-orange-500", title: "Payment Received", desc: "₹12,450 transport dues collected", time: "1 hour ago" },
    ];

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
                                        <Map size={20} />
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
                                    <Map className="text-blue-600" size={16} />
                                    <h3 className="font-bold text-slate-900 text-sm">Route Analytics</h3>
                                </div>
                                <button className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">View All</button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                                {stats.routeBreakdown && stats.routeBreakdown.length > 0 ? (
                                    stats.routeBreakdown.map((route, idx) => (
                                        <div key={idx} className="flex items-start justify-between gap-2 pb-2 border-b border-slate-50 last:border-0">
                                            <div className="bg-blue-100 text-blue-600 text-[10px] font-bold py-0.5 px-1.5 rounded">
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
                                        </div>
                                    ))
                                ) : (
                                    [
                                        { id: "R13", name: "Ramachandrapuram, Ooduru Via Velangi...", count: 30 },
                                        { id: "R07", name: "Konapapeta, U.Kothapalli, Uppada...", count: 28 },
                                        { id: "R26", name: "Unduru, Panasapadu, Subbaiah Hotel...", count: 27 },
                                        { id: "R23", name: "Kakinada Local- SP Office, Dairform...", count: 24 }
                                    ].map((route, idx) => (
                                        <div key={idx} className="flex items-start justify-between gap-2 pb-2 border-b border-slate-50 last:border-0">
                                            <div className="bg-blue-100 text-blue-600 text-[10px] font-bold py-0.5 px-1.5 rounded">
                                                #{idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-[11px] font-bold text-slate-800 leading-tight pr-1 truncate whitespace-normal line-clamp-1">{route.name}</h4>
                                                <span className="text-[9px] text-slate-400 font-medium">ID: {route.id}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-[11px] font-black text-slate-900 leading-none">{route.count}</span>
                                                <span className="text-[9px] text-slate-400 font-medium">Passengers</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-1.5">
                                    <Activity size={12} />
                                    <span className="text-[11px] font-medium">Total Coverage</span>
                                </div>
                                <span className="text-sm font-black text-blue-600">{stats.totalDistance || 1696} km</span>
                            </div>
                        </div>

                        {/* Stage Breakdown Section */}
                        <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100 flex flex-col h-[45vh] min-h-[320px]">
                            <div className="flex justify-between items-center mb-3">
                                <div className="flex items-center gap-2">
                                    <MapPin className="text-blue-600" size={16} />
                                    <h3 className="font-bold text-slate-900 text-sm">Stage Breakdown</h3>
                                </div>
                                <button className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">View All</button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-1 space-y-3 custom-scrollbar">
                                {stats.stageBreakdown && stats.stageBreakdown.length > 0 ? (
                                    stats.stageBreakdown.slice(0,5).map((stage, idx) => {
                                        const maxCount = Math.max(...stats.stageBreakdown.map(s => s.count));
                                        const percentage = (stage.count / maxCount) * 100;
                                        return (
                                            <div key={idx} className="flex flex-col gap-1">
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
                                    [
                                        { name: "DAIRYFORM CENTRE-KKD", desc: "Kakinada Local...", count: 14, pct: 100 },
                                        { name: "VAKALAPUDI JN", desc: "Kakinada Local...", count: 11, pct: 80 },
                                        { name: "KARAPA MAIN CNTR", desc: "Ramachandrapuram...", count: 8, pct: 60 },
                                        { name: "T.KOTHAPALLI", desc: "T.Kothapalli Via...", count: 7, pct: 50 },
                                        { name: "JAGGAMPETA(BABA TMP)", desc: "Jaggampeta Via...", count: 7, pct: 50 }
                                    ].map((stage, idx) => (
                                        <div key={idx} className="flex flex-col gap-1">
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1 pr-2">
                                                    <h4 className="text-[11px] font-bold text-slate-800 leading-tight uppercase truncate whitespace-normal line-clamp-1">{stage.name}</h4>
                                                    <p className="text-[9px] text-slate-400 truncate whitespace-normal line-clamp-1">{stage.desc}</p>
                                                </div>
                                                <div className="flex flex-col items-end shrink-0">
                                                    <span className="text-[11px] font-black text-slate-900 leading-none">{stage.count}</span>
                                                    <span className="text-[9px] text-slate-400 font-medium">Students</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-1">
                                                <div className="bg-blue-300 h-1 rounded-full" style={{ width: `${stage.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="mt-2 pt-2 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-1.5">
                                    <Users size={12} />
                                    <span className="text-[11px] font-medium">Total Stages</span>
                                </div>
                                <span className="text-sm font-black text-blue-600">{stats.stageBreakdown?.length || 47}</span>
                            </div>
                        </div>
                    </div>

                    {/* Recent Activity Section */}
                    <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-100">
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-2">
                                <Clock className="text-blue-600" size={16} />
                                <h3 className="font-bold text-slate-900 text-sm">Recent Activity</h3>
                            </div>
                            <button className="text-[10px] font-semibold text-blue-600 bg-blue-50 px-2 py-1 rounded hover:bg-blue-100 transition-colors">View All Activity</button>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                            {mockActivity.map((activity, idx) => (
                                <div key={idx} className="flex items-start gap-3 p-2 lg:border-r lg:border-slate-100 last:border-r-0">
                                    <div className={`w-8 h-8 rounded-full text-white flex items-center justify-center shrink-0 shadow-sm ${activity.color}`}>
                                        {React.cloneElement(activity.icon, { size: 14 })}
                                    </div>
                                    <div>
                                        <h4 className="text-[11px] font-bold text-slate-900">{activity.title}</h4>
                                        <p className="text-[10px] text-slate-500 mt-0.5 line-clamp-1">{activity.desc}</p>
                                        <p className="text-[9px] text-slate-400 mt-0.5 font-medium">{activity.time}</p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </Layout>
    );
};

export default Dashboard;
