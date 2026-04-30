// Tree view — renders a focused-person view: parents above, the focus + spouse(s)
// in the middle, and children below. Clicking any card re-focuses on that person.
// Multiple spouses each get their own family row with their shared children listed.

import { lifespan, escapeHtml } from '../util/format.js';

export function renderTree({ container, model, focusId, onSelect }) {
  container.innerHTML = '';

  if (!focusId) {
    container.innerHTML = '<p class="tree-empty">Select a person from the list to begin.</p>';
    return;
  }

  const focus = model.byId.person.get(focusId);
  if (!focus) {
    container.innerHTML = `<p class="tree-empty">Unknown person: ${escapeHtml(focusId)}</p>`;
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'tree-grid';

  // ---- parents row ----
  const parentFamilyId = focus.childOf[0] || null;
  const parentFamily = parentFamilyId ? model.byId.family.get(parentFamilyId) : null;
  const father = parentFamily ? model.byId.person.get(parentFamily.husbandId) : null;
  const mother = parentFamily ? model.byId.person.get(parentFamily.wifeId) : null;

  if (father || mother) {
    const label = document.createElement('div');
    label.className = 'tree-row__label';
    label.textContent = 'Parents';
    grid.appendChild(label);

    const row = document.createElement('div');
    row.className = 'tree-row';
    const pair = document.createElement('div');
    pair.className = 'card__pair';
    pair.appendChild(personCard(father, { onSelect, placeholder: 'Father unknown' }));
    const eq = document.createElement('span');
    eq.className = 'pair-equals';
    eq.textContent = '=';
    pair.appendChild(eq);
    pair.appendChild(personCard(mother, { onSelect, placeholder: 'Mother unknown' }));
    row.appendChild(pair);
    grid.appendChild(row);
  }

  // ---- focus + spouse(s) ----
  const focusLabel = document.createElement('div');
  focusLabel.className = 'tree-row__label';
  focusLabel.textContent = focus.families.length > 0 ? 'Self & Partner(s)' : 'Self';
  grid.appendChild(focusLabel);

  const spouseFamilies = focus.families
    .map((fid) => model.byId.family.get(fid))
    .filter(Boolean);

  if (spouseFamilies.length === 0) {
    const row = document.createElement('div');
    row.className = 'tree-row';
    row.appendChild(personCard(focus, { onSelect, isFocus: true }));
    grid.appendChild(row);
  } else {
    spouseFamilies.forEach((fam) => {
      const spouseId = (fam.husbandId === focus.id) ? fam.wifeId : fam.husbandId;
      const spouse = spouseId ? model.byId.person.get(spouseId) : null;

      const row = document.createElement('div');
      row.className = 'tree-row';
      const pair = document.createElement('div');
      pair.className = 'card__pair';
      pair.appendChild(personCard(focus, { onSelect, isFocus: true }));
      const eq = document.createElement('span');
      eq.className = 'pair-equals';
      eq.textContent = '=';
      pair.appendChild(eq);
      pair.appendChild(personCard(spouse, { onSelect, placeholder: 'Spouse unknown' }));
      row.appendChild(pair);
      grid.appendChild(row);

      // children of THIS family
      const kids = (fam.childIds || [])
        .map((id) => model.byId.person.get(id))
        .filter(Boolean);

      if (kids.length > 0) {
        const childLabel = document.createElement('div');
        childLabel.className = 'tree-row__label';
        childLabel.textContent = 'Children';
        grid.appendChild(childLabel);

        const childRow = document.createElement('div');
        childRow.className = 'tree-row';
        kids.forEach((kid) => childRow.appendChild(personCard(kid, { onSelect })));
        grid.appendChild(childRow);
      }
    });
  }

  container.appendChild(grid);
}

// ---- card factory ----

function personCard(person, opts = {}) {
  const { onSelect, isFocus = false, placeholder = null } = opts;

  if (!person) {
    const el = document.createElement('div');
    el.className = 'card card__placeholder';
    el.innerHTML = `
      <div class="card__name">${escapeHtml(placeholder || '(unknown)')}</div>
    `;
    return el;
  }

  const el = document.createElement('div');
  const sexClass = person.sex === 'M' ? 'card--male'
    : person.sex === 'F' ? 'card--female'
    : 'card--unknown';
  el.className = `card ${sexClass}${isFocus ? ' card--focus' : ''}`;
  el.dataset.id = person.id;
  el.tabIndex = 0;
  el.innerHTML = `
    <div class="card__name">${escapeHtml(person.name) || '(unnamed)'}</div>
    <div class="card__dates">${escapeHtml(lifespan(person))}</div>
  `;
  el.addEventListener('click', () => onSelect?.(person.id));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(person.id);
    }
  });
  return el;
}
