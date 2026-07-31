'use strict';

// Dependency-isolation guard for room.js: the CSS-3D room (roomBridge → initRoom).
// The chunk must reference NOTHING from app.js/lib by free global name or the
// obfuscated build's per-chunk name mangling breaks it — full rationale and
// the fix recipe live in test/helpers/chunk-isolation.js (shared by all eight
// *-isolation.test.js guards).

const { test } = require('node:test');
const { assertChunkIsolated } = require('./helpers/chunk-isolation');

test('room.js references no app.js/lib globals (everything comes via the api bridge)', () => {
  assertChunkIsolated('room.js');
});
