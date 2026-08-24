/**
 * Offline QR verification helpers — IndexedDB, payload parse, Ed25519 verify.
 * Kept in one module for a minimal file layout.
 */

const DB_NAME = 'pydah_qr_verify';
const DB_VERSION = 1;
const STORE_PASSENGERS = 'passengers';
const STORE_META = 'syncMetadata';
const STORE_SCANS = 'offlineScans';
const STORE_KEYS = 'publicKeys';

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE_PASSENGERS)) {
                const store = db.createObjectStore(STORE_PASSENGERS, { keyPath: 'requestId' });
                store.createIndex('studentId', 'studentId', { unique: false });
                store.createIndex('busId', 'busId', { unique: false });
                store.createIndex('routeId', 'routeId', { unique: false });
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
        store.put(record);
    }
    await txDone(tx);
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
    if (!info?.kid) return;
    const db = await openDb();
    const tx = db.transaction(STORE_KEYS, 'readwrite');
    tx.objectStore(STORE_KEYS).put(info);
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
    const urlMatch = String(text).match(/verify-transport\/([^/?#]+)/i);
    if (urlMatch) return decodeURIComponent(urlMatch[1]);
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
