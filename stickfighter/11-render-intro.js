// ── render-intro — class-preview mannequins, the intro/title screen, drawHero/drawDownedHero ──
// the intro's living mannequin: the hero as currently built — weapon in hand, gently
// scanning — over a class-colored spotlight. `hot` marks the row being edited.
function drawClassPreview(x, y, cls, color, hot, label) {
  const cc = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL, rider: '#ffab91' }[cls];
  ctx.save();
  // light pool under the feet
  ctx.globalAlpha = hot ? 0.5 : 0.26;
  const pool = ctx.createRadialGradient(x, y + 4, 4, x, y + 4, 46);
  pool.addColorStop(0, cc); pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath(); ctx.ellipse(x, y + 4, 46, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // the hero at 1.3× — a fake hero object drives the same weapon draws the game uses,
  // its facing swaying slowly so the weapon reads as alive, not a museum piece
  ctx.translate(x, y); ctx.scale(1.3, 1.3); ctx.translate(-x, -y);
  const fake = { x, y, fx: 1, fy: Math.sin(frame * 0.02) * 0.22, swingT: 0, castT: 0,
                 swordT: 1e9, heldSaber: false, cls, tint: color, phase: frame * 0.05, mounted: true };
  if (cls === 'wyrm') {
    drawWyrm(fake);   // the beast IS the figure
  } else {
    heroFigure(x, y, frame * 0.05, color, cls, 1, 1, 1, 0, hot ? cc : 0);
    if (cls === 'ranged') drawHeldBow(fake);
    else if (cls === 'caster') drawHeldStaff(fake);
    else if (cls === 'necro') drawHeldScythe(fake);
    else if (cls === 'dragoon' || cls === 'rider') drawHeldLance(fake);
    else drawHeldSword(fake);
  }
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.font = (hot ? 'bold ' : '') + '13px Tahoma,Arial'; ctx.fillStyle = hot ? cc : '#9aa3a8';
  ctx.fillText((label ? label + ' · ' : '') + CLASS_ICON[cls] + ' ' + cls.toUpperCase(), x, y + 32);
  ctx.restore(); ctx.textAlign = 'left';
}

/* the title scene: a night field with the horde marching the ridge in silhouette,
   a gold wordmark, and pill-style mode/class selectors around the mannequin stage.
   Deliberately rnd()-free — every animation runs off `frame`, so pumping title
   frames can never advance the seeded sim stream. Pulses are steady (never
   flashing) under prefers-reduced-motion. */
