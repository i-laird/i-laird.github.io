// ── bosses — boss set-piece logic: Vader, Sidious (+finale), DIO/JoJo, Ian and the choice ──
/* ── Darth Vader: Force powers & phase logic ── */
function vaderTaunt(text, t) { banner = text; bannerSub = '— Darth Vader'; bannerT = t || 110; }
// pick the next action when Vader reaches the player: melee slash, or a Force power
function vaderNextAttack(e, d) {
  const r = rnd();
  if (e.disarmed) {                                  // no blade — telekinesis only, or stalk
    if (r < 0.6 && d < 160) startCast(e, 'push');
    else e.st = 22;
    return;
  }
  if (e.phase2 && r < 0.30 && bossTarget() === player)  startCast(e, 'choke');  // Force choke is P1-only (the struggle/escape is keyed to player)
  else if (r < (e.phase2 ? 0.52 : 0.34))   startCast(e, 'throw');
  else if (r < (e.phase2 ? 0.74 : 0.58))   startCast(e, 'push');
  else { e.mode = 'wind'; e.st = e.phase2 ? 18 : 26; }  // melee slash
}
function startCast(e, power) {
  e.mode = 'cast'; e.power = power; e.st = power === 'choke' ? 28 : 22;
  sfSfx.swing();
  sparks.push({ x: e.x, y: e.y - 42, t: 14, color: '#b39ddb',
                txt: power === 'throw' ? 'SABER THROW' : power === 'choke' ? 'FORCE CHOKE' : 'THE FORCE' });
}
// shove the focused hero away from Vader and lock their footing briefly so the push carries
function forcePush(e, mag) {
  const t = bossTarget();
  const ddx = t.x - e.x, ddy = t.y - e.y, dd = Math.hypot(ddx, ddy) || 1;
  t.vx = ddx / dd * 15 * mag; t.vy = ddy / dd * 15 * mag;
  t.stunT = Math.round(14 * mag); t.choke = 0;
  swFlash = Math.max(swFlash, 14);
  sfSfx.thud();
  sparks.push({ x: t.x, y: t.y - 24, t: 16, color: '#9ec8ff', txt: 'FORCE PUSH' });
}
// hurl the lightsaber: a spinning blade that crosses the room then homes back to Vader (boomerang)
function vaderThrow(e) {
  const t = bossTarget();
  const ang = Math.atan2(t.y - (e.y - 22), t.x - e.x), sp = 6.4;
  arrows.push({ x: e.x + Math.cos(ang) * 14, y: (e.y - 22) + Math.sin(ang) * 14,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                t: 400, kind: 'vsaber', range: 340, travelled: 0, returning: false, spin: 0 });
  sfSfx.lunge();
}
function startChoke(e) {
  player.choke = 90; player.chokeBreak = 0; player.vx = 0; player.vy = 0;
  vaderTaunt('You are beaten. It is useless to resist.', 120);
  sfSfx.lunge(); swFlash = Math.max(swFlash, 16);
}
function enterVaderPhase2(e) {
  e.phase2 = true; e.spd = 2.1;
  e.mode = 'recover'; e.st = 40; e.combo = false; e.power = null;
  forcePush(e, 1.35);                                // blow the player back to open the phase
  swFlash = 34; shake = Math.max(shake, 18); sfSfx.lunge();
  vaderTaunt('You are unwise to lower your defenses!', 160);
}

