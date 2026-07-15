'use strict';

// Stick Fighter ONLINE CO-OP (netplay) integration test.
//
// Boots TWO complete jsdom instances of the real page + the real stickfighter.js,
// stubs the WebRTC layer with a synchronous loopback (a StubPC/StubChannel pair
// wired through a shared "world") and the hal-worker signaling routes with an
// in-memory room map, then drives one instance to HOST and the other to JOIN.
//
// What this pins:
//   - the intro's MULTIPLAYER → HOST / JOIN flow reaches a connected run
//   - the handshake opens a READY LOBBY (hello → lobby), no input frames flow
//     until BOTH players ready up, then cfg → ready → go starts BOTH sims
//   - two sims fed different local inputs stay in lockstep for thousands of
//     ticks: the game's own checksum tripwire (`cs` messages every 60 ticks)
//     ends the run on ANY divergence, so "both still in the run" IS the
//     determinism assertion
//   - nothing persists out of an online run (no profile/tokens/best writes)
//   - killing the transport does NOT end the run: both peers hold it frozen and
//     re-signal through the derived rejoin room ('R'+5 chars, overwritable,
//     gen-stamped), the resume handshake refills what the drop swallowed, and
//     lockstep continues under the same checksum tripwire
//   - a deliberate exit (Q → 'bye') still lands both peers on the intro
//
// Timers are real (the host polls /mp-answer on a 2s interval; the reconnect
// loops poll on 2–2.5s timers), so this test takes ~10–20s of wall clock.

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

// ── shared stub world: signaling rooms + the RTC loopback ────────────────────
function makeWorld() {
  const world = {
    rooms: new Map(), // code → { offer, answer, gen? }
    genSeq: 0, // rejoin-room generation stamps (mirrors the worker's gen)
    hostPc: null, // the pc that created a data channel
    clientPc: null, // the pc that received the offer
    hostCh: null,
    clientCh: null,
    msgCounts: { cs: 0, f: 0, ev: 0 }, // wire-level tallies (both directions)
  };

  world.fetch = (url, opts) => {
    let u;
    try {
      u = new URL(url, 'https://worker.invalid');
    } catch {
      return Promise.reject(new Error('offline (netplay test): unparseable ' + url));
    }
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const respond = (status, data) =>
      Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(data) });
    if (u.pathname === '/mp-host') {
      // a rejoin re-post overwrites the room and stamps a fresh gen (worker parity)
      if (body.rejoin) {
        const gen = 'g' + ++world.genSeq;
        world.rooms.set(body.rejoin, { offer: body.offer, answer: null, gen });
        return respond(200, { code: body.rejoin, ttlSec: 300, gen });
      }
      const code = 'K7QX2';
      world.rooms.set(code, { offer: body.offer, answer: null });
      return respond(200, { code, ttlSec: 300 });
    }
    if (u.pathname === '/mp-offer') {
      const room = world.rooms.get(u.searchParams.get('code'));
      if (!room) return respond(404, { error: 'not_found' });
      return respond(
        200,
        room.gen ? { offer: room.offer, gen: room.gen } : { offer: room.offer }
      );
    }
    if (u.pathname === '/mp-join') {
      const room = world.rooms.get(body.code);
      if (!room) return respond(404, { error: 'not_found' });
      if (room.answer) return respond(409, { error: 'room_taken' });
      if (body.gen && room.gen && body.gen !== room.gen)
        return respond(409, { error: 'room_taken' });
      room.answer = body.answer;
      return respond(200, { ok: true });
    }
    if (u.pathname === '/mp-answer') {
      const room = world.rooms.get(u.searchParams.get('code'));
      if (!room) return respond(404, { error: 'not_found' });
      return respond(200, room.answer ? { answer: room.answer } : { pending: true });
    }
    // anything else (leaderboard etc.) is offline in this test
    return Promise.reject(new Error('offline (netplay test): ' + u.pathname));
  };

  class StubChannel {
    constructor() {
      this.readyState = 'connecting';
      this.peer = null;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
    }
    send(data) {
      try {
        const t = JSON.parse(data).t;
        if (world.msgCounts[t] !== undefined) world.msgCounts[t]++;
      } catch {
        /* tally only */
      }
      const p = this.peer;
      // synchronous, ordered delivery — deterministic under the manual rAF pump
      if (this.readyState === 'open' && p && p.readyState === 'open' && p.onmessage) {
        p.onmessage({ data });
      }
    }
    close() {
      if (this.readyState === 'closed') return;
      this.readyState = 'closed';
      const p = this.peer;
      if (p && p.readyState !== 'closed') {
        p.readyState = 'closed';
        if (p.onclose) p.onclose();
      }
      if (this.onclose) this.onclose();
    }
  }

  world.connect = () => {
    // called when the host applies the answer: open the loopback both ways
    const clientCh = new StubChannel();
    world.clientCh = clientCh;
    clientCh.peer = world.hostCh;
    world.hostCh.peer = clientCh;
    if (world.clientPc && world.clientPc.ondatachannel) {
      world.clientPc.ondatachannel({ channel: clientCh });
    }
    world.hostCh.readyState = 'open';
    clientCh.readyState = 'open';
    // the joiner wires first (ondatachannel above), then both openings fire —
    // client-first so its `hello` finds the host already listening
    if (clientCh.onopen) clientCh.onopen();
    if (world.hostCh.onopen) world.hostCh.onopen();
  };

  world.StubPC = class StubPC {
    constructor() {
      this.localDescription = null;
      this.iceGatheringState = 'complete'; // netWaitIce resolves immediately
      this.signalingState = 'stable';
      this.connectionState = 'new';
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
    }
    addEventListener() {}
    createDataChannel() {
      world.hostPc = this;
      world.hostCh = new StubChannel();
      return world.hostCh;
    }
    createOffer() {
      return Promise.resolve({ type: 'offer', sdp: 'v=0 stub-offer' });
    }
    createAnswer() {
      return Promise.resolve({ type: 'answer', sdp: 'v=0 stub-answer' });
    }
    setLocalDescription(d) {
      this.localDescription = d;
      if (d.type === 'offer') this.signalingState = 'have-local-offer';
      return Promise.resolve();
    }
    setRemoteDescription(d) {
      if (d.type === 'offer') world.clientPc = this;
      if (d.type === 'answer') {
        this.signalingState = 'stable';
        world.connect();
      }
      return Promise.resolve();
    }
    close() {}
  };

  return world;
}

