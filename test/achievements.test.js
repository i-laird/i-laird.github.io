'use strict';

// Easter-egg count + id integrity guard.
//
// The achievement set is coupled to two things that live outside app.js and drift
// silently when it changes:
//   1. generate_og_image.sh hardcodes the count ("N easter eggs") into the share image.
//   2. unlockAchievement('id') is called from ~50 sites across app.js / stickfighter.js /
//      index.html; a typo'd id never unlocks and fails silently.
// CLAUDE.md also notes the finale's `foundEggs.size === ACHIEVEMENTS.length` math is tied
// to this count. These assertions fail loudly the moment any of that diverges.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Pull the ids out of the `const ACHIEVEMENTS = [ ... ];` block in app.js.
function achievementIds() {
  const src = read('app.js');
  const block = src.match(/const ACHIEVEMENTS\s*=\s*\[([\s\S]*?)\n\s*\];/);
  assert.ok(block, 'ACHIEVEMENTS array should be present in app.js');
  return [...block[1].matchAll(/\bid:\s*'([a-z0-9-]+)'/g)].map((m) => m[1]);
}

// Every literal unlockAchievement('id') call across the codebase. Dynamic calls
// (unlockAchievement(data.ach), unlockAchievement(item.ach)) are resolved at runtime from
// backend / item data and can't be checked statically, so they're intentionally excluded.
function referencedIds() {
  const files = ['app.js', 'stickfighter.js', 'index.html'];
  const ids = [];
  for (const f of files) {
    for (const m of read(f).matchAll(/unlockAchievement\(\s*'([a-z0-9-]+)'\s*\)/g)) {
      ids.push({ id: m[1], file: f });
    }
  }
  return ids;
}

test('achievement ids are unique', () => {
  const ids = achievementIds();
  const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
  assert.deepEqual(dupes, [], `duplicate achievement ids: ${dupes.join(', ')}`);
});

test('the OG share image hardcodes the current easter-egg count', () => {
  const ids = achievementIds();
  const og = read('generate_og_image.sh');
  const m = og.match(/(\d+)\s+easter eggs/);
  assert.ok(m, 'generate_og_image.sh should mention "<N> easter eggs"');
  assert.equal(
    Number(m[1]),
    ids.length,
    `generate_og_image.sh says ${m[1]} easter eggs but ACHIEVEMENTS has ${ids.length} — ` +
      're-run ./generate_og_image.sh after changing the achievement set'
  );
});

test('every unlockAchievement() call references a defined achievement id', () => {
  const defined = new Set(achievementIds());
  const bad = referencedIds().filter(({ id }) => !defined.has(id));
  assert.deepEqual(
    bad,
    [],
    'unlockAchievement() called with unknown id(s): ' +
      bad.map(({ id, file }) => `'${id}' (${file})`).join(', ')
  );
});
