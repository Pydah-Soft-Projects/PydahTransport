import React, { useState, useEffect } from 'react';
import { Shield, MapPin, GraduationCap, Edit3, Trash2, Plus, User } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch } from '../utils/api';
import { campusIdsMatch, getCampusId, userHasCampus } from '../utils/campus';

const UserManagement = () => {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState(null);
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [isAddAdminModalOpen, setIsAddAdminModalOpen] = useState(false);

    // Form state for role/permission editing
    const [selectedRole, setSelectedRole] = useState('user'); // Single role
    const [permissions, setPermissions] = useState([]);
    const [selectedCampuses, setSelectedCampuses] = useState([]);
    const [campuses, setCampuses] = useState([]);

    // Colleges and Courses restrictions state
    const [colleges, setColleges] = useState([]);
    const [courses, setCourses] = useState([]);
    const [selectedColleges, setSelectedColleges] = useState([]);
    const [selectedCourses, setSelectedCourses] = useState([]);

    // Superadmin Edit state
    const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);
    const [superAdminForm, setSuperAdminForm] = useState({
        _id: '',
        name: '',
        username: '',
        email: '',
        phone: '',
        password: ''
    });
    const [superAdminSaving, setSuperAdminSaving] = useState(false);
    const [superAdminError, setSuperAdminError] = useState('');

    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null); // Employee selected from search

    const fetchCampuses = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/campuses`);
            const data = await response.json();
            if (response.ok) {
                setCampuses(data);
            }
        } catch (error) {
            console.error('Error fetching campuses:', error);
        }
    };

    const fetchColleges = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/students/colleges`);
            const data = await response.json();
            if (response.ok) {
                setColleges(data);
            }
        } catch (error) {
            console.error('Error fetching colleges:', error);
        }
    };

    const fetchCourses = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/students/courses`);
            const data = await response.json();
            if (response.ok) {
                setCourses(data);
            }
        } catch (error) {
            console.error('Error fetching courses:', error);
        }
    };

    const PERMISSION_OPTIONS = [
        { id: 'dashboard', label: 'Dashboard Access' },
        { id: 'bus_management', label: 'Bus Management' },
        { id: 'fleet_passengers', label: 'Fleet & Passengers' },
        { id: 'route_management', label: 'Route Management' },
        { id: 'transport_requests', label: 'Transport Requests' },
        { id: 'transport_dues', label: 'Transport Dues' },
        { id: 'user_management', label: 'User Management' },
        { id: 'raise_request', label: 'Raise Request' },
        { id: 'concessions', label: 'Concessions' },
        { id: 'inventory', label: 'Inventory — Page Access' },
        { id: 'inventory_edit', label: 'Inventory — Edit Bills', parent: 'inventory' },
        { id: 'inventory_delete', label: 'Inventory — Delete Bills', parent: 'inventory' },
    ];

    const INVENTORY_CHILD_PERMS = ['inventory_edit', 'inventory_delete'];

    useEffect(() => {
        fetchUsers();
        fetchCampuses();
        fetchColleges();
        fetchCourses();
    }, []);

    const fetchUsers = async () => {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;

        if (!token) {
            console.error('No token found');
            return;
        }

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (response.ok) {
                setUsers(data);
            } else {
                console.error('Failed to fetch users:', data.message);
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleSearch = async (query) => {
        setSearchQuery(query);
        if (query.length < 3) {
            setSearchResults([]);
            return;
        }

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;

        if (!token) return;

        setIsSearching(true);
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/search?q=${query}`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            const data = await response.json();
            if (response.ok) {
                setSearchResults(data);
            }
        } catch (error) {
            console.error('Error searching employees:', error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectEmployee = (employee) => {
        setSelectedEmployee(employee);
        setSelectedRole('admin'); // Default to admin
        setPermissions([]);
        setSelectedCampuses([]);
        setSelectedColleges([]);
        setSelectedCourses([]);
        setSearchResults([]);
        setSearchQuery('');
    };

    const handleEditSuperAdmin = (user) => {
        setSelectedUser(user);
        setSuperAdminForm({
            _id: user._id,
            name: user.name || user.employee_name || '',
            username: user.username || '',
            email: user.email || '',
            phone: user.phone || '',
            password: ''
        });
        setSuperAdminError('');
        setIsSuperAdminModalOpen(true);
    };

    const saveSuperAdmin = async (e) => {
        if (e) e.preventDefault();
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;

        if (!token || !superAdminForm._id) return;

        setSuperAdminSaving(true);
        setSuperAdminError('');

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/superadmin/${superAdminForm._id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    name: superAdminForm.name,
                    username: superAdminForm.username,
                    email: superAdminForm.email,
                    phone: superAdminForm.phone,
                    password: superAdminForm.password || undefined
                }),
            });

            const data = await response.json();

            if (response.ok) {
                setIsSuperAdminModalOpen(false);
                fetchUsers(); // Refresh list
            } else {
                setSuperAdminError(data.message || 'Failed to update superadmin');
            }
        } catch (error) {
            console.error('Error updating superadmin:', error);
            setSuperAdminError('Error updating superadmin details');
        } finally {
            setSuperAdminSaving(false);
        }
    };

    const handleManageRole = (user) => {
        if (user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) {
            handleEditSuperAdmin(user);
            return;
        }

        setSelectedUser(user);
        setSelectedEmployee(null); // Clear add mode selection
        // Take the first role if exists, or default to user
        const currentRole = user.roles && user.roles.length > 0 ? user.roles[0] : 'user';
        setSelectedRole(currentRole);
        setPermissions(user.permissions || []);
        setSelectedCampuses(user.campuses || []);
        setSelectedColleges(user.colleges || []);
        setSelectedCourses(user.courses || []);
        setIsManageModalOpen(true);
    };

    const handleDeleteUser = async (user) => {
        if (user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) {
            alert("Super Admin cannot be deleted.");
            return;
        }

        if (!window.confirm(`Are you sure you want to remove ${user.employee_name} from admins? This will revoke their access.`)) {
            return;
        }

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;

        if (!token) return;

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/${user._id}/role`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (response.ok) {
                fetchUsers(); // Refresh list
            } else {
                alert('Failed to remove user');
            }
        } catch (error) {
            console.error('Error deleting user:', error);
            alert('Error deleting user');
        }
    };

    const saveRole = async () => {
        const targetId = selectedUser ? selectedUser._id : selectedEmployee?._id;
        if (!targetId) return;

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;

        if (!token) return;

        console.log('[Frontend] Saving Role:', selectedRole);
        console.log('[Frontend] Target ID:', targetId);
        console.log('[Frontend] Campuses to Save:', selectedCampuses);
        console.log('[Frontend] Colleges to Save:', selectedColleges);
        console.log('[Frontend] Courses to Save:', selectedCourses);

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/${targetId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({ 
                    roles: [selectedRole], 
                    permissions, 
                    campuses: selectedCampuses,
                    colleges: selectedColleges,
                    courses: selectedCourses
                }),
            });

            if (response.ok) {
                setIsManageModalOpen(false);
                setIsAddAdminModalOpen(false);
                setSelectedUser(null);
                setSelectedEmployee(null);
                setSelectedCampuses([]);
                setSelectedColleges([]);
                setSelectedCourses([]);
                fetchUsers(); // Refresh list
            } else {
                alert('Failed to update role');
            }
        } catch (error) {
            console.error('Error updating role:', error);
            alert('Error updating role');
        }
    };

    const openAddAdminModal = () => {
        setSelectedUser(null);
        setSelectedEmployee(null);
        setSelectedRole('admin');
        setPermissions([]);
        setSelectedCampuses([]);
        setSelectedColleges([]);
        setSelectedCourses([]);
        setSearchQuery('');
        setSearchResults([]);
        setIsAddAdminModalOpen(true);
    };

    const handlePermissionChange = (e) => {
        const perm = e.target.value;
        if (e.target.checked) {
            let next = [...permissions, perm];
            const option = PERMISSION_OPTIONS.find((entry) => entry.id === perm);
            if (option?.parent && !next.includes(option.parent)) {
                next.push(option.parent);
            }
            setPermissions(next);
        } else {
            let next = permissions.filter(p => p !== perm);
            if (perm === 'inventory') {
                next = next.filter(p => !INVENTORY_CHILD_PERMS.includes(p));
            }
            setPermissions(next);
        }
    };

    const handleCollegeChange = (collegeName, isChecked) => {
        let newSelectedColleges;
        if (isChecked) {
            newSelectedColleges = [...selectedColleges, collegeName];
        } else {
            newSelectedColleges = selectedColleges.filter(name => name !== collegeName);
        }
        setSelectedColleges(newSelectedColleges);

        // Filter selected courses to ensure they only belong to the remaining selected colleges
        const remainingCollegeIds = colleges
            .filter(c => newSelectedColleges.includes(c.name))
            .map(c => c.id);

        const newSelectedCourses = selectedCourses.filter(courseName => {
            const courseObj = courses.find(c => c.name === courseName);
            if (!courseObj) return false;
            return remainingCollegeIds.includes(courseObj.college_id);
        });
        setSelectedCourses(newSelectedCourses);
    };

    const selectedCollegeIds = colleges
        .filter(c => selectedColleges.includes(c.name))
        .map(c => c.id);

    const filteredCourses = selectedColleges.length > 0
        ? courses.filter(course => selectedCollegeIds.includes(course.college_id))
        : [];

    const activeCampusColleges = campuses
        .filter(campus => userHasCampus(selectedCampuses, getCampusId(campus)))
        .reduce((acc, campus) => {
            if (campus.colleges && campus.colleges.length > 0) {
                acc.push(...campus.colleges);
            }
            return acc;
        }, []);

    const displayedColleges = selectedCampuses.length > 0
        ? colleges.filter(college => activeCampusColleges.includes(college.name))
        : colleges;

    return (
        <Layout>
             <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <h2 className="text-xl font-bold text-slate-800 tracking-tight">User Management</h2>
                    <p className="text-slate-500 text-xs mt-0.5">Manage system administration roles, page permissions, and campus/college-level data access restrictions.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <button
                        type="button"
                        onClick={openAddAdminModal}
                        className="bg-blue-900 hover:bg-blue-700 text-white px-3.5 py-1.5 rounded-lg text-xs font-semibold shadow-sm transition-all hover:shadow-md active:scale-95 flex items-center group"
                    >
                        <Plus className="mr-1.5 group-hover:rotate-90 transition-transform" size={14} />
                        Add Admin
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="bg-slate-50 border-b border-slate-200 text-[10px] uppercase text-slate-500 font-bold tracking-wider">
                                <th className="px-3 py-2">Employee</th>
                                <th className="px-3 py-2">Campus Restrictions</th>
                                <th className="px-3 py-2">Academic Restrictions</th>
                                <th className="px-3 py-2">Status</th>
                                <th className="px-3 py-2 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 text-sm text-slate-700">
                            {loading ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400 font-semibold text-xs animate-pulse">
                                        Loading system users...
                                    </td>
                                </tr>
                            ) : users.length === 0 ? (
                                <tr>
                                    <td colSpan="5" className="p-8 text-center text-slate-400 font-semibold text-xs">
                                        No system users found.
                                    </td>
                                </tr>
                            ) : (
                                users.map((user) => {
                                    const initials = user.employee_name
                                        ? user.employee_name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()
                                        : 'U';
                                    const isSuperAdmin = user.is_superadmin || (user.roles && user.roles.includes('superadmin'));
                                    
                                    return (
                                        <tr key={user._id} className="hover:bg-slate-50/60 transition-colors border-b border-slate-100/60">
                                            {/* Employee details */}
                                            <td className="px-3 py-2">
                                                <div className="flex items-center gap-2">
                                                    <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-indigo-500/10 to-blue-500/10 border border-indigo-100/50 flex items-center justify-center font-bold text-indigo-700 text-xs tracking-wider shadow-sm shrink-0">
                                                        {initials}
                                                    </div>
                                                    <div className="min-w-0">
                                                        <p className="font-semibold text-slate-800 text-xs truncate">{user.employee_name}</p>
                                                        <div className="flex flex-wrap items-center gap-1 mt-0.5 text-[9px] font-bold uppercase tracking-wider text-slate-400">
                                                            <span>ID: {user.emp_no}</span>
                                                            {user.roles && user.roles.map(role => {
                                                                const isSA = role === 'superadmin';
                                                                const isMgr = role === 'manager';
                                                                return (
                                                                    <React.Fragment key={role}>
                                                                        <span className="text-slate-300">•</span>
                                                                        <span className={`px-1.5 py-0.5 rounded text-[8px] font-black capitalize border tracking-wider ${
                                                                            isSA
                                                                                ? 'bg-purple-50 text-purple-700 border-purple-200/50'
                                                                                : isMgr
                                                                                    ? 'bg-amber-50 text-amber-700 border-amber-200/50'
                                                                                    : 'bg-blue-50 text-blue-700 border-blue-200/50'
                                                                        }`}>
                                                                            {isSA ? 'Super Admin' : role}
                                                                        </span>
                                                                    </React.Fragment>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                </div>
                                            </td>
 
                                            {/* Campus Restrictions */}
                                            <td className="px-3 py-2">
                                                {user.campuses && user.campuses.length > 0 ? (
                                                    <div className="flex flex-wrap gap-1 max-w-xs">
                                                        {user.campuses.map(cId => {
                                                            const campus = campuses.find(c => campusIdsMatch(getCampusId(c), cId));
                                                            return (
                                                                <span key={String(cId)} className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-slate-50 text-slate-700 text-[10px] font-bold rounded border border-slate-200 shadow-sm">
                                                                    <MapPin size={9} className="text-slate-400" />
                                                                    {campus ? campus.name : 'Unknown Campus'}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                ) : (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-green-50 text-green-700 text-[10px] font-bold rounded border border-green-200">
                                                        All Campuses
                                                    </span>
                                                )}
                                            </td>
 
                                            {/* Academic Restrictions */}
                                            <td className="px-3 py-2">
                                                <div className="flex flex-col gap-1">
                                                    {user.colleges && user.colleges.length > 0 && (
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-[8px] text-indigo-400 font-black tracking-wider uppercase">COLLEGES:</span>
                                                            {user.colleges.map(cName => (
                                                                <span key={cName} className="px-1 py-0.5 bg-indigo-50 text-indigo-700 text-[9px] font-bold rounded border border-indigo-200 w-fit">
                                                                    {cName}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {user.courses && user.courses.length > 0 && (
                                                        <div className="flex flex-col gap-0.5">
                                                            <span className="text-[8px] text-emerald-500 font-black tracking-wider uppercase">COURSES:</span>
                                                            {user.courses.map(cName => (
                                                                <span key={cName} className="px-1 py-0.5 bg-emerald-50 text-emerald-700 text-[9px] font-bold rounded border border-emerald-200 w-fit">
                                                                    {cName}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}

                                                    {(!user.colleges || user.colleges.length === 0) && (!user.courses || user.courses.length === 0) && (
                                                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-emerald-50 text-emerald-700 text-[10px] font-bold rounded border border-emerald-200">
                                                            All Colleges & Courses
                                                        </span>
                                                    )}
                                                </div>
                                            </td>
 
                                            {/* Account Status */}
                                            <td className="px-3 py-2">
                                                <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold border shadow-sm ${
                                                    user.is_active
                                                        ? 'bg-green-50 text-green-700 border-green-200'
                                                        : 'bg-rose-50 text-rose-700 border-rose-200'
                                                }`}>
                                                    <span className={`w-1 h-1 rounded-full ${user.is_active ? 'bg-green-600' : 'bg-rose-600'}`} />
                                                    {user.is_active ? 'Active' : 'Inactive'}
                                                </span>
                                            </td>

                                            {/* Actions */}
                                            <td className="px-3 py-2 text-right">
                                                {!isSuperAdmin ? (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => handleManageRole(user)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white text-slate-700 font-bold text-[10px] hover:bg-slate-50 hover:text-indigo-600 shadow-sm transition-all"
                                                        >
                                                            <Edit3 size={10} />
                                                            Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(user)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-red-200 bg-white text-red-650 font-bold text-[10px] hover:bg-red-50 shadow-sm transition-all"
                                                        >
                                                            <Trash2 size={10} />
                                                            Delete
                                                        </button>
                                                    </div>
                                                ) : (
                                                    <div className="flex items-center justify-end gap-1">
                                                        <button
                                                            onClick={() => handleEditSuperAdmin(user)}
                                                            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-purple-200 bg-purple-50 text-purple-700 font-bold text-[10px] hover:bg-purple-100 shadow-sm transition-all"
                                                        >
                                                            <Edit3 size={10} />
                                                            Edit Details
                                                        </button>
                                                    </div>
                                                )}
                                            </td>
                                        </tr>
                                    );
                                })
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Manage Roles Modal (For existing users) */}
            <Modal isOpen={isManageModalOpen} onClose={() => setIsManageModalOpen(false)} title={`Manage Role: ${selectedUser?.employee_name}`} maxWidth="max-w-5xl">
                <div className="space-y-6">
                    {/* Employee Details (Full Width) */}
                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                        <h4 className="text-sm font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Employee Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={selectedUser?.employee_name || ''}
                                    readOnly
                                    placeholder="-"
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 text-sm focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Employee ID</label>
                                <input
                                    type="text"
                                    value={selectedUser?.emp_no || ''}
                                    readOnly
                                    placeholder="-"
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 text-sm focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Column 1 */}
                        <div className="space-y-6">
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Access Role</h4>
                                <div className="grid grid-cols-3 gap-3">
                                    {['admin', 'manager', 'user'].map(role => {
                                        const isActive = selectedRole === role;
                                        return (
                                            <label key={role} className={`flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all duration-200 ${
                                                isActive
                                                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-600/20'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                            }`}>
                                                <input
                                                    type="radio"
                                                    name="role"
                                                    value={role}
                                                    checked={isActive}
                                                    onChange={(e) => setSelectedRole(e.target.value)}
                                                    className="sr-only"
                                                />
                                                <span className="capitalize font-semibold text-sm">{role}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Page Permissions</span>
                                    <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-medium">
                                        {permissions.length} Selected
                                    </span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-64 overflow-y-auto custom-scrollbar">
                                    {PERMISSION_OPTIONS.map(perm => {
                                        const isChecked = permissions.includes(perm.id);
                                        return (
                                            <label key={perm.id} className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            } ${perm.parent ? 'ml-4 border-l-2 border-indigo-100' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={perm.id}
                                                    checked={isChecked}
                                                    onChange={handlePermissionChange}
                                                    className="w-4.5 h-4.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 focus:ring-offset-0"
                                                />
                                                <span className={`text-sm font-medium ${isChecked ? 'text-indigo-900' : 'text-gray-700'} ${perm.parent ? 'text-gray-600' : ''}`}>{perm.label}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>

                        {/* Column 2 */}
                        <div className="space-y-6">
                            {/* Campus Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Campus Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedCampuses.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {campuses.map(campus => {
                                        const campusId = getCampusId(campus);
                                        const isChecked = userHasCampus(selectedCampuses, campusId);
                                        return (
                                            <label key={campusId} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            }`}>
                                                <input
                                                    type="checkbox"
                                                    value={campusId}
                                                    checked={isChecked}
                                                    onChange={(e) => {
                                                        let newSelectedCampuses;
                                                        if (e.target.checked) {
                                                            newSelectedCampuses = [...selectedCampuses, campusId];
                                                        } else {
                                                            newSelectedCampuses = selectedCampuses.filter(id => !campusIdsMatch(id, campusId));
                                                        }
                                                        setSelectedCampuses(newSelectedCampuses);

                                                        if (newSelectedCampuses.length > 0) {
                                                            const remainingCampusColleges = campuses
                                                                .filter(c => userHasCampus(newSelectedCampuses, getCampusId(c)))
                                                                .reduce((acc, c) => {
                                                                    if (c.colleges) acc.push(...c.colleges);
                                                                    return acc;
                                                                }, []);
                                                            setSelectedColleges(prev => prev.filter(colName => remainingCampusColleges.includes(colName)));
                                                        }
                                                    }}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                />
                                                <span className="text-sm text-gray-700">{campus.name} ({campus.code})</span>
                                            </label>
                                        );
                                    })}
                                    {campuses.length === 0 && (
                                        <p className="text-xs text-gray-400 italic p-2">No campuses available. Add them in Route Management first.</p>
                                    )}
                                </div>
                            </div>

                            {/* College Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">College Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedColleges.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {displayedColleges.map(college => {
                                        const isChecked = selectedColleges.includes(college.name);
                                        return (
                                            <label key={college.id} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            }`}>
                                                <input
                                                    type="checkbox"
                                                    value={college.name}
                                                    checked={isChecked}
                                                    onChange={(e) => handleCollegeChange(college.name, e.target.checked)}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                />
                                                <span className="text-sm text-gray-700">{college.name} ({college.code})</span>
                                            </label>
                                        );
                                    })}
                                    {displayedColleges.length === 0 && (
                                        <p className="text-xs text-gray-400 italic p-2">No colleges available.</p>
                                    )}
                                </div>
                            </div>
 
                            {/* Course Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Course Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedCourses.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {selectedColleges.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic p-2">Select at least one college to restrict courses.</p>
                                    ) : filteredCourses.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic p-2">No courses available for selected colleges.</p>
                                    ) : (
                                        filteredCourses.map(course => {
                                            const isChecked = selectedCourses.includes(course.name);
                                            return (
                                                <label key={course.id || course.name} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                    isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                                }`}>
                                                    <input
                                                        type="checkbox"
                                                        value={course.name}
                                                        checked={isChecked}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedCourses([...selectedCourses, course.name]);
                                                            } else {
                                                                setSelectedCourses(selectedCourses.filter(name => name !== course.name));
                                                            }
                                                        }}
                                                        className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500"
                                                    />
                                                    <span className="text-sm text-gray-700">{course.name}</span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-gray-100">
                        <button
                            onClick={() => setIsManageModalOpen(false)}
                            className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={saveRole}
                            className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 font-medium shadow-sm transition-all"
                        >
                            Save Changes
                        </button>
                    </div>
                </div>
            </Modal>

            {/* Add Admin Modal */}
            <Modal isOpen={isAddAdminModalOpen} onClose={() => setIsAddAdminModalOpen(false)} title="Add New Admin" maxWidth="max-w-5xl">
                <div className="space-y-6">
                    {/* Search & Details Section (Full Width) */}
                    <div className="space-y-4">
                        <div className="relative">
                            <label className="block text-sm font-medium text-gray-700 mb-1">Search Employee (HRMS)</label>
                            <div className="relative">
                                <input
                                    type="text"
                                    className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                                    placeholder="Search by name or ID..."
                                    value={searchQuery}
                                    onChange={(e) => handleSearch(e.target.value)}
                                />
                                <svg className="w-5 h-5 text-gray-400 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                                </svg>
                            </div>

                            {/* Search Results */}
                            {searchResults.length > 0 && (
                                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto divide-y divide-gray-100">
                                    {searchResults.map(emp => (
                                        <div
                                            key={emp.emp_no}
                                            onClick={() => handleSelectEmployee(emp)}
                                            className="p-3 hover:bg-indigo-50 cursor-pointer transition-colors"
                                        >
                                            <div className="font-medium text-gray-900">{emp.employee_name}</div>
                                            <div className="text-xs text-gray-500">ID: {emp.emp_no}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                            {searchQuery.length > 3 && searchResults.length === 0 && !isSearching && (
                                <div className="text-sm text-gray-500 mt-2 absolute">No employees found.</div>
                            )}
                        </div>

                        {/* Employee Details Form */}
                        <div className="bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <h4 className="text-sm font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Employee Details</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                                    <input
                                        type="text"
                                        value={selectedEmployee?.employee_name || ''}
                                        readOnly
                                        placeholder="-"
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 text-sm focus:outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Employee ID</label>
                                    <input
                                        type="text"
                                        value={selectedEmployee?.emp_no || ''}
                                        readOnly
                                        placeholder="-"
                                        className="w-full px-3 py-2 bg-white border border-gray-200 rounded-lg text-gray-700 text-sm focus:outline-none"
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Columns Section */}
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                        {/* Column 1 */}
                        <div className="space-y-6">
                            {/* Role Selection */}
                            <div>
                                <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Access Role</h4>
                                <div className="grid grid-cols-3 gap-3">
                                    {['admin', 'manager', 'user'].map(role => {
                                        const isActive = selectedRole === role;
                                        return (
                                            <label key={role} className={`flex flex-col items-center justify-center p-3 border rounded-xl cursor-pointer transition-all duration-200 ${
                                                isActive
                                                    ? 'border-indigo-600 bg-indigo-50/50 text-indigo-700 ring-2 ring-indigo-600/20'
                                                    : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
                                            } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="radio"
                                                    name="add_role"
                                                    value={role}
                                                    checked={isActive}
                                                    onChange={(e) => setSelectedRole(e.target.value)}
                                                    disabled={!selectedEmployee}
                                                    className="sr-only"
                                                />
                                                <span className="capitalize font-semibold text-sm">{role}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* Permissions */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Page Permissions</span>
                                    <span className="text-xs bg-indigo-100 text-indigo-800 px-2 py-0.5 rounded-full font-medium">
                                        {permissions.length} Selected
                                    </span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-64 overflow-y-auto custom-scrollbar">
                                    {PERMISSION_OPTIONS.map(perm => {
                                        const isChecked = permissions.includes(perm.id);
                                        return (
                                            <label key={perm.id} className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            } ${perm.parent ? 'ml-4 border-l-2 border-indigo-100' : ''} ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={perm.id}
                                                    checked={isChecked}
                                                    onChange={handlePermissionChange}
                                                    disabled={!selectedEmployee}
                                                    className="w-4.5 h-4.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 focus:ring-offset-0 disabled:opacity-50"
                                                />
                                                <span className={`text-sm font-medium ${isChecked ? 'text-indigo-900' : 'text-gray-700'} ${perm.parent ? 'text-gray-600' : ''} ${!selectedEmployee ? 'opacity-50' : ''}`}>{perm.label}</span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </div>
                            {!selectedEmployee && <div className="text-xs text-red-500 mt-1 font-medium">* Select an employee to assign permissions</div>}
                        </div>

                        {/* Column 2 */}
                        <div className="space-y-6">
                            {/* Campus Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Campus Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedCampuses.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {campuses.map(campus => {
                                        const campusId = getCampusId(campus);
                                        const isChecked = userHasCampus(selectedCampuses, campusId);
                                        return (
                                            <label key={campusId} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={campusId}
                                                    checked={isChecked}
                                                    onChange={(e) => {
                                                        let newSelectedCampuses;
                                                        if (e.target.checked) {
                                                            newSelectedCampuses = [...selectedCampuses, campusId];
                                                        } else {
                                                            newSelectedCampuses = selectedCampuses.filter(id => !campusIdsMatch(id, campusId));
                                                        }
                                                        setSelectedCampuses(newSelectedCampuses);

                                                        if (newSelectedCampuses.length > 0) {
                                                            const remainingCampusColleges = campuses
                                                                .filter(c => userHasCampus(newSelectedCampuses, getCampusId(c)))
                                                                .reduce((acc, c) => {
                                                                    if (c.colleges) acc.push(...c.colleges);
                                                                    return acc;
                                                                }, []);
                                                            setSelectedColleges(prev => prev.filter(colName => remainingCampusColleges.includes(colName)));
                                                        }
                                                    }}
                                                    disabled={!selectedEmployee}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                                                />
                                                <span className={`text-sm text-gray-700 ${!selectedEmployee ? 'opacity-50' : ''}`}>{campus.name} ({campus.code})</span>
                                            </label>
                                        );
                                    })}
                                    {campuses.length === 0 && (
                                        <p className="text-xs text-gray-400 italic p-2">No campuses available. Add them in Route Management first.</p>
                                    )}
                                </div>
                            </div>

                            {/* College Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">College Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedColleges.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {displayedColleges.map(college => {
                                        const isChecked = selectedColleges.includes(college.name);
                                        return (
                                            <label key={college.id} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={college.name}
                                                    checked={isChecked}
                                                    onChange={(e) => handleCollegeChange(college.name, e.target.checked)}
                                                    disabled={!selectedEmployee}
                                                    className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                                                />
                                                <span className={`text-sm text-gray-700 ${!selectedEmployee ? 'opacity-50' : ''}`}>{college.name} ({college.code})</span>
                                            </label>
                                        );
                                    })}
                                    {displayedColleges.length === 0 && (
                                        <p className="text-xs text-gray-400 italic p-2">No colleges available.</p>
                                    )}
                                </div>
                            </div>
 
                            {/* Course Restriction */}
                            <div className="border border-gray-200 rounded-xl overflow-hidden bg-white">
                                <div className="bg-gray-50 px-4 py-2.5 border-b border-gray-200 flex justify-between items-center">
                                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wider">Course Restriction</span>
                                    <span className="text-[10px] text-gray-400">({selectedCourses.length} selected)</span>
                                </div>
                                <div className="p-3 grid grid-cols-1 gap-1 max-h-36 overflow-y-auto custom-scrollbar">
                                    {!selectedEmployee ? (
                                        <p className="text-xs text-gray-400 italic p-2 opacity-50">Select an employee first.</p>
                                    ) : selectedColleges.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic p-2">Select at least one college to restrict courses.</p>
                                    ) : filteredCourses.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic p-2">No courses available for selected colleges.</p>
                                    ) : (
                                        filteredCourses.map(course => {
                                            const isChecked = selectedCourses.includes(course.name);
                                            return (
                                                <label key={course.id || course.name} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                    isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                                } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                    <input
                                                        type="checkbox"
                                                        value={course.name}
                                                        checked={isChecked}
                                                        onChange={(e) => {
                                                            if (e.target.checked) {
                                                                setSelectedCourses([...selectedCourses, course.name]);
                                                            } else {
                                                                setSelectedCourses(selectedCourses.filter(name => name !== course.name));
                                                            }
                                                        }}
                                                        disabled={!selectedEmployee}
                                                        className="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 disabled:opacity-50"
                                                    />
                                                    <span className={`text-sm text-gray-700 ${!selectedEmployee ? 'opacity-50' : ''}`}>{course.name}</span>
                                                </label>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Footer Section */}
                    <div className="pt-4 flex flex-col items-end border-t border-gray-100">
                        <div className="text-xs text-gray-500 mb-3 italic">
                            * User will login with their <strong>Employee ID</strong> and <strong>HRMS Password</strong>
                        </div>
                        <div className="flex gap-3">
                            <button
                                onClick={() => setIsAddAdminModalOpen(false)}
                                className="px-4 py-2 text-gray-600 hover:text-gray-800 font-medium"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={saveRole}
                                disabled={!selectedEmployee}
                                className={`px-4 py-2 text-white rounded-lg font-medium shadow-sm transition-all ${!selectedEmployee ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-900 hover:bg-blue-800'}`}
                            >
                                Add Admin
                            </button>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Edit Superadmin Modal */}
            <Modal isOpen={isSuperAdminModalOpen} onClose={() => setIsSuperAdminModalOpen(false)} title="Edit Superadmin Details" maxWidth="max-w-xl">
                <form onSubmit={saveSuperAdmin} className="space-y-4">
                    {superAdminError && (
                        <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">
                            {superAdminError}
                        </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                            Full Name
                        </label>
                        <input
                            type="text"
                            value={superAdminForm.name}
                            onChange={(e) => setSuperAdminForm({ ...superAdminForm, name: e.target.value })}
                            placeholder="e.g. System Super Admin"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                Username <span className="text-red-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={superAdminForm.username}
                                onChange={(e) => setSuperAdminForm({ ...superAdminForm, username: e.target.value })}
                                placeholder="e.g. superadmin"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                Phone Number
                            </label>
                            <input
                                type="tel"
                                value={superAdminForm.phone}
                                onChange={(e) => setSuperAdminForm({ ...superAdminForm, phone: e.target.value })}
                                placeholder="e.g. 9876543210"
                                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all outline-none"
                            />
                        </div>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                            Email Address
                        </label>
                        <input
                            type="email"
                            value={superAdminForm.email}
                            onChange={(e) => setSuperAdminForm({ ...superAdminForm, email: e.target.value })}
                            placeholder="e.g. admin@pydah.edu.in"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all outline-none"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">Used for forgot password recovery emails.</p>
                    </div>

                    <div>
                        <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                            New Password
                        </label>
                        <input
                            type="password"
                            value={superAdminForm.password}
                            onChange={(e) => setSuperAdminForm({ ...superAdminForm, password: e.target.value })}
                            placeholder="Leave blank to keep current password"
                            className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 transition-all outline-none"
                        />
                        <p className="text-[11px] text-slate-400 mt-1">Only enter a password if you wish to change it.</p>
                    </div>

                    <div className="pt-4 flex justify-end gap-3 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsSuperAdminModalOpen(false)}
                            className="px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-xs rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={superAdminSaving}
                            className="px-4 py-2 bg-purple-700 hover:bg-purple-800 text-white rounded-lg font-semibold text-xs shadow-sm transition-all disabled:opacity-50"
                        >
                            {superAdminSaving ? 'Saving Changes...' : 'Save Changes'}
                        </button>
                    </div>
                </form>
            </Modal>
        </Layout>
    );
};

export default UserManagement;
