const { getFeePortalModels } = require('../models/fee-portal-models');

const TRANSPORT_FEE_HEAD_CODE = 'TRN01';

// @desc    Get transport dues (students with transport fee unpaid / partially paid for an academic year)
// @route   GET /api/transport-dues?academicYear=2024-2025
// @access  Private/Admin
const getTransportDues = async (req, res) => {
    const academicYear = req.query.academicYear || null;
    if (!academicYear) {
        return res.status(400).json({ message: 'Query parameter academicYear is required (e.g. 2024-2025).' });
    }

    const models = getFeePortalModels();
    if (!models) {
        return res.status(503).json({
            message: 'Fee Management database is not connected. Set FEE_MONGO_URI and ensure Fee DB is connected.',
        });
    }

    const { FeeHead, StudentFee, Transaction } = models;

    try {
        const transportHead = await FeeHead.findOne({ code: TRANSPORT_FEE_HEAD_CODE });
        if (!transportHead) {
            return res.status(500).json({
                message: `Transport Fee Head (${TRANSPORT_FEE_HEAD_CODE}) not found in Fee Management.`,
            });
        }

        const studentFees = await StudentFee.find({
            feeHead: transportHead._id,
            academicYear: String(academicYear),
            $or: [{ isActive: true }, { isActive: { $exists: false } }],
        }).lean();

        const dues = [];
        for (const sf of studentFees) {
            const paidRows = await Transaction.aggregate([
                {
                    $match: {
                        studentId: String(sf.studentId),
                        feeHead: sf.feeHead,
                        transactionType: 'DEBIT',
                    },
                },
                { $group: { _id: null, total: { $sum: '$amount' } } },
            ]);
            const totalPaid = paidRows[0]?.total ?? 0;
            const amount = Number(sf.amount) || 0;
            const due = Math.max(0, amount - totalPaid);

            dues.push({
                studentId: sf.studentId,
                studentName: sf.studentName || '—',
                academicYear: sf.academicYear,
                feeAmount: amount,
                totalPaid: Number(totalPaid),
                due,
                college: sf.college,
                course: sf.course,
                branch: sf.branch,
                studentYear: sf.studentYear,
            });
        }

        const onlyUnpaid = req.query.onlyUnpaid === 'true' || req.query.onlyUnpaid === '1';
        const list = onlyUnpaid ? dues.filter((d) => d.due > 0) : dues;

        res.json({
            academicYear,
            count: list.length,
            totalDue: list.reduce((s, d) => s + d.due, 0),
            dues: list,
        });
    } catch (error) {
        console.error('Error fetching transport dues:', error);
        res.status(500).json({ message: error.message || 'Failed to fetch transport dues' });
    }
};

module.exports = {
    getTransportDues,
};
