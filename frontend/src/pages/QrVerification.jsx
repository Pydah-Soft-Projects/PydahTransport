import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
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
    Zap,
    ZapOff,
} from 'lucide-react';
import Layout from '../components/Layout';
import Modal from '../components/Modal';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';
import { hasPermission } from '../utils/permissions';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import {
    createScanId,
    formatSyncTime,
    getOrCreateDeviceId,
    idbAddOfflineScan,
    idbClearPassengers,
    idbCountPassengers,
    idbGetMeta,
    idbGetPublicKey,
    idbGetUnsyncedScans,
    idbMarkScansSynced,
    idbPutAllPassengers,
    idbSavePublicKey,
    idbSetMeta,
    markOfflineVerifyReady,
    parseQrText,
    verifyOfflinePassenger,
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
    const [hasPublicKey, setHasPublicKey] = useState(false);
    const [storedAcademicYear, setStoredAcademicYear] = useState(null);

    // Camera hardware capabilities states
    const [torchSupported, setTorchSupported] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [zoomSupported, setZoomSupported] = useState(false);
    const [zoomCapabilities, setZoomCapabilities] = useState({ min: 1, max: 1, step: 0.1 });
    const [zoomValue, setZoomValue] = useState(1);

    const scannerRef = useRef(null);
    const scannerRunning = useRef(false);
    const handleScanRef = useRef(null);
    const readerHostRef = useRef(null);
    const scanSessionRef = useRef(0);
    const busyRef = useRef(false);
    const lastScanRef = useRef({ text: '', at: 0 });

    const SCAN_COOLDOWN_MS = 1800;

    /** Prefer rear camera id; fall back to facingMode constraints. */
    const getCameraCandidates = useCallback(async () => {
        const candidates = [];
        try {
            // Warm permission so labels are available
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: { ideal: 'environment' } },
                audio: false,
            });
            stream.getTracks().forEach((track) => track.stop());
        } catch {
            // permission may already be granted / denied — continue
        }

        try {
            const cameras = await Html5Qrcode.getCameras();
            if (cameras?.length) {
                const rear = cameras.find((camera) =>
                    /back|rear|environment|trás|arrière|world/i.test(camera.label || '')
                );
                if (rear?.id) candidates.push(rear.id);
                cameras.forEach((camera) => {
                    if (camera?.id && !candidates.includes(camera.id)) {
                        candidates.push(camera.id);
                    }
                });
            }
        } catch {
            // ignore enumeration errors
        }

        // Facing-mode fallbacks work well on phones and many laptops
        candidates.push({ facingMode: 'environment' });
        candidates.push({ facingMode: 'user' });
        return candidates;
    }, []);

    const getScannerConfig = useCallback(() => ({
        fps: 24,
        // Large scan region — small qrbox is a common reason scans never fire
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.max(180, Math.floor(minEdge * 0.82));
            return { width: size, height: size };
        },
        disableFlip: false,
        videoConstraints: {
            width: { min: 640, ideal: 1280, max: 1920 },
            height: { min: 480, ideal: 720, max: 1080 },
            facingMode: 'environment'
        }
    }), []);

    const refreshMeta = useCallback(async () => {
        const [syncAt, count, storedYear, keyInfo] = await Promise.all([
            idbGetMeta('lastSyncAt'),
            idbCountPassengers(),
            idbGetMeta('academicYear'),
            idbGetPublicKey(),
        ]);
        setLastSyncAt(syncAt);
        setRecordCount(count);
        setStoredAcademicYear(storedYear);
        setHasPublicKey(Boolean(keyInfo?.publicKeyPem));
        if (storedYear) setAcademicYear(storedYear);
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

    // Public key is required for signed QR offline — fetch without auth when online
    useEffect(() => {
        let cancelled = false;
        const loadPublicKey = async () => {
            if (online) {
                try {
                    const res = await fetch(`${API_BASE}/verification/public-key`);
                    const data = await res.json().catch(() => ({}));
                    if (!cancelled && res.ok && data.publicKeyPem) {
                        await idbSavePublicKey(data);
                        setHasPublicKey(true);
                        return;
                    }
                } catch {
                    // fall through to local cache
                }
            }
            const cached = await idbGetPublicKey();
            if (!cancelled) setHasPublicKey(Boolean(cached?.publicKeyPem));
        };
        loadPublicKey();
        return () => { cancelled = true; };
    }, [online]);

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
        setTorchSupported(false);
        setTorchOn(false);
        setZoomSupported(false);

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

    const toggleTorch = useCallback(async () => {
        const scanner = scannerRef.current;
        if (!scanner) return;
        try {
            const track = scanner.getActiveCameraTrack();
            if (track) {
                const nextTorch = !torchOn;
                await track.applyConstraints({
                    advanced: [{ torch: nextTorch }]
                });
                setTorchOn(nextTorch);
            }
        } catch (err) {
            console.error('Failed to toggle torch:', err);
        }
    }, [torchOn]);

    const handleZoomChange = useCallback(async (value) => {
        const val = Number(value);
        const scanner = scannerRef.current;
        if (!scanner) return;
        try {
            const track = scanner.getActiveCameraTrack();
            if (track) {
                await track.applyConstraints({
                    advanced: [{ zoom: val }]
                });
                setZoomValue(val);
            }
        } catch (err) {
            console.error('Failed to apply zoom:', err);
        }
    }, []);

    const cycleZoom = useCallback(() => {
        const minZ = zoomCapabilities.min || 1;
        const maxZ = zoomCapabilities.max || 1;
        
        let nextZoom = zoomValue + 0.5;
        if (nextZoom > maxZ) {
            nextZoom = minZ;
        } else if (nextZoom > 3) {
            nextZoom = minZ;
        }
        nextZoom = Math.round(nextZoom * 10) / 10;
        handleZoomChange(nextZoom);
    }, [zoomValue, zoomCapabilities, handleZoomChange]);

    const syncNow = useCallback(async () => {
        if (!online) {
            setSyncMessage('Device is offline. Connect to sync.');
            return;
        }
        if (!isAuthenticated()) {
            setSyncMessage('Please log in again to sync verification data.');
            return;
        }
        if (!hasPermission('qr_verification')) {
            setSyncMessage('Your account does not have QR Verification permission.');
            return;
        }

        setSyncing(true);
        setSyncMessage('Synchronizing…');
        try {
            const keyRes = await apiFetch(`${API_BASE}/verification/public-key`);
            const keyData = await keyRes.json().catch(() => ({}));
            if (keyRes.ok && keyData.publicKeyPem) {
                await idbSavePublicKey(keyData);
                setHasPublicKey(true);
            }

            const params = new URLSearchParams({ academicYear });
            const since = await idbGetMeta('lastSyncAt');
            const prevYear = await idbGetMeta('academicYear');
            const fullSync = !since || recordCount === 0 || prevYear !== academicYear;
            if (!fullSync && since) params.append('since', since);

            const syncRes = await apiFetch(`${API_BASE}/verification/sync?${params.toString()}`);
            const syncData = await syncRes.json().catch(() => ({}));
            if (!syncRes.ok) {
                throw new Error(syncData.message || 'Sync failed');
            }

            if (fullSync) {
                await idbClearPassengers();
            }

            await idbPutAllPassengers(syncData.records || []);
            const syncedAt = syncData.syncedAt || new Date().toISOString();
            await idbSetMeta('lastSyncAt', syncedAt);
            await idbSetMeta('academicYear', academicYear);
            setStoredAcademicYear(academicYear);
            await markOfflineVerifyReady({
                academicYear,
                count: syncData.count || 0,
            });

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
            setSyncMessage(`Synced ${syncData.count || 0} record${syncData.count === 1 ? '' : 's'} for ${academicYear}${fullSync ? ' (full sync)' : ''}.`);
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

        // 1. Synthesize audio feedback (Offline-compatible)
        try {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
                const audioCtx = new AudioCtxClass();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();
                
                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                
                oscillator.type = 'sine';
                if (nextResult.ok) {
                    // Crisp high pitch beep for valid scan (A5 note)
                    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
                    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
                    oscillator.start();
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.16);
                    oscillator.stop(audioCtx.currentTime + 0.16);
                } else {
                    // Warning lower pitch beep for invalid/inactive scan (A4 note)
                    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
                    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
                    oscillator.start();
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
                    oscillator.stop(audioCtx.currentTime + 0.25);
                }
            }
        } catch (audioErr) {
            console.warn('[Audio] Beep feedback failed:', audioErr);
        }

        // 2. Trigger physical vibration haptics (Offline-compatible)
        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                if (nextResult.ok) {
                    navigator.vibrate(100); // Short single pulse
                } else {
                    navigator.vibrate([150, 100, 150]); // Warning double pulse
                }
            } catch (vibErr) {
                console.warn('[Haptics] Vibration feedback failed:', vibErr);
            }
        }

        setTimeout(() => setScanFlash(false), 700);
        setModalOpen(true);
    };

    const fetchOnlineVerify = async (requestId) => {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 6000);
        try {
            const res = await fetch(
                `${API_BASE}/transport-verify/${encodeURIComponent(requestId)}`,
                { signal: controller.signal }
            );
            const data = await res.json().catch(() => ({}));
            return { ok: res.ok, data };
        } finally {
            clearTimeout(timeoutId);
        }
    };

    const showOfflineResult = async (parsed, signatureStatus) => {
        const offline = await verifyOfflinePassenger(parsed, lastSyncAt);
        showResult({
            ok: offline.ok,
            title: offline.title,
            message: offline.message,
            mode: 'OFFLINE',
            signatureStatus,
            data: offline.data,
            lastSyncAt,
            warning: offline.warning,
        });
        await logScan({
            verificationResult: offline.local
                ? (offline.ok ? 'VALID_OFFLINE' : 'INACTIVE_OFFLINE')
                : 'MISSING_LOCAL',
            mode: 'OFFLINE',
            requestId: offline.local?.requestId || parsed.requestId || parsed.payload?.rid || null,
            studentId: offline.local?.studentId || parsed.payload?.sid || null,
            rawPayload: parsed.payload || { requestId: parsed.requestId },
        });
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
                if (!keyInfo?.publicKeyPem && online) {
                    try {
                        const keyRes = await fetch(`${API_BASE}/verification/public-key`);
                        const keyData = await keyRes.json().catch(() => ({}));
                        if (keyRes.ok && keyData.publicKeyPem) {
                            await idbSavePublicKey(keyData);
                            keyInfo = keyData;
                            setHasPublicKey(true);
                        }
                    } catch {
                        // use cached key only
                    }
                }
                const sig = await verifySignedPayload(parsed, keyInfo?.publicKeyPem);
                signatureStatus = sig.reason;
                if (!sig.ok) {
                    const message =
                        sig.reason === 'expired' ? 'QR code has expired.'
                            : sig.reason === 'invalid_signature' ? 'QR signature is invalid (tampered or wrong key).'
                                : sig.reason === 'unsupported_version' ? 'Unsupported QR version. Update the verification app.'
                                    : sig.reason === 'no_public_key' ? 'Public key missing. Sync once while online from the Sync tab.'
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
                parsed.requestId = requestId;
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

            if (online && requestId) {
                try {
                    const { ok: httpOk, data } = await fetchOnlineVerify(requestId);
                    if (httpOk) {
                        const registered = Boolean(data?.registered);
                        showResult({
                            ok: registered,
                            title: registered ? 'Verified' : 'Not Active',
                            message: data?.message || (registered ? 'Registered in transport system' : 'Not active'),
                            mode: 'ONLINE',
                            signatureStatus: signatureStatus || (parsed.type === 'legacy_url' || parsed.type === 'legacy_id' ? 'legacy_url' : null),
                            data,
                            lastSyncAt,
                        });
                        await logScan({
                            verificationResult: registered ? 'VALID' : 'INACTIVE',
                            mode: 'ONLINE',
                            requestId,
                            studentId: data?.admission_number,
                            rawPayload: parsed.payload || { requestId },
                        });
                        await stopScanner();
                        return;
                    }
                } catch {
                    // fall through to offline lookup
                }
            }

            await showOfflineResult(parsed, signatureStatus);
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

        // Let React finish painting #qr-reader before Html5Qrcode mounts into it
        await new Promise((resolve) => setTimeout(resolve, 120));
        if (session !== scanSessionRef.current) return;
        if (!document.getElementById('qr-reader')) {
            setCameraError('Scanner area not ready. Tap Start to try again.');
            return;
        }

        const onDecoded = (decoded) => {
            const trimmed = String(decoded || '').trim();
            if (!trimmed || busyRef.current) return;

            const now = Date.now();
            if (
                trimmed === lastScanRef.current.text
                && now - lastScanRef.current.at < SCAN_COOLDOWN_MS
            ) {
                return;
            }
            lastScanRef.current = { text: trimmed, at: now };

            // Fire-and-forget so the scanner loop is not blocked
            if (handleScanRef.current) {
                Promise.resolve(handleScanRef.current(trimmed)).catch(() => {});
            }
        };

        try {
            const candidates = await getCameraCandidates();
            if (session !== scanSessionRef.current) return;

            const scanner = new Html5Qrcode('qr-reader', {
                formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE],
                useBarCodeDetectorIfSupported: true,
                verbose: false,
            });
            if (session !== scanSessionRef.current) {
                try { scanner.clear(); } catch { /* ignore */ }
                return;
            }
            scannerRef.current = scanner;

            let started = false;
            let lastError = null;
            const config = getScannerConfig();

            for (const camera of candidates) {
                if (session !== scanSessionRef.current) return;
                try {
                    await scanner.start(camera, config, onDecoded, () => {});
                    started = true;
                    break;
                } catch (err) {
                    lastError = err;
                    try {
                        const state = scanner.getState?.();
                        if (state === 2 || state === 3) await scanner.stop();
                    } catch { /* ignore */ }
                }
            }

            if (!started) {
                throw lastError || new Error('No usable camera found.');
            }

            if (session !== scanSessionRef.current) {
                try { await scanner.stop(); } catch { /* ignore */ }
                try { scanner.clear(); } catch { /* ignore */ }
                clearReaderDom();
                return;
            }

            scannerRunning.current = true;
            setScanning(true);
            setCameraError('');

            // Query and configure camera capabilities (Torch, Zoom, Continuous Focus)
            try {
                const track = scanner.getActiveCameraTrack();
                if (track) {
                    const capabilities = track.getCapabilities?.() || {};
                    
                    // 1. Setup continuous autofocus if supported
                    const constraints = {};
                    if (capabilities.focusMode?.includes('continuous')) {
                        constraints.focusMode = 'continuous';
                    }
                    if (Object.keys(constraints).length > 0) {
                        try {
                            await track.applyConstraints({ advanced: [constraints] });
                        } catch (e) {
                            console.warn('[Camera] Failed to apply focusMode:', e);
                        }
                    }

                    // 2. Detect Torch Support
                    if ('torch' in capabilities) {
                        setTorchSupported(true);
                        setTorchOn(false); // default to off
                    } else {
                        setTorchSupported(false);
                    }

                    // 3. Detect Zoom Support
                    if ('zoom' in capabilities) {
                        setZoomSupported(true);
                        const zMin = capabilities.zoom.min || 1;
                        const zMax = capabilities.zoom.max || 1;
                        const zStep = capabilities.zoom.step || 0.1;
                        setZoomCapabilities({ min: zMin, max: zMax, step: zStep });
                        
                        // Set zoom to min zoom initially or current zoom track constraint
                        const currentConstraints = track.getConstraints() || {};
                        const currentZoomConstraint = currentConstraints.advanced?.[0]?.zoom || zMin;
                        setZoomValue(currentZoomConstraint);
                    } else {
                        setZoomSupported(false);
                    }
                }
            } catch (capErr) {
                console.warn('[Camera] Error querying track capabilities:', capErr);
            }
        } catch (err) {
            if (session !== scanSessionRef.current) return;
            scannerRunning.current = false;
            scannerRef.current = null;
            clearReaderDom();
            const message = err?.message || 'Camera permission denied or unavailable.';
            setCameraError(
                /permission|notallowed|denied/i.test(message)
                    ? 'Camera permission denied. Allow camera access and tap Start.'
                    : message
            );
            setScanning(false);
        }
    }, [clearReaderDom, getCameraCandidates, getScannerConfig]);

    useEffect(() => {
        if (activeTab !== 'scan' || modalOpen) {
            stopScanner();
            return undefined;
        }

        let cancelled = false;
        // Slightly longer delay avoids React StrictMode double-mount killing the camera
        const timer = setTimeout(() => {
            if (!cancelled) startScanner();
        }, 350);

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
        lastScanRef.current = { text: '', at: 0 };
        setVerifying(false);
    };

    const detail = result?.data;
    const photoSrc = normalizeStudentPhoto(detail?.student_photo);
    const loggedIn = isAuthenticated();
    const Shell = loggedIn ? Layout : OfflineVerifyShell;

    return (
        <Shell>
            <div className="space-y-3 sm:space-y-4 font-sans text-slate-800 pb-4">
                {!loggedIn && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900">
                        <p className="font-bold">Offline verification mode</p>
                        <p className="mt-1 leading-relaxed">
                            Using passenger data saved on this device. Login is not required until you need to sync again.
                        </p>
                    </div>
                )}

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
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 space-y-1.5">
                                <p className="font-bold flex items-center gap-1.5">
                                    <AlertTriangle size={14} /> Offline verification
                                </p>
                                <p className="leading-relaxed">
                                    Using local data synced at {formatSyncTime(lastSyncAt)} · {recordCount} passenger{recordCount === 1 ? '' : 's'} stored.
                                </p>
                                {recordCount === 0 && (
                                    <p className="font-semibold text-amber-900">
                                        No local records. Connect to internet and run Sync before scanning offline.
                                    </p>
                                )}
                                {!hasPublicKey && (
                                    <p className="font-semibold text-amber-900">
                                        QR signature key not cached. Sync once while online to verify signed QR codes.
                                    </p>
                                )}
                            </div>
                        )}

                        {online && recordCount === 0 && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 text-xs text-blue-800">
                                <p className="font-bold">Prepare for offline scanning</p>
                                <p className="mt-1 leading-relaxed">
                                    Open the Sync tab and download passenger data before going offline.
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
                                {/*
                                  Keep video as object-contain (not cover).
                                  object-cover stretches frames and misaligns Html5Qrcode's crop box,
                                  which makes the camera look fine but never decode the QR.
                                */}
                                <div
                                    id="qr-reader"
                                    ref={readerHostRef}
                                    className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-contain [&_video]:bg-black [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                />

                                {/* Camera Quick Controls (Torch & Zoom cycling) */}
                                {scanning && (torchSupported || zoomSupported) && (
                                    <div className="absolute top-3 right-3 left-3 flex justify-between items-start pointer-events-none z-30">
                                        <div className="bg-slate-950/85 border border-slate-800/80 text-slate-200 text-[9px] sm:text-[10px] font-extrabold tracking-wider uppercase px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm shadow-md">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            Live View
                                        </div>
                                        <div className="flex flex-col gap-2 items-end pointer-events-auto">
                                            {/* Flashlight Button */}
                                            {torchSupported && (
                                                <button
                                                    type="button"
                                                    onClick={toggleTorch}
                                                    className={`p-2 rounded-lg border transition-all shadow-md flex items-center justify-center cursor-pointer ${
                                                        torchOn
                                                            ? 'bg-yellow-400 text-slate-900 border-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.5)]'
                                                            : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:text-white'
                                                    }`}
                                                    title={torchOn ? "Turn flashlight OFF" : "Turn flashlight ON"}
                                                >
                                                    {torchOn ? <Zap size={14} className="fill-current" /> : <ZapOff size={14} />}
                                                </button>
                                            )}

                                            {/* Zoom Button */}
                                            {zoomSupported && (
                                                <button
                                                    type="button"
                                                    onClick={cycleZoom}
                                                    className="px-2 py-1 rounded-lg bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white transition-all shadow-md text-[10px] font-black tracking-wider flex items-center justify-center cursor-pointer min-w-[42px]"
                                                    title="Cycle zoom level"
                                                >
                                                    {zoomValue.toFixed(1)}x
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Decorative viewfinder — pointer-events none so it never blocks the camera */}
                                {scanning && !verifying && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                                        <div className="relative w-[72%] max-w-[300px] aspect-square">
                                            <div className="absolute -top-0.5 -left-0.5 w-8 h-8 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                            <div className="absolute -top-0.5 -right-0.5 w-8 h-8 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                            <div className="absolute -bottom-0.5 -left-0.5 w-8 h-8 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                            <div className="absolute -bottom-0.5 -right-0.5 w-8 h-8 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                            <div className="qr-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
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

                        {!loggedIn && (
                            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900">
                                <p className="font-bold">Login required to sync</p>
                                <p className="mt-1 leading-relaxed">
                                    You can still scan offline with saved data. Connect to the internet and log in when you need a fresh sync.
                                </p>
                                <a
                                    href="/login"
                                    className="inline-flex mt-2 px-3 py-1.5 rounded-lg bg-amber-700 text-white text-[11px] font-bold"
                                >
                                    Go to Login
                                </a>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2 sm:gap-3">
                            <MetaCard label="Device ID" value={deviceId} />
                            <MetaCard label="Last Sync" value={formatSyncTime(lastSyncAt)} />
                            <MetaCard label="Local Records" value={String(recordCount)} />
                            <MetaCard label="Connectivity" value={online ? 'Online' : 'Offline'} />
                            <MetaCard label="Signature Key" value={hasPublicKey ? 'Cached' : 'Missing — sync required'} />
                            <MetaCard label="Synced Year" value={storedAcademicYear || '—'} />
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
                            disabled={syncing || !online || !loggedIn}
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
                        {(!result.ok || result.warning) && (
                            <div
                                className={`rounded-xl px-3 py-2.5 flex items-start gap-2.5 ${
                                    result.warning
                                        ? 'bg-amber-50 border border-amber-100'
                                        : 'bg-red-50 border border-red-100'
                                }`}
                            >
                                <XCircle className={`${result.warning ? 'text-amber-600' : 'text-red-500'} shrink-0 mt-0.5`} size={20} />
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-slate-700 leading-relaxed">{result.message}</p>
                                    <p className="text-[10px] font-bold text-slate-400 uppercase mt-1">
                                        {result.mode}
                                        {result.signatureStatus ? ` · ${result.signatureStatus}` : ''}
                                    </p>
                                </div>
                            </div>
                        )}

                        {detail && (
                            <div className="flex flex-col items-center text-center gap-3 pb-3 border-b border-slate-100">
                                <div className="w-24 h-24 rounded-full border-2 border-slate-200 overflow-hidden bg-slate-50 shadow-sm flex items-center justify-center">
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
                                    <h2 className="text-base sm:text-lg font-black text-slate-900 uppercase leading-tight break-words mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                                        <span>{detail.student_name || '—'}</span>
                                        {result.ok && (
                                            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                <CheckCircle2 size={10} className="fill-emerald-800 text-white shrink-0" /> Verified
                                            </span>
                                        )}
                                    </h2>
                                    <div className="mt-2.5 flex flex-wrap justify-center items-center gap-1.5">
                                        <span className="px-2 py-1 rounded bg-blue-50 text-blue-800 border border-blue-100 text-[10px] font-extrabold uppercase tracking-wide">
                                            ADM: {detail.admission_number || '—'}
                                        </span>
                                        {detail.pin_no && detail.pin_no !== 'N/A' && (
                                            <span className="px-2 py-1 rounded bg-slate-50 text-slate-700 border border-slate-200 text-[10px] font-extrabold uppercase tracking-wide">
                                                PIN: {detail.pin_no}
                                            </span>
                                        )}
                                    </div>
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
        </Shell>
    );
};

const OfflineVerifyShell = ({ children }) => (
    <div className="min-h-screen bg-[#EAF3FF] flex flex-col">
        <header className="bg-[#071B45] text-white px-4 py-3 flex items-center gap-3 shadow-md">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                <ShieldCheck size={18} />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">Pydah Transport</p>
                <p className="text-[10px] text-blue-200 uppercase tracking-wider">Offline QR Verification</p>
            </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="w-full mx-auto max-w-3xl">{children}</div>
        </main>
    </div>
);

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
