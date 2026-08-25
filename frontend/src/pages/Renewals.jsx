import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
    RefreshCw,
    Search,
    CheckCircle2,
    User,
    MapPin,
    GraduationCap,
    Clock,
    Bus,
    Check,
    AlertTriangle,
    XCircle,
    X,
    Users,
    ChevronDown,
    ChevronRight,
    Building2,
    List,
    LayoutGrid,
    Printer,
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { printHtmlDocument } from '../utils/printHtml';
import { getDefaultAcademicYear, getAcademicYearOptions, getPreviousAcademicYear } from '../utils/academicYear';

const statusDisplay = (s) => (s || 'pending').charAt(0).toUpperCase() + (s || 'pending').slice(1);
const formatFare = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const buildToBeRenewedPrintHtml = ({
    expiredYear,
    targetYear,
    routeFilter,
    routeLabel,
    courseFilter,
    searchQuery,
    pendingList,
    abstractTree,
}) => {
    const filterBits = [
        `Expired AY: ${expiredYear}`,
        `Target AY: ${targetYear}`,
        routeFilter ? `Route: ${routeLabel || routeFilter}` : null,
        courseFilter ? `Course: ${courseFilter}` : null,
        searchQuery ? `Search: ${searchQuery}` : null,
    ].filter(Boolean).join(' · ');

    const abstractRows = abstractTree.flatMap((college) => {
        const collegeRow = `
            <tr class="college-row">
                <td colspan="2"><strong>${escapeHtml(college.name)}</strong></td>
                <td class="ctr">${college.total}</td>
                <td class="ctr">${college.renewed}</td>
                <td class="ctr">${college.pending}</td>
                <td class="ctr">${college.total ? Math.round((college.renewed / college.total) * 100) : 0}%</td>
            </tr>`;

        const courseRows = college.courses.flatMap((course) => {
            const courseRow = `
                <tr class="course-row">
                    <td></td>
                    <td><strong>${escapeHtml(course.name)}</strong></td>
                    <td class="ctr">${course.total}</td>
                    <td class="ctr">${course.renewed}</td>
                    <td class="ctr">${course.pending}</td>
                    <td class="ctr">${course.total ? Math.round((course.renewed / course.total) * 100) : 0}%</td>
                </tr>`;
            const yearRows = course.years.map((yearNode) => `
                <tr class="year-row">
                    <td></td>
                    <td style="padding-left:28px;">Year ${yearNode.year}</td>
                    <td class="ctr">${yearNode.total}</td>
                    <td class="ctr">${yearNode.renewed}</td>
                    <td class="ctr">${yearNode.pending}</td>
                    <td class="ctr">${yearNode.total ? Math.round((yearNode.renewed / yearNode.total) * 100) : 0}%</td>
                </tr>`).join('');
            return courseRow + yearRows;
        }).join('');

        return collegeRow + courseRows;
    }).join('');

    const sortLabel = (a, b) => {
        if (a === 'Unknown') return 1;
        if (b === 'Unknown') return -1;
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
    };

    const yearOf = (req) => {
        const n = req.year_of_study != null ? Number(req.year_of_study) : 1;
        return Number.isFinite(n) && n > 0 ? n : 1;
    };

    const collegeGroups = (() => {
        const map = new Map();
        pendingList.forEach((req) => {
            const college = String(req.college || '').trim() || 'Unknown';
            if (!map.has(college)) map.set(college, []);
            map.get(college).push(req);
        });
        return Array.from(map.entries())
            .sort((a, b) => sortLabel(a[0], b[0]))
            .map(([college, rows]) => ({
                college,
                rows: [...rows].sort((a, b) => {
                    const courseCmp = sortLabel(
                        String(a.course || '').trim() || 'Unknown',
                        String(b.course || '').trim() || 'Unknown'
                    );
                    if (courseCmp !== 0) return courseCmp;
                    const yearCmp = yearOf(a) - yearOf(b);
                    if (yearCmp !== 0) return yearCmp;
                    return String(a.route_id || a.route_name || '').localeCompare(
                        String(b.route_id || b.route_name || ''),
                        undefined,
                        { numeric: true, sensitivity: 'base' }
                    );
                }),
            }));
    })();

    let serial = 0;
    const detailSections = collegeGroups.map(({ college, rows }) => {
        const body = rows.map((req) => {
            serial += 1;
            return `
        <tr>
            <td class="num">${serial}</td>
            <td>${escapeHtml(req.student_name || '—')}</td>
            <td>${escapeHtml(req.admission_number || '—')}</td>
            <td>${escapeHtml(req.pin_no || '—')}</td>
            <td>${escapeHtml(String(req.course || '').trim() || '—')}</td>
            <td class="num">${yearOf(req)}</td>
            <td>${escapeHtml(req.route_name || '—')}</td>
        </tr>`;
        }).join('');

        return `
  <h3 class="college-title">${escapeHtml(college)} <span>(${rows.length})</span></h3>
  <table>
    <thead>
      <tr>
        <th class="num">#</th>
        <th>Name</th>
        <th>ADM NO</th>
        <th>Pin No</th>
        <th>Course</th>
        <th class="num">Year</th>
        <th>Previous Route</th>
      </tr>
    </thead>
    <tbody>
      ${body}
    </tbody>
  </table>`;
    }).join('');

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>To Be Renewed - ${escapeHtml(expiredYear)}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 9.5px; margin: 0; }
    .print-header { text-align: center; margin-bottom: 14px; }
    h1 { font-size: 18px; margin: 0 0 6px; font-weight: 800; letter-spacing: 0.01em; }
    .print-subheader { font-size: 12px; font-weight: 700; color: #222; margin: 0; }
    h2 { font-size: 11px; margin: 14px 0 6px; border-bottom: 1px solid #222; padding-bottom: 3px; }
    h3.college-title { font-size: 10.5px; margin: 14px 0 4px; background: #e8e8e8; padding: 5px 8px; border: 1px solid #222; font-weight: 800; }
    h3.college-title span { font-weight: normal; color: #444; font-size: 9.5px; }
    table { width: 100%; border-collapse: collapse; margin: 0 0 8px 0; page-break-inside: auto; }
    tr { page-break-inside: avoid; page-break-after: auto; }
    th, td { border: 1px solid #222; padding: 3px 5px; vertical-align: middle; }
    th { background: #e8e8e8; font-size: 8.5px; text-transform: uppercase; letter-spacing: 0.02em; }
    .num { text-align: right; white-space: nowrap; }
    .ctr { text-align: center; white-space: nowrap; }
    .college-row td { background: #f3f4f6; font-weight: 700; }
    .course-row td { background: #fafafa; }
    .total-row td { font-weight: 700; background: #ececec; border-top: 2px solid #111; }
    .footer { margin-top: 12px; color: #555; font-size: 8.5px; display: flex; justify-content: space-between; }
  </style>
</head>
<body>
  <div class="print-header">
    <h1>Pydah Transport — To Be Renewed List</h1>
    <p class="print-subheader">${escapeHtml(filterBits)}</p>
  </div>

  <h2>Abstract</h2>
  <table>
    <thead>
      <tr>
        <th>College</th>
        <th>Course / Year</th>
        <th class="ctr">Total Expired</th>
        <th class="ctr">Renewed</th>
        <th class="ctr">To Be Renewed</th>
        <th class="ctr">Renewal %</th>
      </tr>
    </thead>
    <tbody>
      ${abstractRows || '<tr><td colspan="6" style="text-align:center;">No data</td></tr>'}
      <tr class="total-row">
        <td colspan="2">Grand Total</td>
        <td class="ctr">${abstractTree.reduce((s, c) => s + c.total, 0)}</td>
        <td class="ctr">${abstractTree.reduce((s, c) => s + c.renewed, 0)}</td>
        <td class="ctr">${abstractTree.reduce((s, c) => s + c.pending, 0)}</td>
        <td class="ctr">${(() => {
            const total = abstractTree.reduce((s, c) => s + c.total, 0);
            const renewed = abstractTree.reduce((s, c) => s + c.renewed, 0);
            return total ? `${Math.round((renewed / total) * 100)}%` : '0%';
        })()}</td>
      </tr>
    </tbody>
  </table>

  <h2>Detailed — To Be Renewed (${pendingList.length})</h2>
  ${detailSections || '<p style="text-align:center;">No passengers pending renewal</p>'}

  <div class="footer">
    <span>Pydah Transport Management System</span>
    <span>End of report</span>
  </div>
</body>
</html>`;
};

const EMPTY_LABEL = 'Unknown';

const buildRenewalAbstract = (list, renewedSet) => {
    const collegeMap = new Map();

    list.forEach((req) => {
        const college = String(req.college || '').trim() || EMPTY_LABEL;
        const course = String(req.course || '').trim() || EMPTY_LABEL;
        const yearRaw = req.year_of_study != null ? Number(req.year_of_study) : 1;
        const year = Number.isFinite(yearRaw) && yearRaw > 0 ? yearRaw : 1;
        const isRenewed = renewedSet.has(String(req.admission_number || '').trim());

        if (!collegeMap.has(college)) {
            collegeMap.set(college, {
                name: college,
                total: 0,
                renewed: 0,
                pending: 0,
                courses: new Map(),
            });
        }
        const collegeNode = collegeMap.get(college);
        collegeNode.total += 1;
        if (isRenewed) collegeNode.renewed += 1;
        else collegeNode.pending += 1;

        if (!collegeNode.courses.has(course)) {
            collegeNode.courses.set(course, {
                name: course,
                total: 0,
                renewed: 0,
                pending: 0,
                years: new Map(),
            });
        }
        const courseNode = collegeNode.courses.get(course);
        courseNode.total += 1;
        if (isRenewed) courseNode.renewed += 1;
        else courseNode.pending += 1;

        if (!courseNode.years.has(year)) {
            courseNode.years.set(year, { year, total: 0, renewed: 0, pending: 0 });
        }
        const yearNode = courseNode.years.get(year);
        yearNode.total += 1;
        if (isRenewed) yearNode.renewed += 1;
        else yearNode.pending += 1;
    });

    const sortLabel = (a, b) => {
        if (a === EMPTY_LABEL) return 1;
        if (b === EMPTY_LABEL) return -1;
        return a.localeCompare(b, undefined, { sensitivity: 'base' });
    };

    return Array.from(collegeMap.values())
        .sort((a, b) => sortLabel(a.name, b.name))
        .map((college) => ({
            ...college,
            courses: Array.from(college.courses.values())
                .sort((a, b) => sortLabel(a.name, b.name))
                .map((course) => ({
                    ...course,
                    years: Array.from(course.years.values()).sort((a, b) => a.year - b.year),
                })),
        }));
};

const AbstractCountCell = ({ value, tone = 'slate' }) => {
    const tones = {
        slate: 'text-slate-800',
        emerald: 'text-emerald-700',
        amber: 'text-amber-700',
    };
    return (
        <td className={`px-3 py-2.5 text-right text-xs font-bold tabular-nums whitespace-nowrap ${tones[tone] || tones.slate}`}>
            {Number(value || 0).toLocaleString('en-IN')}
        </td>
    );
};

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
    const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') === 'abstract' ? 'abstract' : 'detailed');
    const [expandedColleges, setExpandedColleges] = useState(() => new Set());
    const [expandedCourses, setExpandedCourses] = useState(() => new Set());
    const [isPrinting, setIsPrinting] = useState(false);

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
        setActiveTab(searchParams.get('tab') === 'abstract' ? 'abstract' : 'detailed');
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
        const nextTab = next.activeTab ?? activeTab;

        if (nextExpired) params.set('expiredYear', nextExpired);
        if (nextTarget) params.set('targetYear', nextTarget);
        if (nextRoute) params.set('route', nextRoute);
        if (nextCourse) params.set('course', nextCourse);
        if (nextSearch) params.set('search', nextSearch);
        if (nextStatus) params.set('status', nextStatus);
        if (nextTab && nextTab !== 'detailed') params.set('tab', nextTab);

        const qs = params.toString();
        navigate(qs ? `/renewals?${qs}` : '/renewals', { replace: true });
    };

    // Data lists
    const [requests, setRequests] = useState([]);
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
    const [feeEligibility, setFeeEligibility] = useState(null);
    const [feeEligibilityLoading, setFeeEligibilityLoading] = useState(false);

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

    // Preload target routes when renew modal target year changes
    useEffect(() => {
        fetchTargetRoutes(targetYear);
    }, [targetYear]);

    // Handle Renew trigger
    const fetchRenewalFeeEligibility = async (admissionNumber, year) => {
        if (!admissionNumber || !year) {
            setFeeEligibility(null);
            return;
        }
        setFeeEligibilityLoading(true);
        try {
            const response = await apiFetch(
                `${API_BASE}/settings/request-eligibility/check?admission_number=${encodeURIComponent(admissionNumber)}&academic_year=${encodeURIComponent(year)}`
            );
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setFeeEligibility(data);
            } else {
                setFeeEligibility(null);
            }
        } catch {
            setFeeEligibility(null);
        } finally {
            setFeeEligibilityLoading(false);
        }
    };

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
        setFeeEligibility(null);
        fetchRenewalFeeEligibility(passenger.admission_number, targetYear);
    };

    useEffect(() => {
        if (!renewModal.open || !renewModal.passenger?.admission_number) return;
        fetchRenewalFeeEligibility(renewModal.passenger.admission_number, targetYear);
    }, [targetYear, renewModal.open, renewModal.passenger?.admission_number]);

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

        if (feeEligibility && feeEligibility.enabled && !feeEligibility.ok) {
            setRenewModal(prev => ({
                ...prev,
                error: feeEligibility.message || 'Fee payment eligibility not satisfied for the target academic year.',
            }));
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
                setFeeEligibility(null);
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

    const abstractTree = useMemo(
        () => buildRenewalAbstract(filteredRequests, renewedSet),
        [filteredRequests, renewedSet]
    );

    // Stats follow page filters (route / course / search / expired year)
    const totalExpired = requests.length;
    const totalRenewed = useMemo(
        () => requests.filter((r) => renewedSet.has(String(r.admission_number || '').trim())).length,
        [requests, renewedSet]
    );
    const totalPending = totalExpired - totalRenewed;

    const sortedRoutes = useMemo(
        () => [...routes].sort((a, b) =>
            String(a.routeId || '').localeCompare(String(b.routeId || ''), undefined, { numeric: true, sensitivity: 'base' })
        ),
        [routes]
    );

    const selectedRouteLabel = useMemo(() => {
        if (!routeFilter) return '';
        const matched = routes.find((r) => String(r.routeId) === String(routeFilter));
        return matched ? `${matched.routeId} - ${matched.routeName}` : routeFilter;
    }, [routes, routeFilter]);

    // Print uses pending passengers under current API filters (year / route / course / search)
    const printPendingList = useMemo(
        () => requests.filter((r) => !renewedSet.has(String(r.admission_number || '').trim())),
        [requests, renewedSet]
    );

    const printAbstractTree = useMemo(
        () => buildRenewalAbstract(requests, renewedSet),
        [requests, renewedSet]
    );

    const toggleCollege = (collegeName) => {
        setExpandedColleges((prev) => {
            const next = new Set(prev);
            if (next.has(collegeName)) next.delete(collegeName);
            else next.add(collegeName);
            return next;
        });
    };

    const toggleCourse = (collegeName, courseName) => {
        const key = `${collegeName}::${courseName}`;
        setExpandedCourses((prev) => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    };

    const handleTabChange = (tab) => {
        setActiveTab(tab);
        syncFiltersToUrl({ activeTab: tab });
    };

    const handlePrintToBeRenewed = () => {
        if (isPrinting) return;
        if (printPendingList.length === 0) {
            setMessage({ text: 'No passengers pending renewal to print for the current filters.', type: 'error' });
            return;
        }

        setIsPrinting(true);
        try {
            const html = buildToBeRenewedPrintHtml({
                expiredYear,
                targetYear,
                routeFilter,
                routeLabel: selectedRouteLabel,
                courseFilter,
                searchQuery,
                pendingList: printPendingList,
                abstractTree: printAbstractTree,
            });
            printHtmlDocument(
                html,
                `To-Be-Renewed-${expiredYear}`,
                () => setIsPrinting(false)
            );
        } catch (error) {
            console.error('Error printing to-be-renewed list:', error);
            setMessage({ text: 'Failed to prepare print document.', type: 'error' });
            setIsPrinting(false);
        }
    };

    // Pagination calculations
    const indexOfLastRow = currentPage * rowsPerPage;
    const indexOfFirstRow = indexOfLastRow - rowsPerPage;
    const currentRequests = filteredRequests.slice(indexOfFirstRow, indexOfLastRow);
    const totalPages = Math.ceil(filteredRequests.length / rowsPerPage);

    return (
        <Layout>
            {/* Header */}
            <div className="mb-6 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="min-w-0">
                    <h2 className="text-2xl font-bold text-slate-800 tracking-tight flex items-center gap-2">
                        <RefreshCw className="text-blue-600 animate-spin-slow" size={24} />
                        Renewals Management
                    </h2>
                    <p className="text-xs text-slate-400 mt-0.5">Review expired transport passes from previous semesters/years and renew them for upcoming academic sessions.</p>
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 shrink-0">
                    <div className="flex bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-semibold gap-1">
                        <button
                            type="button"
                            onClick={() => handleTabChange('abstract')}
                            className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'abstract' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <LayoutGrid size={13} /> Abstract
                        </button>
                        <button
                            type="button"
                            onClick={() => handleTabChange('detailed')}
                            className={`px-3.5 py-2 rounded-lg transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'detailed' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <List size={13} /> Detailed
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={handlePrintToBeRenewed}
                        disabled={isPrinting || loading || printPendingList.length === 0}
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold shadow-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                        title="Print passengers still pending renewal"
                    >
                        <Printer size={14} className={isPrinting ? 'animate-pulse' : ''} />
                        {isPrinting ? 'Preparing…' : 'Print'}
                    </button>
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
                            {sortedRoutes.map((r) => (
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

            {/* Abstract: College → Course → Year (structured table) */}
            {activeTab === 'abstract' && (
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden">
                    <div className="px-4 py-3 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div>
                            <h3 className="text-sm font-bold text-slate-800">Renewal Abstract</h3>
                            <p className="text-[11px] text-slate-400 mt-0.5">
                                College → Course → Year of study for expired passengers in {expiredYear}.
                            </p>
                        </div>
                        <p className="text-[11px] font-semibold text-slate-500">
                            {filteredRequests.length} passenger{filteredRequests.length === 1 ? '' : 's'} matched
                        </p>
                    </div>

                    {loading ? (
                        <div className="py-20 flex flex-col items-center justify-center gap-3">
                            <Loader />
                            <p className="text-sm font-bold text-slate-500 animate-pulse">Loading abstract…</p>
                        </div>
                    ) : abstractTree.length === 0 ? (
                        <div className="py-20 text-center text-slate-500">
                            <p className="text-lg font-bold">No expired requests found</p>
                            <p className="text-xs text-slate-400 mt-1">Try expanding filters or selecting a different academic year.</p>
                        </div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full min-w-[720px] text-left border-collapse">
                                <thead>
                                    <tr className="bg-slate-50 border-b border-slate-200 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                                        <th className="px-4 py-3 w-[42%]">College / Course / Year</th>
                                        <th className="px-3 py-3 text-right w-[12%]">Total</th>
                                        <th className="px-3 py-3 text-right w-[12%]">Renewed</th>
                                        <th className="px-3 py-3 text-right w-[12%]">Pending</th>
                                        <th className="px-3 py-3 text-right w-[12%]">Renewal %</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {abstractTree.map((college) => {
                                        const collegeOpen = expandedColleges.has(college.name);
                                        const collegeRate = college.total > 0
                                            ? Math.round((college.renewed / college.total) * 100)
                                            : 0;

                                        return (
                                            <React.Fragment key={college.name}>
                                                <tr
                                                    className="bg-white hover:bg-blue-50/40 cursor-pointer transition-colors"
                                                    onClick={() => toggleCollege(college.name)}
                                                >
                                                    <td className="px-4 py-3">
                                                        <div className="flex items-center gap-2.5 min-w-0">
                                                            <span className="text-slate-400 shrink-0">
                                                                {collegeOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                                                            </span>
                                                            <div className="w-7 h-7 rounded-md bg-blue-50 text-blue-700 flex items-center justify-center shrink-0">
                                                                <Building2 size={14} />
                                                            </div>
                                                            <div className="min-w-0">
                                                                <p className="text-xs font-bold text-slate-900 truncate">{college.name}</p>
                                                                <p className="text-[10px] font-semibold text-slate-400">
                                                                    {college.courses.length} course{college.courses.length === 1 ? '' : 's'}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <AbstractCountCell value={college.total} />
                                                    <AbstractCountCell value={college.renewed} tone="emerald" />
                                                    <AbstractCountCell value={college.pending} tone="amber" />
                                                    <td className="px-3 py-3 text-right text-xs font-bold tabular-nums text-slate-600">
                                                        {collegeRate}%
                                                    </td>
                                                </tr>

                                                {collegeOpen && college.courses.map((course) => {
                                                    const courseKey = `${college.name}::${course.name}`;
                                                    const courseOpen = expandedCourses.has(courseKey);
                                                    const courseRate = course.total > 0
                                                        ? Math.round((course.renewed / course.total) * 100)
                                                        : 0;

                                                    return (
                                                        <React.Fragment key={courseKey}>
                                                            <tr
                                                                className="bg-slate-50/80 hover:bg-slate-100 cursor-pointer transition-colors"
                                                                onClick={() => toggleCourse(college.name, course.name)}
                                                            >
                                                                <td className="px-4 py-2.5 pl-10">
                                                                    <div className="flex items-center gap-2.5 min-w-0">
                                                                        <span className="text-slate-400 shrink-0">
                                                                            {courseOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                        </span>
                                                                        <div className="w-6 h-6 rounded bg-indigo-50 text-indigo-600 flex items-center justify-center shrink-0">
                                                                            <GraduationCap size={12} />
                                                                        </div>
                                                                        <div className="min-w-0">
                                                                            <p className="text-xs font-bold text-slate-800 truncate">{course.name}</p>
                                                                            <p className="text-[10px] font-semibold text-slate-400">
                                                                                {course.years.length} year group{course.years.length === 1 ? '' : 's'}
                                                                            </p>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                                <AbstractCountCell value={course.total} />
                                                                <AbstractCountCell value={course.renewed} tone="emerald" />
                                                                <AbstractCountCell value={course.pending} tone="amber" />
                                                                <td className="px-3 py-2.5 text-right text-xs font-bold tabular-nums text-slate-600">
                                                                    {courseRate}%
                                                                </td>
                                                            </tr>

                                                            {courseOpen && course.years.map((yearNode) => {
                                                                const yearRate = yearNode.total > 0
                                                                    ? Math.round((yearNode.renewed / yearNode.total) * 100)
                                                                    : 0;
                                                                return (
                                                                    <tr
                                                                        key={`${courseKey}::${yearNode.year}`}
                                                                        className="bg-white hover:bg-amber-50/30 transition-colors"
                                                                    >
                                                                        <td className="px-4 py-2 pl-20">
                                                                            <div className="flex items-center gap-2.5">
                                                                                <span className="inline-flex items-center justify-center w-6 h-6 rounded bg-amber-50 text-amber-700 text-[10px] font-black shrink-0">
                                                                                    Y{yearNode.year}
                                                                                </span>
                                                                                <p className="text-xs font-semibold text-slate-700">
                                                                                    Year {yearNode.year}
                                                                                </p>
                                                                            </div>
                                                                        </td>
                                                                        <AbstractCountCell value={yearNode.total} />
                                                                        <AbstractCountCell value={yearNode.renewed} tone="emerald" />
                                                                        <AbstractCountCell value={yearNode.pending} tone="amber" />
                                                                        <td className="px-3 py-2 text-right text-xs font-bold tabular-nums text-slate-600">
                                                                            {yearRate}%
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            })}
                                                        </React.Fragment>
                                                    );
                                                })}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-100 border-t-2 border-slate-200">
                                        <td className="px-4 py-3 text-xs font-black text-slate-800 uppercase tracking-wide">
                                            Grand Total
                                        </td>
                                        <AbstractCountCell
                                            value={abstractTree.reduce((sum, c) => sum + c.total, 0)}
                                        />
                                        <AbstractCountCell
                                            value={abstractTree.reduce((sum, c) => sum + c.renewed, 0)}
                                            tone="emerald"
                                        />
                                        <AbstractCountCell
                                            value={abstractTree.reduce((sum, c) => sum + c.pending, 0)}
                                            tone="amber"
                                        />
                                        <td className="px-3 py-3 text-right text-xs font-black tabular-nums text-slate-700">
                                            {(() => {
                                                const total = abstractTree.reduce((sum, c) => sum + c.total, 0);
                                                const renewed = abstractTree.reduce((sum, c) => sum + c.renewed, 0);
                                                return total > 0 ? `${Math.round((renewed / total) * 100)}%` : '0%';
                                            })()}
                                        </td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    )}
                </div>
            )}

            {/* Detailed list table */}
            {activeTab === 'detailed' && (
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
                                        <th className="px-4 py-3">College</th>
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
                                                            {req.pin_no && req.pin_no !== 'N/A' && (
                                                                <p className="text-[10px] font-semibold text-slate-400">Pin: {req.pin_no}</p>
                                                            )}
                                                        </div>
                                                    </div>
                                                </td>

                                                <td className="px-4 py-2.5">
                                                    <p className="font-semibold text-slate-700 text-[11px]">{req.college || '—'}</p>
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
            )}

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

                            {feeEligibilityLoading && (
                                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-500 text-xs font-semibold">
                                    Checking fee payment eligibility…
                                </div>
                            )}

                            {!feeEligibilityLoading && feeEligibility && feeEligibility.enabled && !feeEligibility.ok && (
                                <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs font-semibold flex items-start gap-2">
                                    <AlertTriangle size={16} className="shrink-0 mt-0.5" />
                                    <span>{feeEligibility.message}</span>
                                </div>
                            )}

                            {!feeEligibilityLoading && feeEligibility && feeEligibility.enabled && feeEligibility.ok && !feeEligibility.skipped && (
                                <div className="p-3 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-semibold">
                                    {feeEligibility.message}
                                </div>
                            )}
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
                                onClick={() => {
                                    setRenewModal(prev => ({ ...prev, open: false }));
                                    setFeeEligibility(null);
                                }}
                                className="px-5 py-2.5 rounded-xl border border-slate-200 text-xs font-bold text-slate-500 hover:bg-slate-50 transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                disabled={
                                    renewModal.saving
                                    || feeEligibilityLoading
                                    || (feeEligibility && feeEligibility.enabled && !feeEligibility.ok)
                                }
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
