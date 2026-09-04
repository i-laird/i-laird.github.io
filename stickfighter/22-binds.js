// ── key bindings — the shell's CONTROLS page, and the physical→canonical key translation ──
/* Rebinding never touches the sim. Every handler and sampler in the game keys off
   the CLASSIC names (keys['ArrowLeft'], e.key === 'x', e.code === 'ShiftRight' …),
   so a custom binding is applied by TRANSLATING the physical key event into the
   canonical event at the top of onKey/offKey (remapKey below). The recorder, the
   lockstep frames, the replay feeder and every menu see only the classic keys —
   a rebound run records and replays bit-exact, and a rebound peer lockstops with
   a default-keys peer. Only NON-default bindings are stored (sfOpts.binds, so the
   `forget` command's ilaird* sweep covers them); a physical key whose classic
   role has been rebound away goes dead (it must not ALSO keep its old meaning, or
   "move up on I" would still move up on ↑ and the rebinding would be a lie).
   Typing contexts (the leaderboard name, the room code, a capture in progress)
   read the raw key, never the translation. The default table IS the classic
   layout, so a player who never opens the page gets byte-identical input. */
const BIND_ACTIONS = [
  // seat 1 — the classic solo/P1 keys (solo also accepts WASD/Space/X/F by passthrough)
  { id: 'p1_up',    seat: 1, label: 'up',         key: 'ArrowUp',    code: 'ArrowUp',    def: 'ArrowUp' },
  { id: 'p1_down',  seat: 1, label: 'down',       key: 'ArrowDown',  code: 'ArrowDown',  def: 'ArrowDown' },
  { id: 'p1_left',  seat: 1, label: 'left',       key: 'ArrowLeft',  code: 'ArrowLeft',  def: 'ArrowLeft' },
  { id: 'p1_right', seat: 1, label: 'right',      key: 'ArrowRight', code: 'ArrowRight', def: 'ArrowRight' },
  { id: 'p1_dash',  seat: 1, label: 'dash',       key: 'Shift',      code: 'ShiftRight', def: 'ShiftRight' },
  { id: 'p1_atk',   seat: 1, label: 'attack',     key: 'x',          code: 'Slash',      def: 'Slash' },
  { id: 'p1_cycle', seat: 1, label: 'spell page', key: 'c',          code: 'Period',     def: 'Period' },
  // seat 2 — couch co-op's green hero (WASD · Left-Shift · F · E)
  { id: 'p2_up',    seat: 2, label: 'up',         key: 'w',     code: 'KeyW',      def: 'KeyW' },
  { id: 'p2_down',  seat: 2, label: 'down',       key: 's',     code: 'KeyS',      def: 'KeyS' },
  { id: 'p2_left',  seat: 2, label: 'left',       key: 'a',     code: 'KeyA',      def: 'KeyA' },
  { id: 'p2_right', seat: 2, label: 'right',      key: 'd',     code: 'KeyD',      def: 'KeyD' },
  { id: 'p2_dash',  seat: 2, label: 'dash',       key: 'Shift', code: 'ShiftLeft', def: 'ShiftLeft' },
  { id: 'p2_atk',   seat: 2, label: 'attack',     key: 'f',     code: 'KeyF',      def: 'KeyF' },
  { id: 'p2_cycle', seat: 2, label: 'spell page', key: 'e',     code: 'KeyE',      def: 'KeyE' },
];
// keys with a fixed global meaning can't be taken: the desktop's Escape, the
// menu confirms, pause/quit/restart, the summon digits and the 8/9 cheat keys
const BIND_BLOCKED = new Set(['Escape', 'Enter', 'NumpadEnter', 'Tab', 'KeyP', 'KeyQ', 'KeyR', 'KeyG', 'KeyZ',
  'Digit1', 'Digit2', 'Digit3', 'Digit8', 'Digit9', 'MetaLeft', 'MetaRight', 'AltLeft', 'AltRight',
  'ControlLeft', 'ControlRight', 'CapsLock', 'ContextMenu']);
