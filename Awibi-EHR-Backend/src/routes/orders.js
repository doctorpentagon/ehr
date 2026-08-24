const express = require('express');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient, requireTenantCase } = require('../utils/tenantRecords');
const { templateFor } = require('../utils/monitoringTemplates');
const { inferMonitoringType } = require('../utils/orderRouting');

const read = [authenticate, tenant, requirePermission('orders')];
// Only a prescriber creates medication and nursing orders.
const prescribe = [authenticate, tenant, requirePermission('prescriptions_write')];
// Nurses execute them.
const execute = [authenticate, tenant, requirePermission('drug_admin_write')];
const catalogueWrite = [authenticate, tenant, requirePermission('settings')];
const pharmacyRead = [authenticate, tenant, requirePermission('pharmacy')];
const pharmacyWrite = [authenticate, tenant, requirePermission('pharmacy_write')];
const inventoryWrite = [authenticate, tenant, requirePermission('inventory_write')];
const medicationSafetyRead = [authenticate, tenant, requirePermission('medication_safety')];

const THERAPY_PROBLEM_CATEGORIES = new Set([
  'NEEDS_ADDITIONAL_THERAPY', 'UNNECESSARY_THERAPY', 'INEFFECTIVE_THERAPY',
  'DOSE_TOO_LOW', 'DOSE_TOO_HIGH', 'ADVERSE_DRUG_REACTION', 'NON_ADHERENCE',
  'DRUG_INTERACTION', 'MONITORING_REQUIRED', 'OTHER',
]);
const DRUG_ROUTES = new Set(['ORAL', 'IV', 'IM', 'SC', 'TOPICAL', 'RECTAL', 'INHALATION', 'SUBLINGUAL', 'OTHER']);

function pharmacyInventoryPayload(body = {}, { partial = false } = {}) {
  const text = (value) => String(value || '').trim() || null;
  const number = (value, label, fallback) => {
    if ((value === undefined || value === '') && partial) return undefined;
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isFinite(parsed) || parsed < 0) throw Object.assign(new Error(`${label} must be zero or more`), { status: 400 });
    return parsed;
  };
  const route = body.defaultRoute === undefined && partial ? undefined : String(body.defaultRoute || 'ORAL').toUpperCase();
  if (route !== undefined && !DRUG_ROUTES.has(route)) throw Object.assign(new Error('Choose a valid medicine route'), { status: 400 });
  const name = body.name === undefined && partial ? undefined : text(body.name);
  if (name === null) throw Object.assign(new Error('Medicine name is required'), { status: 400 });
  const nextExpiryDate = body.nextExpiryDate === undefined && partial
    ? undefined
    : body.nextExpiryDate ? new Date(body.nextExpiryDate) : null;
  if (nextExpiryDate && Number.isNaN(nextExpiryDate.getTime())) throw Object.assign(new Error('Enter a valid expiry date'), { status: 400 });
  const unitPrice = number(body.unitPrice, 'unitPrice', 0);
  const stockOnHand = number(body.stockOnHand, 'stockOnHand', 0);
  const reorderLevel = number(body.reorderLevel, 'reorderLevel', 0);
  return {
    ...(name !== undefined ? { name } : {}),
    ...(body.genericName !== undefined || !partial ? { genericName: text(body.genericName) } : {}),
    ...(body.form !== undefined || !partial ? { form: text(body.form) } : {}),
    ...(body.strength !== undefined || !partial ? { strength: text(body.strength) } : {}),
    ...(route !== undefined ? { defaultRoute: route } : {}),
    ...(body.defaultDose !== undefined || !partial ? { defaultDose: text(body.defaultDose) } : {}),
    ...(body.defaultFrequency !== undefined || !partial ? { defaultFrequency: text(body.defaultFrequency) } : {}),
    ...(body.category !== undefined || !partial ? { category: text(body.category) } : {}),
    ...(unitPrice !== undefined ? { unitPrice } : {}),
    ...(stockOnHand !== undefined ? { stockOnHand } : {}),
    ...(reorderLevel !== undefined ? { reorderLevel } : {}),
    ...(body.unitLabel !== undefined || !partial ? { unitLabel: text(body.unitLabel) } : {}),
    ...(nextExpiryDate !== undefined ? { nextExpiryDate } : {}),
    ...(body.isControlled !== undefined || !partial ? { isControlled: Boolean(body.isControlled) } : {}),
  };
}

function medicationSafetySummary(patient, prescriptions, therapyProblems = []) {
  const active = prescriptions.filter((item) => item.status === 'ACTIVE');
  const warnings = [];
  const byName = new Map();
  for (const medicine of active) {
    const key = String(medicine.drugName || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!key) continue;
    if (byName.has(key)) {
      warnings.push({
        kind: 'POSSIBLE_DUPLICATE', severity: 'HIGH', medicines: [byName.get(key).drugName, medicine.drugName],
        message: `Possible duplicate active therapy: ${medicine.drugName}. Confirm indication and intended regimen.`,
      });
    } else byName.set(key, medicine);
  }
  for (const allergy of patient.allergies || []) {
    const substance = String(allergy.substance || '').trim().toLowerCase();
    if (substance.length < 3) continue;
    for (const medicine of active) {
      const name = String(medicine.drugName || '').toLowerCase();
      if (name.includes(substance) || substance.includes(name)) {
        warnings.push({
          kind: 'POSSIBLE_ALLERGY_MATCH', severity: allergy.severity === 'SEVERE' ? 'CRITICAL' : 'HIGH',
          medicines: [medicine.drugName],
          message: `${medicine.drugName} may match recorded allergy “${allergy.substance}”. Verify before supply or administration.`,
        });
      }
    }
  }
  for (const problem of therapyProblems.filter((item) => item.status !== 'RESOLVED' && item.category === 'DRUG_INTERACTION')) {
    warnings.push({
      kind: 'PHARMACIST_RECORDED_INTERACTION', severity: problem.severity,
      medicines: problem.prescription?.drugName ? [problem.prescription.drugName] : [],
      message: problem.description,
    });
  }
  return {
    status: warnings.some((item) => item.severity === 'CRITICAL') ? 'CRITICAL'
      : warnings.length ? 'REVIEW_REQUIRED' : 'PARTIAL_SCREEN_NO_LOCAL_FLAGS',
    warnings,
    scope: 'Checks active medicines against recorded allergies, duplicates and pharmacist warnings.',
    authoritativeInteractionSourceConfigured: false,
    limitation: 'This does not check every possible drug interaction. Confirm with an approved medicine reference.',
  };
}

