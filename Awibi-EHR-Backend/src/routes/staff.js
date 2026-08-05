const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { generateStaffId } = require('../utils/upid');
const { generateTemporaryPassword, isStrongPassword } = require('../utils/passwords');

const auth = [authenticate, tenant, requirePermission('staff')];

router.get('/', auth, async (req, res, next) => {
  try {
    const { search, role, subRole, page = 1, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (role) where.role = role;
    if (subRole) where.subRole = subRole;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { staffId: { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);
    const [total, staff] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where, skip, take: Number(limit), orderBy: { firstName: 'asc' },
        select: {
          id: true, firstName: true, lastName: true, email: true, role: true, subRole: true,
          specialty: true, phone: true, staffId: true, avatar: true, isActive: true,
          emailVerified: true, facilityId: true, createdAt: true, lastLoginAt: true,
        },
      }),
    ]);
    res.json({ staff, total });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const u = await prisma.user.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      select: {
        id: true, firstName: true, lastName: true, email: true, role: true, subRole: true,
        specialty: true, phone: true, staffId: true, avatar: true, isActive: true,
        emailVerified: true, facilityId: true, createdAt: true, lastLoginAt: true,
      },
    });
    if (!u) return res.status(404).json({ error: 'Staff not found' });
    res.json(u);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { firstName, lastName, email, role, subRole, specialty, phone, password } = req.body;
    if (!firstName || !lastName || !email || !role) return res.status(400).json({ error: 'firstName, lastName, email, role required' });

    const sub = await prisma.subscription.findUnique({ where: { facilityId: req.ctx.facilityId } });
    if (sub && sub.staffUsed >= sub.staffLimit) {
      return res.status(402).json({ error: 'Staff limit reached. Upgrade your plan to add more staff.', code: 'STAFF_LIMIT' });
    }

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const facility = await prisma.facility.findUnique({ where: { id: req.ctx.facilityId }, select: { name: true } });
    const facilityCode = facility?.name?.slice(0, 3).toUpperCase() || 'AWB';
    const staffId = generateStaffId(facilityCode);
    if (password && !isStrongPassword(password)) {
      return res.status(400).json({ error: 'Temporary password must be at least 12 characters with upper, lower, number, and symbol' });
    }
    const tempPassword = password || generateTemporaryPassword();
    const hash = await bcrypt.hash(tempPassword, 12);

    const u = await prisma.user.create({
      data: {
        firstName, lastName, email: email.toLowerCase(), passwordHash: hash,
        role, subRole, specialty, phone, facilityId: req.ctx.facilityId,
        staffId, emailVerified: true, isActive: true, mustChangePassword: true,
      },
    });

    if (sub) {
      await prisma.subscription.update({ where: { facilityId: req.ctx.facilityId }, data: { staffUsed: { increment: 1 } } });
    }

    const { passwordHash, otpCode, resetToken, refreshToken, otpExpiresAt, resetTokenExpiresAt, ...safe } = u;
    res.status(201).json({ ...safe, tempPassword });
  } catch (e) { next(e); }
});

router.put('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.user.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const { passwordHash, id, facilityId, createdAt, updatedAt, ...safe } = req.body;
    const u = await prisma.user.update({ where: { id: req.params.id }, data: safe });
    const { passwordHash: ph, otpCode, resetToken, refreshToken, otpExpiresAt, resetTokenExpiresAt, ...result } = u;
    res.json(result);
  } catch (e) { next(e); }
});

router.put('/:id/deactivate', auth, async (req, res, next) => {
  try {
    const u = await prisma.user.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!u) return res.status(404).json({ error: 'Not found' });
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: !u.isActive } });
    res.json({ message: updated.isActive ? 'Reactivated' : 'Deactivated', isActive: updated.isActive });
  } catch (e) { next(e); }
});

router.delete('/:id', auth, async (req, res, next) => {
  try {
    const exists = await prisma.user.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    await prisma.user.delete({ where: { id: req.params.id } });
    res.json({ message: 'Staff removed' });
  } catch (e) { next(e); }
});

router.put('/:id/reset-password', auth, async (req, res, next) => {
  try {
    const exists = await prisma.user.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Not found' });
    const tempPw = generateTemporaryPassword();
    await prisma.user.update({
      where: { id: req.params.id },
      data: { passwordHash: await bcrypt.hash(tempPw, 12), mustChangePassword: true, refreshToken: null },
    });
    res.json({ message: 'Password reset', tempPassword: tempPw });
  } catch (e) { next(e); }
});

module.exports = router;
