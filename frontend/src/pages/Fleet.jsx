import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { printHtmlDocument, exportHtmlAsExcel } from '../utils/printHtml';
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
    Loader2,
    ArrowUpDown,
    ChevronUp,
    ChevronDown
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
    const [reportLoadingAction, setReportLoadingAction] = useState(null);
    const isPrinting = reportLoadingAction !== null;
    const [reportModalOpen, setReportModalOpen] = useState(false);
    const [reportOptions, setReportOptions] = useState({ abstract: true, detailed: true });
    const [reportModalError, setReportModalError] = useState('');
    const [campuses, setCampuses] = useState([]);
    const [selectedCampus, setSelectedCampus] = useState('');
    const [sortField, setSortField] = useState(null);
    const [sortDirection, setSortDirection] = useState('asc');

    const handleSort = (field) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection(field === 'occupancy' ? 'desc' : 'asc');
        }
    };

    const sortedList = React.useMemo(() => {
        if (!sortField) return list;
        const sorted = [...list];
        sorted.sort((a, b) => {
            let valA, valB;
            if (sortField === 'route') {
                valA = a.route ? (a.route.routeId || a.route.routeName || '') : 'ZZZZ';
                valB = b.route ? (b.route.routeId || b.route.routeName || '') : 'ZZZZ';
            } else if (sortField === 'occupancy') {
                valA = a.occupancyPercent || 0;
                valB = b.occupancyPercent || 0;
            } else {
                return 0;
            }

            if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
            if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
        return sorted;
    }, [list, sortField, sortDirection]);


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

        setReportLoadingAction('pdf');
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
                setReportModalError(err.message || 'Failed to generate passenger report.');
            }
        } catch (e) {
            console.error('Error generating PDF report:', e);
            setReportModalError(e?.message ? `Error: ${e.message}` : 'Error generating report.');
        } finally {
            setReportLoadingAction(null);
        }
    };

    const handleDownloadExcelReport = async (options = reportOptions) => {
        if (!options.abstract && !options.detailed) {
            setReportModalError('Select at least one report section.');
            return;
        }

        setReportLoadingAction('excel');
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
                exportHtmlAsExcel(html, 'Transport-Passenger-Report');
                setReportModalOpen(false);
            } else {
                const err = await response.json().catch(() => ({}));
                setReportModalError(err.message || 'Failed to generate passenger report.');
            }
        } catch (e) {
            console.error('Error generating Excel report:', e);
            setReportModalError(e?.message ? `Error: ${e.message}` : 'Error generating report.');
        } finally {
            setReportLoadingAction(null);
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
    const fleetRemainingPercent = totalCapacity > 0
        ? Math.max(0, 100 - fleetOccupancy)
        : 100;

    return (
        <Layout>
            <div className="mb-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div>
                    <h2 className="text-xl font-black text-slate-900 tracking-tight">Fleet & Passengers</h2>
                    <p className="text-xs text-slate-500 font-semibold mt-0.5">Manage transport requests and bus capacity.</p>
                </div>

                <div className="flex flex-col gap-2 bg-[#EAF3FF] p-1.5 rounded-xl border border-slate-200 shadow-sm w-full lg:w-auto lg:flex-row lg:items-center lg:justify-start">
                    <div className="flex flex-wrap items-center gap-2">
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

                        <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm cursor-pointer">
                            <label htmlFor="fleet-academic-year" className="text-[10px] font-black text-slate-400 uppercase tracking-wider cursor-pointer">AY</label>
                            <select
                                id="fleet-academic-year"
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                disabled={occupancyMode === 'live'}
                                className="bg-transparent text-xs font-bold text-slate-700 outline-none disabled:opacity-50 appearance-none pr-1 cursor-pointer"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>

                        {allowedCampuses.length > 1 && (
                            <div className="flex items-center gap-1.5 bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 shadow-sm cursor-pointer">
                                <label htmlFor="fleet-campus" className="text-[10px] font-black text-slate-400 uppercase tracking-wider cursor-pointer">Campus</label>
                                <select
                                    id="fleet-campus"
                                    value={selectedCampus}
                                    onChange={(e) => setSelectedCampus(e.target.value)}
                                    className="bg-transparent text-xs font-bold text-slate-700 outline-none min-w-[120px] appearance-none pr-1 cursor-pointer"
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
                    </div>

                    <button
                        type="button"
                        onClick={openReportModal}
                        disabled={isPrinting}
                        className="inline-flex items-center justify-center w-full sm:w-auto text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg font-semibold hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm border-none whitespace-nowrap"
                    >
                        <Download size={14} className="mr-1.5" />
                        Download Report
                    </button>
                </div>
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

                <div className="mt-5 flex flex-col sm:flex-row sm:justify-end gap-2">
                    <button
                        type="button"
                        onClick={() => setReportModalOpen(false)}
                        disabled={isPrinting}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="button"
                        onClick={() => handleDownloadExcelReport(reportOptions)}
                        disabled={isPrinting || (!reportOptions.abstract && !reportOptions.detailed)}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 disabled:opacity-50 flex items-center justify-center"
                    >
                        {reportLoadingAction === 'excel' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
                        Excel
                    </button>
                    <button
                        type="button"
                        onClick={() => handleDownloadReport(reportOptions)}
                        disabled={isPrinting || (!reportOptions.abstract && !reportOptions.detailed)}
                        className="w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center"
                    >
                        {reportLoadingAction === 'pdf' ? <Loader2 size={16} className="mr-2 animate-spin" /> : <Download size={16} className="mr-2" />}
                        PDF
                    </button>
                </div>
            </Modal>

            {!loading && list.length > 0 && (
                <div className="mb-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                        <div className="min-w-0">
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Occupancy Mode</p>
                            <p className="text-sm font-black text-slate-800 leading-tight">
                                {occupancyMode === 'live' ? 'Live' : academicYear}
                            </p>
                            {selectedCampusLabel && (
                                <p className="text-[9px] font-semibold text-slate-500 truncate leading-none mt-0.5">{selectedCampusLabel}</p>
                            )}
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-sm shrink-0">
                            <Activity size={16} />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Capacity</p>
                            <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{totalCapacity}</p>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                            <Bus size={16} />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-emerald-200 p-3 shadow-sm bg-emerald-50/40 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[9px] font-bold text-emerald-600 uppercase tracking-wider">Seats Filled</p>
                            <p className="text-sm font-black text-emerald-700 leading-tight mt-0.5">{totalSeatsFilled}</p>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-sm shrink-0">
                            <Users size={16} />
                        </div>
                    </div>
                    <div className="bg-white rounded-xl border border-blue-200 p-3 shadow-sm bg-blue-50/40 flex items-center justify-between gap-3">
                        <div>
                            <p className="text-[9px] font-bold text-blue-600 uppercase tracking-wider">Remaining · {fleetRemainingPercent}%</p>
                            <p className="text-sm font-black text-blue-700 leading-tight mt-0.5">{totalSeatsAvailable}</p>
                        </div>
                        <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                            <Users size={16} />
                        </div>
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
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                    <th className="px-3 py-2 w-48">Bus Details</th>
                                    <th 
                                        onClick={() => handleSort('route')}
                                        className="px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors select-none group"
                                    >
                                        <div className="flex items-center gap-1">
                                            <span>Route</span>
                                            {sortField === 'route' ? (
                                                sortDirection === 'asc' ? <ChevronUp size={11} className="text-blue-600 font-bold" /> : <ChevronDown size={11} className="text-blue-600 font-bold" />
                                            ) : (
                                                <ArrowUpDown size={11} className="text-slate-400 opacity-50 group-hover:opacity-100" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-3 py-2">Capacity</th>
                                    <th className="px-3 py-2">Seats Filled</th>
                                    <th className="px-3 py-2 font-bold text-slate-700">Rem. Seats</th>
                                    <th 
                                        onClick={() => handleSort('occupancy')}
                                        className="px-3 py-2 cursor-pointer hover:bg-slate-100 transition-colors select-none group"
                                    >
                                        <div className="flex items-center gap-1">
                                            <span>Occupancy</span>
                                            {sortField === 'occupancy' ? (
                                                sortDirection === 'asc' ? <ChevronUp size={11} className="text-blue-600 font-bold" /> : <ChevronDown size={11} className="text-blue-600 font-bold" />
                                            ) : (
                                                <ArrowUpDown size={11} className="text-slate-400 opacity-50 group-hover:opacity-100" />
                                            )}
                                        </div>
                                    </th>
                                    <th className="px-3 py-2 text-right">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {sortedList.map((item) => (
                                    <tr key={item.bus._id} className="hover:bg-blue-50/30 transition-colors group">
                                        <td className="px-3 py-2">
                                            <div>
                                                <p className="font-bold text-slate-800 text-xs">{item.bus.busNumber}</p>
                                                <p className="text-[9px] text-slate-450 font-bold uppercase tracking-wide">{item.bus.type}</p>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {item.route ? (
                                                <div className="flex items-center text-slate-750">
                                                    <MapPin size={12} className="text-slate-400 mr-1.5" />
                                                    <span className="font-medium text-xs">{item.route.routeName}</span>
                                                    <span className="ml-1.5 text-[9px] bg-slate-100 text-slate-550 px-1 py-0.5 rounded border border-slate-200 font-mono">
                                                        {item.route.routeId}
                                                    </span>
                                                </div>
                                            ) : (
                                                <span className="text-slate-400 italic text-[11px] flex items-center">
                                                    <AlertCircle size={10} className="mr-1" />
                                                    Not assigned
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 text-slate-600 font-medium text-xs">{item.capacity}</td>
                                        <td className="px-3 py-2">
                                            <div className="flex items-center font-bold text-slate-700 text-xs">
                                                <Users size={12} className="text-slate-400 mr-1.5" />
                                                {item.seatsFilled}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            <span className={`text-xs font-black ${item.seatsAvailable <= 5 ? 'text-red-500' : 'text-slate-700'}`}>
                                                {item.seatsAvailable}
                                            </span>
                                        </td>
                                        <td className="px-3 py-2">
                                            <div className="flex flex-col gap-0.5 w-24">
                                                <div className="flex justify-between items-end">
                                                    <span className={`text-[9px] font-bold ${item.occupancyPercent >= 100 ? 'text-red-600' :
                                                        item.occupancyPercent >= 80 ? 'text-amber-600' : 'text-emerald-600'
                                                        }`}>
                                                        {item.occupancyPercent}%
                                                    </span>
                                                </div>
                                                <div className="h-1 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className={`h-full rounded-full transition-all duration-500 ${item.occupancyPercent >= 100 ? 'bg-red-500' :
                                                            item.occupancyPercent >= 80 ? 'bg-amber-500' : 'bg-emerald-500'
                                                            }`}
                                                        style={{ width: `${Math.min(100, item.occupancyPercent)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                        <td className="px-3 py-2 text-right">
                                            <div className="flex items-center justify-end gap-1.5">
                                                {item.bus.assignedRouteId && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleAutoAllocate(item.bus._id)}
                                                        disabled={allocatingId !== null || item.seatsFilled >= item.capacity}
                                                        className="px-2 py-1 rounded bg-blue-600 text-white text-[9px] font-bold hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm hover:shadow transition-all active:scale-95 flex items-center"
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
                                                    className="px-2 py-1 rounded border border-slate-200 text-slate-600 text-[9px] font-bold hover:bg-slate-50 hover:text-slate-900 transition-colors"
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