/* ── Darth Sidious: the Emperor — a reveal, twin sabers, Force lightning, two Royal Guards ── */
function bossSay(text, hold, gap) {           // queue a line of the Emperor's monologue
  dlg.push({ txt: text, sub: '— Darth Sidious', hold: hold || 110, gap: gap == null ? 78 : gap });
}
function sidiousCackle(e, kind) {
  sparks.push({ x: e.x, y: e.y - 48, t: 16, color: '#d0b3ff',
                txt: kind === 'lightning' ? 'UNLIMITED POWER!' : 'THE DARK SIDE' });
  sfSfx.swing();
}
function sidiousLightning(e) {
  ltnFlash = Math.max(ltnFlash, 16);
  shake = Math.max(shake, 10);
  sfSfx.zap();
}
// a leap target that circles the focused hero — keeps him orbiting, not blinking to corners
function sidiousFlank(e) {
  const t = bossTarget();
  const cur = Math.atan2(e.y - t.y, e.x - t.x);
  const ang = cur + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6);
  const rad = 155 + rnd() * 55;
  return { x: clamp(t.x + Math.cos(ang) * rad, 30, GW - 30),
           y: clamp(t.y + Math.sin(ang) * rad, 48, GH - 22) };
}
// begin a lightning windup — 'bolt' locks a straight corridor; 'sweep' rakes a wide arc across the player
function startSidiousCast(e, kind, lx, ly) {
  e.mode = 'cast'; e.castKind = kind; e.lastCast = kind;
  e.st = kind === 'sweep' ? 58 : 56; e.castDur = e.st;   // the rake telegraphs a touch longer
  if (kind === 'sweep') {
    const pa = Math.atan2(ly, lx);
    e.sweepDir = rnd() < 0.5 ? 1 : -1;
    e.sweepArc = 0.85; e.sweepCenterA = pa;            // narrower arc → a clear side to flee toward
    const startA = pa - e.sweepDir * e.sweepArc / 2;   // begin at one edge so the rake crosses the player
    e.lx = Math.cos(startA); e.ly = Math.sin(startA);
  } else {
    e.lx = lx; e.ly = ly;
  }
  sidiousCackle(e, 'lightning');
}
// half-health turn: the sabers go dark, and from here he is nothing but lightning
function enterSidiousPhase2(e) {
  e.phase2 = true; e.lit = 0; e.spd = 3.0;
  e.mode = 'recover'; e.st = 32;
  ltnFlash = Math.max(ltnFlash, 30); swFlash = Math.max(swFlash, 18); shake = Math.max(shake, 16);
  sfSfx.zap();
  knockback(e.x, e.y, 0, 7, 0);   // a repulse wave clears the guards back; harmless flourish
  banner = 'POWER! UNLIMITED POWER!'; bannerSub = '— Darth Sidious'; bannerT = 160;
  sparks.push({ x: e.x, y: e.y - 44, t: 18, color: '#c9a9ff', txt: 'the sabers go dark' });
}
/* ── death cutscene: Vader rises, hoists the electrocuting Emperor overhead, and carries him off ── */
function startSidiousFinale(e) {
  sidiousActive = false;
  enemies.forEach(g => { if (g.type === 'guard') g.dead = true; });   // the guards fall with him
  arrows = []; ltnBolts = []; bolts = [];
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 30, color: '#fff', txt: '...gone.' })); allies = []; }
  player.choke = 0; player.stunT = 0;
  const sx = clamp(e.x, 40, GW - 40), sy = clamp(e.y, 64, GH - 24);
  const exitDir = sx > GW / 2 ? 1 : -1;                              // carried off toward the nearer edge
  sidFinale = { phase: 'rise', t: 0, sx, sy, vx: sx, vy: sy, vrise: 0, lift: 0, faceDir: exitDir, exitDir };
  banner = 'NO... NOOOO!'; bannerSub = '— Darth Sidious'; bannerT = 130;
  ltnFlash = Math.max(ltnFlash, 26); swFlash = Math.max(swFlash, 14); shake = 18; sfSfx.zap();
}
function advanceSidiousFinale() {
  const f = sidFinale; f.t++;
  if (f.phase === 'rise') {                       // Vader pulls himself up from the deck beside the Emperor
    f.vrise = clamp(f.t / 96, 0, 1);
    if (f.t >= 110) { f.phase = 'lift'; f.t = 0; sfSfx.lunge(); }   // a beat once he's risen, then the grab
  } else if (f.phase === 'lift') {                // hoists him overhead as the lightning erupts
    f.lift = clamp(f.t / 72, 0, 1);
    if (f.t % 22 === 0) sfSfx.zap();
    if (f.t >= 78) { f.phase = 'hold'; f.t = 0; banner = 'the apprentice turns on his master'; bannerSub = ''; bannerT = 150; sfSfx.zap(); }
  } else if (f.phase === 'hold') {                // holds him aloft, the storm raging — the moment to watch
    f.lift = 1;
    if (f.t % 22 === 0) sfSfx.zap();
    if (f.t >= 120) { f.phase = 'carry'; f.t = 0; }
  } else {                                        // walks into the dark, the storm raging over them both
    f.vx += f.exitDir * 1.5; f.faceDir = f.exitDir;   // a slow, deliberate march
    if (f.t % 26 === 0) sfSfx.zap();
    if (f.exitDir > 0 ? f.vx > GW + 54 : f.vx < -54) { finishSidiousFinale(); return; }
  }
  if (f.phase !== 'rise' && f.t % 10 === 0) ltnFlash = Math.max(ltnFlash, 6);  // the void strobes violet
  if (!api.reduceMotion && f.t % 8 === 0) shake = Math.max(shake, 5);    // jolts from the shocks
}
function finishSidiousFinale() {
  sidFinale = null;
  swActive = false; sidiousActive = false; swState = ''; swStars = [];
  sidiousIntroT = 0; sidiousCue = 0; dlg = []; dlgT = 0;
  clearBlades(); saberPickup = null;
  arrows = []; ltnBolts = []; ltnFlash = 0; player.choke = 0; player.stunT = 0; swFlash = 0;
  banner = 'the Emperor is no more'; bannerSub = '+3000  ·  borne into the dark'; bannerT = 190;
  score += 3000; addMeter(50); shake = 16;
  grantBossToken();
  jojoCue = 150;                                 // ...but a stranger aura gathers in the dark
}

