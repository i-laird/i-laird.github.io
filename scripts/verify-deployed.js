#!/usr/bin/env node
/* Post-deploy assertions against the LIVE site:
 *   1. it must be serving the obfuscated build, not the clean source, and
 *   2. /.well-known/security.txt must actually be reachable.
 *
 * Why this exists: .github/workflows/deploy.yml only takes effect once GitHub
 * Pages is set to "Source: GitHub Actions". Until that switch is flipped, Pages
 * happily keeps serving the CLEAN source straight from the branch while this
 * workflow runs green — so the easter-egg secrets (the hunt logic, the decrypt
 * puzzle, HAL, the finale) would be sitting in plain sight and nothing would
 * say so. Same failure mode if the setting is ever flipped back, or if a deploy
 * silently no-ops.
 *
 * So: fetch what a real visitor gets and prove it doesn't look like source.
 *
 * Usage: node scripts/verify-deployed.js [baseUrl]
 *        (default https://ianclaird.com — the custom domain in CNAME, i.e. what
 *        visitors actually load, not the *.github.io origin)
 */

const BASE = (process.argv[2] || 'https://ianclaird.com').replace(/\/+$/, '');

/* Identifiers that exist in the hand-written source and cannot survive the
   obfuscator: app.js is wrapped in one IIFE, so these top-level names are all
   function-scoped and get mangled. Verified against a real `npm run build`.
   Deliberately NOT things like `unlockAchievement`, which stays literal because
   it's a reserved window export. */
const SOURCE_MARKERS = ['EGG_CIPHER', 'EGG_KEY_HASH', 'submitCommand'];

const ATTEMPTS = 6;
const DELAY_MS = 20_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path) {
  const res = await fetch(BASE + path, { headers: { 'cache-control': 'no-cache' } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status}`);
  return await res.text();
}

async function checkOnce() {
  const js = await get('/app.js');
  const found = SOURCE_MARKERS.filter((m) => js.includes(m));
  if (found.length) {
    throw new Error(
      `the live site is serving CLEAN SOURCE — found ${found.join(', ')} in /app.js.\n` +
        `  Check: repo Settings → Pages → Build and deployment → Source = "GitHub Actions".\n` +
        `  While it reads "Deploy from a branch", Pages serves the unobfuscated source.`
    );
  }
  // Secondary signal: the build collapses the six lib+app <script> tags into one.
  const html = await get('/');
  const tags = (html.match(/<script[^>]+src="[^"]*\blib\//g) || []).length;
  if (tags)
    throw new Error(
      `/index.html still references ${tags} lib/ script tag(s) — that is the source layout, not dist/`
    );

  /* The RFC 9116 policy must actually be reachable. It lives in a DOT-directory,
     which is the one shape of path a static pipeline drops silently: .gitignore
     rules, artifact packers and Jekyll have all historically eaten dotfiles. If
     it 404s, every other check here still passes and the file is simply absent
     from the internet forever — nothing else in the repo would ever notice.
     test/security-txt.test.js proves the FILE is right; only this proves it is
     SERVED. */
  let sec;
  try {
    sec = await get('/.well-known/security.txt');
  } catch (e) {
    throw new Error(
      `${e.message} — the RFC 9116 policy is not being served. Check that ` +
        `build.js's STATIC list still carries it and that .nojekyll is in dist/ ` +
        `(without it, dot-directories are stripped).`
    );
  }
  if (!/^\s*Contact:/m.test(sec))
    throw new Error(
      '/.well-known/security.txt is reachable but has no Contact: field — ' +
        'it is being served as something else (a 404 page, most likely)'
    );

  return js.length;
}

(async () => {
  let lastErr;
  for (let i = 1; i <= ATTEMPTS; i++) {
    try {
      const size = await checkOnce();
      console.log(`✓ ${BASE} is serving the obfuscated build (app.js ${size} bytes)`);
      process.exit(0);
    } catch (e) {
      lastErr = e;
      // A wrong-content failure is final; only transport/propagation errors are
      // worth waiting out (a fresh Pages deploy can take a couple of minutes).
      if (/serving CLEAN SOURCE|source layout/.test(e.message)) break;
      console.log(`  attempt ${i}/${ATTEMPTS} — ${e.message}`);
      if (i < ATTEMPTS) await sleep(DELAY_MS);
    }
  }
  console.error(`✗ ${BASE}: ${lastErr.message}`);
  process.exit(1);
})();
