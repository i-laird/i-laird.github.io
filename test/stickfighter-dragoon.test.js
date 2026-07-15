'use strict';

// Dragoon (arcade JOUST) integration test — boots the real page + game in jsdom
// and pins the class's core rule, driven purely through the keyboard:
//   - at gallop the lance SKEWERS: kills land while the rider stays alive
//   - a slack lance is death: stop moving and the first body to arrive kills,
//     exactly like every other class ("you get the skewer or you die")
// Deterministic: Math.random/Date.now are pinned, so the run is a pure function
// of the driving pattern below.

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
  window.fetch = () => Promise.reject(new Error('offline (dragoon test)'));

  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }
  await window.boot();

  const sf = window.document.createElement('script');
  sf.textContent = read('stickfighter.js');
  window.document.body.appendChild(sf);

  // pin the entropy draws — the run becomes a pure function of the key pattern
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

test('dragoon: the gallop skewers, a slack lance is death', async (t) => {
  const g = await bootGame();
  t.after(() => g.dom.window.close());

  g.pump(2);
  g.key('ArrowDown');
  g.key('ArrowDown'); // down to the class row
  for (let i = 0; i < 4; i++) g.key('ArrowRight'); // melee → ranged → caster → necro → DRAGOON
  g.key('Enter'); // begin (the run-start boon menu opens synchronously)
  g.key('z'); // take the first boon

  // gallop a clockwise patrol, flapping to stay above the skewer bars — wave-1
  // goblins converge and meet the lance head-on. Enter now and then closes an
  // upgrade shop if a cleared wave opened one (it pauses the sim otherwise).
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
  let sawKills = 0;
  for (let f = 0; f < 1500; f++) {
    if (f > 0 && f % 90 === 0) {
      drop(DIRS[leg % 4]);
      leg++;
      hold(DIRS[leg % 4]);
    }
    if (f % 15 === 0) g.key('x'); // flap
    if (f > 0 && f % 120 === 0) g.key('Enter'); // close a shop if one opened
    g.pump(1);
    const m = g.hud().match(/KILLS (\d+)/);
    if (m) sawKills = Math.max(sawKills, +m[1]);
    if (f === 900) {
      assert.ok(
        !g.hud().includes('play again'),
        'the galloping dragoon must still be alive at ~tick 900 (hud: ' +
          g.hud().slice(0, 120) +
          ')'
      );
    }
    if (f % 200 === 0) await sleep(1);
  }
  assert.ok(
    sawKills >= 3,
    'the lance must be skewering — saw only ' + sawKills + ' kills across the gallop'
  );
  drop(DIRS[leg % 4]);

  // now stand still: momentum decays below every bar, and the first goblin body
  // to arrive kills — the "or you die" half of the joust rule
  for (let f = 0; f < 1800 && !g.hud().includes('play again'); f++) {
    if (f % 120 === 0) g.key('Enter'); // never let a shop freeze the field
    g.pump(1);
    if (f % 200 === 0) await sleep(1);
  }
  assert.ok(
    g.hud().includes('play again'),
    'a standing dragoon must die to contact — the skewer-or-die rule (hud: ' +
      g.hud().slice(0, 120) +
      ')'
  );

  assert.deepEqual(
    g.errors.map((e) => String(e.detail || e)),
    [],
    'no script errors'
  );
});
