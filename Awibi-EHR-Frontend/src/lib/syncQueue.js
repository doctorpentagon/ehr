import axios from 'axios';
import { dequeueAll, deleteEntry } from './offlineQueue';

export async function syncOfflineQueue() {
  const entries = await dequeueAll();
  if (!entries.length) return { synced: 0, failed: 0 };

  const token = localStorage.getItem('accessToken');
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;

  let synced = 0;
  let failed = 0;

  for (const entry of entries) {
    try {
      await axios({
        method: entry.method,
        url: entry.url,
        data: entry.data,
        headers: { ...headers, ...entry.headers },
      });
      await deleteEntry(entry.id);
      synced++;
    } catch (err) {
      if (err.response) {
        // Server rejected it (4xx/5xx) — won't succeed on retry, discard
        await deleteEntry(entry.id);
        failed++;
      }
      // Network error — leave in queue for next sync attempt
    }
  }

  return { synced, failed };
}
