// ── render-field — drawEnemy dispatch, champions, stone/saber pickups, held weapons, husks/minions ──
function drawEnemy(e) {
  // ── readability grammar (render-only) ──
  // ONE language for "about to strike": every telegraphing foe stands on a red
  // underglow, whatever its sprite does (steady pulse under reduced motion)
  if (!e.dead && e.frozen <= 0 && ['aim', 'wind', 'cast', 'gather'].includes(e.mode)) {
    const ua = api.reduceMotion ? 0.22 : 0.16 + 0.10 * Math.sin(frame * 0.25);
    ctx.fillStyle = 'rgba(255,60,50,' + ua.toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + 3, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the vignette must never HIDE a live threat: foes hugging the dark rim get a
  // faint self-light so the atmosphere pass can't cost you a death
  if (!e.dead && (e.x < 70 || e.x > GW - 70 || e.y < 90 || e.y > GH - 60)) {
    ctx.fillStyle = 'rgba(255,90,70,0.10)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y - 8, 26, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  const col = enemyColor(e);
  if (e.type === 'goblin') drawGoblin(e, col);
  else if (e.type === 'shaman') drawShaman(e, col);
  else if (e.type === 'bomber') drawBomber(e, col);
  else if (e.type === 'ogre') drawOgre(e, col);
  else if (e.type === 'wolf') drawWolf(e, col);
  else if (e.type === 'archer') drawArcher(e, col);
  else if (e.type === 'wraith') drawWraith(e, col);
  else if (e.type === 'witchking') drawWitchKing(e, col);
  else if (e.type === 'trooper') drawTrooper(e, col);
  else if (e.type === 'vader') drawVader(e, col);
  else if (e.type === 'sidious') drawSidious(e, col);
  else if (e.type === 'guard') drawGuard(e, col);
  else if (e.type === 'dio') drawDio(e, col);
  else if (e.type === 'ian') drawIan(e, col);
  else {
    const lean = clamp((e.vx || 0) * 0.05, -0.35, 0.35);
    drawTroll(e, col, lean);
    // hearts only for a LIVING wounded troll — a corpse can linger one frame before
    // the dead-filter sweeps it, and overkill damage can leave hp negative
    if (!e.dead && e.hp > 0 && e.hp < (e.elite === 2 ? 8 : e.elite ? 5 : 3)) {
      ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 11px Tahoma,Arial'; ctx.textAlign = 'center';
      ctx.fillText('♥'.repeat(e.hp), e.x, e.y - 78); ctx.textAlign = 'left';
    }
  }
  // HIGH-CONTRAST ELITES (accessibility option): tier as SHAPE, not just tint
  if (sfOpts.hiVis && e.elite && !e.dead) {
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText(e.elite === 2 ? '◆◆' : '◆', e.x, e.y - 60);
    ctx.textAlign = 'left';
  }
}

function drawLuke(c) {
  stickFigure(c.x, c.y, frame * 0.12, '#ffe0b2');
  const base = Math.atan2(c.fy || 0, c.fx || 1);
  const slashing = c.slashT > 0;
  const ang = slashing ? base - 1.1 + (1 - c.slashT / 8) * 2.2 : base + 0.4;
  const hx = c.x, hy = c.y - 20;
  const reach = slashing ? 62 : 38;          // the blade extends as he cleaves
  ctx.save(); ctx.lineCap = 'round';
  if (slashing) {
    // a translucent green wedge tracing the wide sweep of the cleave
    ctx.fillStyle = 'rgba(0,230,118,0.16)';
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, reach + 12, ang - 0.55, ang + 0.55); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 3;  // hilt
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(ang) * 5, hy + Math.sin(ang) * 5);
  ctx.lineTo(hx + Math.cos(ang) * 10, hy + Math.sin(ang) * 10);
  ctx.stroke();
  ctx.strokeStyle = '#b9f6ca'; ctx.lineWidth = 3.5;  // the green blade
  ctx.shadowColor = '#00e676'; ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(ang) * 10, hy + Math.sin(ang) * 10);
  ctx.lineTo(hx + Math.cos(ang) * reach, hy + Math.sin(ang) * reach);
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.restore();
}

