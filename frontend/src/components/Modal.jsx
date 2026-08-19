import React, { useEffect } from 'react';

const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-lg', noScroll = false, fixedHeight = false }) => {
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
        } else {
            document.body.style.overflow = 'unset';
        }
        return () => {
            document.body.style.overflow = 'unset';
        };
    }, [isOpen]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-opacity">
            <div className={`bg-white rounded-2xl shadow-2xl w-full ${maxWidth} transform transition-all scale-100 flex flex-col ${fixedHeight ? 'h-[92vh]' : (noScroll ? '' : 'max-h-[90vh]')}`} style={{ transition: 'max-width 0.3s ease' }}>
                <div className="flex justify-between items-center px-6 py-4 border-b border-gray-100 shrink-0">
                    <h3 className="text-xl font-bold text-gray-800">{title}</h3>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 p-2 rounded-full hover:bg-gray-100 transition-colors"
                    >
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                </div>
                <div className={`px-6 py-5 ${fixedHeight ? 'flex-1 overflow-hidden' : (noScroll ? 'overflow-visible' : 'overflow-y-auto custom-scrollbar')}`}>
                    {children}
                </div>
            </div>
        </div>
    );
};

export default Modal;
