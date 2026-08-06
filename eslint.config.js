'use strict';

/*
 * ESLint flat config.
 *
 * This project is deliberately framework-free: app.js and stickfighter.js are
 * large *classic scripts* that share one global lexical scope (see CLAUDE.md),
 * so the usual no-undef / no-unused-vars rules produce noise rather than signal
 * for them. The lib/ helpers and the test suite, by contrast, are linted
 * strictly — that's where correctness rules earn their keep.
 */

const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
  { ignores: ['node_modules/**', '_site/**', 'vendor/**', 'assets/**', 'dist/**'] },

  // Build tooling runs under Node.
  {
    files: ['scripts/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },

  // Strict rules for the pure, testable helpers.
  {
    files: ['lib/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      // `playerName` is an app.js global the browser build of text.js reads
      // when called with a single argument.
      globals: { ...globals.browser, ...globals.node, playerName: 'readonly' },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  // The test suite runs under the Node test runner.
  {
    files: ['test/**/*.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
  },

  // The service worker runs in its own worker scope — small and standalone,
  // so it gets the strict ruleset.
  {
    files: ['sw.js'],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.serviceworker },
    },
    rules: {
      ...js.configs.recommended.rules,
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      eqeqeq: ['error', 'smart'],
      'prefer-const': 'error',
    },
  },

  // The browser runtime — app.js and the eight lazy chunks.
  //
  // These files used to opt out of the recommended ruleset wholesale, which
  // meant the LARGEST files in the repo (~25k lines) got the weakest checking:
  // no-dupe-keys, no-unreachable, no-dupe-args, use-isnan, valid-typeof and the
  // rest of the genuine-bug rules were all off. None of those conflict with the
  // shared-global-scope design; only the four exemptions below actually do. So
  // the default is now `recommended`, and every exemption has to justify itself.
  //
  // They cost nothing to enable — the runtime files pass all of it as written.
  {
    files: [
      'app.js',
      'stickfighter.js',
      'stickfighter/**/*.js',
      'games.js',
      'sans.js',
      'chess.js',
      'halllm.js',
      'desktop.js',
      'achui.js',
      'room.js',
    ],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
      // the stickfighter/ parts are fragments of one function body (assembled
      // by scripts/assemble-sf.js), so a top-level `return` is legal in context
      parserOptions: { ecmaFeatures: { globalReturn: true } },
    },
    rules: {
      ...js.configs.recommended.rules,

      // ── The four exemptions the architecture actually requires ──
      // app.js and the chunks are classic scripts sharing one global lexical
      // scope, and each chunk reaches app.js through a bridge; cross-file names
      // are the design, not a mistake. Chunk boundaries are enforced instead by
      // the per-chunk isolation tests (test/*-isolation.test.js), which lint
      // each chunk ALONE with no-undef ON — a stricter check than this file
      // could express, because it knows what is supposed to cross.
      'no-undef': 'off',
      'no-unused-vars': 'off',
      // Empty catch blocks are the feature-detection idiom throughout (every
      // one carries a comment saying which API it is probing).
      'no-empty': 'off',
      // Deliberate switch fallthrough in the game state machines.
      'no-fallthrough': 'off',
      // Terminal output and the ANSI/typewriter paths match control chars.
      'no-control-regex': 'off',

      // Assignment inside a condition must be parenthesised to show intent.
      'no-cond-assign': ['error', 'except-parens'],
      // `while (true)` is the correct shape for the game loops.
      'no-constant-condition': ['error', { checkLoops: false }],

      // Held to the same bar as lib/ and sw.js. All three are already clean
      // across every runtime file, so they are ratchets, not cleanup debt.
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'no-throw-literal': 'error',

      // prefer-const is deliberately NOT enabled here, and the reason is worth
      // recording because it looks like an oversight.
      //
      // The stickfighter/ parts are fragments of ONE function body, assembled
      // by scripts/assemble-sf.js. A variable declared in one part is routinely
      // reassigned in another — `cheatBuf` is declared in 22-flow.js and
      // written in 23-input.js — so when ESLint lints a part in isolation it
      // cannot see the reassignment and reports a false positive. Running
      // --fix on that advice produces a const that throws at runtime and
      // silently breaks the game.
      //
      // Outside stickfighter the rule is sound but finds only four sites, all
      // of them one never-reassigned declarator inside a mixed `let a, b`
      // statement that has to stay `let` for the sibling. Nothing to buy.
    },
  },
];
