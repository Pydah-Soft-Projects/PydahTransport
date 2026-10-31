import React, { useState, useEffect, useMemo } from 'react';
import {
    Route as RouteIcon,
    Bus,
    MapPin,
    IndianRupee,
    FileText,
    Download,
    RefreshCw,
    Search,
    Calendar,
    Users,
    CheckCircle2,
    Clock,
    AlertCircle,
    ChevronRight,
    ChevronDown,
    Percent,
    ShieldCheck,
    CreditCard,
    DollarSign,
} from 'lucide-react';
import ExcelJS from 'exceljs';
import Layout from '../components/Layout';
import { apiFetch, API_BASE } from '../utils/api';
import { getDefaultAcademicYear, getAcademicYearOptions } from '../utils/academicYear';
import { printHtmlDocument } from '../utils/printHtml';

const formatCurrency = (val) => `₹${Number(val || 0).toLocaleString('en-IN')}`;

const compareRouteIds = (a, b) => {
    if (a.routeId === 'Unassigned') return 1;
    if (b.routeId === 'Unassigned') return -1;
    const numA = parseInt(String(a.routeId).replace(/\D/g, ''), 10);
    const numB = parseInt(String(b.routeId).replace(/\D/g, ''), 10);
    if (!isNaN(numA) && !isNaN(numB) && numA !== numB) {
        return numA - numB;
    }
    return String(a.routeName || '').localeCompare(String(b.routeName || ''), undefined, { numeric: true });
};

