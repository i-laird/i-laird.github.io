'use strict';

// RFC 9116 security.txt — shape and, more importantly, freshness.
//
// SECURITY.md is a good policy that only people already browsing the GitHub
// repo will ever find. security.txt is how it becomes discoverable at the
// domain where the actual attack surface lives, and it is the first thing a
// security researcher checks.
//
// The freshness half is the point. RFC 9116 makes Expires mandatory, and an
// expired security.txt is worse than not having one: it advertises a reporting
// channel that nobody has promised to read. Nothing about the site breaks when
// the date lapses, so without a gate it would rot silently. This fails while
// there is still a month to fix it — run `node scripts/gen-security-txt.js`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, '.well-known', 'security.txt'), 'utf8');

// "Contact: mailto:..." → { contact: 'mailto:...' }; comments and blanks out.
const fields = {};
for (const raw of SRC.split('\n')) {
  const l = raw.trim();
  if (!l || l.startsWith('#')) continue;
  const i = l.indexOf(':');
  assert.ok(i > 0, `malformed security.txt line: ${l}`);
  fields[l.slice(0, i).trim().toLowerCase()] = l.slice(i + 1).trim();
}

const GRACE_DAYS = 30;

test('carries the fields RFC 9116 requires', () => {
  assert.ok(fields.contact, 'Contact is mandatory');
  assert.ok(fields.expires, 'Expires is mandatory');
  assert.match(fields.contact, /^(mailto:|https:)/, 'Contact must be a URI');
});

test('the contact address matches the one SECURITY.md advertises', () => {
  // Two documents naming two different addresses is how a report gets lost.
  const policy = fs.readFileSync(path.join(ROOT, 'SECURITY.md'), 'utf8');
  const addr = fields.contact.replace(/^mailto:/, '');
  assert.ok(
    policy.includes(addr),
    `security.txt points at ${addr}, which SECURITY.md never mentions`
  );
});

test('Canonical points at where the file is actually served', () => {
  assert.equal(fields.canonical, 'https://ianclaird.com/.well-known/security.txt');
});

test('Expires is a valid ISO-8601 UTC instant', () => {
  const d = new Date(fields.expires);
  assert.ok(!Number.isNaN(d.getTime()), `unparseable Expires: ${fields.expires}`);
  assert.equal(
    d.toISOString(),
    fields.expires,
    'Expires must be a canonical ISO-8601 UTC string'
  );
});

test('Expires is not within its final 30 days', () => {
  const expires = new Date(fields.expires).getTime();
  const daysLeft = Math.floor((expires - Date.now()) / 86400000);
  assert.ok(
    daysLeft > GRACE_DAYS,
    `security.txt expires in ${daysLeft} day(s). An expired one is worse than none — ` +
      'regenerate it with `node scripts/gen-security-txt.js` and commit.'
  );
});

test('Expires is under the RFC one-year ceiling', () => {
  const expires = new Date(fields.expires).getTime();
  const daysOut = Math.floor((expires - Date.now()) / 86400000);
  assert.ok(daysOut < 366, `Expires is ${daysOut} days out; RFC 9116 says under a year`);
});

test('the build copies it into dist/', () => {
  // It lives in a dot-directory, so it is exactly the kind of file a static
  // passthrough drops silently. STATIC carries it and build.js mkdirs the
  // parent; if either regresses the live URL 404s with nothing else failing.
  const build = fs.readFileSync(path.join(ROOT, 'scripts', 'build.js'), 'utf8');
  assert.ok(
    build.includes("'.well-known/security.txt'"),
    'build.js STATIC must carry .well-known/security.txt'
  );
  assert.match(
    build,
    /mkdirSync\(path\.dirname\(dest\)/,
    'the static passthrough must create nested parents or the copy throws'
  );
});
