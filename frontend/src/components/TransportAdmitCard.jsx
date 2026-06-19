import React, { forwardRef } from 'react';
import { normalizeStudentPhoto } from '../utils/studentPhoto';
import { getDefaultAcademicYear } from '../utils/academicYear';

const LOGO_SRC = '/PYDAH_LOGO_PHOTO.jpg';
const BUS_HELPLINE = '8500059344';
const PHOTO_COL_WIDTH = '48mm';

const getAcademicYearLabel = (passenger) => {
    if (passenger?.academic_year) return passenger.academic_year;
    return getDefaultAcademicYear();
};

const getShortAcademicYearLabel = (passenger) => {
    const ay = getAcademicYearLabel(passenger);
    const parts = ay.split('-').map((p) => p.trim());
    if (parts.length === 2 && parts[0].length >= 2 && parts[1].length >= 2) {
        return `${parts[0].slice(-2)}-${parts[1].slice(-2)}`;
    }
    return ay;
};

const formatDate = (d) => {
    if (!d) return '—';
    try {
        return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    } catch {
        return '—';
    }
};

const getTempPassValidTill = () => {
    const d = new Date();
    d.setDate(d.getDate() + 4);
    return formatDate(d);
};

const TempBusPassCopy = ({ copyLabel, passenger }) => {
    const {
        student_name,
        employee_name,
        admission_number,
        emp_no,
        pin_no,
        application_number,
        user_type,
        course,
        branch,
        department,
        year_of_study,
        route_id,
        route_name,
        stage_name,
        stage_timing,
        student_photo,
    } = passenger || {};

    const name = student_name || employee_name || '—';
    const isEmployee = (user_type || '').toLowerCase() === 'employee';
    const transportApplicationNumber = application_number || '—';
    const idNumber = pin_no || admission_number || emp_no || '—';
    const displayCourse = course || department || '—';
    const courseDetail = branch ? `${displayCourse} (${branch})` : displayCourse;
    const yearDetail = isEmployee ? 'Employee' : (year_of_study != null ? `Year ${year_of_study}` : '—');
    const routeLabel = [route_id, route_name].filter(Boolean).join(' - ') || '—';
    const stageTiming = stage_timing || '—';
    const shortAy = getShortAcademicYearLabel(passenger);
    const validTill = getTempPassValidTill();
    const photoSrc = normalizeStudentPhoto(student_photo);
    const photoRowSpan = 6;

    return (
        <div className="admit-card-copy">
            <div className="copy-label">{copyLabel}</div>
            <div className="pass-border">
                <div className="pass-header">
                    <img src={LOGO_SRC} alt="Pydah Group" className="inst-logo" />
                    <div className="header-center">
                        <div className="inst-name">Pydah Group Of Institutions</div>
                        <div className="helpline">Bus Help Line No: {BUS_HELPLINE}</div>
                    </div>
                    <div className="header-right">
                        <div className="pass-type-banner">
                            <span>Temp Bus Pass for</span>
                            <span className="pass-ay">{shortAy} AY</span>
                        </div>
                        <div className="validity-banner">
                            <span>Valid for Four days only</span>
                            <span className="valid-till">Till {validTill}</span>
                        </div>
                    </div>
                </div>

                <div className="pass-content">
                    <table className="info-grid">
                        <tbody>
                            <tr>
                                <td className="cell-label" rowSpan={2}>Student Name &amp; Details</td>
                                <td className="cell-value cell-highlight" colSpan={2}>{name}</td>
                                <td className="cell-photo" rowSpan={photoRowSpan}>
                                    <div className="photo-cell-inner">
                                        <div className="photo-frame">
                                            {photoSrc ? (
                                                <img src={photoSrc} alt={name} className="student-photo" />
                                            ) : (
                                                <div className="photo-placeholder">PHOTO</div>
                                            )}
                                        </div>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td className="cell-value">{courseDetail}</td>
                                <td className="cell-value">{yearDetail}</td>
                            </tr>
                            <tr>
                                <td className="cell-label">Application NO. &amp; ID NO.</td>
                                <td className="cell-value cell-accent">{transportApplicationNumber}</td>
                                <td className="cell-value cell-accent">{idNumber}</td>
                            </tr>
                            <tr>
                                <td className="cell-label">Route No &amp; Name</td>
                                <td className="cell-value" colSpan={2}>{routeLabel}</td>
                            </tr>
                            <tr>
                                <td className="cell-label">Stage Name &amp; Timings</td>
                                <td className="cell-value">{stage_name || '—'}</td>
                                <td className="cell-value">{stageTiming}</td>
                            </tr>
                            <tr>
                                <td colSpan={3} className="terms-bar-cell">
                                    <div className="terms-bar">
                                        <span>1st Term: On or before First Semester starting Date.</span>
                                        <span>2nd Term: On or before Second Semester starting Date.</span>
                                    </div>
                                </td>
                            </tr>
                            <tr>
                                <td colSpan={3} className="notes-section">
                                    <strong className="note-heading">NOTE:</strong>
                                    <span className="note-text">
                                        1. Be at the bus stage 15 min before allotted time.
                                        2. Temp pass valid 4 days only — collect permanent pass from office.
                                        3. Late fee Rs.500/- per term if not paid by due date.
                                    </span>
                                </td>
                                <td className="signature-box">
                                    <span className="signature-label">Authorised Signature</span>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    );
};

