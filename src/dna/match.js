// Half-IBD (identity-by-descent) detection between two parsed kits.
//
// Algorithm (the standard genetic-genealogy approach used by GEDmatch and
// similar tools):
//
//   1. For each chromosome both kits cover, walk the SNPs in lockstep
//      ordered by position. At each SNP present in both kits and called
//      in both, decide whether the genotypes "match" — i.e. share at
//      least one allele (e.g. AG vs AT match through the shared A).
//   2. Track runs of consecutive matching SNPs. Tolerate a small number
//      of consecutive mismatches inside a run to absorb genotyping
//      noise (~0.1–0.5 % of SNPs are mis-called by the chip).
//   3. When a run ends, accept it as a shared segment iff:
//          length in SNPs    >= MIN_SNPS    (default 700)
//          length in cM      >= MIN_CM      (default 7)
//      Both thresholds together rule out the false-positive runs that
//      unrelated people share by chance through population structure.
//   4. Sum cM across all accepted segments → total shared cM, the input
//      to the relationship predictor.

import { segmentCm, isMappedChromosome } from './genetic-map.js';

export const DEFAULT_THRESHOLDS = {
  minSnps: 700,
  minCm: 7,
  maxConsecutiveMismatches: 2,
};

export function compareKits(kitA, kitB, thresholds = DEFAULT_THRESHOLDS) {
  const segments = [];
  const perChromosome = {};
  let intersectingSnps = 0;
  let comparedSnps = 0;
  let matchingSnps = 0;

  const chromosomes = sharedChromosomes(kitA, kitB);

  for (const chr of chromosomes) {
    const a = kitA.byChr[chr];
    const b = kitB.byChr[chr];
    const result = compareChromosome(chr, a, b, thresholds);

    intersectingSnps += result.intersectingSnps;
    comparedSnps += result.comparedSnps;
    matchingSnps += result.matchingSnps;
    perChromosome[chr] = {
      cm: result.totalCm,
      segments: result.segments.length,
      intersectingSnps: result.intersectingSnps,
      comparedSnps: result.comparedSnps,
    };
    segments.push(...result.segments);
  }

  segments.sort((a, b) => b.cm - a.cm);

  const totalCm = segments.reduce((acc, s) => acc + s.cm, 0);
  const xCm = segments.filter((s) => s.chr === 'X').reduce((acc, s) => acc + s.cm, 0);
  const largestCm = segments.length ? segments[0].cm : 0;

  return {
    segments,
    perChromosome,
    totalCm,
    xCm,
    autosomalCm: totalCm - xCm,
    largestCm,
    segmentCount: segments.length,
    intersectingSnps,
    comparedSnps,
    matchingSnps,
    thresholds,
  };
}

function sharedChromosomes(kitA, kitB) {
  const result = [];
  for (const chr of Object.keys(kitA.byChr)) {
    if (!isMappedChromosome(chr)) continue;
    if (!kitB.byChr[chr]) continue;
    result.push(chr);
  }
  // Sort 1..22, X
  result.sort((x, y) => {
    const nx = x === 'X' ? 23 : +x;
    const ny = y === 'X' ? 23 : +y;
    return nx - ny;
  });
  return result;
}

function compareChromosome(chr, a, b, thresholds) {
  // Make sure both arrays are sorted by position. AncestryDNA files are
  // typically already sorted, but don't trust it.
  const orderA = sortIndicesByPosition(a.positions);
  const orderB = sortIndicesByPosition(b.positions);

  const segments = [];
  const matchedFlags = []; // 1 = match, 0 = mismatch (only at intersected, called SNPs)
  const matchedPositions = [];

  let i = 0;
  let j = 0;
  let intersectingSnps = 0;
  let comparedSnps = 0;
  let matchingSnps = 0;

  while (i < orderA.length && j < orderB.length) {
    const ia = orderA[i];
    const ib = orderB[j];
    const pa = a.positions[ia];
    const pb = b.positions[ib];

    if (pa < pb) {
      i++;
    } else if (pa > pb) {
      j++;
    } else {
      intersectingSnps++;
      const a1 = a.a1[ia], a2 = a.a2[ia];
      const b1 = b.a1[ib], b2 = b.a2[ib];

      if (!isNoCall(a1) && !isNoCall(a2) && !isNoCall(b1) && !isNoCall(b2)) {
        comparedSnps++;
        const matched = (a1 === b1) || (a1 === b2) || (a2 === b1) || (a2 === b2);
        if (matched) matchingSnps++;
        matchedFlags.push(matched ? 1 : 0);
        matchedPositions.push(pa);
      }
      i++;
      j++;
    }
  }

  // Walk the matched/mismatched sequence, growing runs and emitting
  // segments that pass the thresholds.
  let runStartIdx = -1;
  let runEndIdx = -1;
  let runMismatchStreak = 0;

  const finishRun = () => {
    if (runStartIdx === -1) return;
    const startPos = matchedPositions[runStartIdx];
    const endPos = matchedPositions[runEndIdx];
    const snpCount = runEndIdx - runStartIdx + 1;
    const cm = segmentCm(chr, startPos, endPos);
    if (snpCount >= thresholds.minSnps && cm >= thresholds.minCm) {
      segments.push({
        chr,
        startBp: startPos,
        endBp: endPos,
        startCm: bpStartCm(chr, startPos),
        endCm: bpStartCm(chr, endPos),
        cm,
        snps: snpCount,
      });
    }
    runStartIdx = -1;
    runEndIdx = -1;
    runMismatchStreak = 0;
  };

  for (let k = 0; k < matchedFlags.length; k++) {
    if (matchedFlags[k] === 1) {
      if (runStartIdx === -1) {
        runStartIdx = k;
      }
      runEndIdx = k;
      runMismatchStreak = 0;
    } else {
      runMismatchStreak++;
      if (runMismatchStreak > thresholds.maxConsecutiveMismatches) {
        finishRun();
      }
    }
  }
  finishRun();

  const totalCm = segments.reduce((acc, s) => acc + s.cm, 0);

  return {
    segments,
    totalCm,
    intersectingSnps,
    comparedSnps,
    matchingSnps,
  };
}

function sortIndicesByPosition(positions) {
  const idx = new Array(positions.length);
  for (let k = 0; k < positions.length; k++) idx[k] = k;
  idx.sort((x, y) => positions[x] - positions[y]);
  return idx;
}

function bpStartCm(chr, pos) {
  // Helper purely so segments carry their cM coords for the visualizer.
  // Intentionally re-imports segmentCm via a single-arg shortcut for clarity.
  return segmentCm(chr, 0, pos);
}

function isNoCall(allele) {
  return allele === '0' || allele === '-' || allele === '' ||
         allele === 'I' || allele === 'D';
}
