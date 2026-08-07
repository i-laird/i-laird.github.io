'use strict';

/*
 * Obfuscated production build.
 *
 * This project is normally a no-build, hand-written static site — the source IS
 * what's served, and `npm run serve` serves it directly. This script is the
 * exception: it produces a `dist/` whose JS is obfuscated gibberish, for deploying
 * a site whose secrets (the easter-egg hunt logic, the decrypt puzzle, HAL, the
 * finale) aren't trivially readable / paste-into-an-LLM-able. The clean source
 * stays the source of truth; tests run against it, not the build.
 *
 * Topology (see CLAUDE.md "Cross-file globals" + the stickfighter api bridge):
 *   - dist/app.js        = TWO independently-obfuscated IIFEs concatenated:
 *                          (a) secrets.js, obfuscated HEAVILY — the puzzle ciphers,
 *                              key hashes and the four scattered key fragments. This
 *                              is the only code whose plaintext actually spoils
 *                              anything, so it takes the full treatment.
 *                          (b) lib/*.js + app.js, obfuscated LIGHTLY. One IIFE so the
 *                              shared top-level names (lib helpers + app.js internals)
 *                              become function-scoped and get renamed consistently.
 *                          (a) comes first: it defines window.initSecrets, which (b)
 *                          calls at load through app.js's secretsBridge().
 *
 *                          WHY THE SPLIT: the heavy config used to run over the whole
 *                          4,600-line bundle to hide ~60 lines of secret, and it cost
 *                          ~156 KB GZIPPED (223 KB → 68 KB) on the one script every
 *                          visitor downloads — control-flow flattening ~88 KB,
 *                          dead-code injection ~68 KB, split-strings ~36 KB. Measured
 *                          on the real bundle. The light config is what the lazy chunks
 *                          already use and lands within a few KB of the clean source.
 *
 *                          Both halves of the protection matter, which is why the
 *                          FRAGMENTS live in secrets.js and not just the ciphers: LIGHT
 *                          still mangles every identifier (verify-deployed.js relies on
 *                          exactly that), but it leaves string literals in the clear.
 *                          Identifiers are covered either way; the *data* is only
 *                          hidden by HEAVY's encoded string array.
 *   - dist/stickfighter.js = stickfighter.js wrapped in its own IIFE, obfuscated
 *                          LIGHTLY. It's a 60fps game loop, so control-flow flattening
 *                          (the expensive transform) is OFF — just identifier mangling
 *                          + plain string-array relocation, which is ~free at runtime.
 *                          It reaches app.js only through the explicit `api` bridge, so
 *                          it can be a separate chunk.
 *   - dist/games.js      = the four shell games (racecar/snake/pong/2048), same
 *                          treatment: own IIFE, LIGHT (they run 20Hz–60fps loops),
 *                          reached only through app.js's gamesBridge().
 *   - dist/sans.js       = the sans easter egg (command set + battle), same
 *                          treatment: own IIFE, LIGHT (20fps battle loop), reached
 *                          only through app.js's sansBridge().
 *   - dist/chess.js      = the chess game, same treatment: own IIFE, LIGHT,
 *                          reached only through app.js's chessBridge().
 *   - dist/index.html    = the five lib+app <script> tags collapsed to one app.js.
 *   - static files copied through.
 *
 * Invariants the configs must preserve (or the site breaks):
 *   - renameProperties / transformObjectKeys OFF — worker JSON fields, DOM props,
 *     the api.* bridge keys, and the window.<publicFn> exports are all literal
 *     property names.
 *   - the chunk entry names (openStickFighter, initGames, initSansMode, initChess)
 *     reserved on both sides — each lazy-load handshake crosses its chunk boundary
 *     by that name (app.js looks it up; the chunk sets it on window). initSecrets is
 *     on the same list: it crosses an obfuscation-unit boundary inside dist/app.js.
 *   - no source maps (they'd hand back the clean source).
 */

const fs = require('fs');
const path = require('path');
const JavaScriptObfuscator = require('javascript-obfuscator');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');

