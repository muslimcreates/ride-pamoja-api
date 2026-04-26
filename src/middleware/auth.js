const { verifyToken } = require('../utils/jwt');

/**
 * Protect routes — extracts and verifies the Bearer JWT.
 * Attaches decoded payload to req.user.
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.slice(7);

  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/**
 * Require the user to have a driver role.
 */
function requireDriver(req, res, next) {
  if (req.user?.role !== 'driver' && req.user?.role !== 'both') {
    return res.status(403).json({ error: 'Driver account required' });
  }
  next();
}

module.exports = { requireAuth, requireDriver };
