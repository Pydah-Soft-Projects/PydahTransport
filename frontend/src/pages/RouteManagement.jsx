import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { campusIdsMatch, filterCampusesForUser, getCampusId } from '../utils/campus';
import {
    Map,
    Edit,
    Trash2,
    Clock,
    Navigation,
    MapPin,
    Plus,
    ArrowRight,
    Milestone,
    IndianRupee,
    ChevronDown,
    ChevronUp
} from 'lucide-react';

const API = import.meta.env.VITE_API_URL || '';

const resolveStageFareForYear = (stage, year) => {
    const overrides = Array.isArray(stage.academicYearFares) ? stage.academicYearFares : [];
    const match = overrides.find((item) => item.academicYear === year);
    if (match) return Number(match.fare);
    return Number(stage.baseFare ?? stage.fare ?? 0);
};

const RouteManagement = () => {
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saveMessage, setSaveMessage] = useState({ text: '', type: '' });
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const academicYearOptions = getAcademicYearOptions();
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [editingId, setEditingId] = useState(null);
    const [expandedRouteId, setExpandedRouteId] = useState(null);
    const [formData, setFormData] = useState({
        routeId: '',
        routeName: '',
        startPoint: '',
        endPoint: '',
        totalDistance: '',
        estimatedTime: '',
        campus: '',
        stages: [] // Start with empty stages
    });

    const [campuses, setCampuses] = useState([]);

    const [activeTab, setActiveTab] = useState('network'); // 'network' or 'transfer'
    const [transferData, setTransferData] = useState({
        sourceRouteId: '',
        stageName: '',
        destinationRouteId: ''
    });
    const [transferPreview, setTransferPreview] = useState({
        studentCount: 0,
        employeeCount: 0,
        passengers: [],
        loading: false
    });
    const [transferSubmitting, setTransferSubmitting] = useState(false);
    const [transferMessage, setTransferMessage] = useState({ text: '', type: '' });
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [selectedCampusFilter, setSelectedCampusFilter] = useState('');
    const [destBuses, setDestBuses] = useState([]);
    const [destBusesLoading, setDestBusesLoading] = useState(false);

    const fetchCampuses = async () => {
        try {
            const response = await apiFetch(`${API}/campuses`);
            const data = await response.json();
            setCampuses(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching campuses:', error);
        }
    };

    const fetchRoutes = async (year = academicYear) => {
        setLoading(true);
        try {
            const response = await apiFetch(
                `${API}/routes?academicYear=${encodeURIComponent(year)}&_=${Date.now()}`
            );
            const data = await response.json();
            setRoutes(Array.isArray(data) ? data : []);
        } catch (error) {
            console.error('Error fetching routes:', error);
            setSaveMessage({ text: 'Failed to load routes for the selected academic year.', type: 'error' });
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({
            routeId: '', routeName: '', startPoint: '', endPoint: '',
            totalDistance: '', estimatedTime: '', campus: '', stages: []
        });
        setExpandedRouteId(null);
        fetchRoutes(academicYear);
        fetchCampuses();
    }, [academicYear]);

    const toggleRoute = (id) => {
        setExpandedRouteId(expandedRouteId === id ? null : id);
    };

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const handleStageChange = (index, e) => {
        const { name, value } = e.target;
        const newStages = [...formData.stages];
        newStages[index][name] = value;
        setFormData(prev => ({ ...prev, stages: newStages }));
    };

    const addStage = () => {
        setFormData(prev => ({
            ...prev,
            stages: [...prev.stages, { stageName: '', distanceFromStart: '', fare: 0, academicYearFares: [] }]
        }));
    };

    const removeStage = (index) => {
        const newStages = formData.stages.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, stages: newStages }));
    };

    const handleEdit = (route, e) => {
        e.stopPropagation();
        setFormData({
            routeId: route.routeId,
            routeName: route.routeName,
            startPoint: route.startPoint,
            endPoint: route.endPoint,
            totalDistance: route.totalDistance,
            estimatedTime: route.estimatedTime,
            campus: getCampusId(route.campus) || '',
            stages: (route.stages || []).map((stage) => ({
                stageName: stage.stageName,
                distanceFromStart: stage.distanceFromStart,
                fare: resolveStageFareForYear(stage, academicYear),
                baseFare: stage.baseFare ?? stage.fare,
                academicYearFares: stage.academicYearFares || [],
            })),
        });
        setEditingId(route._id);
        setIsModalOpen(true);
    };

    const handleDelete = async (id, e) => {
        e.stopPropagation();
        if (!window.confirm('Are you sure you want to delete this route?')) return;

        try {
            const response = await apiFetch(`${API}/routes/${id}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                fetchRoutes(academicYear);
            } else {
                alert('Failed to delete route');
            }
        } catch (error) {
            console.error('Error deleting route:', error);
            alert('Error deleting route');
        }
    };

    const handleCloseModal = () => {
        setIsModalOpen(false);
        setEditingId(null);
        setFormData({
            routeId: '', routeName: '', startPoint: '', endPoint: '',
            totalDistance: '', estimatedTime: '', campus: '', stages: []
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        try {
            const url = editingId
                ? `${API}/routes/${editingId}`
                : `${API}/routes`;

            const method = editingId ? 'PUT' : 'POST';

            const payload = {
                routeId: formData.routeId,
                routeName: formData.routeName,
                startPoint: formData.startPoint,
                endPoint: formData.endPoint,
                totalDistance: formData.totalDistance,
                estimatedTime: formData.estimatedTime,
                campus: formData.campus || null,
                stages: formData.stages.map((stage) => ({
                    stageName: stage.stageName,
                    distanceFromStart: stage.distanceFromStart,
                    fare: Number(stage.fare),
                    baseFare: stage.baseFare,
                    academicYearFares: stage.academicYearFares || [],
                })),
                editingAcademicYear: academicYear,
            };

            const response = await apiFetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });

            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                handleCloseModal();
                await fetchRoutes(academicYear);
                setSaveMessage({
                    text: `Route ${editingId ? 'updated' : 'created'} for academic year ${academicYear}.`,
                    type: 'success',
                });
            } else {
                setSaveMessage({
                    text: data.message || `Failed to ${editingId ? 'update' : 'create'} route`,
                    type: 'error',
                });
            }
        } catch (error) {
            console.error(`Error ${editingId ? 'updating' : 'creating'} route:`, error);
            setSaveMessage({
                text: `Error ${editingId ? 'updating' : 'creating'} route`,
                type: 'error',
            });
        }
    };

    useEffect(() => {
        const fetchPreview = async () => {
            const { sourceRouteId, stageName } = transferData;
            if (!sourceRouteId || !stageName) {
                setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
                return;
            }

            setTransferPreview(prev => ({ ...prev, loading: true }));
            try {
                const response = await apiFetch(
                    `${API}/routes/transfer-preview?sourceRouteId=${encodeURIComponent(sourceRouteId)}&stageName=${encodeURIComponent(stageName)}&academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setTransferPreview({
                        studentCount: data.studentCount || 0,
                        employeeCount: data.employeeCount || 0,
                        passengers: data.passengers || [],
                        loading: false
                    });
                } else {
                    setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
                }
            } catch (error) {
                console.error('Error fetching stage transfer preview:', error);
                setTransferPreview({ studentCount: 0, employeeCount: 0, passengers: [], loading: false });
            }
        };

        fetchPreview();
    }, [transferData.sourceRouteId, transferData.stageName, academicYear]);

    useEffect(() => {
        const fetchDestBuses = async () => {
            const { destinationRouteId } = transferData;
            if (!destinationRouteId) {
                setDestBuses([]);
                return;
            }

            setDestBusesLoading(true);
            try {
                const response = await apiFetch(
                    `${API}/transport-requests/route-buses?route_id=${encodeURIComponent(destinationRouteId)}&academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setDestBuses(data.busesOnRoute || []);
                } else {
                    setDestBuses([]);
                }
            } catch (error) {
                console.error('Error fetching destination route buses:', error);
                setDestBuses([]);
            } finally {
                setDestBusesLoading(false);
            }
        };

        fetchDestBuses();
    }, [transferData.destinationRouteId, academicYear]);

    const handleTransferSubmit = (e) => {
        e.preventDefault();
        const { sourceRouteId, stageName, destinationRouteId } = transferData;
        if (!sourceRouteId || !stageName || !destinationRouteId) {
            setTransferMessage({ text: 'Please fill in all route and stage details.', type: 'error' });
            return;
        }

        setIsConfirmModalOpen(true);
    };

    const executeStageTransfer = async () => {
        setIsConfirmModalOpen(false);
        setTransferSubmitting(true);
        setTransferMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API}/routes/transfer-stage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...transferData,
                    academicYear
                })
            });

            const data = await response.json();
            if (response.ok) {
                setTransferMessage({
                    text: (data.message || 'Stage transferred successfully.') + ' Note: ID cards must be reprinted for the affected passengers as their route has changed.',
                    type: 'success'
                });
                setTransferData({ sourceRouteId: '', stageName: '', destinationRouteId: '' });
                await fetchRoutes(academicYear); // Refresh routes
            } else {
                setTransferMessage({
                    text: data.message || 'Failed to transfer stage.',
                    type: 'error'
                });
            }
        } catch (error) {
            console.error('Error transferring stage:', error);
            setTransferMessage({ text: 'Error transferring stage. Please try again.', type: 'error' });
        } finally {
            setTransferSubmitting(false);
        }
    };

    const filteredRoutes = selectedCampusFilter
        ? routes.filter((route) => campusIdsMatch(getCampusId(route.campus), selectedCampusFilter))
        : routes;



    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));

    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);

    useEffect(() => {
        if (campuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampusFilter(String(userCampuses[0]));
        }
    }, [campuses]);

    return (
        <Layout>
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">
                        {activeTab === 'network' ? `Route Network (${filteredRoutes.length})` : 'Stage Migration'}
                    </h2>
                    <p className="text-slate-500 text-xs mt-0.5">
                        {activeTab === 'network' 
                            ? 'Design routes, manage stages, and set fares per academic year.' 
                            : 'Transfer a route stage to another route network, remapping all linked passengers.'}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                    {activeTab === 'network' && allowedCampuses.length > 1 && (
                        <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                            <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Campus</span>
                            <select
                                value={selectedCampusFilter}
                                onChange={(e) => setSelectedCampusFilter(e.target.value)}
                                className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer outline-none"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>{campus.name} ({campus.code})</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div className="flex items-center bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm">
                        <span className="text-[10px] font-medium text-slate-500 mr-2 uppercase">Academic Year</span>
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="bg-transparent text-xs font-bold text-slate-800 focus:outline-none cursor-pointer outline-none"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    {activeTab === 'network' && (
                        <button
                            onClick={() => setIsModalOpen(true)}
                            className="bg-blue-900 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                        >
                            <Plus className="mr-1.5 group-hover:rotate-90 transition-transform" size={14} />
                            Create Route
                        </button>
                    )}
                </div>
            </div>

            {/* Tab pill navigation */}
            <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200/60 shadow-sm self-start mb-6 w-fit">
                <button
                    onClick={() => { setActiveTab('network'); setTransferMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'network' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Route Network
                </button>
                <button
                    onClick={() => { setActiveTab('transfer'); setSaveMessage({ text: '', type: '' }); }}
                    className={`px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 ${activeTab === 'transfer' ? 'bg-white text-blue-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                >
                    Transfer Stage
                </button>
            </div>

            {activeTab === 'network' ? (
                <>
                    {saveMessage.text && (
                        <div className={`mb-6 p-4 rounded-xl border ${saveMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                            {saveMessage.text}
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-20">
                            <Loader size={40} text="Loading route data..." />
                        </div>
                    ) : filteredRoutes.length === 0 ? (
                        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[400px] flex flex-col items-center justify-center p-8">
                            <div className="bg-slate-50 p-6 rounded-full mb-4">
                                <Map size={48} className="text-slate-400" />
                            </div>
                            <h3 className="text-xl font-bold text-slate-800 mb-2 text-center">No Routes Found</h3>
                            <p className="text-slate-500 text-center max-w-md mx-auto">
                                {selectedCampusFilter 
                                  ? "There are no routes matching the selected campus." 
                                  : "Define the pickup and drop points for your students. Create your first route to get started."}
                            </p>
                            {!selectedCampusFilter && (
                                <button onClick={() => setIsModalOpen(true)} className="mt-6 flex items-center text-blue-600 font-semibold hover:text-blue-800 hover:bg-blue-50 px-4 py-2 rounded-lg transition-all">
                                    <Plus size={20} className="mr-2" />
                                    Create first route
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse">
                                    <thead>
                                        <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                            <th className="px-3 py-2">Route Details</th>
                                            <th className="px-3 py-2">Path (Start → End)</th>
                                            <th className="px-3 py-2">Distance & Time</th>
                                            <th className="px-3 py-2">Stages</th>
                                            <th className="px-3 py-2 text-right">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {filteredRoutes.map((route) => {
                                            const isExpanded = expandedRouteId === route._id;
                                            return (
                                                <React.Fragment key={route._id}>
                                                    <tr 
                                                        onClick={() => toggleRoute(route._id)}
                                                        className={`cursor-pointer transition-colors group ${isExpanded ? 'bg-blue-50/30' : 'hover:bg-slate-50'}`}
                                                    >
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-1">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="font-bold text-slate-800 text-xs">{route.routeName}</span>
                                                                    <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-[10px] font-bold rounded border border-slate-200 font-mono">
                                                                        {route.routeId}
                                                                    </span>
                                                                </div>
                                                                {route.campus && (
                                                                    <div>
                                                                        <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[9px] font-semibold rounded border border-blue-100">
                                                                            Campus: {route.campus.name || route.campus}
                                                                        </span>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex items-center text-xs text-slate-600 font-medium">
                                                                <span className="truncate max-w-[120px]" title={route.startPoint}>{route.startPoint}</span>
                                                                <ArrowRight size={12} className="mx-2 text-slate-300" />
                                                                <span className="truncate max-w-[120px]" title={route.endPoint}>{route.endPoint}</span>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <div className="flex flex-col gap-0.5">
                                                                <span className="text-xs font-bold text-slate-700">{route.totalDistance} <span className="text-[10px] text-slate-400 font-medium uppercase ml-0.5">KM</span></span>
                                                                <div className="flex items-center gap-1 text-[10px] text-slate-500 font-medium">
                                                                    <Clock size={10} />
                                                                    {route.estimatedTime}
                                                                </div>
                                                            </div>
                                                        </td>
                                                        <td className="px-3 py-2">
                                                            <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold border ${route.stages.length > 0 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                                                {route.stages.length}
                                                            </span>
                                                        </td>
                                                        <td className="px-3 py-2 text-right">
                                                            <div className="flex items-center justify-end gap-1">
                                                                <button
                                                                    onClick={(e) => handleEdit(route, e)}
                                                                    className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md transition-all"
                                                                    title="Edit"
                                                                >
                                                                    <Edit size={14} />
                                                                </button>
                                                                <button
                                                                    onClick={(e) => handleDelete(route._id, e)}
                                                                    className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md transition-all"
                                                                    title="Delete"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                                <div className={`p-1 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-blue-600' : ''}`}>
                                                                    <ChevronDown size={14} />
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {isExpanded && (
                                                        <tr>
                                                            <td colSpan="5" className="px-3 py-2 bg-slate-50/50 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                                                <div className="flex items-center gap-2 mb-3">
                                                                    <Milestone size={14} className="text-blue-600" />
                                                                    <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">
                                                                        Stages & Fare Distribution ({academicYear})
                                                                    </h4>
                                                                </div>
                                                                {route.stages.length === 0 ? (
                                                                    <p className="text-xs text-slate-400 italic py-2">No stages defined for this route network.</p>
                                                                ) : (
                                                                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                                                                        {route.stages.map((stage, index) => {
                                                                            const displayFare = resolveStageFareForYear(stage, academicYear);
                                                                            return (
                                                                            <div key={index} className="bg-white p-2.5 rounded-xl border border-slate-100 shadow-sm flex items-center justify-between group/stage hover:border-blue-200 transition-colors">
                                                                                <div className="flex items-center gap-2.5">
                                                                                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-[10px] group-hover/stage:bg-blue-600 group-hover/stage:text-white transition-colors">
                                                                                        {index + 1}
                                                                                    </span>
                                                                                    <div>
                                                                                        <p className="font-bold text-slate-800 text-xs">{stage.stageName}</p>
                                                                                        <p className="text-[10px] text-slate-400 font-medium">{stage.distanceFromStart} km</p>
                                                                                    </div>
                                                                                </div>
                                                                                <div className="text-xs font-bold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-100">
                                                                                    ₹{displayFare}
                                                                                    {stage.hasYearOverride && stage.baseFare != null && stage.baseFare !== displayFare && (
                                                                                        <span className="block text-[9px] font-semibold text-slate-400 line-through">₹{stage.baseFare}</span>
                                                                                    )}
                                                                                    {!stage.hasYearOverride && (
                                                                                        <span className="block text-[9px] font-semibold text-slate-400">base fare</span>
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        );})}
                                                                    </div>
                                                                )}
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
                    )}
                </>
            ) : (
                <div className="flex flex-col lg:flex-row gap-6 items-start animate-in fade-in slide-in-from-top-2 duration-300 w-full">
                    {/* Left: Form */}
                    <div className="flex-1 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 md:p-8">
                        <h3 className="text-lg font-bold text-slate-800 mb-2">Stage Migration Panel</h3>
                        <p className="text-slate-500 text-xs mb-6">Relocate a stage from a source route to a destination route. Passengers currently assigned to this stage will be automatically updated.</p>

                        {transferMessage.text && (
                            <div className={`mb-6 p-4 rounded-xl border text-xs font-semibold ${transferMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {transferMessage.text}
                            </div>
                        )}

                        <form onSubmit={handleTransferSubmit} className="space-y-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Source Route</label>
                                    <select
                                        value={transferData.sourceRouteId}
                                        onChange={(e) => setTransferData({ sourceRouteId: e.target.value, stageName: '', destinationRouteId: '' })}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white"
                                        required
                                    >
                                        <option value="">Select source route</option>
                                        {routes.map(r => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                        ))}
                                    </select>
                                </div>

                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Stage to Transfer</label>
                                    <select
                                        value={transferData.stageName}
                                        onChange={(e) => setTransferData(prev => ({ ...prev, stageName: e.target.value }))}
                                        disabled={!transferData.sourceRouteId}
                                        className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                        required
                                    >
                                        <option value="">Select stage</option>
                                        {transferData.sourceRouteId && routes.find(r => r.routeId === transferData.sourceRouteId)?.stages.map(s => (
                                            <option key={s.stageName} value={s.stageName}>{s.stageName}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {transferData.sourceRouteId && transferData.stageName && (
                                <div className="p-4 bg-blue-50/50 rounded-2xl border border-blue-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[10px] font-black text-blue-800 uppercase tracking-widest mb-3">Affected Passenger Summary</h4>
                                    {transferPreview.loading ? (
                                        <p className="text-xs text-blue-600">Calculating preview...</p>
                                    ) : (
                                        <div className="grid grid-cols-2 gap-4 text-center">
                                            <div className="bg-white p-3 rounded-xl border border-blue-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase">Student Passengers</p>
                                                <span className="text-xl font-black text-blue-900">{transferPreview.studentCount}</span>
                                            </div>
                                            <div className="bg-white p-3 rounded-xl border border-blue-100">
                                                <p className="text-[8px] font-black text-slate-400 uppercase">Employee Passengers</p>
                                                <span className="text-xl font-black text-blue-900">{transferPreview.employeeCount}</span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">Destination Route</label>
                                <select
                                    value={transferData.destinationRouteId}
                                    onChange={(e) => setTransferData(prev => ({ ...prev, destinationRouteId: e.target.value }))}
                                    disabled={!transferData.sourceRouteId || !transferData.stageName}
                                    className="w-full rounded-xl border border-slate-200 px-4 py-3 text-xs outline-none focus:ring-2 focus:ring-blue-500 transition-all font-bold text-slate-700 bg-white disabled:opacity-50 disabled:bg-slate-50"
                                    required
                                >
                                    <option value="">Select destination route</option>
                                    {routes.filter(r => r.routeId !== transferData.sourceRouteId).map(r => (
                                        <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                    ))}
                                </select>
                            </div>

                            {transferData.destinationRouteId && (
                                <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 animate-in fade-in slide-in-from-top-2 duration-300">
                                    <h4 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Destination Route Bus Vacancy</h4>
                                    {destBusesLoading ? (
                                        <p className="text-xs text-slate-400">Loading vacancy details...</p>
                                    ) : destBuses.length === 0 ? (
                                        <p className="text-xs text-red-600 font-semibold italic">No buses assigned to destination route yet.</p>
                                    ) : (
                                        <div className="space-y-2.5">
                                            {destBuses.map((bus) => (
                                                <div key={bus.busNumber} className="flex justify-between items-center bg-white p-3 rounded-xl border border-slate-100 shadow-sm text-xs">
                                                    <div>
                                                        <span className="font-bold text-slate-800">Bus {bus.busNumber}</span>
                                                        <span className="ml-2 text-[10px] text-slate-400 font-bold bg-slate-100 px-1.5 py-0.5 rounded">
                                                            {bus.seatsAvailable} / {bus.capacity} seats free
                                                        </span>
                                                    </div>
                                                    <div className="flex items-center gap-1.5">
                                                        <div className="w-20 bg-slate-100 h-2 rounded-full overflow-hidden">
                                                            <div 
                                                                className={`h-full ${bus.seatsAvailable === 0 ? 'bg-red-500' : (bus.seatsAvailable < 5 ? 'bg-yellow-500' : 'bg-emerald-500')}`} 
                                                                style={{ width: `${(bus.seatsFilled / bus.capacity) * 100}%` }}
                                                            />
                                                        </div>
                                                        <span className="font-black text-[10px] text-slate-500">
                                                            {Math.round((bus.seatsFilled / bus.capacity) * 100)}% filled
                                                        </span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={transferSubmitting || !transferData.sourceRouteId || !transferData.stageName || !transferData.destinationRouteId}
                                className="w-full bg-slate-900 hover:bg-black text-white font-bold py-4 rounded-xl disabled:opacity-50 transition-all shadow-md flex items-center justify-center gap-2"
                            >
                                {transferSubmitting ? 'Transferring...' : 'Execute Stage Migration'}
                            </button>
                        </form>
                    </div>

                    {/* Right: Passenger List Card */}
                    <div className="w-full lg:w-96 bg-white rounded-2xl shadow-sm border border-slate-200 p-6 flex flex-col max-h-[580px]">
                        <h3 className="text-md font-bold text-slate-800">Passengers List</h3>
                        <p className="text-slate-400 text-[10px] mt-0.5">Active or pending passengers on the selected stage.</p>

                        {!transferData.sourceRouteId || !transferData.stageName ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-300">
                                <p className="text-xs font-semibold">Select a route and stage to load passenger list.</p>
                            </div>
                        ) : transferPreview.loading ? (
                            <div className="flex-1 flex items-center justify-center py-20">
                                <span className="text-xs text-slate-400">Loading list...</span>
                            </div>
                        ) : transferPreview.passengers.length === 0 ? (
                            <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400">
                                <p className="text-xs italic">No passengers found on this stage.</p>
                            </div>
                        ) : (
                            <div className="overflow-y-auto flex-1 pr-1 custom-scrollbar space-y-2.5 mt-4">
                                {transferPreview.passengers.map((p, idx) => (
                                    <div key={idx} className="flex items-center justify-between p-3 rounded-xl border border-slate-100 bg-slate-50/50 hover:bg-slate-50 transition-colors">
                                        <div className="min-w-0 flex-1 pr-2">
                                            <p className="font-bold text-slate-800 text-xs truncate" title={p.name}>{p.name}</p>
                                            <p className="text-[10px] text-slate-400 font-medium font-mono truncate">{p.id}</p>
                                        </div>
                                        <div className="flex flex-col items-end gap-1 shrink-0">
                                            <span className={`px-1.5 py-0.5 rounded text-[8px] font-black uppercase ${p.type === 'student' ? 'bg-blue-50 text-blue-700 border border-blue-100' : 'bg-purple-50 text-purple-700 border border-purple-100'}`}>
                                                {p.type}
                                            </span>
                                            <span className={`text-[8px] font-bold ${p.status === 'approved' ? 'text-emerald-600' : 'text-amber-500'}`}>
                                                {p.status}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Modal isOpen={isModalOpen} onClose={handleCloseModal} title={editingId ? "Edit Route" : "Create New Route"}>
                <form onSubmit={handleSubmit} className="space-y-5">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Route ID</label>
                            <input type="text" name="routeId" required value={formData.routeId} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. R01" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Route Name</label>
                            <input type="text" name="routeName" required value={formData.routeName} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. Campus Express" />
                        </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Start Point</label>
                            <input type="text" name="startPoint" required value={formData.startPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">End Point</label>
                            <input type="text" name="endPoint" required value={formData.endPoint} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" />
                        </div>
                    </div>
                    <div className="grid grid-cols-3 gap-4">
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Total Distance (km)</label>
                            <input type="number" name="totalDistance" value={formData.totalDistance} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Est. Time</label>
                            <input type="text" name="estimatedTime" value={formData.estimatedTime} onChange={handleChange} className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all" placeholder="e.g. 45 mins" />
                        </div>
                        <div>
                            <label className="block text-sm font-semibold text-slate-700 mb-1.5">Campus</label>
                            <select
                                name="campus"
                                value={formData.campus || ''}
                                onChange={handleChange}
                                className="w-full px-4 py-2.5 rounded-xl border border-slate-300 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white"
                            >
                                <option value="">Select Campus (Optional)</option>
                                {allowedCampuses.map(campus => (
                                    <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                        {campus.name} ({campus.code})
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    <div className="border-t border-slate-200 pt-5">
                        <div className="flex justify-between items-center mb-4">
                            <div>
                                <h4 className="font-bold text-slate-800">Route Stages</h4>
                                <p className="text-xs text-slate-500 mt-1">Fares below apply to academic year <span className="font-semibold text-slate-700">{academicYear}</span>.</p>
                            </div>
                            <button type="button" onClick={addStage} className="text-sm bg-blue-50 text-blue-600 px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-100 transition-colors">+ Add Stage</button>
                        </div>
                        <div className="space-y-3 max-h-60 overflow-y-auto pr-2 custom-scrollbar">
                            {formData.stages.length === 0 && (
                                <p className="text-sm text-slate-400 italic text-center py-4">No stages added yet. Click "+ Add Stage" to begin.</p>
                            )}
                            {formData.stages.map((stage, index) => (
                                <div key={index} className="bg-slate-50 p-3 rounded-xl relative border border-slate-200 group">
                                    <button type="button" onClick={() => removeStage(index)} className="absolute top-2 right-2 text-slate-400 hover:text-red-500 transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                    <div className="flex items-center mb-3">
                                        <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-xs mr-2">
                                            {index + 1}
                                        </span>
                                        <span className="text-sm font-medium text-slate-700">Stage Details</span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-3 mb-3">
                                        <input type="text" name="stageName" placeholder="Stage Name" value={stage.stageName} onChange={(e) => handleStageChange(index, e)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
                                        <input type="number" name="distanceFromStart" placeholder="Km from Start" value={stage.distanceFromStart} onChange={(e) => handleStageChange(index, e)} className="w-full px-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
                                    </div>
                                    <div>
                                        <div className="relative">
                                            <IndianRupee size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input type="number" name="fare" placeholder={`Fare for ${academicYear}`} value={stage.fare} onChange={(e) => handleStageChange(index, e)} className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-300 text-sm focus:ring-2 focus:ring-blue-500 outline-none" required />
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>

                    <button type="submit" className="w-full bg-blue-900 text-white font-bold py-3.5 rounded-xl hover:bg-blue-700 transition-colors shadow-lg shadow-blue-200 mt-2">
                        {editingId ? 'Update Route Structure' : 'Create Route Structure'}
                    </button>
                </form>
            </Modal>

            <Modal isOpen={isConfirmModalOpen} onClose={() => setIsConfirmModalOpen(false)} title="Confirm Stage Migration">
                <div className="space-y-4">
                    <p className="text-sm text-slate-650 font-semibold leading-relaxed">
                        Are you sure you want to transfer stage <span className="font-bold text-slate-900">"{transferData.stageName}"</span> from route <span className="font-bold text-slate-900">{transferData.sourceRouteId}</span> to route <span className="font-bold text-slate-900">{transferData.destinationRouteId}</span>?
                    </p>
                    <div className="bg-amber-50 border border-amber-100 rounded-xl p-3.5 text-xs text-amber-800 font-bold space-y-1">
                        <p>This will relocate the stage network and update all associated passengers' routes.</p>
                        <p className="text-amber-900">⚠️ Affected passengers ({transferPreview.studentCount + transferPreview.employeeCount}) will need their transport ID cards reprinted.</p>
                    </div>
                    <div className="flex justify-end gap-3 mt-5">
                        <button
                            type="button"
                            onClick={() => setIsConfirmModalOpen(false)}
                            className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-all"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={executeStageTransfer}
                            className="px-4 py-2 text-xs font-bold text-white bg-slate-900 hover:bg-black rounded-xl shadow-md transition-all"
                        >
                            Confirm & Execute
                        </button>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
};

export default RouteManagement;
