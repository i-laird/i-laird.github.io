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
// vm-based script runner — keeps app.js/stickfighter.js visible to test coverage
// (a <script> element attributes them to an anonymous eval). See boot-page.js.
const { runScripts } = require('./helpers/boot-page');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// The page's script chain, in index.html order (lib/rng.js feeds the game's PRNG).
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'secrets.js', // defines window.initSecrets, which app.js calls at load
  'app.js',
];

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
  // Per-tick chunk hashes: a new chunk starts at each full-screen clearRect (one per
  // rendered tick), so two runs can be compared tick-by-tick — needed for the
  // refresh-rate test, where the accumulator allows ±1 tick at the span boundary.
  const chunkHashes = [];
  let ch = 5381 >>> 0;
  const fold = (s) => {
    for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
    if (s.startsWith('clearRect')) {
      chunkHashes.push(ch);
      ch = 5381 >>> 0;
    }
    for (let i = 0; i < s.length; i++) ch = (((ch << 5) + ch) ^ s.charCodeAt(i)) >>> 0;
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
  return {
    ctx,
    getHash: () => h,
    getCalls: () => calls,
    getChunks: () => {
      chunkHashes.push(ch);
      return chunkHashes.slice();
    },
  };
}

// Run the real game headlessly and return the hash of everything it drew.
// `seed` is the ONLY entropy: we stub the seed draw (Date.now/Math.random in
// init()) so the whole run is a function of it. `frameMs` simulates the display's
// refresh interval (16 ≈ 60 Hz, 8 ≈ 120 Hz) — `frames` is normalized so the same
// wall-clock span is covered either way. `reduceMotion` sets the bridge flag.
async function runGame({ seed, frames, frameMs = 16, reduceMotion = false }) {
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

  runScripts(dom, SCRIPTS);
  await window.boot();

  // Inject the lazily-loaded game into the same global scope (as the real page does
  // on first launch), so openStickFighter becomes available.
  runScripts(dom, ['stickfighter.js']);
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

  // The game takes its app.js dependencies through an explicit bridge (app.js's
  // sfBridge()). Reconstruct a minimal one: the real makeRng (so seeding is the real
  // PRNG, instrumented to count rnd() draws), no-op/static stand-ins for the rest.
  // Static flags are fine here — compared runs use the same bridge, so the sim stays
  // a pure function of the seed (the reduceMotion test compares only rnd counts).
  let rndCalls = 0;
  const api = {
    unlockAchievement: window.unlockAchievement, // function decl → on window
    _chirp: window._chirp, // no-ops anyway (sound off + no AudioContext)
    makeRng: (s) => {
      const f = window.makeRng(s); // the real seeded PRNG
      return () => {
        rndCalls++;
        return f();
      };
    },
    HAL_WORKER_URL: 'https://example.invalid', // leaderboard only fires on death; fetch is stubbed to reject
    soundEnabled: false,
    reduceMotion,
    activeMusic: null,
  };
  window.openStickFighter(xp, api); // runs init() (seeds the PRNG) + the first frameStep()
  // Leave the intro (Enter begins the run in the highlighted mode — 1-PLAYER by default), then
  // hold a direction so the sim actually advances (waves spawn, enemies pursue — all RNG-driven).
  // Held-key input only: it is cadence-independent, so cross-refresh-rate runs see the
  // identical per-tick input surface (edge-triggered events would need tick-stamping).
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter' }));
  // the run opens on the boon chooser (opened synchronously at begin) — take the first
  // offer. Same wall-time-zero slot as Enter, so it's cadence-independent like held keys.
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'z' }));
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

  const pumps = Math.round((frames * 16) / frameMs); // same wall-clock span at any cadence
  for (let i = 0; i < pumps; i++) {
    const cbs = raf;
    raf = [];
    for (const cb of cbs) cb(frameMs * i);
  }

  const result = {
    hash: rec.getHash(),
    calls: rec.getCalls(),
    chunks: rec.getChunks(),
    rndCalls,
    errors,
  };
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

test('the sim rate is independent of display refresh rate (60 Hz vs 120 Hz)', async () => {
  // The fixed-timestep driver must advance the same tick stream per unit wall time no
  // matter how often rAF fires. Chunk hashes (one per rendered tick) let us compare
  // tick-by-tick: every shared tick must be bit-identical, and the totals may differ
  // only by the one boundary tick the accumulator hasn't finished at the cut-off.
  const hz60 = await runGame({ seed: 42, frames: 220, frameMs: 16 });
  const hz120 = await runGame({ seed: 42, frames: 220, frameMs: 8 });
  assert.ok(
    Math.abs(hz60.chunks.length - hz120.chunks.length) <= 1,
    `tick counts must match within the boundary tick (${hz60.chunks.length} vs ${hz120.chunks.length})`
  );
  const shared = Math.min(hz60.chunks.length, hz120.chunks.length);
  assert.ok(shared > 100, `runs should share real gameplay ticks (${shared})`);
  for (let c = 0; c < shared; c++) {
    assert.equal(
      hz60.chunks[c],
      hz120.chunks[c],
      `60 Hz and 120 Hz diverged at tick chunk ${c} — the sim is refresh-rate dependent`
    );
  }
});

test('reduceMotion does not shift the RNG stream (settings-independent consumption)', async () => {
  // Cross-machine determinism rule: a client-side setting must never change how many
  // rnd() draws the sim makes. Every reduceMotion branch consumes its rolls first and
  // only gates the visual effect — this pins that (via the instrumented makeRng).
  const off = await runGame({ seed: 7, frames: 400, reduceMotion: false });
  const on = await runGame({ seed: 7, frames: 400, reduceMotion: true });
  assert.ok(off.rndCalls > 0, 'the run should consume RNG');
  assert.equal(
    off.rndCalls,
    on.rndCalls,
    `reduceMotion changed rnd() consumption (${off.rndCalls} vs ${on.rndCalls})`
  );
});
