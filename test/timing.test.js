'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _alignTimings } = require('../lib/timing.js');

const APPROX = 1e-6;

test('exact match: each char keeps its own timestamp', () => {
  const chars = ['a', 'b', 'c'];
  const times = [0.0, 0.5, 1.0];
  const out = _alignTimings(chars, times, 'abc');
  assert.equal(out.length, 3);
  assert.ok(Math.abs(out[0] - 0.0) < APPROX);
  assert.ok(Math.abs(out[1] - 0.5) < APPROX);
  assert.ok(Math.abs(out[2] - 1.0) < APPROX);
});

test('alignment is case-insensitive', () => {
  const out = _alignTimings(['H', 'I'], [0.2, 0.4], 'hi');
  assert.ok(Math.abs(out[0] - 0.2) < APPROX);
  assert.ok(Math.abs(out[1] - 0.4) < APPROX);
});

test('injected characters inherit the previous matched timestamp', () => {
  // Clip voices "ab"; display inserts an unvoiced "X" between them.
  const out = _alignTimings(['a', 'b'], [0.0, 1.0], 'aXb');
  assert.equal(out.length, 3);
  assert.ok(Math.abs(out[0] - 0.0) < APPROX, 'a -> 0.0');
  assert.ok(Math.abs(out[1] - 0.0) < APPROX, 'X inherits a -> 0.0');
  assert.ok(Math.abs(out[2] - 1.0) < APPROX, 'b -> 1.0');
});

test('leading unmatched characters default to 0', () => {
  const out = _alignTimings(['b'], [2.0], 'ab');
  assert.ok(Math.abs(out[0] - 0.0) < APPROX, 'a has no match -> 0');
  assert.ok(Math.abs(out[1] - 2.0) < APPROX, 'b -> 2.0');
});

test('a 0.0s first timestamp is preserved (epsilon sentinel)', () => {
  const out = _alignTimings(['x'], [0.0], 'x');
  assert.ok(Math.abs(out[0] - 0.0) < APPROX);
});

test('output length always equals the display text length', () => {
  const out = _alignTimings(['a', 'b', 'c'], [0, 1, 2], 'a name here');
  assert.equal(out.length, 'a name here'.length);
});
