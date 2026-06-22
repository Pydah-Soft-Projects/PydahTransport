import React, { useState, useEffect } from 'react';
import { RefreshCw, Bus } from 'lucide-react';
import Layout from '../components/Layout';
import Loader from '../components/Loader';
import Modal from '../components/Modal';
import { apiFetch, API_BASE } from '../utils/api';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import { getDefaultAcademicYear } from '../utils/academicYear';

const formatDate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

const getValidationDisplay = (validation) => {
    if (!validation) return null;

    if (validation.valid) {
        return {
            title: 'Ready to raise request',
            className: 'bg-green-50 border-green-200 text-green-800',
        };
    }

    switch (validation.reason) {
        case 'course_completed':
            return {
                title: 'Course completed',
                className: 'bg-slate-100 border-slate-200 text-slate-700',
            };
        case 'year_mismatch':
            return {
                title: 'Student year mismatch',
                className: 'bg-amber-50 border-amber-200 text-amber-900',
            };
        case 'missing_semester_config':
            return {
                title: 'Semester setup pending',
                className: 'bg-amber-50 border-amber-200 text-amber-900',
            };
        case 'request_exists':
            return {
                title: 'Request already exists',
                className: 'bg-red-50 border-red-200 text-red-800',
            };
        default:
            return {
                title: 'Cannot raise request',
                className: 'bg-amber-50 border-amber-200 text-amber-900',
            };
    }
};

const getAcademicYearWindow = (centerLabel = getDefaultAcademicYear(), pastCount = 3, futureCount = 3) => {
    const startYear = Number(String(centerLabel).split('-')[0]);
    if (Number.isNaN(startYear)) {
        return [centerLabel];
    }
    const options = [];
    for (let offset = -pastCount; offset <= futureCount; offset += 1) {
        const start = startYear + offset;
        options.push(`${start}-${start + 1}`);
    }
    return options;
};

const filterAcademicYearOptions = (allLabels, centerLabel = getDefaultAcademicYear()) => {
    const windowLabels = getAcademicYearWindow(centerLabel);
    const labelSet = new Set(allLabels || []);
    const fromDb = windowLabels.filter((label) => labelSet.has(label));
    return fromDb.length > 0 ? fromDb : windowLabels;
};

const buildFallbackAcademicYearOptions = () => getAcademicYearWindow();

