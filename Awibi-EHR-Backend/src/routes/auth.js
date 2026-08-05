const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const passport = require('passport');
const { v4: uuidv4, validate: isUuid } = require('uuid');
const rateLimit = require('express-rate-limit');
const { prisma } = require('../utils/database');
const { sendOTP, sendPasswordReset } = require('../utils/mailer');
const { authenticate } = require('../middleware/auth');
const { getPermissions } = require('../utils/permissions');
const { generateStaffId } = require('../utils/upid');
const { isStrongPassword } = require('../utils/passwords');

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many login attempts — try again in 15 minutes' }, standardHeaders: true, legacyHeaders: false });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 5, message: { error: 'Too many registrations from this IP — try again in an hour' }, standardHeaders: true, legacyHeaders: false });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: { error: 'Too many password reset requests — try again in 15 minutes' }, standardHeaders: true, legacyHeaders: false });

const COOKIE_OPTS = { httpOnly: true, sameSite: 'lax', maxAge: 7 * 24 * 3600 * 1000, secure: process.env.NODE_ENV === 'production' };

function issueTokens(user) {
  const payload = { userId: user.id, role: user.role, subRole: user.subRole, facilityId: user.facilityId };
  const accessToken = jwt.sign(payload, process.env.JWT_SECRET || 'awibi-secret', { expiresIn: process.env.JWT_EXPIRES_IN || '15m' });
  const refreshToken = jwt.sign({ userId: user.id }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET || 'awibi-secret', { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' });
  return { accessToken, refreshToken };
}

async function loadFacility(facilityId) {
  if (!facilityId) return null;
  return prisma.facility.findUnique({
    where: { id: facilityId },
    select: { id: true, name: true, type: true, plan: true, phone: true, address: true, logo: true, profileComplete: true },
  });
}

function userResponse(user) {
  const { passwordHash, otpCode, resetToken, refreshToken, otpExpiresAt, resetTokenExpiresAt, ...u } = user;
  return { ...u, permissions: getPermissions(u.role, u.subRole) };
}

function localDemoOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production' || process.env.LOCAL_DEMO_ACCESS !== 'true') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

function localDemoUserWhere(extra = {}) {
  return {
    ...extra,
    isActive: true,
    email: { endsWith: '@local.awibi.test', mode: 'insensitive' },
    facility: { is: { isActive: true } },
  };
}

// Local-only account catalogue. It gives the UI friendly facility/role choices
// without exposing fixture passwords or changing the real login flow.
router.get('/local-demo-accounts', localDemoOnly, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: localDemoUserWhere(),
      select: {
        id: true,
        firstName: true,
        lastName: true,
        role: true,
        subRole: true,
        specialty: true,
        facility: { select: { id: true, name: true, type: true } },
      },
      orderBy: [{ facilityId: 'asc' }, { role: 'asc' }, { firstName: 'asc' }],
    });

    res.json({
      localOnly: true,
      accounts: users.map((user) => ({
        id: user.id,
        name: `${user.firstName} ${user.lastName}`.trim(),
        role: user.role,
        subRole: user.subRole,
        specialty: user.specialty,
        facility: user.facility,
      })),
    });
  } catch (err) { next(err); }
});

// Local-only passwordless entry. The production guard above and the launcher-
// injected flag make this unavailable in every normal deployment.
router.post('/local-demo-login', localDemoOnly, async (req, res, next) => {
  try {
    const { userId } = req.body || {};
    if (!userId || !isUuid(userId)) return res.status(400).json({ error: 'Choose a valid demo account' });

    const user = await prisma.user.findFirst({
      where: localDemoUserWhere({ id: userId }),
    });
    if (!user) return res.status(404).json({ error: 'Demo account not found' });

    const { accessToken, refreshToken } = issueTokens(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date(), refreshToken },
    });
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    const facility = await loadFacility(user.facilityId);
    res.json({ accessToken, user: userResponse(user), facility, localDemo: true });
  } catch (err) { next(err); }
});

