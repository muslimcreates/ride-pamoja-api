const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET;
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || '30d';

if (!SECRET) {
  console.error('❌  Missing JWT_SECRET in .env');
  process.exit(1);
}

/**
 * Sign a JWT for the given user.
 * @param {{ id: string, phone: string, role: string }} payload
 */
function signToken(payload) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN });
}

/**
 * Verify and decode a JWT.  Throws if invalid or expired.
 * @param {string} token
 */
function verifyToken(token) {
  return jwt.verify(token, SECRET);
}

module.exports = { signToken, verifyToken };
