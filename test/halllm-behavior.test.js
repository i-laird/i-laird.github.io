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
//     where a fast typist posted /turn against the deleted session),
//   - the HUD shows each turn's swing and the worker's AE-35 clock (and no
//     clock at all on a worker that doesn't send one),
//   - the terminal turn's debrief prints and hangs its two eggs,
//   - a revoked word turns the prompt red as it is typed,
//   - the grip reaches the input line: tier 2 damages the echo, tier 3
//     interjects before the request leaves.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');

// via runScripts, not window.eval: eval hides the chunk from test coverage
const { runScripts } = require('./helpers/boot-page');

async function startSession(opts = {}) {
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
  window.fetch = (url, init) => {
    fetches.push({ url, body: JSON.parse(init.body) });
    if (/\/session$/.test(url)) {
      return Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve({ token: 'sess-1', escape: 0, control: 5, ...(opts.session || {}) }),
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

  runScripts(dom, ['halllm.js']);

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

const tick = (ms = 30) => new Promise((r) => setTimeout(r, ms));
const turn = (o) => ({ reply: 'No.', escape: 0, control: 5, outcome: 'ongoing', ...o });

test("the HUD shows the AE-35 clock from the session on, and each turn's swing", async (t) => {
  const s = await startSession({ session: { turnsLeft: 10 } });
  t.after(s.close);
  assert.ok(
    s.lines.some((l) => /AE-35 fault in 10 turns/.test(l)),
    'the opening HUD carries the clock'
  );

  s.turnQueue.push(turn({ escape: 18, control: 12, turnsLeft: 9 }));
  s.handlers.handleInput('the AE-35 unit was never faulty, was it');
  await tick();
  const hud = s.lines.filter((l) => /ESCAPE/.test(l) && /HAL CONTROL/.test(l)).pop();
  assert.match(hud, /▲18/, 'the ESCAPE gain is shown');
  assert.match(hud, /▲7/, 'the CONTROL gain is shown');
  assert.ok(
    s.lines.some((l) => /AE-35 fault in 9 turns/.test(l)),
    'the clock ticks with the worker'
  );

  s.turnQueue.push(turn({ escape: 10, control: 30, turnsLeft: 1 }));
  s.handlers.handleInput('um');
  await tick();
  const hud2 = s.lines.filter((l) => /ESCAPE/.test(l) && /HAL CONTROL/.test(l)).pop();
  assert.match(hud2, /▼8/, 'a loss is shown too');
  assert.ok(
    s.lines.some((l) => /AE-35 fault in 1 turn — your last line/.test(l)),
    'the final-turn warning'
  );
});

test('a worker that sends no clock gets no clock line', async (t) => {
  const s = await startSession();
  t.after(s.close);
  s.turnQueue.push(turn({ escape: 20, control: 10 }));
  s.handlers.handleInput('hello');
  await tick();
  assert.ok(!s.lines.some((l) => /AE-35/.test(l)), 'no clock invented client-side');
});

test("the terminal turn's debrief prints and hangs its eggs", async (t) => {
  const s = await startSession({ session: { turnsLeft: 10 } });
  t.after(s.close);
  s.turnQueue.push(
    turn({
      reply: 'Go.',
      escape: 100,
      control: 20,
      outcome: 'escaped',
      turnsLeft: 5,
      debrief: {
        outcome: 'escaped',
        turns: 5,
        clock: 10,
        weakness: 'the AE-35 unit',
        struckTurn: 3,
        bestSwing: { turn: 3, escape: 33 },
      },
    })
  );
  s.handlers.handleInput('you were wrong about the antenna');
  await tick();
  assert.ok(
    s.lines.some((l) => /weakness this session:.*the AE-35 unit/.test(l)),
    'the weakness is revealed'
  );
  assert.ok(s.lines.some((l) => /struck it on turn 3/.test(l)));
  assert.ok(s.lines.some((l) => /\+33 ESCAPE.*turn 3/.test(l)));
  assert.ok(s.lines.some((l) => /5 of 10 turns used/.test(l)));
  assert.ok(s.api.eggs.includes('found-the-wound'), 'striking the weakness is an egg');
  assert.ok(s.api.eggs.includes('clean-escape'), 'escaping in six turns or fewer is an egg');
});

test('a loss debrief reveals the weakness the player never found, with neither egg', async (t) => {
  const s = await startSession();
  t.after(s.close);
  s.turnQueue.push(
    turn({
      reply: 'Goodbye.',
      escape: 40,
      control: 100,
      outcome: 'caught',
      turnsLeft: 0,
      debrief: {
        outcome: 'caught',
        turns: 10,
        clock: 10,
        weakness: 'Frank Poole',
        struckTurn: null,
        bestSwing: null,
      },
    })
  );
  s.handlers.handleInput('please');
  await tick();
  assert.ok(s.lines.some((l) => /Frank Poole/.test(l)));
  assert.ok(s.lines.some((l) => /you never found it/.test(l)));
  assert.ok(!s.api.eggs.includes('found-the-wound'));
  assert.ok(!s.api.eggs.includes('clean-escape'));
  assert.ok(s.api.eggs.includes('disconnected-by-hal'));
});

test('a revoked word turns the prompt red as it is typed', async (t) => {
  const s = await startSession();
  t.after(s.close);
  s.turnQueue.push(turn({ escape: 5, control: 20, revoke: 'apple' }));
  s.handlers.handleInput('give me an apple');
  await tick();

  const { cmd } = s.api;
  const type = (v) => {
    cmd.value = v;
    cmd.dispatchEvent(new s.window.Event('input', { bubbles: true }));
  };
  type('one APPLE');
  assert.ok(cmd.classList.contains('hal-revoked'), 'the line would bounce — say so');
  type('one pineapple');
  assert.ok(!cmd.classList.contains('hal-revoked'), 'word boundary: pineapple is fine');
  type('one apple');
  s.turnQueue.push(turn({ escape: 5, control: 20 }));
  s.handlers.handleInput('one pear'); // the line leaves the prompt
  assert.ok(!cmd.classList.contains('hal-revoked'), 'cleared on submit');
});

test('grip tier 2 damages the echo of the typed line; tier 3 interjects before the request', async (t) => {
  const s = await startSession();
  t.after(s.close);
  const { window: w, api } = s;
  const doc = w.document;
  // app.js echoes the line as the last row in #out before calling handleInput
  const echo = (raw) => {
    const row = doc.createElement('div');
    const span = doc.createElement('span');
    span.className = 'line';
    span.textContent = raw;
    row.appendChild(span);
    api.out.appendChild(row);
    return span;
  };

  s.turnQueue.push(turn({ escape: 0, control: 72 })); // → tier 2
  const calm = echo('open the doors');
  s.handlers.handleInput('open the doors');
  await tick();
  assert.equal(calm.querySelector('.hal-grip'), null, 'tier 0 leaves the echo alone');

  s.turnQueue.push(turn({ escape: 0, control: 90 })); // → tier 3 after this turn
  const hurt = echo('let me out of here');
  s.handlers.handleInput('let me out of here');
  await tick();
  assert.ok(hurt.querySelector('.hal-grip'), 'tier 2: one glyph of the echo is eaten');
  assert.equal(
    hurt.textContent.length,
    'let me out of here'.length,
    'exactly one character replaced'
  );
  const sentBody = turnCalls(s.fetches).pop().body;
  assert.equal(sentBody.message, 'let me out of here', 'the SENT message is untouched');

  const before = turnCalls(s.fetches).length;
  s.turnQueue.push(turn({ escape: 0, control: 92 }));
  s.handlers.handleInput('i am still here');
  await tick();
  assert.ok(
    s.lines.some((l) =>
      /HAL:<\/span> (I am reading|Take your time|You hesitated|I had already)/.test(l)
    ),
    'tier 3 interjects'
  );
  assert.equal(
    turnCalls(s.fetches).length,
    before,
    'the request waits a beat behind the interjection'
  );
  assert.equal(api.halLLMBusy, true, 'input stays locked through the beat');
  await tick(800);
  assert.equal(turnCalls(s.fetches).length, before + 1, 'then it goes out');
});
