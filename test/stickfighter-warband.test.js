'use strict';

// FOUR-PLAYER WAR BAND integration test — boots FOUR complete jsdom instances of
// the real page + game over a multi-connection stub world (unique-SDP pairing so
// each RTCPeerConnection pair wires its own loopback), then drives one host and
// THREE joiners onto a single room code:
//   - joiner 1 takes the minted room; joiners 2 and 3 fall through to the
//     derived gen-stamped SLOT rooms the host re-arms after each join
//   - the READY LOBBY gates the run on all FOUR confirmations (no input frames
//     may flow before the last ready)
//   - four sims fed divergent inputs stay in lockstep under the host-relayed
//     star: the checksum tripwire ends the run on ANY divergence, so "everyone
//     still in the run" is the four-machine determinism proof
//   - one fighter pressing Q disbands the band — all four land on the intro
//
// Real timers (2s answer polls, 700ms join rounds), so this takes ~15-30s.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');
// vm-based script runner — keeps app.js/stickfighter.js visible to test coverage
// (a <script> element attributes them to an anonymous eval). See boot-page.js.
const { runScripts } = require('./helpers/boot-page');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'secrets.js', // defines window.initSecrets, which app.js calls at load
  'app.js',
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── stub world: signaling rooms + unique-SDP paired RTC loopbacks ────────────
function makeWorld() {
  const world = {
    rooms: new Map(), // code → { offer, answer, gen? }
    genSeq: 0,
    sdpSeq: 0,
    byOffer: new Map(), // offer sdp → hosting pc
    byAnswer: new Map(), // answer sdp → answering (client) pc
    msgCounts: { cs: 0, f: 0, ev: 0 },
    channels: [], // every StubChannel ever opened (for targeted kills if needed)
  };

  world.fetch = (url, opts) => {
    let u;
    try {
      u = new URL(url, 'https://worker.invalid');
    } catch {
      return Promise.reject(new Error('offline (warband test): unparseable ' + url));
    }
    const body = opts && opts.body ? JSON.parse(opts.body) : null;
    const respond = (status, data) =>
      Promise.resolve({ ok: status === 200, status, json: () => Promise.resolve(data) });
    if (u.pathname === '/mp-host') {
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
    return Promise.reject(new Error('offline (warband test): ' + u.pathname));
  };

  class StubChannel {
    constructor() {
      this.readyState = 'connecting';
      this.peer = null;
      this.onopen = null;
      this.onmessage = null;
      this.onclose = null;
      world.channels.push(this);
    }
    send(data) {
      try {
        const t = JSON.parse(data).t;
        if (world.msgCounts[t] !== undefined) world.msgCounts[t]++;
      } catch {
        /* tally only */
      }
      const p = this.peer;
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

  world.connect = (hostPc, clientPc) => {
    const hostCh = hostPc._ch;
    const clientCh = new StubChannel();
    clientCh.peer = hostCh;
    hostCh.peer = clientCh;
    if (clientPc && clientPc.ondatachannel) clientPc.ondatachannel({ channel: clientCh });
    hostCh.readyState = 'open';
    clientCh.readyState = 'open';
    if (clientCh.onopen) clientCh.onopen();
    if (hostCh.onopen) hostCh.onopen();
  };

  world.StubPC = class StubPC {
    constructor() {
      this.localDescription = null;
      this.iceGatheringState = 'complete';
      this.signalingState = 'stable';
      this.connectionState = 'new';
      this.onconnectionstatechange = null;
      this.ondatachannel = null;
      this._ch = null;
    }
    addEventListener() {}
    createDataChannel() {
      this._ch = new StubChannel();
      return this._ch;
    }
    createOffer() {
      const sdp = 'v=0 offer-' + ++world.sdpSeq;
      world.byOffer.set(sdp, this);
      return Promise.resolve({ type: 'offer', sdp });
    }
    createAnswer() {
      const sdp = 'v=0 answer-' + ++world.sdpSeq;
      world.byAnswer.set(sdp, this);
      return Promise.resolve({ type: 'answer', sdp });
    }
    setLocalDescription(d) {
      this.localDescription = d;
      if (d.type === 'offer') this.signalingState = 'have-local-offer';
      return Promise.resolve();
    }
    setRemoteDescription(d) {
      if (d.type === 'answer') {
        this.signalingState = 'stable';
        world.connect(this, world.byAnswer.get(d.sdp));
      }
      return Promise.resolve();
    }
    close() {
      if (this._ch) this._ch.close();
    }
  };

  return world;
}

// ── boot one full game instance ──────────────────────────────────────────────
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
  runScripts(dom, SCRIPTS);
  await window.boot();
  runScripts(dom, ['stickfighter.js']);
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
    HAL_WORKER_URL: 'https://worker.invalid',
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

async function waitUntil(cond, instances, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const inst of instances) inst.pump(2);
    if (cond()) return;
    await sleep(40);
  }
  assert.fail('timed out waiting for: ' + what);
}

test('four-player war band: one code seats four, lockstep holds, Q disbands', async (t) => {
  const world = makeWorld();
  const host = await bootInstance(world);
  const c1 = await bootInstance(world);
  const c2 = await bootInstance(world);
  const c3 = await bootInstance(world);
  const all = [host, c1, c2, c3];
  t.after(() => {
    for (const i of all) i.dom.window.close();
  });

  // host opens a room
  host.pump(2);
  host.key('ArrowRight');
  host.key('ArrowDown');
  host.key('ArrowRight'); // LOCAL → HOST
  host.key('Enter');
  await waitUntil(() => host.hud().includes('ONLINE'), [host], 2000, 'host connect screen');
  await sleep(120); // let /mp-host mint the room

  // three joiners, one after another, all typing the SAME code
  for (const c of [c1, c2, c3]) {
    c.pump(2);
    c.key('ArrowRight');
    c.key('ArrowDown');
    c.key('ArrowRight');
    c.key('ArrowRight'); // LOCAL → HOST → JOIN
    c.key('Enter');
    for (const ch of 'K7QX2') c.key(ch);
    c.key('Enter');
    // joiners 2/3 poll the slot rooms the host arms after each hello —
    // real 700ms/2s timers, so give each join a generous window
    const before = world.channels.filter((x) => x.readyState === 'open').length;
    await waitUntil(
      () => world.channels.filter((x) => x.readyState === 'open').length >= before + 2,
      all,
      20000,
      'the next joiner to link up'
    );
  }

  // the whole band must confirm — no frames may flow before the LAST ready
  host.pump(4);
  for (const i of all) i.pump(2);
  host.key('z');
  c1.key('z');
  c2.key('z');
  for (const i of all) i.pump(4);
  await sleep(50);
  assert.equal(
    world.msgCounts.f,
    0,
    'no input frames may flow before the whole band is ready'
  );
  c3.key('z');
  await waitUntil(
    () => world.msgCounts.f > 0,
    all,
    4000,
    'the four-seat handshake to complete'
  );

  // each seat picks its own boon, in seat order (P1 → P4)
  for (const picker of all) {
    await waitUntil(
      () => picker.hud().includes('your boon is offered'),
      all,
      6000,
      'the boon menu to reach the next seat'
    );
    picker.key('z');
  }

  // divergent inputs on all four seats — the checksum tripwire is the referee
  host.key('ArrowRight');
  c1.key('ArrowLeft');
  c2.key('ArrowUp');
  c3.key('ArrowDown');
  for (let i = 0; i < 1200; i++) {
    for (const inst of all) inst.pump(1);
    if (i % 150 === 0) await sleep(1);
  }
  for (const [n, inst] of all.entries()) {
    assert.ok(
      !inst.hud().includes('BEST:'),
      'seat ' + (n + 1) + ' must still be in the run (a DESYNC or drop boots to the intro)'
    );
  }
  assert.ok(
    world.msgCounts.cs >= 30,
    `checksums must be flowing on all links (saw ${world.msgCounts.cs})`
  );
  assert.ok(
    world.msgCounts.f > 4000,
    `frames must be flowing on all links (saw ${world.msgCounts.f})`
  );

  // one fighter leaves → the band disbands, all four land on the intro
  c2.key('q');
  for (const inst of all) inst.pump(6);
  for (const [n, inst] of all.entries()) {
    assert.ok(
      inst.hud().includes('BEST:'),
      'seat ' + (n + 1) + ' must be back on the intro after the disband'
    );
  }

  for (const [n, inst] of all.entries()) {
    assert.deepEqual(
      inst.errors.map((e) => String(e.detail || e)),
      [],
      'no script errors in instance ' + (n + 1)
    );
  }
});
