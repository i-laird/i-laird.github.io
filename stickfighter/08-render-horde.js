// ── render-horde — stick/hero figures + horde sprites: goblin, shaman, bomber, wolf, archer, troll, ogre, wraith ──
/* ── drawing ── */
function stickFigure(x, y, phase, color, scale = 1, alpha = 1, lean = 0, glow = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // grounding shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 8; }   // soft rim so the hero reads against busy ground
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const s = Math.sin(phase);
  ctx.beginPath(); ctx.arc(0, -34, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-14, -20 + s * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo( 14, -20 - s * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -6);  ctx.lineTo(-10, -6 + 18 + s * 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -6);  ctx.lineTo( 10, -6 + 18 - s * 10); ctx.stroke();
  ctx.restore();
}

/* a HERO body — stickFigure plus the class garb, so the three kits read at a
   glance: melee wears a gold headband (tails streaming) and a sash, ranged a
   leaf-green hood + feather with a quiver slung on the back, caster a wizard
   hat and a flowing robe in place of legs. `dir` mirrors the garb to the
   facing; `mono` draws the garb in the body color only (dash ghosts, the
   downed gray) so tinted figures keep their silhouette without color pops.
   Animation is phase/frame-driven — no rnd(), same rule as all draw code. */
function heroFigure(x, y, phase, color, cls, dir = 1, scale = 1, alpha = 1, lean = 0, glow = 0, mono = false) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 8; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const s = Math.sin(phase);
  ctx.beginPath(); ctx.arc(0, -34, 8, 0, Math.PI * 2); ctx.stroke();       // head
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();    // torso
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-14, -20 + s * 8); ctx.stroke();  // arms
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo( 14, -20 - s * 8); ctx.stroke();
  if (cls !== 'caster' && cls !== 'necro') {                               // legs (robed classes cover them)
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-10, 12 + s * 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo( 10, 12 - s * 10); ctx.stroke();
  }
  // garb, drawn in facing space (+x = forward)
  ctx.scale(dir, 1);
  const gc = (c) => (mono ? color : c);
  ctx.fillStyle = cls === 'necro' && !mono ? NECRO_COL : color;            // an eye, so they face somewhere (the necro's burns soul-teal)
  ctx.beginPath(); ctx.arc(3.5, -35, cls === 'necro' ? 1.5 : 1.2, 0, Math.PI * 2); ctx.fill();
  if (cls === 'melee') {
    ctx.strokeStyle = gc('#ffd24d'); ctx.lineWidth = 2.5;                  // headband
    ctx.beginPath(); ctx.moveTo(-7.5, -37); ctx.lineTo(7.5, -37); ctx.stroke();
    const f1 = Math.sin(phase * 1.7) * 2, f2 = Math.sin(phase * 1.7 + 1.3) * 2.5;
    ctx.lineWidth = 1.8;                                                   // its two streaming tails
    ctx.beginPath(); ctx.moveTo(-7, -37); ctx.quadraticCurveTo(-13, -36 + f1, -17, -33 + f1 * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7, -37); ctx.quadraticCurveTo(-12, -33 + f2, -16, -28 + f2 * 1.5); ctx.stroke();
    ctx.lineWidth = 2;                                                     // waist sash
    ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(4, -10); ctx.stroke();
  } else if (cls === 'ranged') {
    ctx.strokeStyle = gc('#6b4a2b'); ctx.lineWidth = 4;                    // quiver on the back
    ctx.beginPath(); ctx.moveTo(-7, -25); ctx.lineTo(-11, -12); ctx.stroke();
    ctx.strokeStyle = gc('#9ccc65'); ctx.lineWidth = 1.5;                  // fletchings poking out
    ctx.beginPath(); ctx.moveTo(-7, -25); ctx.lineTo(-5.5, -30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8.5, -26); ctx.lineTo(-8, -31); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -24); ctx.lineTo(-3.5, -28.5); ctx.stroke();
    ctx.fillStyle = gc('#7cb342');                                         // peaked hood, point trailing back
    ctx.beginPath();
    ctx.moveTo(8.5, -36);
    ctx.quadraticCurveTo(6, -45, -2, -45.5);
    ctx.quadraticCurveTo(-12, -45, -16.5, -38.5);
    ctx.quadraticCurveTo(-10.5, -40.5, -8.5, -36);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = gc('#f5f5dc'); ctx.lineWidth = 1.5;                  // a feather in it
    ctx.beginPath(); ctx.moveTo(-1, -44.5); ctx.quadraticCurveTo(3, -50, 8, -51); ctx.stroke();
  } else if (cls === 'caster') {
    const sway = Math.sin(phase) * 2.5;                                    // robe hem sways against the stride
    ctx.fillStyle = mono ? color : 'rgba(126,87,194,0.35)';
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -10);
    ctx.quadraticCurveTo(-8, 0, -10 + sway, 11);
    ctx.quadraticCurveTo(0, 14, 10 + sway * 0.5, 11);
    ctx.quadraticCurveTo(8, 0, 4.5, -10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gc('#7e57c2');                                         // the hat cone, tip swept back
    ctx.beginPath();
    ctx.moveTo(-7, -39);
    ctx.quadraticCurveTo(-7, -50, -13, -56);
    ctx.quadraticCurveTo(-2, -54, 2, -47);
    ctx.quadraticCurveTo(5, -42, 7, -39);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = gc('#7e57c2'); ctx.lineWidth = 3;                    // wide brim
    ctx.beginPath(); ctx.moveTo(-12.5, -38.5); ctx.lineTo(12.5, -38.5); ctx.stroke();
    ctx.strokeStyle = gc('#ffd24d'); ctx.lineWidth = 1.6;                  // hat band
    ctx.beginPath(); ctx.moveTo(-6.5, -40.5); ctx.lineTo(6.5, -40.5); ctx.stroke();
  } else if (cls === 'necro') {
    const sway = Math.sin(phase) * 2;                                      // ragged grave-robe, torn hem
    ctx.fillStyle = mono ? color : 'rgba(74,68,96,0.55)';
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -10);
    ctx.quadraticCurveTo(-8.5, 0, -10.5 + sway, 12);
    ctx.lineTo(-6.5 + sway, 8); ctx.lineTo(-2.5, 12.5); ctx.lineTo(1.5, 8); ctx.lineTo(5.5, 12.5); ctx.lineTo(9.5 + sway * 0.5, 8.5);
    ctx.quadraticCurveTo(8.5, 0, 4.5, -10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gc('#4a4458');                                         // a deep grave-cowl, drooping behind
    ctx.beginPath();
    ctx.moveTo(9, -35);
    ctx.quadraticCurveTo(7, -46, -2, -46);
    ctx.quadraticCurveTo(-13, -45.5, -18, -36);
    ctx.quadraticCurveTo(-15, -30, -9, -33);
    ctx.quadraticCurveTo(-6, -30, 0, -31);
    ctx.closePath(); ctx.fill();
  } else if (cls === 'dragoon') {
    const beat = Math.sin(phase * 1.6) * 3;                                // wingbeat rides the stride
    ctx.fillStyle = mono ? color : 'rgba(255,167,38,0.45)';
    ctx.strokeStyle = gc(DRAGOON_COL); ctx.lineWidth = 1.6;
    ctx.beginPath();                                                       // the high rider's wing
    ctx.moveTo(-4, -28);
    ctx.quadraticCurveTo(-15, -38 - beat, -23, -31 - beat * 1.6);
    ctx.quadraticCurveTo(-14, -27, -6, -23);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();                                                       // the low wing, trailing
    ctx.moveTo(-4, -24);
    ctx.quadraticCurveTo(-14, -29 - beat * 0.6, -21, -23 - beat);
    ctx.quadraticCurveTo(-12, -21, -5, -19);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = gc('#cdd8e2'); ctx.lineWidth = 2.5;                  // steel half-helm
    ctx.beginPath(); ctx.moveTo(-7.5, -37.5); ctx.lineTo(7.5, -37.5); ctx.stroke();
    ctx.strokeStyle = gc(DRAGOON_COL); ctx.lineWidth = 1.5;                // its little crest wings
    ctx.beginPath(); ctx.moveTo(-6, -38); ctx.quadraticCurveTo(-11, -43, -15, -42.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -38); ctx.quadraticCurveTo(11, -43, 15, -42.5); ctx.stroke();
  }
  ctx.restore();
}

