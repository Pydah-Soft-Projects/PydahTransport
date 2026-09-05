const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const KEY_DIR = path.join(__dirname, '..', 'keys');
const PRIVATE_KEY_PATH = process.env.QR_PRIVATE_KEY_PATH || path.join(KEY_DIR, 'qr-ed25519-private.pem');
const PUBLIC_KEY_PATH = process.env.QR_PUBLIC_KEY_PATH || path.join(KEY_DIR, 'qr-ed25519-public.pem');
const KEY_ID = process.env.QR_KEY_ID || '2026-01';
const QR_PAYLOAD_VERSION = 1;

let cachedKeys = null;

function ensureKeyPair() {
    if (cachedKeys) return cachedKeys;

    if (process.env.QR_PRIVATE_KEY_PEM && process.env.QR_PUBLIC_KEY_PEM) {
        cachedKeys = {
            privateKey: process.env.QR_PRIVATE_KEY_PEM.replace(/\\n/g, '\n'),
            publicKey: process.env.QR_PUBLIC_KEY_PEM.replace(/\\n/g, '\n'),
            kid: KEY_ID,
        };
        return cachedKeys;
    }

    if (fs.existsSync(PRIVATE_KEY_PATH) && fs.existsSync(PUBLIC_KEY_PATH)) {
        cachedKeys = {
            privateKey: fs.readFileSync(PRIVATE_KEY_PATH, 'utf8'),
            publicKey: fs.readFileSync(PUBLIC_KEY_PATH, 'utf8'),
            kid: KEY_ID,
        };
        return cachedKeys;
    }

    if (!fs.existsSync(KEY_DIR)) {
        fs.mkdirSync(KEY_DIR, { recursive: true });
    }

    const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
        publicKeyEncoding: { type: 'spki', format: 'pem' },
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    fs.writeFileSync(PRIVATE_KEY_PATH, privateKey, { mode: 0o600 });
    fs.writeFileSync(PUBLIC_KEY_PATH, publicKey, { mode: 0o644 });

    console.log(`[qrSigning] Generated Ed25519 key pair (kid=${KEY_ID}) at ${KEY_DIR}`);

    cachedKeys = { privateKey, publicKey, kid: KEY_ID };
    return cachedKeys;
}

function toBase64Url(buf) {
    return Buffer.from(buf)
        .toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function fromBase64Url(str) {
    const padded = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
    return Buffer.from(padded + pad, 'base64');
}

/** Stable JSON without whitespace — only unsigned fields. */
function canonicalizePayload(fields) {
    if (!fields) return '{}';
    const ordered = {
        v: Number(fields.v || 1),
        kid: fields.kid ? String(fields.kid) : null,
        rid: fields.rid !== undefined && fields.rid !== null ? String(fields.rid) : null,
        sid: fields.sid !== undefined && fields.sid !== null ? String(fields.sid) : '',
    };
    if (fields.ay) ordered.ay = String(fields.ay);
    if (fields.rid2 !== undefined && fields.rid2 !== null) ordered.rid2 = String(fields.rid2);
    if (fields.bid !== undefined && fields.bid !== null) ordered.bid = String(fields.bid);
    if (fields.exp) ordered.exp = String(fields.exp);

    return JSON.stringify(ordered);
}

function signPayloadFields(fields) {
    const keys = ensureKeyPair();
    const withMeta = {
        v: QR_PAYLOAD_VERSION,
        kid: keys.kid,
        rid: String(fields.rid),
        sid: String(fields.sid || ''),
        ay: fields.ay || null,
        rid2: fields.rid2 || null,
        bid: fields.bid || null,
        exp: fields.exp || null,
    };
    const canonical = canonicalizePayload(withMeta);
    const signature = crypto.sign(null, Buffer.from(canonical, 'utf8'), keys.privateKey);
    return {
        ...withMeta,
        sig: toBase64Url(signature),
    };
}

/**
 * Compact signed token for QR: TR1.<payloadB64>.<sigB64>
 * Public verify URL embeds it in the hash so phone cameras still open the website.
 */
function buildSignedToken(fields) {
    const signed = signPayloadFields(fields);
    const { sig, ...payload } = signed;
    const body = toBase64Url(Buffer.from(canonicalizePayload(payload), 'utf8'));
    return `TR1.${body}.${sig}`;
}

function buildSignedVerifyUrl(requestId, fields, publicSiteUrl) {
    const base = String(publicSiteUrl || process.env.PUBLIC_SITE_URL || '').replace(/\/$/, '');
    const token = buildSignedToken({ ...fields, rid: requestId });
    if (!base) return token;
    return `${base}/verify-transport/${encodeURIComponent(requestId)}#${token}`;
}

function parseSignedToken(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const text = raw.trim();

    let token = text;
    const hashIdx = text.indexOf('#TR1.');
    if (hashIdx >= 0) {
        token = text.slice(hashIdx + 1);
    } else if (text.includes('TR1.')) {
        const m = text.match(/TR1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) token = m[0];
    }

    if (!token.startsWith('TR1.')) return null;

    const parts = token.split('.');
    if (parts.length !== 3 || parts[0] !== 'TR1') return null;

    let payload;
    try {
        payload = JSON.parse(fromBase64Url(parts[1]).toString('utf8'));
    } catch {
        return null;
    }

    return { payload, sig: parts[2], token };
}

function verifySignedToken(raw) {
    const parsed = parseSignedToken(raw);
    if (!parsed) {
        return { ok: false, reason: 'invalid_format' };
    }

    const { payload, sig } = parsed;
    if (Number(payload.v) !== QR_PAYLOAD_VERSION) {
        return { ok: false, reason: 'unsupported_version', payload };
    }

    const keys = ensureKeyPair();
    if (payload.kid && payload.kid !== keys.kid) {
        // Allow only current key for now; rotation can load multiple PEMs later
        return { ok: false, reason: 'unknown_kid', payload };
    }

    const canonical = canonicalizePayload({
        v: payload.v,
        kid: payload.kid || keys.kid,
        rid: payload.rid,
        sid: payload.sid,
        ay: payload.ay || null,
        rid2: payload.rid2 || null,
        bid: payload.bid || null,
        exp: payload.exp || null,
    });

    let valid = false;
    try {
        valid = crypto.verify(null, Buffer.from(canonical, 'utf8'), keys.publicKey, fromBase64Url(sig));
    } catch {
        return { ok: false, reason: 'verify_error', payload };
    }

    if (!valid) {
        return { ok: false, reason: 'invalid_signature', payload };
    }

    if (payload.exp) {
        const expDate = new Date(payload.exp);
        if (!Number.isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
            return { ok: false, reason: 'expired', payload };
        }
    }

    return { ok: true, payload, reason: 'valid' };
}

function getPublicKeyInfo() {
    const keys = ensureKeyPair();
    return {
        kid: keys.kid,
        algorithm: 'Ed25519',
        publicKeyPem: keys.publicKey,
        version: QR_PAYLOAD_VERSION,
    };
}

module.exports = {
    ensureKeyPair,
    signPayloadFields,
    buildSignedToken,
    buildSignedVerifyUrl,
    parseSignedToken,
    verifySignedToken,
    getPublicKeyInfo,
    canonicalizePayload,
    QR_PAYLOAD_VERSION,
    KEY_ID,
};
