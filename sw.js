'use strict';

// Repeat-visit cache. GitHub Pages serves everything with
// Cache-Control: max-age=600 and offers no way to change that, so without
// this every visit more than ten minutes apart re-downloads the full JS
// bundle and re-fetches every HAL clip that plays. Runtime caching only — no
// precache manifest to keep in sync; whatever the page actually loads gets
// cached as it loads.
//
// Strategies:
//   - assets/audio/*  → CACHE-FIRST. Clips and music are immutable in
//     practice (regenerating a clip is rare, and bumping VERSION below flushes
//     everything). Media elements may send Range requests; we always fetch
//     and cache the FULL file by URL and return it — <audio> accepts a 200
//     full-body response to a ranged request.
//   - every other same-origin GET (the JS bundle + lazy chunks, index.html,
//     style.css, hal_timing.json, the resume PDF…) → STALE-WHILE-REVALIDATE:
//     serve the cached copy instantly, refresh it in the background. After a
//     deploy a returning visitor gets the previous version once and the new
//     one on the next load — acceptable because the cross-file contracts
//     (chunk entry names + api bridge keys) are stable across builds by
//     design (see CLAUDE.md), so a mixed old/new chunk set still works.
//   - cross-origin (CDNs, Turnstile, the hal-worker API) and non-GET
//     requests are never intercepted.
//
// Deploy hygiene: bump VERSION to flush all caches (activate prunes caches
// from other versions). GH Pages serves sw.js itself with max-age=600 and
// browsers re-check the SW script on navigation, so an updated worker takes
// over within minutes of a deploy.

const VERSION = 'v2'; // v2: sim version 4→5 (a stale cached stickfighter.js would fail the netplay handshake)
const STATIC_CACHE = `ilaird-static-${VERSION}`;
const AUDIO_CACHE = `ilaird-audio-${VERSION}`;

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== AUDIO_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

async function audioCacheFirst(request) {
  const cache = await caches.open(AUDIO_CACHE);
  const hit = await cache.match(request.url);
  if (hit) return hit;
  const response = await fetch(request.url); // fetch by URL: full body, no Range header
  if (response.status === 200) await cache.put(request.url, response.clone());
  return response;
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const refresh = fetch(request).then((response) => {
    if (response.status === 200) cache.put(request, response.clone());
    return response;
  });
  if (cached) {
    event.waitUntil(refresh.catch(() => {})); // background refresh; failure just keeps the cached copy
    return cached;
  }
  return refresh; // nothing cached yet — first load goes to the network
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // CDNs / Turnstile / hal-worker: untouched
  if (url.pathname.startsWith('/assets/audio/')) {
    event.respondWith(audioCacheFirst(request));
  } else {
    event.respondWith(staleWhileRevalidate(request, event));
  }
});
