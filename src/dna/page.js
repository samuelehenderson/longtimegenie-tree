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

import { parseDnaFile } from './parser.js';
import { summarize } from './summary.js';
import { compareKits } from './match.js';
import { predictRelationship } from './relationships.js';
import { segmentsToCsv, downloadCsv } from './csv.js';
import { chromosomeLengthCm } from './genetic-map.js';

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
  A: null, // { kit, summary }
  B: null,
  comparison: null,
};

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
  });
}

async function handleSlotFile(slot, file) {
  setSlotStatus(slot, `Parsing ${file.name}…`);
  await new Promise((r) => setTimeout(r, 30));
  try {
    const kit = await parseDnaFile(file);
    const summary = summarize(kit);
    state[slot] = { kit, summary };
    paintSlot(slot);
    setSlotStatus(slot, '');
    refreshCompareButton();
    hideResults();
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
  renderResults(result, elapsed);
  btn.disabled = false;
  hint.textContent = `Compared ${result.comparedSnps.toLocaleString()} SNPs in ${elapsed} ms.`;
}

function renderResults(result, elapsed) {
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

  renderRelationships(totalCm);
  renderChromosomeBrowser(result);
  renderSegmentTable(result.segments);

  const resultsEl = document.getElementById('dna-results');
  resultsEl.hidden = false;
  resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
