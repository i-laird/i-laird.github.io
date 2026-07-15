// ── hero-actions — enemyColor, movement, dash, swing/shoot/cast/scythe, summons, the Nine ──
function enemyColor(e) {
  if (e.flashT > 0 && sfOpts.flash > 0) return '#ffffff';   // impact frame — the flash outranks everything (player-optional)
  if (freezeT > 0 || e.stun > 0 || e.frozen > 0) return '#8fd8ff';
  if (e.type === 'wraith')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#5d4f8a' : '#16121e';
  if (e.type === 'witchking')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#7e57c2' : '#14101c';
  if (e.type === 'trooper')
    return (swState === 'fire' && e.fireT < 10 && (api.reduceMotion || Math.floor(frame / 3) % 2 === 0)) ? '#ffd0d0' : '#f4f7f9';
  if (e.type === 'vader') {
    const tell = api.reduceMotion || Math.floor(frame / 4) % 2 === 0;
    if ((e.mode === 'cast' || e.mode === 'choke') && tell) return '#3a2d4a';  // Force telegraph (violet)
    if (e.mode === 'wind' && tell) return '#3a3a3a';                          // melee tell (grey)
    return e.phase2 ? '#140a0a' : '#0a0a0a';
  }
  if (e.type === 'sidious') {
    const tell = api.reduceMotion || Math.floor(frame / 4) % 2 === 0;
    if (e.mode === 'cast' && tell) return '#3a2750';   // lightning telegraph (violet)
    if (e.mode === 'wind' && tell) return '#2f2f33';   // spin tell (grey)
    return '#0a0a10';
  }
  if (e.type === 'guard') {
    if (e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0)) return '#ff6b6b';
    return '#9b1c1c';
  }
  if (e.type === 'dio') return '#1f1b29';   // drawDio uses its own palette
  if (e.type === 'shaman') return '#7a9a52'; // sickly moss — the chanting robe
  if (e.type === 'bomber')
    return e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#ffb3a0' : '#a1662f';  // powder-brown; flushes as the fuse burns
  if (e.type === 'ogre')
    return e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#a1452f' : '#6d4c41';
  if (e.type === 'troll') {
    if (e.elite) {
      // bull troll: rust hide; dread troll: near-black — both pulse furnace-red
      // once enraged (steady when reduced motion)
      const raging = e.hp <= (e.elite === 2 ? 3 : 2) && (api.reduceMotion || Math.floor(frame / 5) % 2 === 0);
      if (raging) return e.elite === 2 ? '#e64a19' : '#c0392b';
      return e.elite === 2 ? '#3e2723' : '#7f3b30';
    }
    return '#5d4037';
  }
  if (e.type === 'archer')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : e.elite === 2 ? '#b06858' : e.elite ? '#d8a89a' : '#cfc8a0';
  if (e.type === 'wolf')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : e.elite === 2 ? '#e8f4fb' : e.elite ? '#8fc7e8' : '#546e7a';
  // shield-bearer goblins are bronze; the warlord gleams brass-gold
  return e.elite === 2 ? '#c9a227' : e.elite ? '#8d6e63' : '#1b5e20';
}