// POST /v1/auth/register
router.post('/register', registerLimiter, async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, orgName, orgType, facilityType, phone, plan, paystackRef } = req.body;
    if (!firstName || !lastName || !email || !password) {
      return res.status(400).json({ error: 'firstName, lastName, email, password are required' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const exists = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) return res.status(409).json({ error: 'Email already registered' });

    const VALID_PLANS = ['FREE', 'SMALL', 'CLINIC_PLUS', 'INSTITUTION'];
    const VALID_TYPES = ['HOSPITAL', 'CLINIC', 'LAB', 'PROFESSIONAL'];
    const rawPlan = (plan || 'FREE').toUpperCase().replace(/ /g, '_');
    const normalPlan = VALID_PLANS.includes(rawPlan) ? rawPlan : 'FREE';
    const rawType = (facilityType || orgType || 'CLINIC').toUpperCase();
    const normalType = VALID_TYPES.includes(rawType) ? rawType : 'CLINIC';
    const PLAN_LIMITS = {
      FREE:        { patients: 50,    staff: 5 },
      SMALL:       { patients: 200,   staff: 10 },
      CLINIC_PLUS: { patients: 2000,  staff: 50 },
      INSTITUTION: { patients: 10000, staff: 200 },
    };
    const limits = PLAN_LIMITS[normalPlan] || PLAN_LIMITS.FREE;

    const hash = await bcrypt.hash(password, 12);
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const otpExp = new Date(Date.now() + 10 * 60 * 1000);

    // Atomic: create facility + subscription + user in one transaction
    const { facility, user } = await prisma.$transaction(async (tx) => {
      let fac = null;
      if (orgName) {
        fac = await tx.facility.create({
          data: { name: orgName, type: normalType, plan: normalPlan, phone: phone || null },
        });
        await tx.subscription.create({
          data: {
            facilityId: fac.id,
            plan: normalPlan,
            status: 'TRIAL',
            patientLimit: limits.patients,
            staffLimit: limits.staff,
            patientsUsed: 0,
            staffUsed: 0,
            startDate: new Date(),
            endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            paystackRef: paystackRef || null,
          },
        });
      }
      const u = await tx.user.create({
        data: {
          firstName, lastName,
          email: email.toLowerCase(),
          passwordHash: hash,
          role: 'ADMIN',
          facilityId: fac?.id || null,
          otpCode: otp,
          otpExpiresAt: otpExp,
          emailVerified: process.env.NODE_ENV === 'development',
        },
      });
      return { facility: fac, user: u };
    });

    if (process.env.NODE_ENV !== 'development') {
      await sendOTP(email, firstName, otp, 'verify your account');
    }

    const { accessToken, refreshToken } = issueTokens(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken } });
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    res.status(201).json({
      message: process.env.NODE_ENV === 'development' ? 'Registered (dev: email verification skipped)' : 'Check your email for OTP',
      accessToken,
      user: userResponse(user),
      facility,
      requiresOtp: process.env.NODE_ENV !== 'development',
    });
  } catch (err) { next(err); }
});

// POST /v1/auth/login
router.post('/login', loginLimiter, (req, res, next) => {
  passport.authenticate('local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid credentials' });
    if (process.env.NODE_ENV === 'production' && !user.emailVerified) {
      return res.status(403).json({ error: 'Please verify your email before logging in', requiresOtp: true });
    }
    try {
      const { accessToken, refreshToken } = issueTokens(user);
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), refreshToken } });
      res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
      const facility = await loadFacility(user.facilityId);
      res.json({ accessToken, user: userResponse(user), facility });
    } catch (e) { next(e); }
  })(req, res, next);
});

// POST /v1/auth/staff-login
router.post('/staff-login', (req, res, next) => {
  passport.authenticate('staff-local', { session: false }, async (err, user, info) => {
    if (err) return next(err);
    if (!user) return res.status(401).json({ error: info?.message || 'Invalid Staff ID or password' });
    try {
      const { accessToken, refreshToken } = issueTokens(user);
      await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), refreshToken } });
      res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
      const facility = await loadFacility(user.facilityId);
      res.json({ accessToken, user: userResponse(user), facility });
    } catch (e) { next(e); }
  })(req, res, next);
});

// POST /v1/auth/refresh
router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies?.refreshToken || req.body?.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token' });
    const payload = jwt.verify(token, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.userId } });
    if (!user || user.refreshToken !== token) return res.status(401).json({ error: 'Invalid refresh token' });
    const { accessToken, refreshToken: newRefresh } = issueTokens(user);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: newRefresh } });
    res.cookie('refreshToken', newRefresh, COOKIE_OPTS);
    res.json({ accessToken, user: userResponse(user) });
  } catch (_) { res.status(401).json({ error: 'Invalid or expired refresh token' }); }
});

