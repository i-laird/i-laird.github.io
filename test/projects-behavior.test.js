'use strict';

// The projects showcase — the recruiter path, and the one overlay a hiring
// manager is most likely to be the only person who ever opens.
//
// It had no behavioural coverage at all: while it lived inline in app.js the
// only thing exercising it was commands-smoke.test.js dispatching `projects`
// and checking nothing threw. Moving it into a lazy chunk removed even that
// (the loader injects a <script> jsdom never fetches), so this file drives the
// real chunk directly through a stub bridge — the same pattern as
// game-2048.test.js and halllm-behavior.test.js.
//
// What is worth pinning here is the overlay CONTRACT rather than the prose:
// it is appended to document.body (never .window — the godmode rainbow's
// filter would trap position:fixed inside it), it carries real dialog
// semantics, every close path clears the handle app.js polls, and the arch
// diagram stays interactive.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { runScripts } = require('./helpers/boot-page');

function setup() {
  const dom = new JSDOM(
    '<!DOCTYPE html><html><body><div class="window"></div></body></html>',
    {
      runScripts: 'outside-only',
      url: 'https://ianclaird.com/',
      pretendToBeVisual: true,
    }
  );
  runScripts(dom, ['projects.js']);
  const { window } = dom;

  const announced = [];
  const unlocked = [];
  // projOverlayEl lives in app.js (tryStartFinale / ssBusy poll it), so the
  // stub owns it exactly the way app.js does — via an accessor.
  let projOverlayEl = null;
  const api = {
    ACHIEVEMENTS: [{ id: 'a' }, { id: 'b' }],
    announce: (s) => announced.push(s),
    cmd: window.document.createElement('input'),
    unlockAchievement: (id) => unlocked.push(id),
    get projOverlayEl() {
      return projOverlayEl;
    },
    set projOverlayEl(v) {
      projOverlayEl = v;
    },
  };

  assert.equal(typeof window.initProjects, 'function', 'projects.js must define initProjects');
  const handlers = window.initProjects(api);
  return { dom, window, api, handlers, announced, unlocked, ov: () => projOverlayEl };
}

test('the overlay opens with real dialog semantics, outside .window', async (t) => {
  const { dom, window, ov, handlers } = setup();
  t.after(() => dom.window.close());

  handlers.open('index');

  const overlay = ov();
  assert.ok(overlay, 'open() must publish the overlay element back through the bridge');
  assert.equal(
    overlay.parentNode,
    window.document.body,
    'the overlay must be appended to document.body — inside .window the godmode ' +
      "rainbow's filter becomes the containing block and traps position:fixed"
  );

  const box = overlay.querySelector('.proj-box');
  assert.equal(box.getAttribute('role'), 'dialog');
  assert.equal(box.getAttribute('aria-modal'), 'true');
  assert.ok(box.getAttribute('aria-label'), 'the dialog needs an accessible name');
  assert.equal(box.tabIndex, -1, 'the box must be focusable so open() can move focus into it');
});

// Closes its own DOMs per iteration, so it takes no `t`.
test('every close path clears the handle app.js polls', () => {
  for (const how of ['escape', 'backdrop']) {
    const { dom, window, ov, handlers } = setup();

    handlers.open('index');
    assert.ok(ov(), `[${how}] overlay should be open`);

    if (how === 'escape') {
      window.document.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    } else {
      const overlay = ov();
      overlay.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    }

    // A stale projOverlayEl is not a cosmetic leak: tryStartFinale() and
    // ssBusy() both read it, so a non-null handle after close would suppress
    // the finale and the screensaver for the rest of the session.
    assert.equal(ov(), null, `[${how}] must clear api.projOverlayEl`);
    assert.equal(
      window.document.querySelectorAll('.proj-ov').length,
      0,
      `[${how}] must remove the overlay from the DOM`
    );
    dom.window.close();
  }
});

test('both case studies render and their architecture diagrams are interactive', async (t) => {
  const { dom, window, ov, handlers, announced } = setup();
  t.after(() => dom.window.close());

  for (const view of ['calc', 'site']) {
    handlers.open(view);
    const box = ov().querySelector('.proj-box');

    const diagram = box.querySelector('.arch');
    assert.ok(diagram, `the ${view} case study should embed an architecture diagram`);

    const nodes = [...diagram.querySelectorAll('[aria-pressed]')];
    assert.ok(nodes.length > 2, `${view}: expected several clickable components`);

    // The first node starts selected so the info panel is never empty.
    assert.equal(
      nodes[0].getAttribute('aria-pressed'),
      'true',
      `${view}: first node preselected`
    );
    const info = diagram.querySelector('.arch-info');
    assert.ok(
      info.textContent.trim().length > 0,
      `${view}: info panel should not start empty`
    );

    // Clicking another component moves the selection and announces it, so a
    // screen-reader user hears the panel change they cannot see.
    const before = announced.length;
    nodes[2].dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    assert.equal(
      nodes[2].getAttribute('aria-pressed'),
      'true',
      `${view}: clicked node selected`
    );
    assert.equal(
      nodes[0].getAttribute('aria-pressed'),
      'false',
      `${view}: previous deselected`
    );
    assert.ok(announced.length > before, `${view}: selecting a component should announce it`);
  }
});

test('the index view lists projects and reopening re-renders in place', async (t) => {
  const { dom, ov, handlers } = setup();
  t.after(() => dom.window.close());

  handlers.open('index');
  const first = ov();
  assert.ok(first.textContent.length > 200, 'the index should render project content');

  // Navigating between views must reuse the same overlay rather than stacking
  // a second one over the first.
  handlers.open('calc');
  assert.equal(ov(), first, 'reopening should re-render the existing overlay');
  assert.equal(
    dom.window.document.querySelectorAll('.proj-ov').length,
    1,
    'exactly one overlay should ever exist'
  );
});
