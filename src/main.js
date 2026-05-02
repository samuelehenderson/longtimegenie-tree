import { parseGedcom } from './gedcom/parser.js';
import { initImporter } from './ui/importer.js';
import { initPersonList } from './search/list.js';
import { renderTree } from './tree/render.js';
import { renderTimeline } from './timeline/render.js';
import { renderPersonDetail } from './detail/panel.js';
import { registerServiceWorker } from './util/pwa.js';
import { initInstallPrompt } from './util/install.js';
import { initRouter } from './util/router.js';
import { initDnaPage } from './dna/page.js';
import {
  ensureDefaultWorkspace,
  saveTree,
  loadTree,
  clearTree,
  loadNotesForWorkspace,
  saveNote,
} from './storage/index.js';
import { setTreeModel } from './state/tree-model.js';
import { initDuplicatesPanel } from './ui/duplicates-panel.js';
import { exportTreeAsPng, suggestedTreeFilename } from './ui/tree-export.js';
import { initMapPanel } from './map/page.js';
import { exportPersonReport } from './ui/report.js';

registerServiceWorker();
initInstallPrompt();
initRouter();
ensureDefaultWorkspace();
initDnaPage();

// ---------- DOM refs ----------
const dropzone   = document.getElementById('dropzone');
const fileInput  = document.getElementById('file-input');
const status     = document.getElementById('status');
const importer   = document.getElementById('importer');
const workspace  = document.getElementById('workspace');
const headerActions = document.getElementById('header-actions');
const loadedPill = document.getElementById('loaded-pill');
const btnReload  = document.getElementById('btn-reload');
const btnToggleJson = document.getElementById('btn-toggle-json');
const btnExportImage = document.getElementById('btn-export-image');
const btnExportPdf   = document.getElementById('btn-export-pdf');

const personListEl = document.getElementById('person-list');
const listSummary  = document.getElementById('list-summary');
const searchInput  = document.getElementById('search-input');
const viewCanvas   = document.getElementById('view-canvas');
const viewHint     = document.getElementById('view-hint');
const viewToggleBtns = document.querySelectorAll('.view-toggle__btn');
const detailContent = document.getElementById('detail-content');

const output    = document.getElementById('output');
const summary   = document.getElementById('summary');
const jsonView  = document.getElementById('json-view');

// ---------- state ----------
let model = null;
let focusId = null;
let listApi = null;
let currentView = 'tree';
let notesMap = new Map();

const VIEW_HINTS = {
  tree:     'Click any person to re-center the tree.',
  timeline: 'Bars span birth → death. Click a row to update the details.'
};

viewToggleBtns.forEach((btn) => {
  btn.addEventListener('click', () => setView(btn.dataset.view));
});

function setView(view) {
  if (view !== 'tree' && view !== 'timeline') return;
  currentView = view;
  viewToggleBtns.forEach((b) => b.classList.toggle('view-toggle__btn--active', b.dataset.view === view));
  viewHint.textContent = VIEW_HINTS[view];
  viewCanvas.classList.toggle('view-canvas--timeline', view === 'timeline');
  renderCurrentView();
}

// ---------- importer ----------
initImporter({
  dropzone,
  fileInput,
  status,
  onLoad: ({ text, file }) => {
    let parsed;
    try {
      parsed = parseGedcom(text);
    } catch (err) {
      status.textContent = `Parse error: ${err.message}`;
      status.classList.add('status--error');
      return;
    }
    loadModel(parsed, file);
    // Persist the raw GEDCOM so the next session restores it. Best-effort.
    saveTree({
      gedcomText: text,
      filename: file?.name || 'tree.ged',
      sizeBytes: file?.size || text.length,
      personCount: parsed.persons.length,
    });
  },
  onError: (err) => console.error(err)
});

btnReload?.addEventListener('click', () => {
  importer.hidden = false;
  workspace.hidden = true;
  output.hidden = true;
  headerActions.hidden = true;
  status.textContent = '';
  status.classList.remove('status--ok', 'status--error');
  fileInput.value = '';
  importer.scrollIntoView({ behavior: 'smooth' });
  clearTree();
  setTreeModel(null);
});

btnToggleJson?.addEventListener('click', () => {
  output.hidden = !output.hidden;
  btnToggleJson.textContent = output.hidden ? 'Show raw JSON' : 'Hide raw JSON';
  if (!output.hidden) output.scrollIntoView({ behavior: 'smooth' });
});

btnExportPdf?.addEventListener('click', async () => {
  if (!model || !focusId) return;
  const original = btnExportPdf.textContent;
  btnExportPdf.disabled = true;
  btnExportPdf.textContent = 'Building PDF…';
  try {
    await exportPersonReport({
      container: document.getElementById('report-stage'),
      model,
      focusId,
      notesMap,
    });
    btnExportPdf.textContent = 'Saved ✓';
    setTimeout(() => { btnExportPdf.textContent = original; }, 1400);
  } catch (err) {
    console.error('[pdf-report]', err);
    btnExportPdf.textContent = 'Save failed';
    setTimeout(() => { btnExportPdf.textContent = original; }, 2000);
  } finally {
    btnExportPdf.disabled = false;
  }
});

btnExportImage?.addEventListener('click', async () => {
  if (!model || !viewCanvas) return;
  const original = btnExportImage.textContent;
  btnExportImage.disabled = true;
  btnExportImage.textContent = 'Saving…';
  try {
    const focusPerson = focusId ? model.byId.person.get(focusId) : null;
    const filename = suggestedTreeFilename(focusPerson?.name);
    await exportTreeAsPng(viewCanvas, filename, {
      focusName: focusPerson?.name,
      sourceLabel: currentView === 'timeline' ? 'Timeline view' : 'Tree view',
    });
    btnExportImage.textContent = 'Saved ✓';
    setTimeout(() => { btnExportImage.textContent = original; }, 1400);
  } catch (err) {
    console.error('[tree-export]', err);
    btnExportImage.textContent = 'Save failed';
    setTimeout(() => { btnExportImage.textContent = original; }, 2000);
  } finally {
    btnExportImage.disabled = false;
  }
});

