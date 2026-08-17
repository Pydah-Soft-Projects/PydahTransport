import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard,
    Bus,
    Users,
    Map,
    ClipboardList,
    CreditCard,
    UserCog,
    LogOut,
    Menu,
    X,
    PlusCircle,
    Percent,
    Package,
    Settings,
    ChevronDown,
    ChevronLeft,
    ChevronRight,
    Truck,
    RefreshCw,
    Navigation
} from 'lucide-react';

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const [openGroups, setOpenGroups] = useState(() => ({
        inventory: location.pathname.startsWith('/inventory')
    }));

    const handleLogout = () => {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const isSSO = adminInfo.isSSO;

        localStorage.removeItem('adminInfo');

        if (isSSO) {
            window.location.href = import.meta.env.VITE_CRM_URL || 'http://localhost:5173';
        } else {
            navigate('/login');
        }
    };

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');

    const hasPermission = (requiredPerm) => {
        if (!requiredPerm) return true;
        if (adminInfo.role === 'admin') return true;
        if (adminInfo.permissions && adminInfo.permissions.includes(requiredPerm)) return true;
        return false;
    };

    const menuCategories = [
        {
            title: 'MAIN',
            items: [
                { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, permission: 'dashboard' }
            ]
        },
        {
            title: 'MANAGEMENT',
            items: [
                { path: '/buses', label: 'Vehicle Management', permission: 'bus_management', icon: <Bus size={20} /> },
                { path: '/routes', label: 'Route Management', permission: 'route_management', icon: <Map size={20} /> },
                { path: '/fleet', label: 'Fleet & Passengers', permission: 'fleet_passengers', icon: <Users size={20} /> },
                { path: '/gps-tracking', label: 'GPS Live Tracking', permission: 'gps_tracking', icon: <Navigation size={20} /> },
            ]
        },
        {
            title: 'OPERATIONS',
            items: [
                { path: '/raise-request', label: 'Raise New Request', permission: 'raise_request', icon: <PlusCircle size={20} /> },
                { path: '/transport-requests', label: 'Passenger Requests', permission: 'transport_requests', icon: <ClipboardList size={20} /> },
                { path: '/renewals', label: 'Renewals', permission: 'renewals', icon: <RefreshCw size={20} /> },
                { path: '/concessions', label: 'Concessions', permission: 'concessions', icon: <Percent size={20} /> },
            ]
        },
        {
            title: 'FINANCE',
            items: [
                { path: '/transport-dues', label: 'Transport Dues', permission: 'transport_dues', icon: <CreditCard size={20} /> },
            ]
        },
        {
            title: 'INVENTORY',
            items: [
                {
                    key: 'inventory',
                    label: 'Inventory',
                    icon: <Package size={20} />,
                    permission: 'inventory',
                    children: [
                        { path: '/inventory', label: 'Items & History', icon: <Package size={20} /> },
                        { path: '/inventory/raise-bill', label: 'Bills', icon: <Truck size={20} /> },
                    ]
                },
            ]
        },
        {
            title: 'ADMINISTRATION',
            items: [
                { path: '/users', label: 'User Management', permission: 'user_management', icon: <UserCog size={20} /> },
            ]
        }
    ];

    const filteredCategories = menuCategories.map((category) => ({
        ...category,
        items: category.items.filter((item) => hasPermission(item.permission))
    })).filter((category) => category.items.length > 0);

    const isPathActive = (path) => (
        location.pathname === path
        || (path !== '/inventory' && location.pathname.startsWith(`${path}/`))
    );

    const isGroupActive = (item) => {
        if (item.children) {
            return item.children.some((child) => isPathActive(child.path));
        }
        return isPathActive(item.path);
    };

    const getMenuItemClasses = (active) => {
        if (active) return 'bg-blue-100 text-blue-700 font-bold shadow-sm';
        return 'border-transparent text-slate-300 hover:bg-white/10 hover:text-white font-medium';
    };

    const getMenuIconClasses = (active) => {
        if (active) return 'text-blue-700';
        return 'text-slate-300 group-hover:text-white';
    };

    const toggleGroup = (key) => {
        setOpenGroups((prev) => ({ ...prev, [key]: !prev[key] }));
    };

    const renderNavItem = (item, { mobile = false, collapsed = false } = {}) => {
        if (item.children) {
            const groupActive = isGroupActive(item);
            const expanded = mobile || (!collapsed && (openGroups[item.key] || groupActive));

            return (
                <div key={item.key || item.label} className="space-y-1">
                    <button
                        type="button"
                        title={collapsed ? item.label : undefined}
                        onClick={() => {
                            if (collapsed) {
                                navigate(item.children[0].path);
                                return;
                            }
                            toggleGroup(item.key);
                        }}
                        className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-4'} py-1.5 rounded-xl transition-all duration-200 group relative overflow-hidden ${getMenuItemClasses(groupActive && collapsed)}`}
                    >
                        <span className={`${collapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${getMenuIconClasses(groupActive && collapsed)}`}>
                            {item.icon}
                        </span>
                        {!collapsed && (
                            <>
                                <span className="truncate text-[11px] flex-1 text-left">{item.label}</span>
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform ${expanded ? 'rotate-180' : ''} ${groupActive ? 'text-blue-700' : 'text-slate-400'}`}
                                />
                            </>
                        )}
                    </button>
                    {expanded && !collapsed && (
                        <div className="space-y-0.5">
                            {item.children.map((child) => {
                                const childActive = isPathActive(child.path);
                                return (
                                    <Link
                                        key={child.path}
                                        to={child.path}
                                        onClick={mobile ? () => setIsMobileMenuOpen(false) : undefined}
                                        className={`flex items-center px-4 py-1.5 rounded-xl text-[11px] transition-all ${
                                            childActive
                                                ? 'bg-blue-100 text-blue-700 font-bold'
                                                : 'text-slate-300 hover:bg-white/10 hover:text-white'
                                        }`}
                                    >
                                        <span className={`mr-3 ${childActive ? 'text-blue-700' : 'text-slate-400'}`}>
                                            {child.icon}
                                        </span>
                                        <span className="truncate">{child.label}</span>
                                    </Link>
                                );
                            })}
                        </div>
                    )}
                </div>
            );
        }

        const active = isPathActive(item.path);
        return (
            <Link
                key={item.path}
                to={item.path}
                title={collapsed ? item.label : ''}
                onClick={mobile ? () => setIsMobileMenuOpen(false) : undefined}
                className={`flex items-center ${collapsed ? 'justify-center px-0' : 'px-4'} py-1.5 rounded-xl transition-all duration-200 group relative overflow-hidden ${getMenuItemClasses(active)}`}
            >
                <span className={`${collapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${getMenuIconClasses(active)}`}>
                    {item.icon}
                </span>
                {!collapsed && <span className="truncate text-[11px] animate-in fade-in slide-in-from-left-2">{item.label}</span>}
            </Link>
        );
    };

    return (
        <div className="flex h-screen bg-[#EAF3FF] font-sans overflow-hidden">
            <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-[#071B45] bg-gradient-to-b from-[#0A2558] to-[#051632] shadow-lg hidden md:flex flex-col z-20 transition-all duration-300 relative overflow-visible`}>
                <button 
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="absolute -right-3 top-24 bg-white border border-slate-200 rounded-full p-1 shadow-md z-50 hover:bg-slate-50 text-blue-600 cursor-pointer"
                >
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>

                <div className={`min-h-24 flex items-center ${isCollapsed ? 'justify-center px-3' : 'px-6'} py-6 transition-all duration-300 relative z-10`}>
                    <img
                        src="/Gemini_Generated_Image_uu0hhduu0hhduu0h.png"
                        alt="Logo"
                        className="h-12 w-12 object-cover rounded-full flex-shrink-0 border-2 border-white/20 shadow-sm"
                    />
                    {!isCollapsed && (
                        <div className="ml-4 animate-in fade-in slide-in-from-left-2">
                            <h1 className="text-xl font-bold whitespace-nowrap tracking-tight text-white">
                                TRANSPORT
                            </h1>
                            <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400 font-medium mt-0.5">
                                Management System
                            </p>
                        </div>
                    )}
                </div>

                <nav className="flex-1 px-4 space-y-0.5 overflow-y-auto sidebar-scrollbar relative z-10 pb-6">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-3.5 last:mb-0">
                            {!isCollapsed && (
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1 px-4 mt-2">
                                    {category.title}
                                </h3>
                            )}
                            <div className="space-y-0.5">
                                {category.items.map((item) => renderNavItem(item, { collapsed: isCollapsed }))}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className={`p-4 relative z-10 ${isCollapsed ? 'flex justify-center' : ''}`}>
                    <div className={`flex items-center justify-between ${isCollapsed ? 'flex-col gap-4' : 'gap-3 p-3 bg-slate-800/80'} rounded-2xl transition-all duration-300`}>
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'scale-110' : ''}`}>
                                {(adminInfo.name || adminInfo.username || 'S').charAt(0).toUpperCase()}
                            </div>
                            {!isCollapsed && (
                                <div className="flex-1 min-w-0 animate-in fade-in duration-300">
                                    <p className="text-[13px] font-bold text-white truncate leading-tight">
                                        {adminInfo.name || adminInfo.username || 'Super Admin'}
                                    </p>
                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                        {adminInfo.role === 'admin' ? 'Administrator' : adminInfo.role || 'Administrator'}
                                    </p>
                                </div>
                            )}
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col gap-1 pr-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={handleLogout}
                                    title="Logout"
                                    className="p-1.5 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/10"
                                >
                                    <LogOut size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/80 z-30 md:hidden backdrop-blur-sm"
                    onClick={() => setIsMobileMenuOpen(false)}
                ></div>
            )}

            <aside className={`fixed inset-y-0 left-0 w-64 bg-[#071B45] bg-gradient-to-b from-[#0A2558] to-[#051632] shadow-xl flex flex-col z-40 transform transition-transform duration-300 md:hidden overflow-hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
                <div className="min-h-24 flex justify-between items-center px-6 relative z-10">
                    <div className="flex items-center gap-3 min-w-0">
                        <img
                            src="/Gemini_Generated_Image_uu0hhduu0hhduu0h.png"
                            alt="Logo"
                            className="h-10 w-10 object-cover rounded-full border-2 border-white/20 shadow-sm"
                        />
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-white truncate">TRANSPORT</h1>
                            <p className="text-[9px] uppercase tracking-[0.1em] text-slate-400 font-medium">Management System</p>
                        </div>
                    </div>
                    <button type="button" onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 hover:text-white p-2">
                        <X size={24} />
                    </button>
                </div>

                <nav className="flex-1 px-4 space-y-1 overflow-y-auto sidebar-scrollbar relative z-10 pb-6">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-6 last:mb-0">
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2 mt-4">
                                {category.title}
                            </h3>
                            <div className="space-y-1.5">
                                {category.items.map((item) => renderNavItem(item, { mobile: true }))}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className="p-4 relative z-10">
                    <div className="flex items-center justify-between gap-3 p-3 bg-slate-800/80 rounded-2xl">
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm flex-shrink-0">
                                {(adminInfo.name || adminInfo.username || 'S').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-[13px] font-bold text-white truncate leading-tight">
                                    {adminInfo.name || adminInfo.username || 'Super Admin'}
                                </p>
                                <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                    {adminInfo.role === 'admin' ? 'Administrator' : adminInfo.role || 'Administrator'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleLogout}
                            title="Logout"
                            className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/10 shrink-0"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </aside>

            <div className="flex-1 flex flex-col h-screen overflow-hidden relative bg-[#EAF3FF] w-full">
                <header className="md:hidden bg-white shadow-sm border-b border-slate-200 h-16 flex items-center justify-between px-4 z-20">
                    <button type="button" onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-600 rounded-lg hover:bg-slate-100">
                        <Menu size={24} />
                    </button>
                    <h1 className="text-lg font-bold text-slate-800 truncate">Pydah Transport</h1>
                    <div className="w-10"></div>
                </header>

                <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 scroll-smooth w-full">
                    <div className="w-full mx-auto">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default Layout;
