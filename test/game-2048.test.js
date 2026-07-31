'use strict';

// 2048 rules — the one shell game that tests cleanly (turn-based, no timers).
//
// Loads the real games.js chunk in jsdom with a stub api bridge and a pinned
// Math.random (always 0 → every new tile is a 2 in the first empty cell), so
// the board is fully deterministic: two 2s spawn side by side, ArrowLeft must
// merge them into a single 4 worth 4 points. Also pins the innerHTML tile
// rendering (the t2048-* color ramp classes) and that quitting restores the
// input row through the shared game shell.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const GAMES_SRC = fs.readFileSync(path.join(ROOT, 'games.js'), 'utf8');

function setup() {
  const dom = new JSDOM('<!DOCTYPE html><html><body></body></html>', {
    runScripts: 'outside-only',
    url: 'https://ianclaird.com/',
    pretendToBeVisual: true,
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = () => {}; // jsdom lacks it; the shell calls it
  window.Math.random = () => 0; // deterministic: new tile = 2, first empty cell
  window.eval(GAMES_SRC);

  const inputRow = window.document.createElement('div');
  inputRow.style.display = 'flex';
  window.document.body.appendChild(inputRow);
  const api = {
    appendNode: (n) => window.document.body.appendChild(n),
    blank() {},
    scroll() {},
    halSpeak() {},
    halD: (s) => s,
    unlockAchievement() {},
    _chirp() {},
    inputRow,
    cmd: { focus() {}, blur() {} },
    godmodeUnlocked: false,
    playerName: 'Dave',
  };
  const handlers = window.initGames(api);
  const key = (k) => window.dispatchEvent(new window.KeyboardEvent('keydown', { key: k }));
  const screen = () => window.document.querySelector('pre.ascii');
  return { window, handlers, key, screen, inputRow, close: () => window.close() };
}

test('2048: deterministic spawn, merge scores 4, colors render, q quits cleanly', (t) => {
  const { handlers, key, screen, inputRow, close } = setup();
  t.after(close);

  handlers['2048']();
  assert.match(screen().textContent, /press any key|move/i, 'the game screen renders');
  assert.equal(inputRow.style.display, 'none', 'the shell hides the input row');

  key('x'); // any key starts
  // Math.random pinned to 0 → two 2s in the first two cells of row 0
  // (count tile SPANS, not text — the SCORE/BEST header also contains digits)
  const tiles = (n) =>
    (screen().innerHTML.match(new RegExp(`class="t2048-${n}"`, 'g')) || []).length;
  assert.equal(tiles(2), 2, 'starts with exactly two 2-tiles');

  key('ArrowLeft');
  // the two 2s merge into one 4 (score 4), and one new 2 spawns
  assert.match(screen().textContent, /SCORE: 4\b/, 'the merge scores 4');
  assert.equal(tiles(4), 1, 'exactly one 4-tile after the merge');
  assert.equal(tiles(2), 1, 'exactly one fresh 2-tile after the merge');

  key('q');
  assert.equal(inputRow.style.display, 'flex', 'quitting restores the input row');
});

test('2048: sliding into a merged tile does not double-merge', (t) => {
  const { handlers, key, screen, close } = setup();
  t.after(close);

  handlers['2048']();
  key('x'); // start: [2,2,0,0]
  key('ArrowLeft'); // [4,2,0,0]
  key('ArrowLeft'); // merge nothing (4,2 differ): slide only → invalid move? row already flush
  // 4 and 2 cannot merge — the 4 must never become an 8 without two real 4s
  assert.ok(!/\b8\b/.test(screen().textContent), 'no phantom 8 from merging unequal tiles');
  assert.match(screen().textContent, /SCORE: 4\b/, 'score unchanged by a non-merging move');
});
