import { parseGedcom } from './gedcom/parser.js';
import { initImporter } from './ui/importer.js';

const dropzone  = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const status    = document.getElementById('status');
const output    = document.getElementById('output');
const summary   = document.getElementById('summary');
const jsonView  = document.getElementById('json-view');

initImporter({
  dropzone,
  fileInput,
  status,
  onLoad: ({ text }) => {
    let model;
    try {
      model = parseGedcom(text);
    } catch (err) {
      status.textContent = `Parse error: ${err.message}`;
      status.classList.add('status--error');
      return;
    }
    renderOutput(model);
  },
  onError: (err) => console.error(err)
});

function renderOutput(model) {
  output.hidden = false;
  summary.innerHTML = '';
  for (const [label, count] of [
    ['persons',   model.persons.length],
    ['families',  model.families.length],
    ['sources',   model.sources.length]
  ]) {
    const chip = document.createElement('span');
    chip.className = 'summary__chip';
    chip.textContent = `${count} ${label}`;
    summary.appendChild(chip);
  }

  // Strip the bulky `raw` nodes for readability — they're useful at runtime
  // but noisy in JSON view.
  const display = {
    header: model.header,
    persons:  model.persons.map(stripRaw),
    families: model.families.map(stripRaw),
    sources:  model.sources.map(stripRaw)
  };

  jsonView.textContent = JSON.stringify(display, null, 2);
  output.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function stripRaw(obj) {
  const { raw, ...rest } = obj;
  return rest;
}