// Prisma orders enums by DECLARATION order, and NursingTaskPriority is declared
// ROUTINE, URGENT, STAT — so `priority: 'asc'` would sink a STAT task to the
// bottom of a nurse's worklist. Sort by explicit clinical rank instead.
const PRIORITY_RANK = { STAT: 0, URGENT: 1, ROUTINE: 2 };
function byClinicalPriority(a, b) {
  const p = (PRIORITY_RANK[a.priority] ?? 9) - (PRIORITY_RANK[b.priority] ?? 9);
  if (p !== 0) return p;
  // Then soonest due, with undated tasks last.
  const at = a.dueAt ? new Date(a.dueAt).getTime() : Infinity;
  const bt = b.dueAt ? new Date(b.dueAt).getTime() : Infinity;
  return at - bt;
}

function audit(req, action, resource, resourceId, reason) {
  prisma.auditLog.create({
    data: {
      facilityId: req.ctx.facilityId, userId: req.ctx.userId, action,
      resource, resourceId, reason: reason || 'Order management', ip: req.ip,
    },
  }).catch(() => {});
}

// ── Drug catalogue ──────────────────────────────────────────────────────────
// Declared before any '/:id' route.
router.get('/drug-catalogue', read, async (req, res, next) => {
  try {
    const { search, limit = 20 } = req.query;
    const where = { facilityId: req.ctx.facilityId, isActive: true };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { genericName: { contains: search, mode: 'insensitive' } },
      ];
    }
    const drugs = await prisma.drugCatalogue.findMany({
      where, take: Math.min(Number(limit) || 20, 50), orderBy: { name: 'asc' },
    });
    res.json({ drugs, total: drugs.length });
  } catch (e) { next(e); }
});

router.post('/drug-catalogue', catalogueWrite, async (req, res, next) => {
  try {
    const { name, genericName, form, strength, defaultRoute, defaultDose, defaultFrequency, category, unitPrice, isControlled } = req.body || {};
    if (!name) return res.status(400).json({ error: 'name is required' });
    const drug = await prisma.drugCatalogue.create({
      data: {
        facilityId: req.ctx.facilityId, name,
        genericName: genericName || null, form: form || null, strength: strength || null,
        defaultRoute: defaultRoute || 'ORAL', defaultDose: defaultDose || null,
        defaultFrequency: defaultFrequency || null, category: category || null,
        unitPrice: unitPrice != null ? Number(unitPrice) : 0,
        isControlled: Boolean(isControlled),
      },
    });
    res.status(201).json(drug);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That drug and strength already exists' });
    next(e);
  }
});

// ── Pharmacy dispensing and inventory ──────────────────────────────────────
router.get('/pharmacy/queue', pharmacyRead, async (req, res, next) => {
  try {
    const { status = 'ACTIVE', search } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (status && status !== 'ALL') where.status = status;
    if (search) {
      where.OR = [
        { drugName: { contains: search, mode: 'insensitive' } },
        { patient: { is: { firstName: { contains: search, mode: 'insensitive' } } } },
        { patient: { is: { lastName: { contains: search, mode: 'insensitive' } } } },
        { patient: { is: { mrn: { contains: search, mode: 'insensitive' } } } },
        { patient: { is: { universalPatientId: { contains: search, mode: 'insensitive' } } } },
      ];
    }
    const prescriptions = await prisma.prescription.findMany({
      where, orderBy: { createdAt: 'asc' }, take: 100,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true, universalPatientId: true, dateOfBirth: true, gender: true } },
        dispenses: { orderBy: { dispensedAt: 'desc' } },
      },
    });
    const prescriberIds = [...new Set(prescriptions.map((item) => item.prescribedById).filter(Boolean))];
    const prescribers = prescriberIds.length ? await prisma.user.findMany({
      where: { id: { in: prescriberIds }, facilityId: req.ctx.facilityId },
      select: { id: true, firstName: true, lastName: true, staffId: true },
    }) : [];
    const names = Object.fromEntries(prescribers.map((item) => [item.id, item]));
    res.json({
      prescriptions: prescriptions.map((item) => ({ ...item, prescribedBy: names[item.prescribedById] || null })),
      total: prescriptions.length,
    });
  } catch (e) { next(e); }
});