// shared per-hero movement physics (friction, speed cap, dash trail, charge recharge).
// Called once per hero per tick; in single-player it's only ever player, so behaviour
// (and RNG consumption — there is none here) is identical to the old inline block.
function moveHero(h, ix, iy) {
  // a frost-wolf chill drags the hero's acceleration and top speed (dash unaffected — the escape valve)
  const chill = (h.chillT > 0 ? 0.55 : 1) * bn.spd * h.bn.spd;   // banes are global, Fleet Foot is the picker's own
  if (h.chillT > 0) h.chillT--;
  // the dragoon rides Joust physics: heavy glide (little friction), sluggish
  // steering, and a far higher ceiling — momentum is the class's whole weapon.
  // The wyrm (the co-op pair's beast) shares them wholesale.
  const drag = h.cls === 'dragoon' || h.cls === 'wyrm';
  const fr = drag ? 0.93 : 0.86, ac = drag ? 0.3 : 0.62;
  h.vx = h.vx * fr + ix * ac * chill;
  h.vy = h.vy * fr + iy * ac * chill;
  const pv = Math.hypot(h.vx, h.vy);
  const cap = (drag ? DRAG_CAP * up.dragCap : 4.3) * chill;
  // the speed cap lifts during a dash and while reeling from a Force push, so the shove carries
  if (h.dashT <= 0 && h.stunT <= 0 && (h.choke || 0) <= 0 && pv > cap) { h.vx *= cap / pv; h.vy *= cap / pv; }
  h.x = clamp(h.x + h.vx, 14, GW - 14);
  h.y = clamp(h.y + h.vy, 40, GH - 10);
  if (pv > 0.4) h.phase += 0.06 + pv * 0.045;
  if (h.dashT > 0) {
    h.dashT--;
    if (h.cls !== 'wyrm') ghosts.push({ x: h.x, y: h.y, phase: h.phase, t: 16, cls: h.cls, dir: h.fx >= 0 ? 1 : -1 });   // the beast leaves dust, not afterimages
    // Phantom Strike: dashing through a foe staggers it (the no-flinch bosses shrug it off)
    if (up.dashStrike) {
      for (const e of enemies) {
        if (untouchable(e) || e.frozen > 0 || e.stun > 0) continue;
        if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') continue;
        if (Math.hypot(e.x - h.x, e.y - h.y) < 22) {
          e.stun = 20; e.vx = 0; e.vy = 0;
          sparks.push({ x: e.x, y: e.y - 28, t: 12, color: '#80deea', txt: '✦' });
        }
      }
    }
  }
  if (h.iframe > 0) h.iframe--;   // post-shield invulnerability beat
  if (h.dashCharges < up.dashMax && h.rechargeT > 0 && --h.rechargeT <= 0) {
    h.dashCharges++;
    if (h.dashCharges < up.dashMax) h.rechargeT = up.dashCd;  // chain refills
  }
}

function tryDash(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.choke || 0) > 0 || h.dashT > 0 || h.dashCharges <= 0) return;
  const d = Math.hypot(h.fx, h.fy) || 1;
  h.vx = h.fx / d * 11;
  h.vy = h.fy / d * 11;
  h.dashT = up.dashLen;
  h.dashCharges--;
  if (h.rechargeT <= 0) h.rechargeT = up.dashCd;  // start refilling
  sfSfx.dash();
}

function trySwing(h) {
  // Cooldown is gated on the sim tick (not performance.now) so it's part of the
  // deterministic state. up.swingMs stays in ms for the upgrade defs; convert here.
  // The blade (Excalibur / lightsaber) is the run's shared resource — in co-op either
  // hero may wield it, each on their own swing timer (h.swingT / h.swingReadyTick).
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.swordT <= 0 && !h.heldSaber) || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.swingMs * SIM_HZ / 1000); h.swingT = 10;
  h.heldSaber ? sfSfx.saberHit() : sfSfx.swing();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const fx = h.fx / fd, fy = h.fy / fd;
  const kills0 = kills;
  for (const e of enemies) {
    // bosses are untouchable while they run a scripted, non-aggressive intro — no cheesing them first
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > up.swingR + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
    if ((dx / d) * fx + (dy / d) * fy < -0.2) continue;  // ~220° cleave in front
    if (e.hp && --e.hp > 0) {
      e.flashT = 2;   // impact frames (see rangedHit)
      if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
        // bosses / the war-ogre don't flinch — a brief parry stagger, no stunlock
        e.stun = Math.max(e.stun || 0, e.type === 'ogre' ? 10 : 6);
        sparks.push({ x: e.x, y: e.y - 34, t: 14, color: '#ff8a80', txt: e.type === 'dio' ? 'CLANG' : 'CLASH' });
        sfSfx.saberHit();
      } else {
        e.stun = 18; sfSfx.thud();
        e.x = clamp(e.x + dx / d * 50, -60, GW + 60);
        e.y = clamp(e.y + dy / d * 50, -60, GH + 60);
        sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#fff', txt: (e.type === 'wraith' || e.type === 'witchking') ? 'SCREECH' : 'CLANG' });
      }
    } else killEnemy(e);
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain > 0) shake = Math.max(shake, Math.min(10, 2 + slain * 2));
  for (let i = arrows.length - 1; i >= 0; i--) {  // the blade meets the bolts
    const a = arrows[i];
    if (a.kind === 'parrow') continue;            // never bat a partner's arrows out of the air
    const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d < up.swingR + 20 && (dx / d) * fx + (dy / d) * fy > -0.2) {
      sparks.push({ x: a.x, y: a.y, t: 12, color: '#fff', txt: '✦' });
      if (a.kind === 'laser') {
        // deflect the blaster bolt off in a random direction — now yours, lethal to troopers
        const ang = rnd() * Math.PI * 2;
        const spd = Math.hypot(a.vx, a.vy) || 5.2;
        a.vx = Math.cos(ang) * spd; a.vy = Math.sin(ang) * spd;
        a.reflected = true; a.t = 240;
      } else if (up.riposte && a.kind !== 'vsaber') {
        // Riposte: the batted shot is yours now — it flies on away from you
        a.kind = 'parrow'; a.dmg = 1; a.pierce = 0; a.hitSet = null;
        a.bounces = up.ricochet ? 1 : 0;
        a.vx = dx / d * 6.5; a.vy = dy / d * 6.5; a.t = 120;
      } else {
        arrows.splice(i, 1);  // ordinary arrows are just batted out of the air
      }
    }
  }
}

