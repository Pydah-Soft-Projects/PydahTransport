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
                const statsUrl = selectedCampus
                    ? `${import.meta.env.VITE_API_URL}/transport-requests/stats?academicYear=${academicYear}&campus=${selectedCampus}`
                    : `${import.meta.env.VITE_API_URL}/transport-requests/stats?academicYear=${academicYear}`;

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
    }, [academicYear, selectedCampus]);

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
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                    <h2 className="text-[22px] font-bold text-slate-900 tracking-tight">Dashboard Overview</h2>
                    <p className="text-slate-500 text-sm mt-1">Welcome back, Super Admin! Here's what's happening today.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {allowedCampuses.length > 0 && (
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
                            <span className="text-xs font-medium text-slate-500 mr-2">Campus</span>
                            <select
                                value={selectedCampus}
                                onChange={(e) => setSelectedCampus(e.target.value)}
                                className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                        {campus.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm">
                        <span className="text-xs font-medium text-slate-500 mr-2">Academic Year</span>
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="bg-transparent text-sm font-bold text-slate-800 focus:outline-none cursor-pointer"
                        >
                            {getAcademicYearOptions().map((option) => (
                                <option key={option} value={option}>
                                    {option}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {loading ? (
                <div className="min-h-[400px] flex items-center justify-center">
                    <Loader size={48} text="Loading dashboard analytics..." />
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5 mb-6">
                        {/* Total Buses Card */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md">
                                        <Bus size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Buses</h3>
                                        <div className="text-3xl font-black text-slate-900 mt-1">{stats.buses || 30}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={20} /></button>
                            </div>
                            <div className="flex items-center text-emerald-600 text-xs font-bold mt-2">
                                <ArrowUp size={14} className="mr-1" /> 5% <span className="text-slate-400 font-medium ml-1">from last month</span>
                            </div>
                            <div className="w-full h-px bg-slate-100 my-4"></div>
                            <div className="flex justify-between items-center text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs">Operational</span>
                                    <p className="font-bold text-slate-800">{stats.buses > 0 ? stats.buses - 1 : 29}</p>
                                </div>
                                <div className="w-px h-8 bg-slate-100"></div>
                                <div>
                                    <span className="text-slate-500 text-xs">Inactive</span>
                                    <p className="font-bold text-slate-800">1</p>
                                </div>
                            </div>
                        </div>

                        {/* Total Routes Card */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-emerald-500 text-white flex items-center justify-center shadow-md">
                                        <Map size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Total Routes</h3>
                                        <div className="text-3xl font-black text-slate-900 mt-1">{stats.routes || 29}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={20} /></button>
                            </div>
                            <div className="text-blue-600 text-xs font-bold mt-2 flex items-center h-5">
                                {stats.totalDistance || 1696} km Total Coverage
                            </div>
                            <div className="w-full h-px bg-slate-100 my-4"></div>
                            <div className="flex justify-between items-center text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs">Active Routes</span>
                                    <p className="font-bold text-slate-800">{stats.routes > 0 ? stats.routes - 5 : 24}</p>
                                </div>
                                <div className="w-px h-8 bg-slate-100"></div>
                                <div>
                                    <span className="text-slate-500 text-xs">Inactive Routes</span>
                                    <p className="font-bold text-slate-800">5</p>
                                </div>
                            </div>
                        </div>

                        {/* Passengers Card */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-md">
                                        <Users size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Passengers</h3>
                                        <div className="text-3xl font-black text-slate-900 mt-1">{stats.totalPassengers || 421}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={20} /></button>
                            </div>
                            <div className="flex items-center text-emerald-600 text-xs font-bold mt-2">
                                <ArrowUp size={14} className="mr-1" /> 12% <span className="text-slate-400 font-medium ml-1">from last month</span>
                            </div>
                            <div className="w-full h-px bg-slate-100 my-4"></div>
                            <div className="flex justify-between items-center text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs">Approved Requests</span>
                                    <p className="font-bold text-slate-800">{stats.totalPassengers || 421}</p>
                                </div>
                                <div className="w-px h-8 bg-slate-100"></div>
                                <div>
                                    <span className="text-slate-500 text-xs">Pending Requests</span>
                                    <p className="font-bold text-slate-800">18</p>
                                </div>
                            </div>
                        </div>

                        {/* Transport Dues Card */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col">
                            <div className="flex justify-between items-start mb-2">
                                <div className="flex items-center gap-3">
                                    <div className="w-12 h-12 rounded-xl bg-orange-500 text-white flex items-center justify-center shadow-md">
                                        <IndianRupee size={24} />
                                    </div>
                                    <div>
                                        <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Transport Dues</h3>
                                        <div className="text-2xl font-black text-slate-900 mt-1">₹ {mockDues.total}</div>
                                    </div>
                                </div>
                                <button className="text-slate-400 hover:text-slate-600"><MoreVertical size={20} /></button>
                            </div>
                            <div className="flex items-center text-emerald-600 text-xs font-bold mt-2">
                                <ArrowUp size={14} className="mr-1" /> 8% <span className="text-slate-400 font-medium ml-1">from last month</span>
                            </div>
                            <div className="w-full h-px bg-slate-100 my-4"></div>
                            <div className="flex justify-between items-center text-sm">
                                <div>
                                    <span className="text-slate-500 text-xs">Collected</span>
                                    <p className="font-bold text-slate-800">₹ {mockDues.collected}</p>
                                </div>
                                <div className="w-px h-8 bg-slate-100"></div>
                                <div>
                                    <span className="text-slate-500 text-xs">Pending</span>
                                    <p className="font-bold text-slate-800">₹ {mockDues.pending}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
                        {/* Course Wise Section */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <div className="flex items-center gap-2">
                                    <GraduationCap className="text-blue-600" size={20} />
                                    <h3 className="font-bold text-slate-900 text-base">Course Wise</h3>
                                </div>
                                <button className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">View All</button>
                            </div>
                            
                            <div className="flex-1 overflow-y-auto pr-2 space-y-5 custom-scrollbar">
                                {stats.courseBreakdown && stats.courseBreakdown.length > 0 ? (
                                    stats.courseBreakdown.map((item, idx) => {
                                        const maxCount = Math.max(...stats.courseBreakdown.map(c => c.count));
                                        const percentage = (item.count / maxCount) * 100;
                                        return (
                                            <div key={idx} className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-sm font-bold text-slate-800">{item.course}</span>
                                                    <div className="flex flex-col items-end">
                                                        <span className="text-sm font-black text-slate-900">{item.count}</span>
                                                        <span className="text-[10px] text-slate-400 font-medium">Students</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                    <div className="bg-blue-400 h-1.5 rounded-full" style={{ width: `${percentage}%` }}></div>
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
                                        <div key={idx} className="flex flex-col gap-1.5">
                                            <div className="flex justify-between items-center">
                                                <span className="text-sm font-bold text-slate-800">{item.course}</span>
                                                <div className="flex flex-col items-end">
                                                    <span className="text-sm font-black text-slate-900 leading-none">{item.count}</span>
                                                    <span className="text-[10px] text-slate-400 font-medium">Students</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                <div className="bg-blue-300 h-1.5 rounded-full" style={{ width: `${item.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
                            
                            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-2">
                                    <Users size={16} />
                                    <span className="text-sm font-medium">Total Students</span>
                                </div>
                                <span className="text-lg font-black text-blue-600">{stats.totalPassengers || 419}</span>
                            </div>
                        </div>

                        {/* Route Analytics Section */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <div className="flex items-center gap-2">
                                    <Map className="text-blue-600" size={20} />
                                    <h3 className="font-bold text-slate-900 text-base">Route Analytics</h3>
                                </div>
                                <button className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">View All</button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 space-y-4 custom-scrollbar">
                                {stats.routeBreakdown && stats.routeBreakdown.length > 0 ? (
                                    stats.routeBreakdown.map((route, idx) => (
                                        <div key={idx} className="flex items-start justify-between gap-3 pb-3 border-b border-slate-50 last:border-0">
                                            <div className="bg-blue-100 text-blue-600 text-xs font-bold py-1 px-2 rounded">
                                                #{idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-bold text-slate-800 leading-tight pr-2 truncate whitespace-normal line-clamp-2">{route.route_name}</h4>
                                                <span className="text-[10px] text-slate-400 font-medium">ID: {route.route_id}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-slate-900 leading-none">{route.count}</span>
                                                <span className="text-[10px] text-slate-400 font-medium">Passengers</span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    [
                                        { id: "R13", name: "Ramachandrapuram, Ooduru Via Velangi, Nadakuduru", count: 30 },
                                        { id: "R07", name: "Konapapeta, U.Kothapalli, Uppada Via Rayudupalem", count: 28 },
                                        { id: "R26", name: "Unduru, Panasapadu, Subbaiah Hotel, Gandhi Nagar, Gati Center Via MSN", count: 27 },
                                        { id: "R23", name: "Kakinada Local- SP Office, Dairform, Kalpana, Via Main Road", count: 24 }
                                    ].map((route, idx) => (
                                        <div key={idx} className="flex items-start justify-between gap-3 pb-3 border-b border-slate-50 last:border-0">
                                            <div className="bg-blue-100 text-blue-600 text-xs font-bold py-1 px-2 rounded">
                                                #{idx + 1}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <h4 className="text-sm font-bold text-slate-800 leading-tight pr-2 truncate whitespace-normal line-clamp-2">{route.name}</h4>
                                                <span className="text-[10px] text-slate-400 font-medium">ID: {route.id}</span>
                                            </div>
                                            <div className="flex flex-col items-end">
                                                <span className="text-sm font-black text-slate-900 leading-none">{route.count}</span>
                                                <span className="text-[10px] text-slate-400 font-medium">Passengers</span>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-2">
                                    <Activity size={16} />
                                    <span className="text-sm font-medium">Total Coverage</span>
                                </div>
                                <span className="text-lg font-black text-blue-600">{stats.totalDistance || 1696} km</span>
                            </div>
                        </div>

                        {/* Stage Breakdown Section */}
                        <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 flex flex-col h-[400px]">
                            <div className="flex justify-between items-center mb-6">
                                <div className="flex items-center gap-2">
                                    <MapPin className="text-blue-600" size={20} />
                                    <h3 className="font-bold text-slate-900 text-base">Stage Breakdown</h3>
                                </div>
                                <button className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">View All</button>
                            </div>

                            <div className="flex-1 overflow-y-auto pr-2 space-y-5 custom-scrollbar">
                                {stats.stageBreakdown && stats.stageBreakdown.length > 0 ? (
                                    stats.stageBreakdown.slice(0,5).map((stage, idx) => {
                                        const maxCount = Math.max(...stats.stageBreakdown.map(s => s.count));
                                        const percentage = (stage.count / maxCount) * 100;
                                        return (
                                            <div key={idx} className="flex flex-col gap-1.5">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex-1 pr-3">
                                                        <h4 className="text-xs font-bold text-slate-800 leading-tight uppercase truncate whitespace-normal line-clamp-1">{stage.stage_name}</h4>
                                                        <p className="text-[10px] text-slate-400 truncate whitespace-normal line-clamp-1">{stage.route_name}</p>
                                                    </div>
                                                    <div className="flex flex-col items-end shrink-0">
                                                        <span className="text-sm font-black text-slate-900 leading-none">{stage.count}</span>
                                                        <span className="text-[10px] text-slate-400 font-medium">Students</span>
                                                    </div>
                                                </div>
                                                <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                    <div className="bg-blue-300 h-1.5 rounded-full" style={{ width: `${percentage}%` }}></div>
                                                </div>
                                            </div>
                                        );
                                    })
                                ) : (
                                    [
                                        { name: "DAIRYFORM CENTRE-KKD", desc: "Kakinada Local - SP Office, Dairtform, Kalpana, Via Main Road", count: 14, pct: 100 },
                                        { name: "VAKALAPUDI JN", desc: "Kakinada Local - Vakalapudi", count: 11, pct: 80 },
                                        { name: "KARAPA MAIN CNTR", desc: "Ramachandrapuram, Ooduru Via Velangi, Nadakuduru", count: 8, pct: 60 },
                                        { name: "T.KOTHAPALLI", desc: "T.Kothapalli Via Guttendevi, Yanam, Neelapalli", count: 7, pct: 50 },
                                        { name: "JAGGAMPETA(BABA TMP)", desc: "Jaggampeta Via Peddapuram", count: 7, pct: 50 }
                                    ].map((stage, idx) => (
                                        <div key={idx} className="flex flex-col gap-1.5">
                                            <div className="flex justify-between items-start">
                                                <div className="flex-1 pr-3">
                                                    <h4 className="text-xs font-bold text-slate-800 leading-tight uppercase truncate whitespace-normal line-clamp-1">{stage.name}</h4>
                                                    <p className="text-[10px] text-slate-400 truncate whitespace-normal line-clamp-1">{stage.desc}</p>
                                                </div>
                                                <div className="flex flex-col items-end shrink-0">
                                                    <span className="text-sm font-black text-slate-900 leading-none">{stage.count}</span>
                                                    <span className="text-[10px] text-slate-400 font-medium">Students</span>
                                                </div>
                                            </div>
                                            <div className="w-full bg-slate-100 rounded-full h-1.5">
                                                <div className="bg-blue-300 h-1.5 rounded-full" style={{ width: `${stage.pct}%` }}></div>
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>

                            <div className="mt-4 pt-4 border-t border-slate-100 flex justify-between items-center">
                                <div className="flex items-center text-slate-500 gap-2">
                                    <Users size={16} />
                                    <span className="text-sm font-medium">Total Stages</span>
                                </div>
                                <span className="text-lg font-black text-blue-600">{stats.stageBreakdown?.length || 47}</span>
                            </div>
                        </div>
                    </div>

                    {/* Recent Activity Section */}
                    <div className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100">
                        <div className="flex justify-between items-center mb-6">
                            <div className="flex items-center gap-2">
                                <Clock className="text-blue-600" size={20} />
                                <h3 className="font-bold text-slate-900 text-base">Recent Activity</h3>
                            </div>
                            <button className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1.5 rounded-lg hover:bg-blue-100 transition-colors">View All Activity</button>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                            {mockActivity.map((activity, idx) => (
                                <div key={idx} className="flex items-start gap-4 p-3 lg:border-r lg:border-slate-100 last:border-r-0">
                                    <div className={`w-10 h-10 rounded-full text-white flex items-center justify-center shrink-0 shadow-sm ${activity.color}`}>
                                        {activity.icon}
                                    </div>
                                    <div>
                                        <h4 className="text-sm font-bold text-slate-900">{activity.title}</h4>
                                        <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">{activity.desc}</p>
                                        <p className="text-[10px] text-slate-400 mt-1 font-medium">{activity.time}</p>
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
