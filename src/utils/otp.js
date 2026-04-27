const crypto = require('crypto');

/**
 * Generate a cryptographically random 6-digit OTP.
 */
function generateOtp() {
  // Generate a random number between 100000 and 999999
  const buffer = crypto.randomBytes(3);
  const num = buffer.readUIntBE(0, 3) % 900000 + 100000;
  return String(num);
}

/**
 * OTP expiry: 10 minutes from now.
 */
function otpExpiresAt() {
  return new Date(Date.now() + 10 * 60 * 1000).toISOString();
}

/**
 * Check if an OTP stored record is still valid.
 * @param {string} expiresAt  ISO string from DB
 */
function isOtpExpired(expiresAt) {
  return new Date(expiresAt) < new Date();
}

module.exports = { generateOtp, otpExpiresAt, isOtpExpired };
