/**
 * Offline QR verification helpers — IndexedDB, payload parse, Ed25519 verify.
 * Kept in one module for a minimal file layout.
 */

const DB_NAME = 'pydah_qr_verify';
const DB_VERSION = 2;
const STORE_PASSENGERS = 'passengers';
const STORE_META = 'syncMetadata';
const STORE_SCANS = 'offlineScans';
const STORE_KEYS = 'publicKeys';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = (event) => {
            const db = req.result;
            const tx = event.target.transaction;
            let passengerStore;
            if (!db.objectStoreNames.contains(STORE_PASSENGERS)) {
                passengerStore = db.createObjectStore(STORE_PASSENGERS, { keyPath: 'requestId' });
                passengerStore.createIndex('studentId', 'studentId', { unique: false });
                passengerStore.createIndex('busId', 'busId', { unique: false });
                passengerStore.createIndex('routeId', 'routeId', { unique: false });
                passengerStore.createIndex('mongoId', 'mongoId', { unique: false });
            } else if (event.oldVersion < 2) {
                passengerStore = tx.objectStore(STORE_PASSENGERS);
                if (!passengerStore.indexNames.contains('mongoId')) {
                    passengerStore.createIndex('mongoId', 'mongoId', { unique: false });
                }
            }
            if (!db.objectStoreNames.contains(STORE_META)) {
                db.createObjectStore(STORE_META, { keyPath: 'key' });
            }
            if (!db.objectStoreNames.contains(STORE_SCANS)) {
                const scans = db.createObjectStore(STORE_SCANS, { keyPath: 'scanId' });
                scans.createIndex('synced', 'synced', { unique: false });
            }
            if (!db.objectStoreNames.contains(STORE_KEYS)) {
                db.createObjectStore(STORE_KEYS, { keyPath: 'kid' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function txDone(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('IndexedDB aborted'));
    });
}

export async function idbPutAllPassengers(records) {
    const db = await openDb();
    const tx = db.transaction(STORE_PASSENGERS, 'readwrite');
    const store = tx.objectStore(STORE_PASSENGERS);
    for (const record of records) {
        if (!record?.requestId) continue;
        store.put({
            ...record,
            requestId: String(record.requestId),
            mongoId: record.mongoId ? String(record.mongoId) : null,
            studentId: record.studentId ? String(record.studentId) : null,
        });
    }
    await txDone(tx);
}

export async function idbClearPassengers() {
    const db = await openDb();
    const tx = db.transaction(STORE_PASSENGERS, 'readwrite');
    tx.objectStore(STORE_PASSENGERS).clear();
    await txDone(tx);
}

function idbGetByIndex(storeName, indexName, value) {
    return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, 'readonly');
        const index = tx.objectStore(storeName).index(indexName);
        const req = index.get(String(value));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    }));
}

export function idbGetAllByStudent(studentId) {
    return openDb().then((db) => new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_PASSENGERS, 'readonly');
        const index = tx.objectStore(STORE_PASSENGERS).index('studentId');
        const req = index.getAll(String(studentId));
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
    }));
}

function selectLatestPassenger(records) {
    if (!records || records.length === 0) return null;
    if (records.length === 1) return records[0];
    
    return records.sort((a, b) => {
        const ayA = String(a.academicYear || '');
        const ayB = String(b.academicYear || '');
        if (ayA !== ayB) {
            return ayB.localeCompare(ayA);
        }
        const idA = Number(a.requestId) || 0;
        const idB = Number(b.requestId) || 0;
        return idB - idA;
    })[0];
}

/** Lookup passenger by request id, mongo id, or admission/emp number. */
export async function idbFindPassenger({ requestId, mongoId, studentId } = {}) {
    let baseRecord = null;
    if (requestId) {
        baseRecord = await idbGetPassenger(requestId);
    }
    if (!baseRecord && mongoId) {
        baseRecord = await idbGetByIndex(STORE_PASSENGERS, 'mongoId', mongoId);
    }
    if (!baseRecord && studentId) {
        baseRecord = await idbGetByIndex(STORE_PASSENGERS, 'studentId', studentId);
    }

    const resolvedStudentId = baseRecord?.studentId || studentId;
    if (resolvedStudentId) {
        try {
            const allRecords = await idbGetAllByStudent(resolvedStudentId);
            if (allRecords.length > 0) {
                return selectLatestPassenger(allRecords);
            }
        } catch (e) {
            console.warn('Error fetching all records by student:', e);
        }
    }
    return baseRecord;
}

