// ── screens — connect screens, net-wait badge, panel(), the death screen ──
/* the connect screens (HOST / JOIN) — drawn instead of the intro while netUi is set */
function drawNetScreen() {
  const RM = api.reduceMotion;
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  ctx.clearRect(0, 0, GW, GH);
  ctx.save();
  let g = ctx.createLinearGradient(0, 0, 0, GH);
  g.addColorStop(0, '#04060c'); g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);
  for (let i = 0; i < 40; i++) {
    const sx = ih(i) * GW, sy = ih(i + 97) * GH * 0.8 + 8;
    const tw = RM ? 0.5 : 0.35 + 0.28 * Math.sin(frame * 0.045 + i * 1.7);
    ctx.fillStyle = 'rgba(215,230,255,' + Math.max(0.12, tw).toFixed(2) + ')';
    ctx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1.4, i % 7 === 0 ? 2 : 1.4);
  }
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const cy = GH / 2;
  ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
  ctx.fillText(netUi.mode === 'host' ? '🌐 HOSTING A GAME' : '🌐 JOINING A GAME', GW / 2, cy - 110);
  const dots = RM ? '…' : '.'.repeat(1 + (Math.floor(frame / 20) % 3));
  const sub = (t, y, col) => { ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = col || '#9fb0c0'; ctx.fillText(t, GW / 2, y); };
  if (netUi.phase === 'creating') {
    sub('creating a room' + dots, cy - 20);
  } else if (netUi.phase === 'waiting') {
    sub('your room code — tell your friend:', cy - 58);
    ctx.font = 'bold 54px "Courier New",monospace'; ctx.fillStyle = '#ffd24d';
    ctx.shadowColor = '#ffb300'; ctx.shadowBlur = RM ? 12 : 10 + 5 * Math.sin(frame * 0.06);
    ctx.fillText(netUi.code.split('').join(' '), GW / 2, cy);
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    if (netUi.copiedT > 0) {
      netUi.copiedT--;
      sub('✓ copied to the clipboard', cy + 42, '#caffa0');
    } else {
      sub('C — copy the code', cy + 42, '#ffe9ad');
    }
    sub('waiting for a challenger' + dots + '   (the room lives ~5 minutes)', cy + 64);
  } else if (netUi.phase === 'code') {
    sub('type the room code your friend gave you:', cy - 58);
    const bw = 44, gap = 10, x0 = GW / 2 - (bw * 5 + gap * 4) / 2;
    for (let i = 0; i < 5; i++) {
      const x = x0 + i * (bw + gap);
      ctx.fillStyle = 'rgba(10,16,24,0.85)'; ctx.fillRect(x, cy - 34, bw, 52);
      ctx.strokeStyle = i === netUi.input.length ? '#7fd8ff' : '#333d48';
      ctx.lineWidth = i === netUi.input.length ? 2.5 : 1.5;
      ctx.strokeRect(x, cy - 34, bw, 52);
      if (netUi.input[i]) {
        ctx.font = 'bold 34px "Courier New",monospace'; ctx.fillStyle = '#ffd24d';
        ctx.fillText(netUi.input[i], x + bw / 2, cy + 6);
      } else if (i === netUi.input.length && (RM || Math.floor(frame / 24) % 2)) {
        ctx.font = 'bold 34px "Courier New",monospace'; ctx.fillStyle = '#7fd8ff';
        ctx.fillText('▍', x + bw / 2, cy + 6);
      }
    }
    sub(netUi.input.length === 5 ? 'ENTER — connect' : 'type it, or paste it (⌘/Ctrl+V)', cy + 46, netUi.input.length === 5 ? '#caffa0' : '#9fb0c0');
    if (netUi.err) sub(netUi.err, cy + 72, '#ff8a80');
  } else if (netUi.phase === 'connecting') {
    sub('connecting the two of you' + dots, cy - 20);
    sub('(a direct link — the horde travels peer to peer)', cy + 6, '#69788a');
  } else if (netUi.phase === 'handshake') {
    sub('connected! agreeing on a world' + dots, cy - 20, '#caffa0');
  } else if (netUi.phase === 'err') {
    sub(netUi.err || 'something went wrong', cy - 20, '#ff8a80');
    ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
    ctx.fillText('Z — try again', GW / 2, cy + 24);
  } else if (netUi.phase === 'lobby' || netUi.phase === 'starting') {
    // ── the READY LOBBY: the whole war band side by side (2–4 seats). Everyone
    // picks freely; the run starts only when EVERY seat confirms. ──
    const starting = netUi.phase === 'starting';
    const mySeatIdx = netIsHost ? 0 : Math.max(1, netSeat);
    const seats = [];
    const raw = netUi.seats && netUi.seats.length ? netUi.seats : [];
    for (let i = 0; i < Math.max(raw.length, mySeatIdx + 1); i++) {
      seats.push(raw[i] ? { c: raw[i].c | 0, r: !!raw[i].r } : { c: 0, r: false });
    }
    // my own live pick shows immediately (the host echo can lag a beat)
    seats[mySeatIdx] = { c: classSel, r: !!netUi.myReady };
    // the WYRM & RIDER pair binds seat 1 to the saddle
    const paired = CLASSES[clamp(seats[0].c, 0, CLASSES.length - 1)] === 'wyrm';
    if (paired && seats.length > 1) seats[1] = { c: PAIR_RIDER, r: seats[1].r };
    sub(starting ? 'the whole band is ready — forging a shared world' + dots
                 : 'the fight begins when EVERY fighter readies up', cy - 84,
        starting ? '#caffa0' : '#9fb0c0');
    if (!starting && seats.length < NET_MAX_SEATS) {
      sub('room ' + (netUi.code || netRoomCode) + ' — up to four can ride; latecomers use the same code', cy - 64, '#ffd24d');
    }
    const py = cy + 2;
    const n = seats.length;
    const gap = n > 1 ? Math.min(180, (GW - 160) / (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const x = GW / 2 + (i - (n - 1) / 2) * gap;
      const self = i === mySeatIdx;
      drawClassPreview(x, py, CLASSES[clamp(seats[i].c, 0, CLASSES.length - 1)],
                       SEAT_COLS[i] || 'white', self && !starting,
                       'P' + (i + 1) + (self ? ' · YOU' : ''));
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px Tahoma,Arial';
      ctx.fillStyle = seats[i].r ? '#7CFC8A' : '#8494a4';
      ctx.fillText(seats[i].r ? '✓ READY' : 'choosing…', x, py + 54);
    }
    // your class row — every option visible (bound to the saddle when the host
    // rides the wyrm and you are seat 1: your pick is the pair's)
    if (!starting && paired && mySeatIdx === 1) {
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffab91';
      ctx.fillText('🐲 the host chose the WYRM & RIDER — you take the saddle', GW / 2, py + 92);
      ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
      ctx.fillText('your keys AIM the lance · E breathes fire from the heat your wyrm earns', GW / 2, py + 110);
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
      ctx.fillText('Z / ENTER — ' + (netUi.myReady ? 'un-ready' : 'READY UP'), GW / 2, py + 132);
    } else if (!starting) {
      const clsCol = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL };
      const list = netIsHost ? [0, 1, 2, 3, 4, PAIR_WYRM] : [0, 1, 2, 3, 4];
      const nn = list.length, gap2 = 10, chh = 24;
      const cw2 = Math.min(104, Math.floor((GW - 60 - gap2 * (nn - 1)) / nn));
      const x0 = GW / 2 - (cw2 * nn + gap2 * (nn - 1)) / 2;
      for (let i = 0; i < nn; i++) {
        const ci = list[i];
        const sel = ci === classSel, col = clsCol[CLASSES[ci]];
        roundRectPath(x0 + i * (cw2 + gap2), py + 76, cw2, chh, chh / 2);
        if (sel) {
          ctx.shadowColor = col; ctx.shadowBlur = RM ? 10 : 8 + 4 * Math.sin(frame * 0.09);
          ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
          ctx.fillStyle = '#10141a';
        } else {
          ctx.strokeStyle = '#4b5a6a'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#93a3b3';
        }
        ctx.font = (sel ? 'bold ' : '') + '12px Tahoma,Arial';
        ctx.fillText(CLASS_ICON[CLASSES[ci]] + ' ' + CLASSES[ci].toUpperCase(),
                     x0 + i * (cw2 + gap2) + cw2 / 2, py + 76 + chh / 2 + 4.5);
      }
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
      ctx.fillText('◀ ▶ — your hero   ·   Z / ENTER — ' + (netUi.myReady ? 'un-ready' : 'READY UP'),
                   GW / 2, py + 128);
    }
    ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#69788a';
    ctx.fillText('online play is score-free — nothing is saved · Q — leave', GW / 2, GH - 28);
    ctx.restore(); ctx.textAlign = 'left';
    return;
  }
  // your hero, right where you can still change it — the pick rides the handshake
  const classLocked = netUi.phase === 'connecting' || netUi.phase === 'handshake';
  const pvy = GH - 118;
  drawClassPreview(GW / 2, pvy, CLASSES[classSel], 'white', !classLocked);
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = classLocked ? '#9fb0c0' : '#ffe9ad';
  ctx.fillText((classLocked ? 'your class:  ' : '◀ ▶  your class:  ') +
               CLASS_ICON[CLASSES[classSel]] + ' ' + CLASSES[classSel].toUpperCase(), GW / 2, pvy + 34);
  ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#69788a';
  ctx.fillText('online co-op is score-free — nothing is saved · ' +
               (netUi.phase === 'code' ? 'Backspace on an empty code — back' : 'Q — back'), GW / 2, GH - 28);
  ctx.restore(); ctx.textAlign = 'left';
}
// a small "waiting on the other player" badge, drawn by frameStep while the
// lockstep gate is blocked (render-only — never touches the sim)
function drawNetWait() {
  ctx.save();
  ctx.textAlign = 'center';
  const w = 300, h = 44, x = GW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(6,10,16,0.85)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
  ctx.fillText('⏳ waiting for the other player…', GW / 2, y + 18);
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('the link is alive — they may be lagging or tabbed away · Q leaves', GW / 2, y + 34);
  ctx.restore(); ctx.textAlign = 'left';
}

