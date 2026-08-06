'use strict';

// Clickjacking gate on the room's phone flow.
//
// The CSP ships as a <meta> tag because GitHub Pages cannot set response
// headers, and `frame-ancestors` is header-only — so it is silently ignored and
// this origin is embeddable by anyone. That is harmless for a terminal toy and
// NOT harmless for the hallway phone, which is the one interaction on the site
// that collects a real telephone number behind a consent tickbox and can cause
// a real SMS and a real outbound Twilio call. An attacker-controlled overlay on
// a framed copy is the textbook clickjack and the visitor's number is the prize.
//
// So the live receiver refuses to run while framed and drops to the decorative
// answering machine instead: the easter egg still plays, but it cannot be
// steered into texting or dialling a stranger. This pins that, plus the
// fail-closed behaviour when reading window.top throws (a throw means there IS
// a cross-origin ancestor).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ROOM_SRC = fs.readFileSync(path.join(ROOT, 'room.js'), 'utf8');
const APP_SRC = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

// Boot room.js with the popup test seam and a bridge whose `topLevel` we
// control, then pick up the phone and report which receiver answered.
function pickUpWith({ topLevel, halWorkerUrl = 'https://worker.test' }) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/' }
  );
  const { window } = dom;
  const fetches = [];
  window.fetch = (url, opts) => {
    fetches.push({ url, body: opts && opts.body });
    return Promise.resolve({ ok: true, json: () => Promise.resolve({}) });
  };
  window.ROOM_TEST_HOOKS = true;
  window.eval(ROOM_SRC);

  const spoke = [];
  window.initRoom({
    halWorkerUrl,
    turnstileKey: 'test-key',
    halPhone: '+1 (555) 000-0000',
    topLevel,
    soundEnabled: false,
    reduceMotion: true,
    achOverlayOpen: false,
    roomActive: false,
    winEl: window.document.querySelector('.window'),
    cmd: { focus() {} },
    line() {},
    blank() {},
    scroll() {},
    unlockAchievement() {},
    _chirp() {},
    halSpeak: (s) => spoke.push(s),
    halD: (s) => s,
  });

  const hook = window.__roomPopTest;
  assert.ok(hook, 'room.js must expose the test seam when ROOM_TEST_HOOKS is set');
  const res = hook.pickUp();
  return { ...res, fetches, spoke, close: () => window.close() };
}

test('framed: picking up the phone never opens the live line', (t) => {
  const { live, fetches, spoke, close } = pickUpWith({ topLevel: false });
  t.after(close);

  assert.equal(live, false, 'the live receiver must not start inside a frame');
  assert.equal(
    fetches.length,
    0,
    'a framed page must not reach the worker at all — no /room-call, no Turnstile fetch'
  );
  assert.ok(
    spoke.length > 0,
    'it falls back to the decorative answering machine rather than doing nothing'
  );
});

test('top-level: picking up the phone opens the live line as normal', (t) => {
  const { live, close } = pickUpWith({ topLevel: true });
  t.after(close);

  assert.equal(live, true, 'the gate must not break the real feature');
});

test('the gate is independent of the worker being configured', (t) => {
  // No worker URL is the pre-existing answering-machine path; the frame gate
  // must not be the only thing standing between a framed page and a dial.
  const { live, close } = pickUpWith({ topLevel: true, halWorkerUrl: '' });
  t.after(close);
  assert.equal(live, false);
});

test('isTopLevel fails closed when window.top access throws', () => {
  // Cross-origin `window.top` access throws in some browsers. A throw means
  // there IS a cross-origin ancestor, so the catch must return false, not true.
  const src = APP_SRC.match(/function isTopLevel\(\)[\s\S]*?\n {2}}/);
  assert.ok(src, 'isTopLevel() must exist in app.js');

  const fn = new Function(`${src[0]}; return isTopLevel;`)();

  const had = Object.prototype.hasOwnProperty.call(global, 'window');
  const realWindow = global.window;
  try {
    global.window = {
      get self() {
        return {};
      },
      get top() {
        throw new Error('cross-origin');
      },
    };
    assert.equal(fn(), false, 'a throwing window.top must be treated as framed');

    const same = {};
    global.window = { self: same, top: same };
    assert.equal(fn(), true, 'self === top is top-level');

    global.window = { self: {}, top: {} };
    assert.equal(fn(), false, 'self !== top is framed');
  } finally {
    if (had) global.window = realWindow;
    else delete global.window;
  }
});

test('room.js routes the live call through the bridged gate, not a bare global', () => {
  // The chunk-isolation rule: room.js must reach app.js only through `api`.
  // A `self !== top` written directly in room.js would pass the isolation lint
  // (both are browser globals) while quietly bypassing the documented seam.
  assert.match(
    ROOM_SRC,
    /if \(api\.halWorkerUrl && api\.topLevel\) beginLiveCall\(\);/,
    'answerPhone() must gate beginLiveCall on api.topLevel'
  );
  assert.ok(
    !/\bself\s*!==\s*top\b|\bwindow\.top\b/.test(ROOM_SRC),
    'room.js must not compute frame state itself — it comes from the bridge'
  );
});
