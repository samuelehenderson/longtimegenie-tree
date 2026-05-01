// Duplicate-person finder for a parsed GEDCOM model.
//
// Returns pairs that look like the same individual entered twice — a
// common artifact of merging GEDCOMs from multiple sources. The output
// is a list of suggestions; nothing is mutated and nothing is merged.
// Scoring is conservative: hard mismatches (sex, very different birth
// years) zero or penalize; soft signals (same surname + close given,
// same birthplace) accumulate.
//
// Complexity is O(N²) on persons. Modern browsers handle a few thousand
// people comfortably (~tens of thousands of pair comparisons per second).
// For very large trees we'd add a bucketing pre-filter; not needed yet.

const DEFAULT_THRESHOLD = 0.55;

export function findDuplicates(model, threshold = DEFAULT_THRESHOLD) {
  const persons = model.persons;
  const out = [];
  for (let i = 0; i < persons.length; i++) {
    const a = persons[i];
    if (!a.name && !a.surname && !a.given) continue;
    for (let j = i + 1; j < persons.length; j++) {
      const b = persons[j];
      if (!b.name && !b.surname && !b.given) continue;
      const result = scorePair(a, b);
      if (result.score >= threshold) {
        out.push({ idA: a.id, idB: b.id, ...result });
      }
    }
  }
  out.sort((x, y) => y.score - x.score);
  return out;
}

export function scorePair(a, b) {
  // Hard disqualifier: explicitly mismatched sex.
  if (a.sex && b.sex && a.sex !== b.sex) {
    return { score: 0, reasons: [], confidence: 'none' };
  }

  const reasons = [];
  let score = 0;

  // ---- name ----
  const nameA = normalizeName(a.name);
  const nameB = normalizeName(b.name);
  if (!nameA || !nameB) {
    return { score: 0, reasons: [], confidence: 'none' };
  }

  if (nameA === nameB) {
    score += 0.55;
    reasons.push('Identical name');
  } else if (sameSurname(a, b) && sameGiven(a, b)) {
    score += 0.5;
    reasons.push('Same surname and given');
  } else if (sameSurname(a, b)) {
    const givenA = (a.given || '').toLowerCase().trim();
    const givenB = (b.given || '').toLowerCase().trim();
    const givenSim = stringSim(givenA, givenB);
    if (givenSim >= 0.7) {
      score += 0.4;
      reasons.push('Same surname, similar given names');
    } else if (givenSim >= 0.5) {
      score += 0.25;
      reasons.push('Same surname, somewhat similar given');
    } else if (givenA.length && givenB.length && givenA[0] === givenB[0]) {
      score += 0.1;
      reasons.push('Same surname, same first initial');
    }
  } else {
    const totalSim = stringSim(nameA, nameB);
    if (totalSim >= 0.85) {
      score += 0.3;
      reasons.push('Very similar full names');
    }
  }

  // ---- birth year ----
  const birthA = yearOf(a.birth);
  const birthB = yearOf(b.birth);
  if (birthA && birthB) {
    const diff = Math.abs(birthA - birthB);
    if (diff === 0) {
      score += 0.3;
      reasons.push('Same birth year');
    } else if (diff <= 1) {
      score += 0.2;
      reasons.push('Birth year within 1');
    } else if (diff <= 3) {
      score += 0.05;
      reasons.push('Birth year within 3');
    } else if (diff > 5) {
      score -= 0.25;
      reasons.push(`Birth years differ by ${diff}`);
    }
  } else if (birthA || birthB) {
    // One has a date, the other doesn't — neutral.
  }

  // ---- death year ----
  const deathA = yearOf(a.death);
  const deathB = yearOf(b.death);
  if (deathA && deathB) {
    const diff = Math.abs(deathA - deathB);
    if (diff === 0) {
      score += 0.15;
      reasons.push('Same death year');
    } else if (diff <= 1) {
      score += 0.08;
    } else if (diff > 5) {
      score -= 0.15;
      reasons.push(`Death years differ by ${diff}`);
    }
  }

  // ---- birthplace ----
  if (placeMatch(a.birth?.place, b.birth?.place)) {
    score += 0.12;
    reasons.push('Same birth place');
  }

  // ---- deathplace ----
  if (placeMatch(a.death?.place, b.death?.place)) {
    score += 0.06;
  }

  score = Math.max(0, Math.min(1, score));
  const confidence =
    score >= 0.85 ? 'very-high' :
    score >= 0.7  ? 'high' :
    score >= 0.55 ? 'possible' :
                    'low';

  return { score, reasons, confidence };
}

// ---------- helpers ----------

function normalizeName(name) {
  return (name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[‘’“”]/g, "'")
    .trim();
}

function sameSurname(a, b) {
  const sa = (a.surname || '').toLowerCase().trim();
  const sb = (b.surname || '').toLowerCase().trim();
  return !!sa && sa === sb;
}

function sameGiven(a, b) {
  const ga = (a.given || '').toLowerCase().trim();
  const gb = (b.given || '').toLowerCase().trim();
  return !!ga && ga === gb;
}

function yearOf(event) {
  if (!event?.date) return null;
  const m = /\b(\d{4})\b/.exec(event.date);
  return m ? +m[1] : null;
}

function normalizePlace(p) {
  if (!p) return '';
  return p
    .toLowerCase()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 2)
    .join(', ');
}

function placeMatch(a, b) {
  const na = normalizePlace(a);
  const nb = normalizePlace(b);
  return !!na && na === nb;
}

function stringSim(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;
  const distance = levenshtein(longer, shorter);
  return (longer.length - distance) / longer.length;
}

function levenshtein(s1, s2) {
  const m = s1.length;
  const n = s2.length;
  const dp = new Array(n + 1);
  for (let j = 0; j <= n; j++) dp[j] = j;
  for (let i = 1; i <= m; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j];
      const sub = prev + (s1.charCodeAt(i - 1) === s2.charCodeAt(j - 1) ? 0 : 1);
      dp[j] = Math.min(sub, dp[j] + 1, dp[j - 1] + 1);
      prev = tmp;
    }
  }
  return dp[n];
}
