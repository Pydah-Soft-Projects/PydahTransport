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
    ChevronLeft,
    ChevronRight,
    Settings
} from 'lucide-react';

const Layout = ({ children }) => {
    const location = useLocation();
    const navigate = useNavigate();
    const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);

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

    // Helper to check permissions
    const hasPermission = (requiredPerm) => {
        if (!requiredPerm) return true; // Public/Always visible
        if (adminInfo.role === 'admin') return true; // Legacy Superadmin sees all
        if (adminInfo.permissions && adminInfo.permissions.includes(requiredPerm)) return true;
        return false;
    };

    // Define Items with Permissions and Categories
    const menuCategories = [
        {
            title: "MAIN",
            items: [
                { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, permission: 'dashboard' }
            ]
        },
        {
            title: "MANAGEMENT",
            items: [
                { path: '/buses', label: 'Vehicle Management', permission: 'bus_management', icon: <Bus size={20} /> },
                { path: '/routes', label: 'Route Management', permission: 'route_management', icon: <Map size={20} /> },
                { path: '/fleet', label: 'Fleet & Passengers', permission: 'fleet_passengers', icon: <Users size={20} /> },
            ]
        },
        {
            title: "OPERATIONS",
            items: [
                { path: '/raise-request', label: 'Raise Request', permission: 'raise_request', icon: <PlusCircle size={20} /> },
                { path: '/transport-requests', label: 'Passenger Requests', permission: 'transport_requests', icon: <ClipboardList size={20} /> },
                { path: '/concessions', label: 'Concessions', permission: 'concessions', icon: <Percent size={20} /> },
            ]
        },
        {
            title: "FINANCE",
            items: [
                { path: '/transport-dues', label: 'Transport Dues', permission: 'transport_dues', icon: <CreditCard size={20} /> },
            ]
        },
        {
            title: "INVENTORY",
            items: [
                { path: '/inventory', label: 'Inventory Items', icon: <Package size={20} />, permission: 'inventory' },
            ]
        },
        {
            title: "ADMINISTRATION",
            items: [
                { path: '/users', label: 'User Management', permission: 'user_management', icon: <UserCog size={20} /> },
            ]
        }
    ];

    const filteredCategories = menuCategories.map(category => ({
        ...category,
        items: category.items.filter(item => hasPermission(item.permission))
    })).filter(category => category.items.length > 0);

    const isMenuActive = (path) => (
        location.pathname === path || location.pathname.startsWith(`${path}/`)
    );

    const getMenuItemClasses = (path) => {
        const active = isMenuActive(path);
        if (active) {
            return 'bg-blue-100 text-blue-700 font-bold shadow-sm';
        }
        return 'border-transparent text-slate-300 hover:bg-white/10 hover:text-white font-medium';
    };

    const getMenuIconClasses = (path) => {
        const active = isMenuActive(path);
        if (active) return 'text-blue-700';
        return 'text-slate-300 group-hover:text-white';
    };

    return (
        <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
            {/* Sidebar (Desktop) */}
            <aside className={`${isCollapsed ? 'w-20' : 'w-72'} bg-[#0f172a] shadow-lg hidden md:flex flex-col z-20 transition-all duration-300 relative overflow-hidden`}>
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

                <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar relative z-10 pb-6">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-6 last:mb-0">
                            {!isCollapsed && (
                                <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2 mt-4">
                                    {category.title}
                                </h3>
                            )}
                            <div className="space-y-1.5">
                                {category.items.map((item) => (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        title={isCollapsed ? item.label : ""}
                                        className={`flex items-center ${isCollapsed ? 'justify-center px-0' : 'px-4'} py-2.5 rounded-xl transition-all duration-200 group relative overflow-hidden ${getMenuItemClasses(item.path)}`}
                                    >
                                        <span className={`${isCollapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${getMenuIconClasses(item.path)}`}>
                                            {item.icon}
                                        </span>
                                        {!isCollapsed && <span className="truncate text-[13px] animate-in fade-in slide-in-from-left-2">{item.label}</span>}
                                    </Link>
                                ))}
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
                                    <div className="flex items-center gap-1.5 mt-1">
                                        <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full"></div>
                                        <span className="text-[10px] text-slate-400 font-medium">Online</span>
                                    </div>
                                </div>
                            )}
                        </div>
                        {!isCollapsed && (
                            <div className="flex flex-col gap-1 pr-1 shrink-0">
                                <button className="p-1.5 text-slate-400 hover:text-white transition-colors rounded-lg hover:bg-white/10">
                                    <Settings size={16} />
                                </button>
                                <button
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

            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-slate-900/80 z-30 md:hidden backdrop-blur-sm"
                    onClick={() => setIsMobileMenuOpen(false)}
                ></div>
            )}

            {/* Sidebar (Mobile) */}
            <aside className={`fixed inset-y-0 left-0 w-72 bg-[#0f172a] shadow-xl flex flex-col z-40 transform transition-transform duration-300 md:hidden overflow-hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}`}>
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
                    <button onClick={() => setIsMobileMenuOpen(false)} className="text-slate-400 hover:text-white p-2">
                        <X size={24} />
                    </button>
                </div>
                
                <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar relative z-10 pb-6">
                    {filteredCategories.map((category, idx) => (
                        <div key={idx} className="mb-6 last:mb-0">
                            <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2 px-2 mt-4">
                                {category.title}
                            </h3>
                            <div className="space-y-1.5">
                                {category.items.map((item) => (
                                    <Link
                                        key={item.path}
                                        to={item.path}
                                        onClick={() => setIsMobileMenuOpen(false)}
                                        className={`flex items-center px-4 py-2.5 rounded-xl transition-all duration-200 ${getMenuItemClasses(item.path)}`}
                                    >
                                        <span className={`mr-3 ${getMenuIconClasses(item.path)}`}>{item.icon}</span>
                                        <span className="truncate text-[13px]">{item.label}</span>
                                    </Link>
                                ))}
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
                            onClick={handleLogout}
                            title="Logout"
                            className="p-2 text-slate-400 hover:text-red-400 transition-colors rounded-lg hover:bg-white/10 shrink-0"
                        >
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative bg-slate-50 w-full">
                {/* Mobile Header */}
                <header className="md:hidden bg-white shadow-sm border-b border-slate-200 h-16 flex items-center justify-between px-4 z-20">
                    <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-600 rounded-lg hover:bg-slate-100">
                        <Menu size={24} />
                    </button>
                    <h1 className="text-lg font-bold text-slate-800 truncate">Pydah Transport</h1>
                    <div className="w-10"></div>
                </header>

                <main className="flex-1 overflow-x-hidden overflow-y-auto p-6 md:p-8 scroll-smooth w-full">
                    <div className="w-full max-w-[1600px] mx-auto">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default Layout;