import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Download, X, Smartphone, Monitor } from 'lucide-react';
import {
    clearDeferredInstallPrompt,
    getDeferredInstallPrompt,
    startInstallCapture,
    subscribeInstallPrompt,
} from '../pwaInstallPrompt';

const isStandalone = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(display-mode: standalone)').matches
        || window.navigator.standalone === true;
};

const isIos = () => {
    if (typeof navigator === 'undefined') return false;
    return /iphone|ipad|ipod/i.test(navigator.userAgent);
};

const isIosSafari = () => {
    if (!isIos()) return false;
    const ua = navigator.userAgent;
    return /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
};

const isDesktopBrowser = () => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(min-width: 768px)').matches && !isIos();
};

const PwaInstallBanner = ({ appName = 'Pydah Transport', variant = 'overlay' }) => {
    const [visible, setVisible] = useState(false);
    const [canInstall, setCanInstall] = useState(false);
    const [showIosHint, setShowIosHint] = useState(false);
    const [showDesktopHint, setShowDesktopHint] = useState(false);
    const [installing, setInstalling] = useState(false);
    const deferredPromptRef = useRef(getDeferredInstallPrompt());

    useEffect(() => {
        // Hide forever only when already running as installed app
        if (isStandalone()) return undefined;

        // Clear any old dismiss flag from earlier versions
        try {
            localStorage.removeItem('pydah_transport_pwa_banner_dismissed');
        } catch {
            // ignore
        }

        const stopCapture = startInstallCapture();

        if (isIosSafari()) {
            setShowIosHint(true);
            setVisible(true);
            return stopCapture;
        }

        const existingPrompt = getDeferredInstallPrompt();
        if (existingPrompt) {
            deferredPromptRef.current = existingPrompt;
            setCanInstall(true);
        } else {
            setShowDesktopHint(isDesktopBrowser());
        }

        setVisible(true);

        const unsubscribe = subscribeInstallPrompt((event) => {
            deferredPromptRef.current = event;
            setCanInstall(true);
            setShowDesktopHint(false);
            setVisible(true);
        });

        const onInstalled = () => {
            setVisible(false);
            setCanInstall(false);
            deferredPromptRef.current = null;
            clearDeferredInstallPrompt();
        };

        window.addEventListener('appinstalled', onInstalled);

        return () => {
            stopCapture();
            unsubscribe();
            window.removeEventListener('appinstalled', onInstalled);
        };
    }, []);

    // X only hides for this visit — next reload shows the banner again
    const dismiss = useCallback(() => {
        setVisible(false);
    }, []);

    const handleInstall = useCallback(async () => {
        const prompt = deferredPromptRef.current;
        if (!prompt) return;

        setInstalling(true);
        try {
            await prompt.prompt();
            const { outcome } = await prompt.userChoice;
            if (outcome === 'accepted') {
                setVisible(false);
            }
        } catch {
            // ignore
        } finally {
            setInstalling(false);
            if (deferredPromptRef.current === prompt) {
                deferredPromptRef.current = null;
                clearDeferredInstallPrompt();
                setCanInstall(false);
                if (!isStandalone()) setShowDesktopHint(isDesktopBrowser());
            }
        }
    }, []);

    const subtitle = () => {
        if (showIosHint) {
            return 'Tap Share, then Add to Home Screen to install the app.';
        }
        if (canInstall) {
            return 'Tap Install for quick access from your desktop or home screen.';
        }
        if (showDesktopHint) {
            return 'Use the install icon in the address bar, or browser menu → Install app.';
        }
        return 'Install for quick access. Use your browser install option if no button appears.';
    };

    if (!visible || isStandalone()) return null;

    const shellClass = variant === 'overlay'
        ? 'fixed z-50 left-0 right-0 px-3 sm:px-4 md:px-6 bottom-3 sm:bottom-4 md:top-0 md:bottom-auto md:px-0 pb-[max(0px,env(safe-area-inset-bottom))]'
        : 'w-full shrink-0';

    const cardClass = variant === 'overlay'
        ? 'max-w-lg md:max-w-none mx-auto md:mx-0 rounded-2xl md:rounded-none shadow-xl md:shadow-md border border-white/10 md:border-blue-800/30 overflow-hidden'
        : 'border-b border-blue-800/30';

    return (
        <div className={shellClass} role="region" aria-label="Install app">
            <div className={`${cardClass} bg-gradient-to-r from-blue-700 to-blue-600 text-white`}>
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:gap-3 px-3 py-3 sm:px-4 sm:py-3">
                    <div className="flex items-start sm:items-center gap-2.5 sm:gap-3 flex-1 min-w-0">
                        <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl bg-white/15 flex items-center justify-center shrink-0">
                            {showIosHint ? <Smartphone size={18} /> : showDesktopHint && !canInstall ? <Monitor size={18} /> : <Download size={18} />}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-sm sm:text-base font-bold leading-tight">
                                Install {appName}
                            </p>
                            <p className="text-[11px] sm:text-xs text-blue-100 mt-0.5 leading-snug">
                                {subtitle()}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={dismiss}
                            aria-label="Dismiss install banner"
                            className="sm:hidden shrink-0 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0 w-full sm:w-auto">
                        {canInstall && (
                            <button
                                type="button"
                                onClick={handleInstall}
                                disabled={installing}
                                className="flex-1 sm:flex-none px-4 py-2.5 sm:py-2 rounded-xl sm:rounded-lg bg-white text-blue-700 text-xs sm:text-sm font-bold hover:bg-blue-50 disabled:opacity-70 cursor-pointer shadow-sm"
                            >
                                {installing ? 'Installing…' : 'Install app'}
                            </button>
                        )}
                        <button
                            type="button"
                            onClick={dismiss}
                            aria-label="Dismiss install banner"
                            className="hidden sm:flex shrink-0 p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 cursor-pointer"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default PwaInstallBanner;
