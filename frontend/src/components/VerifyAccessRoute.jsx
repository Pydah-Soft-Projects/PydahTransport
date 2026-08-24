import React, { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { ShieldOff } from 'lucide-react';
import { isAuthenticated } from '../utils/api';
import { hasPermission } from '../utils/permissions';
import { canUseOfflineVerify } from '../utils/qrVerification';

/**
 * /verify access rules:
 * 1. Logged in + qr_verification (or admin) → allow
 * 2. Logged in WITHOUT permission → Access Denied
 * 3. Not logged in, but this device was synced by authorized staff → allow offline scan
 * 4. Otherwise → login
 */
const VerifyAccessRoute = ({ children }) => {
    const location = useLocation();
    const [status, setStatus] = useState('loading'); // loading | allow | deny | no_permission

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            if (isAuthenticated()) {
                if (hasPermission('qr_verification')) {
                    if (!cancelled) setStatus('allow');
                } else if (!cancelled) {
                    setStatus('no_permission');
                }
                return;
            }

            try {
                const ready = await canUseOfflineVerify();
                if (!cancelled) setStatus(ready ? 'allow' : 'deny');
            } catch {
                if (!cancelled) setStatus('deny');
            }
        };

        check();
        return () => { cancelled = true; };
    }, []);

    if (status === 'loading') {
        return (
            <div className="min-h-screen bg-[#EAF3FF] flex items-center justify-center px-4">
                <div className="text-center">
                    <div className="w-9 h-9 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                    <p className="text-xs font-semibold text-slate-500 mt-3">Opening verification…</p>
                </div>
            </div>
        );
    }

    if (status === 'no_permission') {
        return (
            <div className="min-h-screen bg-[#EAF3FF] flex items-center justify-center px-4">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 max-w-md w-full text-center">
                    <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center mx-auto">
                        <ShieldOff size={22} />
                    </div>
                    <h1 className="text-lg font-bold text-slate-900 mt-4">Access Denied</h1>
                    <p className="text-sm text-slate-600 mt-2 leading-relaxed">
                        Your account does not have permission for QR Verification.
                        Ask an administrator to enable the <span className="font-semibold">QR Verification</span> permission.
                    </p>
                    <div className="flex flex-col sm:flex-row gap-2 mt-5 justify-center">
                        <Link
                            to="/dashboard"
                            className="px-4 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700"
                        >
                            Go to Dashboard
                        </Link>
                        <Link
                            to="/"
                            className="px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 text-xs font-bold hover:bg-slate-50"
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
