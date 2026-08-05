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
if (process.env.NODE_ENV === 'production') {
  if (process.env.LOCAL_DEMO_ACCESS === 'true') {
    console.error('FATAL: LOCAL_DEMO_ACCESS must never be enabled in production.');
    process.exit(1);
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
