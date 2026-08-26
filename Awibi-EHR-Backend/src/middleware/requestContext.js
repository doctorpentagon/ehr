const { randomUUID } = require('node:crypto');
const logger = require('../utils/logger');

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,100}$/;

function requestRoute(req) {
  if (req.route?.path) return `${req.baseUrl || ''}${req.route.path}`;
  // The fallback is used for 404s. Remove common record identifiers so logs
  // describe the endpoint shape without retaining a patient's URL identifier.
  return (req.path || '/')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/ig, ':id')
    .replace(/AWB-[A-Z0-9-]+/ig, ':healthId');
}

function requestContext(req, res, next) {
  const supplied = req.get('x-request-id');
  req.id = supplied && SAFE_REQUEST_ID.test(supplied) ? supplied : randomUUID();
  res.set('X-Request-Id', req.id);
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info('http.request', {
      requestId: req.id,
      method: req.method,
      route: requestRoute(req),
      status: res.statusCode,
      durationMs: Date.now() - startedAt,
      facilityId: req.ctx?.facilityId || null,
      userId: req.ctx?.userId || null,
    });
  });

  next();
}

module.exports = { requestContext, requestRoute };
