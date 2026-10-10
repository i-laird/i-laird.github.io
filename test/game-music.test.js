'use strict';

// Shell-game music — createMusic() in games.js, behind createGameShell's
// `music` option.
//
// Loads the real games.js chunk in jsdom with a stub api bridge and a stub
// Audio that records what the engine does to each element. Pins:
//  - the sound-toggle contract: ONE { play, pause } handle is parked on
//    api.activeMusic for the game's lifetime (stopAllAudio / resumeModeAudio
//    in app.js call nothing else), it only plays when sound is on, and
//    quitting pauses everything and releases the handle — a stale one would
//    let the toggle resurrect the music over the bare terminal
//  - every audio file a game names exists on disk
//  - the godmode behaviours: the dark-twin crossfade and tape drag (snake),
//    Daisy surfacing, HAL's pong tricks bending the track, 2048's stolen
//    melody, and the death rewind whose silence survives a sound toggle

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const GAMES = {
  racecar: 'grid_sector_horizon.mp3',
  snake: 'pixel_pressure.mp3',
  pong: 'pixel_rally.mp3',
  2048: 'grid_logic.mp3',
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg} (got ${a}, want ${b})`);

function setup(soundEnabled, godmodeUnlocked = false) {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ianclaird.com/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom lacks it; the shell calls it
  // racecar draws on a 2D canvas; any-method no-op context is enough here
  const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: () => true });
  window.HTMLCanvasElement.prototype.getContext = () => ctx;
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
  runScripts(dom, ['games.js']);

  const inputRow = window.document.createElement('div');
  inputRow.style.display = 'flex';
  window.document.body.appendChild(inputRow);
  const api = {
    appendNode: (n) => window.document.body.appendChild(n),
    blank() {},
    scroll() {},
    halSpeak() {},
    halD: (s) => s,
    unlockAchievement() {},
    _chirp() {},
    inputRow,
    cmd: { focus() {}, blur() {} },
    godmodeUnlocked,
    playerName: 'Dave',
    soundEnabled,
    activeMusic: null,
  };
  const handlers = window.initGames(api);
  const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k }));
  const el = (file) => made.find((a) => a.src.endsWith('/' + file));
  const text = () => window.document.body.textContent;
  return { window, api, handlers, key, made, el, text, inputRow, close: () => window.close() };
}

const onDisk = (a) => fs.existsSync(path.join(__dirname, '..', a.src));

for (const [game, file] of Object.entries(GAMES)) {
  test(`${game}: one looping track behind the activeMusic handle, released on quit`, (t) => {
    const { api, handlers, key, made, inputRow, close } = setup(true);
    t.after(close);

    handlers[game]();
    assert.equal(made.length, 1, 'outside godmode a game creates exactly one track');
    const track = made[0];
    assert.ok(track.src.endsWith(file), `${game} plays ${file}`);
    assert.ok(onDisk(track), `${track.src} exists on disk`);
    assert.equal(track.loop, true, 'the track loops');
    assert.equal(track.plays, 1, 'plays immediately when sound is on');

    // the sound toggle reaches it through the handle, and only the handle
    assert.equal(typeof api.activeMusic.play, 'function');
    api.activeMusic.pause();
    assert.equal(track.paused, true, 'the handle pauses the track');
    api.activeMusic.play();
    assert.equal(track.paused, false, 'the handle resumes it');

    key('q');
    assert.equal(track.paused, true, 'quitting pauses the track');
    assert.equal(api.activeMusic, null, 'quitting releases activeMusic');
    assert.equal(inputRow.style.display, 'flex', 'the input row comes back');
  });
}

test('sound off → the track is parked but silent, and the toggle can start it', (t) => {
  const { api, handlers, key, made, close } = setup(false);
  t.after(close);

  handlers.racecar();
  assert.equal(made[0].plays, 0, 'does not play while sound is off');
  api.activeMusic.play(); // what resumeModeAudio does when sound is turned on
  assert.equal(made[0].plays, 1, 'turning sound on starts it');
  key('q');
  assert.equal(api.activeMusic, null);
});

for (const game of Object.keys(GAMES)) {
  test(`${game}: every godmode audio file it names exists`, (t) => {
    const { handlers, key, made, close } = setup(true, true);
    t.after(close);

    handlers[game]();
    assert.ok(
      made.length >= 3,
      'godmode adds the reverse clip and Daisy (and a twin where used)'
    );
    for (const a of made) assert.ok(onDisk(a), `${a.src} exists on disk`);
    assert.ok(
      made.some((a) => a.src.endsWith('_rev.mp3')),
      'has a reverse clip'
    );
    assert.ok(
      made.some((a) => a.src.endsWith('daisy_buried.mp3')),
      'has the Daisy bed'
    );
    key('q');
    key('q');
  });
}

test('racecar: godmode swaps in the HAL track', (t) => {
  const { handlers, key, made, close } = setup(true, true);
  t.after(close);

  handlers.racecar();
  assert.ok(made[0].src.endsWith('machine_override.mp3'), 'godmode plays machine_override');
  key('q');
});

test('snake: godmode rots the music as HAL opens phases, and Daisy surfaces', async (t) => {
  const { api, handlers, key, el, close } = setup(true, true);
  t.after(close);

  handlers.snake();
  const clean = el('pixel_pressure.mp3');
  const dark = el('pixel_pressure_dark.mp3');
  const daisy = el('daisy_buried.mp3');
  assert.equal(
    clean.plays + dark.plays,
    2,
    'the track and its twin play in step from the start'
  );
  near(clean.volume, 0.5, 'the run starts clean');
  near(dark.volume, 0, 'the twin starts silent');
  assert.equal(daisy.plays, 0, 'Daisy is not playing yet');

  api.activeMusic.pause();
  assert.ok(clean.paused && dark.paused, 'one pause stops both');
  api.activeMusic.play();
  assert.ok(!clean.paused && !dark.paused, 'one play resumes both');

  key('x'); // start the run
  key('2'); // godmode phase keys: each phase HAL opens rots the music a third further
  key('3');
  key('4');
  await wait(3600); // corruption glides ~1.5s, Daisy ~2.5s
  near(dark.volume, 0.5, 'by the fourth phase the twin has taken over');
  near(clean.volume, 0, 'and the clean track is gone');
  near(clean.playbackRate, 0.94, 'the tape drags');
  assert.equal(dark.playbackRate, clean.playbackRate, 'both drag together, staying in step');
  assert.equal(daisy.plays, 1, 'Daisy has started');
  near(daisy.volume, 0.3, 'and surfaced, half-buried');

  key('q');
  key('q');
  assert.ok(clean.paused && dark.paused && daisy.paused, 'quitting stops everything');
  assert.equal(api.activeMusic, null, 'quitting releases activeMusic');
});

test("pong: each of HAL's tricks bends the music, and losing drags it to a halt", async (t) => {
  const { api, handlers, key, el, close } = setup(true, true);
  t.after(close);

  handlers.pong();
  const main = el('pixel_rally.mp3');
  const swap = el('pixel_rally_swap.mp3');
  const rev = el('pixel_rally_rev.mp3');
  key('x'); // start the match

  key('1'); // "Enjoy the other side"
  await wait(1700);
  near(swap.volume, 0.5, 'the side-switch crosses the music to the twin');
  near(main.volume, 0, 'and off the clean track');
  assert.equal(main.playbackRate, 1, 'a side-switch does not drag the tape');

  key('3'); // "Surprise"
  assert.equal(rev.plays, 1, 'the flip cuts to the reversed bar');
  near(swap.volume, 0, 'with the track ducked under it');
  await wait(1600);
  assert.equal(rev.paused, true, 'the reversed bar ends');
  near(swap.volume, 0.5, 'and the track comes back'); // still switched: the restore is 5s out

  key('4'); // "Time slows for you"
  await wait(1000);
  near(main.playbackRate, 0.84, 'the slow drags the tape down');

  key('2'); // "Let me speed things up"
  await wait(1600);
  near(main.playbackRate, 1.12, 'the speed-up pitches it up');

  // quitting mid-match is a loss: HAL's taunt lands in silence
  key('q');
  assert.ok(main.paused && swap.paused, 'the loss stops the track');
  assert.equal(rev.plays, 2, 'with the record dragged backwards');
  const before = main.plays;
  api.activeMusic.play(); // a sound toggle during the death screen
  assert.equal(main.plays, before, 'the silence survives a sound toggle');

  key('r'); // rematch
  assert.equal(main.plays, before + 1, 'a rematch starts the track over');
  near(main.volume, 0.5, 'clean again');
  assert.equal(main.playbackRate, 1, 'at normal speed');
  key('q');
  key('q');
  assert.equal(api.activeMusic, null);
});

test('2048: stealing the 64 takes the melody, and it comes back flat', async (t) => {
  const { window, handlers, key, el, text, close } = setup(true, true);
  t.after(close);
  window.Math.random = () => 0; // new tile = 2 in the first empty cell; no random meddling

  handlers['2048']();
  const main = el('grid_logic.mp3');
  const stolen = el('grid_logic_stolen.mp3');
  key('x'); // start

  // a fixed corner strategy reaches a 64 well inside this budget
  const screen = () => window.document.querySelector('pre.ascii').textContent;
  let taken = false;
  for (let i = 0; i < 600 && !taken; i++) {
    const before = screen();
    for (const k of ['ArrowDown', 'ArrowRight', 'ArrowLeft', 'ArrowUp']) {
      key(k);
      if (screen() !== before) break;
    }
    taken = /That 64 is mine/.test(text());
    if (/game over/.test(screen())) break;
  }
  assert.ok(taken, 'the run reached HAL stealing the 64');

  await wait(1700);
  near(stolen.volume, 0.5, 'the melody is gone: only the stolen twin plays');
  near(main.volume, 0, 'the clean track is silent');
  key('q');
});
