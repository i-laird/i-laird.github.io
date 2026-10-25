'use strict';

// The room's viewport and the monitor's screen are overflow:hidden, but the
// browser still scrolls them when something inside is focused or
// scrollIntoView()'d — the live terminal's prompt, or chess's board after a
// long game. That slid the whole scene up and looked like the camera had
// dropped to the floor. room.js pins both back to 0 on every scroll event.
// jsdom has no layout, so this simulates the browser's scroll: it sets the
// offset and fires the event, the way a focus() would.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

test('the room cannot be scrolled out from under the camera', (t) => {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"><input id="cmd"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  t.after(() => window.close());
  window.Audio = function () {
    this.play = () => Promise.resolve();
    this.pause = () => {};
  };
  window.ROOM_CREEP_SCHEDULE = [600000, 600000, 600000, 600000];
  window.ROOM_CLOCK_HOUR = 12;
  runScripts(dom, ['room.js']);
  const room = window.initRoom({
    halWorkerUrl: '',
    turnstileKey: '',
    halPhone: '',
    topLevel: true,
    soundEnabled: false,
    reduceMotion: true,
    achOverlayOpen: false,
    projOverlayOpen: false,
    roomActive: false,
    activeMusic: null,
    winEl: window.document.querySelector('.window'),
    cmd: { focus() {}, blur() {} },
    line() {},
    blank() {},
    scroll() {},
    unlockAchievement() {},
    _chirp() {},
    halSpeak() {},
    halD: (s) => s,
  });
  room.open();
  for (const id of ['room-viewport', 'room-screen']) {
    const el = window.document.getElementById(id);
    let top = 0;
    Object.defineProperty(el, 'scrollTop', {
      configurable: true,
      get: () => top,
      set: (v) => {
        top = v;
      },
    });
    el.scrollTop = 140; // what focusing the prompt did, measured in Chrome
    el.dispatchEvent(new window.Event('scroll'));
    assert.equal(el.scrollTop, 0, `#${id} snaps back`);
  }
});
