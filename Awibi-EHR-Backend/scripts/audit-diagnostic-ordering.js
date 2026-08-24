/**
 * Regression audit for the comprehensive investigation-order modal.
 *
 * Proves that a multi-test clinician order retains test-specific details and
 * that catalogue and custom investigations enter the correct specialty queue.
 * Synthetic requests are removed in finally so repeated audits do not clutter
 * the local beta worklists.
 */
const { prisma, connectDatabase } = require('../src/utils/database');

const BASE = process.env.API || 'http://localhost:8000/v1';
const createdIds = [];
let checks = 0;

function pass(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
  console.log(`  PASS ${message}`);
}

async function request(path, token, options = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
  });
  let body = null;
  try { body = await response.json(); } catch { /* non-JSON error */ }
  return { status: response.status, body };
}

async function main() {
  await connectDatabase();
  const accounts = (await request('/auth/local-demo-accounts')).body?.accounts || [];
  const admin = accounts.find((account) => account.role === 'ADMIN' && account.facility?.name === 'UCH Ibadan Demo');
  pass(Boolean(admin), 'UCH facility administrator demo exists');

  const login = await request('/auth/local-demo-login', null, {
    method: 'POST',
    body: JSON.stringify({ userId: admin.id }),
  });
  pass(login.status === 200 && Boolean(login.body?.accessToken), 'facility administrator can authenticate');
  const token = login.body.accessToken;

  const patient = await prisma.patient.findFirst({
    where: { facilityId: admin.facility.id, universalPatientId: 'AWB-TEST2PAT' },
  });
  pass(Boolean(patient), 'permanent synthetic diagnostic patient exists');

  const catalogueResponse = await request('/lab/catalogue', token);
  const catalogue = catalogueResponse.body?.tests || [];
  const byCode = (code) => catalogue.find((test) => test.code === code);
  const lft = byCode('LFT');
  const viral = byCode('VIRAL-MARKERS');
  const sfa = byCode('SFA');
  pass(Boolean(lft && viral && sfa), 'LFT, viral markers and SFA are in the facility catalogue');

  const order = await request('/lab', token, {
    method: 'POST',
    body: JSON.stringify({
      patientId: patient.id,
      tests: [
        { catalogueTestId: lft.id, priority: 'ROUTINE', notes: 'Clinical indication / question: jaundice\nTest-specific details: fractionated bilirubin and enzymes' },
        { catalogueTestId: viral.id, priority: 'ROUTINE', notes: 'Clinical indication / question: antenatal screening\nTest-specific details: HBsAg, anti-HCV and approved HIV screen' },
        { catalogueTestId: sfa.id, priority: 'ROUTINE', notes: 'Clinical indication / question: fertility assessment\nTest-specific details: 3 days abstinence; complete sample; collection time recorded' },
        { testName: 'Custom molecular tissue panel', testType: 'LAB', diagnosticDiscipline: 'HISTOPATHOLOGY', specimenType: 'FFPE tissue block', priority: 'ROUTINE', notes: 'Clinical indication / question: refine tumour classification\nCustom investigation details: targeted panel requested by MDT' },
      ],
    }),
  });
  pass(order.status === 201 && order.body?.count === 4, 'four detailed investigations save in one transaction-shaped request');
  for (const item of order.body?.requests || []) createdIds.push(item.id);

  const saved = order.body?.requests || [];
  pass(saved.find((item) => item.catalogueTestId === lft.id)?.notes.includes('fractionated bilirubin'), 'LFT-specific details are retained');
  pass(saved.find((item) => item.catalogueTestId === viral.id)?.notes.includes('HBsAg'), 'viral-marker details are retained');
  pass(saved.find((item) => item.catalogueTestId === sfa.id)?.notes.includes('abstinence'), 'SFA collection details are retained');
  const custom = saved.find((item) => item.testName === 'Custom molecular tissue panel');
  pass(custom?.diagnosticDiscipline === 'Histopathology' && custom?.specimenType === 'FFPE tissue block', 'custom test keeps specialty and specimen');

  const chemistryQueue = await request('/lab?discipline=CHEMICAL_PATHOLOGY&search=Liver%20Function', token);
  const microbiologyQueue = await request('/lab?discipline=MICROBIOLOGY&search=Seminal%20Fluid', token);
  const histopathologyQueue = await request('/lab?discipline=HISTOPATHOLOGY&search=Custom%20molecular', token);
  pass(chemistryQueue.body?.requests?.some((item) => createdIds.includes(item.id)), 'LFT reaches Chemical Pathology');
  pass(microbiologyQueue.body?.requests?.some((item) => createdIds.includes(item.id)), 'SFA reaches Microbiology');
  pass(histopathologyQueue.body?.requests?.some((item) => item.id === custom?.id), 'custom tissue test reaches Histopathology');

  console.log(`\nDiagnostic ordering audit passed: ${checks} assertions.`);
}

main()
  .catch((error) => { console.error(`\nDiagnostic ordering audit failed: ${error.message}`); process.exitCode = 1; })
  .finally(async () => {
    if (createdIds.length) await prisma.labRequest.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
    await prisma.$disconnect();
  });
