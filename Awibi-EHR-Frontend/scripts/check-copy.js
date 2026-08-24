import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || 'src');
const blocked = [
  'operational workflow',
  'durable alert',
  'structured result',
  'ai is structuring',
  'ai draft ready',
  'clinical-ai service',
  'snapshotted at order time',
  'silently alter',
  'production rollout',
];

function filesIn(folder) {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(folder, entry.name);
    if (entry.isDirectory()) return filesIn(full);
    return /\.(jsx|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const problems = [];
for (const file of filesIn(root)) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  lines.forEach((line, index) => {
    const lower = line.toLowerCase();
    blocked.forEach((phrase) => {
      if (lower.includes(phrase)) problems.push(`${path.relative(process.cwd(), file)}:${index + 1} uses “${phrase}”`);
    });
  });
}

if (problems.length) {
  console.error('Interface copy needs review:\n' + problems.map((item) => `  - ${item}`).join('\n'));
  process.exit(1);
}

console.log('  copy OK — no blocked interface phrases');
