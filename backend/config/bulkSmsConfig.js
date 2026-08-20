const getBulkSmsConfig = () => ({
  apiKey: process.env.BULKSMS_API_KEY || '',
  senderId: process.env.BULKSMS_SENDER_ID || 'PYDAHK',
  englishApiUrl: process.env.BULKSMS_ENGLISH_API_URL || 'https://www.bulksmsapps.com/api/apismsv2.aspx',
  unicodeApiUrl: process.env.BULKSMS_UNICODE_API_URL || 'https://www.bulksmsapps.com/api/apibulkv2.aspx',
  bulkApiUrl: process.env.BULKSMS_BULK_API_URL || 'https://www.bulksmsapps.com/api/apibulkv2.aspx',
  balanceApiUrl: process.env.BULKSMS_BALANCE_API_URL || 'https://www.bulksmsapps.com/api/apicheckbalancev2.aspx',
});

const isBulkSmsConfigured = () => Boolean(getBulkSmsConfig().apiKey);

module.exports = {
  getBulkSmsConfig,
  isBulkSmsConfigured,
};