// ── Clinical pharmacy: patient medication review and care plan ─────────────
router.get('/pharmacy/patient/:patientId', pharmacyRead, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const scope = { facilityId: req.ctx.facilityId, patientId: req.params.patientId };
    const [patient, prescriptions, therapyProblems, carePlans] = await prisma.$transaction([
      prisma.patient.findFirst({
        where: { id: req.params.patientId, facilityId: req.ctx.facilityId },
        select: {
          id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true,
          dateOfBirth: true, gender: true, allergies: true,
          conditions: { where: { status: { in: ['ACTIVE', 'CHRONIC'] } }, orderBy: { updatedAt: 'desc' } },
        },
      }),
      prisma.prescription.findMany({
        where: scope, orderBy: { createdAt: 'desc' },
        include: { dispenses: { orderBy: { dispensedAt: 'desc' } } },
      }),
      prisma.pharmacyTherapyProblem.findMany({
        where: scope, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
        include: {
          prescription: { select: { id: true, drugName: true, dosage: true, status: true } },
          identifiedBy: { select: { id: true, firstName: true, lastName: true, staffId: true } },
        },
      }),
      prisma.pharmacyCarePlan.findMany({
        where: scope, orderBy: { createdAt: 'desc' }, take: 30,
        include: { pharmacist: { select: { id: true, firstName: true, lastName: true, staffId: true } } },
      }),
    ]);
    res.json({
      patient, prescriptions, therapyProblems, carePlans,
      safety: medicationSafetySummary(patient, prescriptions, therapyProblems),
    });
  } catch (e) { next(e); }
});

// Doctors, nurses and pharmacists may all read the same medication-safety
// summary. Only pharmacists author DTPs and pharmaceutical care plans.
router.get('/medication-safety/:patientId', medicationSafetyRead, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const patient = await prisma.patient.findFirst({
      where: { id: req.params.patientId, facilityId: req.ctx.facilityId },
      select: { id: true, firstName: true, lastName: true, allergies: true },
    });
    const prescriptions = await prisma.prescription.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    const therapyProblems = await prisma.pharmacyTherapyProblem.findMany({
      where: { patientId: req.params.patientId, facilityId: req.ctx.facilityId, status: { not: 'RESOLVED' } },
      include: { prescription: { select: { drugName: true } } },
    });
    res.json({ patient, safety: medicationSafetySummary(patient, prescriptions, therapyProblems) });
  } catch (e) { next(e); }
});

router.post('/pharmacy/problems', pharmacyWrite, async (req, res, next) => {
  try {
    const { patientId, prescriptionId, category, problemType, severity, description, evidence, recommendation } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!THERAPY_PROBLEM_CATEGORIES.has(category)) return res.status(400).json({ error: 'Choose a valid Drug Therapy Problem category' });
    if (!['ACTUAL', 'POTENTIAL'].includes(problemType)) return res.status(400).json({ error: 'problemType must be ACTUAL or POTENTIAL' });
    if (!['LOW', 'MODERATE', 'HIGH', 'CRITICAL'].includes(severity)) return res.status(400).json({ error: 'Choose a valid severity' });
    if (String(description || '').trim().length < 5) return res.status(400).json({ error: 'Describe the therapy problem' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (prescriptionId) {
      const prescription = await prisma.prescription.findFirst({ where: { id: prescriptionId, patientId, facilityId: req.ctx.facilityId } });
      if (!prescription) return res.status(404).json({ error: 'Linked prescription not found for this patient' });
    }
    const problem = await prisma.pharmacyTherapyProblem.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, prescriptionId: prescriptionId || null,
        identifiedById: req.ctx.userId, category, problemType, severity,
        description: String(description).trim(), evidence: String(evidence || '').trim() || null,
        recommendation: String(recommendation || '').trim() || null,
      },
    });
    audit(req, 'pharmacy.dtp.create', 'PharmacyTherapyProblem', problem.id, `${severity} ${category}`);
    res.status(201).json(problem);
  } catch (e) { next(e); }
});

router.put('/pharmacy/problems/:id/status', pharmacyWrite, async (req, res, next) => {
  try {
    const problem = await prisma.pharmacyTherapyProblem.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!problem) return res.status(404).json({ error: 'Drug Therapy Problem not found' });
    const { status, resolution } = req.body || {};
    if (!['OPEN', 'IN_REVIEW', 'RESOLVED'].includes(status)) return res.status(400).json({ error: 'Invalid problem status' });
    if (status === 'RESOLVED' && String(resolution || '').trim().length < 3) return res.status(400).json({ error: 'Record the resolution before closure' });
    const saved = await prisma.pharmacyTherapyProblem.update({
      where: { id: problem.id },
      data: {
        status, resolution: String(resolution || '').trim() || problem.resolution,
        resolvedAt: status === 'RESOLVED' ? new Date() : null,
      },
    });
    audit(req, 'pharmacy.dtp.status', 'PharmacyTherapyProblem', saved.id, `${problem.status} to ${status}`);
    res.json(saved);
  } catch (e) { next(e); }
});

