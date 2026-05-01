// Shared accessor for the currently-loaded GEDCOM model.
//
// The Tree tab loads and owns the model; the DNA tab needs read-only
// access to look up linked persons by id, populate the link picker, and
// compute genealogical relationships. A bare module-level singleton with
// pub/sub is plenty — there's only one model at a time, and it changes
// rarely (on tree load / clear).

let model = null;
const listeners = new Set();

export function setTreeModel(m) {
  model = m || null;
  for (const cb of listeners) {
    try { cb(model); } catch (err) { console.error('[tree-model listener]', err); }
  }
}

export function getTreeModel() {
  return model;
}

export function onTreeModelChange(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}
