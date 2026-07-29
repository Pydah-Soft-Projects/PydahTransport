import React, { useState, useEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import { useReactToPrint } from 'react-to-print';
import { FileText, Trash2, Calendar, Pencil, Users, CheckCircle2, XCircle, User, MapPin, GraduationCap, Clock, Bus, Printer, Ban } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import TransportAdmitCard from '../components/TransportAdmitCard';
import TransportBusIdCardSheet from '../components/TransportBusIdCardSheet';
import Loader from '../components/Loader';
import { apiFetch, API_BASE } from '../utils/api';
import { triggerAdmitCardPrint } from '../utils/printAdmitCard';
import { printHtmlDocument } from '../utils/printHtml';
import QRCode from 'qrcode';
import { getTransportVerifyUrl } from '../utils/siteUrl';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { normalizeStudentPhoto } from '../utils/studentPhoto';

const statusDisplay = (s) => (s || 'pending').charAt(0).toUpperCase() + (s || 'pending').slice(1);

const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const formatFare = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

const getFareSummary = (request) => {
    if (request?.user_type === 'employee') {
        return {
            normal: 'Free (₹0)',
            adjusted: null,
            label: null,
            hasAdjustment: false,
        };
    }

    const normalFare = request?.original_fare ?? request?.fare;
    const payableFare = request?.payable_fare ?? normalFare;
    const hasAdjustment = Boolean(request?.has_fare_adjustment);

    return {
        normal: formatFare(normalFare),
        adjusted: hasAdjustment ? formatFare(payableFare) : null,
        label: request?.fare_adjustment_type === 'CONCESSION' ? 'After concession' : 'Revised fee',
        hasAdjustment,
    };
};

const FareDisplay = ({ request }) => {
    if (request?.user_type === 'employee') {
        return <span className="text-slate-500 text-xs font-semibold">Free (₹0)</span>;
    }

    const fare = getFareSummary(request);
    return (
        <div className="space-y-0.5 text-xs">
            <p className="font-semibold text-slate-800">Normal: {fare.normal}</p>
            {fare.hasAdjustment && (
                <p className="text-[10px] font-bold text-emerald-750">
                    {fare.label}: {fare.adjusted}
                </p>
            )}
        </div>
    );
};

const courseExpiryKey = (courseId, yearOfStudy) => `${Number(courseId)}-${Number(yearOfStudy)}`;

const TransportRequests = () => {
    const [requests, setRequests] = useState([]);
    const [routes, setRoutes] = useState([]);
    const [courses, setCourses] = useState([]);
    const [routeFilter, setRouteFilter] = useState('');
    const [courseFilter, setCourseFilter] = useState('');
    const [statusFilter, setStatusFilter] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [rowsPerPage, setRowsPerPage] = useState(10);
    const [userTypeFilter, setUserTypeFilter] = useState('student'); // 'student' or 'employee'

    const filteredRequestsByType = React.useMemo(() => {
        const list = requests.filter((r) => {
            const userType = r.user_type || 'student';
            return userType === userTypeFilter;
        });
        return [...list].sort((a, b) => {
            const aNeed = a.new_id_card_needed ? 1 : 0;
            const bNeed = b.new_id_card_needed ? 1 : 0;
            return bNeed - aNeed;
        });
    }, [requests, userTypeFilter]);
    const [loading, setLoading] = useState(true);
    const [actionLoading, setActionLoading] = useState(null);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [approveModal, setApproveModal] = useState({ open: false, requestId: null, data: null, selectedBusId: '', loading: true, error: null });
    const [selectedPassPassenger, setSelectedPassPassenger] = useState(null);
    const [fetchingPass, setFetchingPass] = useState(false);
    const [courseExpiryModalOpen, setCourseExpiryModalOpen] = useState(false);
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear());
    const [selectedExpiryCourseId, setSelectedExpiryCourseId] = useState('');
    const [courseExpiryList, setCourseExpiryList] = useState([]);
    const [courseExpiryLoading, setCourseExpiryLoading] = useState(false);
    const [courseExpirySaving, setCourseExpirySaving] = useState(null);
    const [courseExpiryEdits, setCourseExpiryEdits] = useState({});
    const [courseExpirySchemaOk, setCourseExpirySchemaOk] = useState(true);
    const [editingYears, setEditingYears] = useState({});
    const [detailModal, setDetailModal] = useState({ open: false, request: null, loading: false });
    const [cancelFormOpen, setCancelFormOpen] = useState(false);
    const [cancelReason, setCancelReason] = useState('');
    const [idCardModalOpen, setIdCardModalOpen] = useState(false);
    const [idCardAcademicYear, setIdCardAcademicYear] = useState(getDefaultAcademicYear());
    const [idCardCollegeCode, setIdCardCollegeCode] = useState('');
    const [idCardCourseCode, setIdCardCourseCode] = useState('');
    const [idCardAllApplications, setIdCardAllApplications] = useState([]);
    const [idCardApplicationsLoading, setIdCardApplicationsLoading] = useState(false);
    const [idCardFromSerial, setIdCardFromSerial] = useState('');
    const [idCardToSerial, setIdCardToSerial] = useState('');
    const [idCardPerPage, setIdCardPerPage] = useState(6);
    const [idCardPassengers, setIdCardPassengers] = useState([]);
    const [idCardPadToFullPage, setIdCardPadToFullPage] = useState(true);
    const [idCardPrintLoading, setIdCardPrintLoading] = useState(false);
    const [fetchingIdCard, setFetchingIdCard] = useState(false);
    const [idCardPreviewCount, setIdCardPreviewCount] = useState(null);
    const [downloadingReport, setDownloadingReport] = useState(false);
    const [selectedRequestIds, setSelectedRequestIds] = useState([]);
    // Stores the full row data for every selected ID so names remain visible
    // even after the filter/search changes and that row is no longer in `requests`.
    const [selectedRequestsMap, setSelectedRequestsMap] = useState({});
    const [idCardPrintMode, setIdCardPrintMode] = useState('range');
    const academicYearOptions = getAcademicYearOptions();

    const admitCardRef = useRef();
    const idCardSheetRef = useRef();
    const handlePrintAdmitCardClick = async (p) => {
        if (fetchingPass || fetchingIdCard) return;
        setFetchingPass(true);
        try {
            const response = await apiFetch(`${API_BASE}/print`, {
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

    const attachQrToPassenger = async (passenger) => {
        const verifyUrl = getTransportVerifyUrl(passenger.id ?? passenger._id);
        if (!verifyUrl) return passenger;
        try {
            const qrDataUrl = await QRCode.toDataURL(verifyUrl, {
                errorCorrectionLevel: 'M',
                margin: 1,
                width: 256,
            });
            return { ...passenger, qrDataUrl };
        } catch {
            return passenger;
        }
    };

    const handlePrintIdCardClick = async (req) => {
        if (fetchingIdCard || fetchingPass) return;
        if (req.status !== 'approved') {
            setMessage({ text: 'ID card is available only for approved requests.', type: 'error' });
            return;
        }
        setFetchingIdCard(true);
        try {
            const response = await apiFetch(`${API_BASE}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'transport-bus-idcard-sheet',
                    data: {
                        requestIds: [req.id],
                        academicYear: req.academic_year || academicYear,
                        cardsPerPage: 6,
                        padToFullPage: false
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Bus-ID-Card-${req.admission_number || req.id}`);
            } else {
                alert('Failed to generate ID card.');
            }
        } catch (error) {
            console.error('Error printing ID card:', error);
            alert('Error preparing ID card.');
        } finally {
            setFetchingIdCard(false);
        }
    };

    const handleDownloadReport = async () => {
        if (downloadingReport || currentRequests.length === 0) return;
        setDownloadingReport(true);
        try {
            const requestIds = currentRequests.map(r => r.id || r._id);
            const response = await apiFetch(`${API_BASE}/print`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    template: 'passenger-report',
                    data: {
                        requestIds,
                        academicYear: academicYear || undefined,
                        includeAbstract: false,
                        includeDetailed: true,
                        isRequestsReport: true,
                    }
                })
            });
            if (response.ok) {
                const html = await response.text();
                printHtmlDocument(html, `Transport-Requests-Report-${academicYear || 'All'}`);
            } else {
                alert('Failed to generate report.');
            }
        } catch (error) {
            console.error('Error generating report:', error);
            alert('Error generating report.');
        } finally {
            setDownloadingReport(false);
        }
    };

    const toggleSelectRequest = (req, e) => {
        e.stopPropagation();
        if ((req.status || '').toLowerCase() !== 'approved') {
            alert('Selection is only available for approved requests.');
            return;
        }
        const id = req.id;
        setSelectedRequestIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
        );
        setSelectedRequestsMap((prev) => {
            if (prev[id]) {
                // deselecting — remove from map
                const next = { ...prev };
                delete next[id];
                return next;
            }
            // selecting — store the row
            return { ...prev, [id]: req };
        });
    };

    const handleSelectAll = (e) => {
        const visibleApproved = filteredRequestsByType.filter(r => (r.status || '').toLowerCase() === 'approved');
        const visibleApprovedIds = visibleApproved.map(r => r.id);
        if (e.target.checked) {
            setSelectedRequestIds((prev) => [...new Set([...prev, ...visibleApprovedIds])]);
            setSelectedRequestsMap((prev) => {
                const next = { ...prev };
                visibleApproved.forEach(r => { next[r.id] = r; });
                return next;
            });
        } else {
            setSelectedRequestIds((prev) => prev.filter(id => !visibleApprovedIds.includes(id)));
            setSelectedRequestsMap((prev) => {
                const next = { ...prev };
                visibleApprovedIds.forEach(id => { delete next[id]; });
                return next;
            });
        }
    };



    const idCardCollegeOptions = [...new Set(
        idCardAllApplications.map((app) => app.college_code).filter(Boolean)
    )].sort();
    const idCardCourseOptions = [...new Set(
        idCardAllApplications
            .filter((app) => !idCardCollegeCode || app.college_code === idCardCollegeCode)
            .map((app) => app.course_code)
            .filter(Boolean)
    )].sort();
    const idCardApplications = idCardAllApplications.filter((app) => {
        if (idCardCollegeCode && app.college_code !== idCardCollegeCode) return false;
        if (idCardCourseCode && app.course_code !== idCardCourseCode) return false;
        return true;
    });

    const buildIdCardQuery = (fromSerial, toSerial) => {
        const params = new URLSearchParams({
            academicYear: idCardAcademicYear,
            fromSerial: String(fromSerial),
            toSerial: String(toSerial),
        });
        if (idCardCollegeCode) params.append('collegeCode', idCardCollegeCode);
        if (idCardCourseCode) params.append('courseCode', idCardCourseCode);
        return params.toString();
    };

    const fetchIdCardApplications = async (year) => {
        setIdCardApplicationsLoading(true);
        try {
            const response = await apiFetch(
                `${API_BASE}/transport-requests/id-card-application-numbers?academicYear=${encodeURIComponent(year)}`
            );
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                const apps = data.applications || [];
                setIdCardAllApplications(apps);
                setIdCardCollegeCode('');
                setIdCardCourseCode('');
                setIdCardFromSerial('');
                setIdCardToSerial('');
                setIdCardPreviewCount(null);
            } else {
                setIdCardAllApplications([]);
                setIdCardFromSerial('');
                setIdCardToSerial('');
                setMessage({ text: data.message || 'Failed to load transport application numbers.', type: 'error' });
            }
        } catch {
            setIdCardAllApplications([]);
            setIdCardFromSerial('');
            setIdCardToSerial('');
            setMessage({ text: 'Error loading transport application numbers.', type: 'error' });
        } finally {
            setIdCardApplicationsLoading(false);
        }
    };

    useEffect(() => {
        if (!idCardApplications.length) {
            setIdCardFromSerial('');
            setIdCardToSerial('');
            return;
        }
        setIdCardFromSerial(String(idCardApplications[0].application_serial));
        setIdCardToSerial(String(idCardApplications[idCardApplications.length - 1].application_serial));
        setIdCardPreviewCount(null);
    }, [idCardCollegeCode, idCardCourseCode, idCardAllApplications]);

    const openIdCardModal = () => {
        setIdCardAcademicYear(academicYear);
        setIdCardPreviewCount(null);
        setIdCardPrintMode(selectedRequestIds.length > 0 ? 'selected' : 'range');
        setIdCardModalOpen(true);
    };

    const closeIdCardModal = () => {
        if (idCardPrintLoading) return;
        setIdCardModalOpen(false);
        setIdCardPreviewCount(null);
    };

    const handleIdCardFromChange = (serial) => {
        setIdCardFromSerial(serial);
        setIdCardPreviewCount(null);
        if (idCardToSerial && Number(idCardToSerial) < Number(serial)) {
            setIdCardToSerial(serial);
        }
    };

    const idCardToOptions = idCardApplications.filter(
        (app) => !idCardFromSerial || Number(app.application_serial) >= Number(idCardFromSerial)
    );

    const validateIdCardRange = () => {
        if (!idCardApplications.length) {
            setMessage({ text: 'No approved transport application numbers found for this academic year.', type: 'error' });
            return null;
        }
        const fromSerial = Number(idCardFromSerial);
        const toSerial = Number(idCardToSerial);
        if (!Number.isFinite(fromSerial) || !Number.isFinite(toSerial) || toSerial < fromSerial) {
            setMessage({ text: 'Select a valid transport application number range (From ≤ To).', type: 'error' });
            return null;
        }
        return { fromSerial, toSerial };
    };

    const handlePreviewIdCardCount = async () => {
        const range = validateIdCardRange();
        if (!range) return;
        const { fromSerial, toSerial } = range;
        setIdCardPrintLoading(true);
        try {
            const response = await apiFetch(
                `${API_BASE}/transport-requests/id-cards-print?${buildIdCardQuery(fromSerial, toSerial)}`
            );
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setIdCardPreviewCount(data.count ?? 0);
            } else {
                setMessage({ text: data.message || 'Failed to preview ID cards.', type: 'error' });
            }
        } catch {
            setMessage({ text: 'Error previewing ID cards.', type: 'error' });
        } finally {
            setIdCardPrintLoading(false);
        }
    };

    const handleConfirmPrintIdCards = async () => {
        let requestIds = [];
        
        if (idCardPrintMode === 'selected') {
            if (!selectedRequestIds.length) {
                setMessage({ text: 'No passengers selected for printing.', type: 'error' });
                return;
            }
            requestIds = selectedRequestIds;
        } else {
            const range = validateIdCardRange();
            if (!range) return;
            const { fromSerial, toSerial } = range;
            setIdCardPrintLoading(true);
            try {
                const response = await apiFetch(
                    `${API_BASE}/transport-requests/id-cards-print?${buildIdCardQuery(fromSerial, toSerial)}`
                );
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    setMessage({ text: data.message || 'Failed to load ID cards for printing.', type: 'error' });
                    setIdCardPrintLoading(false);
                    return;
                }
                const passengers = data.passengers || [];
                if (!passengers.length) {
                    setMessage({ text: 'No approved passengers found in that application number range.', type: 'error' });
                    setIdCardPrintLoading(false);
                    return;
                }
                requestIds = passengers.map(p => p.id || p._id);
            } catch (error) {
                console.error('Error printing ID cards:', error);
                setMessage({ text: 'Error preparing ID cards for print.', type: 'error' });
                setIdCardPrintLoading(false);
                return;
            }
        }

        setIdCardPrintLoading(true);
        try {
            // Request printed ID Card Sheet HTML from the backend Print Service
            const printResponse = await apiFetch(`${API_BASE}/print`, {
                method: 'POST',
                body: JSON.stringify({
                    template: 'transport-bus-idcard-sheet',
                    data: {
                        requestIds,
                        academicYear: academicYear,
                        cardsPerPage: 6,
                        padToFullPage: true
                    }
                })
            });

            if (printResponse.ok) {
                const html = await printResponse.text();
                printHtmlDocument(html, `Bus-ID-Cards-Range-${academicYear}`);
                setIdCardModalOpen(false);
                setSelectedRequestIds([]); // Clear selections after successful printing
                setSelectedRequestsMap({});
            } else {
                setMessage({ text: 'Failed to generate ID card sheet HTML.', type: 'error' });
            }
        } catch (error) {
            console.error('Error printing ID cards:', error);
            setMessage({ text: 'Error preparing ID cards for print.', type: 'error' });
        } finally {
            setIdCardPrintLoading(false);
        }
    };

    const openDetailModal = async (req) => {
        // Open modal immediately with list data so it appears responsive
        setDetailModal({ open: true, request: req, loading: true });
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${req.id}/full-details`);
            if (response.ok) {
                const freshData = await response.json();
                // Merge fresh transport fields on top of list-row data (which has expiry, is_expired, etc.)
                setDetailModal((prev) => ({
                    ...prev,
                    loading: false,
                    request: { ...req, ...freshData },
                }));
                // Also update the requests list so re-opened modal stays consistent
                setRequests((prev) =>
                    prev.map((r) => (r.id === req.id ? { ...r, ...freshData } : r))
                );
            } else {
                setDetailModal((prev) => ({ ...prev, loading: false }));
            }
        } catch {
            setDetailModal((prev) => ({ ...prev, loading: false }));
        }
    };

    const closeDetailModal = () => {
        setDetailModal({ open: false, request: null, loading: false });
        setCancelFormOpen(false);
        setCancelReason('');
    };

    const fetchRequests = async () => {
        setLoading(true);
        try {
            let url = `${API_BASE}/transport-requests?`;
            const params = new URLSearchParams();
            if (academicYear) params.append('academicYear', academicYear);
            if (routeFilter) params.append('route_id', routeFilter);
            if (courseFilter) params.append('course', courseFilter);
            if (statusFilter) params.append('status', statusFilter);
            if (searchQuery) params.append('search', searchQuery);

            url += params.toString();

            const response = await apiFetch(url);
            if (response.ok) {
                const data = await response.json();
                data.sort((a, b) => {
                    const appA = a.application_number;
                    const appB = b.application_number;
                    if (appA && appB) {
                        return appB.localeCompare(appA, undefined, { numeric: true, sensitivity: 'base' });
                    }
                    if (appA) return -1;
                    if (appB) return 1;
                    return new Date(b.request_date) - new Date(a.request_date);
                });
                setRequests(data);
            } else {
                console.error('Failed to fetch requests');
            }
        } catch (error) {
            console.error('Error fetching requests:', error);
        } finally {
            setLoading(false);
        }
    };

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

    const fetchCourseExpiry = async () => {
        setCourseExpiryLoading(true);
        try {
            const response = await apiFetch(`${API_BASE}/students/course-expiry?academicYear=${encodeURIComponent(academicYear)}`);
            const data = await response.json();
            if (response.ok) {
                setCourseExpiryList(data.courses || []);
                setCourseExpirySchemaOk(data.yearWiseKeyOk !== false);
                const edits = {};
                (data.courses || []).forEach((c) => {
                    if (c.expiry_date) {
                        edits[courseExpiryKey(c.course_id, c.year_of_study)] = c.expiry_date.slice(0, 10);
                    }
                });
                setCourseExpiryEdits(edits);
                if (data.yearWiseKeyOk === false && data.migrationHint) {
                    setMessage({ text: data.migrationHint, type: 'error' });
                }
            } else {
                setMessage({ text: data.message || 'Failed to load course expiry settings.', type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Error loading course expiry settings.', type: 'error' });
        } finally {
            setCourseExpiryLoading(false);
        }
    };

    const handleSaveCourseExpiry = async (courseId, courseName, yearOfStudy) => {
        const expiryDate = courseExpiryEdits[courseExpiryKey(courseId, yearOfStudy)];
        if (!expiryDate) {
            setMessage({ text: 'Please select an expiry date.', type: 'error' });
            return;
        }
        const saveKey = courseExpiryKey(courseId, yearOfStudy);
        setCourseExpirySaving(saveKey);
        try {
            const response = await apiFetch(`${API_BASE}/students/course-expiry`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    course_id: Number(courseId),
                    academic_year: academicYear,
                    year_of_study: Number(yearOfStudy),
                    expiry_date: expiryDate,
                }),
            });
            const data = await response.json();
            if (response.ok) {
                setMessage({ text: data.message || `Expiry set for ${courseName} Year ${yearOfStudy}.`, type: 'success' });
                setEditingYears((prev) => {
                    const next = { ...prev };
                    delete next[saveKey];
                    return next;
                });
                fetchCourseExpiry();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to save course expiry.', type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Error saving course expiry.', type: 'error' });
        } finally {
            setCourseExpirySaving(null);
        }
    };

    const handleClearCourseExpiry = async (courseId, courseName, yearOfStudy) => {
        if (!window.confirm(`Remove expiry for ${courseName} Year ${yearOfStudy}? Students will fall back to semester-based expiry.`)) return;
        const saveKey = courseExpiryKey(courseId, yearOfStudy);
        setCourseExpirySaving(saveKey);
        try {
            const response = await apiFetch(
                `${API_BASE}/students/course-expiry/${courseId}?academicYear=${encodeURIComponent(academicYear)}&yearOfStudy=${yearOfStudy}`,
                { method: 'DELETE' }
            );
            const data = await response.json();
            if (response.ok) {
                setMessage({ text: data.message || 'Course expiry removed.', type: 'success' });
                setCourseExpiryEdits((prev) => {
                    const next = { ...prev };
                    delete next[courseExpiryKey(courseId, yearOfStudy)];
                    return next;
                });
                setEditingYears((prev) => {
                    const next = { ...prev };
                    delete next[courseExpiryKey(courseId, yearOfStudy)];
                    return next;
                });
                fetchCourseExpiry();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to remove course expiry.', type: 'error' });
            }
        } catch (e) {
            setMessage({ text: 'Error removing course expiry.', type: 'error' });
        } finally {
            setCourseExpirySaving(null);
        }
    };

    const openCourseExpiryModal = () => {
        setCourseExpiryModalOpen(true);
        setSelectedExpiryCourseId('');
        setEditingYears({});
    };

    const closeCourseExpiryModal = () => {
        setCourseExpiryModalOpen(false);
        setSelectedExpiryCourseId('');
        setEditingYears({});
    };

    const handleAcademicYearChange = (value) => {
        setAcademicYear(value);
        setSelectedExpiryCourseId('');
        setEditingYears({});
    };

    const startEditYear = (rowKey, existingDate) => {
        setEditingYears((prev) => ({ ...prev, [rowKey]: true }));
        if (existingDate) {
            setCourseExpiryEdits((prev) => ({ ...prev, [rowKey]: existingDate.slice(0, 10) }));
        }
    };

    const cancelEditYear = (rowKey, hadExpiry, existingDate) => {
        setEditingYears((prev) => {
            const next = { ...prev };
            delete next[rowKey];
            return next;
        });
        if (hadExpiry && existingDate) {
            setCourseExpiryEdits((prev) => ({ ...prev, [rowKey]: existingDate.slice(0, 10) }));
        } else {
            setCourseExpiryEdits((prev) => {
                const next = { ...prev };
                delete next[rowKey];
                return next;
            });
        }
    };

    const getYearsForSelectedCourse = () => {
        if (!selectedExpiryCourseId) return [];
        const fromApi = courseExpiryList.filter(
            (c) => String(c.course_id) === String(selectedExpiryCourseId)
        );
        if (fromApi.length > 0) return fromApi;

        const course = courses.find((c) => String(c.id) === String(selectedExpiryCourseId));
        if (!course) return [];
        const totalYears = course.total_years || 4;
        return Array.from({ length: totalYears }, (_, index) => ({
            course_id: course.id,
            course_name: course.name,
            year_of_study: index + 1,
            expiry_date: null,
            is_past: 0,
            passenger_count: 0,
            active_passenger_count: 0,
            expired_passenger_count: 0,
        }));
    };

    const selectedCourseMeta = courses.find((c) => String(c.id) === String(selectedExpiryCourseId));
    const selectedCourseYears = getYearsForSelectedCourse();
    const selectedCoursePassengerTotal = selectedCourseYears.reduce(
        (sum, row) => sum + Number(row.passenger_count || 0),
        0
    );
    const selectedCourseActiveTotal = selectedCourseYears.reduce(
        (sum, row) => sum + Number(row.active_passenger_count || 0),
        0
    );

    useEffect(() => {
        fetchRoutes();
        fetchCourses();
    }, []);

    useEffect(() => {
        if (courseExpiryModalOpen) {
            fetchCourseExpiry();
        }
    }, [courseExpiryModalOpen, academicYear]);

    useEffect(() => {
        if (idCardModalOpen) {
            fetchIdCardApplications(idCardAcademicYear);
        }
    }, [idCardModalOpen, idCardAcademicYear]);

    useEffect(() => {
        fetchRequests();
        setCurrentPage(1);
    }, [academicYear, routeFilter, courseFilter, statusFilter, searchQuery]);

    // Re-fetch requests when the browser tab/page becomes visible again,
    // so changes made in other pages (e.g. route change in AdminRaiseRequest) are reflected.
    useEffect(() => {
        const handleVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                fetchRequests();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    }, [academicYear, routeFilter, courseFilter, statusFilter, searchQuery]);

    const isExpiredPass = (req) => {
        const normalizedStatus = (req.status || '').toLowerCase();
        return normalizedStatus === 'expired' || (normalizedStatus === 'approved' && Boolean(req.is_expired));
    };

    const calculateStats = () => {
        const total = requests.length;
        const students = requests.filter(r => r.user_type === 'student').length;
        const employees = requests.filter(r => r.user_type === 'employee').length;
        const approved = requests.filter(r => (r.status || '').toLowerCase() === 'approved' && !isExpiredPass(r)).length;
        const expired = requests.filter(r => isExpiredPass(r)).length;
        const pending = requests.filter(r => (r.status || '').toLowerCase() === 'pending').length;
        const rejected = requests.filter(r => (r.status || '').toLowerCase() === 'rejected').length;
        const cancelled = requests.filter(r => (r.status || '').toLowerCase() === 'cancelled').length;
        return { total, students, employees, approved, expired, pending, rejected, cancelled };
    };

    const stats = calculateStats();

    // Pagination logic
    const indexOfLastRow = currentPage * rowsPerPage;
    const indexOfFirstRow = indexOfLastRow - rowsPerPage;
    const currentRequests = filteredRequestsByType.slice(indexOfFirstRow, indexOfLastRow);
    const totalPages = Math.ceil(filteredRequestsByType.length / rowsPerPage);

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
                setApproveModal((m) => ({
                    ...m,
                    data,
                    selectedBusId: defaultBusId,
                    loading: false,
                    error: null,
                }));
            } else {
                setApproveModal((m) => ({ ...m, loading: false, error: data.message || 'Failed to load semester options' }));
            }
        } catch (err) {
            setApproveModal((m) => ({ ...m, loading: false, error: 'Could not load semester options' }));
        }
    };

    const closeApproveModal = () => {
        setApproveModal({ open: false, requestId: null, data: null, selectedBusId: '', loading: true, error: null });
    };

    const handleConfirmApprove = async () => {
        const id = approveModal.requestId;
        if (!id) return;
        
        if (approveModal.data?.busesOnRoute?.length > 0 && !approveModal.selectedBusId) {
            setApproveModal(m => ({ ...m, error: 'Please select a bus to assign the passenger to.' }));
            return;
        }

        setActionLoading(id);
        setMessage({ text: '', type: '' });
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
                        ? `Approved. Application No: ${data.application_number}`
                        : (data.message || 'Request approved. Transport fee created in Fee Management.'),
                    type: 'success',
                });
                closeApproveModal();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to approve', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Something went wrong. Please try again.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleApprove = (id) => {
        closeDetailModal();
        openApproveModal(id);
    };

    const handleReject = async (id) => {
        setActionLoading(id);
        setMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${id}/reject`, {
                method: 'PATCH',
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setMessage({ text: data.message || 'Request rejected.', type: 'success' });
                closeDetailModal();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to reject', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Something went wrong. Please try again.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleCancelRequest = async (id) => {
        const reason = cancelReason.trim();
        if (!reason) {
            setMessage({ text: 'Please enter a cancellation reason.', type: 'error' });
            return;
        }

        if (!window.confirm('Cancel this transport request? The seat will be vacated but the record will be kept.')) {
            return;
        }

        setActionLoading(id);
        setMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${id}/cancel`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reason }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setMessage({ text: data.message || 'Transport request cancelled.', type: 'success' });
                closeDetailModal();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to cancel request', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Something went wrong. Please try again.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const handleDelete = async (id) => {
        if (!window.confirm('Are you sure you want to delete this request? If approved, this will also remove associated fees and concessions.')) {
            return;
        }

        setActionLoading(id);
        setMessage({ text: '', type: '' });
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${id}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    admin_name: 'Admin', // In a real app, this would come from auth state
                    admin_id: 1
                })
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                setMessage({ text: data.message || 'Request deleted successfully.', type: 'success' });
                closeDetailModal();
                fetchRequests();
            } else {
                setMessage({ text: data.message || 'Failed to delete request', type: 'error' });
            }
        } catch (err) {
            setMessage({ text: 'Something went wrong. Please try again.', type: 'error' });
        } finally {
            setActionLoading(null);
        }
    };

    const isPending = (req) => (req.status || '').toLowerCase() === 'pending';

    return (
        <Layout>
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">Transport Requests</h2>
                    <p className="text-slate-500 text-xs mt-0.5">View, approve, or reject student transport requests. Approval creates the transport fee (TRN01) in Fee Management.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={handleDownloadReport}
                        disabled={downloadingReport || loading || currentRequests.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-semibold text-xs hover:bg-emerald-700 shadow-sm transition-all hover:shadow-md active:scale-95 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                        <FileText size={14} />
                        {downloadingReport ? 'Preparing...' : 'Download Report'}
                    </button>
                    <button
                        type="button"
                        onClick={openIdCardModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900 text-white font-semibold text-xs hover:bg-blue-800 shadow-sm transition-all hover:shadow-md active:scale-95 cursor-pointer"
                    >
                        <Printer size={14} />
                        Print ID Cards
                    </button>
                    <button
                        type="button"
                        onClick={openCourseExpiryModal}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-purple-600 text-white font-semibold text-xs hover:bg-purple-700 shadow-sm transition-all hover:shadow-md active:scale-95 cursor-pointer"
                    >
                        <Calendar size={14} />
                        Course Expiry Settings
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Requests</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.total}</p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">({stats.students} Stud, {stats.employees} Emp)</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                        <FileText size={16} />
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Active Approved</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.approved}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-500 text-white flex items-center justify-center shadow-sm shrink-0">
                        <CheckCircle2 size={16} />
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Expired Passes</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.expired}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-rose-500 text-white flex items-center justify-center shadow-sm shrink-0">
                        <Ban size={16} />
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pending</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.pending}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-amber-500 text-white flex items-center justify-center shadow-sm shrink-0">
                        <Clock size={16} />
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Rejected</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.rejected}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-red-600 text-white flex items-center justify-center shadow-sm shrink-0">
                        <XCircle size={16} />
                    </div>
                </div>
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Cancelled</p>
                        <p className="text-sm font-black text-slate-800 leading-tight mt-0.5">{stats.cancelled}</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center shadow-sm shrink-0">
                        <Trash2 size={16} />
                    </div>
                </div>
            </div>

            {message.text && (
                <div className={`mb-6 p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {message.text}
                </div>
            )}

            <div className="flex w-full flex-wrap items-center gap-2 mb-4 bg-white p-3 rounded-xl shadow-sm border border-slate-200">
                <div className="flex-1 min-w-[145px]">
                    <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-slate-700 bg-transparent cursor-pointer"
                    >
                        <option value="">All Academic Years</option>
                        {academicYearOptions.map((year) => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                </div>

                <div className="flex-[2] min-w-[180px] relative">
                    <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>
                    <input
                        type="text"
                        placeholder="Search name/ID..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8.5 pr-2 py-1.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-xs text-slate-800 placeholder-slate-400 font-medium"
                    />
                </div>

                <div className="flex-1 min-w-[120px]">
                    <select
                        value={routeFilter}
                        onChange={(e) => setRouteFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-ellipsis text-slate-700 font-bold bg-transparent cursor-pointer"
                    >
                        <option value="">All Routes</option>
                        {routes.map((r) => (
                            <option key={r._id} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                        ))}
                    </select>
                </div>

                <div className="flex-1 min-w-[120px]">
                    <select
                        value={courseFilter}
                        onChange={(e) => setCourseFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-ellipsis text-slate-700 font-bold bg-transparent cursor-pointer"
                    >
                        <option value="">All Courses</option>
                        {courses.map((c) => (
                            <option key={c.id} value={c.name}>{c.name}</option>
                        ))}
                    </select>
                </div>

                <div className="flex-1 min-w-[120px]">
                    <select
                        value={statusFilter}
                        onChange={(e) => setStatusFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all text-ellipsis text-slate-700 font-bold bg-transparent cursor-pointer"
                    >
                        <option value="">All Status</option>
                        <option value="pending">Pending</option>
                        <option value="approved">Approved (all)</option>
                        <option value="active">Active (not expired)</option>
                        <option value="expired">Expired</option>
                        <option value="rejected">Rejected</option>
                        <option value="cancelled">Cancelled</option>
                    </select>
                </div>

                {(routeFilter || courseFilter || statusFilter || searchQuery) && (
                    <div className="flex-shrink-0">
                        <button
                            onClick={() => { setRouteFilter(''); setCourseFilter(''); setStatusFilter(''); setSearchQuery(''); }}
                            className="text-xs text-red-650 hover:text-red-750 font-bold px-3 py-1.5 border border-red-100 bg-red-50 rounded-lg transition-all cursor-pointer"
                        >
                            Reset
                        </button>
                    </div>
                )}
            </div>
            {loading ? (
                <div className="py-20">
                    <Loader text="Loading requests..." />
                </div>
            ) : requests.length === 0 ? (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 text-center text-slate-400 font-semibold text-xs">
                    No transport requests found{academicYear ? ` for academic year ${academicYear}` : ''}.
                </div>
            ) : (
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    {/* Pagination Controls */}
                    <div className="p-3 border-b border-slate-200 flex flex-wrap items-center justify-between gap-4 bg-slate-50/80">
                    <div className="flex items-center gap-4">
                        <div className="flex items-center gap-2">
                            <span className="text-sm text-gray-600 font-medium">Rows per page:</span>
                            <select
                                value={rowsPerPage}
                                onChange={(e) => {
                                    setRowsPerPage(Number(e.target.value));
                                    setCurrentPage(1);
                                }}
                                className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white shadow-sm"
                            >
                                <option value={10}>10</option>
                                <option value={20}>20</option>
                                <option value={50}>50</option>
                                <option value={100}>100</option>
                            </select>
                        </div>

                        {/* User Type Tabs */}
                        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 shadow-sm">
                            <button
                                type="button"
                                onClick={() => {
                                    setUserTypeFilter('student');
                                    setCurrentPage(1);
                                }}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${userTypeFilter === 'student'
                                    ? 'bg-blue-900 text-white shadow-sm'
                                    : 'text-slate-500 hover:bg-slate-50'
                                    }`}
                            >
                                Students
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setUserTypeFilter('employee');
                                    setCurrentPage(1);
                                }}
                                className={`px-3 py-1.5 rounded-md text-[11px] font-bold uppercase tracking-wide transition-colors cursor-pointer ${userTypeFilter === 'employee'
                                    ? 'bg-blue-900 text-white shadow-sm'
                                    : 'text-slate-500 hover:bg-slate-50'
                                    }`}
                            >
                                Employees
                            </button>
                        </div>
                    </div>
                        <div className="flex items-center gap-4 text-sm text-gray-600">
                            <span>
                                Showing <span className="font-semibold text-gray-900">{indexOfFirstRow + 1}</span> to <span className="font-semibold text-gray-900">{Math.min(indexOfLastRow, requests.length)}</span> of <span className="font-semibold text-gray-900">{requests.length}</span> entries
                            </span>
                            <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg shadow-sm p-1">
                                <button
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                    className="p-1 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
                                </button>
                                <span className="px-3 font-medium text-gray-700 bg-gray-50 py-1 rounded-md border border-gray-100">Page {currentPage} of {totalPages || 1}</span>
                                <button
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages || totalPages === 0}
                                    className="p-1 rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                    <th className="px-3 py-2 w-8">
                                        <input
                                            type="checkbox"
                                            checked={
                                                requests.length > 0 &&
                                                requests
                                                    .filter(r => (r.status || '').toLowerCase() === 'approved')
                                                    .every(r => selectedRequestIds.includes(r.id))
                                                && requests.some(r => (r.status || '').toLowerCase() === 'approved')
                                            }
                                            onChange={handleSelectAll}
                                            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                        />
                                    </th>
                                    <th className="px-3 py-2">Pin Number</th>
                                    <th className="px-3 py-2">Adm Number</th>
                                    <th className="px-3 py-2">App No.</th>
                                    <th className="px-3 py-2">Name</th>
                                    <th className="px-3 py-2">Academic Info</th>
                                    <th className="px-3 py-2">Fare</th>
                                    <th className="px-3 py-2">Status</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs text-slate-700">
                                {currentRequests.map((req) => (
                                    <tr
                                        key={req.id}
                                        onClick={() => openDetailModal(req)}
                                        className="hover:bg-slate-50/60 transition-colors border-b border-slate-100/60 cursor-pointer text-xs"
                                    >
                                        <td className="px-3 py-2 w-8" onClick={(e) => e.stopPropagation()}>
                                            {(req.status || '').toLowerCase() === 'approved' ? (
                                                <input
                                                    type="checkbox"
                                                    checked={selectedRequestIds.includes(req.id)}
                                                    onChange={(e) => toggleSelectRequest(req, e)}
                                                    className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                                                />
                                            ) : (
                                                <input
                                                    type="checkbox"
                                                    disabled
                                                    className="opacity-20 cursor-not-allowed"
                                                />
                                            )}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-slate-700 text-xs">
                                            {req.user_type === 'employee' ? '—' : (req.pin_no || '—')}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-blue-600">{req.admission_number || req.emp_no}</td>
                                        <td className="px-3 py-2 font-bold text-indigo-700">{req.application_number || '—'}</td>
                                        <td className="px-3 py-2 font-semibold text-slate-900">
                                            <div className="flex flex-col gap-0.5">
                                                <span>{req.student_name || req.employee_name}</span>
                                                {req.new_id_card_needed && (
                                                    <span className="w-fit inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-[8px] font-black uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200 animate-pulse">
                                                        New Card Needed
                                                    </span>
                                                )}
                                            </div>
                                        </td>
                                        <td className="px-3 py-2">
                                            {req.user_type === 'employee' ? (
                                                <span className="text-[10px] bg-slate-50 border border-slate-200 px-1.5 py-0.5 rounded text-slate-500 font-bold">Employee</span>
                                            ) : (
                                                <div className="flex flex-col gap-0.5">
                                                    <span className="text-[11px] font-bold uppercase text-slate-800 tracking-wide">{req.course || '—'}</span>
                                                    <div className="flex items-center gap-1 text-[9px] text-slate-400 font-bold uppercase tracking-wider">
                                                        <span className="bg-blue-50 text-blue-700 px-1 py-0.5 rounded font-black border border-blue-200/50">
                                                            Y{req.year_of_study || '—'}
                                                        </span>
                                                        <span>•</span>
                                                        <span className="font-semibold text-slate-500">{req.academic_year || '—'}</span>
                                                    </div>
                                                </div>
                                            )}
                                        </td>
                                        <td className="px-3 py-2 font-semibold text-slate-950">
                                            <FareDisplay request={req} />
                                        </td>
                                        <td className="px-3 py-2">
                                            {isExpiredPass(req) ? (
                                                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border border-red-200 bg-red-50 text-red-700">
                                                    Expired
                                                </span>
                                            ) : (
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border ${(req.status || '').toLowerCase() === 'approved' ? 'bg-green-50 border-green-200 text-green-700' :
                                                    (req.status || '').toLowerCase() === 'pending' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                                                    (req.status || '').toLowerCase() === 'cancelled' ? 'bg-orange-50 border-orange-200 text-orange-750' :
                                                        'bg-slate-50 border-slate-200 text-slate-600'
                                                    }`}>
                                                    {statusDisplay(req.status)}
                                                </span>
                                            )}
                                            {req.effective_expiry_date && req.user_type !== 'employee' && (
                                                <p className="text-[9px] text-slate-400 font-semibold mt-1">
                                                    Until {formatDate(req.effective_expiry_date)}
                                                    {req.course_expiry_date ? ` (course Y${req.year_of_study || '?'})` : ''}
                                                </p>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    
                    <TransportAdmitCard ref={admitCardRef} passenger={selectedPassPassenger} />
                </div>
            )
            }

            <Modal
                isOpen={detailModal.open}
                onClose={closeDetailModal}
                title="Passenger Request"
                maxWidth="max-w-5xl"
                noScroll
            >
                {detailModal.loading && (
                    <div className="flex items-center gap-2 text-sm text-slate-500 py-2 px-1">
                        <svg className="animate-spin h-4 w-4 text-blue-500" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                        Refreshing details…
                    </div>
                )}
                {detailModal.request && (() => {
                    const req = detailModal.request;
                    const name = req.student_name || req.employee_name || '—';
                    const idNo = req.admission_number || req.emp_no || '—';
                    const isEmployee = req.user_type === 'employee';
                    const fareSummary = getFareSummary(req);
                    const statusKey = (req.status || '').toLowerCase();
                    const statusStyles = isExpiredPass(req)
                        ? 'bg-red-50 text-red-700 ring-red-100'
                        : statusKey === 'approved'
                            ? 'bg-emerald-50 text-emerald-700 ring-emerald-100'
                            : statusKey === 'pending'
                                ? 'bg-amber-50 text-amber-700 ring-amber-100'
                                : statusKey === 'cancelled'
                                    ? 'bg-orange-50 text-orange-700 ring-orange-100'
                                : 'bg-slate-100 text-slate-600 ring-slate-200';

                    const DetailItem = ({ icon: Icon, label, value }) => (
                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50/80 border border-slate-100 min-w-0">
                            <div className="p-1.5 rounded-md bg-white text-slate-500 shrink-0 border border-slate-100">
                                <Icon size={14} />
                            </div>
                            <div className="min-w-0">
                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">{label}</p>
                                <p className="text-sm font-semibold text-slate-900 mt-0.5 truncate" title={value}>{value}</p>
                            </div>
                        </div>
                    );

                    const photoSrc = normalizeStudentPhoto(req.student_photo);

                    return (
                        <div className="space-y-5">

                            {/* ── TOP: Photo + Student Details ───────────────────────── */}
                            <div className="relative overflow-hidden rounded-2xl bg-white border border-slate-200 p-5 shadow-sm">
                                {/* decorative blob */}
                                <div className="pointer-events-none absolute -top-6 -right-6 w-36 h-36 rounded-full bg-blue-50" />

                                <div className="relative flex flex-col sm:flex-row gap-5">
                                    {/* Photo */}
                                    <div className="shrink-0 self-center sm:self-start">
                                        <div className="w-28 h-36 sm:w-32 sm:h-40 rounded-2xl border-2 border-slate-200 overflow-hidden bg-slate-50 shadow-md flex items-center justify-center">
                                            {photoSrc ? (
                                                <img
                                                    src={photoSrc}
                                                    alt={name}
                                                    className="w-full h-full object-cover object-top"
                                                />
                                            ) : (
                                                <div className="flex flex-col items-center gap-1.5">
                                                    <User size={32} className="text-slate-300" />
                                                    <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wide">No Photo</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Student Details beside photo */}
                                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                                        {/* Name + ID + badges */}
                                        <div>
                                            <div className="flex flex-wrap items-center gap-2 mb-2">
                                                <span className={`px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide ring-1 ${isEmployee ? 'bg-purple-100 text-purple-700 ring-purple-200' : 'bg-blue-100 text-blue-700 ring-blue-200'}`}>
                                                    {req.user_type || 'student'}
                                                </span>
                                                <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold ring-1 ${statusStyles}`}>
                                                    {isExpiredPass(req) ? 'Expired' : statusDisplay(req.status)}
                                                </span>
                                                {req.new_id_card_needed && (
                                                    <span className="px-2.5 py-0.5 rounded-lg text-[10px] font-bold uppercase tracking-wide bg-amber-150 text-amber-900 ring-1 ring-amber-250 animate-pulse">
                                                        New ID Card Needed
                                                    </span>
                                                )}
                                            </div>
                                            {/* Name and ID on same line */}
                                            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                                                <h4 className="text-xl sm:text-2xl font-black leading-tight uppercase tracking-wide text-slate-900">{name}</h4>
                                                <span className="text-sm font-bold text-blue-600 shrink-0">{idNo}</span>
                                            </div>
                                        </div>

                                        {/* Key info chips */}
                                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                                            {!isEmployee && req.course && (
                                                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Course</p>
                                                    <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{req.course}{req.branch ? ` · ${req.branch}` : ''}</p>
                                                </div>
                                            )}
                                            {!isEmployee && req.year_of_study != null && (
                                                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Year</p>
                                                    <p className="text-xs font-bold text-slate-800 mt-0.5">Year {req.year_of_study}</p>
                                                </div>
                                            )}
                                            {req.academic_year && (
                                                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Academic Year</p>
                                                    <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{req.academic_year}</p>
                                                </div>
                                            )}
                                            {req.application_number && (
                                                <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                    <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Application No.</p>
                                                    <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{req.application_number}</p>
                                                </div>
                                            )}
                                            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Requested</p>
                                                <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">{formatDate(req.request_date)}</p>
                                            </div>
                                            <div className="rounded-xl bg-slate-50 border border-slate-100 px-3 py-2 min-w-0">
                                                <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wide leading-none">Raised By</p>
                                                <p className="text-xs font-bold text-slate-800 mt-0.5 truncate">
                                                    {req.raised_by
                                                        ? `${req.raised_by.charAt(0).toUpperCase() + req.raised_by.slice(1)}${req.raised_by_id ? ` (${req.raised_by_id})` : ''}`
                                                        : 'Student'}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── BOTTOM: Transport Details + Actions ─────────────────── */}
                            <div className="grid grid-cols-1 lg:grid-cols-[1fr_220px] gap-5 items-start">
                                {/* Transport Details — full left column */}
                                <div>
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2.5">Transport Details</p>
                                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                                        {/* Route — full width so long names never truncate */}
                                        <div className="col-span-2 md:col-span-3 flex items-start gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50/80 border border-slate-100 min-w-0">
                                            <div className="p-1.5 rounded-md bg-white text-slate-500 shrink-0 border border-slate-100 mt-0.5">
                                                <MapPin size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">Route</p>
                                                <p className="text-sm font-semibold text-slate-900 mt-0.5 break-words whitespace-normal">{req.route_name || '—'}</p>
                                            </div>
                                        </div>
                                        <DetailItem icon={Bus} label="Stage" value={req.stage_name || '—'} />
                                        <DetailItem icon={Bus} label="Bus" value={req.bus_id || 'Not assigned'} />
                                        <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl bg-slate-50/80 border border-slate-100 min-w-0">
                                            <div className="p-1.5 rounded-md bg-white text-slate-500 shrink-0 border border-slate-100">
                                                <FileText size={14} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[9px] font-bold uppercase tracking-wider text-slate-400 leading-none">Fare</p>
                                                <p className="text-sm font-semibold text-slate-900 mt-0.5">Normal: {fareSummary.normal}</p>
                                                {fareSummary.hasAdjustment && (
                                                    <p className="text-[11px] font-bold text-emerald-700">
                                                        {fareSummary.label}: {fareSummary.adjusted}
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                        {req.effective_expiry_date && !isEmployee && (
                                            <DetailItem icon={Clock} label="Valid Until" value={formatDate(req.effective_expiry_date)} />
                                        )}
                                        {req.is_expired != null && !isEmployee && (
                                            <DetailItem
                                                icon={Clock}
                                                label="Pass Status"
                                                value={req.is_expired ? 'Expired' : 'Valid'}
                                            />
                                        )}
                                    </div>
                                </div>

                                <div className="lg:border-l lg:pl-5 border-slate-100">
                                    <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-2">Actions</p>
                                    <div className="space-y-2">
                                        {isPending(req) && (
                                            <>
                                                <button
                                                    type="button"
                                                    onClick={() => handleApprove(req.id)}
                                                    disabled={actionLoading !== null}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-50 shadow-sm transition-colors"
                                                >
                                                    <CheckCircle2 size={17} />
                                                    Approve
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleReject(req.id)}
                                                    disabled={actionLoading !== null}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-amber-700 text-sm font-bold border border-amber-200 hover:bg-amber-50 disabled:opacity-50 transition-colors"
                                                >
                                                    <XCircle size={17} />
                                                    {actionLoading === req.id ? 'Rejecting…' : 'Reject'}
                                                </button>
                                            </>
                                        )}
                                        {req.status === 'approved' && (
                                            <>
                                                <button
                                                    type="button"
                                                    disabled={fetchingPass || fetchingIdCard}
                                                    onClick={() => handlePrintAdmitCardClick(req)}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-slate-900 text-white text-sm font-bold hover:bg-black disabled:opacity-50 shadow-sm transition-colors"
                                                >
                                                    <FileText size={17} />
                                                    {fetchingPass ? 'Preparing…' : 'Print Admit Card'}
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={fetchingPass || fetchingIdCard}
                                                    onClick={() => handlePrintIdCardClick(req)}
                                                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-blue-700 text-white text-sm font-bold hover:bg-blue-800 disabled:opacity-50 shadow-sm transition-colors"
                                                >
                                                    <Printer size={17} />
                                                    {fetchingIdCard ? 'Preparing…' : 'Print ID Card'}
                                                </button>
                                                {!cancelFormOpen ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            setCancelFormOpen(true);
                                                            setCancelReason('');
                                                        }}
                                                        disabled={actionLoading !== null}
                                                        className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-white text-orange-700 text-sm font-bold border border-orange-200 hover:bg-orange-50 disabled:opacity-50 transition-colors"
                                                    >
                                                        <Ban size={17} />
                                                        Cancel Request
                                                    </button>
                                                ) : (
                                                    <div className="rounded-xl border border-orange-200 bg-orange-50/60 p-3 space-y-2">
                                                        <p className="text-xs font-bold text-orange-800">Cancellation reason</p>
                                                        <textarea
                                                            value={cancelReason}
                                                            onChange={(e) => setCancelReason(e.target.value)}
                                                            rows={3}
                                                            placeholder="e.g. Student withdrew transport for this year"
                                                            className="w-full rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                                                        />
                                                        <div className="flex gap-2">
                                                            <button
                                                                type="button"
                                                                onClick={() => handleCancelRequest(req.id)}
                                                                disabled={actionLoading !== null}
                                                                className="flex-1 py-2 rounded-lg bg-orange-600 text-white text-xs font-bold hover:bg-orange-700 disabled:opacity-50"
                                                            >
                                                                {actionLoading === req.id ? 'Cancelling…' : 'Confirm Cancel'}
                                                            </button>
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    setCancelFormOpen(false);
                                                                    setCancelReason('');
                                                                }}
                                                                disabled={actionLoading !== null}
                                                                className="px-3 py-2 rounded-lg border border-orange-200 text-orange-700 text-xs font-bold hover:bg-white disabled:opacity-50"
                                                            >
                                                                Back
                                                            </button>
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                        {statusKey === 'cancelled' && (
                                            <div className="rounded-xl border border-orange-200 bg-orange-50/70 p-3 text-sm text-orange-900">
                                                <p className="text-[10px] font-black uppercase tracking-wider text-orange-600 mb-1">Cancelled</p>
                                                <p className="font-semibold leading-snug">{req.cancellation_reason || 'No reason recorded'}</p>
                                                {req.cancelled_at && (
                                                    <p className="text-[11px] text-orange-700 mt-1">
                                                        {formatDate(req.cancelled_at)}
                                                    </p>
                                                )}
                                            </div>
                                        )}
                                        <button
                                            type="button"
                                            onClick={() => handleDelete(req.id)}
                                            disabled={actionLoading !== null}
                                            className="w-full flex items-center justify-center gap-2 py-2 rounded-xl text-red-600 text-xs font-bold hover:bg-red-50 disabled:opacity-50 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                            Delete
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                })()}
            </Modal>

            <Modal
                isOpen={courseExpiryModalOpen}
                onClose={closeCourseExpiryModal}
                title="Course & Year-wise Bus Pass Expiry"
                maxWidth="max-w-2xl"
            >
                <p className="text-sm text-slate-500 mb-5">
                    Select academic year and course, then set or edit expiry dates for each year of study.
                    Course expiry overrides semester dates for seat occupancy.
                </p>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                            Academic Year
                        </label>
                        <select
                            value={academicYear}
                            onChange={(e) => handleAcademicYearChange(e.target.value)}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                            {academicYearOptions.map((year) => (
                                <option key={year} value={year}>{year}</option>
                            ))}
                        </select>
                    </div>
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                            Course
                        </label>
                        <select
                            value={selectedExpiryCourseId}
                            onChange={(e) => {
                                setSelectedExpiryCourseId(e.target.value);
                                setEditingYears({});
                            }}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                        >
                            <option value="">Select a course</option>
                            {courses.map((course) => (
                                <option key={course.id} value={course.id}>
                                    {course.name}{course.code ? ` (${course.code})` : ''}
                                </option>
                            ))}
                        </select>
                    </div>
                </div>

                {!courseExpirySchemaOk && (
                    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800 mb-4">
                        The database still has the old <strong>course + academic year</strong> unique key, so saving
                        Year 2 overwrites Year 1. Run this on MySQL, then re-enter dates per year:
                        <pre className="mt-2 text-xs bg-red-100 p-2 rounded overflow-x-auto">
                            ALTER TABLE course_transport_expiry DROP INDEX uk_course_academic_year;
                        </pre>
                    </div>
                )}

                {!selectedExpiryCourseId ? (
                    <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-sm text-slate-500">
                        Choose a course to manage year-wise expiry dates.
                    </div>
                ) : courseExpiryLoading ? (
                    <Loader text="Loading expiry dates..." />
                ) : (
                    <div className="space-y-3">
                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-2 border-b border-gray-100">
                            <h4 className="font-bold text-slate-800">{selectedCourseMeta?.name || 'Selected course'}</h4>
                            <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-semibold text-slate-500">{academicYear}</span>
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 text-slate-700 font-semibold">
                                    <Users size={14} />
                                    {selectedCoursePassengerTotal} approved · {selectedCourseActiveTotal} active
                                </span>
                            </div>
                        </div>

                        {selectedCourseYears.map((yearRow) => {
                            const rowKey = courseExpiryKey(yearRow.course_id, yearRow.year_of_study);
                            const hasExpiry = Boolean(yearRow.expiry_date);
                            const isEditing = Boolean(editingYears[rowKey]);
                            const passengerCount = Number(yearRow.passenger_count || 0);
                            const activeCount = Number(yearRow.active_passenger_count || 0);
                            const expiredCount = Number(yearRow.expired_passenger_count || 0);

                            return (
                                <div
                                    key={rowKey}
                                    className="rounded-xl border border-gray-100 bg-gray-50/60 p-4 flex flex-col gap-3"
                                >
                                    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                                    <div className="sm:w-36 flex-shrink-0 space-y-1.5">
                                        <span className="inline-flex bg-blue-100 text-blue-800 px-3 py-1 rounded-lg text-xs font-bold">
                                            Year {yearRow.year_of_study}
                                        </span>
                                        <p className="text-[11px] text-slate-600 font-medium flex items-center gap-1">
                                            <Users size={12} className="text-slate-400" />
                                            {passengerCount} passenger{passengerCount !== 1 ? 's' : ''}
                                        </p>
                                        {passengerCount > 0 && (
                                            <p className="text-[10px] text-slate-500 leading-snug">
                                                <span className="text-green-700 font-semibold">{activeCount} active</span>
                                                {expiredCount > 0 && (
                                                    <> · <span className="text-red-600 font-semibold">{expiredCount} expired</span></>
                                                )}
                                            </p>
                                        )}
                                    </div>

                                    {!isEditing ? (
                                        <>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-slate-500 uppercase font-semibold mb-1">Expiry Date</p>
                                                {hasExpiry ? (
                                                    <p className={`font-semibold ${yearRow.is_past ? 'text-red-600' : 'text-green-700'}`}>
                                                        {formatDate(yearRow.expiry_date)}
                                                        {yearRow.is_past ? ' · Expired' : ''}
                                                    </p>
                                                ) : (
                                                    <p className="text-sm text-gray-400">Not set — semester-based expiry applies</p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                {hasExpiry ? (
                                                    <>
                                                        <button
                                                            type="button"
                                                            onClick={() => startEditYear(rowKey, yearRow.expiry_date)}
                                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-blue-200 text-blue-700 text-xs font-semibold hover:bg-blue-50"
                                                        >
                                                            <Pencil size={14} />
                                                            Edit
                                                        </button>
                                                        <button
                                                            type="button"
                                                            disabled={courseExpirySaving === rowKey}
                                                            onClick={() => handleClearCourseExpiry(yearRow.course_id, yearRow.course_name, yearRow.year_of_study)}
                                                            className="px-3 py-1.5 rounded-lg border border-red-200 text-red-600 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
                                                        >
                                                            Clear
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => startEditYear(rowKey, null)}
                                                        className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700"
                                                    >
                                                        Set Date
                                                    </button>
                                                )}
                                            </div>
                                        </>
                                    ) : (
                                        <>
                                            <div className="flex-1 min-w-0">
                                                <label className="block text-xs text-slate-500 uppercase font-semibold mb-1">
                                                    {hasExpiry ? 'New expiry date' : 'Set expiry date'}
                                                </label>
                                                <input
                                                    type="date"
                                                    value={courseExpiryEdits[rowKey] || ''}
                                                    onChange={(e) => setCourseExpiryEdits((prev) => ({ ...prev, [rowKey]: e.target.value }))}
                                                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm bg-white"
                                                />
                                            </div>
                                            <div className="flex items-center gap-2 flex-shrink-0">
                                                <button
                                                    type="button"
                                                    disabled={courseExpirySaving === rowKey}
                                                    onClick={() => handleSaveCourseExpiry(yearRow.course_id, yearRow.course_name, yearRow.year_of_study)}
                                                    className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 disabled:opacity-50"
                                                >
                                                    {courseExpirySaving === rowKey ? 'Saving...' : hasExpiry ? 'Update' : 'Save'}
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => cancelEditYear(rowKey, hasExpiry, yearRow.expiry_date)}
                                                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 text-xs font-semibold hover:bg-white"
                                                >
                                                    Cancel
                                                </button>
                                            </div>
                                        </>
                                    )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </Modal>

            <Modal
                isOpen={approveModal.open}
                onClose={closeApproveModal}
                title="Approve transport request"
            >
                {approveModal.loading && (
                    <p className="text-gray-500 py-4">Loading…</p>
                )}
                {approveModal.error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 mb-4">
                        {approveModal.error}
                    </div>
                )}
                {!approveModal.loading && approveModal.data && (
                    <>
                        <div className="mb-4 p-3 bg-gray-50 rounded-xl text-sm">
                            <p><span className="font-medium text-gray-600">{approveModal.data.user_type === 'employee' ? 'Employee' : 'Student'}:</span> {approveModal.data.studentName}</p>
                            <p><span className="font-medium text-gray-600">ID Number:</span> {approveModal.data.admissionNumber}</p>
                            {approveModal.data.user_type !== 'employee' && (
                                <p><span className="font-medium text-gray-600">Course / Year:</span> {approveModal.data.course} – Year {approveModal.data.yearOfStudy}</p>
                            )}
                            {approveModal.data.academic_year && (
                                <p><span className="font-medium text-gray-600">Academic Year:</span> {approveModal.data.academic_year}</p>
                            )}
                        </div>
                        {(approveModal.data.application_number || approveModal.data.next_application_number) && (
                            <div className="mb-4 p-4 rounded-xl border border-indigo-200 bg-indigo-50">
                                <p className="text-xs font-bold uppercase tracking-wide text-indigo-700">Application Number</p>
                                <p className="text-2xl font-black text-indigo-900 mt-1 tracking-wider">
                                    {approveModal.data.application_number || approveModal.data.next_application_number}
                                </p>
                                {!approveModal.data.application_number && approveModal.data.next_application_number && (
                                    <p className="text-xs text-indigo-600 mt-1">Will be assigned when you confirm approval</p>
                                )}
                                {(approveModal.data.college_code || approveModal.data.course_code) && (
                                    <p className="text-xs text-indigo-600 mt-2">
                                        College: <span className="font-semibold">{approveModal.data.college_code || approveModal.data.college_name || '—'}</span>
                                        {' · '}
                                        Course: <span className="font-semibold">{approveModal.data.course_code || approveModal.data.course_name || '—'}</span>
                                    </p>
                                )}
                            </div>
                        )}
                        {approveModal.data.route_name && (
                            <div className="mb-4 p-4 rounded-xl border border-blue-100 bg-blue-50">
                                <p className="text-sm font-semibold text-blue-900 mb-2">Route: {approveModal.data.route_name} {approveModal.data.route_id && <span className="text-blue-600">({approveModal.data.route_id})</span>}</p>
                                {approveModal.data.busesOnRoute && approveModal.data.busesOnRoute.length > 0 ? (
                                    <>
                                        <p className="text-xs font-semibold text-blue-800 mb-2">Select a Bus to Assign:</p>
                                        <select 
                                            value={approveModal.selectedBusId}
                                            onChange={(e) => setApproveModal(m => ({ ...m, selectedBusId: e.target.value, error: null }))}
                                            className="w-full text-sm p-2 border border-blue-200 rounded outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                        >
                                            <option value="">-- Choose Bus --</option>
                                            {approveModal.data.busesOnRoute.map((b) => (
                                                <option key={b.busNumber} value={b.busNumber} disabled={b.seatsAvailable <= 0}>
                                                    {b.busNumber} ({b.seatsAvailable <= 0 ? '🚫 FULL' : `Filled: ${b.seatsFilled}/${b.capacity} | ${b.seatsAvailable} available`})
                                                </option>
                                            ))}
                                        </select>
                                    </>
                                ) : (
                                    <p className="text-sm text-blue-700">No buses assigned to this route yet. Assign in Bus Management → Bus–Route mapping.</p>
                                )}
                            </div>
                        )}
                        {approveModal.data.user_type !== 'employee' ? (
                            <>
                                <p className="text-sm text-gray-700 mb-2">Transport is valid until the <strong>end of the academic year</strong> (last semester), regardless of which sem the student applied in.</p>
                                {approveModal.data.expiry ? (
                                    <div className="p-4 rounded-xl border border-green-200 bg-green-50 text-green-800">
                                        <p className="font-semibold">Expiry date: {formatDate(approveModal.data.expiry.expiry_date)}</p>
                                        <p className="text-sm mt-1">{approveModal.data.expiry.label}</p>
                                    </div>
                                ) : (
                                    <p className="text-gray-500 py-2">No semester config found for this course/year. Approval will still succeed; expiry will not be set.</p>
                                )}
                            </>
                        ) : (
                            <p className="text-sm font-medium p-4 rounded-xl border bg-purple-50 text-purple-800 border-purple-200">
                                Employee transport requests do not have academic expiry dates and are free of charge.
                            </p>
                        )}
                        <div className="flex gap-3 mt-6">
                            <button
                                type="button"
                                onClick={handleConfirmApprove}
                                disabled={actionLoading !== null}
                                className="flex-1 bg-green-600 text-white font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {actionLoading === approveModal.requestId ? 'Approving…' : 'Confirm & Approve'}
                            </button>
                            <button
                                type="button"
                                onClick={closeApproveModal}
                                className="px-4 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50"
                            >
                                Cancel
                            </button>
                        </div>
                    </>
                )}
            </Modal>

            <Modal
                isOpen={idCardModalOpen}
                onClose={closeIdCardModal}
                title="Print Bus ID Cards"
                maxWidth="max-w-2xl"
            >
                {/* <p className="text-sm text-slate-500 mb-5">
                    Select academic year, transport application number range, and how many ID cards to print per A4 page
                    (front + back layout as per the official template).
                </p> */}

                {idCardApplicationsLoading ? (
                    <Loader text="Loading transport application numbers..." />
                ) : (
                <div className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                            Print Mode
                        </label>
                        <div className="flex gap-6 p-3 bg-slate-50 rounded-xl border border-slate-200/60 mb-2">
                            <label className="inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer">
                                <input
                                    type="radio"
                                    name="idCardPrintMode"
                                    value="range"
                                    checked={idCardPrintMode === 'range'}
                                    onChange={() => setIdCardPrintMode('range')}
                                    className="cursor-pointer"
                                />
                                By Application Range
                            </label>
                            <label className={`inline-flex items-center gap-2 text-xs font-bold text-slate-700 cursor-pointer ${selectedRequestIds.length === 0 ? 'opacity-40 cursor-not-allowed' : ''}`}>
                                <input
                                    type="radio"
                                    name="idCardPrintMode"
                                    value="selected"
                                    checked={idCardPrintMode === 'selected'}
                                    onChange={() => {
                                        if (selectedRequestIds.length > 0) {
                                            setIdCardPrintMode('selected');
                                        }
                                    }}
                                    disabled={selectedRequestIds.length === 0}
                                    className="cursor-pointer disabled:cursor-not-allowed"
                                />
                                Selected Candidates ({selectedRequestIds.length})
                            </label>
                        </div>
                    </div>

                    {idCardPrintMode === 'selected' ? (
                        <div className="p-4 rounded-xl border border-blue-200 bg-blue-50 space-y-3">
                            <p className="text-sm font-semibold text-blue-900">
                                Will print ID cards for the <strong>{selectedRequestIds.length}</strong> passenger(s) selected from the list.
                            </p>
                            <ul className="divide-y divide-blue-100 rounded-lg border border-blue-100 bg-white overflow-hidden max-h-48 overflow-y-auto">
                                {selectedRequestIds.map((id) => {
                                    const req = selectedRequestsMap[id] || requests.find(r => r.id === id);
                                    const name = req?.student_name || req?.employee_name || `ID: ${id}`;
                                    const appNo = req?.application_number;
                                    const admNo = req?.admission_number || req?.emp_no;
                                    return (
                                        <li key={id} className="flex items-center justify-between px-3 py-2 text-xs">
                                            <div className="flex items-center gap-2 min-w-0">
                                                <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black text-[9px] shrink-0">
                                                    {(name[0] || '?').toUpperCase()}
                                                </span>
                                                <span className="font-semibold text-slate-800 truncate">{name}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0 ml-2">
                                                {appNo && <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{appNo}</span>}
                                                {admNo && <span className="text-[10px] text-slate-400 font-medium">{admNo}</span>}
                                            </div>
                                        </li>
                                    );
                                })}
                            </ul>
                        </div>
                    ) : (
                        <>
                            <div>
                                <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                                    Academic Year
                                </label>
                                <select
                                    value={idCardAcademicYear}
                                    onChange={(e) => setIdCardAcademicYear(e.target.value)}
                                    disabled={idCardPrintLoading}
                                    className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                                >
                                    {academicYearOptions.map((year) => (
                                        <option key={year} value={year}>{year}</option>
                                    ))}
                                </select>
                            </div>

                            {idCardAllApplications.length > 0 && (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                                            College Code
                                        </label>
                                        <select
                                            value={idCardCollegeCode}
                                            onChange={(e) => {
                                                setIdCardCollegeCode(e.target.value);
                                                setIdCardCourseCode('');
                                            }}
                                            disabled={idCardPrintLoading}
                                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                                        >
                                            <option value="">All Colleges</option>
                                            {idCardCollegeOptions.map((code) => (
                                                <option key={code} value={code}>{code}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                                            Course Code
                                        </label>
                                        <select
                                            value={idCardCourseCode}
                                            onChange={(e) => setIdCardCourseCode(e.target.value)}
                                            disabled={idCardPrintLoading}
                                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                                        >
                                            <option value="">All Courses</option>
                                            {idCardCourseOptions.map((code) => (
                                                <option key={code} value={code}>{code}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}

                            {!idCardApplications.length ? (
                                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-sm text-slate-500">
                                    No approved transport application numbers found for {idCardAcademicYear}.
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                                            From Transport Application No.
                                        </label>
                                        <select
                                            value={idCardFromSerial}
                                            onChange={(e) => handleIdCardFromChange(e.target.value)}
                                            disabled={idCardPrintLoading}
                                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                                        >
                                            {idCardApplications.map((app) => (
                                                <option key={`from-${app.id}-${app.application_serial}`} value={app.application_serial}>
                                                    {app.application_number} — {app.student_name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-xs font-bold uppercase tracking-wide text-slate-500 mb-2">
                                            To Transport Application No.
                                        </label>
                                        <select
                                            value={idCardToSerial}
                                            onChange={(e) => {
                                                setIdCardToSerial(e.target.value);
                                                setIdCardPreviewCount(null);
                                            }}
                                            disabled={idCardPrintLoading}
                                            className="w-full rounded-xl border border-gray-200 px-3 py-2.5 text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white disabled:opacity-60"
                                        >
                                            {idCardToOptions.map((app) => (
                                                <option key={`to-${app.id}-${app.application_serial}`} value={app.application_serial}>
                                                    {app.application_number} — {app.student_name}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    <div className="rounded-xl border border-slate-100 bg-slate-50 px-4 py-3 text-xs text-slate-600 leading-relaxed">
                        ID cards will be printed in a 6 cards per A4 page layout (front + back layout) to match the official template.
                    </div>

                    {idCardPrintMode === 'range' && idCardPreviewCount != null && (
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                            <strong>{idCardPreviewCount}</strong> approved passenger{idCardPreviewCount === 1 ? '' : 's'} found in this range.
                            {idCardPreviewCount > 0 && (
                                <span> Will print across {Math.ceil(idCardPreviewCount / idCardPerPage)} page{Math.ceil(idCardPreviewCount / idCardPerPage) === 1 ? '' : 's'}.</span>
                            )}
                        </div>
                    )}
                </div>
                )}

                <div className="flex flex-wrap gap-3 mt-6">
                    <button
                        type="button"
                        onClick={handleConfirmPrintIdCards}
                        disabled={idCardPrintLoading || (idCardPrintMode === 'selected' ? selectedRequestIds.length === 0 : (idCardApplicationsLoading || !idCardApplications.length))}
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Printer size={18} />
                        {idCardPrintLoading ? 'Preparing…' : 'Print ID Cards'}
                    </button>
                    <button
                        type="button"
                        onClick={closeIdCardModal}
                        disabled={idCardPrintLoading}
                        className="px-4 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                    >
                        Cancel
                    </button>
                </div>
            </Modal>

            <TransportBusIdCardSheet
                ref={idCardSheetRef}
                passengers={idCardPassengers}
                academicYear={idCardAcademicYear}
                cardsPerPage={idCardPerPage}
                padToFullPage={idCardPadToFullPage}
            />
        </Layout >
    );
};

export default TransportRequests;
