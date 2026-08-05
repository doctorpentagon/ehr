const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');

// Platform (Awibi operator) surface. This is the ONLY place that reads across
// facilities, and it is restricted to SUPER_ADMIN. It deliberately does NOT use
// the `tenant` middleware — facility scoping does not apply to platform
// oversight — so every route here must guard on role itself.
function superAdminOnly(req, res, next) {
  if (req.user?.role !== 'SUPER_ADMIN') {
    return res.status(403).json({ error: 'Platform metrics are restricted to Awibi super administrators' });
  }
  next();
}

const guard = [authenticate, superAdminOnly];

function audit(req, action, meta) {
  prisma.auditLog.create({
    data: {
      facilityId: req.user?.facilityId || null,
      userId: req.user?.id,
      action,
      resource: 'Platform',
      resourceId: null,
      reason: meta || 'Platform oversight',
      ip: req.ip,
    },
  }).catch(() => {});
}

// ── Overview: the investor-facing numbers ───────────────────────────────────
router.get('/overview', guard, async (req, res, next) => {
  try {
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const [
      totalFacilities, activeFacilities, hospitals, labs, professionals, clinics,
      totalUsers, activeUsers, doctors, totalPatients, patientsThisMonth,
      totalCases, casesThisMonth, subscriptions,
    ] = await prisma.$transaction([
      prisma.facility.count(),
      prisma.facility.count({ where: { isActive: true } }),
      prisma.facility.count({ where: { type: 'HOSPITAL' } }),
      prisma.facility.count({ where: { type: 'LAB' } }),
      prisma.facility.count({ where: { type: 'PROFESSIONAL' } }),
      prisma.facility.count({ where: { type: 'CLINIC' } }),
      prisma.user.count(),
      prisma.user.count({ where: { isActive: true } }),
      prisma.user.count({ where: { subRole: 'DOCTOR', isActive: true } }),
      prisma.patient.count({ where: { isArchived: false } }),
      prisma.patient.count({ where: { isArchived: false, createdAt: { gte: startOfMonth } } }),
      prisma.case.count(),
      prisma.case.count({ where: { createdAt: { gte: startOfMonth } } }),
      prisma.subscription.groupBy({ by: ['plan', 'status'], _count: { _all: true } }),
    ]);

    // TWO DIFFERENT MONEY NUMBERS — do not conflate them.
    //
    // `platformRevenue` is what Awibi earns: subscription fees paid by
    // facilities. This is the figure an investor is asking about.
    //
    // `clinicalVolume` is the money the hospitals themselves bill and collect
    // from their own patients. It flows to the facility, never to Awibi. It is
    // a useful measure of platform activity, but reporting it as "revenue" would
    // overstate the business by whatever multiple the tenants happen to bill.
    const [activeSubs, allSubs] = await prisma.$transaction([
      prisma.subscription.aggregate({
        _sum: { amount: true }, _count: { _all: true },
        where: { status: 'ACTIVE' },
      }),
      prisma.subscription.aggregate({ _sum: { amount: true } }),
    ]);
    const clinicalAll = await prisma.invoice.aggregate({ _sum: { total: true, amountPaid: true } });
    const clinicalMonth = await prisma.invoice.aggregate({
      _sum: { amountPaid: true },
      where: { paidAt: { gte: startOfMonth } },
    });

    // Encounters per month for the trend line — last 6 months.
    const months = [];
    for (let i = 5; i >= 0; i -= 1) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const to = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const [encounters, clinical, newFacilities] = await Promise.all([
        prisma.case.count({ where: { createdAt: { gte: from, lt: to } } }),
        prisma.invoice.aggregate({ _sum: { amountPaid: true }, where: { paidAt: { gte: from, lt: to } } }),
        prisma.facility.count({ where: { createdAt: { gte: from, lt: to } } }),
      ]);
      months.push({
        month: from.toLocaleString('en', { month: 'short' }),
        year: from.getFullYear(),
        encounters,
        newFacilities,
        // Clearly named: this is the tenants' clinical billing, not Awibi's income.
        clinicalVolume: Number(clinical._sum.amountPaid || 0),
      });
    }

    const packages = subscriptions.reduce((acc, s) => {
      acc[s.plan] = (acc[s.plan] || 0) + s._count._all;
      return acc;
    }, {});

    audit(req, 'platform.overview.view');

    res.json({
      facilities: {
        total: totalFacilities,
        active: activeFacilities,
        inactive: totalFacilities - activeFacilities,
        byType: { hospitals, labs, professionals, clinics },
      },
      users: { total: totalUsers, active: activeUsers, doctors },
      patients: { total: totalPatients, thisMonth: patientsThisMonth },
      encounters: { total: totalCases, thisMonth: casesThisMonth },
      // What Awibi earns from facility subscriptions.
      platformRevenue: {
        activeSubscriptions: activeSubs._count._all,
        recurringPerCycle: Number(activeSubs._sum.amount || 0),
        contractedTotal: Number(allSubs._sum.amount || 0),
        currency: 'NGN',
      },
      // What the facilities bill their own patients. Platform activity, not income.
      clinicalVolume: {
        billedAllTime: Number(clinicalAll._sum.total || 0),
        collectedAllTime: Number(clinicalAll._sum.amountPaid || 0),
        collectedThisMonth: Number(clinicalMonth._sum.amountPaid || 0),
        currency: 'NGN',
        note: 'Billed by facilities to their patients. This money belongs to the facility, not to Awibi.',
      },
      packages,
      trend: months,
    });
  } catch (e) { next(e); }
});

