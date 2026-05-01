// Relationship prediction from total shared cM.
//
// Ranges adapted from Blaine Bettinger's Shared cM Project (v4.0, 2020),
// which aggregates real reported autosomal totals from tens of thousands
// of known DNA matches. Min/max bracket the empirical range; mean is the
// sampled average. Many relationships overlap heavily — half-sibling vs.
// aunt/niece vs. grandparent are essentially indistinguishable from cM
// alone — so we surface every plausible relationship within the user's
// range, sorted by how close their total is to each relationship's mean.

const RELATIONSHIPS = [
  { name: 'Identical twin or self',                                     min: 3330, mean: 3485, max: 3720 },
  { name: 'Parent / Child',                                             min: 3330, mean: 3485, max: 3720 },
  { name: 'Full sibling',                                               min: 2209, mean: 2613, max: 3384 },
  { name: 'Grandparent / Grandchild / Aunt / Uncle / Niece / Nephew / Half-sibling',
                                                                        min: 1156, mean: 1759, max: 2436 },
  { name: 'Great-grandparent / 1st cousin / Great-aunt or great-uncle / Half-aunt or half-uncle',
                                                                        min:  464, mean:  874, max: 1486 },
  { name: '1st cousin once removed / Half-1st cousin',                  min:  102, mean:  439, max:  980 },
  { name: '2nd cousin / 1st cousin twice removed',                      min:   41, mean:  229, max:  592 },
  { name: '2nd cousin once removed / Half-2nd cousin',                  min:   14, mean:  122, max:  353 },
  { name: '3rd cousin',                                                 min:    0, mean:   73, max:  234 },
  { name: '3rd cousin once removed / Half-3rd cousin',                  min:    0, mean:   48, max:  192 },
  { name: '4th cousin',                                                 min:    0, mean:   35, max:  139 },
  { name: '5th cousin or more distant',                                 min:    0, mean:   25, max:  117 },
];

export function predictRelationship(totalCm) {
  const candidates = RELATIONSHIPS
    .filter((r) => totalCm >= r.min && totalCm <= r.max)
    .map((r) => ({
      ...r,
      // Distance from the mean, normalized by half the range, so closeness
      // is comparable across wide and narrow ranges.
      distance: Math.abs(totalCm - r.mean) / Math.max(1, (r.max - r.min) / 2),
    }))
    .sort((a, b) => a.distance - b.distance);

  if (candidates.length === 0) {
    if (totalCm > 3720) {
      return [{ name: 'Identical twin or self', distance: 0, min: 3330, mean: 3485, max: 3720 }];
    }
    return [{ name: 'Unrelated or very distant', distance: 0, min: 0, mean: 0, max: 0 }];
  }

  return candidates;
}
