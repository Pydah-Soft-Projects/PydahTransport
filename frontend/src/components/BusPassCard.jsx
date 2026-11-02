import React, { forwardRef } from 'react';

const BusPassCard = forwardRef(({ passenger }, ref) => {
    if (!passenger) return null;

    const {
        student_name,
        employee_name,
        admission_number,
        emp_no,
        user_type,
        course,
        branch,
        department,
        route_name,
        stage_name,
        bus_id,
        student_photo,
        pin_no
    } = passenger;

    const name = student_name || employee_name || 'N/A';
    const admNo = admission_number || emp_no || 'N/A';
    const pinNo = pin_no || 'N/A';
    const type = user_type || 'Student';
    const displayCourse = course || department || 'N/A';
    const displayBranch = branch ? `- ${branch}` : '';

    return (
        <div style={{ position: 'absolute', top: '-9999px', left: '-9999px', overflow: 'hidden' }}>
            <div ref={ref} className="bus-pass-container font-sans text-slate-900">
                <style type="text/css" media="print">
                    {`
                        @page { 
                            size: 85.6mm 54mm; 
                            margin: 0; 
                        }
                        body { 
                            margin: 0; 
                            -webkit-print-color-adjust: exact; 
                        }
                        .bus-pass-card {
                            width: 85.6mm;
                            height: 54mm;
                            position: relative;
                            overflow: hidden;
                            background-color: white;
                            border: 1px solid #e2e8f0;
                            box-sizing: border-box;
                            display: flex;
                            flex-direction: column;
                        }
                        .header {
                            background: linear-gradient(135deg, var(--primary, #145A3A) 0%, var(--secondary, #287A50) 100%);
                            color: white;
                            padding: 3mm;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                        }
                        .header-title {
                            font-size: 13pt;
                            font-weight: 800;
                            text-transform: uppercase;
                            letter-spacing: 0.5mm;
                        }
                        .header-subtitle {
                            font-size: 5pt;
                            opacity: 0.9;
                            font-weight: 500;
                        }
                        .content {
                            display: flex;
                            padding: 2mm 3mm;
                            flex: 1;
                            gap: 3mm;
                        }
                        .photo-box {
                            width: 20mm;
                            height: 25mm;
                            border: 0.5mm solid #cbd5e1;
                            background-color: #f8fafc;
                            display: flex;
                            align-items: center;
                            justify-content: center;
                            overflow: hidden;
                            border-radius: 1mm;
                        }
                        .photo-box img {
                            width: 100%;
                            height: 100%;
                            object-fit: cover;
                        }
                        .photo-placeholder {
                            font-size: 6pt;
                            color: #94a3b8;
                            text-align: center;
                            padding: 2mm;
                        }
                        .details {
                            flex: 1;
                            display: flex;
                            flex-direction: column;
                            gap: 0.5mm;
                        }
                        .detail-row {
                            display: flex;
                            flex-direction: column;
                        }
                        .label {
                            font-size: 4.5pt;
                            color: #64748b;
                            text-transform: uppercase;
                            font-weight: 700;
                            line-height: 1;
                        }
                        .value {
                            font-size: 7.5pt;
                            font-weight: 700;
                            color: #1e293b;
                            line-height: 1.1;
                        }
                        .footer {
                            background-color: #f1f5f9;
                            padding: 2mm 3mm;
                            display: flex;
                            justify-content: space-between;
                            align-items: center;
                            border-top: 0.1mm solid #e2e8f0;
                        }
                        .bus-id-badge {
                            background-color: var(--primary, #145A3A);
                            color: white;
                            padding: 0.5mm 2mm;
                            border-radius: 3mm;
                            font-size: 6pt;
                            font-weight: 800;
                        }
                        .type-badge {
                            font-size: 5pt;
                            font-weight: 800;
                            text-transform: uppercase;
                            color: var(--primary, #145A3A);
                        }
                    `}
                </style>

                <div className="bus-pass-card shadow-lg">
                    <div className="header">
                        <div>
                            <div className="header-title">BUS PASS</div>
                            <div className="header-subtitle">Pydah Transport Services</div>
                        </div>
                        <div className="type-badge" style={{color: 'white', background: 'rgba(255,255,255,0.2)', padding: '0.5mm 1.5mm', borderRadius: '1mm'}}>
                            {type}
                        </div>
                    </div>

                    <div className="content">
                        <div className="photo-box">
                            {student_photo ? (
                                <img src={student_photo} alt="Student" />
                            ) : (
                                <div className="photo-placeholder">PHOTO</div>
                            )}
                        </div>
                        <div className="details">
                            <div className="detail-row">
                                <div className="label">Name</div>
                                <div className="value" style={{fontSize: '8pt', color: 'var(--primary, #145A3A)'}}>{name}</div>
                            </div>
                            
                            {type.toLowerCase() === 'employee' ? (
                                <div className="detail-row">
                                    <div className="label">Employee No</div>
                                    <div className="value">{admNo}</div>
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 gap-2">
                                    <div className="detail-row">
                                        <div className="label">Admission No</div>
                                        <div className="value">{admNo}</div>
                                    </div>
                                    <div className="detail-row">
                                        <div className="label">PIN Number</div>
                                        <div className="value">{pinNo}</div>
                                    </div>
                                </div>
                            )}

                            <div className="detail-row">
                                <div className="label">Course / Dept</div>
                                <div className="value" style={{fontSize: '6.5pt'}}>{displayCourse} {displayBranch}</div>
                            </div>
                            <div className="detail-row">
                                <div className="label">Route & Stage</div>
                                <div className="value" style={{fontSize: '6.5pt'}}>{route_name} - {stage_name}</div>
                            </div>
                        </div>
                    </div>

                    <div className="footer">
                        <div style={{fontSize: '4.5pt', color: '#64748b', fontWeight: '700'}}>
                            VALID FOR ACADEMIC SESSION 2025-2026
                        </div>
                        <div className="bus-id-badge">
                            BUS: {bus_id || 'N/A'}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
});

export default BusPassCard;
