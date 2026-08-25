const {
  getEligibilitySettings,
  updateEligibilitySettings,
  listFeeHeads,
  checkStudentRequestEligibility,
} = require('../services/requestEligibilityService');

const serializeSettings = (doc) => ({
  enabled: Boolean(doc.enabled),
  feeHeadId: doc.feeHeadId || '',
  feeHeadCode: doc.feeHeadCode || '',
  feeHeadName: doc.feeHeadName || '',
  minPaidAmount: Number(doc.minPaidAmount) || 0,
  updatedBy: doc.updatedBy || '',
  updatedAt: doc.updatedAt || null,
});

// GET /api/settings/request-eligibility
const getRequestEligibilitySettings = async (req, res) => {
  try {
    const doc = await getEligibilitySettings();
    return res.json(serializeSettings(doc));
  } catch (error) {
    console.error('Error loading request eligibility settings:', error);
    return res.status(500).json({ message: error.message || 'Failed to load settings' });
  }
};

// PUT /api/settings/request-eligibility
const putRequestEligibilitySettings = async (req, res) => {
  try {
    const updatedBy =
      req.user?.employee_name || req.user?.name || req.user?.username || 'admin';

    const { enabled, feeHeadId, feeHeadCode, feeHeadName, minPaidAmount } = req.body || {};

    if (enabled && !String(feeHeadId || '').trim()) {
      return res.status(400).json({ message: 'Select a fee head before enabling this check.' });
    }

    const amount = minPaidAmount !== undefined ? Number(minPaidAmount) : undefined;
    if (amount !== undefined && (!Number.isFinite(amount) || amount < 0)) {
      return res.status(400).json({ message: 'Minimum paid amount must be a non-negative number.' });
    }

    const doc = await updateEligibilitySettings(
      { enabled, feeHeadId, feeHeadCode, feeHeadName, minPaidAmount: amount },
      updatedBy
    );
    return res.json(serializeSettings(doc));
  } catch (error) {
    console.error('Error saving request eligibility settings:', error);
    return res.status(500).json({ message: error.message || 'Failed to save settings' });
  }
};

// GET /api/settings/fee-heads
const getFeeHeads = async (req, res) => {
  try {
    const result = await listFeeHeads();
    if (!result.ok) {
      return res.status(503).json({ message: result.message, feeHeads: [] });
    }
    return res.json({ feeHeads: result.feeHeads });
  } catch (error) {
    console.error('Error listing fee heads:', error);
    return res.status(500).json({ message: error.message || 'Failed to list fee heads' });
  }
};

// GET /api/settings/request-eligibility/check?admission_number=&academic_year=
const checkRequestEligibility = async (req, res) => {
  try {
    const admissionNumber = req.query.admission_number || req.query.admissionNumber;
    const academicYear = req.query.academic_year || req.query.academicYear;
    if (!admissionNumber || !academicYear) {
      return res.status(400).json({
        message: 'admission_number and academic_year are required.',
      });
    }
    const result = await checkStudentRequestEligibility(admissionNumber, academicYear);
    return res.json(result);
  } catch (error) {
    console.error('Error checking request eligibility:', error);
    return res.status(500).json({ message: error.message || 'Failed to check eligibility' });
  }
};

module.exports = {
  getRequestEligibilitySettings,
  putRequestEligibilitySettings,
  getFeeHeads,
  checkRequestEligibility,
};
