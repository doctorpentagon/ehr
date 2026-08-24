import React, { useState, useEffect, useCallback } from 'react';
import { WifiOff, Wifi, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { getCount } from '@/lib/offlineQueue';
import { syncOfflineQueue } from '@/lib/syncQueue';
import { currentOfflineOwnerKey } from '@/lib/offlinePolicy';

export default function OfflineBanner() {
  const [online, setOnline] = useState(navigator.onLine);
  const [showBack, setShowBack] = useState(false);
  const [pending, setPending] = useState(0);
  const [syncing, setSyncing] = useState(false);

  const refreshCount = useCallback(async () => {
    try { setPending(await getCount(currentOfflineOwnerKey())); } catch (_) {}
  }, []);

  const runSync = useCallback(async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const { synced, failed } = await syncOfflineQueue();
      await refreshCount();
      if (synced > 0) toast.success(`${synced} saved change${synced > 1 ? 's' : ''} sent.`);
      if (failed > 0) toast.warning(`${failed} change${failed > 1 ? 's' : ''} could not be sent and ${failed > 1 ? 'were' : 'was'} removed from the queue.`);
    } catch (_) {
      toast.error('Could not send saved changes. The app will try again when the connection returns.');
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
    const onMessage = (e) => { if (e.data?.type === 'awibi-flush-queue') runSync(); };
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
          No internet.{pending > 0 ? ` ${pending} change${pending > 1 ? 's' : ''} waiting to be sent.` : ' New changes will be sent when the connection returns.'}
        </span>
      )}

      {online && showBack && (
        <span>{syncing ? 'Sending saved changes…' : `Internet is back${pending > 0 ? ` — ${pending} change${pending > 1 ? 's' : ''} left` : ' — all changes sent'}`}</span>
      )}

      {online && !showBack && pending > 0 && (
        <span>{pending} saved change{pending > 1 ? 's' : ''} waiting</span>
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
