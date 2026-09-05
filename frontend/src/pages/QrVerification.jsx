import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
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
    Bus,
    Users,
    Search,
    ArrowLeft,
    Check,
    Clock,
    Filter,
    AlertOctagon,
    Sparkles,
    ChevronRight,
    X,
    UserCheck,
    ShieldAlert,
    GraduationCap,
    Briefcase,
    ChevronDown,
    CheckCheck,
    RotateCcw,
    MapPin,
    Building2,
    Calendar,
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
    idbFindPassenger,
    idbGetAllPassengers,
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
    buildOfflineLookupKeys,
    extractRequestIdFromText,
} from '../utils/qrVerification';

const QrVerification = () => {
    const academicYearOptions = getAcademicYearOptions();
    const [searchParams, setSearchParams] = useSearchParams();
    const tabParam = searchParams.get('tab');
    const initialTab = (tabParam === 'inspection' || tabParam === 'sync' || tabParam === 'scan') ? tabParam : 'scan';
    const [activeTab, setActiveTab] = useState(initialTab); // 'scan' | 'inspection' | 'sync'

    useEffect(() => {
        const currentParam = searchParams.get('tab');
        if (currentParam && (currentParam === 'inspection' || currentParam === 'sync' || currentParam === 'scan')) {
            setActiveTab(currentParam);
        }
    }, [searchParams]);

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

    // ==========================================
    // INSPECTION STATE
    // ==========================================
    const [rawRoutes, setRawRoutes] = useState([]);
    const [rawBuses, setRawBuses] = useState([]);
    const [allCachedPassengers, setAllCachedPassengers] = useState([]);
    const [loadingInspectionData, setLoadingInspectionData] = useState(false);
    const [selectedRoute, setSelectedRoute] = useState(null);
    const [routeSearchQuery, setRouteSearchQuery] = useState('');
    const [inspectionSearchQuery, setInspectionSearchQuery] = useState('');
    const [inspectionFilter, setInspectionFilter] = useState('all'); // 'all' | 'students' | 'faculty' | 'inspected' | 'pending'
    const [inspectionStageFilter, setInspectionStageFilter] = useState('all');
    const [inspectionNotification, setInspectionNotification] = useState(null);
    const [wrongBusModal, setWrongBusModal] = useState({
        isOpen: false,
        passenger: null,
        scannedRouteId: '',
        scannedRouteName: '',
        scannedBusId: '',
        targetRouteId: '',
        targetRouteName: '',
        targetBuses: [],
    });

    // Inspected records persisted per date + academic year in localStorage
    const getInspectionStorageKey = useCallback((year) => {
        const today = new Date().toISOString().slice(0, 10);
        return `pydah_inspected_${year || 'curr'}_${today}`;
    }, []);

    const [inspectedMap, setInspectedMap] = useState(() => {
        try {
            const today = new Date().toISOString().slice(0, 10);
            const key = `pydah_inspected_${getDefaultAcademicYear()}_${today}`;
            const stored = localStorage.getItem(key);
            return stored ? JSON.parse(stored) : {};
        } catch {
            return {};
        }
    });

    // Sync inspection storage whenever map or academicYear changes
    useEffect(() => {
        try {
            const key = getInspectionStorageKey(academicYear);
            localStorage.setItem(key, JSON.stringify(inspectedMap));
        } catch (e) {
            console.error('Failed to save inspectedMap to localStorage', e);
        }
    }, [inspectedMap, academicYear, getInspectionStorageKey]);

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

    const fetchCameras = useCallback(async ({ force = false } = {}) => {
        if (!force && camerasFetchedRef.current && availableCamerasRef.current.length > 0) {
            return availableCamerasRef.current;
        }

        if (navigator.mediaDevices?.getUserMedia) {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
            } catch {
                // continue
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

    const getScannerConfig = useCallback(() => ({
        fps: 20,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
            const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
            const size = Math.max(180, Math.min(320, Math.floor(minEdge * 0.48)));
            return { width: size, height: size };
        },
        disableFlip: false,
    }), []);

    const deviceConstraint = useCallback((devId, highRes = true) => ({
        deviceId: { exact: devId },
        width: { ideal: highRes ? 1920 : 1280 },
        height: { ideal: highRes ? 1080 : 720 },
    }), []);

    const playBeepFeedback = useCallback((isSuccess) => {
        try {
            const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
            if (AudioCtxClass) {
                const audioCtx = new AudioCtxClass();
                const oscillator = audioCtx.createOscillator();
                const gainNode = audioCtx.createGain();

                oscillator.connect(gainNode);
                gainNode.connect(audioCtx.destination);
                oscillator.type = 'sine';

                if (isSuccess) {
                    oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
                    gainNode.gain.setValueAtTime(0.12, audioCtx.currentTime);
                    oscillator.start();
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.16);
                    oscillator.stop(audioCtx.currentTime + 0.16);
                } else {
                    oscillator.frequency.setValueAtTime(440, audioCtx.currentTime);
                    gainNode.gain.setValueAtTime(0.15, audioCtx.currentTime);
                    oscillator.start();
                    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
                    oscillator.stop(audioCtx.currentTime + 0.25);
                }
            }
        } catch (err) {
            console.warn('[Audio] Beep failed:', err);
        }

        if (typeof navigator !== 'undefined' && navigator.vibrate) {
            try {
                if (isSuccess) {
                    navigator.vibrate(100);
                } else {
                    navigator.vibrate([150, 100, 150]);
                }
            } catch {
                // ignore
            }
        }
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

    // Load Inspection Data (Routes, Buses, Cached Passengers)
    const loadInspectionData = useCallback(async () => {
        setLoadingInspectionData(true);
        try {
            const cachedPassengers = await idbGetAllPassengers();
            setAllCachedPassengers(cachedPassengers || []);

            let routesData = [];
            let busesData = [];

            if (online && isAuthenticated()) {
                try {
                    const [routesRes, busesRes] = await Promise.all([
                        apiFetch(`${API_BASE}/routes?academicYear=${encodeURIComponent(academicYear)}`).catch(() => null),
                        apiFetch(`${API_BASE}/buses`).catch(() => null),
                    ]);

                    if (routesRes && routesRes.ok) {
                        routesData = await routesRes.json().catch(() => []);
                    }
                    if (busesRes && busesRes.ok) {
                        busesData = await busesRes.json().catch(() => []);
                    }
                } catch (e) {
                    console.warn('Could not fetch routes/buses from server, using local fallback:', e);
                }
            }

            setRawRoutes(Array.isArray(routesData) ? routesData : []);
            setRawBuses(Array.isArray(busesData) ? busesData : []);
        } catch (err) {
            console.error('Error loading inspection data:', err);
        } finally {
            setLoadingInspectionData(false);
        }
    }, [academicYear, online]);

    useEffect(() => {
        setDeviceId(getOrCreateDeviceId());
        refreshMeta();
        loadInspectionData();

        const onOnline = () => setOnline(true);
        const onOffline = () => setOnline(false);
        window.addEventListener('online', onOnline);
        window.addEventListener('offline', onOffline);
        return () => {
            window.removeEventListener('online', onOnline);
            window.removeEventListener('offline', onOffline);
        };
    }, [refreshMeta, loadInspectionData]);

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
                    // fall through
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

    const startFrameProcessingLoop = useCallback((onDecodedCallback) => {
        // background jsQR enhancement
    }, []);

    const stopFrameProcessingLoop = useCallback(() => {
        // no-op
    }, []);

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
            await loadInspectionData();
            setSyncMessage(`Synced ${syncData.count || 0} record${syncData.count === 1 ? '' : 's'} for ${academicYear}${fullSync ? ' (full sync)' : ''}.`);
        } catch (err) {
            setSyncMessage(err.message || 'Sync failed');
        } finally {
            setSyncing(false);
        }
    }, [academicYear, online, recordCount, refreshMeta, loadInspectionData]);

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
                // queued locally
            }
        }
    };

    const showResult = (nextResult) => {
        setResult(nextResult);
        setScanFlash(true);
        playBeepFeedback(nextResult.ok);
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

    // ==========================================
    // STANDALONE SCAN HANDLER
    // ==========================================
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
                        // cached
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

                if (online) {
                    const idsToTry = [];
                    const localRid = offline.local?.requestId ? String(offline.local.requestId) : null;
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
                                // try next
                            }
                        }

                        if (scanToken !== scanResultTokenRef.current) return;
                        if (!best) {
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
                } catch {
                    // fall through
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

    // ==========================================
    // INSPECTION SCAN HANDLER
    // ==========================================
    const markPassengerInspected = useCallback((passenger, wrongRouteOverride = false) => {
        if (!passenger) return;
        const pKey = String(passenger.requestId || passenger.studentId || passenger.mongoId);
        const record = {
            requestId: passenger.requestId || passenger.id,
            studentId: passenger.studentId || passenger.admission_number || passenger.emp_no,
            studentName: passenger.studentName || passenger.student_name || passenger.employee_name || 'Passenger',
            userType: passenger.userType || passenger.user_type || 'student',
            routeId: passenger.routeId || passenger.route_id,
            routeName: passenger.routeName || passenger.route_name,
            stageName: passenger.stageName || passenger.stage_name,
            busId: passenger.busId || passenger.bus_id,
            inspectedAt: new Date().toISOString(),
            method: 'QR_SCAN',
            wrongRouteOverride: Boolean(wrongRouteOverride),
            originalRouteId: passenger.routeId || passenger.route_id,
            originalBusId: passenger.busId || passenger.bus_id,
        };

        setInspectedMap((prev) => ({
            ...prev,
            [pKey]: record,
        }));
    }, []);

    const undoPassengerInspected = useCallback((passengerKey) => {
        setInspectedMap((prev) => {
            const next = { ...prev };
            delete next[passengerKey];
            return next;
        });
    }, []);

    const processInspectionScan = useCallback(async (rawText) => {
        if (!rawText || busyRef.current || !selectedRoute) return;
        busyRef.current = true;
        setScanInstruction('QR detected — verifying route…');
        setVerifying(true);
        setCameraError('');
        setScanFlash(true);

        try {
            const parsed = parseQrText(rawText);
            let requestId = parsed.requestId || null;

            if (parsed.type === 'signed') {
                requestId = parsed.payload?.rid ? String(parsed.payload.rid) : parsed.requestId;
                if (requestId) parsed.requestId = requestId;
            } else {
                const urlId = extractRequestIdFromText(rawText);
                const numId = rawText.match(/([a-f0-9]{24}|\d+)/i)?.[1];
                const fallbackId = urlId || numId;
                if (fallbackId) {
                    parsed.requestId = fallbackId;
                    requestId = fallbackId;
                }
            }

            // 1. Local IndexedDB passenger lookup
            let passenger = await idbFindPassenger(buildOfflineLookupKeys(parsed));
            if (!passenger && parsed.studentId) {
                passenger = await idbFindPassenger({ studentId: parsed.studentId });
            }
            if (!passenger && (parsed.requestId || rawText)) {
                passenger = await idbFindPassenger({ requestId: parsed.requestId || rawText, studentId: rawText });
            }

            // 1b. Direct lookup across all cached passengers by admission number, PIN, or request ID
            if (!passenger && allCachedPassengers.length > 0) {
                const cleanRaw = String(rawText || '').trim().toLowerCase();
                const sidRaw = String(parsed.studentId || '').trim().toLowerCase();
                const ridRaw = String(parsed.requestId || '').trim().toLowerCase();

                passenger = allCachedPassengers.find((p) => {
                    const sId = String(p.studentId || p.admission_number || p.emp_no || '').trim().toLowerCase();
                    const pin = String(p.pinNo || p.pin_no || '').trim().toLowerCase();
                    const req = String(p.requestId || '').trim().toLowerCase();
                    const mon = String(p.mongoId || '').trim().toLowerCase();
                    return (
                        (cleanRaw && (sId === cleanRaw || pin === cleanRaw || req === cleanRaw || mon === cleanRaw))
                        || (sidRaw && sId === sidRaw)
                        || (ridRaw && (req === ridRaw || mon === ridRaw))
                    );
                });
            }

            // 2. Online fallback if not found in local IDB
            if (!passenger && online && (requestId || parsed.studentId || rawText)) {
                try {
                    const lookupId = requestId || parsed.studentId || rawText.trim();
                    const { ok: httpOk, data } = await fetchOnlineVerify(lookupId);
                    if (httpOk && data && isUsefulOnlineVerify(data)) {
                        passenger = {
                            requestId: data.requestId || requestId || lookupId,
                            mongoId: data._id || data.requestId,
                            studentId: data.admission_number || data.emp_no || lookupId,
                            studentName: data.student_name || data.employee_name,
                            userType: data.user_type || 'student',
                            routeId: data.route_id,
                            routeName: data.route_name,
                            stageName: data.stage_name,
                            busId: data.bus_id,
                            transportStatus: data.status || 'approved',
                            studentPhoto: data.student_photo,
                            pinNo: data.pin_no,
                            academicYear: data.academic_year,
                        };
                    }
                } catch {
                    // ignore
                }
            }

            if (!passenger) {
                playBeepFeedback(false);
                setWrongBusModal({
                    isOpen: true,
                    passenger: {
                        studentName: 'Unregistered / Unknown Pass',
                        studentId: rawText.slice(0, 32),
                        userType: 'unknown',
                        stageName: 'Not registered in transport system',
                        pinNo: '—',
                        routeId: 'Unassigned',
                        routeName: 'No active transport registration',
                        busId: 'None',
                    },
                    scannedRouteId: 'Unregistered',
                    scannedRouteName: 'No active transport pass found',
                    scannedBusId: 'None',
                    targetRouteId: selectedRoute.routeId,
                    targetRouteName: selectedRoute.routeName,
                    targetBuses: selectedRoute.assignedBuses || [],
                });
                return;
            }

            // Check if student was already inspected/checked in
            const pKey = String(passenger.requestId || passenger.studentId || passenger.mongoId);
            const isAlreadyInspected = Boolean(inspectedMap[pKey]);

            // Exact Route comparison
            const normalizeRouteNumber = (id) => {
                if (!id) return '';
                const clean = String(id).trim().toLowerCase();
                const match = clean.match(/\d+/);
                return match ? parseInt(match[0], 10).toString() : clean;
            };

            const normPassengerRoute = normalizeRouteNumber(passenger.routeId || passenger.route_id);
            const normSelectedRoute = normalizeRouteNumber(selectedRoute.routeId);

            const rawPassengerRoute = String(passenger.routeId || passenger.route_id || '').trim().toLowerCase();
            const rawSelectedRoute = String(selectedRoute.routeId || '').trim().toLowerCase();

            const isRouteIdMatch = (normPassengerRoute && normSelectedRoute && normPassengerRoute === normSelectedRoute)
                || (rawPassengerRoute && rawSelectedRoute && rawPassengerRoute === rawSelectedRoute);

            const isRouteNameMatch = Boolean(
                passenger.routeName && selectedRoute.routeName
                && String(passenger.routeName).trim().toLowerCase() === String(selectedRoute.routeName).trim().toLowerCase()
            );

            const isRouteMatch = isRouteIdMatch || isRouteNameMatch;

            if (isRouteMatch) {
                // Direct match on this bus/route -> Check In Student!
                markPassengerInspected(passenger, false);
                playBeepFeedback(true);
                setInspectionNotification({
                    type: 'success',
                    title: isAlreadyInspected ? 'Already Checked In' : 'Boarded Successfully',
                    passengerKey: pKey,
                    message: isAlreadyInspected
                        ? `${passenger.studentName || 'Student'} (${passenger.studentId || 'ID'}) was already scanned and checked in.`
                        : `✅ ${passenger.studentName || 'Student'} (${passenger.studentId || 'ID'}) checked in for Stage: ${passenger.stageName || 'assigned stage'}.`,
                });
            } else {
                // ROUTE / BUS MISMATCH -> Open Wrong Bus Alert Popup Warning!
                playBeepFeedback(false);
                setWrongBusModal({
                    isOpen: true,
                    passenger,
                    scannedRouteId: passenger.routeId || passenger.route_id || 'Unassigned',
                    scannedRouteName: passenger.routeName || passenger.route_name || 'Different Route',
                    scannedBusId: passenger.busId || passenger.bus_id || 'Unassigned',
                    targetRouteId: selectedRoute.routeId,
                    targetRouteName: selectedRoute.routeName,
                    targetBuses: selectedRoute.assignedBuses || [],
                });
            }
        } finally {
            setVerifying(false);
            setTimeout(() => setScanFlash(false), 600);
            busyRef.current = false;
        }
    }, [selectedRoute, online, markPassengerInspected, playBeepFeedback]);

    // Assign active scanner handler depending on tab
    useEffect(() => {
        if (activeTab === 'inspection') {
            handleScanRef.current = processInspectionScan;
        } else {
            handleScanRef.current = processQrText;
        }
    }, [activeTab, processInspectionScan, processQrText]);

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
                if (!track?.getSettings || !cam?.id) return true;
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

                    let appliedZoom = null;
                    if ('zoom' in capabilities) {
                        const zMin = capabilities.zoom.min || 1;
                        const zMax = capabilities.zoom.max || 1;
                        const zStep = capabilities.zoom.step || 0.1;
                        setZoomCapabilities({ min: zMin, max: zMax, step: zStep });
                        setZoomSupported(zMax > zMin);

                        if (zMax > zMin) {
                            appliedZoom = Math.min(zMax, Math.max(zMin, 1.8));
                            advanced.zoom = appliedZoom;
                        }
                    } else {
                        setZoomSupported(false);
                    }

                    if (Object.keys(advanced).length > 0) {
                        await track.applyConstraints({ advanced: [advanced] }).catch(() => {});
                        if (appliedZoom !== null) {
                            setZoomValue(appliedZoom);
                        }
                    }

                    if ('torch' in capabilities) {
                        setTorchSupported(true);
                    } else {
                        setTorchSupported(false);
                    }
                }
            } catch (capErr) {
                console.warn('Camera constraints setup error:', capErr);
            }
        } catch (err) {
            if (session !== scanSessionRef.current) return;
            await stopScanner();
            setCameraError(err.message || 'Failed to start camera.');
        }
    }, [clearReaderDom, fetchCameras, getActiveTrack, getScannerConfig, isFrontLabel, isMobileDevice, isRearLabel, preferRearCameraIndex, stopScanner]);

    const handleCameraSelect = useCallback(async (indexStr) => {
        const nextIndex = Number(indexStr);
        if (Number.isNaN(nextIndex)) return;
        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);
        if (scanning) {
            await startScanner(nextIndex, { exclusive: true, preferRear: false });
        }
    }, [scanning, startScanner]);

    const switchCamera = useCallback(async () => {
        const list = await fetchCameras();
        if (list.length === 0) return;
        const nextIndex = (activeCameraIndexRef.current + 1) % list.length;
        activeCameraIndexRef.current = nextIndex;
        setActiveCameraIndex(nextIndex);
        if (scanning) {
            await startScanner(nextIndex, { exclusive: true, preferRear: false });
        }
    }, [fetchCameras, scanning, startScanner]);

    const handleTabSwitch = useCallback((tab) => {
        if (scanning) {
            stopScanner();
        }
        setActiveTab(tab);
        setSearchParams({ tab });
        setInspectionNotification(null);
    }, [scanning, stopScanner, setSearchParams]);

    const closeResultModal = () => {
        setModalOpen(false);
        setResult(null);
    };

    // ==========================================
    // AGGREGATE ROUTE INSPECTION DATA
    // ==========================================
    const routesWithMetrics = useMemo(() => {
        const routeMap = new Map();

        // 1. Add defined routes
        rawRoutes.forEach((r) => {
            const rId = String(r.routeId || r._id || '').trim();
            if (!rId) return;
            const rName = r.routeName || r.name || `Route ${rId}`;
            routeMap.set(rId.toLowerCase(), {
                routeId: rId,
                routeName: rName,
                stages: r.stages || [],
                assignedBuses: [],
                passengers: [],
            });
        });

        // 2. Associate buses from buses collection
        rawBuses.forEach((b) => {
            const assignedRId = String(b.assignedRouteId || '').trim();
            if (assignedRId) {
                const existing = routeMap.get(assignedRId.toLowerCase());
                if (existing) {
                    if (b.busNumber && !existing.assignedBuses.includes(b.busNumber)) {
                        existing.assignedBuses.push(b.busNumber);
                    }
                }
            }
        });

        // 3. Associate all passengers (students & faculty)
        allCachedPassengers.forEach((p) => {
            const pRouteId = String(p.routeId || p.route_id || '').trim();
            const pRouteName = String(p.routeName || p.route_name || '').trim();
            const pBusId = String(p.busId || p.bus_id || '').trim();

            let targetKey = pRouteId.toLowerCase();
            let targetRoute = routeMap.get(targetKey);

            if (!targetRoute && pRouteName) {
                for (const r of routeMap.values()) {
                    if (r.routeName.toLowerCase() === pRouteName.toLowerCase()) {
                        targetRoute = r;
                        break;
                    }
                }
            }

            if (!targetRoute && pRouteId) {
                targetRoute = {
                    routeId: pRouteId,
                    routeName: pRouteName || `Route ${pRouteId}`,
                    stages: [],
                    assignedBuses: [],
                    passengers: [],
                };
                routeMap.set(targetKey, targetRoute);
            }

            if (targetRoute) {
                targetRoute.passengers.push(p);
                if (pBusId && !targetRoute.assignedBuses.includes(pBusId)) {
                    targetRoute.assignedBuses.push(pBusId);
                }
            }
        });

        // Calculate counts & stats
        const list = Array.from(routeMap.values()).map((r) => {
            const students = r.passengers.filter((p) => (p.userType || p.user_type || 'student') === 'student');
            const faculty = r.passengers.filter((p) => (p.userType || p.user_type) === 'employee');
            const total = r.passengers.length;

            const inspectedCount = r.passengers.filter((p) => {
                const key = String(p.requestId || p.studentId || p.mongoId);
                return Boolean(inspectedMap[key]);
            }).length;

            return {
                ...r,
                studentsCount: students.length,
                facultyCount: faculty.length,
                totalCount: total,
                inspectedCount,
                inspectedPercent: total > 0 ? Math.round((inspectedCount / total) * 100) : 0,
            };
        });

        // Sort by Route ID numeric / alphabetical
        return list.sort((a, b) => {
            const numA = parseInt(a.routeId.replace(/\D/g, ''), 10);
            const numB = parseInt(b.routeId.replace(/\D/g, ''), 10);
            if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB;
            return a.routeId.localeCompare(b.routeId);
        });
    }, [rawRoutes, rawBuses, allCachedPassengers, inspectedMap]);

    // Active Route Selected Details
    const activeRouteData = useMemo(() => {
        if (!selectedRoute) return null;
        return routesWithMetrics.find((r) => r.routeId.toLowerCase() === selectedRoute.routeId.toLowerCase()) || selectedRoute;
    }, [selectedRoute, routesWithMetrics]);

    // Filtered routes list for overview tab
    const filteredRoutes = useMemo(() => {
        if (!routeSearchQuery.trim()) return routesWithMetrics;
        const q = routeSearchQuery.toLowerCase().trim();
        return routesWithMetrics.filter((r) =>
            r.routeId.toLowerCase().includes(q)
            || r.routeName.toLowerCase().includes(q)
            || r.assignedBuses.some((b) => b.toLowerCase().includes(q))
        );
    }, [routesWithMetrics, routeSearchQuery]);

    // Overall summary counts for inspection tab
    const overallStats = useMemo(() => {
        let totalStudents = 0;
        let totalFaculty = 0;
        let totalInspected = 0;
        routesWithMetrics.forEach((r) => {
            totalStudents += r.studentsCount;
            totalFaculty += r.facultyCount;
            totalInspected += r.inspectedCount;
        });
        const total = totalStudents + totalFaculty;
        return {
            totalRoutes: routesWithMetrics.length,
            totalStudents,
            totalFaculty,
            total,
            totalInspected,
            totalPercent: total > 0 ? Math.round((totalInspected / total) * 100) : 0,
        };
    }, [routesWithMetrics]);

    // Filtered passenger list inside active route
    const filteredPassengers = useMemo(() => {
        if (!activeRouteData) return [];
        let list = activeRouteData.passengers || [];

        // 1. Filter by category
        if (inspectionFilter === 'students') {
            list = list.filter((p) => (p.userType || p.user_type || 'student') === 'student');
        } else if (inspectionFilter === 'faculty') {
            list = list.filter((p) => (p.userType || p.user_type) === 'employee');
        } else if (inspectionFilter === 'inspected') {
            list = list.filter((p) => Boolean(inspectedMap[String(p.requestId || p.studentId || p.mongoId)]));
        } else if (inspectionFilter === 'pending') {
            list = list.filter((p) => !inspectedMap[String(p.requestId || p.studentId || p.mongoId)]);
        }

        // 2. Filter by stage
        if (inspectionStageFilter !== 'all') {
            list = list.filter((p) => String(p.stageName || p.stage_name || '').toLowerCase() === inspectionStageFilter.toLowerCase());
        }

        // 3. Search query
        if (inspectionSearchQuery.trim()) {
            const q = inspectionSearchQuery.toLowerCase().trim();
            list = list.filter((p) => {
                const name = String(p.studentName || p.student_name || p.employee_name || '').toLowerCase();
                const adm = String(p.studentId || p.admission_number || p.emp_no || '').toLowerCase();
                const pin = String(p.pinNo || p.pin_no || '').toLowerCase();
                const stage = String(p.stageName || p.stage_name || '').toLowerCase();
                return name.includes(q) || adm.includes(q) || pin.includes(q) || stage.includes(q);
            });
        }

        return list;
    }, [activeRouteData, inspectionFilter, inspectionStageFilter, inspectionSearchQuery, inspectedMap]);

    // Unique stages for selected route
    const routeUniqueStages = useMemo(() => {
        if (!activeRouteData?.passengers) return [];
        const stages = new Set();
        activeRouteData.passengers.forEach((p) => {
            const st = String(p.stageName || p.stage_name || '').trim();
            if (st) stages.add(st);
        });
        return Array.from(stages).sort();
    }, [activeRouteData]);

    const detail = result?.data;
    const hasPassengerDetail = Boolean(detail && (detail.student_name || detail.admission_number));
    const photoSrc = normalizeStudentPhoto(detail?.student_photo || result?.local?.studentPhoto);

    const loggedIn = isAuthenticated();
    const Shell = loggedIn ? Layout : OfflineVerifyShell;

    const pageHeaderTitle = useMemo(() => {
        if (activeTab === 'inspection') {
            if (selectedRoute) {
                return `Route ${selectedRoute.routeId} Inspection`;
            }
            return 'Route Inspection';
        }
        if (activeTab === 'sync') {
            return 'Sync & Data';
        }
        return 'QR Scanner';
    }, [activeTab, selectedRoute]);

    return (
        <Shell title={pageHeaderTitle}>
            <div className="space-y-4 max-w-5xl mx-auto pb-12">
                {!loggedIn && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-900 shadow-2xs">
                        <p className="font-bold flex items-center gap-1.5">
                            <ShieldCheck size={14} className="text-emerald-700" /> Offline verification mode
                        </p>
                        <p className="mt-0.5 leading-relaxed">
                            Using passenger records saved locally on this device. Login is not required to scan or inspect.
                        </p>
                    </div>
                )}


                {/* ========================================================================= */}
                {/* TAB 1: STANDALONE QR SCANNER                                              */}
                {/* ========================================================================= */}
                {activeTab === 'scan' && (
                    <div className="space-y-4">
                        {!online && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 space-y-1">
                                <p className="font-bold flex items-center gap-1.5 text-amber-900">
                                    <AlertTriangle size={14} /> Offline Mode Active
                                </p>
                                <p className="leading-relaxed">
                                    Scanning with {recordCount} local passenger record{recordCount === 1 ? '' : 's'} stored on this device.
                                </p>
                            </div>
                        )}

                        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                            {/* Scanner Top Toolbar */}
                            <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                                <div className="flex items-center gap-2 min-w-0">
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${scanning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                    <p className="text-xs font-bold text-slate-700 truncate">
                                        {verifying ? 'QR detected — verifying…' : scanning ? 'Point camera at student / faculty QR pass' : 'Scanner ready'}
                                    </p>
                                </div>
                                <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                    {availableCameras.length > 0 && (
                                        <select
                                            value={activeCameraIndex}
                                            onChange={(e) => handleCameraSelect(e.target.value)}
                                            disabled={modalOpen}
                                            className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 max-w-[150px] sm:max-w-[190px] truncate shadow-2xs"
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
                                        className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                                    >
                                        <SwitchCamera size={13} className="text-blue-600" />
                                        <span className="hidden sm:inline">Switch</span>
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => (scanning ? stopScanner() : startScanner())}
                                        disabled={modalOpen}
                                        className={`px-4 py-1.5 text-[11px] font-bold rounded-lg border cursor-pointer disabled:opacity-50 transition-all shadow-sm ${
                                            scanning
                                                ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                                        }`}
                                    >
                                        {scanning ? 'Stop Scanner' : 'Start Scanner'}
                                    </button>
                                </div>
                            </div>

                            {/* Viewfinder Area */}
                            <div className="relative bg-slate-950 aspect-[3/4] sm:aspect-video max-h-[72vh] sm:max-h-[500px] min-h-[380px] sm:min-h-[440px] overflow-hidden flex flex-col items-center justify-center">
                                <div
                                    id="qr-reader"
                                    ref={readerHostRef}
                                    className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-contain [&_video]:bg-black [&_video]:contrast-[1.12] [&_video]:brightness-[1.04] [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                />

                                {scanning && (
                                    <div className="absolute top-3 right-3 left-3 flex justify-between items-start pointer-events-none z-30">
                                        <div className="bg-slate-950/85 border border-slate-800/80 text-slate-200 text-[10px] font-black tracking-wider uppercase px-3 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm shadow-md">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                            {availableCameras[activeCameraIndex]?.label || 'Live Scanner'}
                                        </div>
                                        <div className="flex flex-col gap-2 items-end pointer-events-auto">
                                            <button
                                                type="button"
                                                onClick={switchCamera}
                                                className="p-2.5 rounded-full bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 active:scale-95 transition-all shadow-md flex items-center justify-center cursor-pointer"
                                                title="Switch Camera"
                                            >
                                                <SwitchCamera size={16} className="text-blue-400" />
                                            </button>

                                            {zoomSupported && (
                                                <button
                                                    type="button"
                                                    onClick={cycleZoom}
                                                    className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
                                                >
                                                    <ZoomIn size={14} className="text-emerald-400" />
                                                    <span className="text-[11px] font-bold tabular-nums">{Number(zoomValue).toFixed(1)}x</span>
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
                                                >
                                                    {torchOn ? <Zap size={16} className="fill-current" /> : <ZapOff size={16} />}
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {scanning && !verifying && (
                                    <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                                        <div className="relative w-[50%] max-w-[280px] min-w-[170px] aspect-square">
                                            <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                            <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                            <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                            <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                            <div className="qr-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                                        </div>
                                    </div>
                                )}

                                {scanning && zoomSupported && (
                                    <div className="absolute bottom-3 inset-x-0 flex justify-center z-30 pointer-events-auto px-4">
                                        <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-1 rounded-full shadow-lg">
                                            {[1, 1.5, 2, 3, 5]
                                                .filter((z) => z >= (zoomCapabilities.min || 1) && z <= (zoomCapabilities.max || 1))
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
                                <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100 flex items-center gap-2">
                                    <AlertTriangle size={14} className="shrink-0" />
                                    <span>{cameraError}</span>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* ========================================================================= */}
                {/* TAB 2: ROUTE & BUS INSPECTION                                             */}
                {/* ========================================================================= */}
                {activeTab === 'inspection' && (
                    <div className="space-y-4">
                        {/* VIEW A: OVERVIEW - LIST OF ALL ROUTES WITH ASSIGNED BUSES */}
                        {!selectedRoute ? (
                            <div className="space-y-4">
                                {/* Inspection Metrics Banner */}
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                                    <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Active Routes</span>
                                            <Bus size={15} className="text-blue-600" />
                                        </div>
                                        <p className="text-xl sm:text-2xl font-black text-slate-900 mt-1">
                                            {overallStats.totalRoutes}
                                        </p>
                                    </div>

                                    <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Total Students</span>
                                            <GraduationCap size={15} className="text-indigo-600" />
                                        </div>
                                        <p className="text-xl sm:text-2xl font-black text-indigo-900 mt-1">
                                            {overallStats.totalStudents}
                                        </p>
                                    </div>

                                    <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Total Faculty</span>
                                            <Briefcase size={15} className="text-teal-600" />
                                        </div>
                                        <p className="text-xl sm:text-2xl font-black text-teal-900 mt-1">
                                            {overallStats.totalFaculty}
                                        </p>
                                    </div>

                                    <div className="bg-white rounded-xl p-3.5 border border-slate-200 shadow-2xs">
                                        <div className="flex items-center justify-between text-slate-400">
                                            <span className="text-[10px] font-bold uppercase tracking-wider">Inspected Today</span>
                                            <CheckCircle2 size={15} className="text-emerald-600" />
                                        </div>
                                        <div className="flex items-baseline gap-1.5 mt-1">
                                            <p className="text-xl sm:text-2xl font-black text-emerald-700">
                                                {overallStats.totalInspected}
                                            </p>
                                            <span className="text-xs font-bold text-slate-500">
                                                / {overallStats.total} ({overallStats.totalPercent}%)
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Search Bar for Routes */}
                                <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-2xs flex items-center gap-2">
                                    <Search size={16} className="text-slate-400 shrink-0 ml-1" />
                                    <input
                                        type="text"
                                        value={routeSearchQuery}
                                        onChange={(e) => setRouteSearchQuery(e.target.value)}
                                        placeholder="Search routes by ID, route name, or bus number…"
                                        className="w-full text-xs font-semibold text-slate-800 placeholder-slate-400 outline-none bg-transparent"
                                    />
                                    {routeSearchQuery && (
                                        <button
                                            type="button"
                                            onClick={() => setRouteSearchQuery('')}
                                            className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>

                                {/* Routes Cards Grid */}
                                {filteredRoutes.length === 0 ? (
                                    <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-2">
                                        <Bus size={32} className="mx-auto text-slate-300" />
                                        <p className="text-sm font-bold text-slate-700">No matching routes found</p>
                                        <p className="text-xs text-slate-500">
                                            {routeSearchQuery ? 'Try another search term or clear the filter.' : 'Run Sync to download registered routes and passenger data.'}
                                        </p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
                                        {filteredRoutes.map((route) => {
                                            const isDone = route.totalCount > 0 && route.inspectedCount === route.totalCount;
                                            return (
                                                <div
                                                    key={route.routeId}
                                                    onClick={() => {
                                                        setSelectedRoute(route);
                                                        setInspectionFilter('all');
                                                        setInspectionStageFilter('all');
                                                        setInspectionSearchQuery('');
                                                    }}
                                                    className="bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs hover:shadow-md hover:border-blue-400 transition-all cursor-pointer flex flex-col justify-between gap-3 group"
                                                >
                                                    <div>
                                                        {/* Top Row: Route ID & Status */}
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 font-extrabold text-xs border border-blue-100">
                                                                <Bus size={13} className="text-blue-600" />
                                                                <span>Route {route.routeId}</span>
                                                            </div>
                                                            {isDone ? (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                                                                    <CheckCheck size={11} /> Completed
                                                                </span>
                                                            ) : route.inspectedCount > 0 ? (
                                                                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-full">
                                                                    <Clock size={11} /> In Progress
                                                                </span>
                                                            ) : (
                                                                <span className="inline-flex items-center text-[10px] font-bold text-slate-500 bg-slate-50 border border-slate-200 px-2 py-0.5 rounded-full">
                                                                    Pending
                                                                </span>
                                                            )}
                                                        </div>

                                                        {/* Route Name */}
                                                        <h3 className="text-sm font-bold text-slate-900 mt-2.5 group-hover:text-blue-600 transition-colors line-clamp-1">
                                                            {route.routeName}
                                                        </h3>

                                                        {/* Assigned Buses Badges */}
                                                        <div className="flex items-center gap-1.5 flex-wrap mt-2">
                                                            {route.assignedBuses.length > 0 ? (
                                                                route.assignedBuses.map((busNo) => (
                                                                    <span
                                                                        key={busNo}
                                                                        className="inline-flex items-center gap-1 text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200/80 px-2 py-0.5 rounded-md"
                                                                    >
                                                                        🚌 {busNo}
                                                                    </span>
                                                                ))
                                                            ) : (
                                                                <span className="text-[10px] font-medium text-slate-400 italic">
                                                                    No bus assigned
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    {/* Bottom Section: Passenger Stats & Progress */}
                                                    <div className="pt-3 border-t border-slate-100 space-y-2">
                                                        <div className="flex items-center justify-between text-xs text-slate-600 font-semibold">
                                                            <span>Students: <strong className="text-slate-900">{route.studentsCount}</strong></span>
                                                            <span>Faculty: <strong className="text-slate-900">{route.facultyCount}</strong></span>
                                                            <span>Total: <strong className="text-blue-700">{route.totalCount}</strong></span>
                                                        </div>

                                                        {/* Visual Progress Bar */}
                                                        <div>
                                                            <div className="flex justify-between items-center text-[10px] font-bold text-slate-400 mb-1">
                                                                <span>Boarded / Inspected</span>
                                                                <span className="text-slate-700 font-bold tabular-nums">
                                                                    {route.inspectedCount} / {route.totalCount} ({route.inspectedPercent}%)
                                                                </span>
                                                            </div>
                                                            <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                                                <div
                                                                    className={`h-full transition-all duration-300 ${
                                                                        isDone
                                                                            ? 'bg-emerald-500'
                                                                            : route.inspectedCount > 0
                                                                            ? 'bg-blue-600'
                                                                            : 'bg-slate-300'
                                                                    }`}
                                                                    style={{ width: `${route.inspectedPercent}%` }}
                                                                />
                                                            </div>
                                                        </div>

                                                        <button
                                                            type="button"
                                                            className="w-full mt-1 py-1.5 px-3 rounded-lg text-xs font-bold bg-slate-50 hover:bg-blue-600 text-slate-700 hover:text-white border border-slate-200 hover:border-blue-600 transition-all flex items-center justify-center gap-1 cursor-pointer"
                                                        >
                                                            <span>Inspect Route</span>
                                                            <ChevronRight size={14} />
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        ) : (
                            /* VIEW B: ACTIVE ROUTE PASSENGER INSPECTION DASHBOARD */
                            <div className="space-y-4">
                                {/* Route Header Card */}
                                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-3">
                                    <div className="flex items-center justify-between gap-3 flex-wrap">
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (scanning) stopScanner();
                                                setSelectedRoute(null);
                                            }}
                                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 bg-slate-100 hover:bg-slate-200 cursor-pointer transition-colors"
                                        >
                                            <ArrowLeft size={14} /> Back to Routes
                                        </button>

                                        <div className="flex items-center gap-2 flex-wrap">
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    if (window.confirm(`Are you sure you want to clear all inspection records for Route ${activeRouteData.routeId}?`)) {
                                                        const pKeys = (activeRouteData.passengers || []).map(
                                                            (p) => String(p.requestId || p.studentId || p.mongoId)
                                                        );
                                                        setInspectedMap((prev) => {
                                                            const next = { ...prev };
                                                            pKeys.forEach((k) => delete next[k]);
                                                            return next;
                                                        });
                                                    }
                                                }}
                                                className="px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:text-rose-700 hover:bg-rose-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1 border border-slate-200"
                                            >
                                                <RotateCcw size={12} /> Reset Route
                                            </button>
                                        </div>
                                    </div>

                                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-slate-100">
                                        <div>
                                            <div className="flex items-center gap-2 flex-wrap">
                                                <span className="px-2.5 py-1 rounded-md bg-blue-600 text-white font-extrabold text-xs">
                                                    Route {activeRouteData.routeId}
                                                </span>
                                                <h2 className="text-base sm:text-lg font-black text-slate-900">
                                                    {activeRouteData.routeName}
                                                </h2>
                                            </div>
                                            <div className="flex items-center gap-2 mt-1 flex-wrap">
                                                <span className="text-xs text-slate-500 font-semibold">Assigned Bus(es):</span>
                                                {activeRouteData.assignedBuses?.length > 0 ? (
                                                    activeRouteData.assignedBuses.map((busNo) => (
                                                        <span key={busNo} className="text-xs font-bold text-amber-900 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                                                            🚌 {busNo}
                                                        </span>
                                                    ))
                                                ) : (
                                                    <span className="text-xs text-slate-400 italic">None assigned</span>
                                                )}
                                            </div>
                                        </div>

                                        {/* Route Stats Box */}
                                        <div className="flex items-center gap-3 bg-slate-50 p-2 rounded-xl border border-slate-100">
                                            <div className="text-center px-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Assigned</p>
                                                <p className="text-sm font-black text-slate-800">{activeRouteData.totalCount}</p>
                                            </div>
                                            <div className="w-px h-6 bg-slate-200" />
                                            <div className="text-center px-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Boarded</p>
                                                <p className="text-sm font-black text-emerald-600">{activeRouteData.inspectedCount}</p>
                                            </div>
                                            <div className="w-px h-6 bg-slate-200" />
                                            <div className="text-center px-2">
                                                <p className="text-[10px] font-bold text-slate-400 uppercase">Remaining</p>
                                                <p className="text-sm font-black text-rose-600">
                                                    {Math.max(0, activeRouteData.totalCount - activeRouteData.inspectedCount)}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </div>

                                {/* Route QR Scanner Card (Identical to QR Scanner Tab) */}
                                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                                    {/* Scanner Top Toolbar */}
                                    <div className="px-3 sm:px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2 flex-wrap">
                                        <div className="flex items-center gap-2 min-w-0">
                                            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${scanning ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                                            <p className="text-xs font-bold text-slate-700 truncate">
                                                {verifying ? 'QR detected — verifying route…' : scanning ? `Point camera at student / faculty QR pass (Route ${activeRouteData.routeId})` : `Route ${activeRouteData.routeId} Scanner ready`}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 shrink-0 flex-wrap">
                                            {availableCameras.length > 0 && (
                                                <select
                                                    value={activeCameraIndex}
                                                    onChange={(e) => handleCameraSelect(e.target.value)}
                                                    disabled={modalOpen}
                                                    className="px-2.5 py-1.5 text-[11px] font-semibold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 cursor-pointer disabled:opacity-50 max-w-[150px] sm:max-w-[190px] truncate shadow-2xs"
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
                                                className="px-2.5 py-1.5 text-[11px] font-bold rounded-lg border border-slate-200 text-slate-700 bg-white hover:bg-slate-50 active:bg-slate-100 transition-colors cursor-pointer disabled:opacity-50 flex items-center gap-1.5 shadow-2xs"
                                            >
                                                <SwitchCamera size={13} className="text-blue-600" />
                                                <span className="hidden sm:inline">Switch</span>
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => (scanning ? stopScanner() : startScanner())}
                                                disabled={modalOpen}
                                                className={`px-4 py-1.5 text-[11px] font-bold rounded-lg border cursor-pointer disabled:opacity-50 transition-all shadow-sm ${
                                                    scanning
                                                        ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                                                        : 'bg-blue-600 text-white border-blue-600 hover:bg-blue-700 shadow-blue-600/20'
                                                }`}
                                            >
                                                {scanning ? 'Stop Scanner' : 'Start Scanner'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Viewfinder Area */}
                                    <div className="relative bg-slate-950 aspect-[3/4] sm:aspect-video max-h-[72vh] sm:max-h-[500px] min-h-[380px] sm:min-h-[440px] overflow-hidden flex flex-col items-center justify-center">
                                        <div
                                            id="qr-reader"
                                            ref={readerHostRef}
                                            className="absolute inset-0 w-full h-full overflow-hidden [&_video]:!w-full [&_video]:!h-full [&_video]:object-contain [&_video]:bg-black [&_video]:contrast-[1.12] [&_video]:brightness-[1.04] [&_#qr-reader__dashboard]:hidden [&_img]:hidden"
                                        />

                                        {scanning && (
                                            <div className="absolute top-3 right-3 left-3 flex justify-between items-start pointer-events-none z-30">
                                                <div className="bg-slate-950/85 border border-slate-800/80 text-slate-200 text-[10px] font-black tracking-wider uppercase px-3 py-1.5 rounded-lg flex items-center gap-1.5 backdrop-blur-sm shadow-md">
                                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                                                    {availableCameras[activeCameraIndex]?.label || `Route ${activeRouteData.routeId} Live Scanner`}
                                                </div>
                                                <div className="flex flex-col gap-2 items-end pointer-events-auto">
                                                    <button
                                                        type="button"
                                                        onClick={switchCamera}
                                                        className="p-2.5 rounded-full bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 active:scale-95 transition-all shadow-md flex items-center justify-center cursor-pointer"
                                                        title="Switch Camera"
                                                    >
                                                        <SwitchCamera size={16} className="text-blue-400" />
                                                    </button>

                                                    {zoomSupported && (
                                                        <button
                                                            type="button"
                                                            onClick={cycleZoom}
                                                            className="px-2.5 py-1.5 rounded-lg bg-slate-950/80 text-slate-200 border border-slate-800 hover:text-white hover:bg-slate-900 transition-all shadow-md flex items-center justify-center gap-1 cursor-pointer"
                                                        >
                                                            <ZoomIn size={14} className="text-emerald-400" />
                                                            <span className="text-[11px] font-bold tabular-nums">{Number(zoomValue).toFixed(1)}x</span>
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
                                                        >
                                                            {torchOn ? <Zap size={16} className="fill-current" /> : <ZapOff size={16} />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {scanning && !verifying && (
                                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center z-10">
                                                <div className="relative w-[50%] max-w-[280px] min-w-[170px] aspect-square">
                                                    <div className="absolute -top-0.5 -left-0.5 w-7 h-7 border-t-4 border-l-4 border-emerald-400 rounded-tl-xl" />
                                                    <div className="absolute -top-0.5 -right-0.5 w-7 h-7 border-t-4 border-r-4 border-emerald-400 rounded-tr-xl" />
                                                    <div className="absolute -bottom-0.5 -left-0.5 w-7 h-7 border-b-4 border-l-4 border-emerald-400 rounded-bl-xl" />
                                                    <div className="absolute -bottom-0.5 -right-0.5 w-7 h-7 border-b-4 border-r-4 border-emerald-400 rounded-br-xl" />
                                                    <div className="qr-scan-line absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent shadow-[0_0_12px_rgba(52,211,153,0.9)]" />
                                                </div>
                                            </div>
                                        )}

                                        {scanning && zoomSupported && (
                                            <div className="absolute bottom-3 inset-x-0 flex justify-center z-30 pointer-events-auto px-4">
                                                <div className="flex items-center gap-1 bg-slate-950/85 backdrop-blur-md border border-slate-800 p-1 rounded-full shadow-lg">
                                                    {[1, 1.5, 2, 3, 5]
                                                        .filter((z) => z >= (zoomCapabilities.min || 1) && z <= (zoomCapabilities.max || 1))
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
                                                    <span className="text-sm font-bold text-slate-800">Checking Route…</span>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {cameraError && (
                                        <div className="px-3 py-2 text-xs text-red-700 bg-red-50 border-t border-red-100 flex items-center gap-2">
                                            <AlertTriangle size={14} className="shrink-0" />
                                            <span>{cameraError}</span>
                                        </div>
                                    )}

                                    {/* Recent Inspection Notification Toast */}
                                    {inspectionNotification && (
                                        <div
                                            className={`p-3 text-xs flex items-center justify-between gap-2 border-t ${
                                                inspectionNotification.type === 'success'
                                                    ? 'bg-emerald-50 text-emerald-900 border-emerald-100'
                                                    : 'bg-rose-50 text-rose-900 border-rose-100'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2">
                                                {inspectionNotification.type === 'success' ? (
                                                    <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
                                                ) : (
                                                    <AlertTriangle size={16} className="text-rose-600 shrink-0" />
                                                )}
                                                <span className="font-semibold">{inspectionNotification.message}</span>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                {inspectionNotification.passengerKey && (
                                                    <button
                                                        type="button"
                                                        onClick={() => {
                                                            undoPassengerInspected(inspectionNotification.passengerKey);
                                                            setInspectionNotification(null);
                                                        }}
                                                        className="underline font-bold text-slate-700 hover:text-slate-900 cursor-pointer"
                                                    >
                                                        Undo
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setInspectionNotification(null)}
                                                    className="p-1 hover:bg-black/5 rounded cursor-pointer"
                                                >
                                                    <X size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Passenger List Filter & Search Toolbar */}
                                <div className="bg-white rounded-2xl p-4 border border-slate-200 shadow-2xs space-y-3">
                                    {/* Search & Stage Filter Row */}
                                    <div className="flex flex-col sm:flex-row gap-2.5">
                                        <div className="relative flex-1">
                                            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                            <input
                                                type="text"
                                                value={inspectionSearchQuery}
                                                onChange={(e) => setInspectionSearchQuery(e.target.value)}
                                                placeholder="Search student / faculty name, ADM, PIN, or stage…"
                                                className="w-full pl-9 pr-8 py-2 text-xs font-semibold text-slate-800 bg-slate-50 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                                            />
                                            {inspectionSearchQuery && (
                                                <button
                                                    type="button"
                                                    onClick={() => setInspectionSearchQuery('')}
                                                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 cursor-pointer"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>

                                        {/* Stage Filter Dropdown */}
                                        {routeUniqueStages.length > 0 && (
                                            <select
                                                value={inspectionStageFilter}
                                                onChange={(e) => setInspectionStageFilter(e.target.value)}
                                                className="px-3 py-2 text-xs font-bold text-slate-700 bg-slate-50 border border-slate-200 rounded-xl outline-none cursor-pointer"
                                            >
                                                <option value="all">All Stages ({routeUniqueStages.length})</option>
                                                {routeUniqueStages.map((st) => (
                                                    <option key={st} value={st}>{st}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>

                                    {/* Passenger Filter Pills */}
                                    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs font-bold text-slate-600">
                                        {[
                                            { id: 'all', label: `All (${activeRouteData.totalCount})` },
                                            { id: 'students', label: `Students (${activeRouteData.studentsCount})` },
                                            { id: 'faculty', label: `Faculty (${activeRouteData.facultyCount})` },
                                            { id: 'inspected', label: `Boarded (${activeRouteData.inspectedCount})` },
                                            { id: 'pending', label: `Pending (${Math.max(0, activeRouteData.totalCount - activeRouteData.inspectedCount)})` },
                                        ].map((tab) => (
                                            <button
                                                key={tab.id}
                                                type="button"
                                                onClick={() => setInspectionFilter(tab.id)}
                                                className={`px-3 py-1.5 rounded-lg shrink-0 transition-all cursor-pointer ${
                                                    inspectionFilter === tab.id
                                                        ? 'bg-blue-600 text-white shadow-2xs'
                                                        : 'bg-slate-100 hover:bg-slate-200 text-slate-600'
                                                }`}
                                            >
                                                {tab.label}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Passenger List */}
                                <div className="space-y-2">
                                    {filteredPassengers.length === 0 ? (
                                        <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center space-y-1">
                                            <Users size={28} className="mx-auto text-slate-300" />
                                            <p className="text-sm font-bold text-slate-700">No passengers found</p>
                                            <p className="text-xs text-slate-400">
                                                {inspectionSearchQuery || inspectionFilter !== 'all' || inspectionStageFilter !== 'all'
                                                    ? 'No passenger matches the selected filter criteria.'
                                                    : 'No passengers are currently registered for this route.'}
                                            </p>
                                        </div>
                                    ) : (
                                        filteredPassengers.map((p) => {
                                            const pKey = String(p.requestId || p.studentId || p.mongoId);
                                            const inspectionRecord = inspectedMap[pKey];
                                            const isInspected = Boolean(inspectionRecord);
                                            const isStudent = (p.userType || p.user_type || 'student') === 'student';
                                            const photo = normalizeStudentPhoto(p.studentPhoto || p.student_photo);

                                            return (
                                                <div
                                                    key={pKey}
                                                    className={`bg-white rounded-2xl border p-3 sm:p-3.5 shadow-2xs transition-all flex items-center justify-between gap-3 ${
                                                        isInspected
                                                            ? 'border-emerald-200/80 bg-emerald-50/20'
                                                            : 'border-slate-200 hover:border-slate-300'
                                                    }`}
                                                >
                                                    <div className="flex items-center gap-3 min-w-0">
                                                        {/* Avatar / Photo */}
                                                        <div className="w-11 h-11 rounded-xl bg-slate-100 border border-slate-200 overflow-hidden flex items-center justify-center shrink-0">
                                                            {photo ? (
                                                                <img src={photo} alt="" className="w-full h-full object-cover" />
                                                            ) : (
                                                                <User size={20} className="text-slate-400" />
                                                            )}
                                                        </div>

                                                        {/* Name and Details */}
                                                        <div className="min-w-0">
                                                            <div className="flex items-center gap-1.5 flex-wrap">
                                                                <p className="text-xs sm:text-sm font-bold text-slate-900 truncate">
                                                                    {p.studentName || p.student_name || p.employee_name || 'Passenger'}
                                                                </p>
                                                                <span
                                                                    className={`text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded ${
                                                                        isStudent
                                                                            ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                                            : 'bg-teal-50 text-teal-700 border border-teal-200'
                                                                    }`}
                                                                >
                                                                    {isStudent ? 'Student' : 'Faculty'}
                                                                </span>
                                                                {inspectionRecord?.wrongRouteOverride && (
                                                                    <span className="text-[9px] font-extrabold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded">
                                                                        Route Override
                                                                    </span>
                                                                )}
                                                            </div>

                                                            <div className="flex items-center gap-2 mt-0.5 text-[11px] text-slate-500 font-medium flex-wrap">
                                                                <span>ADM/ID: <strong className="text-slate-700 font-mono">{p.studentId || p.admission_number || p.emp_no || '—'}</strong></span>
                                                                {p.pinNo && p.pinNo !== 'N/A' && (
                                                                    <>
                                                                        <span>•</span>
                                                                        <span>PIN: <strong className="text-slate-700 font-mono">{p.pinNo}</strong></span>
                                                                    </>
                                                                )}
                                                                <span>•</span>
                                                                <span className="flex items-center gap-0.5 text-blue-700 font-semibold truncate">
                                                                    <MapPin size={11} className="shrink-0" /> {p.stageName || p.stage_name || 'Stage —'}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>

                                                    {/* Right Action: Check-in / Inspected button */}
                                                    <div className="shrink-0 flex items-center gap-2">
                                                        {isInspected ? (
                                                            <button
                                                                type="button"
                                                                onClick={() => undoPassengerInspected(pKey)}
                                                                className="px-3 py-1.5 rounded-xl bg-emerald-100 hover:bg-emerald-200 text-emerald-900 border border-emerald-300 text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
                                                                title="Click to undo inspection"
                                                            >
                                                                <Check size={14} className="text-emerald-700 stroke-[3]" />
                                                                <span className="hidden sm:inline">Boarded</span>
                                                            </button>
                                                        ) : (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    markPassengerInspected(p, false);
                                                                    playBeepFeedback(true);
                                                                }}
                                                                className="px-3.5 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-sm shadow-blue-600/20 cursor-pointer"
                                                            >
                                                                Check In
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ========================================================================= */}
                {/* TAB 3: SYNC & LOCAL DATA STORAGE                                          */}
                {/* ========================================================================= */}
                {activeTab === 'sync' && (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-4 max-w-2xl">
                        <div>
                            <h2 className="text-sm font-bold text-slate-800">Sync & Offline Database</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                Download all approved transport student & faculty records to inspect offline without internet connectivity.
                            </p>
                        </div>

                        {!loggedIn && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-900">
                                <p className="font-bold">Login required to synchronize latest records</p>
                                <p className="mt-1 leading-relaxed">
                                    You can still scan and inspect offline using locally stored records. Connect to the internet and log in to fetch updates.
                                </p>
                                <a
                                    href="/login"
                                    className="inline-flex mt-2 px-3.5 py-1.5 rounded-lg bg-amber-700 text-white text-xs font-bold"
                                >
                                    Go to Login
                                </a>
                            </div>
                        )}

                        <div className="grid grid-cols-2 gap-2.5 sm:gap-3">
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
                                className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 font-bold text-slate-700 bg-white cursor-pointer"
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
                            className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 disabled:opacity-50 cursor-pointer shadow-sm shadow-blue-600/30"
                        >
                            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
                            Sync Now
                        </button>

                        {syncMessage && (
                            <p className="text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-2.5">
                                {syncMessage}
                            </p>
                        )}
                    </div>
                )}
            </div>

            {/* ========================================================================= */}
            {/* POPUP 1: STANDALONE QR SCAN RESULT MODAL                                  */}
            {/* ========================================================================= */}
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

                                <div className="min-w-0 flex-1 space-y-2">
                                    <div>
                                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Passenger</p>
                                        <h2 className="text-base sm:text-lg font-black text-slate-900 uppercase leading-tight break-words">
                                            {detail.student_name || '—'}
                                        </h2>
                                    </div>

                                    {result.ok && (
                                        <div className="w-fit">
                                            <span className="inline-flex items-center gap-0.5 px-2.5 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                                                <CheckCircle2 size={10} className="fill-emerald-800 text-white shrink-0" /> Verified
                                            </span>
                                        </div>
                                    )}

                                    <div className="text-[11px] font-extrabold text-blue-800 bg-blue-50 border border-blue-100 px-2.5 py-1 rounded-lg w-fit">
                                        ADM: <span className="font-mono">{detail.admission_number || '—'}</span>
                                    </div>

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
                                <DetailRow label="Type" value={detail.user_type === 'employee' ? 'Faculty / Employee' : 'Student'} />
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
                            className="w-full py-2.5 rounded-xl bg-blue-600 text-white text-xs font-bold hover:bg-blue-700 cursor-pointer shadow-md shadow-blue-600/20"
                        >
                            Scan Next
                        </button>
                    </div>
                )}
            </Modal>

            {/* ========================================================================= */}
            {/* POPUP 2: WRONG BUS / ROUTE MISMATCH ALERT MODAL                           */}
            {/* ========================================================================= */}
            <Modal
                isOpen={wrongBusModal.isOpen}
                onClose={() => setWrongBusModal((prev) => ({ ...prev, isOpen: false }))}
                title="Route Mismatch Alert"
                maxWidth="max-w-md"
            >
                {wrongBusModal.passenger && (
                    <div className="space-y-4">
                        {/* High-visibility Warning Banner */}
                        <div className="rounded-xl p-3.5 bg-rose-50 border border-rose-200 text-rose-900 flex items-start gap-3">
                            <div className="p-2 bg-rose-600 text-white rounded-xl shrink-0 mt-0.5">
                                <AlertOctagon size={20} />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-tight text-rose-950">
                                    Wrong Bus / Route Detected
                                </h3>
                                <p className="text-xs text-rose-800 mt-0.5 leading-relaxed">
                                    This passenger is assigned to a <strong>different route</strong> and bus.
                                </p>
                            </div>
                        </div>

                        {/* Passenger Details */}
                        <div className="flex gap-3.5 pb-3 border-b border-slate-100 items-center">
                            <div className="w-16 h-16 rounded-xl border border-slate-200 overflow-hidden bg-slate-50 flex items-center justify-center shrink-0">
                                {wrongBusModal.passenger.studentPhoto || wrongBusModal.passenger.student_photo ? (
                                    <img
                                        src={normalizeStudentPhoto(wrongBusModal.passenger.studentPhoto || wrongBusModal.passenger.student_photo)}
                                        alt=""
                                        className="w-full h-full object-cover"
                                    />
                                ) : (
                                    <User size={28} className="text-slate-400" />
                                )}
                            </div>
                            <div className="min-w-0 flex-1">
                                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Passenger Name</p>
                                <h4 className="text-base font-black text-slate-900 truncate">
                                    {wrongBusModal.passenger.studentName || wrongBusModal.passenger.student_name || wrongBusModal.passenger.employee_name || 'Passenger'}
                                </h4>
                                <div className="flex items-center gap-2 mt-1 text-xs text-slate-600 font-semibold flex-wrap">
                                    <span>ID: <strong className="font-mono text-slate-800">{wrongBusModal.passenger.studentId || wrongBusModal.passenger.admission_number || wrongBusModal.passenger.emp_no || '—'}</strong></span>
                                    {wrongBusModal.passenger.pinNo && (
                                        <span>PIN: <strong className="font-mono text-slate-800">{wrongBusModal.passenger.pinNo}</strong></span>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Comparison Box */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            {/* Assigned to */}
                            <div className="p-3 rounded-xl bg-amber-50/80 border border-amber-200">
                                <p className="text-[10px] font-bold text-amber-800 uppercase tracking-wider flex items-center gap-1">
                                    <ShieldAlert size={12} /> Assigned Route
                                </p>
                                <p className="text-sm font-black text-slate-900 mt-1">
                                    Route {wrongBusModal.scannedRouteId}
                                </p>
                                <p className="text-xs text-slate-600 truncate">{wrongBusModal.scannedRouteName}</p>
                                <p className="text-[11px] font-bold text-amber-900 mt-1.5">
                                    Assigned Bus: {wrongBusModal.scannedBusId || 'N/A'}
                                </p>
                                <p className="text-[11px] text-slate-600 mt-0.5">
                                    Stage: {wrongBusModal.passenger.stageName || wrongBusModal.passenger.stage_name || '—'}
                                </p>
                            </div>

                            {/* Current Inspected Route */}
                            <div className="p-3 rounded-xl bg-blue-50/80 border border-blue-200">
                                <p className="text-[10px] font-bold text-blue-800 uppercase tracking-wider flex items-center gap-1">
                                    <Bus size={12} /> Current Bus / Route
                                </p>
                                <p className="text-sm font-black text-slate-900 mt-1">
                                    Route {wrongBusModal.targetRouteId}
                                </p>
                                <p className="text-xs text-slate-600 truncate">{wrongBusModal.targetRouteName}</p>
                                <p className="text-[11px] font-bold text-blue-900 mt-1.5">
                                    This Bus: {wrongBusModal.targetBuses?.join(', ') || 'N/A'}
                                </p>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex flex-col sm:flex-row gap-2 pt-2">
                            <button
                                type="button"
                                onClick={() => {
                                    markPassengerInspected(wrongBusModal.passenger, true);
                                    setWrongBusModal((prev) => ({ ...prev, isOpen: false }));
                                    setInspectionNotification({
                                        type: 'success',
                                        title: 'Boarding Allowed (Override)',
                                        passengerKey: String(wrongBusModal.passenger.requestId || wrongBusModal.passenger.studentId),
                                        message: `Allowed boarding for ${wrongBusModal.passenger.studentName || 'Passenger'} (Assigned to Route ${wrongBusModal.scannedRouteId}).`,
                                    });
                                }}
                                className="flex-1 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors cursor-pointer text-center shadow-sm"
                            >
                                ⚠️ Allow Boarding Anyway
                            </button>

                            <button
                                type="button"
                                onClick={() => setWrongBusModal((prev) => ({ ...prev, isOpen: false }))}
                                className="py-2.5 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs transition-colors cursor-pointer text-center"
                            >
                                Dismiss / Reject
                            </button>
                        </div>
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

const OfflineVerifyShell = ({ children, title }) => (
    <div className="min-h-screen bg-[#EAF3FF] flex flex-col">
        <header className="bg-[#071B45] text-white px-4 py-3 flex items-center gap-3 shadow-md">
            <div className="w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center">
                <ShieldCheck size={18} />
            </div>
            <div className="min-w-0">
                <p className="text-sm font-bold leading-tight">{title || 'Pydah Transport'}</p>
                <p className="text-[10px] text-blue-200 uppercase tracking-wider">Offline Verification</p>
            </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
            <div className="w-full mx-auto max-w-4xl">{children}</div>
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
    <div className="rounded-xl border border-slate-200/80 bg-slate-50 px-3 py-2.5 shadow-2xs">
        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">{label}</p>
        <p className="text-xs font-bold text-slate-800 mt-0.5 break-all">{value}</p>
    </div>
);

export default QrVerification;
