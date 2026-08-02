// Achievements overlay — the easter-egg panel behind the titlebar 🥚 badge
// (the unlocked/locked list, the share view, and the 1200×630 share-card
// canvas), lazily loaded on the first badge click (see toggleAchievements()
// in app.js; same pattern as the other lazy chunks). Loaded as a CLASSIC
// script, it exposes one global, initAchUI(api), which returns { toggle }.
// Everything it needs from app.js arrives through the explicit `api` bridge
// (app.js's achBridge(): the ACHIEVEMENTS definitions, the live foundEggs
// set, the #cmd element, and the achOverlayEl accessor — that element handle
// STAYS OWNED BY APP.JS because the finale idle-poll reads it to avoid
// interrupting an open overlay). This file references NOTHING from app.js by
// free global name, so it can be bundled & obfuscated as an independent lazy
// chunk. The only contract is the initAchUI name + the api key names (keep
// both on the obfuscator's reserved list).
// NOTE: the moved code is kept at its original app.js indentation on purpose.

function initAchUI(api) {
  // Dependency bridge from app.js (see achBridge() there). Stable refs are
  // destructured; the overlay element handle is read/written as
  // api.achOverlayEl so app.js (the finale poll) always sees the live value.
  const { ACHIEVEMENTS, foundEggs, cmd } = api;

  function achKeyHandler(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeAchievements(); }
  }
  function closeAchievements() {
    if (!api.achOverlayEl) return;
    api.achOverlayEl.remove();
    api.achOverlayEl = null;
    document.removeEventListener('keydown', achKeyHandler, true);
    cmd.focus();
  }
  function achHeaderHTML(rightHTML) {
    return `<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px">` +
      `<span style="color:var(--green-bright);font-weight:bold">EASTER EGGS — ${foundEggs.size}/${ACHIEVEMENTS.length}</span>` +
      (foundEggs.size === ACHIEVEMENTS.length ? `<span style="color:#ffd24d;font-weight:bold">— complete</span>` : '') +
      `<span style="display:flex;align-items:center;gap:12px">${rightHTML}` +
      `<span style="color:var(--green-dim)">[esc] close</span></span></div>`;
  }

  function renderAchList(box) {
    let rows = '';
    for (const a of ACHIEVEMENTS) {
      rows += foundEggs.has(a.id)
        ? `<div>🥚 <span style="color:var(--green-bright);font-weight:bold">${a.name}</span> <span style="color:var(--white)">— ${a.desc}</span></div>`
        : `<div style="color:var(--green-dim)">🔒 ??? — ${a.hint}</div>`;
    }
    box.innerHTML = achHeaderHTML(
      `<button id="ach-share-btn" class="card" style="padding:3px 14px;font-size:13px">share</button>`
    ) + rows;
    box.querySelector('#ach-share-btn').addEventListener('click', () => renderShareView(box));
  }

  function renderShareView(box) {
    const BACK = `<button id="ach-back-btn" class="card" style="padding:3px 14px;font-size:13px">← back</button>`;
    const wireBack = () => box.querySelector('#ach-back-btn').addEventListener('click', () => renderAchList(box));
    const fail = msg => {
      box.innerHTML = achHeaderHTML(BACK) + `<div style="color:var(--red,#ff5555)">${msg}</div>`;
      wireBack();
    };

    let canvas = null;
    try { canvas = buildShareCard(); } catch (e) {}
    if (!canvas || !canvas.toBlob) { fail('share failed — your browser does not support canvas.'); return; }

    canvas.toBlob(blob => {
      if (!blob) { fail('share failed — could not encode image.'); return; }
      if (initAchUI._shareUrl) URL.revokeObjectURL(initAchUI._shareUrl);   // don't leak one blob per share/back toggle
      const url = URL.createObjectURL(blob);
      initAchUI._shareUrl = url;

      box.innerHTML = achHeaderHTML(BACK);
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'easter egg share card';
      img.style.cssText = 'display:block;width:100%;border:1px solid var(--green-dim);border-radius:4px;margin:4px 0 10px';
      box.appendChild(img);

      const actions = document.createElement('div');
      actions.className = 'cards';

      if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
        const copyBtn = document.createElement('button');
        copyBtn.className = 'card';
        copyBtn.textContent = 'copy image';
        copyBtn.addEventListener('click', () => {
          navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
            .then(() => { copyBtn.textContent = 'copied ✓'; })
            .catch(() => { copyBtn.textContent = 'copy failed — try download'; });
        });
        actions.appendChild(copyBtn);
      }

      const dl = document.createElement('a');
      dl.className = 'card';
      dl.href = url;
      dl.download = 'ianclaird-easter-eggs.png';
      dl.textContent = 'download png';
      actions.appendChild(dl);

      const file = new File([blob], 'ianclaird-easter-eggs.png', { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        const shareBtn = document.createElement('button');
        shareBtn.className = 'card';
        shareBtn.textContent = 'share…';
        shareBtn.addEventListener('click', () => {
          navigator.share({
            files: [file],
            title: 'easter egg hunt — ianclaird.com',
            text: `I found ${foundEggs.size}/${ACHIEVEMENTS.length} easter eggs on ianclaird.com — can you beat that?`,
          }).catch(() => {});
        });
        actions.appendChild(shareBtn);
      }

      box.appendChild(actions);
      wireBack();
    }, 'image/png');
  }


  // Renders the shareable achievement card (1200×630, OG-image ratio) using the
  // CURRENT theme colors — sharing from HAL mode produces a red card on purpose.
  function buildShareCard() {
    const CW = 1200, CH = 630;
    const canvas = document.createElement('canvas');
    canvas.width = CW; canvas.height = CH;
    const ctx = canvas.getContext('2d');
    const css = getComputedStyle(document.documentElement);
    const col = (v, fb) => (css.getPropertyValue(v) || '').trim() || fb;
    const GREEN  = col('--green', '#00ff41'),  DIM    = col('--green-dim', '#00802b'),
          BRIGHT = col('--green-bright', '#7fff8f'), BG = col('--bg', '#0a0e0a'),
          TBAR   = col('--bar', '#141814'),    BORDER = col('--border', '#1e261e'),
          WHITE  = col('--white', '#d0d0d0');
    const mono = () => "'Courier New', Courier, monospace";
    const total = ACHIEVEMENTS.length, n = foundEggs.size;

    // backdrop + window
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, CW, CH);
    const wx = 24, wy = 24, ww = CW - 48, wh = CH - 48;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(wx, wy, ww, wh, 14); else ctx.rect(wx, wy, ww, wh);
    ctx.fillStyle = BG; ctx.fill();
    ctx.strokeStyle = BORDER; ctx.lineWidth = 2; ctx.stroke();

    // titlebar + traffic lights
    ctx.save();
    ctx.clip();
    ctx.fillStyle = TBAR;
    ctx.fillRect(wx, wy, ww, 64);
    ctx.strokeStyle = BORDER;
    ctx.beginPath(); ctx.moveTo(wx, wy + 64); ctx.lineTo(wx + ww, wy + 64); ctx.stroke();
    [['#ff5f57', 0], ['#febc2e', 34], ['#28c840', 68]].forEach(([c, dx]) => {
      ctx.beginPath(); ctx.arc(64 + dx, wy + 32, 10, 0, Math.PI * 2);
      ctx.fillStyle = c; ctx.fill();
    });
    ctx.fillStyle = '#555';
    ctx.font = `22px ${mono()}`;
    ctx.textAlign = 'center';
    ctx.fillText('ian@portfolio — easter eggs — 80×24', CW / 2, wy + 40);

    // prompt line
    ctx.textAlign = 'left';
    ctx.font = `26px ${mono()}`;
    ctx.fillStyle = BRIGHT;
    ctx.fillText('ian@portfolio:~$', 72, 148);
    ctx.fillStyle = GREEN;
    ctx.fillText(' achievements', 72 + ctx.measureText('ian@portfolio:~$').width, 148);

    // heading with a CRT glow
    ctx.font = `bold 54px ${mono()}`;
    ctx.fillStyle = BRIGHT;
    ctx.shadowColor = GREEN; ctx.shadowBlur = 22;
    ctx.fillText('EASTER EGG HUNT', 72, 230);
    ctx.shadowBlur = 0;

    // the count
    ctx.font = `bold 64px ${mono()}`;
    ctx.fillStyle = GREEN;
    ctx.fillText(`🥚 ${n} / ${total}`, 72, 322);

    // progress bar
    const bx = 72, by = 350, bw = CW - 144, bh = 24;
    ctx.strokeStyle = DIM; ctx.lineWidth = 2;
    ctx.strokeRect(bx, by, bw, bh);
    if (n > 0) {
      ctx.fillStyle = GREEN;
      ctx.fillRect(bx + 3, by + 3, Math.max(4, (bw - 6) * (n / total)), bh - 6);
    }

    // unlocked list, two columns — or a gentle taunt when empty
    ctx.font = `24px ${mono()}`;
    const names = ACHIEVEMENTS.filter(a => foundEggs.has(a.id)).map(a => a.name);
    if (!names.length) {
      ctx.fillStyle = DIM;
      ctx.fillText('nothing found yet. not even the easy one.', 72, 430);
    } else {
      const shown = names.slice(0, 8);
      if (names.length > 8) shown[7] = `…and ${names.length - 7} more`;
      shown.forEach((name, i) => {
        const x = i < 4 ? 72 : 620, y = 418 + (i % 4) * 38;
        ctx.fillStyle = GREEN;  ctx.fillText('✓', x, y);
        ctx.fillStyle = WHITE;  ctx.fillText(name, x + 32, y);
      });
    }

    // HAL is watching (only if you've met him)
    if (foundEggs.has('meet-hal')) {
      const ex = CW - 120, ey = 510;
      ctx.beginPath(); ctx.arc(ex, ey, 30, 0, Math.PI * 2);
      ctx.fillStyle = '#1a1a1a'; ctx.fill();
      ctx.strokeStyle = '#444'; ctx.lineWidth = 3; ctx.stroke();
      const eye = ctx.createRadialGradient(ex, ey, 2, ex, ey, 18);
      eye.addColorStop(0, '#ffdddd'); eye.addColorStop(0.25, '#ff3030'); eye.addColorStop(1, '#400000');
      ctx.beginPath(); ctx.arc(ex, ey, 18, 0, Math.PI * 2);
      ctx.fillStyle = eye; ctx.fill();
    }

    // footer — golden when complete
    ctx.font = `26px ${mono()}`;
    if (n === total) {
      ctx.fillStyle = '#ffd24d';
      ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 12;
      ctx.fillText(`★ all ${total} found — daisy, daisy ★   →   ianclaird.com`, 72, 572);
      ctx.shadowBlur = 0;
    } else {
      ctx.fillStyle = DIM;
      ctx.fillText(`can you find all ${total}?  →  ianclaird.com`, 72, 572);
    }

    // scanlines over everything inside the window
    ctx.fillStyle = 'rgba(0,0,0,0.13)';
    for (let y = wy; y < wy + wh; y += 4) ctx.fillRect(wx, y, ww, 2);
    ctx.restore();

    return canvas;
  }


  function toggle() {
    if (api.achOverlayEl) { closeAchievements(); return; }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--green-dim);border-radius:4px;padding:18px 22px;max-width:560px;width:92%;max-height:80vh;overflow-y:auto;font-size:14px;line-height:1.7;color:var(--green)';
    renderAchList(box);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAchievements(); });
    document.body.appendChild(overlay);
    api.achOverlayEl = overlay;
    cmd.blur();
    document.addEventListener('keydown', achKeyHandler, true);
  }

  return { toggle };
}

// Explicit window export: survives the obfuscated build's IIFE wrap (see
// build.js reservedNames). This is the only name this chunk shares with app.js.
window.initAchUI = initAchUI;