const BIND_CODE_RE = /^[A-Za-z0-9]{1,24}$/;
let bindMap = null;      // physical code → action (only built while custom binds exist)
let bindDead = null;     // canonical codes whose action was rebound elsewhere → the physical key is dead
let bindCapture = null;  // the action id awaiting a key press on the CONTROLS page
let bindSel = 0;         // the CONTROLS page cursor
let shellPage = 'main';  // 'main' | 'binds'
// what the player has actually bound for an action (its default unless overridden)
function bindOf(a) { return (sfOpts.binds && sfOpts.binds[a.id]) || a.def; }
// rebuild the translation tables from sfOpts.binds (called at load + after every change)
function rebuildBinds() {
  const custom = sfOpts.binds && Object.keys(sfOpts.binds).length > 0;
  if (!custom) { bindMap = null; bindDead = null; return; }
  bindMap = new Map(); bindDead = new Set();
  for (const a of BIND_ACTIONS) {
    const code = bindOf(a);
    bindMap.set(code, a);
    if (code !== a.code) bindDead.add(a.code);
  }
  // a canonical code that is still someone's live binding is not dead
  for (const code of bindMap.keys()) bindDead.delete(code);
}
// validate a persisted binds object: real codes, nothing blocked, no double booking
function sanitizeBinds(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object') return out;
  const used = new Set();
  for (const a of BIND_ACTIONS) {
    const v = raw[a.id];
    if (typeof v !== 'string' || !BIND_CODE_RE.test(v) || BIND_BLOCKED.has(v) || v === a.def) continue;
    if (used.has(v)) continue;
    used.add(v); out[a.id] = v;
  }
  return out;   // a default another action stole simply goes dead (bindDead) until re-bound
}
function setBind(id, code) {
  const a = BIND_ACTIONS.find(x => x.id === id);
  if (!a || BIND_BLOCKED.has(code) || !BIND_CODE_RE.test(code)) return false;
  if (!sfOpts.binds) sfOpts.binds = {};
  // one key, one job: whoever else held this physical key loses it (back to their default,
  // unless that default is the key just taken — then it is simply dead until re-bound)
  for (const o of BIND_ACTIONS) if (o.id !== id && bindOf(o) === code) delete sfOpts.binds[o.id];
  if (code === a.def) delete sfOpts.binds[a.id]; else sfOpts.binds[a.id] = code;
  if (!Object.keys(sfOpts.binds).length) delete sfOpts.binds;
  saveOpts(); rebuildBinds();
  return true;
}
function resetBind(id) {
  if (sfOpts.binds && sfOpts.binds[id]) { delete sfOpts.binds[id]; if (!Object.keys(sfOpts.binds).length) delete sfOpts.binds; }
  saveOpts(); rebuildBinds();
}
function resetAllBinds() { delete sfOpts.binds; saveOpts(); rebuildBinds(); }
// the raw event is translated only OUTSIDE the typing contexts (name entry, the
// room code, an in-progress capture) and never for synthetic gamepad events,
// which are minted canonical already
function bindsBypass() {
  return (!alive && lbState === 'enter') || (netUi && netUi.phase === 'code') || bindCapture !== null;
}
const BIND_DEAD_EV = { key: 'Dead', code: 'Dead' };
function remapKey(raw) {
  if (!bindMap || raw.pad || bindsBypass()) return raw;
  const a = bindMap.get(raw.code);
  if (a) return { key: a.key, code: a.code, repeat: raw.repeat, preventDefault: () => raw.preventDefault() };
  if (bindDead.has(raw.code)) return { key: BIND_DEAD_EV.key, code: BIND_DEAD_EV.code, repeat: raw.repeat, preventDefault: () => raw.preventDefault() };
  return raw;
}
// a capture in progress: the next real key press becomes the binding (Escape is
// the desktop's, so it is not even offered — Backspace cancels instead)
function captureBind(raw) {
  if (raw.repeat) return;
  if (raw.code === 'Backspace') { bindCapture = null; if (sfSfx.killE) sfSfx.killE(); return; }
  if (raw.code === 'Escape') return;
  if (setBind(bindCapture, raw.code)) { bindCapture = null; sfSfx.coin(); }
  else if (sfSfx.thud) sfSfx.thud();
}
// human labels for KeyboardEvent.code values
function codeLabel(code) {
  if (!code) return '—';
  const m = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift',
              Space: 'Space', Slash: '/', Period: '.', Comma: ',', Semicolon: ';', Quote: "'", Backslash: '\\', Backquote: '`',
              BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backspace: 'Backspace', Dead: '—' };
  if (m[code]) return m[code];
  if (/^Key[A-Z]$/.test(code)) return code[3];
  if (/^Digit\d$/.test(code)) return code[5];
  if (/^Numpad/.test(code)) return 'num ' + code.slice(6).toLowerCase();
  return code;
}
// the CONTROLS page (drawn by drawShellMenu when shellPage === 'binds'): two
// columns of actions, the bound key beside each; Enter captures, Backspace resets
function drawBindsPage(y0) {
  ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#ffd24d'; ctx.textAlign = 'center';
  ctx.fillText('CONTROLS', GW / 2, y0);
  ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(padCount() ? '🎮 ' + padCount() + ' gamepad' + (padCount() > 1 ? 's' : '') + ' connected — see the pad card below' : 'keyboard — rebind any action; the game, replays and co-op never notice', GW / 2, y0 + 22);
  ctx.shadowBlur = 0;
  const perCol = BIND_ACTIONS.filter(a => a.seat === 1).length;
  const colW = Math.min(300, (GW - 60) / 2);
  const rowH = 24;
  const heads = ['PLAYER 1  (solo)', 'PLAYER 2  (couch co-op)'];
  const headCol = ['#ffffff', P2_COL];
  for (let c = 0; c < 2; c++) {
    const x = GW / 2 - colW + 12 + c * colW;
    ctx.font = 'bold 11px Tahoma,Arial'; ctx.fillStyle = headCol[c]; ctx.textAlign = 'left';
    ctx.fillText(heads[c], x, y0 + 52);
  }
  for (let i = 0; i < BIND_ACTIONS.length; i++) {
    const a = BIND_ACTIONS[i];
    const c = a.seat - 1, r = i % perCol;
    const x = GW / 2 - colW + 12 + c * colW;
    const y = y0 + 72 + r * rowH;
    const hot = i === bindSel;
    const capturing = hot && bindCapture === a.id;
    const custom = !!(sfOpts.binds && sfOpts.binds[a.id]);
    if (hot) { ctx.fillStyle = 'rgba(255,210,77,0.10)'; ctx.fillRect(x - 6, y - 15, colW - 12, rowH - 2); }
    ctx.font = (hot ? 'bold ' : '') + '13px Tahoma,Arial'; ctx.fillStyle = hot ? '#ffe9ad' : '#9aa3a8'; ctx.textAlign = 'left';
    ctx.fillText(a.label, x, y);
    ctx.textAlign = 'right';
    ctx.fillStyle = capturing ? '#ff8a80' : custom ? '#7fd8ff' : hot ? '#e8eef4' : '#77828c';
    ctx.font = (capturing ? 'italic ' : 'bold ') + '13px Tahoma,Arial';
    ctx.fillText(capturing ? 'press a key…' : codeLabel(bindOf(a)), x + colW - 30, y);
  }
  const yb = y0 + 72 + perCol * rowH + 6;
  ctx.textAlign = 'center';
  // the pad card — the fixed standard-gamepad layout (not rebindable; see 22-gamepad)
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#8494a4';
  ctx.fillText('🎮 pad: stick / d-pad move · A confirm · X attack · Y spell page · LB RB LT RT dash · Start pause · L3 R3 Back summon 1·2·3', GW / 2, yb);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('↑ ↓ ← → — choose   ·   Enter / Z — rebind   ·   Backspace — default   ·   Delete — reset all   ·   P / Q — back', GW / 2, yb + 22);
}
// key handling for the CONTROLS page (called from onKey's shell block; returns
// true when it consumed the key)
function bindsPageKey(e) {
  const n = BIND_ACTIONS.length, perCol = n / 2;
  if (e.key === 'ArrowUp')        { bindSel = (bindSel + n - 1) % n; if (sfSfx.killE) sfSfx.killE(); }
  else if (e.key === 'ArrowDown') { bindSel = (bindSel + 1) % n; if (sfSfx.killE) sfSfx.killE(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { bindSel = (bindSel + perCol) % n; if (sfSfx.killE) sfSfx.killE(); }
  else if (!e.repeat && ['Enter', 'z', 'Z'].includes(e.key)) { bindCapture = BIND_ACTIONS[bindSel].id; if (sfSfx.charge) sfSfx.charge(); }
  else if (!e.repeat && e.key === 'Backspace') { resetBind(BIND_ACTIONS[bindSel].id); if (sfSfx.killE) sfSfx.killE(); }
  else if (!e.repeat && e.key === 'Delete') { resetAllBinds(); if (sfSfx.thud) sfSfx.thud(); }   // not a letter: a bound attack key must not wipe the page
  else if (!e.repeat && ['p', 'P', 'q', 'Q'].includes(e.key)) { shellPage = 'main'; if (sfSfx.killE) sfSfx.killE(); }
  else return false;
  return true;
}
// the persisted binds arrive raw from the options loader (02-state runs before this
// table exists); validate them here, then build the translation tables
sfOpts.binds = sanitizeBinds(sfOpts.binds);
if (!Object.keys(sfOpts.binds).length) delete sfOpts.binds;
rebuildBinds();
