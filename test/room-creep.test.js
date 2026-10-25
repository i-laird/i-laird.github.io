'use strict';

// The room getting creepier over time (room.js: "while you aren't looking",
// "the room remembers you", the tab title).
//
// Opens the real room in jsdom with a stub bridge and pins: props change only
// while they are OUT of view (the start camera faces the monitor, so the mug
// and the duck must stay put while the bed's gamepad and the tally wall
// behind the player's shoulder change); the visit counter persists under the
// ilaird_ prefix (so `forget` erases it) and drives the tally marks, the
// corkboard note and how far along a return visit starts; the 2-4 AM start;
// and the tab title while the page is hidden, restored on the way out.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup({ visits, hour = 12, schedule = [60000, 60000, 60000, 60000] } = {}) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><head><title>ian laird</title></head>' +
      '<body><div class="window"><input id="cmd"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  window.Audio = function () {
    this.play = () => Promise.resolve();
    this.pause = () => {};
  };
  window.ROOM_CREEP_SCHEDULE = schedule;
  window.ROOM_CLOCK_HOUR = hour;
  if (visits !== undefined) window.localStorage.setItem('ilaird_room_visits', String(visits));
  runScripts(dom, ['room.js']);
  const lines = [];
  const api = {
    halWorkerUrl: '',
    turnstileKey: '',
    halPhone: '',
    topLevel: true,
    soundEnabled: false,
    reduceMotion: true,
    achOverlayOpen: false,
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
  const key = (k) =>
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true })
    );
  return { window, room, $, key, lines, close: () => window.close() };
}

const stage = ($) => {
  const m = $('#room-viewport').className.match(/creep-(\d)/g) || [];
  return m.length;
};

test('props move only while they are out of view', async (t) => {
  const { room, $, key, close } = setup({ schedule: [50, 100, 150, 600000] });
  t.after(close);
  room.open();
  await wait(2600); // fly-out lands (~1.7s), stages 1-3 fire, the first shift happens
  assert.equal(stage($), 3);
  await wait(5000); // shifts are spaced ~4.5s apart

  // behind the start camera's shoulder: the gamepad left the bed, a mark was scratched
  assert.ok($('.rm-gamepad-chair:not(.rm-hide)'), 'the gamepad is on the chair now');
  assert.ok($('.rm-gamepad:not(.rm-gamepad-chair)').classList.contains('rm-hide'));
  assert.equal($('.rm-tally').children.length, 1, "tonight's tally mark");
  // in plain view: nothing moved
  assert.equal(
    $('.rm-mug:not(.rm-mug2)').dataset.bz,
    '200',
    'the mug you are looking at stays put'
  );
  assert.equal($('.rm-duck').dataset.bz, '-80', 'so does the duck');
  assert.ok($('.rm-trophy').classList.contains('rm-hide') === false, 'and the trophy');

  key('Escape');
  await wait(400);
  room.open(); // every visit puts the props back
  assert.ok($('.rm-gamepad-chair').classList.contains('rm-hide'));
  key('Escape');
  await wait(400);
});

test('the room remembers visits: tally, a note, and a head start', async (t) => {
  const { window, room, $, key, close } = setup({ visits: 3 });
  t.after(close);
  room.open();
  assert.equal(
    window.localStorage.getItem('ilaird_room_visits'),
    '4',
    'counted under the ilaird_ prefix'
  );
  assert.equal($('.rm-tally').querySelectorAll('i').length, 3, 'one mark per earlier visit');
  assert.ok(
    Array.from(corkNotes($)).includes('you came back.'),
    'the corkboard has a note for you'
  );
  await wait(2000); // the fly-out lands
  assert.equal(stage($), 2, 'a fourth visit starts at stage 2');
  key('Escape');
  await wait(400);
});

function corkNotes($) {
  return Array.from($('.rm-cork').querySelectorAll('i')).map((el) => el.textContent);
}

test('a first visit starts calm, unless it is the small hours', async (t) => {
  const calm = setup({});
  t.after(calm.close);
  calm.room.open();
  await wait(2000);
  assert.equal(stage(calm.$), 0, 'first visit at noon: calm');
  assert.equal(calm.$('.rm-tally').children.length, 0, 'no marks yet');

  const night = setup({ hour: 3 });
  t.after(night.close);
  night.room.open();
  await wait(2000);
  assert.equal(stage(night.$), 2, '3 AM starts at stage 2');
  calm.key('Escape');
  night.key('Escape');
  await wait(400);
});

test('the tab title while you are away, restored when you leave', async (t) => {
  const { window, room, key, close } = setup({ schedule: [10, 600000, 600000, 600000] });
  t.after(close);
  let hidden = false;
  Object.defineProperty(window.document, 'hidden', { configurable: true, get: () => hidden });
  const vis = () => window.document.dispatchEvent(new window.Event('visibilitychange'));

  room.open();
  await wait(2000); // stage 1
  hidden = true;
  vis();
  assert.equal(window.document.title, 'I’m still here');
  hidden = false;
  vis();
  assert.equal(window.document.title, 'ian laird');
  hidden = true;
  vis();
  key('Escape');
  await wait(400);
  assert.equal(window.document.title, 'ian laird', 'leaving restores the real title');
});
