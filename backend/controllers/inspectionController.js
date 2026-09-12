const InspectionSession = require('../models/InspectionSession');

const getInspectorName = (user) => user?.employee_name || user?.name || user?.username || 'Admin';

const autoClosePastOr7PMSessions = async () => {
    try {
        const now = new Date();
        const todayStr = now.toLocaleDateString('en-CA');
        const currentHour = now.getHours();

        await InspectionSession.updateMany(
            { inspectionDate: { $lt: todayStr }, status: 'in_progress' },
            { $set: { status: 'submitted', completedAt: now } }
        );

        if (currentHour >= 19) {
            await InspectionSession.updateMany(
                { inspectionDate: todayStr, status: 'in_progress' },
                { $set: { status: 'submitted', completedAt: now } }
            );
        }
    } catch (err) {
        console.error('Error auto-closing inspection sessions:', err);
    }
};

const startInspection = async (req, res) => {
    const { academicYear, inspectionDate, busNumber, routeId, routeName, totalCount } = req.body;
    if (!inspectionDate || !busNumber || !routeId) {
        return res.status(400).json({ message: 'inspectionDate, busNumber and routeId are required' });
    }

    autoClosePastOr7PMSessions().catch((err) => console.error('Error auto-closing sessions:', err));

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const isAfter7PM = inspectionDate < todayStr || (inspectionDate === todayStr && now.getHours() >= 19);

    let existingSession = await InspectionSession.findOne({
        inspectionDate,
        busNumber: String(busNumber),
        routeId: String(routeId),
        status: 'in_progress',
    }).sort({ startedAt: -1 });

    if (existingSession) {
        if (!isAfter7PM && existingSession.status !== 'submitted') {
            existingSession.status = 'in_progress';
        }
        if (totalCount !== undefined) {
            existingSession.totalCount = Number(totalCount) || 0;
        }
        await existingSession.save();
        return res.json(existingSession);
    }

    const session = await InspectionSession.create({
        inspectorId: req.user?._id || null,
        inspectorName: getInspectorName(req.user),
        inspectorUsername: req.user?.emp_no || req.user?.username || null,
        academicYear: academicYear || null,
        inspectionDate,
        busNumber: String(busNumber),
        routeId: String(routeId),
        routeName: routeName || null,
        totalCount: Number(totalCount) || 0,
        startedAt: now,
        status: isAfter7PM ? 'submitted' : 'in_progress',
        completedAt: isAfter7PM ? now : null,
        scannedPassengers: {},
        inspectedCount: 0,
    });

    return res.status(201).json(session);
};

const completeInspection = async (req, res) => {
    const { inspectedCount, totalCount } = req.body;
    const session = await InspectionSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Inspection session not found' });

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const isPast7PM = session.inspectionDate < todayStr || (session.inspectionDate === todayStr && now.getHours() >= 19);

    session.completedAt = now;
    if (inspectedCount !== undefined) {
        session.inspectedCount = Math.max(0, Number(inspectedCount) || 0);
    } else if (session.scannedPassengers) {
        session.inspectedCount = Object.keys(session.scannedPassengers).length;
    }
    if (totalCount !== undefined) session.totalCount = Math.max(0, Number(totalCount) || 0);
    session.status = isPast7PM ? 'submitted' : 'completed';
    await session.save();
    return res.json(session);
};

const listInspectionSessions = async (req, res) => {
    await autoClosePastOr7PMSessions();

    const filter = {};
    if (req.query.date) filter.inspectionDate = req.query.date;
    if (req.query.academicYear) filter.academicYear = req.query.academicYear;

    const sessions = await InspectionSession.find(filter).sort({ startedAt: -1 }).lean();

    const now = new Date();
    const todayStr = now.toLocaleDateString('en-CA');
    const isPast7PM = now.getHours() >= 19;

    const updatedSessions = sessions.map((s) => {
        const isExpired = s.inspectionDate < todayStr || (s.inspectionDate === todayStr && isPast7PM);
        const scannedCount = s.scannedPassengers && typeof s.scannedPassengers === 'object' ? Object.keys(s.scannedPassengers).length : 0;
        return {
            ...s,
            status: isExpired && s.status === 'in_progress' ? 'submitted' : s.status,
            inspectedCount: Math.max(s.inspectedCount || 0, scannedCount),
        };
    });

    return res.json(updatedSessions);
};

const recordScan = async (req, res) => {
    const { passengerKey, scanRecord, inspectedCount } = req.body;
    const session = await InspectionSession.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Inspection session not found' });

    if (!session.scannedPassengers) session.scannedPassengers = {};
    if (passengerKey && scanRecord) {
        session.scannedPassengers[passengerKey] = scanRecord;
        session.markModified('scannedPassengers');
    }
    const sessionScannedCount = Object.keys(session.scannedPassengers).length;
    if (inspectedCount !== undefined) {
        session.inspectedCount = Math.max(sessionScannedCount, Number(inspectedCount) || 0);
    } else {
        session.inspectedCount = sessionScannedCount;
    }
    await session.save();
    return res.json(session);
};

module.exports = { startInspection, completeInspection, listInspectionSessions, recordScan };