/* ── the JoJo interlude: DIO. he trolls you with stopped time, then the real fight ── */
function dioSay(text, hold, gap) { dlg.push({ txt: text, sub: '— DIO', hold: hold || 110, gap: gap == null ? 78 : gap }); }
function startDioStop(t) {
  dioStopT = t; dioStopFx = 12;
  sfSfx.zawarudo();
  sparks.push({ x: GW / 2, y: 50, t: 24, color: '#fff', txt: 'ZA WARUDO!' });
}
function dioKnife(x, y, vx, vy, scale) { return { x, y, vx, vy, t: 360, kind: 'knife', spin: rnd() * 6, scale: scale || 1 }; }
function startJojo() {
  jojoActive = true; jojoCue = 0;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  swActive = false; swState = ''; swStars = []; vaderActive = false; sidiousActive = false; sidFinale = null;
  stone = null; clearBlades(); saberPickup = null; armSaberAll(true);   // every hero keeps a lightsaber into the duel
  dioStopT = 0; roadRoller = null; ltnFlash = 0; dlg = []; dlgT = 0; playerStand = 0; freezeT = 0;
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 30, color: '#fff', txt: '...gone.' })); allies = []; }
  player.x = GW * 0.26; player.y = GH / 2; player.vx = 0; player.vy = 0; player.choke = 0; player.stunT = 0;
  jojoBg = [];   // drifting ゴ menacing glyphs
  for (let i = 0; i < 22; i++) jojoBg.push({ x: rnd() * GW, y: rnd() * GH, s: 14 + rnd() * 34, vy: -(0.08 + rnd() * 0.30), a: 0.05 + rnd() * 0.09 });
  enemies.push(makeEnemy('dio', GW * 0.78, GH / 2));
  banner = 'KONO DIO DA!'; bannerSub = '— DIO'; bannerT = 150;
  shake = 12; sfSfx.summon();
}
// the scripted troll intro — he stops time only to mess with you
function dioTroll(e) {
  e.tt++;
  const enter = (s) => e.tstep === s && e.tt === 1;
  const done = (len) => { if (e.tt >= len) { e.tstep++; e.tt = 0; } };
  const px = player.x;
  if (e.tstep === 0) {                                   // a long beat — the Stands rise and square off (intro card already boasted)
    done(140);
  } else if (e.tstep === 1) {                            // stop time, saunter into your face, stroll back
    if (enter(1)) { startDioStop(170); e.hx = e.x; e.hy = e.y; }
    if (dioStopT > 0) {
      const tx = px + (px < GW / 2 ? 30 : -30);
      e.x += (tx - e.x) * 0.07; e.y += (player.y - e.y) * 0.07;   // a slow, unhurried stroll
      if (dioStopT === 120) dioSay('oh? you were about to attack? how rude.', 340, 0);
    } else { e.x += (e.hx - e.x) * 0.09; e.y += (e.hy - e.y) * 0.09; }
    done(420);
  } else if (e.tstep === 2) {                            // the centrepiece: a knife at your throat that slowly wilts to a rose
    const side = px < GW / 2 ? 1 : -1;
    const tx = px + side * 28, ty = player.y - 22;
    if (enter(2)) { startDioStop(260); dioSay('see this? a knife. right at your throat.', 380, 0); }
    if (dioStopT === 220 && !e.f2k) { e.f2k = true; arrows.push(dioKnife(tx, ty, -side, 0.45, 3.6)); sfSfx.arrow(); }
    if (dioStopT === 140 && !e.f2b) { e.f2b = true; dioSay('but a clean death? no... far too kind.', 380, 0); }
    if (dioStopT === 80 && !e.f2) { e.f2 = true; arrows = arrows.filter(a => a.kind !== 'knife'); sparks.push({ x: tx, y: ty, t: 260, color: '#ff5d8f', txt: '🌹', size: 56, rise: 0.05 }); dioStopFx = Math.max(dioStopFx, 9); }
    if (dioStopT === 30 && !e.f2c) { e.f2c = true; dioSay('...muda. i intend to savour this.', 380, 0); }
    done(520);
  } else if (e.tstep === 3) {                            // stop time and rearrange YOU
    if (enter(3)) startDioStop(130);
    if (dioStopT === 64) { player.x = clamp(GW - player.x, 20, GW - 20); player.y = clamp(GH - player.y, 44, GH - 12); sparks.push({ x: player.x, y: player.y - 26, t: 48, color: '#caa6ff', txt: '!?', size: 22 }); }
    if (dioStopT === 0 && !e.f3) { e.f3 = true; dioSay('did you really think YOU could choose where to stand?', 360, 0); }
    done(400);
  } else {                                               // enough games — the fight begins
    if (enter(4)) { dioSay('enough. you have amused me, JoJo.', 360, 260); dioSay('now... be erased. MUDA MUDA MUDA!', 360, 0); shake = 14; }
    if (e.tt >= 500) { e.mode = 'idle'; e.st = 36; e.cape = 1; dlg = []; dlgT = 0; banner = 'DIO'; bannerSub = 'the world is his'; bannerT = 130; sfSfx.zawarudo(); }
  }
}
function startBarrage(e) {
  e.mode = 'barrage'; e.st = 56;
  startDioStop(88);   // the synced "ZA WARUDO!" spark is the callout — no queued line to lag behind the action
  const _t = bossTarget(), px = _t.x, py = _t.y;   // knives ring the frozen hero, with spread so there are gaps to weave
  for (let i = 0; i < 15; i++) {
    const edge = i / 15 * Math.PI * 2;
    const sx = px + Math.cos(edge) * 360, sy = py + Math.sin(edge) * 320;
    const a = Math.atan2(py - sy, px - sx) + (rnd() - 0.5) * 0.55;
    arrows.push(dioKnife(clamp(sx, -16, GW + 16), clamp(sy, -16, GH + 16), Math.cos(a) * 3.3, Math.sin(a) * 3.3));
  }
}
function startRoller(e) {
  e.mode = 'roller'; e.st = 78;
  startDioStop(66);
  dlg = []; dlgT = 0; banner = 'ROAD ROLLER DA!'; bannerSub = '— DIO'; bannerT = 95;   // fire the callout in sync with the attack, bypassing the queue
  { const t = bossTarget(); roadRoller = { zoneX: clamp(t.x, 40, GW - 40), zoneY: clamp(t.y, 60, GH - 16), x: clamp(t.x, 40, GW - 40), y: -80, phase: 'hover', t: 0, toy: false }; }
  shake = 10;
}
function updateRoadRoller() {
  const r = roadRoller; r.t++;
  if (r.phase === 'hover') {                 // positioned high during stopped time
    r.y += (r.zoneY - 150 - r.y) * 0.2;
    if (dioStopT <= 0) { r.phase = 'drop'; r.t = 0; r.y0 = r.y; }   // remember the height for the telegraph
  } else if (r.phase === 'drop') {           // time resumes — it falls (the whole fall is the dodge window)
    r.y += 5.4;
    if (r.y >= r.zoneY) { r.y = r.zoneY; r.phase = 'impact'; r.t = 0; shake = 22; sfSfx.bomb(); }
  } else {                                   // impact — lethal a beat, MUDA spam, then gone
    if (r.t % 3 === 0) sparks.push({ x: r.zoneX + (rnd() - 0.5) * 80, y: r.zoneY - rnd() * 46, t: 8, color: '#ffe082', txt: 'MUDA' });
    if (r.t > 44) roadRoller = null;
  }
}
/* ── DIO's death: a slow crumble — he staggers, his time-stop fails, then he turns to dust ── */
function startDioFinale(e) {
  e.mode = 'dying'; e.hp = 1; e.crumble = 0; e.stand = 0;
  dioFinale = { phase: 'stagger', t: 0 };
  dioStopT = 0; dioStopFx = 0; roadRoller = null; arrows = []; player.stunT = 0; player.choke = 0;
  kills++; score += 500 * mult; addMeter(20);
  sparks.push({ x: e.x, y: e.y - 26, t: 22, color: '#ffd24d', txt: '+' + (500 * mult) });
  banner = 'im-impossible!'; bannerSub = '— DIO'; bannerT = 130;
  shake = 16; sfSfx.thud();
}
function advanceDioFinale() {
  const f = dioFinale; f.t++;
  playerStand *= 0.95;                                  // Star Platinum fades as the duel ends
  const e = enemies.find(en => en.type === 'dio');
  if (f.phase === 'stagger') {                          // he reels, refusing to believe it
    if (f.t >= 80) { f.phase = 'laststand'; f.t = 0; banner = 'toki yo... to... maré...?'; bannerSub = 'but time will not obey him'; bannerT = 150; sfSfx.zawarudo(); dioStopFx = 16; }
  } else if (f.phase === 'laststand') {                 // one last ZA WARUDO — and it sputters out
    if (!api.reduceMotion && f.t % 12 === 0) dioStopFx = Math.max(dioStopFx, 9);
    if (f.t >= 96) { f.phase = 'crumble'; f.t = 0; banner = 'WRYYYYYYY!'; bannerSub = ''; bannerT = 200; sfSfx.die(); shake = 22; }
  } else {                                              // he crumbles to dust from the feet up
    if (e) e.crumble = clamp(f.t / 120, 0, 1);
    if (f.t % 2 === 0 && e) {
      const ox = (rnd() - 0.5) * 26, oy = (rnd() - 0.5) * 10, tt = 22 + rnd() * 24, pale = rnd() < 0.5;  // consumed even under reduced motion
      if (!api.reduceMotion) sparks.push({ x: e.x + ox, y: e.y - 6 - (e.crumble || 0) * 42 + oy, t: tt, color: pale ? '#d8c9a4' : '#caa6ff', txt: '·' });
    }
    if (f.t >= 132) { finishDioFinale(); return; }
  }
  if (!api.reduceMotion && f.t % 8 === 0) shake = Math.max(shake, 4);
}
function finishDioFinale() {
  sfUnlock('dio');
  const e = enemies.find(en => en.type === 'dio'); if (e) e.dead = true;
  dioFinale = null; jojoActive = false; dioStopT = 0; dioStopFx = 0; roadRoller = null;
  arrows = []; dlg = []; dlgT = 0; player.stunT = 0;
  clearBlades();                        // the lightsaber stays behind, back to the horde
  banner = 'DIO is no more'; bannerSub = '+3000  ·  the bizarre night ends'; bannerT = 190;
  score += 3000; addMeter(50); shake = 14;
  grantBossToken();
  ianCue = 150;                                  // ...and one last figure remains to face: the creator
}

