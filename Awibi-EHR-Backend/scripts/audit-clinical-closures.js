/**
 * Destructive-safe local E2E audit for the two human clinical safety loops:
 * consultation -> routed orders, and critical observation -> named closure.
 * Synthetic records are removed in finally, whether the audit passes or fails.
 */
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();
const BASE = process.env.EHR_API_URL || 'http://localhost:8000/v1';
const created = { caseId: null, lateCaseId: null, sheetId: null, alertId: null, orderIds: [], prescriptionIds: [], labIds: [] };
let passed = 0;

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? ` - ${detail}` : ''}`);
  passed += 1;
  console.log(`  PASS ${label}${detail ? ` (${detail})` : ''}`);
}

async function request(method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch { data = {}; }
  return { status: response.status, data };
}

async function main() {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    try {
      const health = await fetch(`${BASE}/health`);
      if (health.ok) break;
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const catalogue = await request('GET', '/auth/local-demo-accounts');
  check('local clinical fixture is available', catalogue.status === 200 && catalogue.data.accounts?.length > 0);
  const accounts = catalogue.data.accounts;
  const doctor = accounts.find(item => item.subRole === 'DOCTOR');
  const facilityId = doctor?.facility?.id;
  const nurse = accounts.find(item => item.subRole === 'NURSE' && item.facility?.id === facilityId);
  const lab = accounts.find(item => item.subRole === 'LAB' && item.facility?.id === facilityId);
  check('doctor, nurse and laboratory roles share one facility', Boolean(doctor && nurse && lab));

  const login = async account => {
    const response = await request('POST', '/auth/local-demo-login', null, { userId: account.id });
    check(`${account.name} can start the audit journey`, response.status === 200 && Boolean(response.data.accessToken));
    return response.data.accessToken;
  };
  const [doctorToken, nurseToken, labToken] = await Promise.all([login(doctor), login(nurse), login(lab)]);
  const patients = await request('GET', '/patients?limit=10', doctorToken);
  const patient = patients.data.patients?.find(item => !item.isEmergencyTemp);
  check('a real facility patient is available', patients.status === 200 && Boolean(patient?.id));
  const types = await request('GET', '/encounter-types', doctorToken);
  const encounterTypeId = types.data.types?.[0]?.id;
  check('the facility has an encounter context', types.status === 200 && Boolean(encounterTypeId));
  const diagnosticCatalogue = await request('GET', '/lab/catalogue?testType=LAB', doctorToken);
  const renalTest = diagnosticCatalogue.data.tests?.find(item => /electrolyte|urea|creatinine|renal/i.test(item.name))
    || diagnosticCatalogue.data.tests?.[0];
  check('the facility has a catalogue-backed laboratory test', diagnosticCatalogue.status === 200 && Boolean(renalTest?.id));

  const atomicTitle = `Atomic rejection ${Date.now()}`;
  const rejected = await request('POST', '/cases', doctorToken, {
    patientId: patient.id,
    encounterTypeId,
    title: atomicTitle,
    orders: [{ type: 'MEDICATION', name: 'Paracetamol' }],
  });
  check('an incomplete medication rejects the whole consultation transaction', rejected.status === 400, `HTTP ${rejected.status}`);
  check('the rejected transaction leaves no partial case', await prisma.case.count({ where: { title: atomicTitle } }) === 0);

  const encounter = await request('POST', '/cases', doctorToken, {
    patientId: patient.id,
    encounterTypeId,
    encounterType: 'WARD_ROUND',
    title: 'Acute gastroenteritis with reduced urine output',
    chiefComplaint: 'Three days of watery stool, weakness and reduced urine output.',
    history: 'No blood in stool. Family used sachet water after a community pipe interruption.',
    examination: 'Tired, dry oral mucosa, pulse 104/min, capillary refill 3 seconds.',
    assessment: 'Moderate dehydration secondary to acute gastroenteritis.',
    plan: 'Rehydrate, monitor urine output and renal function, review response.',
    icdCodes: ['A09', 'E86.0'],
    orders: [
      {
        type: 'NURSING', name: 'Strict intake and output chart - measure urine output hourly',
        frequencyHours: 1, priority: 'STAT', goal: 'Urine output at least 30 ml/hour',
        goalMin: 30, criticalLow: 15,
        instructions: 'Escalate immediately if output is 15 ml/hour or less.',
      },
      {
        type: 'MEDICATION', name: 'Oral rehydration salts', dosage: '200 ml',
        frequency: 'after each loose stool', duration: '24 hours', route: 'ORAL',
        instructions: 'Give slowly in frequent sips; document vomiting.',
      },
      {
        type: 'LAB', name: renalTest.name, catalogueTestId: renalTest.id, priority: 'URGENT',
        instructions: 'Collect before IV fluid if this will not delay resuscitation.',
      },
    ],
  });
  check('structured consultation saves atomically', encounter.status === 201, `HTTP ${encounter.status}`);
  check('consultation automatically records the professional and server time',
    encounter.data.authorId === doctor.id
    && encounter.data.reviewedById === doctor.id
    && Number.isFinite(new Date(encounter.data.createdAt).getTime())
    && Math.abs(new Date(encounter.data.occurredAt).getTime() - new Date(encounter.data.createdAt).getTime()) < 60_000);
  created.caseId = encounter.data.id;
  created.orderIds = encounter.data.structuredOrders?.orders?.map(item => item.id) || [];
  created.prescriptionIds = encounter.data.structuredOrders?.medications?.map(item => item.id) || [];
  created.labIds = encounter.data.structuredOrders?.investigations?.map(item => item.id) || [];
  check('consultation creates one nursing order', created.orderIds.length === 1);
  check('consultation creates one active medicine', created.prescriptionIds.length === 1);
  check('consultation creates one diagnostic request', created.labIds.length === 1);

  const futureEncounter = await request('POST', '/cases', doctorToken, {
    patientId: patient.id,
    encounterTypeId,
    title: `Impossible future consultation ${Date.now()}`,
    occurredAt: new Date(Date.now() + 60 * 60_000).toISOString(),
    lateEntryReason: 'Should never be accepted',
  });
  check('consultation rejects a future clinical time', futureEncounter.status === 400, `HTTP ${futureEncounter.status}`);

  const earlierCareTime = new Date(Date.now() - 15 * 60_000);
  const missingLateReason = await request('POST', '/cases', doctorToken, {
    patientId: patient.id,
    encounterTypeId,
    title: `Retrospective consultation without reason ${Date.now()}`,
    occurredAt: earlierCareTime.toISOString(),
  });
  check('retrospective consultation requires a late-entry reason', missingLateReason.status === 400, `HTTP ${missingLateReason.status}`);

  const retrospective = await request('POST', '/cases', doctorToken, {
    patientId: patient.id,
    encounterTypeId,
    title: `Retrospective consultation ${Date.now()}`,
    occurredAt: earlierCareTime.toISOString(),
    lateEntryReason: 'Documented after stabilising the patient and completing the immediate ward review.',
  });
  created.lateCaseId = retrospective.data?.id;
  check('retrospective consultation preserves care time, entry time, reason and professional',
    retrospective.status === 201
    && retrospective.data.authorId === doctor.id
    && Math.abs(new Date(retrospective.data.occurredAt).getTime() - earlierCareTime.getTime()) < 1000
    && new Date(retrospective.data.createdAt).getTime() > new Date(retrospective.data.occurredAt).getTime()
    && retrospective.data.lateEntryReason === 'Documented after stabilising the patient and completing the immediate ward review.');

  const detail = await request('GET', `/cases/${created.caseId}`, doctorToken);
  check('case detail returns the routed records', detail.status === 200
    && detail.data.structuredOrders.orders.some(item => item.id === created.orderIds[0])
    && detail.data.structuredOrders.medications.some(item => item.id === created.prescriptionIds[0])
    && detail.data.structuredOrders.investigations.some(item => item.id === created.labIds[0]));
  const nursingWorklist = await request('GET', '/orders/standing?status=ACTIVE', nurseToken);
  check('the ward sees the care order without re-entry', nursingWorklist.data.orders?.some(item => item.id === created.orderIds[0]));
  const drugChart = await request('GET', `/nursing/drug-chart/${patient.id}`, nurseToken);
  check('the ward drug chart sees the prescription', drugChart.data.prescriptions?.some(item => item.id === created.prescriptionIds[0]));
  const diagnostics = await request('GET', '/lab?status=PENDING', labToken);
  check('the laboratory queue sees the investigation', diagnostics.data.requests?.some(item => item.id === created.labIds[0]));

  const monitoringRequests = await request('GET', `/nursing/monitoring-requests?patientId=${patient.id}`, nurseToken);
  check('the nursing order asks for its monitoring chart', monitoringRequests.data.requests?.some(item => item.orderId === created.orderIds[0]));
  const initiated = await request('POST', `/nursing/monitoring-requests/${created.orderIds[0]}/initiate`, nurseToken, {
    title: 'Hourly urine output chart',
    frequencyMins: 60,
    instructions: 'Measure from the urine bag hourly; inform the doctor at 15 ml or less.',
  });
  check('nurse opens the requested chart', initiated.status === 201, `HTTP ${initiated.status}`);
  created.sheetId = initiated.data.sheet?.id;
  const urineField = initiated.data.sheet?.fields?.find(item => item.key === 'volumeMl');
  check('doctor-defined thresholds travel into the bedside chart', urineField?.goalMin === 30 && urineField?.criticalLow === 15);

  const earlierObservation = new Date(Date.now() - 10 * 60_000);
  const critical = await request('POST', `/nursing/monitoring-sheets/${created.sheetId}/entries`, nurseToken, {
    values: { volumeMl: 10 }, notes: 'Only 10 ml in the last hour; catheter tubing checked and not kinked.',
    recordedAt: earlierObservation.toISOString(),
    lateEntryReason: 'Documented after immediate catheter patency check and escalation.',
  });
  created.alertId = critical.data.alert?.id || critical.data.clinicalAlerts?.[0]?.id;
  check('critical observation and durable alert save together', critical.status === 201 && critical.data.isCritical && Boolean(created.alertId));
  check('monitoring preserves professional, observation time and EHR audit time',
    critical.data.recordedById === nurse.id
    && Math.abs(new Date(critical.data.recordedAt).getTime() - earlierObservation.getTime()) < 1000
    && new Date(critical.data.createdAt).getTime() > new Date(critical.data.recordedAt).getTime()
    && critical.data.lateEntryReason === 'Documented after immediate catheter patency check and escalation.');
  check('server grades the critical threshold', critical.data.deviations?.volumeMl?.severity === 'CRITICAL_LOW');

  const futureObservation = await request('POST', `/nursing/monitoring-sheets/${created.sheetId}/entries`, nurseToken, {
    values: { volumeMl: 30 }, recordedAt: new Date(Date.now() + 60 * 60_000).toISOString(), lateEntryReason: 'Should never be accepted',
  });
  check('monitoring rejects a future observation time', futureObservation.status === 400, `HTTP ${futureObservation.status}`);

  const openAlerts = await request('GET', '/alerts', doctorToken);
  const openAlert = openAlerts.data.alerts?.find(item => item.id === created.alertId);
  check('doctor sees a persistent open alert', openAlert?.persistent === true && openAlert?.status === 'OPEN');
  const nurseAck = await request('POST', `/alerts/${created.alertId}/acknowledge`, nurseToken);
  check('nursing cannot impersonate the clinician response', nurseAck.status === 403, `HTTP ${nurseAck.status}`);
  const acknowledged = await request('POST', `/alerts/${created.alertId}/acknowledge`, doctorToken);
  check('named doctor acknowledges the alert', acknowledged.status === 200
    && acknowledged.data.status === 'ACKNOWLEDGED' && acknowledged.data.acknowledgedById === doctor.id);

  const improved = await request('POST', `/nursing/monitoring-sheets/${created.sheetId}/entries`, nurseToken, {
    values: { volumeMl: 45 }, notes: 'Output improved after oral rehydration; patient is tolerating sips.',
  });
  check('normal repeat reading is accepted', improved.status === 201 && improved.data.deviations?.volumeMl?.severity === 'NORMAL');
  const afterNormal = await request('GET', '/alerts', doctorToken);
  const stillOpen = afterNormal.data.alerts?.find(item => item.id === created.alertId);
  check('normalisation does not silently close the episode', stillOpen?.status === 'ACKNOWLEDGED' && Boolean(stillOpen.normalizedAt));

  const acted = await request('POST', `/alerts/${created.alertId}/action`, doctorToken, {
    actionNote: 'Reviewed at bedside, confirmed catheter patency and prescribed continued oral rehydration with repeat renal panel.',
  });
  check('named doctor records the clinical action', acted.status === 200
    && acted.data.status === 'ACTED_ON' && acted.data.actionById === doctor.id);
  const resolved = await request('POST', `/alerts/${created.alertId}/resolve`, doctorToken, {
    resolution: 'Urine output improved to 45 ml/hour, circulation is better and hourly monitoring will continue for four hours.',
  });
  check('named doctor records outcome and resolves', resolved.status === 200
    && resolved.data.status === 'RESOLVED' && resolved.data.resolvedById === doctor.id);
  const closedFeed = await request('GET', '/alerts', doctorToken);
  check('resolved alert leaves the active feed', !closedFeed.data.alerts?.some(item => item.id === created.alertId));

  await new Promise(resolve => setTimeout(resolve, 100));
  const auditActions = await prisma.auditLog.findMany({
    where: { resource: 'ClinicalAlert', resourceId: created.alertId },
    select: { action: true, userId: true },
  });
  check('audit trail names acknowledgement, action and resolution',
    ['clinical_alert.acknowledge', 'clinical_alert.action', 'clinical_alert.resolve']
      .every(action => auditActions.some(item => item.action === action && item.userId === doctor.id)));

  console.log(`\nClinical closure audit passed: ${passed} assertions.`);
}

async function cleanup() {
  const ids = [created.caseId, created.lateCaseId, created.sheetId, created.alertId, ...created.orderIds, ...created.prescriptionIds, ...created.labIds].filter(Boolean);
  if (created.alertId || created.sheetId) {
    await prisma.clinicalAlert.deleteMany({
      where: { OR: [
        ...(created.alertId ? [{ id: created.alertId }] : []),
        ...(created.sheetId ? [{ sourceId: created.sheetId }] : []),
      ] },
    });
  }
  if (created.sheetId) await prisma.monitoringSheet.deleteMany({ where: { id: created.sheetId } });
  if (created.orderIds.length) await prisma.order.deleteMany({ where: { id: { in: created.orderIds } } });
  if (created.prescriptionIds.length) await prisma.prescription.deleteMany({ where: { id: { in: created.prescriptionIds } } });
  if (created.labIds.length) await prisma.labRequest.deleteMany({ where: { id: { in: created.labIds } } });
  const caseIds = [created.caseId, created.lateCaseId].filter(Boolean);
  if (caseIds.length) await prisma.case.deleteMany({ where: { id: { in: caseIds } } });
  if (ids.length) await prisma.auditLog.deleteMany({ where: { resourceId: { in: ids } } });
}

main()
  .catch(error => { console.error(`\nClinical closure audit FAILED: ${error.message}`); process.exitCode = 1; })
  .finally(async () => {
    try { await cleanup(); } catch (error) { console.error(`Cleanup warning: ${error.message}`); process.exitCode = 1; }
    await prisma.$disconnect();
  });
