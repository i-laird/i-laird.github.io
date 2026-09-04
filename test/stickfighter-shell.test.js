'use strict';

// The shell features — rebinding, gamepad, bestiary, death recap, mutators —
// driven through the real page + game in jsdom. The load-bearing claims:
//   - REBINDING is a translation, not a sim change: a run driven on a rebound
//     key produces the IDENTICAL draw stream to the default-key run, and the
//     key it was rebound away from goes dead;
//   - a GAMEPAD is the same translation: stick-right equals ArrowRight, and
//     A begins/confirms like Z;
//   - the BESTIARY ledger fills from a real run and persists, and the panel
//     masks secrets until met;
//   - the DEATH RECAP names the killer and offers counsel on the results screen;
//   - MUTATED runs roll three modifiers deterministically from the seed, tag the
//     HUD, and are unranked.
// Deterministic: Math.random/Date.now are pinned, so every run here is a pure
// function of the driving pattern.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
const { runScripts } = require('./helpers/boot-page');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'secrets.js',
  'app.js',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootGame(opts = {}) {
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
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  window.fetch = () => Promise.reject(new Error('offline (shell test)'));
  if (opts.storage)
    for (const [k, v] of Object.entries(opts.storage)) window.localStorage.setItem(k, v);

  runScripts(dom, SCRIPTS);
  await window.boot();
  runScripts(dom, ['stickfighter.js']);

  window.Math.random = () => 0.5;
  window.Date.now = () => 1234567890;

  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};

  // a recording context: every draw op folds into a rolling hash (for the
  // equivalence claims) and every fillText string is kept (for the screen text)
  let hash = 2166136261;
  const texts = [];
  let recording = false;
  const fold = (s) => {
    for (let i = 0; i < s.length; i++) {
      hash ^= s.charCodeAt(i);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
  };
  const gradient = { addColorStop() {} };
  const canvasEl = window.document.createElement('canvas');
  const methods = {};
  const store = {};
  const ctx = new Proxy(store, {
    get(_t, prop) {
      if (prop === 'canvas') return canvasEl;
      if (typeof prop === 'symbol') return undefined;
      if (prop === 'measureText') return (s) => ({ width: String(s).length * 7 });
      if (
        prop === 'createLinearGradient' ||
        prop === 'createRadialGradient' ||
        prop === 'createConicGradient' ||
        prop === 'createPattern'
      )
        return () => gradient;
      if (prop === 'getImageData')
        return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 });
      if (Object.prototype.hasOwnProperty.call(store, prop)) return store[prop];
      if (!methods[prop])
        methods[prop] = (...args) => {
          if (prop === 'fillText') texts.push(String(args[0]));
          if (recording)
            fold(
              prop +
                ':' +
                args.map((a) => (typeof a === 'number' ? a.toFixed(2) : String(a))).join(',')
            );
        };
      return methods[prop];
    },
    set(_t, prop, val) {
      store[prop] = val;
      return true;
    },
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;

  // an optional standard-mapping gamepad behind navigator.getGamepads
  const pad = {
    connected: true,
    id: 'test pad',
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0 })),
    axes: [0, 0, 0, 0],
  };
  Object.defineProperty(window.navigator, 'getGamepads', {
    configurable: true,
    value: () => (opts.pad ? [pad] : []),
  });

  const xp = window.document.createElement('div');
  Object.defineProperty(xp, 'offsetWidth', { configurable: true, value: 800 });
  Object.defineProperty(xp, 'offsetHeight', { configurable: true, value: 600 });
  window.document.body.appendChild(xp);

  window.openStickFighter(xp, {
    unlockAchievement: window.unlockAchievement,
    _chirp: window._chirp,
    makeRng: window.makeRng,
    HAL_WORKER_URL: '',
    soundEnabled: false,
    reduceMotion: false,
    activeMusic: null,
  });

  let ts = 0;
  return {
    dom,
    errors,
    pad,
    window,
    key(k, code) {
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, code: code || '' })
      );
    },
    keyUp(k, code) {
      window.document.dispatchEvent(
        new window.KeyboardEvent('keyup', { key: k, code: code || '' })
      );
    },
    hud() {
      for (const el of xp.children) if (el.tagName === 'DIV') return el.innerHTML;
      return '';
    },
    texts,
    clearTexts() {
      texts.length = 0;
    },
    record(on) {
      recording = on;
      if (on) hash = 2166136261;
    },
    hash: () => hash,
    pump(frames = 1) {
      for (let i = 0; i < frames; i++) {
        ts += 16;
        const cbs = raf;
        raf = [];
        for (const cb of cbs) cb(ts);
      }
    },
  };
}

