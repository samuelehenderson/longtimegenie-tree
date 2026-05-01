// Public storage API. Everything else in the app talks to this module
// rather than IndexedDB directly, so the underlying schema is free to
// evolve without callers caring.
//
// Persistence is best-effort: if the browser doesn't support IndexedDB,
// or quota is exhausted, calls fail silently (logged) and the app keeps
// running in memory-only mode. The user still has a working session;
// they just won't see it restored next time.
//
// Multi-workspace lands in a later PR. For now there's a single hardcoded
// 'default' workspace, but the schema and APIs already accept a workspace
// id throughout — so the multi-workspace UI is a small UI change later
// rather than a data migration.

import { tx, reqToPromise, clearAllStores } from './db.js';

const DEFAULT_WORKSPACE_ID = 'default';
const DEFAULT_WORKSPACE = {
  id: DEFAULT_WORKSPACE_ID,
  name: 'Default workspace',
  createdAt: 0,
  updatedAt: 0,
};

let supportedCache = null;

export function isStorageSupported() {
  if (supportedCache !== null) return supportedCache;
  supportedCache = typeof indexedDB !== 'undefined';
  return supportedCache;
}

// ---------- workspaces ----------

export async function getCurrentWorkspaceId() {
  if (!isStorageSupported()) return DEFAULT_WORKSPACE_ID;
  try {
    const row = await tx('app', 'readonly', (s) =>
      reqToPromise(s.get('currentWorkspaceId'))
    );
    return row?.value || DEFAULT_WORKSPACE_ID;
  } catch (err) {
    logErr('getCurrentWorkspaceId', err);
    return DEFAULT_WORKSPACE_ID;
  }
}

export async function ensureDefaultWorkspace() {
  if (!isStorageSupported()) return DEFAULT_WORKSPACE;
  try {
    return await tx(['workspaces', 'app'], 'readwrite', (stores) => {
      const wsReq = stores.workspaces.get(DEFAULT_WORKSPACE_ID);
      wsReq.onsuccess = () => {
        if (!wsReq.result) {
          const now = Date.now();
          stores.workspaces.put({
            ...DEFAULT_WORKSPACE,
            createdAt: now,
            updatedAt: now,
          });
        }
        const appReq = stores.app.get('currentWorkspaceId');
        appReq.onsuccess = () => {
          if (!appReq.result) {
            stores.app.put({ key: 'currentWorkspaceId', value: DEFAULT_WORKSPACE_ID });
          }
        };
      };
      return DEFAULT_WORKSPACE;
    });
  } catch (err) {
    logErr('ensureDefaultWorkspace', err);
    return DEFAULT_WORKSPACE;
  }
}

// ---------- tree (GEDCOM) ----------

export async function saveTree({ workspaceId, gedcomText, filename, sizeBytes, personCount }) {
  if (!isStorageSupported()) return;
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    await tx('trees', 'readwrite', (s) => {
      s.put({
        workspaceId: ws,
        gedcomText,
        filename,
        sizeBytes,
        personCount,
        importedAt: Date.now(),
      });
    });
  } catch (err) {
    logErr('saveTree', err);
  }
}

export async function loadTree(workspaceId) {
  if (!isStorageSupported()) return null;
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    return (await tx('trees', 'readonly', (s) => reqToPromise(s.get(ws)))) || null;
  } catch (err) {
    logErr('loadTree', err);
    return null;
  }
}

export async function clearTree(workspaceId) {
  if (!isStorageSupported()) return;
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    await tx('trees', 'readwrite', (s) => s.delete(ws));
  } catch (err) {
    logErr('clearTree', err);
  }
}

// ---------- kits (DNA) ----------

export async function saveKit({ workspaceId, slot, vendor, filename, kitText, summary, linkedPersonId }) {
  if (!isStorageSupported()) return null;
  const ws = workspaceId || await getCurrentWorkspaceId();
  const id = `${ws}:${slot}`;
  try {
    await tx('kits', 'readwrite', (s) => {
      s.put({
        id,
        workspaceId: ws,
        slot,
        vendor,
        filename,
        kitText,
        summary,
        linkedPersonId: linkedPersonId || null,
        importedAt: Date.now(),
      });
    });
    return id;
  } catch (err) {
    logErr('saveKit', err);
    return null;
  }
}

export async function setKitLink({ workspaceId, slot, linkedPersonId }) {
  if (!isStorageSupported()) return;
  const ws = workspaceId || await getCurrentWorkspaceId();
  const id = `${ws}:${slot}`;
  try {
    await tx('kits', 'readwrite', (s) => {
      const req = s.get(id);
      req.onsuccess = () => {
        const row = req.result;
        if (!row) return;
        s.put({ ...row, linkedPersonId: linkedPersonId || null });
      };
    });
  } catch (err) {
    logErr('setKitLink', err);
  }
}

export async function loadKitsForWorkspace(workspaceId) {
  if (!isStorageSupported()) return [];
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    return await tx('kits', 'readonly', (s) =>
      reqToPromise(s.index('byWorkspace').getAll(ws))
    );
  } catch (err) {
    logErr('loadKitsForWorkspace', err);
    return [];
  }
}

export async function clearKitForSlot(slot, workspaceId) {
  if (!isStorageSupported()) return;
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    await tx('kits', 'readwrite', (s) => s.delete(`${ws}:${slot}`));
  } catch (err) {
    logErr('clearKitForSlot', err);
  }
}

// ---------- notes (per person) ----------

export async function saveNote({ workspaceId, personId, text }) {
  if (!isStorageSupported()) return;
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    if (!text || !text.trim()) {
      await tx('notes', 'readwrite', (s) => s.delete([ws, personId]));
      return;
    }
    await tx('notes', 'readwrite', (s) => {
      s.put({
        workspaceId: ws,
        personId,
        text,
        updatedAt: Date.now(),
      });
    });
  } catch (err) {
    logErr('saveNote', err);
  }
}

export async function loadNotesForWorkspace(workspaceId) {
  if (!isStorageSupported()) return new Map();
  const ws = workspaceId || await getCurrentWorkspaceId();
  try {
    const rows = await tx('notes', 'readonly', (s) =>
      reqToPromise(s.index('byWorkspace').getAll(ws))
    );
    return new Map(rows.map((r) => [r.personId, r.text]));
  } catch (err) {
    logErr('loadNotesForWorkspace', err);
    return new Map();
  }
}

// ---------- geocache ----------

export async function getCachedGeocode(place) {
  if (!isStorageSupported()) return null;
  try {
    return (await tx('geocache', 'readonly', (s) => reqToPromise(s.get(place)))) || null;
  } catch (err) {
    logErr('getCachedGeocode', err);
    return null;
  }
}

export async function saveCachedGeocode(entry) {
  if (!isStorageSupported() || !entry?.place) return;
  try {
    await tx('geocache', 'readwrite', (s) => {
      s.put({ ...entry, lookedUpAt: Date.now() });
    });
  } catch (err) {
    logErr('saveCachedGeocode', err);
  }
}

// ---------- destructive ----------

export async function resetAllStorage() {
  if (!isStorageSupported()) return;
  try {
    await clearAllStores();
  } catch (err) {
    logErr('resetAllStorage', err);
  }
}

// ---------- utility ----------

function logErr(label, err) {
  console.warn(`[storage:${label}]`, err?.message || err);
}
