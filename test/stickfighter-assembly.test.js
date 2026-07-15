'use strict';

/*
 * stickfighter.js is a GENERATED artifact, assembled from the stickfighter/
 * part files by scripts/assemble-sf.js (the parts are the source of truth —
 * see CLAUDE.md). This test pins the committed artifact to the parts so that
 * neither can drift:
 *  - editing a part without running `npm run assemble` fails CI, and
 *  - editing stickfighter.js directly (the classic mistake) also fails CI,
 *    because the assembly no longer reproduces it.
 * It also sanity-checks the part inventory so a part that stops matching the
 * NN-*.js naming (and would silently drop out of the build) is caught.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const { assemble, partFiles, OUT } = require('../scripts/assemble-sf.js');

test('committed stickfighter.js matches the assembled parts exactly', () => {
  const artifact = fs.readFileSync(OUT, 'utf8');
  const assembled = assemble();
  assert.strictEqual(
    artifact,
    assembled,
    'stickfighter.js is stale or was edited directly — edit stickfighter/ parts and run `npm run assemble`'
  );
});

test('part inventory is sane', () => {
  const parts = partFiles();
  assert.ok(parts.length >= 20, `expected the full part set, got ${parts.length}`);
  // every .js file in stickfighter/ must match the NN-*.js pattern the
  // assembler picks up — a mis-named file would be silently excluded
  const all = fs
    .readdirSync(path.join(__dirname, '..', 'stickfighter'))
    .filter((f) => f.endsWith('.js'));
  assert.deepStrictEqual(
    all.sort(),
    parts,
    'a stickfighter/ .js file does not match the NN-*.js assembly pattern'
  );
});

test('assembled artifact keeps the chunk contract', () => {
  const artifact = fs.readFileSync(OUT, 'utf8');
  assert.ok(
    artifact.includes('window.openStickFighter = openStickFighter'),
    'the openStickFighter window export must survive assembly (the lazy-load handshake depends on it)'
  );
  assert.ok(
    artifact.startsWith('// GENERATED FILE'),
    'the artifact must carry the generated-file warning header'
  );
});
