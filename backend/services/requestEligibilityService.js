const mongoose = require('mongoose');
const RequestEligibilitySetting = require('../models/RequestEligibilitySetting');
const { getFeePortalModels } = require('../models/fee-portal-models');

const SETTINGS_KEY = 'default';

const getAcademicYearDateRange = (academicYear) => {
  const start = Number(String(academicYear || '').split('-')[0]);
  if (!Number.isFinite(start)) return null;
  // June (month 5) startYear → end of May next year
  return {
    from: new Date(start, 5, 1, 0, 0, 0, 0),
    to: new Date(start + 1, 4, 31, 23, 59, 59, 999),
  };
};

const getEligibilitySettings = async () => {
  let doc = await RequestEligibilitySetting.findOne({ key: SETTINGS_KEY });
  if (!doc) {
    doc = await RequestEligibilitySetting.create({ key: SETTINGS_KEY, enabled: false });
  }
  return doc;
};

const updateEligibilitySettings = async (payload = {}, updatedBy = '') => {
  const updates = {
    updatedBy: updatedBy || '',
  };

  if (typeof payload.enabled === 'boolean') {
    updates.enabled = payload.enabled;
  }
  if (payload.feeHeadId !== undefined) {
    updates.feeHeadId = String(payload.feeHeadId || '').trim();
  }
  if (payload.feeHeadCode !== undefined) {
    updates.feeHeadCode = String(payload.feeHeadCode || '').trim();
  }
  if (payload.feeHeadName !== undefined) {
    updates.feeHeadName = String(payload.feeHeadName || '').trim();
  }
  if (payload.minPaidAmount !== undefined) {
    const amount = Number(payload.minPaidAmount);
    updates.minPaidAmount = Number.isFinite(amount) && amount >= 0 ? amount : 0;
  }

  const doc = await RequestEligibilitySetting.findOneAndUpdate(
    { key: SETTINGS_KEY },
    { $set: updates },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  );
  return doc;
};

const listFeeHeads = async () => {
  const models = getFeePortalModels();
  if (!models) {
    return { ok: false, message: 'Fee Management database is not connected.', feeHeads: [] };
  }
  const { FeeHead } = models;
  const feeHeads = await FeeHead.find({}).sort({ name: 1 }).lean();
  return {
    ok: true,
    feeHeads: feeHeads.map((h) => ({
      id: String(h._id),
      name: h.name || '',
      code: h.code || '',
      description: h.description || '',
    })),
  };
};

/**
 * Sum DEBIT payments for a student + fee head scoped to an academic year.
 * Prefers StudentFee.studentYear match; also includes payments whose date falls in the AY window.
 */
const getPaidAmountForFeeHead = async ({
  Transaction,
  StudentFee,
  studentId,
  feeHeadObjectId,
  academicYear,
}) => {
  const admission = String(studentId || '').trim();
  if (!admission || !feeHeadObjectId) {
    return { totalPaid: 0, studentYears: [] };
  }

  const fees = await StudentFee.find({
    studentId: admission,
    feeHead: feeHeadObjectId,
    academicYear: String(academicYear),
    $or: [{ isActive: true }, { isActive: { $exists: false } }],
  }).lean();

  const yearVals = [...new Set(
    fees
      .map((f) => f.studentYear)
      .filter((v) => v != null && v !== '')
      .map((v) => String(v))
  )];

  const range = getAcademicYearDateRange(academicYear);
  const orClauses = [];

  if (yearVals.length > 0) {
    orClauses.push({ studentYear: { $in: yearVals } });
    orClauses.push({ studentYear: { $in: yearVals.map((y) => Number(y)).filter((n) => Number.isFinite(n)) } });
  }
  if (range) {
    orClauses.push({ paymentDate: { $gte: range.from, $lte: range.to } });
    orClauses.push({ createdAt: { $gte: range.from, $lte: range.to } });
  }

  const match = {
    studentId: admission,
    feeHead: feeHeadObjectId,
    transactionType: 'DEBIT',
  };
  if (orClauses.length > 0) {
    match.$or = orClauses;
  }

  const paidRows = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]);

  return {
    totalPaid: Number(paidRows[0]?.total ?? 0),
    studentYears: yearVals,
    feeRecords: fees.length,
  };
};

/**
 * Check whether a student may raise/renew a transport request for an academic year.
 * Employees are always allowed (caller should skip). When settings disabled → allowed.
 */
