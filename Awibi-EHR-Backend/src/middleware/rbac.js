const { can } = require('../utils/permissions');

// Usage: router.get('/beds', authenticate, requirePermission('beds'), handler)
function requirePermission(module) {
  return (req, res, next) => {
    const { role, subRole } = req.ctx || {};
    if (!role) return res.status(401).json({ error: 'Unauthorized' });
    if (can(role, subRole, module)) return next();
    return res.status(403).json({ error: `Access denied — requires '${module}' permission` });
  };
}

// Require specific role
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.ctx || !roles.includes(req.ctx.role)) {
      return res.status(403).json({ error: 'Insufficient role' });
    }
    next();
  };
}

module.exports = { requirePermission, requireRole };
