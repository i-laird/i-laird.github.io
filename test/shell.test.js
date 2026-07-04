'use strict';

// Unit tests for lib/shell.js — the pure parsers behind the terminal's shell
// emulation (tokenizing, globs, pipes, history expansion, variable expansion,
// path resolution, the session-overlay merge). These used to live inside
// app.js where they were untestable without a DOM; the trickiest string-
// munging in the shell now has direct coverage.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  tokenizeArgs,
  hasGlob,
  globToRe,
  numFlag,
  pipeFilter,
  expandHistoryBang,
  formatHistoryLines,
  expandShellVars,
  dateStr,
  unameStr,
  mergeNode,
  resolveFsPath,
  displayFsPath,
} = require('../lib/shell.js');

const HOME = ['home', 'ian'];

test('tokenizeArgs splits words and honours quotes', () => {
  assert.deepEqual(tokenizeArgs('a b  c'), ['a', 'b', 'c']);
  assert.deepEqual(tokenizeArgs('"two words" three'), ['two words', 'three']);
  assert.deepEqual(tokenizeArgs("'single quoted' x"), ['single quoted', 'x']);
  assert.deepEqual(tokenizeArgs('""'), ['']);
  assert.deepEqual(tokenizeArgs(''), []);
  assert.deepEqual(tokenizeArgs(undefined), []);
});

test('hasGlob detects * and ? only', () => {
  assert.equal(hasGlob('*.txt'), true);
  assert.equal(hasGlob('file?.log'), true);
  assert.equal(hasGlob('plain.txt'), false);
});

test('globToRe compiles glob segments with regex metacharacters escaped', () => {
  assert.ok(globToRe('*.txt').test('notes.txt'));
  assert.ok(!globToRe('*.txt').test('notes.txt.bak'));
  assert.ok(globToRe('file?').test('file1'));
  assert.ok(!globToRe('file?').test('file12'));
  // '*' must not cross a path separator
  assert.ok(!globToRe('*').test('a/b'));
  // literal dots stay literal
  assert.ok(!globToRe('a.txt').test('axtxt'));
});

test('numFlag reads -n N and -N forms with a default', () => {
  assert.equal(numFlag(['-n', '5'], 10), 5);
  assert.equal(numFlag(['-3'], 10), 3);
  assert.equal(numFlag([], 10), 10);
  assert.equal(numFlag(['-n', 'junk'], 10), 10);
});

test('pipeFilter grep filters lines, with -i and -v', () => {
  const lines = ['Alpha', 'beta', 'gamma alpha'];
  assert.deepEqual(pipeFilter('grep alpha', lines).lines, ['gamma alpha']);
  assert.deepEqual(pipeFilter('grep -i alpha', lines).lines, ['Alpha', 'gamma alpha']);
  assert.deepEqual(pipeFilter('grep -iv alpha', lines).lines, ['beta']);
  assert.ok(pipeFilter('grep', lines).err, 'grep without a pattern is a usage error');
});

test('pipeFilter head/tail slice with counts', () => {
  const lines = ['1', '2', '3', '4', '5'];
  assert.deepEqual(pipeFilter('head -2', lines).lines, ['1', '2']);
  assert.deepEqual(pipeFilter('tail -n 2', lines).lines, ['4', '5']);
  assert.deepEqual(pipeFilter('head', lines).lines, lines); // default 10 > input
});

test('pipeFilter wc counts lines, words, chars', () => {
  const lines = ['one two', 'three'];
  assert.deepEqual(pipeFilter('wc -l', lines).lines, ['2']);
  assert.deepEqual(pipeFilter('wc -w', lines).lines, ['3']);
  // chars: "one two\nthree" = 13 + 2 line-count = 15 (chars + newlines convention)
  assert.deepEqual(pipeFilter('wc -c', lines).lines, ['15']);
  assert.match(pipeFilter('wc', lines).lines[0], /^\s+2\s+3\s+15$/);
});

test('pipeFilter rejects unknown filters', () => {
  assert.match(pipeFilter('sed s/a/b/', ['x']).err, /command not found/);
});

test('expandHistoryBang resolves !!, !n, !-k and !prefix', () => {
  // newest-first, as app.js keeps cmdHistory
  const hist = ['ls -a', 'cat readme.txt', 'help'];
  assert.equal(expandHistoryBang('!!', hist), 'ls -a');
  assert.equal(expandHistoryBang('!1', hist), 'help'); // oldest = 1
  assert.equal(expandHistoryBang('!3', hist), 'ls -a');
  assert.equal(expandHistoryBang('!-1', hist), 'ls -a'); // 1 back
  assert.equal(expandHistoryBang('!cat', hist), 'cat readme.txt');
  assert.equal(expandHistoryBang('!9', hist), null);
  assert.equal(expandHistoryBang('!zzz', hist), null);
  assert.equal(expandHistoryBang('!!', []), null);
});

