import React, { useEffect, useState } from 'react';
import { Navigate, useLocation, Link } from 'react-router-dom';
import { apiFetch } from '../utils/api';
import { ShieldOff } from 'lucide-react';

const VerifyAccessRoute = ({ children }) => {
    const location = useLocation();
    const [status, setStatus] = useState('loading'); // 'loading' | 'allow' | 'deny' | 'no_permission'

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            const raw = localStorage.getItem('adminInfo');
            if (!raw) {
                if (!cancelled) setStatus('deny');
                return;
            }

            try {
                const res = await apiFetch(`${import.meta.env.VITE_API_URL}/auth/me`);
                if (!res.ok) {
                    if (!cancelled) setStatus('deny');
                    return;
                }
                const data = await res.json();
                if (cancelled) return;

                const role = data.role;
                const permissions = Array.isArray(data.permissions) ? data.permissions : [];

                if (role === 'admin' || permissions.includes('qr_verification')) {
                    setStatus('allow');
                } else {
                    setStatus('no_permission');
                }
            } catch {
                if (!cancelled) setStatus('deny');
            }
        };

        check();
        return () => { cancelled = true; };
    }, []);

    if (status === 'loading') {
        return (
            <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--background)' }}>
                <div className="text-center">
                    <div className="w-9 h-9 border-2 border-t-transparent rounded-full animate-spin mx-auto" style={{ borderColor: 'var(--primary)', borderTopColor: 'transparent' }} />
                    <p className="text-xs font-semibold mt-3" style={{ color: 'var(--text-secondary)' }}>Opening verification…</p>
                </div>
            </div>
        );
    }

    if (status === 'no_permission') {
        return (
            <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: 'var(--background)' }}>
                <div className="rounded-2xl border shadow-sm p-6 max-w-md w-full text-center" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto" style={{ backgroundColor: 'var(--danger-light, #fee2e2)', color: 'var(--danger, #dc2626)' }}>
                        <ShieldOff size={22} />
                    </div>
                    <h1 className="text-lg font-bold mt-4" style={{ color: 'var(--text-primary)' }}>Access Denied</h1>
                    <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        Your account does not have permission for QR Verification.
                        Ask an administrator to enable the <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>QR Verification</span> permission.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 mt-5 justify-center">
                        <Link
                            to="/dashboard"
                            className="px-4 py-2.5 rounded-xl text-white text-xs font-bold transition-colors"
                            style={{ backgroundColor: 'var(--primary)' }}
                        >
                            Go to Dashboard
                        </Link>
                        <Link
                            to="/"
                            className="px-4 py-2.5 rounded-xl border text-xs font-bold hover:bg-black/5"
                            style={{ borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                        >
                            Home
                        </Link>
                    </div>
                </div>
            </div>
        );
    }

    if (status === 'deny') {
        return <Navigate to="/login" replace state={{ from: location.pathname, next: '/verify' }} />;
    }

    return children;
};

export default VerifyAccessRoute;
