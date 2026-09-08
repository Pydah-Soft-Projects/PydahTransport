const InspectionSession = require('../models/InspectionSession');

const getInspectorName = (user) => user?.employee_name || user?.name || user?.username || 'Admin';

const startInspection = async (req, res) => {
    const { academicYear, inspectionDate, busNumber, routeId, routeName, totalCount } = req.body;
    if (!inspectionDate || !busNumber || !routeId) {
        return res.status(400).json({ message: 'inspectionDate, busNumber and routeId are required' });
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
        startedAt: new Date(),
    });

    return res.status(201).json(session);
};

const completeInspection = async (req, res) => {
    const { inspectedCount, totalCount } = req.body;
    const session = await InspectionSession.findOne({ _id: req.params.id, inspectorId: req.user?._id });
    if (!session) return res.status(404).json({ message: 'Inspection session not found' });

    session.completedAt = new Date();
    session.inspectedCount = Math.max(0, Number(inspectedCount) || 0);
    if (totalCount !== undefined) session.totalCount = Math.max(0, Number(totalCount) || 0);
    session.status = 'completed';
    await session.save();
    return res.json(session);
};

const listInspectionSessions = async (req, res) => {
    const filter = {};
    if (req.query.date) filter.inspectionDate = req.query.date;
    if (req.query.academicYear) filter.academicYear = req.query.academicYear;
    const sessions = await InspectionSession.find(filter).sort({ startedAt: -1 }).lean();
    return res.json(sessions);
};

module.exports = { startInspection, completeInspection, listInspectionSessions };
