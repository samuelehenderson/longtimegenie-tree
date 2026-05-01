// Controller for the DNA tab. Two-kit comparison workflow:
//
//   1. User drops a file in slot A or B → parsed kit is held in state[A|B].
//   2. When both slots are populated, the Compare button is enabled.
//   3. Compare runs the IBD walker and renders the headline, predicted
//      relationship list, chromosome browser, segment table, and CSV
//      download.
//
// Parsed kits stay in memory until the user removes them or refreshes the
// tab. Nothing is uploaded.

import { parseDnaText, readDnaFileToText } from './parser.js';
import { summarize } from './summary.js';
import { compareKits } from './match.js';
import { predictRelationship } from './relationships.js';
import { segmentsToCsv, downloadCsv } from './csv.js';
import { chromosomeLengthCm } from './genetic-map.js';
import { saveKit, loadKitsForWorkspace, clearKitForSlot, setKitLink } from '../storage/index.js';
import { getTreeModel, onTreeModelChange } from '../state/tree-model.js';
import { computeRelationship, compareWithDnaPrediction } from '../tree/relationship.js';

const SEX_LABELS = {
  male: 'Male',
  female: 'Female',
  unknown: 'Unknown',
};

const CHROMOSOMES_FOR_BROWSER = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', 'X',
];

const state = {
  A: null, // { kit, summary, text, linkedPersonId }
  B: null,
  comparison: null,
};

let openPicker = null; // teardown for any active picker so only one is open at once

export function initDnaPage() {
  const compareBtn = document.getElementById('dna-compare-btn');
  if (!compareBtn) return;

  bindSlot('A');
  bindSlot('B');

  compareBtn.addEventListener('click', runComparison);

  document.getElementById('dna-csv-btn')?.addEventListener('click', () => {
    if (!state.comparison) return;
    const a = state.A?.summary.filename || 'KitA';
    const b = state.B?.summary.filename || 'KitB';
    const csv = segmentsToCsv(state.comparison.segments, { kitNameA: a, kitNameB: b });
    const stamp = new Date().toISOString().slice(0, 10);
    downloadCsv(`dna-segments-${stamp}.csv`, csv);
  });

  restoreKitsFromStorage();

  // Re-render the link UI whenever the tree model changes (loads or clears).
  onTreeModelChange(() => {
    renderSlotLinkArea('A');
    renderSlotLinkArea('B');
  });
}

async function restoreKitsFromStorage() {
  const rows = await loadKitsForWorkspace();
  if (!rows.length) return;
  for (const row of rows) {
    if (!row.slot || !row.kitText || (row.slot !== 'A' && row.slot !== 'B')) continue;
    setSlotStatus(row.slot, `Restoring ${row.filename}…`);
    await new Promise((r) => setTimeout(r, 30));
    try {
      const kit = parseDnaText(row.kitText, row.filename);
      const summary = row.summary || summarize(kit);
      state[row.slot] = {
        kit,
        summary,
        text: row.kitText,
        linkedPersonId: row.linkedPersonId || null,
      };
      paintSlot(row.slot);
      setSlotStatus(row.slot, '');
    } catch (err) {
      console.warn('[restore] failed to re-parse kit', row.filename, err);
      await clearKitForSlot(row.slot);
      setSlotStatus(row.slot, '', false);
    }
  }
  refreshCompareButton();
}

function bindSlot(slot) {
  const dropzone = document.querySelector(`[data-slot-dropzone="${slot}"]`);
  const fileInput = document.querySelector(`[data-slot-file="${slot}"]`);
  const reset = document.querySelector(`[data-slot-reset="${slot}"]`);

  dropzone.addEventListener('click', () => fileInput.click());
  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });
  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropzone.classList.add('dropzone--drag');
  });
  dropzone.addEventListener('dragleave', () => {
    dropzone.classList.remove('dropzone--drag');
  });
  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropzone.classList.remove('dropzone--drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleSlotFile(slot, file);
  });

  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleSlotFile(slot, file);
  });

  reset.addEventListener('click', () => {
    state[slot] = null;
    fileInput.value = '';
    showSlotDropzone(slot, true);
    setSlotStatus(slot, '');
    refreshCompareButton();
    hideResults();
    clearKitForSlot(slot);
  });
}

