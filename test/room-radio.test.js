'use strict';

// The room's clock radio (room.js, "the clock radio").
//
// Opens the real room in jsdom with a stub bridge and a stub Audio, runs the
// creep stages on a compressed schedule, and pins: the station and its
// corrupted twin both exist on disk and play in step behind ONE
// { play, pause } handle parked on api.activeMusic (so the sound toggle
// reaches the radio); the mix slides from the clean track to the twin and the
// tape sags as the creep advances; and leaving the room stops both and
// releases the handle — a stale one would let the toggle start the radio over
// the bare terminal.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(soundEnabled) {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"><input id="cmd"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  const made = [];
  window.Audio = function (src) {
    this.src = src;
    this.plays = 0;
    this.paused = true;
    this.volume = 1;
    this.playbackRate = 1;
    this.currentTime = 0;
    this.play = () => {
      this.plays++;
      this.paused = false;
      return Promise.resolve();
    };
    this.pause = () => {
      this.paused = true;
    };
    made.push(this);
  };
  window.ROOM_CREEP_SCHEDULE = [100, 200, 300, 400]; // armed once the fly-out lands
  runScripts(dom, ['room.js']);

  const api = {
    halWorkerUrl: '',
    turnstileKey: '',
    halPhone: '',
    topLevel: true,
    soundEnabled,
    reduceMotion: true,
    achOverlayOpen: false,
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
  };
  const room = window.initRoom(api);
  const key = (k) =>
    window.document.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true })
    );
  return { window, api, room, made, key, close: () => window.close() };
}

test('the clock radio plays, corrupts with the creep, and stops on the way out', async (t) => {
  const { window, api, room, made, key, close } = setup(true);
  t.after(close);

  room.open();
  assert.equal(made.length, 2, 'the station and its twin');
  const [clean, dark] = made;
  assert.ok(clean.src.endsWith('two_am_radio_station.mp3'));
  assert.ok(dark.src.endsWith('two_am_radio_station_dark.mp3'));
  for (const a of made) {
    assert.ok(fs.existsSync(path.join(__dirname, '..', a.src)), `${a.src} exists on disk`);
    assert.equal(a.loop, true);
    assert.equal(a.plays, 1, 'both start together when sound is on');
  }

  // the sound toggle reaches the pair through one handle
  api.activeMusic.pause();
  assert.ok(clean.paused && dark.paused, 'one pause stops both');
  api.activeMusic.play();
  assert.ok(!clean.paused && !dark.paused, 'one play resumes both');

  await wait(1200); // swelling in; the creep is not armed until the fly-out lands
  assert.ok(clean.volume > 0, 'the station has faded in');
  assert.equal(dark.volume, 0, 'calm: none of the twin yet');
  assert.equal(clean.playbackRate, 1, 'calm: the tape runs true');

  await wait(4500); // fly-out lands (~1.7s), then every creep stage fires
  assert.ok(window.document.querySelector('.creep-4'), 'the creep reached its last stage');
  assert.ok(dark.volume > clean.volume, 'the twin has overtaken the station');
  assert.ok(clean.playbackRate < 0.97, 'and the tape has sagged');
  assert.match(
    window.document.querySelector('.rm-clock').dataset.tip,
    /not a station/,
    'the clock knows what it is playing'
  );

  key('Escape');
  await wait(400);
  assert.ok(clean.paused && dark.paused, 'leaving stops the radio');
  assert.equal(api.activeMusic, null, 'and releases activeMusic');
  assert.equal(api.roomActive, false);
});

test('sound off: the radio is parked silent until the toggle starts it', async (t) => {
  const { api, room, made, key, close } = setup(false);
  t.after(close);

  room.open();
  assert.equal(made[0].plays + made[1].plays, 0, 'nothing plays while sound is off');
  api.activeMusic.play(); // what resumeModeAudio does when sound is turned on
  assert.equal(made[0].plays + made[1].plays, 2, 'turning sound on starts both');
  key('Escape');
  await wait(400);
  assert.equal(api.activeMusic, null);
});
