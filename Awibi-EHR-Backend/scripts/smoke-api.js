const path = require('path');
const dotenv = require('dotenv');
const { PrismaClient } = require('@prisma/client');

dotenv.config({ path: path.resolve(__dirname, '../.env.local'), override: true });
const db = new PrismaClient();

const baseUrl = process.env.LOCAL_API_URL || 'http://localhost:8000/v1';
const smokeClientIp = `2001:db8::${Date.now().toString(16)}`;
const password = process.env.DEMO_PASSWORD;
const accounts = {
  admin: process.env.DEMO_ADMIN_EMAIL,
  doctor: process.env.DEMO_DOCTOR_EMAIL,
  nurse: process.env.DEMO_NURSE_EMAIL,
  records: process.env.DEMO_RECORDS_EMAIL,
  lab: process.env.DEMO_LAB_EMAIL,
};

let passed = 0;
let failed = 0;

function assert(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failed += 1;
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

async function request(pathname, { token, method = 'GET', body, form } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      'x-forwarded-for': smokeClientIp,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: form || (body === undefined ? undefined : JSON.stringify(body)),
  });
  let data = null;
  try {
    data = response.headers.get('content-type')?.includes('application/json')
      ? await response.json()
      : Buffer.from(await response.arrayBuffer());
  } catch { /* unreadable response */ }
  return { status: response.status, data };
}

async function login(role) {
  const result = await request('/auth/login', {
    method: 'POST',
    body: { email: accounts[role], password },
  });
  assert(`${role} login`, result.status === 200 && Boolean(result.data?.accessToken), `status ${result.status}`);
  return result.data?.accessToken;
}

/**
 * The super admin is created by scripts/add-local-superadmin.js rather than the
 * base seed, so it has no fixed demo email in .env. Fetch it through the local
 * demo picker instead, and return null if the fixture is absent so the platform
 * checks skip loudly rather than passing vacuously.
 */
async function loginSuperAdmin() {
  const listed = await request('/auth/local-demo-accounts');
  const account = listed.data?.accounts?.find((a) => a.role === 'SUPER_ADMIN');
  if (!account) {
    assert('super admin fixture exists (run scripts/add-local-superadmin.js)', false, 'no SUPER_ADMIN account');
    return null;
  }
  const result = await request('/auth/local-demo-login', { method: 'POST', body: { userId: account.id } });
  assert('super admin session', result.status === 200 && Boolean(result.data?.accessToken), `status ${result.status}`);
  return result.data?.accessToken;
}

async function expectStatus(name, pathname, token, expected, body) {
  const result = await request(pathname, {
    token,
    method: body === undefined ? 'GET' : 'POST',
    body,
  });
  assert(name, result.status === expected, `expected ${expected}, received ${result.status}`);
  return result;
}