async function handleSlotFile(slot, file) {
  setSlotStatus(slot, `Parsing ${file.name}…`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const text = await readDnaFileToText(file);
    const kit = parseDnaText(text, file.name);
    const summary = summarize(kit);
    state[slot] = { kit, summary, text, linkedPersonId: null };
    paintSlot(slot);
    setSlotStatus(slot, '');
    refreshCompareButton();
    hideResults();

    // Persist for the next session. Best-effort; does not block the UI.
    saveKit({
      slot,
      vendor: kit.vendor,
      filename: kit.filename,
      kitText: text,
      summary,
      linkedPersonId: null,
    });
  } catch (err) {
    console.error(err);
    setSlotStatus(slot, `Couldn't read this file: ${err.message || err}`, true);
  }
}

function paintSlot(slot) {
  const { summary } = state[slot];
  setText(`[data-slot-field="${slot}.vendor"]`, summary.vendor);
  setText(`[data-slot-field="${slot}.filename"]`, summary.filename);
  setText(`[data-slot-field="${slot}.snps"]`, summary.totalSnps.toLocaleString());
  setText(`[data-slot-field="${slot}.sex"]`, SEX_LABELS[summary.inferredSex] || summary.inferredSex);
  showSlotDropzone(slot, false);
  renderSlotLinkArea(slot);
}

function showSlotDropzone(slot, showDropzone) {
  document.querySelector(`[data-slot-dropzone="${slot}"]`).hidden = !showDropzone;
  document.querySelector(`[data-slot-stats="${slot}"]`).hidden = showDropzone;
  document.querySelector(`[data-slot-reset="${slot}"]`).hidden = showDropzone;
}

function setSlotStatus(slot, msg, isError = false) {
  const el = document.querySelector(`[data-slot-status="${slot}"]`);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('status--error', isError);
}

// ---------- linking to a person in the tree ----------

function renderSlotLinkArea(slot) {
  const area = document.querySelector(`[data-slot-link-area="${slot}"]`);
  if (!area) return;

  const slotState = state[slot];
  const treeModel = getTreeModel();

  area.innerHTML = '';
  closePicker();

  if (!slotState) return;

  if (!treeModel) {
    area.innerHTML = `
      <p class="dna-slot__link-hint">Load a tree on the Tree tab to link this kit to a person.</p>
    `;
    return;
  }

  if (slotState.linkedPersonId) {
    const person = treeModel.byId.person.get(slotState.linkedPersonId);
    const name = person?.name || slotState.linkedPersonId;
    const wrap = document.createElement('div');
    wrap.className = 'dna-slot__link';
    wrap.innerHTML = `
      <span class="dna-slot__link-label">
        Linked to <strong>${escapeHtml(name)}</strong>
      </span>
      <button type="button" class="dna-slot__link-action" data-action="change">Change…</button>
      <button type="button" class="dna-slot__link-action dna-slot__link-action--unlink" data-action="unlink">Unlink</button>
    `;
    wrap.querySelector('[data-action="unlink"]').addEventListener('click', () => {
      assignLink(slot, null);
    });
    wrap.querySelector('[data-action="change"]').addEventListener('click', () => {
      openPersonPicker(slot, area);
    });
    area.appendChild(wrap);
  } else {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'dna-slot__pick-btn';
    btn.textContent = 'Link this kit to a person…';
    btn.addEventListener('click', () => openPersonPicker(slot, area));
    area.appendChild(btn);
  }
}

