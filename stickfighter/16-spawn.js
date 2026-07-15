// ── spawn — spawning: edgePoint, rollType, rollElite, makeEnemy ──
/* ── spawning ── */
function edgePoint() {
  for (let i = 0; i < 8; i++) {
    const side = Math.floor(rnd() * 4);
    let x, y;
    if      (side === 0) { x = rnd() * GW; y = 30; }
    else if (side === 1) { x = GW - 30; y = rnd() * GH; }
    else if (side === 2) { x = rnd() * GW; y = GH - 30; }
    else                 { x = 30; y = rnd() * GH; }
    if (Math.hypot(x - player.x, y - player.y) > KEEP_OUT * 2) return { x, y };
  }
  return { x: 30, y: 30 };
}

function rollType() {
  // the goblin SHAMAN (endless wave 8+ / hard mode wave 4+): a rare support piece —
  // it never attacks, it makes everything else worse (see the shaman branch +
  // shamanHaste). At most two afield (counting pending warns), so it stays a
  // priority target, not a wall.
  if ((endless || hardMode) && wave >= (hardMode ? 4 : 8) &&
      enemies.filter(s => s.type === 'shaman' && !s.dead).length +
      warns.filter(w => w.type === 'shaman').length < 2 &&
      rnd() < 0.08) return 'shaman';
  // the goblin BOMBARDIER (endless wave 10+ / hard mode wave 6+): long-range area
  // denial — its kegs make the floor itself unsafe (and wound the horde too: bait
  // the shot). ≤2 afield.
  if ((endless || hardMode) && wave >= (hardMode ? 6 : 10) &&
      enemies.filter(s => s.type === 'bomber' && !s.dead).length +
      warns.filter(w => w.type === 'bomber').length < 2 &&
      rnd() < 0.07) return 'bomber';
  const r = rnd();
  // hard mode: every type phases in one wave early (wolves join the very first band)
  if (wave >= (hardMode ? 3 : 4) && r < 0.15) return 'troll';
  if (wave >= (hardMode ? 2 : 3) && r < 0.35) return 'archer';
  if (wave >= (hardMode ? 1 : 2) && r < 0.6) return 'wolf';
  return 'goblin';
}

// endless-only ELITE variants — one harder cousin per base sprite, phased in by
// depth (the roll's odds grow with wave). Returns a TIER: 0 none · 1 elite
// (double points) · 2 DREAD (rare, wave 9+, quadruple points).
//   tier 1: shield-bearer goblin (blocks one hit) · frost wolf (chills on a close
//           pass) · volley archer (three-arrow fan) · bull troll (5 HP, enrages)
//   tier 2: goblin warlord (tower shield blocks two, faster) · dire frost wolf
//           (the chill is a 90px AURA) · deadeye (five faster arrows) · dread
//           troll (8 HP, roars into a harder enrage)
function rollElite() {
  if (!endless && !hardMode) return 0;
  // hard mode runs the elite math five waves deep: elites stalk from wave 1
  // (gently), and the dread tier arrives by wave 4 instead of 9
  const w = wave + (hardMode ? 5 : 0);
  if (rnd() >= Math.min(0.5, 0.06 * (w - 5))) return 0;
  // a rolled elite may ascend to the dread tier — rarer, and only in deep waves
  return w >= 9 && rnd() < Math.min(0.25, 0.04 * (w - 8)) ? 2 : 1;
}

