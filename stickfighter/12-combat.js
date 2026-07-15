// ── combat — hit resolution: knockback, killEnemy, strike/downHero/reviveHero, endRun ──
function knockback(cx, cy, killR, push, stun) {
  for (const e of enemies) {
    const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy) || 1;
    if (killR > 0 && d < killR) {
      if (!e.hp || (e.hp -= 2) <= 0) { killEnemy(e); continue; }
    }
    const p = push * Math.max(0.25, 1 - d / 500);
    e.x = clamp(e.x + dx / d * p, -60, GW + 60);
    e.y = clamp(e.y + dy / d * p, -60, GH + 60);
    e.stun = stun; e.vx = 0; e.vy = 0;
    if (e.mode) { e.mode = e.type === 'archer' ? 'approach' : 'stalk'; e.st = 70; }
  }
  enemies = enemies.filter(e => !e.dead);
}

// heavy impacts hold the world — max semantics so a cleave punctuates, never stutters
function hitStopFor(n) { hitStop = Math.min(14, Math.max(hitStop, n)); }
function killEnemy(e) {
  if (e.dead) return;
  // downing the fell beast doesn't end the Witch-king — he rises and fights on foot
  if (e.type === 'witchking' && e.mounted) {
    hitStopFor(10);   // the fell beast crashes — the world feels it
    e.mounted = false; e.hp = e.footMax; e.kr = 22; e.spd = 1.7;
    e.mode = 'walk'; e.st = 60; e.stun = 36; e.flailAng = 0;
    banner = 'the fell beast is slain!'; bannerSub = 'the Witch-king takes up his flail'; bannerT = 130;
    sfSfx.screech(); shake = 12;
    sparks.push({ x: e.x, y: e.y - 30, t: 30, color: '#b39ddb', txt: 'SCREEEE' });
    return;
  }
  // DIO doesn't simply die — a slow crumble cutscene plays out (handled in dioFinale)
  if (e.type === 'dio' && e.mode !== 'dying') { hitStopFor(12); startDioFinale(e); return; }
  e.dead = true;
  kills++;
  killsByType[e.type] = (killsByType[e.type] || 0) + 1;
  // HIT-STOP: every kill lands with weight — a beat for a grunt, a held breath
  // for a troll or an elite, the world stopping for a boss
  hitStopFor(e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' ? 12
           : e.type === 'ogre' ? 8
           : e.type === 'troll' || e.elite ? 4 : 2);
  sfUnlock('first_blood');
  if (e.type === 'wolf' && e.elite && !noPersist()) {   // WOLFSBANE: frost + dire frost wolves, lifetime
    wolfKills++;
    try { localStorage.setItem('ilaird_sf_wolfkills', String(wolfKills)); } catch (_) {}
    if (wolfKills >= 100) sfUnlock('wolf_100');
  }
  // a necromancer in the party harvests the fallen: grunts leave husks to raise
  if ((e.type === 'goblin' || e.type === 'wolf' || e.type === 'archer' || e.type === 'troll') &&
      !champsBanned() && husks.length < HUSK_CAP && heroesAll().some(h => h.cls === 'necro')) {
    husks.push({ src: e.type, x: e.x, y: e.y, t: Math.round(HUSK_T * up.huskMul), elite: e.elite || 0 });
  }
  // Shatter: a foe killed while frozen bursts into an ice nova-let, freezing its neighbors
  if (up.shatter && e.frozen > 0) {
    sfSfx.freeze();
    blasts.push({ kind: 'frost', x: e.x, y: e.y, r: 0, t: 0, life: 20, rMax: 70 });
    let n = 0;
    for (const o of enemies) {
      if (o === e || untouchable(o) || o.frozen > 0) continue;
      if (o.type === 'witchking' || o.type === 'vader' || o.type === 'sidious' || o.type === 'dio' || o.type === 'wraith') continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) < 70) { o.frozen = 180; o.vx = 0; o.vy = 0; n++; }
    }
    if (n) sparks.push({ x: e.x, y: e.y - 30, t: 18, color: '#8fd8ff', txt: 'SHATTER' });
  }
  const pts = ((e.type === 'dio' ? 500 : e.type === 'sidious' ? 400 : e.type === 'vader' ? 300 : e.type === 'witchking' ? 200 : e.type === 'ogre' ? 120 : e.type === 'troll' ? 40 : e.type === 'shaman' ? 35 : e.type === 'bomber' ? 35 : e.type === 'wraith' ? 30 : e.type === 'guard' ? 25 : e.type === 'trooper' ? 20 : 15) + bn.bounty) * mult * (e.elite === 2 ? 4 : e.elite ? 2 : 1);
  score += pts;
  if (e.kr !== 0 || e.type === 'shaman' || e.type === 'bomber') addDecal(e.x, e.y, 'ash');   // (render-only) the field remembers the fallen
  addMeter(7);
  sparks.push({ x: e.x, y: e.y - 26, t: 20, color: '#ffd24d', txt: '+' + pts });
  sfSfx.killE();
  if (e.type === 'witchking') {
    sfUnlock('witch_king');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    if (hardMode) sfUnlock('dark_hour');
    if (!hardMode) openBoonMenu('THE WITCH-KING FALLS — CHOOSE A BOON');   // hard mode: no gifts, ever
    bossActive = false; nineDone = true; corpses = [];
    const gotTok = grantBossToken();   // every Witch-king kill earns an upgrade token
    banner = 'the Witch-king is no more'; bannerSub = '+1000' + (gotTok ? '  ·  token earned' : ''); bannerT = 160;
    score += 1000;
    addMeter(40);
    shake = 16;
    awaitExit = true;  // a way out opens to the east...
    openUpgradeMenu('THE WITCH-KING FALLS');  // spend banked tokens before the road east
  } else if (e.type === 'trooper') {
    swTroopersLeft--;
  } else if (e.type === 'ogre') {
    sfUnlock('ogre');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // the mini-boss falls hard — extra points, a meter surge, and a guaranteed powerup drop
    banner = 'the war-ogre falls!'; bannerSub = '+200'; bannerT = 130;
    score += 200; addMeter(30); shake = 14;
    powerups.push({ x: e.x, y: e.y, kind: ['freeze', 'fire', 'bolt'][Math.floor(rnd() * 3)], t: 820 });
  } else if (e.type === 'vader') {
    sfUnlock('vader');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // the dark lord falls — but a darker master waits in the void. keep the saber.
    vaderActive = false; swState = 'vaderdown';   // stay in the void; keep the lightsaber + starfield
    arrows = []; player.choke = 0; player.stunT = 0; swFlash = 0;  // clear in-flight saber / Force effects
    banner = 'the dark lord falls'; bannerSub = '+1500'; bannerT = 170;
    score += 1500; addMeter(40); shake = 18;
    grantBossToken();                   // Vader's fall earns an upgrade before the Emperor
    // a breath, an upgrade, then the Emperor reveals himself
    if (!openUpgradeMenu('DARTH VADER FALLS')) sidiousCue = 110;
  } else if (e.type === 'sidious') {
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // he does not simply fall — Darth Vader rises and bears him into the dark,
    // the Emperor's lightning storming over them both (reward deferred to the cutscene's end)
    sfUnlock('sidious');
    startSidiousFinale(e);
  } else if (e.type === 'wraith' && nineActive) {
    // every wraith's body stays on the field
    corpses.push({ x: e.x, y: e.y, dir: (player.x - e.x) >= 0 ? 1 : -1 });
    if (--wraithsLeft <= 0) {
      // the last has fallen — but one of the bodies stirs
      nineActive = false; bossActive = true;
      const c = corpses[Math.floor(rnd() * corpses.length)] || { x: player.x, y: 60 };
      bossRiseX = c.x; bossRiseY = c.y; bossRiseT = 440;
      banner = 'the Nine are fallen...'; bannerSub = 'but one will not stay dead'; bannerT = 130;
      sfSfx.screech();
    }
  }
}

