const SmsTemplate = require('../models/SmsTemplate');
const AutoNotificationSetting = require('../models/AutoNotificationSetting');
const TransportRequest = require('../models/TransportRequest');
const EmployeeTransportRequest = require('../models/EmployeeTransportRequest');
const { mysqlPool, getEmployeeConnection } = require('../config/db');
const {
  normalizePhone,
  sendBulkSms,
  sendPersonalizedSms,
  isBulkSmsConfigured,
} = require('./bulkSmsService');

const DLT_VAR_REGEX = /\{#\s*var\s*#\}/gi;

const RECIPIENT_PLACEHOLDERS = [
  'name', 'student_name', 'employee_name',
  'admission_number', 'emp_no',
  'route_id', 'route_name', 'stage_name', 'bus_id',
  'old_route_id', 'new_route_id',
  'old_route_name', 'new_route_name',
  'old_stage_name', 'new_stage_name',
  'old_bus_id', 'new_bus_id',
];

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
  }).project({ emp_no: 1, phone_number: 1, alt_phone_number: 1 }).toArray();
  for (const emp of employees) {
    const phone = normalizePhone(emp.phone_number) || normalizePhone(emp.alt_phone_number);
    if (emp.emp_no) map[String(emp.emp_no)] = phone;
  }
  return map;
};

const DEFAULT_SETTINGS = AutoNotificationSetting.AUTO_NOTIFICATION_ACTIONS.map((action) => ({
  action,
  enabled: false,
  templateId: null,
  notifyStudents: true,
  notifyEmployees: true,
}));

const ensureDefaultSettings = async () => {
  const existing = await AutoNotificationSetting.find().lean();
  const existingActions = new Set(existing.map((s) => s.action));
  const toCreate = DEFAULT_SETTINGS.filter((s) => !existingActions.has(s.action));
  if (toCreate.length > 0) {
    await AutoNotificationSetting.insertMany(toCreate);
  }
  return AutoNotificationSetting.find()
    .populate('templateId', 'name dltTemplateId body description isActive varMappings unicode')
    .sort({ action: 1 })
    .lean();
};

const buildParams = (base = {}, extra = {}) => ({
  ...extra,
  ...base,
  name: base.name || base.student_name || base.employee_name || '',
  student_name: base.student_name || base.name || '',
  employee_name: base.employee_name || base.name || '',
});

const buildRecipientsFromLists = async ({
  students = [],
  employees = [],
  extraParams = {},
}) => {
  const studentIds = students.map((s) => s.admissionNumber || s.admission_number).filter(Boolean);
  const empNos = employees.map((e) => String(e.admissionNumber || e.emp_no || '')).filter(Boolean);
  const [studentPhoneMap, employeePhoneMap] = await Promise.all([
    fetchStudentPhones(studentIds),
    fetchEmployeePhones(empNos),
  ]);

  const recipients = [];

  students.forEach((s) => {
    const adm = String(s.admissionNumber || s.admission_number || '').trim();
    const params = buildParams({
      name: s.name || s.student_name || '',
      student_name: s.name || s.student_name || '',
      admission_number: adm,
      route_id: s.route_id || s.new_route_id || extraParams.new_route_id || '',
      route_name: s.route_name || s.new_route_name || extraParams.new_route_name || '',
      stage_name: s.stage_name || s.new_stage_name || extraParams.new_stage_name || '',
      bus_id: s.bus_id || s.new_bus_id || extraParams.new_bus_id || '',
      old_route_id: s.old_route_id || extraParams.old_route_id || '',
      new_route_id: s.new_route_id || extraParams.new_route_id || '',
      old_route_name: s.old_route_name || extraParams.old_route_name || '',
      new_route_name: s.new_route_name || extraParams.new_route_name || '',
      old_stage_name: s.old_stage_name || extraParams.old_stage_name || '',
      new_stage_name: s.new_stage_name || extraParams.new_stage_name || '',
      old_bus_id: s.old_bus_id || extraParams.old_bus_id || '',
      new_bus_id: s.new_bus_id || extraParams.new_bus_id || '',
    }, extraParams);

    recipients.push({
      type: 'student',
      name: params.name,
      phone: studentPhoneMap[adm] || null,
      params,
    });
  });

  employees.forEach((e) => {
    const empNo = String(e.admissionNumber || e.emp_no || '').trim();
    const params = buildParams({
      name: e.name || e.employee_name || '',
      employee_name: e.name || e.employee_name || '',
      emp_no: empNo,
      route_id: e.route_id || e.new_route_id || extraParams.new_route_id || '',
      route_name: e.route_name || e.new_route_name || extraParams.new_route_name || '',
      stage_name: e.stage_name || e.new_stage_name || extraParams.new_stage_name || '',
      bus_id: e.bus_id || e.new_bus_id || extraParams.new_bus_id || '',
      old_route_id: e.old_route_id || extraParams.old_route_id || '',
      new_route_id: e.new_route_id || extraParams.new_route_id || '',
      old_route_name: e.old_route_name || extraParams.old_route_name || '',
      new_route_name: e.new_route_name || extraParams.new_route_name || '',
      old_stage_name: e.old_stage_name || extraParams.old_stage_name || '',
      new_stage_name: e.new_stage_name || extraParams.new_stage_name || '',
      old_bus_id: e.old_bus_id || extraParams.old_bus_id || '',
      new_bus_id: e.new_bus_id || extraParams.new_bus_id || '',
    }, extraParams);

    recipients.push({
      type: 'employee',
      name: params.name,
      phone: employeePhoneMap[empNo] || null,
      params,
    });
  });

  return recipients;
};