/* ── the other class kits: the attack key dispatches by h.cls ── */
function tryAttack(h) {
  if (!h) return;
  if (h.cls === 'ranged') return tryShoot(h);
  if (h.cls === 'caster') return tryCast(h);
  if (h.cls === 'necro') return tryScythe(h);
  if (h.cls === 'dragoon' || h.cls === 'wyrm') return tryFlap(h);
  if (h.cls === 'rider') return tryLance(h);
  return trySwing(h);
}
/* ── the rider (the co-op pair's saddle seat) ──
   Mounted, the rider never steers — their movement keys are an 8-way TURRET AIM
   (set in the loop's P2 block) and the attack key JABS a lance along it: the
   nearest foe in a narrow cone takes a rangedHit. Thrown/dismounted, the same
   key is a short desperate stab. Lance kills top up the shared heat gauge. */
function tryLance(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.max(8, Math.round(up.jabT)); h.swingT = 8;
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  const reach = h.mounted ? up.riderReach : 34;
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > e.kr + reach) continue;
    if ((dx / d) * ux + (dy / d) * uy < 0.6) continue;   // a jab, not a sweep
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) { sfSfx.blip(); return; }
  sfSfx.thud();
  if (rangedHit(best, 1, ux, uy) && p2 && p2.cls === 'rider') heat = Math.min(up.heatMax, heat + HEAT_LANCE);
  enemies = enemies.filter(e => !e.dead);
}
// FIRE BREATH — the rider's spender (the spell-cycle key, E): drinks BREATH_COST
// from the shared heat gauge and rakes a cone along the aim. Bosses stagger by
// the usual no-flinch rules; the pack burns. Only tramples and lance kills
// refill the gauge — the beast earns, the rider spends.
function tryBreath(h) {
  if (!h || h.down || !h.mounted || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0) return;
  if (heat < up.breathCost) {
    sparks.push({ x: h.x, y: h.y - 20, t: 12, color: '#ff8a65', txt: 'no heat' });
    sfSfx.blip();
    return;
  }
  heat -= up.breathCost;
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  fieldWashSet('255,120,40', 0.12, 32);   // (render-only)
  addDecal(h.x + ux * BREATH_R * 0.5, h.y + uy * BREATH_R * 0.5, 'scorch');
  sfSfx.bomb(); shake = Math.max(shake, 6);
  blasts.push({ kind: 'fire', x: h.x + ux * BREATH_R * 0.45, y: h.y + uy * BREATH_R * 0.45, r: 0, t: 0, life: 22, rMax: BREATH_R * 0.6 });
  const kills0 = kills;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > BREATH_R + e.kr) continue;
    if ((dx / d) * ux + (dy / d) * uy < up.breathCone) continue;   // a tight cone along the aim
    rangedHit(e, up.breathDmg, ux, uy);
    if (!e.dead && e.hp > 0) e.stun = Math.max(e.stun || 0, 24);   // scorched
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain >= 4) sfUnlock('dragonfire');
  if (slain > 1) sparks.push({ x: h.x + ux * 60, y: h.y - 30, t: 16, color: '#ff8a65', txt: slain + ' BURNED' });
}
/* ── the dragoon (arcade JOUST) ──
   The attack key carries no weapon at all — it's a WING FLAP, an impulse along the
   facing that buys speed and direction changes on a short tick cooldown. The lance
   does all the killing, and the lance IS your velocity (see joustSweep). */
