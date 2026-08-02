#!/usr/bin/env node
/* Do the CDN files still hash to what chess.js pins them at?
 *
 * chess.js loads the only third-party code this site executes, and pins both
 * payloads by SHA-384 (a `<script integrity>` attribute for chess.js, an
 * explicit SubtleCrypto digest for the Stockfish bytes before they reach a blob
 * Worker). That pinning turned one failure mode into another:
 *
 *   before — a CDN serving different bytes would silently EXECUTE them
 *   after  — a CDN serving different bytes silently BREAKS the chess command
 *
 * The second is far better, but it is still silent. A visitor gets "Failed to
 * load chess engine" and nothing tells the operator. A plain reachability probe
 * cannot catch it either: the file is still there, still 200, still the right
 * size — just not the same bytes. So this checks the property that now actually
 * matters, which is the same one the browser checks.
 *
 * It reads the pins OUT of chess.js rather than restating them, so the check
 * can never drift from what ships. Adding a third dependency, or bumping a
 * version without recomputing its hash, fails here.
 *
 * Usage: node scripts/verify-cdn-pins.js
 * Exits non-zero on any mismatch, missing pin, or unreachable dependency.
 */

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const CHESS_JS = path.join(__dirname, '..', 'chess.js');
const TIMEOUT_MS = 30_000;

/* Pair up `const <NAME>_SRC = '…'` with `const <NAME>_SRI = '…'` by their shared
   prefix, so the pairing survives reordering and picks up new dependencies
   automatically. A prefix with only one half of the pair is an error, not a
   thing to skip — that is exactly how an unpinned dependency would sneak in. */
function readPins(src) {
  const urls = new Map();
  const hashes = new Map();
  for (const m of src.matchAll(/const\s+(\w+)_SRC\s*=\s*'([^']+)'/g)) urls.set(m[1], m[2]);
  for (const m of src.matchAll(/const\s+(\w+)_SRI\s*=\s*'(sha384-[A-Za-z0-9+/=]+)'/g)) {
    hashes.set(m[1], m[2]);
  }

  const problems = [];
  for (const name of urls.keys()) {
    if (!hashes.has(name))
      problems.push(`${name}_SRC has no matching ${name}_SRI — that dependency is UNPINNED`);
  }
  for (const name of hashes.keys()) {
    if (!urls.has(name)) problems.push(`${name}_SRI has no matching ${name}_SRC`);
  }
  if (!urls.size)
    problems.push(
      'no <NAME>_SRC constants found in chess.js — has the loader been rewritten?'
    );
  if (problems.length) {
    for (const p of problems) console.error(`✗ ${p}`);
    process.exit(1);
  }

  return [...urls].map(([name, url]) => ({ name, url, expected: hashes.get(name) }));
}

async function actualHash(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return {
    hash: 'sha384-' + crypto.createHash('sha384').update(buf).digest('base64'),
    bytes: buf.length,
  };
}

(async () => {
  const pins = readPins(fs.readFileSync(CHESS_JS, 'utf8'));
  let failed = 0;

  for (const { name, url, expected } of pins) {
    try {
      const { hash, bytes } = await actualHash(url);
      if (hash === expected) {
        console.log(`✓ ${name}  ${bytes} bytes  ${url}`);
      } else {
        failed++;
        console.error(
          `✗ ${name}  INTEGRITY MISMATCH\n` +
            `    url      ${url}\n` +
            `    pinned   ${expected}\n` +
            `    actual   ${hash}\n` +
            `    The CDN is serving different bytes than chess.js pins. Until this is\n` +
            `    resolved the chess command fails for every visitor (the browser refuses\n` +
            `    the mismatched file — it does NOT execute it, so this is a broken\n` +
            `    feature, not a compromise of the site).\n` +
            `    If the change is legitimate, re-pin with:\n` +
            `      curl -sS ${url} | openssl dgst -sha384 -binary | openssl base64 -A\n` +
            `    If it is not, leave the pin alone — it is doing its job.`
        );
      }
    } catch (e) {
      failed++;
      console.error(`✗ ${name}  unreachable — ${e.message}\n    ${url}`);
    }
  }

  if (failed) process.exit(1);
  console.log(
    `\n${pins.length} pinned CDN dependenc${pins.length === 1 ? 'y' : 'ies'} verified.`
  );
})();