// the mid-run reconnect banner (netRecon set): the run is held frozen while the
// transport re-signals — drawn over the last frame from frameStep, render-only
function drawNetRecon() {
  const rc = netReconActive();
  if (!rc) return;
  const seat = netReconSeat();
  const secs = Math.max(0, Math.floor((performance.now() - rc.t0) / 1000));
  const left = Math.max(0, Math.floor(NET_RECON_MAX_MS / 1000) - secs);
  const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  ctx.save();
  ctx.textAlign = 'center';
  const w = 420, h = 58, x = GW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(18,6,8,0.9)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ff8a80';
  ctx.fillText(netRecon ? '🔌 CONNECTION LOST — RECONNECTING…' : '🔌 PLAYER ' + (seat + 1) + ' DROPPED — RE-SIGNALING…', GW / 2, y + 20);
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('attempt ' + rc.attempt + ' — the run is held · gives up in ' + clock + ' · Q leaves now', GW / 2, y + 40);
  ctx.restore(); ctx.textAlign = 'left';
}

/* ── PAUSE & SETTINGS (the shell) ──
   Solo/couch runs truly pause (toggles cross the recorder as opcode 13, so a
   replay holds the same beats); online it is an overlay over the live sim.
   Every option is PRESENTATION ONLY — the iron rule from reduceMotion: options
   change what you see, never what the sim does. */