function tryFlap(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.choke || 0) > 0 || tick < (h.flapReadyTick || 0)) return;
  h.flapReadyTick = tick + Math.max(6, Math.round(up.flapCd));
  h.flapT = tick;
  const d = Math.hypot(h.fx, h.fy) || 1;
  h.vx += h.fx / d * FLAP_IMP;
  h.vy += h.fy / d * FLAP_IMP;
  if (h.cls !== 'wyrm') ghosts.push({ x: h.x, y: h.y, phase: h.phase, t: 12, cls: h.cls, dir: h.fx >= 0 ? 1 : -1 });
  sfSfx.flap();
}
// a foe's skewer bar: how fast the lance must fly to take it (null = unjoustable)
function joustBar(e) {
  const b = JOUST_BAR[e.type];
  if (b === undefined) return null;   // ian — the choice is not made with a lance
  return b + (e.elite === 2 ? JOUST_DREAD : e.elite ? JOUST_ELITE : 0);
}
/* the JOUST itself: runs every tick per mounted hero, BEFORE the contact loop.
   Any foe inside lance reach, roughly ahead of the velocity, with the rider at or
   above its skewer bar, takes a lance hit (rangedHit rules — bosses stagger and
   never die to a pass; grunts are skewered clean). A SURVIVOR caroms the rider off
   Joust-style — reflect off the contact normal — so momentum never carries you
   into a body you only wounded. Below the bar (or hit from the flank) nothing
   happens here, and the ordinary touch-death contact loop right after this is the
   "or you die" half of the rule. Consumes no rnd(); safe for lockstep and replays. */
