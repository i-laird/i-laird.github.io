'use strict';

// Shared jsdom page-boot harness: loads the real index.html + the real
// lib/*.js → app.js script chain into a jsdom DOM exactly like the browser
// does, runs boot(), and hands back { dom, window, errors }. Used by
// boot.test.js (load-time smoke) and app-commands.test.js (behavioral suite).
//
// Not a test file itself — node --test ignores non-*.test.js names.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Scripts in the exact order index.html loads them: the lib helpers define
// globals app.js reads, then app.js itself.
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'app.js',
];

// Browser APIs jsdom doesn't implement that app.js touches at load time.
// matchMedia / AudioContext / speechSynthesis are deliberately left undefined
// to exercise the real feature-guards.
function installShims(window) {
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  window.fetch = () => Promise.reject(new Error('offline (test harness)'));
  if (window.HTMLCanvasElement) {
    window.HTMLCanvasElement.prototype.getContext = () => null;
  }
}

// Build a jsdom DOM, run the real scripts in load order, and wait for boot().
async function bootPage() {
  const html = read('index.html');

  // Surface genuine in-page script errors as test failures; resource-load
  // chatter for external <script src> tags is not fetched at all.
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

  // Inject each file as an inline classic script so it runs in the shared
  // global scope, exactly like the browser: function declarations land on
  // window, const/let stay lexical (still visible to window.eval).
  for (const src of SCRIPTS) {
    const el = window.document.createElement('script');
    el.textContent = read(src);
    window.document.body.appendChild(el);
  }

  assert.equal(typeof window.boot, 'function', 'boot() should be a global function');
  await window.boot();

  return { dom, window, errors };
}

module.exports = { bootPage, installShims, read, ROOT };
