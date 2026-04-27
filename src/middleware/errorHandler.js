/**
 * Centralised Express error handler.
 * Any route can call next(err) to land here.
 */
function errorHandler(err, req, res, next) {
  console.error(`[${new Date().toISOString()}] ERROR ${req.method} ${req.path}:`, err);

  const status = err.status || err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(status).json({
    error: message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack }),
  });
}

module.exports = { errorHandler };
