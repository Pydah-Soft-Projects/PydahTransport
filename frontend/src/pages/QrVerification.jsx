import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import {
    ShieldCheck,
    Wifi,
    WifiOff,
    RefreshCw,
    Camera,
    CheckCircle2,
    XCircle,
    AlertTriangle,
    Loader2,
    User,
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import {
    createScanId,
    formatSyncTime,
    getOrCreateDeviceId,
    idbAddOfflineScan,
    idbCountPassengers,
    idbGetMeta,
    idbGetPassenger,
    idbGetPublicKey,
    idbGetUnsyncedScans,
    idbMarkScansSynced,
    idbPutAllPassengers,
    idbSavePublicKey,
    idbSetMeta,
    parseQrText,
    verifySignedPayload,
} from '../utils/qrVerification';

const QrVerification = () => {
    const academicYearOptions = getAcademicYearOptions();
    const [activeTab, setActiveTab] = useState('scan');
    const [online, setOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);
    const [lastSyncAt, setLastSyncAt] = useState(null);
    const [recordCount, setRecordCount] = useState(0);
    const [deviceId, setDeviceId] = useState('');
    const [academicYear, setAcademicYear] = useState(getDefaultAcademicYear());
    const [syncing, setSyncing] = useState(false);
    const [syncMessage, setSyncMessage] = useState('');
    const [scanning, setScanning] = useState(false);
    const [cameraError, setCameraError] = useState('');
    const [result, setResult] = useState(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [scanFlash, setScanFlash] = useState(false);

    const scannerRef = useRef(null);
    const scannerRunning = useRef(false);
    const handleScanRef = useRef(null);
    const readerHostRef = useRef(null);
    const scanSessionRef = useRef(0);
    const busyRef = useRef(false);

    const refreshMeta = useCallback(async () => {
        const [syncAt, count] = await Promise.all([
            idbGetMeta('lastSyncAt'),
            idbCountPassengers(),
        ]);
        setLastSyncAt(syncAt);
        setRecordCount(count);
    }, []);

    useEffect(() => {
        setDeviceId(getOrCreateDeviceId());
        refreshMeta();

        const onOnline = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [refreshMeta]);

    const clearReaderDom = useCallback(() => {
        const host = readerHostRef.current || document.getElementById('qr-reader');
        if (host) host.innerHTML = '';
    }, []);

    const stopScanner = useCallback(async () => {
        scanSessionRef.current += 1;
        const scanner = scannerRef.current;
        scannerRef.current = null;
        scannerRunning.current = false;
        setScanning(false);

        if (scanner) {
            try {
                const state = scanner.getState?.();
                if (state === 2 || state === 3) {
                    await scanner.stop();
                }
            } catch {
                // ignore
            }
            try {
                scanner.clear();
            } catch {
                // ignore
            }
        }

        const host = readerHostRef.current || document.getElementById('qr-reader');
        if (host) {
            host.querySelectorAll('video').forEach((video) => {
                const stream = video.srcObject;
                if (stream && typeof stream.getTracks === 'function') {
                    stream.getTracks().forEach((track) => track.stop());
                }
                video.srcObject = null;
            });
        }
        clearReaderDom();
    }, [clearReaderDom]);

    const syncNow = useCallback(async () => {
        if (!online) {
            setSyncMessage('Device is offline. Connect to sync.');
            return;
        }
        if (!isAuthenticated()) {
            setSyncMessage('Please log in again to sync verification data.');
            return;
        }

        setSyncing(true);
        setSyncMessage('Synchronizing…');
        try {
            const keyRes = await apiFetch(`${API_BASE}/verification/public-key`);
            const keyData = await keyRes.json().catch(() => ({}));
            if (keyRes.ok && keyData.publicKeyPem) {
                await idbSavePublicKey(keyData);
            }

            const params = new URLSearchParams({ academicYear });
            const since = await idbGetMeta('lastSyncAt');
            if (since && recordCount > 0) params.append('since', since);

            const syncRes = await apiFetch(`${API_BASE}/verification/sync?${params.toString()}`);
            const syncData = await syncRes.json().catch(() => ({}));
            if (!syncRes.ok) {
                throw new Error(syncData.message || 'Sync failed');
            }

            await idbPutAllPassengers(syncData.records || []);
            const syncedAt = syncData.syncedAt || new Date().toISOString();
            await idbSetMeta('lastSyncAt', syncedAt);
            await idbSetMeta('academicYear', academicYear);

            const pending = await idbGetUnsyncedScans();
            if (pending.length > 0) {
                const uploadRes = await apiFetch(`${API_BASE}/verification/offline-scans`, {
                    method: 'POST',
                    body: JSON.stringify({ scans: pending }),
                });
                if (uploadRes.ok) {
                    await idbMarkScansSynced(pending.map((s) => s.scanId));
                }
            }

            await refreshMeta();
            setSyncMessage(`Synced ${syncData.count || 0} records for ${academicYear}.`);
        } catch (err) {
            setSyncMessage(err.message || 'Sync failed');
        } finally {
            setSyncing(false);
        }
    }, [academicYear, online, recordCount, refreshMeta]);

    useEffect(() => {
        if (online && isAuthenticated()) {
            const t = setTimeout(() => {
                syncNow();
            }, 800);
            return () => clearTimeout(t);
        }
        return undefined;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [online]);

    const logScan = async ({ verificationResult, mode, requestId, studentId, rawPayload }) => {
        const scan = {
            scanId: createScanId(),
            requestId: requestId || null,
            studentId: studentId || null,
            transportId: requestId || null,
            verificationResult,
            mode,
            scannedAt: new Date().toISOString(),
            deviceId: getOrCreateDeviceId(),
            academicYear,
            rawPayload: rawPayload || null,
            synced: false,
        };
        await idbAddOfflineScan(scan);

        if (online && isAuthenticated()) {
            try {
                const res = await apiFetch(`${API_BASE}/verification/offline-scans`, {
                    method: 'POST',
                    body: JSON.stringify({ scans: [scan] }),
                });
                if (res.ok) await idbMarkScansSynced([scan.scanId]);
            } catch {
                // stay queued locally
            }
        }
    };

    const showResult = (nextResult) => {
        setResult(nextResult);
        setScanFlash(true);
        setTimeout(() => setScanFlash(false), 700);
        setModalOpen(true);
    };

    const processQrText = useCallback(async (rawText) => {
        if (!rawText || busyRef.current) return;
        busyRef.current = true;
        setVerifying(true);
        setCameraError('');
        setScanFlash(true);

        try {
            const parsed = parseQrText(rawText);
            let signatureStatus = null;
            let requestId = parsed.requestId || null;

            if (parsed.type === 'signed') {
                let keyInfo = await idbGetPublicKey(parsed.payload?.kid);
                if (!keyInfo && online) {
                    const keyRes = await fetch(`${API_BASE}/verification/public-key`);
                    const keyData = await keyRes.json().catch(() => ({}));
                    if (keyRes.ok) {
                        await idbSavePublicKey(keyData);
                        keyInfo = keyData;
                    }
                }
                const sig = await verifySignedPayload(parsed, keyInfo?.publicKeyPem);
                signatureStatus = sig.reason;
                if (!sig.ok) {
                    const message =
                        sig.reason === 'expired' ? 'QR code has expired.'
                            : sig.reason === 'invalid_signature' ? 'QR signature is invalid (tampered or wrong key).'
                                : sig.reason === 'unsupported_version' ? 'Unsupported QR version. Update the verification app.'
                                    : sig.reason === 'no_public_key' ? 'Public key missing. Sync once from the Sync tab.'
                                        : 'Could not verify QR signature.';
                    showResult({
                        ok: false,
                        title: 'Invalid QR',
                        message,
                        mode: online ? 'ONLINE' : 'OFFLINE',
                        signatureStatus,
                    });
                    await logScan({
                        verificationResult: `INVALID:${sig.reason}`,
                        mode: online ? 'ONLINE' : 'OFFLINE',
                        requestId,
                        rawPayload: parsed.payload,
                    });
                    await stopScanner();
                    return;
                }
                requestId = String(parsed.payload.rid);
            } else if (parsed.type === 'unknown' || parsed.type === 'empty' || parsed.type === 'invalid') {
                showResult({
                    ok: false,
                    title: 'Invalid QR',
                    message: 'This QR is not a recognized transport verification code.',
                    mode: online ? 'ONLINE' : 'OFFLINE',
                });
                await logScan({
                    verificationResult: 'INVALID:format',
                    mode: online ? 'ONLINE' : 'OFFLINE',
                    rawPayload: { raw: rawText },
                });
                await stopScanner();
                return;
            }

            if (online) {
                try {
                    const res = await fetch(`${API_BASE}/transport-verify/${encodeURIComponent(requestId)}`);
                    const data = await res.json();
                    const ok = Boolean(data?.registered);
                    showResult({
                        ok,
                        title: ok ? 'Verified' : 'Not Active',
                        message: data?.message || (ok ? 'Registered in transport system' : 'Not active'),
                        mode: 'ONLINE',
                        signatureStatus: signatureStatus || (parsed.type === 'legacy_url' || parsed.type === 'legacy_id' ? 'legacy_url' : null),
                        data,
                        lastSyncAt,
                    });
                    await logScan({
                        verificationResult: ok ? 'VALID' : 'INACTIVE',
                        mode: 'ONLINE',
                        requestId,
                        studentId: data?.admission_number,
                        rawPayload: parsed.payload || { requestId },
                    });
                    await stopScanner();
                    return;
                } catch {
                    // fall through to offline
                }
            }

            const local = requestId ? await idbGetPassenger(String(requestId)) : null;
            if (!local) {
                showResult({
                    ok: false,
                    title: 'Data unavailable offline',
                    message: 'Student data not found locally. Open Sync and synchronize.',
                    mode: 'OFFLINE',
                    signatureStatus,
                    lastSyncAt,
                    warning: true,
                });
                await logScan({
                    verificationResult: 'MISSING_LOCAL',
                    mode: 'OFFLINE',
                    requestId,
                    rawPayload: parsed.payload || { requestId },
                });
            } else {
                const active = String(local.transportStatus || '').toLowerCase() === 'approved';
                showResult({
                    ok: active,
                    title: active ? 'Offline Verified' : 'Not Active (Offline)',
                    message: active
                        ? `Verified using data synchronized at ${formatSyncTime(lastSyncAt)}.`
                        : `Local status: ${local.transportStatus}`,
                    mode: 'OFFLINE',
                    signatureStatus,
                    data: {
                        registered: active,
                        student_name: local.studentName,
                        admission_number: local.studentId,
                        route_id: local.routeId,
                        route_name: local.routeName,
                        stage_name: local.stageName,
                        bus_id: local.busId,
                        academic_year: local.academicYear,
                        status: local.transportStatus,
                        user_type: local.userType,
                        student_photo: local.studentPhoto || null,
                    },
                    lastSyncAt,
                    warning: true,
                });
                await logScan({
                    verificationResult: active ? 'VALID_OFFLINE' : 'INACTIVE_OFFLINE',
                    mode: 'OFFLINE',
                    requestId,
                    studentId: local.studentId,
                    rawPayload: parsed.payload || local,
                });
            }
            await stopScanner();
        } finally {
            setVerifying(false);
            setTimeout(() => setScanFlash(false), 600);
        }
    }, [academicYear, lastSyncAt, online, stopScanner]);

    handleScanRef.current = processQrText;

    const startScanner = useCallback(async () => {
        const session = ++scanSessionRef.current;
        setCameraError('');
        setScanning(false);
        busyRef.current = false;

        const prev = scannerRef.current;
        scannerRef.current = null;
        scannerRunning.current = false;
        if (prev) {
            try {
                const state = prev.getState?.();
                if (state === 2 || state === 3) await prev.stop();
            } catch { /* ignore */ }
            try { prev.clear(); } catch { /* ignore */ }
        }
        clearReaderDom();

        if (session !== scanSessionRef.current) return;

        try {
            const scanner = new Html5Qrcode('qr-reader');
            if (session !== scanSessionRef.current) {
                try { scanner.clear(); } catch { /* ignore */ }
                return;
            }
            scannerRef.current = scanner;

            const boxSize = Math.min(260, Math.floor(window.innerWidth * 0.7));
            await scanner.start(
                { facingMode: 'environment' },
                { fps: 8, qrbox: { width: boxSize, height: boxSize } },
                async (decoded) => {
                    if (handleScanRef.current) {
                        await handleScanRef.current(decoded);
                    }
                },
                () => { }
            );

            if (session !== scanSessionRef.current) {
                try { await scanner.stop(); } catch { /* ignore */ }
                try { scanner.clear(); } catch { /* ignore */ }
                clearReaderDom();
                return;
            }

            scannerRunning.current = true;
            setScanning(true);
        } catch (err) {
            if (session !== scanSessionRef.current) return;
            scannerRunning.current = false;
            scannerRef.current = null;
            clearReaderDom();
            setCameraError(err?.message || 'Camera permission denied or unavailable.');
            setScanning(false);
        }
    }, [clearReaderDom]);

    useEffect(() => {
        if (activeTab !== 'scan' || modalOpen) {
            stopScanner();
            return undefined;
        }

        let cancelled = false;
        const timer = setTimeout(() => {
            if (!cancelled) startScanner();
        }, 200);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            stopScanner();
        };
    }, [activeTab, modalOpen, startScanner, stopScanner]);

    const closeResultModal = () => {
        setModalOpen(false);
        setResult(null);
        busyRef.current = false;
        setVerifying(false);
    };

    const detail = result?.data;
    const photoSrc = normalizeStudentPhoto(detail?.student_photo);

    return (
        <Layout>
            <div className="space-y-3 sm:space-y-4 font-sans text-slate-800 pb-4">
                <div className="bg-white rounded-xl p-3 sm:p-4 shadow-sm border border-slate-200 flex flex-col gap-3 sm:gap-4">
                    <div className="flex items-start sm:items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                            <ShieldCheck size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight leading-tight">QR Verification</h1>
                            <p className="text-[11px] sm:text-xs text-slate-500 mt-0.5 truncate">
                                Last sync: {formatSyncTime(lastSyncAt)}
                            </p>
                        </div>
                        <div
                            className={`inline-flex items-center gap-1 text-[9px] sm:text-[10px] font-bold uppercase tracking-wide px-2 py-1 rounded-lg border shrink-0 ${
                                online
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                        >
                            {online ? <Wifi size={11} /> : <WifiOff size={11} />}
                            {online ? 'Online' : 'Offline'}
                        </div>
                    </div>

                    <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold gap-1 w-full sm:w-auto sm:self-end">
                        <button
                            type="button"
                            onClick={() => setActiveTab('scan')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'scan' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <Camera size={13} /> Scan
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('sync')}
                            className={`flex-1 sm:flex-none px-4 py-2 rounded-md transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
                                activeTab === 'sync' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                            }`}
                        >
                            <RefreshCw size={13} /> Sync
                        </button>
                    </div>
                </div>

                {activeTab === 'scan' && (
                    <div className="space-y-3">
                        {!online && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                                <p className="font-bold flex items-center gap-1.5">
                                    <AlertTriangle size={14} /> Offline verification
                                </p>
                                <p className="mt-1 leading-relaxed">
                                    Uses last synced data ({formatSyncTime(lastSyncAt)}).
                                </p>
                            </div>
                        )}

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                            <div className="px-3 sm:px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2">
                                <p className="text-xs font-bold text-slate-700">
                                    {verifying ? 'QR detected — verifying…' : scanning ? 'Point at transport QR' : 'Camera ready'}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => (scanning ? stopScanner() : startScanner())}
                                    disabled={modalOpen}
                                    className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
                                >
                                    {scanning ? 'Stop' : 'Start'}
                                </button>
                            </div>

                            <div className="relative bg-slate-900 aspect-[3/4] sm:aspect-video max-h-[70vh] sm:max-h-[520px] overflow-hidden">
                                <div
                                    id="qr-reader"
                                    ref={readerHostRef}
                                    className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-cover [&_#qr-reader__scan_region]:!w-full [&_#qr-reader__scan_region]:!h-full [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                />

                                {/* Viewfinder + scan line */}
                                {scanning && !verifying && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                                        <div className="relative w-[68%] max-w-[260px] aspect-square">
                                            <div className="absolute inset-0 rounded-2xl border-2 border-white/70 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
                                            <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                            <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                            <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                            <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                            <div className="qr-scan-line absolute left-2 right-2 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                                        </div>
                                    </div>
                                )}

                                {/* Detected flash */}
                                {scanFlash && (
                                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-emerald-500/25 animate-pulse">
                                        <div className="bg-white/95 rounded-2xl px-4 py-3 shadow-lg flex items-center gap-2">
                                            <CheckCircle2 className="text-emerald-600" size={22} />
                                            <span className="text-sm font-bold text-slate-800">QR Scanned</span>
                                        </div>
                                    </div>
                                )}

                                {verifying && !scanFlash && (
                                    <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/40">
                                        <div className="bg-white rounded-2xl px-4 py-3 shadow-lg flex items-center gap-2">
                                            <Loader2 className="animate-spin text-blue-600" size={18} />
                                            <span className="text-sm font-bold text-slate-800">Verifying…</span>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {cameraError && (
                                <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
                                    {cameraError}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'sync' && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 sm:p-4 space-y-4 max-w-2xl">
                        <div>
                            <h2 className="text-sm font-bold text-slate-800">Sync & device</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Download approved passenger data for offline verification.
                            </p>
                        </div>

                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                            <MetaCard label="Device ID" value={deviceId} />
                            <MetaCard label="Last Sync" value={formatSyncTime(lastSyncAt)} />
                            <MetaCard label="Local Records" value={String(recordCount)} />
                            <MetaCard label="Connectivity" value={online ? 'Online' : 'Offline'} />
                        </div>

                        <div>
                            <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                                Academic Year
                            </label>
                            <select
                                value={academicYear}
                                onChange={(e) => setAcademicYear(e.target.value)}
                                className="w-full rounded-lg border border-slate-200 px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-700 bg-white cursor-pointer"
                            >
                                {academicYearOptions.map((year) => (
                                    <option key={year} value={year}>{year}</option>
                                ))}
                            </select>
                        </div>

                        <button
                            type="button"
                            onClick={syncNow}
                            disabled={syncing || !online}
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                        >
                            {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                            Sync Now
                        </button>

                        {syncMessage && (
                            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-100 rounded-lg px-3 py-2">
                                {syncMessage}
                            </p>
                        )}
                    </div>
                )}
            </div>

            <Modal
                isOpen={modalOpen && Boolean(result)}
                onClose={closeResultModal}
                title={result?.title || 'Scan result'}
                maxWidth="max-w-md"
            >
                {result && (
                    <div className="space-y-4">
                        <div
                            className={`rounded-xl px-3 py-2.5 flex items-start gap-2.5 ${
                                result.ok
                                    ? 'bg-emerald-50 border border-emerald-100'
                                    : result.warning
                                        ? 'bg-amber-50 border border-amber-100'
                                        : 'bg-red-50 border border-red-100'
                            }`}
                        >
                            {result.ok ? (
                                <CheckCircle2 className="text-emerald-600 shrink-0 mt-0.5" size={20} />
                            ) : (
                                <XCircle className={`${result.warning ? 'text-amber-600' : 'text-red-500'} shrink-0 mt-0.5`} size={20} />
                            )}
                            <div className="min-w-0">
                                <p className="text-xs font-semibold text-slate-700 leading-relaxed">{result.message}</p>
                                <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                                    {result.mode}
                                    {result.signatureStatus ? ` · ${result.signatureStatus}` : ''}
                                </p>
                            </div>
                        </div>

                        {detail && (
                            <div className="flex flex-col items-center text-center gap-3 pb-3 border-b border-slate-100">
                                <div className="w-24 h-28 rounded-xl border-2 border-slate-200 overflow-hidden bg-slate-50 shadow-sm flex items-center justify-center">
                                    {photoSrc ? (
                                        <img
                                            src={photoSrc}
                                            alt={detail.student_name || 'Passenger'}
                                            className="w-full h-full object-cover object-top"
                                        />
                                    ) : (
                                        <User className="text-slate-300" size={40} />
                                    )}
                                </div>
                                <div className="min-w-0 w-full px-1">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Passenger</p>
                                    <h2 className="text-lg font-black text-slate-900 uppercase leading-tight break-words mt-0.5">
                                        {detail.student_name || '—'}
                                    </h2>
                                    <p className="text-sm font-semibold text-blue-700 mt-1 break-all">
                                        {detail.admission_number || '—'}
                                    </p>
                                </div>
                            </div>
                        )}

                        {detail && (
                            <div className="space-y-2">
                                <DetailRow label="Type" value={detail.user_type === 'employee' ? 'Employee' : 'Student'} />
                                <DetailRow label="Route" value={detail.route_id ? `${detail.route_id} · ${detail.route_name || ''}` : detail.route_name} />
                                <DetailRow label="Stage" value={detail.stage_name} />
                                <DetailRow label="Bus" value={detail.bus_id} />
                                <DetailRow label="Status" value={detail.status} />
                                <DetailRow label="Academic Year" value={detail.academic_year} />
                                {detail.application_number && (
                                    <DetailRow label="Transport ID" value={detail.application_number} />
                                )}
                                {detail.course && (
                                    <DetailRow label="Course" value={`${detail.course}${detail.branch ? ` (${detail.branch})` : ''}`} />
                                )}
                            </div>
                        )}

                        <button
                            type="button"
                            onClick={closeResultModal}
                            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer"
                        >
                            Scan Next
                        </button>
                    </div>
                )}
            </Modal>

            <style>{`
                @keyframes qr-scan-sweep {
                    0% { top: 8%; opacity: 0; }
                    10% { opacity: 1; }
                    90% { opacity: 1; }
                    100% { top: 88%; opacity: 0; }
                }
                .qr-scan-line {
                    animation: qr-scan-sweep 2s ease-in-out infinite;
                }
            `}</style>
        </Layout>
    );
};

const DetailRow = ({ label, value }) => (
    <div className="flex justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0">
        <span className="text-[10px] font-bold uppercase text-slate-400 shrink-0">{label}</span>
        <span className="text-xs font-semibold text-slate-800 text-right break-words">{value || '—'}</span>
    </div>
);

const MetaCard = ({ label, value }) => (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{label}</p>
        <p className="text-xs font-bold text-slate-800 mt-0.5 break-all">{value}</p>
    </div>
);

export default QrVerification;
