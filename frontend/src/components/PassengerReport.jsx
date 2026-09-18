import React, { forwardRef, useMemo } from 'react';

const compareRouteIds = (left, right) => {
    const idA = (left.routeId || '').toString().trim();
    const idB = (right.routeId || '').toString().trim();

    if (!idA && !idB) return left.routeName.localeCompare(right.routeName);
    if (!idA) return 1;
    if (!idB) return -1;

    return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
};

const getPassengerCourseLabel = (passenger) => {
    if (passenger.user_type === 'employee') {
        return passenger.department || passenger.course || 'Employee';
    }
    return passenger.course || 'Unassigned';
};

const buildCourseStats = (passengerList = []) => {
    const courseMap = passengerList.reduce((acc, passenger) => {
        const course = getPassengerCourseLabel(passenger);
        acc[course] = (acc[course] || 0) + 1;
        return acc;
    }, {});

    return Object.entries(courseMap)
        .map(([course, count]) => ({ course, count }))
        .sort((left, right) => left.course.localeCompare(right.course));
};

const CourseStatsTable = ({ rows, showHeading = true }) => {
    if (!rows.length) return null;

    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const pairs = [];
    for (let index = 0; index < rows.length; index += 2) {
        pairs.push([rows[index], rows[index + 1] || null]);
    }

    return (
        <div className="course-stats-block">
            {showHeading && <h3 className="subsection-heading">Course-Wise Statistics</h3>}
            <table className="report-table course-stats-table">
                <thead>
                    <tr>
                        <th className="course-pair-name">Course</th>
                        <th className="course-pair-count">Count</th>
                        <th className="course-pair-name">Course</th>
                        <th className="course-pair-count">Count</th>
                    </tr>
                </thead>
                <tbody>
                    {pairs.map(([left, right], index) => (
                        <tr key={`${left.course}-${index}`}>
                            <td className="course-pair-name">{left.course}</td>
                            <td className="course-pair-count">{left.count}</td>
                            <td className="course-pair-name">{right?.course || ''}</td>
                            <td className="course-pair-count">{right ? right.count : ''}</td>
                        </tr>
                    ))}
                    <tr className="abstract-total-row">
                        <td colSpan={3}>Total</td>
                        <td className="course-pair-count">{total}</td>
                    </tr>
                </tbody>
            </table>
        </div>
    );
};

