'use strict';

// HAL clip integrity.
//
// The HAL audio system couples clips to code by string key: HAL_CLIPS values,
// halPlayKey('key') calls, and halTypeLine(text, 'key') second arguments all
// name files in assets/audio/. A typo'd key or a renamed/deleted clip degrades
// silently to TTS (or silence) at runtime — no error, no test failure — the
// same silent-drift class the achievements-integrity test closes for eggs.
// This pins both directions: every referenced key has its mp3, and every
// hal_*.mp3 on disk is still referenced by some source file (no orphans from
// removed features quietly bloating the repo).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// every file that can reference a clip key (stickfighter.js is the assembled
// artifact — scanning it covers the parts)
const SOURCES = [
  'app.js',
  'games.js',
  'sans.js',
  'chess.js',
  'halllm.js',
  'desktop.js',
  'achui.js',
  'room.js',
  'stickfighter.js',
];

test('every referenced hal_* clip key has an mp3, and no mp3 is orphaned', () => {
  const referenced = new Set();
  for (const f of SOURCES) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/'(hal_[a-z0-9_]+)'/g)) referenced.add(m[1]);
  }
  assert.ok(
    referenced.size > 100,
    `sanity: expected 100+ clip keys, found ${referenced.size}`
  );

  const onDisk = new Set(
    fs
      .readdirSync(path.join(ROOT, 'assets', 'audio'))
      .filter((f) => /^hal_.*\.mp3$/.test(f))
      .map((f) => f.replace(/\.mp3$/, ''))
  );

  const missing = [...referenced].filter((k) => !onDisk.has(k));
  assert.deepEqual(
    missing,
    [],
    `clip keys referenced in source with no assets/audio mp3 (typo, or run generate_hal_audio.sh): ${missing.join(', ')}`
  );

  const orphans = [...onDisk].filter((k) => !referenced.has(k));
  assert.deepEqual(
    orphans,
    [],
    `hal_*.mp3 files no source file references (stale clip from a removed line?): ${orphans.join(', ')}`
  );
});

test('per-clip timing JSONs only exist for real clips', () => {
  const audio = fs.readdirSync(path.join(ROOT, 'assets', 'audio'));
  const mp3s = new Set(
    audio.filter((f) => f.endsWith('.mp3')).map((f) => f.replace(/\.mp3$/, ''))
  );
  const strayTimings = audio
    .filter((f) => /^hal_.*\.json$/.test(f))
    .map((f) => f.replace(/\.json$/, ''))
    .filter((k) => k !== 'hal_timing' && !mp3s.has(k)); // hal_timing.json = the aggregate table, not a clip
  assert.deepEqual(
    strayTimings,
    [],
    `timing JSONs without a matching mp3: ${strayTimings.join(', ')}`
  );
});
