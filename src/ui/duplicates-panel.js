// Duplicates panel — runs the duplicate finder on the current model and
// renders pair cards. Each pair shows both candidates side-by-side with
// the reasons the algorithm flagged them. Clicking a person re-focuses
// the tree on that person and closes the panel.
//
// The panel intentionally surfaces possibilities only — it doesn't
// merge, edit, or modify the GEDCOM. Merging is destructive and a
// separate workflow.

import { findDuplicates } from '../tree/duplicates.js';
import { lifespan } from '../util/format.js';

const CONFIDENCE_LABELS = {
  'very-high': 'Very likely',
  'high':      'Likely',
  'possible':  'Possible',
  'low':       'Low',
};

export function initDuplicatesPanel({ openBtn, closeBtn, panel, summary, list, getModel, onSelectPerson }) {
  if (!openBtn || !panel) return;

  openBtn.addEventListener('click', async () => {
    const model = getModel?.();
    if (!model) return;
    panel.hidden = false;
    summary.textContent = 'Scanning…';
    list.innerHTML = '';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

    // Yield so the "Scanning…" text actually paints before we lock the
    // main thread on a large O(N²) sweep.
    await new Promise((r) => setTimeout(r, 30));

    const t0 = performance.now();
    const pairs = findDuplicates(model);
    const elapsed = Math.round(performance.now() - t0);

    if (pairs.length === 0) {
      summary.textContent = `No likely duplicates found across ${model.persons.length.toLocaleString()} people. (${elapsed} ms)`;
      list.innerHTML = '<p class="duplicates__empty">Nothing flagged. If you suspect duplicates, the threshold may be too strict.</p>';
      return;
    }

    summary.textContent = `${pairs.length} pair${pairs.length === 1 ? '' : 's'} flagged across ${model.persons.length.toLocaleString()} people. (${elapsed} ms)`;
    renderPairs(pairs, model, list, onSelectPerson, () => { panel.hidden = true; });
  });

  closeBtn?.addEventListener('click', () => {
    panel.hidden = true;
  });
}

function renderPairs(pairs, model, list, onSelectPerson, closePanel) {
  list.innerHTML = '';
  for (const pair of pairs) {
    const a = model.byId.person.get(pair.idA);
    const b = model.byId.person.get(pair.idB);
    if (!a || !b) continue;

    const card = document.createElement('div');
    card.className = `dup-pair dup-pair--${pair.confidence}`;
    card.innerHTML = `
      <div class="dup-pair__head">
        <span class="dup-pair__confidence">${CONFIDENCE_LABELS[pair.confidence] || pair.confidence}</span>
        <span class="dup-pair__score">${(pair.score * 100).toFixed(0)}%</span>
      </div>
      <div class="dup-pair__people">
        <button type="button" class="dup-person" data-id="${escapeAttr(a.id)}">
          <span class="dup-person__name">${escapeHtml(a.name) || '(unnamed)'}</span>
          <span class="dup-person__dates">${escapeHtml(lifespan(a))}</span>
          <span class="dup-person__id">${escapeHtml(a.id)}</span>
        </button>
        <span class="dup-pair__vs" aria-hidden="true">↔</span>
        <button type="button" class="dup-person" data-id="${escapeAttr(b.id)}">
          <span class="dup-person__name">${escapeHtml(b.name) || '(unnamed)'}</span>
          <span class="dup-person__dates">${escapeHtml(lifespan(b))}</span>
          <span class="dup-person__id">${escapeHtml(b.id)}</span>
        </button>
      </div>
      <ul class="dup-pair__reasons">
        ${pair.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('')}
      </ul>
    `;
    card.querySelectorAll('.dup-person').forEach((btn) => {
      btn.addEventListener('click', () => {
        onSelectPerson?.(btn.dataset.id);
        closePanel();
      });
    });
    list.appendChild(card);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}
