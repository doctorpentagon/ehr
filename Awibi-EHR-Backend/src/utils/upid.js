const { prisma } = require('./database');

const CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I confusion

function generateUPID() {
  let id = 'AWB-';
  for (let i = 0; i < 8; i++) id += CHARS[Math.floor(Math.random() * CHARS.length)];
  return id;
}

async function ensureUniqueUPID() {
  let upid;
  do {
    upid = generateUPID();
    const exists = await prisma.patient.findUnique({ where: { universalPatientId: upid } });
    if (!exists) return upid;
  } while (true);
}

function generateStaffId(facilityCode = 'AWB') {
  const n = Math.floor(100000 + Math.random() * 900000);
  return `${facilityCode}-STF-${n}`;
}

module.exports = { generateUPID, ensureUniqueUPID, generateStaffId };