const TransportAdmitCard = forwardRef(({ passenger }, ref) => {
    if (!passenger) return null;

    return (
        <div
            className="transport-admit-print-host"
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
            <div ref={ref} className="transport-admit-print-root">
                <style>{`
                    @page {
                        size: A4 portrait;
                        margin: 6mm;
                    }
                    @media print {
                        html, body {
                            margin: 0;
                            padding: 0;
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                        .transport-admit-print-host {
                            visibility: visible !important;
                            position: static !important;
                            z-index: auto !important;
                            width: 100% !important;
                        }
                        .transport-admit-print-root {
                            height: 285mm !important;
                            max-height: 285mm !important;
                            page-break-after: avoid !important;
                            page-break-inside: avoid !important;
                        }
                        .pass-border,
                        .info-grid td,
                        .signature-box {
                            border-color: #000 !important;
                        }
                        .pass-type-banner,
                        .terms-bar {
                            background: #4a4a4a !important;
                            color: #fff !important;
                        }
                        .validity-banner {
                            background: #d9d9d9 !important;
                        }
                        .cell-label {
                            background: #f0f4ff !important;
                        }
                        .copy-label,
                        .copy-label,
                        .inst-name,
                        .helpline,
                        .cell-highlight,
                        .cell-accent,
                        .valid-till,
                        .note-heading {
                            -webkit-print-color-adjust: exact;
                            print-color-adjust: exact;
                        }
                    }
                    .transport-admit-print-root {
                        font-family: Arial, Helvetica, sans-serif;
                        color: #000;
                        background: #fff;
                        width: 198mm;
                        height: 285mm;
                        max-height: 285mm;
                        margin: 0 auto;
                        display: grid;
                        grid-template-rows: 1fr auto 1fr;
                        align-items: center;
                        box-sizing: border-box;
                        page-break-inside: avoid;
                    }
                    .copy-section {
                        display: flex;
                        flex-direction: column;
                        justify-content: center;
                        align-items: center;
                        width: 100%;
                        min-height: 0;
                    }
                    .admit-card-copy {
                        display: flex;
                        flex-direction: column;
                        flex: 0 0 auto;
                        width: 100%;
                        page-break-inside: avoid;
                    }
                    .copy-separator {
                        border: none;
                        border-top: 1px dashed #666;
                        margin: 0;
                        flex-shrink: 0;
                        width: 100%;
                        height: 0;
                    }
                    .copy-label {
                        font-size: 12pt;
                        font-weight: 700;
                        margin-bottom: 1mm;
                        text-transform: uppercase;
                        flex-shrink: 0;
                        color: #1e40af;
                        text-align: center;
                        letter-spacing: 0.3mm;
                    }
                    .pass-border {
                        border: 2px solid #000;
                        padding: 2mm;
                        box-sizing: border-box;
                        display: flex;
                        flex-direction: column;
                        gap: 0;
                    }
                    .pass-header {
                        display: flex;
                        align-items: center;
                        gap: 2mm;
                        flex-shrink: 0;
                        margin-bottom: 2.5mm;
                    }
                    .inst-logo {
                        width: 30mm;
                        height: 22mm;
                        object-fit: contain;
                        object-position: left center;
                        flex-shrink: 0;
                    }
                    .header-center {
                        flex: 1;
                        text-align: center;
                    }
                    .inst-name {
                        font-size: 15pt;
                        font-weight: 700;
                        line-height: 1.1;
                        color: #1e3a8a;
                    }
                    .helpline {
                        font-size: 10pt;
                        font-weight: 700;
                        margin-top: 0.6mm;
                        color: #1e40af;
                    }
                    .header-right {
                        flex-shrink: 0;
                        min-width: 48mm;
                        display: flex;
                        flex-direction: column;
                        gap: 0;
                    }
                    .pass-type-banner {
                        background: #4a4a4a;
                        color: #fff;
                        font-size: 8.5pt;
                        font-weight: 700;
                        padding: 1mm 1.5mm;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 1.5mm;
                    }
                    .pass-ay {
                        white-space: nowrap;
                        color: #fde68a;
                    }
                    .validity-banner {
                        background: #d9d9d9;
                        color: #000;
                        font-size: 8pt;
                        font-weight: 600;
                        padding: 1mm 1.5mm;
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 1.5mm;
                    }
                    .valid-till {
                        font-weight: 700;
                        white-space: nowrap;
                        color: #b91c1c;
                    }
                    .pass-content {
                        display: block;
                        margin-top: 0.5mm;
                    }
                    .info-grid {
                        width: 100%;
                        border-collapse: collapse;
                        border-spacing: 0;
                        table-layout: fixed;
                        font-size: 10.5pt;
                    }
                    .info-grid td {
                        border: 1px solid #000;
                        padding: 2mm 2.5mm;
                        vertical-align: middle;
                        line-height: 1.35;
                    }
                    .cell-label {
                        font-weight: 700;
                        width: 30%;
                        background: #f0f4ff;
                        color: #1e3a8a;
                    }
                    .cell-value {
                        font-weight: 500;
                        color: #1f2937;
                    }
                    .cell-highlight {
                        font-weight: 700;
                        color: #1e40af;
                        font-size: 11pt;
                    }
                    .cell-accent {
                        font-weight: 700;
                        color: #0f766e;
                        font-size: 10.5pt;
                    }
                    .cell-photo {
                        width: ${PHOTO_COL_WIDTH};
                        vertical-align: middle;
                        text-align: center;
                        padding: 1.5mm 2.5mm;
                        box-sizing: border-box;
                        background: #fff;
                    }
                    .photo-cell-inner {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        width: 100%;
                        height: 100%;
                        min-height: 44mm;
                    }
                    .photo-frame {
                        border: none;
                        width: 100%;
                        max-width: 38mm;
                        margin: 0 auto;
                        aspect-ratio: 3 / 4;
                        padding: 0;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        overflow: hidden;
                        box-sizing: border-box;
                        background: transparent;
                    }
                    .student-photo {
                        width: 100%;
                        height: 100%;
                        max-width: 100%;
                        max-height: 100%;
                        object-fit: cover;
                        object-position: center top;
                        display: block;
                        margin: 0 auto;
                        box-sizing: border-box;
                    }
                    .photo-placeholder {
                        font-size: 11pt;
                        color: #64748b;
                        font-weight: 700;
                        width: 100%;
                        height: 100%;
                        min-height: 36mm;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        box-sizing: border-box;
                        background: #f8fafc;
                    }
                    .terms-bar-cell {
                        padding: 0;
                        vertical-align: middle;
                    }
                    .terms-bar {
                        background: #808080;
                        color: #fff;
                        font-size: 9pt;
                        font-weight: 600;
                        padding: 1.5mm 2.5mm;
                        display: flex;
                        justify-content: center;
                        align-items: center;
                        flex-wrap: wrap;
                        gap: 1mm 5mm;
                        text-align: center;
                        border: none;
                    }
                    .terms-bar span {
                        text-align: center;
                    }
                    .signature-box {
                        width: ${PHOTO_COL_WIDTH};
                        vertical-align: bottom;
                        text-align: center;
                        padding: 1.2mm;
                        padding-bottom: 1.5mm;
                        box-sizing: border-box;
                        background: #fff;
                        min-height: 15mm;
                    }
                    .signature-label {
                        font-size: 8pt;
                        font-weight: 600;
                        color: #374151;
                    }
                    .notes-section {
                        font-size: 11.5pt;
                        line-height: 1.4;
                        color: #374151;
                        vertical-align: top;
                    }
                    .notes-section .note-heading,
                    .notes-section .note-text {
                        display: inline;
                    }
                    .note-heading {
                        font-weight: 700;
                        color: #b91c1c;
                        font-size: 11.5pt;
                        margin-right: 1mm;
                    }
                    .note-text {
                        font-size: 11.5pt;
                    }
                `}</style>

                <div className="copy-section">
                    <TempBusPassCopy copyLabel="STUDENT COPY" passenger={passenger} />
                </div>
                <hr className="copy-separator" aria-hidden="true" />
                <div className="copy-section">
                    <TempBusPassCopy copyLabel="TRANSPORT OFFICE COPY" passenger={passenger} />
                </div>
            </div>
        </div>
    );
});

export default TransportAdmitCard;
