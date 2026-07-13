import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { printHtmlDocument } from '../utils/printHtml';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import Modal from '../components/Modal';
import {
    Bus,
    MapPin,
    Users,
    Activity,
    AlertCircle,
    CheckCircle2,
    ArrowRight,
    Download,
    Loader2
} from 'lucide-react';

import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { filterCampusesForUser, getCampusId } from '../utils/campus';

const API = API_BASE;

const Fleet = () => {
    const [list, setList] = useState([]);
    const [loading, setLoading] = useState(true);
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const [occupancyMode, setOccupancyMode] = useState('live');
    const academicYearOptions = getAcademicYearOptions();
    const [allocatingId, setAllocatingId] = useState(null);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [isPrinting, setIsPrinting] = useState(false);
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportOptions, setReportOptions] = useState({ abstract: true, detailed: true });
    const [reportModalError, setReportModalError] = useState('');
    const [campuses, setCampuses] = useState([]);
    const [selectedCampus, setSelectedCampus] = useState('');

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const userCampuses = adminInfo.campuses || [];
    const isSuperAdmin = adminInfo.role === 'admin' || (adminInfo.roles && adminInfo.roles.includes('superadmin'));
    const allowedCampuses = filterCampusesForUser(campuses, userCampuses, isSuperAdmin);
    const selectedCampusLabel = allowedCampuses.find((campus) => String(getCampusId(campus)) === String(selectedCampus))?.name;

    useEffect(() => {
        const fetchCampuses = async () => {
            try {
                const response = await apiFetch(`${API}/campuses`);
                if (response.ok) {
                    const data = await response.json();
                    setCampuses(Array.isArray(data) ? data : []);
                }
            } catch (error) {
                console.error('Error fetching campuses:', error);
            }
        };
        fetchCampuses();
    }, []);

    useEffect(() => {
        if (campuses.length > 0 && !isSuperAdmin && userCampuses.length === 1) {
            setSelectedCampus(String(userCampuses[0]));
        }
    }, [campuses]);

    const handleDownloadReport = async (options = reportOptions) => {
        if (!options.abstract && !options.detailed) {
            setReportModalError('Select at least one report section.');
            return;
        }

        setIsPrinting(true);
        setMessage({ text: '', type: '' });
        setReportModalError('');
        try {
            const status = occupancyMode === 'live' ? 'active' : 'approved';
            const response = await apiFetch(`${API}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'passenger-report',
                    data: {
                        status,
                        academicYear: occupancyMode !== 'live' ? academicYear : undefined,
                        occupancyMode,
                        campus: selectedCampus || undefined,
                        campusName: selectedCampusLabel || undefined,
                        includeAbstract: options.abstract,
                        includeDetailed: options.detailed,
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, 'Transport-Passenger-Report');
                setReportModalOpen(false);
            } else {
                const err = await response.json().catch(() => ({}));
                const errorText = err.message || 'Failed to generate passenger report HTML.';
                if (reportModalOpen) {
                    setReportModalError(errorText);
                } else {
                    setMessage({ text: errorText, type: 'error' });
                }
            }
        } catch (e) {
            console.error('Error generating report:', e);
            const errorText = 'Error generating report.';
            if (reportModalOpen) {
                setReportModalError(errorText);
            } else {
                setMessage({ text: errorText, type: 'error' });
            }
        } finally {
            setIsPrinting(false);
        }
    };

    const openReportModal = () => {
        setReportModalError('');
        setReportOptions({ abstract: true, detailed: true });
        setReportModalOpen(true);
    };

    const toggleReportOption = (key) => {
        setReportOptions((prev) => {
            const next = { ...prev, [key]: !prev[key] };
            if (!next.abstract && !next.detailed) {
                return prev;
            }
            return next;
        });
        setReportModalError('');
    };

    const fetchOverview = async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams({ occupancyMode });
            if (occupancyMode !== 'live') params.append('academicYear', academicYear);
            if (selectedCampus) params.append('campus', selectedCampus);
            const response = await apiFetch(
                `${API}/buses/overview?${params.toString()}`
            );
            if (response.ok) {
                const data = await response.json();
                const rows = Array.isArray(data) ? data : (data.buses || []);
                setList(rows);
            } else {
                setList([]);
            }
        } catch (e) {
            setList([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchOverview();
    }, [academicYear, occupancyMode, selectedCampus]);

    const handleAutoAllocate = async (busId) => {
        setAllocatingId(busId);
        setMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(
                `${API}/buses/${busId}/auto-allocate?academicYear=${encodeURIComponent(academicYear)}`,
                { method: 'POST' }
            );
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setMessage({ text: data.message || 'Allocation done.', type: 'success' });
                fetchOverview();
            } else {
                setMessage({ text: data.message || 'Allocation failed', type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Something went wrong.', type: 'error' });
        } finally {
            setAllocatingId(null);
        }
    };

    const totalCapacity = list.reduce((sum, item) => sum + Number(item.capacity || 0), 0);
    const totalSeatsFilled = list.reduce((sum, item) => sum + Number(item.seatsFilled || 0), 0);
    const totalSeatsAvailable = list.reduce((sum, item) => sum + Number(item.seatsAvailable || 0), 0);
    const fleetOccupancy = totalCapacity > 0
        ? Math.min(100, Math.round((totalSeatsFilled / totalCapacity) * 100))
        : 0;

    return (
        <Layout>
            <div className="mb-8 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-bold text-slate-800 break-words tracking-tight">Fleet & Passengers</h2>
                    <p className="text-slate-700 mt-2 font-medium">Manage transport requests and bus capacity.</p>
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                        <div className="inline-flex rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
                            <button
                                type="button"
                                onClick={() => setOccupancyMode('live')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${occupancyMode === 'live'
                                    ? 'bg-emerald-600 text-white'
                                    : 'text-slate-500 hover:bg-slate-50'
                                    }`}
                            >
                                Live
                            </button>
                            <button
                                type="button"
                                onClick={() => setOccupancyMode('academicYear')}
                                className={`px-3 py-1.5 rounded-lg text-xs font-black uppercase tracking-wide transition-colors ${occupancyMode === 'academicYear'
                                    ? 'bg-blue-600 text-white'
                                    : 'text-slate-500 hover:bg-slate-50'
                                    }`}
                            >
                                AY
                            </button>
                        </div>
                        <label htmlFor="fleet-academic-year" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                            Academic Year
                        </label>
                        <select
                            id="fleet-academic-year"
                            value={academicYear}
                            onChange={(e) => setAcademicYear(e.target.value)}
                            disabled={occupancyMode === 'live'}
                            className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                        {allowedCampuses.length > 1 && (
                            <>
                                <label htmlFor="fleet-campus" className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                                    Campus
                                </label>
                                <select
                                    id="fleet-campus"
                                    value={selectedCampus}
                                    onChange={(e) => setSelectedCampus(e.target.value)}
                                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-800 bg-white outline-none focus:ring-2 focus:ring-blue-500 min-w-[150px]"
                                >
                                    <option value="">All Campuses</option>
                                    {allowedCampuses.map((campus) => (
                                        <option key={getCampusId(campus)} value={getCampusId(campus)}>
                                            {campus.name} ({campus.code})
                                        </option>
                                    ))}
                                </select>
                            </>
                        )}
                    </div>
                </div>
                <button
                    type="button"
                    onClick={openReportModal}
                    disabled={isPrinting}
                    className="flex items-center bg-blue-600 text-white px-5 py-2.5 rounded-xl font-semibold shadow-sm hover:bg-blue-700 disabled:opacity-50 transition-all flex-none whitespace-nowrap h-fit"
                >
                    {isPrinting ? <Loader2 size={18} className="mr-2 text-white animate-spin" /> : <Download size={18} className="mr-2" />}
                    {isPrinting ? 'Preparing Report...' : 'Download Route-Wise Report'}
                </button>
            </div>

            <Modal
                isOpen={reportModalOpen}
                onClose={() => !isPrinting && setReportModalOpen(false)}
                title="Download Route-Wise Report"
                maxWidth="max-w-md"
            >
                <p className="text-sm text-slate-600 mb-4">
                    Choose which sections to include in the report.
                </p>

                <div className="space-y-3">
                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={reportOptions.abstract}
                            onChange={() => toggleReportOption('abstract')}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Abstract</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                                Route-wise summary table with totals for students and employees.
                            </span>
                        </span>
                    </label>

                    <label className="flex items-start gap-3 p-3 rounded-xl border border-slate-200 hover:bg-slate-50 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={reportOptions.detailed}
                            onChange={() => toggleReportOption('detailed')}
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>
                            <span className="block text-sm font-bold text-slate-800">Detailed</span>
                            <span className="block text-xs text-slate-500 mt-0.5">
                                Stage-wise passenger list with names, IDs, course, and bus details.
                            </span>
                        </span>
                    </label>
                </div>

                {reportModalError && (
                    <p className="mt-3 text-sm font-medium text-red-600">{reportModalError}</p>
                )}

                <div className="mt-5 flex justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setReportModalOpen(false)}
                        disabled={isPrinting}
                        className="px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => handleDownloadReport(reportOptions)}
                        disabled={isPrinting || (!reportOptions.abstract && !reportOptions.detailed)}
                        className="px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center"
                    >
                        {isPrinting ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
                        {isPrinting ? 'Generating...' : 'Download Report'}
                    </button>
                </div>
            </Modal>

            {!loading && list.length > 0 && (
                <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Occupancy Mode</p>
                        <p className="text-lg font-black text-slate-800 mt-1">
                            {occupancyMode === 'live' ? 'Live' : academicYear}
                        </p>
                        {selectedCampusLabel && (
                            <p className="text-[10px] font-semibold text-slate-500 mt-1">{selectedCampusLabel}</p>
                        )}
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Capacity</p>
                        <p className="text-lg font-black text-slate-800 mt-1">{totalCapacity}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-emerald-200 p-4 shadow-sm bg-emerald-50/40">
                        <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider">Seats Filled</p>
                        <p className="text-lg font-black text-emerald-700 mt-1">{totalSeatsFilled}</p>
                    </div>
                    <div className="bg-white rounded-xl border border-blue-200 p-4 shadow-sm bg-blue-50/40">
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Remaining · {fleetOccupancy}%</p>
                        <p className="text-lg font-black text-blue-700 mt-1">{totalSeatsAvailable}</p>
                    </div>
                </div>
            )}

            {message.text && (
                <div className={`mb-4 p-3 rounded-lg border flex items-center text-sm ${message.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {message.type === 'success' ? <CheckCircle2 size={16} className="mr-2" /> : <AlertCircle size={16} className="mr-2" />}
                    <span className="font-medium">{message.text}</span>
                </div>
            )}

            {loading ? (
                <div className="min-h-[300px] flex items-center justify-center">
                    <Loader size={32} text="Loading fleet overview..." />
                </div>
            ) : list.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-10 text-center flex flex-col items-center">
                    <div className="bg-slate-50 p-4 rounded-full mb-4">
                        <Bus size={32} className="text-slate-400" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-1">No Buses Found</h3>
                    <p className="text-slate-500 text-sm max-w-sm mx-auto mb-6">
                        {selectedCampus
                            ? 'No buses found for the selected campus. Try another campus or add buses in Bus Management.'
                            : 'No buses in the fleet. Add buses and assign routes in Bus Management.'}
                    </p>
                    <Link to="/buses" className="inline-flex items-center bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium shadow-sm hover:bg-blue-700 transition-all">
                        Go to Bus Management
                        <ArrowRight size={16} className="ml-2" />
                    </Link>
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden w-full">
                    <div className="overflow-x-auto w-full">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[11px] uppercase text-slate-500 font-bold tracking-wider">
                                    <th className="px-4 py-2.5 w-48">Bus Details</th>
                                    <th className="px-4 py-2.5">Route</th>
                                    <th className="px-4 py-2.5">Capacity</th>
                                    <th className="px-4 py-2.5">Seats Filled</th>
                                    <th className="px-4 py-2.5 font-bold text-slate-700">Rem. Seats</th>
                                    <th className="px-4 py-2.5">Occupancy</th>
                                    <th className="px-4 py-2.5 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {list.map((item) => (
                                    <tr key={item.bus._id} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="px-4 py-2">
                                            <div>
                                                <p className="font-bold text-slate-800 text-sm">{item.bus.busNumber}</p>
                                                <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wide">{item.bus.type}</p>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            {item.route ? (
                                                <div className="flex items-center text-slate-700">
                                                    <MapPin size={14} className="text-slate-400 mr-2" />
                                                    <span className="font-medium text-sm">{item.route.routeName}</span>
                                                    <span className="ml-2 text-[10px] bg-slate-100 text-slate-500 px-1 py-0.5 rounded border border-slate-200 font-mono">
                                                        {item.route.routeId}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-400 italic text-xs flex items-center">
                                                    <AlertCircle size={12} className="mr-1.5" />
                                                    Not assigned
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-4 py-2 text-slate-600 font-medium text-sm">{item.capacity}</td>
                                        <td className="px-4 py-2">
                                            <div className="flex items-center font-bold text-slate-700 text-sm">
                                                <Users size={14} className="text-slate-400 mr-2" />
                                                {item.seatsFilled}
                                            </div>
                                        </td>
                                        <td className="px-4 py-2">
                                            <span className={`text-sm font-black ${item.seatsAvailable <= 5 ? 'text-red-500' : 'text-slate-700'}`}>
                                                {item.seatsAvailable}
                                            </span>
                                        </td>
                                        <td className="px-4 py-2">
                                            <div className="flex flex-col gap-1 w-24">
                                                <div className="flex justify-between items-end">
                                                    <span className={`text-[10px] font-bold ${item.occupancyPercent >= 100 ? 'text-red-600' :
                                                        item.occupancyPercent >= 80 ? 'text-amber-600' : 'text-emerald-600'
                                                        }`}>
                                                        {item.occupancyPercent}%
                                                    </span>
                                                </div>
                                                <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 ${item.occupancyPercent >= 100 ? 'bg-red-500' :
                                                            item.occupancyPercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                                                            }`}
                                                        style={{ width: `${Math.min(100, item.occupancyPercent)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-4 py-2 text-right">
                                            <div className="flex items-center justify-end gap-2">
                                                {item.bus.assignedRouteId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAutoAllocate(item.bus._id)}
                                                        disabled={allocatingId !== null || item.seatsFilled >= item.capacity}
                                                        className="px-2 py-1 rounded bg-blue-600 text-white text-[10px] font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow transition-all active:scale-95 flex items-center"
                                                    >
                                                        {allocatingId === item.bus._id ? (
                                                            <>
                                                                <Loader size={10} className="mr-1 text-white" />
                                                                Running...
                                                            </>
                                                        ) : item.seatsFilled >= item.capacity ? (
                                                            'Full'
                                                        ) : (
                                                            <>
                                                                <Activity size={10} className="mr-1" />
                                                                Auto-fill
                                                            </>
                                                        )}
                                                    </button>
                                                )}
                                                <Link
                                                    to={`/buses/${item.bus._id}`}
                                                    className="px-2 py-1 rounded border border-slate-200 text-slate-600 text-[10px] font-semibold hover:bg-slate-50 hover:text-slate-900 transition-colors"
                                                >
                                                    View details
                                                </Link>
                                            </div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}
        </Layout>
    );
};

export default Fleet;
