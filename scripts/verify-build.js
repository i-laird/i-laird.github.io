'use strict';

/*
 * Post-build verification. Heavy obfuscation can subtly break things that "it
 * parses" won't catch, and the failure is invisible until you click around the
 * live site. So before deploying dist/ we:
 *   1. Boot the REAL obfuscated bundle (dist/app.js) in jsdom and assert the
 *      terminal comes up and the inline-handler public API survived.
 *   2. Drive the obfuscated game chunk (dist/stickfighter.js) headlessly and time
 *      it against the clean source — confirming the light config kept the 60fps
 *      loop's JS overhead negligible (this is the whole point of the heavy/light
 *      split).
 *   3. Execute the other lazy chunks (dist/games.js, dist/sans.js) and assert
 *      each still exports its window.<entry> and returns the handler keys app.js
 *      calls — the cross-chunk contract obfuscation must not break.
 *   4. Assert the easter-egg puzzle is genuinely unreadable in dist/app.js AND
 *      still round-trips. dist/app.js is two independently-obfuscated units — a
 *      heavy one for secrets.js, a light one for everything else — so this is
 *      both the check that the heavy config did its job and the check that the
 *      cross-unit bridge survived it. Obfuscation is randomized, which is why
 *      this gates the artifact rather than the config.
 *
 * Run after `npm run build`. Exits non-zero on failure so CI can gate on it.
 */

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { JSDOM, VirtualConsole } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const read = (p) => fs.readFileSync(p, 'utf8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function makeDom(html) {
  const errors = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) => errors.push(e));
  const dom = new JSDOM(html, {
    url: 'https://ianclaird.com/',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    virtualConsole: vc,
  });
  const { window } = dom;
  window.Audio = class {
    play() {
      return Promise.resolve();
    }
    pause() {}
    load() {}
    addEventListener() {}
    removeEventListener() {}
  };
  window.fetch = () => Promise.reject(new Error('offline'));
  if (window.HTMLCanvasElement) window.HTMLCanvasElement.prototype.getContext = () => null;
  return { dom, window, errors };
}

function inject(window, code) {
  const el = window.document.createElement('script');
  el.textContent = code;
  window.document.body.appendChild(el);
}

// ── 1. The obfuscated main bundle boots and keeps its public API ──────────────
async function verifyBoot() {
  const html = read(path.join(DIST, 'index.html'));
  const { dom, window, errors } = makeDom(html);

  // The static home screen ships the banner and a visible input row in the HTML
  // itself (fast first paint), which would satisfy the asserts below before the
  // bundle even runs. Strip #out and hide the row first so passing them requires
  // boot()'s fallback render to have actually executed inside the obfuscated
  // bundle — this is what catches obfuscation breaking boot.
  window.document.getElementById('out').innerHTML = '';
  const inputRow = window.document.getElementById('input-row');
  inputRow.style.display = 'none';

  inject(window, read(path.join(DIST, 'app.js'))); // the IIFE auto-calls boot()

  // Wait for boot()'s async tail: with #out stripped it takes the fallback
  // render path (banner + cards) and only reveals the input row at the end.
  for (let i = 0; i < 100 && inputRow.style.display !== 'flex'; i++) await sleep(20);

  const out = window.document.getElementById('out').textContent;
  assert.match(out, /IAN {2}LAIRD/, 'obfuscated bundle: boot banner should render');
  assert.equal(
    inputRow.style.display,
    'flex',
    'obfuscated bundle: input row should be revealed'
  );
  for (const fn of ['toggleSound', 'focusCmd', 'unlockAchievement', 'toggleAchievements']) {
    assert.equal(
      typeof window[fn],
      'function',
      `obfuscated bundle: window.${fn} must survive for inline HTML handlers`
    );
  }
  assert.deepEqual(
    errors.map((e) => String(e.detail || e)),
    [],
    'obfuscated bundle: no script errors during load + boot'
  );
  dom.window.close();
  console.log('✓ obfuscated main bundle boots; public API intact');
}

// ── 2. Time the game chunk: obfuscated vs clean ───────────────────────────────
const NOOP_CTX = () => {
  const grad = { addColorStop() {} };
  const fns = {};
  return new Proxy(
    {},
    {
      get(_t, p) {
        if (p === 'canvas') return { width: 800, height: 600 };
        if (p === 'measureText') return () => ({ width: 7 });
        if (
          p === 'createLinearGradient' ||
          p === 'createRadialGradient' ||
          p === 'createPattern'
        )
          return () => grad;
        if (p === 'getImageData') return () => ({ data: new Uint8ClampedArray(4) });
        if (!fns[p]) fns[p] = () => {};
        return fns[p];
      },
      set: () => true,
    }
  );
};

