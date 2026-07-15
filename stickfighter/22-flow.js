// ── flow — startStarWars, stopGame, the 9-spam warp cheats ──
// the Star Wars interlude: a corridor where a squad of stormtroopers forms up, then opens fire
function startStarWars() {
  swActive = true; swState = 'march'; swReadyT = 0; vaderActive = false;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  // no medieval steel beyond the door — Excalibur stays behind
  stone = null; clearBlades();
  // a lightsaber waits on the deck — but only a melee hero has any use for it
  saberPickup = heroesAll().some(h => h.cls === 'melee') ? { x: GW * 0.30, y: GH / 2 } : null;
  // player has just charged through the doorway — slam them against the west wall
  player.x = 34; player.y = GH / 2; player.vx = 0; player.vy = 0;
  // co-op: P2 lands beside P1, and both arm up — a single floor saber can't equip two,
  // and both heroes need a blade to deflect bolts and duel Vader. (Skip the lone pickup.)
  // A fresh set-piece also revives a fallen partner so nobody's stuck down through the duel.
  if (coop && p2) {
    for (const h of heroesAll()) { h.down = false; h.reviveT = 0; h.shield = up.shield; }
    p2.x = 34; p2.y = GH / 2 + 42; p2.vx = 0; p2.vy = 0;
    saberPickup = null; armSaberAll(true);
  }
  // a fixed starfield so it doesn't flicker frame to frame
  swStars = [];
  for (let i = 0; i < 70; i++) {
    swStars.push({ x: rnd() * GW, y: rnd() * GH, r: rnd() * 1.3 + 0.3 });
  }
  const cols = 4, rows = 4;
  // tight formation, pushed to the right of the room
  const baseX = GW * 0.75, dx = (GW * 0.92 - baseX) / (cols - 1);
  const baseY = GH * 0.32, dy = (GH * 0.74 - baseY) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slotX = baseX + c * dx, slotY = baseY + r * dy;
      // enter from off the east edge in a marching column — front rank (right column) leads
      // (spawn x stays within updateEnemy's GW+60 clamp so the ranks don't bunch up)
      const e = makeEnemy('trooper', GW + 16 + (cols - 1 - c) * 14, slotY);
      e.slotX = slotX; e.slotY = slotY;
      e.fireT = 50 + rnd() * 150;   // staggered so the volley isn't a single wall
      enemies.push(e);
    }
  }
  swTroopersLeft = rows * cols;
  banner = 'IMPERIAL CORRIDOR'; bannerSub = 'a squad marches in — cut them down'; bannerT = 150;
  sfSfx.wave();
}

function stopGame() {
  if (netplay || netUi) netSend({ t: 'bye' });   // the desktop is shutting down — tell the partner
  netTeardown();
  alive = false;
  stopSfMusic();
  wraithSfx.pause();
  if (rafId) cancelAnimationFrame(rafId);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('keyup',   offKey);
  document.removeEventListener('paste',   onPaste);
  window.removeEventListener('blur', dropKeys);
  canvas.remove(); hud.remove(); xp._sfCleanup = null;
  const matte = document.getElementById('sf-matte');
  if (matte) matte.remove();   // the letterbox backdrop must never outlive the game
}

let cheatBuf = '', nineKeyCount = 0, last9 = 0, eightKeyCount = 0, last8 = 0;
function skipToTheNine() {
  if (!alive || nineActive || bossActive || bossRiseT > 0) return;
  bossIntro = null;
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; breatherT = 0;
  summonTheNine();
}
function skipToWitchKing() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; corpses = []; breatherT = 0;
  nineActive = false; bossRiseT = 0; awaitExit = false; swActive = false; swState = ''; swFadeT = 0;
  wave = 5; nineDone = true; bossActive = true; waveQuota = 0;
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: '...gone.' })); allies = []; }
  beginBossIntro('witchking', () => {
    enemies.push(makeEnemy('witchking', GW / 2, 60));
    banner = 'the Witch-king of Angmar'; bannerSub = 'no living man may hinder him'; bannerT = 150;
    sfSfx.screech(); shake = 16;
  });
}
function skipToPreStarWars() {
  if (!alive) return;
  stopSfMusic();
  bossIntro = null;
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; corpses = []; breatherT = 0;
  nineActive = false; bossActive = false; bossRiseT = 0; swActive = false; swState = ''; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0; awaitExit = true;
  banner = 'the Witch-king is no more'; bannerSub = 'run east —'; bannerT = 120;
}
function skipToVader() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0;
  startStarWars();                          // build the corridor (starfield, west-wall spawn)
  enemies = []; arrows = []; swTroopersLeft = 0;  // skip the trooper squad entirely
  armSaberAll(true); saberPickup = null;     // hand the heroes the lightsaber outright
  vaderActive = true; swState = 'vader';
  beginBossIntro('vader', () => {
    banishAllies();                          // the duel is his alone
    const vx = player.x < GW / 2 ? GW - 70 : 70;
    enemies.push(makeEnemy('vader', vx, GH / 2));
    banner = 'DARTH VADER'; bannerSub = 'the dark lord bars your path'; bannerT = 150;
    score += 500; addMeter(30); sfSfx.saber();
  });
}
function skipToSidious() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0;
  startStarWars();                          // build the void, then drop straight to the Emperor
  enemies = []; arrows = []; warns = []; swTroopersLeft = 0; vaderActive = false;
  beginBossIntro('sidious', startSidious);
}
function skipToJojo() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0; sidFinale = null;
  wave = 5; nineDone = true; waveQuota = 0;
  beginBossIntro('dio', startJojo);
}
function skipToIan() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  sidFinale = null; dioFinale = null; jojoActive = false; swActive = false;
  wave = 5; nineDone = true; waveQuota = 0;
  enemies = []; arrows = []; warns = []; mournful = false; endless = false;
  beginBossIntro('ian', startIan);
}
