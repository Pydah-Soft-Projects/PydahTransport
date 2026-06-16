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

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/${targetId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                // Send role as an array for backend compatibility, but UI controls distinct single role
                body: JSON.stringify({ roles: [selectedRole], permissions, campuses: selectedCampuses }),
            });

            if (response.ok) {
                setIsManageModalOpen(false);
                setIsAddAdminModalOpen(false);
                setSelectedUser(null);
                setSelectedEmployee(null);
                setSelectedCampuses([]);
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
                                <th className="p-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">Roles</th>
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
                                                    <div className="flex flex-wrap gap-1">
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
            <Modal isOpen={isManageModalOpen} onClose={() => setIsManageModalOpen(false)} title={`Manage Role: ${selectedUser?.employee_name}`}>
                <div className="space-y-6">
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Access Role</h4>
                        <div className="space-y-2">
                            {/* Single Selection Radio Buttons */}
                            {['admin', 'manager', 'user'].map(role => (
                                <label key={role} className="flex items-center space-x-3 p-3 border rounded-lg hover:bg-gray-50 cursor-pointer transition-colors">
                                    <input
                                        type="radio"
                                        name="role"
                                        value={role}
                                        checked={selectedRole === role}
                                        onChange={(e) => setSelectedRole(e.target.value)}
                                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300"
                                    />
                                    <span className="capitalize font-medium text-gray-800">{role}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Page Permissions</h4>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-1">
                            {PERMISSION_OPTIONS.map(perm => (
                                <label key={perm.id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                                    <input
                                        type="checkbox"
                                        value={perm.id}
                                        checked={permissions.includes(perm.id)}
                                        onChange={handlePermissionChange}
                                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                                    />
                                    <span className="text-gray-700">{perm.label}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Campus Restriction</h4>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                            {campuses.map(campus => (
                                <label key={campus._id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                                    <input
                                        type="checkbox"
                                        value={campus._id}
                                        checked={selectedCampuses.includes(campus._id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedCampuses([...selectedCampuses, campus._id]);
                                            } else {
                                                setSelectedCampuses(selectedCampuses.filter(id => id !== campus._id));
                                            }
                                        }}
                                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300"
                                    />
                                    <span className="text-gray-700">{campus.name} ({campus.code})</span>
                                </label>
                            ))}
                            {campuses.length === 0 && (
                                <p className="text-xs text-gray-400 italic p-2">No campuses available. Add them in Route Management first.</p>
                            )}
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1">If no campuses are selected, the user will have access to all campuses.</p>
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
            <Modal isOpen={isAddAdminModalOpen} onClose={() => setIsAddAdminModalOpen(false)} title="Add New Admin">
                <div className="space-y-6">
                    {/* Search Section */}
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
                    <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                        <h4 className="text-sm font-bold text-gray-800 mb-4 border-b border-gray-200 pb-2">Employee Details</h4>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Full Name</label>
                                <input
                                    type="text"
                                    value={selectedEmployee?.employee_name || ''}
                                    readOnly
                                    placeholder="-"
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-gray-700 text-sm focus:outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Employee ID</label>
                                <input
                                    type="text"
                                    value={selectedEmployee?.emp_no || ''}
                                    readOnly
                                    placeholder="-"
                                    className="w-full px-3 py-2 bg-white border border-gray-200 rounded text-gray-700 text-sm focus:outline-none"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Role Selection (Add Mode) */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Access Role</h4>
                        <div className="flex gap-4">
                            {['admin', 'manager', 'user'].map(role => (
                                <label key={role} className="flex items-center space-x-2 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="add_role"
                                        value={role}
                                        checked={selectedRole === role}
                                        onChange={(e) => setSelectedRole(e.target.value)}
                                        disabled={!selectedEmployee}
                                        className="w-4 h-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 disabled:opacity-50"
                                    />
                                    <span className={`capitalize font-medium text-sm text-gray-800 ${!selectedEmployee ? 'opacity-50' : ''}`}>{role}</span>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Permissions Section */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Page Permissions</h4>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                            {PERMISSION_OPTIONS.map(perm => (
                                <label key={perm.id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                                    <input
                                        type="checkbox"
                                        value={perm.id}
                                        checked={permissions.includes(perm.id)}
                                        onChange={handlePermissionChange}
                                        disabled={!selectedEmployee}
                                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 disabled:opacity-50"
                                    />
                                    <span className={`text-gray-700 ${!selectedEmployee ? 'opacity-50' : ''}`}>{perm.label}</span>
                                </label>
                            ))}
                        </div>
                        {!selectedEmployee && <div className="text-xs text-red-500 mt-1">* Select an employee to assign permissions</div>}
                    </div>

                    {/* Campus Restrictions Section */}
                    <div>
                        <h4 className="text-sm font-semibold text-gray-700 mb-3 block">Campus Restriction</h4>
                        <div className="grid grid-cols-1 gap-2 max-h-48 overflow-y-auto p-1 border border-gray-100 rounded-lg">
                            {campuses.map(campus => (
                                <label key={campus._id} className="flex items-center space-x-3 p-2 rounded hover:bg-gray-50 cursor-pointer text-sm">
                                    <input
                                        type="checkbox"
                                        value={campus._id}
                                        checked={selectedCampuses.includes(campus._id)}
                                        onChange={(e) => {
                                            if (e.target.checked) {
                                                setSelectedCampuses([...selectedCampuses, campus._id]);
                                            } else {
                                                setSelectedCampuses(selectedCampuses.filter(id => id !== campus._id));
                                            }
                                        }}
                                        disabled={!selectedEmployee}
                                        className="w-4 h-4 text-indigo-600 rounded focus:ring-indigo-500 border-gray-300 disabled:opacity-50"
                                    />
                                    <span className={`text-gray-700 ${!selectedEmployee ? 'opacity-50' : ''}`}>{campus.name} ({campus.code})</span>
                                </label>
                            ))}
                            {campuses.length === 0 && (
                                <p className="text-xs text-gray-400 italic p-2">No campuses available. Add them in Route Management first.</p>
                            )}
                        </div>
                        <p className={`text-[10px] text-gray-400 mt-1 ${!selectedEmployee ? 'opacity-50' : ''}`}>If no campuses are selected, the user will have access to all campuses.</p>
                    </div>

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
