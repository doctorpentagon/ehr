/** Decode only the non-secret JWT claims needed to keep an offline queue scoped. */
export function offlineOwnerKeyFromToken(token) {
  try {
    const encoded = String(token || '').split('.')[1];
    if (!encoded) return null;
    const padded = encoded.replace(/-/g, '+').replace(/_/g, '/')
      .padEnd(Math.ceil(encoded.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded));
    if (!payload?.userId || !payload?.facilityId) return null;
    return `${payload.facilityId}:${payload.userId}`;
  } catch {
    return null;
  }
}

/**
 * Owner key from the authenticated user object.
 *
 * The access token is now an httpOnly cookie JS cannot read, so the offline
 * queue can no longer derive its owner from the token. It comes from the user
 * hydrated into Redux by /auth/me instead. Same shape: `facilityId:userId`.
 */
export function offlineOwnerKeyFromUser(user) {
  if (!user?.id || !user?.facilityId) return null;
  return `${user.facilityId}:${user.id}`;
}

export function currentOfflineOwnerKey() {
  // The token is now an httpOnly cookie JS cannot read. redux-persist writes
  // the authenticated user under localStorage['persist:auth'] (key 'auth',
  // 'user' whitelisted), so derive the owner from there — it survives reloads
  // the same way the persisted token used to.
  try {
    const root = JSON.parse(localStorage.getItem('persist:auth') || '{}');
    const user = root.user ? JSON.parse(root.user) : null;
    return offlineOwnerKeyFromUser(user);
  } catch {
    return null;
  }
}

export function entryBelongsToOwner(entry, ownerKey) {
  return Boolean(ownerKey && entry?.ownerKey && entry.ownerKey === ownerKey);
}

/** Only a client error is permanent. Server and network failures must retry. */
export function shouldDiscardAfterSyncFailure(status) {
  const numeric = Number(status);
  return numeric >= 400 && numeric < 500;
}
