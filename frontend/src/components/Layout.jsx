import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import DraftFloatingWidget from './DraftFloatingWidget';
import LogoutConfirmModal from './LogoutConfirmModal';
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
    Navigation,
    UserCheck,
    MessageSquare,
    ShieldCheck,
    Camera,
    FileText,
    MapPin,
    Activity,
    Zap,
    Moon,
    Fuel,
    BarChart2,
} from 'lucide-react';

const Layout = ({ children, title }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem('sidebar_collapsed') === 'true');
    const [openGroups, setOpenGroups] = useState({ pathname: location.pathname, values: {} });

    const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);

    const toggleSidebarCollapse = () => {
        setIsCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem('sidebar_collapsed', String(next));
            return next;
        });
    };

    const handleLogoutClick = () => {
        setIsLogoutModalOpen(true);
    };

    const handleConfirmLogout = () => {
        const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
        const isSSO = Boolean(
            adminInfo.isSSO === true ||
            adminInfo.isSSO === 'true' ||
            localStorage.getItem('isSSO') === 'true'
        );
        const crmUrl = adminInfo.crmUrl || localStorage.getItem('crmUrl') || import.meta.env.VITE_CRM_URL || 'https://crm.pydah.edu.in';

        localStorage.removeItem('adminInfo');
        localStorage.removeItem('isSSO');
        localStorage.removeItem('crmUrl');
        sessionStorage.clear();
        window.dispatchEvent(new Event('auth-change'));

        if (isSSO) {
            window.location.href = crmUrl;
        } else {
            navigate('/login');
        }
    };

    const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');

    const hasPermission = (requiredPerm) => {
        if (!requiredPerm) return true;
        if (adminInfo.role === 'admin') return true;
        if (adminInfo.permissions && adminInfo.permissions.includes(requiredPerm)) return true;
        if (requiredPerm === 'reports' && adminInfo.permissions && adminInfo.permissions.includes('transport_requests')) return true;
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
                {
                    key: 'route_management',
                    label: 'Route Management',
                    icon: <Map size={20} />,
                    permission: 'route_management',
                    children: [
                        { path: '/routes?tab=network', label: 'Route Network', icon: <Map size={16} /> },
                        { path: '/routes?tab=bus-mapping', label: 'Bus–Route Mapping', icon: <Bus size={16} /> },
                        { path: '/routes?tab=transfer', label: 'Transfer Stage', icon: <RefreshCw size={16} /> },
                        { path: '/routes?tab=student-transfer', label: 'Transfer Students', icon: <Users size={16} /> },
                        { path: '/routes?tab=history', label: 'History Logs', icon: <ClipboardList size={16} /> },
                    ]
                },
                { path: '/fleet', label: 'Fleet & Passengers', permission: 'fleet_passengers', icon: <Users size={20} /> },
                {
                    key: 'gps_tracking',
                    label: 'GPS Live Tracking',
                    icon: <Navigation size={20} />,
                    permission: 'gps_tracking',
                    children: [
                        { path: '/gps-tracking?tab=live', label: 'Live Tracking Map', icon: <MapPin size={16} /> },
                        { path: '/gps-tracking?tab=reports', label: 'Campus IN / OUTs', icon: <Activity size={16} /> },
                        { path: '/gps-tracking?tab=nightstay', label: 'Night Stay IN / OUTs', icon: <Moon size={16} /> },
                        { path: '/gps-tracking?tab=fuel', label: 'Fuel Day Report', icon: <Fuel size={16} /> },
                        { path: '/gps-tracking?tab=destination', label: 'Final Destination', icon: <Zap size={16} /> },
                    ]
                },
                { path: '/communications', label: 'Communications', permission: 'communications', icon: <MessageSquare size={20} /> },
            ]
        },
        {
            title: 'OPERATIONS',
            items: [
                { path: '/raise-request', label: 'Raise New Request', permission: 'raise_request', icon: <PlusCircle size={20} /> },
                { path: '/transport-requests', label: 'Passenger Requests', permission: 'transport_requests', icon: <ClipboardList size={20} /> },
                { path: '/reports', label: 'Reports', permission: 'reports', icon: <BarChart2 size={20} /> },
                {
                    key: 'qr_verification',
                    label: 'QR Verification',
                    icon: <ShieldCheck size={20} />,
                    permission: 'qr_verification',
                    children: [
                        { path: '/verify?tab=scan', label: 'QR Scanner', icon: <Camera size={16} /> },
                        { path: '/verify?tab=inspection', label: 'Route Inspection', icon: <Bus size={16} /> },
                        { path: '/verify?tab=sync', label: 'Sync & Data', icon: <RefreshCw size={16} /> },
                        { path: '/inspection-reports', label: 'Inspection Reports', icon: <FileText size={16} /> },
                    ]
                },
                { path: '/renewals', label: 'Renewals', permission: 'renewals', icon: <RefreshCw size={20} /> },
            ]
        },
        {
            title: 'ACADEMIC',
            items: [
                { path: '/transport-dues', label: 'Transport Dues', permission: 'transport_dues', icon: <CreditCard size={20} /> },
                { path: '/concessions', label: 'Concessions', permission: 'concessions', icon: <Percent size={20} /> },
                { path: '/attendance', label: 'Attendance', permission: 'attendance', icon: <UserCheck size={20} /> },
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
                { path: '/settings', label: 'Settings', permission: 'settings', icon: <Settings size={20} /> },
                { path: '/users', label: 'User Management', permission: 'user_management', icon: <UserCog size={20} /> },
            ]
        }
    ];

    const filteredCategories = menuCategories.map((category) => ({
        ...category,
        items: category.items.filter((item) => hasPermission(item.permission))
    })).filter((category) => category.items.length > 0);

    const isPathActive = (path) => {
        if (path.includes('?')) {
            const [basePath, searchStr] = path.split('?');
            const params = new URLSearchParams(searchStr);
            const activeTab = params.get('tab');
            const currentTab = new URLSearchParams(location.search).get('tab') || (basePath === '/routes' ? 'network' : (basePath === '/verify' ? 'scan' : (basePath === '/gps-tracking' ? 'live' : '')));
            return location.pathname === basePath && currentTab === activeTab;
        }
        if (path === '/fleet') {
            return location.pathname === '/fleet'
                || location.pathname.startsWith('/buses/')
                || location.pathname.startsWith('/other-vehicles/');
        }
        if (path === '/buses') {
            return location.pathname === '/buses';
        }
        if (path === '/reports') {
            return location.pathname === '/reports' || location.pathname === '/freports' || location.pathname === '/f-reports';
        }
        return location.pathname === path
            || (path !== '/inventory' && path !== '/verify' && location.pathname.startsWith(`${path}/`));
    };

    const isGroupActive = (item) => {
        if (item.children) {
            return item.children.some((child) => isPathActive(child.path));
        }
        return isPathActive(item.path);
    };

    const getMenuItemClasses = (active) => {
        if (active) return 'bg-[var(--primary)] text-[var(--sidebar-text)] font-semibold';
        return 'text-[var(--sidebar-text)] hover:bg-[color-mix(in_srgb,var(--sidebar-text)_10%,transparent)] font-medium';
    };

    const getMenuIconClasses = (active) => {
        if (active) return 'text-[var(--sidebar-text)]';
        return 'text-[var(--sidebar-muted)] group-hover:text-[var(--sidebar-text)]';
    };

    const toggleGroup = (key, expanded) => {
        setOpenGroups((prev) => ({
            pathname: location.pathname,
            values: {
                ...(prev.pathname === location.pathname ? prev.values : {}),
                [key]: !expanded,
            },
        }));
    };

    const renderNavItem = (item, { mobile = false, collapsed = false } = {}) => {
        if (item.children) {
            const groupActive = isGroupActive(item);
            const expanded = openGroups.pathname === location.pathname
                ? (openGroups.values[item.key] ?? groupActive)
                : groupActive;

            return (
                <div key={item.key || item.label} className="space-y-1">
                    <button
                        type="button"
                        title={collapsed ? item.label : undefined}
                        onClick={() => {
                            if (collapsed && !mobile) {
                                navigate(item.children[0].path);
                                return;
                            }
                            toggleGroup(item.key, expanded);
                        }}
                        className={`w-full flex items-center ${collapsed ? 'justify-center px-0' : 'px-4'} py-3 rounded-xl transition-all duration-200 group relative overflow-hidden ${getMenuItemClasses(groupActive && collapsed)}`}
                    >
                        <span className={`${collapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${getMenuIconClasses(groupActive && collapsed)}`}>
                            {item.icon}
                        </span>
                        {!collapsed && (
                            <>
                                <span className="truncate text-sm flex-1 text-left">{item.label}</span>
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform ${expanded ? 'rotate-180' : ''} ${groupActive ? 'text-[var(--primary)]' : 'text-[var(--sidebar-muted)]'}`}
                                />
                            </>
                        )}
                    </button>
                    {expanded && !collapsed && (
                        <div className="space-y-0.5 ml-6 pl-1 border-l border-[var(--border)]">
                            {item.children.map((child) => {
                                const childActive = isPathActive(child.path);
                                return (
                                    <Link
                                        key={child.path}
                                        to={child.path}
                                        onClick={mobile ? () => setIsMobileMenuOpen(false) : undefined}
                                        className={`flex items-center px-3 py-2 rounded-lg text-xs transition-all ${
                                            childActive
                                                ? 'bg-[var(--primary)] text-[var(--sidebar-text)] font-semibold'
                                                    : 'text-[var(--sidebar-text)] hover:bg-[color-mix(in_srgb,var(--sidebar-text)_10%,transparent)]'
                                        }`}
                                    >
                                        <span className={`mr-2.5 ${childActive ? 'text-[var(--sidebar-text)]' : 'text-[var(--sidebar-muted)]'}`}>
                                            {React.cloneElement(child.icon, { size: 14 })}
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
                className={`flex items-center ${collapsed ? 'justify-center px-0' : 'px-4'} py-3 rounded-xl transition-all duration-200 group relative overflow-hidden ${getMenuItemClasses(active)}`}
            >
                <span className={`${collapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${getMenuIconClasses(active)}`}>
                    {item.icon}
                </span>
                {!collapsed && <span className="truncate text-sm animate-in fade-in slide-in-from-left-2">{item.label}</span>}
            </Link>
        );
    };

    const getMobileTitle = () => {
        if (title) return title;
        const [basePath, searchStr] = (location.pathname + location.search).split('?');
        const tabParam = new URLSearchParams(searchStr || '').get('tab');
        if (basePath === '/verify') {
            if (tabParam === 'inspection') return 'Route Inspection';
            if (tabParam === 'sync') return 'Sync & Data';
            return 'QR Scanner';
        }
        if (basePath === '/inspection-reports') return 'Inspection Reports';
        if (basePath === '/dashboard') return 'Dashboard';
        if (basePath === '/buses') return 'Vehicle Management';
        if (basePath.startsWith('/buses/')) return 'Bus Details';
        if (basePath.startsWith('/other-vehicles/')) return 'Vehicle Details';
        if (basePath === '/fleet') return 'Fleet & Passengers';
        if (basePath === '/routes') {
            if (tabParam === 'bus-mapping') return 'Bus–Route Mapping';
            if (tabParam === 'transfer') return 'Transfer Stage';
            if (tabParam === 'student-transfer') return 'Transfer Students';
            if (tabParam === 'history') return 'History Logs';
            return 'Route Network';
        }
        if (basePath === '/gps-tracking') return 'GPS Live Tracking';
        if (basePath === '/communications') return 'Communications';
        if (basePath === '/raise-request') return 'Raise New Request';
        if (basePath === '/transport-requests') return 'Passenger Requests';
        if (basePath === '/reports') return 'Reports';
        if (basePath === '/renewals') return 'Renewals';
        if (basePath === '/transport-dues') return 'Transport Dues';
        if (basePath === '/concessions') return 'Concessions';
        if (basePath === '/attendance') return 'Attendance';
        if (basePath === '/inventory') return 'Inventory';
        if (basePath === '/inventory/raise-bill') return 'Bills';
        if (basePath === '/settings') return 'Settings';
        if (basePath === '/users') return 'User Management';
        return 'Campo Transport';
    };

    return (
        <div className="flex h-screen overflow-hidden" style={{ backgroundColor: 'var(--background)' }}>
            <aside 
                className={`fixed top-0 left-0 bottom-0 ${isCollapsed ? 'w-20' : 'w-72'} print:hidden hidden md:flex flex-col z-40 transition-all duration-300 overflow-visible border-r`}
                style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-text)', borderColor: 'var(--border)', fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif" }}
            >
                <button 
                    type="button"
                    onClick={toggleSidebarCollapse}
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-expanded={!isCollapsed}
                    className="absolute -right-3 top-[106px] z-50 flex h-6 w-6 items-center justify-center rounded-full border shadow-md text-[var(--primary)]"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                    {isCollapsed
                        ? <ChevronRight size={14} strokeWidth={2.5} />
                        : <ChevronLeft size={14} strokeWidth={2.5} />}
                </button>

                <div className="flex flex-col items-center justify-center border-b px-3 pt-6 pb-4 text-center" style={{ borderColor: 'var(--border)' }}>
                    <img
                        src="/campo-logos/campo_logo_transparent_hq.png"
                        alt="Campo"
                        className={`h-8 w-auto object-contain ${isCollapsed ? 'max-w-[52px]' : 'max-w-[144px]'}`}
                    />
                    {!isCollapsed && (
                        <span className="mt-1 text-[11px] font-medium tracking-wide text-[var(--sidebar-muted)]">
                            Transport Management
                        </span>
                    )}
                </div>

                <nav className="sidebar-scrollbar relative z-10 flex-1 space-y-1 overflow-y-auto px-3 pb-6 pt-3">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-4 last:mb-0">
                            {!isCollapsed && (
                                <h3 className="mb-2 mt-3 px-3 text-[11px] font-bold uppercase tracking-widest text-[var(--sidebar-muted)]">
                                    {category.title}
                                </h3>
                            )}
                            <div className="space-y-1">
                                {category.items.map((item) => renderNavItem(item, { collapsed: isCollapsed }))}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className={`relative z-10 p-4 ${isCollapsed ? 'flex justify-center' : ''}`}>
                    <div
                        className={`flex items-center justify-between ${isCollapsed ? 'flex-col gap-4' : 'gap-3 p-3'} rounded-2xl transition-all duration-300`}
                        style={!isCollapsed ? {
                            backgroundColor: 'color-mix(in srgb, var(--sidebar) 75%, var(--text-primary))',
                        } : undefined}
                    >
                        <div className="flex items-center gap-3 min-w-0">
                            <div className={`w-11 h-11 rounded-full bg-[var(--surface)] flex items-center justify-center text-[var(--primary)] font-bold text-sm flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'scale-110' : ''}`}>
                                {(adminInfo.name || adminInfo.username || 'S').charAt(0).toUpperCase()}
                            </div>
                            {!isCollapsed && (
                                <div className="flex-1 min-w-0 animate-in fade-in duration-300">
                                    <p className="text-xs font-bold text-[var(--sidebar-text)] truncate leading-tight uppercase">
                                        {adminInfo.name || adminInfo.username || 'Super Admin'}
                                    </p>
                                    <p className="text-xs text-[var(--sidebar-muted)] truncate mt-0.5">
                                        {adminInfo.role === 'admin' ? 'Administrator' : adminInfo.role || 'Administrator'}
                                    </p>
                                </div>
                            )}
                        </div>
                        {isCollapsed ? (
                            <button
                                type="button"
                                onClick={handleLogoutClick}
                                title="Logout"
                                className="p-2 text-[var(--sidebar-muted)] transition-colors rounded-lg hover:bg-[color-mix(in_srgb,var(--sidebar-text)_10%,transparent)] hover:text-[var(--sidebar-text)]"
                            >
                                <LogOut size={18} />
                            </button>
                        ) : (
                            <div className="shrink-0">
                                <button
                                    type="button"
                                    onClick={handleLogoutClick}
                                    title="Logout"
                                    className="p-1.5 text-[var(--sidebar-text)] transition-colors rounded-lg hover:bg-[color-mix(in_srgb,var(--sidebar-text)_10%,transparent)]"
                                >
                                    <LogOut size={18} strokeWidth={2.25} />
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </aside>

            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 print:hidden z-[100] md:hidden backdrop-blur-sm"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar) 75%, transparent)' }}
                    onClick={() => setIsMobileMenuOpen(false)}
                ></div>
            )}

            <aside 
                className={`fixed inset-y-0 left-0 w-64 print:hidden shadow-xl flex flex-col z-[110] transform transition-transform duration-300 md:hidden overflow-hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}
                style={{ backgroundColor: 'var(--sidebar)', color: 'var(--sidebar-text)', fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif" }}
            >
                <div className="relative z-10 flex flex-col items-center justify-center border-b px-6 pt-6 pb-4 text-center" style={{ borderColor: 'var(--border)' }}>
                    <div className="flex min-w-0 flex-col items-center">
                        <img
                            src="/campo-logos/campo_logo_transparent_hq.png"
                            alt="Campo"
                            className="h-8 w-auto max-w-[144px] object-contain"
                        />
                        <span className="text-[11px] text-[var(--sidebar-muted)] font-medium tracking-wide mt-1">
                            Transport Management
                        </span>
                    </div>
                    <button type="button" onClick={() => setIsMobileMenuOpen(false)} aria-label="Close navigation" className="absolute right-3 top-5 p-2 text-[var(--sidebar-muted)] hover:text-[var(--sidebar-text)]">
                        <X size={24} />
                    </button>
                </div>

                <nav className="flex-1 px-3 pt-3 space-y-1 overflow-y-auto sidebar-scrollbar relative z-10 pb-6">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-4 last:mb-0">
                            <h3 className="text-[11px] font-bold text-[var(--sidebar-muted)] uppercase tracking-widest mb-2 px-3 mt-3">
                                {category.title}
                            </h3>
                            <div className="space-y-1">
                                {category.items.map((item) => renderNavItem(item, { mobile: true }))}
                            </div>
                        </div>
                    ))}
                </nav>

                <div className="p-4 relative z-10">
                    <div className="flex items-center justify-between gap-3 p-3 rounded-2xl" style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar) 75%, var(--text-primary))' }}>
                        <div className="flex items-center gap-3 min-w-0">
                            <div className="w-11 h-11 rounded-full bg-[var(--surface)] flex items-center justify-center text-[var(--primary)] font-bold text-sm flex-shrink-0">
                                {(adminInfo.name || adminInfo.username || 'S').charAt(0).toUpperCase()}
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="text-xs font-bold text-[var(--sidebar-text)] truncate leading-tight">
                                    {adminInfo.name || adminInfo.username || 'Super Admin'}
                                </p>
                                <p className="text-xs text-[var(--sidebar-muted)] truncate mt-0.5">
                                    {adminInfo.role === 'admin' ? 'Administrator' : adminInfo.role || 'Administrator'}
                                </p>
                            </div>
                        </div>
                        <button
                            type="button"
                            onClick={handleLogoutClick}
                            title="Logout"
                            className="p-2 text-[var(--sidebar-muted)] transition-colors rounded-lg hover:bg-[color-mix(in_srgb,var(--sidebar-text)_10%,transparent)] hover:text-[var(--sidebar-text)] shrink-0"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </aside>

            <div className={`flex-1 flex flex-col h-screen overflow-hidden relative transition-[margin] duration-300 ${isCollapsed ? 'md:ml-20' : 'md:ml-72'}`} style={{ backgroundColor: 'var(--background)' }}>
                <header 
                    className="md:hidden shadow-sm h-14 sm:h-16 flex items-center justify-between px-3.5 z-20"
                    style={{ backgroundColor: 'var(--navbar)', borderBottom: '1px solid var(--navbar-border, var(--border))' }}
                >
                    <button type="button" onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-[var(--text-secondary)] rounded-lg hover:bg-[color-mix(in_srgb,var(--text-secondary)_5%,transparent)]">
                        <Menu size={22} />
                    </button>
                    <h1 className="text-sm sm:text-base font-bold text-[var(--text-primary)] truncate px-2 text-center flex-1">
                        {getMobileTitle()}
                    </h1>
                    <div className="w-9"></div>
                </header>

                <main className="flex-1 overflow-x-hidden overflow-y-auto p-4 md:p-6 scroll-smooth w-full" style={{ backgroundColor: 'var(--background)' }}>
                    <div className="w-full mx-auto">
                        {children}
                    </div>
                </main>
                <DraftFloatingWidget />
            </div>

            <LogoutConfirmModal
                isOpen={isLogoutModalOpen}
                onClose={() => setIsLogoutModalOpen(false)}
                onConfirm={handleConfirmLogout}
                isSSO={Boolean(
                    adminInfo.isSSO === true ||
                    adminInfo.isSSO === 'true' ||
                    localStorage.getItem('isSSO') === 'true'
                )}
                crmUrl={adminInfo.crmUrl || localStorage.getItem('crmUrl') || import.meta.env.VITE_CRM_URL || 'https://crm.pydah.edu.in'}
                userName={adminInfo.name || adminInfo.username}
            />
        </div>
    );
};

export default Layout;
