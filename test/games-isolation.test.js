'use strict';

// Shell-games dependency-isolation guard.
//
// games.js is the lazily-loaded chunk holding the four createGameShell games
// (racecar / snake / pong / 2048). For it to be bundled and obfuscated
// independently of app.js (same as stickfighter.js), it must reference NOTHING
// from app.js/lib by free global name — every external dependency arrives
// through the explicit `api` bridge (app.js's gamesBridge(), passed to
// initGames(api)).
//
// This invariant is invisible to the other tests: in the real page everything
// shares one global scope, so a stray `godmodeUnlocked` (or any app.js global)
// still resolves at runtime and nothing breaks — until the obfuscated build
// mangles the name on one side only. So we check it statically here: lint
// games.js in ISOLATION (browser globals only, no app.js globals) with
// no-undef on. Anything it flags is a free reference into another file that
// the bridge must carry.
//
// If this fails: route the flagged name through the api bridge (destructure a
// stable function/const at the top of initGames, or read a live flag as
// api.<name>) and add its key to gamesBridge() in app.js.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Linter } = require('eslint');
const globals = require('globals');

test('games.js references no app.js/lib globals (everything comes via the api bridge)', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'games.js'), 'utf8');
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
    `games.js must take all app.js/lib dependencies through the api bridge, but ` +
      `still references these by free global name: ${external.join(', ')}`
  );
});
