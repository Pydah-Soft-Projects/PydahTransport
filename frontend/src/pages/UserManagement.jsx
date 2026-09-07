import React, { useState, useEffect } from 'react';
import { Shield, MapPin, Edit3, Trash2, Plus, User, Search, UserPlus, X, Check, Mail, Phone, Building2 } from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch } from '../utils/api';
import { campusIdsMatch, getCampusId, userHasCampus } from '../utils/campus';

const UserManagement = () => {
    // Tab state
    const [activeTab, setActiveTab] = useState('users'); // 'users' | 'roles'

    // Users state
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedUser, setSelectedUser] = useState(null);

    // Filter & Search states
    const [searchQuery, setSearchQuery] = useState('');
    const [filterStatus, setFilterStatus] = useState('all');
    const [filterCampus, setFilterCampus] = useState('all');
    const [filterCollege, setFilterCollege] = useState('all');
    const [filterRole, setFilterRole] = useState('all');

    // Modals state
    const [isManageModalOpen, setIsManageModalOpen] = useState(false);
    const [isAddAdminModalOpen, setIsAddAdminModalOpen] = useState(false);
    const [isCreateRoleModalOpen, setIsCreateRoleModalOpen] = useState(false);
    const [isSuperAdminModalOpen, setIsSuperAdminModalOpen] = useState(false);

    // Form state for user edit (Image 3)
    const [editRole, setEditRole] = useState('office_staff');
    const [editEmail, setEditEmail] = useState('');
    const [editMobile, setEditMobile] = useState('');
    const [editIsActive, setEditIsActive] = useState(true);
    const [permissions, setPermissions] = useState([]);
    const [selectedCampuses, setSelectedCampuses] = useState([]);
    const [selectedColleges, setSelectedColleges] = useState([]);
    const [selectedCourses, setSelectedCourses] = useState([]);

    // Data lists
    const [campuses, setCampuses] = useState([]);
    const [colleges, setColleges] = useState([]);
    const [courses, setCourses] = useState([]);

    // Custom Roles state (Image 2)
    const [rolesList, setRolesList] = useState([
        { id: 'office_staff', name: 'Office Staff', description: 'Standard office staff user with collection and reporting access' },
        { id: 'cashier', name: 'Cashier', description: 'Handles daily fee collection and cashier summaries' },
        { id: 'ao', name: 'AO', description: 'Administrative Officer with college wide oversight' },
        { id: 'manager', name: 'Manager', description: 'Manages departmental permissions and staff' },
        { id: 'admin', name: 'Admin', description: 'Full system management and configuration access' },
        { id: 'support_staff', name: 'Support Staff', description: 'Helps with student queries and bus pass views' }
    ]);
    const [newRoleName, setNewRoleName] = useState('');
    const [newRoleDesc, setNewRoleDesc] = useState('');
    const [newRolePermissions, setNewRolePermissions] = useState([]);

    // HRMS Search state (for Add User)
    const [employeeSearchQuery, setEmployeeSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedEmployee, setSelectedEmployee] = useState(null);

    // Superadmin Edit state
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

    const DEFAULT_ROLE_PERMISSIONS = {
        office_staff: [
            'dashboard',
            'fleet_passengers',
            'raise_request',
            'transport_requests',
            'renewals',
            'transport_dues',
            'concessions',
            'attendance',
            'qr_verification'
        ],
        cashier: [
            'dashboard',
            'transport_dues'
        ],
        ao: [
            'dashboard',
            'fleet_passengers',
            'gps_tracking',
            'communications',
            'transport_requests',
            'transport_dues',
            'attendance',
            'qr_verification'
        ],
        manager: [
            'dashboard',
            'bus_management',
            'route_management',
            'fleet_passengers',
            'gps_tracking',
            'communications',
            'raise_request',
            'transport_requests',
            'renewals',
            'transport_dues',
            'concessions',
            'attendance',
            'inventory',
            'inventory_edit',
            'inventory_delete',
            'qr_verification',
            'settings'
        ],
        admin: [
            'dashboard',
            'bus_management',
            'route_management',
            'fleet_passengers',
            'gps_tracking',
            'communications',
            'raise_request',
            'transport_requests',
            'renewals',
            'transport_dues',
            'concessions',
            'attendance',
            'inventory',
            'inventory_edit',
            'inventory_delete',
            'user_management',
            'qr_verification',
            'settings'
        ],
        support_staff: [
            'dashboard',
            'gps_tracking'
        ],
        user: [
            'dashboard'
        ]
    };

    const ROLE_OPTIONS = [
        { id: 'office_staff', label: 'Office Staff' },
        { id: 'cashier', label: 'Cashier' },
        { id: 'ao', label: 'AO (Administrative Officer)' },
        { id: 'manager', label: 'Manager' },
        { id: 'admin', label: 'Admin' },
        { id: 'user', label: 'User' }
    ];

    const ROLE_PERMISSIONS_LIST = [
        { id: 'dashboard', label: 'Dashboard', path: '/dashboard' },
        { id: 'bus_management', label: 'Vehicle Management', path: '/buses' },
        { id: 'route_management', label: 'Route Management', path: '/routes' },
        { id: 'fleet_passengers', label: 'Fleet & Passengers', path: '/fleet' },
        { id: 'gps_tracking', label: 'GPS Live Tracking', path: '/gps-tracking' },
        { id: 'communications', label: 'Communications', path: '/communications' },
        { id: 'raise_request', label: 'Raise New Request', path: '/raise-request' },
        { id: 'transport_requests', label: 'Passenger Requests', path: '/transport-requests' },
        { id: 'renewals', label: 'Renewals', path: '/renewals' },
        { id: 'transport_dues', label: 'Transport Dues', path: '/transport-dues' },
        { id: 'concessions', label: 'Concessions', path: '/concessions' },
        { id: 'attendance', label: 'Attendance', path: '/attendance' },
        { id: 'qr_verification', label: 'QR Verification', path: '/verify' },
        { id: 'inventory', label: 'Inventory', path: '/inventory' },
        { id: 'inventory_edit', label: 'Inventory — Edit Bills/Items', path: '/inventory' },
        { id: 'inventory_delete', label: 'Inventory — Delete Bills/Items', path: '/inventory' },
        { id: 'settings', label: 'Settings', path: '/settings' },
        { id: 'user_management', label: 'User Management', path: '/users' },
    ];

    useEffect(() => {
        fetchUsers();
        fetchCampuses();
        fetchColleges();
        fetchCourses();
    }, []);

    const fetchCampuses = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/campuses`);
            const data = await response.json();
            if (response.ok) setCampuses(data);
        } catch (error) {
            console.error('Error fetching campuses:', error);
        }
    };

    const fetchColleges = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/students/colleges`);
            const data = await response.json();
            if (response.ok) setColleges(data);
        } catch (error) {
            console.error('Error fetching colleges:', error);
        }
    };

    const fetchCourses = async () => {
        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/students/courses`);
            const data = await response.json();
            if (response.ok) setCourses(data);
        } catch (error) {
            console.error('Error fetching courses:', error);
        }
    };

    const fetchUsers = async () => {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;
        if (!token) return;

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) {
                setUsers(data);
            }
        } catch (error) {
            console.error('Error fetching users:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleEmployeeSearch = async (query) => {
        setEmployeeSearchQuery(query);
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
                headers: { 'Authorization': `Bearer ${token}` }
            });
            const data = await response.json();
            if (response.ok) setSearchResults(data);
        } catch (error) {
            console.error('Error searching employees:', error);
        } finally {
            setIsSearching(false);
        }
    };

    const handleSelectEmployee = (employee) => {
        setSelectedEmployee(employee);
        setEditRole('office_staff');
        setEditEmail(employee.email || employee.official_email || employee.personal_email || '');
        setEditMobile(employee.phone || employee.phone_number || employee.mobile || employee.alt_phone_number || '');
        setEditIsActive(true);
        setPermissions(DEFAULT_ROLE_PERMISSIONS.office_staff);
        setSelectedCampuses([]);
        setSelectedColleges([]);
        setSelectedCourses([]);
        setSearchResults([]);
        setEmployeeSearchQuery('');
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

            if (response.ok) {
                setIsSuperAdminModalOpen(false);
                fetchUsers();
            } else {
                const data = await response.json();
                setSuperAdminError(data.message || 'Failed to update superadmin');
            }
        } catch (error) {
            console.error('Error updating superadmin:', error);
            setSuperAdminError('Error updating superadmin details');
        } finally {
            setSuperAdminSaving(false);
        }
    };

    const handleRoleDropdownChange = (newRole) => {
        setEditRole(newRole);
        const customRoleObj = rolesList.find(r => r.id === newRole);
        if (customRoleObj && customRoleObj.permissions && customRoleObj.permissions.length > 0) {
            setPermissions(customRoleObj.permissions);
        } else if (DEFAULT_ROLE_PERMISSIONS[newRole]) {
            setPermissions(DEFAULT_ROLE_PERMISSIONS[newRole]);
        } else {
            setPermissions(DEFAULT_ROLE_PERMISSIONS.office_staff);
        }
    };

    const handleManageRole = (user) => {
        if (user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) {
            handleEditSuperAdmin(user);
            return;
        }

        setSelectedUser(user);
        setSelectedEmployee(null);
        const currentRole = user.roles && user.roles.length > 0 ? user.roles[0] : 'office_staff';
        setEditRole(currentRole);
        setEditEmail(user.email || user.official_email || user.personal_email || '');
        setEditMobile(user.phone || user.phone_number || user.mobile || user.alt_phone_number || '');
        setEditIsActive(user.is_active !== false);

        // Preselect permissions: if user already has custom saved permissions, use them;
        // else check custom roles defined in rolesList, else fall back to DEFAULT_ROLE_PERMISSIONS for that role
        const customRoleObj = rolesList.find(r => r.id === currentRole);
        let initialPerms = [];
        if (user.permissions && user.permissions.length > 0) {
            initialPerms = user.permissions;
        } else if (customRoleObj && customRoleObj.permissions && customRoleObj.permissions.length > 0) {
            initialPerms = customRoleObj.permissions;
        } else {
            initialPerms = DEFAULT_ROLE_PERMISSIONS[currentRole] || DEFAULT_ROLE_PERMISSIONS.office_staff;
        }
        setPermissions(initialPerms);

        // Preselect campus: if user has campuses use them, else default to Green Campus if available
        let initialCampuses = user.campuses || [];
        if ((!initialCampuses || initialCampuses.length === 0) && campuses.length > 1) {
            initialCampuses = [getCampusId(campuses[1])]; // Green Campus
        }
        setSelectedCampuses(initialCampuses);

        setSelectedColleges(user.colleges || []);
        setSelectedCourses(user.courses || []);
        setIsManageModalOpen(true);
    };

    const handleDeleteUser = async (user) => {
        if (user.is_superadmin || (user.roles && user.roles.includes('superadmin'))) {
            alert("Super Admin cannot be deleted.");
            return;
        }

        if (!window.confirm(`Are you sure you want to remove ${user.employee_name || user.name}? This will revoke their access.`)) {
            return;
        }

        const adminInfo = JSON.parse(localStorage.getItem('adminInfo'));
        const token = adminInfo?.token;
        if (!token) return;

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/${user._id}/role`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });

            if (response.ok) {
                fetchUsers();
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

        try {
            const response = await apiFetch(`${import.meta.env.VITE_API_URL}/users/${targetId}/role`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({
                    roles: [editRole],
                    permissions,
                    campuses: selectedCampuses,
                    colleges: selectedColleges,
                    courses: selectedCourses,
                    email: editEmail,
                    phone: editMobile
                }),
            });

            if (response.ok) {
                setIsManageModalOpen(false);
                setIsAddAdminModalOpen(false);
                setSelectedUser(null);
                setSelectedEmployee(null);
                fetchUsers();
            } else {
                alert('Failed to update user details');
            }
        } catch (error) {
            console.error('Error updating user role:', error);
            alert('Error updating user role');
        }
    };

    const openAddAdminModal = () => {
        setSelectedUser(null);
        setSelectedEmployee(null);
        setEditRole('office_staff');
        setEditEmail('');
        setEditMobile('');
        setPermissions(DEFAULT_ROLE_PERMISSIONS.office_staff || []);
        setSelectedCampuses([]);
        setSelectedColleges([]);
        setSelectedCourses([]);
        setEmployeeSearchQuery('');
        setSearchResults([]);
        setIsAddAdminModalOpen(true);
    };

    const [editingRole, setEditingRole] = useState(null);

    const openCreateRoleModal = () => {
        setEditingRole(null);
        setNewRoleName('');
        setNewRoleDesc('');
        setNewRolePermissions([]);
        setIsCreateRoleModalOpen(true);
    };

    const handleEditRoleClick = (role) => {
        setEditingRole(role);
        setNewRoleName(role.name);
        setNewRoleDesc(role.description || '');
        const currentPerms = role.permissions && role.permissions.length > 0
            ? role.permissions
            : (DEFAULT_ROLE_PERMISSIONS[role.id] || []);
        setNewRolePermissions(currentPerms);
        setIsCreateRoleModalOpen(true);
    };

    const handleSaveRole = (e) => {
        if (e) e.preventDefault();
        if (!newRoleName.trim()) {
            alert('Please enter a role name');
            return;
        }

        if (editingRole) {
            setRolesList(rolesList.map(r => {
                if (r.id === editingRole.id) {
                    return {
                        ...r,
                        name: newRoleName,
                        description: newRoleDesc,
                        permissions: newRolePermissions
                    };
                }
                return r;
            }));
        } else {
            const roleId = newRoleName.toLowerCase().replace(/\s+/g, '_');
            const newRoleObj = {
                id: roleId,
                name: newRoleName,
                description: newRoleDesc || 'Custom defined role',
                userCount: 0,
                permissions: newRolePermissions
            };
            setRolesList([...rolesList, newRoleObj]);
        }

        setEditingRole(null);
        setNewRoleName('');
        setNewRoleDesc('');
        setNewRolePermissions([]);
        setIsCreateRoleModalOpen(false);
    };

    const togglePermission = (permId) => {
        let nextPerms = [...permissions];
        if (nextPerms.includes(permId)) {
            nextPerms = nextPerms.filter(p => p !== permId);

            if (permId === 'fee_collection') {
                const feeChildren = ['enable_fee_collection', 'enable_fee_concession', 'enable_edit_transaction', 'enable_delete_transaction'];
                nextPerms = nextPerms.filter(p => !feeChildren.includes(p));
            }
            if (permId === 'reports_analytics') {
                const reportChildren = ['daily_collection', 'cashier_summary'];
                nextPerms = nextPerms.filter(p => !reportChildren.includes(p));
            }
        } else {
            nextPerms.push(permId);

            if (permId === 'fee_collection' && !nextPerms.includes('enable_fee_collection')) {
                nextPerms.push('enable_fee_collection');
            }

            const feeChildren = ['enable_fee_collection', 'enable_fee_concession', 'enable_edit_transaction', 'enable_delete_transaction'];
            if (feeChildren.includes(permId) && !nextPerms.includes('fee_collection')) {
                nextPerms.push('fee_collection');
            }

            if (permId === 'reports_analytics') {
                if (!nextPerms.includes('daily_collection')) nextPerms.push('daily_collection');
                if (!nextPerms.includes('cashier_summary')) nextPerms.push('cashier_summary');
            }

            const reportChildren = ['daily_collection', 'cashier_summary'];
            if (reportChildren.includes(permId) && !nextPerms.includes('reports_analytics')) {
                nextPerms.push('reports_analytics');
            }
        }
        setPermissions(nextPerms);
    };

    const toggleNewRolePermission = (permId) => {
        if (newRolePermissions.includes(permId)) {
            setNewRolePermissions(newRolePermissions.filter(p => p !== permId));
        } else {
            setNewRolePermissions([...newRolePermissions, permId]);
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
    };

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

    // Filtering logic for users list
    const filteredUsers = users.filter(user => {
        // Search filter
        const name = (user.employee_name || user.name || '').toLowerCase();
        const username = (user.username || user.emp_no || '').toLowerCase();
        const q = searchQuery.toLowerCase().trim();
        if (q && !name.includes(q) && !username.includes(q)) return false;

        // Status filter
        if (filterStatus === 'active' && user.is_active === false) return false;
        if (filterStatus === 'inactive' && user.is_active !== false) return false;

        // Role filter
        if (filterRole !== 'all') {
            const userRoles = user.roles || [];
            if (!userRoles.includes(filterRole)) return false;
        }

        // Campus filter
        if (filterCampus !== 'all') {
            if (user.campuses && user.campuses.length > 0) {
                if (!userHasCampus(user.campuses, filterCampus)) return false;
            }
        }

        // College filter
        if (filterCollege !== 'all') {
            if (user.colleges && user.colleges.length > 0) {
                if (!user.colleges.includes(filterCollege)) return false;
            }
        }

        return true;
    });

    const getCampusScopeText = (userCampuses) => {
        if (!userCampuses || userCampuses.length === 0) return 'GC';
        return userCampuses.map(cId => {
            const c = campuses.find(cam => campusIdsMatch(getCampusId(cam), cId));
            return c ? c.code : 'GC';
        }).join(', ');
    };

    const getCollegeScopeText = (userColleges) => {
        if (!userColleges || userColleges.length === 0) return 'Pydah College of Engineering';
        return userColleges.slice(0, 2).join(', ') + (userColleges.length > 2 ? ` (+${userColleges.length - 2} more)` : '');
    };

    const getCourseScopeText = (userCourses) => {
        if (!userCourses || userCourses.length === 0) return 'B.Tech, Diploma, M.Tech, MBA, MCA';
        return userCourses.join(', ');
    };

    return (
        <Layout>
            {/* Top Header & Page Navigation */}
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-5 gap-3.5">
                <div className="hidden md:block">
                    <h1 className="text-xl font-bold text-slate-900 tracking-tight">User Management</h1>
                    <p className="text-slate-500 text-xs mt-0.5">Create and manage access for system users.</p>
                </div>
                
                {/* Search & Tabs Segmented Switch */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full md:w-auto">
                    <div className="relative flex-1 md:w-72">
                        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                            type="text"
                            placeholder="Search users (name, username)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full pl-9 pr-3.5 py-2 sm:py-1.5 bg-white border border-slate-200 rounded-xl sm:rounded-full text-xs text-slate-700 shadow-2xs focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder:text-slate-400"
                        />
                    </div>
                    
                    <div className="grid grid-cols-2 bg-slate-100 p-1 rounded-xl sm:rounded-full border border-slate-200 shadow-inner shrink-0 w-full sm:w-auto">
                        <button
                            type="button"
                            onClick={() => setActiveTab('users')}
                            className={`py-1.5 sm:py-1 px-5 rounded-lg sm:rounded-full text-xs font-bold transition-all text-center cursor-pointer ${
                                activeTab === 'users'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Users
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('roles')}
                            className={`py-1.5 sm:py-1 px-5 rounded-lg sm:rounded-full text-xs font-bold transition-all text-center cursor-pointer ${
                                activeTab === 'roles'
                                    ? 'bg-blue-600 text-white shadow-xs'
                                    : 'text-slate-600 hover:text-slate-900'
                            }`}
                        >
                            Roles
                        </button>
                    </div>
                </div>
            </div>

            {/* TAB CONTENT: USERS */}
            {activeTab === 'users' && (
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-3.5 sm:p-4">
                    {/* Header Bar inside card: Existing Users + Filters + Create New User */}
                    <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-3 pb-3.5 mb-4 border-b border-slate-100">
                        <div className="flex items-center justify-between w-full lg:w-auto">
                            <h3 className="text-base font-bold text-slate-800 tracking-tight">Existing Users</h3>
                            <span className="lg:hidden text-[11px] font-bold text-slate-400">
                                {filteredUsers.length} total
                            </span>
                        </div>
                        
                        <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 w-full lg:w-auto">
                            <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 w-full sm:w-auto">
                                <select
                                    value={filterStatus}
                                    onChange={(e) => setFilterStatus(e.target.value)}
                                    className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                >
                                    <option value="all">All Status</option>
                                    <option value="active">Active</option>
                                    <option value="inactive">Inactive</option>
                                </select>

                                <select
                                    value={filterCampus}
                                    onChange={(e) => setFilterCampus(e.target.value)}
                                    className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 truncate"
                                >
                                    <option value="all">All Campuses</option>
                                    {campuses.map(c => (
                                        <option key={getCampusId(c)} value={getCampusId(c)}>{c.name}</option>
                                    ))}
                                </select>

                                <select
                                    value={filterCollege}
                                    onChange={(e) => setFilterCollege(e.target.value)}
                                    className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 truncate"
                                >
                                    <option value="all">All Colleges</option>
                                    {colleges.map(col => (
                                        <option key={col.id || col.name} value={col.name}>{col.name}</option>
                                    ))}
                                </select>

                                <select
                                    value={filterRole}
                                    onChange={(e) => setFilterRole(e.target.value)}
                                    className="w-full sm:w-auto px-2.5 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 truncate"
                                >
                                    <option value="all">All Roles</option>
                                    {ROLE_OPTIONS.map(r => (
                                        <option key={r.id} value={r.id}>{r.label || r.id}</option>
                                    ))}
                                </select>
                            </div>

                            <button
                                type="button"
                                onClick={openAddAdminModal}
                                className="w-full sm:w-auto sm:ml-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 sm:py-1.5 rounded-lg text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                            >
                                <UserPlus size={14} />
                                <span>Create New User</span>
                            </button>
                        </div>
                    </div>

                    {/* Mobile Cards View (< md screens) */}
                    <div className="md:hidden space-y-3">
                        {loading ? (
                            <div className="p-8 text-center text-slate-400 font-semibold text-xs animate-pulse">
                                Loading system users...
                            </div>
                        ) : filteredUsers.length === 0 ? (
                            <div className="p-8 text-center text-slate-400 font-semibold text-xs bg-slate-50 rounded-xl border border-slate-200">
                                No matching users found.
                            </div>
                        ) : (
                            filteredUsers.map((user) => {
                                const displayRoleKey = user.roles && user.roles[0] ? user.roles[0] : 'office_staff';
                                const roleOption = ROLE_OPTIONS.find(r => r.id === displayRoleKey);
                                const displayRole = roleOption ? roleOption.label : displayRoleKey;
                                const userName = user.employee_name || user.name || 'User';
                                const initial = (userName.charAt(0) || 'U').toUpperCase();

                                return (
                                    <div
                                        key={user._id}
                                        className="bg-white rounded-xl border border-slate-200 shadow-2xs p-3.5 space-y-3 transition-all"
                                    >
                                        {/* User Header */}
                                        <div className="flex items-start justify-between gap-2.5">
                                            <div className="flex items-start gap-2.5 min-w-0">
                                                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm shrink-0">
                                                    {initial}
                                                </div>
                                                <div className="min-w-0">
                                                    <h4 className="font-bold text-slate-900 text-xs sm:text-sm tracking-tight truncate leading-tight">
                                                        {userName}
                                                    </h4>
                                                    <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                                                        <span className="text-[10px] font-mono text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                                                            ID: {user.emp_no || user.username || '—'}
                                                        </span>
                                                        <span className="inline-block px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200/80 font-bold text-[10px]">
                                                            {displayRole}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Active / Inactive Badge */}
                                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${
                                                user.is_active !== false
                                                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                                    : 'bg-rose-50 text-rose-700 border border-rose-200'
                                            }`}>
                                                <span className={`w-1.5 h-1.5 rounded-full ${user.is_active !== false ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                                                {user.is_active !== false ? 'Active' : 'Inactive'}
                                            </span>
                                        </div>

                                        {/* Contact Row (Email & Mobile) */}
                                        {(user.email || user.phone || user.mobile) && (
                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 text-[11px] text-slate-600 bg-slate-50/70 p-2.5 rounded-lg border border-slate-100">
                                                {user.email && (
                                                    <div className="flex items-center gap-1.5 truncate">
                                                        <Mail size={12} className="text-slate-400 shrink-0" />
                                                        <span className="truncate">{user.email}</span>
                                                    </div>
                                                )}
                                                {(user.phone || user.mobile) && (
                                                    <div className="flex items-center gap-1.5">
                                                        <Phone size={12} className="text-slate-400 shrink-0" />
                                                        <span>{user.phone || user.mobile}</span>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* College & Campus Scope */}
                                        <div className="text-[11px] bg-slate-50/80 rounded-lg p-2.5 border border-slate-100 space-y-1">
                                            <div className="flex items-center gap-1.5 text-indigo-900 font-bold">
                                                <Building2 size={12} className="text-indigo-600 shrink-0" />
                                                <span>Campuses: {getCampusScopeText(user.campuses)}</span>
                                            </div>
                                            <div className="text-xs font-semibold text-slate-800 pl-4">
                                                {getCollegeScopeText(user.colleges)}
                                            </div>
                                            <div className="text-[10px] text-slate-500 pl-4">
                                                Courses: {getCourseScopeText(user.courses)}
                                            </div>
                                        </div>

                                        {/* Action Buttons Bar */}
                                        <div className="grid grid-cols-3 gap-2 pt-1 border-t border-slate-100 text-xs font-bold">
                                            <button
                                                type="button"
                                                onClick={() => handleManageRole(user)}
                                                className="py-1.5 px-2 bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200/80 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            >
                                                <Edit3 size={13} />
                                                <span>Perms</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleManageRole(user)}
                                                className="py-1.5 px-2 bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200/80 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            >
                                                <UserPlus size={13} />
                                                <span>Role</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleDeleteUser(user)}
                                                className="py-1.5 px-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200/80 rounded-lg flex items-center justify-center gap-1 transition-colors cursor-pointer"
                                            >
                                                <Trash2 size={13} />
                                                <span>Delete</span>
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Desktop Table View (>= md screens) */}
                    <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                                    <th className="py-2.5 px-3">Name</th>
                                    <th className="py-2.5 px-3">Username</th>
                                    <th className="py-2.5 px-3">Role</th>
                                    <th className="py-2.5 px-3">Email</th>
                                    <th className="py-2.5 px-3">Mobile</th>
                                    <th className="py-2.5 px-3">Status</th>
                                    <th className="py-2.5 px-3">College Scope</th>
                                    <th className="py-2.5 px-3 text-right">Action</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 text-xs">
                                {loading ? (
                                    <tr>
                                        <td colSpan="8" className="p-8 text-center text-slate-400 font-semibold animate-pulse">
                                            Loading system users...
                                        </td>
                                    </tr>
                                ) : filteredUsers.length === 0 ? (
                                    <tr>
                                        <td colSpan="8" className="p-8 text-center text-slate-400 font-semibold">
                                            No matching users found.
                                        </td>
                                    </tr>
                                ) : (
                                    filteredUsers.map((user) => {
                                        const displayRoleKey = user.roles && user.roles[0] ? user.roles[0] : 'office_staff';
                                        const roleOption = ROLE_OPTIONS.find(r => r.id === displayRoleKey);
                                        const displayRole = roleOption ? roleOption.label : displayRoleKey;

                                        return (
                                            <tr key={user._id} className="hover:bg-slate-50/70 transition-colors">
                                                {/* Name */}
                                                <td className="py-3 px-3">
                                                    <span className="font-bold text-blue-600 text-xs uppercase tracking-tight block">
                                                        {user.employee_name || user.name || 'User'}
                                                    </span>
                                                </td>

                                                {/* Username */}
                                                <td className="py-3 px-3 text-slate-500 font-medium">
                                                    {user.emp_no || user.username || '—'}
                                                </td>

                                                {/* Role */}
                                                <td className="py-3 px-3">
                                                    <span className="inline-block px-2.5 py-0.5 rounded-full bg-slate-100 text-slate-700 border border-slate-200 font-semibold text-[11px]">
                                                        {displayRole}
                                                    </span>
                                                </td>

                                                {/* Email */}
                                                <td className="py-3 px-3 text-slate-500">
                                                    {user.email || '—'}
                                                </td>

                                                {/* Mobile */}
                                                <td className="py-3 px-3 text-slate-500">
                                                    {user.phone || user.mobile || '—'}
                                                </td>

                                                {/* Status */}
                                                <td className="py-3 px-3">
                                                    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
                                                        user.is_active !== false
                                                            ? 'bg-emerald-100 text-emerald-800'
                                                            : 'bg-rose-100 text-rose-800'
                                                    }`}>
                                                        <span className={`w-1.5 h-1.5 rounded-full ${user.is_active !== false ? 'bg-emerald-600' : 'bg-rose-600'}`}></span>
                                                        {user.is_active !== false ? 'Active' : 'Inactive'}
                                                    </span>
                                                </td>

                                                {/* College Scope */}
                                                <td className="py-3 px-3">
                                                    <div className="space-y-0.5">
                                                        <div className="text-[11px] font-bold text-indigo-900">
                                                            Campuses: {getCampusScopeText(user.campuses)}
                                                        </div>
                                                        <div className="text-xs font-bold text-slate-800">
                                                            {getCollegeScopeText(user.colleges)}
                                                        </div>
                                                        <div className="text-[10px] text-slate-400 font-medium">
                                                            Courses: {getCourseScopeText(user.courses)}
                                                        </div>
                                                    </div>
                                                </td>

                                                {/* Action Icons */}
                                                <td className="py-3 px-3 text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <button
                                                            onClick={() => handleManageRole(user)}
                                                            title="Edit Permissions"
                                                            className="p-1.5 text-blue-600 bg-blue-50 border border-blue-200/80 rounded-md hover:bg-blue-100 transition-colors cursor-pointer"
                                                        >
                                                            <Edit3 size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleManageRole(user)}
                                                            title="Assign Role"
                                                            className="p-1.5 text-orange-600 bg-orange-50 border border-orange-200/80 rounded-md hover:bg-orange-100 transition-colors cursor-pointer"
                                                        >
                                                            <UserPlus size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(user)}
                                                            title="Delete User"
                                                            className="p-1.5 text-rose-600 bg-rose-50 border border-rose-200/80 rounded-md hover:bg-rose-100 transition-colors cursor-pointer"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </td>
                                            </tr>
                                        );
                                    })
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* TAB CONTENT: ROLES */}
            {activeTab === 'roles' && (
                <div className="bg-white rounded-xl shadow-xs border border-slate-200 p-4 sm:p-5">
                    <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 pb-3.5 mb-4 sm:mb-5 border-b border-slate-100">
                        <div>
                            <h3 className="text-base font-bold text-slate-800 tracking-tight">System Access Roles</h3>
                            <p className="text-xs text-slate-500 mt-0.5">Configure role permissions and access definitions across system modules.</p>
                        </div>
                        <button
                            type="button"
                            onClick={openCreateRoleModal}
                            className="w-full sm:w-auto bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-xs font-bold shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                            <Plus size={14} />
                            <span>Create New Role</span>
                        </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 sm:gap-4">
                        {rolesList.map(role => (
                            <div key={role.id} className="border border-slate-200 rounded-xl p-3.5 sm:p-4 hover:shadow-sm transition-all bg-slate-50/40 flex flex-col justify-between">
                                <div>
                                    <div className="flex justify-between items-start mb-2 gap-2">
                                        <h4 className="font-bold text-slate-900 text-sm">{role.name}</h4>
                                        <span className="px-2 py-0.5 bg-blue-50 text-blue-700 font-bold text-[10px] rounded-full border border-blue-200 shrink-0">
                                            {role.id}
                                        </span>
                                    </div>
                                    <p className="text-xs text-slate-500 mb-4">{role.description}</p>
                                </div>
                                <div className="pt-3 border-t border-slate-200/60 flex justify-between items-center text-xs">
                                    <span className="text-slate-400 font-medium">
                                        {users.filter(u => u.roles && u.roles.includes(role.id)).length} active users
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => handleEditRoleClick(role)}
                                        className="text-blue-600 hover:text-blue-800 font-bold text-xs cursor-pointer"
                                    >
                                        Edit Role
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* CREATE / EDIT ROLE MODAL */}
            <Modal isOpen={isCreateRoleModalOpen} onClose={() => setIsCreateRoleModalOpen(false)} title={editingRole ? `Edit Role: ${editingRole.name}` : "Create New Role"} maxWidth="max-w-4xl">
                <form onSubmit={handleSaveRole} className="space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Left Side: Role Name & Description */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                    ROLE NAME
                                </label>
                                <input
                                    type="text"
                                    required
                                    placeholder="e.g. support_staff"
                                    value={newRoleName}
                                    onChange={(e) => setNewRoleName(e.target.value)}
                                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                    DESCRIPTION
                                </label>
                                <textarea
                                    rows="6"
                                    placeholder="Describe what users with this role can do..."
                                    value={newRoleDesc}
                                    onChange={(e) => setNewRoleDesc(e.target.value)}
                                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all resize-none"
                                ></textarea>
                            </div>
                        </div>

                        {/* Right Side: Page and Feature Permissions */}
                        <div>
                            <label className="block text-xs font-bold text-slate-700 mb-2 pb-1 border-b border-slate-200">
                                Page and Feature Permissions
                            </label>
                            <div className="border border-slate-200 rounded-lg p-2.5 max-h-72 overflow-y-auto space-y-1 bg-slate-50/40 custom-scrollbar">
                                {ROLE_PERMISSIONS_LIST.map(perm => {
                                    const isChecked = newRolePermissions.includes(perm.id);
                                    return (
                                        <label key={perm.id} className="flex items-center space-x-3 p-2 bg-white rounded-lg border border-slate-100 cursor-pointer hover:bg-blue-50/30 transition-colors">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={() => toggleNewRolePermission(perm.id)}
                                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                            />
                                            <span className="text-xs font-semibold text-slate-800">
                                                {perm.label} <span className="text-slate-400 font-mono text-[11px]">({perm.path})</span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    </div>

                    {/* Bottom Modal Actions */}
                    <div className="pt-4 flex flex-col-reverse sm:flex-row justify-between gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsCreateRoleModalOpen(false)}
                            className="w-full sm:w-auto px-6 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg transition-all text-center"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="w-full sm:w-auto px-8 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs rounded-lg shadow-sm transition-all text-center"
                        >
                            {editingRole ? 'Save Changes' : 'Create Role'}
                        </button>
                    </div>
                </form>
            </Modal>

            {/* EDIT USER / MANAGE PERMISSIONS MODAL */}
            <Modal isOpen={isManageModalOpen} onClose={() => setIsManageModalOpen(false)} title={`Edit Permissions: ${selectedUser?.employee_name || selectedUser?.name || 'User'}`} maxWidth="max-w-5xl">
                <div className="space-y-4">
                    {/* Yellow Banner Note at Top */}
                    <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs font-medium flex items-center gap-2">
                        <span className="font-bold text-amber-950">Note:</span> user will login using their Employee DB password.
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* LEFT COLUMN (Role, Email, Mobile, Campus Cards) */}
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                    ROLE
                                </label>
                                <select
                                    value={editRole}
                                    onChange={(e) => handleRoleDropdownChange(e.target.value)}
                                    className="w-full px-3.5 py-2 text-xs font-semibold text-slate-800 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none bg-white"
                                >
                                    {ROLE_OPTIONS.map(r => (
                                        <option key={r.id} value={r.id}>{r.label}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                    EMAIL ADDRESS
                                </label>
                                <input
                                    type="email"
                                    value={editEmail}
                                    onChange={(e) => setEditEmail(e.target.value)}
                                    placeholder="e.g. employee@pydah.edu.in"
                                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                    MOBILE NUMBER
                                </label>
                                <input
                                    type="text"
                                    value={editMobile}
                                    onChange={(e) => setEditMobile(e.target.value)}
                                    placeholder="e.g. 9876543210"
                                    className="w-full px-3.5 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                            </div>

                            {/* Active Account checkbox */}
                            <div className="p-3 border border-slate-200 rounded-lg bg-white">
                                <label className="flex items-center space-x-2.5 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={editIsActive}
                                        onChange={(e) => setEditIsActive(e.target.checked)}
                                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                    />
                                    <span className="text-xs font-bold text-slate-800 uppercase tracking-wider">ACTIVE ACCOUNT</span>
                                </label>
                            </div>

                            {/* Campus Selection Cards */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                                    CAMPUS SELECTION
                                </label>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                                    {campuses.map(campus => {
                                        const cId = getCampusId(campus);
                                        const isChecked = userHasCampus(selectedCampuses, cId);
                                        return (
                                            <div
                                                key={cId}
                                                onClick={() => {
                                                    if (isChecked) {
                                                        setSelectedCampuses(selectedCampuses.filter(id => !campusIdsMatch(id, cId)));
                                                    } else {
                                                        setSelectedCampuses([...selectedCampuses, cId]);
                                                    }
                                                }}
                                                className={`p-3 rounded-xl border cursor-pointer transition-all ${
                                                    isChecked
                                                        ? 'border-blue-600 bg-blue-50/40 ring-1 ring-blue-500/20'
                                                        : 'border-slate-200 bg-white hover:bg-slate-50'
                                                }`}
                                            >
                                                <div className="flex items-center space-x-2">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => {}}
                                                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500 pointer-events-none"
                                                    />
                                                    <span className="font-bold text-xs text-slate-900">{campus.name}</span>
                                                </div>
                                                <div className="mt-1 pl-6 text-[10px] text-blue-600 font-bold">{campus.code || 'GC'}</div>
                                                <div className="pl-6 text-[10px] text-slate-400 font-medium">
                                                    {campus.colleges ? `${campus.colleges.length} colleges` : 'Multiple colleges'}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium italic">
                                    Select campus(es) first, then choose colleges within them.
                                </p>
                            </div>
                        </div>

                        {/* RIGHT COLUMN (COLLEGE & COURSE SCOPE + PERMISSIONS Checklist) */}
                        <div className="space-y-4">
                            {/* COLLEGE & COURSE SCOPE */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                                    COLLEGE & COURSE SCOPE
                                </label>
                                <div className="border border-slate-300 rounded-xl p-3 bg-white max-h-56 overflow-y-auto custom-scrollbar space-y-2">
                                    {displayedColleges.length === 0 ? (
                                        <p className="text-xs text-slate-400 italic p-2">No colleges available.</p>
                                    ) : (
                                        displayedColleges.map((college, idx) => {
                                            const isCollegeChecked = selectedColleges.includes(college.name);
                                            const collegeCourses = courses.filter(c => c.college_id === college.id || c.college === college.name);
                                            const availableCourses = collegeCourses.length > 0
                                                ? collegeCourses.map(c => c.name)
                                                : ['B.Tech', 'Diploma', 'M.Tech', 'MBA', 'MCA'];

                                            return (
                                                <React.Fragment key={college.id || college.name}>
                                                    {idx > 0 && <hr className="border-slate-200 my-2" />}
                                                    <div className="space-y-2">
                                                        <label className="flex items-center space-x-2.5 cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={isCollegeChecked}
                                                                onChange={(e) => handleCollegeChange(college.name, e.target.checked)}
                                                                className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                                            />
                                                            <span className="font-bold text-xs text-slate-900">{college.name}</span>
                                                        </label>

                                                        {/* Nested Courses Box when College is checked */}
                                                        {isCollegeChecked && (
                                                            <div className="ml-6 p-3 bg-slate-50/70 border border-slate-200 rounded-lg space-y-2">
                                                                <div className="flex justify-between items-center text-[11px]">
                                                                    <span className="font-semibold text-slate-500">Courses:</span>
                                                                    <div className="flex gap-2 font-bold">
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                const otherCourses = selectedCourses.filter(cName => !availableCourses.includes(cName));
                                                                                setSelectedCourses([...otherCourses, ...availableCourses]);
                                                                            }}
                                                                            className="text-blue-600 hover:text-blue-800"
                                                                        >
                                                                            Select All
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={() => {
                                                                                setSelectedCourses(selectedCourses.filter(cName => !availableCourses.includes(cName)));
                                                                            }}
                                                                            className="text-rose-600 hover:text-rose-800"
                                                                        >
                                                                            Clear
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <hr className="border-slate-200" />
                                                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 pt-1">
                                                                    {availableCourses.map(courseName => {
                                                                        const isCourseChecked = selectedCourses.includes(courseName);
                                                                        return (
                                                                            <label key={courseName} className="flex items-center space-x-2 cursor-pointer text-xs">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={isCourseChecked}
                                                                                    onChange={(e) => {
                                                                                        if (e.target.checked) {
                                                                                            setSelectedCourses([...selectedCourses, courseName]);
                                                                                        } else {
                                                                                            setSelectedCourses(selectedCourses.filter(c => c !== courseName));
                                                                                        }
                                                                                    }}
                                                                                    className="w-3.5 h-3.5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                                                                />
                                                                                <span className="font-medium text-slate-800">{courseName}</span>
                                                                            </label>
                                                                        );
                                                                    })}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </React.Fragment>
                                            );
                                        })
                                    )}
                                </div>
                                <p className="text-[10px] text-slate-400 mt-1 font-medium italic">
                                    Leave empty (no colleges selected) to allow access to all colleges (e.g. Super Admin).
                                </p>
                            </div>

                            {/* PERMISSIONS Checklist */}
                            <div>
                                <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-2">
                                    PERMISSIONS
                                </label>

                                <div className="border border-slate-300 rounded-xl p-3.5 sm:p-4 bg-white max-h-[380px] overflow-y-auto custom-scrollbar space-y-3">
                                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                                        {ROLE_PERMISSIONS_LIST.map((perm) => {
                                            const isChecked = permissions.includes(perm.id);
                                            return (
                                                <label key={perm.id} className="flex items-center space-x-2 text-xs font-semibold text-slate-800 cursor-pointer">
                                                    <input
                                                        type="checkbox"
                                                        checked={isChecked}
                                                        onChange={() => togglePermission(perm.id)}
                                                        className="w-4 h-4 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                                    />
                                                    <span>{perm.label}</span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Bottom Modal Actions */}
                    <div className="pt-4 flex flex-col-reverse sm:flex-row justify-between gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsManageModalOpen(false)}
                            className="w-full sm:w-auto px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold text-xs rounded-lg transition-all text-center"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={saveRole}
                            className="w-full sm:w-auto px-8 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-lg shadow-md transition-all text-center"
                        >
                            Update User
                        </button>
                    </div>
                </div>
            </Modal>

            {/* ADD ADMIN / CREATE USER MODAL */}
            <Modal isOpen={isAddAdminModalOpen} onClose={() => setIsAddAdminModalOpen(false)} title="Create New User" maxWidth="max-w-4xl">
                <div className="space-y-4">
                    <div className="relative">
                        <label className="block text-xs font-bold text-slate-700 mb-1">Search Employee (HRMS)</label>
                        <div className="relative">
                            <input
                                type="text"
                                className="w-full pl-9 pr-4 py-2 border border-slate-300 rounded-lg text-xs focus:ring-2 focus:ring-blue-500 outline-none"
                                placeholder="Search by employee name or ID..."
                                value={employeeSearchQuery}
                                onChange={(e) => handleEmployeeSearch(e.target.value)}
                            />
                            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                        </div>

                        {searchResults.length > 0 && (
                            <div className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-48 overflow-y-auto divide-y divide-slate-100">
                                {searchResults.map(emp => (
                                    <div
                                        key={emp.emp_no}
                                        onClick={() => handleSelectEmployee(emp)}
                                        className="p-2.5 hover:bg-blue-50 cursor-pointer transition-colors"
                                    >
                                        <div className="font-bold text-xs text-slate-900">{emp.employee_name}</div>
                                        <div className="text-[10px] text-slate-500">ID: {emp.emp_no}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {selectedEmployee && (
                        <div className="p-3 bg-blue-50/60 border border-blue-200 rounded-lg flex justify-between items-center text-xs">
                            <div>
                                <span className="font-bold text-blue-900">{selectedEmployee.employee_name}</span>
                                <span className="text-slate-500 ml-2">(ID: {selectedEmployee.emp_no})</span>
                            </div>
                            <span className="text-emerald-700 font-bold text-[11px] bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                                Selected
                            </span>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                ROLE
                            </label>
                            <select
                                value={editRole}
                                onChange={(e) => setEditRole(e.target.value)}
                                className="w-full px-3 py-2 text-xs font-semibold text-slate-800 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                {ROLE_OPTIONS.map(r => (
                                    <option key={r.id} value={r.id}>{r.label}</option>
                                ))}
                            </select>
                        </div>

                        <div>
                            <label className="block text-[11px] font-bold text-slate-600 uppercase tracking-wider mb-1">
                                EMAIL ADDRESS
                            </label>
                            <input
                                type="email"
                                value={editEmail}
                                onChange={(e) => setEditEmail(e.target.value)}
                                placeholder="e.g. employee@pydah.edu.in"
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>

                    <div className="pt-4 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsAddAdminModalOpen(false)}
                            className="w-full sm:w-auto px-5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-lg text-center"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={saveRole}
                            disabled={!selectedEmployee}
                            className={`w-full sm:w-auto px-6 py-2 text-white font-bold text-xs rounded-lg shadow-sm transition-all text-center ${
                                !selectedEmployee ? 'bg-slate-300 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                            }`}
                        >
                            Create User Access
                        </button>
                    </div>
                </div>
            </Modal>

            {/* EDIT SUPERADMIN MODAL */}
            <Modal isOpen={isSuperAdminModalOpen} onClose={() => setIsSuperAdminModalOpen(false)} title="Edit Superadmin Details" maxWidth="max-w-xl">
                <form onSubmit={saveSuperAdmin} className="space-y-4">
                    {superAdminError && (
                        <div className="p-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg text-xs font-semibold">
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
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                                Username <span className="text-rose-500">*</span>
                            </label>
                            <input
                                type="text"
                                required
                                value={superAdminForm.username}
                                onChange={(e) => setSuperAdminForm({ ...superAdminForm, username: e.target.value })}
                                placeholder="e.g. superadmin"
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
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
                                className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
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
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                        />
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
                            className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 outline-none"
                        />
                    </div>

                    <div className="pt-4 flex flex-col-reverse sm:flex-row justify-end gap-2.5 border-t border-slate-100">
                        <button
                            type="button"
                            onClick={() => setIsSuperAdminModalOpen(false)}
                            className="w-full sm:w-auto px-4 py-2 text-slate-600 hover:text-slate-800 font-medium text-xs rounded-lg text-center"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={superAdminSaving}
                            className="w-full sm:w-auto px-6 py-2 bg-purple-700 hover:bg-purple-800 text-white font-bold text-xs shadow-sm transition-all disabled:opacity-50 text-center"
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
