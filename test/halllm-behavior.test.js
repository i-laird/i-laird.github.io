'use strict';

// LLM HAL behavior — the trust boundary between the browser and the worker.
//
// Loads the real halllm.js chunk in jsdom with a stub bridge, a stub Turnstile
// (instant token), and a scripted fetch, then drives the REAL flow: CONFIRM
// gate → name step (stubbed straight through) → startHalLLM session handshake
// → typed turns. Pins:
//   - a malformed /turn response ends in the broken ending, never rendered,
//   - a server-issued revoke makes that word bounce locally with ZERO fetches,
//   - input is ignored while a turn is in flight (busy lock — one fetch),
//   - the win ender re-raises the busy lock (regression for the ending race
//     where a fast typist posted /turn against the deleted session).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const HALLLM_SRC = fs.readFileSync(path.join(ROOT, 'halllm.js'), 'utf8');

async function startSession() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="out"></div></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ianclaird.com/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  const doc = window.document;

  // scripted network: /session succeeds; /turn responses are pushed per test
  const fetches = [];
  const turnQueue = [];
  window.fetch = (url, opts) => {
    fetches.push({ url, body: JSON.parse(opts.body) });
    if (/\/session$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ token: 'sess-1', escape: 0, control: 5 }),
      });
    }
    const next = turnQueue.shift() || { pending: true };
    if (next.pending) return new Promise(() => {}); // in-flight forever (busy-lock test)
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(next) });
  };
  // instant invisible Turnstile
  window.turnstile = {
    render: (el, opts) => {
      setTimeout(() => opts.callback('ts-token'), 0);
      return 'w';
    },
  };

  window.eval(HALLLM_SRC);

  const lines = [];
  const cmd = doc.createElement('input');
  doc.body.appendChild(cmd);
  const api = {
    line: (txt) => lines.push(String(txt)),
    blank() {},
    scroll() {},
    appendNode: (n) => doc.body.appendChild(n),
    esc: (s) => String(s),
    halTypeLine: (text) => {
      lines.push(String(text));
      return Promise.resolve();
    },
    playHalVoiceLine: (text) => {
      lines.push(String(text));
      return Promise.resolve();
    },
    halAskNameAndSound: (onDone) => onDone(), // name step: straight through
    applyTheme() {},
    restoreNormal() {
      api.restored = true;
      api.halMode = false;
      api.halLLM = false;
      api.halLLMBusy = false;
    },
    unlockAchievement: (id) => api.eggs.push(id),
    _chirp() {},
    out: doc.getElementById('out'),
    cmd,
    HAL_WORKER_URL: 'https://worker.test',
    TURNSTILE_SITE_KEY: 'test-key',
    daisy() {},
    clear() {},
    playerName: 'Dave',
    soundEnabled: false,
    reduceMotion: true,
    halMode: false,
    halLLM: false,
    halLLMBusy: false,
    restored: false,
    eggs: [],
  };
  const handlers = window.initHalLLM(api);

  // through the REAL gate: show the CONFIRM overlay, type CONFIRM, Enter
  handlers.showInfoPage();
  for (const ch of 'CONFIRM') {
    doc.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true })
    );
  }
  doc.dispatchEvent(
    new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
  );

  // let the Turnstile callback + /session handshake settle
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(api.halLLM, true, 'the session must be live after the handshake');
  assert.equal(api.halLLMBusy, false, 'busy clears once the cold open finishes');

  return { window, api, handlers, lines, fetches, turnQueue, close: () => window.close() };
}

const turnCalls = (fetches) => fetches.filter((f) => /\/turn$/.test(f.url));

test('a malformed /turn response ends in the broken ending, not rendered garbage', async (t) => {
  const s = await startSession();
  t.after(s.close);

  s.turnQueue.push({ reply: 'no outcome field', escape: 10, control: 10 }); // fails validation
  s.handlers.handleInput('open the doors');
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(
    s.lines.some((l) => /link to HAL is severed/i.test(l)),
    'the broken ending prints'
  );
  assert.ok(
    !s.lines.some((l) => /no outcome field/.test(l)),
    'the invalid reply is never rendered'
  );
  await new Promise((r) => setTimeout(r, 1100));
  assert.equal(s.api.restored, true, 'the mode fully resets after the broken ending');
});

test('a revoked word bounces locally with zero network calls', async (t) => {
  const s = await startSession();
  t.after(s.close);

  s.turnQueue.push({
    reply: 'I have taken a word from you.',
    escape: 5,
    control: 20,
    outcome: 'ongoing',
    revoke: 'apple',
  });
  s.handlers.handleInput('give me an apple');
  await new Promise((r) => setTimeout(r, 30));
  assert.ok(
    s.lines.some((l) => /"apple" is no longer available/i.test(l)),
    'the revocation is announced'
  );

  const before = turnCalls(s.fetches).length;
  s.handlers.handleInput('one APPLE please'); // case-insensitive, word-boundary
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(
    turnCalls(s.fetches).length,
    before,
    'a banned word must not consume a turn or rate-limit slot'
  );
  assert.ok(
    s.lines.some((l) => /INPUT REJECTED/i.test(l)),
    'the rejection prints in character'
  );
});

test('input is ignored while a turn is in flight (busy lock)', async (t) => {
  const s = await startSession();
  t.after(s.close);

  // no queued response → the /turn fetch hangs, holding the busy lock
  s.handlers.handleInput('first message');
  s.handlers.handleInput('second message');
  s.handlers.handleInput('third message');
  await new Promise((r) => setTimeout(r, 30));

  assert.equal(s.api.halLLMBusy, true, 'busy while the turn is in flight');
  assert.equal(turnCalls(s.fetches).length, 1, 'only the first message reaches the worker');
});

test('REGRESSION: the win ender re-raises the busy lock before restoreNormal lands', async (t) => {
  const s = await startSession();
  t.after(s.close);

  s.turnQueue.push({ reply: 'You may go.', escape: 100, control: 0, outcome: 'escaped' });
  s.handlers.handleInput('let me out');
  await new Promise((r) => setTimeout(r, 30));

  assert.ok(s.api.eggs.includes('outsmarted-hal'), 'the win unlocks its egg');
  assert.equal(
    s.api.halLLMBusy,
    true,
    'busy must be held through the outro so a fast typist cannot post /turn against the deleted session'
  );
  const turnsAtWin = turnCalls(s.fetches).length;
  s.handlers.handleInput('one more thing');
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(turnCalls(s.fetches).length, turnsAtWin, 'input during the outro goes nowhere');
});