function drawShellMenu() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const y0 = Math.round(GH * 0.24);
  ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.fillText(netplay ? 'SETTINGS' : 'PAUSED', GW / 2, y0);
  ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(netplay ? 'the war band fights on — settings are yours alone' : 'the horde waits', GW / 2, y0 + 22);
  ctx.shadowBlur = 0;
  const rows = [
    ['screen shake', sfOpts.shake === 0 ? 'off' : sfOpts.shake < 1 ? 'half' : 'full'],
    ['camera kicks', sfOpts.kick > 0 ? 'on' : 'off'],
    ['impact flashes', sfOpts.flash > 0 ? 'full' : 'reduced'],
    ['high-contrast elites', sfOpts.hiVis ? 'on' : 'off'],
  ];
  for (let i = 0; i < rows.length; i++) {
    const hot = i === shellSel;
    const y = y0 + 60 + i * 30;
    ctx.font = (hot ? 'bold ' : '') + '14px Tahoma,Arial';
    ctx.fillStyle = hot ? '#ffe9ad' : '#9aa3a8'; ctx.textAlign = 'right';
    ctx.fillText(rows[i][0], GW / 2 - 16, y);
    ctx.fillStyle = hot ? '#7fd8ff' : '#77828c'; ctx.textAlign = 'left';
    ctx.fillText((hot ? '◀ ' : '') + rows[i][1] + (hot ? ' ▶' : ''), GW / 2 + 16, y);
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('↑ ↓ — choose   ·   ◀ ▶ — change   ·   P — ' + (netplay ? 'close' : 'resume'), GW / 2, y0 + 60 + rows.length * 30 + 16);
  ctx.restore(); ctx.textAlign = 'left';
}

