const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { hospNoConfig, formatHospNo, hospNoStem } = require('../utils/patientValidation');

const facilityAuth = [authenticate, tenant, requirePermission('settings')];

// Every signed-in user holds `settings` so they can reach their own profile
// page, which means this route is readable by a lab scientist and a nurse too.
// Administrative detail (licence number, NHIS code, the raw settings blob,
// subscription and billing limits) is therefore returned only to the roles that
// actually administer the facility. Everyone else gets the branding and contact
// details their screens need — nothing more.
const ADMIN_ONLY_FACILITY_FIELDS = [
  'licenseNumber', 'nhisCode', 'settings', 'subscription',
  'plan', 'planExpiresAt', 'profileComplete', 'isActive',
];

router.get('/facility', facilityAuth, async (req, res, next) => {
  try {
    const f = await prisma.facility.findUnique({
      where: { id: req.ctx.facilityId },
      include: { subscription: true },
    });
    if (!f) return res.status(404).json({ error: 'Facility not found' });

    const isAdministrator = req.user?.role === 'ADMIN' || req.user?.role === 'SUPER_ADMIN';
    if (isAdministrator) return res.json(f);

    const trimmed = { ...f };
    for (const field of ADMIN_ONLY_FACILITY_FIELDS) delete trimmed[field];
    res.json(trimmed);
  } catch (e) { next(e); }
});

// Editing facility configuration is an administrator's job, not every user's.
const facilityWrite = [authenticate, tenant, requirePermission('settings'), (req, res, next) => {
  if (req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Only a facility administrator can change these settings' });
  }
  next();
}];

router.put('/facility', facilityWrite, async (req, res, next) => {
  try {
    const exists = await prisma.facility.findUnique({ where: { id: req.ctx.facilityId } });
    if (!exists) return res.status(404).json({ error: 'Facility not found' });
    const { id, createdAt, updatedAt, subscription, users, ...allowed } = req.body;
    const { name, email, phone, address, state, lga, licenseNumber, nhisCode, settings } = allowed;
    const f = await prisma.facility.update({
      where: { id: req.ctx.facilityId },
      data: { name, email, phone, address, state, lga, licenseNumber, nhisCode, settings: settings || undefined, profileComplete: true },
    });
    res.json(f);
  } catch (e) { next(e); }
});

// ── Hospital number format ──────────────────────────────────────────────────
//
// The number staff quote to pull a chart. Every hospital has a house style, and
// a number that does not look like the one on the paper folder will not be
// trusted or used — so it is configurable rather than fixed at PAT-001.

router.get('/hospital-number', facilityAuth, async (req, res, next) => {
  try {
    const facility = await prisma.facility.findUnique({
      where: { id: req.ctx.facilityId },
      select: {
        hospNoPrefix: true, hospNoIncludeYear: true,
        hospNoPadding: true, hospNoStart: true, hospNoSeparator: true,
      },
    });
    const config = hospNoConfig(facility || {});
    const issued = await prisma.patient.count({
      where: { facilityId: req.ctx.facilityId, mrn: { startsWith: hospNoStem(config) } },
    });
    res.json({
      ...config,
      // What the next patient will actually get, so an administrator can see
      // the result before committing rather than guessing from four fields.
      preview: formatHospNo(config, Math.max(config.start, issued + 1)),
      issuedUnderCurrentFormat: issued,
    });
  } catch (e) { next(e); }
});

router.put('/hospital-number', facilityWrite, async (req, res, next) => {
  try {
    const { prefix, includeYear, padding, start, separator } = req.body || {};

    if (prefix !== undefined) {
      const value = String(prefix).trim();
      // Letters and digits only: the prefix ends up in URLs, filenames and on
      // printed cards, and punctuation there causes trouble in all three.
      if (!/^[A-Za-z0-9]{1,10}$/.test(value)) {
        return res.status(400).json({
          error: 'The facility code should be 1–10 letters or digits, for example LUTH',
          field: 'prefix',
        });
      }
    }
    if (padding !== undefined && (!Number.isInteger(Number(padding)) || padding < 1 || padding > 10)) {
      return res.status(400).json({ error: 'Padding must be between 1 and 10 digits', field: 'padding' });
    }
    if (start !== undefined && (!Number.isInteger(Number(start)) || start < 0)) {
      return res.status(400).json({ error: 'The starting number cannot be negative', field: 'start' });
    }
    if (separator !== undefined && !['-', '/', '', '.'].includes(String(separator))) {
      return res.status(400).json({ error: 'Separator must be -, /, . or blank', field: 'separator' });
    }

    const facility = await prisma.facility.update({
      where: { id: req.ctx.facilityId },
      data: {
        ...(prefix !== undefined ? { hospNoPrefix: String(prefix).trim().toUpperCase() } : {}),
        ...(includeYear !== undefined ? { hospNoIncludeYear: Boolean(includeYear) } : {}),
        ...(padding !== undefined ? { hospNoPadding: Number(padding) } : {}),
        ...(start !== undefined ? { hospNoStart: Number(start) } : {}),
        ...(separator !== undefined ? { hospNoSeparator: String(separator) } : {}),
      },
      select: {
        hospNoPrefix: true, hospNoIncludeYear: true,
        hospNoPadding: true, hospNoStart: true, hospNoSeparator: true,
      },
    });

    const config = hospNoConfig(facility);
    const issued = await prisma.patient.count({
      where: { facilityId: req.ctx.facilityId, mrn: { startsWith: hospNoStem(config) } },
    });

    res.json({
      ...config,
      preview: formatHospNo(config, Math.max(config.start, issued + 1)),
      // Existing numbers are deliberately left alone. They are printed on
      // folders, cards and invoices; rewriting them would strand every patient
      // holding the old one.
      note: 'Numbers already issued are unchanged. This applies to new registrations.',
    });
  } catch (e) { next(e); }
});

router.get('/profile', authenticate, async (req, res, next) => {
  try {
    const u = await prisma.user.findUnique({
      where: { id: req.ctx.userId },
      select: {
        id: true, firstName: true, lastName: true, email: true, role: true, subRole: true,
        specialty: true, phone: true, staffId: true, avatar: true, isActive: true,
        emailVerified: true, facilityId: true, createdAt: true, lastLoginAt: true,
      },
    });
    res.json(u);
  } catch (e) { next(e); }
});

router.put('/profile', authenticate, async (req, res, next) => {
  try {
    const { firstName, lastName, phone, specialty, avatar } = req.body;
    const u = await prisma.user.update({
      where: { id: req.ctx.userId },
      data: { firstName, lastName, phone, specialty, avatar },
      select: {
        id: true, firstName: true, lastName: true, email: true, role: true, subRole: true,
        specialty: true, phone: true, staffId: true, avatar: true, isActive: true,
        emailVerified: true, facilityId: true, createdAt: true, lastLoginAt: true,
      },
    });
    res.json(u);
  } catch (e) { next(e); }
});

module.exports = router;
