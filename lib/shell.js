/*
 * shell.js — pure parsers for the terminal's shell emulation.
 *
 * Dual-mode by design: loaded as a classic <script> in the browser (these
 * top-level declarations become globals that app.js reads directly, matching
 * the no-module / no-IIFE architecture documented in CLAUDE.md), and also
 * require()-able under Node for the test suite via the module.exports guard
 * at the bottom.
 *
 * Everything here is pure: no DOM, no app.js state. Functions that used to
 * read app.js globals (cwd, cmdHistory, the home path) now take them as
 * parameters and carry distinct names — app.js keeps thin same-named adapters
 * (fsResolve/fsDisplay) or passes the state at the call site, so the shell
 * logic is unit-testable without a browser.
 */

/**
 * Split a shell argument string into words, honouring "double" and 'single'
 * quoted segments (a quoted segment is one word, quotes stripped).
 * @param {string} str
 * @returns {string[]}
 */
function tokenizeArgs(str) {
  const out = [],
    re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m;
  while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/**
 * Does a word contain a glob metacharacter (* or ?)?
 * @param {string} w
 * @returns {boolean}
 */
function hasGlob(w) {
  return /[*?]/.test(w);
}

/**
 * Compile one glob path segment to an anchored RegExp: * matches any run of
 * non-slash characters, ? exactly one; everything else is literal.
 * @param {string} seg
 * @returns {RegExp}
 */
function globToRe(seg) {
  let re = '^';
  for (const ch of seg) {
    if (ch === '*') re += '[^/]*';
    else if (ch === '?') re += '[^/]';
    else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(re + '$');
}

/**
 * Extract a numeric count flag (-n 5 or -5) from an argument list.
 * @param {string[]} args
 * @param {number} def fallback when no flag is present
 * @returns {number}
 */
function numFlag(args, def) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '-n' && args[i + 1] != null) {
      const v = parseInt(args[i + 1], 10);
      return Number.isNaN(v) ? def : v;
    }
    const m = /^-(\d+)$/.exec(args[i]);
    if (m) return parseInt(m[1], 10);
  }
  return def;
}

/**
 * Apply one pipeline filter (grep / head / tail / wc) to a list of lines.
 * @param {string} seg the filter command text, e.g. "grep -i foo"
 * @param {string[]} lines input lines
 * @returns {{lines: string[]} | {err: string}}
 */
function pipeFilter(seg, lines) {
  const parts = seg.split(/\s+/).filter(Boolean);
  const c = parts[0];
  const args = parts.slice(1);
  switch (c) {
    case 'grep': {
      let ci = false,
        inv = false;
      const pats = [];
      args.forEach((a) => {
        if (/^-[ivIV]+$/.test(a)) {
          if (/[iI]/.test(a)) ci = true;
          if (/[vV]/.test(a)) inv = true;
        } else pats.push(a);
      });
      if (!pats.length) return { err: 'usage: grep [-i] [-v] pattern' };
      const pat = pats.join(' ');
      const hit = ci
        ? (l) => l.toLowerCase().includes(pat.toLowerCase())
        : (l) => l.includes(pat);
      return { lines: lines.filter((l) => (inv ? !hit(l) : hit(l))) };
    }
    case 'head': {
      const n = numFlag(args, 10);
      return { lines: n <= 0 ? [] : lines.slice(0, n) };
    }
    case 'tail': {
      const n = numFlag(args, 10);
      return { lines: n <= 0 ? [] : lines.slice(-n) };
    }
    case 'wc': {
      const text = lines.join('\n');
      const lc = lines.length;
      const wc = text.split(/\s+/).filter(Boolean).length;
      const cc = text.length + (lines.length ? lines.length : 0); // chars + newlines
      if (args.includes('-l')) return { lines: [String(lc)] };
      if (args.includes('-w')) return { lines: [String(wc)] };
      if (args.includes('-c')) return { lines: [String(cc)] };
      return {
        lines: [
          `${String(lc).padStart(7)} ${String(wc).padStart(7)} ${String(cc).padStart(7)}`,
        ],
      };
    }
    default:
      return { err: `bash: ${c}: command not found` };
  }
}

/**
 * Bash-style history expansion: !! / !n / !-k / !prefix → the matching past
 * command, or null when there is no match.
 * @param {string} t the bang token (starts with '!')
 * @param {string[]} history newest-first command history
 * @returns {string | null}
 */
function expandHistoryBang(t, history) {
  const n = history.length;
  if (!n) return null;
  if (t === '!!') return history[0];
  const rest = t.slice(1);
  if (/^\d+$/.test(rest)) {
    const k = +rest;
    return k >= 1 && k <= n ? history[n - k] : null;
  }
  if (/^-\d+$/.test(rest)) {
    const k = +rest.slice(1);
    return k >= 1 && k <= n ? history[k - 1] : null;
  }
  return history.find((c) => c.startsWith(rest)) || null;
}

