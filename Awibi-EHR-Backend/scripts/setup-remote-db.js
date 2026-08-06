/**
 * Prepare a hosted database: create the tables, then load the demo data.
 *
 * Render's Shell tab is a paid feature, so on the free tier there is no way to
 * run a command inside the service. This runs the same two steps from your own
 * machine against the hosted database instead.
 *
 * Usage — paste the EXTERNAL database URL, not the internal one. The internal
 * URL only resolves inside Render's network:
 *
 *   node scripts/setup-remote-db.js "postgresql://user:pass@host/db"
 *
 * Safe to stop and re-run: it checks what is already there before seeding, so
 * it will not create a second set of demo patients.
 */
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const url = process.argv[2] || process.env.REMOTE_DATABASE_URL;

if (!url) {
  console.error('\nGive me the External Database URL from your Render Postgres page:\n');
  console.error('  node scripts/setup-remote-db.js "postgresql://user:pass@host.oregon-postgres.render.com/dbname"\n');
  process.exit(1);
}

if (!/^postgres(ql)?:\/\//.test(url)) {
  console.error('\nThat does not look like a PostgreSQL connection string.');
  console.error('It should start with postgresql:// and come from the "External Database URL" field.\n');
  process.exit(1);
}

// Render's internal hostname has no dots and is unreachable from outside.
if (!/@[^/]*\./.test(url)) {
  console.error('\nThat is the INTERNAL database URL — it only works inside Render.');
  console.error('On your Postgres page, copy the "External Database URL" instead.\n');
  process.exit(1);
}

const masked = url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:****@');

/**
 * The seed needs the demo fixture credentials, which live in `.env.local` and
 * are normally injected by scripts/run-local.js. That launcher is not involved
 * here, so read them directly — otherwise the seed stops with a list of missing
 * variables that looks alarming but only means "run me through the launcher".
 */
const fs = require('fs');
const path = require('path');

function readEnvFile(name) {
  const file = path.join(__dirname, '..', name);
  if (!fs.existsSync(file)) return {};
  return Object.fromEntries(
    fs.readFileSync(file, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && line.includes('='))
      .map((line) => {
        const at = line.indexOf('=');
        return [line.slice(0, at).trim(), line.slice(at + 1).trim().replace(/^["']|["']$/g, '')];
      }),
  );
}

const local = { ...readEnvFile('.env'), ...readEnvFile('.env.local') };
const DEMO_VARS = [
  'DEMO_PASSWORD', 'DEMO_ADMIN_EMAIL', 'DEMO_DOCTOR_EMAIL',
  'DEMO_NURSE_EMAIL', 'DEMO_RECORDS_EMAIL', 'DEMO_LAB_EMAIL',
  'DEMO_SUPERADMIN_EMAIL', 'DEMO_ISOLATION_ADMIN_EMAIL',
];
const demoEnv = Object.fromEntries(
  DEMO_VARS.filter((k) => local[k] || process.env[k]).map((k) => [k, process.env[k] || local[k]]),
);

const missing = DEMO_VARS.slice(0, 6).filter((k) => !demoEnv[k]);
if (missing.length) {
  console.error(`\nMissing demo fixture settings: ${missing.join(', ')}`);
  console.error('These normally live in Awibi-EHR-Backend/.env.local\n');
  process.exit(1);
}

const env = { ...process.env, ...demoEnv, DATABASE_URL: url, DIRECT_URL: url };

(async () => {
  console.log(`\nTarget: ${masked}\n`);

  console.log('1/3  Creating tables…');
  try {
    execSync('npx prisma db push --skip-generate --accept-data-loss', { env, stdio: 'inherit' });
  } catch {
    console.error('\nCould not create the tables. Usual causes:');
    console.error('  · the URL is the Internal one rather than the External one');
    console.error('  · the database is still provisioning — wait for "Available" on Render\n');
    process.exit(1);
  }

  console.log('\n2/3  Checking what is already there…');
  const db = new PrismaClient({ datasources: { db: { url } } });
  const [users, patients] = await Promise.all([db.user.count(), db.patient.count()]);
  console.log(`     ${users} staff, ${patients} patients`);

  if (users > 0) {
    // Seeding twice would fail on unique constraints, or worse, half-succeed.
    console.log('\n3/3  Already populated — skipping the seed.');
    console.log('     To start over: add --reset to the seed and run it deliberately.\n');
  } else {
    console.log('\n3/3  Loading demo data…');
    await db.$disconnect();
    try {
      execSync('node src/seeds/demo.js', { env, stdio: 'inherit' });
    } catch {
      console.error('\nSeeding failed. The tables exist, so you can re-run just the seed.\n');
      process.exit(1);
    }
  }

  const check = new PrismaClient({ datasources: { db: { url } } });
  const demoAccounts = await check.user.count({
    where: { email: { endsWith: '@local.awibi.test' } },
  });
  const facilities = await check.facility.count();
  await check.$disconnect();

  console.log('\n─────────────────────────────────────────────');
  console.log(`  ${facilities} facilities, ${demoAccounts} demo sign-in accounts`);
  console.log('─────────────────────────────────────────────');
  console.log('\nCheck it worked:');
  console.log('  https://<your-service>.onrender.com/v1/auth/local-demo-accounts');
  console.log('\nThat should now list accounts instead of returning an error.\n');
})();
