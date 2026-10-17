import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, AlertCircle, ArrowLeft, ExternalLink } from 'lucide-react';
import ForgotPasswordModal from '../components/ForgotPasswordModal';
import PwaInstallBanner from '../components/PwaInstallBanner';
import { isAuthenticated } from '../utils/api';

const Login = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    // Directly initialize isSSOProcessing from search params to avoid initial flash of manual login form
    const [isSSOProcessing, setIsSSOProcessing] = useState(() => {
        if (typeof window !== 'undefined') {
            const params = new URLSearchParams(window.location.search);
            return Boolean(params.get('token'));
        }
        return false;
    });
    const [isForgotPasswordOpen, setIsForgotPasswordOpen] = useState(false);
    const [showPassword, setShowPassword] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();

    const nextPath = location.state?.next || '/dashboard';

    // Preload portal-switcher.js early if an incoming SSO token is present in the URL
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.get('token')) {
            const SCRIPT_ID = 'pydah-portal-switcher-cdn';
            if (!document.getElementById(SCRIPT_ID)) {
                const script = document.createElement('script');
                script.id = SCRIPT_ID;
                script.src = 'https://crm.pydah.edu.in/portal-switcher.js';
                script.async = true;
                document.body.appendChild(script);
            }
        }
    }, []);

    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const token = params.get('token');

        if (token) {
            setIsSSOProcessing(true);
            // Incoming SSO login takes priority - clear existing session
            localStorage.removeItem('adminInfo');
            localStorage.removeItem('isSSO');
            localStorage.removeItem('crmUrl');
            sessionStorage.clear();

            // Ensure portal-switcher.js is loaded so <pydah-sso-loader /> is registered
            const SCRIPT_ID = 'pydah-portal-switcher-cdn';
            if (!document.getElementById(SCRIPT_ID)) {
                const script = document.createElement('script');
                script.id = SCRIPT_ID;
                script.src = 'https://crm.pydah.edu.in/portal-switcher.js';
                script.async = true;
                document.body.appendChild(script);
            }

            handleSSOLogin(token);
            return;
        } else {
            setIsSSOProcessing(false);
        }

        // Already logged in → skip login form (works after app reopen)
        if (isAuthenticated()) {
            navigate(nextPath === '/login' ? '/dashboard' : nextPath, { replace: true });
            return;
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.search]);

    const handleSSOLogin = async (ssoToken) => {
        setIsSSOProcessing(true);
        setError('');

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/sso-session`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ ssoToken }),
            });

            const data = await response.json();

            if (response.ok) {
                const params = new URLSearchParams(location.search);
                const crmUrl = params.get('crmUrl') || params.get('returnUrl') || params.get('redirectUrl') || import.meta.env.VITE_CRM_URL || 'https://crm.pydah.edu.in';
                const sessionData = {
                    ...data,
                    isSSO: true,
                    crmUrl
                };
                localStorage.setItem('adminInfo', JSON.stringify(sessionData));
                localStorage.setItem('isSSO', 'true');
                localStorage.setItem('crmUrl', crmUrl);
                window.dispatchEvent(new Event('auth-change'));
                navigate('/dashboard');
            } else {
                setError(data.message || 'SSO authentication failed. Your access token may have expired.');
            }
        } catch (err) {
            console.error('SSO Error:', err);
            setError('Unable to verify SSO session with the Central Gateway. Please try normal login.');
        }
    };

    const handleSwitchToNormalLogin = () => {
        setError('');
        setIsSSOProcessing(false);
        navigate('/login', { replace: true });
    };

    const handleReturnToCrm = () => {
        const params = new URLSearchParams(location.search);
        const crmUrl = params.get('crmUrl') || params.get('returnUrl') || params.get('redirectUrl') || import.meta.env.VITE_CRM_URL || 'https://crm.pydah.edu.in';
        window.location.href = crmUrl;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setError('');

        if (!navigator.onLine) {
            setError('You are offline. Connect to the internet to log in.');
            return;
        }

        setIsLoading(true);

        try {
            const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json();

            if (response.ok) {
                const sessionData = {
                    ...data,
                    isSSO: false
                };
                localStorage.setItem('adminInfo', JSON.stringify(sessionData));
                localStorage.removeItem('isSSO');
                localStorage.removeItem('crmUrl');
                window.dispatchEvent(new Event('auth-change'));
                navigate(nextPath === '/login' ? '/dashboard' : nextPath);
            } else {
                setError(data.message || 'Login failed');
            }
        } catch (err) {
            setError(
                navigator.onLine
                    ? 'Something went wrong. Please try again.'
                    : 'You are offline. Connect to the internet to log in.'
            );
        } finally {
            setIsLoading(false);
        }
    };

    if (isSSOProcessing && !error) {
        return <pydah-sso-loader />;
    }

    return (
        <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4 relative overflow-hidden font-inter">
            <PwaInstallBanner variant="overlay" />
            <div className="absolute inset-0 z-0 bg-slate-950">
                <img
                    src="/Transport_background.jpg"
                    alt="Pydah Transport Background"
                    className="w-full h-full object-cover opacity-80"
                />
                <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/30 to-transparent"></div>
            </div>

            <div className="bg-white p-8 rounded-2xl shadow-2xl w-full max-w-md relative z-10 border border-slate-200">
                <button
                    onClick={() => navigate('/')}
                    className="absolute top-4 left-4 text-slate-400 hover:text-slate-800 transition-colors p-2 rounded-full hover:bg-slate-100"
                    title="Back to Home"
                    type="button"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                    </svg>
                </button>

                {/* ========================================================================= */}
                {/* 1. DEDICATED SSO AUTHENTICATION & ERROR STATE                             */}
                {/* ========================================================================= */}
                {isSSOProcessing ? (
                    <div className="text-center py-4">
                        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-50 text-red-600 mb-4 ring-8 ring-red-50/50">
                            <AlertCircle className="w-8 h-8" />
                        </div>
                        <h2 className="text-2xl font-bold text-slate-900 mb-2">SSO Sign-In Failed</h2>
                        <p className="text-slate-600 text-sm mb-6 leading-relaxed">
                            {error}
                        </p>

                        <div className="space-y-3 pt-2">
                            <button
                                type="button"
                                onClick={handleSwitchToNormalLogin}
                                className="w-full bg-slate-900 hover:bg-slate-800 text-white font-medium py-3 px-4 rounded-xl transition-all shadow-md hover:shadow-lg flex items-center justify-center gap-2"
                            >
                                <ArrowLeft className="w-4 h-4" />
                                Continue with Username & Password
                            </button>

                            <button
                                type="button"
                                onClick={handleReturnToCrm}
                                className="w-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium py-2.5 px-4 rounded-xl transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                <ExternalLink className="w-4 h-4" />
                                Return to Central Portal
                            </button>
                        </div>
                    </div>
                ) : (
                    /* ========================================================================= */
                    /* 2. STANDARD MANUAL LOGIN (USERNAME / PASSWORD)                            */
                    /* ========================================================================= */
                    <div>
                        <div className="text-center mb-8 mt-2">
                            <h1 className="text-3xl font-bold text-slate-900 mb-2">Welcome Back</h1>
                            <p className="text-slate-500 text-sm font-medium">Sign in to access the transport dashboard</p>
                        </div>

                        {error && (
                            <div className="bg-red-50 border-l-4 border-red-500 text-red-700 p-4 rounded-md mb-6 text-sm flex items-center">
                                <span className="mr-2">⚠️</span> {error}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-6">
                            <div>
                                <label className="block text-slate-700 text-sm font-bold mb-2" htmlFor="username">
                                    Username
                                </label>
                                <input
                                    type="text"
                                    id="username"
                                    className="w-full px-4 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white text-slate-800"
                                    placeholder="Enter your admin ID"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    required
                                />
                            </div>
                            <div>
                                <div className="flex justify-between items-center mb-2">
                                    <label className="block text-slate-700 text-sm font-bold" htmlFor="password">
                                        Password
                                    </label>
                                    <button
                                        type="button"
                                        onClick={() => setIsForgotPasswordOpen(true)}
                                        className="text-xs text-slate-600 hover:text-slate-900 font-medium hover:underline"
                                    >
                                        Forgot password?
                                    </button>
                                </div>
                                <div className="relative">
                                    <input
                                        type={showPassword ? "text" : "password"}
                                        id="password"
                                        className="w-full pl-4 pr-12 py-3 rounded-lg border border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-500 focus:border-transparent transition-all bg-slate-50 focus:bg-white text-slate-800"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword(!showPassword)}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors p-1"
                                    >
                                        {showPassword ? (
                                            <EyeOff className="h-5 w-5" />
                                        ) : (
                                            <Eye className="h-5 w-5" />
                                        )}
                                    </button>
                                </div>
                            </div>
                            <button
                                type="submit"
                                disabled={isLoading}
                                className={`w-full text-white font-bold py-3 px-4 rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-slate-500 transform transition-all flex items-center justify-center gap-2 ${isLoading
                                    ? 'bg-slate-700 cursor-not-allowed'
                                    : 'bg-slate-900 hover:bg-slate-800 hover:shadow-lg active:scale-95'
                                    }`}
                            >
                                {isLoading ? (
                                    <>
                                        <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Signing In...
                                    </>
                                ) : (
                                    'Sign In'
                                )}
                            </button>
                        </form>
                    </div>
                )}

                <div className="mt-8 text-center border-t border-slate-200 pt-6">
                    <p className="text-slate-400 text-xs font-medium">
                        Protected by Pydah Transport Security Systems
                    </p>
                </div>
            </div>

            <ForgotPasswordModal
                isOpen={isForgotPasswordOpen}
                onClose={() => setIsForgotPasswordOpen(false)}
            />
        </div>
    );
};

export default Login;
