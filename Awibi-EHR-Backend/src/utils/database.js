const { PrismaClient } = require('@prisma/client');

// Singleton pattern — prevents multiple client instances in development (nodemon restarts)
const prisma = global._prisma || new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
});

if (process.env.NODE_ENV !== 'production') {
  global._prisma = prisma;
}

async function connectDatabase() {
  try {
    await prisma.$connect();
    console.log('✅  PostgreSQL connected through Prisma');
  } catch (err) {
    console.error('❌  Database connection failed:', err.message);
    if (process.env.NODE_ENV === 'production') process.exit(1);
    else console.warn('⚠️   Running without database — check DATABASE_URL in .env');
  }
}

async function disconnectDatabase() {
  await prisma.$disconnect();
}

module.exports = { prisma, connectDatabase, disconnectDatabase };