function makeEnemy(type, x, y, elite) {
  const e = { type, x, y, vx: 0, vy: 0, phase: rnd() * Math.PI * 2,
              grz: 0, stun: 0 };
  if (type === 'goblin') { e.spd = Math.min(2.6, 1.35 + wave * 0.15); e.kr = 14; }
  if (type === 'wolf')   { e.spd = 1.15; e.kr = 13; e.mode = 'stalk'; e.st = 70; }
  if (type === 'archer') { e.spd = 1.5; e.kr = 12; e.mode = 'approach'; e.st = 40; }
  if (type === 'troll')  { e.spd = Math.min(1.5, 0.8 + wave * 0.06); e.kr = 26; e.hp = 3; }
  // MARKED (bane): the open-field horde walks faster — the scripted bosses keep their tuned pace
  if (type === 'goblin' || type === 'wolf' || type === 'archer' || type === 'troll') e.spd *= bn.foeSpd;
  if (type === 'shaman') {
    // endless support: harmless to touch, 2 HP — it rides with the warband,
    // shrieking the pack into a frenzy and blinking clear of hunters
    e.spd = 1.35; e.kr = 0; e.hp = 2; e.st = 90;
    e.blinkCd = 0; e.frenzyT = 0; e.frenzyCd = 160;
    if (!shamanSeen) {
      shamanSeen = true;
      banner = 'a goblin SHAMAN drives the warband'; bannerSub = 'silence it, or fight a frenzied horde'; bannerT = 130;
    }
  }
  if (type === 'bomber') {
    // endless artillery: harmless to touch, shy, 2 HP — but its kegs shell the floor
    e.spd = 1.2; e.kr = 0; e.hp = 2; e.mode = 'roam'; e.st = 120;
    if (!bomberSeen) {
      bomberSeen = true;
      banner = 'a goblin BOMBARDIER wheels its kegs in'; bannerSub = 'the red ring is the landing zone — its own horde is not spared'; bannerT = 140;
    }
  }
  // endless elites (see rollElite): tinted, one behavior tweak per tier, 2×/4× points
  if (elite && (type === 'goblin' || type === 'wolf' || type === 'archer' || type === 'troll')) {
    e.elite = elite;                                // 1 = elite · 2 = dread
    if (type === 'goblin') { e.hp = elite === 2 ? 3 : 2; if (elite === 2) e.spd *= 1.25; }  // buckler eats one blow; the warlord's tower shield eats two
    if (type === 'troll') e.hp = elite === 2 ? 8 : 5;   // bull troll / dread troll — both enrage low
    if (elite === 2 && !dreadSeen) {
      dreadSeen = true;
      banner = 'a DREAD elite takes the field'; bannerSub = 'the endless dark has champions of its own'; bannerT = 140;
    } else if (!eliteSeen) {
      eliteSeen = true;
      banner = 'the endless dark breeds ELITES'; bannerSub = 'tinted foes fight back harder'; bannerT = 130;
    }
  }
  if (type === 'ogre') {
    // a horde mini-boss: lumbers, telegraphs, then bull-rushes straight across the field
    const bandO = partySize() - 1;   // the ogre toughens with the party
    e.spd = 1.25; e.kr = 30; e.hp = 8 + bandO * 3; e.maxhp = e.hp; e.mode = 'stalk'; e.st = 80; e.lx = 0; e.ly = 0;
  }
  if (type === 'wraith') {
    // the Nine harden with the party (2P/3P take 3 blows, a full band 4)
    e.spd = 2.6; e.kr = 14; e.hp = 2 + Math.ceil((partySize() - 1) / 2); e.mode = 'circle';
    // keep the bearing it spawned at so the ring forms without crossing paths
    e.slot = Math.atan2(y - player.y, x - player.x) - frame * 0.004;
    e.ring = Math.hypot(x - player.x, y - player.y) || 300;
  }
  if (type === 'witchking') {
    // rises mounted on a fell beast; a few hits down the beast, then he fights on foot
    const bandK = partySize() - 1;   // the king endures more blades
    e.spd = 2.88; e.kr = 24; e.mountMax = 4 + bandK; e.footMax = 6 + bandK * 2; e.hp = e.mountMax;
    e.mounted = true; e.mode = 'hover'; e.st = 80; e.flailAng = 0;
  }
  if (type === 'trooper') {
    // marches into formation, then fires; harmless to touch — only the blasters kill
    e.kr = 0; e.hp = 1; e.mode = 'march'; e.fireT = 0;
  }
  if (type === 'vader') {
    // a proper duel: advances, telegraphs, melee slashes AND Force powers; escalates at half health
    const bandV = partySize() - 1;
    e.spd = 1.5; e.kr = 20; e.hp = 10 + bandV * 3; e.maxhp = e.hp;
    e.mode = 'advance'; e.st = 50; e.slashAng = 0;
    e.phase2 = false; e.power = null; e.combo = false; e.disarmed = false;
    e.intro = 50;   // a brief menacing entrance: holds position, harmless to touch — no instant spawn-kill
  }
  if (type === 'sidious') {
    // Clone Wars Sidious: fast & acrobatic, twin red sabers, a spin attack and Force lightning;
    // at half HP he stows the sabers and turns to pure lightning (e.phase2)
    const bandS = partySize() - 1;
    e.spd = 2.7; e.kr = 17; e.hp = 14 + bandS * 4; e.maxhp = e.hp;
    e.mode = 'enter'; e.st = 60; e.spinAng = 0; e.lit = 0; e.hop = 0;
    e.phase2 = false; e.castKind = 'bolt';
  }
  if (type === 'guard') {
    // Royal Guard: red robe + force pike. stalks, telegraphs, lunges. contact-lethal.
    e.spd = 1.55; e.kr = 14; e.hp = 2; e.mode = 'idle'; e.st = 50; e.pike = 0;
  }
  if (type === 'dio') {
    // DIO + The World: trolls you with stopped time, then knives / MUDA rushes / the road roller
    const bandD = partySize() - 1;
    e.spd = 1.95; e.kr = 17; e.hp = 16 + bandD * 4; e.maxhp = e.hp;   // a deliberate saunter — readable, not frantic
    e.mode = 'troll'; e.tstep = 0; e.tt = 0; e.st = 0; e.stand = 0; e.cape = 0; e.rollerDone = false;
  }
  if (type === 'ian') {
    // the creator: unarmed, harmless, never attacks — the fight is a choice, not a duel
    e.kr = 0; e.hp = 99; e.mode = 'idle'; e.phase = 0; e.crumble = 0; e.fade = 1;
  }
  return e;
}
