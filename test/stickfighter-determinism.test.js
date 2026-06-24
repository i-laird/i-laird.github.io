'use strict';

// Stick Fighter determinism integration test.
//
// The game's simulation was refactored to be a pure function of (seed, inputs):
// all gameplay randomness flows through a seeded PRNG (lib/rng.js) and timing runs
// off a monotonic tick counter instead of the wall clock. That's the groundwork
// for replays / future lockstep multiplayer — and this test is its regression guard.
//
// We can't read the game's internal state (it all lives inside the openStickFighter
// closure), so instead we observe its *output*: a recording 2D-canvas context folds
// every draw operation into a rolling hash. The draw stream is a faithful projection
// of the sim (every entity position, telegraph, particle is drawn), so:
//   - same seed + same inputs  → identical hash  (determinism)
//   - different seed           → different hash   (proves the stream reflects the
//                                                  RNG-driven sim, i.e. the run
//                                                  actually reached gameplay, not
//                                                  just the static intro screen)
//
// The harness drives the REAL game: it loads the real page (lib + app.js) like the
// boot smoke test, injects the real stickfighter.js into the shared scope, then
// pumps an exact number of deterministic ticks via a manual requestAnimationFrame.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The page's script chain, in index.html order (lib/rng.js feeds the game's PRNG).
const SCRIPTS = ['lib/codec.js', 'lib/timing.js', 'lib/text.js', 'lib/rng.js', 'app.js'];

// Same minimal browser-API shims the boot test uses (jsdom lacks them; app.js and the
// game feature-guard AudioContext/matchMedia, so leaving those undefined is correct).
function installShims(window) {
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  window.fetch = () => Promise.reject(new Error('offline (determinism test)'));
}

// A 2D-context stand-in that records every operation into a rolling 32-bit hash
// (djb2). It returns sane, deterministic values for the few calls the game reads
// back (measureText, gradients), and treats every other property access as a
// recording no-op method. Two identical sims produce an identical call sequence
// and therefore an identical hash.
function makeRecordingCtx(window) {
  let h = 5381 >>> 0;
  let calls = 0;
  const fold = (s) => {
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  };
  const canvasEl = window.document.createElement('canvas');
  canvasEl.width = 800;
  canvasEl.height = 600;
  const gradient = { addColorStop() {} };
  const store = {};
  const methods = {};
  const ctx = new Proxy(store, {
    get(_t, prop) {
      if (prop === 'canvas') return canvasEl;
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'measureText') {
        return (s) => {
          fold('measureText|' + s);
          return { width: String(s).length * 7 };
        };
      }
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createConicGradient' ||
        prop === 'createPattern'
      ) {
        return (...a) => {
          fold(prop + '|' + a.join(','));
          return gradient;
        };
      }
      if (prop === 'getImageData') {
        return (...a) => {
          fold('getImageData|' + a.join(','));
          return { data: new Uint8ClampedArray(4), width: 1, height: 1 };
        };
      }
      // A data property that was previously assigned (e.g. lineWidth) — return it.
      if (Object.prototype.hasOwnProperty.call(store, prop)) return store[prop];
      // Otherwise treat it as a (memoized) recording method.
      if (!methods[prop]) {
        methods[prop] = (...args) => {
          calls++;
          fold(prop + '|' + args.join(','));
        };
      }
      return methods[prop];
    },
    set(_t, prop, val) {
      store[prop] = val;
      fold('=' + String(prop) + '|' + String(val));
      return true;
    },
  });
  return { ctx, getHash: () => h, getCalls: () => calls };
}

// Run the real game headlessly for `frames` deterministic ticks and return the
// hash of everything it drew. `seed` is the ONLY entropy: we stub the seed draw
// (Date.now/Math.random in init()) so the whole run is a function of it.
async function runGame({ seed, frames }) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));

  const dom = new JSDOM(read('index.html'), {
    url: 'https://ianclaird.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  installShims(window);

  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }
  await window.boot();

  // Inject the lazily-loaded game into the same global scope (as the real page does
  // on first launch), so openStickFighter becomes available.
  const sf = window.document.createElement('script');
  sf.textContent = read('stickfighter.js');
  window.document.body.appendChild(sf);
  assert.equal(
    typeof window.openStickFighter,
    'function',
    'openStickFighter should be a global'
  );

  // Pin the run's only entropy: init() draws its seed from Date.now ^ Math.random.
  // Fixing both makes sfSeed a pure function of `seed`.
  window.Math.random = () => 0;
  window.Date.now = () => seed >>> 0;

  // Manual rAF pump → we control the exact number of ticks (the game's frameStep
  // self-schedules via requestAnimationFrame and runs one loop() per frame at SF_SPEED
  // 1.0 on localhost).
  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};

  // Recording canvas: getContext('2d') hands the game our hashing context.
  const rec = makeRecordingCtx(window);
  window.HTMLCanvasElement.prototype.getContext = () => rec.ctx;

  // A desktop surface with real dimensions (jsdom reports offsetWidth/Height as 0).
  const xp = window.document.createElement('div');
  Object.defineProperty(xp, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(xp, 'offsetHeight', { configurable: true, value: 600 });
  window.document.body.appendChild(xp);

  window.openStickFighter(xp); // runs init() (seeds the PRNG) + the first frameStep()
  // Leave the intro and hold a direction so the sim actually advances (waves spawn,
  // enemies pursue — all RNG-driven).
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

  for (let i = 0; i < frames; i++) {
    const cbs = raf;
    raf = [];
    for (const cb of cbs) cb(16 * i);
  }

  const result = { hash: rec.getHash(), calls: rec.getCalls(), errors };
  dom.window.close(); // stop jsdom timers (e.g. the 60s egg-nudge)
  return result;
}

test('a run is reproducible from its seed (identical seed + inputs → identical sim)', async () => {
  const a = await runGame({ seed: 12345, frames: 220 });
  const b = await runGame({ seed: 12345, frames: 220 });

  assert.deepEqual(
    a.errors.map((e) => String(e.detail || e)),
    [],
    'no script errors should occur while the game runs'
  );
  assert.ok(a.calls > 1000, `the game should reach real gameplay (only ${a.calls} draw ops)`);
  assert.equal(a.hash, b.hash, 'same seed + inputs must produce a bit-identical draw stream');
});

test('a different seed diverges (the draw stream reflects RNG-driven gameplay)', async () => {
  // Also a guard that the determinism test above isn't trivially equal: if the run
  // never left the (RNG-free) intro, different seeds would collide here and fail.
  const a = await runGame({ seed: 1, frames: 220 });
  const c = await runGame({ seed: 999, frames: 220 });
  assert.notEqual(a.hash, c.hash, 'different seeds should produce different runs');
});
