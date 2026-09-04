// ── gamepad — standard-mapping pads, translated into the keyboard's own synthetic key events ──
/* A pad never talks to the sim. padPoll() runs once per rAF (frameStep, before the
   sim steps) and diffs each pad's buttons/sticks against the last poll; every edge
   becomes a synthetic {key, code} event fed to onKey/offKey — the SAME canonical
   names the keyboard produces (pad 0 = seat 1's arrows / R-Shift / Slash / Period,
   pad 1 = seat 2's WASD / L-Shift / F / E in couch co-op). So `keys[...]`, the pend
   edges, the recorder, the replay feeder and the lockstep frames see nothing new:
   a pad run records, replays and lockstops exactly like a keyboard run. Synthetic
   events carry `pad: true` so remapKey leaves them alone (they are minted
   canonical; a rebound keyboard must not "kill" the pad's arrows). Fixed layout,
   not rebindable: stick / d-pad move · A confirm (Z) · B back (Backspace) ·
   X attack · Y spell page · LB RB LT RT dash · Start pause (P) · L3 R3 Back = the
   summon digits 1 · 2 · 3. Held directions auto-repeat in menus (keyboards do
   that for free). Solo and online runs read pad 0 only; a second pad is only
   ever seat 2, and only when the intro (LOCAL) or the run (coop) says so. */
const PAD_DEAD = 0.5;
const PAD_REPEAT_FIRST = 320, PAD_REPEAT_NEXT = 110;   // ms — menu auto-repeat for held directions
let padStates = [];   // per pad index → { held: Map<code, { ev, next }> }
let padsSeen = 0;     // connected pads at the last poll (hints + the shell's controls row)
function padCount() { return padsSeen; }
// the canonical events for a seat (1 or 2) — read off BIND_ACTIONS' canonical
// columns, never the player's physical bindings
function padSeatKeys(seat) {
  const pick = (suffix) => { const a = BIND_ACTIONS.find(x => x.id === 'p' + seat + '_' + suffix); return { key: a.key, code: a.code }; };
  return { up: pick('up'), down: pick('down'), left: pick('left'), right: pick('right'),
           dash: pick('dash'), atk: pick('atk'), cycle: pick('cycle') };
}
const PAD_FIXED = {
  confirm: { key: 'z', code: 'KeyZ' }, back: { key: 'Backspace', code: 'Backspace' },
  pause: { key: 'p', code: 'KeyP' }, s1: { key: '1', code: 'Digit1' }, s2: { key: '2', code: 'Digit2' }, s3: { key: '3', code: 'Digit3' },
};
function padEvent(k, repeat) { return { key: k.key, code: k.code, repeat: !!repeat, pad: true, preventDefault() {} }; }
// is the second pad a seat right now? (couch co-op on the intro, or a couch run)
function padSeatFor(i) {
  if (i === 0) return 1;
  if (i === 1 && !netplay && (started ? coop : isLocalMulti())) return 2;
  return 0;   // no seat — ignored
}
function padPoll() {
  if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') return;
  let pads;
  try { pads = navigator.getGamepads() || []; } catch (_) { return; }
  const now = performance.now();
  const menuish = !started || paused || !alive || shellMenu || !!bossIntro;
  let seen = 0;
  for (let i = 0; i < pads.length && i < 2; i++) {
    const gp = pads[i];
    if (!padStates[i]) padStates[i] = { held: new Map() };
    const st = padStates[i];
    const want = new Map();   // code → canonical event for everything pressed this poll
    const seat = gp && gp.connected !== false ? padSeatFor(i) : 0;
    if (gp && gp.connected !== false) seen++;
    if (seat) {
      const K = padSeatKeys(seat);
      const b = (n) => !!(gp.buttons[n] && (gp.buttons[n].pressed || gp.buttons[n].value > 0.5));
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      const add = (k) => { if (!want.has(k.code)) want.set(k.code, k); };
      if (b(12) || ay < -PAD_DEAD) add(K.up);
      if (b(13) || ay > PAD_DEAD)  add(K.down);
      if (b(14) || ax < -PAD_DEAD) add(K.left);
      if (b(15) || ax > PAD_DEAD)  add(K.right);
      if (b(0)) add(PAD_FIXED.confirm);
      if (b(1)) add(PAD_FIXED.back);
      if (b(2)) add(K.atk);
      if (b(3)) add(K.cycle);
      if (b(4) || b(5) || b(6) || b(7)) add(K.dash);
      if (b(9)) add(PAD_FIXED.pause);
      if (b(10)) add(PAD_FIXED.s1);
      if (b(11)) add(PAD_FIXED.s2);
      if (b(8)) add(PAD_FIXED.s3);
    }
    // releases first (a code that moved from one button to another stays held)
    for (const [code, h] of st.held) {
      if (!want.has(code)) { st.held.delete(code); offKey(padEvent(h.ev)); }
    }
    // presses + menu auto-repeat for the four directions
    for (const [code, k] of want) {
      const h = st.held.get(code);
      if (!h) { st.held.set(code, { ev: k, next: now + PAD_REPEAT_FIRST }); onKey(padEvent(k)); continue; }
      const dir = k.key === 'ArrowUp' || k.key === 'ArrowDown' || k.key === 'ArrowLeft' || k.key === 'ArrowRight'
               || k.key === 'w' || k.key === 'a' || k.key === 's' || k.key === 'd';
      if (menuish && dir && now >= h.next) { h.next = now + PAD_REPEAT_NEXT; onKey(padEvent(k, true)); }
    }
  }
  padsSeen = seen;
}
// every synthetic key goes up when the game stops (mirrors dropKeys for the keyboard)
function padRelease() {
  for (const st of padStates) if (st) { for (const h of st.held.values()) offKey(padEvent(h.ev)); st.held.clear(); }
}
