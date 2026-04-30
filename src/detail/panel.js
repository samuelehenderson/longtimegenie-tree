// Person detail panel — renders the focused person's facts, relationships,
// and source citations grouped by the event they're attached to.

import { lifespan, escapeHtml, eventLabel } from '../util/format.js';

export function renderPersonDetail({ container, model, focusId, onSelect }) {
  container.innerHTML = '';

  if (!focusId) {
    container.innerHTML = '<p class="detail-empty">Pick a person to see their details.</p>';
    return;
  }

  const person = model.byId.person.get(focusId);
  if (!person) {
    container.innerHTML = `<p class="detail-empty">No person with id ${escapeHtml(focusId)}.</p>`;
    return;
  }

  const parts = [];

  // ---- header ----
  parts.push(`
    <h3 class="detail-name">${escapeHtml(person.name) || '(unnamed)'}</h3>
    <p class="detail-id">${escapeHtml(person.id)} · ${escapeHtml(lifespan(person))}</p>
  `);

  // ---- vital facts ----
  parts.push(renderFacts(person));

  // ---- relations ----
  const relationsHtml = renderRelations(person, model);
  if (relationsHtml) parts.push(relationsHtml);

  // ---- citations ----
  const citationsHtml = renderCitations(person, model);
  if (citationsHtml) parts.push(citationsHtml);

  container.innerHTML = parts.join('');

  container.querySelectorAll('.relation-link').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      const id = el.dataset.id;
      if (id) onSelect?.(id);
    });
  });
}

function renderFacts(person) {
  const rows = [];
  if (person.sex)   rows.push(['Sex', person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : person.sex]);
  rows.push(['Born',  formatEvent(person.birth)]);
  rows.push(['Died',  formatEvent(person.death)]);

  return `
    <div class="detail-section">
      <p class="detail-section__title">Vital facts</p>
      ${rows.map(([k, v]) => `
        <div class="fact">
          <span class="fact__label">${escapeHtml(k)}</span>
          <span class="fact__value">${v}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function formatEvent(evt) {
  if (!evt || (!evt.date && !evt.place)) return '<span class="fact__place">—</span>';
  const date = evt.date ? `<strong>${escapeHtml(evt.date)}</strong>` : '';
  const place = evt.place ? `<span class="fact__place">${escapeHtml(evt.place)}</span>` : '';
  return `${date}${place}`;
}

function renderRelations(person, model) {
  const parentFamily = person.childOf[0] ? model.byId.family.get(person.childOf[0]) : null;
  const father = parentFamily ? model.byId.person.get(parentFamily.husbandId) : null;
  const mother = parentFamily ? model.byId.person.get(parentFamily.wifeId) : null;

  const spouseFamilies = person.families
    .map((fid) => model.byId.family.get(fid))
    .filter(Boolean);

  const spouses = spouseFamilies
    .map((f) => (f.husbandId === person.id) ? f.wifeId : f.husbandId)
    .map((id) => id ? model.byId.person.get(id) : null);

  const children = spouseFamilies.flatMap((f) => f.childIds.map((id) => model.byId.person.get(id))).filter(Boolean);

  const siblings = parentFamily
    ? parentFamily.childIds.filter((id) => id !== person.id).map((id) => model.byId.person.get(id)).filter(Boolean)
    : [];

  const sections = [];
  if (father || mother) {
    sections.push(['Parents', [father, mother].filter(Boolean)]);
  }
  if (siblings.length) sections.push(['Siblings', siblings]);
  if (spouses.length)  sections.push(['Spouse(s)', spouses.filter(Boolean)]);
  if (children.length) sections.push(['Children', children]);

  if (!sections.length) return '';

  return `
    <div class="detail-section">
      <p class="detail-section__title">Relations</p>
      ${sections.map(([title, list]) => `
        <div class="fact">
          <span class="fact__label">${escapeHtml(title)}</span>
          <span class="fact__value">${list.map(personChip).join(' ')}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function personChip(p) {
  if (!p) return '';
  return `<a href="#" class="relation-link" data-id="${escapeHtml(p.id)}">${escapeHtml(p.name) || '(unnamed)'}</a>`;
}

function renderCitations(person, model) {
  const items = collectCitations(person);
  if (items.length === 0) return '';

  return `
    <div class="detail-section">
      <p class="detail-section__title">Sources</p>
      ${items.map((c) => renderCitation(c, model)).join('')}
    </div>
  `;
}

function collectCitations(person) {
  const items = [];
  // event-level citations
  const pushEvent = (evt, tag) => {
    if (!evt?.citations) return;
    evt.citations.forEach((c) => items.push({ ...c, eventTag: tag, eventDate: evt.date }));
  };
  pushEvent(person.birth, 'BIRT');
  pushEvent(person.death, 'DEAT');
  (person.events || []).forEach((evt) => pushEvent(evt, evt.type));
  // citations attached directly to the INDI record
  (person.citations || []).forEach((c) => items.push({ ...c, eventTag: 'INDI' }));
  return items;
}

function renderCitation(c, model) {
  const source = c.sourceId ? model.byId.source.get(c.sourceId) : null;
  const title = source?.title || `Source ${c.sourceId || '(unknown)'}`;
  const author = source?.author;

  return `
    <div class="citation">
      <div class="citation__event">${escapeHtml(eventLabel(c.eventTag))}${c.eventDate ? ` · ${escapeHtml(c.eventDate)}` : ''}</div>
      <div class="citation__title">${escapeHtml(title)}</div>
      ${c.page    ? `<div class="citation__page">${escapeHtml(c.page)}</div>` : ''}
      ${author    ? `<div class="citation__author">${escapeHtml(author)}</div>` : ''}
    </div>
  `;
}
