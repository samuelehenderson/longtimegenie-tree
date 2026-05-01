// Place-name → coordinates via OpenStreetMap's Nominatim service.
//
// This is the only feature in the app that talks to a network: a place
// name like "Detroit, Wayne, Michigan, USA" gets sent to Nominatim,
// which returns lat/lon. Person names and dates never leave the
// browser. The caller is responsible for surfacing this fact to the
// user before the first lookup (see the consent flow in page.js).
//
// We respect Nominatim's usage policy: ≤ 1 request per second, with a
// descriptive User-Agent / Referer (the browser sends Referer
// automatically), and aggressive caching so any place is looked up at
// most once across all of the user's sessions on this device. Cached
// hits return immediately.

import { getCachedGeocode, saveCachedGeocode } from '../storage/index.js';

const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const RATE_LIMIT_MS = 1100;

let lastRequestAt = 0;

export async function geocodePlace(displayName, normalizedKey) {
  const cached = await getCachedGeocode(normalizedKey);
  if (cached) return cached;

  // Respect Nominatim's 1 req/sec policy.
  const sinceLast = Date.now() - lastRequestAt;
  if (sinceLast < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - sinceLast);
  }
  lastRequestAt = Date.now();

  const url = `${NOMINATIM_URL}?q=${encodeURIComponent(displayName)}&format=json&limit=1`;
  let entry;
  try {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`Nominatim returned ${res.status}`);
    const data = await res.json();
    if (Array.isArray(data) && data.length > 0) {
      entry = {
        place: normalizedKey,
        displayName,
        lat: parseFloat(data[0].lat),
        lon: parseFloat(data[0].lon),
        resolvedName: data[0].display_name || displayName,
        missing: false,
      };
    } else {
      entry = { place: normalizedKey, displayName, missing: true };
    }
  } catch (err) {
    console.warn('[geocode] failed for', displayName, err);
    // Don't cache failures — the network might just be flaky.
    return null;
  }

  saveCachedGeocode(entry);
  return entry;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
