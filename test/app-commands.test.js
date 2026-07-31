'use strict';

// Terminal command suite — the dispatch layer end-to-end.
//
// lib/shell.js's pure parsers have unit tests, but the layer that WIRES them —
// submitCommand → executeNormal → the fs/pipe/redirect handlers — had none.
// This boots the real page (test/helpers/boot-page.js) and drives typed
// commands through window.submitCommand, asserting on the actual rendered
// output lines: the path every visitor's first keystroke takes.
//
// Output is asserted per-.line element (terminal lines are sibling spans, so
// #out.textContent has no newlines to anchor on). runLines() returns only the
// lines a command ADDED, so earlier output can't satisfy later assertions.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { bootPage } = require('./helpers/boot-page');

function makeRunner(window) {
  const out = window.document.getElementById('out');
  return function runLines(command) {
    const before = out.querySelectorAll('.line').length;
    window.submitCommand(command);
    return [...out.querySelectorAll('.line')].slice(before).map((el) => el.textContent);
  };
}
const hasLine = (lines, re) => lines.some((l) => re.test(l));

test('filesystem commands: cd / pwd / ls / cat', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  assert.ok(hasLine(run('pwd'), /^\/home\/ian$/), 'pwd prints the home path');

  const ls = run('ls');
  assert.ok(hasLine(ls, /README\.txt/i), 'ls lists README.txt');
  assert.ok(hasLine(ls, /projects/), 'ls lists the projects directory');

  run('cd projects');
  assert.ok(hasLine(run('pwd'), /^\/home\/ian\/projects$/), 'cd descends');
  run('cd ..');
  assert.ok(hasLine(run('pwd'), /^\/home\/ian$/), 'cd .. returns home');

  assert.ok(run('cat readme.txt').length > 2, 'cat readme.txt prints the file body');
  assert.ok(
    hasLine(run('cat nope.txt'), /No such file/i),
    'cat on a missing file errors like bash'
  );
});

test('$VAR expansion, redirection, session files, and rm', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  assert.ok(hasLine(run('echo $USER'), /^ian$/), 'echo expands $USER');
  assert.ok(hasLine(run('echo $HOME'), /^\/home\/ian$/), 'echo expands $HOME');

  run('echo hello world > note.txt');
  assert.ok(hasLine(run('ls'), /note\.txt/), 'redirection creates a session file');
  assert.ok(hasLine(run('cat note.txt'), /^hello world$/), 'the session file holds the text');

  run('rm note.txt');
  assert.ok(!hasLine(run('cat note.txt'), /^hello world$/), 'rm tombstones the session file');
});

test('pipelines: cat | grep | wc', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  run('echo alpha beta > pipe.txt');
  assert.ok(
    hasLine(run('cat pipe.txt | grep alpha'), /alpha beta/),
    'grep passes a matching line through the pipe'
  );
  assert.ok(
    hasLine(run('cat pipe.txt | grep -v alpha | wc -l'), /^\s*0$/),
    'inverted grep into wc counts zero lines'
  );
  assert.ok(
    hasLine(run('cat pipe.txt | frobnicate'), /command not found/),
    'an unknown pipe stage errors like bash'
  );
});

test('history, !! expansion, and && / || chaining honor exit codes', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  run('echo FIRSTMARK');
  assert.ok(hasLine(run('history'), /echo FIRSTMARK/), 'history lists past commands');
  // !! expands to the last command (history) and reruns it
  assert.ok(hasLine(run('!!'), /echo FIRSTMARK/), '!! reruns the last command');

  // && short-circuits on failure; || runs the fallback
  assert.ok(
    !hasLine(run('cat nope.txt && echo CHAINPASS'), /^CHAINPASS$/),
    'a failing command must not run the && branch'
  );
  assert.ok(
    hasLine(run('cat nope.txt || echo FALLBACKRAN'), /^FALLBACKRAN$/),
    'a failing command must run the || branch'
  );
  assert.ok(hasLine(run('echo A; echo B'), /^B$/), '; runs every segment regardless');
});

test('unknown commands error, and help unlocks the curious egg', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  assert.ok(
    hasLine(run('frobnicate'), /frobnicate.*command not found/),
    'unknown commands print the bash-style error'
  );

  run('help');
  const eggs = window.localStorage.getItem('ilaird_eggs') || '';
  assert.match(eggs, /curious/, 'running help should unlock the curious egg');
});

test('REGRESSION: a throw inside an awaitingInput callback cannot wedge the terminal', async (t) => {
  // The error boundary must reset the state machine, not just the prompt —
  // before the handleFatal fix, every subsequent Enter re-invoked the same
  // throwing callback forever.
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const run = makeRunner(window);

  window.eval('awaitingInput = () => { throw new Error("callback boom"); };');

  // go through the REAL keyboard path so the throw escapes an event listener
  // and reaches the window error boundary
  const cmd = window.document.getElementById('cmd');
  cmd.value = 'anything';
  cmd.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

  assert.equal(window.eval('awaitingInput'), null, 'the boundary must clear awaitingInput');
  assert.match(
    window.document.getElementById('out').textContent,
    /system fault/i,
    'the recovery line printed'
  );
  assert.ok(
    hasLine(run('pwd'), /^\/home\/ian$/),
    'the very next command must dispatch normally'
  );
});

test('a failed lazy-chunk load prints an error, resets the loader, and a retry works', async (t) => {
  const { dom, window } = await bootPage();
  t.after(() => dom.window.close());
  const doc = window.document;

  // jsdom never fetches injected <script src> tags; fire onerror ourselves so
  // the load-failure path runs deterministically.
  const origAppend = doc.head.appendChild.bind(doc.head);
  doc.head.appendChild = (el) => {
    const r = origAppend(el);
    if (el.tagName === 'SCRIPT' && el.src)
      setTimeout(() => el.onerror && el.onerror(new Error('offline')), 0);
    return r;
  };

  window.submitCommand('snake');
  assert.ok(
    doc.querySelector('.mod-load'),
    'the loading-module line shows while the chunk downloads'
  );
  await new Promise((r) => setTimeout(r, 20));
  assert.match(
    doc.getElementById('out').textContent,
    /could not load the game module/i,
    'the failure prints the retry hint'
  );
  assert.equal(doc.querySelector('.mod-load'), null, 'the loading line is removed on failure');
  assert.equal(
    window.eval('gamesLoading'),
    null,
    'the loader promise resets so a retry re-fetches'
  );

  // retry: this time the chunk "loads" (a stub initGames appears, as if the
  // script arrived) — the same typed command must now dispatch into it
  window.eval(
    'window.initGames = () => ({ racecar(){}, snake(){ window.__snakeRan = true; }, pong(){}, "2048"(){} });'
  );
  window.submitCommand('snake');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(window.__snakeRan, true, 'retyping the command retries and dispatches');
});