function openPersonPicker(slot, host) {
  closePicker();
  const treeModel = getTreeModel();
  if (!treeModel) return;

  const picker = document.createElement('div');
  picker.className = 'link-picker';
  picker.innerHTML = `
    <input type="search" class="link-picker__search" placeholder="Search people…" autocomplete="off" />
    <div class="link-picker__list" role="listbox"></div>
    <p class="link-picker__hint">Press Esc to cancel.</p>
  `;
  host.appendChild(picker);

  const search = picker.querySelector('.link-picker__search');
  const list = picker.querySelector('.link-picker__list');

  const sortedPersons = [...treeModel.persons].sort(byNameThenId);
  let query = '';

  function paintList() {
    const q = query.trim().toLowerCase();
    const matched = q
      ? sortedPersons.filter((p) => p.name.toLowerCase().includes(q))
      : sortedPersons;
    const top = matched.slice(0, 200);
    if (!top.length) {
      list.innerHTML = `<div class="link-picker__empty">No matches.</div>`;
      return;
    }
    list.innerHTML = top.map((p) => `
      <button type="button" class="link-picker__row" data-id="${escapeAttr(p.id)}">
        <span class="link-picker__name">${escapeHtml(p.name) || '(unnamed)'}</span>
        <span class="link-picker__dates">${escapeHtml(formatLifespan(p))}</span>
      </button>
    `).join('');
    if (matched.length > top.length) {
      const more = document.createElement('div');
      more.className = 'link-picker__more';
      more.textContent = `+ ${matched.length - top.length} more — refine your search.`;
      list.appendChild(more);
    }
  }

  paintList();

  search.addEventListener('input', () => {
    query = search.value;
    paintList();
  });
  search.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closePicker();
  });
  list.addEventListener('click', (e) => {
    const row = e.target.closest('.link-picker__row');
    if (!row) return;
    assignLink(slot, row.dataset.id);
  });

  // Click outside closes the picker.
  const onDocClick = (e) => {
    if (!picker.contains(e.target) && !host.contains(e.target)) {
      closePicker();
    }
  };
  setTimeout(() => document.addEventListener('click', onDocClick), 0);

  openPicker = () => {
    document.removeEventListener('click', onDocClick);
    picker.remove();
    openPicker = null;
  };

  search.focus();
}

function closePicker() {
  if (openPicker) openPicker();
}

