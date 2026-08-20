const { getBulkSmsConfig, isBulkSmsConfigured } = require('../config/bulkSmsConfig');

const normalizePhone = (raw) => {
  if (!raw) return null;
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length !== 10) return null;
  return digits;
};

const buildUrl = (baseUrl, params) => {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
};

const callBulkSms = async (url) => {
  const response = await fetch(url, { method: 'GET' });
  const text = (await response.text()).trim();
  return { ok: response.ok, status: response.status, body: text };
};

/**
 * Send a single English SMS
 */
const sendSingleSms = async ({ number, message, templateId }) => {
  if (!isBulkSmsConfigured()) {
    return { success: false, error: 'BulkSMS API key is not configured' };
  }

  const phone = normalizePhone(number);
  if (!phone) return { success: false, error: `Invalid phone number: ${number}` };
  if (!message || !String(message).trim()) {
    return { success: false, error: 'Message is required' };
  }
  if (!templateId) {
    return { success: false, error: 'DLT Template ID is required' };
  }

  const { apiKey, senderId, englishApiUrl } = getBulkSmsConfig();
  const url = buildUrl(englishApiUrl, {
    apikey: apiKey,
    sender: senderId,
    number: phone,
    message: String(message).trim(),
    templateid: String(templateId).trim(),
  });

  try {
    const result = await callBulkSms(url);
    const looksLikeId = /^\d+$/.test(result.body);
    return {
      success: looksLikeId || result.ok,
      messageId: looksLikeId ? result.body : null,
      response: result.body,
      number: phone,
    };
  } catch (error) {
    return { success: false, error: error.message, number: phone };
  }
};

/**
 * Send the same message to multiple numbers (English bulk)
 */
const sendBulkSms = async ({ numbers = [], message, unicode = false, templateId }) => {
  if (!isBulkSmsConfigured()) {
    return { success: false, error: 'BulkSMS API key is not configured' };
  }

  const phones = [...new Set(numbers.map(normalizePhone).filter(Boolean))];
  if (phones.length === 0) return { success: false, error: 'No valid phone numbers' };
  if (!message || !String(message).trim()) {
    return { success: false, error: 'Message is required' };
  }
  if (!templateId) {
    return { success: false, error: 'DLT Template ID is required' };
  }

  const { apiKey, senderId, bulkApiUrl, unicodeApiUrl } = getBulkSmsConfig();
  const baseUrl = unicode ? unicodeApiUrl : bulkApiUrl;
  const params = {
    apikey: apiKey,
    sender: senderId,
    number: phones.join(','),
    message: String(message).trim(),
    templateid: String(templateId).trim(),
  };
  if (unicode) params.coding = 3;

  const url = buildUrl(baseUrl, params);

  try {
    const result = await callBulkSms(url);
    return {
      success: result.ok,
      response: result.body,
      numbers: phones,
      count: phones.length,
    };
  } catch (error) {
    return { success: false, error: error.message, numbers: phones };
  }
};

/**
 * Send personalized messages one-by-one (different body per recipient)
 */
const sendPersonalizedSms = async (items = [], { unicode = false, templateId } = {}) => {
  const results = [];
  for (const item of items) {
    if (unicode) {
      const bulk = await sendBulkSms({
        numbers: [item.number],
        message: item.message,
        unicode: true,
        templateId,
      });
      results.push({
        number: normalizePhone(item.number),
        success: bulk.success,
        response: bulk.response || bulk.error,
        name: item.name || null,
      });
    } else {
      const single = await sendSingleSms({
        number: item.number,
        message: item.message,
        templateId,
      });
      results.push({
        number: single.number || normalizePhone(item.number),
        success: single.success,
        messageId: single.messageId || null,
        response: single.response || single.error,
        name: item.name || null,
      });
    }
  }

  const sent = results.filter((r) => r.success).length;
  return {
    success: sent > 0,
    sent,
    failed: results.length - sent,
    results,
  };
};

const stripHtml = (text = '') => String(text)
  .replace(/<[^>]*>/gi, ' ')
  .replace(/&nbsp;/gi, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const parseBalanceResponse = (rawBody = '') => {
  const cleaned = stripHtml(rawBody);
  // Typical: "36952 credit balance"
  const match = cleaned.match(/(\d+(?:\.\d+)?)\s*credit/i) || cleaned.match(/(\d+(?:\.\d+)?)/);
  if (match) {
    return {
      balance: Number(match[1]),
      label: `${match[1]} credits`,
      raw: cleaned,
    };
  }
  return {
    balance: null,
    label: cleaned || 'Unavailable',
    raw: cleaned,
  };
};

const checkBalance = async () => {
  if (!isBulkSmsConfigured()) {
    return { success: false, error: 'BulkSMS API key is not configured' };
  }

  const { apiKey, balanceApiUrl } = getBulkSmsConfig();
  const url = buildUrl(balanceApiUrl, { apikey: apiKey });

  try {
    const result = await callBulkSms(url);
    const parsed = parseBalanceResponse(result.body);
    return {
      success: true,
      balance: parsed.balance,
      label: parsed.label,
      raw: parsed.raw,
    };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

module.exports = {
  normalizePhone,
  sendSingleSms,
  sendBulkSms,
  sendPersonalizedSms,
  checkBalance,
  isBulkSmsConfigured,
  getBulkSmsConfig,
};
