'use strict';
// Content-Security-Policy integrity guard (pure file parsing — no DOM).
//
// index.html ships a CSP with NO `script-src 'unsafe-inline'`, which means the
// two inline <script> blocks are only allowed because their SHA-256 hashes are
// listed in the policy. Edit either block without recomputing its hash and the
// CRT pre-paint silently stops running (or, for the JSON-LD block, the site
// quietly loses its structured data). Neither failure is visible in a normal
// test run, so it is pinned here instead.
//
// This also guards the two properties that let the policy stay strict at all:
// no inline on* handlers in the markup, and no 'unsafe-inline'/'unsafe-eval' in
// script-src. If you genuinely need an inline handler, move it into app.js's
// wireChrome() rather than loosening the policy.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

// HTML comments first: index.html's prose mentions "<script>" inside a comment,
// and a naive scan would hash from there to the end of the next real block.
const STRIPPED = HTML.replace(/<!--[\s\S]*?-->/g, '');

function inlineScripts() {
  const out = [];
  const re = /<script(?![^>]*\ssrc=)([^>]*)>([\s\S]*?)<\/script>/g;
  let m;
  while ((m = re.exec(STRIPPED))) out.push({ attrs: m[1].trim(), body: m[2] });
  return out;
}

function sha256(body) {
  return 'sha256-' + crypto.createHash('sha256').update(body, 'utf8').digest('base64');
}

function policy() {
  const m = STRIPPED.match(
    /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)">/i
  );
  assert.ok(m, 'index.html must ship a Content-Security-Policy meta tag');
  return m[1];
}

function directive(name) {
  const found = policy()
    .split(';')
    .map((s) => s.trim())
    .find((s) => s === name || s.startsWith(name + ' '));
  return found ? found.slice(name.length).trim() : null;
}

test('every inline <script> in index.html is allowed by a hash in the CSP', () => {
  const scripts = inlineScripts();
  assert.ok(scripts.length > 0, 'expected inline scripts to hash');
  const src = directive('script-src');
  assert.ok(src, 'the policy must define script-src');

  for (const s of scripts) {
    const hash = sha256(s.body);
    assert.ok(
      src.includes(`'${hash}'`),
      `inline <script ${s.attrs || ''}> is not allowed by the CSP.\n` +
        `  Its content changed — add/replace its hash in the script-src of index.html:\n` +
        `    '${hash}'`
    );
  }
});

test('the CSP lists no stale inline-script hashes', () => {
  const live = new Set(inlineScripts().map((s) => sha256(s.body)));
  const listed = (directive('script-src').match(/'sha256-[A-Za-z0-9+/=]+'/g) || []).map((h) =>
    h.slice(1, -1)
  );
  for (const h of listed) {
    assert.ok(
      live.has(h),
      `script-src lists '${h}', which no longer matches any inline script — remove it`
    );
  }
  assert.equal(listed.length, live.size, 'one hash per inline script');
});

test('script-src stays strict', () => {
  const src = directive('script-src');
  assert.ok(!src.includes("'unsafe-inline'"), "script-src must not allow 'unsafe-inline'");
  assert.ok(!src.includes("'unsafe-eval'"), "script-src must not allow 'unsafe-eval'");
  assert.ok(!/\*(\s|$)/.test(src), 'script-src must not use a wildcard host');
});

test('index.html carries no inline event handlers', () => {
  // An inline on* attribute is inline script: re-adding one would force
  // 'unsafe-inline' back into script-src and undo the policy. wireChrome() in
  // app.js is where these belong.
  const handlers = STRIPPED.match(/\son[a-z]+\s*=\s*"/gi) || [];
  assert.deepEqual(
    handlers.map((h) => h.trim()),
    [],
    'found inline on* handler(s) in index.html — move them to wireChrome() in app.js'
  );
});

test('the lock-down directives are present', () => {
  for (const d of [
    'default-src',
    'base-uri',
    'object-src',
    'form-action',
    'worker-src',
    'connect-src',
  ]) {
    assert.ok(directive(d) !== null, `the policy must define ${d}`);
  }
  assert.equal(directive('object-src'), "'none'");
  assert.equal(directive('base-uri'), "'none'");
});

/* The secondary pages carry their OWN policy. A <meta> CSP covers only its own
   document, so index.html's does nothing for them — and privacy.html/terms.html
   are the pages a carrier reviewer loads, which makes "the two trust-sensitive
   pages are the two unprotected ones" the wrong shape to ship.
   They can afford a stricter policy than index.html: no page here has any
   JavaScript, so script-src is 'none' rather than a hash allowlist. That turns
   "someone adds a script tag here later" into a visible break instead of a
   quiet widening of the surface. */
for (const page of ['privacy.html', 'terms.html', '404.html']) {
  test(`${page} carries its own strict, script-free CSP`, () => {
    const src = fs.readFileSync(path.join(ROOT, page), 'utf8');
    const meta = src.match(
      /<meta\s+http-equiv="Content-Security-Policy"\s+content="([\s\S]*?)"\s*>/i
    );
    assert.ok(meta, `${page} must ship a <meta> CSP`);

    const policy = meta[1];
    const read = (name) => {
      const m = policy.match(new RegExp(`(?:^|;)\\s*${name}\\s+([^;]+)`, 'i'));
      return m ? m[1].trim().replace(/\s+/g, ' ') : null;
    };

    assert.equal(read('script-src'), "'none'", `${page} must forbid all script`);
    assert.equal(read('default-src'), "'none'");
    assert.equal(read('base-uri'), "'none'");
    assert.equal(read('form-action'), "'none'");

    // The claim above — that these pages have no JS — is the reason script-src
    // can be 'none'. Assert it directly so the two cannot drift apart.
    assert.ok(
      !/<script/i.test(src),
      `${page} declares script-src 'none' but contains a <script> tag`
    );
    assert.ok(
      !/\son[a-z]+\s*=/i.test(src.replace(/<!--[\s\S]*?-->/g, '')),
      `${page} must carry no inline event handlers`
    );
  });
}

test('chess.js pins both CDN payloads with a SHA-384 hash', () => {
  // The only third-party code the site executes. chess.js goes in via <script
  // integrity>; stockfish.js is fetched and blob-Worker'd, so chess.js verifies
  // its bytes by hand. Losing either pin is a silent supply-chain regression.
  const src = fs.readFileSync(path.join(ROOT, 'chess.js'), 'utf8');
  const hashes = src.match(/'sha384-[A-Za-z0-9+/=]{60,}'/g) || [];
  assert.equal(hashes.length, 2, 'expected a SHA-384 pin for both chess.js and stockfish.js');
  assert.ok(/\.integrity\s*=/.test(src), 'the injected <script> must set .integrity');
  assert.ok(
    /crossOrigin\s*=\s*'anonymous'/.test(src),
    'integrity is only checked with crossOrigin set'
  );
  assert.ok(
    /subtle\.digest\('SHA-384'/.test(src),
    'the fetched stockfish bytes must be digest-checked'
  );

  // Every CDN URL in the file must be one of the two pinned ones.
  const urls = src.match(/https:\/\/cdn[^']*\.js/g) || [];
  assert.equal(urls.length, 2, `unexpected CDN URL(s) in chess.js: ${urls.join(', ')}`);
});