function drawJotaro(c) {
  stickFigure(c.x, c.y, frame * 0.07, '#283593');
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.fillStyle = '#10153a';  // the cap
  ctx.beginPath(); ctx.arc(0, -36, 8, Math.PI, 0); ctx.fill();
  ctx.fillRect(-8, -37, 19, 3);
  ctx.restore();
  if (c.oraT > 0 && c.target && !c.target.dead) {
    // Star Platinum manifests over the target in a flurry of fists
    const t = c.target;
    ctx.save(); ctx.globalAlpha = 0.85;
    stickFigure(t.x + 14, t.y, frame * 0.6, '#7e57c2');
    ctx.strokeStyle = '#b39ddb'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2, r = 10 + rnd() * 14;
      ctx.beginPath(); ctx.moveTo(t.x + 14, t.y - 20);
      ctx.lineTo(t.x + Math.cos(a) * r, t.y - 20 + Math.sin(a) * r); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawChamp(c) {
  if (c.kind === 'gandalf') drawWizard(c);
  else if (c.kind === 'luke') drawLuke(c);
  else drawJotaro(c);
}

function drawStone() {
  const s = stone;
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 8, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#78909c';
  ctx.beginPath(); ctx.ellipse(0, 0, 21, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#90a4ae';
  ctx.beginPath(); ctx.ellipse(-5, -4, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(-0.12);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -32); ctx.stroke();   // blade
  ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-9, -32); ctx.lineTo(9, -32); ctx.stroke(); // crossguard
  ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -43); ctx.stroke();  // grip
  ctx.restore();
  if (frame % 50 < 9) {  // glint
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Tahoma,Arial';
    ctx.fillText('✦', 4, -24);
  }
  // beckoning glow
  ctx.strokeStyle = 'rgba(255,210,77,' + (0.35 + Math.sin(frame * 0.09) * 0.25).toFixed(2) + ')';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, -14, 34 + Math.sin(frame * 0.09) * 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawSaberPickup() {
  const s = saberPickup;
  ctx.save(); ctx.translate(s.x, s.y);
  // beckoning blue glow
  ctx.strokeStyle = 'rgba(90,200,255,' + (0.35 + Math.sin(frame * 0.12) * 0.25).toFixed(2) + ')';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, -8, 26 + Math.sin(frame * 0.12) * 4, 0, Math.PI * 2); ctx.stroke();
  // hilt standing upright with a half-lit blade
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -14); ctx.stroke();
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-2.5, -6, 5, 3);  // activation stud
  ctx.shadowColor = '#5ac8ff'; ctx.shadowBlur = 14;
  ctx.strokeStyle = '#bfe7ff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -40); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawWizard(g) {
  stickFigure(g.x, g.y, frame * 0.08, '#f5f5f5', 1.15);
  ctx.save(); ctx.translate(g.x, g.y);
  ctx.fillStyle = '#cfd8dc';  // pointed hat
  ctx.beginPath(); ctx.moveTo(-13, -46); ctx.lineTo(13, -46); ctx.lineTo(2, -66); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a1887f'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(19, -2); ctx.lineTo(19, -46); ctx.stroke();  // staff
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#bbdefb'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(19, -49, 3.5 + Math.sin(frame * 0.2) * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHeldSword(h) {
  const baseAng = Math.atan2(h.fy, h.fx);
  const a0 = baseAng - 1.9, sweep = (1 - h.swingT / 10) * 3.8;  // matches the ~220° cleave
  const ang = h.swingT > 0 ? a0 + sweep : baseAng + 0.3;
  const hx = h.x, hy = h.y - 20;   // swing-wedge pivot (the cleave AoE stays centred on the hero)
  // blue lightsaber vs Excalibur's gold steel
  const trail = h.heldSaber ? '90,200,255' : '255,245,157';
  const bladeLen = h.heldSaber ? 46 : 40;
  ctx.save();
  if (!h.heldSaber && !api.reduceMotion && h.swordT < 180 && Math.floor(frame / 6) % 2 === 0) ctx.globalAlpha = 0.45;  // Excalibur expiring
  ctx.lineCap = 'round';
  if (h.swingT > 0) {  // cleave wedge + sweep trail
    ctx.fillStyle = 'rgba(' + trail + ',' + (h.swingT / 34).toFixed(2) + ')';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, up.swingR * 0.88, a0, a0 + sweep);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(' + trail + ',' + (h.swingT / 12).toFixed(2) + ')';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(hx, hy, up.swingR * 0.88, a0, a0 + sweep);
    ctx.stroke();
  }
  // the gripping hand sits out in front of the body at hand height — never on the chest
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const fxn = h.fx / fl, fyn = h.fy / fl;
  const handX = h.x + fxn * 11, handY = h.y - 13 + fyn * 5;
  // the sword-arm: a real forearm from the shoulder down to the hand (angled apart from the blade,
  // so the weapon clearly reads as held rather than sprouting from the torso)
  ctx.lineJoin = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  // the blade geometry now grows out of the hand
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -Math.sin(ang), py = Math.cos(ang);
  const at = (d) => [handX + ux * d, handY + uy * d];

  if (h.heldSaber) {
    // a brushed-metal hilt straddling the fist, then a glowing energy blade
    const [h0x, h0y] = at(-5), [h1x, h1y] = at(9);
    ctx.strokeStyle = '#33373c'; ctx.lineWidth = 6;            // dark grip body
    ctx.beginPath(); ctx.moveTo(h0x, h0y); ctx.lineTo(h1x, h1y); ctx.stroke();
    ctx.strokeStyle = '#aab2bb'; ctx.lineWidth = 2.2;          // chrome highlight down it
    ctx.beginPath(); ctx.moveTo(h0x, h0y); ctx.lineTo(h1x, h1y); ctx.stroke();
    const [emx, emy] = at(9);                                  // emitter shroud
    ctx.strokeStyle = '#d0d6dc'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(emx - px * 3, emy - py * 3); ctx.lineTo(emx + px * 3, emy + py * 3); ctx.stroke();
    const [b0x, b0y] = at(10), [b1x, b1y] = at(10 + bladeLen);
    ctx.shadowColor = '#5ac8ff'; ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(120,205,255,0.55)'; ctx.lineWidth = 9;   // outer plasma glow
    ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.stroke();
    ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 3.4;                // white-hot core
    ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = heroTint(h);                               // fist on the hilt
    ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  // Excalibur — a golden-hilted steel blade gripped in the fist
  const [pomx, pomy] = at(-6), [cgx, cgy] = at(6);
  ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 4;             // leather-wrapped grip through the fist
  ctx.beginPath(); ctx.moveTo(pomx, pomy); ctx.lineTo(cgx, cgy); ctx.stroke();
  ctx.fillStyle = '#ffd24d';                                  // pommel knob behind the hand
  ctx.beginPath(); ctx.arc(pomx, pomy, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3;             // crossguard just past the fist
  ctx.beginPath(); ctx.moveTo(cgx + px * 7, cgy + py * 7); ctx.lineTo(cgx - px * 7, cgy - py * 7); ctx.stroke();
  // tapered, fullered steel blade as a filled polygon
  const bb = 8, bt = 8 + bladeLen, hw = 3.2;
  ctx.shadowColor = '#fff59d'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#dfe6ea';
  ctx.beginPath();
  ctx.moveTo(handX + ux * bb + px * hw, handY + uy * bb + py * hw);
  ctx.lineTo(handX + ux * (bt - 9) + px * hw * 0.8, handY + uy * (bt - 9) + py * hw * 0.8);
  ctx.lineTo(handX + ux * bt, handY + uy * bt);              // the point
  ctx.lineTo(handX + ux * (bt - 9) - px * hw * 0.8, handY + uy * (bt - 9) - py * hw * 0.8);
  ctx.lineTo(handX + ux * bb - px * hw, handY + uy * bb - py * hw);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;   // central fuller highlight
  ctx.beginPath(); ctx.moveTo(handX + ux * bb, handY + uy * bb); ctx.lineTo(handX + ux * (bt - 4), handY + uy * (bt - 4)); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,140,150,0.6)'; ctx.lineWidth = 1;   // shaded edge for depth
  ctx.beginPath();
  ctx.moveTo(handX + ux * bb - px * hw, handY + uy * bb - py * hw);
  ctx.lineTo(handX + ux * (bt - 9) - px * hw * 0.8, handY + uy * (bt - 9) - py * hw * 0.8);
  ctx.stroke();
  ctx.fillStyle = heroTint(h);                                // fist on the grip
  ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// the ranged hero's bow: a curved stave + string held out in the facing direction,
// with the string drawn back and an arrow nocked in the beat after a shot
function drawHeldBow(h) {
  // the bow points along the held direction (the facing) — where the next arrow flies
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl, uy = h.fy / fl, px = -uy, py = ux;
  const handX = h.x + ux * 12, handY = h.y - 14 + uy * 5;
  const drawn = h.swingT > 0 ? (h.swingT / 8) : 0;   // 1 = just loosed
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5; // the bow arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.strokeStyle = '#a5d6a7'; ctx.lineWidth = 3;     // the stave
  ctx.beginPath();
  ctx.moveTo(handX + px * 13, handY + py * 13);
  ctx.quadraticCurveTo(handX + ux * 9, handY + uy * 9, handX - px * 13, handY - py * 13);
  ctx.stroke();
  const pull = 3 + drawn * 6;                         // the string (pulled back right after firing)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(handX + px * 13, handY + py * 13);
  ctx.lineTo(handX - ux * pull, handY - uy * pull);
  ctx.lineTo(handX - px * 13, handY - py * 13);
  ctx.stroke();
  if (drawn > 0.3) {                                  // the nocked arrow flashes as it looses
    ctx.strokeStyle = '#f5f5dc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(handX - ux * pull, handY - uy * pull); ctx.lineTo(handX + ux * 12, handY + uy * 12); ctx.stroke();
  }
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(handX, handY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the unhorsed rider's dirk: short, desperate, held out front — matches the
// on-foot jab's reach so the picture tells the truth
function drawHeldDirk(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl, uy = h.fy / fl;
  const hx = h.x + ux * 9, hy = h.y - 18 + uy * 4;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = '#cdd8e2'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + ux * 13, hy + uy * 13); ctx.stroke();
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the dragoon's couched lance: it points where you FLY (the velocity), falling
// back to the facing at a standstill — so the joust reads exactly like it kills.
// The tip ignites ember-orange once you're moving fast enough to skewer the
// lightest foe (a steady glow, never a flash — reduced-motion safe by nature).
function drawHeldLance(h) {
  const vv = Math.hypot(h.vx || 0, h.vy || 0);
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = vv > 0.8 ? h.vx / vv : h.fx / fl;
  const uy = vv > 0.8 ? h.vy / vv : h.fy / fl;
  const px = -uy, py = ux;
  const handX = h.x + ux * 10, handY = h.y - 16 + uy * 5;
  const len = 34 + (up.lanceR || 0) * 0.6;
  const hot = vv >= JOUST_BAR.goblin;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;                     // the lance arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.strokeStyle = '#b0895a'; ctx.lineWidth = 3;                         // the shaft
  ctx.beginPath();
  ctx.moveTo(handX - ux * 10, handY - uy * 10);
  ctx.lineTo(handX + ux * len, handY + uy * len);
  ctx.stroke();
  if (hot) { ctx.shadowColor = DRAGOON_COL; ctx.shadowBlur = 9; }
  ctx.fillStyle = hot ? DRAGOON_COL : '#cdd8e2';                          // the tip
  ctx.beginPath();
  ctx.moveTo(handX + ux * (len + 9), handY + uy * (len + 9));
  ctx.lineTo(handX + ux * len + px * 3.4, handY + uy * len + py * 3.4);
  ctx.lineTo(handX + ux * len - px * 3.4, handY + uy * len - py * 3.4);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  const wave = Math.sin((h.phase || 0) * 2) * 2.5;                        // the pennon streams off the neck
  ctx.fillStyle = DRAGOON_COL;
  ctx.beginPath();
  ctx.moveTo(handX + ux * (len - 2), handY + uy * (len - 2));
  ctx.lineTo(handX + ux * (len - 13) + px * (5 + wave * 0.4), handY + uy * (len - 13) + py * (5 + wave * 0.4));
  ctx.lineTo(handX + ux * (len - 8), handY + uy * (len - 8));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = heroTint(h);                                            // the fist on the grip
  ctx.beginPath(); ctx.arc(handX, handY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the caster's staff: held upright with a glowing orb in the SELECTED spell's
// color — it swells through the incantation (h.castT counting down, normalized
// by the spell's own cast length) and flares as the spell looses
function drawHeldStaff(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl;
  const side = ux >= 0 ? 1 : -1;
  const gx = h.x + side * 10, gy = h.y - 13;
  const charge = h.castT > 0 ? 1 - h.castT / (h.castMax || CAST_T) : 0;
  const flare = (h.swingT > 0 ? h.swingT / 10 : 0) + charge;
  const sp = SPELLS[h.casting || curSpell(h)] || SPELLS.bolt;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5; // the staff arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(gx, gy); ctx.stroke();
  ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 3;     // the staff itself
  ctx.beginPath(); ctx.moveTo(gx + side * 2, gy + 12); ctx.lineTo(gx + side * 5, gy - 24); ctx.stroke();
  const pulse = api.reduceMotion ? 0.5 : 0.4 + 0.25 * Math.sin(frame * 0.15);
  ctx.fillStyle = sp.col;
  ctx.shadowColor = sp.col; ctx.shadowBlur = 10 + flare * 14;
  ctx.globalAlpha = Math.min(1, pulse + 0.35 + flare * 0.6);
  ctx.beginPath(); ctx.arc(gx + side * 5.5, gy - 27, 3.4 + flare * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(gx, gy, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the necromancer's scythe: a long dark snath with a crescent soul-steel blade —
// rested on the shoulder at ease, whirled through a teal reaping wedge on the swing
function drawHeldScythe(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const fxn = h.fx / fl, fyn = h.fy / fl;
  const baseAng = Math.atan2(fyn, fxn);
  const swinging = h.swingT > 0;
  const a0 = baseAng - 1.9, sweepA = (1 - h.swingT / 10) * 3.8;
  const ang = swinging ? a0 + sweepA : baseAng + 0.55;
  const hx = h.x, hy = h.y - 20;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (swinging) {                                   // the reaping wedge
    ctx.fillStyle = 'rgba(100,255,218,' + (h.swingT / 40).toFixed(2) + ')';
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, SCYTHE_R * 0.95, a0, a0 + sweepA);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(100,255,218,' + (h.swingT / 14).toFixed(2) + ')';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hx, hy, SCYTHE_R * 0.95, a0, a0 + sweepA); ctx.stroke();
  }
  const handX = h.x + fxn * 11, handY = h.y - 13 + fyn * 5;
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;                 // the scythe arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -Math.sin(ang), py = Math.cos(ang);
  const at = (dd) => [handX + ux * dd, handY + uy * dd];
  const [s0x, s0y] = at(-14), [s1x, s1y] = at(30);
  ctx.strokeStyle = '#3e2f23'; ctx.lineWidth = 3.2;                   // the snath
  ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y); ctx.stroke();
  const glow = api.reduceMotion ? 0.5 : 0.35 + 0.25 * Math.sin(frame * 0.09);
  ctx.shadowColor = NECRO_COL; ctx.shadowBlur = 6 + glow * 8;         // the crescent, soul-lit
  ctx.strokeStyle = '#cfe8e4'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(s1x, s1y);
  ctx.quadraticCurveTo(s1x + px * 16 + ux * 4, s1y + py * 16 + uy * 4,
                       s1x + px * 24 - ux * 8, s1y + py * 24 - uy * 8);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = heroTint(h);                                        // fist on the snath
  ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// a fallen grunt's husk: a bone mound with a soul wisp curling off it — fades out
// over its final beats so the raise window is legible
function drawHusk(k) {
  const fade = Math.min(1, k.t / 120) * 0.85;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(k.x, k.y);
  ctx.strokeStyle = '#8a93a5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-2, -4); ctx.stroke();   // slumped bones
  ctx.beginPath(); ctx.moveTo(7, -1); ctx.lineTo(1, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(5, -2); ctx.stroke();
  ctx.fillStyle = '#aab2bb';
  ctx.beginPath(); ctx.arc(-6, -5, 3, 0, Math.PI * 2); ctx.fill();        // the skull
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-7.2, -5.6, 1.2, 1.2); ctx.fillRect(-4.4, -5.6, 1.2, 1.2);
  const wispA = api.reduceMotion ? 0.5 : 0.35 + 0.2 * Math.sin(frame * 0.11 + k.y);
  const bob = api.reduceMotion ? 0 : Math.sin(frame * 0.08 + k.x) * 2;    // the wisp
  ctx.fillStyle = NECRO_COL; ctx.globalAlpha = fade * wispA;
  ctx.beginPath(); ctx.arc(bob, -13 + Math.sin(frame * 0.06 + k.x * 0.7) * 3, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// a raised minion: its living sprite redrawn in spectral soul-teal, with a
// draining life-ring at its feet — the raise is a loan, and the ring is the clock
function drawMinion(m) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  const fk = { x: m.x, y: m.y, phase: m.phase, vx: m.fx || 1, elite: 0, hp: 1,
               mode: 'lunge', lx: m.fx || 1, st: 0 };
  const col = '#57e6c4';
  if (m.src === 'wolf') drawWolf(fk, col);
  else if (m.src === 'archer') drawArcher(fk, col);
  else if (m.src === 'troll') drawTroll(fk, col, 0);
  else drawGoblin(fk, col);
  ctx.globalAlpha = 1;
  const fr = clamp(m.t / MINION_T, 0, 1);
  ctx.strokeStyle = 'rgba(100,255,218,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m.x, m.y + 2, 12, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/* ── THE BATTLEFIELD (atmosphere pass) ──
   The open field used to be a transparent canvas showing the XP desktop through
   it. Now the fight happens somewhere: a scorched night field — mottled earth,
   old battle debris, fog breathing at the rim, embers rising off unseen fires —
   beneath a HORIZON BAND holding a gothic city in silhouette (spires, a twin-
   towered cathedral, dead trees, a fenced yard of graves) under a hunter's moon
   that ripens bone → amber → blood as the run deepens, all of it under a WAVE
   TINT that runs cold dawn-blue to blood red (grey in the mournful world). The
   band is pure backdrop — sprites walk in front of it, exactly like the set-
   piece rooms' painted walls. STRICTLY render-only and rnd()-free: everything
   animates off `frame` + a position hash, so the deterministic draw-stream and
   60/120Hz cadence tests hold, and no sim version bump is needed. The set-piece
   rooms (corridor / mansion / Ian) still paint their own worlds. Steady (never
   flashing) under prefers-reduced-motion. */
function drawBattlefield() {
  const RM = api.reduceMotion;
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  // ── the run's MOOD, stepped once per draw call (= per tick) ──
  // dread: the Nine (and the Witch-king after them) snuff the field's warmth —
  // embers die, fog flees outward, the tint drops to a dead grey-violet, and
  // the light pools dim to half (see drawLightPools). Eases over ~30 ticks and
  // relights the same way once the king falls.
  dreadF += (((nineActive || (bossActive && !nineDone)) ? 1 : 0) - dreadF) * 0.04;
  const dread = dreadF;
  // the gathering storm: still air early, the wind rising as the Nine draw near
  // (wave 4 is the eve), settling to a war-torn breeze after
  const wind = wave === 4 ? 1 : wave === 3 ? 0.4 : wave >= 6 ? 0.5 : 0;
  const ogreUp = enemies.some((e) => e.type === 'ogre' && !e.dead);
  const deep = Math.min(1, (wave - 1) / 9);   // how far into the night the run is (shared by moon + tint)
  // 1) the ground — deep and cold, faintly lifted at the fight's heart
  let g = ctx.createLinearGradient(0, 0, 0, GH);
  g.addColorStop(0, '#141a30'); g.addColorStop(0.55, '#0d1120'); g.addColorStop(1, '#080b12');
  ctx.fillStyle = g; ctx.fillRect(-30, -30, GW + 60, GH + 60);   // overscan bleed — the living camera drifts
  // 1b) THE NIGHT ABOVE — the horizon band. A haze-dimmed sky, a hunter's
  //     moon, a slow rack of cloud, and the old city in silhouette. Hash-
  //     placed and `frame`-driven like everything else here; the moon's
  //     color is pure sim state (wave/dread/mournful), so the draw stream
  //     stays a function of the seed.
  const HOR = GH * 0.26;
  const sky = ctx.createLinearGradient(0, -30, 0, HOR);
  sky.addColorStop(0, '#1a2138'); sky.addColorStop(0.6, '#131a2c'); sky.addColorStop(1, '#141a30');
  ctx.fillStyle = sky; ctx.fillRect(-30, -30, GW + 60, HOR + 30);
  for (let i = 0; i < 14; i++) {   // a few dim stars through the haze
    const tw = RM ? 0.5 : 0.35 + 0.35 * Math.sin(frame * 0.017 + i * 3.3);
    ctx.fillStyle = 'rgba(205,215,235,' + (0.18 * tw).toFixed(3) + ')';
    ctx.fillRect(-30 + ih(i + 811) * (GW + 60), 4 + ih(i + 837) * HOR * 0.5, 1.1, 1.1);
  }
  // the moon — bone-pale at dawn-wave, ripening late toward blood; dread
  // bleaches it to a dead pallor, the mournful world keeps it ash-grey
  const mk = mournful ? 0 : deep * deep;
  let mcr = 236 - 26 * mk, mcg = 228 - 134 * mk, mcb = 206 - 150 * mk;
  if (mournful) { mcr = 168; mcg = 168; mcb = 176; }
  mcr = Math.round(mcr + (170 - mcr) * dread);
  mcg = Math.round(mcg + (172 - mcg) * dread);
  mcb = Math.round(mcb + (182 - mcb) * dread);
  const mrgb = mcr + ',' + mcg + ',' + mcb;
  const mx = GW * 0.73, my = HOR * 0.5, mR = Math.max(22, Math.min(GW, GH) * 0.075);
  const halo = ctx.createRadialGradient(mx, my, mR * 0.5, mx, my, mR * 3.6);
  halo.addColorStop(0, 'rgba(' + mrgb + ',' + (0.15 * (1 - dread * 0.5)).toFixed(3) + ')');
  halo.addColorStop(1, 'rgba(' + mrgb + ',0)');
  ctx.fillStyle = halo;
  ctx.fillRect(mx - mR * 3.6, my - mR * 3.6, mR * 7.2, mR * 7.2);
  const md = ctx.createRadialGradient(mx - mR * 0.35, my - mR * 0.35, mR * 0.2, mx, my, mR);
  md.addColorStop(0, 'rgb(' + mrgb + ')');
  md.addColorStop(1, 'rgb(' + Math.max(0, mcr - 62) + ',' + Math.max(0, mcg - 66) + ',' + Math.max(0, mcb - 58) + ')');
  ctx.fillStyle = md; ctx.beginPath(); ctx.arc(mx, my, mR, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.10)';   // the old scars on its face
  ctx.beginPath();
  ctx.arc(mx - mR * 0.3, my - mR * 0.1, mR * 0.16, 0, Math.PI * 2);
  ctx.arc(mx + mR * 0.25, my + mR * 0.3, mR * 0.12, 0, Math.PI * 2);
  ctx.arc(mx + mR * 0.1, my - mR * 0.38, mR * 0.09, 0, Math.PI * 2);
  ctx.fill();
  // a slow rack of cloud dragging across the moon (still air under RM)
  for (let i = 0; i < 3; i++) {
    const cw = GW * (0.26 + ih(i + 861) * 0.18), ch = 6 + ih(i + 883) * 6;
    const cx = ((ih(i + 907) * (GW + 320) + (RM ? 0 : frame * (0.05 + ih(i + 929) * 0.06) * (1 + wind))) % (GW + 320)) - 160;
    const cy = HOR * (0.22 + ih(i + 953) * 0.5);
    ctx.fillStyle = 'rgba(9,12,20,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, cw / 2, ch, 0, 0, Math.PI * 2);
    ctx.ellipse(cx + cw * 0.36, cy + 2, cw * 0.3, ch * 0.7, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // the city on the horizon — a far roofline pale in the haze, a near one black
  const roofline = (n, seed, colr, hLo, hHi) => {
    ctx.fillStyle = colr;
    const cell = (GW + 60) / n;
    for (let i = 0; i < n; i++) {
      const bw = cell * (0.55 + ih(i * 3 + seed) * 0.5);
      const bx = -30 + i * cell;
      const bh = hLo + ih(i * 7 + seed + 39) * (hHi - hLo);
      const by = HOR - bh;
      ctx.fillRect(bx, by, bw, bh + 4);
      const p = ih(i + seed + 73);
      if (p < 0.34) {          // a needle spire
        ctx.beginPath(); ctx.moveTo(bx + bw * 0.15, by + 1); ctx.lineTo(bx + bw * 0.5, by - bh * (0.6 + p)); ctx.lineTo(bx + bw * 0.85, by + 1); ctx.closePath(); ctx.fill();
      } else if (p < 0.62) {   // a pitched gable
        ctx.beginPath(); ctx.moveTo(bx - 1, by + 1); ctx.lineTo(bx + bw / 2, by - 3 - ih(i + seed + 91) * 6); ctx.lineTo(bx + bw + 1, by + 1); ctx.closePath(); ctx.fill();
      } else {                 // a flat roof and its cold chimneys
        ctx.fillRect(bx + bw * 0.18, by - 4, 2, 5);
        ctx.fillRect(bx + bw * 0.66, by - 6, 2.4, 7);
      }
    }
  };
  roofline(13, 900, '#161d31', HOR * 0.16, HOR * 0.40);
  roofline(8, 1200, '#080b13', HOR * 0.08, HOR * 0.26);
  // the cathedral every such city is built around, twin spires over the nave
  const cwid = Math.max(90, GW * 0.13), cxl = GW * 0.30 - cwid / 2, cnh = HOR * 0.34, cth = HOR * 0.52;
  ctx.fillStyle = '#080b13';
  ctx.fillRect(cxl + cwid * 0.16, HOR - cnh, cwid * 0.68, cnh + 4);
  ctx.beginPath();
  for (const tx of [cxl, cxl + cwid * 0.82]) {
    ctx.rect(tx, HOR - cth, cwid * 0.18, cth + 4);
    ctx.moveTo(tx - 2, HOR - cth + 1);
    ctx.lineTo(tx + cwid * 0.09, HOR - cth - HOR * 0.22);
    ctx.lineTo(tx + cwid * 0.18 + 2, HOR - cth + 1);
    ctx.closePath();
  }
  ctx.fill();
  // its rose window, holding a little haunted light (dark in dread)
  const rw = RM ? 0.7 : 0.55 + 0.45 * Math.sin(frame * 0.013);
  ctx.fillStyle = 'rgba(178,138,210,' + (0.2 * rw * (1 - dread)).toFixed(3) + ')';
  ctx.beginPath(); ctx.arc(GW * 0.30, HOR - cnh * 0.55, cwid * 0.075, 0, Math.PI * 2); ctx.fill();
  // dead trees clawing at the sky
  ctx.strokeStyle = '#080b13'; ctx.lineWidth = 1.7; ctx.lineCap = 'round';
  for (let i = 0; i < 3; i++) {
    const tx = GW * (0.09 + ih(i + 1501) * 0.82), th = 15 + ih(i + 1531) * 13;
    const lean = (ih(i + 1553) - 0.5) * 10;
    ctx.beginPath();
    ctx.moveTo(tx, HOR + 3);
    ctx.quadraticCurveTo(tx + lean * 0.4, HOR - th * 0.55, tx + lean, HOR - th);
    ctx.moveTo(tx + lean * 0.55, HOR - th * 0.62);
    ctx.lineTo(tx + lean * 0.55 + (ih(i + 1571) - 0.5) * 14, HOR - th * 0.9);
    ctx.moveTo(tx + lean * 0.3, HOR - th * 0.4);
    ctx.lineTo(tx + lean * 0.3 - 6 - ih(i + 1597) * 5, HOR - th * 0.62);
    ctx.stroke();
  }
  ctx.lineCap = 'butt';
  // an iron fence and its quiet tenants, black against the moon's halo
  const f0 = GW * 0.58, f1 = GW * 0.88;
  ctx.strokeStyle = '#080b13'; ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(f0, HOR - 5.5); ctx.lineTo(f1, HOR - 5.5);
  for (let x = f0; x <= f1; x += 6.5) { ctx.moveTo(x, HOR + 2); ctx.lineTo(x, HOR - 9); }
  ctx.stroke();
  ctx.fillStyle = '#080b13';
  for (let x = f0; x <= f1; x += 6.5) {
    ctx.beginPath(); ctx.moveTo(x - 1.3, HOR - 9); ctx.lineTo(x, HOR - 12); ctx.lineTo(x + 1.3, HOR - 9); ctx.closePath(); ctx.fill();
  }
  for (let i = 0; i < 3; i++) {   // headstones leaning shoulder to shoulder
    const gx = f0 + 8 + ih(i + 1621) * (f1 - f0 - 16), gh = 5 + ih(i + 1647) * 4;
    ctx.beginPath();
    ctx.moveTo(gx - 2.6, HOR + 2); ctx.lineTo(gx - 2.6, HOR - gh);
    ctx.arc(gx, HOR - gh, 2.6, Math.PI, 0);
    ctx.lineTo(gx + 2.6, HOR + 2); ctx.closePath(); ctx.fill();
  }
  // candle-lit windows across the skyline — snuffed one and all under dread
  const wLit = (1 - dread) * (mournful ? 0.35 : 1);
  if (wLit > 0.05) {
    for (let i = 0; i < 9; i++) {
      const wx = -20 + ih(i + 1701) * (GW + 40);
      const wy = HOR - 7 - ih(i + 1723) * HOR * 0.20;
      const fl = RM ? 0.75 : 0.55 + 0.45 * Math.sin(frame * 0.021 + i * 2.7);
      ctx.fillStyle = 'rgba(255,184,92,' + (0.42 * fl * wLit).toFixed(3) + ')';
      ctx.fillRect(wx, wy, 1.7, 2.6);
    }
  }
  // the ground-haze the city stands in (and the horizon seam drowns in)
  const hz = ctx.createLinearGradient(0, HOR - 22, 0, HOR + 30);
  hz.addColorStop(0, 'rgba(96,110,145,0)');
  hz.addColorStop(0.5, 'rgba(96,110,145,' + (0.13 * (1 - dread * 0.5)).toFixed(3) + ')');
  hz.addColorStop(1, 'rgba(96,110,145,0)');
  ctx.fillStyle = hz; ctx.fillRect(-30, HOR - 22, GW + 60, 52);
  // and the moonlight lying long across the field below
  const sheen = ctx.createRadialGradient(mx, HOR, 0, mx, HOR, GH * 0.85);
  sheen.addColorStop(0, 'rgba(' + mrgb + ',' + (0.055 * (1 - dread)).toFixed(3) + ')');
  sheen.addColorStop(1, 'rgba(' + mrgb + ',0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(-30, HOR, GW + 60, GH - HOR + 30);
  // 2) mottled earth: fixed hashed scorch patches and faint dead moss
  for (let i = 0; i < 32; i++) {
    const x = ih(i) * GW, y = HOR + 6 + ih(i + 51) * (GH - HOR - 16);
    const r = 20 + ih(i + 97) * 44;
    ctx.fillStyle = i % 3 ? 'rgba(0,0,0,0.08)' : 'rgba(34,46,38,0.06)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.42, ih(i + 13) * 3.14, 0, Math.PI * 2); ctx.fill();
  }
  // 2b) GROUND MEMORY: the field remembers this run — ash where they fell,
  //     scorch rings where fire landed, frost blooms melting away (~40s fades;
  //     recorded by sim events via addDecal, pruned here as they expire)
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    const age = tick - d.t0;
    const life = d.kind === 'frost' ? 700 : 2400;
    if (age >= life) { decals.splice(i, 1); continue; }
    const a = (1 - age / life) * (d.kind === 'ash' ? 0.22 : d.kind === 'frost' ? 0.2 : 0.3);
    if (d.kind === 'scorch') {
      ctx.strokeStyle = 'rgba(10,6,4,' + a.toFixed(3) + ')'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,' + (a * 0.8).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = d.kind === 'frost'
        ? 'rgba(150,200,230,' + a.toFixed(3) + ')'
        : 'rgba(20,16,14,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.kind === 'frost' ? 20 : 13, d.kind === 'frost' ? 8 : 5.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 3) the debris of older battles: half-buried skulls, snapped spears, ribs
  for (let i = 0; i < 15; i++) {
    const x = ih(i + 201) * GW, y = HOR + 14 + ih(i + 233) * (GH - HOR - 36);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ih(i + 77) * Math.PI);
    ctx.globalAlpha = 0.2;
    if (i % 5 === 0) {           // a half-buried skull, staring at nothing
      ctx.fillStyle = '#9aa3a8';
      ctx.beginPath(); ctx.arc(0, 0, 3.4, Math.PI, 0); ctx.fill();
      ctx.fillRect(-2.6, -0.4, 1.4, 1.8); ctx.fillRect(1.2, -0.4, 1.4, 1.8);
    } else if (i % 5 === 1) {    // a snapped spear
      ctx.strokeStyle = '#6b5a40'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#8a939c';
      ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(11, 0); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
    } else {                     // a rib, or just a rock
      ctx.strokeStyle = i % 2 ? '#727a82' : '#3c444d'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 4.6, 0.3, 2.4); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // 4) embers rising off fires just out of sight (a steady field under RM) —
  //    blown sideways by the storm wind, flushed red while the War-Ogre lives,
  //    and SNUFFED entirely as dread takes the field
  const emberA = 1 - dread;
  if (emberA > 0.02) {
    for (let i = 0; i < 22; i++) {
      const sp = 0.25 + ih(i + 301) * 0.5;
      const yy = GH - ((RM ? i * 37 : frame * sp + ih(i + 331) * GH) % (GH + 20));
      const drift = RM ? 0 : Math.sin((frame * 0.01 + i) * 1.7) * 14 + frame * 0.5 * wind;
      const xx = (((ih(i + 359) * GW + drift) % GW) + GW) % GW;
      const tw = RM ? 0.5 : 0.35 + 0.3 * Math.sin(frame * 0.11 + i * 2.1);
      const gCh = ogreUp ? 70 + ((i * 37) % 40) : 120 + ((i * 37) % 60);
      ctx.fillStyle = 'rgba(255,' + gCh + ',40,' + (Math.max(0.08, tw * 0.35) * emberA).toFixed(3) + ')';
      ctx.fillRect(xx, yy, i % 5 === 0 ? 2 : 1.4, i % 5 === 0 ? 2 : 1.4);
    }
  }
  // 5) fog banks breathing along the rim (very slow — vestibular-safe); the
  //    storm hurries them, and dread drives them outward and thin
  for (let i = 0; i < 5; i++) {
    const t = RM ? 0.5 : 0.5 + 0.5 * Math.sin(frame * 0.004 + i * 1.9);
    const spd = 0.00015 * (1 + wind * 3);
    const fx = (((i * 0.23 + 0.06) + (RM ? 0 : frame * spd * (i % 2 ? 1 : -1))) % 1 + 1) % 1 * GW;
    const fy = i % 2 ? 28 + t * 10 - dread * 40 : GH - 32 - t * 10 + dread * 40;
    const fr = (130 + ih(i + 407) * 90) * (1 + dread * 0.8);
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, 'rgba(120,140,170,' + (0.10 * (0.5 + t * 0.5) * (1 - dread * 0.55)).toFixed(3) + ')');
    fg.addColorStop(1, 'rgba(120,140,170,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }
  // 5b) the eve of the Nine: silent lightning flickers at the field's edge
  //     (wave 4 only; skipped under reduced motion — it is a flash by nature)
  if (wave === 4 && !RM && dread < 0.2) {
    const cyc = Math.floor(frame / 380);
    const ph = frame % 380;
    if (ph < 6) {
      const side = ih(cyc + 611) < 0.5 ? 0 : GW;
      const lg = ctx.createRadialGradient(side, GH * (0.2 + ih(cyc + 613) * 0.5), 0, side, GH * 0.4, GW * 0.7);
      lg.addColorStop(0, 'rgba(200,215,255,' + (0.10 * (1 - ph / 6)).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-30, -30, GW + 60, GH + 60);
    }
  }
  // 6) the wave tint: cold blue dawn → violet dusk → blood red as the run
  //    deepens — and dread drains it all to a dead grey-violet
  const tr = Math.round((40 + deep * 160) * (1 - dread) + 70 * dread);
  const tg = Math.round((30 - deep * 14) * (1 - dread) + 60 * dread);
  const tb = Math.round((90 - deep * 60) * (1 - dread) + 90 * dread);
  const ta = (0.05 + deep * 0.07) * (1 - dread) + 0.16 * dread;
  ctx.fillStyle = mournful
    ? 'rgba(90,90,100,0.10)'
    : 'rgba(' + tr + ',' + tg + ',' + tb + ',' + ta.toFixed(3) + ')';
  ctx.fillRect(-30, -30, GW + 60, GH + 60);
  // 6b) EVENT LIGHT WASH: the big moments light the whole world for a breath —
  //     Excalibur gold, a powerup's element, the cold drain of a hero falling
  //     (a smooth eased fade, never a flash; stepped once per draw = per tick)
  if (fieldWash) {
    const w = fieldWash;
    const wa = w.a * (1 - w.t / w.T) * (1 - w.t / w.T);
    ctx.fillStyle = 'rgba(' + w.rgb + ',' + wa.toFixed(3) + ')';
    ctx.fillRect(-30, -30, GW + 60, GH + 60);
    if (++w.t >= w.T) fieldWash = null;
  }
  // 7) the dark leans in from the edges — and leans in HARDER under dread
  const v = ctx.createRadialGradient(GW / 2, GH * 0.52, Math.min(GW, GH) * (0.36 - dread * 0.09), GW / 2, GH * 0.52, Math.max(GW, GH) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (0.4 + dread * 0.18).toFixed(3) + ')');
  ctx.fillStyle = v; ctx.fillRect(-30, -30, GW + 60, GH + 60);
  // 8) EYES IN THE DARK: during the breather, red glints blink open in the
  //    vignette darkness — the next wave, already watching (steady under RM);
  //    and while dread holds the field, the horde's silhouettes ring the edge
  if (breatherT > 0 && waveQuota + enemies.length === 0 && !mournful) {
    const nEyes = Math.min(8, 3 + wave);
    const edgeIn = Math.min(1, (BREATHER - breatherT) / 20, breatherT / 20);
    for (let i = 0; i < nEyes; i++) {
      const blink = RM ? 1 : (((frame + i * 37) % 90) < 72 ? 1 : 0);
      if (!blink) continue;
      const side = Math.floor(ih(wave * 13 + i) * 4);
      const along = 0.12 + ih(wave * 29 + i + 7) * 0.76;
      const ex = side === 0 ? 14 + ih(i + wave) * 10 : side === 1 ? GW - 14 - ih(i + wave) * 10 : along * GW;
      const ey = side < 2 ? 44 + along * (GH - 60) : side === 2 ? 48 + ih(i + wave) * 10 : GH - 16 - ih(i + wave) * 10;
      ctx.fillStyle = 'rgba(255,60,50,' + (0.55 * edgeIn).toFixed(3) + ')';
      ctx.fillRect(ex - 2.6, ey, 1.7, 1.7);
      ctx.fillRect(ex + 1, ey, 1.7, 1.7);
    }
  }
  if (dread > 0.5) {
    const wA = (dread - 0.5) * 0.36;
    for (let i = 0; i < 10; i++) {
      const along = ih(i + 501);
      const top = i % 2 === 0;
      const wx = 30 + along * (GW - 60);
      const wy = top ? 34 : GH - 12;
      ctx.fillStyle = 'rgba(6,8,12,' + wA.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(wx, wy, 7 + ih(i + 531) * 4, Math.PI, 0);   // a hunched, motionless watcher
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(wx - 5, wy - 6); ctx.lineTo(wx - 8, wy - 12); ctx.lineTo(wx - 3, wy - 8);   // an ear
      ctx.closePath(); ctx.fill();
    }
  }
}
/* ── LIGHT POOLS — the fight lights the field ──
   Soft additive ground glows under everything that burns, hums, or shines:
   blades, the stone, spell orbs, powerups, blasts, keg fuses, minions, allies,
   and a cool presence glow anchoring each hero to the dark. Render-only. */
function drawLightPools() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dim = 1 - dreadF * 0.5;   // the Nine dim every light on the field
  const pool = (x, y, r, rgb, a) => {
    a *= dim;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const puls = api.reduceMotion ? 0.75 : 0.65 + 0.35 * Math.sin(frame * 0.07);
  for (const h of heroesLive()) {
    pool(h.x, h.y + 2, 46, '140,170,210', 0.05);
    if (h.heldSaber) pool(h.x, h.y - 6, 70, '80,160,255', 0.10 * puls);
    else if (h.swordT > 0) pool(h.x, h.y - 6, 64, '255,200,80', 0.09 * puls);
    if (h.cls === 'caster' && h.castT > 0) pool(h.x, h.y - 10, 60, '200,140,255', 0.12);
    if (h.cls === 'necro') pool(h.x, h.y, 40, '80,255,215', 0.04);
  }
  if (stone) pool(stone.x, stone.y, 80, '255,200,80', 0.10 * puls);
  if (saberPickup) pool(saberPickup.x, saberPickup.y, 70, '80,160,255', 0.10 * puls);
  for (const pu of powerups) {
    pool(pu.x, pu.y, 54, pu.kind === 'freeze' ? '120,210,255' : pu.kind === 'fire' ? '255,140,60' : '190,150,255', 0.10 * puls);
  }
  for (const b of blasts) {
    if (b.x == null) continue;   // chain-lightning blasts carry point lists, not a center
    pool(b.x, b.y, (b.rMax || 80) * 1.1, b.kind === 'frost' ? '120,210,255' : b.kind === 'fire' ? '255,120,40' : '190,150,255', 0.12);
  }
  for (const k of kegs) {        // the arcing keg's lit fuse
    const t = k.t / k.T;
    pool(k.sx + (k.tx - k.sx) * t, k.sy + (k.ty - k.sy) * t - Math.sin(t * Math.PI) * 60, 26, '255,160,60', 0.10);
  }
  for (const m of minions) pool(m.x, m.y, 34, '80,255,215', 0.05);
  for (const al of allies) {
    if (al.x == null) continue;
    pool(al.x, al.y, 50, al.kind === 'luke' ? '120,255,140' : al.kind === 'gandalf' ? '220,220,255' : '160,120,255', 0.07);
  }
  ctx.restore();
}
