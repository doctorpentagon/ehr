require('dotenv').config({ path: require('path').join(__dirname, '../.env') });
const { prisma, connectDatabase } = require('../src/utils/database');
const { seedShowcases } = require('../src/seeds/showcase');

async function main() {
  await connectDatabase();
  const facilities = await prisma.facility.findMany({
    where: {
      OR: [
        { name: { contains: 'Demo', mode: 'insensitive' } },
        { name: { contains: 'Test', mode: 'insensitive' } },
        { users: { some: { email: { endsWith: '@local.awibi.test' } } } },
      ],
    },
    orderBy: { createdAt: 'asc' },
  });
  if (!facilities.length) throw new Error('No local demo or test facility was found. Run the normal demo seed first.');
  const results = await seedShowcases(prisma, facilities);
  console.log(`Showcase data ready in ${results.length} facilit${results.length === 1 ? 'y' : 'ies'}.`);
  results.forEach(result => console.log(`- ${result.facility}: ${result.healthId}`));
}

main()
  .catch(error => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