export function buildOfflineLookupKeys(parsed) {
    const keys = {
        requestId: parsed?.requestId ? String(parsed.requestId) : null,
        mongoId: null,
        studentId: null,
    };

    if (parsed?.payload?.rid) keys.requestId = String(parsed.payload.rid);
    if (parsed?.payload?.sid) keys.studentId = String(parsed.payload.sid);

    const raw = String(parsed?.raw || '');
    const mongoMatch = raw.match(/verify-transport\/([a-f0-9]{24})/i);
    if (mongoMatch) keys.mongoId = mongoMatch[1];

    if (/^[a-f0-9]{24}$/i.test(keys.requestId || '')) {
        keys.mongoId = keys.requestId;
    }

    return keys;
}

export function mapPassengerToVerifyData(local) {
    if (!local) return null;
    const active = String(local.transportStatus || '').toLowerCase() === 'approved';
    return {
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
        application_number: local.applicationNumber || null,
        student_photo: local.studentPhoto || null,
        pin_no: local.pinNo || null,
    };
}

export async function verifyOfflinePassenger(parsed, lastSyncAt) {
    const keys = buildOfflineLookupKeys(parsed);
    const local = await idbFindPassenger(keys);
    if (!local) {
        return {
            ok: false,
            title: 'Data unavailable offline',
            message: 'Student not found in local data. Open Sync and download passenger records while online.',
            warning: true,
            local: null,
        };
    }

    const active = String(local.transportStatus || '').toLowerCase() === 'approved';
    return {
        ok: active,
        title: active ? 'Offline Verified' : 'Not Active (Offline)',
        message: active
            ? `Verified using data synchronized at ${formatSyncTime(lastSyncAt)}.`
            : `Local status: ${local.transportStatus || 'unknown'}`,
        warning: true,
        local,
        data: mapPassengerToVerifyData(local),
    };
}

export async function idbGetPassenger(requestId) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_PASSENGERS, 'readonly').objectStore(STORE_PASSENGERS).get(String(requestId));
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    });
}

export async function idbCountPassengers() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_PASSENGERS, 'readonly').objectStore(STORE_PASSENGERS).count();
        req.onsuccess = () => resolve(req.result || 0);
        req.onerror = () => reject(req.error);
    });
}

export async function idbSetMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction(STORE_META, 'readwrite');
    tx.objectStore(STORE_META).put({ key, value });
    await txDone(tx);
}

export async function idbGetMeta(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_META, 'readonly').objectStore(STORE_META).get(key);
        req.onsuccess = () => resolve(req.result?.value ?? null);
        req.onerror = () => reject(req.error);
    });
}

export async function idbSavePublicKey(info) {
    if (!info?.publicKeyPem) return;
    const db = await openDb();
    const tx = db.transaction(STORE_KEYS, 'readwrite');
    tx.objectStore(STORE_KEYS).put({
        kid: info.kid || 'default',
        algorithm: info.algorithm || 'Ed25519',
        publicKeyPem: info.publicKeyPem,
        version: info.version || 1,
    });
    await txDone(tx);
}

export async function idbGetPublicKey(kid) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const store = db.transaction(STORE_KEYS, 'readonly').objectStore(STORE_KEYS);
        if (kid) {
            const req = store.get(kid);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
            return;
        }
        const req = store.getAll();
        req.onsuccess = () => {
            const rows = req.result || [];
            resolve(rows[0] || null);
        };
        req.onerror = () => reject(req.error);
    });
}

export async function idbAddOfflineScan(scan) {
    const db = await openDb();
    const tx = db.transaction(STORE_SCANS, 'readwrite');
    tx.objectStore(STORE_SCANS).put({ ...scan, synced: false });
    await txDone(tx);
}

export async function idbGetUnsyncedScans() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = db.transaction(STORE_SCANS, 'readonly').objectStore(STORE_SCANS).getAll();
        req.onsuccess = () => resolve((req.result || []).filter((s) => !s.synced));
        req.onerror = () => reject(req.error);
    });
}

export async function idbMarkScansSynced(scanIds) {
    const db = await openDb();
    const tx = db.transaction(STORE_SCANS, 'readwrite');
    const store = tx.objectStore(STORE_SCANS);
    for (const id of scanIds) {
        const getReq = store.get(id);
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve, reject) => {
            getReq.onsuccess = () => {
                const row = getReq.result;
                if (row) store.put({ ...row, synced: true });
                resolve();
            };
            getReq.onerror = () => reject(getReq.error);
        });
    }
    await txDone(tx);
}

