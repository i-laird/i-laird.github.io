// ── loop — the fixed-timestep frame driver and loop() — one sim tick + one render, fused ──
/* ── main loop ── */
// rAF driver on a FIXED TIMESTEP: the sim advances SIM_HZ × SF_SPEED ticks per
// second of wall-clock time, independent of the display's refresh rate — a 120 Hz
// monitor renders more often but simulates no faster (before this, sim speed
// scaled with refresh rate). loop() is one sim tick + a render, fused — catch-up
// ticks simply redraw, and (important for determinism) any rnd() consumed in
// render code still runs exactly once per tick. The accumulator is capped so a
// backgrounded tab doesn't fast-forward the horde on return, and a hard per-frame
// step cap drops the remainder rather than spiraling.
let lastFrameTs = null;
function frameStep(ts) {
  rafId = requestAnimationFrame(frameStep);
  const now = (typeof ts === 'number') ? ts : performance.now();
  if (lastFrameTs === null) lastFrameTs = now;
  const dt = Math.max(0, Math.min(0.25, (now - lastFrameTs) / 1000));
  lastFrameTs = now;
  simAcc += dt * SIM_HZ * SF_SPEED;
  let steps = Math.floor(simAcc);
  simAcc -= steps;
  if (steps > 5) steps = 5;   // hard cap — drop the excess, never spiral
  for (let i = 0; i < steps; i++) {
    // the LOCKSTEP gate: online, a tick only runs once BOTH peers' input frames
    // for it are buffered (this covers every tick — menus and death screen too,
    // since tick advances there and pause duration is part of determinism)
    if (netplay && started && !netCanStep()) { simAcc = 0; netStall++; break; }
    if (netplay) netStall = 0;
    loop();
  }
  // a badge over the frozen frame (render-only). netRecon = the link actually died
  // and is being re-signaled (see netStartRecon); a plain stall = the link is alive
  // but the peer is lagging or tabbed away — deliberately NOT a reconnect trigger.
  if (netplay && started) {
    if (netReconActive()) drawNetRecon();
    else if (netStall > 30) drawNetWait();
  }
}

