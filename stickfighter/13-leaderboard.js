// ── leaderboard — hall of legends: run proof, fetch/submit, replay watch entry points ──
/* ── online leaderboard (the "hall of legends") ──
   Backed by the same hal-worker service as the LLM-HAL game (GET /scores,
   POST /score). Reads HAL_WORKER_URL — an app.js global (both are classic
   scripts in one shared scope). Degrades silently to lbState='off' (the
   original local-best death screen) whenever the worker is absent/unreachable. */
function lbBase() {
  try { return (typeof HAL_WORKER_URL === 'string' && HAL_WORKER_URL) ? HAL_WORKER_URL : null; }
  catch (_) { return null; }
}
// stamp the run's true start time with a worker-signed token (fire-and-forget —
// starting never waits on the network; no token just means the submit is refused
// by a proof-enforcing worker and the death screen stays view-only)
function beginRunProof() {
  runToken = null;
  const base = lbBase();
  if (!base || netplay) return;   // online runs never submit, so they claim no run token
  fetch(base + '/run-start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && typeof d.token === 'string') runToken = d.token; })
    .catch(() => {});
}
function lbBegin() {
  lbScore = score; lbWave = wave; lbRank = -1; lbName = ''; lbScores = null; lbDaily = null;
  watchSel = null; watchErr = '';
  const base = lbBase();
  if (cheated) { lbState = 'off'; return; }   // warp/grant cheats: a fine playground, not a ranked run
  if (!base || score <= 0) { lbState = 'off'; return; }
  lbState = 'loading';
  const day = dailyDayStr();
  // fetch both boards: the all-time hall is required; today's board is best-effort
  // (an old worker without daily support echoes the all-time board WITHOUT a `day`
  // field, so requiring d.day === day keeps a stale backend from faking a daily list)
  const allP = fetch(base + '/scores', { method: 'GET' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));
  const dayP = fetch(base + '/scores?day=' + day, { method: 'GET' })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  Promise.all([allP, dayP])
    .then(([all, dl]) => {
      if (alive) return;                       // player already restarted — ignore the stale load
      lbScores = (all && Array.isArray(all.scores)) ? all.scores.slice(0, 10) : [];
      lbDaily = (dl && dl.day === day && Array.isArray(dl.scores)) ? dl.scores.slice(0, 10) : null;
      const board = dailyRun ? lbDaily : lbScores;
      if (board === null) { lbState = 'view'; return; }   // daily run, worker has no daily boards — display only
      const lowest = board.length >= 10 ? board[board.length - 1].score : 0;
      lbState = (board.length < 10 || lbScore > lowest) ? 'enter' : 'view';
    })
    .catch(() => { if (!alive) lbState = 'off'; });
}
function lbSubmit() {
  const base = lbBase();
  const nm = (lbName.trim() || 'AAA').slice(0, 10);
  if (!base) { lbState = 'off'; return; }
  lbState = 'submitting';
  // attach the run's recording (header + per-tick events) so the board entry is
  // watchable — skipped if the recorder overflowed or the encoding is oversized
  let replayField = {};
  if (!recOverflow && recHdr) {
    const rp = { ...recHdr, ev: recEv };
    if (JSON.stringify(rp).length <= 150000) replayField = { replay: rp };
  }
  fetch(base + '/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // a daily run carries its day → the worker writes today's board instead;
    // token + ticks + kills are the run's minimal proof (see beginRunProof)
    body: JSON.stringify({ game: 'sf', name: nm, score: lbScore, wave: lbWave,
                           token: runToken, ticks: lbTicks, kills: lbKills,
                           ...replayField,
                           ...(dailyRun ? { day: dailyDayStr() } : {}) }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      if (alive) return;                       // restarted mid-submit — drop the response
      if (d && Array.isArray(d.scores)) {
        if (dailyRun) lbDaily = d.scores.slice(0, 10);
        else lbScores = d.scores.slice(0, 10);
      }
      lbRank = (d && Number.isInteger(d.rank)) ? d.rank : -1;
      if (dailyRun && lbRank === 0) sfUnlock('daily_crown');   // LEGEND OF THE DAY — top of today's board
      lbState = 'done';
    })
    .catch(() => { if (!alive) lbState = 'view'; });   // show the board we already have
}

/* ── watching a legend: fetch a stored replay and re-simulate it locally ── */
let watchSel = null;    // { list: [{entry, daily}], idx } — the death-screen picker
let watchErr = '';      // sticky failure notice (the death hud repaints every tick)
function watchableEntries() {
  const list = [];
  for (const e of lbScores || []) if (e && typeof e.rp === 'string') list.push({ entry: e, daily: false });
  for (const e of lbDaily || [])  if (e && typeof e.rp === 'string') list.push({ entry: e, daily: true });
  return list;
}
function startWatch(item) {
  const base = lbBase();
  if (!base) return;
  hud.innerHTML = 'fetching the legend…';
  fetch(base + '/replay?id=' + encodeURIComponent(item.entry.rp))
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      const rd = d && d.replay;
      // v must match the CURRENT sim-balance version — an older recording would
      // re-simulate under new rules and play back a different run than it claims
      if (!rd || rd.v !== 5 || !Array.isArray(rd.ev) || typeof rd.seed !== 'number') return Promise.reject('bad');
      startReplay(rd, item.entry);
    })
    .catch(() => { watchSel = null; watchErr = 'replay unavailable — recorded on an older build, or expired'; });
}
function startReplay(d, entry) {
  // impersonate the recorded run's setup; the watcher's own selections return on exit
  repSaved = { c1: classSel, c2: classSel2, coop, daily: dailyRun, hs: hardSel,
               top: menuTop, ss: subSingle, sm: subMulti };
  watchSel = null;
  replayMode = true;
  replay = { d, i: 0, name: String(entry.name || 'AAA'), score: entry.score | 0 };
  classSel = clamp(d.c1 | 0, 0, CLASSES.length - 1); classSel2 = clamp(d.c2 | 0, 0, CLASSES.length - 1);
  coop = !!d.coop; dailyRun = false;
  sfSeedOverride = d.seed >>> 0;
  repMask = 0;
  init();                 // replayMode: init loads the RECORDER's persistent state
  started = true; frame = 0;
  // same post-init roll as live play — the feeder's opcode 12 picks (hardMode
  // came from the recording's header, so hard replays open on the bane menu)
  hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
  banner = '▶ ' + replay.name + ' — ' + replay.score;
  bannerSub = 'a legend, replayed · Q to leave'; bannerT = 150;
}
function stopReplay() {
  replayMode = false; replay = null;
  if (repSaved) {
    classSel = repSaved.c1; classSel2 = repSaved.c2;
    coop = repSaved.coop; dailyRun = repSaved.daily; hardSel = repSaved.hs;
    menuTop = repSaved.top; subSingle = repSaved.ss; subMulti = repSaved.sm;
    repSaved = null;
  }
  sfSeedOverride = null;
  init();                 // back to the title, the watcher's own setup restored
}
