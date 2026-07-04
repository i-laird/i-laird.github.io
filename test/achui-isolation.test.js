'use strict';

// Achievements-overlay dependency-isolation guard.
//
// achui.js is the lazily-loaded chunk holding the easter-egg overlay UI (the
// unlocked/locked list, the share view, and the share-card canvas). For it to
// be bundled and obfuscated independently of app.js (same as the other lazy
// chunks), it must reference NOTHING from app.js/lib by free global name —
// every external dependency arrives through the explicit `api` bridge
// (app.js's achBridge(), passed to initAchUI(api)).
//
// See sans-isolation.test.js for why this is checked statically: in the real
// page everything shares one global scope, so a stray free reference still
// resolves at runtime — until the obfuscated build mangles the name on one
// side only.
//
// If this fails: route the flagged name through the api bridge (destructure a
// stable function/const at the top of initAchUI, or read a live flag as
// api.<name>) and add its key to achBridge() in app.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const globals = require('globals');

test('achui.js references no app.js/lib globals (everything comes via the api bridge)', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'achui.js'), 'utf8');
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
    `achui.js must take all app.js/lib dependencies through the api bridge, but ` +
      `still references these by free global name: ${external.join(', ')}`
  );
});
