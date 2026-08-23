import { dequeueAll, deleteEntry } from './offlineQueue';
import api from './api';
import {
  currentOfflineOwnerKey,
  entryBelongsToOwner,
  shouldDiscardAfterSyncFailure,
} from './offlinePolicy';

export async function syncOfflineQueue() {
  const entries = await dequeueAll();
  if (!entries.length) return { synced: 0, failed: 0 };

  const ownerKey = currentOfflineOwnerKey();
  if (!ownerKey) return { synced: 0, failed: 0 };

  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    // Never replay one clinician's or facility's work in another session.
    // Leave it queued so it can sync if the original user signs back in.
    if (!entryBelongsToOwner(entry, ownerKey)) continue;

    try {
      // The shared client resolves `/cases` to `/v1/cases` locally and to the
      // configured backend in production. Its request interceptor adds the
      // current token; queued credentials are intentionally never retained.
      await api({
        method: entry.method,
        url: entry.url,
        data: entry.data,
      });
      await deleteEntry(entry.id);
      synced++;
    } catch (err) {
      if (shouldDiscardAfterSyncFailure(err.response?.status)) {
        // A 4xx is tied to the queued action and cannot heal by retrying.
        await deleteEntry(entry.id);
        failed++;
      }
      // Network and 5xx failures stay queued for the next reconnect.
    }
  }

  return { synced, failed };
}
