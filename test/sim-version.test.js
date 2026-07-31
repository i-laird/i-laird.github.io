'use strict';

// Sim-version pin.
//
// Any gameplay-affecting change to Stick Fighter must bump the sim version in
// FOUR places: recHdr.v (05-init.js), startWatch's replay check
// (13-leaderboard.js), NET_SIM_V (02-state.js), and the hal-worker's
// REPLAY_VERSION (out of repo — deploy discipline covers that one). The three
// in-repo copies are independent hardcoded literals; this test is the only
// thing that stops them drifting apart, which the project docs call the
// invariant most likely to bite (a mismatch silently replays stored runs
// under different rules, or desyncs netplay against a stale-cached peer).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SF = path.join(__dirname, '..', 'stickfighter');
const read = (p) => fs.readFileSync(path.join(SF, p), 'utf8');

function extract(file, re, label) {
  const m = read(file).match(re);
  assert.ok(m, `${label} not found in ${file} — if it moved, update this test`);
  return parseInt(m[1], 10);
}

test('the three in-repo sim-version literals agree', () => {
  const netSimV = extract('02-state.js', /const NET_SIM_V = (\d+)/, 'NET_SIM_V');
  const recHdrV = extract('05-init.js', /recHdr = \{ v: (\d+)/, 'recHdr.v');
  const watchV = extract('13-leaderboard.js', /rd\.v !== (\d+)/, 'startWatch replay check');

  assert.equal(recHdrV, netSimV, 'recHdr.v (05-init.js) must match NET_SIM_V (02-state.js)');
  assert.equal(
    watchV,
    netSimV,
    'the startWatch check (13-leaderboard.js) must match NET_SIM_V'
  );
  // reminder for the fourth copy this test cannot see
  assert.ok(
    netSimV >= 5,
    'sim version went backwards? The hal-worker REPLAY_VERSION must be bumped in the same deploy.'
  );
});