/* ── the LIVING CAMERA (see the cam state note in 02-state) ── */
function camKick(dx, dy, mag) {
  if (api.reduceMotion) return;
  const d = Math.hypot(dx, dy) || 1;
  cam.kx += (dx / d) * mag * sfOpts.kick;
  cam.ky += (dy / d) * mag * sfOpts.kick;
}
// one camera step per loop call (= per sim tick — the cadence tests depend on it)
function camUpdate() {
  if (api.reduceMotion) {
    cam.x = cam.y = cam.kx = cam.ky = 0; cam.zoom = 1; cam.pulse = 0;
    cam.prevBreather = breatherT;
    return;
  }
  // drift toward the party's center of mass — only on the open field (the
  // battlefield draws with an overscan bleed for exactly this; the set-piece
  // rooms are framed compositions and hold still)
  const roomBound = swActive || jojoActive || ianActive;
  let tx = 0, ty = 0;
  if (!roomBound) {
    const hs = heroesLive();
    if (hs.length) {
      let ax = 0, ay = 0;
      for (const h of hs) { ax += h.x; ay += h.y; }
      tx = clamp((ax / hs.length - GW / 2) * 0.12, -14, 14);
      ty = clamp((ay / hs.length - GH / 2) * 0.12, -10, 10);
    }
  }
  cam.x += (tx - cam.x) * 0.05;
  cam.y += (ty - cam.y) * 0.05;
  // zoom: boss cards punch in; the wave's final kill breathes in and settles
  if (breatherT > 0 && cam.prevBreather <= 0) cam.pulse = 44;
  cam.prevBreather = breatherT;
  if (cam.pulse > 0) cam.pulse--;
  const zt = bossIntro ? 1.08 : cam.pulse > 0 ? 1 + 0.09 * (cam.pulse / 44) : 1;
  cam.zoom += (zt - cam.zoom) * 0.08;
  // kicks decay fast
  cam.kx *= 0.8; cam.ky *= 0.8;
}
function camApply() {
  if (api.reduceMotion) return;
  ctx.translate(GW / 2, GH / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-GW / 2, -GH / 2);
  ctx.translate(-cam.x + cam.kx, -cam.y + cam.ky);
}

