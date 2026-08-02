#!/usr/bin/env node
/* Stick Fighter soak/fuzz harness — `npm run fuzz-sf`.
 *
 * NOT part of `npm test`: a useful sweep takes minutes, which is too slow for
 * every commit. Run it before a release, and after any balance or AI change.
 *
 * What it catches that the unit suites don't:
 *   The determinism tests hash the draw stream to prove two runs MATCH. This
 *   one INSPECTS the stream instead: any draw op with a NaN or Infinity
 *   argument means an entity's position, size or angle went non-finite. Canvas
 *   silently ignores such an op, so it is invisible in play — but the value is
 *   in the sim, it spreads, and in netplay it desyncs. Nothing else in the
 *   suite would notice.
 *   It also fails on any uncaught script error thrown from the frame loop.
 *
 * It drives the REAL game (real page + real stickfighter.js in jsdom, manual
 * rAF pump), so it exercises the shipped code path, not a model of it.
 *
 * Usage:
 *   npm run fuzz-sf                          # default sweep
 *   npm run fuzz-sf -- --seeds=1,2 --frames=4000
 *   npm run fuzz-sf -- --warps=3,6,9         # jump straight to bosses
 *   npm run fuzz-sf -- --coop                # couch co-op (two heroes)
 *   npm run fuzz-sf -- --quick               # small smoke sweep
 *
 * Exits non-zero if anything is found, so it can gate a release.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'app.js',
];

// '9' spam warps ahead; the count picks the destination (see 23-input.js).
const WARP_NAME = {
  0: 'wave 1',
  3: 'the Nine',
  4: 'Witch-king',
  5: 'east door',
  6: 'Vader',
  7: 'Sidious',
  8: 'DIO',
  9: 'Ian',
};

function arg(name, def) {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : def;
}
const flag = (name) => process.argv.includes(`--${name}`);

/* A 2D-context stand-in that flags any non-finite argument. Every unknown
   property is treated as a recording no-op method, so the game can call
   whatever it likes without the harness needing to model the canvas API. */
function makeInspectCtx(window) {
  const bad = [];
  let calls = 0;
  const canvasEl = window.document.createElement('canvas');
  canvasEl.width = 800;
  canvasEl.height = 600;
  const grad = { addColorStop() {} };
  const target = {
    canvas: canvasEl,
    measureText: (t) => ({ width: String(t).length * 6 }),
    createLinearGradient: () => grad,
    createRadialGradient: () => grad,
    createPattern: () => null,
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    putImageData() {},
    drawImage() {},
    setLineDash() {},
    save() {},
    restore() {},
  };
  return {
    ctx: new Proxy(target, {
      get(t, prop) {
        if (prop in t) return t[prop];
        if (typeof prop !== 'string') return undefined;
        return (...args) => {
          calls++;
          for (const a of args) {
            if (typeof a === 'number' && !Number.isFinite(a)) {
              bad.push({ op: prop, args: args.slice(0, 6) });
              break;
            }
          }
        };
      },
      set(t, prop, v) {
        if (typeof v === 'number' && !Number.isFinite(v)) {
          bad.push({ op: `set ${String(prop)}`, args: [v] });
        }
        t[prop] = v;
        return true;
      },
    }),
    getBad: () => bad,
    getCalls: () => calls,
  };
}

