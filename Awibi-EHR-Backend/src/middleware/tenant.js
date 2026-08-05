// Adds facilityId to req.ctx from the JWT claim.
// Every clinical query must scope to req.ctx.facilityId.
function tenant(req, res, next) {
  if (!req.ctx || !req.ctx.facilityId) {
    // Super admins may not have a facilityId — allow through
    if (req.ctx && req.ctx.role === 'SUPER_ADMIN') return next();
    return res.status(403).json({ error: 'No facility context — complete facility setup first' });
  }
  next();
}

module.exports = { tenant };