async function run() {
  assert('private local configuration present', Boolean(password) && Object.values(accounts).every(Boolean));
  await expectStatus('health endpoint', '/health', null, 200);
  await expectStatus('protected endpoint rejects anonymous request', '/patients', null, 401);
  await expectStatus('document downloads reject anonymous requests', '/uploads/00000000-0000-4000-8000-000000000000/download', null, 401);

  const tokens = {};
  for (const role of Object.keys(accounts)) tokens[role] = await login(role);

  const profiles = {};
  for (const [role, token] of Object.entries(tokens)) {
    profiles[role] = await expectStatus(`${role} session profile`, '/auth/me', token, 200);
  }

  const adminChecks = [
    '/analytics', '/analytics/summary', '/patients', '/appointments', '/lab',
    '/departments', '/staff', '/billing', '/billing/summary', '/subscriptions',
    '/reports/patients', '/settings/facility', '/affiliates', '/admissions', '/admissions/beds',
  ];
  for (const pathname of adminChecks) {
    await expectStatus(`admin can read ${pathname}`, pathname, tokens.admin, 200);
  }
  // Policy change (owner-confirmed): ADMIN is the facility owner and sees every
  // record in their own facility, including encounters. Authoring signed clinical
  // content remains restricted — asserted below by the vitals/conditions probes.
  await expectStatus('admin can read clinical cases in own facility', '/cases', tokens.admin, 200);

  await expectStatus('doctor can read patients', '/patients', tokens.doctor, 200);
  await expectStatus('doctor can read cases', '/cases', tokens.doctor, 200);
  await expectStatus('doctor cannot manage staff', '/staff', tokens.doctor, 403);
  await expectStatus('doctor cannot access billing', '/billing', tokens.doctor, 403);

  await expectStatus('nurse can read admissions', '/admissions', tokens.nurse, 200);
  await expectStatus('nurse cannot manage staff', '/staff', tokens.nurse, 403);

  await expectStatus('records can read patients', '/patients', tokens.records, 200);
  await expectStatus('records can read appointments', '/appointments', tokens.records, 200);
  await expectStatus('records cannot access lab', '/lab', tokens.records, 403);
  await expectStatus('records cannot manage staff', '/staff', tokens.records, 403);

  await expectStatus('lab can read lab queue', '/lab', tokens.lab, 200);
  await expectStatus('lab cannot read patient records', '/patients', tokens.lab, 403);
  await expectStatus('lab cannot manage staff', '/staff', tokens.lab, 403);

  const patients = await request('/patients?limit=1', { token: tokens.admin });
  const patient = patients.data?.patients?.[0];
  assert('seeded patient is available', Boolean(patient?.id));
  if (patient?.id) {
    await expectStatus('admin can read patient detail', `/patients/${patient.id}`, tokens.admin, 200);
    await expectStatus('doctor can read patient detail', `/patients/${patient.id}`, tokens.doctor, 200);
    await expectStatus('records can read patient detail', `/patients/${patient.id}`, tokens.records, 200);

    await expectStatus('records cannot record vitals', `/patients/${patient.id}/vitals`, tokens.records, 403, { heartRate: 72 });
    await expectStatus('records cannot create allergies', `/patients/${patient.id}/allergies`, tokens.records, 403, { substance: 'Security probe' });
    await expectStatus('records cannot create clinical conditions', `/patients/${patient.id}/conditions`, tokens.records, 403, { name: 'Security probe' });
    await expectStatus('records cannot prescribe medication', `/patients/${patient.id}/prescriptions`, tokens.records, 403, { drugName: 'Security probe' });
    await expectStatus('administrators cannot record clinical vitals', `/patients/${patient.id}/vitals`, tokens.admin, 403, { heartRate: 72 });
    await expectStatus('nurses cannot create diagnoses', `/patients/${patient.id}/conditions`, tokens.nurse, 403, { name: 'Security probe' });
    await expectStatus('nurses cannot record impossible vital values', `/patients/${patient.id}/vitals`, tokens.nurse, 400, { temperature: 900 });

    const createdClinical = [];
    try {
      const nurseVital = await request(`/patients/${patient.id}/vitals`, {
        token: tokens.nurse,
        method: 'POST',
        body: { heartRate: 72, temperature: 36.8, notes: 'Automated permission check' },
      });
      assert('nurse can record attributed vitals with calculated values',
        nurseVital.status === 201
          && Boolean(nurseVital.data?.id)
          && nurseVital.data?.recordedById === profiles.nurse?.data?.user?.id,
        `status ${nurseVital.status}`);
      if (nurseVital.data?.id) createdClinical.push(['vitals', nurseVital.data.id]);

      const doctorAllergy = await request(`/patients/${patient.id}/allergies`, {
        token: tokens.doctor,
        method: 'POST',
        body: { substance: 'Automated permission check', severity: 'MILD' },
      });
      assert('doctor can create an allergy', doctorAllergy.status === 201 && Boolean(doctorAllergy.data?.id), `status ${doctorAllergy.status}`);
      if (doctorAllergy.data?.id) createdClinical.push(['allergy', doctorAllergy.data.id]);

      const doctorCondition = await request(`/patients/${patient.id}/conditions`, {
        token: tokens.doctor,
        method: 'POST',
        body: { name: 'Automated permission check', status: 'ACTIVE' },
      });
      assert('doctor can create a clinical condition', doctorCondition.status === 201 && Boolean(doctorCondition.data?.id), `status ${doctorCondition.status}`);
      if (doctorCondition.data?.id) createdClinical.push(['condition', doctorCondition.data.id]);

      const doctorPrescription = await request(`/patients/${patient.id}/prescriptions`, {
        token: tokens.doctor,
        method: 'POST',
        body: { drugName: 'Automated permission check', dosage: '1 mg', frequency: 'ONCE', duration: '1 day' },
      });
      assert('doctor can create a prescription', doctorPrescription.status === 201 && Boolean(doctorPrescription.data?.id), `status ${doctorPrescription.status}`);
      if (doctorPrescription.data?.id) createdClinical.push(['prescription', doctorPrescription.data.id]);
    } finally {
      for (const [model, id] of createdClinical) await db[model].deleteMany({ where: { id } });
    }
  }

  // Create or reuse a stable second facility to prove tenant isolation on both
  // reads and relationship-bearing writes. Values remain private and local.
  const secondaryEmail = `isolation.${accounts.admin}`;
  let secondaryLogin = await request('/auth/login', {
    method: 'POST', body: { email: secondaryEmail, password },
  });
  if (secondaryLogin.status === 401) {
    secondaryLogin = await request('/auth/register', {
      method: 'POST',
      body: {
        firstName: 'Isolation', lastName: 'Administrator', email: secondaryEmail,
        password, orgName: 'Awibi Isolation Test Facility', facilityType: 'CLINIC', plan: 'FREE',
      },
    });
  }
  const secondaryToken = secondaryLogin.data?.accessToken;
  assert('secondary facility session available', Boolean(secondaryToken), `status ${secondaryLogin.status}`);

  if (secondaryToken && patient?.id) {
    await expectStatus('secondary facility cannot read primary patient', `/patients/${patient.id}`, secondaryToken, 404);
    await expectStatus('secondary facility cannot create appointment for primary patient', '/appointments', secondaryToken, 404, {
      patientId: patient.id,
      scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
      visitType: 'ROUTINE',
    });
    await expectStatus('secondary facility cannot create lab order for primary patient', '/lab', secondaryToken, 404, {
      patientId: patient.id, testName: 'Isolation probe', testType: 'LAB',
    });
    await expectStatus('secondary facility cannot admit primary patient', '/admissions', secondaryToken, 404, {
      patientId: patient.id, diagnosis: 'Isolation probe',
    });
    await expectStatus('secondary facility cannot invoice primary patient', '/billing', secondaryToken, 404, {
      patientId: patient.id, items: [{ description: 'Isolation probe', amount: 1 }],
    });

    const documents = await request(`/uploads?patientId=${patient.id}`, { token: tokens.admin });
    assert('document metadata does not expose storage paths',
      documents.status === 200 && documents.data.every((doc) => !('url' in doc) && !('filename' in doc)));

    let securityDocument = documents.data.find((doc) => doc.originalName === 'security-upload-check.png');
    if (!securityDocument) {
      const form = new FormData();
      form.append('patientId', patient.id);
      form.append('file', new Blob([Buffer.from('89504e470d0a1a0a', 'hex')], { type: 'image/png' }), 'security-upload-check.png');
      const uploaded = await request('/uploads', { token: tokens.admin, method: 'POST', form });
      assert('valid signed document uploads successfully', uploaded.status === 200 && Boolean(uploaded.data?.id), `status ${uploaded.status}`);
      assert('upload response does not expose storage paths', !uploaded.data?.url && !uploaded.data?.filename);
      securityDocument = uploaded.data;
    } else {
      assert('valid signed document upload is reusable', true);
      assert('existing document metadata remains redacted', !securityDocument.url && !securityDocument.filename);
    }

    if (securityDocument?.id) {
      const downloaded = await request(`/uploads/${securityDocument.id}/download`, { token: tokens.admin });
      assert('authorized same-facility document download succeeds', downloaded.status === 200 && downloaded.data?.length > 0, `status ${downloaded.status}`);
      await expectStatus('cross-facility document download is hidden', `/uploads/${securityDocument.id}/download`, secondaryToken, 404);
    }

    const deceptiveForm = new FormData();
    deceptiveForm.append('patientId', patient.id);
    deceptiveForm.append('file', new Blob([Buffer.from('not a png')], { type: 'image/png' }), 'deceptive.png');
    const deceptiveUpload = await request('/uploads', { token: tokens.admin, method: 'POST', form: deceptiveForm });
    assert('deceptive extension with invalid signature is rejected', deceptiveUpload.status === 400, `status ${deceptiveUpload.status}`);
  }

  const primaryDepartments = await request('/departments', { token: tokens.admin });
  const primaryDepartment = primaryDepartments.data?.[0];
  if (secondaryToken && primaryDepartment?.id) {
    await expectStatus('secondary facility cannot add a bed to primary department', `/departments/${primaryDepartment.id}/beds`, secondaryToken, 404, {
      bedNumber: 'ISO-1', ward: 'Isolation', type: 'GENERAL',
    });
  }

  const primaryFacilityId = profiles.admin?.data?.user?.facilityId;
  const doctorId = profiles.doctor?.data?.user?.id;
  if (primaryFacilityId && doctorId && patient?.id) {
    await expectStatus('patient creation requires a name', '/patients', tokens.records, 400, { phone: '000' });
    let lifecyclePatientId;
    try {
      const subscriptionBefore = await db.subscription.findUnique({ where: { facilityId: primaryFacilityId } });
      const createdPatient = await request('/patients', {
        token: tokens.records,
        method: 'POST',
        body: {
          firstName: 'Lifecycle', lastName: 'Verification', gender: 'FEMALE',
          // A Nigerian mobile: +234 then a 10-digit number starting 7, 8 or 9.
          phone: `+2348${Date.now().toString().slice(-9)}`,
        },
      });
      lifecyclePatientId = createdPatient.data?.id;
      assert('records can create a validated patient', createdPatient.status === 201 && Boolean(lifecyclePatientId), `status ${createdPatient.status}`);

      if (lifecyclePatientId) {
        const updatedPatient = await request(`/patients/${lifecyclePatientId}`, {
          token: tokens.records,
          method: 'PUT',
          body: { lastName: 'Verification Updated' },
        });
        assert('records can update patient demographics', updatedPatient.status === 200 && updatedPatient.data?.lastName === 'Verification Updated');

        const archivedPatient = await request(`/patients/${lifecyclePatientId}`, {
          token: tokens.records,
          method: 'DELETE',
          body: { reason: 'Automated archive workflow check' },
        });
        assert('patient deletion performs a recoverable archive', archivedPatient.status === 200 && /archived/i.test(archivedPatient.data?.message || ''));
        await expectStatus('archived patient is hidden from normal detail reads', `/patients/${lifecyclePatientId}`, tokens.records, 404);
        const archivedList = await request('/patients/archived/list', { token: tokens.records });
        assert('authorized records staff can list archived patients',
          archivedList.status === 200 && archivedList.data?.some((row) => row.id === lifecyclePatientId));
        // Compare against the count taken immediately before each action rather
        // than a baseline captured earlier in the run. Registration now repairs
        // a drifted counter as a side effect, so an older baseline is not a
        // reliable reference point — and what actually matters is that a slot
        // is freed on archive and taken back on restore.
        const afterArchiveSubscription = await db.subscription.findUnique({ where: { facilityId: primaryFacilityId } });
        const liveAfterArchive = await db.patient.count({ where: { facilityId: primaryFacilityId, isArchived: false } });
        assert('archive restores the subscription patient slot',
          !subscriptionBefore || afterArchiveSubscription?.patientsUsed === liveAfterArchive,
          `counter ${afterArchiveSubscription?.patientsUsed}, actual ${liveAfterArchive}`);

        const restoredPatient = await request(`/patients/${lifecyclePatientId}/restore`, {
          token: tokens.records,
          method: 'PUT',
          body: { reason: 'Automated restore workflow check' },
        });
        assert('archived patient can be restored', restoredPatient.status === 200 && restoredPatient.data?.isArchived === false);
        const afterRestoreSubscription = await db.subscription.findUnique({ where: { facilityId: primaryFacilityId } });
        const liveAfterRestore = await db.patient.count({ where: { facilityId: primaryFacilityId, isArchived: false } });
        assert('restore reclaims the subscription patient slot',
          !subscriptionBefore || afterRestoreSubscription?.patientsUsed === liveAfterRestore,
          `counter ${afterRestoreSubscription?.patientsUsed}, actual ${liveAfterRestore}`);
        assert('restoring a patient takes a slot back',
          liveAfterRestore === liveAfterArchive + 1, `${liveAfterArchive} → ${liveAfterRestore}`);
      }
    } finally {
      if (lifecyclePatientId) {
        const stored = await db.patient.findUnique({ where: { id: lifecyclePatientId }, select: { isArchived: true } });
        await db.$transaction(async (tx) => {
          await tx.auditLog.deleteMany({ where: { resource: 'Patient', resourceId: lifecyclePatientId } });
          await tx.patient.deleteMany({ where: { id: lifecyclePatientId, facilityId: primaryFacilityId } });
          if (stored && !stored.isArchived) {
            await tx.subscription.updateMany({
              where: { facilityId: primaryFacilityId, patientsUsed: { gt: 0 } },
              data: { patientsUsed: { decrement: 1 } },
            });
          }
        });
      }
    }

    let atomicAppointmentId;
    try {
      const appointment = await request('/appointments', {
        token: tokens.admin,
        method: 'POST',
        body: {
          patientId: patient.id,
          doctorId,
          scheduledAt: new Date(Date.now() + 180 * 86_400_000).toISOString(),
          visitType: 'ROUTINE',
          duration: 30,
          charges: 1250,
          remarks: 'Automated atomicity check',
        },
      });
      atomicAppointmentId = appointment.data?.id;
      assert('appointment with charge is created', appointment.status === 201 && Boolean(atomicAppointmentId), `status ${appointment.status}`);
      const invoice = atomicAppointmentId
        ? await db.invoice.findFirst({ where: { appointmentId: atomicAppointmentId, facilityId: primaryFacilityId } })
        : null;
      assert('appointment transaction creates its linked invoice', Boolean(invoice) && Number(invoice.total) === 1250);
    } finally {
      if (atomicAppointmentId) {
        await db.$transaction([
          db.invoice.deleteMany({ where: { appointmentId: atomicAppointmentId } }),
          db.appointment.deleteMany({ where: { id: atomicAppointmentId, facilityId: primaryFacilityId } }),
        ]);
      }
    }

    const admissionPatient = await db.patient.findFirst({
      where: { facilityId: primaryFacilityId, admissions: { none: { status: 'ADMITTED' } } },
      select: { id: true, status: true },
    });
    const availableBed = await db.bed.findFirst({
      where: { facilityId: primaryFacilityId, status: 'AVAILABLE', currentPatientId: null },
      select: { id: true },
    });
    assert('admission transaction fixture is available', Boolean(admissionPatient && availableBed));

    let atomicAdmissionId;
    if (admissionPatient && availableBed) {
      try {
        const admission = await request('/admissions', {
          token: tokens.admin,
          method: 'POST',
          body: {
            patientId: admissionPatient.id,
            bedId: availableBed.id,
            diagnosis: 'Automated atomicity check',
          },
        });
        atomicAdmissionId = admission.data?.id;
        assert('atomic admission succeeds', admission.status === 201 && Boolean(atomicAdmissionId), `status ${admission.status}`);
        const [reservedBed, admittedPatient] = await Promise.all([
          db.bed.findUnique({ where: { id: availableBed.id } }),
          db.patient.findUnique({ where: { id: admissionPatient.id } }),
        ]);
        assert('admission atomically reserves bed and updates patient',
          reservedBed?.status === 'OCCUPIED'
            && reservedBed?.currentPatientId === admissionPatient.id
            && admittedPatient?.status === 'IN_PATIENT');

        const duplicate = await request('/admissions', {
          token: tokens.admin,
          method: 'POST',
          body: { patientId: admissionPatient.id, diagnosis: 'Duplicate probe' },
        });
        assert('duplicate active admission is rejected', duplicate.status === 409, `status ${duplicate.status}`);

        const discharge = await request(`/admissions/${atomicAdmissionId}/discharge`, {
          token: tokens.admin,
          method: 'PUT',
          body: { status: 'DISCHARGED', notes: 'Automated atomicity check complete' },
        });
        assert('atomic discharge succeeds', discharge.status === 200 && discharge.data?.status === 'DISCHARGED', `status ${discharge.status}`);
        const [releasedBed, dischargedPatient] = await Promise.all([
          db.bed.findUnique({ where: { id: availableBed.id } }),
          db.patient.findUnique({ where: { id: admissionPatient.id } }),
        ]);
        assert('discharge atomically releases bed and updates patient',
          releasedBed?.status === 'AVAILABLE'
            && releasedBed?.currentPatientId === null
            && dischargedPatient?.status === 'DISCHARGED');

        const repeatedDischarge = await request(`/admissions/${atomicAdmissionId}/discharge`, {
          token: tokens.admin,
          method: 'PUT',
          body: { status: 'DISCHARGED' },
        });
        assert('repeated discharge is rejected', repeatedDischarge.status === 409, `status ${repeatedDischarge.status}`);
      } finally {
        if (atomicAdmissionId) {
          await db.$transaction([
            db.admission.deleteMany({ where: { id: atomicAdmissionId, facilityId: primaryFacilityId } }),
            db.bed.update({ where: { id: availableBed.id }, data: { status: 'AVAILABLE', currentPatientId: null } }),
            db.patient.update({ where: { id: admissionPatient.id }, data: { status: admissionPatient.status } }),
          ]);
        }
      }
    }
  }

  const nurseId = profiles.nurse?.data?.user?.id;
  if (nurseId) {
    const originalNurseAuth = await db.user.findUnique({
      where: { id: nurseId },
      select: { passwordHash: true, mustChangePassword: true, refreshToken: true, lastLoginAt: true },
    });
    try {
      const reset = await request(`/staff/${nurseId}/reset-password`, {
        token: tokens.admin,
        method: 'PUT',
        body: {},
      });
      const temporaryPassword = reset.data?.tempPassword;
      assert('staff reset issues a strong temporary password',
        reset.status === 200
          && typeof temporaryPassword === 'string'
          && temporaryPassword.length >= 12
          && /[a-z]/.test(temporaryPassword)
          && /[A-Z]/.test(temporaryPassword)
          && /\d/.test(temporaryPassword)
          && /[^A-Za-z0-9]/.test(temporaryPassword));

      const temporaryLogin = await request('/auth/login', {
        method: 'POST',
        body: { email: accounts.nurse, password: temporaryPassword },
      });
      const temporaryToken = temporaryLogin.data?.accessToken;
      assert('staff can authenticate with the one-time password',
        temporaryLogin.status === 200 && Boolean(temporaryToken) && temporaryLogin.data?.user?.mustChangePassword === true,
        `status ${temporaryLogin.status}`);
      await expectStatus('temporary-password session is blocked from clinical data', '/admissions', temporaryToken, 403);
      await expectStatus('temporary-password session can read its own profile', '/auth/me', temporaryToken, 200);

      const weakChange = await request('/auth/change-password', {
        token: temporaryToken,
        method: 'POST',
        body: { currentPassword: temporaryPassword, newPassword: 'StillWeak1!' },
      });
      assert('forced password change rejects weak replacements', weakChange.status === 400, `status ${weakChange.status}`);

      const replacementPassword = `Replacement!${Date.now()}z`;
      const changed = await request('/auth/change-password', {
        token: temporaryToken,
        method: 'POST',
        body: { currentPassword: temporaryPassword, newPassword: replacementPassword },
      });
      assert('forced password change accepts a strong replacement', changed.status === 200, `status ${changed.status}`);
      await expectStatus('clinical access is restored after password change', '/admissions', temporaryToken, 200);
    } finally {
      if (originalNurseAuth) {
        await db.user.update({ where: { id: nurseId }, data: originalNurseAuth });
      }
    }
  }

  // ── Ward documentation, diagnostics lifecycle, signing, platform ──────────
  // These lock in the clinical behaviour added for the pilot so it cannot
  // silently regress.
  {
    const patients = await db.patient.findMany({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false }, take: 1,
    });
    const patientId = patients[0]?.id;

    // Monitoring: nurse authors, admin only observes.
    await expectStatus('monitoring templates are available to the nurse', '/nursing/monitoring-templates', tokens.nurse, 200);
    await expectStatus('admin can read ward monitoring', '/nursing/monitoring-sheets', tokens.admin, 200);
    await expectStatus('admin cannot author a monitoring sheet', '/nursing/monitoring-sheets', tokens.admin, 403,
      { patientId, type: 'IV_FLUID' });
    await expectStatus('records officer has no ward monitoring access', '/nursing/monitoring-sheets', tokens.records, 403);
    await expectStatus('nurse ward summary loads', '/nursing/stats', tokens.nurse, 200);

    if (patientId) {
      const sheet = await request('/nursing/monitoring-sheets', {
        token: tokens.nurse, method: 'POST',
        body: { patientId, type: 'BLOOD_TRANSFUSION', targetValue: 450 },
      });
      assert('nurse creates a transfusion monitoring sheet', sheet.status === 201, `status ${sheet.status}`);
      const sheetId = sheet.data?.id;

      if (sheetId) {
        assert('transfusion template observes every 15 minutes', sheet.data.frequencyMins === 15, `got ${sheet.data.frequencyMins}`);
        const future = await request(`/nursing/monitoring-sheets/${sheetId}/entries`, {
          token: tokens.nurse, method: 'POST',
          body: { values: { temperature: 37 }, recordedAt: '2099-01-01T00:00:00Z' },
        });
        assert('future-dated observation is rejected', future.status === 400, `status ${future.status}`);

        const entry = await request(`/nursing/monitoring-sheets/${sheetId}/entries`, {
          token: tokens.nurse, method: 'POST',
          body: { values: { temperature: 38.4 }, intakeMl: 150, isAbnormal: true },
        });
        assert('nurse records a transfusion observation', entry.status === 201, `status ${entry.status}`);

        const loaded = await request(`/nursing/monitoring-sheets/${sheetId}`, { token: tokens.nurse });
        assert('fluid balance is computed from entries', loaded.data?.totals?.intakeMl === 150, `got ${loaded.data?.totals?.intakeMl}`);

        await db.monitoringEntry.deleteMany({ where: { sheetId } });
        await db.monitoringSheet.delete({ where: { id: sheetId } });
      }

      // Medication administration: deviations must be justified.
      const noReason = await request('/nursing/drug-administrations', {
        token: tokens.nurse, method: 'POST',
        body: { patientId, drugName: 'Adrenaline 1mg', route: 'IM' },
      });
      assert('unscheduled dose without a reason is rejected', noReason.status === 400, `status ${noReason.status}`);

      const withReason = await request('/nursing/drug-administrations', {
        token: tokens.nurse, method: 'POST',
        body: { patientId, drugName: 'Adrenaline 1mg', route: 'IM', dose: '1mg', reason: 'Anaphylaxis — smoke test' },
      });
      assert('unscheduled dose with a reason is accepted', withReason.status === 201, `status ${withReason.status}`);
      if (withReason.data?.id) await db.drugAdministration.delete({ where: { id: withReason.data.id } });

      // Diagnostics: catalogue drives reference ranges and critical flagging.
      const catalogue = await request('/lab/catalogue?search=Potassium', { token: tokens.doctor });
      assert('diagnostics catalogue is readable', catalogue.status === 200 && catalogue.data?.tests?.length > 0,
        `status ${catalogue.status}`);
      const potassium = catalogue.data?.tests?.[0];

      if (potassium) {
        const order = await request('/lab', {
          token: tokens.doctor, method: 'POST',
          body: { patientId, catalogueTestId: potassium.id, priority: 'STAT' },
        });
        assert('doctor orders from the catalogue', order.status === 201, `status ${order.status}`);
        const labId = order.data?.id;

        if (labId) {
          assert('order inherits the catalogue reference range',
            order.data.referenceLow === potassium.referenceLow && order.data.resultUnit === potassium.unit,
            `${order.data.referenceLow}-${order.data.referenceHigh} ${order.data.resultUnit}`);

          const illegal = await request(`/lab/${labId}/status`, {
            token: tokens.lab, method: 'POST', body: { status: 'COMPLETED' },
          });
          assert('invalid investigation transition is rejected', illegal.status === 409, `status ${illegal.status}`);

          await request(`/lab/${labId}/status`, { token: tokens.lab, method: 'POST', body: { status: 'COLLECTED', specimenId: 'SMOKE-1' } });
          const inProgress = await request(`/lab/${labId}/status`, { token: tokens.lab, method: 'POST', body: { status: 'IN_PROGRESS' } });
          assert('specimen collection is timestamped', Boolean(inProgress.data?.collectedAt), 'collectedAt missing');

          const critical = await request(`/lab/${labId}/result`, {
            token: tokens.lab, method: 'PUT', body: { resultValue: 6.9, result: 'K+ 6.9 mmol/L' },
          });
          assert('critical result is auto-flagged from the catalogue range',
            critical.data?.isCritical === true && critical.data?.abnormalFlag === 'CRITICAL_HIGH',
            `flag ${critical.data?.abnormalFlag}`);

          const alerts = await request('/lab/alerts/critical', { token: tokens.doctor });
          assert('critical result reaches the doctor alert queue', alerts.data?.criticalCount >= 1, `count ${alerts.data?.criticalCount}`);

          await expectStatus('admin cannot acknowledge a critical result', `/lab/${labId}/acknowledge`, tokens.admin, 403, {});
          const ack = await request(`/lab/${labId}/acknowledge`, {
            token: tokens.doctor, method: 'POST', body: { reason: 'Smoke test acknowledgement' },
          });
          assert('doctor acknowledges the critical result', ack.status === 200 && Boolean(ack.data?.criticalAckAt), `status ${ack.status}`);

          await db.labRequest.delete({ where: { id: labId } });
        }
      }

      // Clinical notes: signing is restricted and makes the note immutable.
      // Every new encounter must carry a context, so the fixture picks one the
      // same way a doctor would.
      const wardRoundType = (await request('/encounter-types', { token: tokens.doctor }))
        .data?.types?.find((x) => x.name === 'Inpatient Ward Round');
      const draft = await request('/cases', {
        token: tokens.doctor, method: 'POST',
        body: {
          patientId, title: 'Smoke test case', encounterType: 'WARD_ROUND',
          encounterTypeId: wardRoundType?.id,
          chiefComplaint: 'Smoke test', doctorsOrders: 'Observe', captureMethod: 'NOTE_TAKER',
        },
      });
      assert('doctor creates a ward-round case', draft.status === 201, `status ${draft.status}`);
      const caseId = draft.data?.id;

      if (caseId) {
        assert('encounter type is stored', draft.data.encounterType === 'WARD_ROUND', draft.data.encounterType);

        const noDiagnosis = await request(`/cases/${caseId}/sign`, { token: tokens.doctor, method: 'POST', body: {} });
        assert('a note cannot be signed without a diagnosis', noDiagnosis.status === 400, `status ${noDiagnosis.status}`);

        await request(`/cases/${caseId}`, {
          token: tokens.doctor, method: 'PUT',
          body: { icdCodes: [{ code: 'J18.9', description: 'Pneumonia' }] },
        });
        const stale = await request(`/cases/${caseId}`, { token: tokens.doctor, method: 'PUT', body: { plan: 'x', version: 1 } });
        assert('stale edits are blocked by optimistic locking', stale.status === 409, `status ${stale.status}`);

        await expectStatus('admin cannot sign a clinical note', `/cases/${caseId}/sign`, tokens.admin, 403, {});

        const signed = await request(`/cases/${caseId}/sign`, { token: tokens.doctor, method: 'POST', body: {} });
        assert('doctor signs the note', signed.status === 200 && signed.data?.status === 'SIGNED', `status ${signed.status}`);

        const edit = await request(`/cases/${caseId}`, { token: tokens.doctor, method: 'PUT', body: { plan: 'tamper' } });
        assert('a signed note cannot be edited', edit.status === 409, `status ${edit.status}`);
        const remove = await request(`/cases/${caseId}`, { token: tokens.doctor, method: 'DELETE' });
        assert('a signed note cannot be deleted', remove.status === 409, `status ${remove.status}`);

        await db.case.delete({ where: { id: caseId } });
      }
    }

    // Platform oversight is Awibi-staff only.
    await expectStatus('facility admin cannot read platform metrics', '/platform/overview', tokens.admin, 403);
    await expectStatus('doctor cannot read platform metrics', '/platform/overview', tokens.doctor, 403);
    await expectStatus('facility admin cannot list platform facilities', '/platform/facilities', tokens.admin, 403);
  }

  // ── Patient lookup, households, insurance, emergency, invoice PDF ─────────
  {
    // Type-ahead lookup replaces the old load-every-patient dropdowns.
    const shortQuery = await request('/patients/lookup?q=a', { token: tokens.records });
    assert('lookup ignores single-character queries', shortQuery.data?.patients?.length === 0, 'returned rows');

    const byName = await request('/patients/lookup?q=Dav', { token: tokens.records });
    assert('lookup finds a patient by name fragment', byName.data?.patients?.length > 0, 'no match');
    const david = byName.data?.patients?.[0];

    if (david) {
      assert('lookup returns only picker fields',
        !('address' in david) && !('nin' in david) && Boolean(david.universalPatientId),
        `keys ${Object.keys(david).join(',')}`);

      const byUpid = await request(`/patients/lookup?q=${encodeURIComponent(david.universalPatientId)}`, { token: tokens.records });
      assert('lookup finds a patient by exact UPID',
        byUpid.data?.patients?.[0]?.id === david.id, 'exact match not first');

      // ── Households ───────────────────────────────────────────────────────
      const household = await request('/households', {
        token: tokens.records, method: 'POST',
        body: { name: `Smoke Household ${Date.now()}`, principalPatientId: david.id, address: '1 Smoke Street' },
      });
      assert('records officer creates a household', household.status === 201, `status ${household.status}`);
      const householdId = household.data?.id;

      const others = await request('/patients/lookup?q=Oli', { token: tokens.records });
      const dependant = others.data?.patients?.find((p) => p.id !== david.id);

      if (householdId && dependant) {
        // Start from a known state: inheritance is deliberately skipped when the
        // dependant already carries an active policy, so leftover data from a
        // previous run would mask a real regression.
        await db.insurance.deleteMany({ where: { patientId: { in: [david.id, dependant.id] } } });

        // Insurance on the principal, then inheritance by the dependant.
        const policy = await request('/insurance', {
          token: tokens.records, method: 'POST',
          body: {
            patientId: david.id, provider: 'SmokeHMO', planName: 'Smoke Plan',
            policyNumber: 'SMK-1', coverageDetails: { Outpatient: '100%', Copay: 500 },
          },
        });
        assert('insurance policy is recorded', policy.status === 201, `status ${policy.status}`);

        const added = await request(`/households/${householdId}/members`, {
          token: tokens.records, method: 'POST',
          body: { patientId: dependant.id, relationship: 'CHILD', inheritInsurance: true },
        });
        assert('dependant joins the household', added.status === 201, `status ${added.status}`);

        const inherited = await request(`/insurance/patient/${dependant.id}`, { token: tokens.records });
        assert('dependant inherits the principal policy',
          inherited.data?.active?.provider === 'SmokeHMO' && inherited.data?.active?.principalInsured === false,
          'not inherited');

        const history = await request(`/households/${householdId}/family-history`, { token: tokens.doctor });
        assert('family history aggregates across the household',
          Array.isArray(history.data?.conditions) && history.data.household.members.length >= 2,
          `members ${history.data?.household?.members?.length}`);

        // A doctor must not be editing insurance policies.
        await expectStatus('doctor cannot record insurance', '/insurance', tokens.doctor, 403,
          { patientId: david.id, provider: 'Nope' });

        // Invoice for the dependant, billed to the principal, as a PDF.
        const invoice = await request('/billing', {
          token: tokens.admin, method: 'POST',
          body: {
            patientId: dependant.id,
            items: [{ category: 'Consultation', description: 'Smoke consultation', quantity: 1, unitPrice: 5000, amount: 5000 }],
          },
        });
        assert('invoice is created for the dependant', invoice.status === 201, `status ${invoice.status}`);
        const invoiceId = invoice.data?.id;

        if (invoiceId) {
          const pdf = await fetch(`${baseUrl}/billing/${invoiceId}/pdf`, {
            headers: { Authorization: `Bearer ${tokens.admin}` },
          });
          const bytes = Buffer.from(await pdf.arrayBuffer());
          assert('invoice PDF is generated', pdf.status === 200 && bytes.slice(0, 5).toString() === '%PDF-',
            `status ${pdf.status}`);
          assert('invoice PDF has content', bytes.length > 1500, `${bytes.length} bytes`);
          await db.invoice.delete({ where: { id: invoiceId } });
        }

        await db.insurance.deleteMany({ where: { patientId: { in: [david.id, dependant.id] } } });
        await request(`/households/${householdId}/members/${dependant.id}`, { token: tokens.records, method: 'DELETE' });
      }

      if (householdId) {
        await db.patient.updateMany({ where: { householdId }, data: { householdId: null, relationship: null } });
        await db.household.delete({ where: { id: householdId } });
      }

      // ── Emergency: capture first, identify later ─────────────────────────
      const emergency = await request('/emergency', {
        token: tokens.records, method: 'POST',
        body: {
          presentingName: 'Smoke Unknown', approximateAge: 40, triage: 'RESUSCITATION',
          chiefComplaint: 'Smoke test collapse',
          redFlags: [{ key: 'consciousness', label: 'Altered consciousness', checked: true }],
        },
      });
      assert('emergency opens without a patient ID', emergency.status === 201, `status ${emergency.status}`);
      const emergencyId = emergency.data?.id;
      const tempPatientId = emergency.data?.patient?.id;

      if (emergencyId && tempPatientId) {
        assert('emergency creates a flagged temporary record',
          emergency.data.patient.isEmergencyTemp === true, 'not flagged');

        const vital = await request(`/patients/${tempPatientId}/vitals`, {
          token: tokens.nurse, method: 'POST',
          body: { heartRate: 128, respiratoryRate: 28, oxygenSaturation: 89 },
        });
        assert('vitals record against the temporary patient', vital.status === 201, `status ${vital.status}`);

        const beforeVitals = await request(`/patients/${david.id}/vitals`, { token: tokens.doctor });
        const beforeCount = Array.isArray(beforeVitals.data) ? beforeVitals.data.length : 0;

        const merged = await request(`/emergency/${emergencyId}/link`, {
          token: tokens.records, method: 'POST', body: { targetPatientId: david.id },
        });
        assert('emergency record merges into a known patient', merged.status === 200, `status ${merged.status}`);

        const afterVitals = await request(`/patients/${david.id}/vitals`, { token: tokens.doctor });
        const afterCount = Array.isArray(afterVitals.data) ? afterVitals.data.length : 0;
        assert('merge moves clinical data without loss', afterCount === beforeCount + 1,
          `${beforeCount} -> ${afterCount}`);

        const reMerge = await request(`/emergency/${emergencyId}/link`, {
          token: tokens.records, method: 'POST', body: { targetPatientId: david.id },
        });
        assert('a merged emergency cannot be merged again', reMerge.status === 409, `status ${reMerge.status}`);

        // Clean up the vital that moved onto the permanent record.
        const moved = await db.vitals.findFirst({
          where: { patientId: david.id, heartRate: 128, respiratoryRate: 28 },
          orderBy: { createdAt: 'desc' },
        });
        if (moved) await db.vitals.delete({ where: { id: moved.id } });
        await db.emergencyEncounter.delete({ where: { id: emergencyId } });
        await db.patient.delete({ where: { id: tempPatientId } });
      }
    }
  }

  // ── Orders, nursing worklist, public booking ─────────────────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });

    await expectStatus('doctor can read the drug formulary', '/orders/drug-catalogue', tokens.doctor, 200);
    await expectStatus('nurse can read the drug formulary', '/orders/drug-catalogue', tokens.nurse, 200);

    if (patient) {
      // Prescribing is a prescriber's act.
      await expectStatus('nurse cannot prescribe', '/orders/medications', tokens.nurse, 403,
        { patientId: patient.id, drugName: 'Test' });
      await expectStatus('nurse cannot create a nursing order', '/orders/nursing-tasks', tokens.nurse, 403,
        { patientId: patient.id, title: 'Test' });

      const meds = await request('/orders/medications', {
        token: tokens.doctor, method: 'POST',
        body: {
          patientId: patient.id,
          medications: [
            { drugName: 'Smoke Amoxicillin', dosage: '500mg', frequency: 'TDS', route: 'ORAL' },
            { drugName: 'Smoke Paracetamol', dosage: '1g', frequency: 'TDS', route: 'ORAL' },
          ],
        },
      });
      assert('doctor prescribes several medications at once', meds.status === 201 && meds.data?.count === 2,
        `status ${meds.status}`);

      const routine = await request('/orders/nursing-tasks', {
        token: tokens.doctor, method: 'POST',
        body: { patientId: patient.id, title: 'Smoke routine task', priority: 'ROUTINE' },
      });
      const stat = await request('/orders/nursing-tasks', {
        token: tokens.doctor, method: 'POST',
        body: { patientId: patient.id, title: 'Smoke STAT task', priority: 'STAT' },
      });
      const recurring = await request('/orders/nursing-tasks', {
        token: tokens.doctor, method: 'POST',
        body: { patientId: patient.id, title: 'Smoke recurring task', priority: 'URGENT', frequencyHours: 4 },
      });
      assert('doctor creates nursing orders', routine.status === 201 && stat.status === 201, 'not created');

      const worklist = await request('/orders/worklist', { token: tokens.nurse });
      const titles = (worklist.data?.tasks || []).map((t) => t.title);
      const statIndex = titles.indexOf('Smoke STAT task');
      const routineIndex = titles.indexOf('Smoke routine task');
      // Prisma sorts enums by declaration order, which would bury a STAT task.
      assert('a STAT task outranks a routine task on the worklist',
        statIndex >= 0 && routineIndex >= 0 && statIndex < routineIndex,
        `STAT at ${statIndex}, routine at ${routineIndex}`);

      if (recurring.data?.id) {
        const done = await request(`/orders/nursing-tasks/${recurring.data.id}/complete`, {
          token: tokens.nurse, method: 'POST', body: { note: 'Smoke completion' },
        });
        assert('nurse completes a nursing task', done.status === 200, `status ${done.status}`);

        const regenerated = await db.nursingTask.findFirst({
          where: { patientId: patient.id, title: 'Smoke recurring task', status: 'PENDING' },
        });
        assert('a recurring task reschedules itself', Boolean(regenerated), 'no follow-up task created');
      }

      // Doctors do not execute nursing tasks.
      if (routine.data?.id) {
        await expectStatus('doctor cannot complete a nursing task', `/orders/nursing-tasks/${routine.data.id}/complete`,
          tokens.doctor, 403, {});
      }

      await db.nursingTask.deleteMany({ where: { patientId: patient.id, title: { startsWith: 'Smoke ' } } });
      await db.prescription.deleteMany({ where: { patientId: patient.id, drugName: { startsWith: 'Smoke ' } } });
    }

    // ── Public, unauthenticated surface ─────────────────────────────────────
    const clinics = await fetch(`${baseUrl}/public/clinics`).then((r) => r.json());
    const slug = clinics.clinics?.find((c) => c.slug?.includes('uch'))?.slug;
    assert('public clinic directory is reachable without auth', Boolean(slug), 'no slug');

    if (slug) {
      const page = await fetch(`${baseUrl}/public/clinic/${slug}`).then((r) => r.json());
      assert('public clinic page loads without auth', Boolean(page.clinic?.name), 'no clinic');
      // The public page must never expose staff contact details.
      const doctor = page.doctors?.[0];
      assert('public doctor listing exposes no contact details',
        !doctor || (!('email' in doctor) && !('phone' in doctor) && !('staffId' in doctor)),
        `keys ${doctor ? Object.keys(doctor).join(',') : 'none'}`);

      const triage = await fetch(`${baseUrl}/public/symptom-checker`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ redFlags: ['chest_pain'], severity: 5 }),
      }).then((r) => r.json());
      assert('a red flag routes the patient to emergency', triage.routing === 'EMERGENCY', `got ${triage.routing}`);

      const verify = await fetch(`${baseUrl}/public/clinic/${slug}/verify-patient`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '09090909090' }),
      }).then((r) => r.json());
      // Only a first name and an opaque ref may come back.
      assert('returning-patient check does not leak the record',
        !('lastName' in verify) && !('dateOfBirth' in verify) && !('universalPatientId' in verify),
        `keys ${Object.keys(verify).join(',')}`);

      const badPhone = await fetch(`${baseUrl}/public/clinic/${slug}/booking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName: 'Smoke Tester', phone: '12345', requestedAt: new Date(Date.now() + 86400000).toISOString() }),
      });
      assert('a malformed phone number is rejected', badPhone.status === 400, `status ${badPhone.status}`);

      const created = await fetch(`${baseUrl}/public/clinic/${slug}/booking`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: 'Smoke Booking', phone: '08012345678',
          requestedAt: new Date(Date.now() + 3 * 86400000).toISOString(), reason: 'Smoke test',
        }),
      });
      const booking = await created.json();
      assert('a booking request is accepted', created.status === 201 && Boolean(booking.reference), `status ${created.status}`);

      // Confirming a public request is reception's decision, not a clinician's.
      const row = await db.bookingRequest.findUnique({ where: { reference: booking.reference } });
      if (row) {
        await expectStatus('nurse cannot approve a booking', `/bookings/${row.id}/confirm`, tokens.nurse, 403, {});
        await expectStatus('doctor cannot approve a booking', `/bookings/${row.id}/confirm`, tokens.doctor, 403, {});
        await expectStatus('records officer can list booking requests', '/bookings', tokens.records, 200);

        const rejected = await request(`/bookings/${row.id}/reject`, { token: tokens.records, method: 'POST', body: {} });
        assert('rejecting a booking requires a reason', rejected.status === 400, `status ${rejected.status}`);

        const confirmed = await request(`/bookings/${row.id}/confirm`, { token: tokens.records, method: 'POST', body: {} });
        assert('records officer confirms a booking', confirmed.status === 200, `status ${confirmed.status}`);
        assert('confirming creates a provisional patient for a new booker',
          confirmed.data?.createdPatient === true, 'no patient created');

        if (confirmed.data?.appointment?.id) await db.appointment.delete({ where: { id: confirmed.data.appointment.id } });
        if (confirmed.data?.patientId) await db.patient.delete({ where: { id: confirmed.data.patientId } });
        await db.bookingRequest.delete({ where: { id: row.id } });
      }
    }
  }

  // ── Regressions found in the 4 August audit ──────────────────────────────
  // Each of these was a real defect. They are asserted here so they cannot
  // silently come back.
  {
    // A nurse or doctor at the bedside must be able to open an emergency.
    // This was previously gated on patient_demographics_write, which only
    // reception and administration hold — so an ER nurse could not start one.
    for (const [role, token] of [['nurse', tokens.nurse], ['doctor', tokens.doctor], ['records', tokens.records]]) {
      const opened = await request('/emergency', {
        token, method: 'POST',
        body: { presentingName: `Smoke ${role} emergency`, triage: 'URGENT' },
      });
      assert(`${role} can open an emergency encounter`, opened.status === 201, `status ${opened.status}`);
      if (opened.data?.id) {
        await db.emergencyEncounter.delete({ where: { id: opened.data.id } });
        if (opened.data.patient?.id) await db.patient.delete({ where: { id: opened.data.patient.id } });
      }
    }
    await expectStatus('a lab scientist cannot open an emergency', '/emergency', tokens.lab, 403,
      { presentingName: 'Smoke lab' });

    // Platform revenue must report Awibi's subscription income, not the
    // hospitals' clinical billing. Reporting the latter as revenue overstated
    // the business by whatever multiple the tenants happened to bill.
    const superAdminToken = await loginSuperAdmin();
    const platform = superAdminToken
      ? await request('/platform/overview', { token: superAdminToken })
      : { status: 0 };
    assert('platform metrics reachable by the super admin', platform.status === 200, `status ${platform.status}`);
    if (platform.status === 200) {
      const subs = await db.subscription.aggregate({ _sum: { amount: true }, where: { status: 'ACTIVE' } });
      const clinical = await db.invoice.aggregate({ _sum: { amountPaid: true } });
      assert('platform revenue reports subscription income',
        Number(platform.data?.platformRevenue?.recurringPerCycle) === Number(subs._sum.amount || 0),
        `got ${platform.data?.platformRevenue?.recurringPerCycle}, subscriptions ${subs._sum.amount}`);
      assert('clinical billing is reported separately from revenue',
        Number(platform.data?.clinicalVolume?.collectedAllTime) === Number(clinical._sum.amountPaid || 0),
        `got ${platform.data?.clinicalVolume?.collectedAllTime}`);
      assert('the ambiguous "revenue" field is gone', platform.data?.revenue === undefined);

      const subsPage = await request('/platform/subscriptions', { token: superAdminToken });
      assert('subscriptions page lists every facility',
        subsPage.status === 200 && subsPage.data?.subscriptions?.length === await db.subscription.count(),
        `status ${subsPage.status}`);
    }

    // Every signed-in user holds `settings` to reach their own profile, so the
    // facility record must not hand a lab scientist the licence number, NHIS
    // code or the raw settings blob.
    const labFacility = await request('/settings/facility', { token: tokens.lab });
    const leaked = ['licenseNumber', 'nhisCode', 'settings', 'subscription']
      .filter((k) => labFacility.data && k in labFacility.data);
    assert('facility settings hide administrative fields from clinical staff',
      leaked.length === 0, `leaked ${leaked.join(', ')}`);
    assert('facility settings still expose branding the UI needs', Boolean(labFacility.data?.name));
    // Facility settings are edited with PUT, so probe the real method.
    const labEdit = await request('/settings/facility', {
      token: tokens.lab, method: 'PUT', body: { name: 'Should not apply' },
    });
    assert('a lab scientist cannot edit facility settings', labEdit.status === 403, `status ${labEdit.status}`);
    const facilityAfter = await request('/settings/facility', { token: tokens.admin });
    assert('facility name survives the blocked write',
      facilityAfter.data?.name !== 'Should not apply', facilityAfter.data?.name);
  }

  // ── Registration integrity (audit findings) ──────────────────────────────
  {
    const created = [];
    const register = (body) => request('/patients', { token: tokens.records, method: 'POST', body });

    // Nigerian mobile formats staff actually type must be accepted; anything
    // that is not a real number must be refused at the door.
    for (const [phone, shouldAccept] of [
      ['08031234567', true], ['+2348031234567', true], ['2348031234567', true],
      ['12345', false], ['0603123456', false], ['08031234567890', false],
    ]) {
      const r = await register({ firstName: 'SmokePhone', lastName: 'Check', gender: 'MALE', phone });
      assert(`phone ${phone} is ${shouldAccept ? 'accepted' : 'rejected'}`,
        shouldAccept ? r.status === 201 : r.status === 400, `status ${r.status}`);
      if (r.data?.id) created.push(r.data.id);
    }

    // A future date of birth is always a typo and poisons age, the guardian
    // prompt and every growth calculation downstream.
    const future = await register({ firstName: 'SmokeDob', lastName: 'Future', gender: 'MALE', dateOfBirth: '2099-01-01' });
    assert('a future date of birth is rejected', future.status === 400, `status ${future.status}`);
    if (future.data?.id) created.push(future.data.id);

    // A shared family phone must warn, not block.
    const first = await register({ firstName: 'SmokeFamily', lastName: 'One', gender: 'MALE', phone: '08055443322' });
    if (first.data?.id) created.push(first.data.id);
    const second = await register({ firstName: 'SmokeFamily', lastName: 'Two', gender: 'FEMALE', phone: '08055443322' });
    if (second.data?.id) created.push(second.data.id);
    assert('a duplicate phone number is allowed', second.status === 201, `status ${second.status}`);
    assert('a duplicate phone number warns the receptionist',
      Boolean(second.data?.warnings?.some((w) => w.code === 'DUPLICATE_PHONE')));

    const childDob = new Date();
    childDob.setFullYear(childDob.getFullYear() - 7);
    const child = await register({
      firstName: 'SmokeChild', lastName: 'Guardian', gender: 'MALE',
      dateOfBirth: childDob.toISOString().slice(0, 10),
    });
    if (child.data?.id) created.push(child.data.id);
    assert('a patient under 18 prompts for a guardian',
      Boolean(child.data?.warnings?.some((w) => w.code === 'GUARDIAN_REQUIRED')));

    // MRN was generated from a row count, so two receptionists registering at
    // the same moment produced the same chart number, and any deletion made the
    // count fall and reuse a number already on a chart.
    const concurrent = await Promise.all(Array.from({ length: 6 }, (_, i) =>
      register({ firstName: 'SmokeRace', lastName: `P${i}`, gender: 'MALE' })));
    const succeeded = concurrent.filter((r) => r.status === 201);
    succeeded.forEach((r) => created.push(r.data.id));
    const mrns = succeeded.map((r) => r.data.mrn);
    assert('concurrent registrations all succeed', succeeded.length === 6, `${succeeded.length}/6`);
    assert('concurrent registrations never share an MRN',
      new Set(mrns).size === mrns.length, mrns.join(' '));

    for (const id of created) {
      await db.patient.delete({ where: { id } }).catch(() => {});
    }
  }

  // ── Ward documentation reaches the patient chart ─────────────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });
    if (patient) {
      const sheet = await request('/nursing/monitoring-sheets', {
        token: tokens.nurse, method: 'POST',
        body: { patientId: patient.id, type: 'URINARY_CATHETER' },
      });
      assert('nurse opens a catheter chart', sheet.status === 201, `status ${sheet.status}`);

      if (sheet.data?.id) {
        for (const volume of [350, 280, 120]) {
          await request(`/nursing/monitoring-sheets/${sheet.data.id}/entries`, {
            token: tokens.nurse, method: 'POST',
            body: { values: { urineVolume: volume }, outputMl: volume },
          });
        }

        // A doctor on a ward round must see the nurses' chart from the patient
        // record, without going to the nursing module and searching again.
        const onChart = await request(`/nursing/monitoring-sheets?patientId=${patient.id}&status=ALL`, { token: tokens.doctor });
        const found = onChart.data?.sheets?.find((s) => s.id === sheet.data.id);
        assert('the sheet appears on the patient chart for the doctor', Boolean(found), `status ${onChart.status}`);
        assert('the chart shows the observations', found?.entries?.length === 3, `${found?.entries?.length} entries`);
        assert('the chart shows a correct fluid balance',
          Number(found?.totals?.outputMl) === 750 && Number(found?.totals?.balanceMl) === -750,
          `out ${found?.totals?.outputMl}, balance ${found?.totals?.balanceMl}`);

        // status=ALL must mean "no filter"; it was previously matched against
        // the enum, so the list silently returned nothing.
        assert('status=ALL does not silently empty the list',
          (onChart.data?.sheets?.length || 0) > 0, `${onChart.data?.sheets?.length} sheets`);

        await db.monitoringEntry.deleteMany({ where: { sheetId: sheet.data.id } });
        await db.monitoringSheet.delete({ where: { id: sheet.data.id } });
      }
    }
  }

  // ── Money cannot be corrupted or lost ────────────────────────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false },
    });
    const invoice = await request('/billing/', {
      token: tokens.admin, method: 'POST',
      body: {
        patientId: patient.id, subtotal: 10000, total: 10000,
        items: [{ description: 'Consultation', quantity: 1, unitPrice: 10000, amount: 10000 }],
      },
    });
    assert('an invoice can be raised', invoice.status === 201 || invoice.status === 200, `status ${invoice.status}`);

    if (invoice.data?.id) {
      const id = invoice.data.id;
      const pay = (body) => request(`/billing/${id}/record-payment`, { token: tokens.admin, method: 'PUT', body });

      // A negative payment used to subtract from takings already recorded,
      // silently reopening a settled invoice with no trace of who did it.
      assert('a negative payment is refused', (await pay({ amount: -8000 })).status === 400);
      assert('a zero payment is refused', (await pay({ amount: 0 })).status === 400);
      // These used to write NaN and return a Prisma stack trace to the browser.
      assert('a missing amount is refused cleanly', (await pay({ method: 'CASH' })).status === 400);
      assert('a non-numeric amount is refused cleanly', (await pay({ amount: 'abc' })).status === 400);
      assert('an unknown payment method is refused', (await pay({ amount: 100, method: 'BITCOIN' })).status === 400);

      const partial = await pay({ amount: 4000, method: 'CASH' });
      assert('a part-payment leaves the correct balance',
        Number(partial.data?.balance) === 6000 && partial.data?.paymentStatus === 'PART_PAID',
        `balance ${partial.data?.balance}, ${partial.data?.paymentStatus}`);
      assert('a part-paid invoice is not stamped with a payment date',
        !partial.data?.paidAt, String(partial.data?.paidAt));

      // Change in the till is not income. Overpaying used to inflate takings.
      const over = await pay({ amount: 9000, method: 'CASH' });
      assert('an overpayment applies only what is owed', Number(over.data?.applied) === 6000, `applied ${over.data?.applied}`);
      assert('an overpayment records the change given', Number(over.data?.changeGiven) === 3000, `change ${over.data?.changeGiven}`);
      assert('an overpayment never exceeds the invoice total',
        Number(over.data?.amountPaid) === 10000 && Number(over.data?.balance) === 0,
        `paid ${over.data?.amountPaid}, balance ${over.data?.balance}`);
      assert('a settled invoice takes no further payment', (await pay({ amount: 1000 })).status === 400);

      // Every sum received must be attributable to the person who took it.
      const ledger = await request(`/billing/${id}/payments`, { token: tokens.admin });
      assert('each payment is recorded separately', ledger.data?.payments?.length === 2, `${ledger.data?.payments?.length} rows`);
      assert('the ledger agrees with the invoice', Number(ledger.data?.totalReceived) === 10000, `${ledger.data?.totalReceived}`);
      assert('each payment names the cashier who took it',
        ledger.data?.payments?.every((p) => p.receivedBy?.firstName));

      // A mistake is reversed by a voided row that stays visible.
      const voidUrl = `/billing/payments/${ledger.data.payments[0].id}/void`;
      assert('voiding a payment requires a reason',
        (await request(voidUrl, { token: tokens.admin, method: 'PUT', body: {} })).status === 400);
      const voided = await request(voidUrl, {
        token: tokens.admin, method: 'PUT', body: { reason: 'Entered against the wrong invoice' },
      });
      assert('voiding recomputes the balance from the surviving payments',
        Number(voided.data?.invoice?.amountPaid) === 4000 && Number(voided.data?.invoice?.balance) === 6000,
        `paid ${voided.data?.invoice?.amountPaid}, balance ${voided.data?.invoice?.balance}`);
      assert('a voided payment is kept, not deleted', voided.data?.payment?.isVoided === true);

      await db.payment.deleteMany({ where: { invoiceId: id } });
      await db.invoice.delete({ where: { id } }).catch(() => {});
    }
  }

  // ── Uploads fail in a way staff can act on ───────────────────────────────
  {
    const oversize = new FormData();
    oversize.append('file', new Blob([new Uint8Array(21 * 1024 * 1024)], { type: 'image/png' }), 'huge.png');
    const big = await fetch(`${baseUrl}/uploads`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens.records}` }, body: oversize,
    });
    // This used to be a 500 with a raw MulterError, which reads as "the system
    // is broken" and invites staff to retry the same file indefinitely.
    assert('an oversized file is refused with a clear status', big.status === 413, `status ${big.status}`);
    const bigBody = await big.json().catch(() => ({}));
    assert('the oversize message says what to do', /20 MB/.test(bigBody.error || ''), bigBody.error);

    const disguised = new FormData();
    disguised.append('file', new Blob([new TextEncoder().encode('#!/bin/sh')], { type: 'image/png' }), 'evil.png');
    const fake = await fetch(`${baseUrl}/uploads`, {
      method: 'POST', headers: { Authorization: `Bearer ${tokens.records}` }, body: disguised,
    });
    assert('a file whose contents contradict its name is refused', fake.status === 400, `status ${fake.status}`);
  }

  // ── The nursing record belongs to nurses; doctors review it ──────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });

    const sheet = await request('/nursing/monitoring-sheets', {
      token: tokens.nurse, method: 'POST', body: { patientId: patient.id, type: 'BGL_INSULIN' },
    });
    assert('nurse opens a blood glucose chart', sheet.status === 201, `status ${sheet.status}`);
    assert('the template supplies the items', (sheet.data?.fields || []).length === 5,
      `${(sheet.data?.fields || []).length} fields`);

    // Owner decision, 4 August 2026: doctors read and comment, nurses author.
    const doctorSheet = await request('/nursing/monitoring-sheets', {
      token: tokens.doctor, method: 'POST', body: { patientId: patient.id, type: 'VITALS' },
    });
    assert('doctor cannot open a nursing sheet', doctorSheet.status === 403, `status ${doctorSheet.status}`);

    if (sheet.data?.id) {
      const id = sheet.data.id;
      const addEntry = (token, values) => request(`/nursing/monitoring-sheets/${id}/entries`, {
        token, method: 'POST', body: { values },
      });

      assert('doctor cannot author an observation', (await addEntry(tokens.doctor, { bgl: 120 })).status === 403);

      // Severity is decided by the sheet's own goal bands, on the server. A
      // browser must not be able to make a critical reading look ordinary.
      for (const [bgl, expected] of [[300, 'CRITICAL_HIGH'], [200, 'HIGH'], [120, 'NORMAL'], [60, 'CRITICAL_LOW']]) {
        const entry = await addEntry(tokens.nurse, { bgl });
        assert(`blood glucose ${bgl} reads as ${expected}`,
          entry.data?.deviations?.bgl?.severity === expected,
          `got ${entry.data?.deviations?.bgl?.severity}`);
      }

      const critical = await addEntry(tokens.nurse, { bgl: 400 });
      assert('a critical reading names itself in the response',
        critical.data?.alert?.severity === 'CRITICAL', JSON.stringify(critical.data?.alert || {}).slice(0, 60));
      assert('a client cannot mark a critical reading as normal',
        critical.data?.isAbnormal === true);
      assert('blood glucose carries a sliding-scale suggestion',
        critical.data?.slidingScale?.isSuggestionOnly === true,
        critical.data?.slidingScale?.advice);

      // A doctor asks for a correction; the nurse closes the loop.
      const reviewUrl = `/nursing/monitoring-sheets/${id}/reviews`;
      assert('a correction request without instructions is refused',
        (await request(reviewUrl, { token: tokens.doctor, method: 'POST', body: { kind: 'ADJUSTMENT_REQUESTED' } })).status === 400);
      const review = await request(reviewUrl, {
        token: tokens.doctor, method: 'POST',
        body: { kind: 'CORRECTION_REQUESTED', comment: 'Please recheck against the 08:00 reading' },
      });
      assert('doctor can ask the nurse to correct a reading', review.status === 201, `status ${review.status}`);

      const open = await request(`/nursing/monitoring-reviews?patientId=${patient.id}`, { token: tokens.nurse });
      assert('the request reaches the nurse', open.data?.reviews?.some((r) => r.id === review.data.id));

      const resolveUrl = `/nursing/monitoring-reviews/${review.data.id}/resolve`;
      assert('a doctor cannot close a nursing action',
        (await request(resolveUrl, { token: tokens.doctor, method: 'PUT', body: { resolution: 'done' } })).status === 403);
      assert('the nurse closes the loop',
        (await request(resolveUrl, { token: tokens.nurse, method: 'PUT', body: { resolution: 'Rechecked and confirmed' } })).status === 200);

      await db.monitoringReview.deleteMany({ where: { sheetId: id } });
      await db.monitoringEntry.deleteMany({ where: { sheetId: id } });
      await db.monitoringSheet.delete({ where: { id } });
    }

    // SpO2 is a nursing observation that only means anything as a trend.
    const vitals = await request('/nursing/monitoring-sheets', {
      token: tokens.nurse, method: 'POST', body: { patientId: patient.id, type: 'VITALS' },
    });
    assert('a vitals chart includes SpO2',
      (vitals.data?.fields || []).some((f) => f.key === 'spo2'));

    if (vitals.data?.id) {
      for (const [spo2, expected] of [[98, 'NORMAL'], [93, 'LOW'], [88, 'CRITICAL_LOW']]) {
        const entry = await request(`/nursing/monitoring-sheets/${vitals.data.id}/entries`, {
          token: tokens.nurse, method: 'POST', body: { values: { spo2, pulse: 80, systolic: 120, diastolic: 80 } },
        });
        assert(`SpO2 ${spo2}% reads as ${expected}`,
          entry.data?.deviations?.spo2?.severity === expected,
          `got ${entry.data?.deviations?.spo2?.severity}`);
      }
      await db.monitoringEntry.deleteMany({ where: { sheetId: vitals.data.id } });
      await db.monitoringSheet.delete({ where: { id: vitals.data.id } });
    }
  }

  // ── Standing orders carry their whole execution history ──────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });
    const place = (token, body) => request('/orders/standing', { token, method: 'POST', body });

    const order = await place(tokens.doctor, {
      patientId: patient.id, type: 'NURSING', name: 'Turn and reposition',
      frequencyHours: 2, goal: 'Prevent pressure ulcer',
    });
    assert('doctor places a recurring nursing order', order.status === 201, `status ${order.status}`);
    assert('nurse cannot place an order',
      (await place(tokens.nurse, { patientId: patient.id, type: 'NURSING', name: 'x' })).status === 403);
    assert('an order must have a name a nurse will recognise',
      (await place(tokens.doctor, { patientId: patient.id, type: 'DIET', name: '   ' })).status === 400);

    // An infusion and the chart that tracks it belong together.
    const infusion = await place(tokens.doctor, {
      patientId: patient.id, type: 'MEDICATION', name: 'IV Normal Saline 1000mL', details: { rate: 125 },
    });
    assert('an infusion order offers a fluid chart',
      infusion.data?.suggestedMonitoringSheet?.sheetType === 'IV_FLUID');

    if (order.data?.id) {
      const id = order.data.id;
      const run = (token, body) => request(`/orders/standing/${id}/execute`, { token, method: 'POST', body });

      assert('doctor cannot carry out a nursing order', (await run(tokens.doctor, { result: 'x' })).status === 403);
      for (let i = 0; i < 3; i += 1) await run(tokens.nurse, { result: 'Turned, skin intact' });

      // A skipped dose recorded with a reason is a clinical fact; one that
      // simply never appears is a hole nobody can explain later.
      assert('skipping without a reason is refused', (await run(tokens.nurse, { outcome: 'SKIPPED' })).status === 400);
      assert('a skip with a reason is recorded',
        (await run(tokens.nurse, { outcome: 'SKIPPED', reason: 'Patient in theatre' })).status === 201);
      assert('charting something as already done in the future is refused',
        (await run(tokens.nurse, { result: 'x', executedAt: new Date(Date.now() + 7200_000).toISOString() })).status === 400);

      // This is the whole point of the model: a task recorded one completion,
      // so a Q2H order looked the same whether it ran 12 times or once.
      const full = await request(`/orders/standing/${id}`, { token: tokens.doctor });
      assert('one order carries every execution', full.data?.executionCount === 4, `${full.data?.executionCount}`);
      assert('carried out and missed are counted apart',
        full.data?.completedCount === 3 && full.data?.missedCount === 1,
        `${full.data?.completedCount} done, ${full.data?.missedCount} missed`);

      const setStatus = (body) => request(`/orders/standing/${id}/status`, { token: tokens.doctor, method: 'PUT', body });
      await setStatus({ status: 'HELD' });
      assert('a held order cannot be carried out', (await run(tokens.nurse, { result: 'x' })).status === 409);
      await setStatus({ status: 'ACTIVE' });
      assert('stopping a treatment requires a reason', (await setStatus({ status: 'DISCONTINUED' })).status === 400);
      await setStatus({ status: 'DISCONTINUED', reason: 'Patient mobile, no longer required' });
      assert('a discontinued order cannot be carried out', (await run(tokens.nurse, { result: 'x' })).status === 409);
    }

    // Overdue is judged from the last execution, not the start, so one late
    // round does not report every later occurrence as overdue forever.
    const overdue = await place(tokens.doctor, {
      patientId: patient.id, type: 'NURSING', name: 'Hourly neuro observations',
      frequencyHours: 1, startAt: new Date(Date.now() - 4 * 3600_000).toISOString(),
    });
    const late = await request(`/orders/standing?patientId=${patient.id}&overdueOnly=true`, { token: tokens.nurse });
    assert('an order hours past due is flagged overdue',
      late.data?.orders?.some((o) => o.id === overdue.data.id));

    for (const id of [order.data?.id, infusion.data?.id, overdue.data?.id].filter(Boolean)) {
      await db.orderExecution.deleteMany({ where: { orderId: id } });
      await db.order.delete({ where: { id } }).catch(() => {});
    }
  }

  // ── Resuscitation: the account of an arrest ──────────────────────────────
  {
    const encounter = await request('/emergency', {
      token: tokens.records, method: 'POST',
      body: {
        presentingName: 'Smoke Unknown', approximateAge: 40,
        triage: 'RESUSCITATION', chiefComplaint: 'Collapsed',
      },
    });
    assert('an emergency opens for an unidentified arrival', encounter.status === 201, `status ${encounter.status}`);

    const protocols = await request('/emergency/resuscitation/protocols?type=CODE_BLUE', { token: tokens.nurse });
    assert('the ACLS protocol is available', protocols.data?.protocols?.some((p) => p.key === 'ACLS'));

    const event = await request('/emergency/resuscitation', {
      token: tokens.nurse, method: 'POST',
      body: {
        patientId: encounter.data.patientId, emergencyEncounterId: encounter.data.id,
        type: 'CODE_BLUE', protocols: ['ACLS'],
      },
    });
    assert('a nurse can start a Code Blue', event.status === 201, `status ${event.status}`);
    assert('a lab scientist cannot start a resuscitation',
      (await request('/emergency/resuscitation', {
        token: tokens.lab, method: 'POST', body: { patientId: encounter.data.patientId, type: 'CODE_BLUE' },
      })).status === 403);

    // Two half-records of one arrest are worse than one complete record.
    const duplicate = await request('/emergency/resuscitation', {
      token: tokens.doctor, method: 'POST', body: { patientId: encounter.data.patientId, type: 'CODE_BLUE' },
    });
    assert('a second board cannot be opened for the same arrest', duplicate.status === 409, `status ${duplicate.status}`);
    assert('the duplicate attempt points at the running record', duplicate.data?.eventId === event.data.id);

    if (event.data?.id) {
      const id = event.data.id;
      const log = (action, timeOffsetSeconds, meta) => request(`/emergency/resuscitation/${id}/entries`, {
        token: tokens.nurse, method: 'POST', body: { action, timeOffsetSeconds, meta },
      });

      await log('Start CPR', 0);
      await log('Rhythm check', 120);
      await log('Adrenaline 1 mg IV', 180, { drug: 'Adrenaline', dose: '1 mg', route: 'IV' });
      await log('Defibrillate', 240, { joules: 200 });
      await log('Secure airway', 540);

      assert('an action with no description is refused', (await log('   ', 10)).status === 400);
      assert('an action before the call is refused', (await log('Start CPR', -5)).status === 400);

      const full = await request(`/emergency/resuscitation/${id}`, { token: tokens.doctor });
      assert('the timeline holds every action in order', full.data?.entries?.length === 5,
        `${full.data?.entries?.length} entries`);

      // Losing track of repeat intervals is the failure mode in a long arrest —
      // it is the one thing a person cannot do reliably while compressing.
      assert('repeat doses that have fallen due are surfaced',
        full.data?.dueRepeats?.length === 2,
        (full.data?.dueRepeats || []).map((d) => d.action).join(', ') || 'none');

      assert('closing without an outcome is refused',
        (await request(`/emergency/resuscitation/${id}/end`, { token: tokens.doctor, method: 'PUT', body: {} })).status === 400);
      assert('a doctor closes it with an outcome',
        (await request(`/emergency/resuscitation/${id}/end`, {
          token: tokens.doctor, method: 'PUT', body: { outcome: 'ROSC', outcomeNote: 'ROSC at 5 minutes' },
        })).status === 200);
      assert('a closed resuscitation accepts no further actions', (await log('Adrenaline 1 mg IV', 600)).status === 409);

      // The account of an arrest must follow the patient to their real chart,
      // not stay behind on the archived intake shell.
      const patients = await request('/patients?limit=50', { token: tokens.records });
      const target = (patients.data?.patients || []).find(
        (p) => !p.isEmergencyTemp && p.id !== encounter.data.patientId,
      );
      const merged = await request(`/emergency/${encounter.data.id}/link`, {
        token: tokens.records, method: 'POST', body: { targetPatientId: target.id },
      });
      assert('the emergency record merges into the permanent patient', merged.status === 200, `status ${merged.status}`);
      assert('the resuscitation moves with it', merged.data?.moved?.resuscitationEvents === 1,
        `${merged.data?.moved?.resuscitationEvents}`);

      const onChart = await request(`/emergency/resuscitation?patientId=${target.id}`, { token: tokens.doctor });
      assert('it is readable on the permanent chart', onChart.data?.events?.some((e) => e.id === id));

      await db.resuscitationTimelineEntry.deleteMany({ where: { eventId: id } });
      await db.resuscitationEvent.delete({ where: { id } }).catch(() => {});
    }

    await db.emergencyEncounter.delete({ where: { id: encounter.data.id } }).catch(() => {});
    await db.patient.delete({ where: { id: encounter.data.patientId } }).catch(() => {});
  }

  // ── Public enquiries are written down, not just emailed ──────────────────
  {
    const facility = await db.facility.findFirst({ where: { name: 'UCH Ibadan Demo' }, select: { slug: true } });
    const slug = facility?.slug;
    assert('the facility has a stored slug', Boolean(slug), String(slug));

    const page = await request(`/public/clinic/${slug}`, { token: null });
    assert('the clinic page resolves by stored slug without auth', page.status === 200, `status ${page.status}`);
    assert('the public page exposes no licence number', !/licenseNumber/.test(JSON.stringify(page.data || {})));

    const send = (body) => request(`/public/clinic/${slug}/inquiry`, { token: null, method: 'POST', body });

    // The old contact form only sent mail. If SMTP failed, an enquiry describing
    // chest pain vanished with nothing to show it had ever arrived.
    const urgent = await send({ name: 'Smoke Urgent', phone: '08031234567', symptoms: 'chest pain and sweating' });
    assert('an enquiry is accepted and stored', urgent.status === 201, `status ${urgent.status}`);
    assert('chest pain routes to emergency', urgent.data?.suggestedDepartment === 'Emergency' && urgent.data?.isUrgent === true);
    assert('an urgent reply says go now rather than wait', /do not wait/i.test(urgent.data?.message || ''));

    const routine = await send({ name: 'Smoke Routine', phone: '08099887766', symptoms: 'fever for 3 days' });
    assert('fever routes to general outpatient', routine.data?.suggestedDepartment === 'General Outpatient');
    assert('an enquiry with no way to reply is refused', (await send({ symptoms: 'hello' })).status === 400);

    const queue = await request('/inquiries?status=NEW', { token: tokens.records });
    assert('the records desk sees the enquiries', (queue.data?.inquiries?.length || 0) >= 2);
    // Someone describing chest pain must not sit behind eleven appointment questions.
    assert('possibly urgent enquiries sort to the top', queue.data?.inquiries?.[0]?.isUrgent === true);
    assert('a lab scientist cannot read enquiries', (await request('/inquiries', { token: tokens.lab })).status === 403);

    const stored = queue.data.inquiries.find((i) => i.name === 'Smoke Urgent');
    if (stored) {
      const prefill = await request(`/inquiries/${stored.id}/prefill`, { token: tokens.records });
      assert('registration is prefilled from what they submitted',
        prefill.data?.firstName === 'Smoke' && prefill.data?.phone === '08031234567',
        `${prefill.data?.firstName} ${prefill.data?.phone}`);
      assert('marking contacted without saying what happened is refused',
        (await request(`/inquiries/${stored.id}/status`, {
          token: tokens.records, method: 'PUT', body: { status: 'CONTACTED' },
        })).status === 400);
    }

    await db.patientInquiry.deleteMany({ where: { name: { startsWith: 'Smoke ' } } });
  }

  // ── Staff can reach each other inside the system ─────────────────────────
  {
    const colleagues = await request('/messages/recipients', { token: tokens.nurse });
    assert('a nurse can see colleagues to message', (colleagues.data?.recipients?.length || 0) > 0);
    const doctorUser = colleagues.data.recipients.find((r) => r.subRole === 'DOCTOR');
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, mrn: { not: null } },
    });

    const sent = await request('/messages', {
      token: tokens.nurse, method: 'POST',
      body: {
        recipientId: doctorUser.id, subject: 'Bed 4 deteriorating',
        body: 'SpO2 has fallen from 98 to 89 over four hours. Please review.',
        priority: 'URGENT', patientId: patient.id,
      },
    });
    assert('a nurse can message a doctor about a patient', sent.status === 201, `status ${sent.status}`);
    // A message about a patient should say so, rather than the sender pasting
    // identifiers into free text.
    assert('the message carries the patient context', sent.data?.patient?.mrn === patient.mrn);
    assert('an empty message is refused',
      (await request('/messages', { token: tokens.nurse, method: 'POST', body: { recipientId: doctorUser.id, body: '  ' } })).status === 400);

    // Ward chat currently happens on personal WhatsApp; moving it into the
    // system only helps if it cannot cross facilities.
    const outsider = await db.user.findFirst({
      where: { facility: { name: { not: 'UCH Ibadan Demo' } }, isActive: true },
      select: { id: true },
    });
    if (outsider) {
      assert('the colleague list never includes another facility',
        !colleagues.data.recipients.some((r) => r.id === outsider.id));
      assert('a message cannot be addressed outside the facility',
        (await request('/messages', {
          token: tokens.nurse, method: 'POST', body: { recipientId: outsider.id, body: 'hello' },
        })).status === 404);
    }
    assert('you cannot message yourself',
      (await request('/messages', {
        token: tokens.doctor, method: 'POST', body: { recipientId: doctorUser.id, body: 'note to self' },
      })).status === 400);

    const badge = await request('/messages/unread-count', { token: tokens.doctor });
    assert('the doctor gets an unread badge', badge.data?.unread >= 1 && badge.data?.urgent >= 1,
      `${badge.data?.unread} unread, ${badge.data?.urgent} urgent`);

    const inbox = await request('/messages', { token: tokens.doctor });
    assert('urgent messages sort to the top', inbox.data?.messages?.[0]?.priority === 'URGENT');

    // A sender must not be able to clear a badge on the recipient's behalf.
    assert('a sender cannot mark their own message read',
      (await request(`/messages/${sent.data.id}/read`, { token: tokens.nurse, method: 'PUT' })).status === 404);
    assert('the recipient marks it read',
      (await request(`/messages/${sent.data.id}/read`, { token: tokens.doctor, method: 'PUT' })).status === 200);

    await db.message.deleteMany({ where: { subject: 'Bed 4 deteriorating' } });
    await db.message.deleteMany({ where: { body: { contains: 'SpO2 has fallen from 98 to 89' } } });
  }

  // ── Every permanent patient can be pulled by chart number ────────────────
  {
    // Online bookings used to create a real patient with no MRN, so someone
    // could arrive at the desk quoting a number reception could not find.
    const missing = await db.patient.count({ where: { mrn: null, isEmergencyTemp: false } });
    assert('no permanent patient is left without an MRN', missing === 0, `${missing} without an MRN`);
  }

  // ── Alerts: what somebody should look at now ─────────────────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });

    const sheet = await request('/nursing/monitoring-sheets', {
      token: tokens.nurse, method: 'POST', body: { patientId: patient.id, type: 'VITALS' },
    });
    for (const spo2 of [94, 91, 88, 87]) {
      await request(`/nursing/monitoring-sheets/${sheet.data.id}/entries`, {
        token: tokens.nurse, method: 'POST',
        body: { values: { spo2, pulse: 110, systolic: 100, diastolic: 65 } },
      });
    }
    const order = await request('/orders/standing', {
      token: tokens.doctor, method: 'POST',
      body: {
        patientId: patient.id, type: 'NURSING', name: 'Smoke turn and reposition',
        frequencyHours: 2, startAt: new Date(Date.now() - 9 * 3600_000).toISOString(),
      },
    });
    await request(`/nursing/monitoring-sheets/${sheet.data.id}/reviews`, {
      token: tokens.doctor, method: 'POST',
      body: { kind: 'CORRECTION_REQUESTED', comment: 'Please recheck the probe placement' },
    });

    const nurseAlerts = await request('/alerts', { token: tokens.nurse });
    const doctorAlerts = await request('/alerts', { token: tokens.doctor });
    const labAlerts = await request('/alerts', { token: tokens.lab });

    assert('a critical saturation raises an alert',
      nurseAlerts.data?.alerts?.some((a) => a.category === 'OBSERVATION' && a.severity === 'CRITICAL'));
    // Ten consecutive low saturations are one problem, not ten alerts. A list
    // that scrolls is a list nobody reads. Scoped to this chart so an unrelated
    // chart elsewhere in the facility cannot make the assertion lie either way.
    const spo2Alerts = nurseAlerts.data.alerts.filter(
      (a) => a.category === 'OBSERVATION' && a.id.endsWith(':spo2'),
    );
    assert('repeated critical readings raise one alert, not one each',
      spo2Alerts.length === 1, `${spo2Alerts.length}`);
    assert('the alert names the measurement as charted',
      nurseAlerts.data.alerts.some((a) => a.title === 'SpO2 is critical'),
      nurseAlerts.data.alerts.find((a) => a.category === 'OBSERVATION')?.title);
    assert('a neglected order is flagged overdue',
      nurseAlerts.data.alerts.some((a) => a.category === 'ORDER'));

    // Nobody is shown work they cannot act on.
    assert('a correction request reaches the nurse',
      nurseAlerts.data.alerts.some((a) => a.category === 'REVIEW'));
    assert('the doctor is not shown a nurse-only action',
      !doctorAlerts.data.alerts.some((a) => a.category === 'REVIEW'));
    assert('a lab scientist is not shown ward work', labAlerts.data?.counts?.total === 0,
      `${labAlerts.data?.counts?.total}`);
    assert('critical items sort above warnings', nurseAlerts.data.alerts[0]?.severity === 'CRITICAL');

    // Derived, not stored — so an alert disappears when the thing it describes
    // is dealt with, rather than sitting in a queue looking urgent forever.
    await request(`/nursing/monitoring-sheets/${sheet.data.id}`, {
      token: tokens.nurse, method: 'PATCH', body: { status: 'COMPLETED' },
    });
    for (let i = 0; i < 5; i += 1) {
      await request(`/orders/standing/${order.data.id}/execute`, {
        token: tokens.nurse, method: 'POST', body: { result: 'Turned' },
      });
    }
    const after = await request('/alerts', { token: tokens.nurse });
    assert('closing the chart clears its alert',
      !after.data.alerts.some((a) => a.id.startsWith('critical:') && a.id.endsWith(':spo2')));
    assert('carrying out the order clears the overdue alert',
      !after.data.alerts.some((a) => a.id === `overdue:${order.data.id}`));

    await db.monitoringReview.deleteMany({ where: { sheetId: sheet.data.id } });
    await db.monitoringEntry.deleteMany({ where: { sheetId: sheet.data.id } });
    await db.monitoringSheet.delete({ where: { id: sheet.data.id } }).catch(() => {});
    await db.orderExecution.deleteMany({ where: { orderId: order.data.id } });
    await db.order.delete({ where: { id: order.data.id } }).catch(() => {});
  }

  // ── A doctor orders monitoring; the nurse opens the chart ────────────────
  {
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false, isEmergencyTemp: false },
    });

    // Doctors write instructions in words, not enum values.
    const order = await request('/orders/standing', {
      token: tokens.doctor, method: 'POST',
      body: {
        patientId: patient.id, type: 'NURSING',
        name: 'Urethral catheter — hourly urine output',
        frequencyHours: 1, goal: 'Monitor renal perfusion',
      },
    });
    assert('an order names the chart it needs, from the words used',
      order.data?.suggestedMonitoringSheet?.sheetType === 'URINARY_CATHETER',
      order.data?.suggestedMonitoringSheet?.sheetType);

    const waiting = await request(`/nursing/monitoring-requests?patientId=${patient.id}`, { token: tokens.nurse });
    const pending = waiting.data?.requests?.find((r) => r.orderId === order.data.id);
    assert('it reaches the nurse as a chart waiting to be opened', Boolean(pending));
    assert('the nurse sees what will be recorded before committing',
      (pending?.suggested?.fields || []).length > 0);
    assert('the ordered interval carries through', pending?.suggested?.frequencyMins === 60);

    // What the nurse enters at the bedside becomes the chart: the fields they
    // confirm are the columns, and the details only they know are its settings.
    const opened = await request(`/nursing/monitoring-requests/${order.data.id}/initiate`, {
      token: tokens.nurse, method: 'POST',
      body: {
        frequencyMins: 60,
        metadata: { catheterSize: '16 Fr', site: 'Urethral' },
        fields: [
          { key: 'volumeMl', label: 'Urine volume', unit: 'ml', kind: 'number', mapsTo: 'outputMl', goalMin: 30, criticalLow: 15 },
          { key: 'colour', label: 'Colour', kind: 'select', options: ['Clear', 'Straw', 'Dark'], normalOptions: ['Clear', 'Straw'] },
        ],
        instructions: 'Report if output below 30 ml/hr for two consecutive hours',
      },
    });
    assert('the nurse opens the chart', opened.status === 201, `status ${opened.status}`);
    assert('what the nurse entered is the chart', (opened.data?.sheet?.fields || []).length === 2);
    assert('the bedside details are stored on the chart',
      opened.data?.sheet?.metadata?.catheterSize === '16 Fr');
    assert('the chart is linked back to the order', opened.data?.sheet?.orderId === order.data.id);
    assert('opening the chart counts as carrying out the order',
      (await request(`/orders/standing/${order.data.id}`, { token: tokens.doctor })).data?.completedCount === 1);
    assert('the same order cannot open two charts',
      (await request(`/nursing/monitoring-requests/${order.data.id}/initiate`, {
        token: tokens.nurse, method: 'POST', body: {},
      })).status === 409);
    // Doctors order the chart; they do not open or write it.
    assert('a doctor cannot open the chart themselves',
      (await request(`/nursing/monitoring-requests/${order.data.id}/initiate`, {
        token: tokens.doctor, method: 'POST', body: {},
      })).status === 403);

    // Observations are graded against the limits the nurse set at initiation.
    const entry = await request(`/nursing/monitoring-sheets/${opened.data.sheet.id}/entries`, {
      token: tokens.nurse, method: 'POST', body: { values: { volumeMl: 12, colour: 'Dark' } },
    });
    assert('a low output is graded critical against those limits',
      entry.data?.deviations?.volumeMl?.severity === 'CRITICAL_LOW');
    assert('the charted volume feeds the fluid balance', entry.data?.outputMl === 12);

    await db.monitoringEntry.deleteMany({ where: { sheetId: opened.data.sheet.id } });
    await db.monitoringSheet.delete({ where: { id: opened.data.sheet.id } }).catch(() => {});
    await db.orderExecution.deleteMany({ where: { orderId: order.data.id } });
    await db.order.delete({ where: { id: order.data.id } }).catch(() => {});
  }

  // ── Beds: the administrator builds the ward, nursing runs it ─────────────
  {
    // There was previously no way to create a bed at all — the ward layout was
    // whatever the seed happened to contain.
    assert('a nurse cannot create a bed',
      (await request('/admissions/beds', { token: tokens.nurse, method: 'POST', body: { bedNumber: 'SMOKE-X' } })).status === 403);

    const bulk = await request('/admissions/beds/bulk', {
      token: tokens.admin, method: 'POST',
      body: { ward: 'Smoke Ward', prefix: 'S', from: 1, to: 6, type: 'GENERAL' },
    });
    assert('an administrator sets up a ward in one action', bulk.data?.created === 6, `${bulk.data?.created}`);
    // Re-running should fill gaps, not refuse the batch.
    assert('re-running the range fills gaps rather than failing',
      (await request('/admissions/beds/bulk', {
        token: tokens.admin, method: 'POST', body: { ward: 'Smoke Ward', prefix: 'S', from: 1, to: 8 },
      })).data?.created === 2);

    const board = await request('/admissions/beds?ward=Smoke Ward', { token: tokens.nurse });
    assert('the bed board reports counts', board.data?.counts?.total === 8 && board.data?.counts?.available === 8,
      JSON.stringify(board.data?.counts));

    const bed = board.data.beds[0];
    assert('a nurse can mark a bed for cleaning',
      (await request(`/admissions/beds/${bed.id}/status`, {
        token: tokens.nurse, method: 'PUT', body: { status: 'CLEANING' },
      })).status === 200);
    // Occupancy comes from admitting a patient, never from setting a flag.
    assert('occupancy cannot be set by hand',
      (await request(`/admissions/beds/${bed.id}/status`, {
        token: tokens.nurse, method: 'PUT', body: { status: 'OCCUPIED' },
      })).status === 400);

    const after = await request('/admissions/beds?ward=Smoke Ward', { token: tokens.nurse });
    // A bed that looks free but is not yet cleaned sends a patient to a bed
    // that cannot take them.
    assert('a bed awaiting cleaning is not counted as free',
      after.data.counts.available === 7 && after.data.counts.cleaning === 1,
      JSON.stringify(after.data.counts));

    await db.bed.deleteMany({ where: { facilityId: after.data.beds[0].facilityId, ward: 'Smoke Ward' } });
  }

  // ── Hospital number format ───────────────────────────────────────────────
  {
    const current = await request('/settings/hospital-number', { token: tokens.admin });
    assert('the hospital number format is readable', Boolean(current.data?.prefix), current.data?.preview);
    assert('a clinical role cannot change the number format',
      (await request('/settings/hospital-number', { token: tokens.nurse, method: 'PUT', body: { prefix: 'HACK' } })).status === 403);
    // The prefix reaches URLs, filenames and printed cards.
    assert('a prefix with punctuation is refused',
      (await request('/settings/hospital-number', { token: tokens.admin, method: 'PUT', body: { prefix: 'UC H/1' } })).status === 400);

    const year = String(new Date().getFullYear()).slice(-2);
    const saved = await request('/settings/hospital-number', {
      token: tokens.admin, method: 'PUT',
      body: { prefix: 'SMK', includeYear: true, padding: 6, start: 5000, separator: '-' },
    });
    assert('the preview shows what the next patient will get',
      saved.data?.preview === `SMK-${year}-005000`, saved.data?.preview);

    const registered = await request('/patients', {
      token: tokens.records, method: 'POST',
      body: { firstName: 'SmokeFormat', lastName: 'Check', gender: 'MALE' },
    });
    assert('a new patient gets the configured hospital number',
      registered.data?.mrn === `SMK-${year}-005000`, registered.data?.mrn);
    // Staff search by what the patient is holding.
    const found = await request(`/patients?search=${encodeURIComponent(registered.data.mrn)}`, { token: tokens.records });
    assert('searching by hospital number finds the patient',
      (found.data?.patients || []).some((p) => p.id === registered.data.id));

    await db.patient.delete({ where: { id: registered.data.id } }).catch(() => {});
    // Existing numbers are printed on folders and cards, so a format change
    // never rewrites them — put the demo facility back as it was.
    await request('/settings/hospital-number', {
      token: tokens.admin, method: 'PUT',
      body: { prefix: 'PAT', includeYear: false, padding: 3, start: 1, separator: '-' },
    });
  }

  // ── Encounter context, clinic timetable ──────────────────────────────────
  {
    const types = await request('/encounter-types', { token: tokens.doctor });
    assert('a facility gets the built-in encounter types on first use',
      (types.data?.types?.length || 0) >= 6, `${types.data?.types?.length}`);
    assert('a doctor cannot add an encounter type',
      (await request('/encounter-types', { token: tokens.doctor, method: 'POST', body: { name: 'Sneaky' } })).status === 403);

    const custom = await request('/encounter-types', {
      token: tokens.admin, method: 'POST',
      body: { name: 'Smoke Cardio Clinic', defaultDurationMins: 20 },
    });
    assert('an administrator adds a custom encounter type', custom.status === 201, `status ${custom.status}`);

    // Renaming a built-in type would silently change what every report counts.
    const builtIn = types.data.types.find((x) => x.name === 'Emergency');
    assert('a built-in type cannot be renamed',
      (await request(`/encounter-types/${builtIn.id}`, { token: tokens.admin, method: 'PUT', body: { name: 'Casualty' } })).status === 400);
    assert('a built-in type cannot be deleted',
      (await request(`/encounter-types/${builtIn.id}`, { token: tokens.admin, method: 'DELETE' })).status === 400);

    const day = new Date().getDay();
    // A clinic that ends before it starts yields negative slot arithmetic and
    // an empty booking page nobody can explain.
    assert('a clinic ending before it starts is refused',
      (await request('/encounter-types/schedules', {
        token: tokens.admin, method: 'POST',
        body: { encounterTypeId: custom.data.id, dayOfWeek: day, startTime: '14:00', endTime: '08:00' },
      })).status === 400);

    const schedule = await request('/encounter-types/schedules', {
      token: tokens.admin, method: 'POST',
      body: {
        encounterTypeId: custom.data.id, dayOfWeek: day,
        startTime: '08:00', endTime: '14:00', location: 'Room 3', maxPatients: 24,
      },
    });
    assert('a clinic can be timetabled', schedule.status === 201, `status ${schedule.status}`);

    const board = await request('/encounter-types/schedules/today', { token: tokens.doctor });
    assert('it appears on today’s clinic board',
      board.data?.clinics?.some((c) => c.id === schedule.data.id));
    assert('a nurse can see the clinic board',
      (await request('/encounter-types/schedules/today', { token: tokens.nurse })).status === 200);

    // Every new encounter must say what kind of contact it was — billing, the
    // timetable and every report are built on this.
    const patient = await db.patient.findFirst({
      where: { facility: { name: 'UCH Ibadan Demo' }, isArchived: false },
    });
    assert('a new encounter without a context is refused',
      (await request('/cases', {
        token: tokens.doctor, method: 'POST', body: { patientId: patient.id, chiefComplaint: 'Chest pain' },
      })).status === 400);
    assert('an encounter type from another facility is refused',
      (await request('/cases', {
        token: tokens.doctor, method: 'POST',
        body: { patientId: patient.id, chiefComplaint: 'x', encounterTypeId: '00000000-0000-4000-8000-000000000000' },
      })).status === 400);

    const encounter = await request('/cases', {
      token: tokens.doctor, method: 'POST',
      body: { patientId: patient.id, chiefComplaint: 'Palpitations', encounterTypeId: custom.data.id },
    });
    assert('an encounter with a context is accepted', encounter.status === 201, `status ${encounter.status}`);

    const full = await request(`/cases/${encounter.data.id}`, { token: tokens.doctor });
    assert('the context is visible on the encounter',
      full.data?.encounterTypeConfig?.name === 'Smoke Cardio Clinic');

    const filtered = await request(`/cases?encounterTypeId=${custom.data.id}`, { token: tokens.doctor });
    assert('reports can filter encounters by context',
      filtered.data?.cases?.length >= 1
      && filtered.data.cases.every((c) => c.encounterTypeConfig?.id === custom.data.id));

    await db.case.delete({ where: { id: encounter.data.id } }).catch(() => {});
    await db.clinicScheduleDoctor.deleteMany({ where: { scheduleId: schedule.data.id } });
    await db.clinicSchedule.delete({ where: { id: schedule.data.id } }).catch(() => {});
    await db.encounterTypeConfig.delete({ where: { id: custom.data.id } }).catch(() => {});
  }

  console.log(`\nSmoke result: ${passed} passed, ${failed} failed`);
  if (failed) process.exitCode = 1;
}

run().catch((error) => {
  console.error(`Smoke runner crashed: ${error.message}`);
  process.exitCode = 1;
}).finally(() => db.$disconnect());