const TableSkeleton = () => (
    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col animate-pulse mb-6">
        <div className="p-4 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <div className="flex items-center gap-2">
                <div className="h-5 w-5 bg-slate-200 rounded-md"></div>
                <div className="space-y-1">
                    <div className="h-4 w-64 bg-slate-200 rounded-lg"></div>
                    <div className="h-3 w-80 bg-slate-150 rounded"></div>
                </div>
            </div>
            <div className="h-7 w-28 bg-slate-200 rounded-full"></div>
        </div>
        <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
                <thead>
                    <tr className="bg-slate-100/90 border-b border-slate-200">
                        <th className="p-3"><div className="h-4 w-36 bg-slate-200 rounded"></div></th>
                        <th className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-16 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-24 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-24 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></th>
                        <th className="p-3"><div className="h-4 w-16 bg-slate-200 rounded mx-auto"></div></th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {[1, 2, 3, 4, 5, 6, 7].map((i) => (
                        <tr key={i} className="border-b border-slate-100">
                            <td className="p-3"><div className="h-4 w-44 bg-slate-200 rounded"></div></td>
                            <td className="p-3"><div className="h-4 w-14 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-12 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-12 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-16 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-20 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-16 bg-slate-200 rounded mx-auto"></div></td>
                            <td className="p-3"><div className="h-4 w-12 bg-slate-200 rounded mx-auto"></div></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    </div>
);

const Reports = () => {
    const [academicYear, setAcademicYear] = useState(() => getDefaultAcademicYear());
    const academicYearOptions = useMemo(() => getAcademicYearOptions(), []);
    const [requests, setRequests] = useState([]);
    const [duesData, setDuesData] = useState({});
    const [routes, setRoutes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [downloadingReport, setDownloadingReport] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRouteFilter, setSelectedRouteFilter] = useState('');
    const [feeStatusFilter, setFeeStatusFilter] = useState('all'); // 'all', 'has_due', 'fully_paid'
    const [expandedRoutes, setExpandedRoutes] = useState(new Set());
    const [routeDetailTab, setRouteDetailTab] = useState({}); // { [routeId]: 'stages' | 'students' }

    const cacheRef = React.useRef(new Map());

    const fetchData = async (forceRefresh = false) => {
        if (!forceRefresh && cacheRef.current.has(academicYear)) {
            const cached = cacheRef.current.get(academicYear);
            setRequests(cached.reqData);
            setDuesData(cached.duesMap);
            setRoutes(cached.routesList);
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            const reqParam = new URLSearchParams();
            if (academicYear) reqParam.append('academicYear', academicYear);

            const [reqRes, duesRes, routesRes] = await Promise.allSettled([
                apiFetch(`${API_BASE}/transport-requests?${reqParam.toString()}`),
                apiFetch(`${API_BASE}/transport-dues?academicYear=${encodeURIComponent(academicYear || '')}`),
                apiFetch(`${API_BASE}/routes${academicYear ? `?academicYear=${encodeURIComponent(academicYear)}` : ''}`),
            ]);

            let reqData = [];
            if (reqRes.status === 'fulfilled' && reqRes.value.ok) {
                reqData = await reqRes.value.json();
            }

            let duesMap = {};
            if (duesRes.status === 'fulfilled' && duesRes.value.ok) {
                const duesJson = await duesRes.value.json().catch(() => ({}));
                if (duesJson && Array.isArray(duesJson.dues)) {
                    duesJson.dues.forEach((d) => {
                        if (d.studentId) {
                            duesMap[String(d.studentId).trim()] = d;
                        }
                    });
                }
            }

            let routesList = [];
            if (routesRes.status === 'fulfilled' && routesRes.value.ok) {
                const rJson = await routesRes.value.json().catch(() => ([]));
                routesList = Array.isArray(rJson) ? rJson : [];
            }

            cacheRef.current.set(academicYear, { reqData, duesMap, routesList });
            setRequests(Array.isArray(reqData) ? reqData : []);
            setDuesData(duesMap);
            setRoutes(routesList);
        } catch (error) {
            console.error('Error fetching Route Wise fee report data:', error);
            setRequests([]);
            setDuesData({});
            setRoutes([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [academicYear]);

    // Aggregate requests route-wise
    const routeReportData = useMemo(() => {
        if (!requests || requests.length === 0) return [];

        const routeMap = new Map();
        const routeMetaMap = new Map();

        routes.forEach((r) => {
            const idKey = String(r.routeId || r._id || '').trim();
            if (idKey) routeMetaMap.set(idKey, r);
        });

        requests.forEach((req) => {
            const rawRouteId = req.route_id || req.routeId || '';
            const routeKey = String(rawRouteId || 'Unassigned').trim();
            const meta = routeMetaMap.get(routeKey);
            const routeName = req.route_name || req.routeName || meta?.routeName || (routeKey === 'Unassigned' ? 'Unassigned Route' : `Route ${routeKey}`);

            if (!routeMap.has(routeKey)) {
                routeMap.set(routeKey, {
                    routeId: routeKey,
                    routeName: routeName,
                    assignedBuses: new Set(),
                    studentCount: 0,
                    employeeCount: 0,
                    totalPassengers: 0,
                    grossFee: 0,
                    concessions: 0,
                    feeToBeCollected: 0,
                    feePaid: 0,
                    feeDue: 0,
                    stagesMap: new Map(),
                    passengers: [],
                });
            }

            const rStat = routeMap.get(routeKey);

            const busNumber = req.bus_id || req.busNumber || meta?.assignedBus || null;
            if (busNumber && busNumber !== '—' && busNumber !== 'null') {
                rStat.assignedBuses.add(String(busNumber).trim());
            }

            const isEmp = req.user_type === 'employee';
            const isExp = (req.status || '').toLowerCase() === 'expired' || (req.status === 'approved' && Boolean(req.is_expired));

            const normalFare = Number(req.original_fare ?? req.fare ?? 0);
            const payableFare = isEmp ? 0 : Number(req.payable_fare ?? normalFare);
            const concession = isEmp ? 0 : Math.max(0, normalFare - payableFare);

            const admNo = String(req.admission_number || req.admission_no || req.emp_no || '').trim();
            const dueInfo = duesData[admNo];

            let paidAmount = 0;
            let dueAmount = payableFare;

            if (dueInfo) {
                paidAmount = Number(dueInfo.totalPaid || 0);
                dueAmount = Number(dueInfo.due ?? Math.max(0, payableFare - paidAmount));
            }

            rStat.totalPassengers += 1;
            if (isEmp) {
                rStat.employeeCount += 1;
            } else {
                rStat.studentCount += 1;
                rStat.grossFee += normalFare;
                rStat.concessions += concession;
                rStat.feeToBeCollected += payableFare;
                rStat.feePaid += paidAmount;
                rStat.feeDue += dueAmount;
            }

            const stageName = req.stage_name || req.stageName || 'General Stage';
            if (!rStat.stagesMap.has(stageName)) {
                const metaStage = meta?.stages?.find((s) => String(s.stageName || s.name || '').trim().toLowerCase() === String(stageName).trim().toLowerCase());
                const stageFare = metaStage?.fare || (normalFare > 0 ? normalFare : 0);
                rStat.stagesMap.set(stageName, {
                    stageName: stageName,
                    standardFare: stageFare,
                    studentCount: 0,
                    employeeCount: 0,
                    feeToBeCollected: 0,
                    feePaid: 0,
                    feeDue: 0,
                });
            } else if (normalFare > 0 && rStat.stagesMap.get(stageName).standardFare === 0) {
                rStat.stagesMap.get(stageName).standardFare = normalFare;
            }
            const stgStat = rStat.stagesMap.get(stageName);
            if (isEmp) {
                stgStat.employeeCount += 1;
            } else {
                stgStat.studentCount += 1;
                stgStat.feeToBeCollected += payableFare;
                stgStat.feePaid += paidAmount;
                stgStat.feeDue += dueAmount;
            }

            rStat.passengers.push({
                id: req.id || req._id,
                admissionNumber: admNo,
                name: req.student_name || req.employee_name || '—',
                userType: isEmp ? 'employee' : 'student',
                college: req.college || '—',
                course: req.course || (isEmp ? 'Staff' : '—'),
                year: req.year_of_study || 1,
                stageName: stageName,
                busId: busNumber || '—',
                normalFare: normalFare,
                concession: concession,
                payableFare: payableFare,
                paidAmount: paidAmount,
                dueAmount: dueAmount,
                status: req.status || 'pending',
                isExpired: isExp,
            });
        });

        const list = Array.from(routeMap.values()).map((r) => ({
            ...r,
            assignedBuses: Array.from(r.assignedBuses),
            stages: Array.from(r.stagesMap.values()).sort((a, b) => b.feeToBeCollected - a.feeToBeCollected),
            passengers: r.passengers.sort((a, b) => b.payableFare - a.payableFare),
        }));

        return list.sort(compareRouteIds);
    }, [requests, duesData, routes]);

    // Filter routes by search query, route dropdown, and fee status
    const filteredRoutes = useMemo(() => {
        let list = routeReportData;

        if (selectedRouteFilter) {
            list = list.filter((r) => r.routeId === selectedRouteFilter);
        }

        if (feeStatusFilter === 'has_due') {
            list = list.filter((r) => r.feeDue > 0);
        } else if (feeStatusFilter === 'fully_paid') {
            list = list.filter((r) => r.feeToBeCollected > 0 && r.feeDue === 0);
        }

        const query = (searchQuery || '').trim().toLowerCase();
        if (!query) return list;

        return list.filter((r) => {
            const matchesRoute =
                (r.routeName || '').toLowerCase().includes(query) ||
                String(r.routeId || '').toLowerCase().includes(query) ||
                r.assignedBuses.some((b) => b.toLowerCase().includes(query));

            const matchesStage = r.stages.some((s) => s.stageName.toLowerCase().includes(query));
            const matchesPassenger = r.passengers.some(
                (p) =>
                    p.name.toLowerCase().includes(query) ||
                    p.admissionNumber.toLowerCase().includes(query) ||
                    p.college.toLowerCase().includes(query)
            );

            return matchesRoute || matchesStage || matchesPassenger;
        });
    }, [routeReportData, selectedRouteFilter, feeStatusFilter, searchQuery]);

    // Grand totals calculation
    const grandTotals = useMemo(() => {
        return filteredRoutes.reduce(
            (acc, r) => ({
                routeCount: acc.routeCount + 1,
                totalPassengers: acc.totalPassengers + r.totalPassengers,
                studentCount: acc.studentCount + r.studentCount,
                employeeCount: acc.employeeCount + r.employeeCount,
                grossFee: acc.grossFee + r.grossFee,
                concessions: acc.concessions + r.concessions,
                feeToBeCollected: acc.feeToBeCollected + r.feeToBeCollected,
                feePaid: acc.feePaid + r.feePaid,
                feeDue: acc.feeDue + r.feeDue,
            }),
            {
                routeCount: 0,
                totalPassengers: 0,
                studentCount: 0,
                employeeCount: 0,
                grossFee: 0,
                concessions: 0,
                feeToBeCollected: 0,
                feePaid: 0,
                feeDue: 0,
            }
        );
    }, [filteredRoutes]);

    const toggleRoute = (routeId) => {
        setExpandedRoutes((prev) => {
            const next = new Set(prev);
            if (next.has(routeId)) next.delete(routeId);
            else next.add(routeId);
            return next;
        });
    };

    const handleExpandAll = () => {
        setExpandedRoutes(new Set(filteredRoutes.map((r) => r.routeId)));
    };

    const handleCollapseAll = () => {
        setExpandedRoutes(new Set());
    };

    const setDetailTab = (routeId, tab) => {
        setRouteDetailTab((prev) => ({ ...prev, [routeId]: tab }));
    };

    // Print Route-Wise Fee Report
    const handlePrintReport = () => {
        if (filteredRoutes.length === 0) return;

        const html = `
            <!DOCTYPE html>
            <html>
            <head>
                <meta charset="utf-8" />
                <title>Route-Wise Transport Fee Report - ${academicYear || 'All'}</title>
                <style>
                    @page { size: landscape; margin: 10mm; }
                    body {
                        font-family: 'Segoe UI', Arial, sans-serif;
                        color: #111;
                        background: #fff;
                        margin: 0;
                        padding: 0;
                        font-size: 11px;
                        line-height: 1.4;
                    }
                    .header {
                        text-align: center;
                        margin-bottom: 16px;
                        padding-bottom: 10px;
                        border-bottom: 2px solid #0f172a;
                    }
                    .header h1 {
                        margin: 0;
                        font-size: 18px;
                        font-weight: 800;
                        text-transform: uppercase;
                        letter-spacing: 0.05em;
                        color: #0f172a;
                    }
                    .header h2 {
                        margin: 4px 0 0 0;
                        font-size: 13px;
                        font-weight: 700;
                        color: #1e3a8a;
                    }
                    .header p {
                        margin: 3px 0 0 0;
                        font-size: 10px;
                        color: #555;
                    }
                    .kpi-row {
                        display: flex;
                        justify-content: space-between;
                        gap: 10px;
                        margin-bottom: 14px;
                    }
                    .kpi-box {
                        flex: 1;
                        padding: 8px 10px;
                        border: 1px solid #cbd5e1;
                        border-radius: 6px;
                        background: #f8fafc;
                        text-align: center;
                    }
                    .kpi-box .lbl {
                        font-size: 9px;
                        font-weight: 700;
                        text-transform: uppercase;
                        color: #64748b;
                    }
                    .kpi-box .val {
                        font-size: 14px;
                        font-weight: 800;
                        color: #0f172a;
                        margin-top: 2px;
                    }
                    .kpi-box.highlight .val {
                        color: #047857;
                    }
                    table {
                        width: 100%;
                        border-collapse: collapse;
                        font-size: 10px;
                        margin-bottom: 16px;
                    }
                    th {
                        background: #1e3a8a;
                        color: #fff;
                        font-weight: 700;
                        text-transform: uppercase;
                        padding: 6px 8px;
                        border: 1px solid #1e3a8a;
                        font-size: 9px;
                    }
                    td {
                        padding: 6px 8px;
                        border: 1px solid #e2e8f0;
                    }
                    tr:nth-child(even) {
                        background: #f8fafc;
                    }
                    .text-right { text-align: right; }
                    .text-center { text-align: center; }
                    .font-bold { font-weight: 700; }
                    .total-row {
                        background: #0f172a !important;
                        color: #fff !important;
                        font-weight: 800;
                        font-size: 10.5px;
                    }
                    .total-row td {
                        border-color: #0f172a;
                    }
                    .footer-signatures {
                        margin-top: 35px;
                        display: flex;
                        justify-content: space-between;
                        text-align: center;
                        font-size: 10px;
                        font-weight: 700;
                    }
                    .sig-block {
                        width: 180px;
                        border-top: 1px solid #000;
                        padding-top: 4px;
                    }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>Pydah Educational Institutions</h1>
                    <h2>Route-Wise Transport Fee Collection Report</h2>
                    <p>Academic Year: ${academicYear || 'All'} · Generated on ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                </div>

                <div class="kpi-row">
                    <div class="kpi-box">
                        <div class="lbl">Total Routes</div>
                        <div class="val">${grandTotals.routeCount}</div>
                    </div>
                    <div class="kpi-box">
                        <div class="lbl">Students</div>
                        <div class="val">${grandTotals.studentCount}</div>
                    </div>
                    <div class="kpi-box">
                        <div class="lbl">Gross Standard Fee</div>
                        <div class="val">${formatCurrency(grandTotals.grossFee)}</div>
                    </div>
                    <div class="kpi-box">
                        <div class="lbl">Concessions Given</div>
                        <div class="val">${formatCurrency(grandTotals.concessions)}</div>
                    </div>
                    <div class="kpi-box highlight">
                        <div class="lbl">Fee to be Collected (Net)</div>
                        <div class="val">${formatCurrency(grandTotals.feeToBeCollected)}</div>
                    </div>
                    <div class="kpi-box">
                        <div class="lbl">Amount Collected</div>
                        <div class="val">${formatCurrency(grandTotals.feePaid)}</div>
                    </div>
                    <div class="kpi-box">
                        <div class="lbl">Pending Balance</div>
                        <div class="val" style="color: #b91c1c;">${formatCurrency(grandTotals.feeDue)}</div>
                    </div>
                </div>

                <table>
                    <thead>
                        <tr>
                            <th>#</th>
                            <th style="text-align: left;">Route Name & ID</th>
                            <th>Assigned Bus</th>
                            <th>Students</th>
                            <th>Staff</th>
                            <th class="text-right">Gross Fee</th>
                            <th class="text-right">Concession</th>
                            <th class="text-right">Fee To Be Collected</th>
                            <th class="text-right">Paid</th>
                            <th class="text-right">Balance Due</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${filteredRoutes.map((r, idx) => `
                            <tr>
                                <td class="text-center">${idx + 1}</td>
                                <td><strong>${r.routeName}</strong> (${r.routeId})</td>
                                <td class="text-center">${r.assignedBuses.join(', ') || '—'}</td>
                                <td class="text-center font-bold">${r.studentCount}</td>
                                <td class="text-center">${r.employeeCount}</td>
                                <td class="text-right">${formatCurrency(r.grossFee)}</td>
                                <td class="text-right" style="color: #c2410c;">${formatCurrency(r.concessions)}</td>
                                <td class="text-right font-bold" style="color: #047857;">${formatCurrency(r.feeToBeCollected)}</td>
                                <td class="text-right">${formatCurrency(r.feePaid)}</td>
                                <td class="text-right font-bold" style="color: ${r.feeDue > 0 ? '#b91c1c' : '#555'};">${formatCurrency(r.feeDue)}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                    <tfoot>
                        <tr class="total-row">
                            <td colspan="3" style="padding-left: 10px;">TOTAL (${filteredRoutes.length} ROUTES)</td>
                            <td class="text-center">${grandTotals.studentCount}</td>
                            <td class="text-center">${grandTotals.employeeCount}</td>
                            <td class="text-right">${formatCurrency(grandTotals.grossFee)}</td>
                            <td class="text-right">${formatCurrency(grandTotals.concessions)}</td>
                            <td class="text-right" style="color: #6ee7b7;">${formatCurrency(grandTotals.feeToBeCollected)}</td>
                            <td class="text-right">${formatCurrency(grandTotals.feePaid)}</td>
                            <td class="text-right" style="color: #fca5a5;">${formatCurrency(grandTotals.feeDue)}</td>
                        </tr>
                    </tfoot>
                </table>

                <div class="footer-signatures">
                    <div class="sig-block">Transport Supervisor</div>
                    <div class="sig-block">Accounts / Fee Officer</div>
                    <div class="sig-block">Principal / Director</div>
                </div>
            </body>
            </html>
        `;

        printHtmlDocument(html, `Route-Wise-Fee-Report-${academicYear || 'All'}`);
    };

    // Export Excel with Route Summary, Stage Breakdown, and Student Roster
    const handleExportExcel = async () => {
        if (filteredRoutes.length === 0) return;
        try {
            const workbook = new ExcelJS.Workbook();

            // Sheet 1: Route-Wise Fee Summary
            const wsSummary = workbook.addWorksheet('Route-Wise Fee Summary');
            wsSummary.columns = [
                { header: 'Route ID', key: 'routeId', width: 14 },
                { header: 'Route Name', key: 'routeName', width: 34 },
                { header: 'Assigned Bus', key: 'bus', width: 18 },
                { header: 'Students', key: 'students', width: 12 },
                { header: 'Staff (Free)', key: 'staff', width: 12 },
                { header: 'Gross Standard Fee', key: 'gross', width: 22 },
                { header: 'Concession Amount', key: 'concession', width: 20 },
                { header: 'Fee To Be Collected (Net)', key: 'toCollect', width: 24 },
                { header: 'Amount Paid', key: 'paid', width: 18 },
                { header: 'Balance Due', key: 'due', width: 18 },
            ];

            const headerRow = wsSummary.getRow(1);
            headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            headerRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E3A8A' },
            };
            headerRow.alignment = { horizontal: 'center', vertical: 'middle' };

            filteredRoutes.forEach((r) => {
                const row = wsSummary.addRow({
                    routeId: r.routeId,
                    routeName: r.routeName,
                    bus: r.assignedBuses.join(', ') || '—',
                    students: r.studentCount,
                    staff: r.employeeCount,
                    gross: r.grossFee,
                    concession: r.concessions,
                    toCollect: r.feeToBeCollected,
                    paid: r.feePaid,
                    due: r.feeDue,
                });
                row.getCell('gross').numFmt = '₹#,##0';
                row.getCell('concession').numFmt = '₹#,##0';
                row.getCell('toCollect').numFmt = '₹#,##0';
                row.getCell('paid').numFmt = '₹#,##0';
                row.getCell('due').numFmt = '₹#,##0';
            });

            const totalRow = wsSummary.addRow({
                routeId: 'TOTAL',
                routeName: `All ${filteredRoutes.length} Routes`,
                bus: '',
                students: grandTotals.studentCount,
                staff: grandTotals.employeeCount,
                gross: grandTotals.grossFee,
                concession: grandTotals.concessions,
                toCollect: grandTotals.feeToBeCollected,
                paid: grandTotals.feePaid,
                due: grandTotals.feeDue,
            });
            totalRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            totalRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF0F172A' },
            };
            totalRow.getCell('gross').numFmt = '₹#,##0';
            totalRow.getCell('concession').numFmt = '₹#,##0';
            totalRow.getCell('toCollect').numFmt = '₹#,##0';
            totalRow.getCell('paid').numFmt = '₹#,##0';
            totalRow.getCell('due').numFmt = '₹#,##0';

            // Sheet 2: Stage-Wise Breakdown
            const wsStages = workbook.addWorksheet('Stage-Wise Breakdown');
            wsStages.columns = [
                { header: 'Route ID', key: 'routeId', width: 14 },
                { header: 'Route Name', key: 'routeName', width: 30 },
                { header: 'Stage Name', key: 'stageName', width: 28 },
                { header: 'Standard Fare', key: 'fare', width: 16 },
                { header: 'Students', key: 'students', width: 12 },
                { header: 'Staff', key: 'staff', width: 10 },
                { header: 'Fee To Be Collected', key: 'toCollect', width: 22 },
                { header: 'Paid', key: 'paid', width: 16 },
                { header: 'Due', key: 'due', width: 16 },
            ];
            const stageHeaderRow = wsStages.getRow(1);
            stageHeaderRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
            stageHeaderRow.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF1E3A8A' },
            };

            filteredRoutes.forEach((r) => {
                r.stages.forEach((stg) => {
                    const row = wsStages.addRow({
                        routeId: r.routeId,
                        routeName: r.routeName,
                        stageName: stg.stageName,
                        fare: stg.standardFare,
                        students: stg.studentCount,
                        staff: stg.employeeCount,
                        toCollect: stg.feeToBeCollected,
                        paid: stg.feePaid,
                        due: stg.feeDue,
                    });
                    row.getCell('fare').numFmt = '₹#,##0';
                    row.getCell('toCollect').numFmt = '₹#,##0';
                    row.getCell('paid').numFmt = '₹#,##0';
                    row.getCell('due').numFmt = '₹#,##0';
                });
            });

            const buffer = await workbook.xlsx.writeBuffer();
            const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
            const url = window.URL.createObjectURL(blob);
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = `Route-Wise-Fee-Collection-Report-${academicYear || 'All'}.xlsx`;
            anchor.click();
            window.URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Error exporting Excel:', err);
            alert('Failed to export Excel.');
        }
    };

    return (
        <Layout>
            {/* Header Section */}
            <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center mb-4 gap-3">
                <div>
                    <div className="flex items-center gap-2">
                        <RouteIcon className="text-blue-900" size={24} />
                        <h2 className="text-xl font-bold text-slate-800 tracking-tight">Route-Wise Fee to be Collected Report</h2>
                    </div>
                    <p className="text-slate-500 text-xs mt-0.5">
                        Route and stage-wise summary of transport fees to be collected, concessions, and outstanding dues.
                    </p>
                </div>
                <div className="flex items-center gap-2 w-full sm:w-auto">
                    <button
                        type="button"
                        onClick={handlePrintReport}
                        disabled={loading || filteredRoutes.length === 0}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white font-bold text-xs hover:bg-emerald-700 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                        <FileText size={14} />
                        <span>Print Report</span>
                    </button>
                    <button
                        type="button"
                        onClick={handleExportExcel}
                        disabled={loading || filteredRoutes.length === 0}
                        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-900 text-white font-bold text-xs hover:bg-blue-800 shadow-xs transition-all active:scale-95 cursor-pointer disabled:opacity-55 disabled:cursor-not-allowed"
                    >
                        <Download size={14} />
                        <span>Export Excel</span>
                    </button>
                    <button
                        type="button"
                        onClick={() => fetchData(true)}
                        disabled={loading}
                        className="p-2 rounded-lg bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 shadow-2xs transition-all active:scale-95 cursor-pointer disabled:opacity-55"
                        title="Refresh Data"
                    >
                        <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                    </button>
                </div>
            </div>

            {/* Quick Stats Cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Fee to be Collected</p>
                        <p className="text-sm sm:text-base font-black text-emerald-700 leading-tight mt-0.5">
                            {formatCurrency(grandTotals.feeToBeCollected)}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Net Receivable</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white flex items-center justify-center shadow-xs shrink-0">
                        <IndianRupee size={16} />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Gross Standard Fee</p>
                        <p className="text-sm sm:text-base font-black text-slate-800 leading-tight mt-0.5">
                            {formatCurrency(grandTotals.grossFee)}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Before Adjustments</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
                        <CreditCard size={16} />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Concessions Given</p>
                        <p className="text-sm sm:text-base font-black text-orange-600 leading-tight mt-0.5">
                            {formatCurrency(grandTotals.concessions)}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Fee Waivers</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-orange-500 text-white flex items-center justify-center shadow-xs shrink-0">
                        <Percent size={16} />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Amount Collected</p>
                        <p className="text-sm sm:text-base font-black text-blue-700 leading-tight mt-0.5">
                            {formatCurrency(grandTotals.feePaid)}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Paid into Fee Portal</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-blue-500 text-white flex items-center justify-center shadow-xs shrink-0">
                        <CheckCircle2 size={16} />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Pending Balance</p>
                        <p className="text-sm sm:text-base font-black text-rose-600 leading-tight mt-0.5">
                            {formatCurrency(grandTotals.feeDue)}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Outstanding Due</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-rose-500 text-white flex items-center justify-center shadow-xs shrink-0">
                        <AlertCircle size={16} />
                    </div>
                </div>

                <div className="bg-white rounded-xl border border-slate-200 p-3 shadow-xs flex items-center justify-between gap-3">
                    <div>
                        <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Total Students</p>
                        <p className="text-sm sm:text-base font-black text-slate-800 leading-tight mt-0.5">
                            {grandTotals.studentCount}
                        </p>
                        <p className="text-[8px] font-semibold text-slate-400 mt-0.5">Across {grandTotals.routeCount} Routes</p>
                    </div>
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white flex items-center justify-center shadow-xs shrink-0">
                        <Users size={16} />
                    </div>
                </div>
            </div>

            {/* Filter Bar */}
            <div className="flex flex-wrap items-center gap-3 mb-4 bg-white p-3 rounded-xl shadow-xs border border-slate-200">
                <div className="flex-1 min-w-[200px] relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Search Route Name, ID, Stage, Bus, Student..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-9 pr-3 py-1.5 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-blue-500/20 text-xs text-slate-800 placeholder-slate-400 font-medium"
                    />
                </div>

                <div className="w-full sm:w-auto min-w-[150px] flex items-center gap-1.5">
                    <RouteIcon size={14} className="text-slate-400 shrink-0" />
                    <select
                        value={selectedRouteFilter}
                        onChange={(e) => setSelectedRouteFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-slate-700 bg-transparent cursor-pointer"
                    >
                        <option value="">All Routes</option>
                        {routeReportData.map((r) => (
                            <option key={r.routeId} value={r.routeId}>
                                {r.routeName} ({r.routeId})
                            </option>
                        ))}
                    </select>
                </div>

                <div className="w-full sm:w-auto min-w-[140px] flex items-center gap-1.5">
                    <IndianRupee size={14} className="text-slate-400 shrink-0" />
                    <select
                        value={feeStatusFilter}
                        onChange={(e) => setFeeStatusFilter(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-slate-700 bg-transparent cursor-pointer"
                    >
                        <option value="all">All Fee Status</option>
                        <option value="has_due">Pending Dues Only</option>
                        <option value="fully_paid">Fully Paid Only</option>
                    </select>
                </div>

                <div className="w-full sm:w-auto min-w-[150px] flex items-center gap-1.5">
                    <Calendar size={14} className="text-slate-400 shrink-0" />
                    <select
                        value={academicYear}
                        onChange={(e) => setAcademicYear(e.target.value)}
                        className="w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:ring-2 focus:ring-blue-500/20 transition-all font-bold text-slate-700 bg-transparent cursor-pointer"
                    >
                        <option value="">All Academic Years</option>
                        {academicYearOptions.map((year) => (
                            <option key={year} value={year}>{year}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Table Content */}
            {loading ? (
                <TableSkeleton />
            ) : filteredRoutes.length === 0 ? (
                <div className="bg-white rounded-xl border border-slate-200 p-12 text-center shadow-xs mb-6">
                    <RouteIcon size={44} className="mx-auto text-slate-300 mb-3" />
                    <h3 className="text-sm font-bold text-slate-800">No route fee records found</h3>
                    <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        {searchQuery
                            ? `No routes match "${searchQuery}".`
                            : 'There are no transport requests with routes recorded for the selected academic year.'}
                    </p>
                    {searchQuery && (
                        <button
                            type="button"
                            onClick={() => setSearchQuery('')}
                            className="mt-3 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs font-bold rounded-lg hover:bg-blue-100 transition-colors cursor-pointer"
                        >
                            Clear Search
                        </button>
                    )}
                </div>
            ) : (
                <div className="space-y-4 mb-6">
                    <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden flex flex-col">
                        <div className="p-4 bg-slate-50 border-b border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-2">
                                <RouteIcon size={18} className="text-blue-900" />
                                <div>
                                    <h4 className="text-sm font-extrabold text-slate-800 uppercase tracking-wider">
                                        Route-Wise Fee to be Collected
                                    </h4>
                                    <p className="text-[11px] text-slate-500">
                                        Click any route row to view stage-wise breakdown and passenger roster
                                    </p>
                                </div>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={expandedRoutes.size === filteredRoutes.length ? handleCollapseAll : handleExpandAll}
                                    className="text-xs font-semibold px-2.5 py-1 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 transition-colors cursor-pointer"
                                >
                                    {expandedRoutes.size === filteredRoutes.length ? 'Collapse All' : 'Expand All'}
                                </button>
                                <span className="text-xs font-bold bg-blue-50 text-blue-900 border border-blue-200 px-3 py-1 rounded-full">
                                    {filteredRoutes.length} Routes
                                </span>
                            </div>
                        </div>

                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-xs">
                                <thead>
                                    <tr className="bg-slate-100/90 text-[10.5px] text-slate-600 uppercase font-bold tracking-wider border-b border-slate-200">
                                        <th className="p-3">Route / Network</th>
                                        <th className="p-3 text-center">Assigned Bus</th>
                                        <th className="p-3 text-center text-blue-900">Students</th>
                                        <th className="p-3 text-center text-slate-500">Staff</th>
                                        <th className="p-3 text-right">Gross Standard Fee</th>
                                        <th className="p-3 text-right text-orange-700">Concession</th>
                                        <th className="p-3 text-right text-emerald-700 font-extrabold">Fee To Be Collected</th>
                                        <th className="p-3 text-right text-blue-700">Paid</th>
                                        <th className="p-3 text-right text-rose-700">Balance Due</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100 font-semibold">
                                    {filteredRoutes.map((r) => {
                                        const isExpanded = expandedRoutes.has(r.routeId);
                                        const activeTab = routeDetailTab[r.routeId] || 'stages';

                                        return (
                                            <React.Fragment key={r.routeId}>
                                                <tr
                                                    onClick={() => toggleRoute(r.routeId)}
                                                    className={`hover:bg-blue-50/60 transition-colors cursor-pointer border-b border-slate-100 ${
                                                        isExpanded ? 'bg-blue-50/50' : ''
                                                    }`}
                                                >
                                                    <td className="p-3">
                                                        <div className="flex items-center gap-2">
                                                            <div
                                                                className={`p-1 rounded-md transition-transform ${
                                                                    isExpanded ? 'bg-blue-100 text-blue-900 rotate-90' : 'bg-slate-100 text-slate-500'
                                                                }`}
                                                            >
                                                                <ChevronRight size={14} />
                                                            </div>
                                                            <div>
                                                                <span className="font-bold text-slate-900 text-xs sm:text-sm">
                                                                    {r.routeName}
                                                                </span>
                                                                <span className="ml-2 text-[10px] font-extrabold bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded border border-slate-200">
                                                                    ID: {r.routeId}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td className="p-3 text-center">
                                                        {r.assignedBuses.length > 0 ? (
                                                            <div className="flex flex-wrap items-center justify-center gap-1">
                                                                {r.assignedBuses.map((bus) => (
                                                                    <span
                                                                        key={bus}
                                                                        className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-800 border border-amber-200 px-1.5 py-0.5 rounded"
                                                                    >
                                                                        <Bus size={10} />
                                                                        {bus}
                                                                    </span>
                                                                ))}
                                                            </div>
                                                        ) : (
                                                            <span className="text-slate-400 text-xs">—</span>
                                                        )}
                                                    </td>
                                                    <td className="p-3 text-center font-bold text-blue-900 text-xs sm:text-sm">
                                                        {r.studentCount}
                                                    </td>
                                                    <td className="p-3 text-center text-slate-500 font-medium text-xs">
                                                        {r.employeeCount}
                                                    </td>
                                                    <td className="p-3 text-right text-slate-700 font-semibold text-xs">
                                                        {formatCurrency(r.grossFee)}
                                                    </td>
                                                    <td className="p-3 text-right text-orange-700 font-bold text-xs">
                                                        {formatCurrency(r.concessions)}
                                                    </td>
                                                    <td className="p-3 text-right text-emerald-700 font-extrabold text-xs sm:text-sm">
                                                        {formatCurrency(r.feeToBeCollected)}
                                                    </td>
                                                    <td className="p-3 text-right text-blue-700 font-bold text-xs">
                                                        {formatCurrency(r.feePaid)}
                                                    </td>
                                                    <td
                                                        className={`p-3 text-right font-extrabold text-xs ${
                                                            r.feeDue > 0 ? 'text-rose-700' : 'text-slate-400'
                                                        }`}
                                                    >
                                                        {formatCurrency(r.feeDue)}
                                                    </td>
                                                </tr>

                                                {/* Expanded Accordion: Stages and Passengers */}
                                                {isExpanded && (
                                                    <tr className="bg-slate-50/90">
                                                        <td colSpan={9} className="p-3 sm:p-4 border-b border-slate-200">
                                                            <div className="bg-white rounded-xl border border-slate-200 shadow-2xs overflow-hidden">
                                                                {/* Accordion Tabs */}
                                                                <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setDetailTab(r.routeId, 'stages');
                                                                            }}
                                                                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                                                activeTab === 'stages'
                                                                                    ? 'bg-blue-900 text-white shadow-xs'
                                                                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                                                            }`}
                                                                        >
                                                                            Stage Breakdown ({r.stages.length})
                                                                        </button>
                                                                        <button
                                                                            type="button"
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setDetailTab(r.routeId, 'students');
                                                                            }}
                                                                            className={`px-3 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                                                                activeTab === 'students'
                                                                                    ? 'bg-blue-900 text-white shadow-xs'
                                                                                    : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-100'
                                                                            }`}
                                                                        >
                                                                            Passenger Roster ({r.passengers.length})
                                                                        </button>
                                                                    </div>
                                                                    <span className="text-[11px] font-bold text-slate-500">
                                                                        {r.routeName} Details
                                                                    </span>
                                                                </div>

                                                                {/* Tab 1: Stage Breakdown */}
                                                                {activeTab === 'stages' && (
                                                                    <div className="overflow-x-auto">
                                                                        <table className="w-full text-left text-xs border-collapse">
                                                                            <thead>
                                                                                <tr className="bg-slate-100/90 text-[10px] uppercase text-slate-700 font-bold border-b border-slate-200">
                                                                                    <th className="p-2.5 pl-4">Stage Name</th>
                                                                                    <th className="p-2.5 text-right">Stage Fare</th>
                                                                                    <th className="p-2.5 text-center text-blue-900">Students</th>
                                                                                    <th className="p-2.5 text-center text-slate-500">Staff</th>
                                                                                    <th className="p-2.5 text-right text-emerald-700 font-bold">Fee To Be Collected</th>
                                                                                    <th className="p-2.5 text-right text-blue-700">Paid</th>
                                                                                    <th className="p-2.5 text-right text-rose-700">Due</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-slate-100 font-semibold">
                                                                                {r.stages.map((stg) => (
                                                                                    <tr key={stg.stageName} className="hover:bg-blue-50/30 transition-colors">
                                                                                        <td className="p-2.5 pl-4 font-bold text-slate-800 flex items-center gap-1.5">
                                                                                            <MapPin size={12} className="text-slate-400" />
                                                                                            {stg.stageName}
                                                                                        </td>
                                                                                        <td className="p-2.5 text-right text-slate-700 font-medium">
                                                                                            {formatCurrency(stg.standardFare)}
                                                                                        </td>
                                                                                        <td className="p-2.5 text-center font-bold text-blue-900">
                                                                                            {stg.studentCount}
                                                                                        </td>
                                                                                        <td className="p-2.5 text-center text-slate-500 font-medium">
                                                                                            {stg.employeeCount}
                                                                                        </td>
                                                                                        <td className="p-2.5 text-right font-extrabold text-emerald-700">
                                                                                            {formatCurrency(stg.feeToBeCollected)}
                                                                                        </td>
                                                                                        <td className="p-2.5 text-right text-blue-700 font-bold">
                                                                                            {formatCurrency(stg.feePaid)}
                                                                                        </td>
                                                                                        <td
                                                                                            className={`p-2.5 text-right font-bold ${
                                                                                                stg.feeDue > 0 ? 'text-rose-700' : 'text-slate-400'
                                                                                            }`}
                                                                                        >
                                                                                            {formatCurrency(stg.feeDue)}
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}

                                                                {/* Tab 2: Passenger Roster */}
                                                                {activeTab === 'students' && (
                                                                    <div className="overflow-x-auto max-h-96">
                                                                        <table className="w-full text-left text-xs border-collapse">
                                                                            <thead className="sticky top-0 bg-slate-100 z-10 shadow-2xs">
                                                                                <tr className="text-[10px] uppercase text-slate-700 font-bold border-b border-slate-200">
                                                                                    <th className="p-2.5 pl-4">Admission No</th>
                                                                                    <th className="p-2.5">Passenger Name</th>
                                                                                    <th className="p-2.5">Type</th>
                                                                                    <th className="p-2.5">College / Course</th>
                                                                                    <th className="p-2.5">Stage</th>
                                                                                    <th className="p-2.5 text-right">Standard Fee</th>
                                                                                    <th className="p-2.5 text-right text-orange-700">Concession</th>
                                                                                    <th className="p-2.5 text-right text-emerald-700 font-bold">To Be Collected</th>
                                                                                    <th className="p-2.5 text-right text-blue-700">Paid</th>
                                                                                    <th className="p-2.5 text-right text-rose-700">Due</th>
                                                                                </tr>
                                                                            </thead>
                                                                            <tbody className="divide-y divide-slate-100 font-semibold">
                                                                                {r.passengers.map((p) => (
                                                                                    <tr key={p.id || p.admissionNumber} className="hover:bg-blue-50/30 transition-colors">
                                                                                        <td className="p-2.5 pl-4 font-mono font-bold text-blue-900">
                                                                                            {p.admissionNumber || '—'}
                                                                                        </td>
                                                                                        <td className="p-2.5 font-bold text-slate-900">
                                                                                            {p.name}
                                                                                        </td>
                                                                                        <td className="p-2.5">
                                                                                            <span
                                                                                                className={`text-[9.5px] font-bold px-1.5 py-0.5 rounded ${
                                                                                                    p.userType === 'employee'
                                                                                                        ? 'bg-amber-100 text-amber-800'
                                                                                                        : 'bg-blue-100 text-blue-800'
                                                                                                }`}
                                                                                            >
                                                                                                {p.userType === 'employee' ? 'Staff' : 'Student'}
                                                                                            </span>
                                                                                        </td>
                                                                                        <td className="p-2.5 text-slate-600">
                                                                                            <div>{p.college}</div>
                                                                                            <div className="text-[10px] text-slate-400">{p.course} {p.userType !== 'employee' ? `(Yr ${p.year})` : ''}</div>
                                                                                        </td>
                                                                                        <td className="p-2.5 text-slate-700">{p.stageName}</td>
                                                                                        <td className="p-2.5 text-right text-slate-600">{formatCurrency(p.normalFare)}</td>
                                                                                        <td className="p-2.5 text-right text-orange-700">{formatCurrency(p.concession)}</td>
                                                                                        <td className="p-2.5 text-right text-emerald-700 font-bold">{formatCurrency(p.payableFare)}</td>
                                                                                        <td className="p-2.5 text-right text-blue-700">{formatCurrency(p.paidAmount)}</td>
                                                                                        <td
                                                                                            className={`p-2.5 text-right font-bold ${
                                                                                                p.dueAmount > 0 ? 'text-rose-700' : 'text-slate-400'
                                                                                            }`}
                                                                                        >
                                                                                            {formatCurrency(p.dueAmount)}
                                                                                        </td>
                                                                                    </tr>
                                                                                ))}
                                                                            </tbody>
                                                                        </table>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </td>
                                                    </tr>
                                                )}
                                            </React.Fragment>
                                        );
                                    })}
                                </tbody>
                                <tfoot>
                                    <tr className="bg-slate-900 text-white font-extrabold text-xs border-t-2 border-slate-300">
                                        <td className="p-3">
                                            <span>TOTAL ({filteredRoutes.length} ROUTES)</span>
                                        </td>
                                        <td className="p-3 text-center">—</td>
                                        <td className="p-3 text-center text-blue-200 font-bold">{grandTotals.studentCount}</td>
                                        <td className="p-3 text-center text-slate-300 font-bold">{grandTotals.employeeCount}</td>
                                        <td className="p-3 text-right text-slate-200">{formatCurrency(grandTotals.grossFee)}</td>
                                        <td className="p-3 text-right text-orange-300">{formatCurrency(grandTotals.concessions)}</td>
                                        <td className="p-3 text-right text-emerald-300 text-sm font-black">{formatCurrency(grandTotals.feeToBeCollected)}</td>
                                        <td className="p-3 text-right text-blue-200 font-bold">{formatCurrency(grandTotals.feePaid)}</td>
                                        <td className="p-3 text-right text-rose-300 font-bold">{formatCurrency(grandTotals.feeDue)}</td>
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>
                </div>
            )}
        </Layout>
    );
};

export default Reports;
