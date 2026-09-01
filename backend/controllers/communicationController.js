const SmsTemplate = require('../models/SmsTemplate');
const AutoNotificationSetting = require('../models/AutoNotificationSetting');
const AutoNotificationLog = require('../models/AutoNotificationLog');
const { ensureDefaultSettings, AUTO_NOTIFICATION_ACTIONS } = require('../services/autoNotificationService');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const { mysqlPool, getEmployeeConnection } = require('../config/db');
const {
  normalizePhone,
  sendBulkSms,
  sendPersonalizedSms,
  checkBalance,
  isBulkSmsConfigured,
  getBulkSmsConfig,
} = require('../services/bulkSmsService');

const RECIPIENT_PLACEHOLDERS = [
  'name',
  'student_name',
  'employee_name',
  'admission_number',
  'emp_no',
  'route_id',
  'route_name',
  'stage_name',
  'bus_id',
];

const DLT_VAR_REGEX = /\{#\s*var\s*#\}/gi;

const countDltVars = (body = '') => {
  const matches = String(body || '').match(DLT_VAR_REGEX);
  return matches ? matches.length : 0;
};

const applyTemplateParams = (body, params = {}) => {
  let result = String(body || '');
  Object.entries(params).forEach(([key, value]) => {
    const safe = value === null || value === undefined ? '' : String(value);
    result = result.replace(new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'gi'), safe);
  });
  return result;
};

const resolveVarMappings = (varMappings = [], recipientParams = {}, extraParams = {}) => {
  return (Array.isArray(varMappings) ? varMappings : []).map((mapping) => {
    if (!mapping) return '';
    if (mapping.type === 'custom') {
      return mapping.value === null || mapping.value === undefined ? '' : String(mapping.value);
    }
    if (mapping.type === 'field' && mapping.field) {
      const key = String(mapping.field);
      if (Object.prototype.hasOwnProperty.call(recipientParams, key)) {
        return recipientParams[key] == null ? '' : String(recipientParams[key]);
      }
      if (Object.prototype.hasOwnProperty.call(extraParams, key)) {
        return extraParams[key] == null ? '' : String(extraParams[key]);
      }
      return '';
    }
    return '';
  });
};

const applyDltVars = (body, values = []) => {
  let index = 0;
  return String(body || '').replace(DLT_VAR_REGEX, () => {
    const value = values[index];
    index += 1;
    return value === null || value === undefined ? '' : String(value);
  });
};

const hasRecipientPlaceholders = (body) => {
  const text = String(body || '');
  return RECIPIENT_PLACEHOLDERS.some((key) => new RegExp(`\\{\\{\\s*${key}\\s*\\}\\}`, 'i').test(text));
};

const mappingsNeedPersonalization = (varMappings = []) => (
  (Array.isArray(varMappings) ? varMappings : []).some(
    (m) => m && m.type === 'field' && RECIPIENT_PLACEHOLDERS.includes(String(m.field || ''))
  )
);

const fetchStudentPhones = async (admissionNumbers = []) => {
  const map = {};
  if (!mysqlPool || admissionNumbers.length === 0) return map;

  const [rows] = await mysqlPool.query(
    `SELECT admission_number, admission_no, student_mobile, parent_mobile1
     FROM students
     WHERE admission_number IN (?) OR admission_no IN (?)`,
    [admissionNumbers, admissionNumbers]
  );

  for (const row of rows) {
    const phone = normalizePhone(row.student_mobile) || normalizePhone(row.parent_mobile1);
    if (row.admission_number) map[row.admission_number] = phone;
    if (row.admission_no) map[row.admission_no] = phone;
  }
  return map;
};

const fetchEmployeePhones = async (empNos = []) => {
  const map = {};
  const conn = getEmployeeConnection();
  if (!conn || empNos.length === 0) return map;

  const employees = await conn.collection('employees').find({
    emp_no: { $in: empNos },
  }).project({
    emp_no: 1,
    phone_number: 1,
    alt_phone_number: 1,
  }).toArray();

  for (const emp of employees) {
    const phone = normalizePhone(emp.phone_number) || normalizePhone(emp.alt_phone_number);
    if (emp.emp_no) map[String(emp.emp_no)] = phone;
  }
  return map;
};

