import React, { useState, useEffect, useCallback } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getCount } from '@/lib/offlineQueue';
import { syncOfflineQueue } from '@/lib/syncQueue';

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [showBack, setShowBack] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try { setPending(await getCount()); } catch (_) {}
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { synced, failed } = await syncOfflineQueue();
      await refreshCount();
      if (synced > 0) toast.success(`Synced ${synced} queued action${synced > 1 ? 's' : ''}.`);
      if (failed > 0) toast.warning(`${failed} action${failed > 1 ? 's' : ''} could not sync and were discarded.`);
    } catch (_) {
      toast.error('Sync failed — will retry on next reconnect.');
    } finally {
      setSyncing(false);
    }
  }, [syncing, refreshCount]);

  useEffect(() => {
    refreshCount();

    const goOnline = async () => {
      setOnline(true);
      setShowBack(true);
      setTimeout(() => setShowBack(false), 5000);
      await runSync();
    };
    const goOffline = () => { setOnline(false); setShowBack(false); refreshCount(); };

    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);

    // Listen for SW background-sync trigger
    const onMessage = (e) => { if (e.data?.type === 'SYNC_QUEUE') runSync(); };
    navigator.serviceWorker?.addEventListener('message', onMessage);

    // Refresh count every 30s while offline to reflect newly queued items
    const interval = setInterval(() => { if (!navigator.onLine) refreshCount(); }, 30000);

    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      navigator.serviceWorker?.removeEventListener('message', onMessage);
      clearInterval(interval);
    };
  }, []);

  if (online && !showBack && pending === 0) return null;

  return (
    <div
      className={`fixed top-0 inset-x-0 z-[100] flex items-center justify-center gap-2 py-2 px-4 text-sm font-medium transition-colors ${
        online ? 'bg-green-600 text-white' : 'bg-gray-900 text-white'
      }`}
    >
      {online ? <Wifi size={15} /> : <WifiOff size={15} />}

      {!online && (
        <span>
          You are offline.{pending > 0 ? ` ${pending} change${pending > 1 ? 's' : ''} queued.` : ' Changes will sync when reconnected.'}
        </span>
      )}

      {online && showBack && (
        <span>{syncing ? 'Syncing queued changes…' : `Back online${pending > 0 ? ` — ${pending} item${pending > 1 ? 's' : ''} remaining` : ' — all synced!'}`}</span>
      )}

      {online && !showBack && pending > 0 && (
        <span>{pending} queued change{pending > 1 ? 's' : ''} pending</span>
      )}

      {online && pending > 0 && !syncing && (
        <button
          onClick={runSync}
          className="ml-2 flex items-center gap-1 underline underline-offset-2 hover:opacity-80"
        >
          <RefreshCw size={13} /> Sync now
        </button>
      )}

      {syncing && <RefreshCw size={13} className="animate-spin ml-1" />}
    </div>
  );
}
