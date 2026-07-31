'use strict';

// SMS opt-in form (the room's number popup) — carrier-compliance invariants.
//
// The `num` stage of room.js's phone popup is the site's A2P SMS opt-in form.
// Its rules are legally load-bearing (carrier compliance), so they get pinned
// here rather than living only as a "don't strip these" comment:
//   - the consent checkbox is NEVER pre-checked,
//   - submit refuses without consent (and without a plausible number),
//   - the required disclosures are present (one-time code, no marketing,
//     msg-&-data-rates, HELP/STOP, terms + privacy links),
//   - the submit button reads disabled until the box is ticked,
//   - typed/echoed input is HTML-escaped (the chat auto-path can hand the
//     popup a raw free-text line — regression test for the escPop fix).
//
// room.js exposes a small test seam (window.__roomPopTest) when the page sets
// window.ROOM_TEST_HOOKS before initRoom runs; that avoids driving the whole
// creep → ring → Turnstile → /room-call flow just to open the popup.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.join(__dirname, '..');
const ROOM_SRC = fs.readFileSync(path.join(ROOT, 'room.js'), 'utf8');

function setup() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"></div></body></html>',
    {
      runScripts: 'outside-only',
      url: 'https://ianclaird.com/',
    }
  );
  const { window } = dom;
  const fetches = [];
  // dialFlow → workerPost → fetch; answer every dial with not_allowlisted so
  // the flow advances to the 'offer' stage instead of the full dial sequence.
  window.fetch = (url, opts) => {
    fetches.push({ url, body: JSON.parse(opts.body) });
    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({ error: 'not_allowlisted' }),
    });
  };
  window.ROOM_TEST_HOOKS = true;
  window.eval(ROOM_SRC);
  const api = {
    halWorkerUrl: 'https://worker.test',
    turnstileKey: 'test-key',
    halPhone: '+1 (555) 000-0000',
    soundEnabled: false,
    reduceMotion: true,
    achOverlayOpen: false,
    roomActive: false,
    winEl: window.document.querySelector('.window'),
    cmd: { focus() {} },
    line() {},
    blank() {},
    scroll() {},
    unlockAchievement() {},
    _chirp() {},
    halSpeak() {},
    halD: (s) => s,
  };
  window.initRoom(api);
  const hook = window.__roomPopTest;
  assert.ok(hook, 'room.js must expose the test seam when ROOM_TEST_HOOKS is set');
  return { window, hook, fetches, close: () => window.close() };
}

test('consent checkbox is never pre-checked', (t) => {
  const { window, hook, close } = setup();
  t.after(close);

  const pop = hook.open('num');
  assert.equal(pop.agree, false, 'a fresh pop object must start agree:false');
  const box = hook.el.querySelector('[data-act="agree"]');
  assert.ok(box, 'the consent checkbox is rendered');
  assert.equal(box.getAttribute('aria-checked'), 'false');
  assert.ok(!box.classList.contains('on'));

  // even after a previous consent, a re-opened form starts unticked
  hook.key(' ');
  assert.equal(hook.pop.agree, true, 'space ticks the box');
  hook.open('num');
  assert.equal(hook.pop.agree, false, 're-opening resets consent to unticked');
  assert.ok(window); // keep jsdom alive until after()
});

test('submit refuses without a number and without consent; consent enables the dial', async (t) => {
  const { hook, fetches, close } = setup();
  t.after(close);

  hook.open('num');

  // no number at all → refused, no network
  hook.submit();
  assert.equal(fetches.length, 0, 'no dial without a number');
  assert.match(hook.el.textContent, /not a telephone number/i);

  // a number, but the box unticked → refused, no network
  for (const d of '5551234567') hook.key(d);
  hook.submit();
  assert.equal(fetches.length, 0, 'no dial without consent');
  assert.match(hook.el.textContent, /consent/i);

  // tick the box → the dial goes out, carrying the typed number
  hook.key(' ');
  assert.equal(hook.pop.agree, true);
  hook.submit();
  assert.equal(fetches.length, 1, 'consent + number → exactly one /room-dial');
  assert.match(fetches[0].url, /\/room-dial$/);
  assert.equal(fetches[0].body.phone, '5551234567');

  // not_allowlisted reply → the verify/self-call offer, with the number masked
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(hook.pop.stage, 'offer');
  assert.match(hook.el.textContent, /··· ··· 4567/, 'offer stage masks the number');
  assert.ok(!hook.el.textContent.includes('5551234567'), 'full number is never re-rendered');
});

test('required disclosures and legal links are present on the opt-in form', (t) => {
  const { hook, close } = setup();
  t.after(close);

  hook.open('num');
  const text = hook.el.textContent;
  assert.match(text, /verification code/i, 'says what the SMS is');
  assert.match(text, /never marketing/i, 'message-type disclosure');
  assert.match(text, /one SMS per verification request/i, 'frequency disclosure');
  assert.match(text, /message & data rates may apply/i, 'rates disclaimer');
  assert.match(text, /reply HELP for help, STOP to opt out/i, 'HELP/STOP instructions');
  assert.ok(hook.el.querySelector('a[href="terms.html"]'), 'links the SMS program terms');
  assert.ok(hook.el.querySelector('a[href="privacy.html"]'), 'links the privacy policy');

  // submit button reads disabled until the box is ticked
  const btn = hook.el.querySelector('[data-act="submit"]');
  assert.ok(btn.classList.contains('off'), 'submit is off while unticked');
  hook.key(' ');
  assert.ok(
    !hook.el.querySelector('[data-act="submit"]').classList.contains('off'),
    'submit enables once ticked'
  );
});

test('popup input is HTML-escaped (chat auto-path regression)', (t) => {
  const { window, hook, close } = setup();
  t.after(close);

  // the chat auto-path (submitCallLine → openPop) copies the RAW typed line
  // into p.input — simulate exactly that
  hook.open('num');
  hook.pop.input = '<img src=x onerror=window.__xss=1>5551234567';
  hook.render();
  assert.equal(hook.el.querySelector('img'), null, 'markup must not become elements');
  assert.equal(window.__xss, undefined, 'no handler ever ran');
  assert.ok(
    hook.el.textContent.includes('<img src=x onerror=window.__xss=1>5551234567'),
    'the raw text is shown literally'
  );
});

test('keyboard charset and escape-to-decline', (t) => {
  const { hook, close } = setup();
  t.after(close);

  hook.open('num');
  hook.key('a');
  hook.key('<');
  hook.key('5');
  hook.key('(');
  hook.key('!');
  assert.equal(hook.pop.input, '5(', 'only phone characters are accepted from the keyboard');
  hook.key('Escape');
  assert.equal(hook.pop, null, 'escape declines and closes the popup');
});
