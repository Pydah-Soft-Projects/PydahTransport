import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { isAuthenticated } from '../utils/api';
import { canUseOfflineVerify } from '../utils/qrVerification';

/**
 * Allows /verify when:
 * - user has a saved login session, OR
 * - device previously synced passenger data (works offline after app reopen)
 */
const VerifyAccessRoute = ({ children }) => {
    const location = useLocation();
    const [status, setStatus] = useState('loading'); // loading | allow | deny

    useEffect(() => {
        let cancelled = false;

        const check = async () => {
            if (isAuthenticated()) {
                if (!cancelled) setStatus('allow');
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

    if (status === 'deny') {
        return <Navigate to="/login" replace state={{ from: location.pathname, next: '/verify' }} />;
    }

    return children;
};

export default VerifyAccessRoute;