const buildStudentRecipients = async ({ routeId, busId }) => {
  const filter = { status: 'approved' };
  if (routeId) filter.route_id = String(routeId);
  if (busId) filter.bus_id = String(busId);

  const requests = await TransportRequest.find(filter)
    .select('admission_number student_name route_id route_name stage_name bus_id')
    .lean();

  const admissionNos = requests.map((r) => r.admission_number).filter(Boolean);
  const phoneMap = await fetchStudentPhones(admissionNos);

  return requests.map((r) => {
    const phone = phoneMap[r.admission_number] || null;
    return {
      id: String(r._id),
      type: 'student',
      name: r.student_name || '',
      identifier: r.admission_number || '',
      phone,
      route_id: r.route_id || '',
      route_name: r.route_name || '',
      stage_name: r.stage_name || '',
      bus_id: r.bus_id || '',
      params: {
        name: r.student_name || '',
        student_name: r.student_name || '',
        admission_number: r.admission_number || '',
        route_id: r.route_id || '',
        route_name: r.route_name || '',
        stage_name: r.stage_name || '',
        bus_id: r.bus_id || '',
      },
    };
  });
};

const buildEmployeeRecipients = async ({ routeId, busId }) => {
  const filter = { status: 'approved' };
  if (routeId) filter.route_id = String(routeId);
  if (busId) filter.bus_id = String(busId);

  const requests = await EmployeeTransportRequest.find(filter)
    .select('emp_no employee_name route_id route_name stage_name bus_id')
    .lean();

  const empNos = requests.map((r) => String(r.emp_no)).filter(Boolean);
  const phoneMap = await fetchEmployeePhones(empNos);

  return requests.map((r) => {
    const empNo = String(r.emp_no || '');
    const phone = phoneMap[empNo] || null;
    return {
      id: String(r._id),
      type: 'employee',
      name: r.employee_name || '',
      identifier: empNo,
      phone,
      route_id: r.route_id || '',
      route_name: r.route_name || '',
      stage_name: r.stage_name || '',
      bus_id: r.bus_id || '',
      params: {
        name: r.employee_name || '',
        employee_name: r.employee_name || '',
        emp_no: empNo,
        route_id: r.route_id || '',
        route_name: r.route_name || '',
        stage_name: r.stage_name || '',
        bus_id: r.bus_id || '',
      },
    };
  });
};

