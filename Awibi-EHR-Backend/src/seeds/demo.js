/**
 * AwibiEHR Demo Seed (Prisma)
 * Creates a complete demo facility with staff, patients, and sample data.
 * Run: npm run seed
 * Run: npm run seed:reset  (clears everything first)
 */
require('dotenv').config({ path: require('path').join(__dirname, '../../.env') });
const bcrypt = require('bcryptjs');
const { prisma, connectDatabase } = require('../utils/database');
const { generateUPID } = require('../utils/upid');

const RESET = process.argv.includes('--reset');

const REQUIRED_DEMO_VARS = [
  'DEMO_PASSWORD',
  'DEMO_ADMIN_EMAIL',
  'DEMO_DOCTOR_EMAIL',
  'DEMO_NURSE_EMAIL',
  'DEMO_RECORDS_EMAIL',
  'DEMO_LAB_EMAIL',
];

function getPrivateDemoCredentials() {
  const missing = REQUIRED_DEMO_VARS.filter((name) => !process.env[name]);
  if (missing.length) {
    throw new Error(`Missing private demo configuration: ${missing.join(', ')}`);
  }
  const admin = process.env.DEMO_ADMIN_EMAIL.toLowerCase();
  // Awibi-staff super administrator. Derived from the admin address so existing
  // .env.local files keep working; set DEMO_SUPERADMIN_EMAIL to override. The
  // @local.awibi.test suffix is required for local demo entry to list it.
  const superAdmin = (process.env.DEMO_SUPERADMIN_EMAIL || admin.replace(/^admin\./, 'superadmin.')).toLowerCase();

  return {
    password: process.env.DEMO_PASSWORD,
    admin,
    superAdmin,
    doctor: process.env.DEMO_DOCTOR_EMAIL.toLowerCase(),
    nurse: process.env.DEMO_NURSE_EMAIL.toLowerCase(),
    records: process.env.DEMO_RECORDS_EMAIL.toLowerCase(),
    lab: process.env.DEMO_LAB_EMAIL.toLowerCase(),
  };
}