/* ── the DEATH KILL CAM ──
   The last seconds of the run replay in slow motion off the ghost tape, the
   camera easing in tight on the fallen hero, letterboxed under a closing red
   wash, ending on the title. Strictly render-only: the sim (and netplay's
   lockstep ticks) keep running underneath; advancement happens once per loop
   call so the deterministic draw-stream and 60/120Hz cadence tests hold. */
function drawKillCam() {
  const kc = killCam;
  const N = kc.tape.length;
  const idx = Math.min(N - 1, Math.floor(kc.i));
  const snap = kc.tape[idx];
  const atEnd = idx >= N - 1;
  const p = Math.min(1, kc.t / 50);
  const ease = 1 - (1 - p) * (1 - p);
  const zoom = 1.12 + ease * 0.68;
  const fx = clamp(kc.fx, GW * 0.22, GW * 0.78);
  const fy = clamp(kc.fy, GH * 0.26, GH * 0.74);
  ctx.save();
  ctx.translate(GW / 2, GH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-fx, -fy + ease * 8);
  if (!swActive && !jojoActive && !ianActive) drawBattlefield();
  else { ctx.fillStyle = '#04060a'; ctx.fillRect(-GW, -GH, GW * 3, GH * 3); }
  for (const e of snap.enemies) drawEnemy(e);
  for (const h of snap.heroes) drawHero(h);
  ctx.restore();
  kc.t++;
  if (!atEnd) kc.i += CAM_SPEED;
  else kc.hold++;
  // screen-space drama: letterbox bars + a red wash leaning in + the title
  const bar = Math.min(GH * 0.11, kc.t * 2.5);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, GW, bar); ctx.fillRect(0, GH - bar, GW, bar);
  const rv = ctx.createRadialGradient(GW / 2, GH / 2, Math.min(GW, GH) * 0.2, GW / 2, GH / 2, Math.max(GW, GH) * 0.7);
  rv.addColorStop(0, 'rgba(120,8,8,0)');
  rv.addColorStop(1, 'rgba(120,8,8,' + (0.12 + ease * 0.16).toFixed(3) + ')');
  ctx.fillStyle = rv; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  if (atEnd) {
    ctx.globalAlpha = Math.min(1, kc.hold / 24);
    ctx.font = 'bold 34px Tahoma,Arial';
    ctx.strokeStyle = '#2a0505'; ctx.lineWidth = 6;
    ctx.strokeText('THOU ART SLAIN', GW / 2, GH / 2 - 8);
    ctx.fillStyle = '#ff6e6e';
    ctx.fillText('THOU ART SLAIN', GW / 2, GH / 2 - 8);
    ctx.globalAlpha = 1;
  }
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = 'rgba(200,210,220,0.7)';
  ctx.fillText('the final moments · any key skips', GW / 2, GH - bar - 10);
  ctx.textAlign = 'left';
  if (kc.hold > 64) killCam = null;   // ...and the death screen takes over
}

function panel(lines) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  let y = GH / 2 - (lines.length - 1) * 16;
  for (const [text, font, color] of lines) {
    ctx.font = font; ctx.fillStyle = color;
    ctx.fillText(text, GW / 2, y);
    y += 34;
  }
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

/* the game-over screen: epitaph + the online "hall of legends" leaderboard.
   Off when the worker's unreachable (lbState 'off') → just the local best. */
/* ── the RESULTS CEREMONY ──
   Before the boards: the run gets a reckoning. Lines land one per beat and the
   score counts up — all deadT-driven (deterministic; any key fast-forwards
   deadT past it, see onKey). Replay watchers skip straight to their ending. */
