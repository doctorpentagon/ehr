/**
 * Seed a starter drug formulary for local demo facilities. Idempotent.
 *
 * These are widely used medicines in Nigerian outpatient and ward practice.
 * Default doses are the common adult starting points and are only a
 * convenience — the prescriber sets the actual dose for each patient.
 *
 * Run: node scripts/run-local.js scripts/seed-drug-catalogue.js
 */
const { prisma, connectDatabase } = require('../src/utils/database');

const DRUGS = [
  // Antimalarials
  { name: 'Artemether/Lumefantrine', genericName: 'Artemether + Lumefantrine', form: 'Tablet', strength: '20/120mg', category: 'Antimalarial', defaultDose: '4 tablets', defaultFrequency: 'Twice daily', unitPrice: 150 },
  { name: 'Artesunate', form: 'Injection', strength: '60mg', category: 'Antimalarial', defaultRoute: 'IV', defaultDose: '2.4mg/kg', defaultFrequency: 'At 0, 12, 24 hours', unitPrice: 2500 },
  { name: 'Dihydroartemisinin/Piperaquine', form: 'Tablet', strength: '40/320mg', category: 'Antimalarial', defaultDose: '1 tablet', defaultFrequency: 'Daily', unitPrice: 200 },

  // Antibiotics
  { name: 'Amoxicillin', form: 'Capsule', strength: '500mg', category: 'Antibiotic', defaultDose: '500mg', defaultFrequency: 'Three times daily', unitPrice: 60 },
  { name: 'Amoxicillin/Clavulanate', form: 'Tablet', strength: '625mg', category: 'Antibiotic', defaultDose: '1 tablet', defaultFrequency: 'Twice daily', unitPrice: 250 },
  { name: 'Ceftriaxone', form: 'Injection', strength: '1g', category: 'Antibiotic', defaultRoute: 'IV', defaultDose: '1g', defaultFrequency: 'Twice daily', unitPrice: 1200 },
  { name: 'Ciprofloxacin', form: 'Tablet', strength: '500mg', category: 'Antibiotic', defaultDose: '500mg', defaultFrequency: 'Twice daily', unitPrice: 90 },
  { name: 'Metronidazole', form: 'Tablet', strength: '400mg', category: 'Antibiotic', defaultDose: '400mg', defaultFrequency: 'Three times daily', unitPrice: 40 },
  { name: 'Azithromycin', form: 'Tablet', strength: '500mg', category: 'Antibiotic', defaultDose: '500mg', defaultFrequency: 'Daily', unitPrice: 300 },

  // Analgesics / antipyretics
  { name: 'Paracetamol', genericName: 'Acetaminophen', form: 'Tablet', strength: '500mg', category: 'Analgesic', defaultDose: '1g', defaultFrequency: 'Three times daily', unitPrice: 20 },
  { name: 'Ibuprofen', form: 'Tablet', strength: '400mg', category: 'Analgesic', defaultDose: '400mg', defaultFrequency: 'Three times daily', unitPrice: 30 },
  { name: 'Diclofenac', form: 'Injection', strength: '75mg', category: 'Analgesic', defaultRoute: 'IM', defaultDose: '75mg', defaultFrequency: 'Twice daily', unitPrice: 250 },
  { name: 'Tramadol', form: 'Capsule', strength: '50mg', category: 'Analgesic', defaultDose: '50mg', defaultFrequency: 'Twice daily', unitPrice: 120, isControlled: true },
  { name: 'Morphine', form: 'Injection', strength: '10mg', category: 'Analgesic', defaultRoute: 'IV', defaultDose: '2.5-5mg', defaultFrequency: 'As required', unitPrice: 1500, isControlled: true },

  // Cardiovascular
  { name: 'Amlodipine', form: 'Tablet', strength: '5mg', category: 'Cardiovascular', defaultDose: '5mg', defaultFrequency: 'Daily', unitPrice: 50 },
  { name: 'Lisinopril', form: 'Tablet', strength: '10mg', category: 'Cardiovascular', defaultDose: '10mg', defaultFrequency: 'Daily', unitPrice: 70 },
  { name: 'Hydrochlorothiazide', form: 'Tablet', strength: '25mg', category: 'Cardiovascular', defaultDose: '25mg', defaultFrequency: 'Daily', unitPrice: 40 },
  { name: 'Furosemide', form: 'Injection', strength: '40mg', category: 'Cardiovascular', defaultRoute: 'IV', defaultDose: '40mg', defaultFrequency: 'Daily', unitPrice: 300 },
  { name: 'Atorvastatin', form: 'Tablet', strength: '20mg', category: 'Cardiovascular', defaultDose: '20mg', defaultFrequency: 'At night', unitPrice: 120 },

  // Endocrine
  { name: 'Metformin', form: 'Tablet', strength: '500mg', category: 'Endocrine', defaultDose: '500mg', defaultFrequency: 'Twice daily', unitPrice: 45 },
  { name: 'Glibenclamide', form: 'Tablet', strength: '5mg', category: 'Endocrine', defaultDose: '5mg', defaultFrequency: 'Daily', unitPrice: 35 },
  { name: 'Insulin (soluble)', form: 'Injection', strength: '100IU/ml', category: 'Endocrine', defaultRoute: 'SC', defaultDose: 'As charted', defaultFrequency: 'Three times daily', unitPrice: 3500 },

  // Gastrointestinal
  { name: 'Omeprazole', form: 'Capsule', strength: '20mg', category: 'Gastrointestinal', defaultDose: '20mg', defaultFrequency: 'Daily', unitPrice: 80 },
  { name: 'Metoclopramide', form: 'Injection', strength: '10mg', category: 'Gastrointestinal', defaultRoute: 'IV', defaultDose: '10mg', defaultFrequency: 'Three times daily', unitPrice: 200 },
  { name: 'ORS Sachet', genericName: 'Oral rehydration salts', form: 'Sachet', strength: 'Standard', category: 'Gastrointestinal', defaultDose: '1 sachet in 1L', defaultFrequency: 'As required', unitPrice: 100 },

  // Respiratory / allergy
  { name: 'Salbutamol', form: 'Inhaler', strength: '100mcg', category: 'Respiratory', defaultRoute: 'INHALATION', defaultDose: '2 puffs', defaultFrequency: 'As required', unitPrice: 2500 },
  { name: 'Chlorpheniramine', form: 'Tablet', strength: '4mg', category: 'Antihistamine', defaultDose: '4mg', defaultFrequency: 'At night', unitPrice: 20 },
  { name: 'Hydrocortisone', form: 'Injection', strength: '100mg', category: 'Steroid', defaultRoute: 'IV', defaultDose: '100mg', defaultFrequency: 'Three times daily', unitPrice: 800 },
  { name: 'Prednisolone', form: 'Tablet', strength: '5mg', category: 'Steroid', defaultDose: '30mg', defaultFrequency: 'Daily', unitPrice: 40 },

  // Emergency
  { name: 'Adrenaline', genericName: 'Epinephrine', form: 'Injection', strength: '1mg/ml', category: 'Emergency', defaultRoute: 'IM', defaultDose: '0.5mg', defaultFrequency: 'As required', unitPrice: 900 },
  { name: 'Calcium Gluconate', form: 'Injection', strength: '10%', category: 'Emergency', defaultRoute: 'IV', defaultDose: '10ml', defaultFrequency: 'As required', unitPrice: 700 },
  { name: 'Diazepam', form: 'Injection', strength: '10mg', category: 'Emergency', defaultRoute: 'IV', defaultDose: '10mg', defaultFrequency: 'As required', unitPrice: 500, isControlled: true },

  // Haematinics / obstetrics
  { name: 'Ferrous Sulphate', form: 'Tablet', strength: '200mg', category: 'Haematinic', defaultDose: '200mg', defaultFrequency: 'Twice daily', unitPrice: 25 },
  { name: 'Folic Acid', form: 'Tablet', strength: '5mg', category: 'Haematinic', defaultDose: '5mg', defaultFrequency: 'Daily', unitPrice: 15 },
  { name: 'Oxytocin', form: 'Injection', strength: '10IU', category: 'Obstetric', defaultRoute: 'IM', defaultDose: '10IU', defaultFrequency: 'Stat', unitPrice: 400 },

  // Fluids
  { name: 'Normal Saline 0.9%', form: 'Infusion', strength: '500ml', category: 'IV Fluid', defaultRoute: 'IV', defaultDose: '500ml', defaultFrequency: 'As charted', unitPrice: 600 },
  { name: 'Dextrose 5%', form: 'Infusion', strength: '500ml', category: 'IV Fluid', defaultRoute: 'IV', defaultDose: '500ml', defaultFrequency: 'As charted', unitPrice: 600 },
  { name: "Ringer's Lactate", form: 'Infusion', strength: '500ml', category: 'IV Fluid', defaultRoute: 'IV', defaultDose: '500ml', defaultFrequency: 'As charted', unitPrice: 700 },
];

async function main() {
  await connectDatabase();
  const facilities = await prisma.facility.findMany({ where: { isActive: true }, select: { id: true, name: true } });
  if (!facilities.length) throw new Error('No facilities found. Run npm run seed:local first.');

  let created = 0; let skipped = 0;
  for (const facility of facilities) {
    for (const d of DRUGS) {
      const existing = await prisma.drugCatalogue.findFirst({
        where: { facilityId: facility.id, name: d.name, strength: d.strength || null },
      });
      if (existing) { skipped += 1; continue; }
      await prisma.drugCatalogue.create({
        data: {
          facilityId: facility.id,
          name: d.name,
          genericName: d.genericName || null,
          form: d.form || null,
          strength: d.strength || null,
          defaultRoute: d.defaultRoute || 'ORAL',
          defaultDose: d.defaultDose || null,
          defaultFrequency: d.defaultFrequency || null,
          category: d.category || null,
          unitPrice: d.unitPrice ?? 0,
          isControlled: Boolean(d.isControlled),
        },
      });
      created += 1;
    }
    console.log(`  ${facility.name}: formulary ready`);
  }
  console.log(`\n✅  ${created} drugs created, ${skipped} already present, across ${facilities.length} facilities.`);
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