function loop() {
  tick++;                          // the deterministic sim clock — advances once per logical tick

  /* replay feeder: apply every recorded event stamped up to this tick, BEFORE any
     game logic — pend actions land exactly where the pend consumer will eat them,
     masks land before the input sampler, and menu/cutscene events (buy / continue /
     intro-advance / Ian) land in the same between-ticks slot they were recorded in */
  if (replayMode && replay) {
    const ev = replay.d.ev;
    while (replay.i < ev.length && ev[replay.i][0] <= tick) {
      const e = ev[replay.i++];
      switch (e[1]) {
        case 0: repMask = e[2] | 0; break;
        case 1: pend.dashP1 = true; break;
        case 2: pend.atkP1 = true; break;
        case 3: pend.dashP2 = true; break;
        case 4: pend.atkP2 = true; break;
        case 5: pend.summon = ['gandalf', 'luke', 'jotaro'][e[2]] || null; break;
        case 6: pend.mash += e[2] | 0; break;
        case 7: { const u = availableUpgrades().find((x) => x.id === e[2]); if (u && upMenu) buyUpgrade(u); break; }
        case 8: if (upMenu) finishUpgrades(); break;
        case 9: if (bossIntro) advanceBossIntro(); break;
        case 10: if (ianChoice) chooseIan(e[2] ? 1 : 0); break;
        case 11: if (e[2]) pend.cycleP2 = true; else pend.cycleP1 = true; break;
        case 12: if (boonMenu) pickBoon(e[2]); break;
        case 13: shellToggle(); break;   // the recorded pause — replays hold the same beats
      }
    }
  }

  /* netplay feeder — the lockstep twin of the replay feeder above. Runs every tick
     (menus, death screen and all — frames must keep flowing or both peers stall):
     1. sample the LOCAL held-keys + staged edges into a frame for tick+NET_DELAY,
        buffer it and send it (frameStep's gate guarantees the remote does the same);
     2. apply host menu events stamped up to this tick (same opcodes as replay);
     3. apply BOTH players' buffered frames for THIS tick into pend/netMask. */
  if (netplay && started) {
    const nt = tick + NET_DELAY;
    const mine = netFrames[netSeat];
    if (!mine.has(nt)) {
      let lm = 0;   // every seat plays with the full solo bindings (arrows OR WASD)
      if (keys['ArrowLeft'] || keys['a']) lm |= 1;
      if (keys['ArrowRight'] || keys['d']) lm |= 2;
      if (keys['ArrowUp'] || keys['w']) lm |= 4;
      if (keys['ArrowDown'] || keys['s']) lm |= 8;
      const f = { m: lm,
                  e: (netLocal.dash ? 1 : 0) | (netLocal.atk ? 2 : 0) | (netLocal.cycle ? 4 : 0),
                  s: netLocal.summon, h: netLocal.mash };
      netLocal.dash = netLocal.atk = netLocal.cycle = false; netLocal.summon = -1; netLocal.mash = 0;
      mine.set(nt, f);
      netSend({ t: 'f', r: netRunId, p: netSeat, k: nt, m: f.m, e: f.e, s: f.s, h: f.h });
    }
    while (netEvents.length && netEvents[0][0] <= tick) {
      const ev = netEvents.shift();
      switch (ev[1]) {
        case 7: { const u = availableUpgrades().find((x) => x.id === ev[2]); if (u && upMenu) buyUpgrade(u); break; }
        case 8: if (upMenu) finishUpgrades(); break;
        case 9: if (bossIntro) advanceBossIntro(); break;
        case 10: if (ianChoice) chooseIan(ev[2] ? 1 : 0); break;
        case 12: if (boonMenu) pickBoon(ev[2]); break;
      }
    }
    // apply EVERY seat's frame for THIS tick (the gate guaranteed they're here)
    const fs = netFrames.map((fm) => fm.get(tick));
    if (fs.every(Boolean)) {
      netMask = (fs[0].m & 15) | (((fs[1] ? fs[1].m : 0) & 15) << 4);   // P1 low nibble, P2 high
      netMasks[2] = fs[2] ? fs[2].m & 15 : 0;   // P3/P4 movement reads these directly
      netMasks[3] = fs[3] ? fs[3].m & 15 : 0;
      const DASH = ['dashP1', 'dashP2', 'dashP3', 'dashP4'];
      const ATK  = ['atkP1', 'atkP2', 'atkP3', 'atkP4'];
      const CYC  = ['cycleP1', 'cycleP2', 'cycleP3', 'cycleP4'];
      const SUM  = ['summon', 'summon2', 'summon3', 'summon4'];
      for (let i = 0; i < fs.length; i++) {
        if (fs[i].e & 1) pend[DASH[i]] = true;
        if (fs[i].e & 2) pend[ATK[i]] = true;
        if (fs[i].e & 4) pend[CYC[i]] = true;
        if (fs[i].s >= 0) pend[SUM[i]] = ['gandalf', 'luke', 'jotaro'][fs[i].s] || null;
      }
      if (fs[0].h > 0) pend.mash += fs[0].h;   // the Force choke grips P1 — only seat 0 mashes count
      // spent frames are dropped; our OWN seat keeps a trailing 30-tick window so
      // a reconnect resume can re-send anything a drop swallowed — and the HOST
      // keeps EVERY seat's window, because third-party frames only reach a client
      // through the host's relay: on a client's resume the host must be able to
      // refill the other seats' frames too, not just its own (transport
      // bookkeeping only — never read by the sim, so determinism is untouched)
      for (let i = 0; i < netFrames.length; i++) {
        netFrames[i].delete((netIsHost || i === netSeat) ? tick - 30 : tick);
      }
    }
    if (tick % 60 === 0) netChecksum();
  }

  /* intro screen — a proper title scene + character creation (see drawIntroScreen;
     the onKey intro handler owns the row navigation) */
  if (!started) {
    if (netUi) {   // the HOST/JOIN connect screens live where the intro would be
      drawNetScreen();
      drawTrophyToasts();
      hud.innerHTML = '🌐 ONLINE CO-OP<br>Q backs out';
      frame++;
      return;
    }
    drawIntroScreen();
    drawTrophyToasts();
    hud.innerHTML = 'BEST: ' + best + ' · ' +
      (menuTop === 1 ? (subMulti === 0 ? '2-PLAYER' : subMulti === 1 ? '🌐 HOST' : '🌐 JOIN')
                     : (subSingle === 2 ? '☀ DAILY' : subSingle === 1 ? '☠ HARD' : '1-PLAYER')) +
      '<br>double-click icon to quit';
    frame++;
    return;
  }

  /* death animation + game-over screen */
  if (!alive) {
    // the KILL CAM plays first — it advances itself once per loop call (= per
    // tick), and any key skips it; deadT holds so the fall animation still plays
    if (killCam) { drawKillCam(); return; }
    deadT++;
    ctx.clearRect(0, 0, GW, GH);
    if (started && !swActive && !jojoActive && !ianActive) drawBattlefield();
    if (stone) drawStone();
    for (const e of enemies) drawEnemy(e);
    const fall = Math.min(1, deadT / 28);
    heroFigure(player.x, player.y, 0, 'white', player.cls, player.fx >= 0 ? 1 : -1, 1, 1 - fall * 0.4, fall * Math.PI / 2);
    if (coop && p2) heroFigure(p2.x, p2.y, 0, P2_COL, p2.cls, p2.fx >= 0 ? 1 : -1, 1, 1 - fall * 0.4, fall * Math.PI / 2);
    if (deadT > 34) {
      drawDeathScreen();
      hud.innerHTML = replayMode               ? '▶ replay over · Q to return'
                    : netplay                  ? (netIsHost ? '🌐 R — rematch · Q — leave' : '🌐 the host rematches with R · Q — leave')
                    : watchSel                 ? '↑↓ choose a legend · ENTER to watch'
                    : watchErr                 ? '▶ ' + watchErr + ' · R to play'
                    : lbState === 'enter'      ? 'type your name · ENTER to submit'
                    : lbState === 'loading'    ? 'reaching the hall of legends…'
                    : lbState === 'submitting' ? 'recording your legend…'
                    : 'press R to play again';
    }
    drawTrophyToasts();   // a trophy earned in the dying beat still shows
    return;
  }

  /* a paused overlay — a boon offer, or the upgrade shop between waves */
  if (paused) {
    if (boonMenu) drawBoonPanel();
    else if (upMenu) drawUpgradePanel();
    else if (shellMenu) drawShellMenu();
    drawTrophyToasts();
    hud.innerHTML = netplay && boonMenu && (boonMenu.who | 0) !== netSeat
      ? '⏳ Player ' + ((boonMenu.who | 0) + 1) + ' is choosing…<br>(everyone picks their OWN boon)'
      : shellMenu ? 'PAUSED — settings<br>↑↓ rows · ◀ ▶ change · P resumes'
      : (boonMenu
        ? (boonMenu.bane ? 'a bane must be borne' : (coop ? 'P' + ((boonMenu.who | 0) + 1) + ' — your boon is offered' : 'a boon is offered')) + '<br>◀ ▶ choose · Z takes it'
        : ((upMenu && upMenu.title) || ('WAVE ' + wave + ' CLEARED')) + '<br>spend tokens · ' + tokens + ' left'
          + (netplay ? '<br>🌐 you both shop · Continue closes it for both' : ''));
    return;
  }

  /* boss intro card / codec entrance — freeze the field, overlay the cutscene */
  // the presentation clock still runs under the intro card (tick already does) —
  // without this, Ian's talking flap freezes mid-plea on his card
  if (bossIntro) { frame++; drawBossIntro(); return; }

  frame++;

  /* ── HIT-STOP: on a heavy impact the whole sim holds its breath for a few
     ticks and falls straight through to the render — the frozen frame IS the
     impact. The feeders above already ran (frames/events keep flowing online),
     pend edges queue up and land when the world unfreezes, and the living
     camera keeps moving over the stillness. Labeled block so the untouched
     gameplay section below needs no re-indentation. ── */
  simStep: {
  if (hitStop > 0) { hitStop--; break simStep; }

  /* per-tick input: queued edge-triggered presses enter the sim only here, on the
     tick boundary (see resetPend) — with the held-key reads just below, this is the
     sim's complete input surface for this tick (the replay/lockstep capture point) */
  if (pend.dashP1) { pend.dashP1 = false; recPush([tick, 1]); tryDash(player); }
  if (pend.atkP1)  { pend.atkP1 = false;  recPush([tick, 2]); tryAttack(player); }
  if (pend.cycleP1) { pend.cycleP1 = false; recPush([tick, 11, 0]); cycleSpell(player); }
  if (coop && p2) {
    if (pend.dashP2) { pend.dashP2 = false; recPush([tick, 3]); tryDash(p2); }
    if (pend.atkP2)  { pend.atkP2 = false;  recPush([tick, 4]); tryAttack(p2); }
    if (pend.cycleP2) { pend.cycleP2 = false; recPush([tick, 11, 1]); p2.cls === 'rider' ? tryBreath(p2) : cycleSpell(p2); }
    if (p3) {   // seats 3/4 exist only online — the recorder is disarmed there
      if (pend.dashP3) { pend.dashP3 = false; tryDash(p3); }
      if (pend.atkP3)  { pend.atkP3 = false;  tryAttack(p3); }
      if (pend.cycleP3) { pend.cycleP3 = false; cycleSpell(p3); }
    }
    if (p4) {
      if (pend.dashP4) { pend.dashP4 = false; tryDash(p4); }
      if (pend.atkP4)  { pend.atkP4 = false;  tryAttack(p4); }
      if (pend.cycleP4) { pend.cycleP4 = false; cycleSpell(p4); }
    }
  } else { pend.dashP2 = false; pend.atkP2 = false; pend.cycleP2 = false; }
  if (pend.summon) {
    const sk = pend.summon; pend.summon = null;
    recPush([tick, 5, ['gandalf', 'luke', 'jotaro'].indexOf(sk)]);
    trySummon(sk);
  }
  if (pend.summon2) {   // netplay only — the joiners' summons, after the host's, in seat order (deterministic meter spend)
    const sk = pend.summon2; pend.summon2 = null;
    trySummon(sk);
  }
  if (pend.summon3) { const sk = pend.summon3; pend.summon3 = null; trySummon(sk); }
  if (pend.summon4) { const sk = pend.summon4; pend.summon4 = null; trySummon(sk); }
  if (pend.prompt) { pend.prompt = false; championPrompt(); }   // banner only — not recorded
  if (player.choke <= 0) pend.mash = 0;   // mashes only mean anything mid-choke

  /* held-direction sampling — one mask covers every movement source, so it is the
     exact thing the recorder stores and the replayer feeds back.
     bits: 1 ← · 2 → · 4 ↑ · 8 ↓ (arrows) · 16 a · 32 d · 64 w · 128 s (WASD) */
  let im;
  if (replayMode) im = repMask;
  else if (netplay) im = netMask;   // the combined lockstep mask (fed above) — never the live keys
  else {
    im = 0;
    if (keys['ArrowLeft'])  im |= 1;
    if (keys['ArrowRight']) im |= 2;
    if (keys['ArrowUp'])    im |= 4;
    if (keys['ArrowDown'])  im |= 8;
    if (keys['a'] || keys['A']) im |= 16;
    if (keys['d'] || keys['D']) im |= 32;
    if (keys['w'] || keys['W']) im |= 64;
    if (keys['s'] || keys['S']) im |= 128;
    if (im !== recLastM) { recPush([tick, 0, im]); recLastM = im; }
  }

  /* input → acceleration + friction (P1) */
  let ix = 0, iy = 0;
  // P1 always reads the arrow keys; in single-player WASD also drives P1 (the classic
  // dual binding), but in co-op WASD is P2's, so it's excluded from P1 here.
  if ((im & 1) || (!coop && (im & 16))) ix = -1;
  if ((im & 2) || (!coop && (im & 32))) ix =  1;
  if ((im & 4) || (!coop && (im & 64))) iy = -1;
  if ((im & 8) || (!coop && (im & 128))) iy =  1;
  if (ix && iy) { ix *= 0.707; iy *= 0.707; }
  if (ix || iy) { player.fx = ix; player.fy = iy; }
  if (sidFinale || dioFinale || ianActive) { ix = 0; iy = 0; } // input locked — watch the cutscene
  if (dioStopT > 0) { ix = 0; iy = 0; }           // time stopped — you cannot move
  if (player.down) { ix = 0; iy = 0; }            // a fallen hero lies still until revived
  // Force choke: held aloft, input locked — break free by struggling (mashes queue in
  // onKey and are applied here, on the tick)
  if (player.choke > 0) {
    if (pend.mash > 0) { recPush([tick, 6, pend.mash]); player.chokeBreak += pend.mash; player.swingT = 6; sfSfx.saberHit(); pend.mash = 0; }
    ix = 0; iy = 0; player.choke--;
    if (player.chokeBreak >= 3) {                 // struggled free
      player.choke = 0; player.stunT = 0;
      const v = enemies.find(en => en.type === 'vader' && !en.dead);
      if (v) { v.stun = 26; v.mode = 'recover'; v.st = 28; }
      sparks.push({ x: player.x, y: player.y - 26, t: 18, color: '#9ec8ff', txt: 'BREAK FREE!' });
      sfSfx.saberHit();
    } else if (player.choke <= 0) { slayPlayer(); return; }  // never broke loose
    else { player.vy -= 0.35; }                   // lifted off the deck
  } else if (player.stunT > 0) { ix = 0; iy = 0; player.stunT--; }  // Force-push recoil
  moveHero(player, ix, iy);

  /* P2 (co-op only): WASD move, sharing the same physics. P2 is never Force-choked (that's
     P1-only), but a boss can Force-push it (when it's the focused target), and the
     cutscene/time-stop locks freeze it too. */
  if (coop && p2 && !p2.down) {
    let jx = 0, jy = 0;
    if (im & 16)  jx = -1;
    if (im & 32)  jx =  1;
    if (im & 64)  jy = -1;
    if (im & 128) jy =  1;
    if (jx && jy) { jx *= 0.707; jy *= 0.707; }
    if (jx || jy) { p2.fx = jx; p2.fy = jy; }
    if (sidFinale || dioFinale || ianActive || dioStopT > 0) { jx = 0; jy = 0; }
    if (p2.stunT > 0) { jx = 0; jy = 0; p2.stunT--; }   // Force-push recoil carries
    if (p2.cls === 'rider' && p2.mounted && !player.down) {
      // MOUNTED: the rider never steers — the keys above already set the turret
      // aim (p2.fx/fy); the body just rides the saddle. No moveHero at all.
      p2.x = player.x; p2.y = player.y - RIDER_SADDLE;
      p2.vx = 0; p2.vy = 0;
      if (p2.iframe > 0) p2.iframe--;
    } else {
      if (p2.cls === 'rider') p2.mounted = false;   // the wyrm fell — thrown to your feet
      moveHero(p2, jx, jy);
      // an unhorsed rider REMOUNTS by reaching the living wyrm (the revive verb's twin)
      if (p2.cls === 'rider' && !p2.mounted && !player.down && player.cls === 'wyrm' &&
          Math.hypot(p2.x - player.x, p2.y - player.y) < up.remountR) {
        p2.mounted = true;
        sparks.push({ x: player.x, y: player.y - 40, t: 14, color: DRAGOON_COL, txt: 'MOUNTED' });
      }
    }
  }

  /* seats 3 and 4 (online war band only): the same physics, masks straight from
     the lockstep frames — no local keys, no mounted-rider special cases */
  for (const [hx, mi] of [[p3, 2], [p4, 3]]) {
    if (!hx || hx.down) continue;
    let kx = 0, ky = 0;
    const hm = netMasks[mi];
    if (hm & 1) kx = -1;
    if (hm & 2) kx = 1;
    if (hm & 4) ky = -1;
    if (hm & 8) ky = 1;
    if (kx && ky) { kx *= 0.707; ky *= 0.707; }
    if (kx || ky) { hx.fx = kx; hx.fy = ky; }
    if (sidFinale || dioFinale || ianActive || dioStopT > 0) { kx = 0; ky = 0; }
    if (hx.stunT > 0) { kx = 0; ky = 0; hx.stunT--; }
    moveHero(hx, kx, ky);
  }

  /* the dragoon's lance rides its velocity — the joust resolves right after movement
     and BEFORE the contact loop below, so a skewer lands before the body would.
     The wyrm tramples by the identical rules (and feeds the heat gauge). */
  for (const h of heroesLive()) if (h.cls === 'dragoon' || h.cls === 'wyrm') joustSweep(h);

  /* reviving a downed partner: stand close to one and a ring fills; let go and it drains */
  if (coop && p2) {
    for (const h of heroesAll()) {
      if (!h.down) continue;
      const helper = heroesLive().find(o => Math.hypot(o.x - h.x, o.y - h.y) < 34);
      if (helper) { if (++h.reviveT >= reviveNeed()) reviveHero(h); }
      else h.reviveT = Math.max(0, h.reviveT - 1);
    }
  }

  /* waves: the next one only begins once the field is cleared */
  if (breatherT > 0) {
    if (--breatherT === 0) {
      wave++;
      if (wave >= 5) sfUnlock('wave_5');
      if (wave >= 4 && player.cls === 'wyrm') sfUnlock('pair_bond');
      if (wave >= 10) sfUnlock('wave_10');
      if (wave >= 15) sfUnlock('deep_15');
      if (hardMode && wave >= 5) sfUnlock('hard_5');
      if (wave >= 6 && runFlawless) sfUnlock('unscathed');       // five waves, not one blow landed
      if (wave >= 5 && tick <= 3 * 60 * SIM_HZ) sfUnlock('swift'); // tick-based, so replays agree
      waveQuota = Math.min(30 + 10 * (partySize() - 1), bandScale(8 + wave * 3));
      if (up.shield) for (const h of heroesAll()) h.shield = true;   // the Aegis recharges for every hero at the dawn of each wave
      banner = 'WAVE ' + wave;
      bannerSub = { 2: 'the wolves are loosed', 3: 'skeleton archers nock their arrows', 4: 'the trolls have come' }[wave] || '';
      bannerT = 90;
      sfSfx.wave();
      if (wave === 3 && !ogreSpawned) {             // a war-ogre lumbers in alongside the wave-3 band
        ogreSpawned = true;
        const op = edgePoint();
        warns.push({ x: op.x, y: op.y, type: 'ogre', t: 75 });   // a longer telegraph for the brute
        bannerSub = 'a WAR-OGRE lumbers from the dark'; bannerT = 120;
      }
      if (wave === 5 && !nineDone) summonTheNine();  // the Nazgûl set piece
    }
  } else if (waveQuota <= 0 && enemies.length === 0 && warns.length === 0
             && !nineActive && !bossActive && bossRiseT <= 0
             && !awaitExit && !swActive && swFadeT <= 0 && !jojoActive && jojoCue <= 0
             && !ianActive && ianCue <= 0) {
    if (wave === 5) breatherT = BREATHER;  // wave 5's send-off comes from the Witch-king fight
    else offerUpgrade();                   // every other cleared wave → pick an upgrade
  }

  /* the eastward escape → a cut to the Star Wars corridor */
  if (awaitExit && player.x > GW - 24) { awaitExit = false; swFadeT = FADE_LEN; }
  if (swFadeT > 0 && --swFadeT === Math.floor(FADE_LEN / 2)) startStarWars();
  if (swActive) {
    if (swState === 'march' && !enemies.some(e => e.type === 'trooper' && e.mode === 'march')) {
      swState = 'ready'; swReadyT = 40;
      banner = 'FORMATION SET'; bannerSub = 'they take aim...'; bannerT = 80;
    } else if (swState === 'ready' && --swReadyT <= 0) {
      swState = 'fire'; banner = 'OPEN FIRE'; bannerSub = ''; bannerT = 70; sfSfx.blaster();
    }
    if (swTroopersLeft <= 0 && !vaderActive && swState === 'fire') {
      // the squad is down — the dark lord himself steps from the shadows
      vaderActive = true; swState = 'vader'; arrows = [];
      beginBossIntro('vader', () => {
        banishAllies();                          // the duel is his alone
        const vx = player.x < GW / 2 ? GW - 70 : 70;   // step from the far side, never on top of the player
        enemies.push(makeEnemy('vader', vx, GH / 2));
        banner = 'DARTH VADER'; bannerSub = 'the dark lord bars your path'; bannerT = 150;
        score += 500; addMeter(30);
        sfSfx.saber();
      });
    }
    // Vader has fallen, the upgrade is spent — the Emperor steps from the dark
    if (sidiousCue > 0 && --sidiousCue === 0) beginBossIntro('sidious', startSidious);
    // the Emperor's reveal: monologue plays, then the duel begins
    if (sidiousIntroT > 0 && --sidiousIntroT === 0) {
      banner = 'so be it'; bannerSub = '— Darth Sidious'; bannerT = 90;
      shake = 14; ltnFlash = Math.max(ltnFlash, 18); sfSfx.zap();
    }
    if (sidFinale) advanceSidiousFinale();           // the death cutscene plays out
  }

  if (dlg.length) {                                  // scripted dialogue queue (Sidious reveal, DIO's taunts)
    if (dlgT > 0) dlgT--;
    else { const ln = dlg.shift(); banner = ln.txt; bannerSub = ln.sub; bannerT = ln.hold; dlgT = ln.gap; }
  }

  /* the JoJo interlude: a stranger steps out of the dark once the Emperor is gone */
  if (jojoCue > 0 && --jojoCue === 0) beginBossIntro('dio', startJojo);
  if (dioFinale) advanceDioFinale();             // DIO's slow crumble plays out
  if (dioStopFx > 0) dioStopFx--;

  /* the final confrontation: the creator kneels once DIO is dust */
  if (ianCue > 0 && --ianCue === 0) beginBossIntro('ian', startIan);
  if (ianActive) {
    if (ianFinale) advanceIanFinale();
    else if (!ianChoice) {                 // a short beat after the card, then present the choice
      if (dlgT > 0) dlgT--;
      else ianChoice = { sel: 0, t: 0 };
    }
  }

  /* one of the fallen wraiths rises as the Witch-king of Angmar */
  if (bossRiseT > 0 && --bossRiseT === 0) {
    beginBossIntro('witchking', () => {
      enemies.push(makeEnemy('witchking', bossRiseX, bossRiseY));
      banner = 'the Witch-king of Angmar'; bannerSub = 'no living man may hinder him'; bannerT = 150;
      sfSfx.screech(); shake = 16;
    });
  }

  /* spawn warnings → enemies (each wave is a fixed war band) */
  const band = partySize() - 1;   // extra fighters bring a denser, faster horde
  const spawnEvery = Math.max(Math.max(14, 24 - band * 3), 92 - wave * 8 - band * 10);
  const maxFoes = Math.min(26 + band * 4, 7 + wave * 3 + band * 2);
  if (!nineActive && !awaitExit && !swActive && swFadeT <= 0 && breatherT <= 0 && !ianActive && ianCue <= 0 && waveQuota > 0 && frame > 50 && frame % spawnEvery === 0 && enemies.length + warns.length < maxFoes) {
    const p = edgePoint();
    warns.push({ x: p.x, y: p.y, type: rollType(), elite: rollElite(), t: 45 });
    waveQuota--;
  }
  for (let i = warns.length - 1; i >= 0; i--) {
    const w = warns[i];
    if (--w.t <= 0) { enemies.push(makeEnemy(w.type, w.x, w.y, w.elite)); warns.splice(i, 1); }
  }

  /* pickups */
  if (frame % 200 === 0 && coins.length < 3) {
    const p = farPoint(50);
    coins.push({ x: p.x, y: p.y, t: 620 });
  }
  if (frame > 800 && frame % 660 === 0 && powerups.length < 1 && !ianActive && !mournful && !jojoActive) {
    const p = farPoint(70);
    powerups.push({ x: p.x, y: p.y, kind: ['freeze', 'fire', 'bolt'][Math.floor(rnd() * 3)], t: 700 });
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const ck = coins[i];
    if (--ck.t <= 0) { coins.splice(i, 1); continue; }
    if (nearHero(ck.x, ck.y, 22)) {
      coins.splice(i, 1);
      mult = Math.min(6, mult + 1);
      score += 40 + (bn.gold ? 25 : 0);
      addMeter(bn.miser ? 0 : bn.gold ? 10 : 5);   // Miser's Curse starves the meter
      sfSfx.coin();
      sparks.push({ x: ck.x, y: ck.y, t: 20, color: '#ffd24d', txt: 'x' + mult });
    }
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    if (--pu.t <= 0) { powerups.splice(i, 1); continue; }
    const ph = nearHero(pu.x, pu.y, 24);   // the hero who grabbed it — blasts erupt from them
    if (ph) {
      powerups.splice(i, 1);
      if (pu.kind === 'freeze') {
        // frost nova — a ring of ice snaps out and encases only the foes it reaches
        sfSfx.freeze();
        fieldWashSet('130,200,255', 0.16, 45); addDecal(ph.x, ph.y, 'frost');   // (render-only)
        blasts.push({ kind: 'frost', x: ph.x, y: ph.y, r: 0, t: 0, life: 26 });
        let n = 0;
        for (const e of enemies) {
          // the great bosses shrug off the cold; everything else freezes solid
          if (isGreatBoss(e)) continue;
          if (Math.hypot(e.x - ph.x, e.y - ph.y) < FROST_R) { e.frozen = FROST_DUR; e.vx = 0; e.vy = 0; n++; }
        }
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#8fd8ff', txt: n ? 'FROZEN x' + n : 'frost nova' });
      } else if (pu.kind === 'fire') {
        // fireball — a billowing wall of flame erupts and engulfs the nearby mob
        sfSfx.bomb(); shake = 16;
        fieldWashSet('255,120,40', 0.18, 50); addDecal(ph.x, ph.y, 'scorch');   // (render-only)
        blasts.push({ kind: 'fire', x: ph.x, y: ph.y, r: 0, t: 0, life: 30 });
        knockback(ph.x, ph.y, FIRE_R, 220, 50);
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#ff8a65', txt: 'FWOOSH' });
      } else {
        // chain lightning — a bolt leaps from foe to foe, frying the whole chain
        sfSfx.zap(); shake = 10;
        const pts = [{ x: ph.x, y: ph.y - 16 }];
        const hit = new Set();
        let from = { x: ph.x, y: ph.y }, hops = 0;
        for (let j = 0; j < 6; j++) {                 // up to 6 jumps, each reaching ~260px
          let best = null, bestD = 260;
          for (const e of enemies) {
            if (e.dead || hit.has(e)) continue;
            // the great bosses are too mighty to be chained — grunts only
            if (isGreatBoss(e)) continue;
            const dd = Math.hypot(e.x - from.x, e.y - from.y);
            if (dd < bestD) { bestD = dd; best = e; }
          }
          if (!best) break;
          hit.add(best); hops++;
          pts.push({ x: best.x, y: best.y - 14 });
          from = best;
          const dmg = best.type === 'troll' ? 3 : best.type === 'ogre' ? 4 : 99;
          if (!best.hp || (best.hp -= dmg) <= 0) killEnemy(best);
          else { best.stun = Math.max(best.stun || 0, 26); sparks.push({ x: best.x, y: best.y - 30, t: 16, color: '#b3e5fc', txt: '⚡' }); }
        }
        enemies = enemies.filter(e => !e.dead);
        fieldWashSet('170,130,255', 0.16, 45);   // (render-only) the field strobes violet — one eased lift
        blasts.push({ kind: 'chain', pts, t: 0, life: 18 });
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#80d8ff', txt: hops ? 'CHAIN x' + hops : 'ZAP' });
      }
    }
  }
  // animate the active blasts: grow fire/frost fronts (embers, ice motes) or crackle the chain
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t++;
    if (b.kind === 'fire' || b.kind === 'frost') {
      const grow = b.rMax || (b.kind === 'fire' ? FIRE_R : FROST_R);  // caster spells are tighter than the powerups
      b.r = grow * Math.min(1, b.t / (b.kind === 'fire' ? 12 : 9));
      if (b.t % 2 === 0) {
        // rolls consumed even under reduced motion — settings must not shift the RNG stream
        const ang = rnd() * Math.PI * 2, rr = b.r * (0.7 + rnd() * 0.35), hot = rnd() < 0.5;
        if (!api.reduceMotion) {
          if (b.kind === 'fire')
            sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 16, color: hot ? '#ffb74d' : '#ff7043', txt: '✦' });
          else
            sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 18, color: '#b3e5fc', txt: '❄' });
        }
      }
    } else if (b.kind === 'chain' && b.t % 2 === 0 && b.pts.length > 1) {
      const seg = b.pts[Math.floor(rnd() * (b.pts.length - 1)) + 1];
      const ox = rnd() * 16 - 8, oy = rnd() * 16 - 8;
      if (!api.reduceMotion) sparks.push({ x: seg.x + ox, y: seg.y + oy, t: 12, color: '#cff3ff', txt: '·' });
    }
    if (b.t >= b.life) blasts.splice(i, 1);
  }
  if (freezeT > 0) freezeT--;

  /* the sword in the stone (never during the Star Wars / JoJo interludes) */
  if (!swActive && !jojoActive && jojoCue <= 0 && !awaitExit && swFadeT <= 0 && !ianActive && ianCue <= 0 && !stone && heroesLive().some(h => h.cls === 'melee' && h.swordT <= 0 && !h.heldSaber) && --stoneCd <= 0) {
    const p = farPoint(80);
    stone = { x: p.x, y: p.y };
    if (!stoneSeen) {
      stoneSeen = true;
      banner = 'a sword in a stone...'; bannerSub = 'run to it and claim your destiny'; bannerT = 110;
    } else {
      sparks.push({ x: p.x, y: p.y - 40, t: 30, color: '#eceff1', txt: 'the sword returns' });
    }
  }
  // only a melee hero who isn't already holding a blade can pull the sword (it's theirs alone)
  const stoneGrabber = stone ? heroesLive().find(h => h.cls === 'melee' && !h.heldSaber && h.swordT <= 0 && Math.hypot(h.x - stone.x, h.y - stone.y) < PULL_R) : null;
  if (stoneGrabber) {
    stone = null; stoneCd = 150;   // a beat before the next stone (lets a co-op partner arm too, but not instantly)
    sfUnlock('excalibur');
    stoneGrabber.swordT = Math.round(SWORD_T * up.swordMul);   // Keen Edge holds the blade longer
    fieldWashSet('255,200,80', 0.2, 60);   // (render-only) the pull washes the whole field gold
    banner = '⚔ EXCALIBUR ⚔'; bannerSub = 'X — swing the blade'; bannerT = 100;
    sfSfx.sword(); shake = 8;
    knockback(stoneGrabber.x, stoneGrabber.y, 0, 0, 30);  // a stunned beat — nobody moves, nobody is shoved
  }
  // each hero's Excalibur counts down on its own; when one fades, queue a fresh stone
  for (const h of heroesAll()) {
    if (h.swordT > 0 && --h.swordT === 0) {
      stoneCd = 300;
      sparks.push({ x: h.x, y: h.y - 46, t: 30, color: '#eceff1', txt: 'the blade fades...' });
    }
  }
  /* the blue lightsaber on the corridor deck — claimed by whichever melee hero reaches it */
  const saberGrabber = saberPickup ? heroesLive().find(h => h.cls === 'melee' && !h.heldSaber && Math.hypot(h.x - saberPickup.x, h.y - saberPickup.y) < PULL_R) : null;
  if (saberGrabber) {
    saberPickup = null; saberGrabber.heldSaber = true;
    banner = 'A LIGHTSABER'; bannerSub = 'X — strike them down'; bannerT = 110;
    sfSfx.saber(); shake = 6;
  }
  for (const h of heroesAll()) if (h.swingT > 0) h.swingT--;

  /* the caster's clock: the well refills a sip per tick (kills top it up in
     resolveCast — see soul sparks), and pending incantations resolve */
  if (!sidFinale && !dioFinale && dioStopT <= 0 && !ianActive) {
    for (const h of heroesLive()) {
      if (h.cls !== 'caster') continue;
      // the well holds its breath for MANA_HOLD ticks after every cast — the
      // trickle only flows in the spaces BETWEEN casts (kill sparks still land)
      if (tick >= (h.manaHoldTick || 0)) h.mana = Math.min(up.manaMax, h.mana + MANA_REGEN * up.manaRegen);
      if (h.castT > 0 && --h.castT === 0) resolveCast(h);
    }
  }

  /* the necromancer's dead: husks crumble on their timers; minions hunt the
     horde, claw it (rangedHit rules), soak contact in return, and fall when
     their hp or time runs out. Boss rooms banish the lot, like champions. */
  if (champsBanned()) {
    if (minions.length || husks.length) {
      if (minions.length) sparks.push({ x: player.x, y: player.y - 46, t: 28, color: NECRO_COL, txt: 'your dead abandon you' });
      minions = []; husks = [];
    }
  } else if (!sidFinale && !dioFinale && dioStopT <= 0) {
    for (let i = husks.length - 1; i >= 0; i--) if (--husks[i].t <= 0) husks.splice(i, 1);
    for (let i = minions.length - 1; i >= 0; i--) {
      const m = minions[i];
      m.t--;
      if (m.hitCd > 0) m.hitCd--;
      if (m.hurtCd > 0) m.hurtCd--;
      if (m.shotCd > 0) m.shotCd--;
      if (m.t <= 0 || m.hp <= 0) {
        if (up.minionBoom) {                       // Deathburst — soul-fire on the way out
          blasts.push({ kind: 'frost', x: m.x, y: m.y, r: 0, t: 0, life: 18, rMax: 62 });
          knockback(m.x, m.y, 58, 90, 24);
          sfSfx.freeze();
        }
        sparks.push({ x: m.x, y: m.y - 24, t: 14, color: NECRO_COL, txt: '…' });
        minions.splice(i, 1); continue;
      }
      // hunt the nearest of the horde (support pieces are fair game; bosses are not its business)
      let prey = null, pd = 1e9;
      for (const e of enemies) {
        if (e.dead || untouchable(e)) continue;
        const t2 = e.type;
        if (!(t2 === 'goblin' || t2 === 'wolf' || t2 === 'archer' || t2 === 'troll' || t2 === 'shaman' || t2 === 'bomber' || t2 === 'ogre')) continue;
        const dd = Math.hypot(e.x - m.x, e.y - m.y);
        if (dd < pd) { pd = dd; prey = e; }
      }
      if (prey) {
        const dx = prey.x - m.x, dy = prey.y - m.y, d = pd || 1;
        const lope = up.trueForms && m.src === 'wolf' ? 2.3 : 1.55;   // True Forms: wolves remember how to run
        if (d > prey.kr + 10) { m.x += dx / d * lope; m.y += dy / d * lope; m.phase += 0.16; m.fx = dx / d || 1; }
        if (d < prey.kr + 16 && m.hitCd <= 0) {                        // claw the mark
          m.hitCd = 42;
          const k0 = kills;
          rangedHit(prey, up.minionDmg, dx / d, dy / d);
          if (kills > k0) {                                            // a minion's kill still feeds the master
            const boss = heroesLive().find(hh => hh.cls === 'necro');
            if (boss) boss.souls = Math.min(SOULS_MAX, boss.souls + (SOUL_MKILL + boss.bn.soulBonus) * (kills - k0));
          }
        }
        if (up.trueForms && m.src === 'archer' && m.shotCd <= 0 && d > 60 && d < 340) {
          m.shotCd = 105;                                              // spectral arrow — hero-safe, horde-lethal
          arrows.push({ x: m.x, y: m.y - 16, kind: 'parrow', vx: dx / d * 4.4, vy: dy / d * 4.4, t: 130, dmg: 1, pierce: 0, bounces: 0, hitSet: null });
          sfSfx.arrow();
        }
      } else {                                                         // no prey — shamble home to the master
        const necro = heroesLive().find(hh => hh.cls === 'necro') || player;
        const dx = necro.x - m.x, dy = necro.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d > 60) { m.x += dx / d * 1.3; m.y += dy / d * 1.3; m.phase += 0.12; m.fx = dx / d || 1; }
        else m.phase += 0.05;
      }
      // the horde claws back — a grunt pressing on the minion wounds it
      if (m.hurtCd <= 0) {
        for (const e of enemies) {
          if (e.dead || e.frozen > 0 || e.stun > 0 || untouchable(e) || !(e.kr > 0)) continue;
          if (Math.hypot(e.x - m.x, e.y - m.y) < e.kr + 10) {
            m.hp--; m.hurtCd = 50;
            const bx = m.x - e.x, by = m.y - e.y, bd = Math.hypot(bx, by) || 1;
            m.x = clamp(m.x + bx / bd * 26, 14, GW - 14); m.y = clamp(m.y + by / bd * 26, 44, GH - 12);
            sparks.push({ x: m.x, y: m.y - 22, t: 10, color: '#ff8a80', txt: '·' });
            break;
          }
        }
      }
      m.x = clamp(m.x, 14, GW - 14); m.y = clamp(m.y, 44, GH - 12);
    }
  }

  /* the champion */
  if (frame % 90 === 0) addMeter(1);
  if (score >= 10000) sfUnlock('score_10k');
  if (meter >= up.summonCost && !champsBanned() && !meterPrompted && champUnlocked()) {
    meterPrompted = true;
    banner = 'summon an ally'; bannerSub = champReadyText(); bannerT = 150;
  }
  const nearest = (cx, cy, rad) => {
    let bestE = null, bd = rad;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; bestE = e; }
    }
    return bestE;
  };
  for (let ci = allies.length - 1; ci >= 0; ci--) {
    const g = allies[ci];
    g.t--;
    if (g.kind === 'gandalf') {
      const tx = player.x + g.side * 70, ty = player.y;
      g.x += clamp(tx - g.x, -2.6, 2.6);
      g.y += clamp(ty - g.y, -2.6, 2.6);
      if (!g.arrived && Math.hypot(g.x - player.x, g.y - player.y) < 150) {
        g.arrived = true;
        shake = 12; sfSfx.bomb();
        knockback(g.x, g.y, 0, 240, 55);
      }
      if (--g.shotCd <= 0) {
        const t = nearest(g.x, g.y, 1e9);
        if (t) {
          const dx = t.x - g.x, dy = (t.y - 18) - (g.y - 24), d = Math.hypot(dx, dy) || 1;
          bolts.push({ x: g.x, y: g.y - 24, vx: dx / d * 7, vy: dy / d * 7, t: 120 });
          g.shotCd = 32;
          sfSfx.bolt();
        }
      }
    } else if (g.kind === 'luke') {
      if (g.slashCd > 0) g.slashCd--;
      if (g.slashT > 0) g.slashT--;
      const LUKE_R = 74, ENGAGE = 54;
      // commit to a foe until it falls or strays from the player — no more thrashing between targets
      if (!g.target || g.target.dead || Math.hypot(g.target.x - player.x, g.target.y - player.y) > 330) {
        g.target = nearest(player.x, player.y, 300);  // guards the player, doesn't roam the map
      }
      const t = g.target;
      if (t && !t.dead) {
        const dx = t.x - g.x, dy = t.y - g.y, d = Math.hypot(dx, dy) || 1;
        g.fx = dx / d; g.fy = dy / d;
        if (d > ENGAGE) { g.x += dx / d * 4.6; g.y += dy / d * 4.6; }   // close to striking range, then hold
        if (d <= LUKE_R && g.slashCd <= 0) {
          g.slashCd = 15; g.slashT = 8;
          sfSfx.saberHit();
          // a sweeping cleave — every foe in a wide arc ahead is cut down at once
          let felled = 0;
          for (const e of enemies) {
            if (e.dead) continue;
            const ex = e.x - g.x, ey = e.y - g.y, ed = Math.hypot(ex, ey) || 1;
            if (ed > LUKE_R + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
            if ((ex / ed) * g.fx + (ey / ed) * g.fy < -0.15) continue;  // ~200° front arc
            if (e.hp && (e.hp -= 2) > 0) { e.stun = 16; sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#aaff66', txt: 'SLASH' }); }
            else { killEnemy(e); felled++; }
          }
          if (felled > 1) sparks.push({ x: g.x, y: g.y - 38, t: 20, color: '#caffa0', txt: felled + ' DOWN' });
        }
      } else {
        const tx = player.x - g.side * 60, ty = player.y;
        g.x += clamp(tx - g.x, -3, 3);
        g.y += clamp(ty - g.y, -3, 3);
      }
      for (let i = arrows.length - 1; i >= 0; i--) {  // the whirling saber bats away bolts
        const a = arrows[i];
        if (a.kind === 'parrow') continue;            // a hero's own arrows fly through
        if (Math.hypot(a.x - g.x, a.y - (g.y - 18)) < 48) {
          sparks.push({ x: a.x, y: a.y, t: 12, color: '#aaff66', txt: '✦' });
          arrows.splice(i, 1);
        }
      }
    } else { // jotaro
      const tx = player.x + g.side * 55, ty = player.y;
      g.x += clamp(tx - g.x, -3, 3);
      g.y += clamp(ty - g.y, -3, 3);
      if (g.oraT > 0) {
        g.oraT--;
        const t = g.target;
        if (!t || t.dead) { g.oraT = 0; g.target = null; }
        else {
          t.stun = 20;
          if (g.oraT % 3 === 0) {
            sfSfx.ora();
            sparks.push({ x: t.x + (rnd() - 0.5) * 26, y: t.y - 14 - rnd() * 22, t: 8, color: '#b39ddb', txt: 'ORA' });
          }
          if (g.oraT === 0) { killEnemy(t); g.target = null; }
        }
      } else if (--g.oraCd <= 0) {
        const t = nearest(g.x, g.y, 190);
        if (t) { g.target = t; g.oraT = 26; g.oraCd = 48; t.stun = 30; }
        else g.oraCd = 10;
      }
    }
    if (g.t <= 0) {
      if (g.kind === 'gandalf' && !swActive) {
        // "fly, you fools" — one final repelling nova as he goes (skipped in the
        // corridor, where a knockback would scramble the trooper formation)
        knockback(g.x, g.y, 0, 190, 40);
        shake = Math.max(shake, 10); sfSfx.bomb();
      }
      const bye = { gandalf: '"fly, you fools!"', luke: '"may the Force be with you."', jotaro: '"yare yare daze."' }[g.kind];
      sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: bye });
      allies.splice(ci, 1);
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.x += b.vx; b.y += b.vy;
    if (--b.t <= 0 || b.x < -20 || b.x > GW + 20 || b.y < -20 || b.y > GH + 20) { bolts.splice(i, 1); continue; }
    for (const e of enemies) {
      if (e.dead) continue;
      if (Math.hypot(b.x - e.x, b.y - (e.y - 18)) < 15) {
        // Gandalf REPELS, he does not slay — a heavy knockdown + shove buys you
        // the space; the kill (and its score and meter) stays yours
        if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
          e.stun = Math.max(e.stun || 0, 6);          // the no-flinch set barely notices
        } else if (e.type === 'trooper') {
          e.stun = Math.max(e.stun || 0, 20);         // staggered, but formation holds
        } else {
          const dv = Math.hypot(b.vx, b.vy) || 1;
          e.stun = Math.max(e.stun || 0, 42);
          e.x = clamp(e.x + b.vx / dv * 34, -60, GW + 60);
          e.y = clamp(e.y + b.vy / dv * 34, -60, GH + 60);
          e.vx = 0; e.vy = 0;
          sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#bbdefb', txt: 'REPELLED' });
        }
        sfSfx.thud();
        bolts.splice(i, 1);
        break;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);

  /* enemies: move, graze, kill */
  for (const e of enemies) {
    updateEnemy(e);
    if (e.type === 'ian' || mournful) continue;  // the creator & a grieving world cannot harm you
    if (e.type === 'shaman' || e.type === 'bomber') continue;  // support pieces never touch you — their horde (and kegs) do
    // shared "this foe is harmless right now" gates (independent of which hero)
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;  // harmless during the reveal
    if (e.type === 'vader' && e.intro > 0) continue;   // harmless as he steps from the shadows
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;   // intro & death are harmless
    if (dioStopT > 0) continue;                // time is stopped — you cannot be touched (nor can you act)
    if (e.frozen > 0) continue;                // an iced foe is harmless — wail on it freely
    // every standing hero is tested against this foe (in co-op the boss arcs can fell either)
    for (const h of heroesLive()) {
      if (h.dashT > 0) continue;               // i-frames: untouchable mid-dash
      // a MOUNTED rider sits above the fray: ground bodies can't touch them (the
      // named boss arcs below still can — archers and flails un-horse riders)
      const inSaddle = h.cls === 'rider' && h.mounted;
      const d = Math.hypot(h.x - e.x, h.y - e.y);
      const bodyR = e.kr + PLAYER_R + (h.cls === 'wyrm' ? WYRM_R : 0);
      if (!inSaddle && d < bodyR) { strike(h); if (!alive) return; continue; }   // bodies overlap → struck
      // the frost wolf chills a hero who brushes close; the DIRE wolf's chill is
      // a full 90px aura (drawn as an icy ring) — no brush needed
      if (!inSaddle && e.elite && e.type === 'wolf' && d < (e.elite === 2 ? 90 : e.kr + PLAYER_R + 26)) {
        if (h.chillT <= 0) sparks.push({ x: h.x, y: h.y - 34, t: 14, color: '#8fd8ff', txt: 'CHILLED' });
        h.chillT = 90;
      }
      if (!inSaddle && d < e.kr + PLAYER_R + 17 && e.grz <= 0) {        // a near miss just past the body
        e.grz = 50; score += 5 * mult;
        addMeter(1);
        sfSfx.graze();
        sparks.push({ x: (h.x + e.x) / 2, y: (h.y + e.y) / 2 - 14, t: 14, color: 'white', txt: '+' + (5 * mult) });
      }
      // the Witch-king's flail reaches well past his body mid-swing
      if (e.type === 'witchking' && !e.mounted && e.mode === 'swing') {
        const fdir = (h.x - e.x) >= 0 ? 1 : -1;
        const fx = e.x + fdir * Math.cos(e.flailAng) * 64;
        const fy = e.y - 32 + Math.sin(e.flailAng) * 64 * 0.7;
        if (Math.hypot(h.x - fx, (h.y - 18) - fy) < 26) { strike(h); if (!alive) return; continue; }
      }
      // Vader's saber sweeps a lethal arc out front during the slash
      if (e.type === 'vader' && e.mode === 'slash') {
        const tx = e.x + Math.cos(e.slashAng) * 56;
        const ty = (e.y - 22) + Math.sin(e.slashAng) * 56;
        if (Math.hypot(h.x - tx, (h.y - 18) - ty) < 24) { strike(h); if (!alive) return; continue; }
      }
      // DIO's MUDA barrage — The World pummels a lethal ring around him
      if (e.type === 'dio' && e.mode === 'muda' && d < 54) { strike(h); if (!alive) return; continue; }
      // Sidious' twin sabers carve a lethal ring while he spins
      if (e.type === 'sidious' && e.mode === 'spin' && d < 46) { strike(h); if (!alive) return; continue; }
      // Force lightning: a lethal corridor along the aim while it crackles
      if (e.type === 'sidious' && e.mode === 'lightning') {
        const ox = e.x, oy = e.y - 24;
        const px = h.x - ox, py = (h.y - 18) - oy;
        const proj = px * e.lx + py * e.ly;
        if (proj > 18 && proj < 470 && Math.abs(px * -e.ly + py * e.lx) < (e.lethalW || 18)) { strike(h); if (!alive) return; continue; }
      }
    }
  }

  /* the road roller: hovers into place during stopped time, then slams its zone on resume */
  if (roadRoller) {
    updateRoadRoller();
    const rr = roadRoller;   // lethal only as it lands (not the whole fall), and only inside the telegraphed ellipse
    if (rr && rr.phase === 'impact' && rr.t < 16) {
      for (const h of heroesLive()) {
        if (h.dashT <= 0 && ((h.x - rr.zoneX) / 46) ** 2 + ((h.y - rr.zoneY) / 17) ** 2 < 1) { strike(h); if (!alive) return; }
      }
    }
  }

  /* powder kegs: ballistic lobs — the landing ring is telegraphed from launch,
     and the blast spares nobody (heroes through strike(); the horde takes 2) */
  for (let i = kegs.length - 1; i >= 0; i--) {
    const k = kegs[i];
    k.t++;
    if (k.t < k.T) continue;
    kegs.splice(i, 1);
    sfSfx.bomb(); shake = Math.max(shake, 8);
    blasts.push({ kind: 'fire', x: k.tx, y: k.ty, r: 0, t: 0, life: 22, rMax: KEG_R + 14 });
    addDecal(k.tx, k.ty, 'scorch');   // (render-only) the ground remembers
    sparks.push({ x: k.tx, y: k.ty - 12, t: 16, color: '#ff8a65', txt: 'BOOM' });
    for (const h of heroesLive()) {
      if (h.dashT > 0) continue;                 // i-frames clear the blast
      if (Math.hypot(h.x - k.tx, (h.y - 10) - k.ty) < KEG_R) { strike(h); if (!alive) return; }
    }
    // the shrapnel reaches the horde well past the core (a pursuer walks ~72px
    // during the keg's flight — a tight radius would never touch a moving pack,
    // and baiting shots into the horde is the whole point of friendly fire)
    for (const e2 of enemies) {
      if (untouchable(e2)) continue;
      if (Math.hypot(e2.x - k.tx, e2.y - k.ty) < KEG_R + 34) {
        if (e2.hp && (e2.hp -= 2) > 0) {
          e2.stun = Math.max(e2.stun || 0, 16);
          sparks.push({ x: e2.x, y: e2.y - 30, t: 12, color: '#ffb74d', txt: 'SCORCHED' });
        } else {
          if (e2.type === 'shaman') sfUnlock('hoisted');   // its own artillery got it
          killEnemy(e2);
        }
      }
    }
    enemies = enemies.filter(e2 => !e2.dead);
  }

  /* arrows */
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (dioStopT > 0) continue;                // knives hang in stopped time
    a.x += a.vx; a.y += a.vy;
    // Ricochet: a player arrow with a bounce left banks off the screen edge
    if (a.kind === 'parrow' && a.bounces > 0 && (a.x < 8 || a.x > GW - 8 || a.y < 30 || a.y > GH - 8)) {
      a.bounces--;
      if (a.x < 8 || a.x > GW - 8) a.vx = -a.vx;
      if (a.y < 30 || a.y > GH - 8) a.vy = -a.vy;
      a.x = clamp(a.x, 8, GW - 8); a.y = clamp(a.y, 30, GH - 8);
      sparks.push({ x: a.x, y: a.y, t: 10, color: '#c5e1a5', txt: '✦' });
    }
    // Vader's thrown saber is exempt from the cull: its own branch below owns its
    // lifecycle (out → home → caught), and losing it off-screen would strand him
    // disarmed with the blade never returning
    if (a.kind !== 'vsaber' && (--a.t <= 0 || a.x < -20 || a.x > GW + 20 || a.y < -20 || a.y > GH + 20)) { arrows.splice(i, 1); continue; }
    if (a.reflected) {
      // a bolt you deflected — harmless to you, kills any trooper it strikes
      let struck = false;
      const before = arrows;      // a boss kill inside killEnemy resets arrows[] wholesale
      for (const e of enemies) {
        if (e.dead) continue;
        if (Math.hypot(a.x - e.x, a.y - (e.y - 14)) < 15) {
          if (!e.hp || --e.hp <= 0) killEnemy(e); else e.stun = 10;
          struck = true; break;
        }
      }
      if (arrows !== before) break;   // the field was swept — stop iterating the stale array
      if (struck) arrows.splice(i, 1);
      continue;  // never harms the player
    }
    if (a.kind === 'parrow') {
      // a hero's arrow — harmless to heroes, strikes the first foe in its path
      let spent = false;
      const before = arrows;      // killing Vader/Sidious/DIO resets arrows[] wholesale
      for (const e of enemies) {
        if (untouchable(e) || (a.hitSet && a.hitSet.has(e))) continue;
        if (Math.hypot(a.x - e.x, a.y - (e.y - 14)) < (e.type === 'troll' || e.type === 'ogre' ? 20 : 15)) {
          (a.hitSet || (a.hitSet = new Set())).add(e);   // a piercing arrow never re-hits the same foe
          const dv = Math.hypot(a.vx, a.vy) || 1;
          rangedHit(e, a.dmg, a.vx / dv, a.vy / dv);
          if (a.pierce > 0) a.pierce--; else spent = true;
          break;
        }
      }
      if (arrows !== before) break;   // the field was swept — stop iterating the stale array
      if (spent) arrows.splice(i, 1);
      continue;
    }
    if (a.kind === 'vsaber') {                         // Vader's thrown saber: out, then home back to him
      a.spin += 0.6;
      if (!a.returning) {
        a.travelled += Math.hypot(a.vx, a.vy);
        if (a.travelled > a.range) a.returning = true;
      } else {
        const v = enemies.find(en => en.type === 'vader' && !en.dead);
        if (!v) { arrows.splice(i, 1); continue; }
        const hx = v.x - a.x, hy = (v.y - 22) - a.y, hd = Math.hypot(hx, hy) || 1;
        a.vx = hx / hd * 7.5; a.vy = hy / hd * 7.5;
        if (hd < 18) { arrows.splice(i, 1); continue; }  // caught — Vader re-arms
      }
      for (const h of heroesLive()) { if (h.dashT <= 0 && Math.hypot(a.x - h.x, a.y - (h.y - 18)) < 14) { strike(h); if (!alive) return; } }
      continue;
    }
    for (const h of heroesLive()) { if (h.dashT <= 0 && Math.hypot(a.x - h.x, a.y - (h.y - 18)) < 10) { strike(h); if (!alive) return; break; } }
  }

  /* passive score */
  if (frame % 60 === 0) score += 10 * mult;

  /* stopped time ticks down last, so the whole frame agrees it is stopped */
  if (dioStopT > 0 && --dioStopT === 0) { dioStopFx = 12; sfSfx.zawarudo(); sparks.push({ x: GW / 2, y: 50, t: 18, color: '#fff', txt: 'time resumes' }); }

  }   // ── end simStep (hit-stop falls through to here) ──

  /* the kill cam's ghost tape: one draw-ready snapshot per live tick (clones +
     baked tint so seat colors survive; render bookkeeping only — no sim reads) */
  if (started && alive && !paused && !bossIntro && !boonMenu) {
    camTape.push({
      heroes: heroesAll().map((h) => ({ ...h, tint: heroTint(h) })),
      enemies: enemies.map((e) => ({ ...e })),
    });
    if (camTape.length > CAM_TAPE_MAX) camTape.shift();
  }

  /* ── render ── */
  ctx.clearRect(0, 0, GW, GH);
  camUpdate();
  ctx.save();
  camApply();   // the living camera (render-only; identity under reduced motion)
  if (shake > 0) { shake--; const sx = (rnd() - 0.5) * shake, sy = (rnd() - 0.5) * shake; if (!api.reduceMotion) ctx.translate(sx * sfOpts.shake, sy * sfOpts.shake); }   // rnd ALWAYS drawn (stream!), option scales only the translate

  // ── the battlefield (atmosphere pass): the open field is a painted night
  // world now, not a window onto the desktop — see drawBattlefield. The
  // set-piece rooms below paint their own worlds instead.
  if (started && !swActive && !jojoActive && !ianActive) {
    drawBattlefield();
    drawLightPools();
  }

  if (swActive) {
    // the corridor: black void + a fixed starfield
    ctx.fillStyle = '#04060a'; ctx.fillRect(-30, -30, GW + 60, GH + 60);
    ctx.fillStyle = '#cdd6e0';
    for (const st of swStars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin((frame + st.x) * 0.02));
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (swFlash > 0) {  // a Force surge floods the deck red (steady under reduced motion)
      const a = api.reduceMotion ? 0.16 : 0.30 * (0.55 + 0.45 * Math.abs(Math.sin(frame * 0.5)));
      ctx.fillStyle = 'rgba(122,14,14,' + a.toFixed(3) + ')'; ctx.fillRect(0, 0, GW, GH);
      swFlash--;
    }
    if (ltnFlash > 0) {  // Force-lightning floods the void violet-white (steady under reduced motion)
      const a = api.reduceMotion ? 0.12 : 0.22 * (0.5 + 0.5 * Math.abs(Math.sin(frame * 0.8)));
      ctx.fillStyle = 'rgba(150,110,255,' + a.toFixed(3) + ')'; ctx.fillRect(0, 0, GW, GH);
      ltnFlash--;
    }
  }
  if (jojoActive) {
    // ── DIO's mansion in Cairo: a sandstone arcade under a blood moon (Stardust Crusaders) ──
    const wallH = GH * 0.32;
    // pointed (keyhole) arch subpath helper
    const archSub = (cx, halfW, top, spring, bot) => {
      ctx.moveTo(cx - halfW, bot); ctx.lineTo(cx - halfW, spring);
      ctx.quadraticCurveTo(cx - halfW, top, cx, top);
      ctx.quadraticCurveTo(cx + halfW, top, cx + halfW, spring);
      ctx.lineTo(cx + halfW, bot); ctx.closePath();
    };

    // 1) the night beyond — deep gradient sky behind the arcade
    const g = ctx.createLinearGradient(0, 0, 0, GH);
    g.addColorStop(0, '#1a0e2b'); g.addColorStop(0.5, '#160a1f'); g.addColorStop(1, '#0e0608');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);

    // arcade geometry — moon framed by one of the arches
    const piers = 5, cellW = GW / piers, archHalf = cellW * 0.34;
    const archTop = GH * 0.05, archSpring = GH * 0.18, archBot = wallH - 7;
    const mArch = GW < GH * 1.4 ? 2.5 : 3.5;           // pick a right-of-centre arch for the moon
    const mx = cellW * mArch, my = GH * 0.15;

    // 2) blood moon + manga emphasis rays, seen through the arch (drawn before the wall)
    const rot = api.reduceMotion ? 0.2 : frame * 0.0015;
    const RAYS = 30, RR = Math.hypot(GW, GH);
    ctx.save(); ctx.translate(mx, my);
    for (let i = 0; i < RAYS; i++) {
      const a0 = rot + (i / RAYS) * Math.PI * 2, a1 = a0 + (Math.PI / RAYS);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(168,126,228,0.05)' : 'rgba(232,194,90,0.045)';
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * RR, Math.sin(a0) * RR); ctx.lineTo(Math.cos(a1) * RR, Math.sin(a1) * RR);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 110);
    halo.addColorStop(0, 'rgba(255,228,190,0.26)'); halo.addColorStop(0.5, 'rgba(214,96,96,0.10)'); halo.addColorStop(1, 'rgba(214,96,96,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 110, 0, Math.PI * 2); ctx.fill();
    const moon = ctx.createRadialGradient(mx - 11, my - 11, 4, mx, my, 44);
    moon.addColorStop(0, '#fdf3dc'); moon.addColorStop(0.7, '#ecd0a4'); moon.addColorStop(1, '#c79a72');
    ctx.fillStyle = moon; ctx.beginPath(); ctx.arc(mx, my, 39, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,108,86,0.18)';
    ctx.beginPath(); ctx.arc(mx - 13, my - 5, 6.5, 0, Math.PI * 2); ctx.arc(mx + 11, my + 10, 5, 0, Math.PI * 2); ctx.arc(mx + 4, my - 16, 3.8, 0, Math.PI * 2); ctx.fill();

    // 3) a shaft of moonlight spilling from the moon's arch onto the floor
    if (!api.reduceMotion) {
      const beam = ctx.createLinearGradient(0, archBot, 0, GH);
      beam.addColorStop(0, 'rgba(245,225,180,0.10)'); beam.addColorStop(1, 'rgba(245,225,180,0)');
      ctx.fillStyle = beam; ctx.beginPath();
      ctx.moveTo(mx - archHalf * 0.8, archBot); ctx.lineTo(mx + archHalf * 0.8, archBot);
      ctx.lineTo(mx + archHalf * 1.9, GH); ctx.lineTo(mx - archHalf * 1.9, GH); ctx.closePath(); ctx.fill();
    }

    // 4) the sandstone arcade wall, arch openings punched out with even-odd fill
    const wg = ctx.createLinearGradient(0, 0, 0, wallH);
    wg.addColorStop(0, '#6f5837'); wg.addColorStop(1, '#4d3c25');
    ctx.fillStyle = wg; ctx.beginPath(); ctx.rect(0, 0, GW, wallH);
    for (let i = 0; i < piers; i++) archSub((i + 0.5) * cellW, archHalf, archTop, archSpring, archBot);
    ctx.fill('evenodd');
    // ashlar mortar courses + arch outlines + keystones
    ctx.strokeStyle = 'rgba(36,24,12,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let y = 14; y < wallH - 8; y += 16) { ctx.moveTo(0, y); ctx.lineTo(GW, y); } ctx.stroke();
    ctx.strokeStyle = 'rgba(28,18,8,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < piers; i++) { const cx = (i + 0.5) * cellW; ctx.beginPath(); archSub(cx, archHalf, archTop, archSpring, archBot); ctx.stroke();
      ctx.fillStyle = '#7d6442'; ctx.beginPath(); ctx.moveTo(cx - 6, archTop - 1); ctx.lineTo(cx + 6, archTop - 1); ctx.lineTo(cx + 9, archTop + 13); ctx.lineTo(cx - 9, archTop + 13); ctx.closePath(); ctx.fill(); ctx.stroke(); }

    // 5) cornice + an Egyptian dentil frieze along the wall's base
    ctx.fillStyle = '#5c4830'; ctx.fillRect(0, wallH - 7, GW, 9);
    ctx.fillStyle = '#876b46'; ctx.fillRect(0, wallH - 7, GW, 2);
    ctx.fillStyle = 'rgba(30,20,10,0.55)'; for (let x = 0; x < GW; x += 16) ctx.fillRect(x, wallH - 5, 8, 5);

    // 6) sandstone floor — faint tile grid + warm wash, low contrast so sprites read
    ctx.fillStyle = 'rgba(60,46,28,0.22)'; ctx.fillRect(0, wallH, GW, GH - wallH);
    ctx.strokeStyle = 'rgba(196,164,110,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    const tile = 46;
    for (let x = 0; x <= GW; x += tile) { ctx.moveTo(x, wallH); ctx.lineTo(x, GH); }
    for (let y = wallH; y <= GH; y += tile) { ctx.moveTo(0, y); ctx.lineTo(GW, y); }
    ctx.stroke();

    // 7) two foreground hall pillars framing the arena
    const drawPillar = (cx) => {
      const w = Math.max(13, GW * 0.02), top = wallH - 6;
      const pg = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      pg.addColorStop(0, '#3f3120'); pg.addColorStop(0.5, '#75603f'); pg.addColorStop(1, '#3f3120');
      ctx.fillStyle = pg; ctx.fillRect(cx - w, top, w * 2, GH - top);
      ctx.fillStyle = '#856b46'; ctx.fillRect(cx - w - 4, top - 9, w * 2 + 8, 11);
      ctx.strokeStyle = 'rgba(34,22,10,0.4)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = -2; k <= 2; k++) { ctx.moveTo(cx + k * w * 0.42, top); ctx.lineTo(cx + k * w * 0.42, GH); } ctx.stroke();
    };
    drawPillar(GW * 0.045); drawPillar(GW * 0.955);

    // 8) ben-day halftone dots in opposite corners — manga texture
    ctx.fillStyle = 'rgba(202,166,255,0.06)';
    for (let yy = 0; yy < 96; yy += 12) for (let xx = 0; xx < 120; xx += 12) {
      const r = 2.6 * (1 - xx / 140) * (1 - yy / 120); if (r > 0.3) { ctx.beginPath(); ctx.arc(xx, yy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let yy = GH; yy > GH - 96; yy -= 12) for (let xx = GW; xx > GW - 120; xx -= 12) {
      const r = 2.6 * (1 - (GW - xx) / 140) * (1 - (GH - yy) / 120); if (r > 0.3) { ctx.beginPath(); ctx.arc(xx, yy, r, 0, Math.PI * 2); ctx.fill(); }
    }

    // 9) roaring ゴゴゴ "menacing" onomatopoeia — bold, outlined, drifting up
    ctx.save(); ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    for (const m of jojoBg) {
      if (!api.reduceMotion) m.y += m.vy;
      if (m.y < -34) { m.y = GH + 24; m.x = (m.x * 1.7 + 61) % GW; }  // rnd-free recycle — this branch only runs when motion is on
      ctx.globalAlpha = Math.min(0.32, m.a * 2.4);
      ctx.font = '900 ' + m.s.toFixed(0) + 'px serif';
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(18,7,28,0.95)'; ctx.fillStyle = '#d6bcff';
      ctx.strokeText('ゴ', m.x, m.y); ctx.fillText('ゴ', m.x, m.y);
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  if (ianActive) {
    // the creator's cozy little room — warm gradient, soft moon, twinkles & drifting cute glyphs
    const g = ctx.createLinearGradient(0, 0, 0, GH);
    g.addColorStop(0, '#181233'); g.addColorStop(0.5, '#291c41'); g.addColorStop(1, '#3c243f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);
    const mg = ctx.createRadialGradient(GW * 0.5, GH * 0.30, 8, GW * 0.5, GH * 0.30, GW * 0.55);
    mg.addColorStop(0, 'rgba(255,228,196,0.12)'); mg.addColorStop(1, 'rgba(255,228,196,0)');
    ctx.fillStyle = mg; ctx.fillRect(0, 0, GW, GH);
    for (const m of ianBg) {
      if (m.kind === 'star') {
        ctx.globalAlpha = api.reduceMotion ? 0.6 : 0.35 + 0.45 * Math.abs(Math.sin((frame + m.x) * 0.05));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      } else {
        if (!api.reduceMotion) { m.y += m.vy; m.x += Math.sin((frame + m.ph) * 0.02) * 0.2; }
        if (m.y < -20) { m.y = GH + 16; m.x = (m.x * 1.7 + 53) % GW; }  // rnd-free recycle — this branch only runs when motion is on
        ctx.globalAlpha = m.a; ctx.fillStyle = m.col;
        ctx.font = m.s.toFixed(0) + 'px Tahoma,Arial'; ctx.textAlign = 'center';
        ctx.fillText(m.ch, m.x, m.y);
      }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    // a warm spotlight + glowing floor pad where the creator kneels
    const e = enemies.find(en => en.type === 'ian');
    if (e) {
      const sg = ctx.createRadialGradient(e.x, e.y - 16, 6, e.x, e.y - 16, 150);
      sg.addColorStop(0, 'rgba(255,214,170,0.20)'); sg.addColorStop(1, 'rgba(255,214,170,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, GW, GH);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(frame * 0.08);
      ctx.strokeStyle = 'rgba(255,228,196,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 4, 28, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  if (!swActive && !jojoActive && !ianActive) {
    // the open battlefield is the XP desktop itself — lay a soft vignette over it so the
    // sprites read against the busy wallpaper, plus a faint warm wash low on the ground.
    const vg = ctx.createRadialGradient(GW / 2, GH * 0.46, GH * 0.32, GW / 2, GH * 0.5, GH * 0.95);
    vg.addColorStop(0, 'rgba(6,8,14,0)'); vg.addColorStop(1, 'rgba(6,8,14,0.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    const gw = ctx.createLinearGradient(0, GH * 0.6, 0, GH);
    gw.addColorStop(0, 'rgba(20,14,30,0)'); gw.addColorStop(1, 'rgba(20,14,30,0.22)');
    ctx.fillStyle = gw; ctx.fillRect(0, GH * 0.6, GW, GH * 0.4);
  }

  if (stone) drawStone();
  if (saberPickup) drawSaberPickup();
  for (const c of corpses) drawCorpse(c);
  for (const k of husks) drawHusk(k);       // the necromancer's larder, under the living
  for (const m of minions) drawMinion(m);
  if (bossRiseT > 0) {
    // a fallen body stirs: a dark shape pulls itself upright in a swelling red haze
    const p = clamp(1 - bossRiseT / 90, 0, 1);  // long hold, then rise over the final ~90 frames
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(frame * 0.3));
    ctx.fillStyle = '#7e1f1f';
    ctx.beginPath(); ctx.ellipse(bossRiseX, bossRiseY + 4, 18 + p * 8, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = p;
    ctx.fillStyle = '#0d0a12';
    ctx.beginPath();
    ctx.moveTo(bossRiseX, bossRiseY - 52 * p);
    ctx.lineTo(bossRiseX - 12, bossRiseY + 2);
    ctx.lineTo(bossRiseX + 12, bossRiseY + 2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  for (const ck of coins) {
    if (ck.t < 120 && Math.floor(ck.t / 6) % 2 === 0) continue;  // blink before despawn
    const spin = api.reduceMotion ? 0.82 : Math.abs(Math.cos((frame + (ck.x | 0)) * 0.07));  // edge-on coin flip
    const w = 1.6 + 6.4 * spin;
    ctx.save(); ctx.translate(ck.x, ck.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';                          // contact shadow on the ground
    ctx.beginPath(); ctx.ellipse(0, 11, 6.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    const fg = ctx.createLinearGradient(-w, -8, w, 8);          // struck-metal sheen across the face
    fg.addColorStop(0, '#c8920c'); fg.addColorStop(0.5, '#ffe98a'); fg.addColorStop(1, '#d9a417');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(0, 0, w, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6508'; ctx.lineWidth = 1.5; ctx.stroke();
    if (spin > 0.42) {                                          // ¢ shows only when the coin faces us
      ctx.fillStyle = 'rgba(138,101,8,0.9)'; ctx.font = 'bold 10px Tahoma,Arial'; ctx.textAlign = 'center';
      ctx.fillText('¢', 0, 3.5); ctx.textAlign = 'left';
    }
    ctx.restore();
  }
  for (const pu of powerups) {
    const accent = pu.kind === 'freeze' ? '143,216,255' : pu.kind === 'bolt' ? '128,216,255' : '255,138,101';
    const ac = pu.kind === 'freeze' ? '#8fd8ff' : pu.kind === 'bolt' ? '#80d8ff' : '#ff8a65';
    const pulse = 1 + Math.sin(frame * 0.12) * 0.12;
    ctx.save(); ctx.translate(pu.x, pu.y);
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);    // soft breathing aura
    const ha = (api.reduceMotion ? 0.3 : 0.24 + 0.12 * Math.sin(frame * 0.12));
    halo.addColorStop(0, 'rgba(' + accent + ',' + ha.toFixed(3) + ')'); halo.addColorStop(1, 'rgba(' + accent + ',0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    ctx.scale(pulse, pulse);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + accent + ',0.3)'; ctx.fill();
    ctx.strokeStyle = ac; ctx.lineWidth = 2; ctx.shadowColor = ac; ctx.shadowBlur = 8; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pu.kind === 'freeze' ? '❄' : pu.kind === 'bolt' ? '⚡' : '🔥', 0, 1);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.restore();
    // three motes orbiting the rune
    ctx.save(); ctx.translate(pu.x, pu.y); ctx.fillStyle = ac;
    const rot = api.reduceMotion ? 0 : frame * 0.05;
    for (let s = 0; s < 3; s++) {
      const a = rot + s / 3 * Math.PI * 2;
      ctx.globalAlpha = api.reduceMotion ? 0.6 : 0.4 + 0.4 * Math.abs(Math.sin(frame * 0.1 + s));
      ctx.beginPath(); ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // fire / frost blasts bloom under the enemies so they read as engulfed
  for (const b of blasts) {
    const k = b.t / b.life;                 // 0→1 over the blast's life
    if (b.kind === 'chain') {
      // a forked bolt arcing through every link of the chain
      ctx.save();
      ctx.shadowColor = '#80d8ff'; ctx.shadowBlur = 14; ctx.lineCap = 'round';
      for (let p = 0; p < b.pts.length - 1; p++) {
        const a = b.pts[p], c = b.pts[p + 1];
        ctx.strokeStyle = 'rgba(207,243,255,' + (1 - k) + ')'; ctx.lineWidth = 3.4;
        _ltnArc(a.x, a.y, c.x, c.y, 7, 6, frame * 0.7 + p * 3.1);
        ctx.strokeStyle = 'rgba(128,216,255,' + (0.55 * (1 - k)) + ')'; ctx.lineWidth = 7;
        _ltnArc(a.x, a.y, c.x, c.y, 7, 6, frame * 0.7 + p * 3.1);
      }
      ctx.shadowBlur = 0; ctx.restore();
      continue;
    }
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.kind === 'fire') {
      const g = ctx.createRadialGradient(0, 0, b.r * 0.15, 0, 0, b.r);
      g.addColorStop(0, 'rgba(255,241,170,' + (0.85 * (1 - k)) + ')');
      g.addColorStop(0.45, 'rgba(255,138,64,' + (0.7 * (1 - k)) + ')');
      g.addColorStop(1, 'rgba(183,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      // a few flame tongues licking outward
      ctx.strokeStyle = 'rgba(255,193,120,' + (0.6 * (1 - k)) + ')';
      ctx.lineWidth = 3;
      for (let s = 0; s < 10; s++) {
        const a = s / 10 * Math.PI * 2 + frame * 0.05;
        const r0 = b.r * 0.6, r1 = b.r * (0.9 + Math.sin(frame * 0.3 + s) * 0.1);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
      }
    } else {
      // frost nova: an icy shockwave ring + a soft chill fill
      ctx.fillStyle = 'rgba(143,216,255,' + (0.22 * (1 - k)) + ')';
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(225,245,255,' + (0.9 * (1 - k)) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  for (const w of warns) {
    if (!api.reduceMotion && Math.floor(w.t / 5) % 2 === 0) continue;  // flash (steady when reduced motion)
    ctx.beginPath(); ctx.arc(w.x, w.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,0,0,0.25)'; ctx.fill();
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ff5252'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText('!', w.x, w.y + 5); ctx.textAlign = 'left';
  }
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const g = ghosts[i];
    if (--g.t <= 0) { ghosts.splice(i, 1); continue; }
    heroFigure(g.x, g.y, g.phase, '#80deea', g.cls, g.dir || 1, 1, g.t / 32, 0, 0, true);
  }
  for (const e of enemies) {
    if (e.mode === 'aim' && freezeT <= 0 && e.stun <= 0 && !(e.frozen > 0)) {
      // telegraph: dashed sight line toward the player (orange wolf, bone archer)
      ctx.save();
      ctx.strokeStyle = e.type === 'archer' ? 'rgba(245,245,220,0.6)' : 'rgba(255,152,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y - 18); ctx.lineTo(player.x, player.y - 18); ctx.stroke();
      ctx.restore();
    }
    drawEnemy(e);
  }
  { const boss = enemies.find(e => e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'ogre' || (e.type === 'dio' && e.mode !== 'troll' && e.mode !== 'dying')); if (boss) drawBossBar(boss); }
  // Sidious' Force lightning — telegraph line, then a jagged forked bolt down the locked corridor
  for (const e of enemies) {
    if (e.type !== 'sidious') continue;
    if (e.mode === 'cast') {
      const prog = e.castDur ? clamp(1 - e.st / e.castDur, 0, 1) : 1;
      const ox = e.x, oy = e.y - 24, len = 470;
      const blink = api.reduceMotion ? 1 : (0.5 + 0.5 * Math.abs(Math.sin(frame * (0.15 + prog * 0.45))));
      ctx.save();
      if (e.castKind === 'sweep') {
        // the whole arc the rake will cross lights up as a danger wedge
        const c = e.sweepCenterA, arc = (e.sweepArc || 0.85) / 2, dirS = e.sweepDir || 1;
        ctx.fillStyle = 'rgba(150,110,255,' + (0.04 + prog * 0.14).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, len, c - arc, c + arc); ctx.closePath(); ctx.fill();
        // the two edges
        ctx.globalAlpha = 0.4 + 0.55 * prog * blink;
        ctx.strokeStyle = '#c9a9ff'; ctx.lineWidth = 1.5 + prog * 1.8; ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = api.reduceMotion ? 0 : -frame * 1.5;
        for (const a of [c - arc, c + arc]) { ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len); ctx.stroke(); }
        // a bright leading line previewing the sweep direction — flee the OTHER way
        ctx.setLineDash([]);
        const t = api.reduceMotion ? 0.5 : (frame % 46) / 46;
        const lead = (c - dirS * arc) + dirS * 2 * arc * t;
        ctx.globalAlpha = 0.85; ctx.strokeStyle = '#fff0c0'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(lead) * len, oy + Math.sin(lead) * len); ctx.stroke();
        // a small curved arrow near him showing which way it rakes
        const rIn = 58, aTrail = c - dirS * arc, aLead = c + dirS * arc;
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffe09a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ox, oy, rIn, Math.min(aTrail, aLead), Math.max(aTrail, aLead)); ctx.stroke();
        const hx = ox + Math.cos(aLead) * rIn, hy = oy + Math.sin(aLead) * rIn, tan = aLead + dirS * Math.PI / 2;
        ctx.fillStyle = '#ffe09a';
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(tan) * 6, hy + Math.sin(tan) * 6);
        ctx.lineTo(hx - Math.cos(tan) * 3 + Math.cos(aLead) * 5, hy - Math.sin(tan) * 3 + Math.sin(aLead) * 5);
        ctx.lineTo(hx - Math.cos(tan) * 3 - Math.cos(aLead) * 5, hy - Math.sin(tan) * 3 - Math.sin(aLead) * 5);
        ctx.closePath(); ctx.fill();
      } else {
        const px = -e.ly, py = e.lx, hw = 18;
        // the danger corridor fills in as the charge builds — shows exactly where the bolt will strike
        ctx.fillStyle = 'rgba(150,110,255,' + (0.05 + prog * 0.16).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ox + px * hw, oy + py * hw);
        ctx.lineTo(ox + e.lx * len + px * hw, oy + e.ly * len + py * hw);
        ctx.lineTo(ox + e.lx * len - px * hw, oy + e.ly * len - py * hw);
        ctx.lineTo(ox - px * hw, oy - py * hw);
        ctx.closePath(); ctx.fill();
        // bright dashed centre line, pulsing faster the nearer it is to firing
        ctx.globalAlpha = 0.4 + 0.6 * prog * blink;
        ctx.strokeStyle = '#c9a9ff'; ctx.lineWidth = 1.5 + prog * 2.2;
        ctx.setLineDash([6, 5]); ctx.lineDashOffset = api.reduceMotion ? 0 : -frame * 1.5;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + e.lx * len, oy + e.ly * len); ctx.stroke();
      }
      ctx.restore();
    } else if (e.mode === 'lightning') {
      const ox = e.x, oy = e.y - 24, len = 470, segs = 16;
      const px = -e.ly, py = e.lx, seed = api.reduceMotion ? 7 : frame;
      for (let pass = 0; pass < 2; pass++) {   // wide violet glow, then a bright white core
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = '#9a6cff'; ctx.shadowBlur = pass === 0 ? 16 : 6;
        ctx.strokeStyle = pass === 0 ? 'rgba(150,110,255,0.5)' : '#ffffff';
        ctx.lineWidth = pass === 0 ? 6 : 2;
        ctx.beginPath(); ctx.moveTo(ox, oy);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const j = (Math.sin(seed * 0.7 + s * 2.3) + Math.sin(seed * 0.31 + s * 5.1)) * 11 * (1 - Math.abs(t - 0.5));
          ctx.lineTo(ox + e.lx * len * t + px * j, oy + e.ly * len * t + py * j);
        }
        ctx.stroke(); ctx.restore();
      }
    }
  }
  /* powder kegs: the shrinking landing ring (steady by design — no flashing) and
     the keg itself tumbling along its lobbed arc */
  for (const k of kegs) {
    const p = k.t / k.T;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,82,82,' + (0.35 + p * 0.45).toFixed(2) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(k.tx, k.ty, KEG_R + (1 - p) * 26, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,82,82,' + (0.08 + p * 0.15).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(k.tx, k.ty, KEG_R, 0, Math.PI * 2); ctx.fill();
    const kx = k.sx + (k.tx - k.sx) * p;
    const ky = k.sy + (k.ty - k.sy) * p - Math.sin(p * Math.PI) * 90;
    ctx.translate(kx, ky); ctx.rotate(p * 7);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-5, -7, 10, 14);
    ctx.strokeStyle = '#3e2a17'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-5, -7, 10, 14);
    ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(5, 3); ctx.stroke();
    if (!api.reduceMotion && Math.floor(frame / 3) % 2 === 0) {
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath(); ctx.arc(0, -9, 2, 0, Math.PI * 2); ctx.fill();   // the sputtering fuse
    }
    ctx.restore();
  }
  for (const a of arrows) {
    ctx.save();
    const laser = a.kind === 'laser';
    const d = Math.hypot(a.vx, a.vy) || 1;
    if (a.kind === 'knife') {
      ctx.restore(); drawKnife(a); continue;          // DIO's thrown knives
    } else if (a.kind === 'vsaber') {
      // a spinning red blade — hilt + glowing blade rotating about its centre
      ctx.translate(a.x, a.y); ctx.rotate(a.spin || 0); ctx.lineCap = 'round';
      ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.shadowColor = '#ff4438'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(22, 0); ctx.stroke();
    } else if (laser) {
      // deflected bolts glow saber-blue (yours); incoming bolts are red
      ctx.strokeStyle = a.reflected ? '#bfe7ff' : '#ff3b30'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.shadowColor = a.reflected ? '#5ac8ff' : '#ff6f60'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(a.x - a.vx / d * 14, a.y - a.vy / d * 14); ctx.lineTo(a.x, a.y); ctx.stroke();
    } else {
      // your own arrows fletch green so friend and foe never blur mid-horde
      ctx.strokeStyle = a.kind === 'parrow' ? '#c5e1a5' : '#f5f5dc'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x - a.vx / d * 9, a.y - a.vy / d * 9); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(a.x, a.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  for (const b of bolts) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#bbdefb'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const g of allies) {
    // the champion's remaining window, legible at a glance — plan around it
    if (g.t0) {
      const p = clamp(g.t / g.t0, 0, 1);
      ctx.save();
      ctx.strokeStyle = p < 0.25 ? 'rgba(255,138,101,0.85)' : 'rgba(202,255,160,0.7)';
      ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(g.x, g.y + 7, 13, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawChamp(g);
  }
  if (jojoActive && playerStand > 0.05) {   // Star Platinum rises above and behind the hero's shoulder
    const dio = enemies.find(en => en.type === 'dio');
    const sdir = dio && dio.x < player.x ? -1 : 1;
    ctx.save();
    ctx.translate(player.x - sdir * 12, player.y - 24); ctx.scale(1.4, 1.4);
    drawStarPlatinum(sdir, playerStand, player.swingT > 0);
    ctx.restore();
  }
  if (coop && p2) drawHero(p2);   // P2 first so P1 reads on top when they overlap
  drawHero(player);
  if (sidFinale) drawSidiousFinale();             // the death cutscene plays over the scene
  if (roadRoller) drawRoadRoller(roadRoller);     // the road roller, on top of everything
  // stopped-time wash: a sepia overlay + a clock motif while DIO acts in frozen time
  if (dioStopT > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(70,52,28,0.34)'; ctx.fillRect(0, 0, GW, GH);
    const vg = ctx.createRadialGradient(GW / 2, GH / 2, GH * 0.3, GW / 2, GH / 2, GH * 0.75);
    vg.addColorStop(0, 'rgba(40,28,14,0)'); vg.addColorStop(1, 'rgba(20,12,4,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#f3e6c8'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText('「 TIME HAS STOPPED 」', GW / 2, GH - 22);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (dioStopFx > 0) {   // a sharp white snap on the stop and on resume
    ctx.save(); ctx.globalAlpha = (api.reduceMotion ? 0.25 : 0.5) * (dioStopFx / 12);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, GW, GH); ctx.restore();
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    if ((s.t -= 1 / TEXT_HOLD) <= 0) { sparks.splice(i, 1); continue; }
    ctx.globalAlpha = s.t / 24;
    ctx.fillStyle = s.color; ctx.font = 'bold ' + (s.size || 13) + 'px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText(s.txt, s.x, s.y - (24 - s.t) * (s.rise == null ? 0.7 : s.rise));
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (bannerT > 0) {
    bannerT -= 1 / TEXT_HOLD;
    ctx.globalAlpha = Math.min(1, bannerT / 25);
    ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 30px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(banner, GW / 2, GH / 3);
    if (bannerSub) {
      ctx.fillStyle = '#ffe9b0'; ctx.font = '15px Tahoma,Arial';
      ctx.fillText(bannerSub, GW / 2, GH / 3 + 28);
    }
    ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (meter >= up.summonCost && !champsBanned() && champUnlocked()) {
    // standing offer — stays up top until an ally is summoned
    ctx.save();
    ctx.globalAlpha = 0.8 + Math.sin(frame * 0.1) * 0.2;
    ctx.fillStyle = '#bbdefb'; ctx.font = 'bold 14px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('ally ready:   ' + champReadyText(), GW / 2, 26);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (freezeT > 0) {
    ctx.fillStyle = 'rgba(143,216,255,0.07)';
    ctx.fillRect(0, 0, GW, GH);
  }
  if (awaitExit) {
    // a pulsing chevron beckoning the player to the east edge
    const cy = GH / 2, ax = GW - 40, pulse = Math.sin(frame * 0.12) * 8;
    ctx.save();
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(frame * 0.12);
    ctx.strokeStyle = '#ffd24d'; ctx.fillStyle = '#ffd24d';
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const off of [-18, 6]) {
      const bx = ax + off + pulse;
      ctx.beginPath();
      ctx.moveTo(bx, cy - 22); ctx.lineTo(bx + 20, cy); ctx.lineTo(bx, cy + 22);
      ctx.stroke();
    }
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('run east', ax - 16, cy - 36);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (ianChoice) drawIanChoice();
  ctx.restore();
  // directional HURT FLASH (render-only, screen-space): the edge the blow came
  // from flares red and fades — you always know which way death was standing
  if (hurtFlash) {
    const hf2 = hurtFlash;
    const d = Math.hypot(hf2.dx, hf2.dy) || 1;
    const a = (api.reduceMotion ? 0.16 : 0.24) * (hf2.t / 26) * (0.5 + 0.5 * sfOpts.flash);
    const ex = GW / 2 + (hf2.dx / d) * GW * 0.62, ey = GH / 2 + (hf2.dy / d) * GH * 0.62;
    const fg = ctx.createRadialGradient(ex, ey, 0, ex, ey, Math.max(GW, GH) * 0.55);
    fg.addColorStop(0, 'rgba(255,40,30,' + a.toFixed(3) + ')');
    fg.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, GW, GH);
    if (--hf2.t <= 0) hurtFlash = null;   // once per loop call — cadence-safe
  }
  if (shellMenu && netplay) drawShellMenu();   // online: settings overlay over a LIVE sim (nothing pauses)
  drawSummonMeter();   // the ally charge gauge sits in the UI layer, unaffected by screen shake
  drawManaGauge();     // ...and the wizard's well mirrors it bottom-right
  drawTrophyToasts();

  if (swFadeT > 0) {
    // cross-fade through black hides the cut to the corridor
    const half = FADE_LEN / 2;
    ctx.globalAlpha = 1 - Math.abs(swFadeT - half) / half;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GW, GH);
    ctx.globalAlpha = 1;
  }

  const foesLeft = enemies.length + warns.length + waveQuota;
  hud.innerHTML =
    (replayMode && replay ? '<span style="color:#ffd24d">▶ REPLAY · ' + replay.name + ' · Q to leave</span><br>' : '') +
    'SCORE ' + score + ' · BEST ' + best + '<br>' +
    (mournful
      ? '<span style="color:#8fd8ff">the world mourns · they will not fight</span> · KILLS ' + kills
      : 'WAVE ' + wave + (netplay ? ' · <span style="color:#7fd8ff">🌐 ONLINE</span>' : '') + (dailyRun ? ' · <span style="color:#ffb300">☀ DAILY</span>' : '') + (hardMode ? ' · <span style="color:#ff6e6e">☠ HARD</span>' : '') + (endless ? ' · <span style="color:#ffd24d">∞ ENDLESS</span>' : '') + ' · FOES ' + foesLeft + ' · KILLS ' + kills + ' · x' + mult) + '<br>' +
    (up.dashMax === 0
      ? '<span style="color:#666">DASH 🔒 locked</span>'
      : '<span style="color:#80deea">DASH ' + '◆'.repeat(player.dashCharges) +
        '<span style="color:#3a4a55">' + '◇'.repeat(up.dashMax - player.dashCharges) + '</span></span>') +
    (up.shield ? (player.shield
      ? '  ·  <span style="color:#7fd8ff">🛡️ AEGIS</span>'
      : '  ·  <span style="color:#5a6168">🛡️ broken · refreshes next wave</span>') : '') + '<br>' +
    (player.cls === 'ranged'
      ? '<span style="color:#9ccc65">🏹 bow · X fires your held direction</span>'
      : player.cls === 'caster'
      ? (() => {
          const sp = SPELLS[curSpell(player)], m = Math.floor(player.mana);
          return '<span style="color:#ce93d8">' + sp.icon + ' ' + sp.name + ' · X casts' +
            (heroSpells().length > 1 ? ' · ' + (coop ? '.' : 'C') + ' turns the page' : '') +
            ' · <span style="color:' + (m >= sp.cost ? '#b39ddb' : '#e57373') + '">🔮 ' + m + '</span></span>';
        })()
      : player.cls === 'necro'
      ? '<span style="color:#64ffda">💀 scythe · X reaps & raises · souls ' + Math.floor(player.souls) +
        ' · dead ' + minions.length + '/' + up.minionCap + (husks.length ? ' · husks ' + husks.length : '') + '</span>'
      : player.heldSaber
      ? '<span style="color:#5ac8ff">⚔ lightsaber · X strikes</span>'
      : saberPickup ? '<span style="color:#5ac8ff">⚔ a lightsaber waits ahead</span>'
      : player.swordT > 0
      ? '<span style="color:#fff59d">⚔ ' + Math.ceil(player.swordT / 60) + 's · X swings</span>'
      : stone ? '<span style="color:#fff59d">⚔ a sword waits in the stone</span>' : '<span style="color:#888">⚔ —</span>') + '<br>' +
    (!champUnlocked()
      ? '<span style="color:#888">🧙 no allies unlocked yet</span>'
      : champsBanned()
        ? '<span style="color:#e57373">no ally can save you now</span>'
        : (() => {
            const charges = Math.floor(meter / up.summonCost);
            const shown = Math.min(charges, alliesUnlocked());
            const pips = '●'.repeat(shown) + '○'.repeat(Math.max(0, alliesUnlocked() - shown));
            const tail = allies.length
              ? allies.map(g => ({ gandalf: '🧙', luke: '⚔️', jotaro: '👊' }[g.kind])).join('') + ' out'
              : charges > 0 ? 'summon 1·2·3' : 'charging';
            return '<span style="color:#bbdefb">🧙 ' + pips + '  ·  ' + tail + '</span>';
          })());
  if (coop && p2) {
    // a per-hero status line: dash charges, Aegis, and the downed/reviving state
    const hero = (h, label, col) => {
      if (h.down) {
        const pct = Math.round(clamp(h.reviveT / reviveNeed(), 0, 1) * 100);
        return '<span style="color:#ff5252">' + label + ' DOWN' + (pct ? ' · reviving ' + pct + '%' : ' · stand close to revive') + '</span>';
      }
      const dash = up.dashMax === 0 ? '' : ' ◆' + h.dashCharges;
      const aeg = up.shield ? (h.shield ? ' 🛡️' : ' 🛡️✕') : '';
      const blade = h.cls === 'ranged' ? ' 🏹'
                  : h.cls === 'caster' ? ' ✨'
                  : h.heldSaber ? ' ⚔' : h.swordT > 0 ? ' ⚔' + Math.ceil(h.swordT / 60) + 's' : '';
      return '<span style="color:' + col + '">' + label + dash + aeg + blade + '</span>';
    };
    hud.innerHTML += '<br>' + hero(player, 'P1', '#fff') + '   ' + hero(p2, 'P2', P2_COL);
  }
  if (player.choke > 0) hud.innerHTML = '<span style="color:#ff5252;font-weight:bold">✊ FORCE CHOKE — mash X / SPACE to break free!</span><br>' + hud.innerHTML;
  if (ianActive) hud.innerHTML = ianFinale
    ? 'the creator\'s fate is sealed...'
    : ianChoice ? '<span style="color:#fff">SPARE or KILL — ← → · Z to choose</span>' : 'the creator kneels, unarmed, before you';
}
