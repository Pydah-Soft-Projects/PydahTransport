import React, { forwardRef, useMemo } from 'react';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import TransportIdCardQr from './TransportIdCardQr';

const LOGO_SRC = '/PYDAH_LOGO_PHOTO.jpg';
const BUS_HELPLINE = '8500059344';

const getShortAcademicYearLabel = (academicYear) => {
    if (!academicYear) return '—';
    const parts = String(academicYear).split('-').map((p) => p.trim());
    if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        return `${parts[0].slice(-2)}-${parts[1].slice(-2)}`;
    }
    return academicYear;
};

const formatTransportId = (passenger) => {
    if (passenger?.application_number) return passenger.application_number;
    if (passenger?.application_serial != null) {
        return String(passenger.application_serial).padStart(4, '0');
    }
    return '—';
};

const chunk = (items, size) => {
    const pages = [];
    for (let i = 0; i < items.length; i += size) {
        pages.push(items.slice(i, i + size));
    }
    return pages;
};

/** Always render exactly `cardsPerPage` rows per sheet (empty slots for unused rows). */
const buildPageSlots = (pagePassengers, cardsPerPage, padToFullPage = true) => {
    const slots = pagePassengers.map((passenger) => ({ passenger }));
    if (!padToFullPage) return slots;
    while (slots.length < cardsPerPage) {
        slots.push({ passenger: null });
    }
    return slots.slice(0, cardsPerPage);
};

const EMPTY_CELL = '\u00A0';