function joustSweep(h) {
  if (dioStopT > 0 || ianActive) return;              // stopped time / the choice — no lance
  const pv = Math.hypot(h.vx, h.vy);
  if (pv < 2) return;                                 // barely moving — the lance hangs slack
  const ux = h.vx / pv, uy = h.vy / pv;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    if (tick < (e.joustTick || 0)) continue;          // one hit per pass
    const bar = joustBar(e);
    if (bar === null || pv < bar) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > e.kr + PLAYER_R + LANCE_R + up.lanceR + (h.cls === 'wyrm' ? WYRM_R : 0)) continue;
    if ((dx / d) * ux + (dy / d) * uy < 0.35) continue;   // the lance points where you fly
    e.joustTick = tick + 26;
    const survived = !rangedHit(e, up.joustDmg, ux, uy);
    sparks.push({ x: (h.x + e.x) / 2, y: (h.y + e.y) / 2 - 20, t: 14, color: DRAGOON_COL, txt: h.cls === 'wyrm' ? 'TRAMPLE' : 'SKEWER' });
    if (!survived && h.cls === 'wyrm') {
      heat = Math.min(up.heatMax, heat + HEAT_TRAMPLE + up.heatTrampleB);   // the beast earns
      trampleN++;
      if (trampleN >= 15) sfUnlock('trampler');
    }
    if (!survived && h.cls === 'dragoon' && e.type === 'troll') sfUnlock('skewered');
    if (survived) {
      // carom: bounce off the contact normal, keep most of the speed
      const nx = dx / d, ny = dy / d;
      const vn = h.vx * nx + h.vy * ny;
      if (vn > 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
      h.vx *= 0.9; h.vy *= 0.9;
      h.x = clamp(h.x - nx * 6, 14, GW - 14);
      h.y = clamp(h.y - ny * 6, 40, GH - 10);
    } else {
      if (h.bn.cry) knockback(e.x, e.y, 0, 60, 12);   // SHRILL CRY: the picker's kills scatter the pack
      if (up.tailwind) {                              // Tailwind: a kill feeds the gallop
        const s = Math.min(1.15, (DRAG_CAP * up.dragCap) / Math.max(pv, 0.1));
        h.vx *= s; h.vy *= s;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);
}
// foes the player cannot damage yet (scripted intros) — mirrors trySwing's skip rules
function untouchable(e) {
  return e.dead ||
         (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) ||
         ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0);
}
// an arrow/bolt lands on e: the blade's no-flinch rules, with a gentler shove
function rangedHit(e, dmg, ux, uy) {
  if (e.hp && (e.hp -= dmg) > 0) {
    e.flashT = 2;   // impact frames: the survivor blazes white for a beat (persists through hit-stop)
    if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
      e.stun = Math.max(e.stun || 0, e.type === 'ogre' ? 10 : 6);
      sparks.push({ x: e.x, y: e.y - 34, t: 14, color: '#ff8a80', txt: 'TSSS' });
      sfSfx.saberHit();
    } else {
      e.stun = 14; sfSfx.thud();
      e.x = clamp(e.x + ux * 16, -60, GW + 60);
      e.y = clamp(e.y + uy * 16, -60, GH + 60);
      sparks.push({ x: e.x, y: e.y - 30, t: 12, color: '#fff', txt: (e.type === 'wraith' || e.type === 'witchking') ? 'SCREECH' : 'THUNK' });
    }
    return false;
  }
  killEnemy(e);
  return true;
}
// ranged: the bow is always strung — a skill shot, not a homing one. The arrow
// flies in the direction being held (8-way, diagonals included); release the keys
// and it fires along the last facing. Aim by footwork.
function tryShoot(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.shotMs * SIM_HZ / 1000); h.swingT = 8;
  sfSfx.arrow();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  const n = up.shotCount, spread = 0.16;
  const spd = ARROW_SPD * up.arrowSpd;                       // Long Draw: faster, farther
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spread;
    const ca = Math.cos(off), sa = Math.sin(off);
    arrows.push({ x: h.x + ux * 12, y: h.y - 18 + uy * 12, kind: 'parrow',
                  vx: (ux * ca - uy * sa) * spd, vy: (ux * sa + uy * ca) * spd,
                  t: Math.round(110 * up.arrowSpd), dmg: up.shotDmg, pierce: up.shotPierce,
                  bounces: up.ricochet ? 1 : 0, hitSet: null });
  }
}
/* ── the wizard's spellbook (see SPELLS) ──
   The attack key casts the SELECTED page: a deliberate incantation — mana is
   drunk up front, the staff orb swells in the spell's color for `cast` ticks,
   then resolveCast() fires it. A press with no mana or no mark in reach fizzles
   free (no cooldown, no mana); a cast whose mark dies mid-incantation refunds
   half. Kills spark +4 mana each (Overcharge refunds much of a killing cast),
   so bold play sustains itself where hiding runs dry. */
