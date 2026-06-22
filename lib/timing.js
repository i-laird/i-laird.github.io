/*
 * timing.js — LCS alignment of ElevenLabs per-character clip timings to the
 * on-screen text, so the HAL typewriter stays in sync even when a player name
 * is injected into a line the clip recorded as "Dave".
 *
 * Dual-mode: classic <script> global in the browser, require()-able in tests.
 * Pure function — no DOM, no globals.
 */

/**
 * Map each character of `fullText` to a timestamp drawn from a clip's
 * per-character timing data. Characters present in the display text but not in
 * the clip (an injected player name, a "HAL: " prefix) inherit the previous
 * matched timestamp, so they all reveal at the same instant.
 *
 * @param {string[]} srcChars characters the clip voices, in order
 * @param {number[]} srcTimes start time (seconds) for each clip character
 * @param {string} fullText the text actually shown on screen
 * @returns {Float64Array} one timestamp (seconds) per character of fullText
 */
function _alignTimings(srcChars, srcTimes, fullText) {
  const m = srcChars.length,
    n = fullText.length;
  // Build LCS DP table
  const dp = [];
  for (let i = 0; i <= m; i++) dp.push(new Uint16Array(n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        srcChars[i - 1].toLowerCase() === fullText[j - 1].toLowerCase()
          ? dp[i - 1][j - 1] + 1
          : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  // Traceback
  const matched = new Float64Array(n); // 0 = unmatched sentinel
  let i = m,
    j = n;
  while (i > 0 && j > 0) {
    if (srcChars[i - 1].toLowerCase() === fullText[j - 1].toLowerCase()) {
      matched[j - 1] = srcTimes[i - 1] + 1e-9; // +epsilon so 0.0s is distinguishable from unmatched
      i--;
      j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--;
    } else {
      j--;
    }
  }
  // Fill unmatched chars with the previous known time (or 0)
  let last = 0;
  const times = new Float64Array(n);
  for (let k = 0; k < n; k++) {
    times[k] = matched[k] ? matched[k] - 1e-9 : last;
    if (matched[k]) last = times[k];
  }
  return times;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { _alignTimings };
}