// ── boot one full game instance (the determinism-test harness, netplay-flavored) ──
async function bootInstance(world) {
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
  window.fetch = world.fetch;
  window.RTCPeerConnection = world.StubPC;

  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }
  await window.boot();

  const sf = window.document.createElement('script');
  sf.textContent = read('stickfighter.js');
  window.document.body.appendChild(sf);

  // deterministic host-side seed draw (the client receives the seed in the cfg)
  window.Math.random = () => 0.5;
  window.Date.now = () => 1234567890;

  // manual rAF pump
  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};

  // no-op recording canvas (we assert via the sim's own tripwire + the HUD)
  let drawCalls = 0;
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
      if (!methods[prop])
        methods[prop] = () => {
          drawCalls++;
        };
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

  const api = {
    unlockAchievement: window.unlockAchievement,
    _chirp: window._chirp,
    makeRng: window.makeRng,
    HAL_WORKER_URL: 'https://worker.invalid',
    soundEnabled: false,
    reduceMotion: false,
    activeMusic: null,
  };
  window.openStickFighter(xp, api);

  let ts = 0;
  const inst = {
    window,
    dom,
    errors,
    xp,
    getDrawCalls: () => drawCalls,
    key(k, code) {
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: k, ...(code && { code }) })
      );
    },
    keyUp(k) {
      window.document.dispatchEvent(new window.KeyboardEvent('keyup', { key: k }));
    },
    hud() {
      // the game's HUD div is the xp child styled with pointer-events:none + top:8px
      for (const el of xp.children) {
        if (el.tagName === 'DIV') return el.innerHTML;
      }
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
  return inst;
}

async function waitUntil(cond, instances, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const inst of instances) inst.pump(2);
    if (cond()) return;
    await sleep(40);
  }
  assert.fail('timed out waiting for: ' + what);
}

