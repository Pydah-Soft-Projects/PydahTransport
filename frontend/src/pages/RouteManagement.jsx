import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
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
    const [selectedCampusFilter, setSelectedCampusFilter] = useState('');
    const [isCampusModalOpen, setIsCampusModalOpen] = useState(false);
    const [campusFormData, setCampusFormData] = useState({ name: '', code: '', location: '' });
    const [campusMessage, setCampusMessage] = useState({ text: '', type: '' });
    const [campusLoading, setCampusLoading] = useState(false);

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

    const handleCampusSubmit = async (e) => {
        e.preventDefault();
        setCampusLoading(true);
        setCampusMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API}/campuses`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(campusFormData),
            });
            const data = await response.json();
            if (response.ok) {
                setCampusFormData({ name: '', code: '', location: '' });
                setCampusMessage({ text: 'Campus created successfully.', type: 'success' });
                fetchCampuses();
            } else {
                setCampusMessage({ text: data.message || 'Failed to create campus.', type: 'error' });
            }
        } catch (error) {
            console.error('Error creating campus:', error);
            setCampusMessage({ text: 'Error creating campus.', type: 'error' });
        } finally {
            setCampusLoading(false);
        }
    };

    const handleCampusDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this campus?')) return;
        try {
            const response = await apiFetch(`${API}/campuses/${id}`, {
                method: 'DELETE',
            });
            const data = await response.json();
            if (response.ok) {
                setCampusMessage({ text: 'Campus deleted successfully.', type: 'success' });
                fetchCampuses();
            } else {
                setCampusMessage({ text: data.message || 'Failed to delete campus.', type: 'error' });
            }
        } catch (error) {
            console.error('Error deleting campus:', error);
            setCampusMessage({ text: 'Error deleting campus.', type: 'error' });
        }
    };

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
            campus: route.campus?._id || route.campus || '',
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

    const filteredRoutes = selectedCampusFilter
        ? routes.filter(route => {
            const rCampusId = route.campus?._id || route.campus;
            return rCampusId === selectedCampusFilter;
        })
        : routes;

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.roles && adminInfo.roles.includes('superadmin');

    const allowedCampuses = isSuperAdmin
        ? campuses
        : campuses.filter(c => userCampuses.includes(c._id));

    useEffect(() => {
        if (campuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampusFilter(userCampuses[0]);
        }
    }, [campuses]);

    return (
        <Layout>
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Route Network ({filteredRoutes.length})</h2>
                    <p className="text-slate-600 mt-1">Design routes, manage stages, and set fares per academic year.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    {allowedCampuses.length > 1 && (
                        <div>
                            <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Campus</label>
                            <select
                                value={selectedCampusFilter}
                                onChange={(e) => setSelectedCampusFilter(e.target.value)}
                                className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
                            >
                                <option value="">All Campuses</option>
                                {allowedCampuses.map((campus) => (
                                    <option key={campus._id} value={campus._id}>{campus.name} ({campus.code})</option>
                                ))}
                            </select>
                        </div>
                    )}
                    <div>
                        <label className="block text-xs font-semibold text-slate-500 mb-1 uppercase tracking-wider">Academic Year</label>
                        <select
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 text-sm font-medium text-slate-700 outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        onClick={() => setIsCampusModalOpen(true)}
                        className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 px-5 py-2.5 rounded-xl font-medium shadow-md transition-all hover:shadow-md active:scale-95 flex items-center group self-end"
                    >
                        Manage Campuses
                    </button>
                    <button
                        onClick={() => setIsModalOpen(true)}
                        className="bg-blue-900 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl font-medium shadow-md transition-all hover:shadow-lg active:scale-95 flex items-center group self-end"
                    >
                        Create Route
                    </button>
                </div>
            </div>

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
                <div className="bg-white rounded-3xl shadow-sm border border-slate-200 overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-xs uppercase text-slate-500 font-black tracking-widest">
                                    <th className="px-6 py-4">Route Details</th>
                                    <th className="px-6 py-4">Path (Start → End)</th>
                                    <th className="px-6 py-4">Distance & Time</th>
                                    <th className="px-6 py-4">Stages</th>
                                    <th className="px-6 py-4 text-right">Actions</th>
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
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-bold text-slate-800 text-sm">{route.routeName}</span>
                                                            <span className="px-1.5 py-0.5 bg-slate-100 text-slate-600 text-xs font-bold rounded border border-slate-200 font-mono">
                                                                {route.routeId}
                                                            </span>
                                                        </div>
                                                        {route.campus && (
                                                            <div>
                                                                <span className="px-1.5 py-0.5 bg-blue-50 text-blue-700 text-[10px] font-semibold rounded border border-blue-100">
                                                                    Campus: {route.campus.name || route.campus}
                                                                </span>
                                                            </div>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex items-center text-sm text-slate-600 font-medium">
                                                        <span className="truncate max-w-[120px]" title={route.startPoint}>{route.startPoint}</span>
                                                        <ArrowRight size={14} className="mx-2 text-slate-300" />
                                                        <span className="truncate max-w-[120px]" title={route.endPoint}>{route.endPoint}</span>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <div className="flex flex-col gap-0.5">
                                                        <span className="text-sm font-bold text-slate-700">{route.totalDistance} <span className="text-xs text-slate-400 font-medium uppercase ml-0.5">KM</span></span>
                                                        <div className="flex items-center gap-1 text-xs text-slate-500 font-medium">
                                                            <Clock size={12} />
                                                            {route.estimatedTime}
                                                        </div>
                                                    </div>
                                                </td>
                                                <td className="px-6 py-4">
                                                    <span className={`px-2 py-1 rounded-md text-xs font-bold border ${route.stages.length > 0 ? 'bg-blue-50 text-blue-700 border-blue-100' : 'bg-slate-50 text-slate-400 border-slate-100'}`}>
                                                        {route.stages.length}
                                                    </span>
                                                </td>
                                                <td className="px-6 py-4 text-right">
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={(e) => handleEdit(route, e)}
                                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all"
                                                            title="Edit"
                                                        >
                                                            <Edit size={16} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => handleDelete(route._id, e)}
                                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                        <div className={`p-1.5 text-slate-400 transition-transform duration-300 ${isExpanded ? 'rotate-180 text-blue-600' : ''}`}>
                                                            <ChevronDown size={18} />
                                                        </div>
                                                    </div>
                                                </td>
                                            </tr>
                                            {isExpanded && (
                                                <tr>
                                                    <td colSpan="5" className="px-6 py-4 bg-slate-50/50 border-t border-slate-100 animate-in fade-in slide-in-from-top-2 duration-300">
                                                        <div className="flex items-center gap-2 mb-4">
                                                            <Milestone size={16} className="text-blue-600" />
                                                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-widest">
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
                                                                    <div key={index} className="bg-white p-3 rounded-2xl border border-slate-100 shadow-sm flex items-center justify-between group/stage hover:border-blue-200 transition-colors">
                                                                        <div className="flex items-center gap-3">
                                                                            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center font-bold text-xs group-hover/stage:bg-blue-600 group-hover/stage:text-white transition-colors">
                                                                                {index + 1}
                                                                            </span>
                                                                            <div>
                                                                                <p className="font-bold text-slate-800 text-sm">{stage.stageName}</p>
                                                                                <p className="text-xs text-slate-400 font-medium">{stage.distanceFromStart} km</p>
                                                                            </div>
                                                                        </div>
                                                                        <div className="text-sm font-black text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-lg border border-emerald-100">
                                                                            ₹{displayFare}
                                                                            {stage.hasYearOverride && stage.baseFare != null && stage.baseFare !== displayFare && (
                                                                                <span className="block text-[10px] font-semibold text-slate-400 line-through">₹{stage.baseFare}</span>
                                                                            )}
                                                                            {!stage.hasYearOverride && (
                                                                                <span className="block text-[10px] font-semibold text-slate-400">base fare</span>
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
                                    <option key={campus._id} value={campus._id}>
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

            <Modal isOpen={isCampusModalOpen} onClose={() => { setIsCampusModalOpen(false); setCampusMessage({ text: '', type: '' }); }} title="Manage Campuses">
                <div className="space-y-6">
                    {/* Add Campus Form */}
                    <form onSubmit={handleCampusSubmit} className="bg-slate-50 p-4 rounded-2xl border border-slate-200 space-y-4">
                        <h4 className="font-bold text-slate-800 text-sm">Add New Campus</h4>
                        {campusMessage.text && (
                            <div className={`p-2.5 rounded-lg text-xs border ${campusMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                                {campusMessage.text}
                            </div>
                        )}
                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Campus Name</label>
                                <input
                                    type="text"
                                    required
                                    value={campusFormData.name}
                                    onChange={(e) => setCampusFormData({ ...campusFormData, name: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="e.g. Main Campus"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-slate-600 mb-1">Campus Code</label>
                                <input
                                    type="text"
                                    required
                                    value={campusFormData.code}
                                    onChange={(e) => setCampusFormData({ ...campusFormData, code: e.target.value })}
                                    className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="e.g. MC"
                                />
                            </div>
                        </div>
                        <div>
                            <label className="block text-xs font-semibold text-slate-600 mb-1">Location (Optional)</label>
                            <input
                                type="text"
                                value={campusFormData.location}
                                onChange={(e) => setCampusFormData({ ...campusFormData, location: e.target.value })}
                                className="w-full px-3 py-2 rounded-lg border border-slate-300 text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="e.g. Visakhapatnam"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={campusLoading}
                            className="w-full bg-blue-900 text-white font-bold py-2 rounded-lg hover:bg-blue-700 transition-colors text-xs disabled:opacity-50"
                        >
                            {campusLoading ? 'Creating...' : 'Create Campus'}
                        </button>
                    </form>

                    {/* Campus List */}
                    <div className="space-y-3">
                        <h4 className="font-bold text-slate-800 text-sm">Existing Campuses</h4>
                        <div className="max-h-60 overflow-y-auto pr-1 space-y-2 custom-scrollbar">
                            {campuses.length === 0 ? (
                                <p className="text-xs text-slate-400 italic text-center py-4">No campuses created yet.</p>
                            ) : (
                                campuses.map((campus) => (
                                    <div key={campus._id} className="flex items-center justify-between p-3 bg-white rounded-xl border border-slate-200 animate-in fade-in duration-200">
                                        <div>
                                            <p className="font-bold text-slate-800 text-xs">{campus.name}</p>
                                            <p className="text-[10px] text-slate-400 font-mono">Code: {campus.code} {campus.location && `| Location: ${campus.location}`}</p>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => handleCampusDelete(campus._id)}
                                            className="p-1 text-slate-400 hover:text-red-500 rounded transition-colors"
                                            title="Delete Campus"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
};

export default RouteManagement;