function drawIntroScreen() {
  const RM = api.reduceMotion;
  // deterministic per-index jitter (a hash, NOT rnd() — see the note above)
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const rr = (x, y, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  ctx.clearRect(0, 0, GW, GH);
  ctx.save();

  /* ── the night scene ── */
  const gy = Math.round(GH * 0.3);                    // the ridge line
  let g = ctx.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, '#04060c'); g.addColorStop(0.7, '#0b1220'); g.addColorStop(1, '#151017');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, gy);
  g = ctx.createLinearGradient(0, gy, 0, GH);
  g.addColorStop(0, '#11161d'); g.addColorStop(1, '#07090d');
  ctx.fillStyle = g; ctx.fillRect(0, gy, GW, GH - gy);
  for (let i = 0; i < 46; i++) {                      // starfield (steady when RM)
    const sx = ih(i) * GW, sy = ih(i + 97) * (gy - 28) + 6;
    const tw = RM ? 0.5 : 0.35 + 0.28 * Math.sin(frame * 0.045 + i * 1.7);
    ctx.fillStyle = 'rgba(215,230,255,' + Math.max(0.12, tw).toFixed(2) + ')';
    const sz = i % 7 === 0 ? 2 : 1.4;
    ctx.fillRect(sx, sy, sz, sz);
  }
  // ember glow over the ridge — the horde's fires, just out of sight. Peaks AT the
  // ridge line and fades both ways, so the marchers read as backlit silhouettes
  g = ctx.createLinearGradient(0, gy - 56, 0, gy + 26);
  g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(0.7, 'rgba(255,130,45,0.26)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, gy - 56, GW, 82);
  // the horde on the march — real sprites, scaled down and silhouetted (frozen when RM)
  // (no archers — drawArcher faces the live `player`, which would break the march)
  const parade = ['goblin', 'wolf', 'goblin', 'troll', 'wolf', 'goblin', 'wolf', 'goblin', 'troll'];
  const span = GW + 160, step = span / parade.length;
  const xoff = RM ? 0 : (frame * 0.32) % span;
  ctx.save(); ctx.globalAlpha = 0.85;
  for (let i = 0; i < parade.length; i++) {
    const x = ((i * step + ih(i + 41) * 44 - xoff) % span + span) % span - 80;
    const sc = 0.5 + ih(i + 13) * 0.14;
    const fk = { x: 0, y: 0, phase: RM ? ih(i + 71) * 6.28 : frame * 0.11 + i * 1.9,
                 vx: -1, mode: 'lunge', lx: -1 };    // vx/lx pin the facing to the march
    ctx.save(); ctx.translate(x, gy + 2); ctx.scale(sc, sc);
    if (parade[i] === 'goblin') drawGoblin(fk, '#0d1218');
    else if (parade[i] === 'wolf') drawWolf(fk, '#0d1218');
    else drawTroll(fk, '#0d1218', 0);
    ctx.restore();
  }
  ctx.restore();
  // vignette so the scene falls away at the edges
  g = ctx.createRadialGradient(GW / 2, GH * 0.44, Math.min(GW, GH) * 0.32, GW / 2, GH * 0.44, Math.max(GW, GH) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);

  /* ── the wordmark ── */
  ctx.textAlign = 'center';
  const blade = (bx, by, ang) => {                    // a crest of crossed swords behind the title
    ctx.save(); ctx.translate(bx, by); ctx.rotate(ang); ctx.globalAlpha = 0.55;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6e7f8f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(0, -46); ctx.stroke();
    ctx.strokeStyle = '#cdd8e2'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(0, -42); ctx.stroke();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10, 40); ctx.lineTo(10, 40); ctx.stroke();
    ctx.fillStyle = '#c9a227';
    ctx.beginPath(); ctx.arc(0, 49, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  blade(GW / 2, 52, -0.62); blade(GW / 2, 52, 0.62);
  const breathe = RM ? 0 : Math.sin(frame * 0.05);    // a slow glow, not a flash
  ctx.lineJoin = 'round';
  ctx.font = 'bold ' + Math.min(44, Math.round(GW / 11)) + 'px Tahoma,Arial';
  ctx.strokeStyle = '#120d02'; ctx.lineWidth = 7;
  ctx.strokeText('STICK FIGHTER', GW / 2, 62);
  g = ctx.createLinearGradient(0, 24, 0, 66);
  g.addColorStop(0, '#fff7dc'); g.addColorStop(0.55, '#ffd24d'); g.addColorStop(1, '#9a7a1f');
  ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 14 + 6 * breathe;
  ctx.fillStyle = g;
  ctx.fillText('STICK FIGHTER', GW / 2, 62);
  ctx.shadowBlur = 0;
  // the 2000 plate, knocked slightly askew — very Y2K
  ctx.save();
  ctx.translate(GW / 2, 84); ctx.rotate(-0.045);
  rr(-52, -14, 104, 27, 6);
  ctx.fillStyle = '#160a06'; ctx.fill();
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1.5; ctx.stroke();
  g = ctx.createLinearGradient(0, -12, 0, 12);
  g.addColorStop(0, '#ffe4b3'); g.addColorStop(0.5, '#ff8a3c'); g.addColorStop(1, '#c62828');
  ctx.font = 'bold 20px Tahoma,Arial'; ctx.fillStyle = g;
  ctx.fillText('2 0 0 0', 0, 7);
  ctx.restore();
  ctx.font = 'italic 13px Tahoma,Arial'; ctx.fillStyle = '#d9a44a';
  ctx.fillText('the horde approaches.  RUN.  (and fight)', GW / 2, 116);

  /* ── the selectors ── */
  const pill = (x, y, w, h, label, sel, active, col, font) => {
    rr(x, y, w, h, h / 2);
    if (sel) {
      if (active) { ctx.shadowColor = col; ctx.shadowBlur = RM ? 10 : 8 + 4 * Math.sin(frame * 0.09); }
      ctx.fillStyle = active ? col : '#77828c';
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#10141a';
    } else {
      ctx.strokeStyle = active ? '#4b5a6a' : '#333d48'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = active ? '#93a3b3' : '#5c6773';
    }
    ctx.font = (sel ? 'bold ' : '') + (font || '13px Tahoma,Arial');
    ctx.fillText(label, x + w / 2, y + h / 2 + 4.5);
  };
  // row 0: SINGLEPLAYER / MULTIPLAYER — row 1: the branch's own sub-choices
  const tops = ['SINGLEPLAYER', 'MULTIPLAYER'];
  const topCol = ['#ffd24d', '#7fd8ff'];
  const tw2 = 150, mh = 26, mgap = 12;
  const tx0 = GW / 2 - (tw2 * 2 + mgap) / 2;
  for (let i = 0; i < 2; i++) pill(tx0 + i * (tw2 + mgap), 128, tw2, mh, tops[i], menuTop === i, introRow === 0, topCol[i]);
  const subs = menuTop === 0
    ? [['NORMAL', '#ffd24d'], [hardUnlocked ? '☠ HARD' : '🔒 HARD', '#ff6e6e'], ['☀ DAILY', '#ffb300']]
    : [['LOCAL', P2_COL], ['🌐 HOST', '#7fd8ff'], ['🌐 JOIN', '#7fd8ff']];
  const subSel = menuTop === 0 ? subSingle : subMulti;
  const mw = 108;
  const mx0 = GW / 2 - (mw * 3 + mgap * 2) / 2;
  for (let i = 0; i < 3; i++) {
    const locked = menuTop === 0 && i === 1 && !hardUnlocked;
    pill(mx0 + i * (mw + mgap), 160, mw, mh, subs[i][0], subSel === i, introRow === 1 && !locked, locked ? '#49525c' : subs[i][1]);
  }
  // one contextual notice line under the selectors
  ctx.font = '11px Tahoma,Arial';
  if (menuTop === 0 && subSingle === 2) {
    ctx.fillStyle = '#ffb300';
    ctx.fillText('☀ ' + dailyDayPretty() + ' — one seed for everyone · today\'s own board · resets at UTC midnight', GW / 2, 200);
  } else if (menuTop === 0 && subSingle === 1 && hardUnlocked) {
    ctx.font = 'bold 11px Tahoma,Arial'; ctx.fillStyle = '#ff6e6e';
    ctx.fillText('☠ HARD MODE — earned by mercy · elites from the first wave, everything comes early', GW / 2, 200);
  } else if (menuTop === 1 && subMulti === 1) {
    ctx.fillStyle = '#7fd8ff';
    ctx.fillText('🌐 HOST — you get a room code to share · pick YOUR class below (your friend picks theirs)', GW / 2, 200);
  } else if (menuTop === 1 && subMulti === 2) {
    ctx.fillStyle = '#7fd8ff';
    ctx.fillText('🌐 JOIN — type the room code a host gave you · pick YOUR class below (the host picks theirs)', GW / 2, 200);
  } else if (netNoticeT > 0 && netNotice) {
    netNoticeT--;
    ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = '#ff8a80';
    ctx.fillText('🌐 ' + netNotice, GW / 2, 200);
  }
  // the mannequin stage: a podium per hero, then the live preview(s) on top
  const py = clamp(Math.round(GH * 0.5), 240, 300);
  const podium = (x) => {
    ctx.fillStyle = 'rgba(10,14,19,0.7)';
    ctx.beginPath(); ctx.ellipse(x, py + 7, 58, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,160,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, py + 7, 58, 15, 0, 0, Math.PI * 2); ctx.stroke();
  };
  if (!isLocalMulti()) {
    podium(GW / 2);
    drawClassPreview(GW / 2, py, CLASSES[classSel], 'white', introRow === 2);
  } else {
    // room to breathe: the two podiums sit as far apart as the field allows
    const podX = Math.min(140, Math.round(GW * 0.18));
    podium(GW / 2 - podX); podium(GW / 2 + podX);
    drawClassPreview(GW / 2 - podX, py, CLASSES[classSel], 'white', introRow === 2, 'P1');
    drawClassPreview(GW / 2 + podX, py, CLASSES[classSel2], P2_COL, introRow === 3, 'P2');
  }
  ctx.textAlign = 'center';
  const clsCol = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL, rider: '#ffab91' };
  // the wyrm & rider are a PAIR: the wyrm pill appears only on P1's row in couch
  // co-op, and picking it binds P2's row to the single locked rider pill
  const PICKS_SOLO = [0, 1, 2, 3, 4];
  const cgap = 10, ch = 24;
  const clsRow = (y, sel, active, lbl, lblCol, list) => {
    const n = list.length;
    const cw = Math.min(104, Math.floor((GW - 60 - cgap * (n - 1)) / n));
    const x0 = GW / 2 - (cw * n + cgap * (n - 1)) / 2;
    if (lbl) {
      ctx.textAlign = 'right'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = lblCol;
      ctx.fillText(lbl, x0 - 12, y + ch / 2 + 4.5); ctx.textAlign = 'center';
    }
    for (let i = 0; i < n; i++) {
      const ci = list[i];
      pill(x0 + i * (cw + cgap), y, cw, ch, CLASS_ICON[CLASSES[ci]] + ' ' + CLASSES[ci].toUpperCase(),
           sel === ci, active, clsCol[CLASSES[ci]], '12px Tahoma,Arial');
    }
  };
  let cy = py + 48;
  if (!isLocalMulti()) {
    clsRow(cy, classSel, introRow === 2, null, null, PICKS_SOLO);
  } else {
    clsRow(cy, classSel, introRow === 2, 'P1', '#fff', [...PICKS_SOLO, PAIR_WYRM]);
    cy += 32;
    if (classSel === PAIR_WYRM) {
      clsRow(cy, PAIR_RIDER, false, 'P2', P2_COL, [PAIR_RIDER]);   // bound to the wyrm
    } else {
      clsRow(cy, classSel2, introRow === 3, 'P2', P2_COL, PICKS_SOLO);
    }
  }
  const CLASS_BLURB = {
    melee:  'run over the stone to seize the sword — X cleaves all before you',
    ranged: 'hold a direction and X looses an arrow that way — diagonals work',
    caster: 'X casts the chosen page — C turns the spellbook · spells drink mana, kills give it back',
    necro:  'X reaps a wide arc — husks caught in the sweep RISE as minions · kills feed the soul well',
    dragoon: 'JOUST: your speed IS the lance — meet every foe at full gallop or die on its body · X flaps',
    wyrm:  'the PAIR: you ARE the beast — steer, flap, TRAMPLE at speed · your kills feed the heat',
    rider: "the PAIR: you never steer — your keys AIM the saddle lance · E breathes fire from the wyrm's heat",
  };
  ctx.font = 'italic 12px Tahoma,Arial'; ctx.fillStyle = '#aeb9c4';
  ctx.fillText(CLASS_BLURB[CLASSES[introRow === 3 ? classSel2 : classSel]], GW / 2, cy + 40);

  /* ── footer: control hints on a dimmed bar, BEGIN pulsing above it ── */
  const hints = [];
  if (isLocalMulti()) {
    hints.push(['Player 1 (white):  arrows move  ·  Right-Shift dash  ·  /  attack', '#fff']);
    hints.push(['Player 2 (green):  WASD move  ·  Left-Shift dash  ·  F  attack', P2_COL]);
    hints.push(['allies & upgrades are shared — revive a downed partner by standing close', '#9fb0c0']);
  } else if (menuTop === 1) {
    hints.push(['move: WASD / arrows   ·   dash: Space / Shift   ·   attack: X / F', '#c8d2da']);
    hints.push(['online co-op — your friend picks their own class · revive a downed partner by standing close', '#7fd8ff']);
  } else {
    hints.push(['move: WASD / arrows   ·   dash: Space / Shift   ·   attack: X / F', '#c8d2da']);
  }
  hints.push(['◀ ▶ choose   ·   ↑ ↓ switch row   ·   1 / 2 / 3 jump to a mode', '#9fb0c0']);
  hints.push(['🏆 trophy case ' + sfTrophies.size + ' / ' + SF_ACH.length + '   ·   press T', sfTrophies.size === SF_ACH.length ? '#7CFC8A' : '#c9a227']);
  hints.push(['coins raise your multiplier  ·  graze foes for bonus  ·  clear waves for tokens', '#8494a4']);
  const barH = hints.length * 17 + 14;
  ctx.fillStyle = 'rgba(5,8,12,0.55)'; ctx.fillRect(0, GH - barH, GW, barH);
  ctx.strokeStyle = 'rgba(90,110,130,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, GH - barH); ctx.lineTo(GW, GH - barH); ctx.stroke();
  let hy = GH - barH + 19;
  ctx.font = '12px Tahoma,Arial';
  for (const [text, color] of hints) { ctx.fillStyle = color; ctx.fillText(text, GW / 2, hy); hy += 17; }
  const pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin(frame * 0.07);   // a fade, never a flash
  const bw = 250, bh = 30, byy = GH - barH - 44;
  rr(GW / 2 - bw / 2, byy, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(255,210,77,' + (0.1 + 0.08 * pulse).toFixed(3) + ')'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,77,' + (0.55 + 0.4 * pulse).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
  ctx.fillText(menuTop === 1 && subMulti === 1 ? '🌐  Z / ENTER — CREATE A ROOM'
             : menuTop === 1 && subMulti === 2 ? '🌐  Z / ENTER — ENTER A CODE'
             : menuTop === 1 ? '⚔  Z / ENTER — READY UP'
             : '⚔  Z / ENTER — BEGIN', GW / 2, byy + 20);

  if (introConfirm) drawIntroConfirm(); // the couch co-op party sheet (confirm gate)
  if (showTrophies) drawTrophyCase();   // the case sits over the whole intro
  ctx.restore(); ctx.textAlign = 'left';
}

// the couch co-op party sheet: a confirm gate over the intro so a stray Enter
// can't launch the run while someone's still deciding. Z/Enter starts (the key
// handler falls through to the begin branch), Q/Backspace backs out.
function drawIntroConfirm() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, GW, GH);
  const w = Math.min(500, GW - 40), h = 252, x = GW / 2 - w / 2, y = GH / 2 - h / 2 - 10;
  roundRectPath(x, y, w, h, 12);
  ctx.fillStyle = 'rgba(10,16,24,0.96)'; ctx.fill();
  ctx.strokeStyle = P2_COL; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = 'bold 17px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
  ctx.fillText('⚔  READY TO FIGHT? — COUCH CO-OP', GW / 2, y + 32);
  const px = Math.min(120, Math.round(w * 0.24));
  const py = y + 128;
  drawClassPreview(GW / 2 - px, py, CLASSES[classSel], 'white', true, 'P1');
  drawClassPreview(GW / 2 + px, py, CLASSES[classSel2], P2_COL, true, 'P2');
  ctx.textAlign = 'center';
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('P1: arrows · Right-Shift dash · / attack       P2: WASD · Left-Shift dash · F attack', GW / 2, y + h - 46);
  ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7CFC8A';
  ctx.fillText('Z / ENTER — fight!       Q / Backspace — back', GW / 2, y + h - 18);
  ctx.restore(); ctx.textAlign = 'left';
}

