import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

const API = API_BASE;

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
    const radius = 38;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (Math.min(100, percent) / 100) * circumference;

    return (
        <svg width="96" height="96" viewBox="0 0 100 100" className="shrink-0">
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

const StatCard = ({ title, children, className = '' }) => (
    <div className={`bg-white rounded-2xl border border-slate-200 p-5 shadow-sm h-full ${className}`}>
        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-3">{title}</p>
        {children}
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
    const academicYearOptions = getAcademicYearOptions();
    
    // For expired taxes warning
    const [expiredTaxesWarning, setExpiredTaxesWarning] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [filterCourse, setFilterCourse] = useState('');
    const [filterYear, setFilterYear] = useState('');
    const [filterStage, setFilterStage] = useState('');
    const [filterType, setFilterType] = useState('');

    const handlePrint = async () => {
        if (!data?.bus?.busNumber) return;
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
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Transport-Passenger-Report-${data.bus.busNumber}`);
            } else {
                const err = await response.json().catch(() => ({}));
                alert(err.message || 'Failed to generate passenger report.');
            }
        } catch (error) {
            console.error('Error printing passenger report:', error);
            alert('Error preparing passenger report.');
        }
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
            setLoading(true);
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
                    <Link to="/buses" className="text-blue-600 hover:underline">← Back to Bus Fleet</Link>
                </div>
            </Layout>
        );
    }

    const { bus, route, passengers, seatsFilled, seatsAvailable, capacity, occupancyPercent } = data;
    const occupancyLabel = occupancyMode === 'live' ? 'Live' : academicYear;
    const studentCount = (passengers || []).filter((p) => !p.user_type || p.user_type === 'student').length;
    const employeeCount = (passengers || []).filter((p) => p.user_type === 'employee').length;

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
            <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <Link to="/fleet" className="text-blue-600 hover:underline text-sm font-semibold flex items-center gap-1 w-fit">
                    <span>←</span> Back to Bus Fleet
                </Link>
                <div className="flex flex-wrap gap-2">
                    <button
                        type="button"
                        onClick={handlePrint}
                        className="inline-flex items-center text-sm bg-white text-slate-700 px-4 py-2.5 rounded-xl font-semibold hover:bg-slate-50 transition-all border border-slate-200 shadow-sm"
                    >
                        <Download size={16} className="mr-2 text-blue-600" />
                        Download Report
                    </button>
                    {route && (
                        <button
                            type="button"
                            onClick={openAssignModal}
                            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 shadow-sm transition-all"
                        >
                            Assign Passengers
                        </button>
                    )}
                </div>
            </div>

            <div className="mb-6">
                <div className="flex flex-wrap items-center gap-3 mb-2">
                    <h1 className="text-3xl md:text-4xl font-black text-slate-900 tracking-tight">{bus.busNumber}</h1>
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        bus.status === 'active' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'
                    }`}>
                        {bus.status || 'active'}
                    </span>
                </div>
                <p className="text-sm text-slate-600 font-medium">
                    {bus.type || 'Standard Bus'}
                    {bus.vehicleModel ? ` · ${bus.vehicleModel}` : ''}
                    {route ? (
                        <>
                            {' · Route: '}
                            <span className="text-slate-800">{routePathLabel}</span>
                        </>
                    ) : (
                        <span className="text-slate-400"> · No route assigned</span>
                    )}
                </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4 mb-4">
                <StatCard title="Occupancy">
                    <div className="flex items-center gap-4">
                        <DonutChart percent={occupancyPercent} />
                        <div className="space-y-2 text-xs font-semibold text-slate-600">
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-blue-600" />
                                <span>{seatsFilled} Occupied</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full bg-slate-200" />
                                <span>{seatsAvailable} Available</span>
                            </div>
                        </div>
                    </div>
                </StatCard>

                <StatCard title="Seat Capacity">
                    <div className="flex items-start gap-3">
                        <div className="p-2.5 rounded-xl bg-blue-50 text-blue-600">
                            <Armchair size={22} />
                        </div>
                        <div>
                            <p className="text-3xl font-black text-slate-900 leading-none">
                                {seatsFilled} <span className="text-lg text-slate-400 font-bold">/ {capacity}</span>
                            </p>
                            <p className="text-xs font-semibold text-emerald-600 mt-2">{seatsAvailable} Seats Available</p>
                        </div>
                    </div>
                </StatCard>

                <StatCard title="Route">
                    {route ? (
                        <div className="space-y-2 max-h-28 overflow-y-auto custom-scrollbar pr-1">
                            {routeStops.map((stop, index) => (
                                <div key={`${stop}-${index}`} className="flex items-center gap-2 text-sm text-slate-700">
                                    <MapPin size={14} className="text-blue-500 shrink-0" />
                                    <span className="font-medium">{stop}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-sm text-slate-400 italic">No route assigned</p>
                    )}
                </StatCard>

                <StatCard title="Bus Staff">
                    <div className="space-y-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <User size={16} className="text-slate-400 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Driver</p>
                                    <p className={`text-sm font-semibold truncate ${bus.driverName ? 'text-slate-800' : 'text-red-500'}`}>
                                        {bus.driverName || 'Not Assigned'}
                                    </p>
                                </div>
                            </div>
                            {!bus.driverName && (
                                <Link to="/buses" className="text-[10px] font-bold text-blue-600 hover:underline whitespace-nowrap">
                                    + Assign
                                </Link>
                            )}
                        </div>
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex items-center gap-2 min-w-0">
                                <UserCheck size={16} className="text-slate-400 shrink-0" />
                                <div className="min-w-0">
                                    <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Attendant</p>
                                    <p className={`text-sm font-semibold truncate ${bus.attendantName ? 'text-slate-800' : 'text-red-500'}`}>
                                        {bus.attendantName || 'Not Assigned'}
                                    </p>
                                </div>
                            </div>
                            {!bus.attendantName && (
                                <Link to="/buses" className="text-[10px] font-bold text-blue-600 hover:underline whitespace-nowrap">
                                    + Assign
                                </Link>
                            )}
                        </div>
                    </div>
                </StatCard>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                <StatCard title="Live Status">
                    <div className="flex items-center gap-3">
                        {occupancyMode === 'live' ? (
                            <>
                                <span className="relative flex h-3 w-3">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
                                </span>
                                <div>
                                    <p className="text-sm font-black text-emerald-700 uppercase tracking-wide">Live</p>
                                    <p className="text-xs text-slate-500">Bus is active and running.</p>
                                </div>
                            </>
                        ) : (
                            <div>
                                <p className="text-sm font-black text-blue-700 uppercase tracking-wide">Academic Year</p>
                                <p className="text-xs text-slate-500">Showing {academicYear} occupancy.</p>
                            </div>
                        )}
                    </div>
                    <div className="mt-4 inline-flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                        <button
                            type="button"
                            onClick={() => setOccupancyMode('live')}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${occupancyMode === 'live' ? 'bg-emerald-600 text-white' : 'text-slate-500 hover:bg-white'}`}
                        >
                            Live
                        </button>
                        <button
                            type="button"
                            onClick={() => setOccupancyMode('academicYear')}
                            className={`px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-wide transition-colors ${occupancyMode === 'academicYear' ? 'bg-blue-600 text-white' : 'text-slate-500 hover:bg-white'}`}
                        >
                            AY
                        </button>
                    </div>
                </StatCard>

                <StatCard title="Academic Year">
                    <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        disabled={occupancyMode === 'live'}
                        className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                    >
                        {academicYearOptions.map((year) => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                    <p className="text-xs text-slate-500 mt-3">
                        {occupancyMode === 'live' ? 'Switch to AY mode to filter by academic year.' : `Passengers for ${academicYear}.`}
                    </p>
                </StatCard>

                <StatCard title="Passenger Mix">
                    <div className="grid grid-cols-2 gap-3">
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-center">
                            <p className="text-2xl font-black text-blue-700">{studentCount}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-blue-600 mt-1">Students</p>
                        </div>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
                            <p className="text-2xl font-black text-slate-800">{employeeCount}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-500 mt-1">Staff</p>
                        </div>
                    </div>
                </StatCard>
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
                        <UsersIcon size={18} /> Passenger List
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-slate-500 hover:text-slate-700 hover:bg-slate-50'}`}
                    >
                        <History size={18} /> History
                    </button>
                </div>

                {activeTab === 'passengers' ? (
                    <>
                        <div className="p-5 border-b border-slate-100 space-y-4">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                                <h2 className="text-base font-bold text-slate-800 uppercase tracking-wide">
                                    Passenger List ({filteredPassengers.length})
                                </h2>
                                {route && (
                                    <button
                                        type="button"
                                        onClick={openAssignModal}
                                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 w-fit"
                                    >
                                        Assign Passengers
                                    </button>
                                )}
                            </div>
                            <div className="flex flex-col xl:flex-row gap-3">
                                <div className="relative flex-1 min-w-[200px]">
                                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input
                                        type="text"
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        placeholder="Search by name..."
                                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-200 text-sm outline-none focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 flex-1">
                                    <select value={filterCourse} onChange={(e) => setFilterCourse(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">Course</option>
                                        {courseOptions.map((course) => <option key={course} value={course}>{course}</option>)}
                                    </select>
                                    <select value={filterYear} onChange={(e) => setFilterYear(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">Year</option>
                                        {yearOptions.map((year) => <option key={year} value={year}>{formatYearLabel(year)}</option>)}
                                    </select>
                                    <select value={filterStage} onChange={(e) => setFilterStage(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">Stage</option>
                                        {stageOptions.map((stage) => <option key={stage} value={stage}>{stage}</option>)}
                                    </select>
                                    <select value={filterType} onChange={(e) => setFilterType(e.target.value)} className="rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-blue-500">
                                        <option value="">Type</option>
                                        {typeOptions.map((type) => <option key={type} value={type}>{type}</option>)}
                                    </select>
                                </div>
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
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-4 py-3 w-16">Seat No</th>
                                            <th className="px-4 py-3">ID Number</th>
                                            <th className="px-4 py-3">Name</th>
                                            <th className="px-4 py-3">Type</th>
                                            <th className="px-4 py-3">Course</th>
                                            <th className="px-4 py-3">Year</th>
                                            <th className="px-4 py-3">Stage</th>
                                            <th className="px-4 py-3">Fare (₹)</th>
                                            <th className="px-4 py-3 text-center">Admit Card</th>
                                            <th className="px-4 py-3">Status</th>
                                            <th className="px-4 py-3 text-center">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredPassengers.map((passenger, index) => (
                                            <tr key={passenger.id} className={`hover:bg-slate-50/80 ${passenger.is_expired ? 'opacity-70' : ''}`}>
                                                <td className="px-4 py-3 text-sm font-semibold text-slate-500">{String(index + 1).padStart(2, '0')}</td>
                                                <td className="px-4 py-3 text-sm font-medium text-slate-700">{passenger.admission_number || passenger.emp_no || '—'}</td>
                                                <td className="px-4 py-3 text-sm font-semibold text-slate-900">{passenger.student_name || passenger.employee_name}</td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${passenger.user_type === 'employee' ? 'bg-slate-100 text-slate-700' : 'bg-blue-50 text-blue-700'}`}>
                                                        {passenger.user_type || 'student'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-700">
                                                    {passenger.user_type === 'employee' ? 'Employee' : (
                                                        <>
                                                            {passenger.course || '—'}
                                                            {passenger.branch ? <span className="block text-[11px] text-slate-500">{passenger.branch}</span> : null}
                                                        </>
                                                    )}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-700">
                                                    {passenger.user_type === 'employee' ? '—' : formatYearLabel(passenger.year_of_study)}
                                                </td>
                                                <td className="px-4 py-3 text-sm text-slate-700">{passenger.stage_name || '—'}</td>
                                                <td className="px-4 py-3">
                                                    <FareDisplay passenger={passenger} compact />
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        disabled={fetchingPass}
                                                        onClick={() => handlePrintAdmitCardClick(passenger)}
                                                        className="inline-flex items-center justify-center p-2 rounded-lg text-blue-700 bg-blue-50 hover:bg-blue-100 transition-all disabled:opacity-50"
                                                        title="Print Admit Card"
                                                    >
                                                        <FileText size={16} />
                                                    </button>
                                                </td>
                                                <td className="px-4 py-3">
                                                    <span className={`px-2 py-1 rounded-md text-[10px] font-bold uppercase ${passenger.is_expired ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>
                                                        {passenger.is_expired ? 'Expired' : 'Boarded'}
                                                    </span>
                                                </td>
                                                <td className="px-4 py-3 text-center">
                                                    <button
                                                        type="button"
                                                        disabled={fetchingPass}
                                                        onClick={() => handlePrintAdmitCardClick(passenger)}
                                                        className="p-2 rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                                                        title="Actions"
                                                    >
                                                        <MoreHorizontal size={16} />
                                                    </button>
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </>
                ) : (
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
        </Layout>
    );
};

export default BusDetails;
