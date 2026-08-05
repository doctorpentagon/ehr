/**
 * Bring subscription usage counters back in line with reality.
 *
 * `patientsUsed` and `staffUsed` were running totals kept by the API. Anything
 * that removed a record outside those routes — a migration, a cleanup, direct
 * database work — left the total too high, and a total that is too high refuses
 * registrations from a facility that is genuinely under its limit.
 *
 * The gates now count rows instead, so this only repairs what is displayed.
 * Safe to run repeatedly.
 */
const { PrismaClient } = require('@prisma/client');

const db = new PrismaClient();

(async () => {
  const subscriptions = await db.subscription.findMany({
    select: { facilityId: true, patientsUsed: true, staffUsed: true, patientLimit: true, staffLimit: true },
  });

  let repaired = 0;
  for (const sub of subscriptions) {
    const [patients, staff, facility] = await Promise.all([
      db.patient.count({ where: { facilityId: sub.facilityId, isArchived: false } }),
      db.user.count({ where: { facilityId: sub.facilityId, isActive: true } }),
      db.facility.findUnique({ where: { id: sub.facilityId }, select: { name: true } }),
    ]);

    if (sub.patientsUsed === patients && sub.staffUsed === staff) continue;

    await db.subscription.update({
      where: { facilityId: sub.facilityId },
      data: { patientsUsed: patients, staffUsed: staff },
    });
    console.log(`  ${facility?.name || sub.facilityId}: patients ${sub.patientsUsed} → ${patients}, staff ${sub.staffUsed} → ${staff}`);
    repaired += 1;
  }

  console.log(`\n${repaired} of ${subscriptions.length} subscription(s) corrected`);
  await db.$disconnect();
})();
