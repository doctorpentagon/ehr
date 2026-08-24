const { prisma } = require('../src/utils/database');

const BASE = 'http://localhost:8000/v1';
const created = { problemId: null, carePlanId: null, inventoryId: null };
let passed = 0;

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  PASS ${label}${detail ? ` (${detail})` : ''}`);
}

async function request(method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

async function login(account) {
  const response = await request('POST', '/auth/local-demo-login', null, { userId: account.id });
  check(`${account.subRole || account.role} demo login works`, response.status === 200 && Boolean(response.data?.accessToken));
  return response.data.accessToken;
}

(async () => {
  try {
    const catalogue = await request('GET', '/auth/local-demo-accounts');
    check('local demo accounts are available', catalogue.status === 200 && catalogue.data?.accounts?.length > 0);
    const accounts = catalogue.data.accounts;
    // Use the populated UCH fixture. The isolation facility now also has
    // showcase clinicians, and selecting the first pharmacist would mix the
    // audit with a tenant that intentionally has no diagnostics role.
    const pharmacist = accounts.find((account) => account.subRole === 'PHARMACIST' && account.facility?.name === 'UCH Ibadan Demo');
    const facilityId = pharmacist?.facility?.id;
    const doctor = accounts.find((account) => account.subRole === 'DOCTOR' && account.facility?.id === facilityId);
    const nurse = accounts.find((account) => account.subRole === 'NURSE' && account.facility?.id === facilityId);
    const diagnostics = accounts.find((account) => account.subRole === 'LAB' && account.facility?.id === facilityId);
    check('pharmacist, doctor, nurse and diagnostics tester share the facility', Boolean(pharmacist && doctor && nurse && diagnostics));

    const [pharmacistToken, doctorToken, nurseToken, diagnosticsToken] = await Promise.all([
      login(pharmacist), login(doctor), login(nurse), login(diagnostics),
    ]);
    const patients = await request('GET', '/patients?limit=5', pharmacistToken);
    const patient = patients.data?.patients?.find((item) => !item.isEmergencyTemp);
    check('pharmacist can resolve a real facility Health ID', patients.status === 200 && Boolean(patient?.id), patient?.universalPatientId);

    const profile = await request('GET', `/orders/pharmacy/patient/${patient.id}`, pharmacistToken);
    check('patient medication profile opens', profile.status === 200 && profile.data?.patient?.id === patient.id);
    check('profile contains medication history and local safety scope', Array.isArray(profile.data?.prescriptions) && Boolean(profile.data?.safety?.scope));
    check('safety response states the interaction-source limitation', profile.data?.safety?.authoritativeInteractionSourceConfigured === false);

    const problem = await request('POST', '/orders/pharmacy/problems', pharmacistToken, {
      patientId: patient.id,
      category: 'MONITORING_REQUIRED',
      problemType: 'ACTUAL',
      severity: 'MODERATE',
      description: 'Synthetic audit: monitoring parameters require pharmacist follow-up.',
      evidence: 'Synthetic beta verification only.',
      recommendation: 'Record and review the required monitoring plan.',
    });
    created.problemId = problem.data?.id;
    check('pharmacist records an attributed Drug Therapy Problem', problem.status === 201 && problem.data?.identifiedById === pharmacist.id);

    const doctorProblem = await request('POST', '/orders/pharmacy/problems', doctorToken, {
      patientId: patient.id, category: 'OTHER', problemType: 'POTENTIAL', severity: 'LOW', description: 'Must be refused',
    });
    check('doctor cannot author a pharmacist DTP', doctorProblem.status === 403);

    const resolved = await request('PUT', `/orders/pharmacy/problems/${created.problemId}/status`, pharmacistToken, {
      status: 'RESOLVED', resolution: 'Synthetic audit closure recorded with an explicit outcome.',
    });
    check('DTP closes only with a recorded outcome', resolved.status === 200 && resolved.data?.status === 'RESOLVED' && Boolean(resolved.data?.resolvedAt));

    const plan = await request('POST', '/orders/pharmacy/care-plans', pharmacistToken, {
      patientId: patient.id,
      documentationFormat: 'CORE_PRIME_FARM',
      coreCondition: 'Synthetic condition context for workflow verification.',
      coreOutcomes: 'A measurable, patient-specific outcome is documented.',
      coreRegimen: 'Current synthetic regimen reviewed.',
      coreEvaluation: 'Effectiveness, safety and adherence parameters recorded.',
      primeProblems: 'Interaction and monitoring needs considered.',
      farmFindings: 'Synthetic patient-specific findings.',
      farmAssessment: 'No clinical inference; workflow verification only.',
      farmResolution: 'Complete review and sign the attributed care plan.',
      farmMonitoring: 'Review effectiveness, safety and adherence at follow-up.',
      patientNeeds: 'Clear medicine counselling record.',
      therapyGoals: 'Documented and reviewable medicine plan.',
      interventions: 'Synthetic counselling workflow entry.',
      followUpPlan: 'Synthetic follow-up workflow test.',
      adherence: 'UNABLE_TO_ASSESS',
    });
    created.carePlanId = plan.data?.id;
    check('pharmacist creates an attributed CORE–PRIME–FARM care plan', plan.status === 201 && plan.data?.status === 'DRAFT' && plan.data?.documentationFormat === 'CORE_PRIME_FARM' && Boolean(plan.data?.farmMonitoring) && plan.data?.pharmacistId === pharmacist.id);

    const doctorPlan = await request('POST', '/orders/pharmacy/care-plans', doctorToken, {
      patientId: patient.id, assessment: 'Must be refused',
    });
    check('doctor cannot author a pharmacist care plan', doctorPlan.status === 403);

    const signed = await request('POST', `/orders/pharmacy/care-plans/${created.carePlanId}/sign`, pharmacistToken, {});
    check('the author signs the plan with server time', signed.status === 200 && signed.data?.status === 'SIGNED' && Boolean(signed.data?.signedAt));
    const signedAgain = await request('POST', `/orders/pharmacy/care-plans/${created.carePlanId}/sign`, pharmacistToken, {});
    check('a signed care plan cannot be silently signed again', signedAgain.status === 409);

    for (const [role, token] of [['pharmacist', pharmacistToken], ['doctor', doctorToken], ['nurse', nurseToken]]) {
      const safety = await request('GET', `/orders/medication-safety/${patient.id}`, token);
      check(`${role} can read the shared medication-safety summary`, safety.status === 200 && Boolean(safety.data?.safety));
    }
    const unrelatedSafety = await request('GET', `/orders/medication-safety/${patient.id}`, diagnosticsToken);
    check('unrelated diagnostics staff cannot read medication safety', unrelatedSafety.status === 403);

    check('dispensing queue remains available', (await request('GET', '/orders/pharmacy/queue?status=ALL', pharmacistToken)).status === 200);
    check('Health ID can search the dispensing queue', (await request('GET', `/orders/pharmacy/queue?status=ALL&search=${encodeURIComponent(patient.universalPatientId)}`, pharmacistToken)).status === 200);
    check('inventory remains available', (await request('GET', '/orders/pharmacy/inventory', pharmacistToken)).status === 200);

    const stockName = `Synthetic audit medicine ${Date.now()}`;
    const stock = await request('POST', '/orders/pharmacy/inventory', pharmacistToken, {
      name: stockName, genericName: 'Synthetic generic', strength: '10 mg', form: 'tablet', category: 'Audit',
      defaultRoute: 'ORAL', stockOnHand: 25, reorderLevel: 5, unitLabel: 'tablets', unitPrice: 10,
    });
    created.inventoryId = stock.data?.id;
    check('pharmacist creates a facility stock item', stock.status === 201 && stock.data?.stockOnHand === 25);
    const visibleStock = await request('GET', `/orders/pharmacy/inventory?search=${encodeURIComponent(stockName)}`, pharmacistToken);
    check('created stock is readable in the active list', visibleStock.status === 200 && visibleStock.data?.items?.some((item) => item.id === created.inventoryId));
    const changedStock = await request('PUT', `/orders/pharmacy/inventory/${created.inventoryId}`, pharmacistToken, {
      name: stockName, genericName: 'Synthetic generic updated', strength: '10 mg', form: 'tablet', category: 'Audit',
      defaultRoute: 'ORAL', stockOnHand: 18, reorderLevel: 6, unitLabel: 'tablets', unitPrice: 12,
    });
    check('pharmacist edits medicine details and balance', changedStock.status === 200 && changedStock.data?.stockOnHand === 18 && changedStock.data?.genericName.endsWith('updated'));
    const refusedArchive = await request('DELETE', `/orders/pharmacy/inventory/${created.inventoryId}`, pharmacistToken, {});
    check('archive requires an accountable reason', refusedArchive.status === 400);
    const archived = await request('DELETE', `/orders/pharmacy/inventory/${created.inventoryId}`, pharmacistToken, { reason: 'Synthetic audit archive' });
    check('stock delete is a recoverable archive', archived.status === 200 && archived.data?.isActive === false);
    const archivedList = await request('GET', `/orders/pharmacy/inventory?stockStatus=ARCHIVED&search=${encodeURIComponent(stockName)}`, pharmacistToken);
    check('archived stock has its own list', archivedList.status === 200 && archivedList.data?.items?.some((item) => item.id === created.inventoryId));
    const restored = await request('POST', `/orders/pharmacy/inventory/${created.inventoryId}/restore`, pharmacistToken, {});
    check('authorized pharmacy user restores archived stock', restored.status === 200 && restored.data?.isActive === true);
    const forbiddenStock = await request('POST', '/orders/pharmacy/inventory', diagnosticsToken, { name: `Forbidden ${Date.now()}` });
    check('diagnostics staff cannot mutate pharmacy stock', forbiddenStock.status === 403);
    console.log(`\n  ${passed} pharmacy-care checks passed, 0 gaps`);
  } finally {
    if (created.problemId) await prisma.pharmacyTherapyProblem.deleteMany({ where: { id: created.problemId } });
    if (created.carePlanId) await prisma.pharmacyCarePlan.deleteMany({ where: { id: created.carePlanId } });
    if (created.inventoryId) await prisma.drugCatalogue.deleteMany({ where: { id: created.inventoryId } });
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(`\n  FAIL ${error.message}`);
  process.exitCode = 1;
});
