'use strict';

// Boot smoke test.
//
// The lib/ helpers have unit tests, but app.js (~4,600 lines) is a single
// classic script with no IIFE (its top-level declarations share one global
// lexical scope), so a typo or a stray reference anywhere in the file is a
// load-time ReferenceError that linting cannot catch (no-undef is deliberately
// off for app.js). This loads the real index.html + the real script chain in a
// jsdom DOM (test/helpers/boot-page.js), runs boot(), and asserts the terminal
// actually comes up and dispatches a command — the class of breakage that
// "it parses" and "it lints" both miss. Deeper command behavior is covered by
// app-commands.test.js on the same harness.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./helpers/boot-page');

test('the page loads and boots without throwing', async (t) => {
  const { dom, window, errors } = await bootPage();
  t.after(() => dom.window.close()); // stop jsdom timers (e.g. the 60s egg-nudge auto-hide)

  assert.deepEqual(
    errors.map((e) => String(e.detail || e)),
    [],
    'no script errors should occur during load + boot'
  );

  const outText = window.document.getElementById('out').textContent;
  assert.match(outText, /IAN {2}LAIRD/, 'boot banner should render');
  assert.match(outText, /Type help/i, 'boot should print the help hint');

  // The input row is revealed and the global onclick handlers the inline HTML relies on
  // are present (these are the globals a no-IIFE regression would silently drop).
  assert.equal(window.document.getElementById('input-row').style.display, 'flex');
  assert.equal(typeof window.submitCommand, 'function');
  // The public API the inline on* handlers in index.html call by name. These are
  // explicitly exported to window (app.js) so they survive the obfuscated/IIFE build;
  // this guards that export block against accidental removal.
  for (const fn of ['toggleSound', 'focusCmd', 'unlockAchievement', 'toggleAchievements']) {
    assert.equal(
      typeof window[fn],
      'function',
      `window.${fn} must be exported for inline HTML handlers`
    );
  }
});

test('the help command dispatches and prints the command list', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  window.submitCommand('help');

  const outText = window.document.getElementById('out').textContent;
  for (const cmd of ['about', 'resume', 'projects', 'games', 'neofetch']) {
    assert.match(outText, new RegExp(`\\b${cmd}\\b`), `help should list "${cmd}"`);
  }
});

test('terminal output is mirrored to the screen-reader live region', async (t) => {
  // Guards the accessibility wiring: completed lines must reach #a11y-live so assistive
  // tech announces them.
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  const live = window.document.getElementById('a11y-live');
  assert.ok(live, '#a11y-live region should exist');
  assert.equal(live.getAttribute('aria-live'), 'polite');

  window.submitCommand('help');
  assert.ok(live.textContent.trim().length > 0, 'help output should be announced');
});

test('the global error boundary recovers a wedged terminal', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  // Simulate the failure mode the boundary exists for: a game has hidden the input row,
  // then an uncaught error fires (e.g. from its animation loop).
  const inputRow = window.document.getElementById('input-row');
  inputRow.style.display = 'none';

  window.dispatchEvent(
    new window.ErrorEvent('error', { error: new Error('boom'), message: 'boom' })
  );

  assert.equal(inputRow.style.display, 'flex', 'the prompt should be restored after a fault');
  assert.match(
    window.document.getElementById('out').textContent,
    /system fault/i,
    'a recovery line should be printed'
  );
});
