/**
 * Seed the diagnostics catalogue (laboratory + imaging) for local demo
 * facilities. Idempotent — safe to re-run.
 *
 * Reference ranges are standard adult values in common Nigerian laboratory use.
 * Critical thresholds are the values that should trigger an immediate call to
 * the ordering clinician.
 *
 * Run: node scripts/run-local.js scripts/seed-diagnostics-catalogue.js
 */
const { prisma, connectDatabase } = require('../src/utils/database');

const CATALOGUE = [
  // ── Haematology ───────────────────────────────────────────────────────────
  { name: 'Haemoglobin', code: 'HB', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood',
    unit: 'g/dL', referenceLow: 12, referenceHigh: 16, criticalLow: 7, criticalHigh: 20, price: 2000, turnaroundHours: 2 },
  { name: 'Full Blood Count', code: 'FBC', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood',
    unit: null, resultKind: 'TEXT', price: 5000, turnaroundHours: 4 },
  { name: 'White Blood Cell Count', code: 'WBC', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood',
    unit: 'x10³/µL', referenceLow: 4, referenceHigh: 11, criticalLow: 1, criticalHigh: 30, price: 2500, turnaroundHours: 2 },
  { name: 'Platelet Count', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood',
    unit: 'x10³/µL', referenceLow: 150, referenceHigh: 450, criticalLow: 50, criticalHigh: 1000, price: 2500, turnaroundHours: 2 },
  { name: 'PCV / Haematocrit', code: 'PCV', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood',
    unit: '%', referenceLow: 36, referenceHigh: 48, criticalLow: 21, criticalHigh: 60, price: 1500, turnaroundHours: 1 },

  // ── Parasitology / microbiology ───────────────────────────────────────────
  { name: 'Malaria Parasite (MP)', code: 'MP', testType: 'LAB', category: 'Parasitology', specimenType: 'EDTA blood',
    unit: null, resultKind: 'TEXT', price: 2000, turnaroundHours: 1 },
  { name: 'Malaria RDT', testType: 'LAB', category: 'Parasitology', specimenType: 'Whole blood',
    unit: null, resultKind: 'TEXT', price: 1500, turnaroundHours: 1 },
  { name: 'Widal Test', testType: 'LAB', category: 'Serology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 2500, turnaroundHours: 4 },
  { name: 'Urinalysis', testType: 'LAB', category: 'Microbiology', specimenType: 'Urine',
    unit: null, resultKind: 'TEXT', price: 2000, turnaroundHours: 2 },
  { name: 'Urine MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'Mid-stream urine',
    unit: null, resultKind: 'TEXT', price: 5000, turnaroundHours: 72 },

  // ── Chemistry ─────────────────────────────────────────────────────────────
  { name: 'Fasting Blood Sugar', code: 'FBS', testType: 'LAB', category: 'Chemistry', specimenType: 'Fluoride oxalate',
    unit: 'mg/dL', referenceLow: 70, referenceHigh: 100, criticalLow: 40, criticalHigh: 400, price: 1500, turnaroundHours: 2 },
  { name: 'Random Blood Sugar', code: 'RBS', testType: 'LAB', category: 'Chemistry', specimenType: 'Fluoride oxalate',
    unit: 'mg/dL', referenceLow: 70, referenceHigh: 140, criticalLow: 40, criticalHigh: 400, price: 1500, turnaroundHours: 1 },
  { name: 'HbA1c', testType: 'LAB', category: 'Chemistry', specimenType: 'EDTA blood',
    unit: '%', referenceLow: 4, referenceHigh: 5.6, criticalHigh: 10, price: 8000, turnaroundHours: 24 },
  { name: 'Serum Creatinine', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: 'mg/dL', referenceLow: 0.6, referenceHigh: 1.3, criticalHigh: 4, price: 3000, turnaroundHours: 4 },
  { name: 'Serum Potassium', code: 'K', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: 'mmol/L', referenceLow: 3.5, referenceHigh: 5.1, criticalLow: 2.5, criticalHigh: 6.5, price: 3000, turnaroundHours: 4 },
  { name: 'Serum Sodium', code: 'Na', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: 'mmol/L', referenceLow: 135, referenceHigh: 145, criticalLow: 120, criticalHigh: 160, price: 3000, turnaroundHours: 4 },
  { name: 'Liver Function Test', code: 'LFT', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 9000, turnaroundHours: 24 },

  // ── Imaging (same catalogue: every facility has a lab and imaging side) ───
  { name: 'Chest X-Ray', code: 'CXR', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 8000, turnaroundHours: 4 },
  { name: 'Abdominal Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 12000, turnaroundHours: 4 },
  { name: 'Obstetric Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 12000, turnaroundHours: 2 },
  { name: 'Pelvic Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 10000, turnaroundHours: 4 },
  { name: 'CT Scan (Brain)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 85000, turnaroundHours: 24 },
  { name: 'MRI (Lumbar Spine)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 150000, turnaroundHours: 48 },
  { name: 'ECG', testType: 'ECG', category: 'Cardiology',
    resultKind: 'REPORT', price: 7000, turnaroundHours: 1 },
  { name: 'Echocardiography', testType: 'IMAGING', category: 'Cardiology',
    resultKind: 'REPORT', price: 25000, turnaroundHours: 24 },
];

async function main() {
  await connectDatabase();
  const facilities = await prisma.facility.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  if (!facilities.length) throw new Error('No facilities found. Run npm run seed:local first.');

  let created = 0;
  let skipped = 0;

  for (const facility of facilities) {
    for (const t of CATALOGUE) {
      const existing = await prisma.diagnosticTest.findFirst({
        where: { facilityId: facility.id, name: t.name },
      });
      if (existing) { skipped += 1; continue; }
      await prisma.diagnosticTest.create({
        data: {
          facilityId: facility.id,
          name: t.name,
          code: t.code || null,
          testType: t.testType,
          category: t.category || null,
          specimenType: t.specimenType || null,
          unit: t.unit || null,
          referenceLow: t.referenceLow ?? null,
          referenceHigh: t.referenceHigh ?? null,
          criticalLow: t.criticalLow ?? null,
          criticalHigh: t.criticalHigh ?? null,
          resultKind: t.resultKind || 'NUMERIC',
          price: t.price ?? 0,
          turnaroundHours: t.turnaroundHours ?? null,
        },
      });
      created += 1;
    }
    console.log(`  ${facility.name}: catalogue ready`);
  }

  console.log(`\n✅  ${created} tests created, ${skipped} already present, across ${facilities.length} facilities.`);
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