// begin a solo melee run and take the first boon
function beginRun(g) {
  g.pump(2);
  g.key('Enter');
  g.key('z');
}

test('rebinding: a rebound key reproduces the default-key draw stream, and the old key goes dead', async (t) => {
  // reference: the default keys, ArrowUp held for 240 frames
  const a = await bootGame();
  t.after(() => a.dom.window.close());
  beginRun(a);
  a.key('ArrowUp', 'ArrowUp');
  a.record(true);
  a.pump(240);
  const refHash = a.hash();
  a.record(false);

  // rebind P1 up → I through the title's shell (P → controls › → Enter → press I)
  const b = await bootGame();
  t.after(() => b.dom.window.close());
  b.pump(2);
  b.key('p', 'KeyP');
  b.pump(1);
  assert.ok(b.texts.includes('SETTINGS'), 'P on the title opens the shell');
  b.key('ArrowUp', 'ArrowUp'); // wraps to the last row: controls ›
  b.key('Enter', 'Enter');
  b.clearTexts();
  b.pump(1);
  assert.ok(b.texts.includes('CONTROLS'), 'the controls page opens');
  b.key('Enter', 'Enter'); // capture for the first row (P1 up)
  b.clearTexts();
  b.pump(1);
  assert.ok(b.texts.includes('press a key…'), 'a capture is armed');
  b.key('i', 'KeyI');
  const saved = JSON.parse(b.window.localStorage.getItem('ilaird_sf_opts'));
  assert.equal(saved.binds.p1_up, 'KeyI', 'the binding persists (only the non-default entry)');
  b.key('p', 'KeyP'); // back to the main page
  b.key('p', 'KeyP'); // close the shell
  beginRun(b);
  b.key('i', 'KeyI'); // the rebound key
  b.record(true);
  b.pump(240);
  assert.equal(b.hash(), refHash, 'holding I must drive the identical run ArrowUp did');
  b.record(false);

  // the key it was rebound away from is dead: holding ArrowUp now does not move
  const c = await bootGame({
    storage: {
      ilaird_sf_opts: JSON.stringify({
        shake: 1,
        kick: 1,
        flash: 1,
        hiVis: false,
        binds: { p1_up: 'KeyI' },
      }),
    },
  });
  t.after(() => c.dom.window.close());
  beginRun(c);
  c.key('ArrowUp', 'ArrowUp');
  c.record(true);
  c.pump(240);
  assert.notEqual(c.hash(), refHash, 'the physical ArrowUp is dead once rebound away');
  assert.equal(a.errors.length + b.errors.length + c.errors.length, 0);
});

