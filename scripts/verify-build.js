'use strict';

/*
 * Post-build verification. Heavy obfuscation can subtly break things that "it
 * parses" won't catch, and the failure is invisible until you click around the
 * live site. So before deploying dist/ we:
 *   1. Boot the REAL obfuscated bundle (dist/app.js) in jsdom and assert the
 *      terminal comes up and the inline-handler public API survived.
 *   2. Drive the obfuscated game chunk (dist/stickfighter.js) headlessly and time
 *      it against the clean source — confirming the light config kept the 60fps
 *      loop's JS overhead negligible (this is the whole point of the heavy/light
 *      split).
 *
 * Run after `npm run build`. Exits non-zero on failure so CI can gate on it.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(p, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom(html) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(html, {
    url: 'https://ianclaird.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  window.fetch = () => Promise.reject(new Error('offline'));
  if (window.HTMLCanvasElement) window.HTMLCanvasElement.prototype.getContext = () => null;
  return { dom, window, errors };
}

function inject(window, code) {
  const el = window.document.createElement('script');
  el.textContent = code;
  window.document.body.appendChild(el);
}

// ── 1. The obfuscated main bundle boots and keeps its public API ──────────────
async function verifyBoot() {
  const html = read(path.join(DIST, 'index.html'));
  const { dom, window, errors } = makeDom(html);
  inject(window, read(path.join(DIST, 'app.js'))); // the IIFE auto-calls boot()

  // Wait for boot()'s async tail: it appends the banner synchronously but only
  // reveals the input row after an internal sleep(40), so poll on that.
  const inputRow = window.document.getElementById('input-row');
  for (let i = 0; i < 100 && inputRow.style.display !== 'flex'; i++) await sleep(20);

  const out = window.document.getElementById('out').textContent;
  assert.match(out, /IAN {2}LAIRD/, 'obfuscated bundle: boot banner should render');
  assert.equal(
    inputRow.style.display,
    'flex',
    'obfuscated bundle: input row should be revealed'
  );
  for (const fn of ['toggleSound', 'focusCmd', 'unlockAchievement', 'toggleAchievements']) {
    assert.equal(
      typeof window[fn],
      'function',
      `obfuscated bundle: window.${fn} must survive for inline HTML handlers`
    );
  }
  assert.deepEqual(
    errors.map((e) => String(e.detail || e)),
    [],
    'obfuscated bundle: no script errors during load + boot'
  );
  dom.window.close();
  console.log('✓ obfuscated main bundle boots; public API intact');
}

// ── 2. Time the game chunk: obfuscated vs clean ───────────────────────────────
const NOOP_CTX = () => {
  const grad = { addColorStop() {} };
  const fns = {};
  return new Proxy(
    {},
    {
      get(_t, p) {
        if (p === 'canvas') return { width: 800, height: 600 };
        if (p === 'measureText') return () => ({ width: 7 });
        if (
          p === 'createLinearGradient' ||
          p === 'createRadialGradient' ||
          p === 'createPattern'
        )
          return () => grad;
        if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (!fns[p]) fns[p] = () => {};
        return fns[p];
      },
      set: () => true,
    }
  );
};

// Minimal mulberry32 so the game's PRNG runs (matches lib/rng.js).
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function timeGame(stickfighterCode, frames) {
  const { dom, window } = makeDom('<!doctype html><html><body></body></html>');
  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};
  window.HTMLCanvasElement.prototype.getContext = NOOP_CTX;

  // Pin the seed (init() draws it from Date.now ^ Math.random) so BOTH variants
  // simulate the identical game — the only timing difference is then obfuscation
  // overhead, not which run happened to die early onto the cheap death screen.
  window.Math.random = () => 0;
  window.Date.now = () => 1234;

  inject(window, stickfighterCode);
  const xp = window.document.createElement('div');
  Object.defineProperty(xp, 'offsetWidth', { value: 800 });
  Object.defineProperty(xp, 'offsetHeight', { value: 600 });
  window.document.body.appendChild(xp);

  const api = {
    unlockAchievement: () => {},
    _chirp: () => {},
    makeRng,
    HAL_WORKER_URL: 'https://example.invalid',
    soundEnabled: false,
    reduceMotion: false,
    activeMusic: null,
  };
  window.openStickFighter(xp, api);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

  const pump = (n) => {
    for (let i = 0; i < n; i++) {
      const cbs = raf;
      raf = [];
      for (const cb of cbs) cb(16 * i);
    }
  };
  pump(120); // warm up V8
  const t0 = process.hrtime.bigint();
  pump(frames);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  dom.window.close();
  return ms;
}

function verifyGamePerf() {
  const FRAMES = 2000;
  const clean = timeGame(read(path.join(ROOT, 'stickfighter.js')), FRAMES);
  const obf = timeGame(read(path.join(DIST, 'stickfighter.js')), FRAMES);
  const overhead = ((obf / clean - 1) * 100).toFixed(1);
  console.log(
    `✓ game chunk: ${FRAMES} ticks — clean ${clean.toFixed(0)}ms vs obfuscated ${obf.toFixed(0)}ms ` +
      `(${overhead >= 0 ? '+' : ''}${overhead}% JS overhead)`
  );
  // Light config should keep overhead modest. Fail loudly if it regresses badly
  // (e.g. someone turns control-flow flattening on for the game chunk).
  assert.ok(
    obf / clean < 1.6,
    `game JS overhead too high (${overhead}%) — keep the LIGHT config`
  );
}

(async () => {
  await verifyBoot();
  verifyGamePerf();
  console.log('\nBuild verified.');
})().catch((e) => {
  console.error('\n✗ build verification FAILED:\n', e.message);
  process.exit(1);
});
