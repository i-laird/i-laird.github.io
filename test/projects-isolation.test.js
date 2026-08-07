'use strict';

// projects.js must reference nothing from app.js/lib by free global name —
// everything arrives through projectsBridge(). Same contract as the other lazy
// chunks; see test/helpers/chunk-isolation.js for why this is enforced
// statically rather than at runtime.
//
// The one that bites here is projOverlayEl: it looks like a natural `let` for
// the chunk to own, but tryStartFinale() and the screensaver's ssBusy() in
// app.js both poll it so neither fires over an open showcase. It stays
// app.js-owned and crosses as an accessor.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { assertChunkIsolated } = require('./helpers/chunk-isolation');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'projects.js'), 'utf8');

test('projects.js takes every app.js/lib dependency through the api bridge', () => {
  assertChunkIsolated('projects.js');
});

test('projects.js exports its entry point for the lazy-load handshake', () => {
  assert.match(
    SRC,
    /window\.initProjects\s*=\s*initProjects/,
    'projects.js must export window.initProjects — app.js looks it up by that name, ' +
      'which is why it is on the obfuscator reservedNames list'
  );
  assert.match(
    SRC,
    /return\s*\{\s*open:/,
    'initProjects(api) must return an { open } handler'
  );
});

test('the overlay element stays owned by app.js', () => {
  // A local `let projOverlayEl` here would compile and work, right up until the
  // finale fired over an open case study.
  assert.doesNotMatch(
    SRC,
    /^\s*(let|var|const)\s+projOverlayEl\b/m,
    'projOverlayEl must not be declared in the chunk — read/write it as api.projOverlayEl'
  );
  assert.match(
    SRC,
    /api\.projOverlayEl/,
    'the chunk should reach the overlay through the bridge'
  );
});
