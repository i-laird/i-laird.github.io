'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { makeRng, hashSeed } = require('../lib/rng.js');

// The whole point of this module is reproducibility — two generators seeded the
// same must walk in lockstep. This is the property future replays/multiplayer rely on.
test('same seed yields an identical sequence', () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 200; i++) assert.strictEqual(a(), b());
});

test('different seeds diverge', () => {
  const a = makeRng(1);
  const b = makeRng(2);
  let collisions = 0;
  for (let i = 0; i < 100; i++) if (a() === b()) collisions++;
  assert.ok(collisions < 3, `streams should differ (got ${collisions} collisions)`);
});

test('values are floats in [0, 1)', () => {
  const r = makeRng(99);
  for (let i = 0; i < 2000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

// Pin the algorithm: an accidental change to the PRNG (which would silently break
// every saved seed/replay) trips this. Values captured from mulberry32(0).
test('a known seed produces stable output', () => {
  const r = makeRng(0);
  assert.ok(Math.abs(r() - 0.26642920868471265) < 1e-15);
  assert.ok(Math.abs(r() - 0.0003297457005828619) < 1e-15);
});

test('hashSeed is deterministic and an unsigned 32-bit int', () => {
  assert.strictEqual(hashSeed('ROOM42'), hashSeed('ROOM42'));
  assert.strictEqual(hashSeed('ROOM42'), 3418095784);
  assert.notStrictEqual(hashSeed('a'), hashSeed('b'));
  const h = hashSeed('anything');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});
