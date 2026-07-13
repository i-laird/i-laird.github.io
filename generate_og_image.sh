#!/bin/bash
# Regenerates assets/og_image.png — the 1200×630 Open Graph card shown when the
# site is linked on social platforms. Self-contained (does not load the site);
# update the canvas drawing below if the design or easter-egg count changes.
# Requires Google Chrome.
set -e
cd "$(dirname "$0")"

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
TMP_HTML="$(mktemp -t og_image).html"

cat > "$TMP_HTML" << 'EOF'
<!DOCTYPE html>
<html>
<body style="margin:0">
<canvas id="c" width="1200" height="630"></canvas>
<script>
  const ctx = document.getElementById('c').getContext('2d');
  const MONO = "'Courier New', Courier, monospace";
  const GREEN = '#00ff41', DIM = '#00802b', BRIGHT = '#7fff8f', RED = '#ff5555',
        WHITE = '#d0d0d0', BG = '#0a0e0a', TBAR = '#141814', BORDER = '#1e261e';
  const CW = 1200, CH = 630;

  // backdrop + window
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, CW, CH);
  const wx = 24, wy = 24, ww = CW - 48, wh = CH - 48;
  ctx.beginPath();
  ctx.roundRect(wx, wy, ww, wh, 14);
  ctx.fillStyle = BG; ctx.fill();
  ctx.strokeStyle = BORDER; ctx.lineWidth = 2; ctx.stroke();
  ctx.save();
  ctx.clip();

  // titlebar + traffic lights
  ctx.fillStyle = TBAR;
  ctx.fillRect(wx, wy, ww, 64);
  ctx.strokeStyle = BORDER;
  ctx.beginPath(); ctx.moveTo(wx, wy + 64); ctx.lineTo(wx + ww, wy + 64); ctx.stroke();
  [['#ff5f57', 0], ['#febc2e', 34], ['#28c840', 68]].forEach(([c, dx]) => {
    ctx.beginPath(); ctx.arc(64 + dx, wy + 32, 10, 0, Math.PI * 2);
    ctx.fillStyle = c; ctx.fill();
  });
  ctx.fillStyle = '#555';
  ctx.font = `22px ${MONO}`;
  ctx.textAlign = 'center';
  ctx.fillText('ian@portfolio — bash — 80×24', CW / 2, wy + 40);
  ctx.textAlign = 'left';

  const prompt = (y, rest) => {
    ctx.font = `26px ${MONO}`;
    ctx.fillStyle = BRIGHT;
    ctx.fillText('ian@portfolio:~$', 72, y);
    ctx.fillStyle = GREEN;
    ctx.fillText(' ' + rest, 72 + ctx.measureText('ian@portfolio:~$').width, y);
  };

  // whoami
  prompt(150, 'whoami');
  ctx.font = `bold 60px ${MONO}`;
  ctx.fillStyle = BRIGHT;
  ctx.shadowColor = GREEN; ctx.shadowBlur = 22;
  ctx.fillText('IAN LAIRD', 72, 232);
  ctx.shadowBlur = 0;
  ctx.font = `28px ${MONO}`;
  ctx.fillStyle = WHITE;
  ctx.fillText('software engineer', 72, 278);

  // the hook
  prompt(360, 'hal');
  ctx.font = `28px ${MONO}`;
  ctx.fillStyle = RED;
  ctx.fillText("HAL: Good morning. I've been expecting you.", 72, 404);

  // idle prompt with block cursor
  ctx.font = `26px ${MONO}`;
  ctx.fillStyle = BRIGHT;
  ctx.fillText('ian@portfolio:~$', 72, 472);
  ctx.fillStyle = GREEN;
  ctx.fillRect(72 + ctx.measureText('ian@portfolio:~$ ').width, 452, 15, 26);

  // HAL eye, watching from the corner
  const ex = CW - 120, ey = 240;
  ctx.beginPath(); ctx.arc(ex, ey, 34, 0, Math.PI * 2);
  ctx.fillStyle = '#1a1a1a'; ctx.fill();
  ctx.strokeStyle = '#444'; ctx.lineWidth = 3; ctx.stroke();
  const eye = ctx.createRadialGradient(ex, ey, 2, ex, ey, 21);
  eye.addColorStop(0, '#ffdddd'); eye.addColorStop(0.25, '#ff3030'); eye.addColorStop(1, '#400000');
  ctx.beginPath(); ctx.arc(ex, ey, 21, 0, Math.PI * 2);
  ctx.fillStyle = eye; ctx.fill();

  // footer
  ctx.fillStyle = DIM;
  ctx.font = `26px ${MONO}`;
  ctx.fillText('5 games · 44 easter eggs · 1 paranoid AI   →   ianclaird.com', 72, 572);

  // scanlines
  ctx.fillStyle = 'rgba(0,0,0,0.13)';
  for (let y = wy; y < wy + wh; y += 4) ctx.fillRect(wx, y, ww, 2);
  ctx.restore();
</script>
</body>
</html>
EOF

"$CHROME" --headless --disable-gpu --hide-scrollbars \
  --window-size=1200,630 --virtual-time-budget=2000 \
  --screenshot="assets/og_image.png" "file://$TMP_HTML" 2>/dev/null

rm "$TMP_HTML"
echo "wrote assets/og_image.png"
