// Approximate physical-to-genetic distance conversion.
//
// Each chromosome has a published total physical length (GRCh37, the build
// AncestryDNA uses) and a published total genetic length in cM (HapMap II
// sex-averaged combined map). Within a chromosome we interpolate linearly:
//
//   cM(pos) = (pos / chr_bp) * chr_cm
//
// This is a v1 approximation. Real recombination rate varies along the
// chromosome — higher near telomeres, lower across centromeres — so per-
// segment cM can be off by 10–20 %. For relationship prediction the errors
// largely average out across the many segments a related pair shares, but a
// future PR will replace this with a proper recombination map for tighter
// per-segment estimates.

const CHROMOSOME_LENGTHS = {
  '1':  { bp: 249250621, cm: 281.5 },
  '2':  { bp: 243199373, cm: 263.6 },
  '3':  { bp: 198022430, cm: 224.0 },
  '4':  { bp: 191154276, cm: 213.2 },
  '5':  { bp: 180915260, cm: 209.4 },
  '6':  { bp: 171115067, cm: 192.4 },
  '7':  { bp: 159138663, cm: 187.2 },
  '8':  { bp: 146364022, cm: 168.0 },
  '9':  { bp: 141213431, cm: 167.5 },
  '10': { bp: 135534747, cm: 181.1 },
  '11': { bp: 135006516, cm: 158.4 },
  '12': { bp: 133851895, cm: 174.7 },
  '13': { bp: 115169878, cm: 125.7 },
  '14': { bp: 107349540, cm: 120.2 },
  '15': { bp: 102531392, cm: 141.3 },
  '16': { bp: 90354753,  cm: 134.0 },
  '17': { bp: 81195210,  cm: 128.1 },
  '18': { bp: 78077248,  cm: 117.4 },
  '19': { bp: 59128983,  cm: 107.3 },
  '20': { bp: 63025520,  cm: 108.3 },
  '21': { bp: 48129895,  cm: 62.4 },
  '22': { bp: 51304566,  cm: 73.5 },
  'X':  { bp: 155270560, cm: 180.8 },
};

export function chromosomeLengthCm(chr) {
  return CHROMOSOME_LENGTHS[chr]?.cm ?? null;
}

export function chromosomeLengthBp(chr) {
  return CHROMOSOME_LENGTHS[chr]?.bp ?? null;
}

export function bpToCm(chr, pos) {
  const c = CHROMOSOME_LENGTHS[chr];
  if (!c) return 0;
  if (pos <= 0) return 0;
  if (pos >= c.bp) return c.cm;
  return (pos / c.bp) * c.cm;
}

export function segmentCm(chr, startBp, endBp) {
  return bpToCm(chr, endBp) - bpToCm(chr, startBp);
}

export function isMappedChromosome(chr) {
  return chr in CHROMOSOME_LENGTHS;
}