function heroSpells() { return up.spells; }     // the party's known pages, in learn order
function curSpell(h) { return heroSpells()[(h.spellSel || 0) % heroSpells().length] || 'bolt'; }
// the cycle key turns the page — queued through pend like every combat input,
// recorded as opcode 11 (the selection changes what the attack key DOES)
function cycleSpell(h) {
  if (!h || h.cls !== 'caster' || h.down || !started || !alive || paused ||
      sidFinale || dioFinale || dioStopT > 0 || ianActive || h.castT > 0) return;
  const n = heroSpells().length;
  if (n < 2) { sparks.push({ x: h.x, y: h.y - 42, t: 14, color: '#ce93d8', txt: 'one page…' }); return; }
  h.spellSel = ((h.spellSel || 0) + 1) % n;
  const sp = SPELLS[curSpell(h)];
  sparks.push({ x: h.x, y: h.y - 44, t: 20, color: sp.col, txt: sp.icon + ' ' + sp.name });
  sfSfx.blip();
}
function nearestFoe(h, r) {
  let t = null, bd = r;
  for (const e of enemies) {
    if (untouchable(e)) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d < bd) { bd = d; t = e; }
  }
  return t;
}
function tryCast(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || h.castT > 0 || tick < h.swingReadyTick) return;
  const key = curSpell(h), sp = SPELLS[key];
  if (h.mana < sp.cost) {                       // the well is dry — fizzle free
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 12, color: '#7986cb', txt: 'no mana' });
    sfSfx.blip();
    return;
  }
  // every page but the nova needs a mark in reach at the moment of the press
  const reach = key === 'bolt' ? ZAP_R : key === 'fire' ? FIRE_TGT_R : STORM_R;
  if (key !== 'nova' && !nearestFoe(h, reach)) {
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 10, color: '#ce93d8', txt: '·' });
    return;
  }
  h.mana -= sp.cost;                            // committed — the incantation drinks up front
  h.manaHoldTick = tick + MANA_HOLD;            // ...and the well holds its breath (no regen for a beat)
  h.swingReadyTick = tick + Math.round(up.zapMs * SIM_HZ / 1000);
  const castT = Math.max(4, Math.round(sp.cast * h.bn.castMul));   // Flicker Cast trims the picker's wind-up
  h.castT = castT; h.castMax = castT; h.casting = key;
  sfSfx.bolt();
}
// the wind-up completes: the spell resolves against the field as it is NOW
// (each targeted page re-marks with a little grace, since foes had `cast`
// ticks to drift). Returns are routed so a slipped mark refunds half.
function resolveCast(h) {
  const key = h.casting || 'bolt', sp = SPELLS[key];
  h.casting = null;
  const kills0 = kills;
  let landed = true;
  if (key === 'nova') castNova(h);
  else if (key === 'fire') landed = castFire(h);
  else if (key === 'storm') landed = castStorm(h);
  else landed = castBolt(h);
  if (!landed) {                                // the mark slipped away mid-incantation
    h.mana = Math.min(up.manaMax, h.mana + Math.round(sp.cost / 2));
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 10, color: '#ce93d8', txt: 'fzzt' });
    return;
  }
  h.swingT = 10;
  const slain = kills - kills0;                 // soul sparks: kills feed the well (Siphon doubles them)
  if (slain > 0) {
    const back = slain * (h.bn.sparks2 ? 10 : 5) + (up.overcharge ? Math.round(sp.cost * 0.3) : 0);
    h.mana = Math.min(up.manaMax, h.mana + back);
    sparks.push({ x: h.x, y: h.y - 34, t: 12, color: '#b39ddb', txt: '🔮+' + back });
  }
}
// ARCANE BOLT — the signature: arcs to the nearest foe and chains up.zapJumps hops
function castBolt(h) {
  const t = nearestFoe(h, ZAP_R + 40);
  if (!t) return false;
  sfSfx.zap();
  const pts = [{ x: h.x, y: h.y - 16 }];
  const hit = new Set();
  let from = t;
  for (let j = 0; j < up.zapJumps && from; j++) {
    hit.add(from);
    const prev = pts[pts.length - 1];
    const dv = Math.hypot(from.x - prev.x, (from.y - 14) - prev.y) || 1;
    pts.push({ x: from.x, y: from.y - 14 });
    rangedHit(from, 1, (from.x - prev.x) / dv, ((from.y - 14) - prev.y) / dv);
    let nx = null, nd = ZAP_HOP;                // the arc leaps on to the next foe
    for (const e of enemies) {
      if (untouchable(e) || hit.has(e)) continue;
      const dd = Math.hypot(e.x - from.x, e.y - from.y);
      if (dd < nd) { nd = dd; nx = e; }
    }
    from = nx;
  }
  blasts.push({ kind: 'chain', pts, t: 0, life: 16 });
  return true;
}
// FROST NOVA — an ice ring around the caster; always erupts (positioning IS the aim)
function castNova(h) {
  sfSfx.freeze();
  addDecal(h.x, h.y, 'frost');   // (render-only) a bloom the field remembers
  blasts.push({ kind: 'frost', x: h.x, y: h.y, r: 0, t: 0, life: 26, rMax: NOVA_R });
  let n = 0;
  for (const e of enemies) {
    // same immunities as the frost powerup — the great bosses shrug off the cold
    if (e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'wraith') continue;
    if (untouchable(e)) continue;
    if (Math.hypot(e.x - h.x, e.y - h.y) < NOVA_R) { e.frozen = 240; e.vx = 0; e.vy = 0; n++; }  // briefer than the powerup's FROST_DUR
  }
  sparks.push({ x: h.x, y: h.y - 36, t: 24, color: '#8fd8ff', txt: n ? 'FROZEN x' + n : 'frost nova' });
}
// FIREBALL — hurled at the nearest mark; erupts THERE (kill + shove, like the powerup)
function castFire(h) {
  const t = nearestFoe(h, FIRE_TGT_R + 40);
  if (!t) return false;
  const cx = t.x, cy = t.y;                     // the eruption outlives its mark
  sfSfx.bomb(); shake = Math.max(shake, 10);
  addDecal(cx, cy, 'scorch');   // (render-only)
  blasts.push({ kind: 'fire', x: cx, y: cy, r: 0, t: 0, life: 30, rMax: FIREB_R });
  knockback(cx, cy, FIREB_R, 180, 40);
  sparks.push({ x: cx, y: cy - 36, t: 24, color: '#ff8a65', txt: 'FWOOSH' });
  return true;
}
// TEMPEST — the Archmage's page: a great arc that leaps six marks, striking twice as hard
function castStorm(h) {
  const t0 = nearestFoe(h, STORM_R + 40);
  if (!t0) return false;
  sfSfx.zap(); shake = Math.max(shake, 8);
  const pts = [{ x: h.x, y: h.y - 16 }];
  const hit = new Set();
  let from = t0;
  for (let j = 0; j < 6 && from; j++) {
    hit.add(from);
    const prev = pts[pts.length - 1];
    const dv = Math.hypot(from.x - prev.x, (from.y - 14) - prev.y) || 1;
    pts.push({ x: from.x, y: from.y - 14 });
    rangedHit(from, 2, (from.x - prev.x) / dv, ((from.y - 14) - prev.y) / dv);
    let nx = null, nd = STORM_HOP;
    for (const e of enemies) {
      if (untouchable(e) || hit.has(e)) continue;
      const dd = Math.hypot(e.x - from.x, e.y - from.y);
      if (dd < nd) { nd = dd; nx = e; }
    }
    from = nx;
  }
  blasts.push({ kind: 'chain', pts, t: 0, life: 20 });
  sfUnlock('tempest');
  return true;
}
/* ── the necromancer's soul scythe ──
   One press, two verbs. First the REAP: a wide arc in front (rangedHit rules —
   bosses stagger, grunts shove), every kill feeding the soul well. Then the
   RAISE: husks caught in the sweep stand up as minions while souls and the
   cap allow (banned wherever champions are banned — boss rooms are yours alone). */
