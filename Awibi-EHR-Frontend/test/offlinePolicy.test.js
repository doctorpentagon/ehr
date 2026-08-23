import test from 'node:test';
import assert from 'node:assert/strict';
import {
  offlineOwnerKeyFromToken,
  entryBelongsToOwner,
  shouldDiscardAfterSyncFailure,
} from '../src/lib/offlinePolicy.js';

function fakeToken(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `header.${encoded}.signature`;
}

test('derives a queue owner from facility and user claims without retaining the token', () => {
  const key = offlineOwnerKeyFromToken(fakeToken({ facilityId: 'facility-a', userId: 'doctor-a' }));
  assert.equal(key, 'facility-a:doctor-a');
});

test('rejects malformed or unscoped tokens', () => {
  assert.equal(offlineOwnerKeyFromToken('not-a-jwt'), null);
  assert.equal(offlineOwnerKeyFromToken(fakeToken({ userId: 'doctor-a' })), null);
});

test('queued work can only replay for its original facility and user', () => {
  const entry = { ownerKey: 'facility-a:doctor-a' };
  assert.equal(entryBelongsToOwner(entry, 'facility-a:doctor-a'), true);
  assert.equal(entryBelongsToOwner(entry, 'facility-a:nurse-a'), false);
  assert.equal(entryBelongsToOwner(entry, 'facility-b:doctor-a'), false);
  assert.equal(entryBelongsToOwner({}, 'facility-a:doctor-a'), false);
});

test('discards permanent 4xx failures but retries network and server failures', () => {
  assert.equal(shouldDiscardAfterSyncFailure(400), true);
  assert.equal(shouldDiscardAfterSyncFailure(409), true);
  assert.equal(shouldDiscardAfterSyncFailure(500), false);
  assert.equal(shouldDiscardAfterSyncFailure(503), false);
  assert.equal(shouldDiscardAfterSyncFailure(undefined), false);
});