const checkStudentRequestEligibility = async (admissionNumber, academicYear) => {
  const settings = await getEligibilitySettings();
  const base = {
    enabled: Boolean(settings.enabled),
    feeHeadId: settings.feeHeadId || '',
    feeHeadCode: settings.feeHeadCode || '',
    feeHeadName: settings.feeHeadName || '',
    minPaidAmount: Number(settings.minPaidAmount) || 0,
    academicYear: String(academicYear || ''),
    admissionNumber: String(admissionNumber || '').trim(),
  };

  if (!settings.enabled) {
    return {
      ok: true,
      eligible: true,
      skipped: true,
      reason: 'disabled',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: 0,
    };
  }

  if (!base.feeHeadId) {
    return {
      ok: false,
      eligible: false,
      reason: 'settings_incomplete',
      message: 'Request eligibility is enabled but no fee head is configured in Settings.',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: base.minPaidAmount,
    };
  }

  if (!base.admissionNumber || !base.academicYear) {
    return {
      ok: false,
      eligible: false,
      reason: 'missing_input',
      message: 'Admission number and academic year are required for fee eligibility check.',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: base.minPaidAmount,
    };
  }

  const models = getFeePortalModels();
  if (!models) {
    return {
      ok: false,
      eligible: false,
      reason: 'fee_db_unavailable',
      message: 'Fee Management database is not connected. Cannot verify fee payment eligibility.',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: base.minPaidAmount,
    };
  }

  const { FeeHead, StudentFee, Transaction } = models;
  if (!mongoose.Types.ObjectId.isValid(base.feeHeadId)) {
    return {
      ok: false,
      eligible: false,
      reason: 'invalid_fee_head',
      message: 'Configured fee head is invalid. Update it in Settings.',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: base.minPaidAmount,
    };
  }

  const feeHeadObjectId = new mongoose.Types.ObjectId(base.feeHeadId);
  const feeHead = await FeeHead.findById(feeHeadObjectId).lean();
  if (!feeHead) {
    return {
      ok: false,
      eligible: false,
      reason: 'fee_head_missing',
      message: 'Configured fee head was not found in Fee Management. Update it in Settings.',
      ...base,
      totalPaid: 0,
      minimumAmount: base.minPaidAmount,
      paidAmount: 0,
      balanceAmount: base.minPaidAmount,
    };
  }

  const paidInfo = await getPaidAmountForFeeHead({
    Transaction,
    StudentFee,
    studentId: base.admissionNumber,
    feeHeadObjectId,
    academicYear: base.academicYear,
  });

  const totalPaid = paidInfo.totalPaid;
  const minPaidAmount = base.minPaidAmount;
  const feeLabel = feeHead.name || base.feeHeadName || base.feeHeadCode || 'selected fee head';
  const balance = Math.max(0, minPaidAmount - totalPaid);

  if (totalPaid + 1e-9 < minPaidAmount) {
    return {
      ok: false,
      eligible: false,
      reason: 'insufficient_payment',
      message: `Minimum transport fee of ₹${minPaidAmount.toLocaleString('en-IN')} required for ${base.academicYear}. Paid: ₹${totalPaid.toLocaleString('en-IN')}. Balance: ₹${balance.toLocaleString('en-IN')}.`,
      ...base,
      feeHeadName: feeHead.name || base.feeHeadName,
      feeHeadCode: feeHead.code || base.feeHeadCode,
      totalPaid,
      minimumAmount: minPaidAmount,
      paidAmount: totalPaid,
      balanceAmount: balance,
      shortfall: balance,
    };
  }

  return {
    ok: true,
    eligible: true,
    reason: 'eligible',
    message: `Eligible: paid ₹${totalPaid.toLocaleString('en-IN')} toward ${feeLabel} for ${base.academicYear} (minimum ₹${minPaidAmount.toLocaleString('en-IN')}).`,
    ...base,
    feeHeadName: feeHead.name || base.feeHeadName,
    feeHeadCode: feeHead.code || base.feeHeadCode,
    totalPaid,
    minimumAmount: minPaidAmount,
    paidAmount: totalPaid,
    balanceAmount: 0,
    shortfall: 0,
  };
};

module.exports = {
  getEligibilitySettings,
  updateEligibilitySettings,
  listFeeHeads,
  checkStudentRequestEligibility,
  getPaidAmountForFeeHead,
};
