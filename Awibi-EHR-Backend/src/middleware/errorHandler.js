const logger = require('../utils/logger');

/**
 * Upload failures are the user's problem to fix, not a server fault. Multer
 * throws plain errors with no status, so they surfaced as 500 "Internal server
 * error" — which tells a ward clerk the system is broken and invites them to
 * retry the same oversized scan over and over. Each one gets the right status
 * and a message that says what to do instead.
 */
const MULTER_ERRORS = {
  LIMIT_FILE_SIZE: [413, 'That file is larger than 20 MB. Please scan at a lower quality or split it.'],
  LIMIT_FILE_COUNT: [400, 'Too many files at once. Please upload them one at a time.'],
  LIMIT_UNEXPECTED_FILE: [400, 'Unexpected file field. Please attach the file using the upload button.'],
  LIMIT_PART_COUNT: [400, 'That upload had too many parts.'],
  LIMIT_FIELD_KEY: [400, 'That upload had an invalid field name.'],
  LIMIT_FIELD_VALUE: [400, 'One of the upload fields was too long.'],
  LIMIT_FIELD_COUNT: [400, 'That upload had too many fields.'],
};

function errorHandler(err, req, res, next) {
  if (err && err.name === 'MulterError') {
    const [status, message] = MULTER_ERRORS[err.code] || [400, 'That file could not be uploaded.'];
    return res.status(status).json({ error: message, code: err.code });
  }

  const status = err.status || err.statusCode || 500;
  // Log all errors server-side
  if (status >= 500) {
    logger.error(err.message, { stack: err.stack, path: req.path, method: req.method });
  }
  // In dev, return real error message so you can see what's failing
  const isDev = process.env.NODE_ENV !== 'production';
  const message = isDev ? (err.message || 'Internal server error') : (status < 500 ? err.message : 'Internal server error');
  res.status(status).json({ error: message, ...(isDev && status >= 500 ? { details: err.stack?.split('\n')[0] } : {}) });
}

function notFound(req, res) {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
}

module.exports = { errorHandler, notFound };