/* ── the final confrontation: Ian, the creator. unarmed. he begs. you choose. ── */
function ianSay(text, hold, gap) { dlg.push({ txt: text, sub: '— Ian', hold: hold || 130, gap: gap == null ? 70 : gap }); }
function startIan() {
  ianActive = true; ianCue = 0;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  swActive = false; swState = ''; swStars = []; jojoActive = false; vaderActive = false; sidiousActive = false;
  dioStopT = 0; dioStopFx = 0; roadRoller = null; ltnFlash = 0; sidFinale = null; dioFinale = null;
  stone = null; clearBlades(); saberPickup = null;
  banishAllies();
  player.x = GW * 0.32; player.y = GH / 2 + 8; player.vx = 0; player.vy = 0; player.choke = 0; player.stunT = 0;
  enemies.push(makeEnemy('ian', GW * 0.7, GH / 2 + 6));
  // the creator's cozy little room: a warm starfield with drifting hearts & code glyphs
  ianBg = [];
  for (let i = 0; i < 48; i++) ianBg.push({ kind: 'star', x: rnd() * GW, y: rnd() * GH * 0.9, r: rnd() * 1.3 + 0.3 });
  const glyphs = ['♥', '♡', '✦', '✧', '★', '{ }', '</>', '⟨⟩', '✿', '♪'];
  const cols = ['#ffd6e7', '#cdb4ff', '#b4e1ff', '#fff0b4', '#c8ffd4', '#ffc4d6'];
  for (let i = 0; i < 16; i++) ianBg.push({ kind: 'mote', x: rnd() * GW, y: rnd() * GH,
    s: 12 + rnd() * 16, vy: -(0.12 + rnd() * 0.4), a: 0.12 + rnd() * 0.18,
    ph: rnd() * 100, ch: glyphs[Math.floor(rnd() * glyphs.length)], col: cols[Math.floor(rnd() * cols.length)] });
  banner = ''; bannerSub = ''; bannerT = 0;
  dlg = []; dlgT = 72;        // the plea is delivered on the intro card — here, just a beat, then the choice
  shake = 6;
}
function chooseIan(sel) {
  if (ianFinale) return;
  ianChoice = null;
  const e = enemies.find(en => en.type === 'ian');
  dlg = []; dlgT = 0;
  if (sel === 1) {                                 // KILL — the world is left hollow and grieving
    if (!noPersist()) try { localStorage.setItem('ilaird_sf_ending', 'kill'); } catch (_) {}
    ianFinale = { outcome: 'kill', phase: 'strike', t: 0 };
    if (e) e.mode = 'dying';
    banner = ''; bannerT = 0;
    swFlash = Math.max(swFlash, 14); shake = 18; sfSfx.saberHit();
  } else {                                         // SPARE — endless mode, as a gift
    if (!noPersist()) try { localStorage.setItem('ilaird_sf_ending', 'spare'); } catch (_) {}
    ianFinale = { outcome: 'spare', phase: 'thanks', t: 0 };
    if (e) e.mode = 'rise';
    ianSay('thank you for sparing me.', 150, 55);
    ianSay('I will now throw everything I have at you.', 185, 0);
    sfSfx.summon();
  }
}
function advanceIanFinale() {
  const f = ianFinale; f.t++;
  const e = enemies.find(en => en.type === 'ian');
  if (f.outcome === 'kill') {
    if (f.phase === 'strike') {
      if (f.t === 6) { banner = 'WHY...?'; bannerSub = '— Ian'; bannerT = 110; }
      if (f.t >= 30) { f.phase = 'fall'; f.t = 0; if (e) { e.mode = 'dying'; e.crumble = 0; } sfSfx.die(); shake = 14; }
    } else {                                       // he fades to ash
      if (e) e.crumble = clamp(f.t / 90, 0, 1);
      if (f.t % 3 === 0 && e) { const ox = (rnd() - 0.5) * 22; if (!api.reduceMotion) sparks.push({ x: e.x + ox, y: e.y - 18 - (e.crumble || 0) * 28, t: 26, color: '#9e9e9e', txt: '·' }); }
      if (f.t >= 116) { finishIanKill(); return; }
    }
  } else {
    if (f.phase === 'thanks') {
      if (!dlg.length && dlgT <= 0 && bannerT < 95) { f.phase = 'leave'; f.t = 0; if (e) e.mode = 'rise'; }
    } else {                                       // he steps back into the light, grateful
      if (e) { e.x += 1.1; e.fade = clamp(1 - f.t / 80, 0, 1); }
      if (f.t >= 84) { finishIanSpare(); return; }
    }
  }
}
function finishIanKill() {
  enemies = enemies.filter(en => en.type !== 'ian');
  ianActive = false; ianFinale = null; ianChoice = null;
  sfUnlock('ian_kill');
  mournful = true; endless = false;
  arrows = []; warns = []; dlg = []; dlgT = 0;
  clearBlades(); stone = null; stoneCd = 150;   // Excalibur returns to the quiet world
  banner = 'the world goes quiet'; bannerSub = 'nothing here will raise a hand to you now'; bannerT = 230;
  shake = 6;
  breatherT = BREATHER;
}
function finishIanSpare() {
  enemies = enemies.filter(en => en.type !== 'ian');
  ianActive = false; ianFinale = null; ianChoice = null;
  sfUnlock('ian_spare');
  endless = true; mournful = false;
  if (!noPersist()) try { localStorage.setItem('ilaird_sf_endless', '1'); } catch (_) {}
  // mercy has a price (and a prize): HARD MODE unlocks forever — a new ☠ HARD
  // choice on the title screen (the flag is read per run in init)
  if (!noPersist() && !hardUnlocked) {
    hardUnlocked = true;
    try { localStorage.setItem('ilaird_sf_hard', '1'); } catch (_) {}
    banner = 'ENDLESS MODE  ·  ☠ HARD MODE UNLOCKED';
    bannerSub = 'the horde never ends — and a harder horde now waits on the title screen';
  } else {
    banner = 'ENDLESS MODE'; bannerSub = 'the horde never ends — survive as long as you can';
  }
  arrows = []; warns = []; dlg = []; dlgT = 0;
  bannerT = 230;
  breatherT = BREATHER;
  if (!hardMode) openBoonMenu('MERCY REWARDED — A FINAL BOON');   // (a hard run re-sparing earns nothing more)
}
function drawIanChoice() {
  const c = ianChoice; c.t = (c.t || 0) + 1;
  const opts = [
    { label: 'SPARE', sub: 'let him live', accent: '#5ac8ff' },
    { label: 'KILL',  sub: 'strike him down', accent: '#e23b3b' },
  ];
  const bw = 158, bh = 72, gap = 28, total = bw * 2 + gap;
  const x0 = GW / 2 - total / 2, y = GH - 116;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px Tahoma,Arial';
  ctx.fillText('what will you do?', GW / 2, y - 18);
  ctx.shadowBlur = 0;
  for (let i = 0; i < 2; i++) {
    const sel = c.sel === i, bx = x0 + i * (bw + gap), o = opts[i];
    const pulse = sel && !api.reduceMotion ? 0.75 + 0.25 * Math.sin(c.t * 0.18) : 1;
    ctx.globalAlpha = sel ? pulse : 0.85;
    ctx.fillStyle = sel ? hexA(o.accent, 0.22) : 'rgba(8,10,14,0.85)';
    roundRectPath(bx, y, bw, bh, 8); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = sel ? o.accent : hexA(o.accent, 0.5);
    roundRectPath(bx, y, bw, bh, 8); ctx.stroke();
    ctx.fillStyle = sel ? '#fff' : o.accent; ctx.font = 'bold 25px Tahoma,Arial';
    ctx.fillText(o.label, bx + bw / 2, y + 36);
    ctx.fillStyle = sel ? '#e8eef5' : '#90a0b0'; ctx.font = '12px Tahoma,Arial';
    ctx.fillText(o.sub, bx + bw / 2, y + 56);
  }
  ctx.fillStyle = '#9fb3c8'; ctx.font = '12px Tahoma,Arial';
  ctx.fillText('←  →   ·   Z to choose', GW / 2, y + bh + 22);
  ctx.restore(); ctx.textAlign = 'left';
}
function startSidious() {
  swActive = true; sidiousActive = true; vaderActive = false; swState = 'sidious';
  sidiousCue = 0; sidiousIntroT = 300;            // ~5s reveal before he strikes
  arrows = []; ltnBolts = []; ltnFlash = 26;
  armSaberAll(true); saberPickup = null;           // the blue lightsaber carries into the duel
  banishAllies();                                 // face the Emperor alone
  if (!swStars.length) { for (let i = 0; i < 70; i++) swStars.push({ x: rnd() * GW, y: rnd() * GH, r: rnd() * 1.3 + 0.3 }); }
  player.choke = 0; player.stunT = 0;
  // the Emperor stands at the far side, flanked by two Royal Guards
  const sx = GW * 0.82, sy = GH / 2;
  enemies.push(makeEnemy('sidious', sx, sy));
  enemies.push(makeEnemy('guard', sx - 10, sy - 72));
  enemies.push(makeEnemy('guard', sx - 10, sy + 72));
  shake = 16;
  banner = 'DARTH SIDIOUS'; bannerSub = 'the Emperor reveals himself'; bannerT = 150;
  sfSfx.ignite();
  // a scripted reveal
  dlg = []; dlgT = 44;
  bossSay('At last we meet again.', 110, 72);
  bossSay('I have been expecting you.', 110, 72);
  bossSay('Your feeble skills are no match for the dark side.', 130, 82);
  bossSay('GUARDS. Witness the power of the Force!', 120, 0);
}

function farPoint(margin) {
  for (let i = 0; i < 12; i++) {
    const x = margin + rnd() * (GW - margin * 2);
    const y = margin + rnd() * (GH - margin * 2);
    if (Math.hypot(x - player.x, y - player.y) > KEEP_OUT) return { x, y };
  }
  return { x: GW / 2, y: 60 };
}
