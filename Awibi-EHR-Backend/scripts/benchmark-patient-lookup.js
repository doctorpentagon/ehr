/**
 * Benchmark the patient type-ahead lookup at realistic scale.
 *
 * Loads synthetic patients into the isolation test facility (which has none),
 * measures the lookup query, then removes every row it created. The demo
 * facility's data is never touched.
 *
 * Run: node scripts/run-local.js scripts/benchmark-patient-lookup.js [count]
 */
const { prisma, connectDatabase } = require('../src/utils/database');

const COUNT = Number(process.argv[2]) || 5000;
const MARKER = 'BENCH-';

const FIRST = ['Adebayo', 'Chiamaka', 'Emeka', 'Fatima', 'Gbenga', 'Halima', 'Ifeanyi', 'Jumoke',
  'Kelechi', 'Lateef', 'Maryam', 'Nneka', 'Olumide', 'Priscilla', 'Rasheed', 'Sade', 'Tunde',
  'Uche', 'Vivian', 'Yusuf', 'Zainab', 'Chinedu', 'Bola', 'Aisha'];
const LAST = ['Adegoke', 'Balogun', 'Chukwu', 'Danladi', 'Eze', 'Falana', 'Gbadamosi', 'Hassan',
  'Ibrahim', 'Jibril', 'Kalu', 'Lawal', 'Mohammed', 'Nwosu', 'Okafor', 'Popoola', 'Quadri',
  'Rufai', 'Sanni', 'Taiwo', 'Umar', 'Vaughan', 'Williams', 'Yakubu'];

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function upid(i) {
  let s = '';
  let n = i + 100000;
  for (let k = 0; k < 8; k += 1) { s += ALPHABET[n % ALPHABET.length]; n = Math.floor(n / ALPHABET.length) + k * 7; }
  return `BEN-${s}`;
}

async function timeIt(label, fn) {
  const runs = [];
  for (let i = 0; i < 5; i += 1) {
    const t0 = process.hrtime.bigint();
    const rows = await fn();
    const t1 = process.hrtime.bigint();
    runs.push(Number(t1 - t0) / 1e6);
    if (i === 0) console.log(`  ${label.padEnd(38)} ${rows.length} row(s)`);
  }
  runs.sort((a, b) => a - b);
  const median = runs[Math.floor(runs.length / 2)];
  console.log(`  ${''.padEnd(38)} median ${median.toFixed(1)} ms  (min ${runs[0].toFixed(1)}, max ${runs.at(-1).toFixed(1)})`);
  return median;
}

async function main() {
  await connectDatabase();

  const facility = await prisma.facility.findFirst({ where: { name: 'Awibi Isolation Test Facility' } });
  if (!facility) throw new Error('Isolation test facility not found. Run npm run seed:local first.');

  console.log(`Loading ${COUNT} synthetic patients into "${facility.name}"…`);
  const batch = [];
  for (let i = 0; i < COUNT; i += 1) {
    const first = FIRST[i % FIRST.length];
    const last = LAST[Math.floor(i / FIRST.length) % LAST.length];
    batch.push({
      facilityId: facility.id,
      universalPatientId: upid(i),
      mrn: `${MARKER}${String(i).padStart(6, '0')}`,
      firstName: first,
      lastName: `${last}${Math.floor(i / (FIRST.length * LAST.length))}`,
      phone: `080${String(10000000 + i).slice(0, 8)}`,
      gender: i % 2 ? 'FEMALE' : 'MALE',
      notes: MARKER,
    });
  }
  for (let i = 0; i < batch.length; i += 1000) {
    await prisma.patient.createMany({ data: batch.slice(i, i + 1000), skipDuplicates: true });
  }
  await prisma.$executeRawUnsafe('ANALYZE "Patient"');

  const total = await prisma.patient.count({ where: { facilityId: facility.id } });
  console.log(`Loaded. Facility now holds ${total} patients.\n`);

  const lookup = (term) => prisma.patient.findMany({
    where: {
      facilityId: facility.id, isArchived: false,
      OR: [
        { universalPatientId: { contains: term, mode: 'insensitive' } },
        { mrn: { contains: term, mode: 'insensitive' } },
        { phone: { contains: term, mode: 'insensitive' } },
        { firstName: { contains: term, mode: 'insensitive' } },
        { lastName: { contains: term, mode: 'insensitive' } },
      ],
    },
    take: 8,
    orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    select: { id: true, firstName: true, lastName: true, universalPatientId: true, mrn: true, phone: true },
  });

  console.log('Lookup timings (5 runs each, median reported):');
  const results = [];
  results.push(await timeIt('exact UPID', () => lookup(upid(4321))));
  results.push(await timeIt('exact MRN', () => lookup(`${MARKER}004321`)));
  results.push(await timeIt('phone fragment', () => lookup('08010004')));
  results.push(await timeIt('surname prefix "Okafor"', () => lookup('Okafor')));
  results.push(await timeIt('first name "Chiamaka"', () => lookup('Chiamaka')));
  results.push(await timeIt('short fragment "ade"', () => lookup('ade')));

  const worst = Math.max(...results);
  console.log(`\nWorst median: ${worst.toFixed(1)} ms across ${total} patients.`);
  console.log(worst < 500 ? '✅  Comfortably inside the 500 ms target.' : '⚠️   Above the 500 ms target — investigate.');

  console.log('\nCleaning up synthetic rows…');
  const removed = await prisma.patient.deleteMany({ where: { facilityId: facility.id, notes: MARKER } });
  await prisma.$executeRawUnsafe('ANALYZE "Patient"');
  console.log(`✅  Removed ${removed.count} synthetic patients. Demo data untouched.`);
}

main()
  .catch((err) => { console.error('❌ ', err.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