// POST /v1/auth/logout
router.post('/logout', authenticate, async (req, res, next) => {
  try {
    await prisma.user.update({ where: { id: req.ctx.userId }, data: { refreshToken: null } });
    res.clearCookie('refreshToken');
    res.json({ message: 'Logged out' });
  } catch (e) { next(e); }
});

// POST /v1/auth/verify-otp
router.post('/verify-otp', async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.otpCode !== otp) return res.status(400).json({ error: 'Invalid OTP' });
    if (new Date() > new Date(user.otpExpiresAt)) return res.status(400).json({ error: 'OTP expired — request a new one' });

    const { accessToken, refreshToken } = issueTokens(user);
    await prisma.user.update({
      where: { id: user.id },
      data: { emailVerified: true, otpCode: null, otpExpiresAt: null, refreshToken },
    });
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);

    const facility = await loadFacility(user.facilityId);
    let subscription = null;
    if (user.facilityId) {
      subscription = await prisma.subscription.findUnique({ where: { facilityId: user.facilityId } });
    }
    res.json({ message: 'Email verified', accessToken, user: userResponse(user), facility, subscription });
  } catch (e) { next(e); }
});

// POST /v1/auth/resend-otp
router.post('/resend-otp', async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    await prisma.user.update({ where: { id: user.id }, data: { otpCode: otp, otpExpiresAt: new Date(Date.now() + 10 * 60 * 1000) } });
    await sendOTP(email, user.firstName, otp);
    res.json({ message: 'OTP sent' });
  } catch (e) { next(e); }
});

// POST /v1/auth/forgot-password
router.post('/forgot-password', forgotLimiter, async (req, res, next) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email: email?.toLowerCase() } });
    if (user) {
      const token = uuidv4();
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: token, resetTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      const url = `${process.env.FRONTEND_URL}/reset-password?token=${token}&email=${encodeURIComponent(email)}`;
      await sendPasswordReset(email, user.firstName, url);
    }
    res.json({ message: 'If that email is registered, a reset link has been sent' });
  } catch (e) { next(e); }
});

// POST /v1/auth/reset-password
router.post('/reset-password', async (req, res, next) => {
  try {
    const { email, token, password } = req.body;
    if (!email || !token || !password) return res.status(400).json({ error: 'email, token, password required' });
    const user = await prisma.user.findFirst({ where: { email: email.toLowerCase(), resetToken: token } });
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (new Date() > new Date(user.resetTokenExpiresAt)) return res.status(400).json({ error: 'Reset link expired' });
    const hash = await bcrypt.hash(password, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, resetToken: null, resetTokenExpiresAt: null, mustChangePassword: false, refreshToken: null },
    });
    res.json({ message: 'Password reset successful' });
  } catch (e) { next(e); }
});

// GET /v1/auth/me
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const u = userResponse(req.user);
    const facility = req.user.facility || null;
    let subscription = null;
    if (req.user.facilityId) {
      subscription = await prisma.subscription.findUnique({ where: { facilityId: req.user.facilityId } });
    }
    res.json({ user: { ...u, facility: undefined }, facility, subscription });
  } catch (e) { next(e); }
});

// GET /v1/auth/google
router.get('/google', (req, res, next) => {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return res.status(503).json({
      error: 'Google OAuth not configured',
      setup: 'Add GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET to .env',
    });
  }
  passport.authenticate('google', { scope: ['profile', 'email'], session: false })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  passport.authenticate('google', { session: false }, async (err, user) => {
    if (err || !user) {
      return res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:5173'}/login?error=google_failed`);
    }
    const { accessToken, refreshToken } = issueTokens(user);
    await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date(), refreshToken } });
    res.cookie('refreshToken', refreshToken, COOKIE_OPTS);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}/auth/google?token=${encodeURIComponent(accessToken)}`);
  })(req, res, next);
});

// POST /v1/auth/change-password
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await prisma.user.findUnique({ where: { id: req.ctx.userId } });
    if (user.passwordHash) {
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) return res.status(400).json({ error: 'Current password incorrect' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 12 characters with upper, lower, number, and symbol' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash: hash, mustChangePassword: false, refreshToken: null },
    });
    res.json({ message: 'Password changed' });
  } catch (e) { next(e); }
});

module.exports = router;