test('rebinding: blocked keys are refused and a stored junk binding is dropped', async (t) => {
  const g = await bootGame({
    storage: {
      ilaird_sf_opts: JSON.stringify({
        binds: { p1_up: 'Escape', p2_atk: 'KeyF', p1_atk: 'nope!', p1_dash: 'KeyJ' },
      }),
    },
  });
  t.after(() => g.dom.window.close());
  g.pump(1);
  const saved = JSON.parse(g.window.localStorage.getItem('ilaird_sf_opts') || '{}');
  // nothing was re-saved yet, so read through the shell instead: open it and rebind
  g.key('p', 'KeyP');
  g.key('ArrowUp', 'ArrowUp');
  g.key('Enter', 'Enter');
  g.key('Enter', 'Enter'); // capture P1 up
  g.key('q', 'KeyQ'); // blocked — refused, capture stays armed
  g.clearTexts();
  g.pump(1);
  assert.ok(g.texts.includes('press a key…'), 'a blocked key does not end the capture');
  g.key('Backspace', 'Backspace'); // cancel the capture
  g.key('ArrowDown', 'ArrowDown'); // P1 down
  g.key('Enter', 'Enter');
  g.key('k', 'KeyK');
  const now = JSON.parse(g.window.localStorage.getItem('ilaird_sf_opts'));
  assert.deepEqual(
    now.binds,
    { p1_dash: 'KeyJ', p1_down: 'KeyK' },
    'Escape, a default, and junk were dropped; the valid one survived'
  );
  assert.ok(saved, 'sanity');
});

test('gamepad: the stick reproduces the arrow-key draw stream, and A confirms like Z', async (t) => {
  const a = await bootGame();
  t.after(() => a.dom.window.close());
  beginRun(a);
  a.key('ArrowRight', 'ArrowRight');
  a.record(true);
  a.pump(240);
  const refHash = a.hash();
  a.record(false);

  const g = await bootGame({ pad: true });
  t.after(() => g.dom.window.close());
  g.pump(2);
  // A begins the run (Z), release, A takes the boon
  g.pad.buttons[0].pressed = true;
  g.pump(1);
  assert.ok(
    g.hud().includes('boon is offered'),
    'A on the title begins the run (hud: ' + g.hud().slice(0, 80) + ')'
  );
  g.pad.buttons[0].pressed = false;
  g.pump(1);
  g.pad.buttons[0].pressed = true;
  g.pump(1);
  g.pad.buttons[0].pressed = false;
  g.pump(1);
  assert.ok(!g.hud().includes('boon is offered'), 'A takes the boon');

  // the stick: held right from the run's first tick, exactly like the keyboard reference
  const h = await bootGame({ pad: true });
  t.after(() => h.dom.window.close());
  h.pump(2);
  h.key('Enter');
  h.key('z');
  h.pad.axes[0] = 1; // stick right
  h.record(true);
  h.pump(240);
  assert.equal(h.hash(), refHash, 'stick-right must drive the identical run ArrowRight did');
  g.pump(1);
  assert.ok(
    g.texts.some((s) => /gamepad connected/.test(s)),
    'the title advertises the pad'
  );
  assert.equal(a.errors.length + g.errors.length + h.errors.length, 0);
});