/**
 * History listing, oldest-first with 1-based numbers (matches !n indexing).
 * @param {string[]} history newest-first command history
 * @returns {string[]}
 */
function formatHistoryLines(history) {
  return history
    .slice()
    .reverse()
    .map((c, i) => `  ${String(i + 1).padStart(3)}  ${c}`);
}

/**
 * Expand shell variables ($USER, $HOME, $HOSTNAME, $PWD, $SHELL, $?) in a
 * string, stripping one level of matching outer quotes first.
 * @param {string} s
 * @param {string} pwd the current working directory as an absolute path
 * @returns {string}
 */
function expandShellVars(s, pwd) {
  let out = (s || '').trim();
  if (out.length >= 2 && /^["']/.test(out) && out[0] === out[out.length - 1])
    out = out.slice(1, -1);
  return out
    .replace(/\$USER\b/g, 'ian')
    .replace(/\$HOME\b/g, '/home/ian')
    .replace(/\$HOSTNAME\b/g, 'portfolio')
    .replace(/\$PWD\b/g, pwd)
    .replace(/\$SHELL\b/g, '/bin/bash')
    .replace(/\$\?/g, '0');
}

/**
 * `date`-style timestamp for the fake shell.
 * @returns {string} e.g. "Tue Jul 01 14:05:09 PDT 2026"
 */
function dateStr() {
  const d = new Date();
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const mons = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  const p = (n) => String(n).padStart(2, '0');
  const tz = (d.toString().match(/\(([^)]+)\)/) || [])[1] || '';
  const abbr =
    tz
      .split(' ')
      .map((w) => w[0])
      .join('') || 'UTC';
  return `${days[d.getDay()]} ${mons[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${abbr} ${d.getFullYear()}`;
}

/**
 * `uname` output for the fake shell.
 * @param {string} arg flags string (-a / -r / -m)
 * @returns {string}
 */
function unameStr(arg) {
  const a = (arg || '').trim();
  if (a.includes('a')) return 'Linux portfolio 9.0.0-hal #1 SMP x86_64 GNU/Linux';
  if (a.includes('r')) return '9.0.0-hal';
  if (a.includes('m')) return 'x86_64';
  return 'Linux';
}

/**
 * Merge a session-overlay filesystem node onto a read-only base node.
 * Tombstones ({deleted:true}) hide the base entry; overlay directories union
 * children (preserving the base's enter/locked); overlay files replace.
 * Node shapes are documented at buildFS() in app.js.
 * @param {object|undefined} base
 * @param {object|undefined} over
 * @returns {object|undefined} the merged node, or undefined when tombstoned
 */
function mergeNode(base, over) {
  if (!over) return base;
  if (over.deleted) return undefined; // tombstone hides the base node
  if (over.d) {
    // overlay directory → union children
    const merged = { d: {} };
    const baseKids = base && base.d ? base.d : {};
    for (const k in baseKids) merged.d[k] = baseKids[k];
    for (const k in over.d) {
      const r = mergeNode(merged.d[k], over.d[k]);
      if (r === undefined) delete merged.d[k];
      else merged.d[k] = r;
    }
    if (base && base.d) {
      if (base.enter) merged.enter = base.enter;
      if (base.locked) merged.locked = base.locked;
    }
    return merged;
  }
  return over; // overlay file replaces base
}

/**
 * Resolve a path string (relative, absolute, or ~-rooted) to path segments,
 * folding out '.' and '..'.
 * @param {string} input the raw path text
 * @param {string[]} cwd current directory segments (used for relative paths)
 * @param {string[]} home the home directory segments (~)
 * @returns {string[]}
 */
function resolveFsPath(input, cwd, home) {
  const raw = (input || '').trim();
  if (raw === '' || raw === '~') return home.slice();
  if (raw === '/') return [];
  let segs, parts;
  if (raw.startsWith('/')) {
    segs = [];
    parts = raw.slice(1).split('/');
  } else if (raw.startsWith('~/')) {
    segs = home.slice();
    parts = raw.slice(2).split('/');
  } else {
    segs = cwd.slice();
    parts = raw.split('/');
  }
  for (const p of parts) {
    if (p === '' || p === '.') continue;
    if (p === '..') {
      if (segs.length) segs.pop();
      continue;
    }
    segs.push(p);
  }
  return segs;
}

/**
 * Render path segments for display, collapsing the home prefix to ~.
 * @param {string[]} segs
 * @param {string[]} home the home directory segments
 * @returns {string} e.g. "~/projects" or "/etc"
 */
function displayFsPath(segs, home) {
  if (segs.length >= home.length && home.every((p, i) => segs[i] === p))
    return '~' + (segs.length > home.length ? '/' + segs.slice(home.length).join('/') : '');
  return '/' + segs.join('/');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
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
  };
}
