const bcrypt = require('bcryptjs');
const { templateFor } = require('../utils/monitoringTemplates');

const SAMPLE_MRN = 'DEMO-SAMPLE-001';
const SAMPLE_SHEET_TITLE = 'Sample: Fluid balance and urine output';
const SAMPLE_ORDER_NAME = 'Sample: Hourly fluid balance monitoring';

function sampleIdFor(facilityId) {
  return `AWB-SAMPLE-${String(facilityId).replaceAll('-', '').slice(0, 6).toUpperCase()}`;
}

function atHoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

async function ensureProfessional(prisma, facility, kind, passwordHash) {
  const config = {
    DOCTOR: { firstName: 'Dr. Chidi', lastName: 'Okeke', role: 'CLINICIAN', subRole: 'DOCTOR', specialty: 'Internal Medicine' },
    NURSE: { firstName: 'Nurse Amina', lastName: 'Bello', role: 'CLINICIAN', subRole: 'NURSE', specialty: 'Medical Nursing' },
    PHARMACIST: { firstName: 'Pharm. Tola', lastName: 'Adebayo', role: 'CLINICIAN', subRole: 'PHARMACIST', specialty: 'Clinical Pharmacy' },
  }[kind];

  const existing = await prisma.user.findFirst({
    where: { facilityId: facility.id, subRole: kind, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (existing) return existing;

  const suffix = String(facility.id).replaceAll('-', '').slice(0, 8).toLowerCase();
  const email = `showcase.${kind.toLowerCase()}.${suffix}@local.awibi.test`;
  return prisma.user.upsert({
    where: { email },
    update: { ...config, facilityId: facility.id, isActive: true, emailVerified: true },
    create: {
      ...config,
      email,
      passwordHash,
      facilityId: facility.id,
      staffId: `DEMO-${kind.slice(0, 3)}-${suffix.toUpperCase()}`,
      isActive: true,
      emailVerified: true,
    },
  });
}

async function findOrCreate(prismaModel, where, data) {
  const existing = await prismaModel.findFirst({ where });
  if (existing) return prismaModel.update({ where: { id: existing.id }, data });
  return prismaModel.create({ data });
}

async function seedFacilityShowcase(prisma, facility, passwordHash) {
  const [doctor, nurse, pharmacist] = await Promise.all([
    ensureProfessional(prisma, facility, 'DOCTOR', passwordHash),
    ensureProfessional(prisma, facility, 'NURSE', passwordHash),
    ensureProfessional(prisma, facility, 'PHARMACIST', passwordHash),
  ]);

  const patientData = {
    facilityId: facility.id,
    universalPatientId: sampleIdFor(facility.id),
    mrn: SAMPLE_MRN,
    firstName: 'Amina',
    lastName: 'Bello (Sample)',
    dateOfBirth: new Date('1987-04-18'),
    gender: 'FEMALE',
    phone: '08000000002',
    email: `sample.patient.${String(facility.id).slice(0, 6)}@awibi.test`,
    status: 'IN_PATIENT',
    registrationStatus: 'COMPLETE',
    notes: 'Synthetic Awibi showcase patient. Monitoring and pharmacy records are sample data only.',
  };
  const patient = await prisma.patient.upsert({
    where: { universalPatientId: patientData.universalPatientId },
    update: patientData,
    create: patientData,
  });

  await findOrCreate(
    prisma.condition,
    { facilityId: facility.id, patientId: patient.id, name: 'Hypertension (sample)' },
    { facilityId: facility.id, patientId: patient.id, name: 'Hypertension (sample)', icdCode: 'I10', status: 'CHRONIC', notes: 'Synthetic demonstration record.' },
  );
  await findOrCreate(
    prisma.allergy,
    { facilityId: facility.id, patientId: patient.id, substance: 'Sulfonamides (sample)' },
    { facilityId: facility.id, patientId: patient.id, substance: 'Sulfonamides (sample)', reaction: 'Rash', severity: 'MODERATE', notes: 'Synthetic demonstration record.' },
  );

  const order = await findOrCreate(
    prisma.order,
    { facilityId: facility.id, patientId: patient.id, name: SAMPLE_ORDER_NAME },
    {
      facilityId: facility.id,
      patientId: patient.id,
      type: 'NURSING',
      name: SAMPLE_ORDER_NAME,
      details: { monitoring: 'Fluid input, urine output and running balance', sample: true },
      goal: 'Maintain urine output at 30 ml/hour or more and review the fluid balance each hour.',
      instructions: 'Record all oral and IV intake, urine output and other losses hourly. Escalate urine output below 30 ml/hour.',
      frequencyHours: 1,
      priority: 'URGENT',
      status: 'ACTIVE',
      orderedById: doctor.id,
      startAt: atHoursAgo(6),
      monitoringType: 'INTAKE_OUTPUT',
    },
  );

  const template = templateFor('INTAKE_OUTPUT');
  const sheet = await findOrCreate(
    prisma.monitoringSheet,
    { facilityId: facility.id, patientId: patient.id, title: SAMPLE_SHEET_TITLE },
    {
      facilityId: facility.id,
      patientId: patient.id,
      createdById: nurse.id,
      type: 'INTAKE_OUTPUT',
      title: SAMPLE_SHEET_TITLE,
      fields: template.fields,
      metadata: { sample: true, source: 'Awibi end-to-end showcase' },
      targetValue: 30,
      targetUnit: 'ml/hour urine output',
      frequencyMins: 60,
      instructions: 'Doctor order: record intake and output hourly. Escalate urine output below 30 ml/hour.',
      orderId: order.id,
      status: 'ACTIVE',
      startedAt: atHoursAgo(6),
    },
  );
  await prisma.order.update({ where: { id: order.id }, data: { monitoringSheetId: sheet.id } });

  const observations = [
    { hours: 4.25, values: { oralIntakeMl: 250, ivIntakeMl: 100, urineOutputMl: 55, otherOutputMl: 0, otherOutputSource: '' }, intakeMl: 350, outputMl: 55, note: '[Sample 1/5] Baseline observation entered by typing. Patient comfortable.' },
    { hours: 3.25, values: { oralIntakeMl: 200, ivIntakeMl: 100, urineOutputMl: 48, otherOutputMl: 0, otherOutputSource: '' }, intakeMl: 300, outputMl: 48, note: '[Sample 2/5] Voice draft reviewed by nurse before saving.' },
    { hours: 2.25, values: { oralIntakeMl: 150, ivIntakeMl: 100, urineOutputMl: 42, otherOutputMl: 0, otherOutputSource: '' }, intakeMl: 250, outputMl: 42, note: '[Sample 3/5] Handwritten chart image extracted; values checked before saving.' },
    { hours: 1.25, values: { oralIntakeMl: 120, ivIntakeMl: 100, urineOutputMl: 35, otherOutputMl: 0, otherOutputSource: '' }, intakeMl: 220, outputMl: 35, note: '[Sample 4/5] Guided questionnaire entry.' },
    { hours: 0.25, values: { oralIntakeMl: 180, ivIntakeMl: 100, urineOutputMl: 50, otherOutputMl: 0, otherOutputSource: '' }, intakeMl: 280, outputMl: 50, note: '[Sample 5/5] Latest observation. Output improved and remains above target.' },
  ];
  for (const observation of observations) {
    await findOrCreate(
      prisma.monitoringEntry,
      { facilityId: facility.id, sheetId: sheet.id, notes: observation.note },
      {
        facilityId: facility.id,
        sheetId: sheet.id,
        recordedById: nurse.id,
        recordedAt: atHoursAgo(observation.hours),
        values: observation.values,
        deviations: {},
        intakeMl: observation.intakeMl,
        outputMl: observation.outputMl,
        isAbnormal: false,
        notes: observation.note,
      },
    );
    await findOrCreate(
      prisma.orderExecution,
      { facilityId: facility.id, orderId: order.id, comment: observation.note },
      {
        facilityId: facility.id,
        orderId: order.id,
        executedAt: atHoursAgo(observation.hours),
        executedById: nurse.id,
        outcome: 'DONE',
        result: `${observation.outputMl} ml urine output; ${observation.intakeMl} ml intake recorded.`,
        comment: observation.note,
      },
    );
  }

  const stock = await findOrCreate(
    prisma.drugCatalogue,
    { facilityId: facility.id, name: 'Amlodipine', strength: '5 mg' },
    {
      facilityId: facility.id,
      name: 'Amlodipine',
      genericName: 'Amlodipine',
      form: 'Tablet',
      strength: '5 mg',
      defaultRoute: 'ORAL',
      defaultDose: '5 mg',
      defaultFrequency: 'Once daily',
      category: 'Antihypertensive',
      unitPrice: 50,
      stockOnHand: 72,
      reorderLevel: 20,
      unitLabel: 'tablets',
      nextExpiryDate: new Date(Date.now() + 240 * 86400000),
      isControlled: false,
      isActive: true,
    },
  );

  const dispensedPrescription = await findOrCreate(
    prisma.prescription,
    { facilityId: facility.id, patientId: patient.id, instructions: '[Sample pharmacy flow: dispensed]' },
    {
      facilityId: facility.id,
      patientId: patient.id,
      prescribedById: doctor.id,
      drugName: 'Amlodipine',
      dosage: '5 mg',
      frequency: 'Once daily',
      duration: '28 days',
      route: 'ORAL',
      instructions: '[Sample pharmacy flow: dispensed]',
      status: 'COMPLETED',
      dispensedAt: atHoursAgo(2),
      createdAt: atHoursAgo(5),
    },
  );
  await findOrCreate(
    prisma.dispense,
    { facilityId: facility.id, prescriptionId: dispensedPrescription.id, notes: '[Sample pharmacy flow: stock issued]' },
    {
      facilityId: facility.id,
      prescriptionId: dispensedPrescription.id,
      patientId: patient.id,
      drugCatalogueId: stock.id,
      quantity: 28,
      unit: 'tablets',
      unitPrice: 50,
      amount: 1400,
      dispensedById: pharmacist.id,
      notes: '[Sample pharmacy flow: stock issued]',
      dispensedAt: atHoursAgo(2),
    },
  );

  const activePrescription = await findOrCreate(
    prisma.prescription,
    { facilityId: facility.id, patientId: patient.id, instructions: '[Sample pharmacy flow: follow-up order]' },
    {
      facilityId: facility.id,
      patientId: patient.id,
      prescribedById: doctor.id,
      drugName: 'Amlodipine',
      dosage: '5 mg',
      frequency: 'Once daily',
      duration: '28 days',
      route: 'ORAL',
      instructions: '[Sample pharmacy flow: follow-up order]',
      status: 'ACTIVE',
      dispensedAt: null,
      createdAt: atHoursAgo(1),
    },
  );

  await findOrCreate(
    prisma.pharmacyTherapyProblem,
    { facilityId: facility.id, patientId: patient.id, description: 'Sample: Missed doses on three days because medicine ran out.' },
    {
      facilityId: facility.id,
      patientId: patient.id,
      prescriptionId: dispensedPrescription.id,
      identifiedById: pharmacist.id,
      category: 'NON_ADHERENCE',
      problemType: 'ACTUAL',
      severity: 'MODERATE',
      description: 'Sample: Missed doses on three days because medicine ran out.',
      evidence: 'Patient report during pharmacist review.',
      recommendation: 'Supply 28 days, explain daily use and arrange a refill reminder.',
      status: 'RESOLVED',
      resolution: 'Medicine supplied; patient counselled and follow-up date agreed.',
      resolvedAt: atHoursAgo(2),
    },
  );

  await findOrCreate(
    prisma.pharmacyCarePlan,
    { facilityId: facility.id, patientId: patient.id, assessment: 'Sample: Blood pressure treatment interrupted by missed doses.' },
    {
      facilityId: facility.id,
      patientId: patient.id,
      pharmacistId: pharmacist.id,
      documentationFormat: 'SOAP',
      subjective: 'Patient reports missing three doses after medicine ran out.',
      objective: 'Active hypertension diagnosis; amlodipine 5 mg once daily prescribed.',
      assessment: 'Sample: Blood pressure treatment interrupted by missed doses.',
      plan: 'Dispense 28 tablets, counsel on adherence, monitor blood pressure and review refill before stock runs out.',
      patientNeeds: 'Reliable medicine supply and a simple refill reminder.',
      therapyGoals: 'Take amlodipine daily and maintain the clinician-agreed blood pressure target.',
      interventions: 'Medicine supplied, dosing confirmed and adherence counselling completed.',
      followUpPlan: 'Pharmacist review in two weeks; escalate dizziness, ankle swelling or uncontrolled readings.',
      adherence: 'PARTIALLY_ADHERENT',
      status: 'SIGNED',
      signedAt: atHoursAgo(2),
      followUpAt: new Date(Date.now() + 14 * 86400000),
    },
  );

  return { facility: facility.name, patientId: patient.id, healthId: patient.universalPatientId, sheetId: sheet.id, orderId: order.id, activePrescriptionId: activePrescription.id };
}

async function seedShowcases(prisma, facilities) {
  const passwordHash = await bcrypt.hash(process.env.DEMO_PASSWORD || `showcase-${Date.now()}-disabled`, 12);
  const results = [];
  for (const facility of facilities) results.push(await seedFacilityShowcase(prisma, facility, passwordHash));
  return results;
}

module.exports = { SAMPLE_MRN, SAMPLE_SHEET_TITLE, seedShowcases, seedFacilityShowcase };
