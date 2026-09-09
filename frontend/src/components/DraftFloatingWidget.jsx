import React, { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { GripVertical, ChevronDown, ChevronUp, X, ArrowRight } from 'lucide-react';
import Modal from './Modal';
import { apiFetch, API_BASE } from '../utils/api';

const DRAFT_STORAGE_KEY = 'pydah_route_transfer_drafts';

const DraftFloatingWidget = ({ onFinalizeAllClick }) => {
    const navigate = useNavigate();
    const location = useLocation();
    const [draftQueue, setDraftQueue] = useState([]);
    const [draftWidgetPos, setDraftWidgetPos] = useState({ x: null, y: null });
    const [isDraftDragging, setIsDraftDragging] = useState(false);
    const [draftDragOffset, setDraftDragOffset] = useState({ x: 0, y: 0 });
    const [isDraftMinimized, setIsDraftMinimized] = useState(false);

    // Modal state for direct finalization from other pages (like /fleet)
    const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [statusMessage, setStatusMessage] = useState({ text: '', type: '' });

    const fetchDrafts = () => {
        try {
            const saved = localStorage.getItem(DRAFT_STORAGE_KEY);
            setDraftQueue(saved ? JSON.parse(saved) : []);
        } catch {
            setDraftQueue([]);
        }
    };

    useEffect(() => {
        fetchDrafts();
        const handleStorageChange = () => fetchDrafts();
        window.addEventListener('storage', handleStorageChange);
        // Custom event for same-window updates
        window.addEventListener('pydah_draft_updated', handleStorageChange);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('pydah_draft_updated', handleStorageChange);
        };
    }, []);

    const clearDraftQueue = () => {
        setDraftQueue([]);
        try {
            localStorage.removeItem(DRAFT_STORAGE_KEY);
            window.dispatchEvent(new Event('pydah_draft_updated'));
            window.dispatchEvent(new Event('storage'));
        } catch { /* ignore */ }
    };

    const removeDraftItem = (id) => {
        const next = draftQueue.filter((item) => item.id !== id);
        setDraftQueue(next);
        try {
            localStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(next));
            window.dispatchEvent(new Event('pydah_draft_updated'));
            window.dispatchEvent(new Event('storage'));
        } catch { /* ignore */ }
    };

    const handleDraftDragStart = (e) => {
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        const rect = e.currentTarget.closest('.draggable-draft-widget')?.getBoundingClientRect();
        if (rect) {
            setDragOffset({
                x: clientX - rect.left,
                y: clientY - rect.top
            });
            setIsDraftDragging(true);
        }
    };

    const setDragOffset = (offset) => setDraftDragOffset(offset);

    useEffect(() => {
        const handleDragMove = (e) => {
            if (!isDraftDragging) return;
            const clientX = e.touches ? e.touches[0].clientX : e.clientX;
            const clientY = e.touches ? e.touches[0].clientY : e.clientY;
            setDraftWidgetPos({
                x: Math.max(10, Math.min(window.innerWidth - 350, clientX - draftDragOffset.x)),
                y: Math.max(10, Math.min(window.innerHeight - 100, clientY - draftDragOffset.y))
            });
        };

        const handleDragEnd = () => setIsDraftDragging(false);

        if (isDraftDragging) {
            window.addEventListener('mousemove', handleDragMove);
            window.addEventListener('mouseup', handleDragEnd);
            window.addEventListener('touchmove', handleDragMove);
            window.addEventListener('touchend', handleDragEnd);
        }
        return () => {
            window.removeEventListener('mousemove', handleDragMove);
            window.removeEventListener('mouseup', handleDragEnd);
            window.removeEventListener('touchmove', handleDragMove);
            window.removeEventListener('touchend', handleDragEnd);
        };
    }, [isDraftDragging, draftDragOffset]);

    const handleFinalizeClick = () => {
        if (onFinalizeAllClick) {
            onFinalizeAllClick();
            return;
        }

        if (location.pathname === '/routes') {
            window.dispatchEvent(new CustomEvent('pydah_open_finalize_modal'));
        } else {
            setIsConfirmModalOpen(true);
        }
    };

    const executeBatchTransferDirectly = async () => {
        setIsSubmitting(true);
        setStatusMessage({ text: '', type: '' });
        try {
            const adminInfo = JSON.parse(localStorage.getItem('adminInfo') || '{}');
            const performedBy = adminInfo.username || adminInfo.name || 'Administrator';
            const res = await apiFetch(`${API_BASE}/routes/batch-transfer`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    draftQueue,
                    performedBy
                })
            });

            const data = await res.json();
            if (res.ok) {
                clearDraftQueue();
                setIsConfirmModalOpen(false);
                setStatusMessage({ text: data.message || 'Batch transfers finalized successfully!', type: 'success' });
                window.location.reload();
            } else {
                setStatusMessage({ text: data.message || 'Batch transfer validation failed.', type: 'error' });
            }
        } catch (err) {
            console.error('Error finalizing batch transfers:', err);
            setStatusMessage({ text: err.message || 'Error executing batch transfers.', type: 'error' });
        } finally {
            setIsSubmitting(false);
        }
    };

    if (draftQueue.length === 0) return null;

    return (
        <>
            <div
                className="draggable-draft-widget fixed z-50 transition-shadow select-none"
                style={
                    draftWidgetPos.x !== null
                        ? { left: `${draftWidgetPos.x}px`, top: `${draftWidgetPos.y}px` }
                        : { bottom: '1.5rem', right: '1.5rem' }
                }
            >
                {isDraftMinimized ? (
                    /* Minimized Floating Pill */
                    <div className="bg-blue-50/95 backdrop-blur-md border border-blue-300 shadow-xl rounded-full px-3.5 py-2 flex items-center gap-2 text-xs text-blue-950 font-extrabold hover:bg-blue-100 transition-all">
                        <div
                            onMouseDown={handleDraftDragStart}
                            onTouchStart={handleDraftDragStart}
                            className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-0.5"
                            title="Drag to move"
                        >
                            <GripVertical size={14} />
                        </div>
                        <div onClick={() => setIsDraftMinimized(false)} className="flex items-center gap-1.5 cursor-pointer">
                            <span>⚡ Draft ({draftQueue.length})</span>
                            <ChevronUp size={14} className="text-blue-700" />
                        </div>
                    </div>
                ) : (
                    /* Compact Card Widget */
                    <div className="w-[340px] max-w-[92vw] bg-blue-50/95 backdrop-blur-xl border border-blue-200 shadow-2xl rounded-2xl p-3.5 text-slate-800 space-y-2.5">
                        {/* Draggable Header */}
                        <div className="flex items-center justify-between gap-2 pb-2 border-b border-blue-200/80">
                            <div className="flex items-center gap-2 min-w-0">
                                <div
                                    onMouseDown={handleDraftDragStart}
                                    onTouchStart={handleDraftDragStart}
                                    className="cursor-grab active:cursor-grabbing text-slate-400 hover:text-slate-600 p-0.5 shrink-0"
                                    title="Click and drag to move panel"
                                >
                                    <GripVertical size={16} />
                                </div>
                                <span className="font-extrabold text-xs text-blue-950 uppercase tracking-wider truncate">⚡ Draft Mode</span>
                                <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 text-[10px] font-extrabold border border-amber-300 shrink-0">
                                    {draftQueue.length}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={() => setIsDraftMinimized(true)}
                                className="text-slate-400 hover:text-slate-700 p-1 hover:bg-blue-100 rounded-lg transition-colors cursor-pointer shrink-0"
                                title="Minimize draft panel"
                            >
                                <ChevronDown size={15} />
                            </button>
                        </div>

                        {/* Queued Action Cards Scrollable List — NO TEXT TRUNCATION */}
                        <div className="space-y-2 max-h-56 overflow-y-auto custom-scrollbar pr-1">
                            {draftQueue.map((item, index) => {
                                const isStage = item.type === 'stage';
                                const isPassenger = item.type === 'passenger';
                                const isBusAttach = item.type === 'bus_attach';
                                const isBusDetach = item.type === 'bus_detach';

                                return (
                                    <div
                                        key={item.id || index}
                                        className="bg-white border border-blue-200/90 rounded-xl p-2.5 text-xs flex items-start justify-between gap-2 shadow-xs"
                                    >
                                        <div className="min-w-0 flex-1 space-y-1">
                                            <div className="flex items-center gap-1.5 text-[10px] flex-wrap">
                                                <span className={`px-1.5 py-0.2 rounded font-mono text-[9px] uppercase font-bold border ${
                                                    isBusAttach ? 'bg-emerald-100 text-emerald-800 border-emerald-300' :
                                                    isBusDetach ? 'bg-rose-100 text-rose-800 border-rose-300' :
                                                    isStage ? 'bg-blue-100 text-blue-800 border-blue-200' :
                                                    'bg-purple-100 text-purple-800 border-purple-200'
                                                }`}>
                                                    {isBusAttach ? 'Bus Attachment' : isBusDetach ? 'Bus Detachment' : isStage ? 'Stage Migration' : 'Passenger Transfer'}
                                                </span>
                                                {(isStage || isPassenger) && (
                                                    <span className="font-extrabold text-amber-800 bg-amber-50 px-1.5 py-0.2 rounded border border-amber-200">
                                                        {item.passengerCount} pass.
                                                    </span>
                                                )}
                                                {isBusAttach && (
                                                    <span className="font-extrabold text-emerald-800 bg-emerald-50 px-1.5 py-0.2 rounded border border-emerald-200">
                                                        +{item.capacity} Seats
                                                    </span>
                                                )}
                                                {isBusDetach && (
                                                    <span className="font-extrabold text-rose-800 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                                                        -{item.capacity} Seats
                                                    </span>
                                                )}
                                            </div>
                                            <p className="font-bold text-slate-900 text-[11px] whitespace-normal leading-tight">
                                                {isBusAttach || isBusDetach ? `Bus ${item.busNumber}` : isStage ? `Stage: "${item.stageName}"` : `${item.passengerCount} Selected Passenger(s)`}
                                            </p>
                                            <div className="text-[10px] text-slate-600 font-medium whitespace-normal leading-tight">
                                                {isBusAttach && (
                                                    <>
                                                        <span className="text-slate-400">Attach To:</span> <span className="font-semibold text-blue-900">{item.destinationRouteName || item.destinationRouteId}</span>
                                                        {item.entryDate && <span className="text-slate-500 ml-1">({item.entryDate})</span>}
                                                    </>
                                                )}
                                                {isBusDetach && (
                                                    <>
                                                        <span className="text-slate-400">Detach From:</span> <span className="font-semibold text-rose-900">{item.sourceRouteName || item.sourceRouteId}</span>
                                                        {item.exitDate && <span className="text-slate-500 ml-1">({item.exitDate})</span>}
                                                    </>
                                                )}
                                                {(isStage || isPassenger) && (
                                                    <>
                                                        <span className="text-slate-400">From:</span> <span className="font-semibold text-slate-800">{item.sourceRouteName || item.sourceRouteId}</span>
                                                        <br />
                                                        <span className="text-slate-400">To:</span> <span className="font-semibold text-blue-900">{item.destinationRouteName || item.destinationRouteId}</span> {item.destinationStageName ? `(${item.destinationStageName})` : ''}
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            onClick={() => removeDraftItem(item.id)}
                                            className="text-slate-400 hover:text-red-600 hover:bg-red-50 p-1 rounded-lg transition-colors cursor-pointer shrink-0 mt-0.5"
                                            title="Remove item"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Panel Action Buttons */}
                        <div className="pt-2 border-t border-blue-200/80 flex items-center justify-between gap-2">
                            <button
                                type="button"
                                onClick={clearDraftQueue}
                                className="px-3 py-1.5 rounded-xl text-xs font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-slate-100 transition-all border border-slate-300 cursor-pointer shadow-xs"
                            >
                                Discard
                            </button>
                            <button
                                type="button"
                                onClick={handleFinalizeClick}
                                className="px-3.5 py-1.5 rounded-xl bg-blue-900 hover:bg-blue-800 text-white font-extrabold text-xs shadow-md transition-all cursor-pointer flex items-center gap-1 active:scale-95"
                            >
                                <span>Finalize All ({draftQueue.length})</span>
                                <ArrowRight size={13} />
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* Confirmation Modal when finalizing directly from Fleet or other pages */}
            <Modal
                isOpen={isConfirmModalOpen}
                onClose={() => setIsConfirmModalOpen(false)}
                title={`Finalize All Pending Draft Actions (${draftQueue.length})`}
            >
                <div className="space-y-4 text-xs">
                    {statusMessage.text && (
                        <div className={`p-3 rounded-xl border font-semibold ${statusMessage.type === 'success' ? 'bg-green-50 border-green-200 text-green-800' : 'bg-red-50 border-red-200 text-red-800'}`}>
                            {statusMessage.text}
                        </div>
                    )}
                    <p className="text-slate-600 font-medium leading-relaxed">
                        You are about to execute <strong>{draftQueue.length} queued action(s)</strong> in batch. This will update bus assignments, passenger route allocations, and trigger automated notifications.
                    </p>

                    <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2 max-h-52 overflow-y-auto custom-scrollbar">
                        {draftQueue.map((item, idx) => {
                            const isBusAttach = item.type === 'bus_attach';
                            const isBusDetach = item.type === 'bus_detach';
                            const isStage = item.type === 'stage';

                            let title = '';
                            let subtitle = '';

                            if (isBusAttach) {
                                title = `Bus Attachment: Bus ${item.busNumber} (+${item.capacity} seats)`;
                                subtitle = `Target Route: ${item.destinationRouteName || item.destinationRouteId}`;
                            } else if (isBusDetach) {
                                title = `Bus Detachment: Bus ${item.busNumber} (-${item.capacity} seats)`;
                                subtitle = `Detaching From: ${item.sourceRouteName || item.sourceRouteId}`;
                            } else if (isStage) {
                                title = `Stage Transfer: "${item.stageName}" (${item.passengerCount} passengers)`;
                                subtitle = `From: ${item.sourceRouteName} ➔ To: ${item.destinationRouteName}`;
                            } else {
                                title = `Passenger Transfer (${item.passengerCount} passengers)`;
                                subtitle = `From: ${item.sourceRouteName} ➔ To: ${item.destinationRouteName} (${item.destinationStageName})`;
                            }

                            return (
                                <div key={item.id || idx} className="p-2.5 bg-white border border-slate-100 rounded-lg text-xs space-y-1">
                                    <div className="flex justify-between font-bold text-slate-800">
                                        <span>{idx + 1}. {title}</span>
                                    </div>
                                    <p className="text-[11px] text-slate-500 font-medium">
                                        {subtitle}
                                    </p>
                                </div>
                            );
                        })}
                    </div>

                    <div className="flex justify-end gap-3 pt-2">
                        <button
                            type="button"
                            onClick={() => setIsConfirmModalOpen(false)}
                            className="px-4 py-2.5 rounded-xl border border-slate-300 text-slate-700 font-bold hover:bg-slate-50 transition-all cursor-pointer"
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            onClick={executeBatchTransferDirectly}
                            disabled={isSubmitting}
                            className="px-5 py-2.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold transition-all shadow-md flex items-center gap-2 cursor-pointer disabled:opacity-50"
                        >
                            {isSubmitting ? (
                                <>
                                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin shrink-0" />
                                    <span>Finalizing Actions...</span>
                                </>
                            ) : (
                                <span>Confirm & Finalize All</span>
                            )}
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default DraftFloatingWidget;
