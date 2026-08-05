const express = require('express');

const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requireTenantPatient } = require('../utils/tenantRecords');

/**
 * Internal messaging between staff of the same facility.
 *
 * Every authenticated member of staff can message colleagues in their own
 * facility — there is no separate permission, because a nurse who cannot tell a
 * doctor something is the problem this solves. Tenant scoping does the work
 * that matters: a message can only ever be addressed to someone in the same
 * facility, and can only reference a patient of that facility.
 */
const auth = [authenticate, tenant];

const SENDER = { select: { id: true, firstName: true, lastName: true, role: true, subRole: true, staffId: true } };
const PATIENT = { select: { id: true, firstName: true, lastName: true, mrn: true } };

/** Colleagues who can be messaged. */
router.get('/recipients', auth, async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { facilityId: req.ctx.facilityId, isActive: true, id: { not: req.ctx.userId } },
      select: { id: true, firstName: true, lastName: true, role: true, subRole: true, specialty: true },
      orderBy: [{ firstName: 'asc' }],
    });
    res.json({ recipients: users });
  } catch (e) { next(e); }
});

router.get('/', auth, async (req, res, next) => {
  try {
    const { box = 'inbox', unreadOnly, patientId } = req.query;

    const where = { facilityId: req.ctx.facilityId, archivedAt: null };
    if (box === 'sent') where.senderId = req.ctx.userId;
    else where.recipientId = req.ctx.userId;

    if (unreadOnly === 'true' || unreadOnly === '1') where.readAt = null;
    if (patientId) where.patientId = patientId;

    const messages = await prisma.message.findMany({
      where,
      // Anything marked urgent sits at the top of the inbox regardless of age;
      // a shift-critical question should not sink under routine traffic.
      orderBy: [{ priority: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { sender: SENDER, recipient: SENDER, patient: PATIENT },
    });

    const unread = await prisma.message.count({
      where: { facilityId: req.ctx.facilityId, recipientId: req.ctx.userId, readAt: null, archivedAt: null },
    });
    res.json({ messages, unread });
  } catch (e) { next(e); }
});

/** Just the badge count — called often, so it stays cheap. */
router.get('/unread-count', auth, async (req, res, next) => {
  try {
    const [unread, urgent] = await Promise.all([
      prisma.message.count({
        where: { facilityId: req.ctx.facilityId, recipientId: req.ctx.userId, readAt: null, archivedAt: null },
      }),
      prisma.message.count({
        where: {
          facilityId: req.ctx.facilityId, recipientId: req.ctx.userId,
          readAt: null, archivedAt: null, priority: 'URGENT',
        },
      }),
    ]);
    res.json({ unread, urgent });
  } catch (e) { next(e); }
});

router.get('/:id', auth, async (req, res, next) => {
  try {
    const message = await prisma.message.findFirst({
      where: {
        id: req.params.id,
        facilityId: req.ctx.facilityId,
        // Only the two people involved may read it.
        OR: [{ senderId: req.ctx.userId }, { recipientId: req.ctx.userId }],
      },
      include: {
        sender: SENDER, recipient: SENDER, patient: PATIENT,
        replies: { include: { sender: SENDER }, orderBy: { createdAt: 'asc' } },
      },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    res.json(message);
  } catch (e) { next(e); }
});

router.post('/', auth, async (req, res, next) => {
  try {
    const { recipientId, subject, body, priority = 'NORMAL', patientId, parentId } = req.body || {};

    if (!recipientId) return res.status(400).json({ error: 'Choose who to send this to', field: 'recipientId' });
    if (!String(body || '').trim()) return res.status(400).json({ error: 'Write a message', field: 'body' });
    if (!['NORMAL', 'URGENT'].includes(priority)) {
      return res.status(400).json({ error: 'priority must be NORMAL or URGENT', field: 'priority' });
    }
    if (recipientId === req.ctx.userId) {
      return res.status(400).json({ error: 'You cannot message yourself', field: 'recipientId' });
    }

    // A message must not be a way to reach someone in another facility.
    const recipient = await prisma.user.findFirst({
      where: { id: recipientId, facilityId: req.ctx.facilityId, isActive: true },
      select: { id: true },
    });
    if (!recipient) return res.status(404).json({ error: 'That colleague is not in this facility' });

    if (patientId) await requireTenantPatient(req.ctx.facilityId, patientId);

    if (parentId) {
      const parent = await prisma.message.findFirst({
        where: {
          id: parentId, facilityId: req.ctx.facilityId,
          OR: [{ senderId: req.ctx.userId }, { recipientId: req.ctx.userId }],
        },
        select: { id: true },
      });
      if (!parent) return res.status(404).json({ error: 'Cannot reply to that message' });
    }

    const message = await prisma.message.create({
      data: {
        facilityId: req.ctx.facilityId,
        senderId: req.ctx.userId,
        recipientId,
        parentId: parentId || null,
        subject: String(subject || '').trim() || null,
        body: String(body).trim(),
        priority,
        patientId: patientId || null,
      },
      include: { sender: SENDER, recipient: SENDER, patient: PATIENT },
    });
    res.status(201).json(message);
  } catch (e) { next(e); }
});

router.put('/:id/read', auth, async (req, res, next) => {
  try {
    // Only the recipient can mark something read — a sender must not be able to
    // clear the badge on a message the other person never opened.
    const message = await prisma.message.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId, recipientId: req.ctx.userId },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });
    if (message.readAt) return res.json(message);

    const updated = await prisma.message.update({
      where: { id: message.id }, data: { readAt: new Date() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

router.put('/read-all', auth, async (req, res, next) => {
  try {
    const result = await prisma.message.updateMany({
      where: { facilityId: req.ctx.facilityId, recipientId: req.ctx.userId, readAt: null },
      data: { readAt: new Date() },
    });
    res.json({ marked: result.count });
  } catch (e) { next(e); }
});

router.put('/:id/archive', auth, async (req, res, next) => {
  try {
    const message = await prisma.message.findFirst({
      where: {
        id: req.params.id, facilityId: req.ctx.facilityId,
        OR: [{ senderId: req.ctx.userId }, { recipientId: req.ctx.userId }],
      },
    });
    if (!message) return res.status(404).json({ error: 'Message not found' });

    const updated = await prisma.message.update({
      where: { id: message.id }, data: { archivedAt: new Date() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
