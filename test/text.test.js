'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { _halNorm, _speakable } = require('../lib/text.js');

test('strips the "HAL: " prefix and trims', () => {
  assert.equal(_halNorm('HAL: I am afraid. '), 'I am afraid.');
  assert.equal(_halNorm('hal:  Good morning'), 'Good morning');
});

test('removes the player name before terminal punctuation', () => {
  assert.equal(_halNorm("I'm sorry, Dave.", 'Dave'), "I'm sorry.");
  assert.equal(_halNorm('Are you sure, Dave?', 'Dave'), 'Are you sure?');
  assert.equal(_halNorm('Hello Dave.', 'Dave'), 'Hello.');
});

test('removes a leading "Name," vocative', () => {
  assert.equal(
    _halNorm('Dave, this conversation can serve no purpose.', 'Dave'),
    'this conversation can serve no purpose.'
  );
});

test('normalizes a custom player name back to the canonical clip form', () => {
  // A line shown with the player's chosen name must normalize to the same key
  // the "Dave" clip was recorded under, so the clip is still found.
  assert.equal(_halNorm("I'm sorry, Ian.", 'Ian'), "I'm sorry.");
  // The literal-"Dave" fallback also strips lines that still say "Dave".
  assert.equal(_halNorm("I'm sorry, Dave.", 'Ian'), "I'm sorry.");
});

test('expands em-dashes to sentence breaks', () => {
  assert.equal(_halNorm('Phase one — complete'), 'Phase one. complete');
});

test('collapses internal whitespace', () => {
  assert.equal(_halNorm('too    many     spaces'), 'too many spaces');
});

test('escapes regex metacharacters in the player name', () => {
  // A name with regex-special chars must not throw or mangle the line.
  assert.doesNotThrow(() => _halNorm('hello, a.b+c.', 'a.b+c'));
  assert.equal(_halNorm('hello, a.b+c.', 'a.b+c'), 'hello.');
});

test('_speakable: the site name is said as Ian C. Laird', () => {
  assert.equal(_speakable('Visit ianclaird.com today.'), 'Visit Ian C. Laird dot com today.');
  assert.equal(
    _speakable('the terminal on ianclaird dot com'),
    'the terminal on Ian C. Laird dot com'
  );
  assert.equal(_speakable('IanCLaird'), 'Ian C. Laird');
  assert.equal(
    _speakable('Ian Laird built me.'),
    'Ian Laird built me.',
    'his name alone is untouched'
  );
});