test('death recap + bestiary: a real death names the killer, offers counsel, and fills the ledger', async (t) => {
  const g = await bootGame();
  t.after(() => g.dom.window.close());
  beginRun(g);
  // stand still — the first goblin body to arrive is the end
  let f = 0;
  for (; f < 3000 && !g.hud().includes('play again'); f++) {
    if (f % 120 === 0) g.key('Enter');
    g.pump(1);
    if (f % 300 === 0) await sleep(1);
  }
  assert.ok(g.hud().includes('play again'), 'the hero died standing still');
  // the results ceremony (deadT 34→178): let it play and collect the screen text
  g.clearTexts();
  g.pump(200);
  assert.ok(g.texts.includes('slain by'), 'the reckoning has a slain-by row');
  assert.ok(
    g.texts.some((s) => /a goblin/.test(s)),
    'the killer is named'
  );
  assert.ok(
    g.texts.some((s) => /momentum/.test(s)),
    'counsel keyed to goblins is offered'
  );
  assert.ok(g.texts.includes('you fought as'), 'the class row is there');
  // the ledger persisted at death: goblins were seen
  const led = JSON.parse(g.window.localStorage.getItem('ilaird_sf_bestiary'));
  assert.ok(led && led.goblin && led.goblin.seen > 0, 'goblins were catalogued');

  // the panel: goblin is known now, the Nine stay masked
  const h = await bootGame({
    storage: { ilaird_sf_bestiary: g.window.localStorage.getItem('ilaird_sf_bestiary') },
  });
  t.after(() => h.dom.window.close());
  h.pump(2);
  h.key('b', 'KeyB');
  h.clearTexts();
  h.pump(1);
  assert.ok(
    h.texts.some((s) => /BESTIARY/.test(s)),
    'B opens the bestiary'
  );
  assert.ok(h.texts.includes('GOBLIN'), 'a met foe shows its name');
  assert.ok(h.texts.includes('THE TELL'), 'the detail card shows the tell');
  assert.ok(
    h.texts.some((s) => /\? \? \?/.test(s)),
    'unmet secrets stay masked'
  );
  assert.ok(
    h.texts.some((s) => /1 \/ \d+ catalogued/.test(s)),
    'the count reflects one known foe'
  );
  h.key('ArrowDown', 'ArrowDown');
  h.clearTexts();
  h.pump(1);
  assert.ok(
    h.texts.some((s) => /meet it on the field/.test(s)),
    'an unmet entry withholds its page'
  );
  h.key('b', 'KeyB');
  h.clearTexts();
  h.pump(1);
  assert.ok(!h.texts.some((s) => /BESTIARY/.test(s)), 'B closes it again');
  assert.equal(g.errors.length + h.errors.length, 0);
});

test('mutated: three seeded modifiers, tagged and unranked, identical on the same seed', async (t) => {
  const run = async () => {
    const g = await bootGame();
    g.pump(2);
    g.key('ArrowDown'); // the sub-mode row
    g.key('ArrowRight'); // NORMAL → (HARD locked, skipped) → DAILY
    g.key('ArrowRight'); // → MUTATED
    g.clearTexts();
    g.pump(1);
    assert.ok(
      g.texts.some((s) => /MUTATED — the seed deals three/.test(s)),
      'the intro notice explains the mode'
    );
    g.key('Enter');
    g.key('z');
    g.clearTexts();
    g.pump(30);
    assert.ok(
      g.hud().includes('MUTATED'),
      'the wave HUD is tagged (hud: ' + g.hud().slice(0, 100) + ')'
    );
    assert.ok(g.texts.includes('⚗ MUTATED'), 'the mutator card is pinned');
    const NAMES = [
      'SWARM',
      'BLOOD MOON',
      'FOG OF WAR',
      'GLASS AEGIS',
      'LEADEN DASH',
      'DROUGHT',
      'THIN AIR',
      'HUNTED',
      'FEAST',
    ];
    const banner = [
      ...new Set(g.texts.filter((s) => NAMES.some((n) => s.endsWith(' ' + n)))),
    ].join('  ·  ');
    return { g, banner };
  };
  const a = await run();
  t.after(() => a.g.dom.window.close());
  const b = await run();
  t.after(() => b.g.dom.window.close());
  assert.ok(a.banner, 'the start banner lists the mutators');
  assert.equal(a.banner, b.banner, 'the same seed rolls the same three');
  assert.equal((a.banner.match(/·/g) || []).length, 2, 'exactly three modifiers: ' + a.banner);
  // stand still and die: the death screen marks the run unranked
  let f = 0;
  for (; f < 3000 && !a.g.hud().includes('play again'); f++) {
    if (f % 120 === 0) a.g.key('Enter');
    a.g.pump(1);
    if (f % 300 === 0) await sleep(1);
  }
  a.g.key('Enter'); // fast-forward the ceremony
  a.g.clearTexts();
  a.g.pump(2);
  assert.ok(
    a.g.texts.some((s) => /mutated runs are unranked/.test(s)),
    'unranked notice'
  );
  assert.equal(a.g.errors.length + b.g.errors.length, 0);
});
