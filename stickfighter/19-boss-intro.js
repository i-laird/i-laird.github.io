// ── boss-intro — BOSS_INTROS cards, codec box, small draw utils (hexA, roundRectPath, wrapText) ──
/* ── boss intros: a Smash-style "CHALLENGER APPROACHING" card, then an
   MGS-style codec entrance with a typing dialogue box, before the fight ── */
const BOSS_INTROS = {
  witchking: {
    name: 'THE WITCH-KING', title: 'LORD OF THE NAZGÛL',
    deep: '#150c1b', accent: '#7e57c2', glow: '#c3a4ff', col: '#14101c', sfx: 'screech',
    pose: () => ({ x: player.x - 100, y: 0, mounted: false, mode: 'idle', flailAng: -0.7, phase: 0 }),
    draw: (e, c) => drawWitchKing(e, c),
    lines: [
      { by: 'THE WITCH-KING', text: 'You fool. No living man may hinder me.' },
      { by: 'THE WITCH-KING', text: 'I will bear you away to a house of lamentation.' },
    ],
  },
  vader: {
    name: 'DARTH VADER', title: 'DARK LORD OF THE SITH',
    deep: '#1a0608', accent: '#e23b3b', glow: '#ff8a80', col: '#101014', sfx: 'saber',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'hover', phase: 0, disarmed: false, slashAng: 0 }),
    draw: (e, c) => drawVader(e, c),
    lines: [
      { by: 'DARTH VADER', text: 'I have been waiting for you.' },
      { by: 'DARTH VADER', text: 'When I left you, I was but the learner. Now I am the master.' },
    ],
  },
  sidious: {
    name: 'DARTH SIDIOUS', title: 'THE EMPEROR',
    deep: '#140a1c', accent: '#9a4ddb', glow: '#caa6ff', col: '#0b0b12', sfx: 'zap',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'idle', lit: 1, phase: 0, phase2: false, hop: 0 }),
    draw: (e, c) => drawSidious(e, c),
    lines: [
      { by: 'DARTH SIDIOUS', text: 'At last we meet again.' },
      { by: 'DARTH SIDIOUS', text: 'I have been expecting you. Welcome... to your end.' },
    ],
  },
  dio: {
    name: 'DIO', title: 'THE WORLD',
    deep: '#170f24', accent: '#ffc400', glow: '#fff59d', col: '#1f1b29', sfx: 'zawarudo',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'idle', phase: 0, crumble: 0, stand: 0 }),
    draw: (e, c) => drawDio(e, c),
    lines: [
      { by: 'DIO', text: 'You thought you could rest, hero?' },
      { by: 'DIO', text: 'MUDA MUDA MUDA! Let me show you... THE WORLD.' },
    ],
  },
  ian: {
    name: 'IAN', title: 'THE CREATOR',
    deep: '#1a1338', accent: '#ff9ec4', glow: '#bfe6ff', col: '#e8eef5', sfx: 'blip',
    pose: () => ({ x: 0, y: 0, mode: 'plead', phase: 0, crumble: 0, fade: 1 }),
    draw: (e, c) => drawIan(e, c),
    lines: [
      { by: '???', text: 'wait — wait. please. it\'s me.' },
      { by: 'IAN', text: 'I made all of this. the goblins, the Nazgûl, DIO... you.' },
      { by: 'IAN', text: 'and I\'m not even armed. so... it\'s your call now.' },
    ],
  },
};
const eOut = (u) => 1 - (1 - u) * (1 - u);
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}
function beginBossIntro(key, spawnFn) {
  const cfg = BOSS_INTROS[key];
  if (!cfg) { spawnFn && spawnFn(); return; }
  bossIntro = { key, cfg, spawnFn, phase: 'approach', t: 0, lineIdx: 0, chars: 0, holdT: 0 };
  shake = 0;
  sfSfx.challenger();
}
function nextBossLine() {
  const bi = bossIntro;
  bi.lineIdx++; bi.chars = 0; bi.holdT = 0;
  if (bi.lineIdx >= bi.cfg.lines.length) finishBossIntro();
}
function finishBossIntro() {
  const fn = bossIntro.spawnFn;
  bossIntro = null;
  keys = {};
  if (fn) fn();
}
// confirm key (Z / X / Space / Enter): proceed from the card, snap/advance the dialogue
function advanceBossIntro() {
  const bi = bossIntro;
  if (bi.phase === 'approach') {
    bi.phase = 'entrance'; bi.t = 0; bi.lineIdx = 0; bi.chars = 0; bi.holdT = 0;
    if (sfSfx[bi.cfg.sfx]) sfSfx[bi.cfg.sfx]();   // the boss's signature roar
    return;
  }
  const line = bi.cfg.lines[bi.lineIdx];
  if (bi.chars < line.text.length) { bi.chars = line.text.length; bi.holdT = 0; }  // snap the line in
  else nextBossLine();
}
// a large vector portrait of the boss, reusing its in-game sprite, scaled about (cx,cy=feet)
function drawBossPortrait(cfg, cx, cy, scale) {
  const e = cfg.pose();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-e.x, -e.y);
  cfg.draw(e, cfg.col);
  ctx.restore();
}
function drawCodecBox(cfg, bi) {
  const { accent, glow } = cfg;
  const m = 22, boxX = m, boxY = 16, boxW = GW - m * 2, boxH = 94;
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,12,0.93)'; roundRectPath(boxX, boxY, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 2; roundRectPath(boxX, boxY, boxW, boxH, 6); ctx.stroke();
  // face chip
  const chip = boxH - 22, cx0 = boxX + 12, cy0 = boxY + 11;
  ctx.save();
  roundRectPath(cx0, cy0, chip, chip, 4); ctx.clip();
  const fg = ctx.createLinearGradient(cx0, cy0, cx0, cy0 + chip);
  fg.addColorStop(0, hexA(glow, 0.16)); fg.addColorStop(1, '#08080d');
  ctx.fillStyle = fg; ctx.fillRect(cx0, cy0, chip, chip);
  drawBossPortrait(cfg, cx0 + chip / 2, cy0 + chip * 1.5, (chip * 1.25) / 55);
  ctx.restore();
  ctx.strokeStyle = glow; ctx.lineWidth = 1.5; roundRectPath(cx0, cy0, chip, chip, 4); ctx.stroke();
  // scanline tint over the chip
  ctx.save(); roundRectPath(cx0, cy0, chip, chip, 4); ctx.clip();
  ctx.globalAlpha = 0.12; ctx.fillStyle = glow;
  for (let yy = cy0; yy < cy0 + chip; yy += 3) ctx.fillRect(cx0, yy, chip, 1);
  ctx.restore();
  // speaker + typed line
  const line = bi.cfg.lines[bi.lineIdx];
  const tx = cx0 + chip + 16, tw = boxW - (tx - boxX) - 16;
  ctx.textAlign = 'left';
  ctx.fillStyle = accent; ctx.font = 'bold 13px Tahoma,Arial';
  ctx.fillText(line.by, tx, boxY + 26);
  ctx.strokeStyle = hexA(accent, 0.5); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, boxY + 32); ctx.lineTo(tx + tw, boxY + 32); ctx.stroke();
  ctx.fillStyle = '#e8eef5'; ctx.font = '15px Tahoma,Arial';
  wrapText(line.text.slice(0, Math.floor(bi.chars)), tx, boxY + 54, tw, 20);
  if (bi.chars >= line.text.length && (api.reduceMotion || Math.floor(bi.t / 16) % 2 === 0)) {
    ctx.fillStyle = glow; ctx.font = 'bold 14px Tahoma,Arial';
    ctx.fillText('▼', boxX + boxW - 24, boxY + boxH - 12);
  }
  // progress pips
  ctx.textAlign = 'right';
  ctx.fillStyle = hexA(glow, 0.8); ctx.font = '11px Tahoma,Arial';
  ctx.fillText(bi.cfg.lines.map((_, i) => i <= bi.lineIdx ? '●' : '○').join(' '), boxX + boxW - 14, boxY + 24);
  ctx.restore();
  ctx.textAlign = 'left';
}
function drawBossIntro() {
  const bi = bossIntro, cfg = bi.cfg; bi.t++;
  const { accent, glow, deep } = cfg;
  ctx.save();
  ctx.textAlign = 'left';

  if (bi.phase === 'approach') {
    const t = bi.t;
    ctx.fillStyle = deep; ctx.fillRect(0, 0, GW, GH);
    // radial vignette
    const vg = ctx.createRadialGradient(GW * 0.5, GH * 0.46, 30, GW * 0.5, GH * 0.5, GW * 0.7);
    vg.addColorStop(0, hexA(glow, 0.10)); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    // sweeping diagonal hazard stripes
    ctx.save();
    ctx.translate(GW / 2, GH / 2); ctx.rotate(-0.46);
    ctx.globalAlpha = 0.09; ctx.fillStyle = accent;
    const off = api.reduceMotion ? 0 : (t * 1.4) % 86;
    for (let x = -GW; x < GW * 1.5; x += 86) ctx.fillRect(x + off, -GH, 40, GH * 2);
    ctx.restore();

    // glow + portrait sliding in from the right with an ease-out overshoot
    const ps = eOut(Math.min(1, t / 22));
    const px = GW * 0.66 + (1 - ps) * GW * 0.55;
    const sc = (GH * 0.62) / 55 * (0.92 + 0.08 * ps);
    if (!api.reduceMotion) {
      const gl = ctx.createRadialGradient(px, GH * 0.5, 10, px, GH * 0.5, GH * 0.55);
      gl.addColorStop(0, hexA(glow, 0.4)); gl.addColorStop(1, hexA(glow, 0));
      ctx.fillStyle = gl; ctx.fillRect(0, 0, GW, GH);
    }
    ctx.save(); ctx.globalAlpha = Math.min(1, t / 9);
    drawBossPortrait(cfg, px, GH * 0.5 + GH * 0.29, sc);
    ctx.restore();

    // slanted name band sliding in from the left
    const bandY = GH * 0.60, slide = eOut(Math.min(1, t / 18));
    const bx = -GW * (1 - slide);
    ctx.save();
    ctx.globalAlpha = 0.94; ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(bx, bandY); ctx.lineTo(bx + GW + 80, bandY - 20);
    ctx.lineTo(bx + GW + 80, bandY + 60); ctx.lineTo(bx, bandY + 80);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(bx, bandY + 62, GW + 160, 4);
    // name + title on the band
    ctx.globalAlpha = 1; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff'; ctx.font = 'italic bold 40px Tahoma,Arial'; ctx.textAlign = 'left';
    ctx.fillText(cfg.name, 40, bandY + 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.font = 'bold 15px Tahoma,Arial';
    ctx.fillText(cfg.title, 42, bandY + 54);
    ctx.restore();

    // top kicker
    const top = eOut(Math.min(1, t / 16));
    ctx.save();
    ctx.globalAlpha = top * (api.reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(t * 0.12));
    ctx.fillStyle = glow; ctx.font = 'italic bold 26px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = hexA(accent, 0.9); ctx.shadowBlur = 12;
    ctx.fillText('⚠  CHALLENGER  APPROACHING  ⚠', GW / 2, 56);
    ctx.restore();

    // prompt
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 0.16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('▶  press  Z  to face them  ◀', GW / 2, GH - 22);
    ctx.restore();
    hud.innerHTML = 'CHALLENGER APPROACHING<br>press Z to begin the duel';
  } else {
    // entrance: the boss looms over a dimmed field while the codec box types
    ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, GW, GH);
    const rise = eOut(Math.min(1, bi.t / 26));
    // floor glow
    ctx.save();
    const fg = ctx.createRadialGradient(GW / 2, GH * 0.94, 8, GW / 2, GH * 0.94, GW * 0.4);
    fg.addColorStop(0, hexA(glow, 0.22)); fg.addColorStop(1, hexA(glow, 0));
    ctx.fillStyle = fg; ctx.fillRect(0, GH * 0.6, GW, GH * 0.4);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = rise;
    drawBossPortrait(cfg, GW / 2, GH * 0.93 + (1 - rise) * 70, (GH * 0.52) / 55);
    ctx.restore();

    // advance the typewriter
    const line = cfg.lines[bi.lineIdx];
    if (bi.chars < line.text.length) {
      const before = Math.floor(bi.chars);
      bi.chars = Math.min(line.text.length, bi.chars + (api.reduceMotion ? 2.4 : 0.62));
      if (Math.floor(bi.chars) > before && Math.floor(bi.chars) % 2 === 0 && line.text[before] !== ' ') sfSfx.blip();
      bi.holdT = 0;
    } else {
      bi.holdT++;
      if (bi.holdT > 96) nextBossLine();
    }
    if (bossIntro) drawCodecBox(cfg, bi);   // nextBossLine() may have ended the intro
    hud.innerHTML = 'a foe steps forward...<br>Z to advance';
  }
  ctx.restore();
  ctx.textAlign = 'left';
}