initDuplicatesPanel({
  openBtn:  document.getElementById('btn-find-duplicates'),
  closeBtn: document.getElementById('btn-close-duplicates'),
  panel:    document.getElementById('duplicates'),
  summary:  document.getElementById('duplicates-summary'),
  list:     document.getElementById('duplicates-list'),
  getModel: () => model,
  onSelectPerson: setFocus,
});

initMapPanel({
  openBtn:  document.getElementById('btn-show-map'),
  closeBtn: document.getElementById('btn-close-map'),
  panel:    document.getElementById('map-panel'),
  getModel: () => model,
  onSelectPerson: setFocus,
});

// ---------- model loaded ----------
async function loadModel(parsed, file) {
  try {
    model = parsed;

    // Show workspace, hide importer
    importer.hidden = true;
    workspace.hidden = false;
    headerActions.hidden = false;
    loadedPill.textContent = file
      ? `${file.name} · ${parsed.persons.length} people`
      : `${parsed.persons.length} people`;

    // Pre-populate the JSON view (kept hidden until requested)
    populateJsonView(parsed);

    // Load any saved per-person notes for this workspace.
    // Notes load is best-effort — if IndexedDB hangs or rejects, fall
    // back to an empty map so the list / detail rendering still runs.
    notesMap = await loadNotesSafely();

    // Initialize the person list with search
    listApi = initPersonList({
      container: personListEl,
      summary: listSummary,
      searchInput,
      model: parsed,
      onSelect: setFocus,
      getActiveId: () => focusId,
      notes: notesMap,
    });

    // Pick a sensible initial focus: first person sorted by surname
    const initial = chooseInitialFocus(parsed);
    setFocus(initial);

    // Make the tree available to other tabs (DNA linking, etc.).
    setTreeModel(parsed);
  } catch (err) {
    console.error('[loadModel] failed:', err);
    if (status) {
      status.textContent = `Couldn't render the tree: ${err?.message || err}. Check the browser console for details.`;
      status.classList.add('status--error');
    }
  }
}

async function loadNotesSafely() {
  // Race the IDB call against a 4 s timeout. If something has the DB
  // wedged (very rare — hung upgrade, tab-blocked, etc.) we still want
  // the rest of the UI to render rather than hang on a black detail
  // panel forever.
  try {
    return await Promise.race([
      loadNotesForWorkspace(),
      new Promise((resolve) => setTimeout(() => {
        console.warn('[notes] load timed out after 4s — continuing without notes.');
        resolve(new Map());
      }, 4000)),
    ]);
  } catch (err) {
    console.warn('[notes] load failed:', err);
    return new Map();
  }
}

function chooseInitialFocus(m) {
  if (!m.persons.length) return null;
  // Prefer a person with both spouse + children, else any with a spouse,
  // else first person alphabetically.
  const withFamily = m.persons.find((p) => {
    const fams = p.families.map((id) => m.byId.family.get(id)).filter(Boolean);
    return fams.some((f) => f.childIds?.length > 0);
  });
  if (withFamily) return withFamily.id;
  const withSpouse = m.persons.find((p) => p.families.length > 0);
  return (withSpouse || m.persons[0]).id;
}

function setFocus(id) {
  if (!model) return;
  focusId = id;
  renderCurrentView();
  renderPersonDetail({
    container: detailContent,
    model,
    focusId,
    onSelect: setFocus,
    notes: notesMap,
    onNoteChange: handleNoteChange,
  });
  listApi?.rerender();
}

async function handleNoteChange(personId, text) {
  const had = notesMap.has(personId);
  if (text && text.trim()) {
    notesMap.set(personId, text);
  } else {
    notesMap.delete(personId);
  }
  // The list's dot indicator only flips when notes appear or disappear;
  // re-render only on those transitions to avoid churn on every keystroke.
  const has = notesMap.has(personId);
  if (had !== has) listApi?.rerender();
  await saveNote({ personId, text });
}

function renderCurrentView() {
  if (!model) return;
  if (currentView === 'timeline') {
    renderTimeline({ container: viewCanvas, model, focusId, onSelect: setFocus });
  } else {
    renderTree({ container: viewCanvas, model, focusId, onSelect: setFocus });
  }
}

function populateJsonView(parsed) {
  const counts = [
    ['persons',  parsed.persons.length],
    ['families', parsed.families.length],
    ['sources',  parsed.sources.length]
  ];
  summary.innerHTML = counts.map(([label, n]) =>
    `<span class="summary__chip">${n} ${label}</span>`
  ).join('');

  const stripRaw = ({ raw, ...rest }) => rest;
  const display = {
    header: parsed.header,
    persons:  parsed.persons.map(stripRaw),
    families: parsed.families.map(stripRaw),
    sources:  parsed.sources.map(stripRaw)
  };
  jsonView.textContent = JSON.stringify(display, null, 2);
}

// ---------- restore previous session ----------
restoreTreeFromStorage();

async function restoreTreeFromStorage() {
  const saved = await loadTree();
  if (!saved?.gedcomText) return;
  try {
    const parsed = parseGedcom(saved.gedcomText);
    loadModel(parsed, { name: saved.filename, size: saved.sizeBytes });
    status.textContent = `Restored ${saved.filename} from your last session.`;
    status.classList.add('status--ok');
  } catch (err) {
    console.warn('[restore] failed to re-parse stored GEDCOM:', err);
    clearTree();
  }
}