// the creator himself — an unarmed, bespectacled stick figure. modes:
//   'plead' standing tall with both hands up (the intro card), 'idle' kneeling in plea (the scene),
//   'rise' standing in relief (spared), 'dying' kneeling as he crumbles.
// e.crumble fades him to ash, e.fade dims him out.
function drawIan(e, col) {
  const tremble = api.reduceMotion ? 0 : Math.sin((e.phase || 0)) * 0.7;
  const cr = e.crumble || 0;
  const mode = e.mode || 'idle';
  const kneel = mode === 'idle' || mode === 'dying';
  const armsUp = mode === 'idle' || mode === 'dying' || mode === 'plead';
  const wob = api.reduceMotion ? 0 : Math.sin((frame || 0) * 0.16) * 1.6;   // pleading-hand wave
  ctx.save();
  ctx.globalAlpha = (e.fade == null ? 1 : e.fade) * (1 - cr);
  ctx.translate(e.x + tremble, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const hy = kneel ? -22 : -34;
  if (kneel) {
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 2); ctx.stroke();      // short torso
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-12, -22); ctx.stroke();  // arms raised, pleading
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(12, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-10, 4); ctx.lineTo(-12, 2); ctx.stroke();  // folded knees
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(8, 6); ctx.lineTo(12, 2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();     // torso
    if (armsUp) {                                                              // standing, both hands up
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(-12, -34 + wob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(12, -34 - wob); ctx.stroke();
    } else {                                                                   // relief, arms lowered
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-11, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(11, -12); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-9, 12); ctx.stroke();     // legs
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(9, 12); ctx.stroke();
  }
  /* ── the creator's face: his own portrait, South Park-ized — TWO PIECES hinged
     at the lips, clapping together while his lines run (the dlg queue is live).
     When the real photo (ianFace) is decoded it's drawn as elliptical cutout
     pieces — the authentic South Park celebrity treatment; otherwise the hand-
     drawn caricature below stands in. Flap is a fade-free bob; reduced motion
     holds it slightly ajar instead. Drawn over the stick body at head height. */
  // "talking" must cover every way his words reach the screen: lines still QUEUED
  // (dlg) or in the between-line gap (dlgT), the displayed spare speech (the dlg
  // pump shifts a line into the banner while it shows, so the queue alone goes
  // empty mid-speech — the 'thanks' phase spans the whole thing), and the intro
  // card's plea (which never touches dlg; it types on the card itself).
  const talking = mode !== 'dying' &&
                  (dlg.length > 0 || dlgT > 0 ||
                   (ianFinale && ianFinale.outcome === 'spare' && ianFinale.phase === 'thanks') ||
                   (bossIntro && bossIntro.key === 'ian' && bossIntro.phase !== 'approach'));
  const flap = talking ? (api.reduceMotion ? 2 : Math.abs(Math.sin((frame || 0) * 0.3)) * 5) : 0;
  const R = 8.5, skin = '#e8c39e', hair = '#2e241c', beard = '#3a2a20';
  if (ianFace.complete && ianFace.naturalWidth > 0) {
    const iw = ianFace.naturalWidth, ih = ianFace.naturalHeight;
    const MOUTH = 0.75;                        // the lip line, as a fraction of the photo's height
    const HW = 21, HH = HW * ih / iw;          // a touch larger than the stick head — it's a cutout
    const topH = HH * MOUTH, botH = HH - topH;
    const mouthY = hy + 1;
    // a tight head-shaped ellipse — trims the photo's background corners and collar
    const ecx = 0, ecy = mouthY - topH + HH * 0.47, erx = HW * 0.44, ery = HH * 0.46;
    if (flap > 0.6) {                          // the open mouth between the pieces
      ctx.fillStyle = '#4a1518';
      ctx.beginPath(); ctx.ellipse(0, mouthY - flap / 2, HW * 0.3, flap * 0.55 + 1.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    // the jaw piece: full photo drawn once, clipped to (head ellipse ∩ below the lips)
    ctx.save();
    ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(-HW / 2 - 2, mouthY, HW + 4, botH + 4); ctx.clip();
    ctx.drawImage(ianFace, -HW / 2, mouthY - topH, HW, HH);
    ctx.restore();
    // the top piece: same photo, clipped to (ellipse ∩ above the lips), lifted by the flap
    ctx.save();
    ctx.translate(0, -flap);
    ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(-HW / 2 - 2, mouthY - topH - 2, HW + 4, topH + 2); ctx.clip();
    ctx.drawImage(ianFace, -HW / 2, mouthY - topH, HW, HH);
    ctx.restore();
    // a tear, while he kneels (over the photo cheek)
    if (kneel && !api.reduceMotion && Math.floor((frame || 0) / 18) % 3 === 0) {
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath(); ctx.arc(HW * 0.28, mouthY - topH * 0.4, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (flap > 0.6) {                                          // the open mouth between the halves
    ctx.fillStyle = '#4a1518';
    ctx.beginPath(); ctx.ellipse(0, hy + 0.6 - flap / 2, R * 0.62, flap * 0.55 + 1.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the JAW half — chin wrapped in the full beard
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0, hy + 0.8, R, 0.12 * Math.PI, 0.88 * Math.PI); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = beard; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, hy + 0.8, R - 1, 0.16 * Math.PI, 0.84 * Math.PI); ctx.stroke();
  // the DOME half — bald on top, short dark hair on the sides, lifted by the flap
  ctx.save();
  ctx.translate(0, hy - flap);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(-R - 1.4, -1.4, 2.1, 0, Math.PI * 2); ctx.fill();   // the ears ride the top half
  ctx.beginPath(); ctx.arc(R + 1.4, -1.4, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0.8, R, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hair; ctx.lineWidth = 2.4;               // side hair — the top stays bare
  ctx.beginPath(); ctx.arc(0, 0.8, R - 0.8, Math.PI * 1.0, Math.PI * 1.24); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0.8, R - 0.8, Math.PI * 1.76, Math.PI * 2.0); ctx.stroke();
  ctx.lineWidth = 1.7;                                        // strong brows
  ctx.beginPath(); ctx.moveTo(-5.2, -3.2); ctx.lineTo(-1.6, -3.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1.6, -3.7); ctx.lineTo(5.2, -3.2); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';                                  // the eyes
  ctx.beginPath(); ctx.arc(-3.1, -1.5, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.1, -1.5, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c99b72'; ctx.lineWidth = 1.2;           // a hint of nose
  ctx.beginPath(); ctx.moveTo(0.2, -1); ctx.lineTo(-0.7, 0.2); ctx.stroke();
  ctx.strokeStyle = beard; ctx.lineWidth = 2;                 // the mustache rides the lip edge
  ctx.beginPath(); ctx.moveTo(-3.8, 0.6); ctx.quadraticCurveTo(0, 1.8, 3.8, 0.6); ctx.stroke();
  ctx.restore();
  // a tear, while he kneels
  if (kneel && !api.reduceMotion && Math.floor((frame || 0) / 18) % 3 === 0) {
    ctx.fillStyle = '#8fd8ff';
    ctx.beginPath(); ctx.arc(5.6, hy - 0.2, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ── enemy sprites (anchored at the feet like stickFigure) ── */
function drawGoblin(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.vx || (player.x - e.x)) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // scurrying legs
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-7, 4 + s * 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 4 - s * 5); ctx.stroke();
  // hunched spine
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(1, -18, 7, -22); ctx.stroke();
  // grasping arms reach forward
  ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(12 + s * 2, -8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(11 - s * 2, -10); ctx.stroke();
  // head with pointy ears
  ctx.beginPath(); ctx.arc(10, -27, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -31); ctx.lineTo(2, -38); ctx.lineTo(9, -32); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(17, -38); ctx.lineTo(10, -32); ctx.closePath(); ctx.fill();
  // the shield-bearer's buckler on its lead arm — gone once its blocks are spent;
  // the warlord carries a taller gold-bossed tower shield instead
  if (e.elite && (e.hp || 0) >= 2) {
    if (e.elite === 2) {
      ctx.fillStyle = '#aab2bb'; ctx.strokeStyle = '#8a6d1f'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(11, -22); ctx.lineTo(18, -22); ctx.lineTo(18, -4); ctx.lineTo(14.5, 0); ctx.lineTo(11, -4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a227';
      ctx.beginPath(); ctx.arc(14.5, -12, 2.4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#aab2bb'; ctx.strokeStyle = '#5d6d7e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(14, -11, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d6d7e';
      ctx.beginPath(); ctx.arc(14, -11, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawShaman(e, col) {
  ctx.save(); ctx.translate(e.x, e.y);
  // the ritual circle IS the haste zone — telegraphed exactly (gutters out while
  // iced); it flares hot while the frenzy-shriek has the pack sprinting
  if (!(e.frozen > 0)) {
    const fz = e.frenzyT > 0;
    const a = api.reduceMotion ? (fz ? 0.55 : 0.3)
      : fz ? 0.45 + 0.25 * Math.sin(frame * 0.22)
           : 0.2 + 0.12 * Math.sin(frame * 0.07);
    ctx.strokeStyle = (fz ? 'rgba(200,255,140,' : 'rgba(140,220,120,') + a.toFixed(2) + ')';
    ctx.lineWidth = fz ? 3 : 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(0, -8, SHAMAN_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // a ragged cowled robe, swaying with the chant
  const sway = Math.sin(e.phase) * 1.5;
  ctx.beginPath();
  ctx.moveTo(-8 + sway * 0.4, 0); ctx.lineTo(-3, -24); ctx.lineTo(5, -28); ctx.lineTo(8 + sway * 0.4, 0);
  ctx.closePath(); ctx.fill();
  // hooded goblin head — the kin ears poke through the cowl
  ctx.beginPath(); ctx.arc(6, -30, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(3, -34); ctx.lineTo(0, -40); ctx.lineTo(6, -34); ctx.closePath(); ctx.fill();
  // gnarled staff crowned with the chant-light
  ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(14, -34 + sway); ctx.stroke();
  const glow = api.reduceMotion ? 0.7 : 0.5 + 0.35 * Math.sin(frame * 0.11);
  ctx.fillStyle = '#a5e88a';
  ctx.shadowColor = '#8fdc78'; ctx.shadowBlur = 8 + glow * 8;
  ctx.beginPath(); ctx.arc(14, -37 + sway, 3.2 + glow, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawBomber(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // goblin kin: scurrying legs + hunched spine, bent under the powder load
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-6, 4 + s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 4 - s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(0, -16, 6, -20); ctx.stroke();
  // head with the pointy ears
  ctx.beginPath(); ctx.arc(9, -24, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -28); ctx.lineTo(2, -34); ctx.lineTo(8, -29); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12, -28); ctx.lineTo(15, -34); ctx.lineTo(9, -29); ctx.closePath(); ctx.fill();
  // the keg on its back — hoisted overhead while winding up the throw
  const up = e.mode === 'wind' ? 14 : 0;
  ctx.save();
  ctx.translate(-4, -26 - up); ctx.rotate(e.mode === 'wind' ? -0.2 : 0.35);
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-5, -7, 10, 14);
  ctx.strokeStyle = '#3e2a17'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-5, -7, 10, 14);
  ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(5, 3); ctx.stroke();
  if (e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 3) % 2 === 0)) {
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.arc(0, -10, 2.2, 0, Math.PI * 2); ctx.fill();   // fuse lit — it's coming
  }
  ctx.restore();
  // carrying arms up to the keg
  ctx.strokeStyle = col; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(4, -18); ctx.lineTo(-2, -24 - up); ctx.stroke();
  ctx.restore();
}

function drawWolf(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.mode === 'lunge' ? e.lx : (player.x - e.x)) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  // the dire frost wolf's chill aura — the icy ring IS the danger zone, telegraphed
  if (e.elite === 2) {
    ctx.strokeStyle = 'rgba(180,225,255,0.28)'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.arc(0, -8, 90, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 13, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // trotting legs
  ctx.beginPath(); ctx.moveTo(8, -12);   ctx.lineTo(8 + s * 4, 0);   ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11, -12);  ctx.lineTo(11 - s * 4, 0);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -12);  ctx.lineTo(-9 - s * 4, 0);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-12 + s * 4, 0); ctx.stroke();
  // arched back
  ctx.beginPath(); ctx.moveTo(-13, -13); ctx.quadraticCurveTo(0, -17, 12, -14); ctx.stroke();
  // tail
  ctx.beginPath(); ctx.moveTo(-13, -13); ctx.quadraticCurveTo(-19, -16, -21, -21); ctx.stroke();
  // neck, snout, ear
  ctx.beginPath(); ctx.moveTo(12, -14); ctx.lineTo(16, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, -19); ctx.lineTo(24, -16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, -21); ctx.lineTo(16, -27); ctx.lineTo(18, -21); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawArcher(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // legs
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-8, 4 + s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 4 - s * 4); ctx.stroke();
  // spine + pelvis
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -27); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -9); ctx.lineTo(4, -9); ctx.stroke();
  // ribs
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-5, -23);   ctx.lineTo(5, -23);   ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4.5, -19); ctx.lineTo(4.5, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -15);   ctx.lineTo(4, -15);   ctx.stroke();
  ctx.lineWidth = 2.5;
  // bow arm + bow
  ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(13, -22); ctx.stroke();
  ctx.beginPath(); ctx.arc(13, -22, 9, -Math.PI / 2.1, Math.PI / 2.1); ctx.stroke();
  ctx.lineWidth = 1.2;
  if (e.mode === 'aim') {  // string drawn, arrow nocked
    ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(4, -22); ctx.lineTo(13, -13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -22); ctx.lineTo(22, -22); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(13, -13); ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-6 - s * 2, -10); ctx.stroke();  // idle off arm
  }
  // skull
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, -34, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(2.2, -35, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-2.2, -35, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-2, -30.5, 4, 1.2);
  ctx.restore();
}

function drawTroll(e, col, lean) {
  const s = Math.sin(e.phase);
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 4, 19, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean); ctx.scale(1.35, 1.35);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  // stumpy legs
  ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-8, 2 + s * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -12);  ctx.lineTo(8, 2 - s * 2);  ctx.stroke();
  // big belly
  ctx.beginPath(); ctx.ellipse(0, -24, 12, 15, 0, 0, Math.PI * 2); ctx.fill();
  // club arm
  ctx.beginPath(); ctx.moveTo(8, -32); ctx.lineTo(17, -14); ctx.stroke();
  ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(17, -14); ctx.lineTo(23, -28); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 4.5;
  // other arm
  ctx.beginPath(); ctx.moveTo(-8, -32); ctx.lineTo(-15, -16 + s * 3); ctx.stroke();
  // head + tusks
  ctx.beginPath(); ctx.arc(0, -44, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(-4, -41); ctx.lineTo(-5, -46); ctx.lineTo(-2, -42); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4, -41);  ctx.lineTo(5, -46);  ctx.lineTo(2, -42);  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawOgre(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.lx || (player.x - e.x)) >= 0 ? 1 : -1;
  const charging = e.mode === 'charge';
  const winding = e.mode === 'wind';
  // telegraph: a dashed charge line + a swelling glow while it winds up the rush
  if (winding && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,82,82,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(e.x, e.y - 20);
    ctx.lineTo(e.x + (e.lx || 0) * 260, e.y - 20 + (e.ly || 0) * 260); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 6, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
  const lean = charging ? dir * 0.35 : 0;
  ctx.rotate(lean); ctx.scale(dir * 1.85, 1.85);
  if (winding) { ctx.shadowColor = '#ff5252'; ctx.shadowBlur = 12; }
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  // tree-trunk legs
  ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(-9, 3 + s * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -11);  ctx.lineTo(9, 3 - s * 1.5);  ctx.stroke();
  // huge hunched body
  ctx.beginPath(); ctx.ellipse(0, -22, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
  // a great slab of a club, raised when charging
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(9, -30); ctx.lineTo(charging ? 20 : 17, charging ? -34 : -12); ctx.stroke();
  ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath();
  if (charging) { ctx.moveTo(20, -34); ctx.lineTo(30, -46); } else { ctx.moveTo(17, -12); ctx.lineTo(25, -30); }
  ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  // off arm
  ctx.beginPath(); ctx.moveTo(-9, -30); ctx.lineTo(-16, -14 + s * 2); ctx.stroke();
  // brutish head + underbite tusks + a single horn
  ctx.beginPath(); ctx.arc(2, -40, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(-3, -36); ctx.lineTo(-4, -42); ctx.lineTo(-1, -37); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(5, -36);  ctx.lineTo(6, -42);  ctx.lineTo(3, -37);  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d7ccc8';
  ctx.beginPath(); ctx.moveTo(6, -46); ctx.lineTo(11, -54); ctx.lineTo(8, -45); ctx.closePath(); ctx.fill();
  // angry little eye
  ctx.fillStyle = winding ? '#ff5252' : '#1a0e0a';
  ctx.beginPath(); ctx.arc(4, -41, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawWraith(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  // flowing black robe with a ragged hem
  ctx.fillStyle = col; ctx.strokeStyle = '#4a3f66'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(-11, -22, -13 + s * 2, 0);
  ctx.lineTo(-6, -5 + s * 2);
  ctx.lineTo(0, 0);
  ctx.lineTo(6, -5 - s * 2);
  ctx.lineTo(13 + s * 2, 0);
  ctx.quadraticCurveTo(11, -22, 0, -40);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // hood with nothing inside but two burning eyes
  ctx.beginPath(); ctx.arc(0, -34, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(1, -33, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e53935';
  ctx.beginPath(); ctx.arc(-1, -34, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5, -34, 1.3, 0, Math.PI * 2); ctx.fill();
  // morgul blade
  ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(8, -20); ctx.lineTo(20, -26); ctx.stroke();
  ctx.restore();
}

// a slain wraith left crumpled on the ground (drawn in world space)
function drawCorpse(c) {
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 4, 19, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(c.dir, 1);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#16121e'; ctx.strokeStyle = '#3a3050'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-20, 1);
  ctx.quadraticCurveTo(-6, -8, 4, -3);
  ctx.quadraticCurveTo(16, -7, 24, 2);
  ctx.quadraticCurveTo(6, 8, -20, 4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-18, -2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