function tryScythe(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.scytheMs * SIM_HZ / 1000);
  h.swingT = 10;
  sfSfx.swing();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const fx = h.fx / fd, fy = h.fy / fd;
  const kills0 = kills;
  for (const e of enemies) {
    // the same scripted-intro protections as the blade
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > SCYTHE_R + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
    if ((dx / d) * fx + (dy / d) * fy < -0.1) continue;   // a wide reaping arc in front
    rangedHit(e, 1, dx / d, dy / d);
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain > 0) {
    const gain = slain * (SOUL_KILL + (up.reaper ? 3 : 0) + h.bn.soulBonus);
    h.souls = Math.min(SOULS_MAX, h.souls + gain);
    sparks.push({ x: h.x, y: h.y - 36, t: 14, color: NECRO_COL, txt: '+' + gain + ' souls' });
    shake = Math.max(shake, Math.min(8, 2 + slain * 2));
  }
  // the raise — nearest-pushed-last order doesn't matter; any husk in the sweep rises
  if (!champsBanned()) {
    for (let i = husks.length - 1; i >= 0; i--) {
      if (minions.length >= up.minionCap || h.souls < up.raiseCost) break;
      const k = husks[i];
      const dx = k.x - h.x, dy = k.y - h.y, d = Math.hypot(dx, dy) || 1;
      if (d > RAISE_R || (dx / d) * fx + (dy / d) * fy < -0.3) continue;
      husks.splice(i, 1);
      h.souls -= up.raiseCost;
      minions.push({ src: k.src, x: k.x, y: k.y, hp: up.minionHp + (k.elite ? 1 : 0),
                     t: Math.round(MINION_T * h.bn.minionMul),   // Restless: the picker's loans run longer
                     phase: 0, fx: 1, hitCd: 20, hurtCd: 30, shotCd: 60, elite: k.elite });
      if (minions.length >= 4) sfUnlock('army_4');
      blasts.push({ kind: 'frost', x: k.x, y: k.y, r: 0, t: 0, life: 16, rMax: 44 });
      sparks.push({ x: k.x, y: k.y - 30, t: 22, color: NECRO_COL, txt: 'RISE' });
      sfSfx.ignite();
    }
  }
}

