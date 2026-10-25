'use strict';

// The room's sound going wrong, and the hallway turning into the boat tunnel
// (room.js: "the sound goes wrong", HALL_SHAPES).
//
// Opens the real room in jsdom with a stub bridge, a stub Audio, a fake Web
// Audio graph and a fake speechSynthesis, then: runs the creep and checks
// the radio's chain overdrives and muffles as it goes; walks the camera down
// the hallway with the real keyboard handling and checks the tunnel comes in
// with depth (flanger, reverb, the Shepard riser, buried Daisy speeding up),
// the couplets are spoken faster and higher as they're passed, and the
// projections light ahead of the player.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function fakeAudioContext(made) {
  const param = (v) => ({
    value: v,
    setTargetAtTime(x) {
      this.value = x;
    },
    setValueAtTime(x) {
      this.value = x;
    },
  });
  const node = (extra) => ({ connect() {}, disconnect() {}, ...extra });
  return function AudioContext() {
    const nodes = { shapers: [], filters: [] };
    const keep = (list, n) => (list.push(n), n);
    const ctx = {
      nodes,
      state: 'running',
      sampleRate: 8000,
      currentTime: 0,
      destination: node(),
      resume: () => Promise.resolve(),
      suspend() {
        ctx.state = 'suspended';
        return Promise.resolve();
      },
      createGain: () => node({ gain: param(1) }),
      createWaveShaper: () => keep(nodes.shapers, node({ curve: null, oversample: 'none' })),
      createBiquadFilter: () =>
        keep(nodes.filters, node({ type: '', frequency: param(350), Q: param(1) })),
      createDelay: () => node({ delayTime: param(0) }),
      createConvolver: () => node({ buffer: null }),
      createDynamicsCompressor: () =>
        node({
          threshold: param(0),
          knee: param(0),
          ratio: param(1),
          attack: param(0),
          release: param(0),
        }),
      createOscillator: () => node({ type: 'sine', frequency: param(440), start() {} }),
      createMediaElementSource: (el) => node({ el }),
      createBuffer: (ch, len) => ({ getChannelData: () => new Float32Array(len) }),
    };
    made.push(ctx);
    return ctx;
  };
}

function setup() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"><input id="cmd"></div></body></html>',
    { runScripts: 'outside-only', url: 'https://ianclaird.com/', pretendToBeVisual: true }
  );
  const { window } = dom;
  const audios = [];
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
    audios.push(this);
  };
  const ctxs = [];
  window.AudioContext = fakeAudioContext(ctxs);
  const spoken = [];
  window.SpeechSynthesisUtterance = function (text) {
    this.text = text;
  };
  window.speechSynthesis = { speak: (u) => spoken.push(u), cancel() {} };
  window.ROOM_CREEP_SCHEDULE = [200, 400, 600, 800];
  window.ROOM_CLOCK_HOUR = 12;
  runScripts(dom, ['room.js']);
  const api = {
    halWorkerUrl: '',
    turnstileKey: '',
    halPhone: '',
    topLevel: true,
    soundEnabled: true,
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
  };
  const room = window.initRoom(api);
  const key = (type, k) =>
    window.document.dispatchEvent(new window.KeyboardEvent(type, { key: k, bubbles: true }));
  const hold = async (k, ms) => {
    key('keydown', k);
    await wait(ms);
    key('keyup', k);
  };
  return { window, api, room, audios, ctxs, spoken, key, hold, close: () => window.close() };
}

test('the radio overdrives and muffles as the creep sets in; the hallway becomes the tunnel', async (t) => {
  const { window, room, audios, ctxs, spoken, key, hold, close } = setup();
  t.after(close);
  room.open();
  assert.equal(ctxs.length, 1, 'the effects chain was built');
  // the mix rides on the chain's gains; an element left at volume 0 would feed it silence
  for (const a of audios)
    assert.equal(a.volume, 1, `${a.src} runs at full volume into the chain`);
  const fx = ctxs[0];
  const shaper = fx.nodes.shapers[0];
  const lp = fx.nodes.filters[0];
  await wait(400);
  assert.equal(shaper.curve, null, 'calm: no overdrive');
  assert.ok(lp.frequency.value > 15000, 'calm: not muffled');
  await wait(2800); // fly-out lands (~1.7s), then all four stages fire
  const $ = (s) => window.document.querySelector(s);
  // the door opens as its own step, only while unwatched — skip the wait
  for (let i = 0; i < 3; i++) key('keydown', '9');
  assert.ok($('.creep-4'), 'the door is open');
  assert.ok(shaper.curve, 'the radio overdrives');
  assert.ok(
    lp.frequency.value <= 2000,
    `and is muffled (${Math.round(lp.frequency.value)} Hz)`
  );
  const song = audios.find((a) => a.src.endsWith('daisy_buried.mp3'));
  assert.equal(song.plays, 0, 'still in the room: no tunnel song yet');
  assert.ok(!$('.rm-proj.on'), 'and no projections');

  // turn to face down the hallway (+z), then walk in
  await hold('ArrowRight', 2100);
  await hold('w', 4200);
  assert.ok(song.plays > 0, 'the buried Daisy started in the hallway');
  assert.ok(
    song.playbackRate > 1,
    `and it is running fast (rate ${song.playbackRate.toFixed(2)})`
  );
  assert.ok(lp.frequency.value > 2500, 'the tunnel opens the sound back up, bright and wrong');
  const lit = window.document.querySelectorAll('.rm-proj.on').length;
  assert.ok(lit >= 2, `projections lit ahead of the player (${lit})`);
  assert.ok(
    lit < window.document.querySelectorAll('.rm-proj').length,
    '…but not the far end yet'
  );
  assert.ok(spoken.length >= 1, 'a couplet was spoken');
  assert.equal(spoken[0].text, "there's no earthly way of knowing");
  if (spoken.length > 1)
    assert.ok(spoken[1].rate > spoken[0].rate && spoken[1].pitch > spoken[0].pitch);

  key('keydown', 'Escape');
  await wait(400);
  assert.ok(song.paused, 'leaving stops the song');
  assert.equal(
    fx.state,
    'suspended',
    '…and the tunnel (the Shepard riser lives in the graph)'
  );
});
