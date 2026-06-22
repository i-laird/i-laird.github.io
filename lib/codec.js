/*
 * codec.js — pure encode/decode helpers for the decrypt puzzle.
 *
 * Dual-mode by design: loaded as a classic <script> in the browser (these
 * top-level declarations become globals that app.js reads directly, matching
 * the no-module / no-IIFE architecture documented in CLAUDE.md), and also
 * require()-able under Node for the test suite via the module.exports guard
 * at the bottom. Keep every function here pure (no DOM, no globals).
 */

/**
 * djb2 string hash. Used to validate decrypt keys without storing plaintext.
 * @param {string} s
 * @returns {number} unsigned 32-bit hash
 */
function _djb2(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h;
}

/**
 * Decrypt a hex-encoded ciphertext with a repeating-key XOR.
 * @param {string} cipherHex even-length hex string
 * @param {string} key
 * @returns {string} decoded plaintext
 */
function _xorDecode(cipherHex, key) {
  return cipherHex
    .match(/../g)
    .map((h, i) => String.fromCharCode(parseInt(h, 16) ^ key.charCodeAt(i % key.length)))
    .join('');
}

/**
 * Format a hex ciphertext as offset-prefixed rows (a faux hexdump) for display.
 * @param {string} cipherHex
 * @returns {string[]} one string per 16-byte row
 */
function _hexRows(cipherHex) {
  return cipherHex
    .match(/.{1,32}/g)
    .map(
      (r, i) =>
        '0x' + (i * 16).toString(16).padStart(4, '0') + ':  ' + r.match(/../g).join(' ')
    );
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _djb2, _xorDecode, _hexRows };
}
