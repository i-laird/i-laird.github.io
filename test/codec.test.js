'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _djb2, _xorDecode, _hexRows } = require('../lib/codec.js');

// These constants mirror the live values in app.js. They double as
// known-answer (round-trip) tests for the decrypt puzzle: if either the
// cipher, the key, or the codec drifts, these fail.
const EGG_CIPHER =
  '17242737797b515e11292f6c5c5d515928613e3a2d5a1044592d613850445c5564323d322b56454345';
const EGG_KEY = 'DAISY2001HAL9000';
const EGG_KEY_HASH = 4147063596;

const EGG2_CIPHER = '07091b1a0a66107962680a057777101d6412263721202d732d5a551046273328';
const EGG2_KEY = 'DAISY2001HAL9000DAVE';
const EGG2_KEY_HASH = 67679802;

test('_djb2 is deterministic and unsigned 32-bit', () => {
  assert.equal(_djb2(''), 5381);
  assert.equal(_djb2('a'), _djb2('a'));
  const h = _djb2('the quick brown fox');
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
});

test('_djb2 matches the live key hashes', () => {
  assert.equal(_djb2(EGG_KEY), EGG_KEY_HASH);
  assert.equal(_djb2(EGG2_KEY), EGG2_KEY_HASH);
});

test('_djb2 is collision-sensitive to small changes', () => {
  assert.notEqual(_djb2('DAISY2001HAL9000'), _djb2('DAISY2001HAL9001'));
});

test('_xorDecode round-trips the puzzle ciphertexts to their plaintext', () => {
  assert.equal(_xorDecode(EGG_CIPHER, EGG_KEY), 'Send Ian an email with the title stardust');
  assert.equal(_xorDecode(EGG2_CIPHER, EGG2_KEY), 'CHRIST IS KING - Spread the word');
});

test('_xorDecode with the wrong key does not yield the plaintext', () => {
  assert.notEqual(
    _xorDecode(EGG_CIPHER, 'WRONGKEY00000000'),
    'Send Ian an email with the title stardust'
  );
});

test('_hexRows formats 16-byte offset rows', () => {
  const rows = _hexRows(EGG_CIPHER);
  assert.ok(rows[0].startsWith('0x0000:  '));
  assert.ok(rows[1].startsWith('0x0010:  '));
  // Each row holds at most 16 space-separated byte pairs.
  for (const row of rows) {
    const bytes = row.split(':  ')[1].split(' ');
    assert.ok(bytes.length <= 16);
    for (const b of bytes) assert.match(b, /^[0-9a-f]{2}$/);
  }
});
