/**
 * Idempotently add the Awibi platform SUPER_ADMIN to an already-seeded local
 * database, without the destructive re-seed that `seed:local:reset` performs.
 *
 * Run: node scripts/run-local.js scripts/add-local-superadmin.js
 */
const bcrypt = require('bcryptjs');
const { prisma, connectDatabase } = require('../src/utils/database');

async function main() {
  await connectDatabase();

  const password = process.env.DEMO_PASSWORD;
  const adminEmail = (process.env.DEMO_ADMIN_EMAIL || '').toLowerCase();
  if (!password || !adminEmail) {
    throw new Error('DEMO_PASSWORD and DEMO_ADMIN_EMAIL are required. Run via scripts/run-local.js.');
  }

  const email = (process.env.DEMO_SUPERADMIN_EMAIL || adminEmail.replace(/^admin\./, 'superadmin.')).toLowerCase();
  if (!email.endsWith('@local.awibi.test')) {
    throw new Error(`Refusing to create ${email}: local demo accounts must end with @local.awibi.test`);
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`✅  SUPER_ADMIN already present (${existing.role}). Nothing to do.`);
    return;
  }

  const facility = await prisma.facility.findFirst({ where: { name: 'UCH Ibadan Demo' } });
  if (!facility) throw new Error('UCH Ibadan Demo facility not found. Run npm run seed:local first.');

  const user = await prisma.user.create({
    data: {
      firstName: 'Awibi',
      lastName: 'Super Admin',
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: 'SUPER_ADMIN',
      facilityId: facility.id,
      staffId: 'AWB-OPS-000001',
      emailVerified: true,
      isActive: true,
      specialty: 'Platform Operations',
    },
  });

  console.log(`✅  Created SUPER_ADMIN "${user.firstName} ${user.lastName}" homed to ${facility.name}.`);
  console.log('    It will now appear in the local demo role picker.');
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
