// Walk a parsed GEDCOM model and produce a map of unique place strings to
// the events that happened there. Places are normalized for grouping so
// "Detroit, MI" and "Detroit, MI " end up in the same bucket.
//
// Returned shape:
//   Map<normalizedPlace, {
//     displayName,         // best-looking variant of the name (longest)
//     events: [
//       { personId, personName, type: 'birth' | 'death' | 'marriage' | 'event',
//         label, date, raw }
//     ]
//   }>

export function extractPlaces(model) {
  const places = new Map();

  const add = (rawPlace, event) => {
    if (!rawPlace) return;
    const trimmed = rawPlace.trim();
    if (!trimmed) return;
    const key = normalizePlace(trimmed);
    let bucket = places.get(key);
    if (!bucket) {
      bucket = { displayName: trimmed, events: [] };
      places.set(key, bucket);
    } else if (trimmed.length > bucket.displayName.length) {
      // Prefer the more detailed variant for display.
      bucket.displayName = trimmed;
    }
    bucket.events.push(event);
  };

  for (const person of model.persons) {
    if (person.birth?.place) {
      add(person.birth.place, {
        personId: person.id,
        personName: person.name || '(unnamed)',
        type: 'birth',
        label: 'Born',
        date: person.birth.date || '',
        raw: person.birth.place,
      });
    }
    if (person.death?.place) {
      add(person.death.place, {
        personId: person.id,
        personName: person.name || '(unnamed)',
        type: 'death',
        label: 'Died',
        date: person.death.date || '',
        raw: person.death.place,
      });
    }
    for (const evt of person.events || []) {
      if (!evt?.place) continue;
      add(evt.place, {
        personId: person.id,
        personName: person.name || '(unnamed)',
        type: 'event',
        label: evt.label || evt.type || 'Event',
        date: evt.date || '',
        raw: evt.place,
      });
    }
  }

  for (const family of model.families) {
    if (!family.marriage?.place) continue;
    const husband = family.husbandId ? model.byId.person.get(family.husbandId) : null;
    const wife    = family.wifeId    ? model.byId.person.get(family.wifeId)    : null;
    const partners = [husband, wife].filter(Boolean);
    if (partners.length === 0) continue;
    for (const p of partners) {
      add(family.marriage.place, {
        personId: p.id,
        personName: p.name || '(unnamed)',
        type: 'marriage',
        label: 'Married',
        date: family.marriage.date || '',
        raw: family.marriage.place,
      });
    }
  }

  return places;
}

export function normalizePlace(s) {
  return (s || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .trim();
}
