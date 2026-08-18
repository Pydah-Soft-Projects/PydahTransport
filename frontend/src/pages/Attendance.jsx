import React, { useState, useEffect } from 'react';
import { Search, Calendar, Users, CheckCircle2, XCircle, Info, X, ChevronLeft, ChevronRight, Download, Filter, ClipboardList, BookOpen, MapPin, UserCheck } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';

const Attendance = () => {
    // Current user context
    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const admin = {
        name: adminInfo.name || adminInfo.username || 'Admin',
        id: adminInfo.id || 1,
    };

    // Date range default helpers
    const getFirstDayOfCurrentMonth = () => {
        const d = new Date();
        return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
    };

    const getTodayDate = () => {
        return new Date().toISOString().split('T')[0];
    };

    // Filter states
    const academicYearOptions = getAcademicYearOptions();
    const currentYear = getDefaultAcademicYear();

    const [academicYear, setAcademicYear] = useState(currentYear);
    const [startDate, setStartDate] = useState(getFirstDayOfCurrentMonth());
    const [endDate, setEndDate] = useState(getTodayDate());
    const [monthSelect, setMonthSelect] = useState('');
    const [routeFilter, setRouteFilter] = useState('');
    const [courseFilter, setCourseFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');

    // Pagination states
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);

    // Data lists
    const [records, setRecords] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [courses, setCourses] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');

    // Detail Modal state
    const [detailModal, setDetailModal] = useState({
        open: false,
        student: null,
        loading: false,
        records: [],
        error: ''
    });

    // Quick Month Select handler
    const handleMonthChange = (e) => {
        const monthVal = e.target.value;
        setMonthSelect(monthVal);
        if (!monthVal) return;

        const currentYearNum = new Date().getFullYear();
        let monthIndex = 0;
        let yearNum = currentYearNum;

        // Parse month select (e.g. "2025-11" or "current-month")
        if (monthVal === 'current') {
            const now = new Date();
            monthIndex = now.getMonth();
            yearNum = now.getFullYear();
        } else if (monthVal === 'last') {
            const now = new Date();
            now.setMonth(now.getMonth() - 1);
            monthIndex = now.getMonth();
            yearNum = now.getFullYear();
        } else {
            const parts = monthVal.split('-');
            yearNum = Number(parts[0]);
            monthIndex = Number(parts[1]);
        }

        const firstDay = new Date(yearNum, monthIndex, 1);
        const lastDay = new Date(yearNum, monthIndex + 1, 0);

        setStartDate(firstDay.toISOString().split('T')[0]);
        setEndDate(lastDay.toISOString().split('T')[0]);
        setCurrentPage(1);
    };

    // Load static lists (routes and courses)
    const fetchFilterMasters = async () => {
        try {
            const [routesRes, requestsRes] = await Promise.all([
                apiFetch(`${API_BASE}/routes`),
                apiFetch(`${API_BASE}/transport-requests?status=approved&limit=1000`)
            ]);

            if (routesRes.ok) {
                const data = await routesRes.json();
                setRoutes(Array.isArray(data) ? data : []);
            }

            if (requestsRes.ok) {
                const data = await requestsRes.json();
                const studentList = data.requests || [];
                // Extract unique course names for dropdown
                const uniqueCourses = [...new Set(studentList.map(s => s.application_course_code || s.course_name).filter(Boolean))];
                setCourses(uniqueCourses);
            }
        } catch (e) {
            console.error('Error fetching attendance filter masters:', e);
        }
    };

    // Fetch summary data
    const fetchAttendanceSummary = async () => {
        setLoading(true);
        setError('');
        try {
            let url = `${API_BASE}/transport-requests/attendance?academicYear=${encodeURIComponent(academicYear)}&startDate=${startDate}&endDate=${endDate}`;
            if (routeFilter) url += `&route=${encodeURIComponent(routeFilter)}`;
            if (courseFilter) url += `&course=${encodeURIComponent(courseFilter)}`;
            if (searchQuery) url += `&search=${encodeURIComponent(searchQuery)}`;

            const res = await apiFetch(url);
            const data = await res.json();
            if (res.ok) {
                setRecords(data.summary || []);
            } else {
                setError(data.message || 'Failed to fetch attendance records.');
            }
        } catch (err) {
            console.error(err);
            setError('Connection error while fetching attendance summary.');
        } finally {
            setLoading(false);
        }
    };

    // Fetch detail log for a specific passenger
    const handleViewDetails = async (student) => {
        setDetailModal({
            open: true,
            student,
            loading: true,
            records: [],
            error: ''
        });

        try {
            const res = await apiFetch(`${API_BASE}/transport-requests/attendance/${student.admission_number}?startDate=${startDate}&endDate=${endDate}`);
            const data = await res.json();
            if (res.ok) {
                setDetailModal(prev => ({
                    ...prev,
                    loading: false,
                    records: data.records || []
                }));
            } else {
                setDetailModal(prev => ({
                    ...prev,
                    loading: false,
                    error: data.message || 'Failed to fetch passenger attendance log.'
                }));
            }
        } catch (err) {
            console.error(err);
            setDetailModal(prev => ({
                ...prev,
                loading: false,
                error: 'Connection error while loading detail records.'
            }));
        }
    };

    useEffect(() => {
        fetchFilterMasters();
    }, []);

    useEffect(() => {
        fetchAttendanceSummary();
    }, [academicYear, startDate, endDate, routeFilter, courseFilter, searchQuery]);

    // CSV Export
    const handleExportCSV = () => {
        if (!records.length) return;
        const headers = ['Admission Number', 'Student Name', 'Course', 'Route', 'Present Days', 'Absent Days', 'Holiday Days', 'Total Days', 'Attendance Rate (%)'];
        const rows = records.map(r => [
            r.admission_number,
            r.student_name,
            r.course,
            r.route_name,
            r.present_days,
            r.absent_days,
            r.holiday_days,
            r.total_days,
            r.attendance_percentage
        ]);

        const csvContent = "data:text/csv;charset=utf-8," 
            + [headers.join(','), ...rows.map(e => e.map(val => `"${String(val).replace(/"/g, '""')}"`).join(','))].join('\n');
            
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `Passenger_Attendance_${startDate}_to_${endDate}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Calculate aggregated stats
    const totalStudents = records.length;
    const avgPercentage = totalStudents > 0 
        ? (records.reduce((acc, curr) => acc + curr.attendance_percentage, 0) / totalStudents).toFixed(1)
        : 0;
    const totalPresentCount = records.reduce((acc, curr) => acc + curr.present_days, 0);
    const totalAbsentCount = records.reduce((acc, curr) => acc + curr.absent_days, 0);

    // Pagination calculations
    const indexOfLastRow = currentPage * rowsPerPage;
    const indexOfFirstRow = indexOfLastRow - rowsPerPage;
    const currentRows = records.slice(indexOfFirstRow, indexOfLastRow);
    const totalPages = Math.ceil(records.length / rowsPerPage);

    // Build dynamic list of months for filter (e.g. past 6 months)
    const getMonthFilterOptions = () => {
        const options = [];
        const monthNames = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
        const d = new Date();
        for (let i = 0; i < 12; i++) {
            const m = d.getMonth();
            const y = d.getFullYear();
            options.push({
                value: `${y}-${m}`,
                label: `${monthNames[m]} ${y}`
            });
            d.setMonth(d.getMonth() - 1);
        }
        return options;
    };

    const monthOptions = getMonthFilterOptions();

    return (
        <Layout>
            <div className="flex flex-col space-y-5 p-4 sm:p-6 bg-slate-50 min-h-screen">
                {/* Header */}
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between space-y-3 sm:space-y-0">
                    <div>
                        <h1 className="text-xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                            <ClipboardList className="text-blue-600" size={24} />
                            Passenger Attendance
                        </h1>
                        <p className="text-xs text-slate-500 mt-0.5">
                            Monitor passenger bus boarding log summaries, attendance percentages, and overall status records.
                        </p>
                    </div>

                    <div className="flex items-center space-x-2">
                        <button
                            onClick={handleExportCSV}
                            disabled={records.length === 0}
                            className="flex items-center space-x-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-xl text-xs font-semibold hover:bg-slate-50 transition-colors shadow-sm disabled:opacity-60"
                        >
                            <Download size={14} />
                            <span>Export CSV</span>
                        </button>
                    </div>
                </div>

                {/* Statistics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                    {/* Stats 1 */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex items-center space-x-3.5 hover:shadow-md transition-shadow">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
                            <Users size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Total Passengers</p>
                            <h3 className="text-lg font-bold text-slate-800 mt-0.5">{totalStudents}</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Active transport requests</p>
                        </div>
                    </div>

                    {/* Stats 2 */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex items-center space-x-3.5 hover:shadow-md transition-shadow">
                        <div className={`p-3 rounded-xl ${avgPercentage >= 75 ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>
                            <BookOpen size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Average Attendance</p>
                            <h3 className="text-lg font-bold text-slate-800 mt-0.5">{avgPercentage}%</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Present to active ratio</p>
                        </div>
                    </div>

                    {/* Stats 3 */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex items-center space-x-3.5 hover:shadow-md transition-shadow">
                        <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
                            <CheckCircle2 size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Present Markings</p>
                            <h3 className="text-lg font-bold text-emerald-600 mt-0.5">{totalPresentCount}</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Total present logs</p>
                        </div>
                    </div>

                    {/* Stats 4 */}
                    <div className="bg-white p-4 border border-slate-100 rounded-2xl shadow-sm flex items-center space-x-3.5 hover:shadow-md transition-shadow">
                        <div className="p-3 bg-rose-50 text-rose-600 rounded-xl">
                            <XCircle size={20} />
                        </div>
                        <div>
                            <p className="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Absent Markings</p>
                            <h3 className="text-lg font-bold text-rose-600 mt-0.5">{totalAbsentCount}</h3>
                            <p className="text-[10px] text-slate-400 mt-0.5">Total absent logs</p>
                        </div>
                    </div>
                </div>

                {/* Filter Controls Panel */}
                <div className="bg-white border border-slate-100 rounded-2xl p-4 shadow-sm flex flex-col space-y-3">
                    {/* Top Row: Date Ranges & Months */}
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3.5 items-end">
                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Academic Year</label>
                            <select
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Quick Month Select</label>
                            <select
                                value={monthSelect}
                                onChange={handleMonthChange}
                                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                            >
                                <option value="">Custom Date Range</option>
                                <option value="current">Current Month</option>
                                <option value="last">Previous Month</option>
                                {monthOptions.map((opt) => (
                                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">From Date</label>
                            <div className="relative">
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value);
                                        setMonthSelect('');
                                        setCurrentPage(1);
                                    }}
                                    className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">To Date</label>
                            <div className="relative">
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => {
                                        setEndDate(e.target.value);
                                        setMonthSelect('');
                                        setCurrentPage(1);
                                    }}
                                    className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Bottom Row: Search & dropdowns */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5 items-end">
                        <div className="relative">
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Search Passenger</label>
                            <div className="relative">
                                <Search className="absolute left-3 top-2.5 text-slate-400" size={14} />
                                <input
                                    type="text"
                                    placeholder="Name or admission number..."
                                    value={searchQuery}
                                    onChange={(e) => {
                                        setSearchQuery(e.target.value);
                                        setCurrentPage(1);
                                    }}
                                    className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 text-slate-700 bg-white placeholder:text-slate-400 font-semibold"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Filter by Route</label>
                            <select
                                value={routeFilter}
                                onChange={(e) => {
                                    setRouteFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                            >
                                <option value="">All Routes</option>
                                {routes.map((r) => (
                                    <option key={r.id || r._id} value={r.routeName}>{r.routeName}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">Filter by Course</label>
                            <select
                                value={courseFilter}
                                onChange={(e) => {
                                    setCourseFilter(e.target.value);
                                    setCurrentPage(1);
                                }}
                                className="w-full text-xs rounded-xl border border-slate-200 px-3 py-2 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
                            >
                                <option value="">All Courses</option>
                                {courses.map((c) => (
                                    <option key={c} value={c}>{c}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>

                {/* Main Table / Data Panel */}
                <div className="bg-white border border-slate-100 rounded-2xl shadow-sm overflow-hidden flex flex-col">
                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center space-y-3">
                            <Loader size={35} />
                            <span className="text-xs text-slate-400 font-semibold">Analyzing attendance data...</span>
                        </div>
                    ) : error ? (
                        <div className="py-16 text-center">
                            <span className="text-xs text-rose-500 font-semibold">{error}</span>
                        </div>
                    ) : !records.length ? (
                        <div className="py-16 text-center flex flex-col items-center justify-center space-y-2">
                            <Info className="text-slate-300" size={36} />
                            <h4 className="text-sm font-semibold text-slate-700">No Attendance Records Found</h4>
                            <p className="text-xs text-slate-400 max-w-xs">
                                There are no passenger attendance log details registered for the selected filters.
                            </p>
                        </div>
                    ) : (
                        <>
                            <div className="overflow-x-auto">
                                <table className="w-full text-left border-collapse text-xs">
                                    <thead>
                                        <tr className="bg-slate-50/70 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                                            <th className="py-3 px-4 text-center w-12">S.No</th>
                                            <th className="py-3 px-4">Adm No</th>
                                            <th className="py-3 px-4">Student Name</th>
                                            <th className="py-3 px-4">Course</th>
                                            <th className="py-3 px-4">Route</th>
                                            <th className="py-3 px-4 text-center">Present</th>
                                            <th className="py-3 px-4 text-center">Absent</th>
                                            <th className="py-3 px-4 text-center">Holiday</th>
                                            <th className="py-3 px-4 text-center">Total Logs</th>
                                            <th className="py-3 px-4 text-center w-32">Rate (%)</th>
                                            <th className="py-3 px-4 text-center w-28">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100 text-slate-700 font-medium">
                                        {currentRows.map((r, i) => {
                                            const sNo = indexOfFirstRow + i + 1;
                                            const rate = r.attendance_percentage;
                                            const rateColor = rate >= 75 
                                                ? 'bg-emerald-100 text-emerald-800'
                                                : rate >= 50
                                                    ? 'bg-amber-100 text-amber-800'
                                                    : 'bg-rose-100 text-rose-800';

                                            return (
                                                <tr key={r.admission_number} className="hover:bg-slate-50/50 transition-colors">
                                                    <td className="py-2.5 px-4 text-center text-slate-400 font-bold">{sNo}</td>
                                                    <td className="py-2.5 px-4 font-bold text-slate-600">{r.admission_number}</td>
                                                    <td className="py-2.5 px-4">
                                                        <div className="flex items-center space-x-2">
                                                            <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] shadow-sm">
                                                                {r.student_name.charAt(0).toUpperCase()}
                                                            </div>
                                                            <span className="font-bold text-slate-800">{r.student_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-4">
                                                        <div className="flex items-center space-x-1">
                                                            <BookOpen size={12} className="text-slate-400" />
                                                            <span>{r.course}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-4">
                                                        <div className="flex items-center space-x-1">
                                                            <MapPin size={12} className="text-slate-400" />
                                                            <span className="truncate max-w-[150px]">{r.route_name}</span>
                                                        </div>
                                                    </td>
                                                    <td className="py-2.5 px-4 text-center text-emerald-600 font-bold">{r.present_days}</td>
                                                    <td className="py-2.5 px-4 text-center text-rose-600 font-bold">{r.absent_days}</td>
                                                    <td className="py-2.5 px-4 text-center text-slate-400">{r.holiday_days}</td>
                                                    <td className="py-2.5 px-4 text-center font-bold text-slate-500">{r.total_days}</td>
                                                    <td className="py-2.5 px-4 text-center">
                                                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold shadow-sm ${rateColor}`}>
                                                            {rate}%
                                                        </span>
                                                    </td>
                                                    <td className="py-2.5 px-4 text-center">
                                                        <button
                                                            onClick={() => handleViewDetails(r)}
                                                            className="px-2.5 py-1 text-[10px] bg-blue-50 text-blue-600 font-bold rounded-lg hover:bg-blue-100 transition-colors shadow-sm"
                                                        >
                                                            View Logs
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="border-t border-slate-100 px-4 py-3 flex items-center justify-between text-xs text-slate-500 font-medium">
                                    <span>
                                        Showing {indexOfFirstRow + 1} to {Math.min(indexOfLastRow, records.length)} of {records.length} entries
                                    </span>
                                    <div className="flex items-center space-x-1">
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                            disabled={currentPage === 1}
                                            className="p-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            <ChevronLeft size={16} />
                                        </button>
                                        {Array.from({ length: totalPages }).map((_, idx) => (
                                            <button
                                                key={idx}
                                                onClick={() => setCurrentPage(idx + 1)}
                                                className={`px-2.5 py-1 rounded-lg border font-bold transition-all shadow-sm ${
                                                    currentPage === idx + 1
                                                        ? 'bg-blue-600 text-white border-blue-600'
                                                        : 'border-slate-200 text-slate-600 hover:bg-slate-50'
                                                }`}
                                            >
                                                {idx + 1}
                                            </button>
                                        ))}
                                        <button
                                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                            disabled={currentPage === totalPages}
                                            className="p-1 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors shadow-sm"
                                        >
                                            <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
            </div>

            {/* Attendance Details Modal */}
            <Modal
                isOpen={detailModal.open}
                onClose={() => setDetailModal(prev => ({ ...prev, open: false }))}
                title={`${detailModal.student?.student_name}'s Attendance Logs`}
                maxWidth="max-w-xl"
            >
                <div className="space-y-4">
                    {/* Student Info Card */}
                    {detailModal.student && (
                        <div className="p-3.5 bg-slate-50 rounded-xl border border-slate-100 flex justify-between items-center text-xs">
                            <div className="space-y-1">
                                <h4 className="font-bold text-slate-800 text-sm">{detailModal.student.student_name}</h4>
                                <p className="text-slate-400 font-semibold">Adm No: <span className="text-slate-600">{detailModal.student.admission_number}</span></p>
                            </div>
                            <div className="text-right space-y-1 text-slate-400 font-semibold">
                                <p>Course: <span className="text-slate-600">{detailModal.student.course}</span></p>
                                <p>Route: <span className="text-slate-600 truncate max-w-[120px] inline-block align-bottom">{detailModal.student.route_name}</span></p>
                            </div>
                        </div>
                    )}

                    {/* Records view */}
                    {detailModal.loading ? (
                        <div className="py-12 flex flex-col items-center justify-center space-y-2">
                            <Loader size={24} />
                            <span className="text-xs text-slate-400 font-medium">Loading logs...</span>
                        </div>
                    ) : detailModal.error ? (
                        <div className="py-8 text-center text-xs text-rose-500 font-semibold">
                            {detailModal.error}
                        </div>
                    ) : !detailModal.records.length ? (
                        <div className="py-12 text-center text-xs text-slate-400 font-medium">
                            No day-by-day logs registered for the selected date range.
                        </div>
                    ) : (
                        <div className="space-y-3">
                            <h5 className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Chronological Records</h5>
                            <div className="max-h-64 overflow-y-auto border border-slate-100 rounded-xl divide-y divide-slate-100">
                                {detailModal.records.map((rec, index) => {
                                    const dateStr = new Date(rec.attendance_date).toLocaleDateString('en-IN', {
                                        day: '2-digit',
                                        month: 'short',
                                        year: 'numeric'
                                    });

                                    const isPresent = rec.status === 'present';
                                    const isHoliday = rec.status === 'holiday';
                                    const statusBadgeColor = isPresent
                                        ? 'bg-emerald-100 text-emerald-800'
                                        : isHoliday
                                            ? 'bg-blue-100 text-blue-800'
                                            : 'bg-rose-100 text-rose-800';

                                    return (
                                        <div key={index} className="flex justify-between items-center p-3 hover:bg-slate-50/50 transition-colors text-xs">
                                            <div className="flex items-center space-x-2">
                                                <Calendar size={14} className="text-slate-400" />
                                                <span className="font-bold text-slate-700">{dateStr}</span>
                                            </div>
                                            <div className="flex items-center space-x-2">
                                                {rec.remarks && (
                                                    <span className="text-[10px] text-slate-400 max-w-[150px] truncate" title={rec.remarks}>
                                                        {rec.remarks}
                                                    </span>
                                                )}
                                                {isHoliday && rec.holiday_reason && (
                                                    <span className="text-[10px] text-blue-500 max-w-[150px] truncate" title={rec.holiday_reason}>
                                                        Holiday: {rec.holiday_reason}
                                                    </span>
                                                )}
                                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${statusBadgeColor}`}>
                                                    {rec.status}
                                                </span>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <div className="flex justify-end pt-2 border-t border-slate-100">
                        <button
                            onClick={() => setDetailModal(prev => ({ ...prev, open: false }))}
                            className="px-4 py-2 bg-slate-100 text-slate-700 font-bold rounded-xl text-xs hover:bg-slate-200 transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </Modal>
        </Layout>
    );
};

export default Attendance;
