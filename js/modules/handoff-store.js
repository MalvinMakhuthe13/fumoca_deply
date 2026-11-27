/**
 * Hand large binary results (e.g. a generated splat) from one FUMOCA page to
 * another without URLs or uploads: stored in IndexedDB under a one-time id,
 * read once by the receiving page and deleted.
 */
const DB = 'fumoca-handoff', STORE = 'items';

function open() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putHandoff(value) {
  const id = (crypto.randomUUID?.() || String(Date.now()) + Math.random().toString(16).slice(2));
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ ...value, createdAt: Date.now() }, id);
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
  });
  db.close();
  return id;
}

export async function takeHandoff(id) {
  if (!id || !/^[\w-]{6,64}$/.test(id)) return null;
  const db = await open();
  const value = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => { store.delete(id); resolve(get.result || null); };
    tx.onerror = () => reject(tx.error);
  });
  db.close();
  // Expire stale handoffs (older than a day).
  if (value && Date.now() - (value.createdAt || 0) > 86_400_000) return null;
  return value;
}