test('two instances host+join, stay in lockstep, persist nothing, survive disconnect', async (t) => {
  const world = makeWorld();
  const host = await bootInstance(world);
  const client = await bootInstance(world);
  t.after(() => {
    host.dom.window.close();
    client.dom.window.close();
  });

  // ── drive the intros: host → MULTIPLAYER/HOST, client → MULTIPLAYER/JOIN ──
  host.pump(2);
  client.pump(2);
  host.key('ArrowRight'); // top row: SINGLE → MULTI
  host.key('ArrowDown'); // to the sub row
  host.key('ArrowRight'); // LOCAL → HOST
  host.key('Enter'); // create a room
  await waitUntil(() => host.hud().includes('ONLINE'), [host], 2000, 'host connect screen');

  client.key('ArrowRight');
  client.key('ArrowDown');
  client.key('ArrowRight');
  client.key('ArrowRight'); // LOCAL → HOST → JOIN
  client.key('Enter'); // open the code entry
  await sleep(80); // let the host's /mp-host fetch land and mint the room
  for (const ch of 'K7QX2') client.key(ch);
  client.key('Enter'); // join

  // the host polls /mp-answer every 2s; the channel opens into the READY LOBBY
  await waitUntil(
    () => world.hostCh && world.clientCh && world.clientCh.readyState === 'open',
    [host, client],
    8000,
    'the peer link to open into the lobby'
  );
  // nobody's run starts until BOTH players ready up (the confirm gate)
  host.pump(2);
  client.pump(2);
  assert.equal(world.msgCounts.f, 0, 'no input frames may flow before both players ready up');
  host.key('z');
  client.pump(2); // deliver the host's rdy before the client's own
  client.key('z');
  await waitUntil(
    () => world.msgCounts.f > 0,
    [host, client],
    4000,
    'the lockstep handshake to complete after both ready'
  );

  // the run opens on the shared boon menu — the HOST picks for the party
  await waitUntil(
    () => host.hud().includes('boon') && client.hud().includes('Player 1 is choosing'),
    [host, client],
    2000,
    'the run-start boon menu on both sims'
  );
  host.key('z');

  // different inputs on each side: host runs right, client runs left+up
  host.key('ArrowRight');
  client.key('ArrowLeft');
  client.key('ArrowUp');

  // ── the core assertion: thousands of ticks of divergent-input lockstep. The
  // game itself exchanges sim checksums every 60 ticks and ends the run (back
  // to the intro, hud 'BEST:') on ANY divergence — so still-in-the-run IS the
  // two-machine determinism proof.
  const drawsBefore = host.getDrawCalls();
  for (let i = 0; i < 1500; i++) {
    host.pump(1);
    client.pump(1);
    if (i % 100 === 0) await sleep(1); // let queued microtasks (fetch noise) drain
  }
  assert.ok(
    !host.hud().includes('BEST:'),
    'host must still be in the online run (a DESYNC or disconnect boots back to the intro)'
  );
  assert.ok(
    !client.hud().includes('BEST:'),
    'client must still be in the online run (a DESYNC or disconnect boots back to the intro)'
  );
  assert.ok(
    host.getDrawCalls() > drawsBefore + 1000,
    'the host sim must actually have advanced (gated ticks rendered)'
  );
  assert.ok(world.msgCounts.cs >= 20, `checksums must be flowing (saw ${world.msgCounts.cs})`);
  assert.ok(
    world.msgCounts.f > 2000,
    `input frames must be flowing (saw ${world.msgCounts.f})`
  );

  // ── nothing persists out of an online run ──
  for (const w of [host.window, client.window]) {
    for (const key of [
      'ilaird_sf_best',
      'ilaird_sf_trophies',
      'ilaird_sf_tokens_melee+melee',
      'ilaird_sf_upgrades_melee+melee',
      'ilaird_sf_maxwave_melee+melee',
    ]) {
      assert.equal(w.localStorage.getItem(key), null, `online run must not write ${key}`);
    }
  }

  // ── transport death mid-run: NOBODY is booted — both peers hold the frozen run
  // and re-signal through the derived rejoin room, then the resume handshake
  // refills the gap and lockstep continues under the same checksum tripwire ──
  const fBefore = world.msgCounts.f;
  world.clientCh.close();
  host.pump(4);
  client.pump(4);
  assert.ok(
    !host.hud().includes('BEST:'),
    'a drop must NOT boot the host to the intro — the run is held for reconnection'
  );
  assert.ok(
    !client.hud().includes('BEST:'),
    'a drop must NOT boot the client to the intro — the run is held for reconnection'
  );
  // the reconnect loops run on real 2–2.5s timers (offer re-post + polls)
  await waitUntil(
    () => world.msgCounts.f > fBefore + 200,
    [host, client],
    20000,
    'the run to resume over the re-signaled link'
  );
  assert.ok(
    [...world.rooms.keys()].some((c) => /^R[A-Z2-9]{5}$/.test(c)),
    'the reconnect must rendezvous through a derived R-prefixed rejoin room'
  );
  // still in lockstep after the resume: more divergent-input frames, same tripwire
  for (let i = 0; i < 300; i++) {
    host.pump(1);
    client.pump(1);
    if (i % 100 === 0) await sleep(1);
  }
  assert.ok(
    !host.hud().includes('BEST:'),
    'host must still be in the run after the reconnect (a DESYNC would boot it)'
  );
  assert.ok(
    !client.hud().includes('BEST:'),
    'client must still be in the run after the reconnect (a DESYNC would boot it)'
  );

  // ── a deliberate exit still leaves cleanly: Q sends 'bye', both land on the intro ──
  host.key('q');
  host.pump(4);
  client.pump(4);
  assert.ok(host.hud().includes('BEST:'), 'Q must land the leaver back on the intro');
  assert.ok(
    client.hud().includes('BEST:'),
    "the peer must land on the intro after the leaver's bye"
  );

  assert.deepEqual(
    host.errors.map((e) => String(e.detail || e)),
    [],
    'no script errors in the host instance'
  );
  assert.deepEqual(
    client.errors.map((e) => String(e.detail || e)),
    [],
    'no script errors in the client instance'
  );
});
