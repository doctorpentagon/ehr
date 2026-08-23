const DB_NAME = 'awibi-offline';
const STORE = 'queue';
const VERSION = 1;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = (e) => {
      e.target.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = () => reject(req.error);
  });
}

export async function enqueue(entry) {
  const db = await openDB();
  const result = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).add({ ...entry, timestamp: Date.now(), attempts: 0 });
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });

  // Reconnect events remain the universal sync path. Supporting Android
  // browsers also get a background-sync attempt when the tab is not active.
  try {
    const registration = await navigator.serviceWorker?.ready;
    await registration?.sync?.register('awibi-sync');
  } catch (_) { /* reconnect handling still flushes the queue */ }

  return result;
}

export async function dequeueAll() {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteEntry(id) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}

export async function getCount(ownerKey) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(
      ownerKey ? req.result.filter((entry) => entry.ownerKey === ownerKey).length : req.result.length,
    );
    req.onerror = () => reject(req.error);
  });
}
