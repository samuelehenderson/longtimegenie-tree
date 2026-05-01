// Compute display-ready summary stats from a parsed kit.
//
// Sex inference looks at how many Y-chromosome SNPs have a real call.
// AncestryDNA includes Y SNPs in every kit (~3000–5000 of them); for
// females nearly all are no-calls, for males nearly all are called.

export const CHROM_ORDER = [
  '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
  '11', '12', '13', '14', '15', '16', '17', '18', '19', '20',
  '21', '22', 'X', 'Y', 'MT',
];

export function summarize(kit) {
  const chromosomes = {};
  for (const chr of CHROM_ORDER) {
    const bucket = kit.byChr[chr];
    chromosomes[chr] = bucket ? bucket.positions.length : 0;
  }

  return {
    vendor: kit.vendor,
    filename: kit.filename,
    totalSnps: kit.totalSnps,
    noCallCount: kit.noCallCount,
    chromosomes,
    inferredSex: inferSex(kit.byChr.Y),
  };
}

function inferSex(yBucket) {
  if (!yBucket || yBucket.positions.length === 0) return 'unknown';
  const total = yBucket.positions.length;
  let called = 0;
  for (let i = 0; i < total; i++) {
    if (!isNoCall(yBucket.a1[i]) && !isNoCall(yBucket.a2[i])) called++;
  }
  const ratio = called / total;
  if (ratio > 0.5) return 'male';
  if (ratio < 0.05) return 'female';
  return 'unknown';
}

function isNoCall(allele) {
  return allele === '0' || allele === '-' || allele === '' ||
         allele === 'I' || allele === 'D';
}
