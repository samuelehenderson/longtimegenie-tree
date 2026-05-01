// Genealogical relationship calculator: given two person ids in the
// loaded GEDCOM model, return their relationship as recorded in the
// tree (or null if they aren't reachable through any common ancestor).
//
// Algorithm: walk both persons' ancestors breadth-first, collecting a
// map of personId → minimum depth. The shared id with the smallest
// (depthA + depthB) is the most-recent common ancestor (MRCA), and the
// pair (depthA, depthB) maps onto a standard relationship label.
//
// Half relationships (one shared parent at the MRCA level rather than
// two) aren't currently distinguished — the result is reported as the
// nearest relationship type. Detecting halves requires the second
// parent at MRCA level too; that's a follow-up refinement.

const MAX_DEPTH = 30; // sanity cap

export function computeRelationship(model, idA, idB) {
  if (!model || !idA || !idB) return null;
  if (idA === idB) {
    return { description: 'Self', kind: 'self', degreeA: 0, degreeB: 0 };
  }

  const ancestorsA = collectAncestors(model, idA);
  const ancestorsB = collectAncestors(model, idB);

  // Direct line: describe B relative to A.
  //   If B appears in A's ancestor set, B is A's ancestor → "Parent" / "Grandparent" / …
  //   If A appears in B's ancestor set, B is A's descendant → "Child" / "Grandchild" / …
  if (ancestorsA.has(idB)) {
    return directLine(ancestorsA.get(idB), 'ancestor');
  }
  if (ancestorsB.has(idA)) {
    return directLine(ancestorsB.get(idA), 'descendant');
  }

  // Find the MRCA (smallest depthA + depthB).
  let bestSum = Infinity;
  let bestPair = null;
  for (const [pid, dA] of ancestorsA) {
    if (!ancestorsB.has(pid)) continue;
    const dB = ancestorsB.get(pid);
    const sum = dA + dB;
    if (sum < bestSum) {
      bestSum = sum;
      bestPair = { mrcaId: pid, depthA: dA, depthB: dB };
    }
  }

  if (!bestPair) return null;
  return cousinLine(bestPair.depthA, bestPair.depthB, bestPair.mrcaId);
}

function collectAncestors(model, startId) {
  const result = new Map();
  const queue = [[startId, 0]];
  while (queue.length) {
    const [id, depth] = queue.shift();
    if (depth >= MAX_DEPTH) continue;
    const person = model.byId.person.get(id);
    if (!person) continue;
    const childOfFams = person.childOf || [];
    for (const famId of childOfFams) {
      const fam = model.byId.family.get(famId);
      if (!fam) continue;
      for (const parentId of [fam.husbandId, fam.wifeId]) {
        if (!parentId) continue;
        const newDepth = depth + 1;
        if (depth === 0 || !result.has(parentId) || result.get(parentId) > newDepth) {
          result.set(parentId, newDepth);
          queue.push([parentId, newDepth]);
        }
      }
    }
  }
  return result;
}

function directLine(depth, role) {
  // role describes B relative to A: 'ancestor' means B is A's ancestor;
  // 'descendant' means B is A's descendant. The label says what B is.
  const labels = role === 'ancestor'
    ? { 1: 'Parent', 2: 'Grandparent', 3: 'Great-grandparent' }
    : { 1: 'Child', 2: 'Grandchild', 3: 'Great-grandchild' };
  if (labels[depth]) {
    return { description: labels[depth], kind: 'direct', depth, role };
  }
  const greats = depth - 2;
  const base = role === 'ancestor' ? 'grandparent' : 'grandchild';
  return {
    description: `${greats}× great-${base}`,
    kind: 'direct',
    depth,
    role,
  };
}

