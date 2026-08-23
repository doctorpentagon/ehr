import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAuthError } from '../src/lib/authErrors.js';

test('preserves structured API errors used by OTP and demo access flows', () => {
  const payload = { error: 'This demo needs an access code', code: 'DEMO_CODE_REQUIRED' };
  assert.deepEqual(normalizeAuthError({ response: { status: 401, data: payload } }), payload);
});

test('explains the Vite proxy 500 caused by an API that is not listening yet', () => {
  const result = normalizeAuthError({
    message: 'Request failed with status code 500',
    response: { status: 500, data: 'Proxy error: connect ECONNREFUSED ::1:8000' },
  });

  assert.equal(result.code, 'API_UNAVAILABLE');
  assert.match(result.error, /API is not ready/);
  assert.equal(result.status, 500);
});

test('distinguishes a real authentication-service 500 from invalid credentials', () => {
  const result = normalizeAuthError({
    message: 'Request failed with status code 500',
    response: { status: 500, data: '' },
  });

  assert.equal(result.code, 'AUTH_SERVICE_ERROR');
  assert.match(result.error, /HTTP 500/);
});

test('keeps ordinary authentication failures readable', () => {
  const result = normalizeAuthError({
    message: 'Request failed with status code 401',
    response: { status: 401, data: 'Invalid credentials' },
  });

  assert.deepEqual(result, { error: 'Invalid credentials', status: 401 });
});