function drawResults() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.66)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const y0 = Math.round(GH * 0.2);
  ctx.font = 'bold 30px Tahoma,Arial'; ctx.fillStyle = '#ff6e6e';
  ctx.fillText('THE RECKONING', GW / 2, y0);
  // the fallen, ranked — the horde knows who did the work
  const byN = Object.entries(killsByType).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const row = (i, label, value, col) => {
    const at = 56 + i * 22;                       // each line lands on its own beat
    if (deadT < at) return;
    const a = Math.min(1, (deadT - at) / 12);
    ctx.globalAlpha = a;
    ctx.font = '14px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0'; ctx.textAlign = 'right';
    ctx.fillText(label, GW / 2 - 14, y0 + 44 + i * 27);
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = col || '#e8eef4'; ctx.textAlign = 'left';
    ctx.fillText(value, GW / 2 + 14, y0 + 44 + i * 27);
    ctx.globalAlpha = 1;
  };
  let i = 0;
  row(i++, 'waves survived', String(wave) + (hardMode ? '  ☠' : '') + (endless ? '  ∞' : ''), '#ffd24d');
  row(i++, 'the fallen', String(kills), '#ff8a80');
  if (byN.length) row(i++, 'mostly', byN.map(([t, n]) => t + ' ×' + n).join(' · '), '#c8d2da');
  row(i++, 'tokens banked', String(tokens), '#80deea');
  // the score counts up over the last stretch of the ceremony
  const sAt = 56 + i * 22;
  if (deadT >= sAt) {
    const sp = Math.min(1, (deadT - sAt) / 40);
    const shown = Math.round(score * (1 - (1 - sp) * (1 - sp)));
    ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#ffd24d'; ctx.textAlign = 'center';
    ctx.fillText(shown.toLocaleString(), GW / 2, y0 + 60 + i * 27 + 14);
    if (sp >= 1 && newBest) {
      ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7CFC8A';
      ctx.fillText('★ A NEW LEGEND — your best ★', GW / 2, y0 + 88 + i * 27);
    }
  }
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = 'rgba(200,210,220,0.6)'; ctx.textAlign = 'center';
  ctx.fillText('any key — the hall of legends awaits', GW / 2, GH - 44);
  ctx.restore(); ctx.textAlign = 'left';
}
function drawDeathScreen() {
  if (!replayMode && deadT < 178) { drawResults(); return; }
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;

  const cx = GW / 2;
  const board = (lbState === 'view' || lbState === 'done' || lbState === 'submitting');
  // two columns when today's board exists (or this WAS a daily run): all-time + daily
  const cols = [{ title: 'ALL TIME', rows: lbScores || [], hot: !dailyRun }];
  if (lbDaily !== null || dailyRun) cols.push({ title: '☀ TODAY · ' + dailyDayPretty(), rows: lbDaily || [], hot: dailyRun });
  const rowsN = Math.max(1, ...cols.map((c) => c.rows.length));
  // height-aware top so a full 10-row board stays centred and on-screen
  const blockH = board ? 172 + rowsN * 18 : lbState === 'enter' ? 230 : 150;
  let y = Math.max(46, GH / 2 - blockH / 2);

  ctx.font = 'bold 36px Tahoma,Arial'; ctx.fillStyle = 'white';
  ctx.fillText('THOU ART SLAIN', cx, y); y += 32;
  ctx.font = '18px Tahoma,Arial'; ctx.fillStyle = newBest ? '#ffd24d' : 'white';
  ctx.fillText('SCORE ' + score + (newBest ? '   ★ NEW BEST ★' : '   ·   BEST ' + best), cx, y); y += 25;
  ctx.font = '14px Tahoma,Arial'; ctx.fillStyle = '#ccc';
  ctx.fillText('you survived ' + wave + (wave === 1 ? ' wave' : ' waves') +
               '  ·  slew ' + kills + (kills === 1 ? ' foe' : ' foes'), cx, y); y += 20;
  if (dailyRun) {
    ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffb300';
    ctx.fillText('☀ daily challenge · ' + dailyDayPretty(), cx, y); y += 20;
  }
  y += 10;

  if (lbState === 'off' || lbState === 'error') {
    if (replayMode) {
      ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
      ctx.fillText('▶ so ends the legend of ' + (replay ? replay.name : '…'), cx, y); y += 24;
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
      ctx.fillText('Q to return', cx, y);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
      return;
    }
    if (netplay) {
      ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
      ctx.fillText('🌐 you fell together — online runs are score-free', cx, y); y += 24;
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
      ctx.fillText(netIsHost ? 'R — rematch (same team, a new world)  ·  Q — leave' : 'the host presses R to rematch  ·  Q — leave', cx, y);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
      return;
    }
    if (cheated) {
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#8a949a';
      ctx.fillText('cheats were used — this run is unranked', cx, y); y += 22;
    }
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
    ctx.fillText('press R to rise again', cx, y);
    ctx.shadowBlur = 0; ctx.textAlign = 'left';
    return;
  }

  ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.fillText('— THE HALL OF LEGENDS —', cx, y); y += 28;

  if (lbState === 'loading') {
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#bbb';
    ctx.fillText('ranking you among the fallen…', cx, y);
  } else if (lbState === 'enter') {
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#caffa0';
    ctx.fillText(dailyRun ? "A LEGEND OF THIS DAY IS BORN" : 'A NEW LEGEND IS BORN', cx, y); y += 30;
    const caret = (Math.floor(deadT / 16) % 2) ? '▍' : ' ';   // deadT, not frame (frozen while dead)
    ctx.font = 'bold 24px "Courier New",monospace'; ctx.fillStyle = '#fff';
    ctx.fillText((lbName || '') + caret, cx, y); y += 26;
    ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#8a949a';
    ctx.fillText('type your name  ·  ENTER to enshrine it' + (dailyRun ? "  ·  today's board" : ''), cx, y);
  } else {
    // the boards, side by side (single centred column when there's no daily board).
    // the ▸ marker highlights the player's row on the board they submitted to.
    const colX = cols.length === 1 ? [cx] : [cx - 168, cx + 168];
    const topY = y;
    let maxY = y;
    cols.forEach((col, ci) => {
      let yy = topY;
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = col.hot ? '#ffd24d' : '#9aa3a8';
      ctx.fillText(col.title, colX[ci], yy); yy += 22;
      ctx.font = '13px "Courier New",monospace';
      if (col.rows.length === 0) {
        ctx.fillStyle = '#bbb';
        ctx.fillText(col.hot ? 'no legends yet — be the first' : 'no legends yet', colX[ci], yy); yy += 18;
      }
      for (let i = 0; i < col.rows.length; i++) {
        const e = col.rows[i];
        const isMe = col.hot && i === lbRank;
        // rows with a stored replay get a ▶; the open watch picker highlights its pick
        const wi = watchSel ? watchSel.list.findIndex((w) => w.entry === e) : -1;
        const onW = wi !== -1 && wi === watchSel.idx;
        ctx.fillStyle = onW ? '#fff' : isMe ? '#ffd24d' : i < 3 ? '#e8e8e8' : '#9aa3a8';
        const rk = String(i + 1).padStart(2, ' ');
        const nm = String(e.name || 'AAA').slice(0, 10).padEnd(10, ' ');
        const sc = String(e.score).padStart(7, ' ');
        ctx.fillText((onW ? '» ' : isMe ? '▸ ' : '  ') + rk + ' ' + nm + ' ' + sc +
                     (e.rp ? ' ▶' : '  ') + (isMe ? '◂' : ''), colX[ci], yy);
        yy += 18;
      }
      maxY = Math.max(maxY, yy);
    });
    y = maxY + 8;
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = watchSel ? '#ffd24d' : '#ccc';
    ctx.fillText(
      watchSel ? '↑ ↓ choose a legend  ·  ENTER to watch  ·  Q closes'
      : lbState === 'submitting' ? 'recording your legend…'
      : watchableEntries().length ? 'press R to rise again  ·  W to watch a ▶ legend'
      : 'press R to rise again', cx, y);
  }
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}
