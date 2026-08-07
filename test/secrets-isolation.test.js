'use strict';

// secrets.js is obfuscated as its OWN unit (heavily, while the rest of the
// page-load bundle takes the cheap config — see scripts/build.js). That makes
// it exactly as isolated as the lazy chunks even though it ships in the same
// file: names on the other side of the boundary are renamed independently, so
// a free reference to anything from app.js or lib/ resolves to undefined in
// the built site while working perfectly in the clean source.
//
// The trap this guards is the codec helpers. _djb2/_xorDecode/_hexRows are
// lib/ globals, so `_djb2(key)` looks completely fine here and runs fine under
// `npm run serve` — but lib/ is bundled into the OTHER unit, so the built
// puzzle would silently stop accepting the right key. They must arrive as
// api.djb2 / api.xorDecode / api.hexRows via app.js's secretsBridge().

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertChunkIsolated } = require('./helpers/chunk-isolation');
const { bootPage } = require('./helpers/boot-page');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'secrets.js'), 'utf8');

test('secrets.js takes every app.js/lib dependency through the api bridge', () => {
  assertChunkIsolated('secrets.js');
});

test('secrets.js exports its entry point for the build', () => {
  assert.match(
    SRC,
    /window\.initSecrets\s*=\s*initSecrets/,
    'secrets.js must export window.initSecrets — app.js calls it by that name across ' +
      'the obfuscation-unit boundary, which is why it is on the reservedNames list'
  );
});

// The whole point of the file. If a cipher, a key hash or a fragment drifts back
// into app.js, the build stops protecting it: the main bundle is obfuscated with
// the light config, which mangles identifiers but leaves string literals in the
// clear. This is the check that keeps the heavy/light split meaningful.
test('no puzzle secret leaks back into the lightly-obfuscated bundle', () => {
  const light = [
    'app.js',
    'lib/codec.js',
    'lib/timing.js',
    'lib/text.js',
    'lib/rng.js',
    'lib/shell.js',
  ]
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'))
    .join('\n');

  // Pull the real values out of secrets.js rather than restating them here —
  // restating would put a copy of every secret in the repo, which is the exact
  // thing being prevented.
  const ciphers = SRC.match(/'[0-9a-f]{32,}'/g) || [];
  assert.ok(ciphers.length >= 2, 'expected secrets.js to hold both encrypted segments');

  for (const lit of ciphers) {
    assert.ok(
      !light.includes(lit.slice(1, -1)),
      `an encrypted segment appears verbatim in the lightly-obfuscated bundle — it ` +
        `belongs in secrets.js, reached through lastEggFile()`
    );
  }

  const frags = (SRC.match(/const FRAGMENTS = \[([^\]]*)\]/) || [])[1];
  assert.ok(frags, 'expected secrets.js to define the FRAGMENTS array');
  const fragLits = (frags.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
  assert.equal(fragLits.length, 4, 'expected four on-site key fragments');

  // A bare fragment value is not itself a tell — "9000" occurs all over app.js
  // in "HAL 9000" and in z-indexes. What leaks the puzzle is a fragment sitting
  // next to its own key.frag[n/4] label, so that is what we check: every
  // key.frag site in the main bundle must interpolate puzzle.frag(), never
  // inline the value.
  for (const m of light.matchAll(/key\.frag[^\n]{0,40}/g)) {
    assert.ok(
      m[0].includes('${'),
      `a key fragment is hard-coded in the lightly-obfuscated bundle: ${m[0].trim()}\n` +
        `  Use puzzle.frag(n) — the light config leaves string literals readable.`
    );
    for (const f of fragLits) {
      assert.ok(
        !m[0].includes(f),
        `key fragment "${f}" appears verbatim beside its label in the main bundle`
      );
    }
  }

  // The key hashes are numbers, so the string-array transform does not touch
  // them; they are only hidden because HEAVY's numbersToExpressions rewrites
  // them. Same rule: they belong in the heavy unit.
  for (const hash of SRC.match(/= (\d{7,})/g) || []) {
    const n = hash.replace('= ', '');
    assert.ok(
      !light.includes(n),
      `key hash ${n} appears in the lightly-obfuscated bundle — it belongs in secrets.js`
    );
  }
});

// app.js calls initSecrets() at TOP LEVEL, which makes secrets.js the first
// hard load-order dependency the terminal has ever had. Unguarded, a 404 on
// that one file throws partway through app.js: function declarations are
// hoisted so boot() still exists, but every later const/let is stranded in its
// temporal dead zone, and the page dies with a baffling "Cannot access X before
// initialization". That is a live risk, not a theoretical one — GitHub Pages
// serves the CLEAN source (separate <script> tags) until Pages is switched to
// the Actions source; in the built bundle the unit is inlined ahead of app.js.
test('the terminal still boots if secrets.js fails to load', async (t) => {
  const { dom, window, errors } = await bootPage({ skip: ['secrets.js'] });
  t.after(() => dom.window.close());

  assert.deepEqual(
    errors.map((e) => String(e.detail || e)),
    [],
    'a missing secrets.js must not throw during load + boot'
  );
  assert.match(
    window.document.getElementById('out').textContent,
    /IAN {2}LAIRD/,
    'the banner should still render without secrets.js'
  );
  assert.equal(
    window.document.getElementById('input-row').style.display,
    'flex',
    'the prompt must still be usable — the puzzle degrades, the terminal does not'
  );

  // And the puzzle itself fails closed rather than pretending to work. The key
  // used here is deliberately a dummy: the real one is assembled from the
  // fragments at runtime and is not written down in this repo.
  window.submitCommand('decrypt AAAABBBBCCCCDDDD');
  assert.doesNotMatch(
    window.document.getElementById('out').textContent,
    /key accepted/,
    'the stub must never accept a key'
  );
});
