const BASE = process.env.API_URL || 'http://127.0.0.1:8000/v1';
let passed = 0;

function check(label, condition, detail = '') {
  if (!condition) throw new Error(`${label}${detail ? ` — ${detail}` : ''}`);
  passed += 1;
  console.log(`  PASS ${label}${detail ? ` (${detail})` : ''}`);
}

async function request(method, path, token, body) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await response.json(); } catch {}
  return { status: response.status, data };
}

(async () => {
  const catalogue = await request('GET', '/auth/local-demo-accounts');
  check('local demo accounts are available', catalogue.status === 200 && catalogue.data?.accounts?.length > 0);
  const facilityAccounts = new Map();
  for (const account of catalogue.data.accounts) {
    if (!['ADMIN', 'SUPER_ADMIN'].includes(account.role)) continue;
    const current = facilityAccounts.get(account.facility.id);
    // A facility administrator has an unambiguous tenant context. Prefer it to
    // a platform administrator whose previously selected facility is stateful.
    if (!current || (current.role === 'SUPER_ADMIN' && account.role === 'ADMIN')) {
      facilityAccounts.set(account.facility.id, account);
    }
  }
  check('showcase has an administrator in each local facility', facilityAccounts.size >= 2, `${facilityAccounts.size} facilities`);

  for (const account of facilityAccounts.values()) {
    const login = await request('POST', '/auth/local-demo-login', null, { userId: account.id });
    check(`${account.facility.name}: demo login`, login.status === 200 && Boolean(login.data?.accessToken));
    const token = login.data.accessToken;

    const patients = await request('GET', '/patients?search=DEMO-SAMPLE-001&limit=5', token);
    const patient = patients.data?.patients?.find(item => item.mrn === 'DEMO-SAMPLE-001');
    check(`${account.facility.name}: sample patient resolves`, patients.status === 200 && Boolean(patient?.id), patient?.universalPatientId);

    const monitoring = await request('GET', `/nursing/monitoring-sheets?patientId=${patient.id}&status=ACTIVE&withEntries=true`, token);
    const sheet = monitoring.data?.sheets?.find(item => item.title === 'Sample: Fluid balance and urine output');
    check(`${account.facility.name}: monitoring sample is listed`, monitoring.status === 200 && Boolean(sheet?.id));
    check(`${account.facility.name}: five timed observations are present`, sheet?.entries?.length === 5, `${sheet?.entries?.length || 0} entries`);
    check(`${account.facility.name}: intake and output totals are calculated`, sheet?.totals?.intakeMl === 1400 && sheet?.totals?.outputMl === 230, `${sheet?.totals?.intakeMl}/${sheet?.totals?.outputMl} ml`);

    const monitoringDetail = await request('GET', `/nursing/monitoring-sheets/${sheet.id}`, token);
    check(`${account.facility.name}: practitioner order stays linked`, monitoringDetail.status === 200 && monitoringDetail.data?.originatingOrder?.name === 'Sample: Hourly fluid balance monitoring');
    check(`${account.facility.name}: ordering professional is attributed`, Boolean(monitoringDetail.data?.originatingOrder?.orderedBy?.id));
    check(`${account.facility.name}: monitoring updates close the order loop`, monitoringDetail.data?.originatingOrder?.executions?.length === 5, `${monitoringDetail.data?.originatingOrder?.executions?.length || 0} executions`);
    check(`${account.facility.name}: numeric values can drive a visual trend`, monitoringDetail.data?.entries?.every(entry => Number.isFinite(Number(entry.values?.urineOutputMl))));

    const pharmacy = await request('GET', `/orders/pharmacy/patient/${patient.id}`, token);
    check(`${account.facility.name}: pharmacy sample opens`, pharmacy.status === 200 && pharmacy.data?.patient?.id === patient.id);
    check(`${account.facility.name}: active and dispensed prescriptions are visible`, pharmacy.data?.prescriptions?.some(item => item.status === 'ACTIVE') && pharmacy.data?.prescriptions?.some(item => item.status === 'COMPLETED'));
    check(`${account.facility.name}: dispensing links prescription, patient and stock`, pharmacy.data?.prescriptions?.some(item => item.dispenses?.some(dispense => dispense.quantity === 28 && dispense.amount === '1400')));
    check(`${account.facility.name}: medicine problem lifecycle is present`, pharmacy.data?.therapyProblems?.some(item => item.status === 'RESOLVED' && item.category === 'NON_ADHERENCE'));
    check(`${account.facility.name}: signed pharmaceutical care plan is present`, pharmacy.data?.carePlans?.some(item => item.status === 'SIGNED' && Boolean(item.signedAt)));

    const inventory = await request('GET', '/orders/pharmacy/inventory?search=Amlodipine', token);
    check(`${account.facility.name}: stock item and balance are visible`, inventory.status === 200 && inventory.data?.items?.some(item => item.strength === '5 mg' && item.stockOnHand === 72));
  }

  console.log(`\n  ${passed} showcase checks passed, 0 gaps`);
})().catch(error => {
  console.error(`\n  FAIL ${error.message}`);
  process.exitCode = 1;
});