// Wrap a script in an IIFE so its top-level declarations become function-scoped —
// the obfuscator then renames them (it leaves true globals alone). The files are
// sloppy-mode classic scripts; a plain IIFE preserves that.
const iife = (code) => `(function(){\n${code}\n})();\n`;

// Shared: never rename properties (breaks JSON/DOM/api access), keep the cross-chunk
// entry names, never emit source maps.
const COMMON = {
  renameProperties: false,
  transformObjectKeys: false,
  renameGlobals: false,
  sourceMap: false,
  reservedNames: [
    '^openStickFighter$',
    '^initGames$',
    '^initSansMode$',
    '^initChess$',
    '^initHalLLM$',
    '^initDesktop$',
    '^initAchUI$',
    '^initRoom$',
    '^initProjects$',
    '^initSecrets$',
  ],
};

// HEAVY — the secret unit (secrets.js) ONLY. Tiny, runs once at load, so the
// cost of throwing the book at it is a few KB and no measurable runtime.
// Do NOT widen this back over the main bundle: see the topology note above.
const HEAVY = {
  ...COMMON,
  compact: true,
  controlFlowFlattening: true,
  controlFlowFlatteningThreshold: 0.75,
  deadCodeInjection: true,
  deadCodeInjectionThreshold: 0.3,
  numbersToExpressions: true,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['base64'],
  // 1, NOT the usual 0.75. The threshold is the PROBABILITY each literal gets
  // moved into the encoded array, and the obfuscator is randomized — at 0.75 a
  // short fragment like 'DAIS' was left in the clear (control-flow flattening
  // hoists it into a plain `{'fqSdo':'DAIS'}` map) in 9 of 12 sample builds.
  // Every string in this unit is a secret, so none of them may roll the dice.
  // verify-build.js gates the built file on this, since a lucky build proves
  // nothing about the next one.
  stringArrayThreshold: 1,
  splitStrings: true,
  splitStringsChunkLength: 8,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: true,
};

// LIGHT — the main bundle and every lazy chunk. Identifier mangling + plain
// string relocation only. Control-flow flattening / dead code OFF: for the game
// chunks it protects the frame budget, and for the main bundle it protects first
// paint (the heavy config tripled its gzipped size). Identifiers are still fully
// mangled here — string literals are not, which is exactly why anything that must
// stay unreadable belongs in secrets.js instead.
const LIGHT = {
  ...COMMON,
  compact: true,
  controlFlowFlattening: false,
  deadCodeInjection: false,
  numbersToExpressions: false,
  simplify: true,
  stringArray: true,
  stringArrayEncoding: ['none'], // relocate strings but don't decode-per-access (cheap)
  stringArrayThreshold: 0.5,
  splitStrings: false,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: false,
};

// The secret unit — obfuscated on its own, heavily. See the topology note.
const SECRETS = 'secrets.js';

// The page-load bundle, in index.html order. lib MUST be bundled with app.js
// (app.js reads _djb2/_xorDecode/_alignTimings/_halNorm/makeRng from it).
// secrets.js is deliberately NOT in here — it is a separate obfuscation unit.
const BUNDLE = [
  'lib/codec.js',
  'lib/timing.js',
  'lib/text.js',
  'lib/rng.js',
  'lib/shell.js',
  'app.js',
];

// Static files served as-is. sw.js is deliberately NOT obfuscated — it holds
// no secrets, and it must stay reviewable (a broken service worker is the one
// file that can wedge returning visitors).
const STATIC = [
  '404.html',
  'privacy.html',
  'terms.html',
  'style.css',
  'robots.txt',
  'sitemap.xml',
  'CNAME',
  '.nojekyll',
  'sw.js',
  // RFC 9116. Served from a dot-directory, which GitHub Pages only passes
  // through because .nojekyll is set — Jekyll would drop it silently.
  '.well-known/security.txt',
];

function obfuscate(label, code, options) {
  const t0 = Date.now();
  const out = JavaScriptObfuscator.obfuscate(code, options).getObfuscatedCode();
  console.log(
    `  ${label}: ${(code.length / 1024).toFixed(0)} KB → ${(out.length / 1024).toFixed(0)} KB ` +
      `(${((Date.now() - t0) / 1000).toFixed(1)}s)`
  );
  return out;
}