function cousinLine(depthA, depthB, mrcaId) {
  const m = Math.min(depthA, depthB);
  const n = Math.max(depthA, depthB);

  if (m === 1 && n === 1) {
    return { description: 'Sibling', kind: 'sibling', mrcaId, depthA, depthB };
  }

  if (m === 1) {
    // Aunt/uncle ↔ niece/nephew, with greats for deeper generations.
    const distance = n - 1;
    if (distance === 1) {
      return { description: 'Aunt/Uncle ↔ Niece/Nephew', kind: 'avuncular', mrcaId, depthA, depthB };
    }
    if (distance === 2) {
      return { description: 'Great-aunt/uncle ↔ Great-niece/nephew', kind: 'avuncular', mrcaId, depthA, depthB };
    }
    const greats = distance - 1;
    return {
      description: `${greats}× great-aunt/uncle ↔ ${greats}× great-niece/nephew`,
      kind: 'avuncular',
      mrcaId,
      depthA,
      depthB,
    };
  }

  // Both depths >= 2: cousins.
  const cousinDegree = m - 1;
  const removed = n - m;
  let desc = `${ordinal(cousinDegree)} cousin`;
  if (removed === 1) desc += ' once removed';
  else if (removed === 2) desc += ' twice removed';
  else if (removed === 3) desc += ' thrice removed';
  else if (removed > 3) desc += ` ${removed}× removed`;
  return {
    description: desc,
    kind: 'cousin',
    cousinDegree,
    removed,
    mrcaId,
    depthA,
    depthB,
  };
}

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

// Heuristic comparison between a tree-derived relationship description
// and the DNA Compare output. Returns 'match' / 'mismatch' / 'unknown'
// — used by the UI to colour the validation panel.
export function compareWithDnaPrediction(treeRel, dnaTopRelationship) {
  if (!treeRel || !dnaTopRelationship) return 'unknown';
  const t = treeRel.description.toLowerCase();
  const d = (dnaTopRelationship.name || '').toLowerCase();

  // Self / identical twin
  if (treeRel.kind === 'self') {
    return d.includes('identical twin') || d.includes('self') ? 'match' : 'mismatch';
  }
  // Parent/child
  if (treeRel.kind === 'direct' && treeRel.depth === 1) {
    return d.includes('parent') ? 'match' : 'mismatch';
  }
  // Sibling — DNA bucket is "Full sibling"
  if (treeRel.kind === 'sibling') {
    return d.includes('full sibling') ? 'match' : d.includes('half-sibling') ? 'mismatch' : 'mismatch';
  }
  // Grandparent / Aunt-uncle / Half-sibling all live in the same DNA bucket
  if ((treeRel.kind === 'direct' && treeRel.depth === 2) ||
      (treeRel.kind === 'avuncular' && treeRel.depthA + treeRel.depthB === 3)) {
    return d.includes('grandparent') || d.includes('aunt') || d.includes('half-sibling')
      ? 'match' : 'mismatch';
  }
  // 1st cousin / Great-grandparent / Great-aunt
  if ((treeRel.kind === 'cousin' && treeRel.cousinDegree === 1 && treeRel.removed === 0) ||
      (treeRel.kind === 'direct' && treeRel.depth === 3) ||
      (treeRel.kind === 'avuncular' && treeRel.depthA + treeRel.depthB === 4)) {
    return d.includes('1st cousin') || d.includes('great-grandparent') || d.includes('great-aunt')
      ? 'match' : 'mismatch';
  }
  // 1st cousin once removed
  if (treeRel.kind === 'cousin' && treeRel.cousinDegree === 1 && treeRel.removed === 1) {
    return d.includes('1st cousin once removed') ? 'match' : 'mismatch';
  }
  // 2nd cousin
  if (treeRel.kind === 'cousin' && treeRel.cousinDegree === 2 && treeRel.removed === 0) {
    return d.includes('2nd cousin') ? 'match' : 'mismatch';
  }
  // 3rd, 4th cousins — looser match
  if (treeRel.kind === 'cousin' && treeRel.cousinDegree >= 3) {
    const expected = `${ordinal(treeRel.cousinDegree)} cousin`.toLowerCase();
    return d.includes(expected) ? 'match' : 'mismatch';
  }
  return 'unknown';
}
