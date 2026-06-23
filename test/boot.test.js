'use strict';

// Boot smoke test.
//
// The lib/ helpers have unit tests, but app.js (~6,700 lines) and stickfighter.js
// have none — and because app.js is a single classic script with no IIFE (all ~180
// top-level declarations share one global lexical scope), a typo or a stray reference
// anywhere in the file is a load-time ReferenceError that linting cannot catch. This
// test loads the real index.html + the real script chain in a jsdom DOM, runs boot(),
// and asserts the terminal actually comes up and dispatches a command — the class of
// breakage that "it parses" and "it lints" both miss.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Scripts in the exact order index.html loads them: the lib helpers define globals
// app.js reads, then app.js itself.
const SCRIPTS = ['lib/codec.js', 'lib/timing.js', 'lib/text.js', 'app.js'];

// Browser APIs jsdom doesn't implement that app.js touches at load time. app.js already
// feature-guards matchMedia / AudioContext / speechSynthesis (so leaving those undefined
// exercises the real graceful-degradation paths); these are the few it uses unguarded.
function installShims(window) {
  // `new Audio(...)` runs at module scope (e.g. the sans voice clip); needs to construct
  // without a real audio backend. Arbitrary property assignment (volume/loop/onended/…)
  // works because it's a plain class instance.
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  // Network is unavailable in the test; app.js fetches (e.g. hal_timing.json) are all
  // `.catch()`-guarded, so a rejecting fetch exercises the same path as an offline visitor.
  window.fetch = () => Promise.reject(new Error('offline (smoke test)'));
  // Canvas is only used by games / the share card (never at boot), but stub getContext so
  // any incidental canvas creation doesn't emit jsdom "Not implemented" errors.
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = () => null;
  }
}

// Build a jsdom DOM, run the real scripts in load order, and wait for boot() to finish.
async function boot() {
  const html = read('index.html');

  // Surface genuine in-page script errors as test failures; ignore the resource-load
  // chatter for the external <script src> tags (we run the local files ourselves below).
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (e) => errors.push(e));

  const dom = new JSDOM(html, {
    url: 'https://ianclaird.com/', // gives localStorage a real origin
    runScripts: 'dangerously', // execute inline scripts we inject
    pretendToBeVisual: true, // provides requestAnimationFrame (scroll() needs it)
    resources: undefined, // do NOT fetch the external <script src> tags
    virtualConsole,
  });

  const { window } = dom;
  installShims(window);

  // Inject each file as an inline classic script so it runs in the shared global scope,
  // exactly like the browser: function declarations land on window, const/let stay lexical.
  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }

  // app.js auto-calls boot() at the end, but it isn't awaited there; call it again and
  // await this promise so the assertions run after the terminal is fully up.
  assert.equal(typeof window.boot, 'function', 'boot() should be a global function');
  await window.boot();

  return { dom, window, errors };
}

test('the page loads and boots without throwing', async (t) => {
  const { dom, window, errors } = await boot();
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
  assert.equal(typeof window.toggleSound, 'function');
  assert.equal(typeof window.focusCmd, 'function');
  assert.equal(typeof window.submitCommand, 'function');
});

test('the help command dispatches and prints the command list', async (t) => {
  const { dom, window } = await boot();
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
  const { dom, window } = await boot();
  t.after(() => dom.window.close());

  const live = window.document.getElementById('a11y-live');
  assert.ok(live, '#a11y-live region should exist');
  assert.equal(live.getAttribute('aria-live'), 'polite');

  window.submitCommand('help');
  assert.ok(live.textContent.trim().length > 0, 'help output should be announced');
});

test('the global error boundary recovers a wedged terminal', async (t) => {
  const { dom, window } = await boot();
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
