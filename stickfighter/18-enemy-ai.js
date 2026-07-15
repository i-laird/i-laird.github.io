// ── enemy-ai — updateEnemy — the per-enemy AI state machines ──
/* ── enemy AI ── */
function updateEnemy(e) {
  if (e.grz > 0) e.grz--;
  if (e.stun > 0) { e.stun--; return; }
  if (e.frozen > 0) { e.frozen--; e.vx = 0; e.vy = 0; return; }  // encased in ice by the frost nova
  if (freezeT > 0) return;
  // the creator just kneels and trembles — he never moves on his own
  if (e.type === 'ian') { e.phase = (e.phase || 0) + 0.08; return; }
  // a world in mourning: the horde no longer hunts you — it just wanders, milling about aimlessly
  if (mournful && (e.type === 'goblin' || e.type === 'wolf' || e.type === 'archer' || e.type === 'troll')) {
    if (e.wt === undefined || --e.wt <= 0) {                 // pick a new gentle heading now and then
      e.wang = rnd() * Math.PI * 2;
      e.wt = 70 + rnd() * 150;
      e.wsp = 0.25 + rnd() * 0.6;
      if (rnd() < 0.25) e.wsp = 0;                   // sometimes just pause and rest
    }
    e.vx = Math.cos(e.wang) * (e.wsp || 0); e.vy = Math.sin(e.wang) * (e.wsp || 0);
    e.x += e.vx; e.y += e.vy;
    if (e.x < 22 || e.x > GW - 22) { e.wang = Math.PI - e.wang; e.x = clamp(e.x, 22, GW - 22); }  // turn at the walls
    if (e.y < 42 || e.y > GH - 14) { e.wang = -e.wang; e.y = clamp(e.y, 42, GH - 14); }
    e.phase += 0.05 + (e.wsp || 0) * 0.12;
    if (rnd() < 0.005) { const ox = rnd() * 8; if (!api.reduceMotion) sparks.push({ x: e.x - 4 + ox, y: e.y - 28, t: 32, color: '#8fd8ff', txt: '·' }); }
    return;
  }
  const tgt = hordeTarget(e);   // P1 for bosses/set-pieces; nearest standing hero for the open-field horde
  const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;

  if (e.type === 'goblin') {
    // steering with momentum so they swing wide on sharp turns
    const hz = shamanHaste(e);
    e.vx += dx / d * 0.085 * hz; e.vy += dy / d * 0.085 * hz;
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > e.spd * hz) { e.vx = e.vx / sp * e.spd * hz; e.vy = e.vy / sp * e.spd * hz; }
    e.x += e.vx; e.y += e.vy; e.phase += 0.22;
  } else if (e.type === 'shaman') {
    // the shaman still never attacks, but it rides WITH the warband: it shepherds
    // the pack from just behind the front line so the ritual circle covers the
    // chase, shrieks the kin into a frenzy when enough crowd the ring, mends
    // wounded trolls (and re-raises elite bucklers), and BLINKS clear in a puff
    // of chant-light when a hero closes in — hunting it down is a real chase now
    e.st--;
    if (e.blinkCd > 0) e.blinkCd--;
    if (e.frenzyT > 0) e.frenzyT--;
    if (e.frenzyCd > 0) e.frenzyCd--;
    // the pack it wards: centroid of the live open-field grunts
    let px = 0, py = 0, pn = 0;
    for (const g of enemies) {
      if (g === e || g.dead) continue;
      if (g.type === 'goblin' || g.type === 'wolf' || g.type === 'archer' || g.type === 'troll') { px += g.x; py += g.y; pn++; }
    }
    if (d < 120 && e.blinkCd <= 0) {
      // blink: reappear behind the pack (or anywhere clear of heroes if it has none)
      let bx = e.x, by = e.y, ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        if (pn) {
          const cx = px / pn, cy = py / pn;
          const hx = tgt.x - cx, hy = tgt.y - cy, hl = Math.hypot(hx, hy) || 1;
          bx = cx - hx / hl * (60 + rnd() * 60) + (rnd() - 0.5) * 70;
          by = cy - hy / hl * (60 + rnd() * 60) + (rnd() - 0.5) * 70;
        } else {
          const a = rnd() * Math.PI * 2;
          bx = e.x + Math.cos(a) * (220 + rnd() * 80);
          by = e.y + Math.sin(a) * (220 + rnd() * 80);
        }
        bx = clamp(bx, 26, GW - 26); by = clamp(by, 48, GH - 16);
        ok = true;
        for (const h of heroesLive()) if (Math.hypot(h.x - bx, h.y - by) < 190) ok = false;
      }
      if (ok) {
        sparks.push({ x: e.x, y: e.y - 24, t: 20, color: '#a5e88a', txt: '✦' });
        e.x = bx; e.y = by;
        sparks.push({ x: e.x, y: e.y - 24, t: 20, color: '#a5e88a', txt: '✦' });
        sfSfx.zap();
        e.blinkCd = 150;
      } else e.blinkCd = 40;     // nowhere safe to land — try again shortly
    } else if (d < 190) {
      e.x -= dx / d * e.spd * 1.2; e.y -= dy / d * e.spd * 1.2; e.phase += 0.11;
    } else if (pn) {
      // shepherd: hold station just behind the pack, relative to its quarry
      const cx = px / pn, cy = py / pn;
      const hx = tgt.x - cx, hy = tgt.y - cy, hl = Math.hypot(hx, hy) || 1;
      const wx = clamp(cx - hx / hl * 70, 26, GW - 26);
      const wy = clamp(cy - hy / hl * 70, 48, GH - 16);
      const sx2 = wx - e.x, sy2 = wy - e.y, sl = Math.hypot(sx2, sy2) || 1;
      if (sl > 24) { e.x += sx2 / sl * e.spd * 1.15; e.y += sy2 / sl * e.spd * 1.15; e.phase += 0.1; }
      else e.phase += 0.07;
    } else e.phase += 0.07;
    // the frenzy shriek: three kin in the ring → whip them into a sprint
    if (e.frenzyT <= 0 && e.frenzyCd <= 0) {
      let kin = 0;
      for (const g of enemies) {
        if (g === e || g.dead || g.frozen > 0) continue;
        if ((g.type === 'goblin' || g.type === 'wolf' || g.type === 'archer' || g.type === 'troll') &&
            Math.hypot(g.x - e.x, g.y - e.y) < SHAMAN_R) kin++;
      }
      if (kin >= 3) {
        e.frenzyT = 110; e.frenzyCd = 340;
        sparks.push({ x: e.x, y: e.y - 52, t: 26, color: '#c8ff9a', txt: 'RA-KA!' });
        shake = Math.max(shake, 5); sfSfx.screech();
      }
    }
    // the mending beat: one heart per beat — wounded trolls, or an elite's broken buckler
    if (e.st <= 0) {
      e.st = 90;
      for (const t of enemies) {
        if (t.dead || !(t.hp > 0)) continue;
        let mhp = 0;
        if (t.type === 'troll') mhp = t.elite === 2 ? 8 : t.elite ? 5 : 3;
        else if (t.type === 'goblin' && t.elite) mhp = t.elite === 2 ? 3 : 2;
        if (mhp && t.hp < mhp && Math.hypot(t.x - e.x, t.y - e.y) < SHAMAN_R) {
          t.hp++;
          sparks.push({ x: t.x, y: t.y - 62, t: 22, color: '#8fdc78', txt: '✚' });
          break;                                   // one heart per beat
        }
      }
    }
  } else if (e.type === 'bomber') {
    // the bombardier: long-range artillery. Roams far out, winds up (a visible
    // fuse tell), then lobs a powder keg at the target's current spot with a
    // little seeded scatter — the shrinking red ring is the dodge. After firing
    // it scurries and re-sights. It never touches you; the floor does.
    e.st--;
    if (e.mode === 'roam') {
      if (d < 300) { e.x -= dx / d * e.spd; e.y -= dy / d * e.spd; e.phase += 0.14; }
      else if (d > 430) { e.x += dx / d * e.spd * 0.7; e.y += dy / d * e.spd * 0.7; e.phase += 0.1; }
      if (e.st <= 0 && d < 520) { e.mode = 'wind'; e.st = 34; }
      else if (e.st <= 0) e.st = 30;
    } else if (e.mode === 'wind') {
      if (e.st <= 0) {
        const sx = clamp(tgt.x + (rnd() - 0.5) * 70, 20, GW - 20);
        const sy = clamp(tgt.y + (rnd() - 0.5) * 70, 46, GH - 12);
        kegs.push({ sx: e.x, sy: e.y - 22, tx: sx, ty: sy, t: 0, T: KEG_AIR });
        sfSfx.lunge();
        e.mode = 'cool'; e.st = 150 + rnd() * 80;
      }
    } else { // cool — scurry off the counter-charge, then re-sight
      if (d < 260) { e.x -= dx / d * e.spd; e.y -= dy / d * e.spd; e.phase += 0.12; }
      if (e.st <= 0) { e.mode = 'roam'; e.st = 40; }
    }
  } else if (e.type === 'troll') {
    // the bull troll enrages below half — faster feet, faster club; the dread
    // troll enrages sooner, harder, and ROARS the moment it turns
    const raging = e.elite && e.hp <= (e.elite === 2 ? 3 : 2);
    if (raging && e.elite === 2 && !e.roared) {
      e.roared = true;
      sparks.push({ x: e.x, y: e.y - 66, t: 26, color: '#ff7043', txt: 'ROAR' });
      shake = Math.max(shake, 8); sfSfx.charge();
    }
    const sp = (raging ? e.spd * (e.elite === 2 ? 1.9 : 1.7) : e.spd) * shamanHaste(e);
    e.x += dx / d * sp; e.y += dy / d * sp; e.phase += (raging ? 0.17 : 0.1);
  } else if (e.type === 'ogre') {
    e.st--;
    if (e.mode === 'stalk') {
      e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.08;
      e.lx = dx / d; e.ly = dy / d;                  // keep its aim fresh until it commits
      if (e.st <= 0 && d < 340) { e.mode = 'wind'; e.st = 36; sfSfx.lunge(); }
      else if (e.st <= 0) e.st = 44;
    } else if (e.mode === 'wind') {
      e.lx = dx / d; e.ly = dy / d;                  // tracks during the wind-up, then locks
      e.phase += 0.04;
      if (e.st <= 0) { e.mode = 'charge'; e.st = 28; sfSfx.charge(); }
    } else { // charge — a fast, locked straight rush that bounces off the walls
      e.x += e.lx * 7.4; e.y += e.ly * 7.4; e.phase += 0.5;
      if (e.x < 18 || e.x > GW - 18) { e.lx = -e.lx; e.x = clamp(e.x, 18, GW - 18); }
      if (e.y < 44 || e.y > GH - 14) { e.ly = -e.ly; e.y = clamp(e.y, 44, GH - 14); }
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 56 + rnd() * 34; }
    }
  } else if (e.type === 'wraith') {
    // the Nine hunt as one: orbit, tighten the ring, then strike together
    e.ring = Math.max(135, e.ring - 0.12);
    const cyc = frame % 360;
    if (cyc < 280) {
      e.mode = 'circle';
      const a = e.slot + frame * 0.004;
      const tx = clamp(tgt.x + Math.cos(a) * e.ring, 10, GW - 10);
      const ty = clamp(tgt.y + Math.sin(a) * e.ring, 36, GH - 6);
      const ddx = tx - e.x, ddy = ty - e.y, dd = Math.hypot(ddx, ddy) || 1;
      if (dd > 4) { e.x += ddx / dd * Math.min(e.spd, dd); e.y += ddy / dd * Math.min(e.spd, dd); }
      e.phase += 0.12;
    } else if (cyc < 312) {
      e.mode = 'aim';  // all Nine flash + sight lines at once
    } else {
      if (e.mode !== 'lunge') {
        e.lx = dx / d; e.ly = dy / d;
        // scale the strike so it actually reaches a stationary player, even when the
        // ring is still wide: cover the gap (+overshoot) within the ~48-frame lunge window
        e.lspd = clamp((d + 30) / 42, 4.6, 9);
        if (e.slot !== undefined && enemies.find(o => o.type === 'wraith' && !o.dead) === e) {
          sfSfx.screech();
          // recorded screech: always on the first lunge, then 20% of the time
          if (!wraithLunged || rnd() < 0.2) playWraithScreech();
          wraithLunged = true;
        }
      }
      e.mode = 'lunge';
      e.x += e.lx * (e.lspd || 4.6); e.y += e.ly * (e.lspd || 4.6); e.phase += 0.4;
    }
  } else if (e.type === 'witchking') {
    e.st--;
    if (e.mounted) {
      // the fell beast: wheel at range, telegraph, then a screaming dive
      e.phase += 0.16;
      if (e.mode === 'hover') {
        const ang = Math.atan2(e.y - tgt.y, e.x - tgt.x) + 0.013;
        const tx = clamp(tgt.x + Math.cos(ang) * 210, 40, GW - 40);
        const ty = clamp(tgt.y + Math.sin(ang) * 175, 50, GH - 40);
        const ddx = tx - e.x, ddy = ty - e.y, dd = Math.hypot(ddx, ddy) || 1;
        e.x += ddx / dd * Math.min(e.spd, dd); e.y += ddy / dd * Math.min(e.spd, dd);
        if (e.st <= 0) { e.mode = 'aim'; e.st = 34; }
      } else if (e.mode === 'aim') {
        if (e.st <= 0) { e.mode = 'dive'; e.st = 30; e.lx = dx / d; e.ly = dy / d; sfSfx.screech(); }
      } else { // dive
        e.x += e.lx * 6.84; e.y += e.ly * 6.84; e.phase += 0.55;
        if (e.st <= 0) { e.mode = 'hover'; e.st = 80 + rnd() * 40; }
      }
    } else {
      // on foot: stalk, then wind up the flail and whip it round in a deadly arc
      if (e.mode === 'walk') {
        e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.13;
        e.flailAng += 0.16;
        if (e.st <= 0 && d < 150) { e.mode = 'wind'; e.st = 32; }
        else if (e.st <= 0) e.st = 40;
      } else if (e.mode === 'wind') {
        e.flailAng += 0.42;  // spins up overhead — the tell
        if (e.st <= 0) { e.mode = 'swing'; e.st = 28; sfSfx.lunge(); }
      } else { // swing
        e.flailAng += 0.5;
        e.x += dx / d * 0.6; e.y += dy / d * 0.6;
        if (e.st <= 0) { e.mode = 'walk'; e.st = 50 + rnd() * 30; }
      }
    }
  } else if (e.type === 'trooper') {
    // march straight to the assigned formation slot, hold, then fire on command
    if (e.mode === 'march') {
      e.phase += 0.22;
      if (e.x > e.slotX + 3) e.x -= 3;
      else { e.x = e.slotX; e.mode = 'set'; }
    } else {
      e.phase += 0.05;
      if (swState === 'fire' && --e.fireT <= 0) {
        // stormtroopers can't aim: wide spread keeps the volley dodgeable
        const spread = (rnd() - 0.5) * 0.5;
        const ca = Math.cos(spread), sa = Math.sin(spread);
        const ux = dx / d, uy = dy / d;
        arrows.push({ x: e.x, y: e.y - 18,
                      vx: (ux * ca - uy * sa) * 5.2, vy: (ux * sa + uy * ca) * 5.2,
                      t: 240, kind: 'laser' });
        sfSfx.blaster();
        e.fireT = 70 + rnd() * 90;
      }
    }
  } else if (e.type === 'vader') {
    // a duel: melee slashes mixed with Force powers (push / saber throw / choke); escalates at half HP
    if (e.intro > 0) { e.intro--; e.phase += 0.04; return; }  // step from the shadows, then begin the duel
    e.st--;
    e.disarmed = arrows.some(a => a.kind === 'vsaber');     // his blade is mid-flight
    if (!e.phase2 && e.hp <= 5 && e.mode !== 'slash') enterVaderPhase2(e);
    else if (e.mode === 'advance') {
      if (e.stun <= 0) { e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.12; }
      if (e.st <= 0) { if (d < 160) vaderNextAttack(e, d); else e.st = 22; }  // close, then commit
    } else if (e.mode === 'wind') {                          // melee wind-up tell
      if (e.st <= 0) {
        e.mode = 'slash'; e.st = 22;
        e.lx = dx / d; e.ly = dy / d;
        e.slashAng = Math.atan2(e.ly, e.lx) - 1.0;           // wind up to one side
        sfSfx.lunge();
      }
    } else if (e.mode === 'slash') {                         // lunge, blade sweeping an arc out front
      e.slashAng += (e.phase2 ? 2.4 : 2.0) / 22;
      e.x += e.lx * 3.0; e.y += e.ly * 3.0; e.phase += 0.2;
      if (e.st <= 0) {
        if (e.phase2 && !e.combo && rnd() < 0.5) { e.combo = true; e.mode = 'wind'; e.st = 10; }  // quick follow-up
        else { e.combo = false; e.mode = 'advance'; e.st = (e.phase2 ? 18 : 34) + rnd() * 22; }
      }
    } else if (e.mode === 'cast') {                          // hand-raised Force telegraph, then unleash
      if (e.st <= 0) {
        if (e.power === 'push')       { forcePush(e, e.phase2 ? 1.15 : 0.9); e.mode = 'recover'; e.st = 18; shake = Math.max(shake, 12); }
        else if (e.power === 'throw') { vaderThrow(e); e.mode = 'recover'; e.st = 34; }
        else if (player.dashT > 0)    { e.mode = 'recover'; e.st = 20; sparks.push({ x: e.x, y: e.y - 42, t: 12, color: '#9ec8ff', txt: 'MISSED' }); }  // dashed clear of the choke
        else                          { startChoke(e); e.mode = 'choke'; }
      }
    } else if (e.mode === 'choke') {                         // hold the player aloft until broken or it ends
      if (player.choke <= 0) { e.mode = 'recover'; e.st = 28; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'advance'; e.st = (e.phase2 ? 16 : 28) + rnd() * 20; }
    }
  } else if (e.type === 'sidious') {
    // Clone Wars Sidious: fast & acrobatic — weaving rushes, a twin-saber spin, Force lightning, telegraphed leaps
    const _px = e.x, _py = e.y;                              // remember where he was (for the motion trail)
    e.st--;
    if (e.lit < 1) e.lit = Math.min(1, e.lit + 0.04);        // both blades snap to life
    e.spinAng += 0.16;
    if (sidiousIntroT > 0) {                                 // the entrance: hover, blades igniting, no aggression
      e.mode = 'enter'; e.mvx = 0; e.mvy = 0;
      e.x += Math.sin(frame * 0.06) * 0.35; e.y += Math.cos(frame * 0.05) * 0.25;
      return;
    }
    if (e.mode === 'enter') { e.mode = 'stalk'; e.st = 36; }
    // at half health the sabers go dark — from here he fights with lightning alone
    if (!e.phase2 && e.hp <= e.maxhp / 2 && (e.mode === 'stalk' || e.mode === 'recover')) enterSidiousPhase2(e);
    if (e.mode === 'stalk') {
      const wv = Math.sin(frame * 0.13) * 0.55;              // weave so he doesn't beeline
      e.x += dx / d * e.spd + (-dy / d) * wv;
      e.y += dy / d * e.spd + ( dx / d) * wv;
      e.phase += 0.18;
      if (e.st <= 0) {
        const r = rnd();
        if (e.phase2) {
          // lightning only: a straight bolt, a sweeping rake, or a leap — but never two rakes in a row
          if (e.lastCast === 'sweep') {
            if (r < 0.62 && d < 440) startSidiousCast(e, 'bolt', dx / d, dy / d);
            else { e.mode = 'gather'; e.st = 11; e.tx = sidiousFlank(e); e.lastCast = null; }
          } else if (r < 0.46 && d < 440) startSidiousCast(e, 'bolt', dx / d, dy / d);
          else if (r < 0.72 && d < 440)   startSidiousCast(e, 'sweep', dx / d, dy / d);
          else { e.mode = 'gather'; e.st = 11; e.tx = sidiousFlank(e); e.lastCast = null; }
        } else {
          if (r < 0.38 && d < 360)       startSidiousCast(e, 'bolt', dx / d, dy / d);
          else if (r < 0.74 && d < 240)  { e.mode = 'wind'; e.st = 26; sidiousCackle(e, 'spin'); }
          else { e.mode = 'gather'; e.st = 13; e.tx = sidiousFlank(e); }  // coil before a leap
        }
      }
    } else if (e.mode === 'gather') {                        // anticipation: dip and coil, then spring
      e.crouch = (1 - Math.max(0, e.st) / 13);               // 0→1 coil
      e.hop = -e.crouch * 6;                                 // dip down before the spring
      e.x -= dx / d * 0.4; e.y -= dy / d * 0.4;              // a small recoil away — reads as winding up
      if (e.st <= 0) {
        e.mode = 'leap'; e.st = 20; e.leapDur = 20; e.crouch = 0; e.hop = 0;
        e.leapFrom = { x: e.x, y: e.y }; e.leapTo = e.tx; sfSfx.dash();
      }
    } else if (e.mode === 'leap') {                          // a smooth eased arc — accelerate then settle
      const t = clamp(1 - Math.max(0, e.st) / e.leapDur, 0, 1);
      const s = t * t * (3 - 2 * t);                         // smoothstep so it springs, not blinks
      e.x = e.leapFrom.x + (e.leapTo.x - e.leapFrom.x) * s;
      e.y = e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * s;
      e.hop = Math.sin(t * Math.PI) * 26;                    // rise and land
      e.phase += 0.16;
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 22; e.hop = 0; }
    } else if (e.mode === 'wind') {                          // gathers both sabers — the spin tell
      e.spinAng += 0.34;
      if (e.st <= 0) { e.mode = 'spin'; e.st = 42; e.lx = dx / d; e.ly = dy / d; sfSfx.lunge(); }
    } else if (e.mode === 'spin') {                          // whirls across, twin blades a lethal ring
      e.spinAng += 0.62;
      e.x += e.lx * 4.4; e.y += e.ly * 4.4; e.phase += 0.32;
      e.lx = e.lx * 0.92 + dx / d * 0.08; e.ly = e.ly * 0.92 + dy / d * 0.08;  // tracks a little
      if (e.st <= 0) { e.mode = 'recover'; e.st = 22; }
    } else if (e.mode === 'cast') {                          // hands raised — a long, building lightning telegraph
      if (e.st === e.castDur - 14) sfSfx.ignite();           // a charging whir partway in
      if (e.st <= 0) {
        if (player.dashT > 0) { e.mode = 'recover'; e.st = 18; sparks.push({ x: e.x, y: e.y - 46, t: 12, color: '#d0b3ff', txt: 'MISSED' }); }
        else {
          sidiousLightning(e); e.mode = 'lightning';
          // the rake sweeps slowly (slower than a running player) over a long window; the bolt is a quick zap
          e.lightDur = e.castKind === 'sweep' ? 42 : 26; e.st = e.lightDur;
          e.lethalW = e.castKind === 'sweep' ? 14 : 18;
        }
      }
    } else if (e.mode === 'lightning') {                     // the bolt arcs along the aim for the window
      if (e.castKind === 'sweep') {                          // rake the beam across the arc (outrunnable)
        const rot = (e.sweepDir || 1) * (e.sweepArc || 0.85) / (e.lightDur || 42);
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const nx = e.lx * ca - e.ly * sa, ny = e.lx * sa + e.ly * ca;
        e.lx = nx; e.ly = ny;
      }
      if (e.st % 4 === 0) ltnFlash = Math.max(ltnFlash, 8);
      if (e.st <= 0) { e.mode = 'recover'; e.st = e.phase2 ? 22 : 24; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'stalk'; e.st = (e.phase2 ? 20 : 22) + rnd() * 20; }
    }
    e.mvx = e.x - _px; e.mvy = e.y - _py;                    // per-tick movement → motion-blur ghosts
  } else if (e.type === 'guard') {
    // Royal Guard: stalk in, plant the force pike, then lunge
    e.st--;
    if (sidiousIntroT > 0) { e.mode = 'idle'; return; }      // stand at attention during the reveal
    if (e.mode === 'idle') { e.mode = 'stalk'; e.st = 40; }
    if (e.mode === 'stalk') {
      e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.16;
      if (e.st <= 0 && d < 150) { e.mode = 'aim'; e.st = 24; }
      else if (e.st <= 0) e.st = 28;
    } else if (e.mode === 'aim') {
      e.pike += 0.2;
      if (e.st <= 0) { e.mode = 'lunge'; e.st = 18; e.lx = dx / d; e.ly = dy / d; sfSfx.lunge(); }
    } else { // lunge
      e.x += e.lx * 4.0; e.y += e.ly * 4.0; e.phase += 0.3; e.pike += 0.32;
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 34 + rnd() * 22; }
    }
  } else if (e.type === 'dio') {
    if (e.mode === 'dying') return;                        // the crumble cutscene drives him now
    e.st--; e.phase += 0.1;
    if (e.cape < 1) e.cape = Math.min(1, e.cape + 0.04);
    // both Stands manifest the moment you enter — The World looms over DIO, Star Platinum over the hero
    const standTarget = (e.mode === 'world' || e.mode === 'muda') ? 1 : 0.6;
    e.stand = (e.stand || 0) + (standTarget - (e.stand || 0)) * 0.1;
    playerStand += (0.9 - playerStand) * 0.07;
    if (e.mode === 'troll') { dioTroll(e); return; }       // the scripted taunting intro
    if (e.mode === 'idle') {                                // saunter at mid-range, then pick an attack
      if (dioStopT <= 0) {
        if (d > 230) { e.x += dx / d * e.spd; e.y += dy / d * e.spd; }
        else if (d < 160) { e.x -= dx / d * e.spd * 0.6; e.y -= dy / d * e.spd * 0.6; }
        e.x += -dy / d * Math.sin(frame * 0.035) * 0.4; e.y += dx / d * Math.sin(frame * 0.035) * 0.4;   // a slow, readable sway
      }
      if (e.st <= 0 && dioStopT <= 0) {
        const r = rnd();
        if (!e.rollerDone && e.hp <= e.maxhp * 0.45 && r < 0.45) { e.rollerDone = true; startRoller(e); }
        else if (r < 0.34) { e.mode = 'knives'; e.st = 40; }    // a longer wind-up you can read
        else if (r < 0.66) { e.mode = 'world'; e.st = 46; }
        else startBarrage(e);
      }
    } else if (e.mode === 'knives') {                       // wind-up, then loose a fan of knives
      if (e.st === 0) {
        const base = Math.atan2(dy, dx);
        for (let i = -3; i <= 3; i++) { const a = base + i * 0.13; arrows.push(dioKnife(e.x + Math.cos(a) * 14, e.y - 20 + Math.sin(a) * 14, Math.cos(a) * 4.3, Math.sin(a) * 4.3)); }
        sfSfx.arrow(); e.mode = 'recover'; e.st = 36;
      }
    } else if (e.mode === 'world') {                        // The World manifests; he lunges in to hammer
      if (e.st > 16) { e.x += dx / d * e.spd * 1.15; e.y += dy / d * e.spd * 1.15; }
      if (e.st === 16) sparks.push({ x: e.x, y: e.y - 42, t: 18, color: '#ffd24d', txt: 'THE WORLD' });
      if (e.st <= 0) { e.mode = 'muda'; e.st = 26; sfSfx.ora(); }
    } else if (e.mode === 'muda') {                         // MUDA barrage — lethal ring around him
      if (e.st % 3 === 0) { sfSfx.ora(); sparks.push({ x: e.x + (rnd() - 0.5) * 64, y: e.y - 18 - rnd() * 34, t: 8, color: '#ffe082', txt: 'MUDA' }); }
      if (e.st <= 0) { e.mode = 'recover'; e.st = 38; }
    } else if (e.mode === 'barrage') {                      // timestop knife wall (placed in startBarrage)
      if (dioStopT <= 0 && e.st <= 0) { e.mode = 'recover'; e.st = 34; }
    } else if (e.mode === 'roller') {                       // the road roller does the work
      if (!roadRoller && e.st <= 0) { e.mode = 'recover'; e.st = 44; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'idle'; e.st = 38 + rnd() * 26; }   // a real breather between attacks
    }
  } else if (e.type === 'archer') {
    // skeleton archer: keep range, telegraph, loose an arrow
    e.st--;
    if (e.mode === 'approach') {
      const hz = shamanHaste(e);
      if (d > 270) { e.x += dx / d * e.spd * hz; e.y += dy / d * e.spd * hz; e.phase += 0.16; }
      else if (d < 180) { e.x -= dx / d * e.spd * 0.8 * hz; e.y -= dy / d * e.spd * 0.8 * hz; e.phase += 0.14; }
      if (e.st <= 0 && d < 320) { e.mode = 'aim'; e.st = 26; }
      else if (e.st <= 0) e.st = 20;
    } else if (e.mode === 'aim') {
      if (e.st <= 0) {
        if (e.elite) {
          // volley archer: a three-arrow fan; the DEADEYE looses five, faster —
          // the gaps are the dodge either way
          const base = Math.atan2(dy, dx);
          const wide = e.elite === 2 ? 2 : 1;
          const spd = e.elite === 2 ? 5.4 : 4.6;
          const step = e.elite === 2 ? 0.14 : 0.17;
          for (let vi = -wide; vi <= wide; vi++) {
            const a = base + vi * step;
            arrows.push({ x: e.x, y: e.y - 18, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, t: 240 });
          }
        } else {
          arrows.push({ x: e.x, y: e.y - 18, vx: dx / d * 4.6, vy: dy / d * 4.6, t: 240 });
        }
        sfSfx.arrow();
        e.mode = 'cool'; e.st = 110 + rnd() * 60;
      }
    } else { // cool
      if (d < 170) { e.x -= dx / d * e.spd * 0.8; e.y -= dy / d * e.spd * 0.8; e.phase += 0.14; }
      if (e.st <= 0) { e.mode = 'approach'; e.st = 40; }
    }
  } else { // wolf: stalk → aim (telegraph) → lunge → rest
    e.st--;
    if (e.mode === 'stalk') {
      const hz = shamanHaste(e);   // hasted stalking — the lunge itself stays honest
      e.x += dx / d * e.spd * hz; e.y += dy / d * e.spd * hz; e.phase += 0.15;
      if (e.st <= 0) {
        if (d < 380) { e.mode = 'aim'; e.st = 30; }
        else e.st = 30;
      }
    } else if (e.mode === 'aim') {
      if (e.st <= 0) {
        e.mode = 'lunge'; e.st = 26;
        e.lx = dx / d; e.ly = dy / d;
        sfSfx.lunge();
      }
    } else if (e.mode === 'lunge') {
      e.x += e.lx * (6.2 + wave * 0.25); e.y += e.ly * (6.2 + wave * 0.25);
      e.phase += 0.55;
      if (e.st <= 0) { e.mode = 'rest'; e.st = 26; }
    } else { // rest
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 70 + rnd() * 50; }
    }
  }
  e.x = clamp(e.x, -60, GW + 60);
  e.y = clamp(e.y, -60, GH + 60);
}
