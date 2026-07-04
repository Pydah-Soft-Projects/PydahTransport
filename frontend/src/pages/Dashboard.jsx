import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import {
    Bus,
    Map,
    Users,
    Bell,
    Zap
} from 'lucide-react';
import { apiFetch } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

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

    const allowedCampuses = isSuperAdmin
        ? campuses
        : campuses.filter(c => userCampuses.includes(c._id));

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
            setSelectedCampus(userCampuses[0]);
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

    return (
        <Layout>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 border-b border-slate-100 pb-4">
                <div>
                    <h2 className="text-2xl font-bold break-words tracking-tight text-slate-900">Dashboard Overview</h2>
                    <p className="text-slate-500 text-sm font-medium">Insights and analytics for transport management.</p>
                </div>
                <div className="flex items-center gap-2.5 self-stretch sm:self-auto">
                    {allowedCampuses.length > 0 && (
                        <>
                            <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Campus</span>
                            <select
                                value={selectedCampus}
                                onChange={(e) => setSelectedCampus(e.target.value)}
                                className="bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 pr-8 shadow-sm transition-all cursor-pointer hover:border-slate-300 mr-2"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={campus._id} value={campus._id}>
                                        {campus.name}
                                    </option>
                                ))}
                            </select>
                        </>
                    )}
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">Academic Year</span>
                    <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        className="bg-white border border-slate-200 text-slate-700 text-sm font-semibold rounded-lg focus:ring-blue-500 focus:border-blue-500 p-2 pr-8 shadow-sm transition-all cursor-pointer hover:border-slate-300"
                    >
                        {getAcademicYearOptions().map((option) => (
                            <option key={option} value={option}>
                                {option}
                            </option>
                        ))}
                    </select>
                </div>
            </div>

            {loading ? (
                <div className="min-h-[400px] flex items-center justify-center">
                    <Loader size={48} text="Loading dashboard analytics..." />
                </div>
            ) : (
                <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-6">
                        {/* Total Buses Card */}
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-all duration-300 relative overflow-hidden group h-[140px]">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-50 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110"></div>
                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className="flex justify-between items-center">
                                    <div className="p-2 bg-emerald-100 rounded-lg text-emerald-600">
                                        <Bus size={20} />
                                    </div>
                                    <span className="bg-emerald-50 text-emerald-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Active</span>
                                </div>
                                <div>
                                    <h3 className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-0.5">Total Buses</h3>
                                    <p className="text-3xl font-bold text-slate-900 leading-none">{stats.buses}</p>
                                </div>
                                <p className="text-emerald-600 text-[11px] font-medium flex items-center">
                                    <span className="mr-1">●</span> Fleet Operational
                                </p>
                            </div>
                        </div>

                        {/* Total Routes Card */}
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-all duration-300 relative overflow-hidden group h-[140px]">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-blue-50 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110"></div>
                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className="flex justify-between items-center">
                                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                                        <Map size={20} />
                                    </div>
                                    <span className="bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Network</span>
                                </div>
                                <div>
                                    <h3 className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-0.5">Total Routes</h3>
                                    <p className="text-3xl font-bold text-slate-900 leading-none">{stats.routes}</p>
                                </div>
                                <p className="text-blue-600 text-[11px] font-medium flex items-center">
                                    <span className="font-bold mr-1">{stats.totalDistance} km</span> coverage
                                </p>
                            </div>
                        </div>

                        {/* Daily Passengers Card */}
                        <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-100 hover:shadow-md transition-all duration-300 relative overflow-hidden group h-[140px]">
                            <div className="absolute top-0 right-0 w-24 h-24 bg-purple-50 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110"></div>
                            <div className="relative z-10 flex flex-col h-full justify-between">
                                <div className="flex justify-between items-center">
                                    <div className="p-2 bg-purple-100 rounded-lg text-purple-600">
                                        <Users size={20} />
                                    </div>
                                    <span className="bg-purple-50 text-purple-700 text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider">Total</span>
                                </div>
                                <div>
                                    <h3 className="text-slate-400 text-[11px] font-bold uppercase tracking-widest mb-0.5">Passengers</h3>
                                    <p className="text-3xl font-bold text-slate-900 leading-none">{stats.totalPassengers}</p>
                                </div>
                                <p className="text-purple-600 text-[11px] font-medium flex items-center">
                                    <span className="mr-1">●</span> Approved Requests
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
                        {/* Course Breakdown Section */}
                        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-6 hover:shadow-lg transition-shadow">
                            <h3 className="text-lg font-bold text-slate-900 mb-4 border-b border-slate-100 pb-3 flex items-center justify-between">
                                <div className="flex items-center">
                                    <span className="bg-emerald-100 text-emerald-600 p-2 rounded-lg mr-2.5">
                                        <Users size={20} />
                                    </span>
                                    Course Wise
                                </div>
                            </h3>
                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                {stats.courseBreakdown.length > 0 ? (
                                    stats.courseBreakdown.map((item, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-100 gap-3">
                                            <p className="font-bold text-slate-700 text-xs flex-1">{item.course}</p>
                                            <div className="px-2.5 py-1 bg-white rounded-lg shadow-sm border border-slate-100 min-w-[50px] text-center">
                                                <span className="text-xs font-black text-emerald-700">{item.count}</span>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-slate-50/50 rounded-xl border-dashed border-2 border-slate-200">
                                        <p className="font-medium text-xs">No course data.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Route Breakdown Section */}
                        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-6 hover:shadow-lg transition-shadow">
                            <h3 className="text-lg font-bold text-slate-900 mb-4 border-b border-slate-100 pb-3 flex items-center justify-between">
                                <div className="flex items-center">
                                    <span className="bg-blue-100 text-blue-600 p-2 rounded-lg mr-2.5">
                                        <Map size={20} />
                                    </span>
                                    Route Analytics
                                </div>
                                <span className="text-[10px] font-bold text-slate-400 uppercase">Passengers</span>
                            </h3>
                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                {stats.routeBreakdown.length > 0 ? (
                                    stats.routeBreakdown.map((route, idx) => (
                                        <div 
                                            key={idx} 
                                            onClick={() => setSelectedRouteId(selectedRouteId === route.route_id ? null : route.route_id)}
                                            className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all duration-200 border ${
                                                selectedRouteId === route.route_id 
                                                ? 'bg-blue-600 border-blue-600 shadow-md transform scale-[1.02]' 
                                                : 'bg-slate-50 border-transparent hover:bg-blue-50 hover:border-blue-100'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className={`w-7 h-7 flex items-center justify-center rounded-lg shadow-sm font-bold text-[10px] ${
                                                    selectedRouteId === route.route_id ? 'bg-white text-blue-600' : 'bg-white text-blue-600'
                                                }`}>
                                                    #{idx + 1}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <p className={`font-bold text-xs ${selectedRouteId === route.route_id ? 'text-white' : 'text-slate-800'}`}>
                                                        {route.route_name}
                                                    </p>
                                                    <p className={`text-[9px] font-medium ${selectedRouteId === route.route_id ? 'text-blue-100' : 'text-slate-500'}`}>
                                                        ID: {route.route_id}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="text-right">
                                                    <p className={`text-base font-black leading-none ${selectedRouteId === route.route_id ? 'text-white' : 'text-slate-900'}`}>
                                                        {route.count}
                                                    </p>
                                                </div>
                                                <div className={`h-6 w-0.5 rounded-full ${selectedRouteId === route.route_id ? 'bg-white/30' : 'bg-blue-200'}`}></div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-slate-50/50 rounded-xl border-dashed border-2 border-slate-200">
                                        <p className="font-medium text-xs">No route data.</p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Stage Breakdown Section */}
                        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-6 hover:shadow-lg transition-shadow">
                            <h3 className="text-lg font-bold text-slate-900 mb-4 border-b border-slate-100 pb-3 flex items-center justify-between">
                                <div className="flex items-center">
                                    <span className="bg-purple-100 text-purple-600 p-2 rounded-lg mr-2.5">
                                        <Users size={20} />
                                    </span>
                                    Stage Breakdown
                                </div>
                                {selectedRouteId ? (
                                    <button 
                                        onClick={() => setSelectedRouteId(null)}
                                        className="text-[10px] font-bold text-purple-600 hover:text-purple-800 uppercase bg-purple-50 px-2 py-1 rounded-md transition-colors"
                                    >
                                        Clear Filter
                                    </button>
                                ) : (
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">Density</span>
                                )}
                            </h3>
                            <div className="space-y-3 max-h-[300px] overflow-y-auto pr-1 custom-scrollbar">
                                {stats.stageBreakdown.filter(s => !selectedRouteId || s.route_id === selectedRouteId).length > 0 ? (
                                    stats.stageBreakdown
                                        .filter(s => !selectedRouteId || s.route_id === selectedRouteId)
                                        .map((stage, idx) => (
                                        <div key={idx} className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl hover:bg-purple-50 transition-colors border border-transparent hover:border-purple-100 gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-bold text-slate-800 text-xs">{stage.stage_name}</p>
                                                <p className="text-[9px] text-slate-500 font-medium">{stage.route_name}</p>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <div className="px-2 py-0.5 bg-white rounded-md shadow-sm border border-slate-100">
                                                    <span className="text-xs font-black text-purple-700">{stage.count}</span>
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                ) : (
                                    <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-slate-50/50 rounded-xl border-dashed border-2 border-slate-200">
                                        <p className="font-medium text-xs">No stage data.</p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Recent Alerts Section */}
                        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-8 hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4 flex items-center">
                                <span className="bg-red-100 text-red-600 p-2 rounded-lg mr-3">
                                    <Bell size={24} />
                                </span>
                                Recent Alerts
                            </h3>
                            <div className="flex flex-col items-center justify-center h-48 text-slate-400 bg-slate-50/50 rounded-xl border-dashed border-2 border-slate-200">
                                <p className="font-medium">No recent alerts available.</p>
                            </div>
                        </div>

                        {/* Quick Actions Section */}
                        <div className="bg-white rounded-2xl shadow-md border border-slate-100 p-8 hover:shadow-lg transition-shadow">
                            <h3 className="text-xl font-bold text-slate-900 mb-6 border-b border-slate-100 pb-4 flex items-center">
                                <span className="bg-indigo-100 text-indigo-600 p-2 rounded-lg mr-3">
                                    <Zap size={24} />
                                </span>
                                Quick Actions
                            </h3>
                            <div className="grid grid-cols-2 gap-4">
                                <a href="/buses" className="p-6 bg-slate-50 rounded-xl hover:bg-emerald-50 hover:text-emerald-700 transition-all text-left group border border-slate-100 hover:border-emerald-200 hover:shadow-md block">
                                    <span className="mb-3 block group-hover:scale-110 transition-transform text-emerald-600">
                                        <Bus size={32} />
                                    </span>
                                    <span className="font-bold text-slate-700 group-hover:text-emerald-700 block text-lg">Add Bus</span>
                                    <span className="text-xs text-slate-500 group-hover:text-emerald-600">Register new vehicle</span>
                                </a>
                                <a href="/routes" className="p-6 bg-slate-50 rounded-xl hover:bg-blue-50 hover:text-blue-700 transition-all text-left group border border-slate-100 hover:border-blue-200 hover:shadow-md block">
                                    <span className="mb-3 block group-hover:scale-110 transition-transform text-blue-600">
                                        <Map size={32} />
                                    </span>
                                    <span className="font-bold text-slate-700 group-hover:text-blue-700 block text-lg">New Route</span>
                                    <span className="text-xs text-slate-500 group-hover:text-blue-600">Create transport path</span>
                                </a>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </Layout>
    );
};

export default Dashboard;
