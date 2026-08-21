import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { RefreshCw, Search, CheckCircle2, User, MapPin, GraduationCap, Clock, Bus, Check, AlertTriangle, XCircle, X, Users } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions, getPreviousAcademicYear } from '../utils/academicYear';

const statusDisplay = (s) => (s || 'pending').charAt(0).toUpperCase() + (s || 'pending').slice(1);
const formatFare = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const Renewals = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();

    // Current user context
    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const admin = {
        name: adminInfo.name || adminInfo.username || 'Admin',
        id: adminInfo.id || 1,
    };

    // Filter states
    const academicYearOptions = getAcademicYearOptions();
    const currentYear = getDefaultAcademicYear();
    const defaultExpiredYear = getPreviousAcademicYear(currentYear);

    const [expiredYear, setExpiredYear] = useState(() => searchParams.get('expiredYear') || defaultExpiredYear);
    const [targetYear, setTargetYear] = useState(() => searchParams.get('targetYear') || currentYear);
    const [routeFilter, setRouteFilter] = useState(() => searchParams.get('route') || '');
    const [courseFilter, setCourseFilter] = useState(() => searchParams.get('course') || '');
    const [searchQuery, setSearchQuery] = useState(() => searchParams.get('search') || '');
    const [renewalStatusFilter, setRenewalStatusFilter] = useState(() => searchParams.get('status') || '');

    // Pagination
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Apply filters coming from dashboard / shared links
    useEffect(() => {
        setExpiredYear(searchParams.get('expiredYear') || defaultExpiredYear);
        setTargetYear(searchParams.get('targetYear') || currentYear);
        setRouteFilter(searchParams.get('route') || '');
        setCourseFilter(searchParams.get('course') || '');
        setSearchQuery(searchParams.get('search') || '');
        setRenewalStatusFilter(searchParams.get('status') || '');
        setCurrentPage(1);
    }, [searchParams]);

    const syncFiltersToUrl = (next = {}) => {
        const params = new URLSearchParams();
        const nextExpired = next.expiredYear ?? expiredYear;
        const nextTarget = next.targetYear ?? targetYear;
        const nextRoute = next.routeFilter ?? routeFilter;
        const nextCourse = next.courseFilter ?? courseFilter;
        const nextSearch = next.searchQuery ?? searchQuery;
        const nextStatus = next.renewalStatusFilter ?? renewalStatusFilter;

        if (nextExpired) params.set('expiredYear', nextExpired);
        if (nextTarget) params.set('targetYear', nextTarget);
        if (nextRoute) params.set('route', nextRoute);
        if (nextCourse) params.set('course', nextCourse);
        if (nextSearch) params.set('search', nextSearch);
        if (nextStatus) params.set('status', nextStatus);

        const qs = params.toString();
        navigate(qs ? `/renewals?${qs}` : '/renewals', { replace: true });
    };

    // Data lists
    const [requests, setRequests] = useState([]);
    const [overallRequests, setOverallRequests] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [targetRoutes, setTargetRoutes] = useState([]);
    const [courses, setCourses] = useState([]);
    const [renewedSet, setRenewedSet] = useState(new Set());

    // UI Loading states
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [message, setMessage] = useState({ text: '', type: '' });

    // Renew Modal state
    const [renewModal, setRenewModal] = useState({
        open: false,
        passenger: null,
        selectedRouteId: '',
        selectedStageName: '',
        selectedStageFare: 0,
        error: '',
        saving: false
    });

    // Approve Modal state
    const [approveModal, setApproveModal] = useState({
        open: false,
        requestId: null,
        data: null,
        selectedBusId: '',
        loading: false,
        error: null
    });

    // Fetch lists
    const fetchRoutes = async () => {
        try {
            const response = await apiFetch(`${API_BASE}/routes`);
            if (response.ok) {
                const data = await response.json();
                setRoutes(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error('Error fetching routes:', e);
        }
    };

    const fetchTargetRoutes = async (year) => {
        try {
            const response = await apiFetch(`${API_BASE}/routes?academicYear=${encodeURIComponent(year)}`);
            if (response.ok) {
                const data = await response.json();
                setTargetRoutes(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error('Error fetching target routes:', e);
        }
    };

    const fetchCourses = async () => {
        try {
            const response = await apiFetch(`${API_BASE}/students/courses`);
            if (response.ok) {
                const data = await response.json();
                setCourses(data);
            }
        } catch (e) {
            console.error('Error fetching courses:', e);
        }
    };

    // Load active/pending requests in target year to identify already renewed passengers
    const fetchTargetYearRequests = async () => {
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests?academicYear=${encodeURIComponent(targetYear)}`);
            if (response.ok) {
                const data = await response.json();
                const set = new Set();
                data.forEach((r) => {
                    if (r.admission_number && ['pending', 'approved'].includes((r.status || '').toLowerCase())) {
                        set.add(String(r.admission_number).trim());
                    }
                });
                setRenewedSet(set);
            }
        } catch (error) {
            console.error('Error fetching target year requests:', error);
        }
    };

    // Load expired requests for selected academic year
    const fetchExpiredRequests = async () => {
        setLoading(true);
        try {
            let url = `${API_BASE}/transport-requests?status=expired&academicYear=${encodeURIComponent(expiredYear)}`;
            const params = new URLSearchParams();
            if (routeFilter) params.append('route_id', routeFilter);
            if (courseFilter) params.append('course', courseFilter);
            if (searchQuery) params.append('search', searchQuery);

            const paramString = params.toString();
            if (paramString) {
                url += `&${paramString}`;
            }

            const response = await apiFetch(url);
            if (response.ok) {
                const data = await response.json();
                setRequests(data);
            } else {
                console.error('Failed to fetch expired requests');
            }
        } catch (error) {
            console.error('Error fetching expired requests:', error);
        } finally {
            setLoading(false);
        }
    };

    // Load all expired requests for the selected year to compute overall stats
    const fetchOverallStats = async () => {
        try {
            const url = `${API_BASE}/transport-requests?status=expired&academicYear=${encodeURIComponent(expiredYear)}`;
            const response = await apiFetch(url);
            if (response.ok) {
                const data = await response.json();
                setOverallRequests(data);
            }
        } catch (error) {
            console.error('Error fetching overall stats:', error);
        }
    };

    useEffect(() => {
        fetchRoutes();
        fetchCourses();
    }, []);

    useEffect(() => {
        fetchTargetYearRequests();
    }, [targetYear]);

    useEffect(() => {
        fetchExpiredRequests();
        setCurrentPage(1);
    }, [expiredYear, routeFilter, courseFilter, searchQuery]);

    useEffect(() => {
        fetchOverallStats();
    }, [expiredYear]);

    // Preload target routes when renew modal target year changes
    useEffect(() => {
        fetchTargetRoutes(targetYear);
    }, [targetYear]);

    // Handle Renew trigger
    const handleOpenRenewModal = (passenger) => {
        // Prepopulate previous route and stage
        setRenewModal({
            open: true,
            passenger,
            selectedRouteId: passenger.route_id || '',
            selectedStageName: passenger.stage_name || '',
            selectedStageFare: passenger.fare || 0,
            error: '',
            saving: false
        });
    };

    // Prepopulate fare based on selected route and stage in target year
    const handleRouteStageChange = (routeId, stageName) => {
        const matchedRoute = targetRoutes.find(r => r.routeId === routeId);
        let fare = 0;
        if (matchedRoute) {
            const matchedStage = (matchedRoute.stages || []).find(s => s.stageName === stageName);
            if (matchedStage) {
                fare = matchedStage.fare || 0;
            }
        }
        setRenewModal(prev => ({
            ...prev,
            selectedRouteId: routeId,
            selectedStageName: stageName,
            selectedStageFare: fare
        }));
    };

    // Confirm Renewal (POST)
    const handleConfirmRenewal = async () => {
        const { passenger, selectedRouteId, selectedStageName, selectedStageFare } = renewModal;
        if (!selectedRouteId || !selectedStageName) {
            setRenewModal(prev => ({ ...prev, error: 'Please select a route and stage for renewal.' }));
            return;
        }

        setRenewModal(prev => ({ ...prev, saving: true, error: '' }));
        try {
            const matchedRoute = targetRoutes.find(r => r.routeId === selectedRouteId);
            const routeName = matchedRoute ? matchedRoute.routeName : passenger.route_name;

            const response = await apiFetch(`${API_BASE}/transport-requests`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    admission_number: passenger.admission_number,
                    student_name: passenger.student_name,
                    route_id: selectedRouteId,
                    route_name: routeName,
                    stage_name: selectedStageName,
                    fare: selectedStageFare,
                    raised_by: 'admin',
                    raised_by_id: admin.id,
                    user_type: 'student',
                    academic_year: targetYear,
                })
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                const createdRequestId = data.id || data._id;
                setRenewModal({ open: false, passenger: null, selectedRouteId: '', selectedStageName: '', selectedStageFare: 0, error: '', saving: false });
                setMessage({ text: 'Renewal request created successfully in target academic year.', type: 'success' });
                
                // Refresh list data
                fetchExpiredRequests();
                fetchTargetYearRequests();

                // Open approve modal immediately to assign bus and finalize
                if (createdRequestId) {
                    openApproveModal(createdRequestId);
                }
            } else {
                setRenewModal(prev => ({ ...prev, saving: false, error: data.message || 'Failed to process renewal request.' }));
            }
        } catch (error) {
            setRenewModal(prev => ({ ...prev, saving: false, error: 'An error occurred. Please try again.' }));
        }
    };

    // Approve Modal operations
    const openApproveModal = async (requestId) => {
        setApproveModal({ open: true, requestId, data: null, selectedBusId: '', loading: true, error: null });
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${requestId}/semester-options`);
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                let defaultBusId = '';
                if (data.busesOnRoute && data.busesOnRoute.length === 1) {
                    defaultBusId = data.busesOnRoute[0].busNumber;
                }
                setApproveModal(prev => ({
                    ...prev,
                    data,
                    selectedBusId: defaultBusId,
                    loading: false,
                    error: null,
                }));
            } else {
                setApproveModal(prev => ({ ...prev, loading: false, error: data.message || 'Failed to load semester options' }));
            }
        } catch (err) {
            setApproveModal(prev => ({ ...prev, loading: false, error: 'Could not load semester options' }));
        }
    };

    const handleConfirmApprove = async () => {
        const id = approveModal.requestId;
        if (!id) return;
        
        if (approveModal.data?.busesOnRoute?.length > 0 && !approveModal.selectedBusId) {
            setApproveModal(prev => ({ ...prev, error: 'Please select a bus to assign the passenger to.' }));
            return;
        }

        setActionLoading(id);
        setApproveModal(prev => ({ ...prev, loading: true }));
        try {
            const payload = { bus_id: approveModal.selectedBusId || null };
            const response = await apiFetch(`${API_BASE}/transport-requests/${id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setMessage({
                    text: data.application_number
                        ? `Approved successfully. Application No: ${data.application_number}`
                        : 'Renewal approved successfully and transport fee created.',
                    type: 'success',
                });
                setApproveModal({ open: false, requestId: null, data: null, selectedBusId: '', loading: false, error: null });
                fetchExpiredRequests();
                fetchTargetYearRequests();
            } else {
                setApproveModal(prev => ({ ...prev, loading: false, error: data.message || 'Failed to approve' }));
            }
        } catch (err) {
            setApproveModal(prev => ({ ...prev, loading: false, error: 'Something went wrong. Please try again.' }));
        } finally {
            setActionLoading(null);
        }
    };

    // Filtered lists
    const filteredRequests = requests.filter((r) => {
        const isRenewed = renewedSet.has(String(r.admission_number).trim());
        if (renewalStatusFilter === 'renewed') return isRenewed;
        if (renewalStatusFilter === 'not_renewed') return !isRenewed;
        return true;
    });

    // Stats calculations
    const totalExpired = overallRequests.length;
    const totalRenewed = overallRequests.filter(r => renewedSet.has(String(r.admission_number).trim())).length;
    const totalPending = totalExpired - totalRenewed;

    // Pagination calculations
    const indexOfLastRow = currentPage * rowsPerPage;
    const indexOfFirstRow = indexOfLastRow - rowsPerPage;
    const currentRequests = filteredRequests.slice(indexOfFirstRow, indexOfLastRow);
    const totalPages = Math.ceil(filteredRequests.length / rowsPerPage);

    return (
        <Layout>
            {/* Header */}
            <div className="mb-6 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <RefreshCw className="text-blue-600 animate-spin-slow" size={24} />
                        Renewals Management
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Review expired transport passes from previous semesters/years and renew them for upcoming academic sessions.</p>
                </div>
            </div>

            {/* Notification messages */}
            {message.text && (
                <div className={`mb-6 p-4 rounded-xl border flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-4 duration-300 ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {message.type === 'success' ? <CheckCircle2 className="text-emerald-500 mt-0.5 shrink-0" size={20} /> : <XCircle className="text-red-500 mt-0.5 shrink-0" size={20} />}
                    <div className="flex-1 font-medium">{message.text}</div>
                    <button onClick={() => setMessage({ text: '', type: '' })} className="text-slate-400 hover:text-slate-600 transition-colors">
                        <X size={18} />
                    </button>
                </div>
            )}

            {/* Stats Panel */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center text-blue-600 shrink-0 animate-in fade-in zoom-in duration-300">
                        <Users size={20} />
                    </div>
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Expired Passengers</p>
                        <h3 className="text-lg font-bold text-slate-800 mt-0.5">{totalExpired}</h3>
                        <p className="text-[9px] text-slate-400 mt-0.5">In academic year {expiredYear}</p>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center text-emerald-600 shrink-0 animate-in fade-in zoom-in duration-300">
                        <CheckCircle2 size={20} />
                    </div>
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Renewed to {targetYear}</p>
                        <h3 className="text-lg font-bold text-emerald-700 mt-0.5">{totalRenewed}</h3>
                        <p className="text-[9px] text-emerald-600 mt-0.5 font-semibold">
                            {totalExpired > 0 ? `${Math.round((totalRenewed / totalExpired) * 100)}%` : '0%'} renewal rate
                        </p>
                    </div>
                </div>

                <div className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm flex items-center gap-3.5">
                    <div className="w-10 h-10 rounded-xl bg-amber-50 flex items-center justify-center text-amber-600 shrink-0 animate-in fade-in zoom-in duration-300">
                        <Clock size={20} />
                    </div>
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pending Renewal</p>
                        <h3 className="text-lg font-bold text-amber-700 mt-0.5">{totalPending}</h3>
                        <p className="text-[9px] text-amber-500 mt-0.5 font-semibold">Awaiting renewal request</p>
                    </div>
                </div>
            </div>

            {/* Filter controls panel */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-4 mb-6">
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3 items-end">
                    {/* Expired Year Filter */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Expired Academic Year</label>
                        <select
                            value={expiredYear}
                            onChange={(e) => {
                                const value = e.target.value;
                                setExpiredYear(value);
                                syncFiltersToUrl({ expiredYear: value });
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>

                    {/* Target Year Filter */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Target Academic Year</label>
                        <select
                            value={targetYear}
                            onChange={(e) => {
                                const value = e.target.value;
                                setTargetYear(value);
                                syncFiltersToUrl({ targetYear: value });
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>

                    {/* Route Filter */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Previous Route</label>
                        <select
                            value={routeFilter}
                            onChange={(e) => {
                                const value = e.target.value;
                                setRouteFilter(value);
                                syncFiltersToUrl({ routeFilter: value });
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            <option value="">All Routes</option>
                            {routes.map((r) => (
                                <option key={r.routeId} value={r.routeId}>{r.routeId} - {r.routeName}</option>
                            ))}
                        </select>
                    </div>

                    {/* Course Filter */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Course</label>
                        <select
                            value={courseFilter}
                            onChange={(e) => {
                                const value = e.target.value;
                                setCourseFilter(value);
                                syncFiltersToUrl({ courseFilter: value });
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            <option value="">All Courses</option>
                            {courseFilter && !courses.some((c) => c.name === courseFilter) && (
                                <option value={courseFilter}>{courseFilter}</option>
                            )}
                            {courses.map((c) => (
                                <option key={c.id} value={c.name}>{c.name}</option>
                            ))}
                        </select>
                    </div>

                    {/* Renewal Status Filter */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Renewal Status</label>
                        <select
                            value={renewalStatusFilter}
                            onChange={(e) => {
                                const value = e.target.value;
                                setRenewalStatusFilter(value);
                                syncFiltersToUrl({ renewalStatusFilter: value });
                            }}
                            className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-3 py-1.5 text-xs font-semibold text-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                        >
                            <option value="">All Passengers</option>
                            <option value="not_renewed">Not Renewed</option>
                            <option value="renewed">Renewed</option>
                        </select>
                    </div>

                    {/* Search Bar */}
                    <div className="space-y-1">
                        <label className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Search Passenger</label>
                        <div className="relative">
                            <input
                                type="text"
                                placeholder="Name or adm no..."
                                value={searchQuery}
                                onChange={(e) => {
                                    const value = e.target.value;
                                    setSearchQuery(value);
                                    syncFiltersToUrl({ searchQuery: value });
                                }}
                                className="w-full bg-slate-50 hover:bg-slate-100 focus:bg-white border border-slate-200 rounded-xl pl-9 pr-3 py-1.5 text-xs font-semibold text-slate-600 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                            />
                            <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                        </div>
                    </div>
                </div>
            </div>

            {/* List Table */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                {loading ? (
                    <div className="py-20 flex flex-col items-center justify-center gap-3">
                        <Loader />
                        <p className="text-sm font-bold text-slate-500 animate-pulse">Loading expired requests...</p>
                    </div>
                ) : currentRequests.length === 0 ? (
                    <div className="py-20 text-center text-slate-500">
                        <p className="text-lg font-bold">No expired requests found</p>
                        <p className="text-xs text-slate-400 mt-1">Try expanding filters or selecting a different academic year.</p>
                    </div>
                ) : (
                    <>
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50/50 border-b border-slate-100 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                                        <th className="px-4 py-3">Passenger Details</th>
                                        <th className="px-4 py-3">Course & Batch</th>
                                        <th className="px-4 py-3">Previous Route & Stage</th>
                                        <th className="px-4 py-3">Expiry Date</th>
                                        <th className="px-4 py-3 text-center">Status</th>
                                        <th className="px-4 py-3 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 text-xs">
                                    {currentRequests.map((req) => {
                                        const isRenewed = renewedSet.has(String(req.admission_number).trim());
                                        return (
                                            <tr key={req._id || req.id} className="hover:bg-slate-50/50 transition-colors">
                                                {/* Passenger Details */}
                                                <td className="px-4 py-2.5">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center text-blue-600 font-bold shrink-0 text-xs">
                                                            <User size={14} />
                                                        </div>
                                                        <div>
                                                            <h4 className="font-bold text-slate-800 text-xs leading-snug">{req.student_name}</h4>
                                                            <p className="text-[10px] font-semibold text-slate-400 mt-0.5">{req.admission_number}</p>
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Course & Year */}
                                                <td className="px-4 py-2.5">
                                                    <div className="space-y-0.5">
                                                        <p className="font-semibold text-slate-700 text-[11px] flex items-center gap-1">
                                                            <GraduationCap size={12} className="text-slate-400" />
                                                            {req.course || 'N/A'}
                                                        </p>
                                                        <p className="text-[9px] font-bold text-slate-400">Year {req.year_of_study || 1}</p>
                                                    </div>
                                                </td>

                                                {/* Previous Route & Stage */}
                                                <td className="px-4 py-2.5">
                                                    <div className="space-y-0.5">
                                                        <p className="font-semibold text-slate-700 text-[11px] flex items-center gap-1">
                                                            <MapPin size={12} className="text-slate-400" />
                                                            {req.route_name || 'N/A'}
                                                        </p>
                                                        <p className="text-[9px] font-bold text-slate-400">{req.stage_name} · {formatFare(req.fare)}</p>
                                                    </div>
                                                </td>

                                                {/* Expiry Date */}
                                                <td className="px-4 py-2.5 text-[11px] font-semibold text-slate-500">
                                                    <div className="flex items-center gap-1">
                                                        <Clock size={12} className="text-slate-400" />
                                                        {req.effective_expiry_date ? new Date(req.effective_expiry_date).toLocaleDateString() : '—'}
                                                    </div>
                                                </td>

                                                {/* Status */}
                                                <td className="px-4 py-2.5 text-center">
                                                    {isRenewed ? (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-sm">
                                                            <Check size={8} strokeWidth={3} />
                                                            Renewed
                                                        </span>
                                                    ) : (
                                                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100 shadow-sm animate-pulse">
                                                            <Clock size={8} />
                                                            Expired
                                                        </span>
                                                    )}
                                                </td>

                                                {/* Actions */}
                                                <td className="px-4 py-2.5 text-right">
                                                    {isRenewed ? (
                                                        <button
                                                            disabled
                                                            className="px-2.5 py-1 bg-slate-100 text-slate-400 rounded-lg text-[10px] font-bold border border-slate-200 cursor-not-allowed"
                                                        >
                                                            Renewed
                                                        </button>
                                                    ) : (
                                                        <button
                                                            onClick={() => handleOpenRenewModal(req)}
                                                            className="px-2.5 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-[10px] font-bold shadow-sm transition-all flex items-center gap-1 ml-auto cursor-pointer"
                                                        >
                                                            <RefreshCw size={10} className="animate-spin-slow" />
                                                            Renew
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination Footer */}
                        {totalPages > 1 && (
                            <div className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 flex items-center justify-between">
                                <p className="text-xs font-semibold text-slate-500">
                                    Showing {indexOfFirstRow + 1} to {Math.min(indexOfLastRow, filteredRequests.length)} of {filteredRequests.length} expired requests
                                </p>
                                <div className="flex gap-2">
                                    <button
                                        disabled={currentPage === 1}
                                        onClick={() => setCurrentPage(prev => prev - 1)}
                                        className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Previous
                                    </button>
                                    <button
                                        disabled={currentPage === totalPages}
                                        onClick={() => setCurrentPage(prev => prev + 1)}
                                        className="px-3.5 py-1.5 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-xs font-bold text-slate-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                    >
                                        Next
                                    </button>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* Renew Modal Proposal */}
            <Modal
                isOpen={renewModal.open}
                onClose={() => !renewModal.saving && setRenewModal(prev => ({ ...prev, open: false }))}
                title="Renew Transport Request"
            >
                {renewModal.passenger && (
                    <div className="space-y-6">
                        {/* Student Details Card */}
                        <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 flex items-start gap-4">
                            <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 font-bold text-sm flex items-center justify-center shrink-0">
                                {renewModal.passenger.student_name.charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <h4 className="font-bold text-slate-800 text-sm">{renewModal.passenger.student_name}</h4>
                                <p className="text-xs text-slate-400 font-semibold mt-0.5">Admission Number: {renewModal.passenger.admission_number}</p>
                                <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs font-semibold text-slate-500">
                                    <span className="flex items-center gap-1"><GraduationCap size={13} /> {renewModal.passenger.course} · Year {renewModal.passenger.year_of_study}</span>
                                    <span className="flex items-center gap-1"><Clock size={13} /> Expired: {renewModal.passenger.academic_year}</span>
                                </div>
                            </div>
                        </div>

                        {/* Options Form */}
                        <div className="space-y-4">
                            {/* Academic Year Selection */}
                            <div className="space-y-1">
                                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Target Academic Year</label>
                                <select
                                    value={targetYear}
                                    onChange={(e) => setTargetYear(e.target.value)}
                                    className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                >
                                    {academicYearOptions.map((year) => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Route & Stage Selection */}
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Renew to Route</label>
                                    <select
                                        value={renewModal.selectedRouteId}
                                        onChange={(e) => handleRouteStageChange(e.target.value, '')}
                                        className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                    >
                                        <option value="">Select Route</option>
                                        {targetRoutes.map((r) => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeId} - {r.routeName}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Renew to Stage</label>
                                    <select
                                        value={renewModal.selectedStageName}
                                        onChange={(e) => handleRouteStageChange(renewModal.selectedRouteId, e.target.value)}
                                        className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                        disabled={!renewModal.selectedRouteId}
                                    >
                                        <option value="">Select Stage</option>
                                        {(targetRoutes.find(r => r.routeId === renewModal.selectedRouteId)?.stages || []).map((s) => (
                                            <option key={s.stageName} value={s.stageName}>{s.stageName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* Info Box */}
                            <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100/50 flex items-center justify-between text-xs font-semibold text-blue-800">
                                <span>Expected Transport Fare:</span>
                                <span className="text-sm font-bold text-blue-900">{formatFare(renewModal.selectedStageFare)}</span>
                            </div>
                        </div>

                        {/* Error details */}
                        {renewModal.error && (
                            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-semibold flex items-center gap-2">
                                <AlertTriangle size={16} className="shrink-0" />
                                <span>{renewModal.error}</span>
                            </div>
                        )}

                        {/* Buttons */}
                        <div className="flex gap-3 justify-end">
                            <button
                                type="button"
                                disabled={renewModal.saving}
                                onClick={() => setRenewModal(prev => ({ ...prev, open: false }))}
                                className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={renewModal.saving}
                                onClick={handleConfirmRenewal}
                                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all disabled:opacity-50 flex items-center gap-2"
                            >
                                {renewModal.saving ? 'Renewing...' : 'Confirm Renewal'}
                            </button>
                        </div>
                    </div>
                )}
            </Modal>

            {/* Immediate Approve Modal */}
            <Modal
                isOpen={approveModal.open}
                onClose={() => !approveModal.loading && setApproveModal(prev => ({ ...prev, open: false }))}
                title="Immediate Passenger Approval"
            >
                <div className="space-y-6">
                    {approveModal.loading ? (
                        <div className="py-12 flex flex-col items-center justify-center gap-3">
                            <Loader />
                            <p className="text-xs font-bold text-slate-400">Resolving student calendar and vacancy details...</p>
                        </div>
                    ) : approveModal.error ? (
                        <div className="p-4 bg-red-50 border border-red-200 rounded-2xl text-red-700 text-xs font-semibold flex items-center gap-2">
                            <AlertTriangle size={20} className="shrink-0" />
                            <span>{approveModal.error}</span>
                        </div>
                    ) : (
                        approveModal.data && (
                            <>
                                {/* Request Info Details */}
                                <div className="space-y-3.5">
                                    <div className="p-4 bg-slate-50 rounded-2xl border border-slate-100 space-y-2.5 text-xs font-semibold text-slate-600">
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Passenger Name:</span>
                                            <span className="text-slate-800 font-bold">{approveModal.data.studentName}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Admission / Emp No:</span>
                                            <span className="text-slate-800 font-bold">{approveModal.data.admissionNumber}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Route & Stage:</span>
                                            <span className="text-slate-800 font-bold">{approveModal.data.route_name} - {approveModal.data.stage_name}</span>
                                        </div>
                                        <div className="flex justify-between">
                                            <span className="text-slate-400">Assigned Fare:</span>
                                            <span className="text-slate-800 font-bold">{formatFare(approveModal.data.fare)}</span>
                                        </div>
                                    </div>

                                    {/* Expiry / Calendar Info */}
                                    {approveModal.data.expiry ? (
                                        <div className="p-4 bg-emerald-50/50 rounded-2xl border border-emerald-100/50 space-y-2 text-xs font-semibold text-emerald-800">
                                            <div className="flex justify-between">
                                                <span>Year & Sem Assigned:</span>
                                                <span className="font-bold">Year {approveModal.data.expiry.year_of_study}, Sem {approveModal.data.expiry.semester_number}</span>
                                            </div>
                                            <div className="flex justify-between">
                                                <span>Calendar Expiry Date:</span>
                                                <span className="font-bold">{new Date(approveModal.data.expiry.expiry_date).toLocaleDateString()}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="p-4 bg-amber-50 rounded-2xl border border-amber-100 text-xs font-semibold text-amber-800 flex items-start gap-2.5">
                                            <AlertTriangle size={18} className="shrink-0 text-amber-500 mt-0.5" />
                                            <div>
                                                <p className="font-bold">No semester calendar configured!</p>
                                                <p className="text-[10px] text-amber-600 mt-0.5">This passenger's pass will fall back to default academic year expiry (June 30) upon approval.</p>
                                            </div>
                                        </div>
                                    )}

                                    {/* Bus Selection dropdown */}
                                    <div className="space-y-1.5">
                                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assign Bus (Vacancy Details)</label>
                                        {approveModal.data.busesOnRoute?.length > 0 ? (
                                            <select
                                                value={approveModal.selectedBusId}
                                                onChange={(e) => setApproveModal(prev => ({ ...prev, selectedBusId: e.target.value }))}
                                                className="w-full bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-xl px-4 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all"
                                            >
                                                <option value="">Select Bus</option>
                                                {approveModal.data.busesOnRoute.map((b) => (
                                                    <option key={b.busNumber} value={b.busNumber} disabled={b.seatsAvailable <= 0}>
                                                        Bus {b.busNumber} ({b.seatsFilled}/{b.capacity} filled · {b.seatsAvailable} seats left)
                                                    </option>
                                                ))}
                                            </select>
                                        ) : (
                                            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-500">
                                                No buses currently assigned to route {approveModal.data.route_id}. You can still approve without bus assignment.
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Buttons */}
                                <div className="flex gap-3 justify-end mt-6">
                                    <button
                                        type="button"
                                        onClick={() => setApproveModal({ open: false, requestId: null, data: null, selectedBusId: '', loading: false, error: null })}
                                        className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors"
                                    >
                                        Approve Later (Pending status)
                                    </button>
                                    <button
                                        type="button"
                                        onClick={handleConfirmApprove}
                                        className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold shadow-sm transition-all"
                                    >
                                        Approve Pass Now
                                    </button>
                                </div>
                            </>
                        )
                    )}
                </div>
            </Modal>
        </Layout>
    );
};

export default Renewals;
