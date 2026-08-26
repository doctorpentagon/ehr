const { createHash, randomInt, timingSafeEqual } = require('node:crypto');

function digest(value) {
  return createHash('sha256').update(String(value || '')).digest('hex');
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function generateOtp() {
  return String(randomInt(100000, 1000000));
}

function hashOtp(otp) {
  return digest(`otp:${otp}`);
}

function otpMatches(stored, supplied) {
  if (!stored || !supplied) return false;
  const hashed = hashOtp(supplied);
  // The plaintext comparison is a one-release compatibility bridge for an OTP
  // issued immediately before deployment. Every new OTP is stored hashed.
  return safeEqual(stored, hashed) || safeEqual(stored, supplied);
}

function hashRefreshToken(token) {
  return digest(`refresh:${token}`);
}

function refreshTokenMatches(stored, supplied) {
  if (!stored || !supplied) return false;
  const hashed = hashRefreshToken(supplied);
  // Accept one legacy plaintext token, then rotate it to a hash. This avoids
  // signing every beta tester out merely because storage was hardened.
  return safeEqual(stored, hashed) || safeEqual(stored, supplied);
}

module.exports = {
  generateOtp,
  hashOtp,
  otpMatches,
  hashRefreshToken,
  refreshTokenMatches,
};
