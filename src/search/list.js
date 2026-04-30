// Person list with search filter. Renders rows for the current model and
// emits onSelect when a row is clicked. Supports rapid filter-as-you-type.

import { lifespan } from '../util/format.js';

export function initPersonList({ container, summary, searchInput, model, onSelect, getActiveId }) {
  const sorted = [...model.persons].sort(byNameThenId);
  let query = '';

  function filtered() {
    if (!query) return sorted;
    const q = query.toLowerCase();
    return sorted.filter((p) => p.name.toLowerCase().includes(q));
  }

  function render() {
    const list = filtered();
    summary.textContent = `${list.length} of ${sorted.length}`;
    if (list.length === 0) {
      container.innerHTML = '<p class="person-list__empty">No matches.</p>';
      return;
    }
    const activeId = getActiveId?.();
    const html = list.map((p) => {
      const cls = ['person-row'];
      if (p.id === activeId) cls.push('person-row--active');
      return `
        <div class="${cls.join(' ')}" data-id="${escapeAttr(p.id)}" role="option" tabindex="0">
          <span class="person-row__name">${escapeHtml(p.name) || '(unnamed)'}</span>
          <span class="person-row__dates">${escapeHtml(lifespan(p))}</span>
        </div>
      `;
    }).join('');
    container.innerHTML = html;
  }

  container.addEventListener('click', (e) => {
    const row = e.target.closest('.person-row');
    if (!row) return;
    onSelect(row.dataset.id);
  });

  container.addEventListener('keydown', (e) => {
    const row = e.target.closest('.person-row');
    if (!row) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(row.dataset.id);
    }
  });

  searchInput.addEventListener('input', (e) => {
    query = e.target.value.trim();
    render();
  });

  render();
  return { rerender: render };
}

function byNameThenId(a, b) {
  const sa = (a.surname || '').toLowerCase();
  const sb = (b.surname || '').toLowerCase();
  if (sa !== sb) return sa.localeCompare(sb);
  const ga = (a.given || a.name || '').toLowerCase();
  const gb = (b.given || b.name || '').toLowerCase();
  if (ga !== gb) return ga.localeCompare(gb);
  return a.id.localeCompare(b.id);
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}
