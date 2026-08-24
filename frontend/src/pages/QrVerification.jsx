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
} from 'lucide-react';
import Layout from '../components/Layout';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
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
    const [verifying, setVerifying] = useState(false);
    const [manualInput, setManualInput] = useState('');

    const scannerRef = useRef(null);
    const scannerRunning = useRef(false);
    const handleScanRef = useRef(null);
    const readerHostRef = useRef(null);
    const scanSessionRef = useRef(0);

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

        // Stop any leftover media tracks html5-qrcode may leave behind
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

    const processQrText = useCallback(async (rawText) => {
        if (!rawText || verifying) return;
        setVerifying(true);
        setCameraError('');
        setActiveTab('scan');

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
                    setResult({
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
                setResult({
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
                    setResult({
                        ok,
                        title: ok ? 'Online Verified' : 'Not Active',
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
                setResult({
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
                setResult({
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
        }
    }, [academicYear, lastSyncAt, online, stopScanner, verifying]);

    handleScanRef.current = processQrText;

    const startScanner = useCallback(async () => {
        const session = ++scanSessionRef.current;
        setCameraError('');
        setScanning(false);

        // Tear down any previous instance without bumping session again
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

            await scanner.start(
                { facingMode: 'environment' },
                { fps: 8, qrbox: { width: 250, height: 250 } },
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
        if (activeTab !== 'scan') {
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
    }, [activeTab, startScanner, stopScanner]);

    const detail = result?.data;

    return (
        <Layout>
            <div className="space-y-4 font-sans text-slate-800">
                <div className="bg-white rounded-xl p-4 shadow-sm border border-slate-200 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-sm shrink-0">
                            <ShieldCheck size={18} />
                        </div>
                        <div>
                            <h1 className="text-lg font-bold text-slate-900 tracking-tight leading-none">QR Verification</h1>
                            <p className="text-xs text-slate-500 mt-1">
                                Scan transport ID cards online or offline · Last sync: {formatSyncTime(lastSyncAt)}
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                        <div
                            className={`inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide px-2.5 py-1.5 rounded-lg border ${
                                online
                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                                    : 'bg-amber-50 text-amber-700 border-amber-200'
                            }`}
                        >
                            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
                            {online ? 'Online' : 'Offline'}
                        </div>
                        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs font-semibold gap-1">
                            <button
                                type="button"
                                onClick={() => setActiveTab('scan')}
                                className={`px-4 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                                    activeTab === 'scan' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                            >
                                <Camera size={13} /> Scan
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('sync')}
                                className={`px-4 py-1.5 rounded-md transition-all cursor-pointer flex items-center gap-1.5 ${
                                    activeTab === 'sync' ? 'bg-blue-600 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900'
                                }`}
                            >
                                <RefreshCw size={13} /> Sync
                            </button>
                        </div>
                    </div>
                </div>

                {activeTab === 'scan' && (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                        <div className="space-y-4">
                            {!online && (
                                <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
                                    <p className="font-bold flex items-center gap-1.5">
                                        <AlertTriangle size={14} /> Offline verification
                                    </p>
                                    <p className="mt-1">
                                        Uses last synchronized data ({formatSyncTime(lastSyncAt)}). Cancellations after that time are not known.
                                    </p>
                                </div>
                            )}

                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                                <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
                                    <p className="text-xs font-bold text-slate-700">Camera scanner</p>
                                    <button
                                        type="button"
                                        onClick={() => (scanning ? stopScanner() : startScanner())}
                                        className="px-3 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 cursor-pointer"
                                    >
                                        {scanning ? 'Stop Camera' : 'Start Camera'}
                                    </button>
                                </div>
                                <div
                                    id="qr-reader"
                                    ref={readerHostRef}
                                    className="w-full min-h-[280px] bg-slate-900 overflow-hidden [&>video]:max-w-full [&>video]:mx-auto [&_video]:max-w-full [&_#qr-reader__scan_region]:max-w-full [&_#qr-reader__scan_region]:mx-auto [&_#qr-reader__scan_region_video]:!w-full"
                                />
                                {cameraError && (
                                    <div className="px-4 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100">
                                        {cameraError}
                                    </div>
                                )}
                                {verifying && (
                                    <div className="px-4 py-2 text-xs text-slate-500 flex items-center gap-1.5 border-t border-slate-100">
                                        <Loader2 size={12} className="animate-spin" /> Verifying…
                                    </div>
                                )}
                            </div>

                            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-2">
                                <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Manual QR / Request ID</label>
                                <textarea
                                    value={manualInput}
                                    onChange={(e) => setManualInput(e.target.value)}
                                    rows={2}
                                    placeholder="Paste QR content or request ID"
                                    className="w-full rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 font-semibold text-slate-800"
                                />
                                <button
                                    type="button"
                                    disabled={verifying || !manualInput.trim()}
                                    onClick={() => processQrText(manualInput.trim())}
                                    className="px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                                >
                                    {verifying ? 'Verifying…' : 'Verify'}
                                </button>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden min-h-[280px]">
                            {result ? (
                                <>
                                    <div
                                        className={`px-4 py-3 flex items-start gap-2.5 ${
                                            result.ok
                                                ? 'bg-emerald-50 border-b border-emerald-100'
                                                : result.warning
                                                    ? 'bg-amber-50 border-b border-amber-100'
                                                    : 'bg-red-50 border-b border-red-100'
                                        }`}
                                    >
                                        {result.ok ? (
                                            <CheckCircle2 className="text-emerald-600 shrink-0" size={22} />
                                        ) : (
                                            <XCircle className={`${result.warning ? 'text-amber-600' : 'text-red-500'} shrink-0`} size={22} />
                                        )}
                                        <div>
                                            <p className="text-sm font-black uppercase tracking-wide text-slate-800">{result.title}</p>
                                            <p className="text-xs text-slate-600 mt-0.5">{result.message}</p>
                                            <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                                                {result.mode}
                                                {result.signatureStatus ? ` · Sig: ${result.signatureStatus}` : ''}
                                            </p>
                                        </div>
                                    </div>
                                    {detail ? (
                                        <div className="px-4 py-3 space-y-2">
                                            <Detail label="Name" value={detail.student_name} />
                                            <Detail label="Admission / Emp No" value={detail.admission_number} />
                                            <Detail label="Route" value={detail.route_id ? `${detail.route_id} · ${detail.route_name || ''}` : detail.route_name} />
                                            <Detail label="Stage" value={detail.stage_name} />
                                            <Detail label="Bus" value={detail.bus_id} />
                                            <Detail label="Status" value={detail.status} />
                                            <Detail label="Academic Year" value={detail.academic_year} />
                                        </div>
                                    ) : null}
                                </>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center p-8 text-center">
                                    <ShieldCheck className="text-blue-600 mb-2" size={36} />
                                    <p className="text-sm font-bold text-slate-800">Ready to verify</p>
                                    <p className="text-xs text-slate-500 mt-1 max-w-sm">
                                        Point the camera at a transport ID QR, or paste a QR string / request ID on the left.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {activeTab === 'sync' && (
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 space-y-4 max-w-2xl">
                        <div>
                            <h2 className="text-sm font-bold text-slate-800">Sync & device</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Download approved passenger data for offline verification and upload queued scan logs.
                            </p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                                className="w-full sm:max-w-xs rounded-lg border border-slate-200 px-3 py-2 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-700 bg-white cursor-pointer"
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
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
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
        </Layout>
    );
};

const Detail = ({ label, value }) => (
    <div className="flex justify-between gap-3 border-b border-slate-50 pb-1.5 last:border-0">
        <span className="text-[10px] font-bold uppercase text-slate-400 shrink-0">{label}</span>
        <span className="text-xs font-semibold text-slate-800 text-right">{value || '—'}</span>
    </div>
);

const MetaCard = ({ label, value }) => (
    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2.5">
        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{label}</p>
        <p className="text-xs font-bold text-slate-800 mt-0.5 break-all">{value}</p>
    </div>
);

export default QrVerification;