router.post('/pharmacy/care-plans', pharmacyWrite, async (req, res, next) => {
  try {
    const {
      patientId, documentationFormat = 'SOAP', subjective, objective, assessment, plan,
      coreCondition, coreOutcomes, coreRegimen, coreEvaluation, primeProblems,
      farmFindings, farmAssessment, farmResolution, farmMonitoring, patientNeeds,
      therapyGoals, interventions, followUpPlan, adherence, followUpAt,
    } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!['SOAP', 'CORE_PRIME_FARM'].includes(documentationFormat)) {
      return res.status(400).json({ error: 'Choose SOAP or CORE–PRIME–FARM documentation' });
    }
    await requireTenantPatient(req.ctx.facilityId, patientId);
    const meaningful = [
      subjective, objective, assessment, plan,
      coreCondition, coreOutcomes, coreRegimen, coreEvaluation, primeProblems,
      farmFindings, farmAssessment, farmResolution, farmMonitoring,
      patientNeeds, therapyGoals, interventions, followUpPlan,
    ]
      .some((value) => String(value || '').trim().length >= 3);
    if (!meaningful) return res.status(400).json({ error: 'Enter at least one meaningful SOAP or pharmaceutical-care section' });
    const carePlan = await prisma.pharmacyCarePlan.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, pharmacistId: req.ctx.userId,
        documentationFormat,
        subjective: String(subjective || '').trim() || null,
        objective: String(objective || '').trim() || null,
        assessment: String(assessment || '').trim() || null,
        plan: String(plan || '').trim() || null,
        coreCondition: String(coreCondition || '').trim() || null,
        coreOutcomes: String(coreOutcomes || '').trim() || null,
        coreRegimen: String(coreRegimen || '').trim() || null,
        coreEvaluation: String(coreEvaluation || '').trim() || null,
        primeProblems: String(primeProblems || '').trim() || null,
        farmFindings: String(farmFindings || '').trim() || null,
        farmAssessment: String(farmAssessment || '').trim() || null,
        farmResolution: String(farmResolution || '').trim() || null,
        farmMonitoring: String(farmMonitoring || '').trim() || null,
        patientNeeds: String(patientNeeds || '').trim() || null,
        therapyGoals: String(therapyGoals || '').trim() || null,
        interventions: String(interventions || '').trim() || null,
        followUpPlan: String(followUpPlan || '').trim() || null,
        adherence: String(adherence || '').trim() || null,
        followUpAt: followUpAt ? new Date(followUpAt) : null,
      },
    });
    audit(req, 'pharmacy.care-plan.create', 'PharmacyCarePlan', carePlan.id, 'Draft pharmaceutical care plan');
    res.status(201).json(carePlan);
  } catch (e) { next(e); }
});

router.post('/pharmacy/care-plans/:id/sign', pharmacyWrite, async (req, res, next) => {
  try {
    const carePlan = await prisma.pharmacyCarePlan.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!carePlan) return res.status(404).json({ error: 'Pharmaceutical care plan not found' });
    if (carePlan.status === 'SIGNED') return res.status(409).json({ error: 'This care plan is already signed' });
    if (carePlan.pharmacistId !== req.ctx.userId) return res.status(403).json({ error: 'Only the author can sign this care plan' });
    const signed = await prisma.pharmacyCarePlan.update({
      where: { id: carePlan.id }, data: { status: 'SIGNED', signedAt: new Date() },
    });
    audit(req, 'pharmacy.care-plan.sign', 'PharmacyCarePlan', signed.id, 'Signed pharmaceutical care plan');
    res.json(signed);
  } catch (e) { next(e); }
});

router.get('/pharmacy/inventory', pharmacyRead, async (req, res, next) => {
  try {
    const { search, stockStatus = 'ACTIVE' } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (stockStatus === 'ARCHIVED') where.isActive = false;
    else if (stockStatus !== 'ALL') where.isActive = true;
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { genericName: { contains: search, mode: 'insensitive' } },
      { category: { contains: search, mode: 'insensitive' } },
    ];
    const [matching, allItems] = await prisma.$transaction([
      prisma.drugCatalogue.findMany({ where, orderBy: [{ name: 'asc' }] }),
      prisma.drugCatalogue.findMany({ where: { facilityId: req.ctx.facilityId } }),
    ]);
    const items = matching.filter((item) => {
      if (stockStatus === 'LOW') return item.stockOnHand > 0 && item.stockOnHand <= item.reorderLevel;
      if (stockStatus === 'OUT') return item.stockOnHand <= 0;
      return true;
    }).slice(0, 300);
    const active = allItems.filter((item) => item.isActive);
    const lowStock = active.filter((item) => item.stockOnHand > 0 && item.stockOnHand <= item.reorderLevel).length;
    const outOfStock = active.filter((item) => item.stockOnHand <= 0).length;
    const expiringSoon = active.filter((item) => item.nextExpiryDate && new Date(item.nextExpiryDate).getTime() <= Date.now() + 90 * 86400000).length;
    res.json({ items, counts: { total: active.length, lowStock, outOfStock, expiringSoon, archived: allItems.length - active.length } });
  } catch (e) { next(e); }
});

router.post('/pharmacy/inventory', inventoryWrite, async (req, res, next) => {
  try {
    const data = pharmacyInventoryPayload(req.body);
    const item = await prisma.drugCatalogue.create({ data: { facilityId: req.ctx.facilityId, ...data } });
    audit(req, 'pharmacy.inventory.create', 'DrugCatalogue', item.id, `Added ${item.name} to facility stock`);
    res.status(201).json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That medicine and strength already exists in this facility' });
    next(e);
  }
});

router.put('/pharmacy/inventory/:id', inventoryWrite, async (req, res, next) => {
  try {
    const existing = await prisma.drugCatalogue.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Medicine not found in this facility formulary' });
    const data = pharmacyInventoryPayload(req.body, { partial: true });
    const item = await prisma.drugCatalogue.update({
      where: { id: existing.id },
      data,
    });
    audit(req, 'pharmacy.inventory.update', 'DrugCatalogue', item.id, `Updated ${item.name}; stock ${item.stockOnHand} ${item.unitLabel || 'units'}`);
    res.json(item);
  } catch (e) {
    if (e.code === 'P2002') return res.status(409).json({ error: 'That medicine and strength already exists in this facility' });
    next(e);
  }
});