function trySummon(kind) {
  if (!started || !alive || paused || champsBanned()) return;
  if (meter < up.summonCost || !up.champs[kind]) return;  // need a banked charge, and the ally unlocked
  if (allies.some(g => g.kind === kind)) return;          // one of each kind at a time
  meter -= up.summonCost; meterPrompted = false;          // spend one charge (keep the rest)
  const fromLeft = player.x > GW / 2;
  const champT = Math.round(CHAMP_T * up.champMul);
  const g = { kind, t: champT, t0: champT, x: fromLeft ? -30 : GW + 30, y: clamp(player.y, 60, GH - 30),
              side: fromLeft ? -1 : 1, shotCd: 40, arrived: false,
              slashCd: 0, slashT: 0, fx: 1, fy: 0, oraT: 0, oraCd: 30, target: null };
  if (kind === 'gandalf') {
    banner = 'YOU SHALL NOT PASS!'; bannerSub = 'the white wizard fights beside you';
    sfSfx.summon();
  } else if (kind === 'luke') {
    banner = '"I am a Jedi, like my father before me."'; bannerSub = 'a green blade hums to life';
    sfSfx.saber();
  } else {
    g.x = player.x + 50; g.y = player.y;  // Star Platinum needs no entrance — time stops instead
    banner = 'ZA WARUDO!'; bannerSub = 'time has stopped';
    freezeT = 130;
    sfSfx.zawarudo();
  }
  bannerT = 110;
  allies.push(g);
  sfUnlock('summoner');
  if (allies.length >= 3) sfUnlock('fellowship');
}

function championPrompt() {
  if (!started || !alive || paused || champsBanned() || meter < up.summonCost || !champUnlocked()) return;
  banner = 'summon an ally'; bannerSub = champReadyText(); bannerT = 150;
}

// the Nazgûl set piece: all nine at once, in a ring — and no champion to hide behind
function summonTheNine() {
  stopSfMusic();   // the horde theme dies here — the Nine arrive in silence
  wave = 5; nineActive = true; nineDone = false; wraithsLeft = 9; waveQuota = 0;
  bossActive = false; bossRiseT = 0;
  banner = 'the Nine'; bannerSub = 'they hunt as one — no champion can save you now'; bannerT = 140;
  sfSfx.screech();
  if (allies.length) {
    allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: '...gone.' }));
    allies = [];
  }
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    warns.push({ x: clamp(player.x + Math.cos(a) * 330, 30, GW - 30),
                 y: clamp(player.y + Math.sin(a) * 330, 50, GH - 20),
                 type: 'wraith', t: 60 });
  }
}
