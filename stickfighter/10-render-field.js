// ── render-field — drawEnemy dispatch, champions, stone/saber pickups, held weapons, husks/minions ──
function drawEnemy(e) {
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