router.delete('/pharmacy/inventory/:id', inventoryWrite, async (req, res, next) => {
  try {
    const reason = String(req.body?.reason || '').trim();
    if (reason.length < 3) return res.status(400).json({ error: 'Enter a reason for archiving this stock item' });
    const existing = await prisma.drugCatalogue.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Medicine not found in this facility formulary' });
    if (!existing.isActive) return res.status(409).json({ error: 'This stock item is already archived' });
    const item = await prisma.drugCatalogue.update({ where: { id: existing.id }, data: { isActive: false } });
    audit(req, 'pharmacy.inventory.archive', 'DrugCatalogue', item.id, reason);
    res.json(item);
  } catch (e) { next(e); }
});

router.post('/pharmacy/inventory/:id/restore', inventoryWrite, async (req, res, next) => {
  try {
    const existing = await prisma.drugCatalogue.findFirst({ where: { id: req.params.id, facilityId: req.ctx.facilityId } });
    if (!existing) return res.status(404).json({ error: 'Archived medicine not found in this facility' });
    if (existing.isActive) return res.status(409).json({ error: 'This stock item is already active' });
    const item = await prisma.drugCatalogue.update({ where: { id: existing.id }, data: { isActive: true } });
    audit(req, 'pharmacy.inventory.restore', 'DrugCatalogue', item.id, 'Restored facility stock item');
    res.json(item);
  } catch (e) { next(e); }
});

router.post('/pharmacy/dispense/:prescriptionId', pharmacyWrite, async (req, res, next) => {
  try {
    const prescription = await prisma.prescription.findFirst({
      where: { id: req.params.prescriptionId, facilityId: req.ctx.facilityId },
    });
    if (!prescription) return res.status(404).json({ error: 'Prescription not found' });
    if (prescription.status === 'CANCELLED') return res.status(409).json({ error: 'A cancelled prescription cannot be dispensed' });

    const { drugCatalogueId, quantity, unit, notes, complete = true } = req.body || {};
    const qty = Number(quantity);
    if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: 'Enter a quantity greater than zero' });
    const stockItem = await prisma.drugCatalogue.findFirst({
      where: { id: drugCatalogueId, facilityId: req.ctx.facilityId, isActive: true },
    });
    if (!stockItem) return res.status(404).json({ error: 'Choose the matching medicine from facility stock' });
    if (stockItem.isControlled && String(notes || '').trim().length < 3) {
      return res.status(400).json({ error: 'Controlled medicine dispensing needs a register or witness note' });
    }
    if (stockItem.stockOnHand < qty) return res.status(409).json({ error: `Only ${stockItem.stockOnHand} ${stockItem.unitLabel || 'units'} available` });

    const amount = Number(stockItem.unitPrice) * qty;
    const result = await prisma.$transaction(async (tx) => {
      const reduced = await tx.drugCatalogue.updateMany({
        where: { id: stockItem.id, facilityId: req.ctx.facilityId, stockOnHand: { gte: qty } },
        data: { stockOnHand: { decrement: qty } },
      });
      if (reduced.count !== 1) throw Object.assign(new Error('Stock changed while dispensing; check the quantity and try again'), { status: 409 });
      const dispense = await tx.dispense.create({
        data: {
          facilityId: req.ctx.facilityId, prescriptionId: prescription.id, patientId: prescription.patientId,
          drugCatalogueId: stockItem.id, quantity: qty, unit: unit || stockItem.unitLabel || null,
          unitPrice: Number(stockItem.unitPrice), amount, dispensedById: req.ctx.userId,
          notes: String(notes || '').trim() || null,
        },
      });
      const updatedPrescription = await tx.prescription.update({
        where: { id: prescription.id },
        data: { dispensedAt: new Date(), ...(complete ? { status: 'COMPLETED' } : {}) },
      });
      return { dispense, prescription: updatedPrescription };
    });
    audit(req, 'pharmacy.dispense', 'Prescription', prescription.id, `${qty} ${stockItem.unitLabel || 'units'} of ${stockItem.name}; NGN ${amount}`);
    res.status(201).json({ ...result, amount, remainingStock: stockItem.stockOnHand - qty });
  } catch (e) { next(e); }
});