const AdminRaiseRequest = () => {
    const [activeTab, setActiveTab] = useState('new'); // 'new' or 'change'
    const [changeType, setChangeType] = useState('route'); // 'route' or 'stage'
    const [userType, setUserType] = useState('student'); // 'student' or 'employee'
    const [searchQuery, setSearchQuery] = useState('');
    const [students, setStudents] = useState([]);
    const [approvedStudents, setApprovedStudents] = useState([]);
    const [selectedStudent, setSelectedStudent] = useState(null);
    const [routes, setRoutes] = useState([]);
    const [selectedRoute, setSelectedRoute] = useState(null);
    const [selectedStage, setSelectedStage] = useState(null);
    const [loading, setLoading] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [message, setMessage] = useState({ text: '', type: '' });
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear);
    const [academicYearOptions, setAcademicYearOptions] = useState(buildFallbackAcademicYearOptions);
    const [academicValidation, setAcademicValidation] = useState(null);
    const [validationLoading, setValidationLoading] = useState(false);
    const [busesOnRoute, setBusesOnRoute] = useState([]);
    const [busesLoading, setBusesLoading] = useState(false);
    const [approveModal, setApproveModal] = useState({ open: false, requestId: null, data: null, selectedBusId: '', loading: true, error: null });
    const [raisedPendingRequestId, setRaisedPendingRequestId] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const [profileLoading, setProfileLoading] = useState(false);
    const [formError, setFormError] = useState('');

    const getRevisedAmountForYear = (year) => {
        if (!selectedStudent?.overallConcession?.revised_fees) return null;
        const revisedFees = Array.isArray(selectedStudent.overallConcession.revised_fees)
            ? selectedStudent.overallConcession.revised_fees
            : (typeof selectedStudent.overallConcession.revised_fees === 'string'
                ? JSON.parse(selectedStudent.overallConcession.revised_fees)
                : []);
        const match = revisedFees.find(f => {
            const isTransport = 
                (f.feeHeadCode && String(f.feeHeadCode).toUpperCase() === 'TRN01') ||
                (f.feeHeadId && (
                    String(f.feeHeadId) === String(selectedStudent.transportFeeHeadId) || 
                    String(f.feeHeadId) === '6996aa36e247525e006623ca' ||
                    String(f.feeHeadId) === '6996aa36e247525e006623b8'
                ));
            return isTransport && Number(f.studentYear) === Number(year);
        });
        return match ? match.revisedAmount : null;
    };

    // Get logged in admin info
    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
    const admin = { 
        name: adminInfo.name || 'Admin', 
        id: adminInfo.id || adminInfo.userId || 1 
    };


    useEffect(() => {
        const fetchRoutes = async () => {
            try {
                const response = await apiFetch(
                    `${API_BASE}/routes?academicYear=${encodeURIComponent(academicYear)}`
                );
                const data = await response.json();
                setRoutes(data);
                setSelectedRoute(null);
                setSelectedStage(null);
            } catch (error) {
                console.error('Error fetching routes:', error);
            }
        };
        fetchRoutes();
    }, [academicYear]);

    useEffect(() => {
        const fetchAcademicYears = async () => {
            try {
                const response = await apiFetch(`${API_BASE}/students/academic-years`);
                if (response.ok) {
                    const data = await response.json();
                    const allLabels = (data || []).map((row) => row.year_label).filter(Boolean);
                    const defaultYear = getDefaultAcademicYear();
                    const labels = allLabels.length > 0
                        ? filterAcademicYearOptions(allLabels, defaultYear)
                        : buildFallbackAcademicYearOptions();
                    setAcademicYearOptions(labels);
                    setAcademicYear(labels.includes(defaultYear) ? defaultYear : labels[0]);
                }
            } catch (error) {
                console.error('Error fetching academic years:', error);
            }
        };
        fetchAcademicYears();
    }, []);

    useEffect(() => {
        const timer = setTimeout(() => {
            if (searchQuery.trim().length >= 2) {
                performSearch(searchQuery);
            } else if (searchQuery.trim().length === 0) {
                setStudents([]);
                setApprovedStudents([]);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [searchQuery, activeTab, userType]);

    const performSearch = async (query) => {
        if (!query) return;
        setLoading(true);
        try {
            const endpoint = activeTab === 'new' 
                ? (userType === 'employee' ? `${API_BASE}/employees/search?q=${encodeURIComponent(searchQuery)}` : `${API_BASE}/students/search?q=${encodeURIComponent(searchQuery)}`)
                : `${API_BASE}/transport-requests/approved-passengers?q=${encodeURIComponent(searchQuery)}&user_type=${userType}`;
            
            const response = await apiFetch(endpoint);
            const data = await response.json();
            
            if (activeTab === 'new') {
                setStudents(data);
            } else {
                setApprovedStudents(data);
            }
        } catch (error) {
            console.error('Error searching students:', error);
        } finally {
            setLoading(false);
        }
    };

    const fetchAcademicValidation = async (student, year) => {
        const admissionNumber = student?.admission_number || student?.admission_no;
        const studentId = student?.student_id ?? student?.id;
        if (!admissionNumber && !studentId) {
            setAcademicValidation(null);
            return;
        }

        const params = new URLSearchParams({ academic_year: year });
        if (admissionNumber) {
            params.set('admission_number', admissionNumber);
        } else {
            params.set('id', String(studentId));
        }

        setValidationLoading(true);
        try {
            const response = await apiFetch(`${API_BASE}/students/academic-validation?${params}`);
            if (response.ok) {
                const data = await response.json();
                setAcademicValidation(data);
                if (data.valid) {
                    setFormError('');
                }
            } else {
                const data = await response.json().catch(() => ({}));
                setAcademicValidation({ valid: false, reason: 'missing_data', message: data.message || 'Could not validate academic year.' });
            }
        } catch (error) {
            console.error('Error validating academic context:', error);
            setAcademicValidation(null);
        } finally {
            setValidationLoading(false);
        }
    };

    const fetchStudentProfile = async (student) => {
        const admissionNumber = student.admission_number || student.admission_no;
        const studentId = student.student_id ?? student.id;
        if (!admissionNumber && !studentId) return student;

        // Approved passengers use transport_requests.id — always prefer admission_number for profile lookup
        const params = admissionNumber
            ? `admission_number=${encodeURIComponent(admissionNumber)}`
            : `id=${encodeURIComponent(studentId)}`;

        try {
            const response = await apiFetch(`${API_BASE}/students/profile?${params}`);
            if (response.ok) {
                const profile = await response.json();
                return { ...student, ...profile };
            }
        } catch (error) {
            console.error('Error fetching student profile:', error);
        }
        return student;
    };

    const handleSelectStudent = async (student) => {
        setFormError('');
        setAcademicValidation(null);
        setSelectedStudent(student);
        setSelectedRoute(null);
        setSelectedStage(null);
        setBusesOnRoute([]);

        if (activeTab === 'change' && changeType === 'stage' && student.route_id) {
            const currentRoute = routes.find(r => r.routeId === student.route_id);
            if (currentRoute) {
                setSelectedRoute(currentRoute);
            }
        }

        if (userType === 'student') {
            setProfileLoading(true);
            const enriched = await fetchStudentProfile(student);
            setSelectedStudent(enriched);
            setProfileLoading(false);
        }
    };

    useEffect(() => {
        if (activeTab !== 'new' || userType !== 'student' || !selectedStudent) {
            setAcademicValidation(null);
            return;
        }
        fetchAcademicValidation(selectedStudent, academicYear);
    }, [academicYear, activeTab, userType, selectedStudent?.admission_number, selectedStudent?.admission_no, selectedStudent?.id]);

    const handleSelectRoute = (e) => {
        setFormError('');
        const routeId = e.target.value;
        const route = routes.find(r => r.routeId === routeId);
        setSelectedRoute(route);
        setSelectedStage(null);
        setBusesOnRoute([]);
    };

    useEffect(() => {
        if (!selectedRoute?.routeId) {
            setBusesOnRoute([]);
            return;
        }

        const fetchBusVacancy = async () => {
            setBusesLoading(true);
            try {
                const response = await apiFetch(
                    `${API_BASE}/transport-requests/route-buses?route_id=${encodeURIComponent(selectedRoute.routeId)}`
                );
                const data = await response.json();
                if (response.ok) {
                    setBusesOnRoute(data.busesOnRoute || []);
                } else {
                    setBusesOnRoute([]);
                }
            } catch (error) {
                console.error('Error fetching bus vacancy:', error);
                setBusesOnRoute([]);
            } finally {
                setBusesLoading(false);
            }
        };

        fetchBusVacancy();
    }, [selectedRoute?.routeId]);

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
                setApproveModal((m) => ({ ...m, loading: false, error: data.message || 'Failed to load approval details' }));
            }
        } catch (err) {
            setApproveModal((m) => ({ ...m, loading: false, error: 'Could not load approval details' }));
        }
    };

    const discardRaisedPendingRequest = async (requestId) => {
        if (!requestId) return;
        try {
            const response = await apiFetch(`${API_BASE}/transport-requests/${requestId}`, {
                method: 'DELETE',
                body: JSON.stringify({
                    admin_name: admin.name,
                    admin_id: admin.id,
                }),
            });
            if (!response.ok) {
                const data = await response.json().catch(() => ({}));
                throw new Error(data.message || 'Failed to discard pending request');
            }
        } catch (error) {
            console.error('Error discarding pending request:', error);
            setMessage({
                text: 'Approval cancelled, but the pending request could not be removed. Check Transport Requests.',
                type: 'error',
            });
        }
    };

    const closeApproveModal = async (isApproved = false) => {
        if (actionLoading) return;

        const pendingId = raisedPendingRequestId;
        setApproveModal({ open: false, requestId: null, data: null, selectedBusId: '', loading: true, error: null });
        setRaisedPendingRequestId(null);

        if (isApproved !== true && pendingId) {
            await discardRaisedPendingRequest(pendingId);
            setMessage({ text: '', type: '' });
        }
    };

    const handleConfirmApprove = async () => {
        const id = approveModal.requestId;
        if (!id) return;

        if (approveModal.data?.busesOnRoute?.length > 0 && !approveModal.selectedBusId) {
            setApproveModal((m) => ({ ...m, error: 'Please select a bus to assign the passenger to.' }));
            return;
        }

        setActionLoading(true);
        try {
            const payload = { bus_id: approveModal.selectedBusId || null };
            const response = await apiFetch(`${API_BASE}/transport-requests/${id}/approve`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                await closeApproveModal(true);
                setMessage({
                    text: data.application_number
                        ? `Approved. Application No: ${data.application_number}`
                        : (data.message || 'Request raised and approved successfully.'),
                    type: 'success',
                });
                setSearchQuery('');
                setStudents([]);
                setApprovedStudents([]);
                setSelectedStudent(null);
                setSelectedRoute(null);
                setSelectedStage(null);
                setBusesOnRoute([]);
                setChangeType('route');
            } else {
                setApproveModal((m) => ({ ...m, error: data.message || 'Failed to approve request' }));
            }
        } catch (err) {
            setApproveModal((m) => ({ ...m, error: 'Something went wrong. Please try again.' }));
        } finally {
            setActionLoading(false);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!selectedStudent || !selectedRoute || !selectedStage) {
            setMessage({ text: 'Please select a student, route, and stage.', type: 'error' });
            return;
        }

        if (activeTab === 'new' && userType === 'student' && academicValidation && !academicValidation.valid) {
            setFormError(academicValidation.message || 'Student batch, year, and academic year do not match.');
            return;
        }

        setFormError('');
        setSubmitting(true);
        try {
            const isChange = activeTab === 'change';
            const endpoint = isChange 
                ? `${API_BASE}/transport-requests/change-request`
                : `${API_BASE}/transport-requests`;
            
            const body = isChange ? {
                admission_number: selectedStudent.admission_number,
                new_route_id: selectedRoute.routeId,
                new_route_name: selectedRoute.routeName,
                new_stage_name: selectedStage.stageName,
                new_fare: selectedStage.fare,
                admin_name: admin.name,
                admin_id: admin.id,
                user_type: userType
            } : {
                admission_number: selectedStudent.admission_number || selectedStudent.admission_no || selectedStudent.emp_no,
                student_name: selectedStudent.student_name || selectedStudent.employee_name,
                route_id: selectedRoute.routeId,
                route_name: selectedRoute.routeName,
                stage_name: selectedStage.stageName,
                fare: selectedStage.fare,
                raised_by: 'admin',
                raised_by_id: admin.id,
                user_type: userType,
                academic_year: academicYear,
            };

            const response = await apiFetch(endpoint, {
                method: 'POST',
                body: JSON.stringify(body)
            });

            if (response.ok) {
                setFormError('');
                const resData = await response.json();
                if (isChange) {
                    setMessage({ text: `Route change processed. Fare Difference: ₹${resData.fareDifference}`, type: 'success' });
                    setSearchQuery('');
                    setStudents([]);
                    setApprovedStudents([]);
                    setSelectedStudent(null);
                    setSelectedRoute(null);
                    setSelectedStage(null);
                    setBusesOnRoute([]);
                    setChangeType('route');
                } else {
                    const requestId = resData.id || resData._id;
                    if (requestId) {
                        setRaisedPendingRequestId(requestId);
                        setMessage({ text: 'Review the details below and confirm approval.', type: 'success' });
                        await openApproveModal(requestId);
                    } else {
                        setMessage({ text: 'Request raised but could not open approval dialog. Approve from Transport Requests.', type: 'error' });
                    }
                }
            } else {
                const data = await response.json();
                const errorText = data.message || 'Failed to process request.';
                if (!isChange && (response.status === 409 || response.status === 400)) {
                    setFormError(errorText);
                } else {
                    setFormError('');
                    setMessage({ text: errorText, type: 'error' });
                }
            }
        } catch (error) {
            setFormError('');
            setMessage({ text: 'An error occurred. Please try again.', type: 'error' });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <Layout>
            <div className="mb-8 flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-3xl font-extrabold text-slate-800 tracking-tight">Raise Request</h2>
                    <p className="text-slate-500 mt-1">Enroll a new student or request a route/stage change for existing passengers.</p>
                </div>
                
                <div className="flex bg-slate-100 p-1.5 rounded-2xl border border-slate-200 shadow-sm self-start md:self-auto">
                    <button
                        onClick={() => { setActiveTab('new'); setFormError(''); setSelectedStudent(null); setStudents([]); setApprovedStudents([]); setSearchQuery(''); }}
                        className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${activeTab === 'new' ? 'bg-white text-blue-900 shadow-md ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        New Enrollment
                    </button>
                    <button
                        onClick={() => { setActiveTab('change'); setFormError(''); setSelectedStudent(null); setStudents([]); setApprovedStudents([]); setSearchQuery(''); }}
                        className={`px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200 ${activeTab === 'change' ? 'bg-white text-blue-900 shadow-md ring-1 ring-black/5' : 'text-slate-500 hover:text-slate-700'}`}
                    >
                        Route/Stage Change
                    </button>
                </div>
            </div>

            {message.text && (
                <div className={`mb-6 p-4 rounded-xl border ${message.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                    {message.text}
                </div>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Student Selection */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">1</span>
                            {activeTab === 'new' ? 'Select Passenger' : 'Find Passenger'}
                        </div>
                        <div className="bg-slate-100 p-1 rounded-lg flex text-xs">
                            <button
                                onClick={() => {
                                    setUserType('student');
                                    setStudents([]);
                                    setApprovedStudents([]);
                                    setSelectedStudent(null);
                                    setSearchQuery('');
                                }}
                                className={`px-3 py-1.5 rounded-md font-bold transition-all ${userType === 'student' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Student
                            </button>
                            <button
                                onClick={() => {
                                    setUserType('employee');
                                    setStudents([]);
                                    setApprovedStudents([]);
                                    setSelectedStudent(null);
                                    setSearchQuery('');
                                }}
                                className={`px-3 py-1.5 rounded-md font-bold transition-all ${userType === 'employee' ? 'bg-white shadow-sm text-blue-700' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Employee
                            </button>
                        </div>
                    </h3>
                    <div className="flex gap-2 mb-6 relative">
                        <div className="flex-1 relative">
                            <input
                                type="text"
                                placeholder={activeTab === 'new' ? `Type to search ${userType === 'employee' ? 'Employee' : 'Student'} Name or ID...` : "Type to search Approved Passenger..."}
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full rounded-xl border border-slate-200 pl-10 pr-4 py-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none transition-all"
                            />
                            <svg className="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"></path>
                            </svg>
                        </div>
                        {loading && (
                            <div className="absolute right-4 top-1/2 -translate-y-1/2">
                                <Loader size={20} text="" className="p-0" />
                            </div>
                        )}
                    </div>

                    <div className="max-h-[400px] overflow-y-auto border border-slate-100 rounded-xl custom-scrollbar pr-1">
                        {(activeTab === 'new' ? students : approvedStudents).length > 0 ? (
                            <ul className="divide-y divide-slate-50">
                                {(activeTab === 'new' ? students : approvedStudents).map(s => {
                                    const uniqueId = s.id || s._id || s.emp_no || s.pin_no || s.admission_number || s.admission_no;
                                    const selectedId = selectedStudent?.id || selectedStudent?._id || selectedStudent?.emp_no || selectedStudent?.pin_no || selectedStudent?.admission_number || selectedStudent?.admission_no;
                                    return (
                                    <li
                                        key={uniqueId}
                                        onClick={() => handleSelectStudent(s)}
                                        className={`p-4 cursor-pointer hover:bg-slate-50 transition-all rounded-lg m-1 ${selectedId === uniqueId ? 'bg-blue-50 border border-blue-100 shadow-sm' : 'border border-transparent'}`}
                                    >
                                        <div className="flex justify-between items-start">
                                            <div>
                                                <div className="font-bold text-slate-900">{s.student_name || s.employee_name}</div>
                                                <div className="text-xs text-slate-500 mt-0.5 font-medium flex items-center gap-2">
                                                    {userType === 'employee' ? (
                                                        <span className="badge">ID: {s.emp_no}</span>
                                                    ) : (
                                                        <span className="badge">
                                                            PIN: {s.pin_no || 'N/A'} <span className="opacity-50 mx-1">|</span> Adm No: {s.admission_number || s.admission_no || 'N/A'}
                                                        </span>
                                                    )}
                                                    {s.email && <span className="opacity-70 truncate px-1 border-l border-slate-200 ml-1 pl-2">{s.email}</span>}
                                                    {s.phone_number && <span className="opacity-70 px-1 border-l border-slate-200 ml-1 pl-2">{s.phone_number}</span>}
                                                </div>
                                            </div>
                                            {(s.current_year || s.year_of_study) && (
                                                <div className="text-[10px] px-2 py-1 bg-white border border-slate-100 rounded-full font-bold text-slate-400">
                                                    Year {s.current_year || s.year_of_study}
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-xs text-slate-400 mt-2 flex items-center gap-2">
                                            <span className="truncate">
                                                {userType === 'employee' ? (s.department || 'Employee') : `Course: ${s.course || 'N/A'}${s.branch ? ` - ${s.branch}` : ''}`}
                                            </span>
                                            {activeTab === 'change' && (
                                                <span className="bg-emerald-50 text-emerald-600 px-1.5 py-0.5 rounded font-black text-[9px] uppercase tracking-tighter">Current: {s.route_name}</span>
                                            )}
                                        </div>
                                    </li>
                                    );
                                })}
                            </ul>
                        ) : (
                            <div className="p-12 text-center text-slate-400 text-sm">
                                {loading ? (
                                    <Loader text="Fetching records..." />
                                ) : (
                                    activeTab === 'new' ? 'Search for a student to begin.' : 'Search for an approved passenger.'
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Request Details */}
                <div className="bg-white rounded-2xl shadow-sm border border-slate-100 p-6 h-fit">
                    <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                        <span className="w-8 h-8 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-sm">2</span>
                        Request Details
                    </h3>

                    {selectedStudent ? (
                        <form onSubmit={handleSubmit} className="space-y-5">
                            {activeTab === 'change' && (
                                <div className="flex gap-2 p-1 bg-slate-100 rounded-xl mb-4">
                                    <button
                                        type="button"
                                        onClick={() => { setChangeType('route'); setSelectedRoute(null); setSelectedStage(null); }}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${changeType === 'route' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        Full Route Change
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => { 
                                            setChangeType('stage'); 
                                            const currentRoute = routes.find(r => r.routeId === selectedStudent.route_id);
                                            setSelectedRoute(currentRoute || null);
                                            setSelectedStage(null);
                                        }}
                                        className={`flex-1 py-1.5 rounded-lg text-xs font-bold transition-all ${changeType === 'stage' ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                                    >
                                        Only Stage Change
                                    </button>
                                </div>
                            )}

                            <div className="p-4 bg-slate-50 rounded-2xl text-sm border border-slate-100 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-100/50 rounded-full -mr-12 -mt-12 transition-transform group-hover:scale-110"></div>
                                <div className="relative z-10 flex gap-4">
                                    {userType === 'student' && (
                                        <div className="shrink-0 w-[88px] h-[104px] rounded-xl border-2 border-white shadow-md overflow-hidden bg-white flex items-center justify-center">
                                            {profileLoading ? (
                                                <Loader size={24} text="" className="p-0" />
                                            ) : normalizeStudentPhoto(selectedStudent.student_photo) ? (
                                                <img
                                                    src={normalizeStudentPhoto(selectedStudent.student_photo)}
                                                    alt={selectedStudent.student_name}
                                                    className="w-full h-full object-cover"
                                                />
                                            ) : (
                                                <span className="text-[9px] font-bold text-slate-400 uppercase text-center px-1">No Photo</span>
                                            )}
                                        </div>
                                    )}
                                    <div className="min-w-0 flex-1">
                                        <p className="text-[10px] uppercase font-black text-slate-400 mb-1 tracking-widest">Selected {userType === 'employee' ? 'Employee' : 'Student'}</p>
                                        <p className="font-black text-slate-900 text-lg uppercase leading-tight">{selectedStudent.student_name || selectedStudent.employee_name}</p>
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            <div className="px-2.5 py-1 bg-white rounded-lg shadow-sm border border-slate-100 inline-block min-w-[70px] text-center">
                                                <p className="text-[8px] font-black text-slate-400 uppercase leading-none">ID Number</p>
                                                <span className="text-xs font-bold text-blue-700">{selectedStudent.admission_number || selectedStudent.admission_no || selectedStudent.emp_no}</span>
                                            </div>
                                            {userType === 'student' && selectedStudent.pin_no && (
                                                <div className="px-2.5 py-1 bg-white rounded-lg shadow-sm border border-slate-100 inline-block text-center">
                                                    <p className="text-[8px] font-black text-slate-400 uppercase leading-none">PIN</p>
                                                    <span className="text-xs font-bold text-slate-700">{selectedStudent.pin_no}</span>
                                                </div>
                                            )}
                                            {userType === 'student' && selectedStudent.batch && (
                                                <div className="px-2.5 py-1 bg-amber-50 rounded-lg shadow-sm border border-amber-100 inline-block text-center">
                                                    <p className="text-[8px] font-black text-amber-500 uppercase leading-none">Batch</p>
                                                    <span className="text-xs font-bold text-amber-800">{selectedStudent.batch}</span>
                                                </div>
                                            )}
                                            {activeTab === 'change' && (
                                                <div className="px-2.5 py-1 bg-emerald-50 rounded-lg shadow-sm border border-emerald-100 inline-block min-w-[70px] text-center">
                                                    <p className="text-[8px] font-black text-emerald-400 uppercase leading-none">Current Fare</p>
                                                    <span className="text-xs font-bold text-emerald-700">₹{selectedStudent.fare}</span>
                                                </div>
                                            )}
                                        </div>
                                        {userType === 'student' && selectedStudent.course && (
                                            <p className="text-xs text-slate-500 mt-2 font-medium">
                                                {selectedStudent.course}{selectedStudent.branch ? ` · ${selectedStudent.branch}` : ''}
                                                {selectedStudent.current_year ? ` · Year ${selectedStudent.current_year}` : ''}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>

                            <div className="space-y-4">
                                {activeTab === 'new' && userType === 'student' && (
                                    <div>
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                                            Academic Year
                                        </label>
                                        <select
                                            value={academicYear}
                                            onChange={(e) => { setAcademicYear(e.target.value); setFormError(''); }}
                                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-700 appearance-none bg-white"
                                            required
                                        >
                                            {academicYearOptions.map((year) => (
                                                <option key={year} value={year}>{year}</option>
                                            ))}
                                        </select>
                                        {validationLoading && (
                                            <p className="mt-2 text-xs text-slate-500">Checking batch, year, and academic year…</p>
                                        )}
                                        {!validationLoading && academicValidation && (() => {
                                            const display = getValidationDisplay(academicValidation);
                                            return (
                                                <div className={`mt-2 p-3 rounded-xl border text-sm leading-relaxed ${display.className}`}>
                                                    <p className="font-bold mb-1">{display.title}</p>
                                                    <p>{academicValidation.message}</p>
                                                    {academicValidation.reason === 'year_mismatch' && academicValidation.total_years != null && (
                                                        <p className="mt-1 text-xs opacity-90">
                                                            {academicValidation.course} is a {academicValidation.total_years}-year course.
                                                        </p>
                                                    )}
                                                </div>
                                            );
                                        })()}
                                    </div>
                                )}
                                {activeTab === 'new' && userType === 'employee' && (
                                    <div>
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                                            Academic Year
                                        </label>
                                        <select
                                            value={academicYear}
                                            onChange={(e) => { setAcademicYear(e.target.value); setFormError(''); }}
                                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-700 appearance-none bg-white"
                                            required
                                        >
                                            {academicYearOptions.map((year) => (
                                                <option key={year} value={year}>{year}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                <div>
                                    <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">
                                        {changeType === 'stage' ? 'Current Route (Locked)' : 'Assign New Route'}
                                    </label>
                                    <select
                                        onChange={handleSelectRoute}
                                        value={selectedRoute?.routeId || ''}
                                        disabled={changeType === 'stage'}
                                        className={`w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium appearance-none ${changeType === 'stage' ? 'bg-slate-100 text-slate-500' : 'bg-white text-slate-700'}`}
                                        required
                                    >
                                        <option value="">{changeType === 'stage' ? selectedRoute?.routeName : 'Select an operation route'}</option>
                                        {routes.map(r => (
                                            <option key={r.routeId} value={r.routeId}>{r.routeName} ({r.routeId})</option>
                                        ))}
                                    </select>
                                </div>

                                {selectedRoute && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-300 p-4 rounded-2xl border border-blue-100 bg-blue-50/60">
                                        <div className="flex items-center gap-2 mb-3">
                                            <Bus size={16} className="text-blue-700" />
                                            <p className="text-xs font-black text-blue-800 uppercase tracking-widest">Route Bus Vacancy</p>
                                        </div>
                                        {busesLoading ? (
                                            <p className="text-sm text-blue-600">Loading bus availability...</p>
                                        ) : busesOnRoute.length > 0 ? (
                                            <div className="space-y-2">
                                                {busesOnRoute.map((b) => (
                                                    <div
                                                        key={b.busNumber}
                                                        className="flex items-center justify-between p-3 bg-white rounded-xl border border-blue-100 text-sm"
                                                    >
                                                        <span className="font-bold text-slate-800">{b.busNumber}</span>
                                                        <span className={`text-xs font-semibold ${b.seatsAvailable > 0 ? 'text-green-700' : 'text-red-600'}`}>
                                                            {b.seatsFilled}/{b.capacity} filled · {b.seatsAvailable} available
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <p className="text-sm text-blue-700">
                                                No buses assigned to this route yet. Assign buses in Bus Management first.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {selectedRoute && (
                                    <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                                        <label className="block text-xs font-black text-slate-400 uppercase tracking-widest mb-1.5 ml-1">New Stage (Stop Point)</label>
                                        <select
                                            onChange={(e) => { setFormError(''); setSelectedStage(selectedRoute.stages.find(s => s.stageName === e.target.value)); }}
                                            className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-blue-500 transition-all font-medium text-slate-700 appearance-none bg-white"
                                            required
                                        >
                                            <option value="">Select a stage point</option>
                                            {selectedRoute.stages.map(s => (
                                                <option key={s.stageName} value={s.stageName}>{s.stageName} — {userType === 'employee' ? 'Free (₹0)' : `₹${s.fare}`}</option>
                                            ))}
                                        </select>
                                    </div>
                                )}

                                {selectedStage && (() => {
                                    const targetYear = activeTab === 'new' 
                                        ? (academicValidation?.current_year || selectedStudent?.current_year) 
                                        : (selectedStudent?.year_of_study || selectedStudent?.current_year);
                                    const revisedAmount = getRevisedAmountForYear(targetYear);
                                    const displayFare = userType === 'employee' ? 0 : selectedStage.fare;
                                    const finalFare = revisedAmount !== null ? revisedAmount : displayFare;
                                    
                                    console.log('Concessions Debug info:', {
                                        selectedStudent,
                                        targetYear,
                                        revisedAmount,
                                        overallConcession: selectedStudent?.overallConcession,
                                        transportFeeHeadId: selectedStudent?.transportFeeHeadId
                                    });
                                    
                                    return (
                                        <div className="p-5 bg-blue-600 rounded-2xl shadow-lg shadow-blue-200/50 border border-blue-500 transform transition-all duration-300 animate-in zoom-in-95 space-y-4">
                                            <div className="flex justify-between items-center">
                                                <span className="text-blue-100 text-xs font-bold uppercase tracking-wider">New Adjusted Fare</span>
                                                <span className={`text-3xl font-black text-white ${revisedAmount !== null ? 'line-through opacity-60 text-2xl' : ''}`}>
                                                    ₹{displayFare}
                                                </span>
                                            </div>

                                            {revisedAmount !== null && (
                                                <div className="flex justify-between items-center pt-2 border-t border-blue-500/30">
                                                    <span className="text-emerald-200 text-xs font-bold uppercase tracking-wider">Revised Concession Fee (Year {targetYear})</span>
                                                    <span className="text-3xl font-black text-emerald-300">₹{revisedAmount}</span>
                                                </div>
                                            )}
                                            
                                            {activeTab === 'change' && (
                                                <div className="pt-4 border-t border-blue-500/50 flex justify-between items-center">
                                                    <span className="text-blue-100 text-[10px] font-bold uppercase tracking-wider">Due Amount (Excess)</span>
                                                    <div className="flex items-center gap-2">
                                                        <span className={`text-xl font-black ${finalFare - selectedStudent.fare > 0 ? 'text-yellow-300' : 'text-blue-200'}`}>
                                                            ₹{Math.max(0, finalFare - selectedStudent.fare)}
                                                        </span>
                                                        {finalFare - selectedStudent.fare > 0 && (
                                                            <span className="bg-yellow-400 text-yellow-900 text-[8px] font-black px-1.5 py-0.5 rounded-full uppercase">To Pay</span>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })()}

                                {formError && (
                                    <div className="p-4 rounded-xl border border-red-200 bg-red-50 text-red-800 text-sm leading-relaxed animate-in fade-in slide-in-from-top-1 duration-200">
                                        <p className="font-bold text-red-900 text-xs uppercase tracking-wide mb-1">
                                            {academicValidation?.reason === 'course_completed' ? 'Course completed' : 'Cannot raise request'}
                                        </p>
                                        <p>{formError}</p>
                                    </div>
                                )}
                            </div>

                            <button
                                type="submit"
                                disabled={
                                    submitting
                                    || !selectedStage
                                    || (activeTab === 'new' && userType === 'student' && academicValidation && !academicValidation.valid)
                                    || (activeTab === 'new' && userType === 'student' && validationLoading)
                                }
                                className="w-full bg-slate-900 text-white font-bold py-4 rounded-2xl hover:bg-black disabled:opacity-50 transition-all shadow-xl active:scale-95 flex items-center justify-center gap-2"
                            >
                                {submitting ? (
                                    <>Processing...</>
                                ) : (
                                    <>{activeTab === 'new' ? 'Raise & Approve' : 'Confirm Route Change'}</>
                                )}
                            </button>
                        </form>
                    ) : (
                        <div className="p-16 text-center text-slate-400 border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                            <RefreshCw size={48} className="mx-auto mb-4 opacity-20" />
                            <p className="font-bold text-slate-500">Pick a student on the left</p>
                            <p className="text-xs text-slate-400 mt-1">We'll load their configuration right here.</p>
                        </div>
                    )}
                </div>
            </div>

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
                                            onChange={(e) => setApproveModal((m) => ({ ...m, selectedBusId: e.target.value, error: null }))}
                                            className="w-full text-sm p-2 border border-blue-200 rounded outline-none focus:ring-2 focus:ring-blue-400 bg-white"
                                        >
                                            <option value="">-- Choose Bus --</option>
                                            {approveModal.data.busesOnRoute.map((b) => (
                                                <option key={b.busNumber} value={b.busNumber}>
                                                    {b.busNumber} (Filled: {b.seatsFilled}/{b.capacity} | {b.seatsAvailable} available)
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
                                disabled={actionLoading}
                                className="flex-1 bg-green-600 text-white font-semibold py-3 rounded-xl hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {actionLoading ? 'Approving…' : 'Confirm & Approve'}
                            </button>
                            <button
                                type="button"
                                onClick={closeApproveModal}
                                disabled={actionLoading}
                                className="px-4 py-3 rounded-xl border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
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

export default AdminRaiseRequest;