function assignLink(slot, personId) {
  const slotState = state[slot];
  if (!slotState) return;
  slotState.linkedPersonId = personId;
  closePicker();
  renderSlotLinkArea(slot);
  setKitLink({ slot, linkedPersonId: personId });

  // If a result panel is currently shown, re-render to update names + tree check.
  if (state.comparison) {
    renderResults(state.comparison, null, /* preserveResults */ true);
  }
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

function formatLifespan(p) {
  const b = p.birth?.date || '';
  const d = p.death?.date || '';
  if (!b && !d) return '';
  return `${b}${b || d ? ' — ' : ''}${d}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}

function refreshCompareButton() {
  const btn = document.getElementById('dna-compare-btn');
  const hint = document.getElementById('dna-compare-hint');
  const ready = state.A && state.B;
  btn.disabled = !ready;
  if (ready) hint.textContent = 'Both kits loaded — ready to compare.';
  else if (state.A || state.B) hint.textContent = 'Load the second kit to enable comparison.';
  else hint.textContent = 'Load both kits to enable comparison.';
}

async function runComparison() {
  if (!state.A || !state.B) return;
  const btn = document.getElementById('dna-compare-btn');
  const hint = document.getElementById('dna-compare-hint');
  btn.disabled = true;
  hint.textContent = 'Comparing…';

  // Yield so the UI repaints the disabled / "Comparing…" state before the
  // matcher locks the main thread.
  await new Promise((r) => setTimeout(r, 30));

  const t0 = performance.now();
  const result = compareKits(state.A.kit, state.B.kit);
  const elapsed = Math.round(performance.now() - t0);

  state.comparison = result;
  state.lastElapsedMs = elapsed;
  renderResults(result, elapsed);
  btn.disabled = false;
  hint.textContent = `Compared ${result.comparedSnps.toLocaleString()} SNPs in ${elapsed} ms.`;
}

function renderResults(result, elapsed, preserveScroll = false) {
  const totalCm = result.totalCm;
  setText('#dna-total-cm', `${formatCm(totalCm)} cM`);
  setText(
    '#dna-total-cm-detail',
    `total shared (autosomal: ${formatCm(result.autosomalCm)} cM` +
    (result.xCm > 0 ? `, X: ${formatCm(result.xCm)} cM` : '') +
    `)`
  );
  setText('#dna-segment-count', String(result.segmentCount));
  setText(
    '#dna-segment-detail',
    `shared segments • from ${result.intersectingSnps.toLocaleString()} overlapping SNPs`
  );
  setText('#dna-largest-cm', `${formatCm(result.largestCm)} cM`);

  renderResultsHeader();
  renderTreeCheck(totalCm);
  renderRelationships(totalCm);
  renderChromosomeBrowser(result);
  renderSegmentTable(result.segments);

  const resultsEl = document.getElementById('dna-results');
  resultsEl.hidden = false;
  if (!preserveScroll) {
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderResultsHeader() {
  const titleEl = document.querySelector('#dna-results .section-title');
  if (!titleEl) return;
  const aName = linkedPersonName('A');
  const bName = linkedPersonName('B');
  titleEl.textContent = (aName && bName)
    ? `${aName} × ${bName}`
    : 'Comparison results';
}

function linkedPersonName(slot) {
  const slotState = state[slot];
  const treeModel = getTreeModel();
  if (!slotState?.linkedPersonId || !treeModel) return null;
  const person = treeModel.byId.person.get(slotState.linkedPersonId);
  return person?.name || null;
}

function renderTreeCheck(totalCm) {
  const el = document.getElementById('dna-tree-check');
  if (!el) return;

  const treeModel = getTreeModel();
  const aId = state.A?.linkedPersonId;
  const bId = state.B?.linkedPersonId;

  if (!treeModel || !aId || !bId) {
    el.hidden = true;
    el.innerHTML = '';
    return;
  }

  const treeRel = computeRelationship(treeModel, aId, bId);
  const dnaTop = predictRelationship(totalCm)[0];
  const verdict = compareWithDnaPrediction(treeRel, dnaTop);

  const aName = linkedPersonName('A') || aId;
  const bName = linkedPersonName('B') || bId;

  if (!treeRel) {
    el.hidden = false;
    el.className = 'dna-tree-check dna-tree-check--none';
    el.innerHTML = `
      <div class="dna-tree-check__head">
        <span class="dna-tree-check__icon" aria-hidden="true">∅</span>
        <strong>${escapeHtml(aName)}</strong> and <strong>${escapeHtml(bName)}</strong>
        share no recorded common ancestor in this tree.
      </div>
      <p class="dna-tree-check__detail">
        DNA still says they share <strong>${formatCm(totalCm)} cM</strong> — best-fit
        relationship: ${escapeHtml(dnaTop?.name || 'unknown')}. Worth investigating.
      </p>
    `;
    return;
  }

  el.hidden = false;
  el.className = `dna-tree-check dna-tree-check--${verdict}`;
  const verdictText = {
    match: 'matches the tree',
    mismatch: 'differs from the tree',
    unknown: 'compared with the tree',
  }[verdict];
  const verdictIcon = { match: '✓', mismatch: '⚠', unknown: '·' }[verdict];

  el.innerHTML = `
    <div class="dna-tree-check__head">
      <span class="dna-tree-check__icon" aria-hidden="true">${verdictIcon}</span>
      <strong>${escapeHtml(aName)}</strong> and <strong>${escapeHtml(bName)}</strong>
      are recorded in the tree as <strong>${escapeHtml(treeRel.description)}</strong>.
    </div>
    <p class="dna-tree-check__detail">
      DNA prediction <strong>${verdictText}</strong>: ${escapeHtml(dnaTop?.name || 'unknown')}
      (${formatCm(totalCm)} cM total).
    </p>
  `;
}

function renderRelationships(totalCm) {
  const container = document.getElementById('dna-relationships');
  container.innerHTML = '';
  const candidates = predictRelationship(totalCm);
  const top = candidates[0];

  for (let i = 0; i < Math.min(candidates.length, 6); i++) {
    const r = candidates[i];
    const li = document.createElement('li');
    li.className = i === 0 ? 'dna-relationship dna-relationship--best' : 'dna-relationship';

    const name = document.createElement('span');
    name.className = 'dna-relationship__name';
    name.textContent = r.name;

    const range = document.createElement('span');
    range.className = 'dna-relationship__range';
    if (r.min !== r.max) {
      range.textContent = `${r.min}–${r.max} cM (mean ${r.mean})`;
    }

    const tag = document.createElement('span');
    tag.className = 'dna-relationship__tag';
    tag.textContent = i === 0 ? 'best fit' : 'plausible';

    li.append(name, range, tag);
    container.appendChild(li);
  }

  if (!top || top.name.startsWith('Unrelated')) {
    const note = document.createElement('p');
    note.className = 'dna-disclaimer';
    note.textContent = `${formatCm(totalCm)} cM is below typical thresholds for a detectable relationship — these kits may be unrelated, or related so distantly that autosomal DNA can't see it.`;
    container.appendChild(note);
  }
}

