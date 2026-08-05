require('dotenv').config();

/**
 * Pin the clock to the hospital's timezone before anything constructs a Date.
 *
 * Every "today" figure in the system — doses given today, abnormal observations
 * today, today's bookings — is computed with setHours(0,0,0,0), which uses the
 * server's local timezone. Managed hosts default to UTC. Lagos is UTC+1, so on
 * an unpinned host the day rolls over at 01:00 local, and everything the night
 * shift charts between midnight and 1am is counted against the previous day.
 * That silently under-reports exactly the shift with the fewest staff to notice.
 *
 * TZ must be set before the first Date is created, which is why it is here at
 * the top of the entry point rather than in config.
 */
process.env.TZ = process.env.TZ || 'Africa/Lagos';

const { connectDatabase } = require('./utils/database');
const app = require('./app');

const PORT = process.env.PORT || 8000;

const DEV_SECRETS = ['awibi-secret', 'awibi-ehr-jwt-secret-change-in-production-2024', 'awibi-ehr-refresh-secret-change-in-production-2024'];
/**
 * Hosted demo mode.
 *
 * `LOCAL_DEMO_ACCESS` stays fatal in production — that guard exists so a laptop
 * .env file can never accidentally open a live hospital, and weakening it would
 * remove the protection for every future deployment.
 *
 * `DEMO_MODE` is a separate, deliberate decision taken per deployment. It opens
 * the passwordless role picker on a hosted environment so evaluators can try the
 * system. Anyone reaching the URL can enter as any role, so it is only ever
 * appropriate for an instance holding invented data.
 *
 * Two conditions must both hold, and the second cannot be set by accident:
 *   DEMO_MODE=true
 *   DEMO_MODE_ACKNOWLEDGED=i-understand-anyone-with-the-url-can-sign-in
 */
const DEMO_MODE = process.env.DEMO_MODE === 'true';
const DEMO_ACK = 'i-understand-anyone-with-the-url-can-sign-in';

if (process.env.NODE_ENV === 'production') {
  if (process.env.LOCAL_DEMO_ACCESS === 'true') {
    console.error('FATAL: LOCAL_DEMO_ACCESS must never be enabled in production.');
    console.error('       For a hosted demo use DEMO_MODE instead — see .env.example.');
    process.exit(1);
  }
  if (DEMO_MODE && process.env.DEMO_MODE_ACKNOWLEDGED !== DEMO_ACK) {
    console.error('FATAL: DEMO_MODE is on but has not been acknowledged.');
    console.error('       This opens passwordless sign-in to anyone who reaches this URL.');
    console.error(`       To proceed, set DEMO_MODE_ACKNOWLEDGED=${DEMO_ACK}`);
    process.exit(1);
  }
  if (DEMO_MODE) {
    // Printed on every boot, so nobody inherits this instance without knowing.
    console.warn('');
    console.warn('  ┌────────────────────────────────────────────────────────────┐');
    console.warn('  │  DEMO MODE — passwordless sign-in is OPEN                   │');
    console.warn('  │  Anyone with this URL can enter as any role in any facility │');
    console.warn('  │  Never point this instance at real patient data             │');
    console.warn('  └────────────────────────────────────────────────────────────┘');
    console.warn('');
  }
  if (!process.env.JWT_SECRET || DEV_SECRETS.includes(process.env.JWT_SECRET)) {
    console.error('FATAL: JWT_SECRET is not set or uses a development default. Set a strong secret before running in production.');
    process.exit(1);
  }
  if (!process.env.JWT_REFRESH_SECRET || DEV_SECRETS.includes(process.env.JWT_REFRESH_SECRET)) {
    console.error('FATAL: JWT_REFRESH_SECRET is not set or uses a development default.');
    process.exit(1);
  }
  if (!process.env.AWIBI_SHARED_SECRET || process.env.AWIBI_SHARED_SECRET === 'awibi-internal') {
    console.error('FATAL: AWIBI_SHARED_SECRET is missing or uses the development default.');
    process.exit(1);
  }
}

async function start() {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log('');
    console.log('╔═══════════════════════════════════════════╗');
    console.log('║       AwibiEHR Backend  v2.0              ║');
    console.log(`║   Running at http://localhost:${PORT}       ║`);
    console.log('║   API docs: http://localhost:' + PORT + '/api-docs  ║');
    console.log('╚═══════════════════════════════════════════╝');
    console.log('');
    console.log('💡  Local setup: run scripts/setup-local.ps1, then npm run seed:local');
  });
}

start().catch(err => { console.error('Startup failed:', err); process.exit(1); });
