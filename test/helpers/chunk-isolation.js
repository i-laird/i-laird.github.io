'use strict';

// Shared body of the eight per-chunk dependency-isolation guards
// (*-isolation.test.js). Each lazy chunk must reference NOTHING from
// app.js/lib by free global name — every external dependency arrives through
// its explicit `api` bridge — or the obfuscated build's per-chunk name
// mangling breaks it. Invisible at runtime in the clean source (one shared
// global scope), so it's enforced statically: lint the chunk in ISOLATION
// (browser globals only) with no-undef on.
//
// If a caller's test fails: route the flagged name through that chunk's api
// bridge (destructure a stable function/const at the top of its init, or read
// a live flag as api.<name>) and add the key to the matching bridge in app.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const globals = require('globals');

function assertChunkIsolated(file) {
  const code = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf8');
  const linter = new Linter();
  const messages = linter.verify(code, {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser }, // browser builtins are fine; app.js/lib globals are not
    },
    rules: { 'no-undef': 'error' },
  });

  const external = [
    ...new Set(
      messages
        .filter((m) => m.ruleId === 'no-undef')
        .map((m) => (m.message.match(/'([^']+)'/) || [])[1])
        .filter(Boolean)
    ),
  ].sort();

  assert.deepEqual(
    external,
    [],
    `${file} must take all app.js/lib dependencies through the api bridge, but ` +
      `still references these by free global name: ${external.join(', ')}`
  );
}

module.exports = { assertChunkIsolated };
