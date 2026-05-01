import { parseGedcom } from './gedcom/parser.js';
import { initImporter } from './ui/importer.js';
import { initPersonList } from './search/list.js';
import { renderTree } from './tree/render.js';
import { renderTimeline } from './timeline/render.js';
import { renderPersonDetail } from './detail/panel.js';
import { registerServiceWorker } from './util/pwa.js';

registerServiceWorker();

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
});

btnToggleJson?.addEventListener('click', () => {
  output.hidden = !output.hidden;
  btnToggleJson.textContent = output.hidden ? 'Show raw JSON' : 'Hide raw JSON';
  if (!output.hidden) output.scrollIntoView({ behavior: 'smooth' });
});

// ---------- model loaded ----------
function loadModel(parsed, file) {
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

  // Initialize the person list with search
  listApi = initPersonList({
    container: personListEl,
    summary: listSummary,
    searchInput,
    model: parsed,
    onSelect: setFocus,
    getActiveId: () => focusId
  });

  // Pick a sensible initial focus: first person sorted by surname
  const initial = chooseInitialFocus(parsed);
  setFocus(initial);
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
  renderPersonDetail({ container: detailContent, model, focusId, onSelect: setFocus });
  listApi?.rerender();
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
