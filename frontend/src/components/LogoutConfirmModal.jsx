import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { LogOut, X, Loader2 } from 'lucide-react';

const LogoutConfirmModal = ({
    isOpen,
    onClose,
    onConfirm,
    isSSO = false,
    crmUrl = 'https://crm.pydah.edu.in',
    userName = ''
}) => {
    const [isLoggingOut, setIsLoggingOut] = useState(false);

    const activeIsSSO = Boolean(
        isSSO ||
        (typeof window !== 'undefined' && (
            localStorage.getItem('isSSO') === 'true' ||
            JSON.parse(localStorage.getItem('adminInfo') || '{}')?.isSSO
        ))
    );

    useEffect(() => {
        if (!isOpen) {
            setIsLoggingOut(false);
            return;
        }

        const handleKeyDown = (e) => {
            if (e.key === 'Escape' && !isLoggingOut) {
                onClose();
            }
        };

        const prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        window.addEventListener('keydown', handleKeyDown);

        return () => {
            document.body.style.overflow = prevOverflow;
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [isOpen, isLoggingOut, onClose]);

    if (!isOpen || typeof document === 'undefined') return null;

    const handleConfirmClick = async () => {
        try {
            setIsLoggingOut(true);
            if (onConfirm) {
                await onConfirm();
            }
        } catch (error) {
            console.error('Logout error:', error);
            setIsLoggingOut(false);
        }
    };

    return createPortal(
        <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity animate-in fade-in duration-200"
            onClick={(e) => {
                if (e.target === e.currentTarget && !isLoggingOut) {
                    onClose();
                }
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="logout-modal-title"
        >
            <div
                className="rounded-2xl shadow-2xl w-full max-w-md border overflow-hidden transform transition-all animate-in zoom-in-95 duration-200"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header with close button */}
                <div className="flex items-center justify-between px-6 pt-5 pb-2">
                    <div className="flex items-center gap-3">
                        <div 
                            className="w-11 h-11 rounded-2xl flex items-center justify-center shrink-0 shadow-sm"
                            style={{ backgroundColor: 'var(--danger-light, #fee2e2)', color: 'var(--danger, #dc2626)' }}
                        >
                            <LogOut size={20} />
                        </div>
                        <div>
                            <h3 id="logout-modal-title" className="text-lg font-bold leading-tight" style={{ color: 'var(--text-primary)' }}>
                                Confirm Sign Out
                            </h3>
                            <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
                                {userName ? `Signed in as ${userName}` : 'Are you sure you want to log out?'}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isLoggingOut}
                        className="p-1.5 rounded-xl hover:bg-black/5 transition-colors disabled:opacity-50"
                        style={{ color: 'var(--text-muted)' }}
                        aria-label="Close dialog"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="px-6 py-4">
                    <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                        Are you sure you want to log out of the{' '}
                        <span className="font-semibold" style={{ color: 'var(--text-primary)' }}>Transport Management Portal</span>?
                    </p>
                </div>

                {/* Footer Buttons */}
                <div className="px-6 py-4 border-t flex items-center justify-end gap-3" style={{ backgroundColor: 'var(--background)', borderColor: 'var(--border)' }}>
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isLoggingOut}
                        className="px-4 py-2.5 rounded-xl border text-sm font-semibold transition-colors shadow-xs disabled:opacity-50 hover:bg-black/5"
                        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-strong)', color: 'var(--text-primary)' }}
                    >
                        Cancel
                    </button>

                    <button
                        type="button"
                        onClick={handleConfirmClick}
                        disabled={isLoggingOut}
                        className="px-5 py-2.5 rounded-xl text-white text-sm font-semibold transition-all shadow-sm flex items-center gap-2 focus:ring-4 disabled:opacity-75"
                        style={{ backgroundColor: 'var(--danger, #dc2626)' }}
                    >
                        {isLoggingOut ? (
                            <>
                                <Loader2 size={16} className="animate-spin shrink-0" />
                                <span>{activeIsSSO ? 'Redirecting to CRM...' : 'Logging Out...'}</span>
                            </>
                        ) : (
                            <>
                                <LogOut size={16} className="shrink-0" />
                                <span>{activeIsSSO ? 'Return to CRM' : 'Yes, Log Out'}</span>
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>,
        document.body
    );
};

export default LogoutConfirmModal;