async function seed() {
  await connectDatabase();
  const demoCredentials = getPrivateDemoCredentials();

  if (RESET) {
    console.log('🗑️   Clearing all data...');
    // Order matters due to FK constraints — delete leaf nodes first
    await prisma.$transaction([
      prisma.auditLog.deleteMany({}),
      prisma.consentGrant.deleteMany({}),
      prisma.patientDocument.deleteMany({}),
      prisma.invoice.deleteMany({}),
      prisma.admission.deleteMany({}),
      prisma.labRequest.deleteMany({}),
      prisma.prescription.deleteMany({}),
      prisma.condition.deleteMany({}),
      prisma.allergy.deleteMany({}),
      prisma.vitals.deleteMany({}),
      prisma.appointment.deleteMany({}),
      prisma.case.deleteMany({}),
      prisma.affiliate.deleteMany({}),
      prisma.bed.deleteMany({}),
      prisma.department.deleteMany({}),
      prisma.subscription.deleteMany({}),
      prisma.patient.deleteMany({}),
      prisma.user.deleteMany({}),
      prisma.facility.deleteMany({}),
    ]);
  }

  const existingFacility = await prisma.facility.findFirst({ where: { name: 'UCH Ibadan Demo' } });
  if (existingFacility && !RESET) {
    console.log('✅  Demo data already seeded. Use --reset to re-seed.');
    process.exit(0);
  }

  console.log('🌱  Seeding demo data...');

  // ── Facility ──────────────────────────────────────────────────────────────
  const facility = await prisma.facility.create({
    data: {
      name: 'UCH Ibadan Demo', type: 'HOSPITAL',
      email: 'demo@uch.edu.ng', phone: '+234 8108294446',
      address: 'Queen Elizabeth Road II, Ibadan',
      state: 'Oyo', lga: 'Ibadan North', plan: 'SMALL',
      profileComplete: true, licenseNumber: 'MDCN-2024-0001',
    },
  });

  await prisma.subscription.create({
    data: {
      facilityId: facility.id, plan: 'SMALL', status: 'ACTIVE',
      patientLimit: 200, staffLimit: 10, patientsUsed: 5, staffUsed: 5,
      startDate: new Date(), endDate: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      amount: 20000,
    },
  });

  // ── Users ─────────────────────────────────────────────────────────────────
  const hash = pw => bcrypt.hash(pw, 12);
  const PASS = demoCredentials.password;

  const [admin, doctor, nurse, records, lab, superAdmin] = await Promise.all([
    prisma.user.create({ data: { firstName: 'Wasiu', lastName: 'Maleek', email: demoCredentials.admin, passwordHash: await hash(PASS), role: 'ADMIN', facilityId: facility.id, staffId: 'UCH-STF-100001', emailVerified: true, isActive: true, specialty: 'Administration' } }),
    prisma.user.create({ data: { firstName: 'Dr. Amaka', lastName: 'Okafor', email: demoCredentials.doctor, passwordHash: await hash(PASS), role: 'CLINICIAN', subRole: 'DOCTOR', facilityId: facility.id, staffId: 'UCH-STF-100002', emailVerified: true, isActive: true, specialty: 'Internal Medicine' } }),
    prisma.user.create({ data: { firstName: 'Bisi', lastName: 'Adeyemi', email: demoCredentials.nurse, passwordHash: await hash(PASS), role: 'CLINICIAN', subRole: 'NURSE', facilityId: facility.id, staffId: 'UCH-STF-100003', emailVerified: true, isActive: true } }),
    prisma.user.create({ data: { firstName: 'Tunde', lastName: 'Adeola', email: demoCredentials.records, passwordHash: await hash(PASS), role: 'RECORDS', facilityId: facility.id, staffId: 'UCH-STF-100004', emailVerified: true, isActive: true } }),
    prisma.user.create({ data: { firstName: 'Ngozi', lastName: 'Eze', email: demoCredentials.lab, passwordHash: await hash(PASS), role: 'CLINICIAN', subRole: 'LAB', facilityId: facility.id, staffId: 'UCH-STF-100005', emailVerified: true, isActive: true, specialty: 'Laboratory Science' } }),
    // Awibi platform super administrator (not a facility employee). Homed to a
    // facility because User.facilityId is required; cross-facility oversight is
    // delivered by the audited facility switcher, not by widening tenant scope.
    prisma.user.create({ data: { firstName: 'Awibi', lastName: 'Super Admin', email: demoCredentials.superAdmin, passwordHash: await hash(PASS), role: 'SUPER_ADMIN', facilityId: facility.id, staffId: 'AWB-OPS-000001', emailVerified: true, isActive: true, specialty: 'Platform Operations' } }),
  ]);

  // ── Departments ────────────────────────────────────────────────────────────
  const [deptGeneral, deptAE, deptLab, deptNurse] = await prisma.$transaction([
    prisma.department.create({ data: { facilityId: facility.id, name: 'General Medicine', code: 'GEN', headId: doctor.id } }),
    prisma.department.create({ data: { facilityId: facility.id, name: 'Accident & Emergency', code: 'A&E', isEmergency: true } }),
    prisma.department.create({ data: { facilityId: facility.id, name: 'Laboratory', code: 'LAB', headId: lab.id } }),
    prisma.department.create({ data: { facilityId: facility.id, name: 'Nursing Ward', code: 'WARD' } }),
  ]);

  // ── Beds ───────────────────────────────────────────────────────────────────
  const bedData = [
    { bedNumber: 'A-01', ward: 'Ward A', type: 'GENERAL' },
    { bedNumber: 'A-02', ward: 'Ward A', type: 'GENERAL' },
    { bedNumber: 'A-03', ward: 'Ward A', type: 'GENERAL' },
    { bedNumber: 'A-04', ward: 'Ward A', type: 'GENERAL' },
    { bedNumber: 'B-01', ward: 'Ward B', type: 'GENERAL' },
    { bedNumber: 'B-02', ward: 'Ward B', type: 'GENERAL' },
    { bedNumber: 'ICU-01', ward: 'ICU', type: 'ICU' },
    { bedNumber: 'ICU-02', ward: 'ICU', type: 'ICU' },
  ];
  const beds = await prisma.$transaction(
    bedData.map(b => prisma.bed.create({ data: { facilityId: facility.id, departmentId: deptNurse.id, ...b, status: 'AVAILABLE' } }))
  );

  // ── Patients ───────────────────────────────────────────────────────────────
  const PATIENTS_DATA = [
    { firstName: 'David', lastName: 'Adesanya', dateOfBirth: new Date('1975-06-30'), gender: 'MALE', phone: '+234 8108294446', email: 'david@gmail.com', state: 'Oyo', maritalStatus: 'Married', religion: 'Islam', bloodType: 'AA', height: 160, weight: 77, hmo: 'NHIS', status: 'OUT_PATIENT', nin: '12345678901' },
    { firstName: 'Olivia', lastName: 'Rhye', dateOfBirth: new Date('1990-03-15'), gender: 'FEMALE', phone: '09090909090', email: 'olivia@gmail.com', state: 'Lagos', bloodType: 'O+', status: 'OUT_PATIENT' },
    { firstName: 'Phoenix', lastName: 'Baker', dateOfBirth: new Date('1985-09-22'), gender: 'MALE', phone: '09090909091', email: 'phoenix@gmail.com', bloodType: 'A+', status: 'OUT_PATIENT' },
    { firstName: 'Lana', lastName: 'Steiner', dateOfBirth: new Date('1992-01-08'), gender: 'FEMALE', phone: '09090909092', email: 'lana@gmail.com', status: 'IN_PATIENT' },
    { firstName: 'Demi', lastName: 'Wilkinson', dateOfBirth: new Date('1978-11-30'), gender: 'MALE', phone: '09090909093', email: 'demi@gmail.com', status: 'IN_PATIENT' },
    { firstName: 'Candice', lastName: 'Wu', dateOfBirth: new Date('1995-07-14'), gender: 'FEMALE', phone: '09090909094', email: 'candice@gmail.com', hmo: 'HMO Direct', status: 'OUT_PATIENT' },
    { firstName: 'Natali', lastName: 'Craig', dateOfBirth: new Date('1988-02-20'), gender: 'FEMALE', phone: '09090909095', email: 'natali@gmail.com', status: 'DISCHARGED' },
    { firstName: 'Drew', lastName: 'Cano', dateOfBirth: new Date('1980-05-12'), gender: 'MALE', phone: '09090909096', email: 'drew@gmail.com', status: 'OUT_PATIENT' },
    { firstName: 'Orlando', lastName: 'Diggs', dateOfBirth: new Date('1970-12-03'), gender: 'MALE', phone: '09090909097', email: 'orlando@gmail.com', bloodType: 'B+', status: 'OUT_PATIENT' },
    { firstName: 'Andi', lastName: 'Lane', dateOfBirth: new Date('1993-08-25'), gender: 'FEMALE', phone: '09090909098', email: 'andi@gmail.com', status: 'OUT_PATIENT' },
  ];

  const patients = [];
  for (let i = 0; i < PATIENTS_DATA.length; i++) {
    const pd = PATIENTS_DATA[i];
    const p = await prisma.patient.create({
      data: {
        facilityId: facility.id,
        universalPatientId: generateUPID(),
        mrn: `PAT-0${String(i + 1).padStart(2, '0')}`,
        emergencyContactName: 'Emergency Contact',
        emergencyContactPhone: '+234 8000000000',
        ...pd,
      },
    });
    patients.push(p);
  }

  const [david, olivia, phoenix, lana, demi] = patients;

  // ── Allergies ──────────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.allergy.create({ data: { facilityId: facility.id, patientId: david.id, substance: 'Eggs', reaction: 'Rash', severity: 'MILD' } }),
    prisma.allergy.create({ data: { facilityId: facility.id, patientId: david.id, substance: 'Milk', reaction: 'Stomach cramps', severity: 'MODERATE' } }),
  ]);

  // ── Conditions ─────────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.condition.create({ data: { facilityId: facility.id, patientId: david.id, name: 'Hypertension', icdCode: 'I10', status: 'CHRONIC' } }),
    prisma.condition.create({ data: { facilityId: facility.id, patientId: david.id, name: 'Ulcer', icdCode: 'K25', status: 'ACTIVE' } }),
    prisma.condition.create({ data: { facilityId: facility.id, patientId: olivia.id, name: 'Diabetes Type 2', icdCode: 'E11', status: 'CHRONIC' } }),
    prisma.condition.create({ data: { facilityId: facility.id, patientId: phoenix.id, name: 'Asthma', icdCode: 'J45', status: 'ACTIVE' } }),
  ]);

  // ── Vitals ──────────────────────────────────────────────────────────────────
  await prisma.vitals.create({
    // Respiratory rate is breaths per minute — normal adult range is 12-20.
    data: { facilityId: facility.id, patientId: david.id, recordedById: nurse.id, bloodPressureSystolic: 123, bloodPressureDiastolic: 72, heartRate: 72, respiratoryRate: 18, temperature: 37.2, oxygenSaturation: 98, height: 160, weight: 77, bmi: 30.1 },
  });

  // ── Cases ───────────────────────────────────────────────────────────────────
  const case1 = await prisma.case.create({
    data: {
      facilityId: facility.id, patientId: david.id, authorId: doctor.id,
      title: 'Hypertension Follow-up',
      chiefComplaint: 'Patient reports occasional headaches and dizziness',
      history: 'Known hypertensive for 5 years. Currently on Amlodipine 5mg daily.',
      examination: 'BP: 123/72mmHg. HR: 72bpm. No pedal edema.',
      assessment: 'Controlled hypertension. Patient compliant with medication.',
      plan: 'Continue current medications. Lifestyle modification counselling. Review in 4 weeks.',
      captureMethod: 'NOTE_TAKER', status: 'CLOSED', reviewedByClinicianAt: new Date(),
    },
  });

  const case2 = await prisma.case.create({
    data: {
      facilityId: facility.id, patientId: olivia.id, authorId: doctor.id,
      title: 'Diabetes Management',
      chiefComplaint: 'Routine diabetes check',
      assessment: 'Type 2 Diabetes — fair glycaemic control',
      plan: 'Continue Metformin. HbA1c in 3 months. Dietary counselling.',
      captureMethod: 'NOTE_TAKER', status: 'OPEN', reviewedByClinicianAt: new Date(),
    },
  });

  // ── Prescriptions ──────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.prescription.create({ data: { facilityId: facility.id, patientId: david.id, caseId: case1.id, prescribedById: doctor.id, drugName: 'Amlodipine', dosage: '5mg', frequency: 'Once daily', duration: '30 days', route: 'ORAL', status: 'ACTIVE' } }),
    prisma.prescription.create({ data: { facilityId: facility.id, patientId: david.id, caseId: case1.id, prescribedById: doctor.id, drugName: 'Lisinopril', dosage: '10mg', frequency: 'Once daily', duration: '30 days', route: 'ORAL', status: 'ACTIVE' } }),
    prisma.prescription.create({ data: { facilityId: facility.id, patientId: olivia.id, caseId: case2.id, prescribedById: doctor.id, drugName: 'Metformin', dosage: '500mg', frequency: 'Twice daily', duration: '90 days', route: 'ORAL', status: 'ACTIVE' } }),
  ]);

  // ── Appointments ────────────────────────────────────────────────────────────
  const todayBase = new Date();
  const appt1 = await prisma.appointment.create({
    data: {
      facilityId: facility.id, patientId: david.id, doctorId: doctor.id,
      scheduledAt: new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate(), 9, 0),
      visitType: 'FOLLOW_UP', status: 'CONFIRMED', charges: 5000, paymentStatus: 'PAID', paidAmount: 5000, remarks: 'Monthly review',
    },
  });
  const appt2 = await prisma.appointment.create({
    data: {
      facilityId: facility.id, patientId: olivia.id, doctorId: doctor.id,
      scheduledAt: new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate(), 11, 0),
      visitType: 'ROUTINE', status: 'SCHEDULED', charges: 3500, paymentStatus: 'UNPAID',
    },
  });
  const appt3 = await prisma.appointment.create({
    data: {
      facilityId: facility.id, patientId: lana.id, doctorId: doctor.id,
      scheduledAt: new Date(todayBase.getFullYear(), todayBase.getMonth(), todayBase.getDate(), 14, 0),
      visitType: 'EMERGENCY', status: 'IN_PROGRESS', charges: 15000, paymentStatus: 'PART_PAID', paidAmount: 5000,
    },
  });

  // ── Lab Requests ────────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.labRequest.create({ data: { facilityId: facility.id, patientId: david.id, requestedById: doctor.id, caseId: case1.id, testName: 'Full Blood Count', testType: 'LAB', priority: 'ROUTINE', status: 'COMPLETED', result: 'Hb: 12.5 g/dL. WBC: 7.2 x10³/μL. Platelets: 220 x10³/μL. Normal.', completedAt: new Date() } }),
    prisma.labRequest.create({ data: { facilityId: facility.id, patientId: olivia.id, requestedById: doctor.id, testName: 'HbA1c', testType: 'LAB', priority: 'ROUTINE', status: 'PENDING' } }),
    prisma.labRequest.create({ data: { facilityId: facility.id, patientId: phoenix.id, requestedById: doctor.id, testName: 'Chest X-Ray', testType: 'IMAGING', priority: 'URGENT', status: 'IN_PROGRESS' } }),
  ]);

  // ── Invoices ────────────────────────────────────────────────────────────────
  await prisma.$transaction([
    prisma.invoice.create({ data: { facilityId: facility.id, patientId: david.id, appointmentId: appt1.id, invoiceNumber: 'INV-2024-001', items: [{ description: 'Consultation fee', amount: 5000 }], subtotal: 5000, total: 5000, amountPaid: 5000, balance: 0, paymentStatus: 'PAID', paidAt: new Date() } }),
    prisma.invoice.create({ data: { facilityId: facility.id, patientId: olivia.id, appointmentId: appt2.id, invoiceNumber: 'INV-2024-002', items: [{ description: 'Consultation fee', amount: 3500 }], subtotal: 3500, total: 3500, amountPaid: 0, balance: 3500, paymentStatus: 'UNPAID' } }),
  ]);

  // ── Admissions ──────────────────────────────────────────────────────────────
  await prisma.admission.create({ data: { facilityId: facility.id, patientId: lana.id, bedId: beds[0].id, admittedById: nurse.id, caseId: case2.id, diagnosis: 'Severe Malaria', status: 'ADMITTED' } });
  await prisma.bed.update({ where: { id: beds[0].id }, data: { status: 'OCCUPIED', currentPatientId: lana.id } });

  await prisma.admission.create({ data: { facilityId: facility.id, patientId: demi.id, bedId: beds[1].id, admittedById: nurse.id, diagnosis: 'Pneumonia', status: 'ADMITTED' } });
  await prisma.bed.update({ where: { id: beds[1].id }, data: { status: 'OCCUPIED', currentPatientId: demi.id } });

  console.log('');
  console.log('✅  Demo data seeded successfully!');
  console.log('  Private credentials were loaded from the environment and are not printed.');
  if (false) {
  console.log('');
  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║               DEMO LOGIN CREDENTIALS                     ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║  Admin:   admin@awibi.demo   /  Demo@1234               ║');
  console.log('║  Doctor:  doctor@awibi.demo  /  Demo@1234               ║');
  console.log('║  Nurse:   nurse@awibi.demo   /  Demo@1234               ║');
  console.log('║  Records: records@awibi.demo /  Demo@1234               ║');
  console.log('║  Lab:     lab@awibi.demo     /  Demo@1234               ║');
  console.log('╠═══════════════════════════════════════════════════════════╣');
  console.log('║  Staff ID login: UCH-STF-100001  /  Demo@1234           ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log('');
  }
  console.log(`  Facility: UCH Ibadan Demo`);
  console.log(`  Patients: ${patients.length} seeded`);
  console.log('');

  await prisma.$disconnect();
  process.exit(0);
}

seed().catch(err => { console.error('Seed failed:', err); prisma.$disconnect(); process.exit(1); });
