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
    ChevronRight
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

    // Define Items with Permissions
    const allMenuItems = [
        { path: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard size={20} />, permission: 'dashboard' },
        { path: '/buses', label: 'Vehicle Management', permission: 'bus_management', icon: <Bus size={20} /> },
        { path: '/routes', label: 'Route Management', permission: 'route_management', icon: <Map size={20} /> },
        { path: '/fleet', label: 'Fleet & Passengers', permission: 'fleet_passengers', icon: <Users size={20} /> },
        { path: '/raise-request', label: 'Raise Request', permission: 'raise_request', icon: <PlusCircle size={20} /> },
        { path: '/transport-requests', label: 'Passenger Requests', permission: 'transport_requests', icon: <ClipboardList size={20} /> },
        { path: '/concessions', label: 'Concessions', permission: 'concessions', icon: <Percent size={20} /> },
        { path: '/transport-dues', label: 'Transport Dues', permission: 'transport_dues', icon: <CreditCard size={20} /> },
        { path: '/inventory', label: 'Inventory Items', icon: <Package size={20} />, permission: 'inventory' },
        { path: '/users', label: 'User Management', permission: 'user_management', icon: <UserCog size={20} /> },
    ];

    const menuItems = allMenuItems.filter(item => hasPermission(item.permission));

    return (
        <div className="flex h-screen bg-slate-50 font-sans overflow-hidden">
            {/* Sidebar (Desktop) */}
            <aside className={`${isCollapsed ? 'w-20' : 'w-64'} bg-white shadow-sm border-r border-slate-200 hidden md:flex flex-col z-20 transition-all duration-300 relative overflow-hidden`}>
                {/* Collapse Toggle Button */}
                <button 
                    onClick={() => setIsCollapsed(!isCollapsed)}
                    className="absolute -right-3 top-24 bg-white border border-slate-200 rounded-full p-1 shadow-md z-30 hover:bg-slate-50 text-blue-600 group"
                >
                    {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                </button>

                <div className={`min-h-28 flex items-center ${isCollapsed ? 'justify-center px-3' : 'px-6'} py-5 transition-all duration-300 bg-gradient-to-r from-blue-600 to-blue-700 relative z-10 border-b border-blue-700/20`}>
                    <img
                        src="/Gemini_Generated_Image_uu0hhduu0hhduu0h.png"
                        alt="Logo"
                        className="h-11 w-11 object-cover rounded-full flex-shrink-0 border-2 border-white/80 shadow-sm"
                    />
                    {!isCollapsed && (
                        <div className="ml-4 animate-in fade-in slide-in-from-left-2">
                            <h1 className="text-2xl font-extrabold whitespace-nowrap tracking-wide text-white">
                                TRANSPORT
                            </h1>
                            <p className="text-[10px] uppercase tracking-[0.18em] text-blue-100">
                                Management System
                            </p>
                        </div>
                    )}
                </div>
                <nav className="flex-1 p-3 space-y-1 overflow-y-auto custom-scrollbar relative z-10 bg-slate-50/60">
                    {menuItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            title={isCollapsed ? item.label : ""}
                            className={`flex items-center ${isCollapsed ? 'justify-center px-0' : 'px-4'} py-3 rounded-xl transition-all duration-200 group relative overflow-hidden border ${location.pathname === item.path
                                ? 'bg-white border-blue-200 text-blue-700 shadow-sm font-semibold'
                                : 'border-transparent text-slate-600 hover:bg-white hover:border-slate-200 hover:text-slate-900 font-medium'
                                }`}
                        >
                            <span className={`${isCollapsed ? 'mr-0' : 'mr-3'} transition-all duration-200 ${location.pathname === item.path ? 'text-blue-600' : 'text-slate-400 group-hover:text-slate-600'
                                }`}>
                                {item.icon}
                            </span>
                            {!isCollapsed && <span className="truncate text-sm animate-in fade-in slide-in-from-left-2">{item.label}</span>}
                        </Link>
                    ))}
                </nav>
                <div className={`p-3 border-t border-slate-200 bg-white relative z-10 ${isCollapsed ? 'flex justify-center' : ''}`}>
                    <div className={`flex items-center ${isCollapsed ? 'justify-center w-12 h-12' : 'gap-3 px-4 py-3 bg-slate-50'} rounded-2xl border border-slate-200 transition-all duration-300`}>
                        <div className={`w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center text-blue-700 font-bold text-sm border border-blue-200 flex-shrink-0 transition-all duration-300 ${isCollapsed ? 'scale-110' : ''}`}>
                            {(adminInfo.name || adminInfo.username || 'U').charAt(0).toUpperCase()}
                        </div>
                        {!isCollapsed && (
                            <>
                                <div className="flex-1 min-w-0 animate-in fade-in duration-300">
                                    <p className="text-[11px] font-bold text-slate-800 truncate leading-tight">
                                        {adminInfo.name || adminInfo.username || 'User'}
                                    </p>
                                    <p className="text-[9px] uppercase font-semibold text-slate-500 truncate tracking-tighter">
                                        {adminInfo.role || (adminInfo.roles && adminInfo.roles.join(', ')) || 'Guest'}
                                    </p>
                                </div>
                                <button
                                    onClick={handleLogout}
                                    title="Logout"
                                    className="p-1.5 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-all duration-200 group"
                                >
                                    <LogOut size={16} className="group-hover:scale-110 transition-transform" />
                                </button>
                            </>
                        )}
                    </div>
                </div>
            </aside>

            {/* Mobile Sidebar Overlay */}
            {isMobileMenuOpen && (
                <div
                    className="fixed inset-0 bg-black opacity-50 z-30 md:hidden"
                    onClick={() => setIsMobileMenuOpen(false)}
                ></div>
            )}

            {/* Sidebar (Mobile) */}
            <aside className={`fixed inset-y-0 left-0 w-64 bg-white shadow-xl border-r border-slate-200 flex flex-col z-40 transform transition-transform duration-300 md:hidden overflow-hidden ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'
                }`}>
                <div className="min-h-24 flex justify-between items-center px-5 bg-gradient-to-r from-blue-600 to-blue-700 relative z-10 border-b border-blue-700/20">
                    <div className="flex items-center gap-3 min-w-0">
                        <img
                            src="/Gemini_Generated_Image_uu0hhduu0hhduu0h.png"
                            alt="Logo"
                            className="h-10 w-10 object-cover rounded-full border-2 border-white/80 shadow-sm"
                        />
                        <div className="min-w-0">
                            <h1 className="text-lg font-bold text-white truncate">TRANSPORT</h1>
                            <p className="text-[9px] uppercase tracking-[0.18em] text-blue-100 truncate">Management System</p>
                        </div>
                    </div>
                    <button onClick={() => setIsMobileMenuOpen(false)} className="text-blue-100 hover:text-white">
                        <X size={24} />
                    </button>
                </div>
                <nav className="flex-1 p-4 space-y-1 bg-slate-50/60 relative z-10">
                    {menuItems.map((item) => (
                        <Link
                            key={item.path}
                            to={item.path}
                            onClick={() => setIsMobileMenuOpen(false)}
                            className={`flex items-center px-4 py-3 rounded-xl border transition-colors ${location.pathname === item.path
                                ? 'bg-white border-blue-200 text-blue-700 font-semibold shadow-sm'
                                : 'border-transparent text-slate-600 hover:bg-white hover:border-slate-200 hover:text-slate-900'
                                }`}
                        >
                            <span className={`mr-3 ${location.pathname === item.path ? 'text-blue-600' : 'text-slate-400'}`}>{item.icon}</span>
                            <span className="truncate text-sm">{item.label}</span>
                        </Link>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <div className="flex-1 flex flex-col h-screen overflow-hidden relative bg-slate-50 w-full">
                {/* Mobile Header */}
                <header className="md:hidden bg-white shadow-sm border-b border-slate-200 h-16 flex items-center justify-between px-4 z-20">
                    <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 text-slate-600 rounded-lg hover:bg-slate-100">
                        <Menu size={24} />
                    </button>
                    <h1 className="text-lg font-bold text-slate-800 truncate">Pydah Transport</h1>
                    <div className="w-10"></div> {/* Spacer for center alignment */}
                </header>

                <main className="flex-1 overflow-x-hidden overflow-y-auto p-6 md:p-8 scroll-smooth w-full">
                    {/* Removed max-w-7xl to allow full width as requested via "fit to screen" interpretation, 
                        or user can re-add container class if "fit to under screen" meant centered. 
                        Assuming full width fluid layout is desired for "professional" dashboard. */}
                    <div className="w-full max-w-[1600px] mx-auto">
                        {children}
                    </div>
                </main>
            </div>
        </div>
    );
};

export default Layout;