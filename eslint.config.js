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

  // The browser runtime. Lenient on purpose: these files are one shared global
  // scope by design, so flag real mistakes (syntax, unreachable code) but not
  // the intentional cross-file globals.
  {
    files: ['app.js', 'stickfighter.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser },
    },
    rules: {
      'no-undef': 'off',
      'no-unused-vars': 'off',
      'no-empty': 'off',
      'no-cond-assign': ['error', 'except-parens'],
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-fallthrough': 'off',
      'no-control-regex': 'off',
    },
  },
];
