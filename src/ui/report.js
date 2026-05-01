// PDF research report exporter.
//
// Builds a print-formatted single-column dossier on the focused person:
// header, vitals, relations, chronological event timeline, sources, and
// research notes — then hands the rendered HTML to html2pdf.js, which
// rasterizes it to a US Letter PDF and saves to the user's downloads.
//
// Notes live in main.js and are passed in so we don't double-source the
// same data layer. Output filename matches the image-export convention.

// `html2pdf.js` is hefty (~140 KB gzipped). We import it dynamically so
// the rest of the app stays lean — the dependency is only fetched the
// first time the user clicks the PDF button.
import { lifespan, escapeHtml, eventLabel } from '../util/format.js';

export async function exportPersonReport({ container, model, focusId, notesMap }) {
  if (!container) throw new Error('exportPersonReport: missing container.');
  if (!model || !focusId) throw new Error('Load a tree and pick a person first.');
  const person = model.byId.person.get(focusId);
  if (!person) throw new Error('Unknown person.');

  container.innerHTML = renderReport(person, model, notesMap);
  const filename = suggestedReportFilename(person.name);

  // html2pdf reads the live element, so the container must be rendered
  // (not display:none). Off-canvas via absolute positioning is the
  // standard workaround.
  container.classList.add('report--rendering');
  try {
    const { default: html2pdf } = await import('html2pdf.js');
    await html2pdf()
      .from(container)
      .set({
        filename,
        margin: [12, 12, 14, 12],   // mm: top, right, bottom, left
        image: { type: 'jpeg', quality: 0.96 },
        html2canvas: {
          scale: 2,
          backgroundColor: '#ffffff',
          useCORS: true,
        },
        jsPDF: {
          unit: 'mm',
          format: 'letter',
          orientation: 'portrait',
        },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .save();
  } finally {
    container.classList.remove('report--rendering');
    container.innerHTML = '';
  }

  return filename;
}

function renderReport(person, model, notesMap) {
  const note = notesMap?.get(person.id) || '';
  const today = new Date().toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  return `
    <div class="report__page">
      ${renderHeader(person, today)}
      ${renderVitals(person)}
      ${renderRelations(person, model)}
      ${renderTimeline(person, model)}
      ${renderSources(person, model)}
      ${renderNotes(note)}
      ${renderFooter(today)}
    </div>
  `;
}

function renderHeader(person, today) {
  return `
    <header class="report__header">
      <div class="report__brand">
        <span class="report__mark">𓊝</span>
        <div>
          <div class="report__brand-name">LongTimeGenie Tree</div>
          <div class="report__brand-tag">Research Report</div>
        </div>
      </div>
      <div class="report__meta">
        <div>${escapeHtml(today)}</div>
      </div>
    </header>

    <h1 class="report__name">${escapeHtml(person.name) || '(unnamed)'}</h1>
    <p class="report__lifespan">${escapeHtml(lifespan(person))}${person.id ? ` · <span class="report__id">${escapeHtml(person.id)}</span>` : ''}</p>
  `;
}

function renderVitals(person) {
  const rows = [];
  if (person.sex) rows.push(['Sex', person.sex === 'M' ? 'Male' : person.sex === 'F' ? 'Female' : person.sex]);
  rows.push(['Born', formatEvent(person.birth)]);
  rows.push(['Died', formatEvent(person.death)]);

  return `
    <section class="report__section">
      <h2>Vital facts</h2>
      <dl class="report__facts">
        ${rows.map(([k, v]) => `
          <div class="report__fact">
            <dt>${escapeHtml(k)}</dt>
            <dd>${v}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `;
}

function formatEvent(evt) {
  if (!evt || (!evt.date && !evt.place)) return '<span class="report__missing">—</span>';
  const date  = evt.date  ? `<strong>${escapeHtml(evt.date)}</strong>` : '';
  const place = evt.place ? `<span class="report__place">${date ? ' · ' : ''}${escapeHtml(evt.place)}</span>` : '';
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
    .map((id) => id ? model.byId.person.get(id) : null)
    .filter(Boolean);

  const children = spouseFamilies
    .flatMap((f) => f.childIds.map((id) => model.byId.person.get(id)))
    .filter(Boolean);

  const siblings = parentFamily
    ? parentFamily.childIds.filter((id) => id !== person.id).map((id) => model.byId.person.get(id)).filter(Boolean)
    : [];

  const sections = [];
  if (father || mother) sections.push(['Parents', [father, mother].filter(Boolean)]);
  if (siblings.length)  sections.push(['Siblings', siblings]);
  if (spouses.length)   sections.push(['Spouse(s)', spouses]);
  if (children.length)  sections.push(['Children', children]);

  if (!sections.length) return '';

  return `
    <section class="report__section">
      <h2>Relations</h2>
      <dl class="report__facts">
        ${sections.map(([title, list]) => `
          <div class="report__fact">
            <dt>${escapeHtml(title)}</dt>
            <dd>${list.map((p) => `
              <div class="report__person-line">
                <span class="report__person-name">${escapeHtml(p.name) || '(unnamed)'}</span>
                <span class="report__person-dates">${escapeHtml(lifespan(p))}</span>
              </div>
            `).join('')}</dd>
          </div>
        `).join('')}
      </dl>
    </section>
  `;
}

function renderTimeline(person, model) {
  const items = collectTimeline(person, model);
  if (items.length === 0) return '';

  return `
    <section class="report__section">
      <h2>Timeline</h2>
      <ol class="report__timeline">
        ${items.map((it) => `
          <li>
            <span class="report__timeline-date">${escapeHtml(it.date || 'Unknown date')}</span>
            <span class="report__timeline-content">
              <strong>${escapeHtml(it.label)}</strong>${it.place ? ` · ${escapeHtml(it.place)}` : ''}
              ${it.note ? `<div class="report__timeline-note">${escapeHtml(it.note)}</div>` : ''}
            </span>
          </li>
        `).join('')}
      </ol>
    </section>
  `;
}

function collectTimeline(person, model) {
  const items = [];
  if (person.birth?.date || person.birth?.place) {
    items.push({ label: 'Born', date: person.birth.date, place: person.birth.place });
  }
  if (person.death?.date || person.death?.place) {
    items.push({ label: 'Died', date: person.death.date, place: person.death.place });
  }
  for (const evt of person.events || []) {
    if (!evt.date && !evt.place) continue;
    items.push({
      label: evt.label || eventLabel(evt.type) || evt.type || 'Event',
      date: evt.date,
      place: evt.place,
      note: evt.note,
    });
  }
  for (const famId of person.families || []) {
    const fam = model.byId.family.get(famId);
    if (!fam?.marriage) continue;
    const spouseId = fam.husbandId === person.id ? fam.wifeId : fam.husbandId;
    const spouse = spouseId ? model.byId.person.get(spouseId) : null;
    const label = spouse ? `Married ${spouse.name}` : 'Married';
    items.push({ label, date: fam.marriage.date, place: fam.marriage.place });
  }

  return items.sort((a, b) => parseYear(a.date) - parseYear(b.date));
}

function parseYear(date) {
  const m = /\b(\d{4})\b/.exec(date || '');
  return m ? +m[1] : 9999;
}

function renderSources(person, model) {
  const citations = collectCitations(person);
  if (citations.length === 0) return '';

  // Dedupe by sourceId, but keep all event references.
  const grouped = new Map();
  for (const c of citations) {
    const key = c.sourceId || 'unsourced';
    if (!grouped.has(key)) grouped.set(key, { sourceId: c.sourceId, refs: [] });
    grouped.get(key).refs.push(c);
  }

  return `
    <section class="report__section">
      <h2>Sources</h2>
      <ol class="report__sources">
        ${[...grouped.values()].map((g) => {
          const source = g.sourceId ? model.byId.source.get(g.sourceId) : null;
          const title  = source?.title || `Source ${g.sourceId || '(unknown)'}`;
          const author = source?.author;
          const pub    = source?.publication;
          const refsHtml = g.refs.map((r) => `
            <li class="report__source-ref">
              <span class="report__source-event">${escapeHtml(eventLabel(r.eventTag))}${r.eventDate ? ` · ${escapeHtml(r.eventDate)}` : ''}</span>
              ${r.page ? `<span class="report__source-page">${escapeHtml(r.page)}</span>` : ''}
            </li>
          `).join('');
          return `
            <li class="report__source">
              <div class="report__source-title">${escapeHtml(title)}</div>
              ${author ? `<div class="report__source-author">${escapeHtml(author)}</div>` : ''}
              ${pub    ? `<div class="report__source-pub">${escapeHtml(pub)}</div>`       : ''}
              <ul class="report__source-refs">${refsHtml}</ul>
            </li>
          `;
        }).join('')}
      </ol>
    </section>
  `;
}

function collectCitations(person) {
  const items = [];
  const pushEvent = (evt, tag) => {
    if (!evt?.citations) return;
    evt.citations.forEach((c) => items.push({ ...c, eventTag: tag, eventDate: evt.date }));
  };
  pushEvent(person.birth, 'BIRT');
  pushEvent(person.death, 'DEAT');
  (person.events || []).forEach((evt) => pushEvent(evt, evt.type));
  (person.citations || []).forEach((c) => items.push({ ...c, eventTag: 'INDI' }));
  return items;
}

function renderNotes(note) {
  if (!note || !note.trim()) return '';
  return `
    <section class="report__section">
      <h2>Research notes</h2>
      <div class="report__notes">${escapeHtml(note).replace(/\n/g, '<br>')}</div>
    </section>
  `;
}

function renderFooter(today) {
  return `
    <footer class="report__footer">
      <div>LongTimeGenie Tree · tree.longtimegenie.com</div>
      <div>${escapeHtml(today)}</div>
    </footer>
  `;
}

function suggestedReportFilename(personName) {
  const stamp = new Date().toISOString().slice(0, 10);
  const slug = (personName || 'person')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60) || 'person';
  return `report-${slug}-${stamp}.pdf`;
}