const sendToRecipients = async (template, recipients, extraParams = {}) => {
  try {
    if (!isBulkSmsConfigured()) {
      return { success: false, skipped: true, reason: 'BulkSMS not configured', sent: 0, failed: 0 };
    }

    const targets = recipients.filter((r) => r.phone);
    if (targets.length === 0) {
      return { success: true, skipped: true, reason: 'No recipients with phone numbers', sent: 0, failed: 0, noPhone: recipients.length };
    }

    const dltTemplateId = String(template.dltTemplateId).trim();
    const dltVarCount = countDltVars(template.body);
    const effectiveMappings = Array.isArray(template.varMappings) ? template.varMappings : [];

    const buildMessageForRecipient = (recipientParams = {}) => {
      let message = String(template.body || '');
      if (dltVarCount > 0) {
        const values = resolveVarMappings(effectiveMappings, recipientParams, extraParams);
        message = applyDltVars(message, values);
      }
      return applyTemplateParams(message, { ...extraParams, ...recipientParams });
    };

    const needsPersonalization = dltVarCount > 0 || mappingsNeedPersonalization(effectiveMappings);

    if (needsPersonalization) {
      const items = targets.map((r) => ({
        number: r.phone,
        name: r.name,
        message: buildMessageForRecipient(r.params || {}),
      }));

      const uniqueBodies = new Set(items.map((i) => i.message));
      if (uniqueBodies.size === 1) {
        const result = await sendBulkSms({
          numbers: items.map((i) => i.number),
          message: items[0].message,
          unicode: template.unicode,
          templateId: dltTemplateId,
        });
        return {
          success: result.success,
          sent: result.success ? targets.length : 0,
          failed: result.success ? 0 : targets.length,
          mode: 'bulk',
        };
      }

      const result = await sendPersonalizedSms(items, {
        unicode: template.unicode,
        templateId: dltTemplateId,
      });
      return {
        success: result.success,
        sent: result.sent || 0,
        failed: result.failed || 0,
        mode: 'personalized',
      };
    }

    const message = buildMessageForRecipient({});
    const result = await sendBulkSms({
      numbers: targets.map((r) => r.phone),
      message,
      unicode: template.unicode,
      templateId: dltTemplateId,
    });
    return {
      success: result.success,
      sent: result.success ? targets.length : 0,
      failed: result.success ? 0 : targets.length,
      mode: 'bulk',
    };
  } catch (err) {
    console.error('[AutoNotify] sendToRecipients error:', err.message);
    return { success: false, skipped: true, reason: err.message, sent: 0, failed: 0 };
  }
};

/**
 * Trigger auto SMS for a configured action.
 * Action succeeds even if SMS fails — result is logged only.
 */