// ── Unified order view for a patient ────────────────────────────────────────
router.get('/patient/:patientId', read, async (req, res, next) => {
  try {
    await requireTenantPatient(req.ctx.facilityId, req.params.patientId);
    const scope = { patientId: req.params.patientId, facilityId: req.ctx.facilityId };

    const [medications, investigations, tasks, standingOrders] = await prisma.$transaction([
      prisma.prescription.findMany({
        where: { ...scope, status: 'ACTIVE' }, orderBy: { createdAt: 'desc' },
        include: { administrations: { orderBy: { administeredAt: 'desc' }, take: 20 } },
      }),
      prisma.labRequest.findMany({
        where: { ...scope, status: { notIn: ['CANCELLED'] } }, orderBy: { createdAt: 'desc' }, take: 25,
      }),
      prisma.nursingTask.findMany({
        where: { ...scope, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.order.findMany({
        where: { ...scope, status: { in: ['ACTIVE', 'HELD'] } },
        orderBy: { createdAt: 'desc' }, take: 25,
      }),
    ]);

    res.json({ medications, investigations, nursingTasks: tasks, standingOrders });
  } catch (e) { next(e); }
});

// ── Medication orders ───────────────────────────────────────────────────────
router.post('/medications', prescribe, async (req, res, next) => {
  try {
    const { patientId, caseId, medications } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    const list = Array.isArray(medications) && medications.length ? medications : [req.body];
    const created = [];
    for (const m of list) {
      if (!m.drugName) return res.status(400).json({ error: 'Each medication needs a drugName' });
      created.push(await prisma.prescription.create({
        data: {
          facilityId: req.ctx.facilityId, patientId, caseId: caseId || null,
          prescribedById: req.ctx.userId,
          drugName: m.drugName,
          dosage: m.dosage || null,
          frequency: m.frequency || null,
          duration: m.duration || null,
          route: m.route || 'ORAL',
          instructions: m.instructions || null,
        },
      }));
    }

    audit(req, 'order.medication.create', 'Prescription', created[0]?.id, `${created.length} medication(s) prescribed`);
    res.status(201).json({ medications: created, count: created.length });
  } catch (e) { next(e); }
});

// ── Nursing tasks ───────────────────────────────────────────────────────────
router.get('/nursing-tasks', read, async (req, res, next) => {
  try {
    const { status, patientId, limit = 50 } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) where.patientId = patientId;
    where.status = status && status !== 'ALL' ? status : { in: ['PENDING', 'IN_PROGRESS'] };

    const tasks = await prisma.nursingTask.findMany({
      where, take: Math.min(Number(limit) || 50, 100),
      orderBy: { createdAt: 'desc' },
      include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
    });

    const now = Date.now();
    res.json({
      tasks: tasks
        .map((t) => ({ ...t, isOverdue: Boolean(t.dueAt && new Date(t.dueAt).getTime() < now && t.status !== 'COMPLETED') }))
        .sort(byClinicalPriority),
      total: tasks.length,
    });
  } catch (e) { next(e); }
});

router.post('/nursing-tasks', prescribe, async (req, res, next) => {
  try {
    const { patientId, caseId, title, instructions, priority, frequencyHours, dueAt } = req.body || {};
    if (!patientId) return res.status(400).json({ error: 'patientId is required' });
    if (!title) return res.status(400).json({ error: 'title is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId, patientId);

    const task = await prisma.nursingTask.create({
      data: {
        facilityId: req.ctx.facilityId, patientId, caseId: caseId || null,
        orderedById: req.ctx.userId,
        title, instructions: instructions || null,
        priority: priority || 'ROUTINE',
        frequencyHours: frequencyHours != null ? Number(frequencyHours) : null,
        // An order with no explicit time is due now — nursing should see it.
        dueAt: dueAt ? new Date(dueAt) : new Date(),
      },
    });
    audit(req, 'order.nursing_task.create', 'NursingTask', task.id, title);
    res.status(201).json(task);
  } catch (e) { next(e); }
});

// Completing a task is a nursing action, not a prescribing one.
router.post('/nursing-tasks/:id/complete', execute, async (req, res, next) => {
  try {
    const existing = await prisma.nursingTask.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    if (existing.status === 'COMPLETED') return res.status(409).json({ error: 'Task is already completed' });

    const { note } = req.body || {};

    const task = await prisma.$transaction(async (tx) => {
      const done = await tx.nursingTask.update({
        where: { id: existing.id },
        data: {
          status: 'COMPLETED',
          completedById: req.ctx.userId,
          completedAt: new Date(),
          completionNote: note || null,
        },
      });

      // A recurring task regenerates itself so the ward never loses the rhythm.
      if (existing.frequencyHours) {
        await tx.nursingTask.create({
          data: {
            facilityId: existing.facilityId, patientId: existing.patientId, caseId: existing.caseId,
            orderedById: existing.orderedById,
            title: existing.title, instructions: existing.instructions,
            priority: existing.priority, frequencyHours: existing.frequencyHours,
            dueAt: new Date(Date.now() + existing.frequencyHours * 3600 * 1000),
          },
        });
      }
      return done;
    });

    audit(req, 'order.nursing_task.complete', 'NursingTask', task.id, note || 'Task completed');
    res.json(task);
  } catch (e) { next(e); }
});

router.patch('/nursing-tasks/:id', execute, async (req, res, next) => {
  try {
    const existing = await prisma.nursingTask.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!existing) return res.status(404).json({ error: 'Task not found' });
    const { status } = req.body || {};
    if (!status) return res.status(400).json({ error: 'status is required' });
    if (status === 'COMPLETED') return res.status(400).json({ error: 'Use the complete endpoint to finish a task' });

    const task = await prisma.nursingTask.update({ where: { id: existing.id }, data: { status } });
    res.json(task);
  } catch (e) { next(e); }
});

// ── Nurse execution worklist ────────────────────────────────────────────────
router.get('/worklist', [authenticate, tenant, requirePermission('drug_admin')], async (req, res, next) => {
  try {
    const fid = req.ctx.facilityId;
    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);

    const [tasks, prescriptions, specimens] = await prisma.$transaction([
      prisma.nursingTask.findMany({
        where: { facilityId: fid, status: { in: ['PENDING', 'IN_PROGRESS'] } },
        orderBy: { createdAt: 'desc' }, take: 50,
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
      prisma.prescription.findMany({
        where: { facilityId: fid, status: 'ACTIVE' },
        orderBy: { createdAt: 'desc' }, take: 50,
        include: {
          patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } },
          administrations: { where: { administeredAt: { gte: startOfDay } }, orderBy: { administeredAt: 'desc' } },
        },
      }),
      // Specimens a nurse still needs to collect.
      prisma.labRequest.findMany({
        where: { facilityId: fid, status: { in: ['PENDING', 'ACCEPTED'] } },
        orderBy: [{ priority: 'desc' }, { createdAt: 'asc' }], take: 30,
        include: { patient: { select: { id: true, firstName: true, lastName: true, universalPatientId: true } } },
      }),
    ]);

    const now = Date.now();
    res.json({
      tasks: tasks
        .map((t) => ({ ...t, isOverdue: Boolean(t.dueAt && new Date(t.dueAt).getTime() < now) }))
        .sort(byClinicalPriority),
      medications: prescriptions.map((p) => ({ ...p, givenToday: p.administrations.length })),
      specimensToCollect: specimens,
      counts: {
        tasks: tasks.length,
        overdueTasks: tasks.filter((t) => t.dueAt && new Date(t.dueAt).getTime() < now).length,
        medications: prescriptions.length,
        specimens: specimens.length,
      },
    });
  } catch (e) { next(e); }
});

// ── Standing orders and their execution history ─────────────────────────────
//
// The nursing task list answers "what is due now". These answer "what was
// instructed, by whom, toward what goal, and has it actually been happening" —
// which is what a ward round and an audit both need, and what a single-completion
// task could never show.

const ORDER_TYPES = ['MEDICATION', 'NURSING', 'DIET', 'ACTIVITY', 'TREATMENT', 'LAB', 'IMAGING'];

/**
 * Guess which chart an order is asking for, from how the doctor wrote it.
 *
 * Doctors write instructions in words, not enum values. Recognising the common
 * phrasings means a nurse is prompted to open the right chart instead of the
 * order sitting there while somebody remembers to start one by hand. Order
 * matters — "catheter output" should match the catheter chart, not fluid balance.
 */
const ORDER_STATUSES = ['ACTIVE', 'COMPLETED', 'DISCONTINUED', 'HELD'];
const EXECUTION_OUTCOMES = ['DONE', 'SKIPPED', 'UNABLE'];

/**
 * When the next occurrence of a recurring order is due, and whether it is late.
 *
 * Overdue is judged from the last execution rather than from the order's start,
 * so an order carried out late once does not report every subsequent occurrence
 * as overdue for the rest of its life.
 */
function scheduleFor(order, lastExecutedAt) {
  if (!order.frequencyHours || order.status !== 'ACTIVE') {
    return { dueAt: null, isOverdue: false, hoursLate: 0 };
  }
  const from = lastExecutedAt ? new Date(lastExecutedAt) : new Date(order.startAt);
  const dueAt = new Date(from.getTime() + order.frequencyHours * 3600_000);
  // A quarter of the interval of grace: a Q2H turn is not "missed" at 2h 01m.
  const graceMs = order.frequencyHours * 3600_000 * 0.25;
  const lateBy = Date.now() - (dueAt.getTime() + graceMs);
  return {
    dueAt,
    isOverdue: lateBy > 0,
    hoursLate: lateBy > 0 ? Math.round((lateBy / 3600_000) * 10) / 10 : 0,
  };
}

function decorate(order) {
  const executions = order.executions || [];
  const done = executions.filter((e) => e.outcome === 'DONE');
  const last = executions[0] || null;
  return {
    ...order,
    executionCount: executions.length,
    completedCount: done.length,
    missedCount: executions.length - done.length,
    lastExecutedAt: last?.executedAt || null,
    lastOutcome: last?.outcome || null,
    ...scheduleFor(order, done[0]?.executedAt || null),
  };
}

router.get('/standing', read, async (req, res, next) => {
  try {
    const { patientId, status, type, overdueOnly } = req.query;
    const where = { facilityId: req.ctx.facilityId };
    if (patientId) {
      await requireTenantPatient(req.ctx.facilityId, patientId);
      where.patientId = patientId;
    }
    // `ALL` means no filter — matching it against the enum returns nothing and
    // reads to staff as "the records are gone".
    if (status && status !== 'ALL') where.status = status;
    else if (!status) where.status = 'ACTIVE';
    if (type && type !== 'ALL') where.type = type;

    const orders = await prisma.order.findMany({
      where,
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        executions: { orderBy: { executedAt: 'desc' }, take: 20 },
      },
      take: 200,
    });

    let decorated = orders.map(decorate).sort(byClinicalPriority);
    if (overdueOnly === 'true' || overdueOnly === '1') decorated = decorated.filter((o) => o.isOverdue);

    res.json({
      orders: decorated,
      counts: {
        total: decorated.length,
        overdue: decorated.filter((o) => o.isOverdue).length,
        held: decorated.filter((o) => o.status === 'HELD').length,
      },
    });
  } catch (e) { next(e); }
});

router.post('/standing', prescribe, async (req, res, next) => {
  try {
    const {
      patientId, caseId, admissionId, type, name, details, goal, instructions,
      frequencyHours, priority, startAt, stopAt, monitoringType,
    } = req.body || {};

    if (!patientId) return res.status(400).json({ error: 'patientId is required', field: 'patientId' });
    if (!ORDER_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${ORDER_TYPES.join(', ')}`, field: 'type' });
    }
    if (!String(name || '').trim()) {
      return res.status(400).json({ error: 'Give the order a name a nurse will recognise', field: 'name' });
    }
    if (frequencyHours != null && (!Number.isFinite(Number(frequencyHours)) || Number(frequencyHours) <= 0)) {
      return res.status(400).json({ error: 'frequencyHours must be a positive number', field: 'frequencyHours' });
    }

    // A doctor can name the chart the order expects, e.g. "catheter, hourly
    // output" carries MonitoringType URINARY_CATHETER. The nurse at the bedside
    // supplies the specifics — the size, the site, the bag actually hung.
    if (monitoringType && !templateFor(monitoringType) && monitoringType !== 'CUSTOM') {
      return res.status(400).json({
        error: `monitoringType must be a known chart type or CUSTOM`,
        field: 'monitoringType',
      });
    }

    await requireTenantPatient(req.ctx.facilityId, patientId);
    if (caseId) await requireTenantCase(req.ctx.facilityId, caseId);

    const order = await prisma.order.create({
      data: {
        facilityId: req.ctx.facilityId,
        patientId,
        caseId: caseId || null,
        admissionId: admissionId || null,
        type,
        // Persist what the order needs charted, inferring it from the doctor's
        // own words when they did not pick one. Inferring it only for the
        // response would leave the nurse's list empty — the prompt has to
        // survive past the moment the order was written.
        monitoringType: monitoringType || inferMonitoringType(name) || null,
        name: String(name).trim(),
        details: details && typeof details === 'object' ? details : {},
        goal: goal || null,
        instructions: instructions || null,
        frequencyHours: frequencyHours != null ? Number(frequencyHours) : null,
        priority: ['ROUTINE', 'URGENT', 'STAT'].includes(priority) ? priority : 'ROUTINE',
        orderedById: req.ctx.userId,
        startAt: startAt ? new Date(startAt) : new Date(),
        stopAt: stopAt ? new Date(stopAt) : null,
      },
    });
    audit(req, 'order.standing.create', 'Order', order.id, `${type}: ${order.name}`);

    // Offered, never created automatically: only the nurse hanging the bag or
    // passing the catheter knows the details that make a chart usable.
    const suggestion = order.monitoringType
      ? {
        sheetType: order.monitoringType,
        reason: monitoringType
          ? 'This order asks for a monitoring chart — a nurse opens it at the bedside'
          : `This looks like it needs a ${templateFor(order.monitoringType)?.label || order.monitoringType} chart`,
      }
      : null;

    res.status(201).json(suggestion ? { ...order, suggestedMonitoringSheet: suggestion } : order);
  } catch (e) { next(e); }
});

router.get('/standing/:id', read, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
      include: {
        patient: { select: { id: true, firstName: true, lastName: true, mrn: true } },
        executions: { orderBy: { executedAt: 'desc' } },
      },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(decorate(order));
  } catch (e) { next(e); }
});

/**
 * Record that an order was carried out — or deliberately was not.
 *
 * A skipped dose with a reason is a clinical fact worth keeping. A skipped dose
 * that simply never appears is a hole in the record that nobody can explain
 * later, so the reason is required rather than optional.
 */
router.post('/standing/:id/execute', execute, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.status === 'DISCONTINUED') {
      return res.status(409).json({ error: 'This order has been discontinued' });
    }
    if (order.status === 'HELD') {
      return res.status(409).json({ error: 'This order is on hold — ask the doctor before carrying it out' });
    }

    const { outcome = 'DONE', result, reason, comment, executedAt } = req.body || {};
    if (!EXECUTION_OUTCOMES.includes(outcome)) {
      return res.status(400).json({ error: `outcome must be one of: ${EXECUTION_OUTCOMES.join(', ')}`, field: 'outcome' });
    }
    if (outcome !== 'DONE' && String(reason || '').trim().length < 3) {
      return res.status(400).json({ error: 'Say why it was not carried out', field: 'reason' });
    }

    let when = new Date();
    if (executedAt) {
      const parsed = new Date(executedAt);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: 'executedAt is not a valid date' });
      // Charting something as already done in the future is never right.
      if (parsed.getTime() > Date.now() + 60_000) {
        return res.status(400).json({ error: 'executedAt cannot be in the future', field: 'executedAt' });
      }
      when = parsed;
    }

    const execution = await prisma.orderExecution.create({
      data: {
        facilityId: req.ctx.facilityId,
        orderId: order.id,
        executedAt: when,
        executedById: req.ctx.userId,
        outcome,
        result: result || null,
        reason: reason || null,
        comment: comment || null,
      },
    });

    // A one-off order is finished once it has been done. A recurring one stays
    // active until someone stops it.
    let updated = order;
    if (!order.frequencyHours && outcome === 'DONE') {
      updated = await prisma.order.update({ where: { id: order.id }, data: { status: 'COMPLETED' } });
    }
    audit(req, 'order.standing.execute', 'Order', order.id, `${outcome}: ${order.name}`);

    const done = await prisma.orderExecution.findFirst({
      where: { orderId: order.id, outcome: 'DONE' }, orderBy: { executedAt: 'desc' },
    });
    res.status(201).json({ execution, order: { ...updated, ...scheduleFor(updated, done?.executedAt) } });
  } catch (e) { next(e); }
});

/** Hold, resume, or stop an order. Stopping requires a reason. */
router.put('/standing/:id/status', prescribe, async (req, res, next) => {
  try {
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, facilityId: req.ctx.facilityId },
    });
    if (!order) return res.status(404).json({ error: 'Order not found' });

    const { status, reason } = req.body || {};
    if (!ORDER_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${ORDER_STATUSES.join(', ')}`, field: 'status' });
    }
    // Stopping a treatment is a clinical decision; the record should say why.
    if (status === 'DISCONTINUED' && String(reason || '').trim().length < 3) {
      return res.status(400).json({ error: 'Say why this order is being stopped', field: 'reason' });
    }

    const updated = await prisma.order.update({
      where: { id: order.id },
      data: {
        status,
        ...(status === 'DISCONTINUED' ? {
          discontinuedAt: new Date(),
          discontinuedById: req.ctx.userId,
          discontinueReason: String(reason).trim(),
        } : {}),
      },
    });
    audit(req, 'order.standing.status', 'Order', order.id, `${status}${reason ? `: ${reason}` : ''}`);
    res.json(updated);
  } catch (e) { next(e); }
});

module.exports = router;
