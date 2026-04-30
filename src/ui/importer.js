// Importer UI — file picker + drag-and-drop. Reads the .ged as text and
// hands the string to a caller-supplied onLoad handler. Keeps DOM concerns
// here so parser.js stays pure.

export function initImporter({ dropzone, fileInput, status, onLoad, onError }) {
  const setStatus = (msg, kind) => {
    status.textContent = msg || '';
    status.classList.remove('status--ok', 'status--error');
    if (kind) status.classList.add(`status--${kind}`);
  };

  const handleFile = async (file) => {
    if (!file) return;
    if (!/\.(ged|gedcom)$/i.test(file.name)) {
      setStatus(`Not a .ged file: ${file.name}`, 'error');
      return;
    }
    setStatus(`Reading ${file.name}…`);
    try {
      const text = await file.text();
      onLoad({ text, file });
      setStatus(`Loaded ${file.name} (${formatBytes(file.size)})`, 'ok');
    } catch (err) {
      setStatus(`Failed to read ${file.name}: ${err.message}`, 'error');
      onError?.(err);
    }
  };

  fileInput.addEventListener('change', (e) => {
    handleFile(e.target.files?.[0]);
  });

  // Click anywhere on the dropzone (not just the label) opens picker
  dropzone.addEventListener('click', (e) => {
    if (e.target === fileInput) return;
    fileInput.click();
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.add('dropzone--drag');
    });
  });

  ['dragleave', 'drop'].forEach((evt) => {
    dropzone.addEventListener(evt, (e) => {
      e.preventDefault();
      dropzone.classList.remove('dropzone--drag');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    handleFile(e.dataTransfer?.files?.[0]);
  });
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}
