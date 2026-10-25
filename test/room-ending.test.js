'use strict';

// The end of a room visit (room.js: the door in hallTick, "after the call").
//
// Opens the real room in jsdom with a stub bridge, opens the door (9-9-9),
// walks the camera into the hallway with the real keyboard handling, and
// checks the door shuts behind the player; then answers the hallway phone
// (no hal-worker → the answering machine) and checks that once the message
// ends the room switches off on its own and the terminal wakes up — with the
// Matrix lines, and HAL's number as a missed call.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('the door shuts behind you; after the call the screen goes out and you wake up', async (t) => {
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
  const lines = [];
  const api = {
    halWorkerUrl: '', // no worker: the phone is the answering machine
    turnstileKey: '',
    halPhone: '+1 (555) 010-2001',
    topLevel: true,
    soundEnabled: false,
    reduceMotion: true,
    achOverlayOpen: false,
    projOverlayOpen: false,
    roomActive: false,
    activeMusic: null,
    winEl: window.document.querySelector('.window'),
    cmd: { focus() {}, blur() {} },
    line: (h) => lines.push(h),
    blank() {},
    scroll() {},
    unlockAchievement() {},
    _chirp() {},
    halSpeak() {},
    halD: (s) => s,
  };
  const room = window.initRoom(api);
  const $ = (s) => window.document.querySelector(s);
  const key = (type, k) =>
    window.document.dispatchEvent(new window.KeyboardEvent(type, { key: k, bubbles: true }));
  const hold = async (k, ms) => {
    key('keydown', k);
    await wait(ms);
    key('keyup', k);
  };

  room.open();
  await wait(1900); // the fly-out lands
  for (let i = 0; i < 3; i++) key('keydown', '9'); // straight to the open door
  assert.ok($('.creep-4'));
  assert.ok(!$('.door-shut'), 'the door stands open');

  await hold('ArrowRight', 2100); // face down the hallway
  await hold('w', 3800);
  assert.ok($('.door-shut'), 'it shut behind you');
  assert.equal($('.rm-door').dataset.tip, 'it will not open.');

  // pick up: the answering machine plays, the caption clears, then the room goes out
  $('.rm-hall-phone').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  await wait(2800); // the message types out
  assert.equal(api.roomActive, true, 'still in the room while the message plays');
  await wait(9500); // the call-back number stays up to be read, then it goes
  assert.equal(api.roomActive, false, 'the screen went out on its own');
  assert.ok(!lines.some((l) => /back inside the machine/.test(l)), 'not the ordinary way out');
  await wait(6500);
  const text = lines.join('\n');
  assert.match(text, /Wake up, Neo\.\.\./);
  assert.match(text, /The Matrix has you/);
  assert.match(text, /white rabbit/);
  await wait(7500);
  assert.match(lines.join('\n'), /missed call: HAL 9000 — \+1 \(555\) 010-2001/);
  assert.match(lines.join('\n'), /wrong movie/);

  room.open(); // a new visit starts with the door open and nothing queued
  assert.ok(!$('.door-shut'));
});