// a blow lands on hero h: the Aegis eats it if charged, otherwise the hero falls.
// In single-player a fall ends the run outright; in co-op the hero is DOWN and the
// run only ends once both heroes are down (see downHero/endRun).
function strike(h) {
  if (!h || h.down || h.dashT > 0 || h.iframe > 0) return;  // mid-dash i-frames / just-shielded
  // (render-only) the living camera lurches WITH the blow — away from the likely striker
  let kdx = 0, kdy = 1, kbest = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d < kbest) { kbest = d; kdx = h.x - e.x; kdy = h.y - e.y; }
  }
  camKick(kdx, kdy, 7);
  hurtFlash = { dx: -kdx, dy: -kdy, t: 26 };   // (render-only) the screen edge flares FROM the striker's side
  hitStopFor(8);   // a blow that lands on a HERO stops the world hardest of all
  runFlawless = false;   // a blow got through the dodges (Aegis eating it still counts) — UNSCATHED is off
  if (h.shield) {
    // the Aegis takes the blow — shatters, buys a beat of safety, and shoves attackers off
    h.shield = false; h.iframe = 44;
    shake = Math.max(shake, 12); sfSfx.shieldBreak();
    sparks.push({ x: h.x, y: h.y - 32, t: 30, color: '#7fd8ff', txt: 'SHIELD BROKEN' });
    knockback(h.x, h.y, 0, 130, 16);
    if (up.secondWind && up.dashMax > 0) {   // Second Wind: the break refills every dash
      h.dashCharges = up.dashMax; h.rechargeT = 0;
      sparks.push({ x: h.x, y: h.y - 48, t: 24, color: '#80deea', txt: 'SECOND WIND' });
    }
    return;
  }
  if (h.bn.cheatDeath) {
    // DEATHWARD: the boon takes the blow that would have ended things — once.
    // Sits BELOW the Aegis on purpose: the shield refreshes every wave, this doesn't.
    h.bn.cheatDeath = false; h.iframe = 60;
    shake = Math.max(shake, 12); sfSfx.shieldBreak();
    sparks.push({ x: h.x, y: h.y - 32, t: 34, color: '#ff8ab5', txt: '💖 DEATHWARD' });
    knockback(h.x, h.y, 0, 130, 16);
    return;
  }
  downHero(h);
}
function downHero(h) {
  camVictim = h;                                 // the kill cam frames whoever just fell
  fieldWashSet('10,16,40', 0.3, 70);             // (render-only) the field drains cold as a hero falls
  if (!coop) { endRun(); return; }               // solo: a hit is simply the end
  h.down = true; h.downT = 0; h.reviveT = 0; h.vx = 0; h.vy = 0; h.dashT = 0; h.stunT = 0;
  if (h.cls === 'rider') h.mounted = false;      // a struck rider is THROWN from the saddle
  if (h.cls === 'wyrm' && p2 && p2.cls === 'rider' && p2.mounted && !p2.down) {
    // the beast falls out from under the rider — dumped standing beside the body
    p2.mounted = false;
    p2.x = clamp(h.x + 20, 14, GW - 14); p2.y = h.y;
    sparks.push({ x: p2.x, y: p2.y - 30, t: 20, color: DRAGOON_COL, txt: 'THROWN!' });
  }
  sfSfx.die(); shake = Math.max(shake, 12);
  sparks.push({ x: h.x, y: h.y - 30, t: 34, color: '#ff5252', txt: 'DOWN!' });
  if (heroesLive().length === 0) endRun();        // both fallen — the horde wins
  else { banner = 'PLAYER ' + (heroSeat(h) + 1) + ' DOWN'; bannerSub = 'a partner can revive — stand close'; bannerT = 90; }
}
// the run is over (solo death, or both heroes down in co-op)
function endRun() {
  // arm the KILL CAM: the ghost tape's last seconds replay in slow motion before
  // the death screen (render-only; any key skips; reduced motion goes straight on)
  if (!replayMode && !api.reduceMotion && camTape.length > 30) {
    const v = camVictim || player;
    killCam = { tape: camTape, i: Math.max(0, camTape.length - CAM_SHOW), t: 0, hold: 0, fx: v.x, fy: v.y };
  }
  if (replayMode) {                  // the legend falls again — nothing of the watcher's changes
    alive = false; sfSfx.die(); shake = 14; lbState = 'off';
    return;
  }
  if (netplay) {                     // online runs are score-free: no board, no best, no saves
    alive = false; sfSfx.die(); shake = 14; lbState = 'off';
    return;
  }
  alive = false;
  if (dailyRun) sfUnlock('daily');   // seeing a daily through counts, win or lose
  lbTicks = tick; lbKills = kills;   // the run's proof stats, frozen at death
  if (score > best) { best = score; newBest = true; localStorage.setItem('ilaird_sf_best', String(best)); }
  sfSfx.die(); shake = 14;
  lbBegin();
}
function reviveHero(h) {
  h.down = false; h.reviveT = 0; h.iframe = up.medic ? 120 : 70;   // up again, with a beat of mercy invulnerability (longer with a Medic)
  h.shield = up.shield; h.vx = 0; h.vy = 0; h.chillT = 0;
  sfSfx.summon();
  sparks.push({ x: h.x, y: h.y - 32, t: 34, color: P2_COL, txt: 'REVIVED!' });
  banner = (h === player ? 'PLAYER 1' : 'PLAYER 2') + ' REVIVED'; bannerSub = ''; bannerT = 70;
}
// legacy name kept for the Force-choke death path (a guaranteed kill of P1)
function slayPlayer() { strike(player); }