const BusIdCardFront = ({ passenger, academicYear, isTemplate = false }) => {
    const shortAy = getShortAcademicYearLabel(
        academicYear || passenger?.academic_year
    );

    let name = EMPTY_CELL;
    let regNo = EMPTY_CELL;
    let routeLabel = EMPTY_CELL;
    let stageName = EMPTY_CELL;
    let transportId = EMPTY_CELL;
    let admissionNo = EMPTY_CELL;
    let pinNo = EMPTY_CELL;
    let routeId = '';
    let routeName = '';
    let photoSrc = null;

    if (!isTemplate && passenger) {
        const {
            student_name,
            employee_name,
            admission_number,
            admission_no,
            emp_no,
            pin_no,
            route_id,
            route_name,
            stage_name,
            student_photo,
        } = passenger;

        name = student_name || employee_name || '—';
        admissionNo = admission_number || admission_no || emp_no || '—';
        pinNo = pin_no ? String(pin_no).trim() : '';
        regNo = pinNo ? `${admissionNo} | PIN ${pinNo}` : admissionNo;
        routeId = route_id || '';
        routeName = route_name || '';
        routeLabel = route_id
            ? `Route No ${route_id}${route_name ? ` (${route_name})` : ''}`
            : route_name || '—';
        stageName = stage_name || '—';
        transportId = formatTransportId(passenger);
        photoSrc = normalizeStudentPhoto(student_photo);
    }

    return (
        <div className={`id-card-front${isTemplate ? ' id-card-front--template' : ''}`}>
            <table className="id-card-table">
                <tbody>
                    <tr>
                        <td className="id-logo-cell" rowSpan={2}>
                            <img src={LOGO_SRC} alt="Pydah Group" className="id-logo" />
                        </td>
                        <td className="id-title-cell">
                            Bus ID {shortAy}
                        </td>
                        <td className="id-number-cell" colSpan={2}>
                            {isTemplate ? 'ID' : `ID ${transportId}`}
                        </td>
                    </tr>
                    <tr>
                        <td className="id-name-cell" colSpan={3}>{name}</td>
                    </tr>
                    <tr>
                        <td className="id-value-cell id-reg-cell" colSpan={3}>
                            {isTemplate ? (
                                'Adm No | PIN'
                            ) : (
                                <div className="id-reg-container">
                                    {pinNo ? (
                                        <span>PIN: {pinNo}</span>
                                    ) : (
                                        <span>Adm No: {admissionNo}</span>
                                    )}
                                </div>
                            )}
                        </td>
                        <td className="id-photo-cell" rowSpan={4}>
                            <div className="id-photo-frame">
                                {photoSrc ? (
                                    <img src={photoSrc} alt={name} className="id-photo" />
                                ) : (
                                    <div className="id-photo-placeholder">PHOTO</div>
                                )}
                            </div>
                        </td>
                    </tr>
                    <tr>
                        <td className="id-value-cell id-route-cell" colSpan={3}>
                            {isTemplate ? (
                                'Route No | Name'
                            ) : routeId ? (
                                <div className="id-route-container">
                                    <span className="id-route-number">Route No: {routeId}</span>
                                    {routeName && <span className="id-route-name-line">{routeName}</span>}
                                </div>
                            ) : (
                                routeName || '—'
                            )}
                        </td>
                    </tr>
                    <tr>
                        <td className="id-label-cell" colSpan={3}>Pick Up Location</td>
                    </tr>
                    <tr>
                        <td className="id-value-cell id-stage-cell" colSpan={3}>{stageName}</td>
                    </tr>
                    <tr>
                        <td className="id-helpline-label-cell" colSpan={2}>
                            Bus Helpline
                        </td>
                        <td className="id-helpline-value-cell" colSpan={1}>
                            {BUS_HELPLINE}
                        </td>
                        <td className="id-signature-cell" colSpan={1}>
                            {EMPTY_CELL}
                        </td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

const BusIdCardBack = ({ passenger, isTemplate = false }) => (
    <div className="id-card-back">
        <div className="id-back-layout">
            <div className="id-back-qr-box" aria-label={isTemplate ? 'QR code placeholder' : 'Transport verification QR code'}>
                {isTemplate || !passenger ? (
                    <div className="id-back-qr-square">
                        <span className="id-back-qr-label">QR</span>
                    </div>
                ) : (
                    <TransportIdCardQr passenger={passenger} qrDataUrl={passenger.qrDataUrl} />
                )}
            </div>
            <div className="id-back-text">
                <table className="id-back-text-table">
                    <tbody>
                        <tr>
                            <td className="id-back-text-terms">
                                <p className="id-back-line">1st Term: On or before First Semester starting Date.</p>
                                <p className="id-back-line">2nd Term: On or before Second Semester starting Date.</p>
                            </td>
                        </tr>
                        <tr>
                            <td className="id-back-text-rules">
                                <p className="id-back-rule-line">
                                    1. Student should compulsory be available at the bus stage before 15 min of the time allotted
                                </p>
                                <p className="id-back-rule-line">
                                    2. late fee of Rs.500/- will be applicable for each term if not paid on or before the above due dates
                                </p>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    </div>
);

const TransportBusIdCardSheet = forwardRef(({ passengers = [], academicYear, cardsPerPage = 5, padToFullPage = true }, ref) => {
    const pages = useMemo(() => chunk(passengers, cardsPerPage), [passengers, cardsPerPage]);

    if (!passengers.length) return null;

    return (
        <div
            className="bus-id-print-host"
            style={{
                position: 'fixed',
                left: 0,
                top: 0,
                width: '210mm',
                visibility: 'hidden',
                zIndex: -1,
                pointerEvents: 'none',
            }}
        >
            <div ref={ref} className="bus-id-print-root">
                <style>{`
                    @page {
                        size: A4 portrait;
                        margin: 4mm;
                    }
                    @media print {
                        html, body {
                            margin: 0;
                            padding: 0;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        .bus-id-print-host {
                            visibility: visible !important;
                            position: static !important;
                            z-index: auto !important;
                            width: 100% !important;
                        }
                        .bus-id-page {
                            page-break-after: always;
                        }
                        .bus-id-page:last-child {
                            page-break-after: auto;
                        }
                        .bus-id-sheet {
                            border-color: #000 !important;
                        }
                        .id-card-half {
                            border-color: #000 !important;
                        }
                        .id-card-v-divider::before {
                            border-left: 2px dotted #000 !important;
                        }
                        .id-card-h-divider::before {
                            border-top: 2px dotted #000 !important;
                        }
                        .id-back-qr-square {
                            border-color: #000 !important;
                        }
                        .id-back-text {
                            border-left-color: transparent !important;
                        }
                        .id-back-qr-box {
                            border-right-color: #000 !important;
                        }
                        .id-back-text-terms {
                            border-bottom-color: #000 !important;
                        }
                        .id-back-text-table td {
                            border-color: #000 !important;
                        }
                        .id-card-table td {
                            border-color: #000 !important;
                        }
                    }
                    .bus-id-print-root {
                        font-family: Arial, Helvetica, sans-serif;
                        color: #000;
                        background: #fff;
                    }
                    .bus-id-page {
                        width: 202mm;
                        height: 289mm;
                        margin: 0 auto;
                        box-sizing: border-box;
                        page-break-after: always;
                        page-break-inside: avoid;
                    }
                    .bus-id-page--5 {
                        --h-gutter: 3.2mm;
                        --v-gutter: 4.5mm;
                        --card-side-inset: 15.25mm;
                        --card-cut-inset: 1.0mm;
                        --card-row-height: calc((289mm - 2px - (4 * var(--h-gutter))) / 5);
                    }
                    .bus-id-page--6 {
                        --h-gutter: 2.7mm;
                        --v-gutter: 4.5mm;
                        --card-side-inset: 15.25mm;
                        --card-cut-inset: 1.0mm;
                        --card-row-height: calc((289mm - 2px - (5 * var(--h-gutter))) / 6);
                    }
                    .bus-id-sheet {
                        display: flex;
                        flex-direction: column;
                        align-items: stretch;
                        width: 100%;
                        height: 100%;
                        border: 1px solid #000;
                        box-sizing: border-box;
                    }
                    .id-card-row {
                        display: flex;
                        flex-direction: row;
                        align-items: stretch;
                        flex: 0 0 var(--card-row-height);
                        height: var(--card-row-height);
                        min-height: var(--card-row-height);
                        max-height: var(--card-row-height);
                        width: 100%;
                        box-sizing: border-box;
                        page-break-inside: avoid;
                        overflow: hidden;
                        padding: var(--card-cut-inset) var(--card-side-inset);
                    }
                    .id-card-h-divider {
                        flex: 0 0 var(--h-gutter);
                        height: var(--h-gutter);
                        min-height: var(--h-gutter);
                        width: 100%;
                        position: relative;
                    }
                    .id-card-h-divider::before {
                        content: '';
                        position: absolute;
                        left: 0;
                        right: 0;
                        top: 50%;
                        border-top: 2px dotted #000;
                    }
                    .id-card-half {
                        flex: 1 1 0;
                        width: 0; /* force equal front/back halves even if photo is huge */
                        min-width: 0;
                        min-height: 0;
                        overflow: hidden;
                        border: 1px solid #000;
                        box-sizing: border-box;
                        display: flex;
                        flex-direction: column;
                    }
                    .id-card-half--front {
                        margin-right: var(--card-cut-inset);
                    }
                    .id-card-half--back {
                        margin-left: var(--card-cut-inset);
                    }
                    .id-card-v-divider {
                        flex: 0 0 var(--v-gutter);
                        width: var(--v-gutter);
                        align-self: stretch;
                        position: relative;
                    }
                    .id-card-v-divider::before {
                        content: '';
                        position: absolute;
                        left: 50%;
                        top: 0;
                        bottom: 0;
                        transform: translateX(-50%);
                        border-left: 2px dotted #000;
                    }
                    .id-card-front,
                    .id-card-back {
                        flex: 1 1 auto;
                        width: 100%;
                        height: 100%;
                        min-height: 0;
                        box-sizing: border-box;
                        overflow: hidden;
                    }
                    .id-card-table {
                        width: 100%;
                        height: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }
                    .bus-id-page--5 .id-card-table {
                        font-size: 7.5pt;
                    }
                    .bus-id-page--6 .id-card-table {
                        font-size: 6.5pt;
                    }
                    .id-card-table td {
                        border: 1px solid #000;
                        padding: 0.15mm 0.3mm;
                        vertical-align: middle;
                        line-height: 1.05;
                        word-wrap: break-word;
                        overflow: hidden;
                        font-weight: 700;
                    }
                    .id-card-table tbody tr {
                        height: 14.28%;
                    }
                    .id-logo-cell {
                        width: 20%;
                        text-align: center;
                        padding: 0.1mm !important;
                    }
                    .bus-id-page--5 .id-logo {
                        max-width: 14.5mm;
                        max-height: 10.5mm;
                    }
                    .bus-id-page--6 .id-logo {
                        max-width: 12.5mm;
                        max-height: 8.5mm;
                    }
                    .id-logo {
                        width: 100%;
                        height: auto;
                        object-fit: contain;
                        display: block;
                        margin: 0 auto;
                    }
                    .id-title-cell {
                        width: 28%;
                        text-align: center;
                    }
                    .bus-id-page--5 .id-title-cell {
                        font-size: 8.5pt;
                    }
                    .bus-id-page--6 .id-title-cell {
                        font-size: 7.5pt;
                    }
                    .id-number-cell {
                        width: 52%;
                        text-align: center;
                        white-space: nowrap;
                    }
                    .bus-id-page--5 .id-number-cell {
                        font-size: 8pt;
                    }
                    .bus-id-page--6 .id-number-cell {
                        font-size: 7pt;
                    }
                    .id-name-cell {
                        text-align: center;
                        text-transform: uppercase;
                        font-weight: 900;
                    }
                    .bus-id-page--5 .id-name-cell {
                        font-size: 10.5pt;
                    }
                    .bus-id-page--6 .id-name-cell {
                        font-size: 9pt;
                    }
                    .id-value-cell,
                    .id-route-cell,
                    .id-label-cell {
                        text-align: center;
                    }
                    .bus-id-page--5 .id-value-cell,
                    .bus-id-page--5 .id-route-cell,
                    .bus-id-page--5 .id-label-cell {
                        font-size: 7.5pt;
                    }
                    .bus-id-page--6 .id-value-cell,
                    .bus-id-page--6 .id-route-cell,
                    .bus-id-page--6 .id-label-cell {
                        font-size: 6.5pt;
                    }

                    /* Custom styles for ID Card elements to make them bold & bigger */
                    .id-reg-container {
                        display: flex;
                        flex-direction: row;
                        align-items: center;
                        justify-content: center;
                        gap: 1.5mm;
                        font-weight: 900;
                    }
                    .bus-id-page--5 .id-reg-container {
                        font-size: 12pt;
                    }
                    .bus-id-page--6 .id-reg-container {
                        font-size: 10pt;
                    }
                    .id-stage-cell {
                        text-align: center;
                        font-weight: 900;
                    }
                    .bus-id-page--5 .id-stage-cell {
                        font-size: 12pt;
                    }
                    .bus-id-page--6 .id-stage-cell {
                        font-size: 10pt;
                    }
                    .id-route-container {
                        display: flex;
                        flex-direction: column;
                        align-items: center;
                        justify-content: center;
                        line-height: 1.25;
                    }
                    .id-route-number {
                        font-weight: 800;
                    }
                    .id-route-name-line {
                        font-weight: 500;
                        max-width: 100%;
                        overflow: hidden;
                        display: -webkit-box;
                        -webkit-line-clamp: 2;
                        -webkit-box-orient: vertical;
                        word-break: break-word;
                    }
                    .bus-id-page--5 .id-route-number {
                        font-size: 8.5pt;
                    }
                    .bus-id-page--5 .id-route-name-line {
                        font-size: 6.5pt;
                    }
                    .bus-id-page--6 .id-route-number {
                        font-size: 7.5pt;
                    }
                    .bus-id-page--6 .id-route-name-line {
                        font-size: 5.5pt;
                    }
                    /* height:1px + absolute fill: cell size comes from rowspan rows;
                       photo cannot expand layout or sit short in the cell */
                    .id-photo-cell {
                        width: 28%;
                        height: 1px;
                        padding: 0 !important;
                        vertical-align: top;
                        overflow: hidden;
                        position: relative;
                    }
                    .id-photo-frame {
                        position: absolute;
                        inset: 0;
                        width: 100%;
                        height: 100%;
                        margin: 0;
                        padding: 0;
                        overflow: hidden;
                        box-sizing: border-box;
                        background: #f0f0f0;
                        line-height: 0;
                    }
                    .id-photo {
                        position: absolute;
                        inset: 0;
                        width: 100%;
                        height: 100%;
                        object-fit: cover;
                        /* Many upload photos have subject low in frame; bias crop down */
                        object-position: center 68%;
                        display: block;
                        border: 0;
                    }
                    .id-photo-placeholder {
                        position: absolute;
                        inset: 0;
                        width: 100%;
                        height: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        font-size: 5pt;
                        font-weight: 700;
                        color: #666;
                        background: #f5f5f5;
                        box-sizing: border-box;
                        line-height: normal;
                    }
                    .id-helpline-label-cell {
                        text-align: center;
                        font-weight: 800;
                        text-transform: uppercase;
                    }
                    .id-helpline-value-cell {
                        text-align: center;
                        font-weight: 950;
                    }
                    .bus-id-page--5 .id-helpline-label-cell {
                        font-size: 8.5pt;
                    }
                    .bus-id-page--5 .id-helpline-value-cell {
                        font-size: 8.5pt;
                    }
                    .bus-id-page--6 .id-helpline-label-cell {
                        font-size: 7.5pt;
                    }
                    .bus-id-page--6 .id-helpline-value-cell {
                        font-size: 7.5pt;
                    }
                    .id-card-back {
                        height: 100%;
                        width: 100%;
                        overflow: hidden;
                    }
                    .id-back-layout {
                        display: flex;
                        flex-direction: row;
                        align-items: stretch;
                        justify-content: flex-start;
                        height: 100%;
                        width: 100%;
                        max-width: 100%;
                        padding: 0.6mm;
                        margin: 0;
                        box-sizing: border-box;
                        gap: 0;
                    }
                    .id-back-qr-box {
                        flex: 0 0 25%;
                        width: 25%;
                        max-width: 25%;
                        min-width: 0;
                        height: 100%;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-sizing: border-box;
                        padding: 1mm 1.2mm 1mm 0.8mm;
                        background: #fff;
                        border-right: 1px solid #000;
                        overflow: hidden;
                    }
                    .id-back-qr-square,
                    .id-back-qr-image {
                        width: 100%;
                        height: auto;
                        max-width: 100%;
                        max-height: calc(100% - 0.5mm);
                        aspect-ratio: 1 / 1;
                        border: 1px solid #000;
                        display: block;
                        box-sizing: border-box;
                        background: #fff;
                        object-fit: contain;
                        flex-shrink: 1;
                    }
                    .id-back-qr-square {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                    }
                    .id-back-qr-label {
                        font-size: 6pt;
                        font-weight: 700;
                        color: #666;
                    }
                    .bus-id-page--6 .id-back-qr-label {
                        font-size: 5pt;
                    }
                    .id-back-text {
                        flex: 1 1 0;
                        min-width: 0;
                        height: 100%;
                        padding: 0;
                        border-left: none;
                        box-sizing: border-box;
                        overflow: hidden;
                    }
                    .id-back-text-table {
                        width: 100%;
                        height: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                    }
                    .id-back-text-table tr {
                        height: 50%;
                    }
                    .id-back-text-terms,
                    .id-back-text-rules {
                        vertical-align: middle;
                        text-align: left;
                        box-sizing: border-box;
                    }
                    .id-back-text-terms {
                        border-bottom: 1px solid #000;
                        padding: 1.8mm 1.5mm 2.2mm 2.8mm;
                    }
                    .id-back-text-rules {
                        padding: 2.2mm 1.5mm 1.8mm 2.8mm;
                    }
                    .bus-id-page--5 .id-back-text-terms,
                    .bus-id-page--5 .id-back-text-terms .id-back-line {
                        font-size: 7pt;
                    }
                    .bus-id-page--6 .id-back-text-terms,
                    .bus-id-page--6 .id-back-text-terms .id-back-line {
                        font-size: 6pt;
                    }
                    .bus-id-page--5 .id-back-rule-line {
                        font-size: 7pt;
                    }
                    .bus-id-page--6 .id-back-rule-line {
                        font-size: 6pt;
                    }
                    .id-back-line {
                        margin: 0;
                        padding: 0;
                        line-height: 1.3;
                        font-weight: 700;
                    }
                    .id-back-text-terms .id-back-line + .id-back-line {
                        margin-top: 0.6mm;
                    }
                    .id-back-rule-line {
                        margin: 0;
                        padding: 0;
                        line-height: 1.32;
                        font-weight: 700;
                    }
                    .id-back-text-rules .id-back-rule-line + .id-back-rule-line {
                        margin-top: 0.8mm;
                    }
                `}</style>

                {pages.map((pagePassengers, pageIndex) => (
                    <div
                        key={`page-${pageIndex}`}
                        className={`bus-id-page bus-id-page--${cardsPerPage}`}
                    >
                        <div className="bus-id-sheet">
                            {buildPageSlots(pagePassengers, cardsPerPage, padToFullPage).map((slot, slotIndex, slots) => (
                                <React.Fragment
                                    key={slot.passenger?.id || slot.passenger?.application_serial || `slot-${pageIndex}-${slotIndex}`}
                                >
                                    <div className="id-card-row">
                                        <div className="id-card-half id-card-half--front">
                                            {slot.passenger ? (
                                                <BusIdCardFront passenger={slot.passenger} academicYear={academicYear} />
                                            ) : (
                                                <BusIdCardFront academicYear={academicYear} isTemplate />
                                            )}
                                        </div>
                                        <div className="id-card-v-divider" aria-hidden="true" />
                                        <div className="id-card-half id-card-half--back">
                                            <BusIdCardBack passenger={slot.passenger} isTemplate={!slot.passenger} />
                                        </div>
                                    </div>
                                    {slotIndex < slots.length - 1 && (
                                        <div className="id-card-h-divider" aria-hidden="true" />
                                    )}
                                </React.Fragment>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
});

export default TransportBusIdCardSheet;
