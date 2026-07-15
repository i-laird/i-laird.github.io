// ── render-bosses — boss & set-piece sprites: witch-king, troopers, Vader, Sidious (+finale), DIO, The World, road roller ──
// the hooded, iron-crowned king himself — drawn at a local offset (caller sets dir)
function drawKingFigure(ox, oy, scale) {
  ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
  ctx.fillStyle = '#0d0a12'; ctx.strokeStyle = '#4a3f66'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(-12, -22, -14, 0);
  ctx.lineTo(-6, -4); ctx.lineTo(0, 0); ctx.lineTo(6, -4); ctx.lineTo(14, 0);
  ctx.quadraticCurveTo(12, -22, 0, -40);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // hood, with a black void where a face should be
  ctx.beginPath(); ctx.arc(0, -36, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(1, -35, 5.5, 0, Math.PI * 2); ctx.fill();
  // the iron crown of Angmar
  ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * 4, -43);
    ctx.lineTo(i * 4, -50 - (i === 0 ? 5 : Math.abs(i) === 1 ? 2 : 0)); ctx.stroke();
  }
  // two cold eyes
  ctx.fillStyle = '#e53935';
  ctx.beginPath(); ctx.arc(-2, -36, 1.4, 0, Math.PI * 2); ctx.arc(3.5, -36, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawWitchKing(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 6, e.mounted ? 32 : 16, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  if (e.mounted) {
    const f = Math.sin(e.phase) * 14;
    // sinuous tail
    ctx.strokeStyle = '#1a1622'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-24, -6);
    ctx.quadraticCurveTo(-50, -2, -58, -18); ctx.stroke();
    // membranous wings (far one offset behind the near one, flapping out of phase)
    const wing = (off, amp) => {
      ctx.beginPath();
      ctx.moveTo(-2 + off, -16);
      ctx.quadraticCurveTo(-30 + off, -40 - amp, -48 + off, -8 - amp);
      ctx.lineTo(-30 + off, -8);
      ctx.quadraticCurveTo(-18 + off, -6, -2 + off, -10);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    ctx.fillStyle = 'rgba(20,16,28,0.85)'; ctx.strokeStyle = '#46395e'; ctx.lineWidth = 1.5;
    wing(10, f * 0.6);
    wing(0, f);
    // body
    ctx.fillStyle = '#15111d'; ctx.strokeStyle = '#3a2f4a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-6, -6, 26, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // neck + wedge head reaching forward
    ctx.beginPath(); ctx.moveTo(14, -10);
    ctx.quadraticCurveTo(28, -16, 30, -30); ctx.lineTo(36, -30);
    ctx.quadraticCurveTo(34, -14, 20, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, -32); ctx.lineTo(46, -29); ctx.lineTo(40, -23); ctx.lineTo(30, -26); ctx.closePath(); ctx.fill(); ctx.stroke();
    // horns
    ctx.strokeStyle = '#2a2236'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(32, -32); ctx.lineTo(30, -41); ctx.stroke();
    // dangling clawed legs
    ctx.strokeStyle = '#1a1622'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(-2, 16); ctx.moveTo(6, 4); ctx.lineTo(10, 16); ctx.stroke();
    // the rider
    drawKingFigure(-6, -28, 0.92);
  } else {
    drawKingFigure(0, 0, 1.25);
    // the flail — chain + spiked ball, lethal mid-swing
    const len = e.mode === 'swing' ? 64 : e.mode === 'wind' ? 50 : 34;
    const bx = Math.cos(e.flailAng) * len;
    const by = -32 + Math.sin(e.flailAng) * len * 0.7;
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(8, -32); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 1.5;
    for (let a = 0; a < 8; a++) {
      const aa = a * Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(aa) * 10, by + Math.sin(aa) * 10);
      ctx.lineTo(bx + Math.cos(aa) * 16, by + Math.sin(aa) * 16); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// classic boss life bar pinned to the top of the field
function drawBossBar(b) {
  const w = 280, x = (GW - w) / 2, y = 14;
  let label, frac, fill;
  if (b.type === 'dio') {
    label = 'DIO  ·  the world is mine';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#ffd24d';
  } else if (b.type === 'sidious') {
    label = 'DARTH SIDIOUS  ·  the dark side of the Force';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#aa66ff';
  } else if (b.type === 'vader') {
    label = 'DARTH VADER  ·  dark lord of the sith';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#ff3b30';
  } else if (b.type === 'ogre') {
    label = 'THE WAR-OGRE  ·  it hungers';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#8d6e63';
  } else {
    label = 'THE WITCH-KING OF ANGMAR' + (b.mounted ? '  ·  upon his fell beast' : '  ·  on foot');
    frac = Math.max(0, b.hp) / (b.mounted ? b.mountMax : b.footMax); fill = b.mounted ? '#7e57c2' : '#e53935';
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = b.type === 'dio' ? '#ffe9a8' : b.type === 'sidious' ? '#d0b3ff' : '#e57373'; ctx.font = 'bold 12px Tahoma,Arial'; ctx.textAlign = 'center';
  ctx.fillText(label, GW / 2, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y + 6, w, 8);
  ctx.fillStyle = fill; ctx.fillRect(x, y + 6, w * frac, 8);
  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(x, y + 6, w, 8);
  ctx.restore(); ctx.textAlign = 'left';
}

function drawTrooper(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const sw = e.mode === 'march' ? Math.sin(e.phase) : 0;
  const white = col, edge = '#aeb9c1', dark = '#15181b';
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 3, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // back arm (behind the torso)
  ctx.strokeStyle = white; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(-3.5, -29); ctx.lineTo(-6, -20); ctx.stroke();

  // armoured legs: white thigh/shin, dark knee gap, dark boots, marching swing
  for (const s of [-1, 1]) {
    const off = s * sw * 3;
    ctx.strokeStyle = white; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(s * 2, -15); ctx.lineTo(s * 2 + off, -2); ctx.stroke();
    ctx.strokeStyle = dark; ctx.lineWidth = 4.8;  // black undersuit at the knee
    ctx.beginPath(); ctx.moveTo(s * 2 + off * 0.5, -8.5); ctx.lineTo(s * 2 + off * 0.6, -7); ctx.stroke();
  }
  ctx.fillStyle = dark;  // boots
  ctx.beginPath();
  ctx.ellipse(-2 - sw * 3, -1.5, 3.4, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(2 + sw * 3, -1.5, 3.4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // abdomen plate + dark belt
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-4.6, -25); ctx.lineTo(4.6, -25); ctx.lineTo(4, -15); ctx.lineTo(-4, -15); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(-4.6, -17.5, 9.2, 2.4);

  // chest plate (broad shoulders) + collar line + dark neck
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-6, -30.5); ctx.lineTo(6, -30.5); ctx.lineTo(4.8, -25); ctx.lineTo(-4.8, -25); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#23282c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-4.6, -26); ctx.lineTo(4.6, -26); ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(-2, -31.5, 4, 2.4);  // undersuit neck

  // shoulder pauldrons
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(-5.6, -29.5, 2.4, 3, 0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(5.6, -29.5, 2.4, 3, -0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // helmet — domed shell with the angular black mask
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-5.5, -33);
  ctx.quadraticCurveTo(-6.4, -43, 0, -43.5);
  ctx.quadraticCurveTo(6.4, -43, 5.5, -33);
  ctx.quadraticCurveTo(5, -30.8, 0, -30.8);
  ctx.quadraticCurveTo(-5, -30.8, -5.5, -33);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // black brow connecting the eye lenses
  ctx.strokeStyle = dark; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-4.8, -39.2); ctx.quadraticCurveTo(0, -40.6, 4.8, -39.2); ctx.stroke();
  // the two angled "tear" eye lenses, white nose ridge between
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-4.6, -38.6); ctx.quadraticCurveTo(-1.6, -38.4, -1.3, -36.2); ctx.quadraticCurveTo(-3.2, -36, -4.6, -37); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4.6, -38.6); ctx.quadraticCurveTo(1.6, -38.4, 1.3, -36.2); ctx.quadraticCurveTo(3.2, -36, 4.6, -37); ctx.closePath(); ctx.fill();
  // cheek vent dashes below the eyes
  ctx.strokeStyle = dark; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-3.7, -35.6); ctx.lineTo(-3.7, -34);
  ctx.moveTo(3.7, -35.6); ctx.lineTo(3.7, -34); ctx.stroke();
  // frown / breathing grille with vent teeth
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-3.4, -33.4); ctx.lineTo(3.4, -33.4); ctx.quadraticCurveTo(2.4, -30.9, 0, -31); ctx.quadraticCurveTo(-2.4, -30.9, -3.4, -33.4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = white; ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-1.6, -33.2); ctx.lineTo(-1.6, -31.4);
  ctx.moveTo(0, -33.3); ctx.lineTo(0, -31.2);
  ctx.moveTo(1.6, -33.2); ctx.lineTo(1.6, -31.4); ctx.stroke();

  // front arm + E-11 blaster levelled forward (drawn last, over the torso)
  ctx.strokeStyle = white; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(3, -29); ctx.lineTo(9, -23); ctx.stroke();
  ctx.strokeStyle = dark; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(6, -23.5); ctx.lineTo(20, -23.5); ctx.stroke();   // barrel
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(9, -23); ctx.lineTo(9.5, -19); ctx.stroke();      // grip
  ctx.beginPath(); ctx.moveTo(11, -25.2); ctx.lineTo(14.5, -25.2); ctx.stroke(); // scope
  ctx.restore();
}

