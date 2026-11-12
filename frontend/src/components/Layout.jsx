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

    const displayName = adminInfo.name || adminInfo.username || 'Super Admin';
    const displayRole = adminInfo.role === 'admin' ? 'Administrator' : adminInfo.role || 'Administrator';
    const userInitial = displayName.charAt(0).toUpperCase();

    const toggleGroup = (key, expanded) => {
        setOpenGroups((prev) => ({
            pathname: location.pathname,
            values: {
                ...(prev.pathname === location.pathname ? prev.values : {}),
                [key]: !expanded,
            },
        }));
    };

    const getNavItemStyle = (active, muted = false) => (
        active
            ? {
                  backgroundColor: 'var(--primary, #2563EB)',
                  color: 'var(--sidebar-text, #FFFFFF)',
                  boxShadow: '0 2px 8px rgba(10, 20, 35, 0.25)',
              }
            : { color: muted ? 'var(--sidebar-muted, #AABBD4)' : 'var(--sidebar-text, #FFFFFF)' }
    );

    const renderNavItem = (item, { mobile = false, collapsed = false } = {}) => {
        if (item.children) {
            const groupActive = isGroupActive(item);
            const expanded = openGroups.pathname === location.pathname
                ? (openGroups.values[item.key] ?? groupActive)
                : groupActive;
            const showActiveStyle = groupActive && collapsed;

            return (
                <div key={item.key || item.label} className="space-y-[4px]">
                    <button
                        type="button"
                        title={collapsed ? item.label : undefined}
                        aria-expanded={!collapsed ? expanded : undefined}
                        onClick={() => {
                            if (collapsed && !mobile) {
                                navigate(item.children[0].path);
                                return;
                            }
                            toggleGroup(item.key, expanded);
                        }}
                        style={getNavItemStyle(showActiveStyle)}
                        className={`w-full flex items-center ${
                            collapsed ? 'justify-center px-0' : 'px-[14px] gap-[14px]'
                        } py-[10px] rounded-[12px] transition-all duration-200 group relative overflow-hidden ${
                            showActiveStyle
                                ? 'font-semibold'
                                : groupActive
                                    ? 'font-semibold opacity-100 hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_8%,transparent)]'
                                    : 'font-medium opacity-80 hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_8%,transparent)]'
                        }`}
                    >
                        <span className="shrink-0 flex items-center justify-center transition-all duration-200">
                            {React.cloneElement(item.icon, {
                                size: collapsed ? 20 : 18,
                                strokeWidth: 2,
                            })}
                        </span>
                        {!collapsed && (
                            <>
                                <span className="truncate text-[13px] flex-1 text-left leading-tight">
                                    {item.label}
                                </span>
                                <ChevronDown
                                    size={14}
                                    strokeWidth={2}
                                    style={{ color: groupActive ? 'var(--sidebar-text, #FFFFFF)' : 'var(--sidebar-muted, #AABBD4)' }}
                                    className={`shrink-0 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                                />
                            </>
                        )}
                    </button>
                    {expanded && !collapsed && (
                        <div
                            className="space-y-[4px] ml-[22px] pl-[12px] pt-[2px] border-l"
                            style={{ borderColor: 'var(--border, var(--sidebar-border, rgba(255, 255, 255, 0.12)))' }}
                        >
                            {item.children.map((child) => {
                                const childActive = isPathActive(child.path);
                                return (
                                    <Link
                                        key={child.path}
                                        to={child.path}
                                        onClick={mobile ? () => setIsMobileMenuOpen(false) : undefined}
                                        style={getNavItemStyle(childActive, true)}
                                        className={`w-full flex items-center gap-[10px] px-[12px] py-[8px] rounded-[10px] text-[12px] transition-all duration-200 ${
                                            childActive
                                                ? 'font-semibold'
                                                : 'font-medium opacity-85 hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_8%,transparent)]'
                                        }`}
                                    >
                                        <span className="shrink-0 flex items-center justify-center">
                                            {React.cloneElement(child.icon, { size: 15, strokeWidth: 2 })}
                                        </span>
                                        <span className="truncate leading-tight">{child.label}</span>
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
                title={collapsed ? item.label : undefined}
                onClick={mobile ? () => setIsMobileMenuOpen(false) : undefined}
                style={getNavItemStyle(active)}
                className={`w-full flex items-center ${
                    collapsed ? 'justify-center px-0' : 'px-[14px] gap-[14px]'
                } py-[10px] rounded-[12px] transition-all duration-200 group relative overflow-hidden ${
                    active
                        ? 'font-semibold'
                        : 'font-medium opacity-80 hover:opacity-100 hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_8%,transparent)]'
                }`}
            >
                <span className="shrink-0 flex items-center justify-center transition-all duration-200">
                    {React.cloneElement(item.icon, {
                        size: collapsed ? 20 : 18,
                        strokeWidth: 2,
                    })}
                </span>
                {!collapsed && (
                    <span className="truncate text-[13px] leading-tight">
                        {item.label}
                    </span>
                )}
            </Link>
        );
    };

    const renderBrandContent = (collapsed = false) => (
        collapsed ? (
            <img
                src="/campo-logos/icon-192.png"
                alt="Campo"
                title="Campo - Transport Management"
                className="w-[36px] h-[36px] object-cover rounded-[8px] shrink-0 shadow-sm"
            />
        ) : (
            <>
                <img
                    src="/campo-logos/campo_logo_transparent_hq.png"
                    alt="Campo"
                    className="h-[28px] max-w-[120px] w-auto object-contain shrink-0"
                />
                <p
                    className="text-[12px] font-medium mt-[8px] leading-tight whitespace-nowrap"
                    style={{ color: 'var(--sidebar-muted, #AABBD4)' }}
                >
                    Transport Management
                </p>
            </>
        )
    );

    const renderNavSections = ({ mobile = false, collapsed = false } = {}) => (
        <nav className="flex-1 px-[14px] pt-[12px] pb-[16px] overflow-y-auto overflow-x-hidden sidebar-scrollbar relative z-10">
            {filteredCategories.map((category, idx) => (
                <div key={category.title || idx} className="mb-[24px] last:mb-0">
                    {!collapsed && (
                        <h3
                            className="px-[14px] pt-[4px] pb-[8px] mb-[4px] text-[11px] font-bold uppercase tracking-[0.06em] truncate"
                            style={{ color: 'var(--sidebar-muted, #AABBD4)' }}
                        >
                            {category.title}
                        </h3>
                    )}
                    <div className="space-y-[4px]">
                        {category.items.map((item) => renderNavItem(item, { mobile, collapsed }))}
                    </div>
                </div>
            ))}
        </nav>
    );

    const renderUserProfile = (collapsed = false) => (
        <div className="p-[14px] relative z-10 shrink-0">
            {collapsed ? (
                <div className="flex items-center justify-center">
                    <div
                        title={`${displayName} • ${displayRole}`}
                        className="w-[40px] h-[40px] rounded-full bg-[var(--surface,#DBEAFE)] text-[var(--primary,#1D4ED8)] flex items-center justify-center font-bold text-[14px] shrink-0 shadow-sm cursor-default"
                    >
                        {userInitial}
                    </div>
                </div>
            ) : (
                <div
                    className="h-[64px] px-[14px] shadow-sm rounded-[16px] flex items-center justify-between gap-2 transition-all duration-200"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar, var(--sidebar-bg, #1E3150)) 75%, var(--text-primary, #0F172A))' }}
                >
                    <div className="flex items-center gap-[12px] min-w-0 flex-1">
                        <div className="w-[40px] h-[40px] rounded-full bg-[var(--surface,#DBEAFE)] text-[var(--primary,#1D4ED8)] flex items-center justify-center font-bold text-[14px] shrink-0">
                            {userInitial}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p
                                className="text-[13px] font-bold truncate leading-tight uppercase"
                                style={{ color: 'var(--sidebar-text, #FFFFFF)' }}
                                title={displayName}
                            >
                                {displayName}
                            </p>
                            <p
                                className="text-[11px] font-normal truncate mt-0.5"
                                style={{ color: 'var(--sidebar-muted, #AABBD4)' }}
                                title={displayRole}
                            >
                                {displayRole}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={handleLogoutClick}
                        title="Logout"
                        aria-label="Logout"
                        style={{ color: 'var(--sidebar-muted, #AABBD4)' }}
                        className="p-1.5 hover:text-red-400 transition-colors rounded-lg hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_10%,transparent)] shrink-0"
                    >
                        <LogOut size={16} strokeWidth={2} />
                    </button>
                </div>
            )}
        </div>
    );

    const sidebarThemeStyle = {
        backgroundColor: 'var(--sidebar, var(--sidebar-bg, #1E3150))',
        color: 'var(--sidebar-text, #FFFFFF)',
        borderColor: 'var(--border, var(--sidebar-border, rgba(255, 255, 255, 0.12)))',
        boxShadow: '4px 0 24px -2px rgba(10, 20, 35, 0.45)',
        fontFamily: "'Plus Jakarta Sans', system-ui, -apple-system, sans-serif",
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
        <div className="flex h-screen font-sans overflow-hidden" style={{ backgroundColor: 'var(--background, #EAF3FF)' }}>
            <aside
                style={sidebarThemeStyle}
                className={`fixed inset-y-0 left-0 h-screen z-40 print:hidden hidden md:flex flex-col border-r transition-all duration-200 ease-in-out overflow-visible ${
                    isCollapsed ? 'w-[80px]' : 'w-[256px]'
                }`}
            >
                <button
                    type="button"
                    onClick={toggleSidebarCollapse}
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    aria-expanded={!isCollapsed}
                    title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    style={{
                        backgroundColor: 'var(--surface, #FFFFFF)',
                        borderColor: 'var(--border, #E2E8F0)',
                        color: 'var(--primary, var(--sidebar, #1E3150))',
                        boxShadow: '0 2px 6px rgba(10, 20, 35, 0.16)',
                    }}
                    className="absolute -right-[12px] top-[106px] w-[24px] h-[24px] rounded-full border flex items-center justify-center z-50 hover:scale-105 transition-all duration-200 cursor-pointer"
                >
                    {isCollapsed ? <ChevronRight size={14} strokeWidth={2.5} /> : <ChevronLeft size={14} strokeWidth={2.5} />}
                </button>

                <div
                    className={`flex flex-col items-center justify-center text-center border-b transition-all duration-200 relative z-10 shrink-0 ${
                        isCollapsed ? 'pt-[24px] pb-[16px] px-[8px]' : 'pt-[24px] pb-[16px] px-[24px]'
                    }`}
                    style={{ borderColor: 'var(--border, var(--sidebar-border, rgba(255, 255, 255, 0.12)))' }}
                >
                    {renderBrandContent(isCollapsed)}
                </div>

                {renderNavSections({ collapsed: isCollapsed })}

                {renderUserProfile(isCollapsed)}
            </aside>

            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 print:hidden z-[100] md:hidden backdrop-blur-sm"
                    style={{ backgroundColor: 'color-mix(in srgb, var(--sidebar, var(--sidebar-bg, #1E3150)) 75%, transparent)' }}
                    onClick={() => setIsMobileMenuOpen(false)}
                ></div>
            )}

            <aside
                style={sidebarThemeStyle}
                className={`fixed inset-y-0 left-0 w-[256px] print:hidden border-r flex flex-col z-[110] transform transition-transform duration-200 ease-in-out md:hidden overflow-hidden ${
                    isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                }`}
            >
                <div
                    className="relative flex flex-col items-center justify-center text-center pt-[24px] pb-[16px] px-[24px] border-b shrink-0"
                    style={{ borderColor: 'var(--border, var(--sidebar-border, rgba(255, 255, 255, 0.12)))' }}
                >
                    <button
                        type="button"
                        onClick={() => setIsMobileMenuOpen(false)}
                        aria-label="Close navigation menu"
                        style={{ color: 'var(--sidebar-muted, #AABBD4)' }}
                        className="absolute right-3 top-3 hover:text-white p-1.5 rounded-lg hover:bg-[color-mix(in_srgb,var(--sidebar-text,#FFFFFF)_10%,transparent)]"
                    >
                        <X size={20} />
                    </button>
                    {renderBrandContent(false)}
                </div>

                {renderNavSections({ mobile: true, collapsed: false })}

                {renderUserProfile(false)}
            </aside>

            <div
                className={`flex-1 flex flex-col h-screen overflow-hidden relative w-full transition-[padding] duration-200 ease-in-out print:pl-0 ${
                    isCollapsed ? 'md:pl-[80px]' : 'md:pl-[256px]'
                }`}
                style={{ backgroundColor: 'var(--background, #EAF3FF)' }}
            >
                <header
                    className="md:hidden shadow-sm h-14 sm:h-16 flex items-center justify-between px-3.5 z-20"
                    style={{ backgroundColor: 'var(--navbar, #FFFFFF)', borderBottom: '1px solid var(--navbar-border, var(--border, #E2E8F0))' }}
                >
                    <button
                        type="button"
                        onClick={() => setIsMobileMenuOpen(true)}
                        aria-label="Open navigation menu"
                        className="p-2 text-[var(--text-secondary,#475569)] rounded-lg hover:bg-[color-mix(in_srgb,var(--text-secondary,#475569)_5%,transparent)]"
                    >
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
