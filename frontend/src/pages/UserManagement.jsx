import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch } from '../utils/api';

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
        { id: 'inventory', label: 'Inventory' },
    ];

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

    const handleManageRole = (user) => {
        if (user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) {
            alert("Super Admin roles cannot be modified.");
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
            setPermissions([...permissions, perm]);
        } else {
            setPermissions(permissions.filter(p => p !== perm));
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

    return (
        <Layout title="User Management">
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="p-6 border-b border-gray-100 flex justify-between items-center">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">System Users</h2>
                        <p className="text-sm text-gray-500">Manage employee access and roles</p>
                    </div>
                    <button
                        onClick={openAddAdminModal}
                        className="bg-blue-900 hover:bg-blue-800 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center"
                    >
                        <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" /></svg>
                        Add Admin
                    </button>
                </div>

                <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                        <thead className="bg-gray-50 border-b border-gray-100">
                            <tr>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Emp ID</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Name</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Roles & Restrictions</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Status</th>
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {loading ? (
                                <tr><td colSpan="5" className="p-6 text-center text-gray-500">Loading users...</td></tr>
                            ) : users.length === 0 ? (
                                <tr><td colSpan="5" className="p-6 text-center text-gray-500">No users found</td></tr>
                            ) : (
                                users.map((user) => (
                                    <tr key={user._id} className="hover:bg-gray-50 transition-colors">
                                        <td className="p-4 text-sm font-medium text-gray-900">{user.emp_no}</td>
                                        <td className="p-4 text-sm text-gray-700">
                                            <div className="font-medium">{user.employee_name}</div>
                                        </td>
                                        <td className="p-4 text-sm">
                                            <div className="flex flex-col gap-1.5">
                                                <div className="flex flex-wrap gap-1">
                                                    {user.roles && user.roles.map(role => (
                                                        <span key={role} className={`px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${role === 'superadmin'
                                                            ? 'bg-purple-100 text-purple-800 border-purple-200'
                                                            : 'bg-blue-100 text-blue-800 border-blue-200'
                                                            }`}>
                                                            {role === 'superadmin' ? 'Super Admin' : role}
                                                        </span>
                                                    ))}
                                                </div>
                                                {user.campuses && user.campuses.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 items-center">
                                                        <span className="text-[10px] text-gray-400 font-bold mr-1">CAMPUSES:</span>
                                                        {user.campuses.map(cId => {
                                                            const campus = campuses.find(c => c._id === cId || c._id === cId._id || c === cId);
                                                            return (
                                                                <span key={cId._id || cId} className="px-1.5 py-0.5 bg-gray-100 text-gray-600 text-[10px] font-semibold rounded border border-gray-200">
                                                                    {campus ? campus.name : 'Unknown Campus'}
                                                                </span>
                                                            );
                                                        })}
                                                    </div>
                                                )}
                                                {user.colleges && user.colleges.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 items-center">
                                                        <span className="text-[10px] text-indigo-400 font-bold mr-1">COLLEGES:</span>
                                                        {user.colleges.map(cName => (
                                                            <span key={cName} className="px-1.5 py-0.5 bg-indigo-50 text-indigo-700 text-[10px] font-semibold rounded border border-indigo-200">
                                                                {cName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                                {user.courses && user.courses.length > 0 && (
                                                    <div className="flex flex-wrap gap-1 items-center">
                                                        <span className="text-[10px] text-green-400 font-bold mr-1">COURSES:</span>
                                                        {user.courses.map(cName => (
                                                            <span key={cName} className="px-1.5 py-0.5 bg-green-50 text-green-700 text-[10px] font-semibold rounded border border-green-200">
                                                                {cName}
                                                            </span>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        <td className="p-4 text-sm">
                                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${user.is_active ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                                {user.is_active ? 'Active' : 'Inactive'}
                                            </span>
                                        </td>
                                        <td className="p-4 text-right">
                                            {!(user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) && (
                                                <>
                                                    <button
                                                        onClick={() => handleManageRole(user)}
                                                        className="text-sm text-indigo-600 hover:text-indigo-900 font-medium px-2 py-1 rounded hover:bg-indigo-50 transition-colors mr-2"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteUser(user)}
                                                        className="text-sm text-red-600 hover:text-red-900 font-medium px-2 py-1 rounded hover:bg-red-50 transition-colors"
                                                    >
                                                        Delete
                                                    </button>
                                                </>
                                            )}
                                        </td>
                                    </tr>
                                ))
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
                                            }`}>
                                                <input
                                                    type="checkbox"
                                                    value={perm.id}
                                                    checked={isChecked}
                                                    onChange={handlePermissionChange}
                                                    className="w-4.5 h-4.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 focus:ring-offset-0"
                                                />
                                                <span className={`text-sm font-medium ${isChecked ? 'text-indigo-900' : 'text-gray-700'}`}>{perm.label}</span>
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
                                        const isChecked = selectedCampuses.includes(campus._id);
                                        return (
                                            <label key={campus._id} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            }`}>
                                                <input
                                                    type="checkbox"
                                                    value={campus._id}
                                                    checked={isChecked}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedCampuses([...selectedCampuses, campus._id]);
                                                        } else {
                                                            setSelectedCampuses(selectedCampuses.filter(id => id !== campus._id));
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
                                    {colleges.map(college => {
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
                                    {colleges.length === 0 && (
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
                                            } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={perm.id}
                                                    checked={isChecked}
                                                    onChange={handlePermissionChange}
                                                    disabled={!selectedEmployee}
                                                    className="w-4.5 h-4.5 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 focus:ring-offset-0 disabled:opacity-50"
                                                />
                                                <span className={`text-sm font-medium ${isChecked ? 'text-indigo-900' : 'text-gray-700'} ${!selectedEmployee ? 'opacity-50' : ''}`}>{perm.label}</span>
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
                                        const isChecked = selectedCampuses.includes(campus._id);
                                        return (
                                            <label key={campus._id} className={`flex items-center space-x-3 p-1.5 rounded-lg cursor-pointer transition-colors ${
                                                isChecked ? 'bg-indigo-50/40' : 'hover:bg-gray-50'
                                            } ${!selectedEmployee ? 'opacity-50 cursor-not-allowed' : ''}`}>
                                                <input
                                                    type="checkbox"
                                                    value={campus._id}
                                                    checked={isChecked}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setSelectedCampuses([...selectedCampuses, campus._id]);
                                                        } else {
                                                            setSelectedCampuses(selectedCampuses.filter(id => id !== campus._id));
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
                                    {colleges.map(college => {
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
                                    {colleges.length === 0 && (
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
        </Layout>
    );
};

export default UserManagement;
