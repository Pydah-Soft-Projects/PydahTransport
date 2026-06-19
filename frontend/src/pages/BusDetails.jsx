import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useParams, Link } from 'react-router-dom';
import { useReactToPrint } from 'react-to-print';
import { Download, FileText, History, Users as UsersIcon, Package, Calendar, Tag, MapPin, UserCheck, AlertTriangle } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import PassengerReport from '../components/PassengerReport';
import TransportAdmitCard from '../components/TransportAdmitCard';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { triggerAdmitCardPrint } from '../utils/printAdmitCard';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

const API = API_BASE;

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
    const academicYearOptions = getAcademicYearOptions();
    
    // For expired taxes warning
    const [expiredTaxesWarning, setExpiredTaxesWarning] = useState([]);

    const componentRef = useRef();
    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Transport-Passenger-Report-${id}`
    });

    const [selectedAdmitPassenger, setSelectedAdmitPassenger] = useState(null);
    const admitCardRef = useRef();
    const handlePrintAdmitCard = useReactToPrint({
        contentRef: admitCardRef,
        documentTitle: selectedAdmitPassenger
            ? `Transport-Admit-Card-${selectedAdmitPassenger.admission_number || selectedAdmitPassenger.emp_no || selectedAdmitPassenger.admission_no}`
            : 'Transport-Admit-Card'
    });

    const handlePrintAdmitCardClick = async (p) => {
        if (fetchingPass) return;
        setFetchingPass(true);
        try {
            const response = await apiFetch(`${API}/transport-requests/${p.id}/full-details`);
            if (response.ok) {
                const fullPassenger = await response.json();
                flushSync(() => setSelectedAdmitPassenger(fullPassenger));
                await triggerAdmitCardPrint(handlePrintAdmitCard, admitCardRef);
            } else {
                alert('Failed to fetch passenger details for admit card.');
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
                const response = await apiFetch(
                    `${API}/buses/${id}/details?academicYear=${encodeURIComponent(academicYear)}`
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
    }, [id, academicYear]);

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
            const res = await apiFetch(
                `${API}/buses/${id}/details?academicYear=${encodeURIComponent(academicYear)}`
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

    const activePassengers = (passengers || []).filter((p) => !p.is_expired);
    const yearPassengers = passengers || [];
    const studentCount = yearPassengers.filter((p) => !p.user_type || p.user_type === 'student').length;
    const employeeCount = yearPassengers.filter((p) => p.user_type === 'employee').length;

    return (
        <Layout>
            <div className="mb-6 flex items-center justify-between">
                <Link to="/buses" className="text-blue-600 hover:underline text-sm font-medium flex items-center gap-1">
                    <span>←</span> Back to Bus Fleet
                </Link>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={handlePrint}
                        className="flex items-center text-sm bg-white text-gray-700 px-4 py-2 rounded-xl font-bold hover:bg-gray-50 transition-all border border-gray-200 shadow-sm"
                    >
                        <Download size={16} className="mr-2 text-blue-600" />
                        Download Report
                    </button>
                    {route && (
                        <button
                            type="button"
                            onClick={openAssignModal}
                            className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 shadow-sm transition-all"
                        >
                            Assign Passengers
                        </button>
                    )}
                </div>
            </div>

            {/* Premium Dashboard Header */}
            <div className="bg-white rounded-3xl shadow-sm border border-gray-100 p-8 mb-8">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <h1 className="text-4xl font-black text-gray-900 tracking-tight">{bus.busNumber}</h1>
                            <span className={`px-3 py-1 rounded-full text-xs font-black uppercase tracking-widest ${
                                bus.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                            }`}>
                                {bus.status}
                            </span>
                        </div>
                        <p className="text-gray-500 font-medium flex items-center gap-2 flex-wrap">
                            <Tag size={16} className="text-blue-500" />
                            {bus.type}
                            {bus.vehicleModel && <> • {bus.vehicleModel}</>}
                            {bus.registrationDate && (
                                <> • Reg. {new Date(bus.registrationDate).toLocaleDateString()}</>
                            )}
                        </p>
                    </div>

                    <div className="flex items-center gap-6">
                        <div>
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Academic Year</p>
                            <select
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                className="rounded-xl border border-gray-200 px-3 py-2 text-sm font-bold text-gray-800 bg-white outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>
                        <div className="text-right">
                            <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Occupancy</p>
                            <div className="flex items-center gap-3">
                                <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                                    <div 
                                        className={`h-full rounded-full transition-all duration-1000 ${
                                            occupancyPercent >= 90 ? 'bg-red-500' : occupancyPercent >= 70 ? 'bg-amber-500' : 'bg-green-500'
                                        }`}
                                        style={{ width: `${occupancyPercent}%` }}
                                    />
                                </div>
                                <span className="text-2xl font-black text-gray-900">{occupancyPercent}%</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Route Info */}
                    <div className="bg-blue-50/50 rounded-2xl p-5 border border-blue-100/50">
                        <p className="text-[10px] font-black text-blue-400 uppercase tracking-widest mb-3">Assigned Route</p>
                        {route ? (
                            <>
                                <p className="font-bold text-gray-900 text-lg leading-tight mb-1">{route.routeName}</p>
                                <p className="text-xs text-blue-600 font-medium">{route.startPoint} → {route.endPoint}</p>
                            </>
                        ) : (
                            <p className="text-gray-400 font-medium italic">No route assigned</p>
                        )}
                    </div>

                    {/* Staff Info */}
                    <div className="bg-purple-50/50 rounded-2xl p-5 border border-purple-100/50">
                        <p className="text-[10px] font-black text-purple-400 uppercase tracking-widest mb-3">Bus Staff</p>
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Driver</span>
                                <span className="text-sm font-bold text-gray-900">{bus.driverName || '—'}</span>
                            </div>
                            <div className="flex justify-between items-center">
                                <span className="text-xs text-gray-500">Attendant</span>
                                <span className="text-sm font-bold text-gray-900">{bus.attendantName || '—'}</span>
                            </div>
                        </div>
                    </div>

                    {/* Capacity Info */}
                    <div className="bg-emerald-50/50 rounded-2xl p-5 border border-emerald-100/50">
                        <p className="text-[10px] font-black text-emerald-400 uppercase tracking-widest mb-3">Seat Capacity</p>
                        <div className="flex items-baseline gap-2">
                            <span className="text-3xl font-black text-emerald-700">{seatsFilled}</span>
                            <span className="text-gray-400 font-bold">/ {capacity}</span>
                        </div>
                        <p className="text-[10px] text-emerald-600 font-bold mt-1 uppercase">{seatsAvailable} seats available · {academicYear}</p>
                    </div>

                 {/* Breakdown */}
                 <div className="bg-gray-50 rounded-2xl p-5 border border-gray-100">
                     <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-3">Passenger Mix</p>
                     <div className="flex gap-4">
                         <div>
                             <p className="text-xl font-black text-gray-900">{studentCount}</p>
                             <p className="text-[10px] font-bold text-blue-500 uppercase">Students</p>
                         </div>
                         <div className="w-px h-8 bg-gray-200" />
                         <div>
                             <p className="text-xl font-black text-gray-900">{employeeCount}</p>
                             <p className="text-[10px] font-bold text-purple-500 uppercase">Staff</p>
                         </div>
                     </div>
                 </div>
             </div>
             
             {/* Expired Taxes Warning */}
             {expiredTaxesWarning.length > 0 && (
                 <div className="bg-red-50 border border-red-200 rounded-lg p-6 mb-6">
                     <div className="flex items-start">
                         <div className="flex-shrink-0">
                             <AlertTriangle size={24} className="mr-4 text-red-500" />
                         </div>
                         <div className="flex-1">
                             <h3 className="text-sm font-bold text-red-800 mb-2">
                                 Warning: Expired Taxes Detected
                             </h3>
                             <p className="text-sm text-red-600">
                                 The following taxes have expired and need attention:
                             </p>
                             <div className="mt-3 space-y-2">
                                 {expiredTaxesWarning.map((tax, index) => (
                                     <div key={index} className="bg-white rounded-lg p-3 border border-red-100">
                                         <div className="flex justify-between items-start">
                                             <div>
                                                 <p className="font-medium text-slate-800">{tax.taxHeader}</p>
                                                 <p className="text-xs text-red-600">
                                                     Expired on: {tax.formattedEndDate}
                                                 </p>
                                             </div>
                                             <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-100 text-red-700">
                                                 EXPIRED
                                             </span>
                                         </div>
                                     </div>
                                 ))}
                             </div>
                             {expiredTaxesWarning.length > 0 && (
                                 <div className="mt-4 text-xs text-red-600 italic">
                                     Please update or remove these taxes from the Bus Management section.
                                 </div>
                             )}
                         </div>
                     </div>
                 </div>
             )}
             
             {/* Compact Seat Map */}
                <div className="mt-8 pt-8 border-t border-gray-50">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xs font-black text-gray-400 uppercase tracking-widest">Visual Seat Map</h3>
                        <div className="flex gap-4 text-[10px] font-bold uppercase">
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-emerald-500" /> Occupied</div>
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-gray-200" /> Available</div>
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {Array.from({ length: capacity }, (_, i) => (
                            <div
                                key={i}
                                className={`w-5 h-5 rounded-md flex items-center justify-center text-[8px] transition-all hover:scale-110 ${
                                    i < seatsFilled ? 'bg-emerald-500 text-white shadow-sm shadow-emerald-200' : 'bg-gray-100 text-gray-300'
                                }`}
                                title={i < seatsFilled ? `Seat ${i + 1} filled` : 'Empty'}
                            >
                                {i < seatsFilled ? '✓' : i + 1}
                            </div>
                        ))}
                    </div>
                </div>
            </div>


            <PassengerReport ref={componentRef} passengers={activePassengers} />

            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="border-b border-gray-100 flex">
                    <button
                        onClick={() => setActiveTab('passengers')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'passengers' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        <UsersIcon size={18} /> Passenger list
                    </button>
                    <button
                        onClick={() => setActiveTab('history')}
                        className={`px-6 py-4 text-sm font-bold flex items-center gap-2 border-b-2 transition-all ${activeTab === 'history' ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'}`}
                    >
                        <History size={18} /> History
                    </button>
                </div>

                {activeTab === 'passengers' ? (
                    <>
                        <div className="p-6 border-b border-gray-100 flex flex-wrap items-center justify-between gap-4">
                            <h2 className="text-lg font-bold text-gray-800">
                                Passenger list <span className="text-sm font-medium text-gray-500">({academicYear})</span>
                            </h2>
                            {route && (
                                <button
                                    type="button"
                                    onClick={openAssignModal}
                                    className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                                >
                                    Assign passengers to this bus
                                </button>
                            )}
                        </div>
                        {passengers.length === 0 ? (
                            <div className="p-12 text-center text-gray-500">
                                <p>No passengers for academic year {academicYear} on this bus.</p>
                                {route && (
                                    <button
                                        type="button"
                                        onClick={openAssignModal}
                                        className="mt-2 text-blue-600 hover:underline font-medium"
                                    >
                                        Assign from approved requests for this route
                                    </button>
                                )}
                            </div>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-gray-50 border-b border-gray-100 text-xs uppercase text-gray-500 font-semibold tracking-wider">
                                            <th className="p-4">#</th>
                                            <th className="p-4">Type</th>
                                            <th className="p-4">ID Number</th>
                                            <th className="p-4">Name</th>
                                            <th className="p-4">Course</th>
                                            <th className="p-4 text-center">Year</th>
                                            <th className="p-4">Academic Year</th>
                                            <th className="p-4">Stage</th>
                                            <th className="p-4">Fare</th>
                                            <th className="p-4 text-right">Admit Card</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-gray-50">
                                        {passengers.map((p, i) => (
                                            <tr key={p.id} className={`hover:bg-gray-50 ${p.is_expired ? 'opacity-60 bg-red-50/30' : ''}`}>
                                                <td className="p-4 text-gray-500">{i + 1}</td>
                                                <td className="p-4">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider ${p.user_type === 'employee' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>
                                                        {p.user_type || 'student'}
                                                    </span>
                                                    {p.is_expired && (
                                                        <span className="ml-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-700">Expired</span>
                                                    )}
                                                </td>
                                                <td className="p-4 font-medium text-gray-600">{p.admission_number || p.emp_no}</td>
                                                <td className="p-4">{p.student_name || p.employee_name}</td>
                                                <td className="p-4">
                                                    {p.user_type === 'employee' ? (
                                                        <span className="text-gray-500 text-sm">Employee</span>
                                                    ) : (
                                                        <div>
                                                            <p className="text-sm font-medium text-gray-800">{p.course || '—'}</p>
                                                            {p.branch && (
                                                                <p className="text-[11px] text-gray-500">{p.branch}</p>
                                                            )}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-4 text-center">
                                                    {p.user_type === 'employee' ? (
                                                        <span className="text-gray-400">—</span>
                                                    ) : (p.year_of_study != null && p.year_of_study !== '') ? (
                                                        <span className="inline-flex bg-blue-50 text-blue-700 px-2.5 py-1 rounded-md text-xs font-bold">
                                                            Y{p.year_of_study}
                                                        </span>
                                                    ) : (
                                                        <span className="text-gray-400 text-sm">—</span>
                                                    )}
                                                </td>
                                                <td className="p-4 text-sm text-gray-700 font-medium">
                                                    {p.user_type === 'employee' ? '—' : (p.academic_year || academicYear || '—')}
                                                </td>
                                                <td className="p-4">{p.stage_name}</td>
                                                <td className="p-4 text-gray-500">{p.user_type === 'employee' ? 'Free (₹0)' : `₹${p.fare}`}</td>
                                                <td className="p-4 text-right">
                                                    <button
                                                        type="button"
                                                        disabled={fetchingPass}
                                                        onClick={() => handlePrintAdmitCardClick(p)}
                                                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-blue-700 bg-blue-50 text-xs font-semibold hover:bg-blue-100 transition-all ${fetchingPass ? 'animate-pulse opacity-50' : ''}`}
                                                        title="Print Admit Card"
                                                    >
                                                        <FileText size={16} />
                                                        Print
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
                                                                <span className="font-bold text-gray-800 text-sm">{record.itemId?.itemName || 'Deleted Item'}</span>
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
            
            <TransportAdmitCard
                ref={admitCardRef}
                passenger={selectedAdmitPassenger}
                busMeta={{
                    driverName: bus.driverName,
                    attendantName: bus.attendantName,
                    routeName: route?.routeName,
                }}
            />

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
