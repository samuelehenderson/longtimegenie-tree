// CSV exporter for shared segments, in a column layout that DNA Painter
// will accept directly: Chromosome, Start, End, cM, SNPs.

export function segmentsToCsv(segments, { kitNameA = 'Kit A', kitNameB = 'Kit B' } = {}) {
  const header = 'Match Name,Chromosome,Start Location,End Location,Centimorgans,SNPs';
  const matchName = csvField(`${kitNameA} × ${kitNameB}`);
  const rows = segments.map((s) =>
    [
      matchName,
      s.chr,
      s.startBp,
      s.endBp,
      s.cm.toFixed(2),
      s.snps,
    ].join(',')
  );
  return [header, ...rows].join('\n') + '\n';
}

function csvField(value) {
  const s = String(value);
  if (/[",\n]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function downloadCsv(filename, csv) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
