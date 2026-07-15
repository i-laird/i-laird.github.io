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
    // ── the READY LOBBY: both fighters, side by side, with room to breathe.
    // Each player still picks freely; the run starts only when BOTH confirm. ──
    const starting = netUi.phase === 'starting';
    sub(starting ? 'both ready — forging a shared world' + dots
                 : 'the fight begins when BOTH of you ready up', cy - 84,
        starting ? '#caffa0' : '#9fb0c0');
    const podX = Math.min(150, Math.round(GW * 0.19));
    const py = cy + 2;
    const myCls = CLASSES[classSel];
    const peerCls = CLASSES[clamp(netUi.peerCls | 0, 0, CLASSES.length - 1)];
    // P1 = the host (white), P2 = the joiner (green) — YOU are hot on your side
    const seatL = { cls: netIsHost ? myCls : peerCls, self: netIsHost };
    const seatR = { cls: netIsHost ? peerCls : myCls, self: !netIsHost };
    drawClassPreview(GW / 2 - podX, py, seatL.cls, 'white', seatL.self && !starting,
                     'P1' + (seatL.self ? ' · YOU' : ''));
    drawClassPreview(GW / 2 + podX, py, seatR.cls, P2_COL, seatR.self && !starting,
                     'P2' + (seatR.self ? ' · YOU' : ''));
    ctx.textAlign = 'center';
    const badge = (x, ready) => {
      ctx.font = 'bold 13px Tahoma,Arial';
      ctx.fillStyle = ready ? '#7CFC8A' : '#8494a4';
      ctx.fillText(ready ? '✓ READY' : 'choosing…', x, py + 54);
    };
    badge(GW / 2 - podX, seatL.self ? netUi.myReady : netUi.peerReady);
    badge(GW / 2 + podX, seatR.self ? netUi.myReady : netUi.peerReady);
    // your class row — all four options visible, none of the old corner-cycler cramp
    if (!starting) {
      const clsCol = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL };
      const n = CLASSES.length, gap2 = 10, chh = 24;
      const cw2 = Math.min(104, Math.floor((GW - 60 - gap2 * (n - 1)) / n));
      const x0 = GW / 2 - (cw2 * n + gap2 * (n - 1)) / 2;
      for (let i = 0; i < n; i++) {
        const sel = i === classSel, col = clsCol[CLASSES[i]];
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
        ctx.fillText(CLASS_ICON[CLASSES[i]] + ' ' + CLASSES[i].toUpperCase(),
                     x0 + i * (cw2 + gap2) + cw2 / 2, py + 76 + chh / 2 + 4.5);
      }
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
      ctx.fillText('◀ ▶ — your hero   ·   Z / ENTER — ' + (netUi.myReady ? 'un-ready' : 'READY UP'),
                   GW / 2, py + 128);
    }
    ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#69788a';
    ctx.fillText('online co-op is score-free — nothing is saved · Q — leave', GW / 2, GH - 28);
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
  const secs = Math.max(0, Math.floor((performance.now() - netRecon.t0) / 1000));
  const left = Math.max(0, Math.floor(NET_RECON_MAX_MS / 1000) - secs);
  const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  ctx.save();
  ctx.textAlign = 'center';
  const w = 420, h = 58, x = GW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(18,6,8,0.9)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ff8a80';
  ctx.fillText('🔌 CONNECTION LOST — RECONNECTING…', GW / 2, y + 20);
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('attempt ' + netRecon.attempt + ' — the run is held · gives up in ' + clock + ' · Q leaves now', GW / 2, y + 40);
  ctx.restore(); ctx.textAlign = 'left';
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
function drawDeathScreen() {
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
