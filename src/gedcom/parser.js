// GEDCOM parser — wraps the `parse-gedcom` library (v2.x) and normalizes
// its tree output into a flat {persons, families, sources, header} model.
// The v2 node shape is { type, value, data: { xref_id?, formal_name }, children }.

import { parse } from 'parse-gedcom';

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

  return { header, persons, families, sources };
}

function parsePerson(node) {
  const nameNode = findChild(node, 'NAME');
  const sexNode = findChild(node, 'SEX');

  return {
    id: stripPointer(node.data?.xref_id),
    name: nameNode ? cleanName(nameNode.value) : '',
    sex: sexNode ? sexNode.value : null,
    birth: parseEvent(findChild(node, 'BIRT')),
    death: parseEvent(findChild(node, 'DEAT')),
    families: childrenOfType(node, 'FAMS').map((c) => stripPointer(c.data?.pointer)),
    childOf:  childrenOfType(node, 'FAMC').map((c) => stripPointer(c.data?.pointer)),
    raw: node
  };
}

function parseFamily(node) {
  const husband = findChild(node, 'HUSB');
  const wife = findChild(node, 'WIFE');
  const children = childrenOfType(node, 'CHIL').map((c) => stripPointer(c.data?.pointer));

  return {
    id: stripPointer(node.data?.xref_id),
    husbandId: husband ? stripPointer(husband.data?.pointer) : null,
    wifeId:    wife    ? stripPointer(wife.data?.pointer)    : null,
    childIds:  children,
    marriage:  parseEvent(findChild(node, 'MARR')),
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
    place: getChildValue(node, 'PLAC')
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

function cleanName(raw) {
  if (!raw) return '';
  // GEDCOM wraps surnames in slashes, e.g. "John /Smith/"
  return raw.replace(/\//g, '').replace(/\s+/g, ' ').trim();
}

function flattenNode(node) {
  return {
    type: node.type,
    value: node.value ?? null,
    children: (node.children || []).map(flattenNode)
  };
}
