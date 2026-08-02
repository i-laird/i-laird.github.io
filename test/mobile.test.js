'use strict';

// Phone experience — the terminal is the interface on a phone too, and typing
// is optional rather than required.
//
// These pin the parts that are easy to regress silently:
//   · a phone lands on the TERMINAL, not the XP desktop (it used to auto-launch
//     for any /Mobi|Android/ UA, which put every phone visitor on an unbranded
//     wallpaper with nothing identifying whose site it was),
//   · the tap-first chip bar appears at phone widths and not at desktop widths,
//     carries the right set per mode, and gets out of the way during a typed
//     multi-step prompt,
//   · the input stays at 16px, because anything smaller makes Safari force-zoom
//     the page on focus and never zoom back.
//
// jsdom reports innerWidth 1024, so the narrow cases redefine it and dispatch a
// resize — which also exercises the resize path that starts/stops the poll.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { bootPage, ROOT } = require('./helpers/boot-page');

function setWidth(window, px) {
  Object.defineProperty(window, 'innerWidth', { value: px, configurable: true });
  window.dispatchEvent(new window.Event('resize'));
}
const chipsOf = (window) =>
  [...window.document.querySelectorAll('#cmd-chips .cmd-chip')].map((c) => c.textContent);
const bar = (window) => window.document.getElementById('cmd-chips');

test('a phone lands on the terminal, not the XP desktop', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  // The prompt is live and the home screen is the home screen.
  assert.notEqual(window.document.getElementById('input-row').style.display, 'none');
  assert.ok(window.document.getElementById('home-cards'), 'the connect cards are present');
  assert.ok(
    !/Recycle Bin/.test(window.document.body.textContent),
    'the XP desktop must not auto-launch'
  );

  // Guard the removal at the source too: the old behaviour was a UA sniff that
  // called COMMANDS.gui() during boot, and re-adding one would be invisible to
  // the assertions above (jsdom's UA is not a phone's).
  const src = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');
  assert.ok(
    !/Mobi\|Android[\s\S]{0,200}?COMMANDS\.gui/.test(src),
    'app.js must not auto-launch the desktop from a user-agent check'
  );
});

test('the chip bar is phone-only', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());

  setWidth(window, 1280);
  assert.equal(bar(window).hidden, true, 'no chip bar at desktop widths');

  setWidth(window, 390);
  assert.equal(bar(window).hidden, false, 'chip bar appears at phone widths');
  assert.ok(chipsOf(window).length > 3, 'and it has chips in it');
});

test('chips carry the normal command set and run on tap', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  setWidth(window, 390);

  const chips = chipsOf(window);
  for (const expected of ['help', 'about', 'projects', 'resume']) {
    assert.ok(chips.includes(expected), `expected a "${expected}" chip`);
  }

  // Every chip must be a real button — a div would not be keyboard reachable.
  const nodes = [...window.document.querySelectorAll('#cmd-chips .cmd-chip')];
  assert.ok(
    nodes.every((n) => n.tagName === 'BUTTON' && n.type === 'button'),
    'chips must be <button type="button">'
  );

  const before = window.document.querySelectorAll('#out .line').length;
  nodes.find((n) => n.textContent === 'help').click();
  assert.ok(
    window.document.querySelectorAll('#out .line').length > before,
    'tapping a chip runs its command'
  );
});

test('the chip bar gets out of the way during a typed prompt', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  setWidth(window, 390);
  assert.equal(bar(window).hidden, false);

  // `hal` sets awaitingInput asynchronously, which is exactly the case a
  // render-after-dispatch would miss — the poll is what catches it.
  window.eval('awaitingInput = () => {};');
  window.eval('renderChips();');
  assert.equal(bar(window).hidden, true, 'hidden while a multi-step prompt is waiting');
  assert.equal(chipsOf(window).length, 0, 'and emptied, so a stray tap cannot derail it');

  window.eval('awaitingInput = null;');
  window.eval('renderChips();');
  assert.equal(bar(window).hidden, false, 'and it comes back afterwards');
});

test('the chip bar hides while a game owns the screen', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  setWidth(window, 390);

  window.document.getElementById('input-row').style.display = 'none';
  window.eval('renderChips();');
  assert.equal(bar(window).hidden, true, 'no chips floating over a game canvas');
});

test('the command input stays at 16px on phones', () => {
  // Under 16px, Safari force-zooms the page on focus and does not zoom back —
  // every tap on the prompt lurched the viewport. This is a functional
  // requirement, not a style preference.
  const css = fs.readFileSync(path.join(ROOT, 'style.css'), 'utf8');
  const m = css.match(/@media \(max-width: 640px\)[\s\S]*?#cmd \{[^}]*font-size:\s*(\d+)px/);
  assert.ok(m, 'the mobile block must set an explicit #cmd font-size');
  assert.ok(Number(m[1]) >= 16, `#cmd is ${m[1]}px on mobile — must be >= 16px`);
});

test('the chip bar lives outside the scrolling terminal', () => {
  // Inside .terminal it scrolls away with the output; it has to stay pinned
  // above the keyboard.
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const term = html.indexOf('<div class="terminal"');
  const chips = html.indexOf('id="cmd-chips"');
  const termEnd = html.indexOf('<div id="cmd-chips"');
  assert.ok(chips > -1, 'the chip bar exists');
  assert.ok(chips > term, 'it comes after the terminal opens');
  assert.ok(
    html.slice(term, termEnd).lastIndexOf('</div>') > -1,
    'the terminal element closes before the chip bar'
  );
});

test('keyboard-only games refuse instead of trapping', async (t) => {
  // The four shell games hide the input row and capture keys. On a phone that
  // is a hard trap: with no input row the software keyboard cannot even be
  // summoned, so there is no way to start, play, or quit — only a reload. They
  // must say so and stay at the prompt instead.
  //
  // jsdom leaves matchMedia undefined on purpose (see boot-page.js), so
  // hasKeyboard() takes its width fallback — which is what these widths drive.
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const out = window.document.getElementById('out');
  const runLines = (c) => {
    const before = out.querySelectorAll('.line').length;
    window.submitCommand(c);
    return [...out.querySelectorAll('.line')].slice(before).map((el) => el.textContent);
  };

  setWidth(window, 390);
  for (const game of ['racecar', 'snake', 'pong', '2048']) {
    const lines = runLines(game);
    assert.ok(
      lines.some((l) => new RegExp(`${game} needs a physical keyboard`, 'i').test(l)),
      `${game} must explain it needs a keyboard`
    );
    assert.notEqual(
      window.document.getElementById('input-row').style.display,
      'none',
      `${game} must not hide the input row on a phone — that is the trap`
    );
  }

  // The suggestion line is worth reading once, not four times.
  const hints = [...out.querySelectorAll('.line')].filter((el) =>
    /Everything else here works fine/i.test(el.textContent)
  );
  assert.equal(hints.length, 1, 'the "try these instead" nudge shows once, not per game');
});

test('commands that work without a keyboard are not gated', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  setWidth(window, 390);
  const out = window.document.getElementById('out');
  const text = (c) => {
    const before = out.querySelectorAll('.line').length;
    window.submitCommand(c);
    return [...out.querySelectorAll('.line')]
      .slice(before)
      .map((el) => el.textContent)
      .join(' ');
  };

  // chess reads typed moves through awaitingInput and keeps the input row, so
  // it is genuinely playable on a phone and must NOT be refused.
  assert.ok(!/needs a physical keyboard/i.test(text('chess')), 'chess works on a phone');
  window.eval('awaitingInput = null;');
  assert.ok(!/needs a physical keyboard/i.test(text('about')), 'about is not gated');
});