const getConfigStatus = async (req, res) => {
  try {
    const cfg = getBulkSmsConfig();
    return res.json({
      success: true,
      configured: isBulkSmsConfigured(),
      senderId: cfg.senderId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getBalance = async (req, res) => {
  try {
    const result = await checkBalance();
    if (!result.success) {
      return res.status(400).json({ success: false, message: result.error });
    }
    return res.json({
      success: true,
      balance: result.balance,
      label: result.label,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const listTemplates = async (req, res) => {
  try {
    const templates = await SmsTemplate.find().sort({ updatedAt: -1 });
    return res.json({ success: true, data: templates });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const createTemplate = async (req, res) => {
  try {
    const { name, body, description, unicode, isActive, dltTemplateId, varMappings = [] } = req.body;
    if (!name || !body) {
      return res.status(400).json({ success: false, message: 'name and body are required' });
    }
    if (!dltTemplateId || !String(dltTemplateId).trim()) {
      return res.status(400).json({ success: false, message: 'DLT Template ID is required' });
    }

    const dltVarCount = countDltVars(body);
    if (dltVarCount > 0) {
      if (!Array.isArray(varMappings) || varMappings.length !== dltVarCount) {
        return res.status(400).json({
          success: false,
          message: `Map all ${dltVarCount} {#var#} variables before saving the template`,
        });
      }
    }

    const template = await SmsTemplate.create({
      name: String(name).trim(),
      dltTemplateId: String(dltTemplateId).trim(),
      body: String(body).trim(),
      description: description ? String(description).trim() : '',
      varMappings: Array.isArray(varMappings) ? varMappings : [],
      unicode: Boolean(unicode),
      isActive: isActive === undefined ? true : Boolean(isActive),
      createdBy: req.user?.username || req.user?.emp_no || null,
    });

    return res.status(201).json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateTemplate = async (req, res) => {
  try {
    const { name, body, description, unicode, isActive, dltTemplateId, varMappings } = req.body;
    const template = await SmsTemplate.findById(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }

    if (name !== undefined) template.name = String(name).trim();
    if (dltTemplateId !== undefined) {
      if (!String(dltTemplateId).trim()) {
        return res.status(400).json({ success: false, message: 'DLT Template ID is required' });
      }
      template.dltTemplateId = String(dltTemplateId).trim();
    }
    if (body !== undefined) template.body = String(body).trim();
    if (description !== undefined) template.description = String(description).trim();
    if (unicode !== undefined) template.unicode = Boolean(unicode);
    if (isActive !== undefined) template.isActive = Boolean(isActive);
    if (varMappings !== undefined) {
      const dltVarCount = countDltVars(template.body);
      if (dltVarCount > 0 && (!Array.isArray(varMappings) || varMappings.length !== dltVarCount)) {
        return res.status(400).json({
          success: false,
          message: `Map all ${dltVarCount} {#var#} variables before saving the template`,
        });
      }
      template.varMappings = Array.isArray(varMappings) ? varMappings : [];
    }

    await template.save();
    return res.json({ success: true, data: template });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const deleteTemplate = async (req, res) => {
  try {
    const template = await SmsTemplate.findByIdAndDelete(req.params.id);
    if (!template) {
      return res.status(404).json({ success: false, message: 'Template not found' });
    }
    return res.json({ success: true, message: 'Template deleted' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const previewRecipients = async (req, res) => {
  try {
    const audience = String(req.query.audience || 'students').toLowerCase();
    const filterBy = String(req.query.filterBy || 'route').toLowerCase();
    const routeId = req.query.routeId || '';
    const busId = req.query.busId || '';

    if (filterBy === 'route' && !routeId) {
      return res.status(400).json({ success: false, message: 'routeId is required for route filter' });
    }
    if (filterBy === 'bus' && !busId) {
      return res.status(400).json({ success: false, message: 'busId is required for bus filter' });
    }

    const recipients = audience === 'employees'
      ? await buildEmployeeRecipients({
          routeId: filterBy === 'route' ? routeId : undefined,
          busId: filterBy === 'bus' ? busId : undefined,
        })
      : await buildStudentRecipients({
          routeId: filterBy === 'route' ? routeId : undefined,
          busId: filterBy === 'bus' ? busId : undefined,
        });

    const withPhone = recipients.filter((r) => r.phone);
    const withoutPhone = recipients.filter((r) => !r.phone);

    return res.json({
      success: true,
      data: {
        total: recipients.length,
        withPhone: withPhone.length,
        withoutPhone: withoutPhone.length,
        recipients,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const sendSms = async (req, res) => {
  try {
    if (!isBulkSmsConfigured()) {
      return res.status(400).json({ success: false, message: 'BulkSMS is not configured' });
    }

    const {
      templateId,
      audience = 'students',
      filterBy = 'route',
      routeId,
      busId,
      selectedIds = [],
      extraParams = {},
      varMappings = [],
    } = req.body;

    if (!templateId) {
      return res.status(400).json({ success: false, message: 'templateId is required' });
    }

    const template = await SmsTemplate.findById(templateId);
    if (!template || !template.isActive) {
      return res.status(404).json({ success: false, message: 'Active template not found' });
    }
    if (!template.dltTemplateId) {
      return res.status(400).json({
        success: false,
        message: 'Selected template has no DLT Template ID. Edit the template and add it before sending.',
      });
    }

    const dltTemplateId = String(template.dltTemplateId).trim();
    const dltVarCount = countDltVars(template.body);
    const savedMappings = Array.isArray(template.varMappings) ? template.varMappings : [];
    const effectiveMappings = (Array.isArray(varMappings) && varMappings.length > 0)
      ? varMappings
      : savedMappings;

    if (dltVarCount > 0) {
      if (!Array.isArray(effectiveMappings) || effectiveMappings.length !== dltVarCount) {
        return res.status(400).json({
          success: false,
          message: `This template has ${dltVarCount} {#var#} placeholders but mappings are incomplete. Edit the template and map all variables.`,
        });
      }
    }

    const recipients = audience === 'employees'
      ? await buildEmployeeRecipients({
          routeId: filterBy === 'route' ? routeId : undefined,
          busId: filterBy === 'bus' ? busId : undefined,
        })
      : await buildStudentRecipients({
          routeId: filterBy === 'route' ? routeId : undefined,
          busId: filterBy === 'bus' ? busId : undefined,
        });

    let targets = recipients.filter((r) => r.phone);
    if (Array.isArray(selectedIds) && selectedIds.length > 0) {
      const selectedSet = new Set(selectedIds.map(String));
      targets = targets.filter((r) => selectedSet.has(String(r.id)));
    }

    if (targets.length === 0) {
      return res.status(400).json({ success: false, message: 'No recipients with valid phone numbers' });
    }

    const buildMessageForRecipient = (recipientParams = {}) => {
      let message = String(template.body || '');
      if (dltVarCount > 0) {
        const values = resolveVarMappings(effectiveMappings, recipientParams, extraParams);
        message = applyDltVars(message, values);
      }
      message = applyTemplateParams(message, { ...extraParams, ...recipientParams });
      return message;
    };

    const needsPersonalization = (
      hasRecipientPlaceholders(template.body)
      || (dltVarCount > 0 && mappingsNeedPersonalization(effectiveMappings))
    );

    if (needsPersonalization || dltVarCount > 0) {
      // DLT vars often differ per student, so send personalized when vars exist
      if (dltVarCount > 0 || needsPersonalization) {
        const items = targets.map((r) => ({
          number: r.phone,
          name: r.name,
          message: buildMessageForRecipient(r.params || {}),
        }));

        // If every message is identical, fall back to bulk for efficiency
        const uniqueBodies = new Set(items.map((i) => i.message));
        if (uniqueBodies.size === 1) {
          const result = await sendBulkSms({
            numbers: items.map((i) => i.number),
            message: items[0].message,
            unicode: template.unicode,
            templateId: dltTemplateId,
          });
          return res.json({
            success: result.success,
            mode: 'bulk',
            sent: result.success ? targets.length : 0,
            failed: result.success ? 0 : targets.length,
            response: result.response || result.error,
            numbers: result.numbers || [],
            preview: items[0].message,
            dltTemplateId,
          });
        }

        const result = await sendPersonalizedSms(items, {
          unicode: template.unicode,
          templateId: dltTemplateId,
        });
        return res.json({
          success: result.success,
          mode: 'personalized',
          sent: result.sent,
          failed: result.failed,
          results: result.results,
          preview: items[0]?.message || null,
          dltTemplateId,
        });
      }
    }

    const message = buildMessageForRecipient({});
    const result = await sendBulkSms({
      numbers: targets.map((r) => r.phone),
      message,
      unicode: template.unicode,
      templateId: dltTemplateId,
    });

    return res.json({
      success: result.success,
      mode: 'bulk',
      sent: result.success ? targets.length : 0,
      failed: result.success ? 0 : targets.length,
      response: result.response || result.error,
      numbers: result.numbers || [],
      preview: message,
      dltTemplateId,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAutoNotificationSettings = async (req, res) => {
  try {
    const settings = await ensureDefaultSettings();
    return res.json({ success: true, data: settings, actions: AUTO_NOTIFICATION_ACTIONS });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const updateAutoNotificationSettings = async (req, res) => {
  try {
    const { settings = [] } = req.body;
    if (!Array.isArray(settings)) {
      return res.status(400).json({ success: false, message: 'settings array is required' });
    }

    for (const item of settings) {
      if (!item.action || !AUTO_NOTIFICATION_ACTIONS.includes(item.action)) continue;

      const update = {
        enabled: Boolean(item.enabled),
        notifyStudents: item.notifyStudents !== false,
        notifyEmployees: item.notifyEmployees !== false,
        templateId: item.templateId || null,
      };

      await AutoNotificationSetting.findOneAndUpdate(
        { action: item.action },
        { $set: update },
        { upsert: true, new: true }
      );
    }

    const refreshed = await ensureDefaultSettings();
    return res.json({ success: true, data: refreshed });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const getAutoNotificationLogs = async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 25));
    const skip = (page - 1) * limit;
    const { action } = req.query;

    const query = {};
    if (action && AUTO_NOTIFICATION_ACTIONS.includes(action)) {
      query.action = action;
    }

    const [logs, total, actionStats, overallStats] = await Promise.all([
      AutoNotificationLog.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      AutoNotificationLog.countDocuments(query),
      AutoNotificationLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: '$action',
            dispatches: { $sum: 1 },
            sentCount: { $sum: '$sentCount' },
            failedCount: { $sum: '$failedCount' },
            noPhoneCount: { $sum: '$noPhoneCount' },
          },
        },
        { $sort: { _id: 1 } },
      ]),
      AutoNotificationLog.aggregate([
        { $match: query },
        {
          $group: {
            _id: null,
            dispatches: { $sum: 1 },
            sentCount: { $sum: '$sentCount' },
            failedCount: { $sum: '$failedCount' },
            noPhoneCount: { $sum: '$noPhoneCount' },
            skippedDispatches: {
              $sum: { $cond: [{ $eq: ['$status', 'skipped'] }, 1, 0] },
            },
          },
        },
      ]),
    ]);

    const stats = {
      dispatches: overallStats[0]?.dispatches || 0,
      sentCount: overallStats[0]?.sentCount || 0,
      failedCount: overallStats[0]?.failedCount || 0,
      noPhoneCount: overallStats[0]?.noPhoneCount || 0,
      skippedDispatches: overallStats[0]?.skippedDispatches || 0,
      byAction: actionStats.map((row) => ({
        action: row._id,
        dispatches: row.dispatches,
        sentCount: row.sentCount,
        failedCount: row.failedCount,
        noPhoneCount: row.noPhoneCount,
      })),
    };

    return res.json({
      success: true,
      data: logs,
      stats,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit) || 1,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getConfigStatus,
  getBalance,
  listTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  previewRecipients,
  sendSms,
  getAutoNotificationSettings,
  updateAutoNotificationSettings,
  getAutoNotificationLogs,
};
