// Place-map panel controller.
//
// Lifecycle:
//   1. User clicks "Show map" in the Tree-tab header.
//   2. First time only: a small consent banner appears explaining that
//      place names will be sent to Nominatim. User clicks Continue
//      (consent stored in localStorage so we never ask again on this
//      device). Cancel closes the panel without ever making a request.
//   3. We pull all unique places from the model, mark cached ones
//      green, queue the rest, and start geocoding 1/sec, updating the
//      progress strip as we go.
//   4. As coordinates come in, markers drop on the Leaflet map. Each
//      marker's popup lists every event/person at that place; clicking
//      a person re-focuses the tree behind the panel.
//   5. The Leaflet instance is initialized lazily once and kept alive
//      across open/close so the map state (zoom, pan) survives.

import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import markerIconUrl from 'leaflet/dist/images/marker-icon.png';
import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png';
import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png';
import { extractPlaces } from './places.js';
import { geocodePlace } from './geocode.js';
import { getCachedGeocode } from '../storage/index.js';

const CONSENT_KEY = 'ltg-tree:map-consent';

// Vite bundles the marker images, but Leaflet's default `L.Icon.Default`
// looks them up by relative URL. Patch it once with our bundled URLs.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIconUrl,
  iconRetinaUrl: markerIcon2xUrl,
  shadowUrl: markerShadowUrl,
});

let mapInstance = null;
let markerLayer = null;
let abortRunId = 0;

export function initMapPanel({ openBtn, closeBtn, panel, getModel, onSelectPerson }) {
  if (!openBtn || !panel) return;

  openBtn.addEventListener('click', () => openPanel(panel, getModel, onSelectPerson));
  closeBtn?.addEventListener('click', () => {
    abortRunId++;
    panel.hidden = true;
  });
}

async function openPanel(panel, getModel, onSelectPerson) {
  const model = getModel?.();
  if (!model) return;

  panel.hidden = false;
  panel.scrollIntoView({ behavior: 'smooth', block: 'start' });

  if (localStorage.getItem(CONSENT_KEY) !== 'yes') {
    renderConsent(panel, () => {
      localStorage.setItem(CONSENT_KEY, 'yes');
      runMap(panel, model, onSelectPerson);
    }, () => {
      panel.hidden = true;
    });
    return;
  }

  runMap(panel, model, onSelectPerson);
}

function renderConsent(panel, onAccept, onDecline) {
  const body = panel.querySelector('[data-map-body]');
  if (!body) return;
  body.innerHTML = `
    <div class="map-consent">
      <h3>One-time heads up</h3>
      <p>
        To plot places on a map I need to look up coordinates for names
        like <em>"Detroit, Wayne, Michigan, USA"</em>. This is the only
        feature on the site that uses the network.
      </p>
      <ul>
        <li>Place strings are sent to <strong>Nominatim</strong> (OpenStreetMap's free geocoder).</li>
        <li>Person names, dates, relationships, and DNA never leave your browser.</li>
        <li>Coordinates are cached locally so each place is looked up at most once on this device.</li>
        <li>Map tiles come from openstreetmap.org while you view.</li>
      </ul>
      <div class="map-consent__actions">
        <button type="button" class="btn btn--primary" data-consent="accept">Continue</button>
        <button type="button" class="btn btn--ghost-on-light" data-consent="decline">Cancel</button>
      </div>
    </div>
  `;
  body.querySelector('[data-consent="accept"]').addEventListener('click', onAccept);
  body.querySelector('[data-consent="decline"]').addEventListener('click', onDecline);
}

