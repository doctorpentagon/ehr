/**
 * Give an MRN to any permanent patient that lacks one.
 *
 * Online bookings used to create a patient without an MRN, so a real person
 * could arrive at the desk and reception could not pull their chart by the
 * number they were quoting. The creation path is fixed; this repairs the records
 * already in the database.
 *
 * Emergency intake shells are deliberately skipped: an unidentified arrival is
 * referenced by their universal patient ID until they are identified and merged
 * into a permanent record, and issuing chart numbers to shells that will be
 * archived only burns numbers.
 *
 * Safe to run repeatedly.
 */
const { PrismaClient } = require('@prisma/client');
const { allocateMrn } = require('../src/utils/patientValidation');

const db = new PrismaClient();

(async () => {
  const missing = await db.patient.findMany({
    where: { mrn: null, isEmergencyTemp: false },
    select: { id: true, firstName: true, lastName: true, facilityId: true, entryMode: true },
  });

  if (missing.length === 0) {
    console.log('Every permanent patient already has an MRN.');
    await db.$disconnect();
    return;
  }

  for (const patient of missing) {
    // One transaction each so the per-facility lock is held only briefly.
    const mrn = await db.$transaction(async (tx) => {
      const allocated = await allocateMrn(tx, patient.facilityId);
      await tx.patient.update({ where: { id: patient.id }, data: { mrn: allocated } });
      return allocated;
    });
    console.log(`  ${patient.firstName} ${patient.lastName} (${patient.entryMode || 'unknown source'}) -> ${mrn}`);
  }

  const remaining = await db.patient.count({ where: { mrn: null, isEmergencyTemp: false } });
  console.log(`\n${missing.length} patient(s) given an MRN. Still missing: ${remaining}`);
  await db.$disconnect();
})();
