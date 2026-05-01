// AncestryDNA raw DNA file parser.
//
// Format (tab-separated):
//   #AncestryDNA raw data download
//   #...header comment block...
//   rsid<TAB>chromosome<TAB>position<TAB>allele1<TAB>allele2
//   rs4477212  1  82154  A  A
//
// AncestryDNA splits each genotype across two columns (allele1, allele2)
// rather than concatenating like 23andMe does. No-calls are encoded as `0`.
// Chromosome numbers 23–26 map to X, Y, MT, PAR respectively.

export function isAncestryFile(text) {
  const head = text.slice(0, 4000);
  if (/AncestryDNA/i.test(head)) return true;
  return /^rsid\tchromosome\tposition\tallele1\tallele2/m.test(head);
}

const CHR_NUMERIC_TO_NAME = {
  23: 'X',
  24: 'Y',
  25: 'MT',
  26: 'PAR',
};

function normalizeChr(raw) {
  if (raw === 'X' || raw === 'Y' || raw === 'MT') return raw;
  const n = +raw;
  if (n >= 1 && n <= 22) return String(n);
  if (CHR_NUMERIC_TO_NAME[n]) return CHR_NUMERIC_TO_NAME[n];
  return raw;
}

function isNoCall(allele) {
  return allele === '0' || allele === '-' || allele === '' || allele === 'I' || allele === 'D';
  // I/D = insertion/deletion markers — treated as no-calls for matching purposes
}

export function parseAncestry(text, filename = '') {
  const byChr = Object.create(null);
  let totalSnps = 0;
  let noCallCount = 0;
  let pastHeader = false;

  // Process line by line without splitting the entire file at once,
  // to keep peak memory down on ~50 MB inputs.
  let start = 0;
  const len = text.length;
  while (start < len) {
    let end = text.indexOf('\n', start);
    if (end === -1) end = len;
    const lineEnd = end > start && text.charCodeAt(end - 1) === 13 ? end - 1 : end;

    if (lineEnd > start) {
      const firstChar = text.charCodeAt(start);
      if (firstChar !== 35 /* # */) {
        if (!pastHeader) {
          // Skip the column header row
          pastHeader = true;
          if (text.charCodeAt(start) === 114 /* r */ &&
              text.substr(start, 4) === 'rsid') {
            start = end + 1;
            continue;
          }
        }
        const line = text.substring(start, lineEnd);
        const parts = line.split('\t');
        if (parts.length >= 5) {
          const rsid = parts[0];
          const chr = normalizeChr(parts[1]);
          const pos = +parts[2];
          const a1 = parts[3];
          const a2 = parts[4];

          if (Number.isFinite(pos) && pos > 0) {
            if (isNoCall(a1) || isNoCall(a2)) noCallCount++;

            let bucket = byChr[chr];
            if (!bucket) {
              bucket = byChr[chr] = {
                rsids: [],
                positions: [],
                a1: [],
                a2: [],
              };
            }
            bucket.rsids.push(rsid);
            bucket.positions.push(pos);
            bucket.a1.push(a1);
            bucket.a2.push(a2);
            totalSnps++;
          }
        }
      }
    }
    start = end + 1;
  }

  return {
    vendor: 'AncestryDNA',
    filename,
    parsedAt: new Date().toISOString(),
    totalSnps,
    noCallCount,
    byChr,
  };
}
