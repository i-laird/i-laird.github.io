// ── input — onKey (~300 lines), key-name normalization, listener wiring, boot ──
// The key map is keyed by a Shift-invariant name: single characters are lowercased so a
// letter released while Shift is held (keyup fires as 'D', not 'd') still clears the same
// entry that keydown set. Without this, P2's WASD keys stick when dashing (Left-Shift) —
// e.g. holding 'd' to run right + tapping Shift leaves keys['d'] true forever. (Arrow keys
// aren't case-sensitive, which is why only P2's letter movement was affected.)
const keyName = (k) => (k.length === 1 ? k.toLowerCase() : k);
function onKey(e) {
  keys[keyName(e.key)] = true;
  // watching a replay: Q leaves; every other key belongs to the legend, not you
  if (replayMode) {
    if (!e.repeat && (e.key === 'q' || e.key === 'Q')) stopReplay();
    e.preventDefault();
    return;
  }
  // an online run: Q leaves cleanly at any point (tell the partner first)
  if (netplay && !e.repeat && (e.key === 'q' || e.key === 'Q')) {
    netSend({ t: 'bye' });
    netLeave('you left the game');
    e.preventDefault();
    return;
  }
  // death-screen watch picker: ↑↓ choose a legend, Enter watches, Q/W closes
  if (!alive && watchSel) {
    const n = watchSel.list.length;
    if (e.key === 'ArrowUp')        watchSel.idx = (watchSel.idx + n - 1) % n;
    else if (e.key === 'ArrowDown') watchSel.idx = (watchSel.idx + 1) % n;
    else if (e.key === 'Enter' && !e.repeat) startWatch(watchSel.list[watchSel.idx]);
    else if (['q', 'Q', 'w', 'W', 'Escape'].includes(e.key)) watchSel = null;
    e.preventDefault();
    return;
  }
  // W on the board view opens the picker (only when some entry has a stored replay)
  if (!alive && (e.key === 'w' || e.key === 'W') && (lbState === 'view' || lbState === 'done')) {
    const list = watchableEntries();
    if (list.length) { watchSel = { list, idx: 0 }; watchErr = ''; e.preventDefault(); return; }
  }
  // entering a name for the leaderboard after death — capture typing, swallow
  // everything else (so letters/digits go into the name, not cheats or the R-restart)
  if (!alive && lbState === 'enter') {
    if (e.key === 'Enter') lbSubmit();
    else if (e.key === 'Backspace') lbName = lbName.slice(0, -1);
    else if (e.key.length === 1 && lbName.length < 10 && /[A-Za-z0-9._-]/.test(e.key)) lbName += e.key;
    e.preventDefault();
    return;
  }
  // ── intro screen: pick 1P/2P on the mode row and a class per hero, then begin ──
  // ↑/↓ switch rows (mode · P1 class · P2 class in 2P), ←/→ change the value on the
  // active row (1/2 still jump the mode directly); Z / Enter / Space begins. Defaults
  // (1-PLAYER · MELEE) keep the classic run one Enter away. (The headless determinism
  // test starts by dispatching Enter, then holds ArrowRight to move.)
  if (!started) {
    // the HOST/JOIN connect screens own the keys while they're up
    if (netUi) {
      const backOut = () => {
        netSend({ t: 'bye' });
        netTeardown();
        netUi = null; netSaved = null; netCfg = null;
      };
      // class is still changeable on the connect screens (◀ ▶) right up until
      // the link opens — the host's cfg reads classSel when the hello arrives,
      // the joiner's hello reads it at channel-open
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
          ['creating', 'waiting', 'code', 'err', 'lobby'].includes(netUi.phase)) {
        const d = e.key === 'ArrowRight' ? 1 : -1;
        classSel = (classSel + d + CLASSES.length) % CLASSES.length;
        try { localStorage.setItem('ilaird_sf_cls', String(classSel)); } catch (err) { /* private mode */ }
        if (netUi.phase === 'lobby') {
          // re-picking un-readies you (the run must never start under a stale pick)
          if (netUi.myReady) { netUi.myReady = false; netSend({ t: 'rdy', v: 0 }); }
          netSend({ t: 'cls', c: classSel });
        }
        if (sfSfx.killE) sfSfx.killE();
        e.preventDefault();
        return;
      }
      if (netUi.phase === 'code') {
        // code entry first: Q is a valid room-code character, so here it TYPES —
        // Backspace on an empty code is the back-out (Escape is the desktop's)
        if (e.key === 'Enter' && netUi.input.length === 5) netStartJoin(netUi.input);
        else if (e.key === 'Backspace') {
          if (netUi.input.length === 0) backOut();
          else netUi.input = netUi.input.slice(0, -1);
        } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && netUi.input.length < 5) {
          netUi.input += e.key.toUpperCase();
        }
      } else if (netUi.phase === 'lobby' && !e.repeat && ['z', 'Z', 'Enter', ' '].includes(e.key)) {
        // the READY gate: the run starts only when BOTH players have confirmed
        netUi.myReady = !netUi.myReady;
        netSend({ t: 'rdy', v: netUi.myReady ? 1 : 0 });
        if (sfSfx.killE) sfSfx.killE();
        netLobbyMaybeStart();
      } else if (!e.repeat && (e.key === 'q' || e.key === 'Q')) {
        backOut();
      } else if (netUi.phase === 'waiting' && !e.repeat && (e.key === 'c' || e.key === 'C')) {
        // the code is canvas-drawn (unselectable) — C puts it on the clipboard
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(netUi.code).then(
              () => { if (netUi) netUi.copiedT = 150; },
              () => {},
            );
          }
        } catch (err) { /* clipboard unavailable — the code stays typeable */ }
      } else if (netUi.phase === 'err' && !e.repeat && ['z', 'Z', 'Enter'].includes(e.key)) {
        if (netUi.mode === 'host') netOpen('host');           // roll a fresh room
        else { netUi.phase = 'code'; netUi.input = ''; netUi.err = ''; }
      }
      e.preventDefault();
      return;
    }
    // the trophy case: T toggles it; while open it swallows the intro keys
    // (Escape is avoided on purpose — that's the XP desktop's shutdown key)
    // the couch co-op party sheet: Z/Enter falls through to the begin branch below;
    // Q/Backspace/X backs out; every other intro key is swallowed while it's up
    if (introConfirm && !['z', 'Z', 'Enter', ' '].includes(e.key)) {
      if (!e.repeat && ['q', 'Q', 'Backspace', 'x', 'X'].includes(e.key)) {
        introConfirm = false;
        if (sfSfx.killE) sfSfx.killE();
      }
      e.preventDefault();
      return;
    }
    if (e.key === 't' || e.key === 'T') { showTrophies = !showTrophies; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (showTrophies) { e.preventDefault(); return; }
    const nRows = isLocalMulti() ? 4 : 3;   // top · sub · class (· P2 class in LOCAL)
    if (e.key === 'ArrowUp')   { introRow = (introRow + nRows - 1) % nRows; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { introRow = (introRow + 1) % nRows; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    // 1/2/3 quick-jumps keep their old muscle memory: solo · couch co-op · daily
    if (e.key === '1') { menuTop = 0; subSingle = 0; if (introRow === 3) introRow = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === '2') { menuTop = 1; subMulti = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === '3') { menuTop = 0; subSingle = 2; if (introRow === 3) introRow = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const nc = CLASSES.length;
      if (introRow === 0) menuTop = (menuTop + 1) % 2;
      else if (introRow === 1) {
        if (menuTop === 0) {
          do { subSingle = (subSingle + d + 3) % 3; } while (subSingle === 1 && !hardUnlocked);   // HARD is skipped until earned
        } else {
          subMulti = (subMulti + d + 3) % 3;
        }
      }
      else if (introRow === 2) classSel  = (classSel  + d + nc) % nc;
      else                     classSel2 = (classSel2 + d + nc) % nc;
      if (sfSfx.killE) sfSfx.killE();
      e.preventDefault(); return;
    }
    if (['z', 'Z', 'Enter', ' '].includes(e.key)) {
      try { localStorage.setItem('ilaird_sf_cls', String(classSel)); localStorage.setItem('ilaird_sf_cls2', String(classSel2)); } catch (_) {}
      if (menuTop === 1 && subMulti !== 0) {
        // online: hand off to the connect flow — the run starts only after BOTH
        // players ready up in the lobby (see the 'lobby' phase)
        netOpen(subMulti === 1 ? 'host' : 'join');
        e.preventDefault();
        return;
      }
      if (menuTop === 1 && subMulti === 0 && !introConfirm) {
        // couch co-op: show the party sheet first — a second Z/Enter starts
        introConfirm = true;
        if (sfSfx.killE) sfSfx.killE();
        e.preventDefault();
        return;
      }
      introConfirm = false;
      coop = menuTop === 1;                                  // LOCAL couch co-op
      dailyRun = menuTop === 0 && subSingle === 2;
      hardSel = menuTop === 0 && subSingle === 1;            // only reachable once hardUnlocked
      // daily pins the shared per-day seed through the existing MP/replay hook;
      // a normal run clears it back to fresh entropy
      sfSeedOverride = dailyRun ? dailySeed() : null;
      init();                     // fresh state on the chosen seed (init reads classSel/coop/hardSel)
      beginRunProof();            // stamp the start time for the leaderboard's proof check
      started = true; frame = 0;
      banner = (dailyRun ? '☀ DAILY CHALLENGE' : coop ? 'CO-OP · WAVE 1' : 'WAVE 1') + (hardMode ? ' · ☠ HARD' : '');
      bannerSub = dailyRun ? dailyDayPretty() + ' — same seed for everyone' : hardMode ? 'the horde remembers your mercy' : '';
      // synchronous: the seed's first draws, live and in replay alike.
      // Hard mode gets no gifts — the run opens on a BANE instead.
      hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
      bannerT = 90;
      startSfMusic();
    }
    e.preventDefault();
    return;
  }
  // a boon offer on the table — nothing else responds until one is taken.
  // ONLINE, the host drives every shared menu: its confirm becomes a tick-stamped
  // event (netQueueEvent) applied by BOTH feeders at the same tick — never a direct
  // call, which would fire it on one sim only and desync. The client just watches.
  if (paused && boonMenu) {
    if (netplay && !netIsHost) { e.preventDefault(); return; }
    const n = boonMenu.opts.length;
    if (['ArrowLeft', 'a', 'A'].includes(e.key))       { boonMenu.sel = (boonMenu.sel + n - 1) % n; sfSfx.killE(); }
    else if (['ArrowRight', 'd', 'D'].includes(e.key)) { boonMenu.sel = (boonMenu.sel + 1) % n; sfSfx.killE(); }
    else if (!e.repeat && ['z', 'Z', ' ', 'Enter'].includes(e.key)) {
      // stamped tick+1 like every between-tick UI event (see the shop below)
      if (netplay) netQueueEvent(12, boonMenu.opts[boonMenu.sel].id);
      else { recPush([tick + 1, 12, boonMenu.opts[boonMenu.sel].id]); pickBoon(boonMenu.opts[boonMenu.sel].id); }
    }
    e.preventDefault();
    return;
  }
  // upgrade menu between waves — input only navigates the shop while paused.
  // ONLINE both players shop at once: each navigates their OWN cursor (sel is
  // view-local — never sim-read), and a confirm crosses as a tick-stamped BUY
  // event carrying the node id, so simultaneous picks resolve deterministically
  // (first event wins; a second buy of the same id no-ops in the feeder).
  if (paused && upMenu) {
    const rows = availableUpgrades();
    const n = rows.length + 1;                       // +1 = the Continue row
    if (['ArrowUp', 'ArrowLeft', 'w', 'W'].includes(e.key))        { upMenu.sel = (upMenu.sel - 1 + n) % n; sfSfx.killE(); }
    else if (['ArrowDown', 'ArrowRight', 's', 'S'].includes(e.key)) { upMenu.sel = (upMenu.sel + 1) % n; sfSfx.killE(); }
    else if (['z', 'Z', ' ', 'Enter'].includes(e.key)) {           // select the highlighted row
      // UI events happen BETWEEN ticks, so they're stamped tick+1: the replay
      // feeder applies them at the top of the next tick — the exact same slot
      if (upMenu.sel >= rows.length) {
        if (netplay) netQueueEvent(8, 0);
        else { recPush([tick + 1, 8]); finishUpgrades(); }        // on Continue → leave
      } else if (netplay) netQueueEvent(7, rows[upMenu.sel].id);
      else { recPush([tick + 1, 7, rows[upMenu.sel].id]); buyUpgrade(rows[upMenu.sel]); }  // on a node → unlock it
    }
    e.preventDefault();
    return;
  }
  // the final confrontation with the creator — all play is locked; only the choice responds
  if (ianActive) {
    if (ianChoice && !(netplay && !netIsHost)) {
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) { ianChoice.sel = 0; sfSfx.killE(); }
      else if (['ArrowRight', 'd', 'D'].includes(e.key)) { ianChoice.sel = 1; sfSfx.killE(); }
      else if (!e.repeat && ['z', 'Z', ' ', 'Enter'].includes(e.key)) {
        if (ianChoice.t >= 60 * SIM_HZ) sfUnlock('the_weight');   // a full minute holding his fate
        if (netplay) netQueueEvent(10, ianChoice.sel);
        else { recPush([tick + 1, 10, ianChoice.sel]); chooseIan(ianChoice.sel); }
      }
    }
    e.preventDefault();
    return;
  }
  // cheat: type "nine" to skip straight to the Nazgûl set piece.
  // Every cheat marks the run `cheated` — still a playground, never ranked.
  // ALL warp/grant cheats are disabled online: they mutate the sim outside the
  // tick-stamped input stream, which would desync the two peers instantly.
  if (!netplay && /^[a-z]$/i.test(e.key)) {
    cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-8);
    if (cheatBuf.endsWith('nine')) { cheatBuf = ''; cheated = true; skipToTheNine(); }
  }
  // cheat: spam 9 — 3×=ringwraiths, 4×=Witch-king, 5×=east door, 6×=Vader, 7×=Sidious, 8×=DIO
  if (!netplay && e.key === '9' && !e.repeat) {
    const now = performance.now();
    nineKeyCount = now - last9 > 1500 ? 1 : nineKeyCount + 1;
    last9 = now;
    if (nineKeyCount >= 3) cheated = true;
    if (nineKeyCount === 3) skipToTheNine();
    else if (nineKeyCount === 4) skipToWitchKing();
    else if (nineKeyCount === 5) skipToPreStarWars();
    else if (nineKeyCount === 6) skipToVader();
    else if (nineKeyCount === 7) skipToSidious();
    else if (nineKeyCount === 8) skipToJojo();
    else if (nineKeyCount >= 9) { nineKeyCount = 0; skipToIan(); }
  }
  // cheat: spam 8 three times to unlock the entire upgrade tree
  if (!netplay && e.key === '8' && !e.repeat) {
    const now = performance.now();
    eightKeyCount = now - last8 > 1500 ? 1 : eightKeyCount + 1;
    last8 = now;
    if (eightKeyCount >= 3) { eightKeyCount = 0; cheated = true; grantAllUpgrades(); }
  }
  // boss intro cutscene — confirm advances the card / dialogue; the 8/9 cheats above
  // still warp through, but nothing else responds while the card is up
  if (bossIntro) {
    if (!e.repeat && ['z', 'Z', 'x', 'X', 'f', 'F', ' ', 'Enter'].includes(e.key)) {
      if (netplay) { if (netIsHost) netQueueEvent(9, 0); }   // the host turns the page for both
      else { recPush([tick + 1, 9]); advanceBossIntro(); }
    }
    e.preventDefault();
    return;
  }
  // Force choke: the only escape is to struggle — mash attack/dash; nothing else responds.
  // Mashes queue like every other combat input and land on the next tick.
  if (player.choke > 0) {
    if (!e.repeat && ['x', 'X', 'f', 'F', ' ', 'Shift'].includes(e.key)) {
      if (netplay) { if (netIsHost) netLocal.mash++; }   // the choke grips P1 = the host
      else pend.mash++;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    return;
  }
  // combat keys. Solo: Space/Shift dash, X/F swing (unchanged). Co-op splits them by
  // hand — P1 = Right-Shift dash + '/' swing, P2 = Left-Shift dash + F swing (the two
  // Shifts are told apart by e.code). Summons/champion-prompt are shared either way.
  // All of these QUEUE into `pend` and apply at the next sim tick (per-tick input
  // capture) — never mutate the sim from inside the event handler.
  if (netplay) {
    // ONLINE both peers get the full solo bindings; edges stage into netLocal and
    // ride the next outgoing input frame (never straight into pend — the frame is
    // the sim's only input path online, identical on both machines)
    if (e.key === ' ' || e.key === 'Shift') netLocal.dash = true;
    if (e.key === 'x' || e.key === 'X' || e.key === 'f' || e.key === 'F') netLocal.atk = true;
    if (e.key === 'c' || e.key === 'C' || e.key === 'e' || e.key === 'E') netLocal.cycle = true;
    if (e.key === '1') netLocal.summon = 0;
    if (e.key === '2') netLocal.summon = 1;
    if (e.key === '3') netLocal.summon = 2;
  } else if (!coop) {
    if (e.key === ' ' || e.key === 'Shift') pend.dashP1 = true;
    if (e.key === 'x' || e.key === 'X' || e.key === 'f' || e.key === 'F') pend.atkP1 = true;
    if (e.key === 'c' || e.key === 'C' || e.key === 'e' || e.key === 'E') pend.cycleP1 = true;  // the wizard turns a spellbook page
  } else {
    if (e.code === 'ShiftRight') pend.dashP1 = true;
    if (e.code === 'Slash') pend.atkP1 = true;
    if (e.code === 'Period') pend.cycleP1 = true;      // beside '/' — P1's spell page
    if (e.code === 'ShiftLeft') pend.dashP2 = true;
    if (e.key === 'f' || e.key === 'F') pend.atkP2 = true;
    if (e.key === 'e' || e.key === 'E') pend.cycleP2 = true;  // beside F — P2's spell page
  }
  if (e.key === 'g' || e.key === 'G') pend.prompt = true;   // banner only — local & unrecorded
  if (!netplay) {
    if (e.key === '1') pend.summon = 'gandalf';
    if (e.key === '2') pend.summon = 'luke';
    if (e.key === '3') pend.summon = 'jotaro';
  }
  if ((e.key === 'r' || e.key === 'R') && !alive) {
    if (netplay) {
      // rematch is host-authoritative: a fresh shared seed, same team & snapshot
      // (blocked while reconnecting — a restart the peer can't hear would desync)
      if (netIsHost && netCfg && !netRecon && !e.repeat) {
        const seed = (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
        netCfg.seed = seed;
        netSend({ t: 'restart', seed });
        netBeginRun();
      }
      e.preventDefault();
      return;
    }
    sfSeedOverride = dailyRun ? dailySeed() : null;   // re-pin today's seed (recomputed in case midnight passed)
    init();
    beginRunProof();
    started = true;
    banner = (dailyRun ? '☀ DAILY CHALLENGE' : coop ? 'CO-OP · WAVE 1' : 'WAVE 1') + (hardMode ? ' · ☠ HARD' : '');
    bannerSub = dailyRun ? dailyDayPretty() + ' — same seed for everyone' : hardMode ? 'the horde remembers your mercy' : '';
    bannerT = 90; startSfMusic();
    hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) || e.code === 'Slash') e.preventDefault();
}
function offKey(e) { keys[keyName(e.key)] = false; }
function dropKeys() { keys = {}; }   // release everything (focus loss → missed keyups)
// ⌘/Ctrl+V fills the JOIN code entry (the paste event carries the clipboard without
// any permission prompt; only listened to on the code screen)
function onPaste(e) {
  if (started || !netUi || netUi.phase !== 'code') return;
  const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
  const code = txt.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (code) { netUi.input = code; e.preventDefault(); }
}
document.addEventListener('keydown', onKey);
document.addEventListener('keyup',   offKey);
document.addEventListener('paste',   onPaste);
// Safety net for stuck movement: if the window loses focus (alt-tab, a click into the
// devtools, etc.) the keyup may never arrive, leaving a key "held". Drop all held keys on
// blur so a hero can't run off on its own.
window.addEventListener('blur', dropKeys);

init(); frameStep();
xp._sfCleanup = stopGame;