const triggerAutoNotification = async (action, {
  students = [],
  employees = [],
  extraParams = {},
} = {}) => {
  try {
    const setting = await AutoNotificationSetting.findOne({ action }).lean();
    if (!setting || !setting.enabled || !setting.templateId) {
      return { skipped: true, reason: 'Auto notification disabled or no template' };
    }

    const template = await SmsTemplate.findById(setting.templateId).lean();
    if (!template || !template.isActive || !template.dltTemplateId) {
      return { skipped: true, reason: 'Template missing or inactive' };
    }

    const filteredStudents = setting.notifyStudents !== false ? students : [];
    const filteredEmployees = setting.notifyEmployees !== false ? employees : [];

    const recipients = await buildRecipientsFromLists({
      students: filteredStudents,
      employees: filteredEmployees,
      extraParams,
    });

    const result = await sendToRecipients(template, recipients, extraParams);
    console.log(`[AutoNotify:${action}] sent=${result.sent || 0} failed=${result.failed || 0} skipped=${Boolean(result.skipped)}`);
    return result;
  } catch (err) {
    console.error(`[AutoNotify:${action}] error:`, err.message);
    return { success: false, error: err.message, sent: 0, failed: 0 };
  }
};

/** Notify passengers on given route IDs after bus mapping sync */
const notifyBusMappingChange = async ({
  routeIds = [],
  busNumber = null,
  previousRouteId = null,
  newRouteId = null,
} = {}) => {
  try {
    const uniqueRouteIds = [...new Set(routeIds.filter(Boolean))];
    if (uniqueRouteIds.length === 0) return { skipped: true, reason: 'No routes' };

    const [students, employees] = await Promise.all([
      TransportRequest.find({
        status: 'approved',
        route_id: { $in: uniqueRouteIds },
      }).select('student_name admission_number route_id route_name stage_name bus_id').lean(),
      EmployeeTransportRequest.find({
        status: 'approved',
        route_id: { $in: uniqueRouteIds },
      }).select('employee_name emp_no route_id route_name stage_name bus_id').lean(),
    ]);

    const studentList = students.map((s) => ({
      name: s.student_name,
      admissionNumber: s.admission_number,
      route_id: s.route_id,
      route_name: s.route_name,
      stage_name: s.stage_name,
      new_bus_id: s.bus_id || busNumber || '',
      old_bus_id: '',
    }));

    const employeeList = employees.map((e) => ({
      name: e.employee_name,
      admissionNumber: e.emp_no,
      route_id: e.route_id,
      route_name: e.route_name,
      stage_name: e.stage_name,
      new_bus_id: e.bus_id || busNumber || '',
      old_bus_id: '',
    }));

    return triggerAutoNotification('bus_route_mapping', {
      students: studentList,
      employees: employeeList,
      extraParams: {
        old_route_id: previousRouteId || '',
        new_route_id: newRouteId || '',
        new_bus_id: busNumber || '',
      },
    });
  } catch (err) {
    console.error('[AutoNotify:bus_route_mapping] error:', err.message);
    return { success: false, skipped: true, error: err.message, sent: 0, failed: 0 };
  }
};

/**
 * Fire-and-forget: runs after HTTP response is sent.
 * Never throws — SMS issues cannot block or fail the main route action.
 */
const fireAutoNotification = (action, getPayload) => {
  setImmediate(() => {
    (async () => {
      try {
        const payload = typeof getPayload === 'function' ? getPayload() : (getPayload || {});
        await triggerAutoNotification(action, payload);
      } catch (err) {
        console.error(`[AutoNotify:${action}] background error:`, err.message);
      }
    })();
  });
};

const fireBusMappingNotification = (options = {}) => {
  setImmediate(() => {
    notifyBusMappingChange(options).catch((err) => {
      console.error('[AutoNotify:bus_route_mapping] background error:', err.message);
    });
  });
};

module.exports = {
  ensureDefaultSettings,
  triggerAutoNotification,
  notifyBusMappingChange,
  fireAutoNotification,
  fireBusMappingNotification,
  AUTO_NOTIFICATION_ACTIONS: AutoNotificationSetting.AUTO_NOTIFICATION_ACTIONS,
};
