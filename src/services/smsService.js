const axios = require('axios');

const AT_USERNAME = process.env.AT_USERNAME || 'sandbox';
const AT_API_KEY  = process.env.AT_API_KEY;

// Sandbox vs production endpoint
const AT_SMS_URL = AT_USERNAME === 'sandbox'
  ? 'https://api.sandbox.africastalking.com/version1/messaging'
  : 'https://api.africastalking.com/version1/messaging';

/**
 * Send an OTP SMS via Africa's Talking REST API.
 * Sandbox: no real SMS — monitor delivery on the AT simulator dashboard.
 * @param {string} phone  E.164 format, e.g. "+254712345678"
 * @param {string} code   6-digit OTP
 */
async function sendOtpSms(phone, code) {
  const message = `Your Ride Pamoja verification code is: ${code}. Valid for 10 minutes. Do not share this code.`;

  const params = new URLSearchParams();
  params.append('username', AT_USERNAME);
  params.append('to', phone);
  params.append('message', message);

  // Only set sender ID in production (sandbox ignores it)
  if (AT_USERNAME !== 'sandbox' && process.env.AT_SENDER_ID) {
    params.append('from', process.env.AT_SENDER_ID);
  }

  const response = await axios.post(AT_SMS_URL, params.toString(), {
    headers: {
      apiKey: AT_API_KEY,
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  const recipients = response.data?.SMSMessageData?.Recipients;
  if (!recipients || recipients.length === 0) {
    throw new Error('AT API returned no recipients');
  }

  const recipient = recipients[0];
  if (recipient.status !== 'Success') {
    throw new Error(`SMS failed: ${recipient.status}`);
  }

  return recipient;
}

module.exports = { sendOtpSms };