const PassengerReport = forwardRef(({
    passengers,
    includeAbstract = false,
    includeDetailed = true,
    occupancyMode = 'live',
    academicYear = '',
    campusName = '',
    isRequestsReport = false,
    assignedBusByRoute = {},
}, ref) => {
    const groupedData = useMemo(() => (passengers || []).reduce((acc, passenger) => {
        const routeName = passenger.route_name || 'Unassigned Route';
        const stageName = passenger.stage_name || 'Unassigned Stage';

        if (!acc[routeName]) acc[routeName] = {};
        if (!acc[routeName][stageName]) acc[routeName][stageName] = [];

        acc[routeName][stageName].push(passenger);
        return acc;
    }, {}), [passengers]);

    const routeSummaries = useMemo(() => {
        const summaries = Object.keys(groupedData).map((routeName) => {
            const stages = groupedData[routeName];
            const stageNames = Object.keys(stages);
            let total = 0;
            let students = 0;
            let employees = 0;
            let routeId = '';

            stageNames.forEach((stageName) => {
                const stagePassengers = stages[stageName];
                total += stagePassengers.length;
                students += stagePassengers.filter((p) => !p.user_type || p.user_type === 'student').length;
                employees += stagePassengers.filter((p) => p.user_type === 'employee').length;
                if (!routeId && stagePassengers[0]?.route_id) {
                    routeId = stagePassengers[0].route_id;
                }
            });

            const assignedBus = assignedBusByRoute[String(routeId || '').trim()] || '—';

            return { routeName, routeId, assignedBus, stageCount: stageNames.length, total, students, employees };
        });

        return summaries.sort(compareRouteIds);
    }, [groupedData, assignedBusByRoute]);

    const sortedRoutes = useMemo(
        () => routeSummaries.map((route) => route.routeName),
        [routeSummaries]
    );

    const grandTotals = useMemo(() => routeSummaries.reduce((acc, route) => ({
        total: acc.total + route.total,
        students: acc.students + route.students,
        employees: acc.employees + route.employees,
        stages: acc.stages + route.stageCount,
    }), { total: 0, students: 0, employees: 0, stages: 0 }), [routeSummaries]);

    const allPassengers = useMemo(() => (passengers || []), [passengers]);

    const studentPassengers = useMemo(() => {
        return allPassengers.filter(p => !p.user_type || p.user_type === 'student');
    }, [allPassengers]);

    const employeePassengers = useMemo(() => {
        return allPassengers.filter(p => p.user_type === 'employee');
    }, [allPassengers]);

    const collegeGroups = useMemo(() => {
        const groups = {};
        studentPassengers.forEach(p => {
            const collegeName = p.college || p.application_college_code || 'Unassigned College';
            if (!groups[collegeName]) groups[collegeName] = [];
            groups[collegeName].push(p);
        });
        return groups;
    }, [studentPassengers]);

    const courseGroups = useMemo(() => {
        const groups = {};
        studentPassengers.forEach(p => {
            const courseName = p.course || p.application_course_code || 'Unassigned Course';
            if (!groups[courseName]) groups[courseName] = [];
            groups[courseName].push(p);
        });
        return groups;
    }, [studentPassengers]);

    const getBaseCourseName = (courseStr = '') => {
        const s = String(courseStr).trim();
        if (!s) return 'Unassigned Course';
        if (/b\.?\s*tech/i.test(s)) return 'B.Tech';
        if (/diploma/i.test(s)) return 'Diploma';
        if (/b\.?\s*pharm/i.test(s)) return 'B.Pharmacy';
        if (/m\.?\s*tech/i.test(s)) return 'M.Tech';
        if (/mba/i.test(s)) return 'MBA';
        if (/mca/i.test(s)) return 'MCA';
        if (/degree/i.test(s)) return 'Degree';
        return s;
    };

    const mainCourseGroups = useMemo(() => {
        const groups = {};
        studentPassengers.forEach(p => {
            const rawCourse = p.course || p.application_course_code || 'Unassigned Course';
            const baseName = getBaseCourseName(rawCourse);
            if (!groups[baseName]) {
                groups[baseName] = {
                    students: [],
                    subCourses: {}
                };
            }
            groups[baseName].students.push(p);

            if (!groups[baseName].subCourses[rawCourse]) {
                groups[baseName].subCourses[rawCourse] = [];
            }
            groups[baseName].subCourses[rawCourse].push(p);
        });
        return groups;
    }, [studentPassengers]);

    const isUsingBusPass = (p) => {
        const st = (p.status || '').toLowerCase();
        return st === 'approved' || Boolean(p.application_number || p.bus_id);
    };

    const globalCourseStats = useMemo(
        () => buildCourseStats(allPassengers),
        [allPassengers]
    );

    const routeCourseStatsMap = useMemo(() => {
        const map = {};
        sortedRoutes.forEach((routeName) => {
            const stages = groupedData[routeName];
            const routePassengers = Object.values(stages).flat();
            map[routeName] = buildCourseStats(routePassengers);
        });
        return map;
    }, [groupedData, sortedRoutes]);

    const showAbstract = includeAbstract;
    const showDetailed = includeDetailed;
    const abstractOnly = showAbstract && !showDetailed;
    const isLiveReport = occupancyMode === 'live';
    const reportModeLabel = isLiveReport
        ? 'Live Occupancy Report'
        : `Academic Year Report · ${academicYear || 'N/A'}`;
    const reportSubtitle = abstractOnly
        ? 'Route-Wise Abstract Summary'
        : showAbstract && showDetailed
            ? 'Route-Wise Abstract & Detailed Breakdown'
            : 'Stage-Wise Passenger Breakdown';

    return (
        <div id="printable-passenger-report" ref={ref} className="print-container">
            <style type="text/css">
                {`
                    @page { size: portrait; margin: 8mm; }
                    #printable-passenger-report {
                        font-family: 'Inter', 'Segoe UI', Arial, sans-serif;
                        font-size: 8px;
                        line-height: 1.25;
                        color: #000;
                        background: #fff;
                        width: 100%;
                        max-width: 100%;
                        margin: 0;
                        padding: 6mm 4mm;
                        box-sizing: border-box;
                    }
                    .report-title {
                        text-align: center;
                        margin: 0 0 8px 0;
                        padding-bottom: 6px;
                        border-bottom: 1px solid #000;
                    }
                    .report-title h1 {
                        margin: 0;
                        font-size: 13px;
                        font-weight: 700;
                        letter-spacing: 0.02em;
                        text-transform: uppercase;
                        color: #000;
                    }
                    .report-title p {
                        margin: 3px 0 0 0;
                        font-size: 7px;
                        font-weight: 600;
                        color: #000;
                    }
                    .section-heading {
                        margin: 0 0 6px 0;
                        font-size: 9px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                        color: #000;
                    }
                    .subsection-heading {
                        margin: 8px 0 4px 0;
                        font-size: 8px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.03em;
                        color: #000;
                    }
                    .report-mode-label {
                        display: inline-block;
                        margin-top: 4px;
                        font-size: 8px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.04em;
                    }
                    .abstract-section { margin-bottom: 10px; }
                    .course-stats-block { margin-bottom: 6px; }
                    .course-stats-table { margin-bottom: 4px; }
                    .route-block { margin-bottom: 10px; }
                    .page-break { page-break-after: always; }
                    .no-break { page-break-inside: avoid; }
                    .route-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 8px;
                        padding: 4px 0;
                        margin-bottom: 6px;
                        border-bottom: 1px solid #000;
                    }
                    .route-header h2 {
                        margin: 0;
                        font-size: 9px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.02em;
                        color: #000;
                        display: flex;
                        align-items: center;
                        gap: 6px;
                        flex-wrap: wrap;
                    }
                    .route-number {
                        font-family: ui-monospace, monospace;
                        font-size: 8px;
                        font-weight: 700;
                    }
                    .route-id {
                        font-family: ui-monospace, monospace;
                        font-size: 8px;
                        font-weight: 700;
                    }
                    .route-name {
                        font-size: 9px;
                        font-weight: 700;
                    }
                    .route-bus {
                        font-family: ui-monospace, monospace;
                        font-size: 8px;
                        font-weight: 700;
                    }
                    .route-header .route-stats {
                        font-size: 7px;
                        font-weight: 600;
                        text-transform: uppercase;
                        white-space: nowrap;
                        color: #000;
                    }
                    .stage-block { margin-bottom: 8px; }
                    .stage-header {
                        display: flex;
                        justify-content: space-between;
                        align-items: center;
                        gap: 8px;
                        padding: 2px 0;
                        margin-bottom: 4px;
                    }
                    .stage-header h3 {
                        margin: 0;
                        font-size: 8px;
                        font-weight: 700;
                        color: #000;
                    }
                    .stage-header .stage-stats {
                        font-size: 7px;
                        font-weight: 700;
                        text-transform: uppercase;
                        color: #000;
                        white-space: nowrap;
                    }
                    table.report-table,
                    table.passenger-table {
                        width: 100%;
                        border-collapse: collapse;
                        table-layout: fixed;
                        margin: 0 0 6px 0;
                    }
                    table.route-abstract-table {
                        table-layout: auto !important;
                    }
                    table.report-table th,
                    table.report-table td,
                    table.passenger-table th,
                    table.passenger-table td {
                        border: 1px solid #000;
                        padding: 2px 4px;
                        vertical-align: middle;
                        word-wrap: break-word;
                        overflow-wrap: anywhere;
                    }
                    table.report-table th,
                    table.passenger-table th {
                        background: #d9d9d9;
                        font-size: 7px;
                        font-weight: 700;
                        text-transform: uppercase;
                        color: #000;
                        text-align: center;
                    }
                    table.report-table td,
                    table.passenger-table td {
                        font-size: 7.5px;
                        color: #000;
                        background: #fff;
                    }
                    .abstract-col-sno { width: 4%; text-align: center; }
                    .abstract-col-route { width: 42%; text-align: left; font-weight: 600; }
                    .abstract-col-id { width: 6%; text-align: center; font-family: ui-monospace, monospace; font-size: 7px; }
                    .abstract-col-bus { width: 11%; text-align: center; font-family: ui-monospace, monospace; font-size: 7px; }
                    .abstract-col-stages { width: 7%; text-align: center; }
                    .abstract-col-total { width: 10%; text-align: center; font-weight: 700; }
                    .abstract-col-stu { width: 10%; text-align: center; }
                    .abstract-col-emp { width: 10%; text-align: center; }
                    .course-pair-name { width: 38%; text-align: left; font-weight: 600; font-size: 7px; }
                    .course-pair-count { width: 12%; text-align: center; font-weight: 700; font-size: 7px; }
                    .abstract-total-row td {
                        font-weight: 700;
                        font-size: 7.5px;
                        border-top: 2px solid #000;
                    }
                    .col-sno { width: 5%; text-align: center; }
                    .col-name { width: 24%; text-align: left; font-weight: 600; }
                    .col-id { width: 9%; text-align: center; font-family: ui-monospace, monospace; font-size: 7px; }
                    .col-type { width: 7%; text-align: center; }
                    .col-course { width: 15%; text-align: left; }
                    .col-route { width: 40%; text-align: left; }
                    .type-student,
                    .type-employee {
                        color: #000;
                        font-weight: 700;
                        text-transform: uppercase;
                        font-size: 6.5px;
                    }
                    .empty-state {
                        text-align: center;
                        padding: 24px 12px;
                        color: #000;
                        font-size: 8px;
                        font-weight: 700;
                        text-transform: uppercase;
                        letter-spacing: 0.08em;
                        border: 1px dashed #000;
                    }
                    @media print {
                        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; margin: 0; }
                        #printable-passenger-report { padding: 0; }
                    }
                `}
            </style>

            <div className="report-title">
                <h1>Transport Passenger Report</h1>
                <p className="report-mode-label">{reportModeLabel}</p>
                <p>
                    {reportSubtitle}
                    {campusName ? ` · Campus: ${campusName}` : ''}
                    {' · Generated '}
                    {new Date().toLocaleDateString('en-IN')}
                </p>
            </div>


            {isRequestsReport ? (
                <div className="requests-report-container mt-2">
                    {/* ABSTRACT SUMMARY SECTION */}
                    {showAbstract && (
                        <div className={`abstract-requests-section ${showDetailed ? 'page-break' : ''}`}>
                            {/* 1. College Summary Abstract Table */}
                            <div className="college-section" style={{ marginBottom: '20px' }}>
                                <h2 className="section-heading" style={{ fontSize: '10px', borderBottom: '1.5px solid #000', paddingBottom: '3px', marginBottom: '8px' }}>
                                    College-Wise Students Breakdown
                                </h2>
                                <table className="report-table" style={{ marginBottom: '10px' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '5%', textAlign: 'center' }}>S.No</th>
                                            <th style={{ textAlign: 'left' }}>College / Course Name</th>
                                            <th style={{ width: '13%', textAlign: 'center' }}>Total Students</th>
                                            <th style={{ width: '9%', textAlign: 'center' }}>1st Year</th>
                                            <th style={{ width: '9%', textAlign: 'center' }}>2nd Year</th>
                                            <th style={{ width: '9%', textAlign: 'center' }}>3rd Year</th>
                                            <th style={{ width: '9%', textAlign: 'center' }}>4th Year</th>
                                            <th style={{ width: '16%', textAlign: 'center' }}>Bus Pass Users</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {Object.keys(collegeGroups).sort().map((collegeName, idx) => {
                                            const collegeStudents = collegeGroups[collegeName];
                                            const cY1 = collegeStudents.filter(p => Number(p.year_of_study || 1) === 1).length;
                                            const cY2 = collegeStudents.filter(p => Number(p.year_of_study) === 2).length;
                                            const cY3 = collegeStudents.filter(p => Number(p.year_of_study) === 3).length;
                                            const cY4 = collegeStudents.filter(p => Number(p.year_of_study) === 4).length;
                                            const cBusPass = collegeStudents.filter(isUsingBusPass).length;

                                            const collegeCoursesMap = {};
                                            collegeStudents.forEach(p => {
                                                const courseName = p.course || p.application_course_code || 'Unassigned Course';
                                                if (!collegeCoursesMap[courseName]) collegeCoursesMap[courseName] = [];
                                                collegeCoursesMap[courseName].push(p);
                                            });

                                            return (
                                                <React.Fragment key={collegeName}>
                                                    <tr style={{ background: '#f0f0f0', fontWeight: 'bold' }}>
                                                        <td style={{ textAlign: 'center' }}>{idx + 1}</td>
                                                        <td style={{ textAlign: 'left', fontWeight: 'bold' }}>{collegeName}</td>
                                                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{collegeStudents.length}</td>
                                                        <td style={{ textAlign: 'center' }}>{cY1}</td>
                                                        <td style={{ textAlign: 'center' }}>{cY2}</td>
                                                        <td style={{ textAlign: 'center' }}>{cY3}</td>
                                                        <td style={{ textAlign: 'center' }}>{cY4}</td>
                                                        <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{cBusPass}</td>
                                                    </tr>
                                                    {Object.keys(collegeCoursesMap).sort().map((courseName) => {
                                                        const crsList = collegeCoursesMap[courseName];
                                                        const crsY1 = crsList.filter(p => Number(p.year_of_study || 1) === 1).length;
                                                        const crsY2 = crsList.filter(p => Number(p.year_of_study) === 2).length;
                                                        const crsY3 = crsList.filter(p => Number(p.year_of_study) === 3).length;
                                                        const crsY4 = crsList.filter(p => Number(p.year_of_study) === 4).length;
                                                        const crsBusPass = crsList.filter(isUsingBusPass).length;
                                                        return (
                                                            <tr key={`${collegeName}-${courseName}`}>
                                                                <td></td>
                                                                <td style={{ textAlign: 'left', paddingLeft: '16px', color: '#333' }}>
                                                                    ↳ {courseName}
                                                                </td>
                                                                <td style={{ textAlign: 'center' }}>{crsList.length}</td>
                                                                <td style={{ textAlign: 'center' }}>{crsY1}</td>
                                                                <td style={{ textAlign: 'center' }}>{crsY2}</td>
                                                                <td style={{ textAlign: 'center' }}>{crsY3}</td>
                                                                <td style={{ textAlign: 'center' }}>{crsY4}</td>
                                                                <td style={{ textAlign: 'center' }}>{crsBusPass}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </React.Fragment>
                                            );
                                        })}
                                        <tr className="abstract-total-row">
                                            <td colSpan={2} style={{ textAlign: 'left', fontWeight: 'bold' }}>Total</td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{studentPassengers.length}</td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                {studentPassengers.filter(p => Number(p.year_of_study || 1) === 1).length}
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                {studentPassengers.filter(p => Number(p.year_of_study) === 2).length}
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                {studentPassengers.filter(p => Number(p.year_of_study) === 3).length}
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                {studentPassengers.filter(p => Number(p.year_of_study) === 4).length}
                                            </td>
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                {studentPassengers.filter(isUsingBusPass).length}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* DETAILED STUDENT LISTS SECTION */}
                    {showDetailed && (
                        <div className="detailed-requests-section">
                            {/* Detailed Students List grouped by College */}
                            {Object.keys(collegeGroups).sort().map((collegeName) => {
                                const list = collegeGroups[collegeName];
                                return (
                                    <div key={collegeName} className="no-break" style={{ marginBottom: '10px' }}>
                                        <div style={{ background: '#e6e6e6', padding: '3px 6px', fontWeight: 'bold', fontSize: '8px', border: '1px solid #000', borderBottom: 'none', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>COLLEGE: {collegeName.toUpperCase()}</span>
                                            <span>Total Students: {list.length}</span>
                                        </div>
                                        <table className="passenger-table" style={{ margin: 0 }}>
                                            <thead>
                                                <tr>
                                                    <th className="col-sno">#</th>
                                                    <th className="col-name">Student Name</th>
                                                    <th className="col-id">ID / Adm No</th>
                                                    <th className="col-course">Course & Branch</th>
                                                    <th className="col-route">Route & Stage</th>
                                                    <th style={{ width: '14%', textAlign: 'center' }}>Bus Pass Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {list.map((p, idx) => {
                                                    const hasPass = isUsingBusPass(p);
                                                    return (
                                                        <tr key={p.id || p._id || idx}>
                                                            <td className="col-sno">{idx + 1}</td>
                                                            <td className="col-name">{p.student_name || '—'}</td>
                                                            <td className="col-id">{p.admission_no || p.admission_number || '—'}</td>
                                                            <td className="col-course">
                                                                {p.course || '—'}{p.branch ? ` (${p.branch})` : ''}
                                                            </td>
                                                            <td className="col-route">
                                                                {p.route_name || 'Unassigned'} {p.stage_name ? `• ${p.stage_name}` : ''}
                                                            </td>
                                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                                {hasPass ? 'Active Pass' : (p.status ? p.status.toUpperCase() : 'PENDING')}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}

                            {/* Detailed Students List grouped by Course */}
                            {Object.keys(courseGroups).sort().map((courseName) => {
                                const list = courseGroups[courseName];
                                const y1 = list.filter(p => Number(p.year_of_study || 1) === 1).length;
                                const y2 = list.filter(p => Number(p.year_of_study) === 2).length;
                                const y3 = list.filter(p => Number(p.year_of_study) === 3).length;
                                const y4 = list.filter(p => Number(p.year_of_study) === 4).length;
                                const busPassCount = list.filter(isUsingBusPass).length;
                                return (
                                    <div key={courseName} className="no-break" style={{ marginBottom: '10px' }}>
                                        <div style={{ background: '#e6e6e6', padding: '3px 6px', fontWeight: 'bold', fontSize: '8px', border: '1px solid #000', borderBottom: 'none', display: 'flex', justifyContent: 'space-between' }}>
                                            <span>COURSE: {courseName.toUpperCase()}</span>
                                            <span>Total: {list.length} | 1st Yr: {y1}, 2nd Yr: {y2}, 3rd Yr: {y3}, 4th Yr: {y4} | Bus Pass Users: {busPassCount}</span>
                                        </div>
                                        <table className="passenger-table" style={{ margin: 0 }}>
                                            <thead>
                                                <tr>
                                                    <th className="col-sno">#</th>
                                                    <th className="col-name">Student Name</th>
                                                    <th className="col-id">ID / Adm No</th>
                                                    <th style={{ width: '8%', textAlign: 'center' }}>Year</th>
                                                    <th style={{ width: '20%', textAlign: 'left' }}>College</th>
                                                    <th className="col-route">Route & Stage</th>
                                                    <th style={{ width: '15%', textAlign: 'center' }}>Bus Pass Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {list.map((p, idx) => {
                                                    const hasPass = isUsingBusPass(p);
                                                    return (
                                                        <tr key={p.id || p._id || idx}>
                                                            <td className="col-sno">{idx + 1}</td>
                                                            <td className="col-name">{p.student_name || '—'}</td>
                                                            <td className="col-id">{p.admission_no || p.admission_number || '—'}</td>
                                                            <td style={{ textAlign: 'center' }}>
                                                                {p.year_of_study ? `${p.year_of_study} Yr` : '—'}
                                                            </td>
                                                            <td style={{ textAlign: 'left' }}>{p.college || '—'}</td>
                                                            <td className="col-route">
                                                                {p.route_name || 'Unassigned'} {p.stage_name ? `• ${p.stage_name}` : ''}
                                                            </td>
                                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                                {hasPass ? 'Active Pass' : (p.status ? p.status.toUpperCase() : 'PENDING')}
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>
                                );
                            })}

                            {/* Employee Requests (if any) */}
                            {employeePassengers.length > 0 && (
                                <div className="employee-section" style={{ marginTop: '14px' }}>
                                    <h2 className="section-heading" style={{ fontSize: '10px', borderBottom: '1.5px solid #000', paddingBottom: '3px', marginBottom: '8px' }}>
                                        Employee Transport Requests
                                    </h2>
                                    <table className="passenger-table">
                                        <thead>
                                            <tr>
                                                <th className="col-sno">#</th>
                                                <th className="col-name" style={{ width: '32%' }}>Employee Name</th>
                                                <th className="col-id" style={{ width: '15%' }}>Emp ID</th>
                                                <th style={{ width: '20%' }}>Department</th>
                                                <th className="col-route" style={{ width: '33%' }}>Route & Stage</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employeePassengers.map((p, idx) => (
                                                <tr key={p.id || p._id || idx}>
                                                    <td className="col-sno">{idx + 1}</td>
                                                    <td className="col-name">{p.employee_name || p.student_name || '—'}</td>
                                                    <td className="col-id">{p.emp_no || '—'}</td>
                                                    <td>{p.department || 'Employee'}</td>
                                                    <td className="col-route">
                                                        {p.route_name || 'Unassigned'} {p.stage_name ? `• ${p.stage_name}` : ''}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            ) : (
                <>
                    {showAbstract && (
                        <div className={`abstract-section ${showDetailed ? 'page-break' : ''}`}>
                            {routeSummaries.length === 0 ? (
                                <div className="empty-state">No approved passengers available to report.</div>
                            ) : (
                                <table className="report-table">
                                    <thead>
                                        <tr>
                                            <th className="abstract-col-sno">#</th>
                                            <th className="abstract-col-route">Route Name</th>
                                            <th className="abstract-col-id">Route ID</th>
                                            <th className="abstract-col-bus">Assigned Bus</th>
                                            <th className="abstract-col-stages">Stages</th>
                                            <th className="abstract-col-total">Total</th>
                                            <th className="abstract-col-stu">Students</th>
                                            <th className="abstract-col-emp">Employees</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {routeSummaries.map((route, index) => (
                                            <tr key={route.routeName}>
                                                <td className="abstract-col-sno">{index + 1}</td>
                                                <td className="abstract-col-route">{route.routeName}</td>
                                                <td className="abstract-col-id">{route.routeId || '—'}</td>
                                                <td className="abstract-col-bus">{route.assignedBus || '—'}</td>
                                                <td className="abstract-col-stages">{route.stageCount}</td>
                                                <td className="abstract-col-total">{route.total}</td>
                                                <td className="abstract-col-stu">{route.students}</td>
                                                <td className="abstract-col-emp">{route.employees}</td>
                                            </tr>
                                        ))}
                                        <tr className="abstract-total-row">
                                            <td className="abstract-col-sno" colSpan={4}>Grand Total</td>
                                            <td className="abstract-col-stages">{grandTotals.stages}</td>
                                            <td className="abstract-col-total">{grandTotals.total}</td>
                                            <td className="abstract-col-stu">{grandTotals.students}</td>
                                            <td className="abstract-col-emp">{grandTotals.employees}</td>
                                        </tr>
                                    </tbody>
                                </table>
                            )}

                            <CourseStatsTable rows={globalCourseStats} />
                        </div>
                    )}

                    {showDetailed && sortedRoutes.map((route, rIdx) => {
                        const stages = groupedData[route];
                        const sortedStages = Object.keys(stages).sort();
                        const routeSummary = routeSummaries.find((item) => item.routeName === route);

                        let routeTotal = 0;
                        let routeStudents = 0;
                        let routeEmployees = 0;

                        Object.values(stages).forEach((sp) => {
                            routeTotal += sp.length;
                            routeStudents += sp.filter((p) => !p.user_type || p.user_type === 'student').length;
                            routeEmployees += sp.filter((p) => p.user_type === 'employee').length;
                        });

                        const routeBusIds = [...new Set(
                            Object.values(stages)
                                .flat()
                                .map((passenger) => passenger.bus_id)
                                .filter(Boolean)
                        )].sort();

                        const routePassengers = Object.values(stages).flat();
                        const uniqueCourses = [...new Set(routePassengers.map(p => getPassengerCourseLabel(p)))].sort();

                        return (
                            <div key={route} className={`route-block ${rIdx < sortedRoutes.length - 1 ? 'page-break' : ''}`}>
                                {showAbstract && rIdx === 0 && (
                                    <h2 className="section-heading">Detailed Breakdown</h2>
                                )}
                                <div className="route-header">
                                    <h2>
                                        <span className="route-number">{String(rIdx + 1).padStart(2, '0')}</span>
                                        <span className="route-id">{routeSummary?.routeId || '—'}</span>
                                        <span className="route-name">{route}</span>
                                        {routeBusIds.length > 0 && (
                                            <span className="route-bus">Bus: {routeBusIds.join(', ')}</span>
                                        )}
                                    </h2>
                                    <div className="route-stats">
                                        Total: {routeTotal} | Stu: {routeStudents} | Emp: {routeEmployees}
                                    </div>
                                </div>

                                <table className="report-table route-abstract-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '5%', textAlign: 'center' }}>S.No</th>
                                            <th style={{ width: '25%', textAlign: 'left' }}>Stage</th>
                                            {uniqueCourses.map(course => (
                                                <th key={course}>{course}</th>
                                            ))}
                                            <th style={{ width: '12%', fontWeight: 'bold' }}>Total</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sortedStages.map((stage, sIdx) => {
                                            const stagePassengers = stages[stage] || [];
                                            const stageTotal = stagePassengers.length;

                                            return (
                                                <tr key={stage}>
                                                    <td style={{ textAlign: 'center' }}>{sIdx + 1}</td>
                                                    <td style={{ textAlign: 'left', fontWeight: 'bold' }}>{stage}</td>
                                                    {uniqueCourses.map(course => {
                                                        const count = stagePassengers.filter(p => getPassengerCourseLabel(p) === course).length;
                                                        return (
                                                            <td key={course} style={{ textAlign: 'center' }}>
                                                                {count > 0 ? count : '—'}
                                                            </td>
                                                        );
                                                    })}
                                                    <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{stageTotal}</td>
                                                </tr>
                                            );
                                        })}
                                        {/* Grand Total Row */}
                                        <tr className="abstract-total-row">
                                            <td colSpan={2} style={{ textAlign: 'left', fontWeight: 'bold' }}>Total</td>
                                            {uniqueCourses.map(course => {
                                                const count = routePassengers.filter(p => getPassengerCourseLabel(p) === course).length;
                                                return (
                                                    <td key={course} style={{ textAlign: 'center', fontWeight: 'bold' }}>
                                                        {count}
                                                    </td>
                                                );
                                            })}
                                            <td style={{ textAlign: 'center', fontWeight: 'bold' }}>{routePassengers.length}</td>
                                        </tr>
                                    </tbody>
                                </table>

                                <div style={{ marginTop: '10px', marginBottom: '4px' }}>
                                    <h3 className="subsection-heading">Passenger List</h3>
                                </div>

                                {sortedStages.map((stage) => {
                                    const stagePassengers = stages[stage] || [];
                                    const numStudents = stagePassengers.filter((p) => !p.user_type || p.user_type === 'student').length;
                                    const numEmployees = stagePassengers.filter((p) => p.user_type === 'employee').length;

                                    return (
                                        <div key={stage} className="stage-block no-break">
                                            <div className="stage-header">
                                                <h3>Stage: {stage}</h3>
                                                <div className="stage-stats">
                                                    Total: {stagePassengers.length} | Stu: {numStudents} | Emp: {numEmployees}
                                                </div>
                                            </div>

                                            {stagePassengers.length > 0 && (
                                                <table className="passenger-table" style={{ margin: '0px' }}>
                                                    <thead>
                                                        <tr>
                                                            <th className="col-sno">#</th>
                                                            <th className="col-name">Passenger Name</th>
                                                            <th className="col-id">ID / Admission</th>
                                                            <th className="col-type">Type</th>
                                                            <th className="col-course">Course / Dept</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {(() => {
                                                            const sortedPassengers = [...stagePassengers].sort((a, b) => {
                                                                const typeA = a.user_type === 'employee' ? 1 : 0;
                                                                const typeB = b.user_type === 'employee' ? 1 : 0;
                                                                if (typeA !== typeB) return typeA - typeB;
                                                                return (a.student_name || a.employee_name || '').localeCompare(b.student_name || b.employee_name || '');
                                                            });
                                                            return sortedPassengers.map((p, pIdx) => {
                                                                const isEmp = p.user_type === 'employee';
                                                                return (
                                                                    <tr key={p.id || p._id || pIdx}>
                                                                        <td className="col-sno">{pIdx + 1}</td>
                                                                        <td className="col-name">{p.student_name || p.employee_name || '—'}</td>
                                                                        <td className="col-id">{p.admission_no || p.admission_number || p.emp_no || '—'}</td>
                                                                        <td className="col-type">
                                                                            <span className={isEmp ? 'type-employee' : 'type-student'}>
                                                                                {isEmp ? 'Employee' : 'Student'}
                                                                            </span>
                                                                        </td>
                                                                        <td className="col-course">
                                                                            {isEmp ? '—' : (p.course || '—') + (p.branch ? ` (${p.branch})` : '')}
                                                                        </td>
                                                                    </tr>
                                                                );
                                                            });
                                                        })()}
                                                    </tbody>
                                                </table>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        );
                    })}

                    {!showAbstract && !showDetailed && (
                        <div className="empty-state">No report sections selected.</div>
                    )}

                    {!showAbstract && showDetailed && sortedRoutes.length === 0 && (
                        <div className="empty-state">No approved passengers available to report.</div>
                    )}
                </>
            )}
        </div>
    );
});

export default PassengerReport;
