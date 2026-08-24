import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { getTransportVerifyUrl } from '../utils/siteUrl';
import { apiFetch, API_BASE, isAuthenticated } from '../utils/api';

const TransportIdCardQr = ({ passenger, qrDataUrl: presetQr, className = '' }) => {
    const [dataUrl, setDataUrl] = useState(presetQr || '');

    useEffect(() => {
        if (presetQr) {
            setDataUrl(presetQr);
            return undefined;
        }

        let cancelled = false;
        const requestId = passenger?.id ?? passenger?._id;

        const build = async () => {
            let content = getTransportVerifyUrl(requestId);
            if (isAuthenticated() && requestId != null) {
                try {
                    const res = await apiFetch(`${API_BASE}/verification/qr-content/${encodeURIComponent(requestId)}`);
                    const data = await res.json().catch(() => ({}));
                    if (res.ok && data.qrContent) {
                        content = data.qrContent;
                    }
                } catch {
                    // fall back to plain URL
                }
            }

            if (!content) {
                if (!cancelled) setDataUrl('');
                return;
            }

            try {
                const src = await QRCode.toDataURL(content, {
                    errorCorrectionLevel: 'M',
                    margin: 1,
                    width: 256,
                    color: { dark: '#000000', light: '#ffffff' },
                });
                if (!cancelled) setDataUrl(src);
            } catch {
                if (!cancelled) setDataUrl('');
            }
        };

        build();
        return () => {
            cancelled = true;
        };
    }, [passenger?.id, passenger?._id, passenger?.admission_number, presetQr]);

    if (!dataUrl) {
        return (
            <div className={`id-back-qr-square ${className}`}>
                <span className="id-back-qr-label">QR</span>
            </div>
        );
    }

    return (
        <img
            src={dataUrl}
            alt="Transport verification QR code"
            className={`id-back-qr-image ${className}`}
        />
    );
};

export default TransportIdCardQr;