async function runMap(panel, model, onSelectPerson) {
  const body = panel.querySelector('[data-map-body]');
  const summary = panel.querySelector('[data-map-summary]');
  if (!body || !summary) return;

  const places = extractPlaces(model);
  if (places.size === 0) {
    body.innerHTML = `<p class="map-empty">No places to map. Birth, death, and marriage events with a PLAC field will appear here.</p>`;
    summary.textContent = '';
    return;
  }

  body.innerHTML = `
    <div class="map-progress" data-map-progress hidden>
      <div class="map-progress__bar"><div class="map-progress__fill" data-progress-fill></div></div>
      <p class="map-progress__label" data-progress-label></p>
    </div>
    <div class="map-canvas" data-map-canvas></div>
  `;

  const canvas = body.querySelector('[data-map-canvas]');
  const progress = body.querySelector('[data-map-progress]');
  const fill = body.querySelector('[data-progress-fill]');
  const label = body.querySelector('[data-progress-label]');

  // Initialize Leaflet once. Subsequent runs reuse the same instance.
  if (!mapInstance) {
    mapInstance = L.map(canvas, { worldCopyJump: true }).setView([20, 0], 2);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 18,
    }).addTo(mapInstance);
    markerLayer = L.layerGroup().addTo(mapInstance);
  } else {
    // Re-attach the existing map element to the new canvas.
    canvas.appendChild(mapInstance.getContainer());
    markerLayer.clearLayers();
    setTimeout(() => mapInstance.invalidateSize(), 0);
  }

  summary.textContent = `${places.size.toLocaleString()} unique place${places.size === 1 ? '' : 's'} from the GEDCOM. Looking up coordinates…`;
  progress.hidden = false;

  // Pre-fetch what's already cached so the map populates instantly,
  // then queue up the misses for online lookup.
  const placeEntries = [...places.entries()];
  const lookupQueue = [];
  let resolved = 0;
  const bounds = [];

  for (const [key, bucket] of placeEntries) {
    const cached = await getCachedGeocode(key);
    if (cached) {
      if (!cached.missing) {
        addMarker(cached, bucket, onSelectPerson);
        bounds.push([cached.lat, cached.lon]);
      }
      resolved++;
    } else {
      lookupQueue.push({ key, bucket });
    }
  }

  updateProgress(fill, label, resolved, places.size, lookupQueue.length);

  if (bounds.length > 0) {
    mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
  }

  if (lookupQueue.length === 0) {
    progress.hidden = true;
    summary.textContent = `${places.size.toLocaleString()} place${places.size === 1 ? '' : 's'} mapped. Click a marker for details.`;
    return;
  }

  const myRunId = ++abortRunId;

  // Process the queue serially with the geocoder's built-in 1 req/sec
  // throttle. Bail out if the user closes the panel mid-way.
  for (const { key, bucket } of lookupQueue) {
    if (abortRunId !== myRunId) return;
    const result = await geocodePlace(bucket.displayName, key);
    resolved++;
    if (result && !result.missing) {
      addMarker(result, bucket, onSelectPerson);
      bounds.push([result.lat, result.lon]);
      if (bounds.length === 1 || bounds.length % 5 === 0) {
        mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 8 });
      }
    }
    updateProgress(fill, label, resolved, places.size, places.size - resolved);
  }

  if (abortRunId !== myRunId) return;
  progress.hidden = true;
  const placed = bounds.length;
  const missed = places.size - placed;
  summary.textContent = missed > 0
    ? `${placed.toLocaleString()} of ${places.size.toLocaleString()} places mapped. ${missed} couldn't be located.`
    : `${placed.toLocaleString()} place${placed === 1 ? '' : 's'} mapped. Click a marker for details.`;
}

function updateProgress(fill, label, done, total, remaining) {
  const pct = total === 0 ? 100 : Math.round((done / total) * 100);
  if (fill) fill.style.width = `${pct}%`;
  if (label) {
    label.textContent = remaining > 0
      ? `Looking up ${remaining.toLocaleString()} place${remaining === 1 ? '' : 's'}… (${done}/${total})`
      : `Done. (${done}/${total})`;
  }
}

function addMarker(geo, bucket, onSelectPerson) {
  const marker = L.marker([geo.lat, geo.lon]);
  marker.bindPopup(buildPopupHtml(bucket));
  marker.on('popupopen', (e) => {
    const popupEl = e.popup.getElement();
    if (!popupEl || !onSelectPerson) return;
    popupEl.querySelectorAll('[data-person-id]').forEach((el) => {
      el.addEventListener('click', () => onSelectPerson(el.dataset.personId));
    });
  });
  marker.addTo(markerLayer);
}

function buildPopupHtml(bucket) {
  // Group events by type for a clean readout.
  const order = ['birth', 'marriage', 'death', 'event'];
  const grouped = {};
  for (const e of bucket.events) {
    (grouped[e.type] ||= []).push(e);
  }

  const sections = order
    .filter((t) => grouped[t]?.length)
    .map((t) => {
      const heading = ({
        birth: 'Born here',
        death: 'Died here',
        marriage: 'Married here',
        event: 'Other events here',
      })[t];
      const items = grouped[t].slice(0, 12).map((e) => `
        <li>
          <a href="#" data-person-id="${escapeAttr(e.personId)}">${escapeHtml(e.personName)}</a>${e.date ? `<span class="map-popup__date"> · ${escapeHtml(e.date)}</span>` : ''}
        </li>
      `).join('');
      const more = grouped[t].length > 12 ? `<li class="map-popup__more">+ ${grouped[t].length - 12} more</li>` : '';
      return `<div class="map-popup__section"><h4>${heading}</h4><ul>${items}${more}</ul></div>`;
    })
    .join('');

  return `
    <div class="map-popup">
      <h3 class="map-popup__title">${escapeHtml(bucket.displayName)}</h3>
      ${sections}
    </div>
  `;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[c]);
}

function escapeAttr(s) {
  return escapeHtml(s);
}
