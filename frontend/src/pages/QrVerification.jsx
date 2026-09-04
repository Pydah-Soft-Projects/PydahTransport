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
    SwitchCamera,
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

    // Camera hardware capabilities & selection states
    const [torchSupported, setTorchSupported] = useState(false);
    const [torchOn, setTorchOn] = useState(false);
    const [zoomSupported, setZoomSupported] = useState(false);
    const [zoomCapabilities, setZoomCapabilities] = useState({ min: 1, max: 1, step: 0.1 });
    const [zoomValue, setZoomValue] = useState(1);
    const [availableCameras, setAvailableCameras] = useState([]);
    const [activeCameraIndex, setActiveCameraIndex] = useState(0);

    const scannerRef = useRef(null);
    const scannerRunning = useRef(false);
    const handleScanRef = useRef(null);
    const readerHostRef = useRef(null);
    const scanSessionRef = useRef(0);
    const busyRef = useRef(false);
    const lastScanRef = useRef({ text: '', at: 0 });
    const activeCameraIndexRef = useRef(0);

    const SCAN_COOLDOWN_MS = 1800;

    /** Fetch available cameras (built-in, rear, front, and USB webcams) prioritizing active index. */
    const getCameraCandidates = useCallback(async (preferredIndex = activeCameraIndexRef.current, { exclusive = false } = {}) => {
        let camerasList = [];

        try {
            const discoveredMap = new Map();

            // Unlock labels on some browsers (empty until a stream was granted once)
            if (navigator.mediaDevices?.getUserMedia && navigator.mediaDevices?.enumerateDevices) {
                try {
                    const pre = await navigator.mediaDevices.enumerateDevices();
                    const videoPre = pre.filter((d) => d.kind === 'videoinput');
                    const labelsMissing = videoPre.length === 0 || videoPre.every((d) => !d.label);
                    if (labelsMissing) {
                        try {
                            const warm = await navigator.mediaDevices.getUserMedia({
                                video: { facingMode: { ideal: 'environment' } },
                                audio: false,
                            });
                            warm.getTracks().forEach((t) => t.stop());
                        } catch {
                            try {
                                const warm = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
                                warm.getTracks().forEach((t) => t.stop());
                            } catch {
                                // permission may already be denied; continue with what we have
                            }
                        }
                    }
                } catch {
                    // ignore pre-enumeration failures
                }
            }

            try {
                const h5Cameras = await Html5Qrcode.getCameras();
                if (h5Cameras?.length) {
                    h5Cameras.forEach((cam, i) => {
                        if (cam.id) {
                            discoveredMap.set(cam.id, cam.label || `Camera ${i + 1}`);
                        }
                    });
                }
            } catch (err) {
                console.warn('[Camera] Html5Qrcode.getCameras warning:', err);
            }

            if (navigator.mediaDevices && typeof navigator.mediaDevices.enumerateDevices === 'function') {
                const allDevices = await navigator.mediaDevices.enumerateDevices();
                const videoInputs = allDevices.filter((d) => d.kind === 'videoinput');

                videoInputs.forEach((vInput, i) => {
                    if (vInput.deviceId) {
                        const existingLabel = discoveredMap.get(vInput.deviceId);
                        const newLabel = vInput.label || `Camera ${i + 1}`;
                        if (!existingLabel || /^Camera\s+\d+$/i.test(existingLabel)) {
                            discoveredMap.set(vInput.deviceId, newLabel);
                        }
                    }
                });
            }

            if (discoveredMap.size > 0) {
                const rawList = Array.from(discoveredMap.entries()).map(([id, label]) => {
                    const lower = String(label || '').toLowerCase();
                    const isFront = /front|user|selfie|face/i.test(lower);
                    const isBack = /back|rear|environment|world|outer|usb|external/i.test(lower);
                    return {
                        id,
                        label,
                        facingHint: isFront ? 'user' : (isBack ? 'environment' : null),
                    };
                });

                // Prefer rear/environment first, then unknown, then front
                const score = (cam) => {
                    if (cam.facingHint === 'environment') return 0;
                    if (cam.facingHint == null) return 1;
                    return 2;
                };
                camerasList = [...rawList].sort((a, b) => score(a) - score(b));
            }
        } catch (err) {
            console.warn('[Camera] Failed to enumerate devices:', err);
        }

        // FacingMode fallbacks when device enumeration is empty / incomplete
        if (camerasList.length === 0) {
            camerasList = [
                { facingMode: 'environment', facingHint: 'environment', label: 'Rear / Outer Camera' },
                { facingMode: 'user', facingHint: 'user', label: 'Front / Integrated Camera' },
            ];
        } else if (camerasList.length === 1) {
            const only = camerasList[0];
            if (only.facingHint === 'user') {
                camerasList.push({ facingMode: 'environment', facingHint: 'environment', label: 'Rear / Outer Camera' });
            } else if (only.facingHint === 'environment') {
                camerasList.push({ facingMode: 'user', facingHint: 'user', label: 'Front / Integrated Camera' });
            } else {
                camerasList = [
                    { ...only, facingHint: only.facingHint || 'environment' },
                    { facingMode: 'environment', facingHint: 'environment', label: 'Rear / Outer Camera' },
                    { facingMode: 'user', facingHint: 'user', label: 'Front / Integrated Camera' },
                ];
            }
        } else {
            const hasEnv = camerasList.some((c) => c.facingHint === 'environment' || c.facingMode === 'environment');
            const hasUser = camerasList.some((c) => c.facingHint === 'user' || c.facingMode === 'user');
            if (!hasEnv) {
                camerasList.push({ facingMode: 'environment', facingHint: 'environment', label: 'Rear / Outer Camera' });
            }
            if (!hasUser) {
                camerasList.push({ facingMode: 'user', facingHint: 'user', label: 'Front / Integrated Camera' });
            }
        }

        setAvailableCameras(camerasList);

        const safeIdx = Math.abs(preferredIndex) % camerasList.length;
        const target = camerasList[safeIdx];
        const candidates = [];

        const pushTargetVariants = (cam) => {
            if (!cam) return;
            
            // Prioritize facingMode over deviceId. Many mobile browsers (especially on Android)
            // will silently ignore deviceId or map it incorrectly, opening the front camera.
            // By requesting facingMode first, we guarantee the correct camera facing.
            if (cam.facingMode || cam.facingHint) {
                const facing = cam.facingMode || cam.facingHint;
                candidates.push({ facingMode: { exact: facing } });
                candidates.push({ facingMode: facing });
            }
            
            if (cam.id) {
                candidates.push({ deviceId: { exact: cam.id } });
                candidates.push({ deviceId: cam.id });
                candidates.push(cam.id);
            }
        };

        pushTargetVariants(target);

        // Only fall back to other cameras on initial start — not when user explicitly switched
        if (!exclusive) {
            camerasList.forEach((cam, idx) => {
                if (idx === safeIdx) return;
                if (cam.id) candidates.push({ deviceId: { exact: cam.id } });
                else if (cam.facingMode) candidates.push({ facingMode: cam.facingMode });
                else if (cam.facingHint) candidates.push({ facingMode: cam.facingHint });
            });
            candidates.push({ facingMode: 'environment' });
            candidates.push({ facingMode: 'user' });
        }

        return { candidates, camerasList, safeIdx, target };
    }, []);

    const getScannerConfig = useCallback((relaxed = false) => ({
        fps: 30,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.max(220, Math.floor(minEdge * (relaxed ? 0.85 : 0.92)));
            return { width: size, height: size };
        },
        disableFlip: false,
        // Strict mins often block rear cameras on mobile when switching — soften them
        videoConstraints: relaxed
            ? {
                width: { ideal: 1280 },
                height: { ideal: 720 },
            }
            : {
                width: { ideal: 1920 },
                height: { ideal: 1080 },
            },
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
        const requestedZoom = Number(value);
        const scanner = scannerRef.current;
        if (!scanner) {
            setZoomValue(requestedZoom);
            return;
        }
        try {
            const track = scanner.getActiveCameraTrack();
            if (track) {
                const capabilities = track.getCapabilities?.() || {};
                const zMin = capabilities.zoom?.min || 1;
                const zMax = capabilities.zoom?.max || 5;
                const safeZoom = Math.min(Math.max(requestedZoom, zMin), zMax);

                const advanced = { zoom: safeZoom };
                if (capabilities.focusMode?.includes('continuous')) {
                    advanced.focusMode = 'continuous';
                }
                if (capabilities.exposureMode?.includes('continuous')) {
                    advanced.exposureMode = 'continuous';
                }

                await track.applyConstraints({ advanced: [advanced] });
                setZoomValue(safeZoom);
            } else {
                setZoomValue(requestedZoom);
            }
        } catch (err) {
            console.warn('Track zoom constraint error:', err);
            setZoomValue(requestedZoom);
        }
    }, []);

    const cycleZoom = useCallback(() => {
        const minZ = zoomCapabilities.min || 1;
        const maxZ = zoomCapabilities.max || 5;
        
        let nextZoom = zoomValue + 1;
        if (nextZoom > maxZ || nextZoom > 5) {
            nextZoom = minZ;
        }
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
        const timeoutId = setTimeout(() => controller.abort(), 2500);
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

            // 1. Instant local IndexedDB lookup for zero-latency UI modal response (< 10ms)
            const offline = await verifyOfflinePassenger(parsed, lastSyncAt);

            if (offline.local) {
                showResult({
                    ok: offline.ok,
                    title: offline.title,
                    message: offline.message,
                    mode: online ? 'LOCAL_SYNCED' : 'OFFLINE',
                    signatureStatus,
                    data: offline.data,
                    lastSyncAt,
                    warning: offline.warning,
                });
                await stopScanner();

                // 2. Non-blocking background verification if online
                if (online && requestId) {
                    fetchOnlineVerify(requestId).then(({ ok: httpOk, data }) => {
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
                            logScan({
                                verificationResult: registered ? 'VALID' : 'INACTIVE',
                                mode: 'ONLINE',
                                requestId,
                                studentId: data?.admission_number,
                                rawPayload: parsed.payload || { requestId },
                            }).catch(() => {});
                        }
                    }).catch(() => {});
                } else {
                    await logScan({
                        verificationResult: offline.ok ? 'VALID_OFFLINE' : 'INACTIVE_OFFLINE',
                        mode: 'OFFLINE',
                        requestId: offline.local?.requestId || requestId,
                        studentId: offline.local?.studentId || parsed.payload?.sid || null,
                        rawPayload: parsed.payload || { requestId },
                    });
                }
                return;
            }

            // 3. Fallback online fetch if record not stored locally in IndexedDB
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
                    // fall through to offline message
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

    const startScanner = useCallback(async (targetIndex, options = {}) => {
        const exclusive = Boolean(options.exclusive);
        const session = ++scanSessionRef.current;
        setCameraError('');
        setScanning(false);
        busyRef.current = false;

        const reqIndex = targetIndex !== undefined ? targetIndex : activeCameraIndexRef.current;

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

        // Ensure previous camera track is fully released before opening another (esp. rear cam on mobile)
        await new Promise((r) => setTimeout(r, exclusive ? 280 : 80));

        // Ensure DOM element is painted
        if (!document.getElementById('qr-reader')) {
            await new Promise((r) => requestAnimationFrame(r));
        }
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

            if (handleScanRef.current) {
                Promise.resolve(handleScanRef.current(trimmed)).catch(() => {});
            }
        };

        try {
            const { candidates, safeIdx, target } = await getCameraCandidates(reqIndex, { exclusive });
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
            const configs = [getScannerConfig(false), getScannerConfig(true)];

            // Deduplicate candidates (objects stringify poorly — keep order with Set of JSON)
            const seen = new Set();
            const uniqueCandidates = [];
            for (const camera of candidates) {
                const key = typeof camera === 'string' ? camera : JSON.stringify(camera);
                if (seen.has(key)) continue;
                seen.add(key);
                uniqueCandidates.push(camera);
            }

            outer:
            for (const camera of uniqueCandidates) {
                for (const config of configs) {
                    if (session !== scanSessionRef.current) return;
                    try {
                        await scanner.start(camera, config, onDecoded, () => {});
                        started = true;
                        break outer;
                    } catch (err) {
                        lastError = err;
                        try {
                            const state = scanner.getState?.();
                            if (state === 2 || state === 3) await scanner.stop();
                        } catch { /* ignore */ }
                    }
                }
            }

            // Last resort for exclusive switch: facingMode of the intended camera type
            if (!started && exclusive && target) {
                const facing = target.facingMode || target.facingHint;
                if (facing) {
                    for (const config of configs) {
                        if (session !== scanSessionRef.current) return;
                        try {
                            await scanner.start({ facingMode: facing }, config, onDecoded, () => {});
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
                }
            }

            if (!started) {
                throw lastError || new Error(
                    exclusive
                        ? 'Could not open the selected camera. Try Start again or pick another camera.'
                        : 'No usable camera found.'
                );
            }

            activeCameraIndexRef.current = safeIdx;
            setActiveCameraIndex(safeIdx);

            if (session !== scanSessionRef.current) {
                try { await scanner.stop(); } catch { /* ignore */ }
                try { scanner.clear(); } catch { /* ignore */ }
                clearReaderDom();
                return;
            }

            scannerRunning.current = true;
            setScanning(true);
            setCameraError('');

            try {
                const track = scanner.getActiveCameraTrack();
                if (track) {
                    const capabilities = track.getCapabilities?.() || {};

                    const advanced = {};
                    if (capabilities.focusMode?.includes('continuous')) {
                        advanced.focusMode = 'continuous';
                    }
                    if (capabilities.exposureMode?.includes('continuous')) {
                        advanced.exposureMode = 'continuous';
                    }
                    if (capabilities.whiteBalanceMode?.includes('continuous')) {
                        advanced.whiteBalanceMode = 'continuous';
                    }
                    if (Object.keys(advanced).length > 0) {
                        try {
                            await track.applyConstraints({ advanced: [advanced] });
                        } catch (e) {
                            console.warn('[Camera] Failed to apply advanced track constraints:', e);
                        }
                    }

                    if ('torch' in capabilities) {
                        setTorchSupported(true);
                        setTorchOn(false);
                    } else {
                        setTorchSupported(false);
                    }

                    if ('zoom' in capabilities) {
                        setZoomSupported(true);
                        const zMin = capabilities.zoom.min || 1;
                        const zMax = capabilities.zoom.max || 1;
                        const zStep = capabilities.zoom.step || 0.1;
                        setZoomCapabilities({ min: zMin, max: zMax, step: zStep });
                        setZoomValue(zMin);
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

    const switchCamera = useCallback(async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

        let list = availableCameras;
        if (!list || list.length <= 1) {
            const res = await getCameraCandidates(activeCameraIndexRef.current);
            list = res.camerasList;
        }
        const nextIndex = (activeCameraIndexRef.current + 1) % Math.max(list.length, 2);
        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);

        await stopScanner();
        // Give the OS time to release the previous camera before opening the next
        setTimeout(() => {
            startScanner(nextIndex, { exclusive: true });
        }, 600);
    }, [availableCameras, stopScanner, startScanner, getCameraCandidates]);

    const handleCameraSelect = useCallback(async (index) => {
        const nextIndex = Number(index);
        if (Number.isNaN(nextIndex)) return;
        if (nextIndex === activeCameraIndexRef.current && scannerRunning.current) return;

        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);

        await stopScanner();
        setTimeout(() => {
            startScanner(nextIndex, { exclusive: true });
        }, 600);
    }, [stopScanner, startScanner]);

    // Handle USB device plugging/unplugging in real-time
    useEffect(() => {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.addEventListener !== 'function') return undefined;

        const handleDeviceChange = async () => {
            const res = await getCameraCandidates(activeCameraIndexRef.current);
            if (res?.camerasList?.length > 0) {
                setAvailableCameras(res.camerasList);
            }
        };

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, [getCameraCandidates]);

    useEffect(() => {
        if (activeTab !== 'scan' || modalOpen) {
            stopScanner();
            return undefined;
        }

        let cancelled = false;
        // Fast 40ms mount trigger for instant camera launch
        const timer = setTimeout(() => {
            if (!cancelled) startScanner();
        }, 40);

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
                            <div className="px-3 sm:px-4 py-2.5 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap sm:flex-nowrap">
                                <div className="flex items-center gap-2 min-w-0">
                                    <p className="text-xs font-bold text-slate-700 truncate">
                                        {verifying ? 'QR detected — verifying…' : scanning ? 'Point at transport QR' : 'Camera ready'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 flex-wrap sm:flex-nowrap">
                                    {availableCameras.length > 0 && (
                                        <select
                                            value={activeCameraIndex}
                                            onChange={(e) => handleCameraSelect(e.target.value)}
                                            disabled={modalOpen}
                                            className="px-2 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 max-w-[160px] sm:max-w-[210px] truncate shadow-2xs"
                                            title="Select camera device"
                                        >
                                            {availableCameras.map((cam, idx) => (
                                                <option key={cam.id || idx} value={idx}>
                                                    📷 {cam.label || `Camera ${idx + 1}`}
                                                </option>
                                            ))}
                                        </select>
                                    )}
                                    <button
                                        type="button"
                                        onClick={switchCamera}
                                        disabled={modalOpen}
                                        className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                                        title="Cycle through cameras"
                                    >
                                        <SwitchCamera size={13} className="text-blue-600" />
                                        <span className="hidden sm:inline">Switch</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => (scanning ? stopScanner() : startScanner())}
                                        disabled={modalOpen}
                                        className={`px-3 py-1.5 text-[11px] font-semibold rounded-lg border cursor-pointer disabled:opacity-50 transition-colors ${
                                            scanning
                                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700'
                                        }`}
                                    >
                                        {scanning ? 'Stop' : 'Start'}
                                    </button>
                                </div>
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
                                    className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-contain [&_video]:bg-black [&_video]:contrast-[1.08] [&_video]:brightness-[1.02] [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                />

                                {/* Camera Quick Controls (Switch Camera, Torch & Preset Zoom pills) */}
                                {scanning && (
                                    <div className="absolute top-3 right-3 left-3 flex justify-between items-start pointer-events-none z-30">
                                        <div className="bg-slate-950/85 border border-slate-800/80 text-slate-200 text-[9px] sm:text-[10px] font-extrabold tracking-wider uppercase px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm shadow-md">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            Live View
                                        </div>
                                        <div className="flex flex-col gap-2 items-end pointer-events-auto">
                                            {/* Switch Camera Overlay Button */}
                                            <button
                                                type="button"
                                                onClick={switchCamera}
                                                className="p-2 rounded-lg bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 transition-all shadow-md flex items-center justify-center cursor-pointer"
                                                title="Change / Switch Camera"
                                            >
                                                <SwitchCamera size={14} className="text-blue-400" />
                                            </button>

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
                            <div className="flex gap-4 pb-3 border-b border-slate-100 text-left items-stretch">
                                {/* Left column: Student photo, not rounded, not cropped (using object-contain) */}
                                <div className="w-28 border border-slate-200 overflow-hidden bg-slate-50 shadow-sm flex items-center justify-center rounded-lg shrink-0">
                                    {photoSrc ? (
                                        <img
                                            src={photoSrc}
                                            alt={detail.student_name || 'Passenger'}
                                            className="w-full h-full object-contain bg-slate-50"
                                        />
                                    ) : (
                                        <User className="text-slate-300" size={44} />
                                    )}
                                </div>

                                {/* Right column: Details in vertical rows */}
                                <div className="min-w-0 flex-1 space-y-2">
                                    {/* Row 1: Student Name */}
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Passenger</p>
                                        <h2 className="text-base sm:text-lg font-black text-slate-900 uppercase leading-tight break-words">
                                            {detail.student_name || '—'}
                                        </h2>
                                    </div>

                                    {/* Row 2: Verified Badge */}
                                    {result.ok && (
                                        <div className="w-fit">
                                            <span className="inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                <CheckCircle2 size={10} className="fill-emerald-800 text-white shrink-0" /> Verified
                                            </span>
                                        </div>
                                    )}

                                    {/* Row 3: ADM Number */}
                                    <div className="text-[11px] font-extrabold text-blue-800 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg w-fit">
                                        ADM: <span className="font-mono">{detail.admission_number || '—'}</span>
                                    </div>

                                    {/* Row 4: PIN Number */}
                                    {detail.pin_no && detail.pin_no !== 'N/A' && (
                                        <div className="text-[11px] font-extrabold text-slate-700 bg-slate-100 border border-slate-200 px-2.5 py-1 rounded-lg w-fit">
                                            PIN: <span className="font-mono">{detail.pin_no}</span>
                                        </div>
                                    )}
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
