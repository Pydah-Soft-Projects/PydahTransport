import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode';
import jsQR from 'jsqr';
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
    ZoomIn,
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
    const [scanInstruction, setScanInstruction] = useState('Searching for QR…');

    const scannerRef = useRef(null);
    const scannerRunning = useRef(false);
    const handleScanRef = useRef(null);
    const readerHostRef = useRef(null);
    const scanSessionRef = useRef(0);
    const busyRef = useRef(false);
    const lastScanRef = useRef({ text: '', at: 0 });
    const activeCameraIndexRef = useRef(0);
    const camerasFetchedRef = useRef(false);
    const availableCamerasRef = useRef([]);
    const scanResultTokenRef = useRef(0);

    const SCAN_COOLDOWN_MS = 1800;

    const isMobileDevice = useCallback(() => {
        if (typeof navigator === 'undefined') return false;
        const ua = navigator.userAgent || '';
        if (/Android|iPhone|iPad|iPod|Mobile|webOS|BlackBerry|IEMobile|Opera Mini/i.test(ua)) return true;
        return navigator.maxTouchPoints > 1 && window.matchMedia?.('(pointer: coarse)')?.matches;
    }, []);

    /**
     * NOTE (mobile QR): verification needs the rear camera by default.
     * Do not hardcode Front/Back — fetch real devices from the phone and let the user switch.
     *
     * CRITICAL (html5-qrcode): never put `videoConstraints` in the scanner config.
     * That field OVERRIDES cameraId/deviceId, so Android opens the default front
     * camera while the dropdown still shows "facing back".
     */
    const fetchCameras = useCallback(async ({ force = false } = {}) => {
        if (!force && camerasFetchedRef.current && availableCamerasRef.current.length > 0) {
            return availableCamerasRef.current;
        }

        // Basic permission so labels populate (do not pin facingMode here — it can stick on front)
        if (navigator.mediaDevices?.getUserMedia) {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch {
                // continue — getCameras may still work if permission was granted earlier
            }
            try {
                stream?.getTracks?.().forEach((t) => t.stop());
            } catch {
                // ignore
            }
            await new Promise((r) => setTimeout(r, 280));
        }

        let devices = [];
        try {
            devices = await Html5Qrcode.getCameras();
        } catch {
            devices = [];
        }

        const list = (Array.isArray(devices) ? devices : []).map((d, i) => ({
            id: d.id,
            label: (d.label && String(d.label).trim()) || `Camera ${i + 1}`,
        }));

        availableCamerasRef.current = list;
        // Avoid re-render loops that abort an in-flight camera start
        setAvailableCameras((prev) => {
            if (
                prev.length === list.length
                && prev.every((cam, i) => cam.id === list[i]?.id && cam.label === list[i]?.label)
            ) {
                return prev;
            }
            return list;
        });
        camerasFetchedRef.current = true;
        return list;
    }, []);

    /** Prefer a rear camera from the fetched list when the device labels it; otherwise index 0. */
    const preferRearCameraIndex = useCallback((list) => {
        if (!Array.isArray(list) || list.length === 0) return 0;
        const rear = list.findIndex((c) =>
            /back|rear|environment|facing\s*back|world/i.test(c.label || '')
        );
        if (rear >= 0) return rear;
        if (isMobileDevice()) {
            const nonFront = list.findIndex((c) => !/front|user|face|selfie|facing\s*front/i.test(c.label || ''));
            if (nonFront >= 0) return nonFront;
        }
        return 0;
    }, [isMobileDevice]);

    const isFrontLabel = useCallback((label = '') => /front|user|face|selfie|facing\s*front/i.test(label), []);
    const isRearLabel = useCallback((label = '') => /back|rear|environment|facing\s*back|world/i.test(label), []);

    /**
     * Scanner tuned for small printed pass QRs (do not change print layout).
     * NEVER put videoConstraints or aspectRatio here — they can override/break
     * deviceId selection on Android and surface as a fake "permission denied".
     */
    const getScannerConfig = useCallback(() => ({
        fps: 20,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            // ~48% crop helps small distant QRs fill more of the decode region
            const size = Math.max(180, Math.min(320, Math.floor(minEdge * 0.48)));
            return { width: size, height: size };
        },
        disableFlip: false,
    }), []);

    /** Prefer higher resolution so small printed modules resolve more pixels. */
    const deviceConstraint = useCallback((deviceId, highRes = true) => ({
        deviceId: { exact: deviceId },
        width: { ideal: highRes ? 1920 : 1280 },
        height: { ideal: highRes ? 1080 : 720 },
    }), []);

    const formatCameraError = useCallback((err) => {
        const name = String(err?.name || '');
        const message = String(err?.message || err || 'Camera unavailable.');
        const blob = `${name} ${message}`;

        if (/notallowed|permissiondenied|permission.?denied|securityerror/i.test(blob)) {
            return 'Camera permission denied. Allow camera access for this site, then tap Start.';
        }
        if (/notreadable|trackstart|could not start video|device.?in.?use|abort/i.test(blob)) {
            return 'Camera is busy or failed to start. Close other apps using the camera, then tap Start.';
        }
        if (/overconstrained|constraint|could not start.*camera/i.test(blob)) {
            return 'Could not open this camera with the requested settings. Tap Start to retry, or switch camera.';
        }
        if (/notfound|requested device not found|no camera/i.test(blob)) {
            return 'No usable camera found on this device.';
        }
        // html5-qrcode often wraps real errors — avoid always blaming permissions
        if (/permission|notallowed|denied/i.test(message) && !/overconstrained|notreadable|busy/i.test(blob)) {
            return 'Camera permission denied. Allow camera access for this site, then tap Start.';
        }
        return message.length > 160 ? `${message.slice(0, 160)}…` : message;
    }, []);

    /** Pick a modest zoom so small pass QRs decode without holding the phone flush to the card. */
    const pickSmallQrZoom = useCallback((zMin, zMax) => {
        const min = Number(zMin) || 1;
        const max = Number(zMax) || 1;
        if (max <= min) return min;
        // ~2x, or 35% into the zoom range — enough for tiny printed codes
        const target = Math.max(min * 1.8, min + (max - min) * 0.35);
        return Math.min(max, Math.max(min, Number(target.toFixed(2))));
    }, []);

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

    const getActiveTrack = useCallback(() => {
        try {
            const host = readerHostRef.current || document.getElementById('qr-reader');
            const video = host?.querySelector('video');
            if (video?.srcObject && typeof video.srcObject.getVideoTracks === 'function') {
                const tracks = video.srcObject.getVideoTracks();
                if (tracks && tracks.length > 0) return tracks[0];
            }
        } catch {
            // ignore
        }
        const scanner = scannerRef.current;
        if (scanner) {
            try {
                if (typeof scanner.getActiveCameraTrack === 'function') {
                    const track = scanner.getActiveCameraTrack();
                    if (track) return track;
                }
            } catch {
                // ignore
            }
        }
        return null;
    }, []);

    const offscreenCanvasRef = useRef(null);
    const frameLoopRef = useRef(null);

    const stopFrameProcessingLoop = useCallback(() => {
        if (frameLoopRef.current) {
            clearInterval(frameLoopRef.current);
            frameLoopRef.current = null;
        }
    }, []);

    const startFrameProcessingLoop = useCallback((onDecodedCallback) => {
        stopFrameProcessingLoop();
        const scanStartTime = Date.now();
        setScanInstruction('Scanning QR…');

        let nativeDetector = null;
        if (typeof window !== 'undefined' && 'BarcodeDetector' in window) {
            try {
                nativeDetector = new window.BarcodeDetector({ formats: ['qr_code'] });
            } catch {
                nativeDetector = null;
            }
        }

        if (!offscreenCanvasRef.current) {
            offscreenCanvasRef.current = document.createElement('canvas');
        }

        frameLoopRef.current = setInterval(async () => {
            if (busyRef.current) return;

            const elapsed = Date.now() - scanStartTime;
            if (elapsed > 8000) {
                setScanInstruction('QR not recognized — move closer or adjust lighting');
            } else if (elapsed > 4000) {
                setScanInstruction('Scanning QR… Move closer if small');
            }

            const host = readerHostRef.current || document.getElementById('qr-reader');
            const video = host?.querySelector('video');
            if (!video || video.readyState < 2 || video.videoWidth === 0) return;

            const width = video.videoWidth;
            const height = video.videoHeight;
            const canvas = offscreenCanvasRef.current;

            if (canvas.width !== width || canvas.height !== height) {
                canvas.width = width;
                canvas.height = height;
            }

            // Pass 1: Native GPU BarcodeDetector directly on video element
            if (nativeDetector) {
                try {
                    const barcodes = await nativeDetector.detect(video);
                    if (barcodes?.length > 0 && barcodes[0].rawValue) {
                        onDecodedCallback(barcodes[0].rawValue);
                        return;
                    }
                } catch {
                    // ignore
                }
            }

            // Pass 2: Draw video frame to canvas & decode using jsQR
            try {
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) return;
                ctx.drawImage(video, 0, 0, width, height);
                const imgData = ctx.getImageData(0, 0, width, height);

                // 2A. Standard raw frame decode
                let code = jsQR(imgData.data, width, height, { inversionAttempts: 'dontInvert' });
                if (code?.data) {
                    onDecodedCallback(code.data);
                    return;
                }

                // 2B. Inverted colors decode attempt
                code = jsQR(imgData.data, width, height, { inversionAttempts: 'onlyInvert' });
                if (code?.data) {
                    onDecodedCallback(code.data);
                    return;
                }

                // 2C. Grayscale & High-Contrast Adaptive Binarization
                const data = imgData.data;
                const len = data.length;
                for (let i = 0; i < len; i += 4) {
                    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
                    const contrast = gray < 120 ? Math.max(0, gray - 30) : Math.min(255, gray + 30);
                    data[i] = contrast;
                    data[i + 1] = contrast;
                    data[i + 2] = contrast;
                }

                code = jsQR(imgData.data, width, height, { inversionAttempts: 'attemptBoth' });
                if (code?.data) {
                    onDecodedCallback(code.data);
                    return;
                }
            } catch {
                // ignore
            }
        }, 110);
    }, [stopFrameProcessingLoop]);

    const stopScanner = useCallback(async () => {
        scanSessionRef.current += 1;
        stopFrameProcessingLoop();
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
    }, [clearReaderDom, stopFrameProcessingLoop]);

    const toggleTorch = useCallback(async () => {
        const track = getActiveTrack();
        if (!track) return;
        try {
            const nextTorch = !torchOn;
            await track.applyConstraints({
                advanced: [{ torch: nextTorch }]
            });
            setTorchOn(nextTorch);
        } catch (err) {
            console.error('Failed to toggle torch:', err);
        }
    }, [getActiveTrack, torchOn]);

    const handleZoomChange = useCallback(async (value) => {
        const requestedZoom = Number(value);
        const track = getActiveTrack();
        if (!track) {
            setZoomValue(requestedZoom);
            return;
        }
        try {
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
        } catch (err) {
            console.warn('Track zoom constraint error:', err);
            setZoomValue(requestedZoom);
        }
    }, [getActiveTrack]);

    const cycleZoom = useCallback(() => {
        const minZ = zoomCapabilities.min || 1;
        const maxZ = zoomCapabilities.max || 5;
        const steps = [minZ, 1.5, 2, 2.5, 3, 4]
            .map((z) => Math.min(maxZ, Math.max(minZ, z)))
            .filter((z, i, arr) => arr.indexOf(z) === i)
            .sort((a, b) => a - b);

        const current = Number(zoomValue) || minZ;
        const next = steps.find((z) => z > current + 0.05) ?? minZ;
        handleZoomChange(next);
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

    /** Online payload is useful only when it confirms identity or registration — not bare "not found". */
    const isUsefulOnlineVerify = (data) => {
        if (!data || typeof data !== 'object') return false;
        if (data.registered) return true;
        return Boolean(data.student_name || data.admission_number || data.status);
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
        setScanInstruction('QR detected, hold steady');
        setVerifying(true);
        setCameraError('');
        setScanFlash(true);
        const scanToken = ++scanResultTokenRef.current;

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
                requestId = parsed.payload?.rid ? String(parsed.payload.rid) : parsed.requestId;
                if (requestId) parsed.requestId = requestId;
            } else if (parsed.type === 'legacy_url' || parsed.type === 'legacy_id' || parsed.type === 'json' || parsed.type === 'student_id') {
                signatureStatus = 'unverified';
            } else {
                const urlId = extractRequestIdFromText(rawText);
                const numId = rawText.match(/([a-f0-9]{24}|\d+)/i)?.[1];
                const fallbackId = urlId || numId;
                if (fallbackId) {
                    parsed.requestId = fallbackId;
                    requestId = fallbackId;
                    signatureStatus = 'unverified';
                }
            }

            // 1. Instant local IndexedDB lookup for zero-latency UI modal response (< 10ms)
            const offline = await verifyOfflinePassenger(parsed, lastSyncAt);

            if (offline.local) {
                showResult({
                    ok: offline.ok,
                    title: offline.title,
                    message: offline.message,
                    mode: online ? 'ONLINE' : 'OFFLINE',
                    signatureStatus,
                    data: offline.data,
                    lastSyncAt,
                    warning: !offline.ok,
                });
                await stopScanner();

                // 2. Background online confirm — never wipe a good local result with bare "not found"
                if (online) {
                    const idsToTry = [];
                    const localRid = offline.local?.requestId ? String(offline.local.requestId) : null;
                    // Prefer latest local request id (QR rid may be an older superseded id)
                    if (localRid) idsToTry.push(localRid);
                    if (requestId && String(requestId) !== localRid) idsToTry.push(String(requestId));

                    (async () => {
                        let best = null;
                        for (const id of idsToTry) {
                            try {
                                const { ok: httpOk, data } = await fetchOnlineVerify(id);
                                if (!httpOk || !isUsefulOnlineVerify(data)) continue;
                                best = data;
                                if (data.registered) break;
                            } catch {
                                // try next id
                            }
                        }

                        // Stale response after a newer scan / modal close — ignore
                        if (scanToken !== scanResultTokenRef.current) return;
                        if (!best) {
                            // Keep local UI; still log that online could not re-confirm
                            logScan({
                                verificationResult: offline.ok ? 'VALID_LOCAL_ONLINE_MISS' : 'INACTIVE_LOCAL_ONLINE_MISS',
                                mode: 'LOCAL_SYNCED',
                                requestId: localRid || requestId,
                                studentId: offline.local?.studentId || parsed.payload?.sid || null,
                                rawPayload: parsed.payload || { requestId },
                            }).catch(() => {});
                            return;
                        }

                        const registered = Boolean(best.registered);
                        showResult({
                            ok: registered,
                            title: registered ? 'Verified' : 'Not Active',
                            message: best.message || (registered ? 'Registered in transport system' : 'Not active'),
                            mode: 'ONLINE',
                            signatureStatus: signatureStatus || (parsed.type === 'legacy_url' || parsed.type === 'legacy_id' ? 'legacy_url' : null),
                            data: best,
                            lastSyncAt,
                        });
                        logScan({
                            verificationResult: registered ? 'VALID' : 'INACTIVE',
                            mode: 'ONLINE',
                            requestId: localRid || requestId,
                            studentId: best?.admission_number || offline.local?.studentId || null,
                            rawPayload: parsed.payload || { requestId },
                        }).catch(() => {});
                    })().catch(() => {});
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
            if (online && (requestId || parsed.studentId || rawText)) {
                try {
                    const { ok: httpOk, data } = await fetchOnlineVerify(requestId);
                    if (httpOk && isUsefulOnlineVerify(data)) {
                        const registered = Boolean(data?.registered);
                        showResult({
                            ok: registered,
                            title: registered ? 'Verified' : 'Not Active',
                            message: data.message || (registered ? 'Registered in transport system' : 'Not active'),
                            mode: 'ONLINE',
                            signatureStatus: data.signature || signatureStatus || 'unverified',
                            data: data.data,
                            lastSyncAt,
                            warning: !registered,
                        });
                        await logScan({
                            verificationResult: registered ? 'VALID' : 'INACTIVE',
                            mode: 'ONLINE',
                            requestId: data.requestId || requestId,
                            studentId: data.data?.admission_number,
                            rawPayload: parsed.payload || { raw: rawText },
                        });
                        await stopScanner();
                        return;
                    }
                    if (httpOk && data && !isUsefulOnlineVerify(data)) {
                        showResult({
                            ok: false,
                            title: 'Not Active',
                            message: data.message || 'No transport registration found for this QR code.',
                            mode: 'ONLINE',
                            signatureStatus,
                            data: null,
                            lastSyncAt,
                        });
                        await logScan({
                            verificationResult: 'INACTIVE',
                            mode: 'ONLINE',
                            requestId,
                            studentId: data?.admission_number,
                            rawPayload: parsed.payload || { requestId },
                        });
                        await stopScanner();
                        return;
                    }
                    if (httpOk && data && !isUsefulOnlineVerify(data)) {
                        showResult({
                            ok: false,
                            title: 'Not Active',
                            message: data.message || 'No transport registration found for this QR code.',
                            mode: 'ONLINE',
                            signatureStatus,
                            data: null,
                            lastSyncAt,
                        });
                        await logScan({
                            verificationResult: 'INACTIVE',
                            mode: 'ONLINE',
                            requestId,
                            rawPayload: parsed.payload || { requestId },
                        });
                        await stopScanner();
                        return;
                    }
                } catch {
                    // fall through to offline result
                }
            }

            await showOfflineResult(parsed, signatureStatus);
            await stopScanner();
        } finally {
            setVerifying(false);
            setTimeout(() => setScanFlash(false), 600);
            busyRef.current = false;
        }
    }, [academicYear, lastSyncAt, online, stopScanner]);

    handleScanRef.current = processQrText;

    const startScanner = useCallback(async (targetIndex, options = {}) => {
        const exclusive = Boolean(options.exclusive);
        const preferRear = options.preferRear !== false;
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

        await new Promise((r) => setTimeout(r, exclusive ? 400 : 150));

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

        const onDecodeError = () => {
            // silent during normal scanning
        };

        try {
            const camerasList = await fetchCameras();
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

            // Config must NOT include videoConstraints — that overrides deviceId in html5-qrcode
            const config = getScannerConfig();

            let ordered = [...camerasList];
            if (camerasList.length > 0) {
                let idx;
                if (targetIndex !== undefined && Number.isFinite(Number(targetIndex))) {
                    const len = camerasList.length;
                    idx = ((Number(targetIndex) % len) + len) % len;
                } else if (preferRear) {
                    idx = preferRearCameraIndex(camerasList);
                } else {
                    idx = activeCameraIndexRef.current || 0;
                }
                const preferred = camerasList[idx];
                ordered = [
                    preferred,
                    ...camerasList.filter((_, i) => i !== idx),
                ].filter(Boolean);

                // When user picks one camera, only try that device
                if (exclusive) {
                    ordered = preferred ? [preferred] : [];
                }
            }

            const stopPartialStart = async () => {
                try {
                    const state = scanner.getState?.();
                    if (state === 2 || state === 3) await scanner.stop();
                } catch { /* ignore */ }
            };

            const trackMatchesCamera = (track, cam) => {
                if (!track?.getSettings || !cam?.id) return true; // can't verify — accept
                const settings = track.getSettings() || {};
                if (settings.deviceId && settings.deviceId !== cam.id) return false;
                if (settings.facingMode === 'user' && isRearLabel(cam.label)) return false;
                if (settings.facingMode === 'environment' && isFrontLabel(cam.label)) return false;
                return true;
            };

            let started = false;
            let startedCam = null;
            let lastError = null;

            for (const cam of ordered) {
                if (!cam?.id || session !== scanSessionRef.current) break;

                // Open with plain deviceId first (most reliable on Android).
                // High-res ideals are optional — overconstraints must not block the camera.
                const attempts = [
                    cam.id,
                    { deviceId: { exact: cam.id } },
                    deviceConstraint(cam.id, false),
                    deviceConstraint(cam.id, true),
                ];

                for (const cameraArg of attempts) {
                    if (session !== scanSessionRef.current) return;
                    try {
                        await scanner.start(cameraArg, config, onDecoded, () => {});
                        const track = scanner.getActiveCameraTrack?.() || null;
                        if (!trackMatchesCamera(track, cam)) {
                            lastError = new Error('Camera mismatch — retrying next device.');
                            await stopPartialStart();
                            continue;
                        }
                        started = true;
                        startedCam = cam;
                        break;
                    } catch (err) {
                        lastError = err;
                        await stopPartialStart();
                    }
                }
                if (started) break;
            }

            // Last resort only if no device list: facingMode (never mix with videoConstraints in config)
            if (!started && camerasList.length === 0) {
                const fallbacks = isMobileDevice()
                    ? [{ facingMode: { exact: 'environment' } }, { facingMode: 'environment' }, { facingMode: 'user' }]
                    : [{ facingMode: 'environment' }, { facingMode: 'user' }];
                for (const cameraArg of fallbacks) {
                    if (session !== scanSessionRef.current) return;
                    try {
                        await scanner.start(cameraArg, config, onDecoded, () => {});
                        started = true;
                        break;
                    } catch (err) {
                        lastError = err;
                        await stopPartialStart();
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

            // Dropdown must follow the device that actually opened
            let resolvedIdx = 0;
            if (startedCam?.id) {
                const byId = camerasList.findIndex((c) => c.id === startedCam.id);
                if (byId >= 0) resolvedIdx = byId;
            } else {
                try {
                    const openedId = scanner.getActiveCameraTrack?.()?.getSettings?.()?.deviceId;
                    const byOpened = camerasList.findIndex((c) => c.id === openedId);
                    if (byOpened >= 0) resolvedIdx = byOpened;
                } catch {
                    resolvedIdx = preferRearCameraIndex(camerasList);
                }
            }

            activeCameraIndexRef.current = resolvedIdx;
            setActiveCameraIndex(resolvedIdx);

            if (session !== scanSessionRef.current) {
                try { await scanner.stop(); } catch { /* ignore */ }
                try { scanner.clear(); } catch { /* ignore */ }
                clearReaderDom();
                return;
            }

            scannerRunning.current = true;
            setScanning(true);
            setCameraError('');
            startFrameProcessingLoop(onDecoded);

            try {
                const track = getActiveTrack();
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

                    // Auto-zoom a bit so already-printed small pass QRs decode without phone-flush distance
                    let appliedZoom = null;
                    if ('zoom' in capabilities) {
                        const zMin = capabilities.zoom.min || 1;
                        const zMax = capabilities.zoom.max || 1;
                        const zStep = capabilities.zoom.step || 0.1;
                        setZoomSupported(true);
                        setZoomCapabilities({ min: zMin, max: zMax, step: zStep });
                        appliedZoom = pickSmallQrZoom(zMin, zMax);
                        advanced.zoom = appliedZoom;
                        setZoomValue(appliedZoom);
                    } else {
                        setZoomSupported(false);
                    }

                    if (Object.keys(advanced).length > 0) {
                        try {
                            await track.applyConstraints({ advanced: [advanced] });
                        } catch (e) {
                            console.warn('[Camera] Failed to apply advanced track constraints:', e);
                            if (appliedZoom != null) setZoomValue(capabilities.zoom?.min || 1);
                        }
                    }

                    if ('torch' in capabilities) {
                        setTorchSupported(true);
                        setTorchOn(false);
                    } else {
                        setTorchSupported(false);
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
            setCameraError(formatCameraError(err));
            setScanning(false);
        }
    }, [
        clearReaderDom,
        deviceConstraint,
        fetchCameras,
        formatCameraError,
        getScannerConfig,
        isFrontLabel,
        isMobileDevice,
        isRearLabel,
        pickSmallQrZoom,
        preferRearCameraIndex,
    ]);

    // Keep latest start/stop on refs so the mount effect does not restart on every callback identity change
    const startScannerRef = useRef(startScanner);
    const stopScannerRef = useRef(stopScanner);
    startScannerRef.current = startScanner;
    stopScannerRef.current = stopScanner;

    const switchCamera = useCallback(async (e) => {
        if (e && typeof e.preventDefault === 'function') e.preventDefault();
        if (e && typeof e.stopPropagation === 'function') e.stopPropagation();

        let list = availableCameras;
        if (!list || list.length === 0) {
            list = await fetchCameras();
        }
        if (!list.length) {
            setCameraError('No cameras found on this device.');
            return;
        }

        const nextIndex = (activeCameraIndexRef.current + 1) % list.length;
        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);

        await stopScanner();
        setTimeout(() => {
            startScanner(nextIndex, { exclusive: true, preferRear: false });
        }, 500);
    }, [availableCameras, stopScanner, startScanner, fetchCameras]);

    const handleCameraSelect = useCallback(async (index) => {
        const nextIndex = Number(index);
        if (Number.isNaN(nextIndex)) return;
        if (nextIndex === activeCameraIndexRef.current && scannerRunning.current) return;

        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);

        await stopScanner();
        setTimeout(() => {
            startScanner(nextIndex, { exclusive: true, preferRear: false });
        }, 500);
    }, [stopScanner, startScanner]);

    // Refresh fetched camera list when USB / external cameras are plugged
    useEffect(() => {
        if (!navigator.mediaDevices || typeof navigator.mediaDevices.addEventListener !== 'function') return undefined;

        const handleDeviceChange = async () => {
            camerasFetchedRef.current = false;
            availableCamerasRef.current = [];
            const list = await fetchCameras({ force: true });
            if (list?.length > 0) setAvailableCameras(list);
        };

        navigator.mediaDevices.addEventListener('devicechange', handleDeviceChange);
        return () => {
            navigator.mediaDevices.removeEventListener('devicechange', handleDeviceChange);
        };
    }, [fetchCameras]);

    useEffect(() => {
        if (activeTab !== 'scan' || modalOpen) {
            stopScannerRef.current();
            return undefined;
        }

        let cancelled = false;
        // Give the DOM a beat; avoid restarting whenever startScanner identity changes
        const timer = setTimeout(() => {
            if (!cancelled) startScannerRef.current();
        }, 120);

        return () => {
            cancelled = true;
            clearTimeout(timer);
            stopScannerRef.current();
        };
    }, [activeTab, modalOpen]);

    const closeResultModal = () => {
        scanResultTokenRef.current += 1; // invalidate any in-flight online re-check
        setModalOpen(false);
        setResult(null);
        busyRef.current = false;
        lastScanRef.current = { text: '', at: 0 };
        setVerifying(false);
    };

    const detail = result?.data;
    const hasPassengerDetail = Boolean(
        detail && (detail.student_name || detail.admission_number || detail.route_name || detail.bus_id || detail.status)
    );
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
                                        {verifying ? 'QR detected — verifying…' : scanning ? 'Center the pass QR in the box' : 'Camera ready'}
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
                                                    {cam.label || `Camera ${idx + 1}`}
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

                            <div className="relative bg-slate-950 aspect-[3/4] sm:aspect-video max-h-[72vh] sm:max-h-[520px] min-h-[380px] sm:min-h-[460px] overflow-hidden flex flex-col items-center justify-center">
                                {/*
                                  Video fills full container height and width using object-cover.
                                  Hide Html5Qrcode default shaded region and SVG canvas overlays so only custom React JSX viewfinder renders.
                                */}
                                <div
                                    id="qr-reader"
                                    ref={readerHostRef}
                                    className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-contain [&_video]:bg-black [&_video]:contrast-[1.12] [&_video]:brightness-[1.04] [&_video]:saturate-[1.05] [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                />

                                {/* Camera Quick Controls (Switch Camera, Torch & Zoom for small pass QRs) */}
                                {scanning && (
                                    <div className="absolute top-3 right-3 left-3 flex justify-between items-start pointer-events-none z-30">
                                        <div className="bg-slate-950/85 border border-slate-800/80 text-slate-200 text-[9px] sm:text-[10px] font-extrabold tracking-wider uppercase px-2.5 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm shadow-md">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            {availableCameras[activeCameraIndex]?.label || 'Live View'}
                                        </div>
                                        <div className="flex flex-col gap-2 items-end pointer-events-auto">
                                            <button
                                                type="button"
                                                onClick={switchCamera}
                                                className="p-2.5 rounded-full bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 active:scale-95 transition-all shadow-md flex items-center justify-center cursor-pointer"
                                                title="Change / Switch Camera"
                                            >
                                                <SwitchCamera size={15} className="text-blue-400" />
                                            </button>

                                            {zoomSupported && (
                                                <button
                                                    type="button"
                                                    onClick={cycleZoom}
                                                    className="px-2 py-1.5 rounded-lg bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
                                                    title="Zoom for small printed QR (tap to cycle)"
                                                >
                                                    <ZoomIn size={14} className="text-emerald-400" />
                                                    <span className="text-[10px] font-bold tabular-nums">{Number(zoomValue).toFixed(1)}x</span>
                                                </button>
                                            )}

                                            {torchSupported && (
                                                <button
                                                    type="button"
                                                    onClick={toggleTorch}
                                                    className={`p-2.5 rounded-full border active:scale-95 transition-all shadow-md flex items-center justify-center cursor-pointer ${
                                                        torchOn
                                                            ? 'bg-yellow-400 text-slate-900 border-yellow-300 shadow-[0_0_12px_rgba(250,204,21,0.5)]'
                                                            : 'bg-slate-950/80 text-slate-300 border-slate-800 hover:text-white'
                                                    }`}
                                                    title={torchOn ? "Turn flashlight OFF" : "Turn flashlight ON"}
                                                >
                                                    {torchOn ? <Zap size={15} className="fill-current" /> : <ZapOff size={15} />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Decorative viewfinder — aim the small pass QR inside this box */}
                                {scanning && !verifying && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                                        <div className="relative w-[48%] max-w-[280px] min-w-[160px] aspect-square">
                                            <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                            <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                            <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                            <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                            <div className="qr-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                                        </div>
                                    </div>
                                )}

                                {/* Camera Zoom Preset Selector Overlay (Positioned floating at bottom) */}
                                {scanning && zoomSupported && (
                                    <div className="absolute bottom-3 inset-x-0 flex justify-center z-30 pointer-events-auto px-4">
                                        <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-1 rounded-full shadow-lg">
                                            {[1, 1.5, 2, 3, 5]
                                                .filter(z => z >= (zoomCapabilities.min || 1) && z <= (zoomCapabilities.max || 1))
                                                .map((z) => {
                                                    const isActive = Math.abs(zoomValue - z) < 0.1;
                                                    return (
                                                        <button
                                                            key={z}
                                                            type="button"
                                                            onClick={() => handleZoomChange(z)}
                                                            className={`px-2.5 py-1 text-[11px] font-bold rounded-full transition-all cursor-pointer ${
                                                                isActive
                                                                    ? 'bg-blue-600 text-white shadow-sm scale-105'
                                                                    : 'text-slate-300 hover:text-white hover:bg-slate-800/60'
                                                            }`}
                                                        >
                                                            {z}x
                                                        </button>
                                                    );
                                                })}
                                        </div>
                                    </div>
                                )}

                                {/* Detected flash overlay */}
                                {scanFlash && (
                                    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-emerald-500/25 animate-pulse">
                                        <div className="bg-white/95 rounded-2xl px-4 py-3 shadow-lg flex items-center gap-2">
                                            <CheckCircle2 className="text-emerald-600" size={22} />
                                            <span className="text-sm font-bold text-slate-800">QR Scanned</span>
                                        </div>
                                    </div>
                                )}

                                {verifying && !scanFlash && (
                                    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center bg-black/40">
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
                            {scanning && !cameraError && (
                                <div className="px-3 py-2 text-[11px] text-slate-600 bg-slate-50 border-t border-slate-100">
                                    Small printed pass QR: hold steady and use <span className="font-semibold">Zoom</span> if needed — no need to reprint cards.
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
                                    </p>
                                </div>
                            </div>
                        )}

                        {hasPassengerDetail && (
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

                        {hasPassengerDetail && (
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
