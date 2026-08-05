/**
 * Add a realistic 7-day vitals series for the demo patients so the trend chart
 * has something meaningful to plot. Idempotent: skips a patient who already has
 * a series. Local demo data only.
 *
 * Run: node scripts/run-local.js scripts/enrich-local-vitals.js
 */
const { prisma, connectDatabase } = require('../src/utils/database');

// A patient recovering from a chest infection: fever settles, sats climb,
// pulse and respiratory rate normalise. Clinically coherent, not random noise.
const COURSE = [
  { h: 144, sys: 138, dia: 88, hr: 104, rr: 24, temp: 38.9, spo2: 92 },
  { h: 132, sys: 136, dia: 86, hr: 100, rr: 23, temp: 38.6, spo2: 93 },
  { h: 120, sys: 134, dia: 85, hr: 98,  rr: 22, temp: 38.2, spo2: 93 },
  { h: 108, sys: 132, dia: 84, hr: 96,  rr: 21, temp: 37.9, spo2: 94 },
  { h: 96,  sys: 130, dia: 83, hr: 92,  rr: 20, temp: 37.6, spo2: 95 },
  { h: 84,  sys: 128, dia: 82, hr: 90,  rr: 20, temp: 37.4, spo2: 95 },
  { h: 72,  sys: 127, dia: 81, hr: 88,  rr: 19, temp: 37.3, spo2: 96 },
  { h: 60,  sys: 126, dia: 80, hr: 84,  rr: 18, temp: 37.1, spo2: 96 },
  { h: 48,  sys: 124, dia: 79, hr: 82,  rr: 18, temp: 37.0, spo2: 97 },
  { h: 36,  sys: 123, dia: 78, hr: 80,  rr: 17, temp: 36.9, spo2: 97 },
  { h: 24,  sys: 122, dia: 78, hr: 78,  rr: 17, temp: 36.8, spo2: 98 },
  { h: 12,  sys: 121, dia: 77, hr: 76,  rr: 16, temp: 36.8, spo2: 98 },
  { h: 6,   sys: 120, dia: 76, hr: 74,  rr: 16, temp: 36.7, spo2: 98 },
  { h: 2,   sys: 119, dia: 76, hr: 72,  rr: 16, temp: 36.7, spo2: 99 },
];

async function main() {
  await connectDatabase();

  const facility = await prisma.facility.findFirst({ where: { name: 'UCH Ibadan Demo' } });
  if (!facility) throw new Error('UCH Ibadan Demo facility not found. Run npm run seed:local first.');

  const nurse = await prisma.user.findFirst({ where: { facilityId: facility.id, subRole: 'NURSE' } });
  const patients = await prisma.patient.findMany({
    where: { facilityId: facility.id, isArchived: false },
    orderBy: { createdAt: 'asc' },
    take: 3,
  });
  if (!patients.length) throw new Error('No patients found. Run npm run seed:local first.');

  let created = 0;
  for (const patient of patients) {
    const existing = await prisma.vitals.count({ where: { patientId: patient.id, facilityId: facility.id } });
    if (existing >= COURSE.length) {
      console.log(`  skip ${patient.firstName} ${patient.lastName} — already has ${existing} readings`);
      continue;
    }

    // Offset each patient slightly so the three charts are not identical.
    const drift = patients.indexOf(patient) * 2;
    const rows = COURSE.map((p) => ({
      facilityId: facility.id,
      patientId: patient.id,
      recordedById: nurse?.id || null,
      bloodPressureSystolic: p.sys + drift,
      bloodPressureDiastolic: p.dia + Math.round(drift / 2),
      heartRate: p.hr + drift,
      respiratoryRate: p.rr,
      temperature: Number((p.temp + drift * 0.05).toFixed(1)),
      oxygenSaturation: Math.min(100, p.spo2),
      recordedAt: new Date(Date.now() - p.h * 3600 * 1000),
    }));

    await prisma.vitals.createMany({ data: rows });
    created += rows.length;
    console.log(`  + ${rows.length} readings for ${patient.firstName} ${patient.lastName}`);
  }

  console.log(`\n✅  ${created} vitals readings added across ${patients.length} patients.`);
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
