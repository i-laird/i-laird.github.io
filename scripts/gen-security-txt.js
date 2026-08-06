#!/usr/bin/env node
'use strict';

/* Regenerate .well-known/security.txt with a fresh Expires date (RFC 9116).
 *
 * The RFC requires Expires and says it SHOULD be less than a year out. That
 * makes the file a small recurring chore, and a chore that is easy to forget is
 * a chore that rots — so this script owns the date and test/security-txt.test.js
 * fails once the committed file is inside its final 30 days. The test tells you
 * to run this; this writes the file; the CI failure is the reminder.
 *
 *   node scripts/gen-security-txt.js        # ~11 months out from today
 *   node scripts/gen-security-txt.js --check # print what it would write
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const DEST = path.join(ROOT, '.well-known', 'security.txt');

// 11 months, not 12: it leaves a month of slack under the RFC's one-year
// ceiling so a renewal that slips by a few weeks is still compliant.
const MONTHS_AHEAD = 11;

function nextExpiry(now = new Date()) {
  const d = new Date(now);
  d.setUTCMonth(d.getUTCMonth() + MONTHS_AHEAD);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

function render(expires) {
  return `# Security contact for ianclaird.com / ilaird.com — RFC 9116.
#
# The full policy, including the scoped attack surface (the outbound SMS and
# telephone path is the part worth your time) and what is out of scope, is at
# the Policy URL below.
#
# Expires is not decoration: a stale security.txt is worse than none, because
# it points a reporter at a channel nobody promises to read. It is regenerated
# by scripts/gen-security-txt.js and test/security-txt.test.js fails the build
# once it is inside its final 30 days.

Contact: mailto:secure@ilaird.com
Expires: ${expires}
Preferred-Languages: en
Canonical: https://ianclaird.com/.well-known/security.txt
Policy: https://github.com/i-laird/i-laird.github.io/blob/main/SECURITY.md
`;
}

const body = render(nextExpiry());

if (process.argv.includes('--check')) {
  process.stdout.write(body);
} else {
  fs.mkdirSync(path.dirname(DEST), { recursive: true });
  fs.writeFileSync(DEST, body);
  console.log(`Wrote ${path.relative(ROOT, DEST)} (Expires: ${nextExpiry()})`);
}

module.exports = { nextExpiry, render };
