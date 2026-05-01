// Tiny promise-based wrapper around IndexedDB.
//
// We don't need the full feature surface of `idb` — we use only one
// database, a fixed schema we own, and small CRUD ops per object store.
// Keeping the wrapper local also avoids another dep + supply-chain
// surface for what's essentially 60 lines of code.

const DB_NAME = 'longtimegenie-tree';
const DB_VERSION = 2;

const SCHEMA = {
  // Keyed by workspace id ('default' for now; multi-workspace UI later).
  workspaces: { keyPath: 'id' },
  // One tree per workspace.
  trees: { keyPath: 'workspaceId' },
  // Multiple kits per workspace; indexed for quick lookup.
  kits: {
    keyPath: 'id',
    indexes: { byWorkspace: { keyPath: 'workspaceId', unique: false } },
  },
  // Notes keyed by [workspace, person] composite key.
  notes: {
    keyPath: ['workspaceId', 'personId'],
    indexes: { byWorkspace: { keyPath: 'workspaceId', unique: false } },
  },
  // App-level scalars (current workspace, etc.).
  app: { keyPath: 'key' },
  // Geocoder cache. Keyed by normalized place string. Survives across
  // workspaces — coordinates for "Detroit, MI" don't depend on whose
  // tree it's in.
  geocache: { keyPath: 'place' },
};

let dbPromise = null;

export function openDb() {
  if (!('indexedDB' in self)) {
    return Promise.reject(new Error('This browser does not support IndexedDB.'));
  }
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      for (const [name, def] of Object.entries(SCHEMA)) {
        const store = db.objectStoreNames.contains(name)
          ? req.transaction.objectStore(name)
          : db.createObjectStore(name, { keyPath: def.keyPath });
        if (def.indexes) {
          for (const [idxName, idxDef] of Object.entries(def.indexes)) {
            if (!store.indexNames.contains(idxName)) {
              store.createIndex(idxName, idxDef.keyPath, { unique: !!idxDef.unique });
            }
          }
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB open blocked by another tab.'));
  });
  return dbPromise;
}

export async function tx(storeNames, mode, fn) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    const stores = Array.isArray(storeNames)
      ? Object.fromEntries(storeNames.map((n) => [n, t.objectStore(n)]))
      : t.objectStore(storeNames);
    let result;
    try {
      result = fn(stores);
    } catch (err) {
      try { t.abort(); } catch {}
      return reject(err);
    }
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Transaction aborted.'));
  });
}

export function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function clearAllStores() {
  const names = Object.keys(SCHEMA);
  return tx(names, 'readwrite', (stores) => {
    for (const name of names) stores[name].clear();
  });
}
