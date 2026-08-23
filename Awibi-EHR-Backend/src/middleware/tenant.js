// Adds facilityId to req.ctx from the JWT claim.
// Every clinical query must scope to req.ctx.facilityId.
function tenant(req, res, next) {
  // Awibi platform operators are deliberately not tenant staff. Platform
  // oversight routes live under /v1/platform and do not mount this middleware.
  // Never let a SUPER_ADMIN fall through a tenant route: an undefined Prisma
  // facility filter can be omitted, turning an intended facility query into a
  // cross-facility query. This remains true even when a local demo operator is
  // homed to a synthetic facility solely so it can appear in the role picker.
  if (req.ctx?.role === 'SUPER_ADMIN') {
    return res.status(403).json({
      error: 'Platform operators cannot enter facility clinical surfaces',
      code: 'PLATFORM_TENANT_ACCESS_DENIED',
    });
  }
  if (!req.ctx || !req.ctx.facilityId) {
    return res.status(403).json({ error: 'No facility context — complete facility setup first' });
  }
  next();
}

module.exports = { tenant };