test('formatHistoryLines numbers oldest-first to match !n', () => {
  const hist = ['newest', 'oldest'];
  assert.deepEqual(formatHistoryLines(hist), ['    1  oldest', '    2  newest']);
});

test('expandShellVars substitutes variables and strips outer quotes', () => {
  assert.equal(expandShellVars('$USER', '/home/ian'), 'ian');
  assert.equal(expandShellVars('"$HOME sweet"', '/home/ian'), '/home/ian sweet');
  assert.equal(expandShellVars('$PWD', '/var/log'), '/var/log');
  assert.equal(expandShellVars('$?', '/'), '0');
  assert.equal(expandShellVars('plain text', '/'), 'plain text');
  // mismatched quotes are left alone
  assert.equal(expandShellVars('"half', '/'), '"half');
});

test('dateStr looks like a date(1) line', () => {
  assert.match(
    dateStr(),
    /^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{2} \d{2}:\d{2}:\d{2} \S+ \d{4}$/
  );
});

test('unameStr answers the flag variants', () => {
  assert.equal(unameStr(''), 'Linux');
  assert.equal(unameStr('-r'), '9.0.0-hal');
  assert.equal(unameStr('-m'), 'x86_64');
  assert.match(unameStr('-a'), /^Linux portfolio 9\.0\.0-hal/);
});

test('resolveFsPath handles relative, absolute, ~ and .. forms', () => {
  const cwd = ['home', 'ian', 'projects'];
  assert.deepEqual(resolveFsPath('', cwd, HOME), HOME);
  assert.deepEqual(resolveFsPath('~', cwd, HOME), HOME);
  assert.deepEqual(resolveFsPath('/', cwd, HOME), []);
  assert.deepEqual(resolveFsPath('sub/dir', cwd, HOME), [
    'home',
    'ian',
    'projects',
    'sub',
    'dir',
  ]);
  assert.deepEqual(resolveFsPath('/etc/motd', cwd, HOME), ['etc', 'motd']);
  assert.deepEqual(resolveFsPath('~/notes.txt', cwd, HOME), ['home', 'ian', 'notes.txt']);
  assert.deepEqual(resolveFsPath('..', cwd, HOME), ['home', 'ian']);
  assert.deepEqual(resolveFsPath('../../..', cwd, HOME), []);
  assert.deepEqual(resolveFsPath('../../../..', cwd, HOME), []); // .. above root stays at root
  assert.deepEqual(resolveFsPath('./a/./b', cwd, HOME), ['home', 'ian', 'projects', 'a', 'b']);
});

test('resolveFsPath does not mutate the passed cwd/home arrays', () => {
  const cwd = ['home', 'ian'];
  const home = ['home', 'ian'];
  resolveFsPath('..', cwd, home);
  resolveFsPath('~/x/..', cwd, home);
  assert.deepEqual(cwd, ['home', 'ian']);
  assert.deepEqual(home, ['home', 'ian']);
});

test('displayFsPath collapses the home prefix to ~', () => {
  assert.equal(displayFsPath(['home', 'ian'], HOME), '~');
  assert.equal(displayFsPath(['home', 'ian', 'projects'], HOME), '~/projects');
  assert.equal(displayFsPath(['etc'], HOME), '/etc');
  assert.equal(displayFsPath([], HOME), '/');
});

test('mergeNode unions directories and lets overlay files replace base files', () => {
  const base = {
    d: {
      'a.txt': { f: ['base a'] },
      sub: { d: { 'b.txt': { f: ['base b'] } }, enter: ['welcome'], locked: false },
    },
  };
  const over = {
    d: {
      'a.txt': { f: ['overlay a'], session: true },
      'new.txt': { f: ['new'], session: true },
      sub: { d: { 'c.txt': { f: ['c'], session: true } } },
    },
  };
  const m = mergeNode(base, over);
  assert.deepEqual(m.d['a.txt'].f, ['overlay a']);
  assert.deepEqual(m.d['new.txt'].f, ['new']);
  // union inside sub: base child kept, overlay child added, dir metadata preserved
  assert.deepEqual(Object.keys(m.d.sub.d).sort(), ['b.txt', 'c.txt']);
  assert.deepEqual(m.d.sub.enter, ['welcome']);
});

test('mergeNode tombstones hide base entries', () => {
  const base = { d: { 'doomed.txt': { f: ['x'] }, 'kept.txt': { f: ['y'] } } };
  const over = { d: { 'doomed.txt': { deleted: true } } };
  const m = mergeNode(base, over);
  assert.equal(m.d['doomed.txt'], undefined);
  assert.ok(m.d['kept.txt']);
  // tombstone at the top level hides the whole node
  assert.equal(mergeNode({ f: ['x'] }, { deleted: true }), undefined);
  // no overlay → base unchanged
  assert.deepEqual(mergeNode(base, undefined), base);
});
