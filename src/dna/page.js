// Controller for the DNA tab. Handles file drop / picker, parsing, and
// rendering the kit-summary card. The actual two-kit comparison engine
// lands in a follow-up PR.

import { parseDnaFile } from './parser.js';
import { summarize, CHROM_ORDER } from './summary.js';

const SEX_LABELS = {
  male: 'Male (Y chromosome largely called)',
  female: 'Female (Y chromosome largely no-call)',
  unknown: 'Unknown',
};

export function initDnaPage() {
  const dropzone = document.getElementById('dna-dropzone');
  const fileInput = document.getElementById('dna-file-input');
  const status = document.getElementById('dna-status');
  const importer = document.getElementById('dna-importer');
  const summaryView = document.getElementById('dna-summary');
  const reloadBtn = document.getElementById('dna-reload');

  if (!dropzone || !fileInput) return;

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
    if (file) handleFile(file);
  });
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleFile(file);
  });
  reloadBtn?.addEventListener('click', () => {
    summaryView.hidden = true;
    importer.hidden = false;
    status.textContent = '';
    fileInput.value = '';
  });

  async function handleFile(file) {
    setStatus(`Parsing ${file.name}… this can take a few seconds for large kits.`);
    // Yield to the browser so the status text actually paints.
    await new Promise((r) => setTimeout(r, 30));
    try {
      const t0 = performance.now();
      const kit = await parseDnaFile(file);
      const summary = summarize(kit);
      const elapsed = Math.round(performance.now() - t0);
      renderSummary(summary, elapsed);
      importer.hidden = true;
      summaryView.hidden = false;
      setStatus('');
    } catch (err) {
      console.error(err);
      setStatus(`Couldn't read this file: ${err.message || err}`, true);
    }
  }

  function setStatus(msg, isError = false) {
    status.textContent = msg;
    status.classList.toggle('status--error', isError);
  }
}

function renderSummary(s, elapsed) {
  setText('dna-summary-vendor', s.vendor);
  setText('dna-summary-filename', s.filename);
  setText('dna-summary-snps', s.totalSnps.toLocaleString());

  const noCallPct = s.totalSnps > 0
    ? ` (${((100 * s.noCallCount) / s.totalSnps).toFixed(2)}%)`
    : '';
  setText('dna-summary-nocalls', `${s.noCallCount.toLocaleString()}${noCallPct}`);

  setText('dna-summary-sex', SEX_LABELS[s.inferredSex] || s.inferredSex);
  setText('dna-summary-elapsed', `${elapsed.toLocaleString()} ms`);

  renderChromDistribution(s.chromosomes);
}

function renderChromDistribution(chromosomes) {
  const container = document.getElementById('dna-chrom-distribution');
  if (!container) return;
  container.innerHTML = '';

  const max = Math.max(1, ...Object.values(chromosomes));

  for (const chr of CHROM_ORDER) {
    const n = chromosomes[chr] || 0;
    // Hide sex / mito chromosomes that have no data at all (uncommon)
    if (n === 0 && (chr === 'Y' || chr === 'MT')) continue;

    const row = document.createElement('div');
    row.className = 'chrom-row';

    const label = document.createElement('span');
    label.className = 'chrom-row__label';
    label.textContent = `chr ${chr}`;

    const barWrap = document.createElement('span');
    barWrap.className = 'chrom-row__bar-wrap';
    const bar = document.createElement('span');
    bar.className = 'chrom-row__bar';
    bar.style.width = `${(n / max) * 100}%`;
    barWrap.appendChild(bar);

    const count = document.createElement('span');
    count.className = 'chrom-row__count';
    count.textContent = n.toLocaleString();

    row.append(label, barWrap, count);
    container.appendChild(row);
  }
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}
