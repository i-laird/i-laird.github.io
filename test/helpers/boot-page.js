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
const vm = require('node:vm');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..', '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Run the page's scripts so that `node --test --experimental-test-coverage`
// can actually see them.
//
// The obvious way to load a classic script into jsdom is to append a <script>
// element with its text — but then V8 attributes the coverage to an anonymous
// jsdom eval, not to a file on disk, so app.js and the chunks vanish from the
// report entirely. That is how `npm run test:coverage` came to print a
// confident 97% while measuring only lib/ and one build script: ~25k lines of
// runtime code, including everything these harnesses exercise, was invisible.
//
// vm.runInContext against jsdom's real context is equivalent (same context,
// same shared global scope, one script per file exactly like separate <script>
// tags) but takes a `filename`, which is what V8 keys coverage on. Pass the
// ABSOLUTE path so the run maps back onto the repo file.
//
// One behavioural difference to know: a throw during load now propagates to
// the caller instead of being swallowed into virtualConsole's jsdomError. That
// is strictly louder — a script that dies at load is never something a test
// should pass through — but it means `errors` only collects what happens
// AFTER load (event handlers, async chains), which is what it was for anyway.
// The same reasoning applies to `window.eval(CHUNK_SRC)` in the per-chunk
// behavioural tests, which is why they call this too rather than eval.
function runScripts(dom, files) {
  const context = dom.getInternalVMContext();
  for (const file of files) {
    vm.runInContext(read(file), context, { filename: path.join(ROOT, file) });
  }
}

// Scripts in the exact order index.html loads them: the lib helpers define
// globals app.js reads, then app.js itself.
const SCRIPTS = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'secrets.js', // defines window.initSecrets, which app.js calls at load
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
//
// `skip` drops files from the chain, to simulate one <script> failing to load.
// That matters for secrets.js: app.js calls initSecrets() at top level, so a
// missing file there used to abort the whole script and wedge the page.
//
// `storage` seeds localStorage BEFORE the scripts run. Several flags are read
// once at load and never again (endingSeen, crtEnabled, foundEggs), so this is
// the only way to boot a page that is already mid- or post-hunt without
// sitting through the real thing.
async function bootPage({ skip = [], storage = null } = {}) {
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

  if (storage) {
    for (const [k, v] of Object.entries(storage)) {
      window.localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
    }
  }

  // Run each file as a classic script in the shared global scope, exactly like
  // the browser: function declarations land on window, const/let stay lexical
  // (still visible to window.eval). See runScripts() on why this is not a
  // <script> element.
  runScripts(
    dom,
    SCRIPTS.filter((s) => !skip.includes(s))
  );

  assert.equal(typeof window.boot, 'function', 'boot() should be a global function');
  await window.boot();

  return { dom, window, errors };
}

module.exports = { bootPage, installShims, runScripts, read, ROOT, SCRIPTS };
