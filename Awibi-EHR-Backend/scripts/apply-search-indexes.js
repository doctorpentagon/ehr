/**
 * Apply the pg_trgm search indexes that Prisma's schema language cannot express.
 * Idempotent — safe to run on every deploy.
 *
 * Run: node scripts/run-local.js scripts/apply-search-indexes.js
 */
const fs = require('fs');
const path = require('path');
const { prisma, connectDatabase } = require('../src/utils/database');

async function main() {
  await connectDatabase();
  const file = path.join(__dirname, '..', 'prisma', 'sql', 'patient-search-indexes.sql');
  const sql = fs.readFileSync(file, 'utf8');

  // Split on statement boundaries; $executeRawUnsafe runs one statement at a time.
  const statements = sql
    .split(';')
    .map((s) => s.replace(/--.*$/gm, '').trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
    console.log(`  ok: ${statement.split('\n')[0].slice(0, 70)}`);
  }
  console.log(`\n✅  ${statements.length} search index statements applied.`);
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
