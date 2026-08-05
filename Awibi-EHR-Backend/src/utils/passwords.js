const crypto = require('crypto');

function generateTemporaryPassword() {
  return `Aw!${crypto.randomBytes(12).toString('base64url')}9z`;
}

function isStrongPassword(password) {
  return typeof password === 'string'
    && password.length >= 12
    && /[a-z]/.test(password)
    && /[A-Z]/.test(password)
    && /\d/.test(password)
    && /[^A-Za-z0-9]/.test(password);
}

module.exports = { generateTemporaryPassword, isStrongPassword };