function build() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  // stickfighter.js is assembled from stickfighter/ parts — make sure the
  // artifact is current before bundling (a no-op when nothing changed).
  const { assemble, OUT: SF_OUT } = require('./assemble-sf');
  const sf = assemble();
  if (!fs.existsSync(SF_OUT) || fs.readFileSync(SF_OUT, 'utf8') !== sf) {
    fs.writeFileSync(SF_OUT, sf);
    console.log('Assembled stickfighter.js from parts');
  }

  console.log('Obfuscating…');
  // dist/app.js = the heavy secret unit, then the light main bundle. Separate
  // obfuscation passes, so nothing may cross between them by free name — the
  // handshake is window.initSecrets (reserved) + app.js's secretsBridge().
  // Order matters: secrets.js must define the global before app.js runs.
  const secretsOut = obfuscate('secrets (heavy)', iife(read(SECRETS)), HEAVY);
  const bundleOut = obfuscate(
    'app bundle (light)',
    iife(BUNDLE.map(read).join('\n;\n')),
    LIGHT
  );
  fs.writeFileSync(path.join(DIST, 'app.js'), secretsOut + '\n' + bundleOut);

  // Lazy chunks: wrap each in its own IIFE, obfuscate light (they all run
  // game loops; each exports only its window.<entry> — see reservedNames).
  for (const chunk of [
    'stickfighter.js',
    'games.js',
    'sans.js',
    'chess.js',
    'halllm.js',
    'desktop.js',
    'achui.js',
    'room.js',
    'projects.js',
  ]) {
    fs.writeFileSync(
      path.join(DIST, chunk),
      obfuscate(chunk.replace('.js', ''), iife(read(chunk)), LIGHT)
    );
  }

  // index.html: the lib scripts and secrets.js are now inside app.js, so drop their
  // tags. (They're loaded with `defer` in the source, so match that; app.js keeps its
  // own deferred tag.)
  let html = read('index.html');
  for (const lib of [
    'lib/codec.js',
    'lib/timing.js',
    'lib/text.js',
    'lib/rng.js',
    'lib/shell.js',
    'secrets.js',
  ]) {
    const before = html;
    html = html.replace(new RegExp(`\\s*<script defer src="${lib}"></script>`), '');
    // a formatting change to the tag would make the replace silently no-op,
    // shipping a dist/index.html that 404s on lib/ — fail the build instead
    if (html === before)
      throw new Error(
        `build: expected to remove the <script> tag for ${lib} from index.html but found no match — did the tag format change?`
      );
  }
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  // Static passthrough. mkdir first: STATIC carries nested paths now
  // (.well-known/security.txt), and copyFileSync will not create the parent.
  for (const f of STATIC) {
    if (!fs.existsSync(path.join(ROOT, f))) continue;
    const dest = path.join(DIST, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dest);
  }
  // Assets are copied wholesale, which means a recursive copy of whatever
  // happens to be sitting in that directory — including OS and editor debris.
  // .gitignore keeps that junk out of the REPO but has no say over the build,
  // so a local `npm run build` would publish it. A .DS_Store is a directory
  // listing: it names every file beside it, including ones that were deleted
  // or never linked. CI builds from a clean clone and never had the problem,
  // which is exactly why it would have gone unnoticed.
  const JUNK = new Set([
    '.DS_Store',
    'Thumbs.db',
    'desktop.ini',
    '.Spotlight-V100',
    '.AppleDouble',
  ]);
  let skipped = 0;
  fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), {
    recursive: true,
    filter: (src) => {
      if (!JUNK.has(path.basename(src))) return true;
      skipped++;
      return false;
    },
  });
  if (skipped)
    console.log(`  (skipped ${skipped} junk file${skipped === 1 ? '' : 's'} in assets/)`);

  console.log(`\nBuilt → ${path.relative(ROOT, DIST)}/`);
}

build();
