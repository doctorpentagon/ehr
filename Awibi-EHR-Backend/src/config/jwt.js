const { randomBytes } = require('node:crypto');

// Local/test processes still need a key when no .env has been created yet.
// Generate it per process instead of shipping a reusable secret in source.
// Production never reaches this fallback: server.js validates the environment
// before loading the Express application, and direct production imports fail.
const runtimeAccessSecret = randomBytes(48).toString('base64url');
const runtimeRefreshSecret = randomBytes(48).toString('base64url');

function secret(name, fallback) {
  if (process.env[name]) return process.env[name];
  if (process.env.NODE_ENV === 'production') {
    throw new Error(`${name} is required in production`);
  }
  return fallback;
}

const JWT_SECRET = secret('JWT_SECRET', runtimeAccessSecret);
const JWT_REFRESH_SECRET = secret('JWT_REFRESH_SECRET', runtimeRefreshSecret);

module.exports = { JWT_SECRET, JWT_REFRESH_SECRET };