function renderChromosomeBrowser(result) {
  const container = document.getElementById('dna-chromosome-browser');
  container.innerHTML = '';

  for (const chr of CHROMOSOMES_FOR_BROWSER) {
    const totalCm = chromosomeLengthCm(chr);
    if (!totalCm) continue;

    const segs = result.segments.filter((s) => s.chr === chr);

    const row = document.createElement('div');
    row.className = 'cb-row';

    const label = document.createElement('span');
    label.className = 'cb-row__label';
    label.textContent = `chr ${chr}`;

    const track = document.createElement('span');
    track.className = 'cb-row__track';

    for (const s of segs) {
      const block = document.createElement('span');
      block.className = 'cb-row__block';
      const leftPct = (s.startCm / totalCm) * 100;
      const widthPct = Math.max(0.4, ((s.endCm - s.startCm) / totalCm) * 100);
      block.style.left = `${leftPct}%`;
      block.style.width = `${widthPct}%`;
      block.title = `chr ${chr}: ${formatCm(s.cm)} cM, ${s.snps.toLocaleString()} SNPs`;
      track.appendChild(block);
    }

    const cm = document.createElement('span');
    cm.className = 'cb-row__cm';
    const chrTotal = segs.reduce((acc, s) => acc + s.cm, 0);
    cm.textContent = chrTotal > 0 ? `${formatCm(chrTotal)} cM` : '—';

    row.append(label, track, cm);
    container.appendChild(row);
  }
}

function renderSegmentTable(segments) {
  const tbody = document.getElementById('dna-segments-tbody');
  tbody.innerHTML = '';
  if (segments.length === 0) {
    const tr = document.createElement('tr');
    tr.innerHTML = '<td colspan="5" class="dna-segments-table__empty">No segments above the 7 cM / 700 SNP threshold.</td>';
    tbody.appendChild(tr);
    return;
  }
  for (const s of segments) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${s.chr}</td>
      <td>${s.startBp.toLocaleString()}</td>
      <td>${s.endBp.toLocaleString()}</td>
      <td>${formatCm(s.cm)}</td>
      <td>${s.snps.toLocaleString()}</td>
    `;
    tbody.appendChild(tr);
  }
}

function hideResults() {
  state.comparison = null;
  const el = document.getElementById('dna-results');
  if (el) el.hidden = true;
}

function setText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}

function formatCm(cm) {
  if (cm >= 100) return cm.toFixed(0);
  if (cm >= 10) return cm.toFixed(1);
  return cm.toFixed(2);
}
