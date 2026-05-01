// Hash-based router for top-level tabs.
//
// Routes are encoded in the URL hash so links like `#/dna` are shareable and
// the browser back/forward buttons work. The active tab is also stored in
// localStorage so a return visit lands on whichever tab was last open.

const STORAGE_KEY = 'ltg-tree:last-tab';
const TABS = ['tree', 'dna'];
const DEFAULT_TAB = 'tree';

const TITLES = {
  tree: 'LongTimeGenie Tree',
  dna: 'DNA Compare — LongTimeGenie',
};

export function initRouter() {
  const tabFromHash = parseTab(location.hash);
  const tabFromStorage = TABS.includes(localStorage.getItem(STORAGE_KEY))
    ? localStorage.getItem(STORAGE_KEY)
    : null;

  const initial = tabFromHash || tabFromStorage || DEFAULT_TAB;

  if (!tabFromHash) {
    history.replaceState(null, '', `#/${initial}`);
  }

  applyRoute(initial);

  window.addEventListener('hashchange', () => {
    applyRoute(parseTab(location.hash) || DEFAULT_TAB);
  });
}

function parseTab(hash) {
  const m = /^#\/(\w+)/.exec(hash || '');
  if (!m) return null;
  return TABS.includes(m[1]) ? m[1] : null;
}

function applyRoute(tab) {
  document.body.dataset.activeTab = tab;

  document.querySelectorAll('.app-tab').forEach((el) => {
    const isActive = el.dataset.tab === tab;
    el.classList.toggle('app-tab--active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
  });

  document.querySelectorAll('.page').forEach((el) => {
    el.hidden = el.dataset.page !== tab;
  });

  document.title = TITLES[tab] || TITLES[DEFAULT_TAB];

  try {
    localStorage.setItem(STORAGE_KEY, tab);
  } catch {
    // ignore — private mode etc.
  }
}
