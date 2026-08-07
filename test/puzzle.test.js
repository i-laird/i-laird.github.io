'use strict';

// The easter-egg endgame: the four scattered key fragments, and the two-stage
// `decrypt` puzzle they open.
//
// This is the payoff of the entire site and it had NO coverage in `npm test`.
// It is also the most silent thing in the codebase when it breaks: the puzzle
// only runs for someone who has already found all 46 eggs, so a regression
// surfaces as "the one person who got there types the right key and is told it
// is wrong" — no error, no console noise, nothing any other test would notice.
// The refactor that moved this into secrets.js (a separate obfuscation unit
// reached through secretsBridge()) made that failure mode easier to hit, not
// harder: a codec helper quietly dropping off the bridge looks like working
// code right up until the key is rejected.
//
// The tests below assemble the key the way a PLAYER does — reading the four
// fragments out of the terminal's own rendered output — rather than hardcoding
// it. That keeps the answer out of the repo AND means these tests exercise the
// whole chain end to end: secrets.js's FRAGMENTS → app.js's filesystem and
// neofetch rendering → the typed `decrypt` command → the codec helpers back
// across the bridge. Hardcoding the key would test none of the middle.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./helpers/boot-page');

const outText = (window) => window.document.getElementById('out').textContent;

// Run a command and return only what it printed.
function run(window, command) {
  const out = window.document.getElementById('out');
  const before = out.textContent.length;
  window.submitCommand(command);
  return out.textContent.slice(before);
}

// The four fragments live in four different places, and three of them only
// exist once a particular egg is found — that gating is part of the hunt, so
// collect them through the real commands rather than reaching into secrets.js.
function harvestFragments(window) {
  window.unlockAchievement('godmode'); // reveals hal9000.core  → [1/4]
  window.unlockAchievement('bad-time'); // reveals sans's letter → [3/4]

  const sources = {
    1: run(window, 'cat hal9000.core'),
    2: run(window, 'neofetch'), // always visible — the teaser
    3: run(window, 'cat a_letter_from_sans.txt'),
    4: run(window, 'cat .secrets'),
  };

  const frags = {};
  for (const [n, text] of Object.entries(sources)) {
    const m = text.match(new RegExp(`key\\.frag\\[${n}/4\\][^\\n]*?([A-Z0-9]{4})`));
    assert.ok(
      m,
      `fragment [${n}/4] should be readable in the terminal output, but was not found in:\n${text.slice(0, 400)}`
    );
    frags[n] = m[1];
  }
  return [frags[1], frags[2], frags[3], frags[4]].join('');
}

test('the four key fragments are discoverable in the terminal', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  const key = harvestFragments(window);

  // 16 characters, four fragments of four — the length the puzzle's own usage
  // text promises the player.
  assert.equal(key.length, 16, `assembled key should be 16 chars, got "${key}"`);
  assert.match(key, /^[A-Z0-9]+$/, 'fragments should be plain uppercase alphanumerics');
});

test('decrypt stays sealed until the finale has run', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  const key = harvestFragments(window);

  // The right key, at the wrong time. This is the endingSeen gate crossing the
  // bridge as a live getter — if it were captured by value at init it would
  // read false forever and the puzzle would never open.
  assert.match(
    run(window, `decrypt ${key}`),
    /nothing here is encrypted/i,
    'decrypt must refuse before the ending, even with the correct key'
  );
  assert.doesNotMatch(outText(window), /key accepted/i);
});

test('after the ending, the assembled key opens segment 1 but not segment 2', async (t) => {
  // Boot straight into the post-finale world. endingSeen is read from
  // localStorage once at load, so seeding it is what a returning visitor looks
  // like — and it skips ~20s of finale theatre these tests do not need.
  const { dom, window } = await bootPage({ storage: { ilaird_ending: '1' } });
  t.after(() => dom.window.close());

  const key = harvestFragments(window);

  // The dropped file exists and is genuinely encrypted-looking.
  const file = run(window, 'cat the_last_egg.txt');
  assert.match(file, /ENCRYPTED/, 'the_last_egg.txt should appear once the ending is seen');
  assert.match(file, /segment 1 of 2/, 'both segments should be present');
  assert.match(file, /segment 2 of 2/);
  assert.doesNotMatch(file, new RegExp(key), 'the ciphertext must not contain its own key');

  // Segment 1 opens.
  const seg1 = run(window, `decrypt ${key}`);
  assert.match(seg1, /key accepted/i, `the assembled key "${key}" should open segment 1`);
  assert.match(seg1, /segment 1 of 2/i);
  assert.match(seg1, /segment 2 remains/i, 'it should point the player at the second stage');

  // Segment 2 must NOT open with only the on-site fragments. The fifth arrives
  // by email auto-reply and is deliberately absent from this repo, so this
  // asserts the two-stage design still holds rather than having collapsed into
  // one stage that the first key opens completely.
  assert.doesNotMatch(
    seg1,
    /that is everything/i,
    'the 16-char key must not also open the final segment'
  );
});

test('decrypt rejects a wrong key, and normalizes a messy right one', async (t) => {
  const { dom, window } = await bootPage({ storage: { ilaird_ending: '1' } });
  t.after(() => dom.window.close());

  const key = harvestFragments(window);

  assert.match(
    run(window, 'decrypt NOTTHEKEYATALL0'),
    /integrity check failed/i,
    'a wrong key must be rejected'
  );

  // A player reading four fragments off four screens types them with spaces or
  // dashes between. The handler strips separators and uppercases before
  // hashing, which is the difference between the puzzle feeling solvable and
  // feeling broken.
  const messy = key.match(/.{4}/g).join('-').toLowerCase();
  assert.match(
    run(window, `decrypt ${messy}`),
    /key accepted/i,
    `a separated, lowercased key ("${messy}") should still be accepted`
  );

  // And with no argument at all, it explains itself rather than failing.
  const usage = run(window, 'decrypt');
  assert.match(usage, /usage/i);
  assert.match(usage, /16 characters/i);
});

test('the puzzle degrades safely when secrets.js is missing', async (t) => {
  const { dom, window } = await bootPage({
    skip: ['secrets.js'],
    storage: { ilaird_ending: '1' },
  });
  t.after(() => dom.window.close());

  // The stub must not fabricate plausible fragments — a player must never be
  // sent chasing a key that cannot work.
  window.unlockAchievement('godmode');
  assert.doesNotMatch(
    run(window, 'cat hal9000.core'),
    /key\.frag\[1\/4\] = "[A-Z0-9]{4}"/,
    'the stub must not emit a real-looking fragment'
  );

  assert.match(run(window, 'cat the_last_egg.txt'), /unreadable/i);
  assert.match(run(window, 'decrypt ANYTHINGATALL00'), /unavailable/i);
});
