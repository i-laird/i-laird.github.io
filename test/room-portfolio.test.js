'use strict';

// The room's portfolio props (room.js: "the portfolio, in the room").
//
// Opens the real room in jsdom with a stub bridge and clicks each prop:
// the shelf's spines open the projects showcase at the right view, the
// trophy opens the achievements overlay, the real resume opens a viewer (with
// the PDF one click away) that Escape closes WITHOUT leaving the room, the
// gamepad and chess board leave the room and only then run their command,
// and while an overlay is open the room keeps its hands off the keyboard.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"><input id="cmd"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  window.Audio = function () {
    this.play = () => Promise.resolve();
    this.pause = () => {};
  };
  window.ROOM_CREEP_SCHEDULE = [600000, 600000, 600000, 600000];
  window.ROOM_CLOCK_HOUR = 12;
  runScripts(dom, ['room.js']);
  const calls = [];
  const api = {
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
    openProjects: (view) => calls.push(['projects', view]),
    toggleAchievements: () => calls.push(['achievements']),
    runCommand: (raw) => calls.push(['run', raw, api.roomActive]),
  };
  const room = window.initRoom(api);
  const $ = (s) => window.document.querySelector(s);
  const click = (el) => el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  const key = (k) =>
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true })
    );
  return { window, api, room, $, click, key, calls, close: () => window.close() };
}

test('the shelf and the trophy open the portfolio over the room', async (t) => {
  const { api, room, $, click, calls, close } = setup();
  t.after(close);
  room.open();
  const spines = Array.from($('.rm-books').querySelectorAll('i'));
  const byLabel = (txt) => spines.find((el) => el.textContent === txt);
  click(byLabel('d/dx'));
  click(byLabel('~/sh'));
  click(byLabel('RTFM'));
  click($('.rm-trophy'));
  assert.deepEqual(calls, [
    ['projects', 'calc'],
    ['projects', 'site'],
    ['projects', 'index'],
    ['achievements'],
  ]);
  assert.equal(api.roomActive, true, 'the room stays open underneath');
});

test('the real resume opens a viewer; Escape closes it, not the room', async (t) => {
  const { window, api, room, $, click, key, close } = setup();
  t.after(close);
  room.open();
  const paper = $('.rm-resume');
  assert.match(
    paper.getAttribute('style'),
    /assets\/documents\/ianclaird_resume\.jpg/,
    'the rendered page is on the desk'
  );
  click(paper);
  const viewer = $('#room-resume');
  assert.ok(viewer, 'the viewer opened');
  assert.equal(viewer.getAttribute('role'), 'dialog');
  assert.match(viewer.querySelector('img').getAttribute('src'), /ianclaird_resume\.jpg$/);
  const links = Array.from(viewer.querySelectorAll('a')).map((a) => a.getAttribute('href'));
  assert.ok(
    links.every((h) => h === 'assets/documents/ianclaird_resume.pdf'),
    'the PDF is one click away'
  );
  key('Escape');
  assert.equal($('#room-resume'), null, 'Escape closed the viewer');
  assert.equal(api.roomActive, true, '…and only the viewer');
  click(paper);
  click(window.document.querySelector('#room-resume .rm-res-x'));
  assert.equal($('#room-resume'), null, 'the close button works too');
  key('Escape'); // now Escape leaves the room as usual
  await wait(400);
  assert.equal(api.roomActive, false);
});

test('while the projects overlay is open, the room ignores the keyboard', async (t) => {
  const { api, room, key, close } = setup();
  t.after(close);
  room.open();
  api.projOverlayOpen = true;
  key('Escape');
  await wait(300);
  assert.equal(api.roomActive, true, 'Escape belonged to the overlay');
  api.projOverlayOpen = false;
  key('Escape');
  await wait(400);
  assert.equal(api.roomActive, false);
});

test('the gamepad and the chess board go back in first, then run their command', async (t) => {
  const pad = setup();
  t.after(pad.close);
  pad.room.open();
  pad.click(pad.$('.rm-gamepad:not(.rm-gamepad-chair)'));
  await wait(400);
  assert.deepEqual(
    pad.calls,
    [['run', 'games', false]],
    'games runs in the terminal, after the room is gone'
  );

  const chess = setup();
  t.after(chess.close);
  chess.room.open();
  chess.click(chess.$('.rm-chess'));
  await wait(400);
  assert.deepEqual(chess.calls, [['run', 'chess', false]]);
});