function drawVader(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const rim = '#8b97a6';  // cool rim-light edge so the black silhouette reads against the void
  // saber angle: raised on the wind-up, sweeping across the front during the slash
  const ang = e.mode === 'slash' ? e.slashAng
            : e.mode === 'wind'  ? Math.atan2(player.y - e.y, player.x - e.x) - 1.3
            : Math.atan2(player.y - e.y, player.x - e.x) - 0.3;
  ctx.save(); ctx.translate(e.x, e.y);
  // backlight halo — separates the dark silhouette from the dark starfield
  const halo = ctx.createRadialGradient(0, -20, 3, 0, -20, 42);
  halo.addColorStop(0, 'rgba(150,180,212,0.36)');
  halo.addColorStop(0.55, 'rgba(120,150,190,0.15)');
  halo.addColorStop(1, 'rgba(120,150,190,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.ellipse(0, -20, 34, 42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(0, 4, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
  // raised Force hand telegraph (unmirrored so it points at the player) during a cast / choke
  if (e.mode === 'cast' || e.mode === 'choke') {
    const pa = Math.atan2(player.y - (e.y - 22), player.x - e.x);
    const px = Math.cos(pa), py = Math.sin(pa);
    ctx.strokeStyle = rim; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(dir * 3, -28); ctx.lineTo(px * 13, -22 + py * 13); ctx.stroke();
    const reach = e.mode === 'choke' ? 1 : (0.5 + 0.5 * Math.abs(Math.sin(frame * 0.4)));
    ctx.fillStyle = 'rgba(150,120,210,' + (0.28 * reach).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(px * 16, -22 + py * 16, 7 + 4 * reach, 0, Math.PI * 2); ctx.fill();
    if (e.mode === 'choke') {  // a taut line of dark energy to the throttled hero
      ctx.strokeStyle = 'rgba(150,120,210,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px * 18, -22 + py * 18); ctx.lineTo(player.x - e.x, (player.y - 18) - e.y); ctx.stroke();
    }
  }
  // red saber drawn in unmirrored space so it tracks the player (gone while it's mid-throw)
  if (!e.disarmed) {
    const hx = dir * 9, hy = -22;
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(ang) * 8, hy + Math.sin(ang) * 8); ctx.stroke();
    ctx.shadowColor = '#ff4438'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * 8, hy + Math.sin(ang) * 8);
    ctx.lineTo(hx + Math.cos(ang) * 52, hy + Math.sin(ang) * 52);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.scale(dir, 1);
  // flowing cape
  ctx.fillStyle = '#0c0c10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-3, -38);
  ctx.quadraticCurveTo(-15, -18, -11 + Math.sin(e.phase) * 2, 2);
  ctx.lineTo(-2, -4); ctx.lineTo(4, 2);
  ctx.quadraticCurveTo(9, -18, 3, -38);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // legs (dark, but light enough to catch the backlight)
  ctx.strokeStyle = '#26292f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-4, 0); ctx.moveTo(0, -16); ctx.lineTo(4, 0); ctx.stroke();
  ctx.strokeStyle = rim; ctx.lineWidth = 1;  // rim highlight down the front of the legs
  ctx.beginPath(); ctx.moveTo(0.6, -15); ctx.lineTo(4.6, 0); ctx.stroke();
  // torso
  ctx.fillStyle = col; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(5, -16); ctx.lineTo(-5, -16); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // chest control box (blinking lights)
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-4, -32, 8, 6);
  ctx.fillStyle = frame % 40 < 20 ? '#ff5252' : '#4dd0e1'; ctx.fillRect(-3, -31, 2, 2);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(1, -31, 2, 2);
  // helmet — domed with the angular mask
  ctx.fillStyle = '#0d0d10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(0, -41, 7.5, Math.PI, 0); ctx.lineTo(6, -36); ctx.lineTo(-6, -36); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // glossy glint across the dome to catch the eye
  ctx.strokeStyle = 'rgba(190,210,235,0.7)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -41, 5.4, Math.PI * 1.12, Math.PI * 1.42); ctx.stroke();
  // mask detail: eyes + breathing grille
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-5, -41); ctx.lineTo(-2, -40); ctx.moveTo(5, -41); ctx.lineTo(2, -40); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.moveTo(-2.5, -38); ctx.lineTo(2.5, -38); ctx.lineTo(1.5, -34); ctx.lineTo(-1.5, -34); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// a glowing lightsaber blade from a hilt pivot — metal hilt, colored glow, white-hot core
function _saberBlade(hx, hy, ang, len, color) {
  color = color || '#ff5347';
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // hilt — a short metal cylinder with an emitter ring and a darker grip
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#c7ccd3'; ctx.lineWidth = 3.6;
  ctx.beginPath(); ctx.moveTo(hx - ca * 4, hy - sa * 4); ctx.lineTo(hx + ca * 6, hy + sa * 6); ctx.stroke();
  ctx.strokeStyle = '#4a4e55'; ctx.lineWidth = 3.6;   // grip
  ctx.beginPath(); ctx.moveTo(hx - ca * 4, hy - sa * 4); ctx.lineTo(hx - ca * 1, hy - sa * 1); ctx.stroke();
  ctx.strokeStyle = '#e6e9ee'; ctx.lineWidth = 1.6;   // emitter ring highlight
  ctx.beginPath(); ctx.moveTo(hx + ca * 5, hy + sa * 5); ctx.lineTo(hx + ca * 6.5, hy + sa * 6.5); ctx.stroke();
  if (len <= 1) return;
  const bx = hx + ca * 7, by = hy + sa * 7;
  const tx = hx + ca * (7 + len), ty = hy + sa * (7 + len);
  ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 15;       // outer bloom
  ctx.strokeStyle = color; ctx.lineWidth = 5.5;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.shadowBlur = 6;                                  // white-hot core
  ctx.strokeStyle = 'rgba(255,242,238,0.95)'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.shadowBlur = 0;
}
function drawSidious(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const rim = '#8f95a3';
  const hop = e.hop || 0;
  const casting = e.mode === 'cast' || e.mode === 'lightning';
  const bl = (e.lit || 0) * 44;   // blade length grows as the sabers ignite
  ctx.save(); ctx.translate(e.x, e.y - hop);
  ctx.lineJoin = 'round';
  // backlight — separates the dark robe from the void (violet-tinged; fiercer once he's pure lightning)
  const halo = ctx.createRadialGradient(0, -24, 3, 0, -24, e.phase2 ? 50 : 46);
  halo.addColorStop(0, e.phase2 ? 'rgba(190,150,255,0.46)' : 'rgba(170,120,220,0.34)');
  halo.addColorStop(0.55, e.phase2 ? 'rgba(150,110,230,0.2)' : 'rgba(130,90,180,0.14)');
  halo.addColorStop(1, 'rgba(130,90,180,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.ellipse(0, -24, e.phase2 ? 38 : 35, e.phase2 ? 50 : 47, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath(); ctx.ellipse(0, 4 + hop, 13, 4, 0, 0, Math.PI * 2); ctx.fill();

  // motion-blur ghosts while moving fast — sells speed so leaps/spins read as motion, not teleport
  if (!api.reduceMotion && (e.mode === 'leap' || e.mode === 'spin')) {
    const mvx = e.mvx || 0, mvy = e.mvy || 0;
    if (Math.hypot(mvx, mvy) > 2.5) {
      for (let g = 3; g >= 1; g--) {
        ctx.save();
        ctx.globalAlpha = 0.14 * (1 - (g - 1) / 3);
        ctx.translate(-mvx * g * 1.5, -mvy * g * 1.5);
        ctx.scale(dir, 1);
        ctx.fillStyle = '#7a4fc0';
        ctx.beginPath();
        ctx.moveTo(0, -47); ctx.quadraticCurveTo(-12, -30, -11, 4);
        ctx.lineTo(11, 4); ctx.quadraticCurveTo(12, -30, 0, -47);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ── body (mirrored to face the player) ── */
  ctx.save(); ctx.scale(dir, 1);
  const sway = Math.sin(e.phase) * 1.5;
  // heavy black cassock — hunched, rounded shoulders forward, a broad ragged hem.
  // a vertical gradient gives the cloth depth: faint violet sheen up top, pure black at the hem
  const robe = ctx.createLinearGradient(0, -48, 0, 6);
  robe.addColorStop(0, '#221c30'); robe.addColorStop(0.45, col); robe.addColorStop(1, '#040308');
  ctx.fillStyle = robe; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -48);
  ctx.quadraticCurveTo(-12, -46, -14, -33);            // hunched shoulder
  ctx.quadraticCurveTo(-19, -13, -15 + sway, 5);        // sweep out to a wide hem
  ctx.lineTo(-9, 1); ctx.lineTo(-5, 5); ctx.lineTo(-1, 1);  // ragged hem
  ctx.lineTo(0, 5); ctx.lineTo(2, 1); ctx.lineTo(6, 5); ctx.lineTo(10, 1);
  ctx.lineTo(15 - sway, 5);
  ctx.quadraticCurveTo(19, -13, 14, -33);
  ctx.quadraticCurveTo(12, -46, 0, -48);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // a darker inner placket down the front + fold lines catching the violet rim
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -33); ctx.lineTo(0, 4); ctx.stroke();
  ctx.strokeStyle = 'rgba(155,135,190,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4, -28); ctx.lineTo(-9 + sway, 3);
  ctx.moveTo(4, -28); ctx.lineTo(9 - sway, 3);
  ctx.moveTo(-1.6, -30); ctx.lineTo(-2.4, 3);
  ctx.moveTo(1.6, -30); ctx.lineTo(2.4, 3);
  ctx.stroke();
  // deep cowl — a big peaked hood draping forward, swallowing the face in shadow
  ctx.fillStyle = '#0b0812'; ctx.strokeStyle = rim; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -55);                                   // the peak
  ctx.quadraticCurveTo(-13, -53, -12, -37);
  ctx.quadraticCurveTo(-11, -29, -4, -28);
  ctx.lineTo(4, -28);
  ctx.quadraticCurveTo(11, -29, 12, -37);
  ctx.quadraticCurveTo(13, -53, 0, -55);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // a violet rim-light down the hood's leading edge
  ctx.strokeStyle = 'rgba(180,150,235,0.4)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(2, -54); ctx.quadraticCurveTo(12, -52, 11, -37); ctx.stroke();
  // the hollow of the hood — pure dark, the face recedes into it
  ctx.fillStyle = '#040305';
  ctx.beginPath(); ctx.ellipse(0, -39, 7.5, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // face set deep in the cowl — gaunt and pale, with a hooked nose, a sneer, and sunken yellow eyes
  ctx.save();
  const fcx = dir * 0.7;
  // dim, sallow skin catching the faint backlight — gaunt and long
  ctx.fillStyle = 'rgba(196,182,152,0.82)';
  ctx.beginPath(); ctx.ellipse(fcx, -38, 3.6, 6, 0, 0, Math.PI * 2); ctx.fill();
  // heavy brow shadow across the top of the face
  ctx.fillStyle = 'rgba(14,8,14,0.7)';
  ctx.beginPath(); ctx.ellipse(fcx, -41.4, 4.2, 2.3, 0, 0, Math.PI * 2); ctx.fill();
  // angry brows angled down toward the nose — a fixed glare
  ctx.strokeStyle = 'rgba(10,6,12,0.92)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fcx - 3.7, -41.4); ctx.lineTo(fcx - 0.8, -39.9);
  ctx.moveTo(fcx + 3.7, -41.4); ctx.lineTo(fcx + 0.8, -39.9);
  ctx.stroke();
  // sunken eye sockets
  ctx.fillStyle = 'rgba(22,12,18,0.85)';
  ctx.beginPath();
  ctx.ellipse(fcx - 2.2, -39.6, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.ellipse(fcx + 2.2, -39.6, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // hollow cheeks
  ctx.fillStyle = 'rgba(58,38,42,0.5)';
  ctx.beginPath();
  ctx.ellipse(fcx - 3, -35.6, 1.2, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(fcx + 3, -35.6, 1.2, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // hooked nose + thin sneering mouth + a furrow between the brows
  ctx.strokeStyle = 'rgba(64,42,42,0.62)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fcx, -39.6); ctx.quadraticCurveTo(fcx + dir * 1, -36.5, fcx, -35); ctx.stroke();
  ctx.strokeStyle = 'rgba(40,24,26,0.78)'; ctx.lineWidth = 1;   // a deeper, downturned sneer
  ctx.beginPath(); ctx.moveTo(fcx - 2.1, -33.4); ctx.quadraticCurveTo(fcx, -32.3, fcx + 2.1, -33.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fcx - 0.5, -42.4); ctx.lineTo(fcx - 0.9, -40.4); ctx.stroke();
  // sickly yellow eyes, glowing deep in the sockets
  ctx.shadowColor = '#ffcf4a'; ctx.shadowBlur = 5; ctx.fillStyle = '#f4d24a';
  ctx.beginPath();
  ctx.arc(fcx - 2.2, -39.6, 1.05, 0, Math.PI * 2);
  ctx.arc(fcx + 2.2, -39.6, 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = '#fff4c0'; ctx.shadowBlur = 2; ctx.fillStyle = '#fff0b0';  // hot catch-light
  ctx.beginPath();
  ctx.arc(fcx - 2.4, -39.9, 0.4, 0, Math.PI * 2);
  ctx.arc(fcx + 2.0, -39.9, 0.4, 0, Math.PI * 2);
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.restore();

  /* ── arms + twin sabers / lightning (unmirrored so they aim true) ── */
  const sh = { x: dir * 6, y: -33 };                   // shoulder origin
  if (e.mode === 'spin') {
    // both blades whirl into a blurred lethal ring
    for (let k = 0; k < 2; k++) _saberBlade(0, -22, e.spinAng + k * Math.PI, 46);
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -22, 53, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (e.mode === 'wind') {
    // both blades raised and crossed overhead — the spin is coming
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves up
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(-3, -34); ctx.lineTo(0, -30); ctx.stroke();
    _saberBlade(0, -30, -Math.PI / 2 - 0.45, 44);
    _saberBlade(0, -30, -Math.PI / 2 + 0.45, 44);
    if (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) {
      ctx.globalAlpha = 0.3; ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -22, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else if (casting) {
    // gnarled hands thrust forward along the aim, violet crackle gathering between them
    const pa = Math.atan2(e.ly, e.lx);
    const h1 = { x: Math.cos(pa) * 15, y: -25 + Math.sin(pa) * 15 };
    const h2 = { x: Math.cos(pa - 0.34) * 13, y: -20 + Math.sin(pa - 0.34) * 13 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 4); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    ctx.strokeStyle = '#cfcabf'; ctx.lineWidth = 2;                          // bony hands
    ctx.beginPath(); ctx.moveTo(h1.x - Math.cos(pa) * 3, h1.y - Math.sin(pa) * 3); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2.x - Math.cos(pa) * 3, h2.y - Math.sin(pa) * 3); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    const steady = api.reduceMotion || e.mode === 'lightning';
    // the orb swells as the charge builds, so the windup is unmistakable
    const prog = e.mode === 'cast' && e.castDur ? clamp(1 - e.st / e.castDur, 0, 1) : 1;
    const ox = (h1.x + h2.x) / 2, oy = (h1.y + h2.y) / 2;
    ctx.shadowColor = '#b388ff'; ctx.shadowBlur = 10 + prog * 10;
    ctx.fillStyle = 'rgba(196,158,255,' + (steady ? 0.55 : 0.35 + 0.3 * prog + 0.2 * Math.abs(Math.sin(frame * 0.5))).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(ox, oy, 4 + prog * 6, 0, Math.PI * 2); ctx.fill();
    // little arcs spitting off the gathering orb during the windup
    if (e.mode === 'cast' && prog > 0.25) {
      ctx.strokeStyle = 'rgba(220,200,255,0.8)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let a = 0; a < 3; a++) {
        const ar = (frame * 0.5 + a * 2.1), rr = (4 + prog * 6);
        const jx = (rnd() - 0.5) * 3, jy = (rnd() - 0.5) * 3;   // consumed even under reduced motion — settings must not shift the RNG stream
        if (api.reduceMotion) continue;
        ctx.beginPath(); ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(ar) * rr * 1.7 + jx, oy + Math.sin(ar) * rr * 1.7 + jy);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  } else if (e.phase2) {
    // sabers stowed — open hands wreathed in residual Force lightning
    const base = Math.atan2(player.y - e.y, player.x - e.x);
    const h1 = { x: dir * 11 + Math.cos(base) * 4, y: -27 }, h2 = { x: dir * 12 + Math.cos(base) * 4, y: -16 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';   // sleeves to the hands
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 5); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    ctx.strokeStyle = '#cfcabf'; ctx.lineWidth = 2;                           // bony fingers
    ctx.beginPath(); ctx.moveTo(h1.x - dir * 3, h1.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2.x - dir * 3, h2.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    {                                   // small idle sparks crawling between the fingertips
      ctx.strokeStyle = 'rgba(200,175,255,0.7)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      for (const h of [h1, h2]) {
        const a = frame * 0.4 + h.y;
        const jx = (rnd() - 0.5) * 2, jy = (rnd() - 0.5) * 2;  // consumed even under reduced motion
        if (api.reduceMotion) continue;
        ctx.beginPath(); ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + Math.cos(a) * 5 + jx, h.y + Math.sin(a) * 5 + jy);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(180,150,255,0.5)';
    ctx.beginPath(); ctx.arc(h1.x, h1.y, 1.6, 0, Math.PI * 2); ctx.arc(h2.x, h2.y, 1.6, 0, Math.PI * 2); ctx.fill();
  } else {
    // resting guard: twin sabers, one high one low, tracking the player
    const base = Math.atan2(player.y - e.y, player.x - e.x);
    const hi = { x: dir * 10, y: -28 }, lo = { x: dir * 11, y: -16 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves to the hilts
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hi.x, hi.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 5); ctx.lineTo(lo.x, lo.y); ctx.stroke();
    _saberBlade(hi.x, hi.y, base - 0.66, bl);    // splayed into a wide guard V
    _saberBlade(lo.x, lo.y, base + 0.62, bl);
  }
  ctx.restore();
}
function drawGuard(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const reach = e.mode === 'aim' || e.mode === 'lunge';
  const sw = e.mode === 'stalk' ? Math.sin(e.phase) * 3 : 0;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 3, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

  // force pike (unmirrored, toward the player) — dark haft, glowing vibro-tip at the business end
  ctx.lineCap = 'round';
  const grip = { x: dir * 9, y: -22 };
  const tip  = reach ? { x: dir * 31, y: -13 } : { x: dir * 14, y: -46 };
  const butt = reach ? { x: dir * 1,  y: -27 } : { x: dir * 11, y: -2 };
  ctx.strokeStyle = '#2f3034'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(butt.x, butt.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.strokeStyle = '#54565c'; ctx.lineWidth = 1;     // haft highlight
  ctx.beginPath(); ctx.moveTo(butt.x, butt.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.fillStyle = '#1f2024';                          // grip collar
  ctx.beginPath(); ctx.arc(grip.x, grip.y, 1.8, 0, Math.PI * 2); ctx.fill();
  // emitter tip — always faintly lit, flares when aiming/lunging
  const hot = reach && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0);
  ctx.shadowColor = '#ff4d4d'; ctx.shadowBlur = reach ? 10 : 5;
  ctx.strokeStyle = hot ? '#ff8a8a' : '#d23030'; ctx.lineWidth = reach ? 3.2 : 2.4;
  const ta = Math.atan2(tip.y - butt.y, tip.x - butt.x);
  ctx.beginPath();
  ctx.moveTo(tip.x - Math.cos(ta) * 7, tip.y - Math.sin(ta) * 7);
  ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.shadowBlur = 0;

  /* ── body (mirrored) ── */
  ctx.save(); ctx.scale(dir, 1);
  // long flowing crimson robe with a darker under-drape
  ctx.fillStyle = '#7a1414';                          // shadowed under-robe
  ctx.beginPath();
  ctx.moveTo(-2, -30); ctx.quadraticCurveTo(-12, -10, -8 + sw * 0.3, 4);
  ctx.lineTo(8 - sw * 0.3, 4); ctx.quadraticCurveTo(12, -10, 2, -30);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.quadraticCurveTo(-9, -28, -10, -15);
  ctx.quadraticCurveTo(-11, -4, -8 + sw * 0.4, 3);
  ctx.lineTo(8 - sw * 0.4, 3);
  ctx.quadraticCurveTo(11, -4, 10, -15);
  ctx.quadraticCurveTo(9, -28, 0, -34);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // robe folds
  ctx.strokeStyle = 'rgba(70,8,8,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-3, -26); ctx.lineTo(-4, 3); ctx.moveTo(0, -28); ctx.lineTo(0, 3); ctx.moveTo(3, -26); ctx.lineTo(4, 3);
  ctx.stroke();
  // shoulder pauldrons
  ctx.fillStyle = '#9c1a1a'; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-9, -31); ctx.quadraticCurveTo(-13, -29, -10, -22); ctx.lineTo(-5, -27); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, -31); ctx.quadraticCurveTo(13, -29, 10, -22); ctx.lineTo(5, -27); ctx.closePath(); ctx.fill(); ctx.stroke();
  // tall helmet — domed crest, angular faceplate, dark visor band
  ctx.fillStyle = '#b71c1c'; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5, -33);
  ctx.lineTo(-5, -40);
  ctx.quadraticCurveTo(-5, -49, 0, -50);
  ctx.quadraticCurveTo(5, -49, 5, -40);
  ctx.lineTo(5, -33);
  ctx.quadraticCurveTo(0, -31, -5, -33);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // vertical crest ridge + sheen
  ctx.strokeStyle = '#e0534f'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -49); ctx.lineTo(0, -40); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,180,180,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(-1.5, -44, 3.5, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke();
  // narrow dark visor
  ctx.fillStyle = '#160404';
  ctx.beginPath(); ctx.moveTo(-3.6, -41); ctx.lineTo(3.6, -41); ctx.lineTo(2.8, -36.5); ctx.lineTo(-2.8, -36.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/* ── death cutscene drawing: Vader, a limp Emperor, and lightning over them both ── */
function _ltnArc(x1, y1, x2, y2, segs, jit, seed) {
  const mx = x2 - x1, my = y2 - y1, len = Math.hypot(mx, my) || 1, px = -my / len, py = mx / len;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    const j = s === segs ? 0 : (Math.sin(seed + s * 2.7) + Math.sin(seed * 0.5 + s * 5.3)) * jit;
    ctx.lineTo(x1 + mx * t + px * j, y1 + my * t + py * j);
  }
  ctx.stroke();
}
function _drawVaderFig(x, y, fd, armsUp, alpha) {
  const rim = '#8b97a6';
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.beginPath(); ctx.ellipse(0, 2, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(fd, 1);
  // cape
  ctx.fillStyle = '#0c0c10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-3, -40); ctx.quadraticCurveTo(-15, -18, -11, 2); ctx.lineTo(-2, -4); ctx.lineTo(4, 2); ctx.quadraticCurveTo(9, -18, 3, -40); ctx.closePath(); ctx.fill(); ctx.stroke();
  // legs
  ctx.strokeStyle = '#26292f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-4, 0); ctx.moveTo(0, -16); ctx.lineTo(4, 0); ctx.stroke();
  // torso
  ctx.fillStyle = '#0a0a0c'; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(5, -16); ctx.lineTo(-5, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
  // chest control box
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-4, -32, 8, 6);
  ctx.fillStyle = frame % 40 < 20 ? '#ff5252' : '#4dd0e1'; ctx.fillRect(-3, -31, 2, 2);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(1, -31, 2, 2);
  // arms — raised overhead to carry, else at his sides
  ctx.strokeStyle = '#15171b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  if (armsUp) {
    ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(-7, -50); ctx.lineTo(-3, -59); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -34); ctx.lineTo(7, -50); ctx.lineTo(3, -59); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-4, -33); ctx.lineTo(-8, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -33); ctx.lineTo(8, -22); ctx.stroke();
  }
  // helmet + mask
  ctx.fillStyle = '#0d0d10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(0, -41, 7.5, Math.PI, 0); ctx.lineTo(6, -36); ctx.lineTo(-6, -36); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-5, -41); ctx.lineTo(-2, -40); ctx.moveTo(5, -41); ctx.lineTo(2, -40); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.moveTo(-2.5, -38); ctx.lineTo(2.5, -38); ctx.lineTo(1.5, -34); ctx.lineTo(-1.5, -34); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// a limp, hanging Emperor held overhead — head lolled, arms and robe dangling
function _drawSidiousLimp(x, y, swing) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(swing);
  ctx.lineJoin = 'round';
  // robe draping down from where Vader grips him
  ctx.fillStyle = '#0a0a0e'; ctx.strokeStyle = '#8f95a3'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-8, -2); ctx.quadraticCurveTo(-13, 14, -6, 22);
  ctx.lineTo(7, 20); ctx.quadraticCurveTo(12, 10, 9, -2);
  ctx.quadraticCurveTo(4, -7, 0, -7); ctx.quadraticCurveTo(-4, -7, -8, -2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // lolled hooded head
  ctx.fillStyle = '#070709'; ctx.strokeStyle = '#8f95a3'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(-9, -4, 6, 5.5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9a7e22';   // dim, dying eyes
  ctx.beginPath(); ctx.arc(-10.5, -5, 0.9, 0, Math.PI * 2); ctx.arc(-8, -6, 0.9, 0, Math.PI * 2); ctx.fill();
  // dangling arms, hands still sparking
  ctx.strokeStyle = '#11111a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(-14, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(14, 16); ctx.stroke();
  ctx.fillStyle = 'rgba(190,150,255,0.6)';
  ctx.beginPath(); ctx.arc(-14, 13, 2, 0, Math.PI * 2); ctx.arc(14, 16, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawSidiousFinale() {
  const f = sidFinale;
  const grounded = f.phase === 'rise';
  const vy = f.vy;
  // Vader: slides up out of the deck during 'rise', then on his feet
  const vDrop = (1 - f.vrise) * 30;
  const armsUp = f.phase !== 'rise';
  // Emperor: slumped where he died until grabbed, then hoisted overhead and carried
  const sidX = grounded ? f.sx : f.vx + f.faceDir * 1;
  const sidY = grounded ? f.sy - 6 : vy - 61 - f.lift * 3;
  const swing = grounded ? 0 : Math.sin(frame * 0.12) * 0.06 * (f.phase === 'carry' ? 1 : 0.4);

  // a dark haze where Vader rises
  if (grounded && f.vrise < 1) {
    ctx.save(); ctx.globalAlpha = 0.4 * (1 - f.vrise);
    ctx.fillStyle = '#1a1430';
    ctx.beginPath(); ctx.ellipse(f.vx, vy + 2, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // limp Emperor (drawn behind Vader's raised arms during the lift/carry, in front during rise)
  if (grounded) _drawSidiousLimp(sidX, sidY, swing);
  // Vader, emerging then carrying
  ctx.save();
  if (vDrop > 0) { ctx.beginPath(); ctx.rect(0, 0, GW, vy + 4); ctx.clip(); }  // clip so he rises from the floor
  _drawVaderFig(f.vx, vy + vDrop, f.faceDir, armsUp, grounded ? f.vrise : 1);
  ctx.restore();
  if (!grounded) _drawSidiousLimp(sidX, sidY, swing);

  // ── the lightning: it shocks them both — arcs from the Emperor crawling all over Vader ──
  const inten = grounded ? f.vrise : 1;
  if (inten > 0.05) {
    const hands = [{ x: sidX - 13, y: sidY + 13 }, { x: sidX + 13, y: sidY + 16 }, { x: sidX, y: sidY - 2 }];
    const targets = [{ x: f.vx, y: vy + vDrop - 41 }, { x: f.vx - 5, y: vy + vDrop - 20 }, { x: f.vx + 5, y: vy + vDrop - 18 }];
    const n = api.reduceMotion ? 2 : 3 + Math.round(inten * 2);
    for (let pass = 0; pass < 2; pass++) {
      ctx.save(); ctx.lineCap = 'round';
      ctx.shadowColor = '#9a6cff'; ctx.shadowBlur = pass === 0 ? 9 : 3;
      ctx.strokeStyle = pass === 0 ? 'rgba(170,120,255,0.5)' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = pass === 0 ? 2.3 : 1;
      for (let i = 0; i < n; i++) {
        const seed = api.reduceMotion ? i * 11 : frame * 0.7 + i * 4.3;
        const a = hands[i % hands.length], b = targets[i % targets.length];
        _ltnArc(a.x, a.y, b.x, b.y, 7, 4, seed);
      }
      // one arc crawling over Vader's own frame — he's caught in it too
      _ltnArc(f.vx - 6, vy + vDrop - 36, f.vx + 6, vy + vDrop - 20, 6, 4, frame * 0.9);
      ctx.restore();
    }
    // sparks flying off
    if (frame % 4 === 0) {
      const t = targets[Math.floor(rnd() * targets.length)];
      const ox = (rnd() - 0.5) * 14, oy = (rnd() - 0.5) * 14;  // consumed even under reduced motion
      if (!api.reduceMotion) sparks.push({ x: t.x + ox, y: t.y + oy, t: 8, color: '#d8c4ff', txt: '✦' });
    }
  }
}

/* ── DIO + The World ── */
// ── Stand-sprite helpers (shared by The World / Star Platinum) ──
// a jointed arm: shoulder → bent elbow → clenched fist
function _standArm(sx, sy, fx, fy, col, edge) {
  const ex = (sx + fx) / 2 + (fx > sx ? 2.5 : -2.5), ey = (sy + fy) / 2 + 3;  // elbow bows out + down
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(fx, fy, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();  // fist
}
// a small filled heart (DIO/The World motif); fill colour set by the caller
function _heart(x, y, s) {
  ctx.beginPath(); ctx.moveTo(x, y + s);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.5, x - s * 0.5, y - s * 1.35, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 1.35, x + s * 1.5, y - s * 0.5, x, y + s);
  ctx.closePath(); ctx.fill();
}
// a 5-point star (Star Platinum motif); fill colour set by the caller
function _star(x, y, s) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5, a2 = a + Math.PI / 5;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s);
    ctx.lineTo(x + Math.cos(a2) * s * 0.45, y + Math.sin(a2) * s * 0.45);
  }
  ctx.closePath(); ctx.fill();
}

// The World — DIO's golden clockwork Stand, looming behind his shoulder
function drawTheWorld(dir, alpha, mode) {
  const gold = '#e8c24a', lit = '#f6dd86', dk = '#6b5a1f', grn = '#5f9c52', pink = '#e84d8a';
  const muda = mode === 'muda';
  const jr = rnd();   // consumed even under reduced motion — settings must not shift the RNG stream
  const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : jr;
  const sway = Math.sin(frame * 0.09) * 1.2;
  ctx.save(); ctx.globalAlpha = 0.82 * alpha; ctx.scale(dir, 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // broad muscular torso
  ctx.fillStyle = gold; ctx.strokeStyle = dk; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-13, -46);
  ctx.quadraticCurveTo(-16, -33, -10, -19); ctx.lineTo(-7, -16); ctx.lineTo(7, -16); ctx.lineTo(10, -19);
  ctx.quadraticCurveTo(16, -33, 13, -46); ctx.closePath(); ctx.fill(); ctx.stroke();
  // sculpted pec + ab lines
  ctx.strokeStyle = dk; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -38); ctx.quadraticCurveTo(0, -33, 9, -38); ctx.stroke();
  // green accent flares
  ctx.strokeStyle = grn; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(-4, -27); ctx.moveTo(10, -30); ctx.lineTo(4, -27); ctx.stroke();

  // arms (ORA flurry blurs the fists outward in muda)
  const reach = muda ? 8 + jt * 9 : 2;
  _standArm(-13, -44, -20 - reach, -29, gold, dk);
  _standArm(13, -44, 20 + reach, -29, gold, dk);
  if (muda) {
    ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
    for (let i = 0; i < 3; i++) { const r = rnd() * 15, oy = rnd() * 6 - 3; if (api.reduceMotion) continue; ctx.beginPath(); ctx.arc(19 + r, -31 + oy, 2.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.82 * alpha;
  }

  // shoulder pauldrons, each stamped with a heart
  for (const sx of [-13, 13]) {
    ctx.fillStyle = lit; ctx.strokeStyle = dk; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sx, -45, 5.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pink; _heart(sx, -45.5, 2.3);
  }

  // head: helmet, chin guard, visor, forehead jewel + crest fins
  ctx.fillStyle = gold; ctx.strokeStyle = dk; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -54, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -49); ctx.quadraticCurveTo(0, -45, 4, -49); ctx.stroke();   // chin guard
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-2, -61); ctx.lineTo(-4, -64 + sway); ctx.moveTo(2, -61); ctx.lineTo(4, -64 - sway); ctx.stroke();  // crest
  ctx.fillStyle = '#23331c'; ctx.fillRect(-5.5, -55.5, 11, 2.6);                              // visor band
  ctx.fillStyle = '#aef0a0'; ctx.fillRect(-4.6, -55.2, 3, 1.6); ctx.fillRect(1.6, -55.2, 3, 1.6);  // glowing eyes
  ctx.fillStyle = grn; ctx.beginPath(); ctx.arc(0, -58.5, 1.7, 0, Math.PI * 2); ctx.fill();   // forehead jewel
  ctx.restore();
}
// Star Platinum — Jotaro's violet Stand, looming over his shoulder during the DIO fight
function drawStarPlatinum(dir, alpha, punching) {
  const pur = '#7d6fd6', lit = '#a99cf0', dk = '#352a63', cy = '#86f0e0', gold = '#e8c24a', skin = '#caa6ff';
  const jr = rnd();   // consumed even under reduced motion — settings must not shift the RNG stream
  const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : jr;
  const sway = Math.sin(frame * 0.08) * 1.6;
  ctx.save(); ctx.globalAlpha = 0.78 * alpha; ctx.scale(dir, 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // flowing hair tails sweeping out behind the head
  ctx.strokeStyle = dk; ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(-5, -55); ctx.quadraticCurveTo(-13, -53, -15, -45 + sway);
  ctx.moveTo(5, -55); ctx.quadraticCurveTo(13, -57, 16, -47 - sway); ctx.stroke();

  // broad muscular torso
  ctx.fillStyle = pur; ctx.strokeStyle = dk; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-14, -46);
  ctx.quadraticCurveTo(-17, -33, -10, -18); ctx.lineTo(-7, -16); ctx.lineTo(7, -16); ctx.lineTo(10, -18);
  ctx.quadraticCurveTo(17, -33, 14, -46); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = dk; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -38); ctx.quadraticCurveTo(0, -33, 9, -38); ctx.stroke();
  // gold collar band + chest studs
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-9, -45); ctx.quadraticCurveTo(0, -42, 9, -45); ctx.stroke();
  ctx.fillStyle = gold; for (const yy of [-37, -31, -25]) { ctx.beginPath(); ctx.arc(0, yy, 1.5, 0, Math.PI * 2); ctx.fill(); }

  // arms (ORA flurry blurs the fists outward while punching)
  const reach = punching ? 9 + jt * 10 : 2;
  _standArm(-14, -44, -21 - reach, -30, pur, dk);
  _standArm(14, -44, 21 + reach, -30, pur, dk);
  if (punching) {
    ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
    for (let i = 0; i < 3; i++) { const r = rnd() * 17, oy = rnd() * 6 - 3; if (api.reduceMotion) continue; ctx.beginPath(); ctx.arc(20 + r, -31 + oy, 2.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.78 * alpha;
  }

  // shoulder guards, each stamped with a star
  for (const sx of [-14, 14]) {
    ctx.fillStyle = lit; ctx.strokeStyle = dk; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sx, -45, 5.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = gold; _star(-14, -45, 3); _star(14, -45, 3);

  // head: face, swept-back cap, metal headband + fierce eyes, gold headband tails
  ctx.fillStyle = skin; ctx.strokeStyle = dk; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -54, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = pur; ctx.beginPath(); ctx.arc(0, -55, 7, Math.PI * 1.04, Math.PI * 1.96); ctx.fill();   // cap over the crown
  ctx.fillStyle = gold; ctx.fillRect(-6, -56.5, 12, 1.8);                                                // metal headband
  ctx.fillStyle = cy; ctx.fillRect(-5, -53.6, 3.4, 2.1); ctx.fillRect(1.6, -53.6, 3.4, 2.1);             // fierce eyes
  ctx.strokeStyle = gold; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-6, -54); ctx.lineTo(-15, -50 + sway); ctx.moveTo(6, -55); ctx.lineTo(15, -58 - sway); ctx.stroke();  // headband tails
  ctx.restore();
}
function drawDio(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const cr = e.crumble || 0;   // 0→1 dissolve during the death cutscene
  ctx.save(); ctx.translate(e.x, e.y); ctx.lineJoin = 'round';
  // menacing aura (gold core, violet falloff) — fades as he crumbles
  const aura = ctx.createRadialGradient(0, -26, 4, 0, -26, 42);
  aura.addColorStop(0, 'rgba(255,210,90,' + (0.20 * (1 - cr)).toFixed(3) + ')'); aura.addColorStop(0.6, 'rgba(150,90,200,' + (0.12 * (1 - cr)).toFixed(3) + ')'); aura.addColorStop(1, 'rgba(150,90,200,0)');
  ctx.fillStyle = aura; ctx.beginPath(); ctx.ellipse(0, -26, 33, 44, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,' + (0.30 * (1 - cr)).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (cr > 0) {
    // dissolve from the feet up: clip away the lower (cr) of the body, fade the rest, jitter as ash
    ctx.globalAlpha = 1 - cr * 0.55;
    ctx.beginPath(); ctx.rect(-46, -60, 92, 63 * (1 - cr)); ctx.clip();
    const ashX = (rnd() - 0.5) * cr * 3, ashY = (rnd() - 0.5) * cr * 2;  // consumed even under reduced motion
    if (!api.reduceMotion) ctx.translate(ashX, ashY);
  }
  if ((e.stand || 0) > 0.05) {   // The World rises above and behind DIO's shoulder
    ctx.save(); ctx.translate(-dir * 12, -24); ctx.scale(1.4, 1.4);
    drawTheWorld(dir, e.stand, e.mode); ctx.restore();
  }
  ctx.scale(dir, 1);
  const s = Math.sin(e.phase) * 2.5;
  // legs (dark trousers) + heart kneepads
  ctx.strokeStyle = '#2a2533'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-5, 0); ctx.moveTo(2, -16); ctx.lineTo(5, 0); ctx.stroke();
  ctx.fillStyle = '#e84d8a'; for (const kx of [-4.5, 4.5]) { ctx.beginPath(); ctx.arc(kx - 1, -7, 1.3, 0, Math.PI * 2); ctx.arc(kx + 1, -7, 1.3, 0, Math.PI * 2); ctx.fill(); }
  // torso (dark tank top) + violet suspenders + gold studs
  ctx.fillStyle = '#1f1b29'; ctx.strokeStyle = '#3a3550'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-7, -34); ctx.lineTo(7, -34); ctx.lineTo(6, -15); ctx.lineTo(-6, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#caa6ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(-3, -16); ctx.moveTo(4, -34); ctx.lineTo(3, -16); ctx.stroke();
  ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(0, -25, 1.7, 0, Math.PI * 2); ctx.fill();
  // pale arms — left on hip, right raised toward the player (more so while attacking)
  ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -32); ctx.lineTo(-11, -24); ctx.lineTo(-7, -19); ctx.stroke();
  const up = (e.mode === 'knives' || e.mode === 'world' || e.mode === 'muda' || e.mode === 'barrage') ? 1 : 0;
  ctx.beginPath(); ctx.moveTo(6, -32); ctx.lineTo(13, -31 - up * 4); ctx.lineTo(18, -33 - up * 9); ctx.stroke();
  // head (pale) + confident eyes
  ctx.fillStyle = '#f0d3aa'; ctx.beginPath(); ctx.arc(0, -40, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(2.4, -41, 0.95, 0, Math.PI * 2); ctx.arc(5.2, -41, 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#caa6ff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1.4, -42.6); ctx.lineTo(3.4, -42.4); ctx.moveTo(4.2, -42.4); ctx.lineTo(6.2, -42.6); ctx.stroke();
  // headband + gem
  ctx.fillStyle = '#3a3550'; ctx.fillRect(-6.5, -44.5, 13.5, 2.6);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(-1, -44.5, 2, 2.6);
  // blond spiky hair (slicked-back spikes)
  ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#e0a93a'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-7, -44);
  ctx.lineTo(-8.5, -50); ctx.lineTo(-4.5, -47);
  ctx.lineTo(-3.5, -54); ctx.lineTo(-0.5, -48);
  ctx.lineTo(1.5, -55); ctx.lineTo(3.5, -48);
  ctx.lineTo(7, -53); ctx.lineTo(7, -44.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
// a thrown knife, pointing along its flight
function drawKnife(a) {
  const k = a.scale || 1;
  ctx.save(); ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(a.vy, a.vx));
  if (k !== 1) { ctx.scale(k, k); ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 4; }  // a held blade catches the light
  ctx.fillStyle = '#cdd3da'; ctx.strokeStyle = '#7a828c'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(4, -2.2); ctx.lineTo(9, 0); ctx.lineTo(4, 2.2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3a2f2a'; ctx.fillRect(-10, -1.4, 4, 2.8);
  ctx.restore();
}
function drawRoadRoller(r) {
  // ground danger zone — telegraph (48×18) sits just outside the lethal ellipse (46×17), so the warning never under-reads
  if (r.phase !== 'impact' || r.t < 12) {
    const warn = api.reduceMotion || Math.floor(frame / (r.phase === 'drop' ? 3 : 5)) % 2 === 0;   // flashes faster as it falls
    ctx.save();
    ctx.strokeStyle = warn ? 'rgba(255,70,70,0.95)' : 'rgba(255,70,70,0.4)';
    ctx.fillStyle = 'rgba(255,70,70,0.10)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.ellipse(r.zoneX, r.zoneY, 48, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // a ring that contracts toward the zone as the roller closes in — shows exactly when impact lands
    if (r.phase === 'drop' && !api.reduceMotion) {
      const prog = clamp((r.y - (r.y0 || 0)) / Math.max(1, r.zoneY - (r.y0 || 0)), 0, 1);
      const k = 1 + (1 - prog) * 1.4;
      ctx.globalAlpha = 0.5 + 0.5 * prog; ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,90,90,0.9)';
      ctx.beginPath(); ctx.ellipse(r.zoneX, r.zoneY, 48 * k, 18 * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save(); ctx.translate(r.x, r.y);
  // big rolling drum
  ctx.fillStyle = '#f2c200'; ctx.strokeStyle = '#3a2f00'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#caa000'; ctx.lineWidth = 1.4;
  for (let a = 0; a < 6; a++) { const ang = a * 1.05 + frame * 0.06; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * 20, Math.sin(ang) * 20); ctx.stroke(); }
  // cab + window + chassis
  ctx.fillStyle = '#a83a28'; ctx.fillRect(-17, -23, 34, 7);
  ctx.fillStyle = '#d94f3a'; ctx.strokeStyle = '#5e1f15'; ctx.lineWidth = 1.5;
  ctx.fillRect(-14, -42, 28, 22); ctx.strokeRect(-14, -42, 28, 22);
  ctx.fillStyle = '#23252b'; ctx.fillRect(-9, -38, 18, 12);
  ctx.restore();
}
