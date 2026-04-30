// GEDCOM parser — wraps the `parse-gedcom` library (v2.x) and normalizes
// its tree output into a flat {persons, families, sources, byId} model.
// The v2 node shape is { type, value, data: { xref_id?, pointer?, formal_name }, children }.

import { parse } from 'parse-gedcom';

const EVENT_TAGS = new Set([
  'BIRT', 'DEAT', 'BURI', 'CHR', 'BAPM', 'BARM', 'BASM', 'BLES',
  'CONF', 'FCOM', 'ORDN', 'NATU', 'EMIG', 'IMMI', 'CENS', 'PROB',
  'WILL', 'GRAD', 'RETI', 'OCCU', 'RESI', 'EVEN'
]);

export function parseGedcom(text) {
  const root = parse(text);
  const top = root.children || [];

  const persons = [];
  const families = [];
  const sources = [];
  let header = null;

  for (const node of top) {
    switch (node.type) {
      case 'HEAD': header = flattenNode(node); break;
      case 'INDI': persons.push(parsePerson(node)); break;
      case 'FAM':  families.push(parseFamily(node)); break;
      case 'SOUR': sources.push(parseSource(node)); break;
      default: break;
    }
  }

  // Lookup maps for fast cross-referencing during render.
  const byId = {
    person:  new Map(persons.map((p) => [p.id, p])),
    family:  new Map(families.map((f) => [f.id, f])),
    source:  new Map(sources.map((s) => [s.id, s]))
  };

  return { header, persons, families, sources, byId };
}

function parsePerson(node) {
  const nameNode = findChild(node, 'NAME');
  const sexNode = findChild(node, 'SEX');
  const { full, given, surname } = parseName(nameNode);

  return {
    id: stripPointer(node.data?.xref_id),
    name: full,
    given,
    surname,
    sex: sexNode ? sexNode.value : null,
    birth: parseEvent(findChild(node, 'BIRT')),
    death: parseEvent(findChild(node, 'DEAT')),
    events: parseAllEvents(node),
    citations: extractCitations(node),
    families: childrenOfType(node, 'FAMS').map((c) => stripPointer(c.data?.pointer)).filter(Boolean),
    childOf:  childrenOfType(node, 'FAMC').map((c) => stripPointer(c.data?.pointer)).filter(Boolean),
    raw: node
  };
}

function parseFamily(node) {
  const husband = findChild(node, 'HUSB');
  const wife = findChild(node, 'WIFE');

  return {
    id: stripPointer(node.data?.xref_id),
    husbandId: husband ? stripPointer(husband.data?.pointer) : null,
    wifeId:    wife    ? stripPointer(wife.data?.pointer)    : null,
    childIds:  childrenOfType(node, 'CHIL').map((c) => stripPointer(c.data?.pointer)).filter(Boolean),
    marriage:  parseEvent(findChild(node, 'MARR')),
    citations: extractCitations(node),
    raw: node
  };
}

function parseSource(node) {
  return {
    id: stripPointer(node.data?.xref_id),
    title:       getChildValue(node, 'TITL'),
    author:      getChildValue(node, 'AUTH'),
    publication: getChildValue(node, 'PUBL'),
    raw: node
  };
}

function parseEvent(node) {
  if (!node) return null;
  return {
    date:  getChildValue(node, 'DATE'),
    place: getChildValue(node, 'PLAC'),
    citations: extractCitations(node)
  };
}

function parseAllEvents(node) {
  const events = [];
  for (const child of node.children || []) {
    if (!EVENT_TAGS.has(child.type)) continue;
    events.push({
      type: child.type,
      label: child.data?.formal_name || child.type,
      date:  getChildValue(child, 'DATE'),
      place: getChildValue(child, 'PLAC'),
      note:  getChildValue(child, 'NOTE'),
      citations: extractCitations(child)
    });
  }
  return events;
}

// SOUR children of an event/person: { sourceId, page, quality, text }
function extractCitations(node) {
  if (!node) return [];
  return childrenOfType(node, 'SOUR').map((c) => ({
    sourceId: stripPointer(c.data?.pointer),
    page:     getChildValue(c, 'PAGE'),
    quality:  getChildValue(c, 'QUAY'),
    text:     extractCitationText(c)
  })).filter((c) => c.sourceId);
}

function extractCitationText(sourNode) {
  const data = findChild(sourNode, 'DATA');
  if (!data) return null;
  return getChildValue(data, 'TEXT');
}

// ---- name handling ----

function parseName(nameNode) {
  if (!nameNode) return { full: '', given: '', surname: '' };
  const raw = nameNode.value || '';
  const surnameMatch = raw.match(/\/([^/]*)\//);
  const surname = surnameMatch ? surnameMatch[1].trim() : (getChildValue(nameNode, 'SURN') || '');
  const given = getChildValue(nameNode, 'GIVN') || raw.replace(/\/[^/]*\//, '').trim();
  return {
    full: raw.replace(/\//g, '').replace(/\s+/g, ' ').trim(),
    given: given.trim(),
    surname: surname.trim()
  };
}

// ---- low-level helpers ----

function findChild(node, type) {
  return (node.children || []).find((c) => c.type === type) || null;
}

function childrenOfType(node, type) {
  return (node.children || []).filter((c) => c.type === type);
}

function getChildValue(node, type) {
  const child = findChild(node, type);
  return child ? (child.value ?? null) : null;
}

function stripPointer(p) {
  if (!p) return null;
  return String(p).replace(/^@|@$/g, '');
}

function flattenNode(node) {
  return {
    type: node.type,
    value: node.value ?? null,
    children: (node.children || []).map(flattenNode)
  };
}
