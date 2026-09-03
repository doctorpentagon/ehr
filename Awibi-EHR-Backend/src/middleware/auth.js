const jwt = require('jsonwebtoken');
const { prisma } = require('../utils/database');
const { JWT_SECRET } = require('../config/jwt');

async function authenticate(req, res, next) {
  try {
    // Prefer the httpOnly cookie (browser sessions); fall back to the Bearer
    // header for API clients and during the transition off localStorage.
    const header = req.headers.authorization;
    const token = req.cookies?.accessToken
      || (header && header.startsWith('Bearer ') ? header.slice(7) : null);
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: {
        facility: {
          select: { id: true, name: true, type: true, plan: true, phone: true, address: true, logo: true, profileComplete: true },
        },
      },
    });
    if (!user || !user.isActive) return res.status(401).json({ error: 'User not found or inactive' });
    req.user = user;
    req.ctx = {
      userId: user.id,
      role: user.role,
      subRole: user.subRole,
      facilityId: user.facilityId,
    };
    const passwordChangeAllowed = new Set([
      '/v1/auth/me', '/v1/auth/change-password', '/v1/auth/logout',
    ]);
    if (user.mustChangePassword && !passwordChangeAllowed.has(req.originalUrl.split('?')[0])) {
      return res.status(403).json({
        error: 'Password change required before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Optional auth — sets req.ctx if token valid, never fails the request
async function optionalAuth(req, res, next) {
  try {
    const header = req.headers.authorization;
    const token = req.cookies?.accessToken
      || (header && header.startsWith('Bearer ') ? header.slice(7) : null);
    if (token) {
      const payload = jwt.verify(token, JWT_SECRET);
      const user = await prisma.user.findUnique({ where: { id: payload.userId } });
      if (user) {
        req.user = user;
        req.ctx = { userId: user.id, role: user.role, subRole: user.subRole, facilityId: user.facilityId };
      }
    }
  } catch (_) { /* ignore */ }
  next();
}

module.exports = { authenticate, optionalAuth };