export function createScanId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return `scan-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getOrCreateDeviceId() {
    const key = 'qr_verify_device_id';
    let id = localStorage.getItem(key);
    if (!id) {
        id = `DEV-${createScanId().slice(0, 8).toUpperCase()}`;
        localStorage.setItem(key, id);
    }
    return id;
}

function fromBase64Url(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    const binary = atob(padded + pad);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
}

function canonicalizePayload(fields) {
    return JSON.stringify({
        v: fields.v,
        kid: fields.kid,
        rid: fields.rid,
        sid: fields.sid,
        ay: fields.ay || null,
        rid2: fields.rid2 || null,
        bid: fields.bid || null,
        exp: fields.exp || null,
    });
}

function pemToSpki(pem) {
    const b64 = pem
        .replace(/-----BEGIN PUBLIC KEY-----/g, '')
        .replace(/-----END PUBLIC KEY-----/g, '')
        .replace(/\s+/g, '');
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
}

export function extractRequestIdFromText(text) {
    if (!text) return null;
    const normalized = String(text).trim();
    const urlMatch = normalized.match(/verify-transport\/([^/?#]+)/i);
    if (urlMatch) {
        try {
            return decodeURIComponent(urlMatch[1]);
        } catch {
            return urlMatch[1];
        }
    }
    return null;
}

export function parseQrText(raw) {
    const text = String(raw || '').trim();
    if (!text) return { type: 'empty' };

    let token = null;
    const hashIdx = text.indexOf('#TR1.');
    if (hashIdx >= 0) token = text.slice(hashIdx + 1);
    else {
        const m = text.match(/TR1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) token = m[0];
    }

    const requestIdFromUrl = extractRequestIdFromText(text);

    if (token && token.startsWith('TR1.')) {
        const parts = token.split('.');
        if (parts.length === 3) {
            try {
                const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
                return {
                    type: 'signed',
                    token,
                    payload,
                    sig: parts[2],
                    requestId: payload.rid || requestIdFromUrl,
                    raw: text,
                };
            } catch {
                return { type: 'invalid', raw: text, requestId: requestIdFromUrl };
            }
        }
    }

    if (requestIdFromUrl) {
        return { type: 'legacy_url', requestId: requestIdFromUrl, raw: text };
    }

    // Plain request id pasted manually
    if (/^[a-f0-9]{24}$/i.test(text) || /^\d+$/.test(text)) {
        return { type: 'legacy_id', requestId: text, raw: text };
    }

    // Signed token without URL wrapper
    if (text.startsWith('TR1.')) {
        const parts = text.split('.');
        if (parts.length === 3) {
            try {
                const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(parts[1])));
                return {
                    type: 'signed',
                    token: text,
                    payload,
                    sig: parts[2],
                    requestId: payload.rid || null,
                    raw: text,
                };
            } catch {
                return { type: 'invalid', raw: text };
            }
        }
    }

    return { type: 'unknown', raw: text };
}

export async function verifySignedPayload(parsed, publicKeyPem) {
    if (!parsed || parsed.type !== 'signed') {
        return { ok: false, reason: 'not_signed' };
    }
    if (!publicKeyPem) {
        return { ok: false, reason: 'no_public_key' };
    }
    if (Number(parsed.payload?.v) !== 1) {
        return { ok: false, reason: 'unsupported_version' };
    }

    if (parsed.payload?.exp) {
        const exp = new Date(parsed.payload.exp);
        if (!Number.isNaN(exp.getTime()) && exp.getTime() < Date.now()) {
            return { ok: false, reason: 'expired', payload: parsed.payload };
        }
    }

    try {
        const key = await crypto.subtle.importKey(
            'spki',
            pemToSpki(publicKeyPem),
            { name: 'Ed25519' },
            false,
            ['verify']
        );
        const canonical = canonicalizePayload(parsed.payload);
        const ok = await crypto.subtle.verify(
            'Ed25519',
            key,
            fromBase64Url(parsed.sig),
            new TextEncoder().encode(canonical)
        );
        if (!ok) return { ok: false, reason: 'invalid_signature', payload: parsed.payload };
        return { ok: true, reason: 'valid', payload: parsed.payload };
    } catch (err) {
        return { ok: false, reason: 'verify_error', message: err.message, payload: parsed.payload };
    }
}

export function formatSyncTime(iso) {
    if (!iso) return 'Never';
    try {
        return new Date(iso).toLocaleString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true,
        });
    } catch {
        return String(iso);
    }
}

const OFFLINE_READY_KEY = 'pydah_qr_offline_ready';

/** Mark device as ready for offline QR after a successful sync. */
export async function markOfflineVerifyReady({ academicYear, count } = {}) {
    await idbSetMeta('offlineReady', {
        ready: true,
        academicYear: academicYear || null,
        count: count || 0,
        at: new Date().toISOString(),
    });
    try {
        localStorage.setItem(OFFLINE_READY_KEY, '1');
    } catch {
        // ignore
    }
}

/** True when this device has synced passenger data and can verify offline without a fresh login. */
export async function canUseOfflineVerify() {
    try {
        if (localStorage.getItem(OFFLINE_READY_KEY) === '1') {
            const count = await idbCountPassengers();
            if (count > 0) return true;
        }
    } catch {
        // fall through
    }

    try {
        const count = await idbCountPassengers();
        if (count > 0) {
            try {
                localStorage.setItem(OFFLINE_READY_KEY, '1');
            } catch {
                // ignore
            }
            return true;
        }
    } catch {
        // ignore
    }

    return false;
}