// Minimal mulberry32 so the game's PRNG runs (matches lib/rng.js).
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function timeGame(stickfighterCode, frames) {
  const { dom, window } = makeDom('<!doctype html><html><body></body></html>');
  let raf = [];
  window.requestAnimationFrame = (cb) => raf.push(cb);
  window.cancelAnimationFrame = () => {};
  window.HTMLCanvasElement.prototype.getContext = NOOP_CTX;

  // Pin the seed (init() draws it from Date.now ^ Math.random) so BOTH variants
  // simulate the identical game — the only timing difference is then obfuscation
  // overhead, not which run happened to die early onto the cheap death screen.
  window.Math.random = () => 0;
  window.Date.now = () => 1234;

  inject(window, stickfighterCode);
  const xp = window.document.createElement('div');
  Object.defineProperty(xp, 'offsetWidth', { value: 800 });
  Object.defineProperty(xp, 'offsetHeight', { value: 600 });
  window.document.body.appendChild(xp);

  const api = {
    unlockAchievement: () => {},
    _chirp: () => {},
    makeRng,
    HAL_WORKER_URL: 'https://example.invalid',
    soundEnabled: false,
    reduceMotion: false,
    activeMusic: null,
  };
  window.openStickFighter(xp, api);
  window.document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowRight' }));

  const pump = (n) => {
    for (let i = 0; i < n; i++) {
      const cbs = raf;
      raf = [];
      for (const cb of cbs) cb(16 * i);
    }
  };
  pump(120); // warm up V8
  const t0 = process.hrtime.bigint();
  pump(frames);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  dom.window.close();
  return ms;
}

function verifyGamePerf() {
  const FRAMES = 2000;
  const clean = timeGame(read(path.join(ROOT, 'stickfighter.js')), FRAMES);
  const obf = timeGame(read(path.join(DIST, 'stickfighter.js')), FRAMES);
  const overhead = ((obf / clean - 1) * 100).toFixed(1);
  console.log(
    `✓ game chunk: ${FRAMES} ticks — clean ${clean.toFixed(0)}ms vs obfuscated ${obf.toFixed(0)}ms ` +
      `(${overhead >= 0 ? '+' : ''}${overhead}% JS overhead)`
  );
  // Light config should keep overhead modest. Fail loudly if it regresses badly
  // (e.g. someone turns control-flow flattening on for the game chunk).
  assert.ok(
    obf / clean < 1.6,
    `game JS overhead too high (${overhead}%) — keep the LIGHT config`
  );
}

// ── 3. The other lazy chunks keep their entry globals + handler contracts ─────
function verifyLazyChunks() {
  // Recursive callable stub: any bridge key resolves to a value that is itself
  // callable AND has any property (so init-time code like
  // `api.cmd.addEventListener(...)` in halllm.js works, not just `api.fn()`).
  const anyStub = new Proxy(function () {}, {
    get: (t, p) => (p === Symbol.toPrimitive ? () => '' : anyStub),
    apply: () => anyStub,
    set: () => true,
  });
  const stubApi = anyStub;
  for (const [file, entry, keys] of [
    ['games.js', 'initGames', ['racecar', 'snake', 'pong', '2048']],
    ['sans.js', 'initSansMode', ['activate', 'command', 'battleCommand']],
    ['chess.js', 'initChess', ['chess']],
    ['halllm.js', 'initHalLLM', ['showInfoPage', 'handleInput']],
    ['desktop.js', 'initDesktop', ['open']],
    ['achui.js', 'initAchUI', ['toggle']],
    ['room.js', 'initRoom', ['open']],
    ['projects.js', 'initProjects', ['open']],
  ]) {
    const { dom, window } = makeDom('<!doctype html><html><body></body></html>');
    inject(window, read(path.join(DIST, file)));
    assert.equal(
      typeof window[entry],
      'function',
      `${file}: window.${entry} must survive obfuscation (reserved name)`
    );
    const handlers = window[entry](stubApi);
    for (const k of keys) {
      assert.equal(
        typeof handlers[k],
        'function',
        `${file}: ${entry}() must return a '${k}' handler (literal key — renameProperties must stay off)`
      );
    }
    dom.window.close();
    console.log(`✓ ${file}: ${entry}() exports intact (${keys.join(', ')})`);
  }
}

