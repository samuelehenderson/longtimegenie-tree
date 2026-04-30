// Small formatting helpers shared across UI modules.

export function lifespan(person) {
  const b = person.birth?.date ? extractYear(person.birth.date) : null;
  const d = person.death?.date ? extractYear(person.death.date) : null;
  if (b && d) return `${b} – ${d}`;
  if (b)      return `b. ${b}`;
  if (d)      return `d. ${d}`;
  return '—';
}

export function extractYear(dateStr) {
  if (!dateStr) return null;
  const m = String(dateStr).match(/(\d{3,4})\b(?!.*\d{3,4})/);
  return m ? m[1] : null;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

// Pretty event labels. Falls back to the raw GEDCOM tag.
export const EVENT_LABELS = {
  BIRT: 'Birth',
  DEAT: 'Death',
  BURI: 'Burial',
  MARR: 'Marriage',
  CHR:  'Christening',
  BAPM: 'Baptism',
  CONF: 'Confirmation',
  GRAD: 'Graduation',
  RETI: 'Retirement',
  OCCU: 'Occupation',
  RESI: 'Residence',
  CENS: 'Census',
  EMIG: 'Emigration',
  IMMI: 'Immigration',
  NATU: 'Naturalization',
  PROB: 'Probate',
  WILL: 'Will',
  EVEN: 'Event'
};

export function eventLabel(tag) {
  return EVENT_LABELS[tag] || tag;
}
