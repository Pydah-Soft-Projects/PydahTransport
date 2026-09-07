import React, { useState, useEffect } from 'react';
import { Search, User, MapPin, ChevronRight, Ticket, Filter } from 'lucide-react';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';

const Concessions = () => {
    const [concessions, setConcessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [filters, setFilters] = useState({ course: '', route_id: '', search: '', page: 1, limit: 10 });
    const [pagination, setPagination] = useState({ total: 0, pages: 0, currentPage: 1 });
    const [courses, setCourses] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [expandedRowId, setExpandedRowId] = useState(null);

    useEffect(() => {
        fetchMetadata();
    }, []);

    useEffect(() => {
        fetchConcessions();
    }, [filters]);

    const fetchMetadata = async () => {
        try {
            const [coursesRes, routesRes] = await Promise.all([
                apiFetch(`${API_BASE}/students/courses`),
                apiFetch(`${API_BASE}/routes`)
            ]);
            setCourses(await coursesRes.json());
            setRoutes(await routesRes.json());
        } catch (error) {
            console.error('Error fetching metadata:', error);
        }
    };

    const fetchConcessions = async () => {
        setLoading(true);
        try {
            const query = new URLSearchParams(filters).toString();
            const response = await apiFetch(`${API_BASE}/transport-requests/concessions?${query}`);
            const result = await response.json();
            setConcessions(result.data || []);
            setPagination(result.pagination || { total: 0, pages: 0, currentPage: 1 });
        } catch (error) {
            console.error('Error fetching concessions:', error);
        } finally {
            setLoading(false);
        }
    };

    return (
        <Layout>
            {/* Page Header (Desktop title, hidden on mobile below top bar) */}
            <div className="mb-6 hidden md:block">
                <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                    <Ticket className="text-blue-600" size={24} />
                    Concessions Management
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">Manage and review student fee concessions and revised fares across academic years.</p>
            </div>

            {/* Filter controls panel */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-3 sm:p-4 mb-6">
                <div className="flex flex-col sm:grid sm:grid-cols-3 gap-2.5 sm:gap-3 items-end">
                    {/* Search student (Row 1 on mobile) */}
                    <div className="w-full space-y-1">
                        <label className="hidden md:block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Search Student</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Search student..."
                                value={filters.search}
                                onChange={(e) => setFilters(prev => ({ ...prev, search: e.target.value, page: 1 }))}
                                className="w-full bg-slate-50 hover:bg-slate-100 focus:bg-white border border-slate-200 rounded-xl pl-8 pr-3 py-2 sm:py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                            <Search className="absolute left-2.5 top-3 sm:top-2.5 text-slate-400" size={13} />
                        </div>
                    </div>

                    {/* Other filters in a single row on mobile (Row 2 on mobile) */}
                    <div className="w-full grid grid-cols-2 sm:contents gap-2.5 sm:gap-3">
                        {/* Course Filter */}
                        <div className="space-y-1">
                            <label className="hidden md:block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Course</label>
                            <select
                                value={filters.course}
                                onChange={(e) => setFilters(prev => ({ ...prev, course: e.target.value, page: 1 }))}
                                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-2 sm:py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            >
                                <option value="">All Courses</option>
                                {courses.map(c => (
                                    <option key={c.id || c.name} value={c.name}>{c.name}</option>
                                ))}
                            </select>
                        </div>

                        {/* Route Filter */}
                        <div className="space-y-1">
                            <label className="hidden md:block text-[9px] font-bold text-slate-400 uppercase tracking-wider">Route</label>
                            <select
                                value={filters.route_id}
                                onChange={(e) => setFilters(prev => ({ ...prev, route_id: e.target.value, page: 1 }))}
                                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-2.5 py-2 sm:py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            >
                                <option value="">All Routes</option>
                                {routes.map(r => (
                                    <option key={r._id || r.id} value={r.routeId}>{r.routeName}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </div>

            {message.text && (
                <div className={`mb-6 p-4 rounded-xl border ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {message.text}
                </div>
            )}

            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {/* Desktop Table View */}
                <div className="hidden md:block overflow-x-auto">
                    <table className="w-full text-left border-collapse min-w-[720px]">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-100 text-[10px] uppercase text-slate-400 font-bold tracking-wider">
                                <th className="p-4 w-10"></th>
                                <th className="p-4">Student Name</th>
                                <th className="p-4">Admission No</th>
                                <th className="p-4">Current Year</th>
                                {[1, 2, 3, 4].map(y => (
                                    <th key={y} className="p-4 text-center">Y{y} Concession</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-50 text-xs text-slate-700">
                            {loading ? (
                                <tr>
                                    <td colSpan="8" className="p-10">
                                        <Loader text="Loading concessions data..." />
                                    </td>
                                </tr>
                            ) : concessions.length === 0 ? (
                                <tr>
                                    <td colSpan="8" className="p-10 text-center text-slate-400">No approved transport requests found.</td>
                                </tr>
                            ) : (
                                concessions.map(c => (
                                    <React.Fragment key={c.id}>
                                        <tr className={`hover:bg-slate-50/60 transition-colors cursor-pointer ${expandedRowId === c.id ? 'bg-blue-50/30' : ''}`} 
                                            onClick={() => setExpandedRowId(expandedRowId === c.id ? null : c.id)}>
                                            <td className="p-4">
                                                <div className={`transition-transform duration-200 ${expandedRowId === c.id ? 'rotate-90 text-blue-600' : 'text-slate-400'}`}>
                                                    <ChevronRight size={16} />
                                                </div>
                                            </td>
                                            <td className="p-4 font-bold text-slate-900">{c.student_name}</td>
                                            <td className="p-4 font-mono text-[11px] text-slate-500">{c.admission_number}</td>
                                            <td className="p-4">
                                                <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-md text-[10px] font-bold">
                                                    Year {c.student_year || '—'}
                                                </span>
                                            </td>
                                            {[1, 2, 3, 4].map(year => {
                                                const isAvailable = year <= c.total_course_years;
                                                const isCurrentYear = Number(year) === Number(c.student_year);
                                                const conInfo = c.yearConcessions ? c.yearConcessions[year] : undefined;
                                                const isConcession = conInfo !== undefined && conInfo !== null;
                                                const amount = conInfo && typeof conInfo === 'object' ? conInfo.amount : conInfo;
                                                const type = conInfo && typeof conInfo === 'object' ? conInfo.concessionType : 'REVISED';

                                                return (
                                                    <td key={year} className="p-4 text-center relative group">
                                                        {isAvailable && isConcession ? (
                                                            <>
                                                                <span 
                                                                    className={`inline-flex flex-col items-center px-3 py-1.5 rounded-lg text-xs font-bold border ${
                                                                        isCurrentYear
                                                                            ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-200 bg-blue-50 text-blue-700'
                                                                            : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                                    }`}
                                                                >
                                                                    <span>{type === 'CONCESSION' ? `-₹${amount}` : `₹${amount}`}</span>
                                                                    <span className="text-[8px] font-extrabold uppercase tracking-wider opacity-75 mt-0.5">
                                                                        {type === 'CONCESSION' ? 'Concession' : 'Revised'}
                                                                    </span>
                                                                </span>
                                                                {isCurrentYear && (
                                                                    <div className="absolute top-1 right-1">
                                                                        <span className="flex h-2 w-2">
                                                                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                                                            <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </>
                                                        ) : (
                                                            <span className="text-slate-300">—</span>
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                        {expandedRowId === c.id && (
                                            <tr className="bg-blue-50/20">
                                                <td colSpan="8" className="p-5">
                                                    <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Route Details</div>
                                                            <div className="text-xs font-bold text-slate-700">{c.route_name}</div>
                                                            <div className="text-[11px] text-slate-400">Route ID: {c.route_id}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Stage Name</div>
                                                            <div className="text-xs font-bold text-slate-700">{c.stage_name}</div>
                                                        </div>
                                                        <div>
                                                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Standard Fare</div>
                                                            <div className="text-xs font-bold text-slate-400 line-through">₹{c.original_fare}</div>
                                                        </div>
                                                        <div className="flex justify-end items-center">
                                                            <div className="text-right">
                                                                <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1">Last Updated</div>
                                                                <div className="text-xs text-slate-500 font-mono">{new Date(c.updated_at).toLocaleDateString()}</div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Mobile Card List View */}
                <div className="block md:hidden divide-y divide-slate-100">
                    {loading ? (
                        <div className="p-10">
                            <Loader text="Loading concessions data..." />
                        </div>
                    ) : concessions.length === 0 ? (
                        <div className="p-10 text-center text-slate-400 text-xs">
                            No approved transport requests found.
                        </div>
                    ) : (
                        concessions.map((c) => {
                            const isExpanded = expandedRowId === c.id;
                            return (
                                <div key={c.id} className="p-3.5 space-y-3 bg-white">
                                    {/* Header Row: Student Name & Expand Toggle */}
                                    <div 
                                        onClick={() => setExpandedRowId(isExpanded ? null : c.id)}
                                        className="flex items-start justify-between gap-2 cursor-pointer"
                                    >
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <div className="w-9 h-9 rounded-full bg-blue-50 text-blue-600 font-bold flex items-center justify-center shrink-0 text-xs">
                                                <User size={16} />
                                            </div>
                                            <div className="min-w-0">
                                                <h4 className="font-bold text-slate-900 text-xs leading-snug truncate">{c.student_name}</h4>
                                                <p className="text-[10px] font-semibold text-slate-400 font-mono">
                                                    ADM: {c.admission_number}
                                                </p>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="bg-blue-50 text-blue-700 border border-blue-100 px-2 py-0.5 rounded-md text-[10px] font-extrabold">
                                                Year {c.student_year || '—'}
                                            </span>
                                            <div className={`p-1 text-slate-400 transition-transform duration-200 ${isExpanded ? 'rotate-90 text-blue-600' : ''}`}>
                                                <ChevronRight size={16} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Year Concessions Quick Badges Grid */}
                                    <div className="grid grid-cols-4 gap-1.5 pt-1">
                                        {[1, 2, 3, 4].map((year) => {
                                            const isAvailable = year <= c.total_course_years;
                                            const isCurrentYear = Number(year) === Number(c.student_year);
                                            const conInfo = c.yearConcessions ? c.yearConcessions[year] : undefined;
                                            const isConcession = conInfo !== undefined && conInfo !== null;
                                            const amount = conInfo && typeof conInfo === 'object' ? conInfo.amount : conInfo;
                                            const type = conInfo && typeof conInfo === 'object' ? conInfo.concessionType : 'REVISED';

                                            return (
                                                <div key={year} className="text-center">
                                                    <span className="text-[8px] font-extrabold uppercase tracking-wider text-slate-400 block mb-0.5">Y{year}</span>
                                                    {isAvailable && isConcession ? (
                                                        <div className={`p-1.5 rounded-xl border text-[10px] font-bold flex flex-col items-center justify-center relative ${
                                                            isCurrentYear 
                                                                ? 'ring-2 ring-blue-500 ring-offset-1 border-blue-200 bg-blue-50 text-blue-700' 
                                                                : 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                                        }`}>
                                                            <span>{type === 'CONCESSION' ? `-₹${amount}` : `₹${amount}`}</span>
                                                            <span className="text-[7px] font-black uppercase tracking-wider opacity-80 mt-0.5">
                                                                {type === 'CONCESSION' ? 'Concession' : 'Revised'}
                                                            </span>
                                                            {isCurrentYear && (
                                                                <span className="absolute -top-1 -right-1 flex h-2 w-2">
                                                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-600"></span>
                                                                </span>
                                                            )}
                                                        </div>
                                                    ) : (
                                                        <div className="p-1.5 rounded-xl border border-slate-100 bg-slate-50 text-slate-300 text-xs">
                                                            —
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Expanded Details Inset */}
                                    {isExpanded && (
                                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-2 text-xs animate-in fade-in duration-200">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Route Name</span>
                                                    <p className="font-bold text-slate-800 text-[11px] flex items-center gap-1 mt-0.5 truncate">
                                                        <MapPin size={12} className="text-slate-400 shrink-0" />
                                                        {c.route_name || 'N/A'}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400 font-medium">Route ID: {c.route_id || '—'}</p>
                                                </div>
                                                <div>
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider block">Stage & Fare</span>
                                                    <p className="font-bold text-slate-800 text-[11px] mt-0.5 truncate">{c.stage_name || '—'}</p>
                                                    <p className="text-[10px] text-slate-400 line-through">Standard: ₹{c.original_fare || 0}</p>
                                                </div>
                                            </div>

                                            {c.updated_at && (
                                                <div className="pt-2 border-t border-slate-200/60 flex items-center justify-between text-[10px] text-slate-400">
                                                    <span className="font-semibold">Last Updated:</span>
                                                    <span className="font-mono">{new Date(c.updated_at).toLocaleDateString()}</span>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Pagination Controls */}
                <div className="px-4 py-3 sm:px-6 sm:py-4 bg-slate-50 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left">
                    <div className="text-xs font-semibold text-slate-500">
                        Showing <span className="text-slate-900 font-bold">{concessions.length}</span> of <span className="text-slate-900 font-bold">{pagination.total}</span> records
                    </div>
                    
                    <div className="flex items-center gap-2 w-full sm:w-auto justify-center">
                        <button
                            disabled={filters.page <= 1 || loading}
                            onClick={() => setFilters(prev => ({ ...prev, page: prev.page - 1 }))}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors text-xs font-bold"
                        >
                            Previous
                        </button>

                        <div className="flex items-center gap-1">
                            {[...Array(pagination.pages)].map((_, i) => {
                                const p = i + 1;
                                // Show only current page, first, last, and neighbors
                                if (p === 1 || p === pagination.pages || (p >= filters.page - 1 && p <= filters.page + 1)) {
                                    return (
                                        <button
                                            key={p}
                                            onClick={() => setFilters(prev => ({ ...prev, page: p }))}
                                            className={`w-8 h-8 rounded-xl text-xs font-bold transition-all ${
                                                filters.page === p 
                                                    ? 'bg-blue-600 text-white shadow-xs' 
                                                    : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
                                            }`}
                                        >
                                            {p}
                                        </button>
                                    );
                                } else if (p === filters.page - 2 || p === filters.page + 2) {
                                    return <span key={p} className="text-slate-400 text-xs">...</span>;
                                }
                                return null;
                            })}
                        </div>

                        <button
                            disabled={filters.page >= pagination.pages || loading}
                            onClick={() => setFilters(prev => ({ ...prev, page: prev.page + 1 }))}
                            className="px-3 py-1.5 rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 disabled:opacity-40 transition-colors text-xs font-bold"
                        >
                            Next
                        </button>
                    </div>
                </div>
            </div>
        </Layout>
    );
};

export default Concessions;