// ── 4. The puzzle secrets are actually unreadable in the built bundle ─────────
// This is the whole justification for the heavy/light split, and it cannot be
// checked by reading build.js: the obfuscator is RANDOMIZED, so the same config
// leaks on some runs and not others. (At the old stringArrayThreshold of 0.75,
// a four-character fragment survived in the clear in 9 of 12 sample builds —
// control-flow flattening hoists short literals into a plain lookup map that
// the string array never touches.) So gate the artifact itself, every build.
//
// The expected values are parsed OUT of secrets.js rather than restated here,
// so this file never becomes a second plaintext copy of the answers.
function verifySecretsHidden() {
  const src = read(path.join(ROOT, 'secrets.js'));
  const built = read(path.join(DIST, 'app.js'));

  const ciphers = (src.match(/'[0-9a-f]{32,}'/g) || []).map((s) => s.slice(1, -1));
  assert.ok(ciphers.length >= 2, 'secrets.js should hold both encrypted segments');

  const fragBlock = (src.match(/const FRAGMENTS = \[([^\]]*)\]/) || [])[1];
  assert.ok(fragBlock, 'secrets.js should define the FRAGMENTS array');
  const frags = (fragBlock.match(/'[^']+'/g) || []).map((s) => s.slice(1, -1));
  assert.equal(frags.length, 4, 'expected four on-site key fragments');

  const hashes = (src.match(/_KEY_HASH = (\d+)/g) || []).map((s) => s.split('= ')[1]);
  assert.equal(hashes.length, 2, 'expected both key hashes');

  // Fragments are short and collide with ordinary text ("9000" is in "HAL 9000"),
  // so match them the way an attacker would find them: quoted, as the obfuscator
  // emits a leaked literal.
  const leaked = [
    ...ciphers.filter((c) => built.includes(c)).map((c) => `segment ${c.slice(0, 12)}…`),
    ...hashes.filter((h) => built.includes(h)).map((h) => `key hash ${h}`),
    ...frags
      .filter((f) => built.includes(`'${f}'`) || built.includes(`"${f}"`))
      .map((f) => `fragment '${f}'`),
  ];

  assert.deepEqual(
    leaked,
    [],
    `dist/app.js exposes puzzle secrets in plaintext: ${leaked.join(', ')}.\n` +
      `  The HEAVY config in build.js must cover secrets.js with stringArrayThreshold: 1.\n` +
      `  Obfuscation is randomized — rebuild and re-check rather than assuming a fluke.`
  );
  console.log(
    `✓ puzzle secrets hidden in dist/app.js (${ciphers.length} segments, ${frags.length} fragments, ${hashes.length} hashes)`
  );

  // ...and the puzzle still WORKS across the obfuscation-unit boundary. This is
  // the silent failure mode of the split: secrets.js gets its identifiers renamed
  // independently of the main bundle, so if a codec helper ever stopped crossing
  // secretsBridge() the correct key would simply be rejected forever — the site
  // would look completely healthy and only the one player who solved it would
  // ever find out. Drive the REAL obfuscated unit and assert acceptance.
  //
  // The key is assembled from the fragments parsed above, so the answer is never
  // written down here either.
  const { _djb2, _xorDecode, _hexRows } = require(path.join(ROOT, 'lib', 'codec.js'));
  const { dom, window } = makeDom(read(path.join(DIST, 'index.html')));
  inject(window, built);
  assert.equal(
    typeof window.initSecrets,
    'function',
    'dist/app.js must export window.initSecrets (reserved name — app.js calls it across the unit boundary)'
  );

  const printed = [];
  const puzzle = window.initSecrets({
    line: (s) => printed.push(String(s)),
    blank: () => {},
    esc: (s) => s,
    djb2: _djb2,
    xorDecode: _xorDecode,
    hexRows: _hexRows,
    endingSeen: true,
  });

  for (const k of ['frag', 'lastEggFile', 'handleDecrypt']) {
    assert.equal(
      typeof puzzle[k],
      'function',
      `initSecrets() must return a '${k}' handler (literal key — renameProperties must stay off)`
    );
  }

  puzzle.handleDecrypt(frags.join(''));
  assert.ok(
    printed.some((l) => l.includes('key accepted')),
    'the obfuscated puzzle rejected the correct segment-1 key — the codec helpers are ' +
      'no longer reaching secrets.js through secretsBridge()'
  );

  printed.length = 0;
  puzzle.handleDecrypt('NOTTHEKEY0000000');
  assert.ok(
    printed.some((l) => l.includes('integrity check failed')),
    'the obfuscated puzzle accepted a wrong key'
  );

  // The fragments must survive the round trip too — they are what app.js prints
  // into the filesystem, and a mangled one would break the hunt invisibly.
  assert.deepEqual(
    [1, 2, 3, 4].map((n) => puzzle.frag(n)),
    frags,
    'frag() must return the fragments unchanged through the obfuscated unit'
  );
  assert.ok(
    (puzzle.lastEggFile().f || []).some((l) => l.includes('ENCRYPTED')),
    'lastEggFile() must still render the encrypted segments'
  );

  dom.window.close();
  console.log('✓ obfuscated puzzle round-trips: correct key accepted, wrong key rejected');
}

// ── 5. The service worker ships with the build ────────────────────────────────
function verifyServiceWorker() {
  assert.ok(
    fs.existsSync(path.join(DIST, 'sw.js')),
    'dist/sw.js missing — the repeat-visit cache silently disappears without it'
  );
  console.log('✓ sw.js copied into dist');
}

(async () => {
  await verifyBoot();
  verifyGamePerf();
  verifyLazyChunks();
  verifySecretsHidden();
  verifyServiceWorker();
  console.log('\nBuild verified.');
})().catch((e) => {
  console.error('\n✗ build verification FAILED:\n', e.message);
  process.exit(1);
});
