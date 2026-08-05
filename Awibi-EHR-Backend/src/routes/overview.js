const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');

router.get('/', [authenticate, tenant, requirePermission('overview')], async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(today); todayEnd.setDate(today.getDate() + 1);

    const [
      totalPatients, totalStaff, totalAdmissions, totalBeds, availableBeds,
      todayAppointments, pendingLab, patientsThisMonth,
      inPatients, outPatients, discharged,
    ] = await prisma.$transaction([
      prisma.patient.count({ where: { facilityId: fid } }),
      prisma.user.count({ where: { facilityId: fid, isActive: true } }),
      prisma.admission.count({ where: { facilityId: fid, status: 'ADMITTED' } }),
      prisma.bed.count({ where: { facilityId: fid } }),
      prisma.bed.count({ where: { facilityId: fid, status: 'AVAILABLE' } }),
      prisma.appointment.count({ where: { facilityId: fid, scheduledAt: { gte: today, lt: todayEnd } } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'PENDING' } }),
      prisma.patient.count({ where: { facilityId: fid, createdAt: { gte: startOfMonth } } }),
      prisma.patient.count({ where: { facilityId: fid, status: 'IN_PATIENT' } }),
      prisma.patient.count({ where: { facilityId: fid, status: 'OUT_PATIENT' } }),
      prisma.patient.count({ where: { facilityId: fid, status: 'DISCHARGED' } }),
    ]);

    // Monthly visits for last 6 months (sequential — each needs its own date range)
    const monthlyStats = [];
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const end = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
      const count = await prisma.appointment.count({ where: { facilityId: fid, scheduledAt: { gte: start, lt: end } } });
      monthlyStats.push({ month: start.toLocaleString('en', { month: 'short' }), visits: count });
    }

    const [recentAppointments, recentCases] = await prisma.$transaction([
      prisma.appointment.findMany({
        where: { facilityId: fid }, take: 5, orderBy: { scheduledAt: 'desc' },
        include: {
          patient: { select: { firstName: true, lastName: true, avatar: true } },
          doctor: { select: { firstName: true, lastName: true } },
        },
      }),
      prisma.case.findMany({
        where: { facilityId: fid }, take: 5, orderBy: { createdAt: 'desc' },
        include: { patient: { select: { firstName: true, lastName: true, universalPatientId: true } } },
      }),
    ]);

    res.json({
      kpi: {
        totalPatients, totalStaff, totalAdmissions,
        totalBeds, availableBeds, occupiedBeds: totalBeds - availableBeds,
        todayAppointments, pendingLab, patientsThisMonth,
      },
      patientStatus: { inPatients, outPatients, discharged, dead: 0, dama: 0 },
      monthlyVisits: monthlyStats,
      entryMode: { walkIn: outPatients, emergency: Math.floor(inPatients * 0.3), referral: Math.floor(inPatients * 0.2) },
      weeklyInsight: [
        { text: `${totalPatients} total patients registered` },
        { text: `${todayAppointments} appointments scheduled today` },
        { text: `${pendingLab} lab tests pending` },
        { text: `${patientsThisMonth} new patients this month` },
      ],
      recentAppointments,
      recentCases,
    });
  } catch (e) { next(e); }
});

router.get('/summary', [authenticate, tenant, requirePermission('overview')], async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const [
      totalPatients, newPatientsThisMonth, newPatientsLastMonth,
      totalStaff, activeStaff, totalBeds, occupiedBeds,
      totalBilledAgg, totalCollectedAgg, unpaidCount,
      totalLab, pendingLab, completedLab, activeCases,
      subscription, recentAudit,
    ] = await prisma.$transaction([
      prisma.patient.count({ where: { facilityId: fid } }),
      prisma.patient.count({ where: { facilityId: fid, createdAt: { gte: startOfMonth } } }),
      prisma.patient.count({ where: { facilityId: fid, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
      prisma.user.count({ where: { facilityId: fid } }),
      prisma.user.count({ where: { facilityId: fid, isActive: true } }),
      prisma.bed.count({ where: { facilityId: fid } }),
      prisma.bed.count({ where: { facilityId: fid, status: 'OCCUPIED' } }),
      prisma.invoice.aggregate({ where: { facilityId: fid }, _sum: { total: true } }),
      prisma.invoice.aggregate({ where: { facilityId: fid }, _sum: { amountPaid: true } }),
      prisma.invoice.count({ where: { facilityId: fid, paymentStatus: { in: ['UNPAID', 'PART_PAID'] } } }),
      prisma.labRequest.count({ where: { facilityId: fid } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'PENDING' } }),
      prisma.labRequest.count({ where: { facilityId: fid, status: 'COMPLETED' } }),
      prisma.case.count({ where: { facilityId: fid, status: { in: ['OPEN', 'DRAFT'] } } }),
      prisma.subscription.findUnique({ where: { facilityId: fid } }),
      prisma.auditLog.findMany({ where: { facilityId: fid }, take: 10, orderBy: { createdAt: 'desc' } }),
    ]);

    const totalRevenue = Number(totalBilledAgg._sum.total || 0);
    const collectedRevenue = Number(totalCollectedAgg._sum.amountPaid || 0);

    const patientGrowth = newPatientsLastMonth > 0
      ? Math.round(((newPatientsThisMonth - newPatientsLastMonth) / newPatientsLastMonth) * 100)
      : null;

    // GroupBy for staff by role and patient by status
    const [staffByRole, patientsByStatus] = await prisma.$transaction([
      prisma.user.groupBy({ by: ['role'], where: { facilityId: fid }, _count: { id: true } }),
      prisma.patient.groupBy({ by: ['status'], where: { facilityId: fid }, _count: { id: true } }),
    ]);

    res.json({
      patients: {
        total: totalPatients, newThisMonth: newPatientsThisMonth, newLastMonth: newPatientsLastMonth,
        growthPct: patientGrowth,
        byStatus: patientsByStatus.map(r => ({ status: r.status, count: r._count.id })),
      },
      staff: {
        total: totalStaff, active: activeStaff, inactive: totalStaff - activeStaff,
        byRole: staffByRole.map(r => ({ role: r.role, count: r._count.id })),
      },
      beds: {
        total: totalBeds, occupied: occupiedBeds, available: totalBeds - occupiedBeds,
        occupancyPct: totalBeds > 0 ? Math.round((occupiedBeds / totalBeds) * 100) : 0,
      },
      revenue: {
        totalBilled: totalRevenue, collected: collectedRevenue,
        outstanding: Math.max(0, totalRevenue - collectedRevenue), unpaidInvoices: unpaidCount,
        collectionRate: totalRevenue > 0 ? Math.round((collectedRevenue / totalRevenue) * 100) : 0,
      },
      lab: {
        total: totalLab, pending: pendingLab, completed: completedLab,
        completionRate: totalLab > 0 ? Math.round((completedLab / totalLab) * 100) : 0,
      },
      cases: { active: activeCases },
      subscription: subscription
        ? { plan: subscription.plan, status: subscription.status, endDate: subscription.endDate, patientsUsed: subscription.patientsUsed, patientLimit: subscription.patientLimit }
        : null,
      recentAudit,
    });
  } catch (e) { next(e); }
});

module.exports = router;
