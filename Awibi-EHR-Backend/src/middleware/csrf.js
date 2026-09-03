const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Paths that authenticate by their own signed payload, not the auth cookie, so
// the double-submit check does not apply. Paystack webhooks carry an
// HMAC-SHA512 signature over the raw body and never present a browser cookie.
// /auth/refresh is authenticated by the signed refresh-token cookie and only
// rotates tokens back into the caller's own browser, so a forged refresh gains
// an attacker nothing; the SPA also calls it without the CSRF header.
const CSRF_EXEMPT_PREFIXES = [
  '/v1/billing/paystack-webhook',
  '/v1/paystack/webhook',
  '/v1/auth/refresh',
];

// Double-submit CSRF guard. A cross-site sameSite=none auth cookie is attached
// by the browser automatically, so a state-changing request must also echo the
// non-httpOnly csrfToken cookie in a header. Same-origin policy stops an
// attacker page from reading our cookie, so it cannot forge the header.
//
// A request authenticated purely by an Authorization: Bearer header (an API
// client that never sends our cookie) is not vulnerable to CSRF and is allowed
// through: the browser never auto-attaches a Bearer header.
function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();

  const path = req.originalUrl.split('?')[0];
  if (CSRF_EXEMPT_PREFIXES.some((prefix) => path.startsWith(prefix))) return next();

  const cookieToken = req.cookies?.csrfToken;
  // No auth cookie present means this is not a cookie-authenticated browser
  // session (e.g. a Bearer API client, or a public unauthenticated route).
  // There is no cookie for an attacker to ride, so no CSRF check is needed.
  if (!req.cookies?.accessToken) return next();

  const headerToken = req.headers['x-csrf-token'];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF token missing or invalid', code: 'CSRF_FAILED' });
  }
  return next();
}

module.exports = { requireCsrf };
