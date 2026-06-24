// Deterministic PRNG for the Stick Fighter sim — the seedable random source that
// makes a run a pure function of (seed, inputs). This is the groundwork for run
// replays/ghosts and, eventually, lockstep multiplayer: given the same seed and
// the same inputs, two machines produce bit-identical simulations. Dual-mode like
// the other lib/ helpers — top-level functions are browser globals (read by
// stickfighter.js in the shared classic-script scope), and module.exports feeds
// the Node unit tests.

// mulberry32: a tiny, fast, fully-deterministic 32-bit PRNG. Returns a generator
// that yields the next float in [0, 1) — a drop-in for Math.random(), except the
// stream is reproducible from its seed.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Hash an arbitrary string to a 32-bit seed (FNV-1a) — so a shared room code can
// seed both peers identically without exchanging a raw number.
function hashSeed(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { makeRng, hashSeed };
}