// ── Facilities register: Hospitals / Labs / Professionals ───────────────────
router.get('/facilities', guard, async (req, res, next) => {
  try {
    const { type, status, search, page = 1, limit = 25 } = req.query;
    const where = {};
    if (type) where.type = type;
    if (status === 'active') where.isActive = true;
    if (status === 'inactive') where.isActive = false;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { state: { contains: search, mode: 'insensitive' } },
      ];
    }
    const skip = (Number(page) - 1) * Number(limit);

    const [total, facilities] = await prisma.$transaction([
      prisma.facility.count({ where }),
      prisma.facility.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, type: true, email: true, phone: true, address: true,
          state: true, lga: true, plan: true, planExpiresAt: true, isActive: true,
          licenseNumber: true, createdAt: true,
          subscription: { select: { plan: true, status: true, endDate: true, amount: true, patientsUsed: true, patientLimit: true, staffUsed: true, staffLimit: true } },
          _count: { select: { users: true, patients: true, cases: true } },
        },
      }),
    ]);

    audit(req, 'platform.facilities.view', `type=${type || 'all'}`);
    res.json({ facilities, total, page: Number(page), limit: Number(limit) });
  } catch (e) { next(e); }
});

// ── Subscriptions: what facilities pay Awibi ────────────────────────────────
// This is the page an investor or the finance team actually wants: who is on
// which plan, what it is worth, and when it renews. It is deliberately separate
// from /payments below, which shows the tenants' own clinical billing.
router.get('/subscriptions', guard, async (req, res, next) => {
  try {
    const { status } = req.query;
    const where = {};
    // Treat an explicit "ALL" as no filter; matching it against the enum
    // literally makes the list silently return nothing.
    if (status && status !== 'ALL') where.status = status;

    const subs = await prisma.subscription.findMany({
      where, orderBy: { endDate: 'asc' },
      include: {
        facility: {
          select: {
            id: true, name: true, type: true, state: true, email: true, phone: true,
            _count: { select: { users: true, patients: true } },
          },
        },
      },
    });

    const now = new Date();
    const in30Days = new Date(Date.now() + 30 * 86400000);

    const rows = subs.map((s) => ({
      id: s.id,
      facility: s.facility,
      plan: s.plan,
      status: s.status,
      amount: Number(s.amount),
      startDate: s.startDate,
      endDate: s.endDate,
      // Usage against the plan's limits — the signal for an upsell or a churn risk.
      patientsUsed: s.patientsUsed,
      patientLimit: s.patientLimit,
      staffUsed: s.staffUsed,
      staffLimit: s.staffLimit,
      isExpired: Boolean(s.endDate && new Date(s.endDate) < now),
      renewsWithin30Days: Boolean(s.endDate && new Date(s.endDate) >= now && new Date(s.endDate) <= in30Days),
    }));

    const totals = {
      activeRecurring: rows.filter((r) => r.status === 'ACTIVE').reduce((a, r) => a + r.amount, 0),
      contracted: rows.reduce((a, r) => a + r.amount, 0),
      active: rows.filter((r) => r.status === 'ACTIVE').length,
      trial: rows.filter((r) => r.status === 'TRIAL').length,
      expired: rows.filter((r) => r.isExpired).length,
      renewingSoon: rows.filter((r) => r.renewsWithin30Days).length,
      currency: 'NGN',
    };

    audit(req, 'platform.subscriptions.view');
    res.json({ subscriptions: rows, totals });
  } catch (e) { next(e); }
});

