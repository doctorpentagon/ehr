const path = require('path');
const { spawn } = require('child_process');
const dotenv = require('dotenv');

const projectRoot = path.resolve(__dirname, '..');
const localEnv = path.join(projectRoot, '.env.local');
const result = dotenv.config({ path: localEnv, override: true });

if (result.error) {
  console.error('Missing .env.local. Run ..\\scripts\\setup-local.ps1 first.');
  process.exit(1);
}

// This flag is intentionally injected only by the local launcher. The normal
// server entry point (including production deployments) never enables demo
// impersonation, even if a developer happens to use development NODE_ENV.
process.env.LOCAL_DEMO_ACCESS = 'true';

const target = process.argv[2];
const args = process.argv.slice(3);
if (!target) {
  console.error('Usage: node scripts/run-local.js <node-script> [...args]');
  process.exit(1);
}

const child = spawn(process.execPath, [path.resolve(projectRoot, target), ...args], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 1);
});
