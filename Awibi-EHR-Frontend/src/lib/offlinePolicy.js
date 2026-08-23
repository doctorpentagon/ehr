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

export function currentOfflineOwnerKey() {
  return offlineOwnerKeyFromToken(localStorage.getItem('accessToken'));
}

export function entryBelongsToOwner(entry, ownerKey) {
  return Boolean(ownerKey && entry?.ownerKey && entry.ownerKey === ownerKey);
}

/** Only a client error is permanent. Server and network failures must retry. */
export function shouldDiscardAfterSyncFailure(status) {
  const numeric = Number(status);
  return numeric >= 400 && numeric < 500;
}
