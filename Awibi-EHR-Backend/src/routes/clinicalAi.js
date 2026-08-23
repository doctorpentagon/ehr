const express = require('express');
const multer = require('multer');
const router = express.Router();
const { prisma } = require('../utils/database');
const { authenticate } = require('../middleware/auth');
const { tenant } = require('../middleware/tenant');
const { requirePermission } = require('../middleware/rbac');
const { requireTenantPatient } = require('../utils/tenantRecords');

const auth = [authenticate, tenant, requirePermission('clinical_write')];
const nursingAuth = [authenticate, tenant, requirePermission('monitoring_write')];
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

const AUDIO_TYPES = new Set(['audio/webm', 'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'audio/ogg']);
const DOCUMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

function configured() {
  return Boolean(process.env.AWIBI_CLINICAL_AI_URL);
}

function normaliseSoap(payload = {}) {
  const source = payload.soap || payload.data || payload;
  return {
    chiefComplaint: source.chiefComplaint ?? source.cc ?? '',
    history: source.history ?? source.hpi ?? '',
    reviewOfSystems: source.reviewOfSystems ?? source.ros ?? '',
    examination: source.examination ?? source.pe ?? '',
    assessment: source.assessment ?? '',
    plan: source.plan ?? '',
    transcript: source.transcript ?? payload.transcript ?? '',
    confidence: source.confidence ?? payload.confidence ?? null,
  };
}

async function callAgent(endpoint, file, fields) {
  if (!configured()) {
    const error = new Error('Clinical AI is not configured on this server. Set AWIBI_CLINICAL_AI_URL before using Voice or Scan extraction.');
    error.statusCode = 503;
    error.code = 'CLINICAL_AI_NOT_CONFIGURED';
    throw error;
  }
  const form = new FormData();
  form.append(endpoint === 'transcribe-soap' ? 'audio_file' : 'image_or_pdf', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  });
  const base = process.env.AWIBI_CLINICAL_AI_URL.replace(/\/$/, '');
  const headers = {};
  if (process.env.AWIBI_CLINICAL_AI_KEY) headers.authorization = `Bearer ${process.env.AWIBI_CLINICAL_AI_KEY}`;
  const response = await fetch(`${base}/${endpoint}`, {
    method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000),
  });
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body.error || body.message || `Clinical AI returned ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  const soap = normaliseSoap(body);
  if (![soap.chiefComplaint, soap.history, soap.reviewOfSystems, soap.examination, soap.assessment, soap.plan].some(value => String(value || '').trim())) {
    const error = new Error('Clinical AI returned an empty SOAP proposal');
    error.statusCode = 502;
    throw error;
  }
  return soap;
}

function normaliseNursingObservation(payload = {}, fieldDefinitions = []) {
  const source = payload.observation || payload.data || payload;
  const proposed = source.values && typeof source.values === 'object' ? source.values : {};
  const allowed = new Set(fieldDefinitions.map(field => field.key).filter(Boolean));
  const values = {};
  for (const [key, value] of Object.entries(proposed)) {
    if (!allowed.has(key) || value === undefined || value === null || value === '') continue;
    values[key] = typeof value === 'boolean' ? String(value) : value;
  }
  const transcript = source.transcript ?? payload.transcript ?? '';
  return {
    values,
    notes: source.notes ?? source.narrative ?? transcript ?? '',
    abnormalSuggested: Boolean(source.abnormalSuggested ?? source.isAbnormal ?? false),
    transcript,
    confidence: source.confidence ?? payload.confidence ?? null,
  };
}

async function callNursingAgent(file, fields, fieldDefinitions) {
  if (!configured()) {
    const error = new Error('Clinical AI is not configured on this server. Set AWIBI_CLINICAL_AI_URL before using nurse Voice or Snap extraction.');
    error.statusCode = 503;
    error.code = 'CLINICAL_AI_NOT_CONFIGURED';
    throw error;
  }
  const form = new FormData();
  form.append('source_file', new Blob([file.buffer], { type: file.mimetype }), file.originalname);
  Object.entries(fields).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') form.append(key, String(value));
  });
  form.append('field_definitions', JSON.stringify(fieldDefinitions));
  const base = process.env.AWIBI_CLINICAL_AI_URL.replace(/\/$/, '');
  const headers = {};
  if (process.env.AWIBI_CLINICAL_AI_KEY) headers.authorization = `Bearer ${process.env.AWIBI_CLINICAL_AI_KEY}`;
  const response = await fetch(`${base}/nursing-observation`, {
    method: 'POST', headers, body: form, signal: AbortSignal.timeout(30_000),
  });
  let body = {};
  try { body = await response.json(); } catch { /* handled below */ }
  if (!response.ok) {
    const error = new Error(body.error || body.message || `Clinical AI returned ${response.status}`);
    error.statusCode = response.status >= 500 ? 502 : response.status;
    throw error;
  }
  const observation = normaliseNursingObservation(body, fieldDefinitions);
  if (!Object.keys(observation.values).length && !String(observation.notes || '').trim()) {
    const error = new Error('Clinical AI returned an empty nursing observation proposal');
    error.statusCode = 502;
    throw error;
  }
  return observation;
}

router.get('/status', auth, (req, res) => {
  res.json({ configured: configured(), provider: configured() ? 'AWIBI_CLINICAL_AI' : null, storesSourceFiles: false });
});

router.get('/nursing-status', nursingAuth, (req, res) => {
  res.json({ configured: configured(), provider: configured() ? 'AWIBI_CLINICAL_AI' : null, storesSourceFiles: false });
});

router.post('/transcribe-soap', auth, upload.single('audio_file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'audio_file is required' });
    if (!AUDIO_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Use a WebM, MP3, M4A, WAV, or OGG audio recording' });
    const patientId = req.body.patient_id || req.body.patientId;
    if (!patientId) return res.status(400).json({ error: 'patient_id is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    const soap = await callAgent('transcribe-soap', req.file, { patient_id: patientId, encounter_id: req.body.encounter_id });
    prisma.auditLog.create({ data: { facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'ai.soap.proposed_from_voice', resource: 'Patient', resourceId: patientId, reason: 'Clinician-requested draft; source audio not retained', ip: req.ip, details: { mimeType: req.file.mimetype, sizeBytes: req.file.size } } }).catch(() => {});
    res.json({ soap, requiresClinicianReview: true, sourceRetained: false });
  } catch (error) { next(error); }
});

router.post('/ocr-soap', auth, upload.single('image_or_pdf'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'image_or_pdf is required' });
    if (!DOCUMENT_TYPES.has(req.file.mimetype)) return res.status(400).json({ error: 'Use a JPG, PNG, WebP, or PDF document' });
    const patientId = req.body.patient_id || req.body.patientId;
    if (!patientId) return res.status(400).json({ error: 'patient_id is required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    const soap = await callAgent('ocr-soap', req.file, { patient_id: patientId });
    prisma.auditLog.create({ data: { facilityId: req.ctx.facilityId, userId: req.ctx.userId, action: 'ai.soap.proposed_from_document', resource: 'Patient', resourceId: patientId, reason: 'Clinician-requested draft; source document not retained', ip: req.ip, details: { mimeType: req.file.mimetype, sizeBytes: req.file.size } } }).catch(() => {});
    res.json({ soap, requiresClinicianReview: true, sourceRetained: false });
  } catch (error) { next(error); }
});

router.post('/nursing-observation', nursingAuth, upload.single('source_file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'source_file is required' });
    if (!AUDIO_TYPES.has(req.file.mimetype) && !DOCUMENT_TYPES.has(req.file.mimetype)) {
      return res.status(400).json({ error: 'Use supported audio, JPG, PNG, WebP, or PDF input' });
    }
    const patientId = req.body.patient_id || req.body.patientId;
    const sheetId = req.body.monitoring_sheet_id || req.body.monitoringSheetId;
    if (!patientId || !sheetId) return res.status(400).json({ error: 'patient_id and monitoring_sheet_id are required' });
    await requireTenantPatient(req.ctx.facilityId, patientId);
    const sheet = await prisma.monitoringSheet.findFirst({
      where: { id: sheetId, patientId, facilityId: req.ctx.facilityId, status: 'ACTIVE' },
      select: { id: true, fields: true, type: true, title: true },
    });
    if (!sheet) return res.status(404).json({ error: 'Active monitoring sheet not found for this patient' });
    const fieldDefinitions = Array.isArray(sheet.fields) ? sheet.fields.map(field => ({
      key: field.key,
      label: field.label,
      kind: field.kind,
      unit: field.unit,
      options: field.options,
    })) : [];
    const observation = await callNursingAgent(req.file, {
      patient_id: patientId,
      monitoring_sheet_id: sheet.id,
      monitoring_type: sheet.type,
      monitoring_title: sheet.title,
      capture_type: AUDIO_TYPES.has(req.file.mimetype) ? 'VOICE' : 'SNAP',
    }, fieldDefinitions);
    prisma.auditLog.create({ data: {
      facilityId: req.ctx.facilityId,
      userId: req.ctx.userId,
      action: 'ai.nursing_observation.proposed',
      resource: 'MonitoringSheet',
      resourceId: sheet.id,
      reason: 'Nurse-requested draft; source file not retained and no observation auto-saved',
      ip: req.ip,
      details: { mimeType: req.file.mimetype, sizeBytes: req.file.size, proposedFieldCount: Object.keys(observation.values).length },
    } }).catch(() => {});
    res.json({
      observation,
      requiresNurseReview: true,
      sourceRetained: false,
      observationSaved: false,
      taskCompleted: false,
      medicationAdministered: false,
    });
  } catch (error) { next(error); }
});

module.exports = router;
