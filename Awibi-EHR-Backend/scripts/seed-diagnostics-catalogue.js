/**
 * Seed the diagnostics catalogue (laboratory + imaging) for local demo
 * facilities. Idempotent — safe to re-run.
 *
 * Values below are synthetic local-beta defaults, not a clinical reference
 * standard. Every deploying facility must approve method-, analyser-, age- and
 * sex-appropriate ranges and critical-call thresholds before real-patient use.
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
  { name: 'Erythrocyte Sedimentation Rate', code: 'ESR', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood', resultKind: 'NUMERIC', price: 2500, turnaroundHours: 4 },
  { name: 'Reticulocyte Count', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood', resultKind: 'TEXT', price: 4500, turnaroundHours: 6 },
  { name: 'Peripheral Blood Film', code: 'PBF', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood', resultKind: 'REPORT', price: 5000, turnaroundHours: 8 },
  { name: 'Prothrombin Time / INR', code: 'PT-INR', testType: 'LAB', category: 'Haematology', specimenType: 'Citrated plasma', resultKind: 'TEXT', price: 6000, turnaroundHours: 4 },
  { name: 'Activated Partial Thromboplastin Time', code: 'APTT', testType: 'LAB', category: 'Haematology', specimenType: 'Citrated plasma', resultKind: 'TEXT', price: 6000, turnaroundHours: 4 },
  { name: 'D-Dimer', testType: 'LAB', category: 'Haematology', specimenType: 'Citrated plasma', resultKind: 'TEXT', price: 12000, turnaroundHours: 6 },
  { name: 'Blood Group and Rhesus Type', code: 'ABO-RH', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood', resultKind: 'TEXT', price: 3000, turnaroundHours: 2 },
  { name: 'Haemoglobin Electrophoresis / Genotype', code: 'HB-ELECT', testType: 'LAB', category: 'Haematology', specimenType: 'EDTA blood', resultKind: 'REPORT', price: 7000, turnaroundHours: 24 },

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
  { name: 'Blood Culture and Sensitivity', testType: 'LAB', category: 'Microbiology', specimenType: 'Blood culture bottles',
    unit: null, resultKind: 'TEXT', price: 12000, turnaroundHours: 120 },
  { name: 'Sputum MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'Sputum',
    unit: null, resultKind: 'TEXT', price: 6000, turnaroundHours: 72 },
  { name: 'Stool MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'Stool',
    unit: null, resultKind: 'TEXT', price: 6000, turnaroundHours: 72 },
  { name: 'Seminal Fluid Analysis (SFA)', code: 'SFA', testType: 'LAB', category: 'Microbiology', specimenType: 'Semen',
    unit: null, resultKind: 'REPORT', price: 8000, turnaroundHours: 4 },
  { name: 'High Vaginal Swab MCS', code: 'HVS-MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'High vaginal swab',
    unit: null, resultKind: 'TEXT', price: 7000, turnaroundHours: 72 },
  { name: 'Urethral Swab MCS', code: 'US-MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'Urethral swab',
    unit: null, resultKind: 'TEXT', price: 7000, turnaroundHours: 72 },
  { name: 'Cerebrospinal Fluid MCS', code: 'CSF-MCS', testType: 'LAB', category: 'Microbiology', specimenType: 'Cerebrospinal fluid',
    unit: null, resultKind: 'REPORT', price: 12000, turnaroundHours: 72 },
  { name: 'GeneXpert MTB/RIF', code: 'XPERT-MTB', testType: 'LAB', category: 'Microbiology', specimenType: 'Sputum or approved specimen',
    unit: null, resultKind: 'TEXT', price: 15000, turnaroundHours: 24 },
  { name: 'Viral Markers Panel', code: 'VIRAL-MARKERS', testType: 'LAB', category: 'Serology', specimenType: 'Serum',
    unit: null, resultKind: 'REPORT', price: 15000, turnaroundHours: 24 },
  { name: 'Hepatitis B Surface Antigen', code: 'HBSAG', testType: 'LAB', category: 'Serology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 5000, turnaroundHours: 8 },
  { name: 'Hepatitis C Antibody', code: 'ANTI-HCV', testType: 'LAB', category: 'Serology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 6000, turnaroundHours: 8 },
  { name: 'HIV 1 & 2 Antigen/Antibody', code: 'HIV-AGAB', testType: 'LAB', category: 'Serology', specimenType: 'Serum or plasma',
    unit: null, resultKind: 'TEXT', price: 5000, turnaroundHours: 8 },
  { name: 'Syphilis Screening (RPR/VDRL)', code: 'RPR-VDRL', testType: 'LAB', category: 'Serology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 4000, turnaroundHours: 8 },

  // Histopathology / morbid anatomy. No universal turnaround or reference
  // interval is implied; the specialist issues a narrative report.
  { name: 'Surgical Biopsy Histology', testType: 'LAB', category: 'Histopathology', specimenType: 'Formalin-fixed tissue',
    unit: null, resultKind: 'REPORT', price: 25000, turnaroundHours: 168 },
  { name: 'Cytology', testType: 'LAB', category: 'Histopathology', specimenType: 'Cytology specimen',
    unit: null, resultKind: 'REPORT', price: 18000, turnaroundHours: 120 },
  { name: 'Cervical Cytology (Pap Smear)', testType: 'LAB', category: 'Histopathology', specimenType: 'Cervical sample',
    unit: null, resultKind: 'REPORT', price: 15000, turnaroundHours: 120 },
  { name: 'Fine Needle Aspiration Cytology', code: 'FNAC', testType: 'LAB', category: 'Histopathology', specimenType: 'Aspirate / prepared slides',
    unit: null, resultKind: 'REPORT', price: 18000, turnaroundHours: 120 },
  { name: 'Core Needle Biopsy Histology', testType: 'LAB', category: 'Histopathology', specimenType: 'Formalin-fixed core biopsy',
    unit: null, resultKind: 'REPORT', price: 28000, turnaroundHours: 168 },
  { name: 'Immunohistochemistry Panel', code: 'IHC', testType: 'LAB', category: 'Histopathology', specimenType: 'Paraffin tissue block / slides',
    unit: null, resultKind: 'REPORT', price: 60000, turnaroundHours: 240 },
  { name: 'Post-mortem Examination', testType: 'OTHER', category: 'Morbid Anatomy', specimenType: 'Post-mortem examination',
    unit: null, resultKind: 'REPORT', price: 0, turnaroundHours: 336 },

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
  { name: 'Renal Function Test', code: 'RFT', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 9000, turnaroundHours: 24 },
  { name: 'Lipid Profile', testType: 'LAB', category: 'Chemistry', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 8000, turnaroundHours: 24 },
  { name: 'Thyroid Function Test', code: 'TFT', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 18000, turnaroundHours: 48 },
  { name: 'Serum Electrolytes, Urea and Creatinine', code: 'EUC', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 10000, turnaroundHours: 8 },
  { name: 'Serum Calcium, Magnesium and Phosphate', code: 'CMP', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 12000, turnaroundHours: 12 },
  { name: 'Cardiac Markers Panel', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum or plasma',
    unit: null, resultKind: 'REPORT', price: 25000, turnaroundHours: 4 },
  { name: 'Troponin I/T', code: 'TROPONIN', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum or plasma',
    unit: null, resultKind: 'TEXT', price: 15000, turnaroundHours: 2 },
  { name: 'Iron Studies', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: null, resultKind: 'REPORT', price: 18000, turnaroundHours: 24 },
  { name: 'Serum Ferritin', code: 'FERRITIN', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: 'ng/mL', resultKind: 'NUMERIC', price: 10000, turnaroundHours: 24 },
  { name: 'Prostate-Specific Antigen', code: 'PSA', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: 'ng/mL', resultKind: 'NUMERIC', price: 12000, turnaroundHours: 24 },
  { name: 'Beta-hCG', code: 'BHCG', testType: 'LAB', category: 'Chemical Pathology', specimenType: 'Serum',
    unit: null, resultKind: 'TEXT', price: 8000, turnaroundHours: 8 },

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
  { name: 'CT Scan (Chest)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 95000, turnaroundHours: 24 },
  { name: 'CT Scan (Abdomen and Pelvis)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 110000, turnaroundHours: 24 },
  { name: 'CT Angiography', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 150000, turnaroundHours: 48 },
  { name: 'MRI (Lumbar Spine)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 150000, turnaroundHours: 48 },
  { name: 'MRI (Brain)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 180000, turnaroundHours: 48 },
  { name: 'Mammography', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 30000, turnaroundHours: 24 },
  { name: 'Doppler Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 30000, turnaroundHours: 24 },
  { name: 'Renal Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 12000, turnaroundHours: 4 },
  { name: 'Scrotal Ultrasound', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 15000, turnaroundHours: 6 },
  { name: 'Transvaginal Ultrasound', code: 'TVUS', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 15000, turnaroundHours: 6 },
  { name: 'X-Ray (Skeletal)', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 9000, turnaroundHours: 4 },
  { name: 'Fluoroscopy Study', testType: 'IMAGING', category: 'Radiology',
    resultKind: 'REPORT', price: 40000, turnaroundHours: 24 },
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