async function runOne({ seed, frames, classIdx, warp, coop }) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(String(e.message || e).slice(0, 200)));

  const dom = new JSDOM(read('index.html'), {
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
  window.fetch = () => Promise.reject(new Error('offline (fuzz harness)'));
  window.addEventListener('error', (e) =>
    errors.push('window.error ' + String(e.message || e).slice(0, 200))
  );

  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }
  await window.boot();
  const sf = window.document.createElement('script');
  sf.textContent = read('stickfighter.js');
  window.document.body.appendChild(sf);

  // Pin the run's only entropy so a finding is reproducible from its seed.
  window.Math.random = () => 0;
  window.Date.now = () => seed >>> 0;

  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};
  const rec = makeInspectCtx(window);
  window.HTMLCanvasElement.prototype.getContext = () => rec.ctx;

  const xp = window.document.createElement('div');
  Object.defineProperty(xp, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(xp, 'offsetHeight', { configurable: true, value: 600 });
  window.document.body.appendChild(xp);

  window.openStickFighter(xp, {
    unlockAchievement: window.unlockAchievement,
    _chirp: window._chirp,
    makeRng: (s) => window.makeRng(s),
    HAL_WORKER_URL: 'https://example.invalid',
    soundEnabled: false,
    reduceMotion: false,
    activeMusic: null,
  });

  const key = (k) =>
    window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: k }));
  const up = (k) =>
    window.document.dispatchEvent(new window.KeyboardEvent('keyup', { key: k }));

  /* Intro navigation. Rows are 0 = SINGLE/MULTI, 1 = sub-mode, 2 = P1 class
     (3 = P2 class in couch co-op). ArrowRight on row 0 toggles SINGLE/MULTI —
     getting this wrong silently parks the run on the online lobby and the
     "sweep" then proves nothing, so the caller checks that draw counts vary. */
  if (coop) key('2'); // quick-jump: couch co-op
  key('ArrowDown');
  key('ArrowDown'); // → the class row
  for (let i = 0; i < classIdx; i++) key('ArrowRight');
  key('Enter');
  if (coop) key('Enter'); // couch co-op shows a party sheet; confirm it
  // One boon offer PER HERO — couch co-op asks Player 1 then Player 2, and the
  // run does not begin until both are taken. Sending a single `z` parked the
  // whole co-op sweep on Player 2's chooser (the varied-draw-count guard below
  // is what caught it).
  key('z');
  if (coop) key('z');
  key('ArrowRight');
  // Boss warp: the '9' counter resets after 1500ms of real time, so these must
  // be dispatched back to back.
  for (let i = 0; i < warp; i++) key('9');

  for (let i = 0; i < frames; i++) {
    const cbs = raf;
    raf = [];
    for (const cb of cbs) {
      try {
        cb(16 * i);
      } catch (e) {
        errors.push('THROW ' + String((e && e.message) || e).slice(0, 200));
      }
    }
    // Stir the inputs so a run explores more than one corner of the state space.
    if (i % 97 === 0) key('x');
    if (i % 131 === 0) {
      up('ArrowRight');
      key('ArrowLeft');
    }
    if (i % 173 === 0) {
      up('ArrowLeft');
      key('ArrowRight');
    }
    if (i % 211 === 0) key('Shift');
  }

  const out = { bad: rec.getBad(), calls: rec.getCalls(), errors };
  dom.window.close(); // stop jsdom timers
  return out;
}

(async () => {
  const quick = flag('quick');
  const seeds = String(arg('seeds', quick ? '7,101' : '7,101,2024,55555,987654,31337'))
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const frames = Number(arg('frames', quick ? 1200 : 4000));
  const classes = Number(arg('classes', 5));
  const warps = String(arg('warps', quick ? '0' : '0,3,6,9'))
    .split(',')
    .map(Number)
    .filter((n) => Number.isFinite(n));
  const coop = flag('coop');

  const total = seeds.length * warps.length * classes;
  console.log(
    `Stick Fighter fuzz — ${total} runs · ${frames} frames · ` +
      `${coop ? 'couch co-op' : 'solo'} · classes 0-${classes - 1} · ` +
      `warps [${warps.map((w) => WARP_NAME[w] || w).join(', ')}]\n`
  );

  let badTotal = 0;
  let errTotal = 0;
  const drawCounts = new Set();
  let n = 0;

  for (const seed of seeds) {
    for (const warp of warps) {
      for (let c = 0; c < classes; c++) {
        const r = await runOne({ seed, frames, classIdx: c, warp, coop });
        n++;
        badTotal += r.bad.length;
        errTotal += r.errors.length;
        drawCounts.add(r.calls);
        const mark = r.bad.length || r.errors.length ? '  <-- FINDING' : '';
        console.log(
          `[${String(n).padStart(3)}/${total}] seed ${String(seed).padStart(7)} ` +
            `${String(WARP_NAME[warp] || warp).padEnd(11)} class ${c}  ` +
            `draws ${String(r.calls).padStart(8)}  non-finite ${String(r.bad.length).padStart(5)}  ` +
            `errors ${r.errors.length}${mark}`
        );
        if (r.bad.length) {
          const byOp = {};
          for (const b of r.bad) byOp[b.op] = (byOp[b.op] || 0) + 1;
          console.log('        ops:  ', JSON.stringify(byOp).slice(0, 300));
          console.log('        first:', JSON.stringify(r.bad[0]).slice(0, 240));
        }
        for (const e of [...new Set(r.errors)].slice(0, 3)) console.log('        err:  ', e);
      }
    }
  }

  console.log(`\n${'-'.repeat(64)}`);
  console.log(`runs ${n} · non-finite draw ops ${badTotal} · script errors ${errTotal}`);

  /* Guard against a silently useless sweep. If every run produced the same
     number of draw ops, the inputs never actually varied the run — which is
     exactly the failure that made an early version of this harness report a
     clean sweep while testing one class parked on a menu. */
  if (drawCounts.size === 1 && n > 1) {
    console.error(
      '\n✗ every run produced an identical draw count — the runs did not vary.\n' +
        '  The sweep proved nothing. Check the intro navigation above.'
    );
    process.exit(1);
  }

  if (badTotal || errTotal) {
    console.error('\n✗ findings above. Each is reproducible: same --seeds/--frames/--warps.');
    process.exit(1);
  }
  console.log('✓ clean');
})();
