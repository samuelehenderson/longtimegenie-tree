// Timeline view — every person plotted as a bar from birth → death on a
// shared time axis. Sorted by birth year. People without a birth date are
// hidden (a small footer notes how many).
//
// Click a row to set focus (updates the detail panel + highlights the bar).

import { escapeHtml, extractYear } from '../util/format.js';

const NOW = new Date().getFullYear();
const ASSUMED_LIFESPAN = 100;

export function renderTimeline({ container, model, focusId, onSelect }) {
  // Preserve scroll position across re-renders so clicking a row doesn't jump.
  const prevScrollTop = container.querySelector('.timeline__rows')?.scrollTop || 0;

  container.innerHTML = '';

  const enriched = model.persons
    .map((p) => ({
      person: p,
      birthYear: yearFrom(p.birth),
      deathYear: yearFrom(p.death)
    }))
    .filter((x) => x.birthYear !== null);

  const missing = model.persons.length - enriched.length;

  if (enriched.length === 0) {
    container.innerHTML = `
      <div class="timeline">
        <p class="timeline__empty">No birth dates available to plot.</p>
      </div>
    `;
    return;
  }

  enriched.sort((a, b) => a.birthYear - b.birthYear || a.person.name.localeCompare(b.person.name));

  // Compute year range, rounded to clean decade boundaries.
  let rawMin = Math.min(...enriched.map((x) => x.birthYear));
  let rawMax = Math.max(...enriched.map((x) => x.deathYear ?? Math.min(NOW, x.birthYear + ASSUMED_LIFESPAN)));
  const minYear = Math.floor(rawMin / 10) * 10;
  const maxYear = Math.ceil(rawMax / 10) * 10;
  const span = Math.max(maxYear - minYear, 10);

  const tickStep = chooseTickStep(span);
  const ticks = [];
  for (let y = minYear; y <= maxYear; y += tickStep) ticks.push(y);

  const ticksHtml = ticks.map((y) => {
    const left = ((y - minYear) / span) * 100;
    return `<span class="timeline__tick" style="left: ${left}%">${y}</span>`;
  }).join('');

  const rowsHtml = enriched.map(({ person, birthYear, deathYear }) => {
    const hasRecordedDeath = !!deathYear;
    const isLiving = !hasRecordedDeath && (NOW - birthYear) < ASSUMED_LIFESPAN;
    const barEnd = hasRecordedDeath ? deathYear : (isLiving ? NOW : birthYear + ASSUMED_LIFESPAN);

    const left  = ((birthYear - minYear) / span) * 100;
    const width = Math.max(((barEnd - birthYear) / span) * 100, 0.4);

    const sexClass = person.sex === 'M' ? 'timeline__bar--male'
      : person.sex === 'F' ? 'timeline__bar--female'
      : 'timeline__bar--unknown';

    const barClasses = ['timeline__bar', sexClass];
    if (person.id === focusId) barClasses.push('timeline__bar--focus');
    if (isLiving) barClasses.push('timeline__bar--living');

    const rowFocusClass = (person.id === focusId) ? ' timeline__row--focus' : '';
    const rangeLabel = `${birthYear}\u2013${hasRecordedDeath ? deathYear : (isLiving ? '…' : '?')}`;

    return `
      <div class="timeline__row${rowFocusClass}" data-id="${escapeHtml(person.id)}" tabindex="0"
           title="${escapeHtml(person.name)} (${rangeLabel})">
        <span class="timeline__row-name">${escapeHtml(person.name) || '(unnamed)'}</span>
        <div class="timeline__row-track">
          <div class="${barClasses.join(' ')}" style="left: ${left}%; width: ${width}%"></div>
        </div>
      </div>
    `;
  }).join('');

  const missingHtml = missing > 0
    ? `<p class="timeline__missing">${missing} ${missing === 1 ? 'person' : 'people'} hidden — no birth date on record.</p>`
    : '';

  container.innerHTML = `
    <div class="timeline">
      <div class="timeline__axis">
        <div class="timeline__axis-spacer"></div>
        <div class="timeline__axis-ticks">${ticksHtml}</div>
      </div>
      <div class="timeline__rows">${rowsHtml}</div>
      ${missingHtml}
    </div>
  `;

  const rowsEl = container.querySelector('.timeline__rows');
  if (rowsEl) {
    rowsEl.scrollTop = prevScrollTop;
    rowsEl.addEventListener('click', (e) => {
      const row = e.target.closest('.timeline__row');
      if (row?.dataset.id) onSelect?.(row.dataset.id);
    });
    rowsEl.addEventListener('keydown', (e) => {
      const row = e.target.closest('.timeline__row');
      if (!row) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect?.(row.dataset.id);
      }
    });
  }
}

function yearFrom(evt) {
  if (!evt?.date) return null;
  const y = extractYear(evt.date);
  return y ? Number(y) : null;
}

function chooseTickStep(span) {
  if (span <= 60)  return 10;
  if (span <= 140) return 20;
  if (span <= 300) return 50;
  return 100;
}