// the WYRM — the co-op pair's war-beast (a proud Joust lineage): big gliding body,
// long neck, snapping beak, galloping legs, and stub wings that beat on a flap.
// Drawn in place of the hero figure for cls 'wyrm'; the mounted rider is a normal
// hero drawn at the saddle right after it.
function drawWyrm(h) {
  const dir = h.fx >= 0 ? 1 : -1;
  const col = heroTint(h);
  const run = Math.hypot(h.vx || 0, h.vy || 0);
  const gait = Math.sin(h.phase || 0);
  const beat = Math.max(0, 1 - (tick - (h.flapT || -99)) / 14);   // wingbeat decays after a flap
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(dir, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs first (behind the body), scissoring with the stride
  ctx.strokeStyle = col; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(-7 + gait * 5, -2); ctx.lineTo(-9 + gait * 7, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -12); ctx.lineTo(7 - gait * 5, -2); ctx.lineTo(9 - gait * 7, 0); ctx.stroke();
  // tail plume
  ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(-14, -18); ctx.quadraticCurveTo(-24, -22 + gait * 2, -30, -16 + gait * 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, -20); ctx.quadraticCurveTo(-23, -27 + gait * 2, -28, -24 + gait * 2); ctx.stroke();
  // the body — a stout ellipse, saddle blanket over the spine
  ctx.fillStyle = 'rgba(20,26,34,0.92)';
  ctx.strokeStyle = col; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(0, -18, 16, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-7, -26); ctx.quadraticCurveTo(0, -30, 7, -26); ctx.stroke();   // the saddle
  // stub wing, beating on a flap (steady half-raised under reduced motion)
  const wa = api.reduceMotion ? 0.4 : beat;
  ctx.fillStyle = 'rgba(255,167,38,0.4)'; ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-2, -22);
  ctx.quadraticCurveTo(-12, -30 - wa * 10, -20, -26 - wa * 14);
  ctx.quadraticCurveTo(-12, -20, -3, -17);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // the neck + head, leaning into the run; the beak snaps at trample speed
  const lean = Math.min(6, run * 1.2);
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(10, -22); ctx.quadraticCurveTo(16 + lean, -34, 17 + lean, -42); ctx.stroke();
  ctx.fillStyle = 'rgba(20,26,34,0.92)';
  ctx.beginPath(); ctx.ellipse(18 + lean, -44, 6, 4.5, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = DRAGOON_COL;                                      // the beak
  const snap = run >= JOUST_BAR.goblin ? (api.reduceMotion ? 1.5 : 1 + gait * 1.6) : 0.8;
  ctx.beginPath(); ctx.moveTo(23 + lean, -45); ctx.lineTo(31 + lean, -44 + snap); ctx.lineTo(23 + lean, -42); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd24d';                                        // the eye
  ctx.beginPath(); ctx.arc(19 + lean, -45, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// the hero's current body color: P1 white / P2 green, overridden by the dash
// cyan and the frost-wolf chill. The intro mannequins pass their display color
// through `h.tint`. Used by the body draw AND the weapon arms/fists, so P2's
// bow arm is green like the rest of P2.
function heroTint(h) {
  if (h.tint) return h.tint;
  const base = coop && p2 ? SEAT_COLS[heroSeat(h)] || 'white' : 'white';
  return h.dashT > 0 ? '#80deea' : h.chillT > 0 ? '#a8d8e8' : base;
}
// draw one hero (class-dressed figure + Aegis bubble + held weapon). A downed
// hero is drawn fallen with a revive ring instead.
function drawHero(h) {
  if (h.down) { drawDownedHero(h); return; }
  if (h.cls === 'wyrm') { drawWyrm(h); return; }
  const lean = clamp(h.vx * 0.04, -0.3, 0.3);
  const col = heroTint(h);
  heroFigure(h.x, h.y, h.phase, col, h.cls, h.fx >= 0 ? 1 : -1, 1, 1, lean, h.dashT > 0 ? '#80deea' : 'rgba(255,255,255,0.5)');
  // the Aegis: a soft hex-bubble around the hero while it holds; a bright flash as it breaks
  if (h.shield || h.iframe > 0) {
    const breaking = !h.shield && h.iframe > 0;
    const a = breaking ? h.iframe / 44 : (api.reduceMotion ? 0.5 : 0.42 + 0.18 * Math.sin(frame * 0.14));
    ctx.save(); ctx.translate(h.x, h.y - 14);
    ctx.strokeStyle = breaking ? 'rgba(200,240,255,' + a + ')' : 'rgba(127,216,255,' + a + ')';
    ctx.lineWidth = breaking ? 3.5 : 2.4;
    ctx.shadowColor = '#7fd8ff'; ctx.shadowBlur = breaking ? 16 : 8;
    const rad = 26 + (breaking ? (1 - h.iframe / 44) * 14 : 0);
    ctx.beginPath();
    for (let s = 0; s <= 6; s++) { const aa = s / 6 * Math.PI * 2 - Math.PI / 2; const fn = s ? 'lineTo' : 'moveTo'; ctx[fn](Math.cos(aa) * rad, Math.sin(aa) * rad * 1.18); }
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }
  if (h.cls === 'ranged') drawHeldBow(h);
  else if (h.cls === 'caster') drawHeldStaff(h);
  else if (h.cls === 'necro') drawHeldScythe(h);
  else if (h.cls === 'dragoon') drawHeldLance(h);
  else if (h.cls === 'rider' && h.mounted) drawHeldLance(h);   // the saddle lance rides the aim
  else if (h.cls === 'rider') drawHeldDirk(h);                 // unhorsed: a short desperate dirk
  else if (h.swordT > 0 || h.heldSaber) drawHeldSword(h);
}
// a fallen co-op hero: a prone figure with a revive ring that fills as a partner stands by
function drawDownedHero(h) {
  heroFigure(h.x, h.y, 0, '#7a7a7a', h.cls, h.fx >= 0 ? 1 : -1, 1, 0.7, Math.PI / 2, 'rgba(160,160,160,0.4)', true);
  const p = clamp(h.reviveT / reviveNeed(), 0, 1);
  ctx.save();
  ctx.translate(h.x, h.y - 18);
  ctx.strokeStyle = 'rgba(120,120,120,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
  if (p > 0) {
    ctx.strokeStyle = P2_COL; ctx.shadowColor = P2_COL; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0, 0, 15, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff8a80'; ctx.font = 'bold 14px Tahoma,Arial'; ctx.textAlign = 'center';
  ctx.fillText('✚', 0, -20);
  ctx.restore(); ctx.textAlign = 'left';
}
