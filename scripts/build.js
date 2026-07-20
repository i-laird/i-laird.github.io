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
 *   - dist/app.js        = (lib/*.js + app.js) concatenated, wrapped in ONE IIFE,
 *                          obfuscated HEAVILY. One IIFE so the shared top-level names
 *                          (the lib helpers + app.js internals) become function-scoped
 *                          and get renamed consistently. app.js isn't perf-critical
 *                          (event-driven), so it takes control-flow flattening + dead
 *                          code + string-array.
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
 *     by that name (app.js looks it up; the chunk sets it on window).
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
  ],
};

// HEAVY — the main bundle. Not perf-critical, so throw the book at it.
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
  stringArrayThreshold: 0.75,
  splitStrings: true,
  splitStringsChunkLength: 8,
  identifierNamesGenerator: 'hexadecimal',
  selfDefending: true,
};

// LIGHT — the game chunk. Identifier mangling + plain string relocation only.
// Control-flow flattening / dead code OFF so the 60fps loop keeps its frame budget.
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

// The page-load bundle, in index.html order. lib MUST be bundled with app.js
// (app.js reads _djb2/_xorDecode/_alignTimings/_halNorm/makeRng from it).
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
  'style.css',
  'robots.txt',
  'sitemap.xml',
  'CNAME',
  '.nojekyll',
  'sw.js',
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
  // Main bundle: concat in order, join defensively with ;\n, wrap, obfuscate heavy.
  const bundleSrc = iife(BUNDLE.map(read).join('\n;\n'));
  fs.writeFileSync(path.join(DIST, 'app.js'), obfuscate('app bundle', bundleSrc, HEAVY));

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
  ]) {
    fs.writeFileSync(
      path.join(DIST, chunk),
      obfuscate(chunk.replace('.js', ''), iife(read(chunk)), LIGHT)
    );
  }

  // index.html: the lib scripts are now inside app.js, so drop their tags. (They're loaded
  // with `defer` in the source, so match that; app.js keeps its own deferred tag.)
  let html = read('index.html');
  for (const lib of [
    'lib/codec.js',
    'lib/timing.js',
    'lib/text.js',
    'lib/rng.js',
    'lib/shell.js',
  ]) {
    html = html.replace(new RegExp(`\\s*<script defer src="${lib}"></script>`), '');
  }
  fs.writeFileSync(path.join(DIST, 'index.html'), html);

  // Static passthrough.
  for (const f of STATIC) {
    if (fs.existsSync(path.join(ROOT, f)))
      fs.copyFileSync(path.join(ROOT, f), path.join(DIST, f));
  }
  fs.cpSync(path.join(ROOT, 'assets'), path.join(DIST, 'assets'), { recursive: true });

  console.log(`\nBuilt → ${path.relative(ROOT, DIST)}/`);
}

build();
