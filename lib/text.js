/*
 * text.js — text normalization for the HAL clip lookup table.
 *
 * Dual-mode: classic <script> global in the browser, require()-able in tests.
 * Pure aside from the optional `name` argument, which in the browser defaults
 * to the live `playerName` global so existing single-argument call sites in
 * app.js keep working unchanged.
 */

/**
 * Normalize a HAL line to its canonical clip-lookup form: strip the "HAL: "
 * prefix, remove the player's name from the surrounding punctuation (clips are
 * recorded against the canonical name "Dave"), expand em-dashes to sentence
 * breaks, and collapse whitespace.
 *
 * @param {string} raw the raw display line
 * @param {string} [name] the current player name (defaults to the `playerName`
 *   global in the browser, or "Dave")
 * @returns {string} normalized lookup key
 */
function _halNorm(raw, name) {
  if (name === undefined) {
    name = typeof playerName !== 'undefined' ? playerName : 'Dave';
  }
  let s = raw.replace(/^HAL:\s*/i, '').trim();
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  s = s.replace(new RegExp(',\\s*' + esc + '\\.', 'gi'), '.');
  s = s.replace(new RegExp(',\\s*' + esc + '\\?', 'gi'), '?');
  s = s.replace(new RegExp(',\\s*' + esc + '\\b', 'gi'), '');
  s = s.replace(new RegExp('\\s+' + esc + '\\.', 'gi'), '.');
  s = s.replace(new RegExp('\\s+' + esc + '\\?', 'gi'), '?');
  s = s.replace(new RegExp('^' + esc + ',\\s*', 'gi'), '');
  // Also strip plain "Dave" (default name, in case playerName differs)
  s = s
    .replace(/,\s*Dave\./gi, '.')
    .replace(/,\s*Dave\?/gi, '?')
    .replace(/\s+Dave\./gi, '.')
    .replace(/,\s*Dave\b/gi, '')
    .replace(/\bDave,\s*/gi, '');
  // Em-dash → ". " (phase messages use —)
  s = s.replace(/\s*—\s*/g, '. ');
  return s.replace(/\s+/g, ' ').trim();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _halNorm };
}
