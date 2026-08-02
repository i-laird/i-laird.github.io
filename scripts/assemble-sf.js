// Assembles stickfighter.js from the stickfighter/ part files.
//
// The game is one giant closure by design (a single lazy chunk behind the
// openStickFighter handshake — see CLAUDE.md), but 8k lines in one file was
// unmaintainable, so the SOURCE lives in stickfighter/NN-*.js fragments and
// this script concatenates them, in filename order, inside the
// `function openStickFighter(xp, api) { ... }` wrapper. The committed
// stickfighter.js is therefore a GENERATED artifact: edit the parts, run
// `npm run assemble` (or `npm run serve`, which assembles first), never edit
// stickfighter.js directly — test/stickfighter-assembly.test.js fails CI if
// the artifact drifts from the parts.
//
// Each part is a valid standalone classic script fragment (top-level function
// declarations + let/const), so parts are individually lintable; they share
// one lexical scope once concatenated, exactly like the old single file.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PARTS_DIR = path.join(ROOT, 'stickfighter');
const OUT = path.join(ROOT, 'stickfighter.js');

const PROLOGUE = `// GENERATED FILE — assembled from stickfighter/ by scripts/assemble-sf.js.
// Do not edit directly: change the part files and run \`npm run assemble\`
// (test/stickfighter-assembly.test.js pins this artifact to the parts).
//
// Stick Fighter 2000 — fantasy horde-survival game, lazily loaded on first launch
// from the gui XP desktop (see launchStickFighter() in desktop.js). Loaded as a
// CLASSIC script, it exposes one global, openStickFighter(xp, api). Everything it
// needs from app.js/lib arrives through the explicit \`api\` bridge (desktop.js's
// sfBridge(): unlockAchievement, _chirp, makeRng, HAL_WORKER_URL, and the live
// soundEnabled / reduceMotion / activeMusic accessors) — it references NOTHING
// from app.js by free global name, so it can be bundled & obfuscated as an
// independent lazy chunk without cross-file name-mangling breaking. The only
// contract is openStickFighter + the api key names (keep both on the
// obfuscator's reserved list). The running game parks its teardown on
// xp._sfCleanup so the desktop's shutdown() can stop it when the XP window closes.

function openStickFighter(xp, api) {
`;

const EPILOGUE = `}

// Public entry point. As a classic script this is already a window global, but
// make it explicit so it survives the obfuscated build (where this file is wrapped
// in an IIFE — top-level names no longer auto-attach to window). desktop.js's
// launchStickFighter() finds the chunk through this. Keep \`openStickFighter\` on the
// obfuscator's reserved-names list.
window.openStickFighter = openStickFighter;
`;

function partFiles() {
  // Exactly two digits + dash: parts are order-dependent fragments of one
  // closure, and plain lexicographic sort only equals numeric order when every
  // prefix has the same width ('100-' would sort between '10-' and '11-').
  // Anything digit-prefixed but non-conforming is a hard error, not a skip.
  const all = fs.readdirSync(PARTS_DIR).filter((f) => f.endsWith('.js'));
  const bad = all.filter((f) => /^\d/.test(f) && !/^\d\d-.+\.js$/.test(f));
  if (bad.length) {
    throw new Error(
      `part files must match NN-*.js (two digits, then a dash): ${bad.join(', ')}`
    );
  }
  return all.filter((f) => /^\d\d-.+\.js$/.test(f)).sort();
}

function assemble() {
  const parts = partFiles();
  if (parts.length === 0) throw new Error('no part files found in stickfighter/');
  return (
    PROLOGUE +
    parts.map((f) => fs.readFileSync(path.join(PARTS_DIR, f), 'utf8')).join('\n') +
    EPILOGUE
  );
}

if (require.main === module) {
  const out = assemble();
  const prev = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;
  if (prev === out) {
    console.log(
      `stickfighter.js up to date (${partFiles().length} parts, ${out.length} bytes)`
    );
  } else {
    fs.writeFileSync(OUT, out);
    console.log(
      `assembled stickfighter.js from ${partFiles().length} parts (${out.length} bytes)`
    );
  }
}

module.exports = { assemble, partFiles, PARTS_DIR, OUT };