// ── Clinical billing across tenants (NOT Awibi's income) ────────────────────
router.get('/payments', guard, async (req, res, next) => {
  try {
    const { status, search, page = 1, limit = 25 } = req.query;
    const where = {};
    if (status) where.paymentStatus = status;
    if (search) where.invoiceNumber = { contains: search, mode: 'insensitive' };
    const skip = (Number(page) - 1) * Number(limit);

    const [total, invoices, totals] = await prisma.$transaction([
      prisma.invoice.count({ where }),
      prisma.invoice.findMany({
        where, skip, take: Number(limit), orderBy: { createdAt: 'desc' },
        select: {
          id: true, invoiceNumber: true, total: true, amountPaid: true, balance: true,
          paymentStatus: true, paystackRef: true, paidAt: true, createdAt: true,
          facility: { select: { id: true, name: true, type: true } },
          patient: { select: { firstName: true, lastName: true, universalPatientId: true } },
        },
      }),
      prisma.invoice.aggregate({ _sum: { total: true, amountPaid: true, balance: true }, where }),
    ]);

    audit(req, 'platform.payments.view');
    res.json({
      invoices, total,
      totals: {
        billed: Number(totals._sum.total || 0),
        collected: Number(totals._sum.amountPaid || 0),
        outstanding: Number(totals._sum.balance || 0),
      },
    });
  } catch (e) { next(e); }
});

// ── CSV export ──────────────────────────────────────────────────────────────
function toCsv(rows, columns) {
  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => escape(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => escape(c.value(r))).join(','));
  return [header, ...body].join('\n');
}

router.get('/export/facilities', guard, async (req, res, next) => {
  try {
    const facilities = await prisma.facility.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        subscription: { select: { plan: true, status: true, endDate: true } },
        _count: { select: { users: true, patients: true, cases: true } },
      },
    });

    const csv = toCsv(facilities, [
      { label: 'Name', value: (f) => f.name },
      { label: 'Type', value: (f) => f.type },
      { label: 'Email', value: (f) => f.email },
      { label: 'Phone', value: (f) => f.phone },
      { label: 'State', value: (f) => f.state },
      { label: 'Address', value: (f) => f.address },
      { label: 'Plan', value: (f) => f.subscription?.plan || f.plan },
      { label: 'Subscription status', value: (f) => f.subscription?.status || '' },
      { label: 'Renewal date', value: (f) => (f.subscription?.endDate ? new Date(f.subscription.endDate).toISOString().slice(0, 10) : '') },
      { label: 'Status', value: (f) => (f.isActive ? 'Active' : 'Inactive') },
      { label: 'Staff', value: (f) => f._count.users },
      { label: 'Patients', value: (f) => f._count.patients },
      { label: 'Encounters', value: (f) => f._count.cases },
      { label: 'Registered', value: (f) => new Date(f.createdAt).toISOString().slice(0, 10) },
    ]);

    audit(req, 'platform.facilities.export', `${facilities.length} rows`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="awibi-facilities-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

router.get('/export/payments', guard, async (req, res, next) => {
  try {
    const invoices = await prisma.invoice.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        facility: { select: { name: true, type: true } },
        patient: { select: { universalPatientId: true } },
      },
    });

    const csv = toCsv(invoices, [
      { label: 'Reference', value: (i) => i.invoiceNumber },
      { label: 'Facility', value: (i) => i.facility?.name },
      { label: 'Facility type', value: (i) => i.facility?.type },
      // Patient identity is deliberately reduced to the opaque UPID in a
      // platform-wide export — operators do not need names to reconcile revenue.
      { label: 'Patient UPID', value: (i) => i.patient?.universalPatientId },
      { label: 'Amount billed', value: (i) => i.total },
      { label: 'Amount paid', value: (i) => i.amountPaid },
      { label: 'Balance', value: (i) => i.balance },
      { label: 'Status', value: (i) => i.paymentStatus },
      { label: 'Paid at', value: (i) => (i.paidAt ? new Date(i.paidAt).toISOString() : '') },
      { label: 'Created', value: (i) => new Date(i.createdAt).toISOString().slice(0, 10) },
    ]);

    audit(req, 'platform.payments.export', `${invoices.length} rows`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="awibi-payments-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  } catch (e) { next(e); }
});

module.exports = router;
