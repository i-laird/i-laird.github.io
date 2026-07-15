'use strict';

// WYRM & RIDER (the co-op pair) integration test — boots the real page + game in
// jsdom and drives BOTH seats on one keyboard (couch co-op):
//   - the paired pick: cycling P1's class row to the WYRM binds P2 to the RIDER
//   - the trample: P1 gallops the beast through wave-1 goblins → kills land
//     while both stay alive (the joust rule on the big body)
//   - skewer-or-die still binds the pair: all keys released, the wyrm is caught
//     slow, the rider is thrown, and the horde finishes both → death screen
// Deterministic: Math.random/Date.now pinned.

const { test } = require('node:test');
const assert = require('node:assert/strict');
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function bootGame() {
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
  window.fetch = () => Promise.reject(new Error('offline (wyrm test)'));
  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }
  await window.boot();
  const sf = window.document.createElement('script');
  sf.textContent = read('stickfighter.js');
  window.document.body.appendChild(sf);
  window.Math.random = () => 0.5;
  window.Date.now = () => 1234567890;
  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};
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
      if (!methods[prop]) methods[prop] = () => {};
      return methods[prop];
    },
    set(_t, prop, val) {
      store[prop] = val;
      return true;
    },
  });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
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
    key(k, code) {
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, ...(code && { code }) })
      );
    },
    keyUp(k) {
      window.document.dispatchEvent(new window.KeyboardEvent('keyup', { key: k }));
    },
    hud() {
      for (const el of xp.children) if (el.tagName === 'DIV') return el.innerHTML;
      return '';
    },
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

test('wyrm & rider: the pair binds, the beast tramples, and slow is still death', async (t) => {
  const g = await bootGame();
  t.after(() => g.dom.window.close());

  g.pump(2);
  g.key('2'); // quick-jump: MULTIPLAYER · LOCAL (couch co-op)
  g.key('ArrowDown');
  g.key('ArrowDown'); // down to P1's class row
  g.key('ArrowLeft'); // melee ← wraps → the WYRM pill (last in P1's paired list)
  g.key('Enter'); // party sheet (the couch co-op confirm gate)
  g.key('Enter'); // confirmed — begin
  g.key('z'); // P1 takes their boon...
  g.key('z'); // ...and P2 takes their own (co-op boons are per player)

  // P1 gallops the wyrm on a clockwise patrol ('/' flaps); P2 aims the saddle
  // lance east ('d' held) and jabs with F. Enter periodically closes any shop.
  const DIRS = [
    ['ArrowRight', 'ArrowDown'],
    ['ArrowLeft', 'ArrowDown'],
    ['ArrowLeft', 'ArrowUp'],
    ['ArrowRight', 'ArrowUp'],
  ];
  let leg = 0;
  const hold = (ks) => {
    for (const k of ks) g.key(k);
  };
  const drop = (ks) => {
    for (const k of ks) g.keyUp(k);
  };
  hold(DIRS[0]);
  g.key('d'); // P2 aim: east
  let sawKills = 0;
  for (let f = 0; f < 1500; f++) {
    if (f > 0 && f % 70 === 0) {
      drop(DIRS[leg % 4]);
      leg++;
      hold(DIRS[leg % 4]);
    }
    if (f % 10 === 0) g.key('/', 'Slash'); // P1 wing flap
    if (f % 40 === 0) g.key('f'); // P2 lance jab
    if (f > 0 && f % 300 === 0) g.key('e'); // P2 fire breath (fizzles free below the cost)
    if (f > 0 && f % 120 === 0) g.key('Enter'); // close a shop if one opened
    g.pump(1);
    const m = g.hud().match(/KILLS (\d+)/);
    if (m) sawKills = Math.max(sawKills, +m[1]);
    if (f === 900) {
      assert.ok(
        !g.hud().includes('play again'),
        'the galloping pair must still be alive at ~tick 900 (hud: ' +
          g.hud().slice(0, 120) +
          ')'
      );
    }
    if (f % 200 === 0) await sleep(1);
  }
  assert.ok(
    sawKills >= 3,
    'the wyrm must be trampling — saw only ' + sawKills + ' kills across the gallop'
  );
  drop(DIRS[leg % 4]);
  g.keyUp('d');

  // all hands off: the beast slows below every bar, is caught, throws the rider,
  // and the horde finishes the pair — the joust rule binds the wyrm too
  for (let f = 0; f < 2400 && !g.hud().includes('play again'); f++) {
    if (f % 120 === 0) g.key('Enter');
    g.pump(1);
    if (f % 200 === 0) await sleep(1);
  }
  assert.ok(
    g.hud().includes('play again'),
    'a standing wyrm must be caught, and the pair must fall (hud: ' +
      g.hud().slice(0, 120) +
      ')'
  );

  assert.deepEqual(
    g.errors.map((e) => String(e.detail || e)),
    [],
    'no script errors'
  );
});
