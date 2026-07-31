'use strict';

// Dependency-isolation guard for halllm.js: the experimental LLM HAL (halLLMBridge → initHalLLM; Turnstile is deliberately read as window.turnstile).
// The chunk must reference NOTHING from app.js/lib by free global name or the
// obfuscated build's per-chunk name mangling breaks it — full rationale and
// the fix recipe live in test/helpers/chunk-isolation.js (shared by all eight
// *-isolation.test.js guards).

const { test } = require('node:test');
const { assertChunkIsolated } = require('./helpers/chunk-isolation');

test('halllm.js references no app.js/lib globals (everything comes via the api bridge)', () => {
  assertChunkIsolated('halllm.js');
});
