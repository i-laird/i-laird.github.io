'use strict';

// Service-worker strategy tests.
//
// sw.js is the one file that can wedge returning visitors if it misroutes a
// request (there's no build step to catch it, and a broken fetch handler
// fails only in production). So we run the REAL sw.js inside a minimal stub
// of the ServiceWorker environment (self / caches / fetch / fetch events) and
// assert the routing contract:
//   - audio is cache-first (second request never hits the network),
//   - other same-origin GETs are stale-while-revalidate (cached copy served,
//     background refresh updates the cache),
//   - cross-origin and non-GET requests are never intercepted,
//   - activate prunes caches from older VERSIONs.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ORIGIN = 'https://ianclaird.com';

// Build a fresh stub SW environment, execute the real sw.js in it, and return
// handles for driving events and inspecting state.
function loadSW({ preExistingCaches = [] } = {}) {
  const listeners = {};
  const stores = new Map(); // cache name → Map(url → response)
  for (const name of preExistingCaches) stores.set(name, new Map());
  const keyOf = (req) => (typeof req === 'string' ? req : req.url);

  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const m = stores.get(name);
      return {
        async match(req) {
          return m.get(keyOf(req));
        },
        async put(req, resp) {
          m.set(keyOf(req), resp);
        },
      };
    },
    async keys() {
      return [...stores.keys()];
    },
    async delete(name) {
      return stores.delete(name);
    },
  };

  const fetchLog = [];
  let fetchImpl = async (input) => ({
    status: 200,
    url: keyOf(input),
    body: 'net:' + keyOf(input),
    clone() {
      return { ...this };
    },
  });

  const sandbox = {
    self: {
      addEventListener: (type, fn) => {
        listeners[type] = fn;
      },
      skipWaiting: () => {},
      clients: { claim: async () => {} },
      location: new URL(ORIGIN + '/sw.js'),
    },
    caches,
    fetch: (input, init) => {
      fetchLog.push(keyOf(input));
      return fetchImpl(input, init);
    },
    URL,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'), sandbox);

  // Drive a fetch event the way the browser would. Returns the response the
  // SW produced, or null if it didn't call respondWith (i.e. passthrough).
  async function dispatchFetch(url, method = 'GET') {
    let responded = null;
    const pending = [];
    const event = {
      request: { url, method },
      respondWith(p) {
        responded = Promise.resolve(p);
      },
      waitUntil(p) {
        pending.push(Promise.resolve(p).catch(() => {}));
      },
    };
    listeners.fetch(event);
    const response = responded ? await responded : null;
    await Promise.all(pending); // let background refreshes settle
    return response;
  }

  async function dispatchActivate() {
    let done = Promise.resolve();
    listeners.activate({
      waitUntil(p) {
        done = p;
      },
    });
    await done;
  }

  return {
    stores,
    fetchLog,
    dispatchFetch,
    dispatchActivate,
    setFetch(fn) {
      fetchImpl = fn;
    },
  };
}

test('audio is cache-first: the second request never touches the network', async () => {
  const sw = loadSW();
  const url = ORIGIN + '/assets/audio/hal_greeting.mp3';

  const first = await sw.dispatchFetch(url);
  assert.equal(first.body, 'net:' + url, 'first play comes from the network');
  assert.equal(sw.fetchLog.length, 1);

  const second = await sw.dispatchFetch(url);
  assert.equal(second.body, 'net:' + url, 'second play is served');
  assert.equal(sw.fetchLog.length, 1, 'second play must be a cache hit — no new fetch');
});

test('audio fetches by URL so a Range request still caches the full file', async () => {
  const sw = loadSW();
  const url = ORIGIN + '/assets/audio/daisy.mp3';
  sw.setFetch(async (input) => {
    assert.equal(
      typeof input,
      'string',
      'audio must be fetched by URL (drops the Range header)'
    );
    return {
      status: 200,
      url: input,
      body: 'full',
      clone() {
        return { ...this };
      },
    };
  });
  const resp = await sw.dispatchFetch(url);
  assert.equal(resp.body, 'full');
});

test('other same-origin GETs are stale-while-revalidate', async () => {
  const sw = loadSW();
  const url = ORIGIN + '/app.js';

  // first load: network (nothing cached yet)
  let v = 1;
  sw.setFetch(async (input) => ({
    status: 200,
    body: 'v' + v,
    clone() {
      return { ...this };
    },
    url: typeof input === 'string' ? input : input.url,
  }));
  const first = await sw.dispatchFetch(url);
  assert.equal(first.body, 'v1');

  // second load after a deploy: cached v1 served instantly, v2 refreshed behind it
  v = 2;
  const second = await sw.dispatchFetch(url);
  assert.equal(second.body, 'v1', 'stale copy is served');
  const third = await sw.dispatchFetch(url);
  assert.equal(third.body, 'v2', 'background refresh updated the cache for next load');
});

test('a failed background refresh keeps the cached copy (offline revisit works)', async () => {
  const sw = loadSW();
  const url = ORIGIN + '/index.html';
  await sw.dispatchFetch(url); // populate
  sw.setFetch(async () => {
    throw new Error('offline');
  });
  const offline = await sw.dispatchFetch(url);
  assert.equal(
    offline.body,
    'net:' + url,
    'cached copy still served when the network is down'
  );
});

test('non-200 responses are never cached', async () => {
  const sw = loadSW();
  const url = ORIGIN + '/missing.js';
  sw.setFetch(async () => ({
    status: 404,
    body: 'nope',
    clone() {
      return { ...this };
    },
  }));
  await sw.dispatchFetch(url);
  sw.setFetch(async () => ({
    status: 200,
    body: 'found',
    clone() {
      return { ...this };
    },
  }));
  const second = await sw.dispatchFetch(url);
  assert.equal(second.body, 'found', 'the 404 must not have been cached');
});

test('cross-origin and non-GET requests pass through untouched', async () => {
  const sw = loadSW();
  assert.equal(
    await sw.dispatchFetch(
      'https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js'
    ),
    null,
    'CDN requests must not be intercepted'
  );
  assert.equal(
    await sw.dispatchFetch(
      'https://nlflqwapol.execute-api.us-east-1.amazonaws.com/turn',
      'POST'
    ),
    null,
    'hal-worker API calls must not be intercepted'
  );
  assert.equal(
    await sw.dispatchFetch(ORIGIN + '/anything', 'POST'),
    null,
    'non-GET must not be intercepted'
  );
  assert.equal(sw.fetchLog.length, 0);
});

test('activate prunes caches from older versions', async () => {
  const sw = loadSW({ preExistingCaches: ['ilaird-static-v0', 'ilaird-audio-v0'] });
  await sw.dispatchFetch(ORIGIN + '/app.js'); // creates the current static cache
  await sw.dispatchActivate();
  const names = [...sw.stores.keys()];
  assert.ok(!names.includes('ilaird-static-v0'), 'old static cache should be deleted');
  assert.ok(!names.includes('ilaird-audio-v0'), 'old audio cache should be deleted');
  assert.ok(
    names.some((n) => /^ilaird-static-v/.test(n)),
    'current static cache should survive'
  );
});
