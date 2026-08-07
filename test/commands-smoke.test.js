'use strict';

// Every COMMANDS entry dispatches without throwing.
//
// This exists because of a specific hole. app.js is one classic script with no
// IIFE, so every top-level name shares a single global lexical scope — which is
// exactly why `no-undef` is switched OFF for it in eslint.config.js (cross-file
// names are the design, not a mistake). The cost of that exemption is that a
// typo'd or since-renamed identifier inside a rarely-run command is invisible:
// it lints clean, it parses clean, boot() never touches it, and the first person
// to find out is a visitor typing an easter egg.
//
// So walk the real COMMANDS table and run every entry. This is deliberately a
// smoke test, not a behavioural one — the assertion is only "it ran, and the
// terminal is still usable afterwards". Commands with their own real tests
// (filesystem, forget, decrypt, the games) are covered properly elsewhere.
//
// It caught one on the first run: `matrix` dereferenced a null 2D context after
// having already hidden the input row.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./helpers/boot-page');

// Commands that cannot be smoke-tested from a bare dispatch, with the reason.
// Keep this list SHORT and justified — every entry here is a command nothing
// else checks either.
const SKIP = {
  // Opens a multi-step awaitingInput chain and a confirm gate; the flow is
  // driven properly in app-commands.test.js ('forget: confirms, then clears').
  forget: 'covered by app-commands.test.js, and leaves a confirm prompt armed',
};

// Modal state a command may legitimately leave behind. Reset between entries so
// one command's mode cannot mask the next one's failure.
function resetTerminal(window) {
  window.eval('awaitingInput = null; silentInput = false;');
  window.eval(
    'halMode = false; halLLM = false; halLLMBusy = false; sansMode = false; sansBattleActive = false;'
  );
  const row = window.document.getElementById('input-row');
  row.style.display = 'flex';
  for (const id of ['screensaver', 'halllm-confirm']) {
    const el = window.document.getElementById(id);
    if (el) el.remove();
  }
}

test('every COMMANDS entry runs without throwing', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  const names = window.eval('Object.keys(COMMANDS)');
  assert.ok(names.length > 30, `expected the full command table, got ${names.length}`);

  const failures = [];
  for (const name of names) {
    if (SKIP[name]) continue;
    try {
      window.submitCommand(name);
    } catch (e) {
      failures.push(`${name} → ${e.message}`);
    }
    resetTerminal(window);
  }

  assert.deepEqual(
    failures,
    [],
    `these commands threw when dispatched:\n  ${failures.join('\n  ')}\n` +
      `(a ReferenceError here is the class of bug no-undef:off cannot catch)`
  );
});

test('every command leaves a usable prompt behind', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  // A command that hides the input row must either restore it or own the screen
  // deliberately (games, matrix, the desktop). What must never happen is a
  // command hiding the row and then failing before it can give it back — that
  // is an unrecoverable page for anyone without a mouse to click elsewhere.
  const OWNS_SCREEN = new Set(['matrix', 'hack', 'sl', 'rm -rf /', 'power off', 'override']);

  const stuck = [];
  for (const name of window.eval('Object.keys(COMMANDS)')) {
    if (SKIP[name] || OWNS_SCREEN.has(name)) continue;
    window.submitCommand(name);
    const hidden = window.document.getElementById('input-row').style.display === 'none';
    const awaiting = window.eval('!!awaitingInput');
    if (hidden && !awaiting) stuck.push(name);
    resetTerminal(window);
  }

  assert.deepEqual(
    stuck,
    [],
    `these commands hid the prompt without claiming the screen: ${stuck.join(', ')}`
  );
});

test('matrix survives a display with no 2D context', async (t) => {
  // Regression for the bug this file found. getContext returns null in jsdom,
  // but also in real browsers under canvas-blocking extensions and on failed
  // context allocation — and matrix hides the input row BEFORE touching it, so
  // an unguarded null left a black screen with no way back to the prompt.
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  window.submitCommand('matrix'); // must not throw

  assert.equal(
    window.document.getElementById('input-row').style.display,
    'flex',
    'matrix must hand the prompt back when it cannot draw'
  );
  assert.match(
    window.document.getElementById('out').textContent,
    /no canvas available/i,
    'it should say why rather than failing silently'
  );
  assert.equal(
    window.document.querySelectorAll('canvas').length,
    0,
    'the dead canvas must be removed, not left covering the page'
  );
});
