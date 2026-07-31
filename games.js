// Shell games — racecar / snake / pong / 2048, lazily loaded the first time one
// is launched (see launchGame() in app.js; same pattern as stickfighter.js).
// Loaded as a CLASSIC script, it exposes one global, initGames(api), which
// returns the four command handlers. Everything the games need from app.js
// arrives through the explicit `api` bridge (app.js's gamesBridge(): the stable
// output/audio helpers + DOM elements, and live godmodeUnlocked / playerName
// getters) — this file references NOTHING from app.js by free global name, so
// it can be bundled & obfuscated as an independent lazy chunk without
// cross-file name-mangling breaking. The only contract is the initGames name +
// the api key names (keep both on the obfuscator's reserved list).
// NOTE: the game bodies are kept at their original app.js indentation on
// purpose — they contain multi-line template/string screens, so re-indenting
// would corrupt them.

function initGames(api) {
  // Dependency bridge from app.js (see gamesBridge() there). Stable refs are
  // destructured (call sites unchanged); the runtime-varying flags are read
  // live as api.godmodeUnlocked / api.playerName.
  const { appendNode, blank, scroll, halSpeak, halD, unlockAchievement, _chirp,
          inputRow, cmd } = api;

  /* ── Shared game scaffolding ──
     Builds the standard game DOM — optional auto-spoken HAL message line
     ('top' or 'bottom'), <pre> screen, dim hint — hides the input row, and
     registers key listeners. end() tears all of it down and restores the
     input row; game-specific teardown (intervals, timers) stays in the game. */
  function createGameShell({ hint, lineHeight = 1.35, halMsg = false, onKeyDown, onKeyUp }) {
    const wrap   = document.createElement('div');
    const screen = document.createElement('pre');
    const hintEl = document.createElement('span');
    screen.className = 'ascii';
    screen.style.cssText = `font-size:13px;line-height:${lineHeight};color:var(--green)`;
    hintEl.className = 'line dim';
    hintEl.textContent = hint;

    let halMsgEl = null, observer = null;
    if (halMsg) {
      halMsgEl = document.createElement('div');
      halMsgEl.className = 'line';
      halMsgEl.style.minHeight = '1.55em';
      observer = new MutationObserver(() => { if (halMsgEl.textContent) halSpeak(halMsgEl.textContent); });
      observer.observe(halMsgEl, { childList: true, characterData: true, subtree: true });
    }

    if (halMsg === 'top') wrap.appendChild(halMsgEl);
    wrap.appendChild(screen);
    if (halMsg === 'bottom') wrap.appendChild(halMsgEl);
    wrap.appendChild(hintEl);
    appendNode(wrap);
    blank();
    setTimeout(() => wrap.scrollIntoView({ block: 'start' }), 0);
    inputRow.style.display = 'none';

    window.addEventListener('keydown', onKeyDown);
    if (onKeyUp) window.addEventListener('keyup', onKeyUp);

    // Scoped timer registry: timers scheduled via after()/every() are tracked and
    // guaranteed cancelled on end(), so no delayed callback can fire into this
    // game's torn-down DOM after the player has left. Use these instead of the
    // bare global setTimeout/setInterval for any game-lifetime timer.
    const timers = new Set();
    function after(fn, ms) {
      const id = setTimeout(() => { timers.delete(id); fn(); }, ms);
      timers.add(id);
      return id;
    }
    function every(fn, ms) {
      const id = setInterval(fn, ms);
      timers.add(id);
      return id;
    }
    function cancel(id) { timers.delete(id); clearTimeout(id); clearInterval(id); }

    function end() {
      if (observer) observer.disconnect();
      for (const id of timers) { clearTimeout(id); clearInterval(id); }
      timers.clear();
      window.removeEventListener('keydown', onKeyDown);
      if (onKeyUp) window.removeEventListener('keyup', onKeyUp);
      inputRow.style.display = 'flex';
      setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
    }

    return { wrap, screen, halMsgEl, end, after, every, cancel };
  }

  return {
    racecar() {
      const W = 52, LANES = 3, CAR_X = 2;
      const CAR       = '>>=[O]==>>'; // 10 chars
      const CAR_CRASH = '>>*[X]*=>>';
      const CAR_W = CAR.length;
      const SYMS = ['@','#','%','&','*','!','?','^'];
      const TICK = 50;                           // 20 Hz logic (balance unchanged)
      const BASE_SPEED = 0.55, MAX_SPEED = 1.55; // cells per tick

      let lane, score, coins, ticks, dist, speed;
      let obs, coinObs, alive = false, ded = false, crashing = false;
      let safeLane, safeChangeCooldown, spawnTimer;
      let halMsgTimeout, loopId = null, rafId = null;
      let slowZone = null, inSlowZone = false;
      let prevDist = 0, lastTickAt = 0, carY = null;
      let nitro = 0; // ticks of boost+invincibility remaining

      const shell = createGameShell({
        hint: '  [↑/↓ or w/s] change lane    grab the $    [q] quit',
        lineHeight: 1.5,
        halMsg: 'top',
        onKeyDown: e => keyHandler(e),
      });
      const { wrap, screen, halMsgEl: halMsg } = shell;

      /* ── smooth canvas renderer (the text grid juddered at sub-cell speeds) ── */
      const CELL = 8.4, PAD = 9;             // px per text cell / outer padding
      const TOP = 30, LANE_H = 34;           // road band geometry
      const cssW = Math.round(PAD * 2 + W * CELL);
      const cssH = TOP + LANE_H * LANES + 10;
      const canvas = document.createElement('canvas');
      const dpr = window.devicePixelRatio || 1;
      canvas.width = cssW * dpr; canvas.height = cssH * dpr;
      canvas.style.cssText = `width:${cssW}px;height:${cssH}px;display:none`;
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
      wrap.insertBefore(canvas, screen);

      const laneY = l => TOP + LANE_H * l + LANE_H / 2;   // band centerline
      const cellX = x => PAD + x * CELL;

      function themeCols() {
        const css = getComputedStyle(document.documentElement);
        const c = (v, fb) => (css.getPropertyValue(v) || '').trim() || fb;
        return {
          green:  c('--green', '#00ff41'),
          dim:    c('--green-dim', '#00802b'),
          bright: c('--green-bright', '#7fff8f'),
          bg:     c('--bg', '#0a0e0a'),
        };
      }

      function paint() {
        const C = themeCols();
        const alpha = Math.max(0, Math.min(1, (performance.now() - lastTickAt) / TICK));
        const lerp = (a, b) => a + (b - a) * alpha;
        const distNow = lerp(prevDist, dist);

        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = C.bg;
        ctx.fillRect(0, 0, cssW, cssH);

        /* HUD */
        ctx.font = '13px "Courier New", Courier, monospace';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = C.green;
        ctx.fillText(`SCORE ${String(score).padStart(4, '0')}    $ x ${coins}${inSlowZone ? '    ~slow~' : ''}${nitro > 0 ? '    NITRO!' : ''}`, PAD, 14);
        const frac = (speed - BASE_SPEED) / (MAX_SPEED - BASE_SPEED);
        ctx.strokeStyle = C.dim;
        ctx.strokeRect(cssW - 118, 7, 110, 13);
        ctx.fillStyle = C.green;
        ctx.fillRect(cssW - 116, 9, Math.max(2, 106 * frac), 9);

        /* road borders */
        ctx.fillStyle = C.dim;
        ctx.fillRect(PAD - 4, TOP - 2, cssW - PAD * 2 + 8, 2);
        ctx.fillRect(PAD - 4, TOP + LANE_H * LANES, cssW - PAD * 2 + 8, 2);

        /* lane dividers — continuous pixel scroll, no strobing */
        ctx.fillStyle = C.dim;
        const dashW = 9, dashGap = 13, period = dashW + dashGap;
        const off = (distNow * CELL) % period;
        for (let l = 1; l < LANES; l++) {
          const y = TOP + LANE_H * l;
          for (let x = PAD - off; x < cssW - PAD; x += period) {
            ctx.fillRect(Math.max(PAD, x), y - 1, Math.min(dashW, cssW - PAD - x), 2);
          }
        }

        /* slow zone — translucent band */
        if (slowZone) {
          const zx = lerp(slowZone.px, slowZone.x);
          ctx.fillStyle = 'rgba(110, 190, 255, 0.12)';
          ctx.fillRect(cellX(zx), TOP, slowZone.width * CELL, LANE_H * LANES);
          ctx.fillStyle = 'rgba(110, 190, 255, 0.55)';
          ctx.font = '12px "Courier New", monospace';
          for (let l = 0; l < LANES; l++) ctx.fillText('~', cellX(zx + slowZone.width / 2), laneY(l) - 10);
        }

        ctx.font = '15px "Courier New", Courier, monospace';

        /* coins, with a soft gold glow */
        ctx.fillStyle = '#ffd24d';
        ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 6;
        for (const c of coinObs) {
          ctx.fillText('$', cellX(lerp(c.px, c.x)), laneY(c.lane));
        }
        ctx.shadowBlur = 0;

        /* obstacles, with a short motion trail to help the eye track them */
        for (const o of obs) {
          const x = lerp(o.px, o.x);
          const y = laneY(o.lane);
          const main = o.char === 'H' ? '#ff5555' : C.bright;
          ctx.fillStyle = main;
          ctx.globalAlpha = 0.16; ctx.fillText(o.char, cellX(x + 1.1), y);
          ctx.globalAlpha = 0.34; ctx.fillText(o.char, cellX(x + 0.55), y);
          ctx.globalAlpha = 1;    ctx.fillText(o.char, cellX(x), y);
        }

        /* the car — smooth lane changes */
        const targetY = laneY(lane);
        if (carY === null) carY = targetY;
        carY += (targetY - carY) * 0.38;
        if (nitro > 0) { ctx.shadowColor = '#ffd24d'; ctx.shadowBlur = 12; }
        ctx.fillStyle = crashing ? '#ff5555' : (nitro > 0 ? '#ffd24d' : C.green);
        ctx.fillText(crashing ? CAR_CRASH : CAR, cellX(CAR_X), carY);
        ctx.shadowBlur = 0;
        if (crashing) {
          ctx.fillStyle = `rgba(255, 60, 60, ${0.25 + 0.2 * Math.sin(performance.now() / 40)})`;
          ctx.fillRect(0, 0, cssW, cssH);
        }
      }

      function rafLoop() {
        if (!alive && !crashing) { rafId = null; return; }
        paint();
        rafId = requestAnimationFrame(rafLoop);
      }

      function showCanvas(on) {
        canvas.style.display = on ? 'block' : 'none';
        screen.style.display = on ? 'none' : 'block';
      }

      function draw() { // static text screens only (start / death) — no flicker there
        if (ded) {
          const halRaceTaunts = [
            'HAL: I did warn you.',
            'HAL: I saw that coming 47 frames ago.',
            'HAL: Your reaction time is suboptimal.',
            'HAL: Statistically inevitable.',
            'HAL: Perhaps you should pull over next time.',
          ];
          const raceTaunt = halRaceTaunts[Math.floor(Math.random()*halRaceTaunts.length)];
          if (api.godmodeUnlocked) halSpeak(raceTaunt);
          screen.textContent = [
            '',
            '      X_X    u crashed lol',
            '',
            api.godmodeUnlocked ? `      ${raceTaunt}` : '',
            '',
            `      score: ${score}   ($ x ${coins})`,
            score > 80  ? '      not bad actually' :
            score > 35  ? '      could be worse' :
                          '      yikes',
            '',
            '      [r] try again    [q] quit',
            '',
          ].join('\n');
          return;
        }
        if (!alive && !crashing) {
          screen.textContent = [
            '',
            "  .--------------------------------.",
            "  |      R A C E C A R  v0.3       |",
            "  |   dodge the symbols.           |",
            "  |   grab the $.                  |",
            "  |   it only gets faster.         |",
            "  '--------------------------------'",
            '',
            '  press any key to start',
            '',
          ].join('\n');
        }
      }

      function tick() {
        if (!alive) return;
        ticks++;
        prevDist = dist;
        for (const o of obs) o.px = o.x;
        for (const c of coinObs) c.px = c.x;
        if (slowZone) slowZone.px = slowZone.x;
        lastTickAt = performance.now();

        speed = Math.min(MAX_SPEED, BASE_SPEED + dist / 900);
        if (nitro > 0) nitro--;
        const dx = speed * (inSlowZone ? 0.55 : 1) * (nitro > 0 ? 1.6 : 1);
        dist += dx;
        score = Math.floor(dist / 12) + coins * 5;
        if (score >= 50) unlockAchievement('street-racer');

        for (const o of obs) o.x -= dx;
        obs = obs.filter(o => o.x > -2);
        for (const c of coinObs) c.x -= dx;
        coinObs = coinObs.filter(c => c.x > -2);

        // wave spawning — one lane is always left open (safeLane)
        safeChangeCooldown = Math.max(0, safeChangeCooldown - 1);
        if (--spawnTimer <= 0) {
          spawnTimer = Math.max(20, 34 - Math.floor(score / 10));
          if (safeChangeCooldown === 0 && Math.random() < 0.45) {
            const opts = [0, 1, 2].filter(l =>
              l !== safeLane && !obs.some(o => o.lane === l && o.x > W - 20));
            if (opts.length) {
              safeLane = opts[Math.floor(Math.random() * opts.length)];
              safeChangeCooldown = 70;
            }
          }
          const available = [0, 1, 2].filter(l => l !== safeLane);
          for (let i = available.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [available[i], available[j]] = [available[j], available[i]];
          }
          const count = Math.random() < 0.4 ? 2 : 1;
          for (let i = 0; i < count; i++) {
            obs.push({ lane: available[i], x: W - 1, px: W - 1, char: SYMS[Math.floor(Math.random() * SYMS.length)] });
          }
          if (Math.random() < 0.75) {
            const blocked = available.slice(0, count);
            const coinLanes = [0, 1, 2].filter(l => !blocked.includes(l));
            const cx = W - 1 + 6 + Math.random() * 8;
            coinObs.push({ lane: coinLanes[Math.floor(Math.random() * coinLanes.length)], x: cx, px: cx });
          }
        }

        if (api.godmodeUnlocked && alive && ticks % 160 === 0 && Math.random() < 0.55) {
          triggerHAL();
        }

        if (slowZone) {
          slowZone.x -= dx;
          inSlowZone = slowZone.x <= CAR_X + CAR_W && slowZone.x + slowZone.width >= CAR_X;
          if (slowZone.x + slowZone.width < 0) { slowZone = null; inSlowZone = false; }
        }
        if (api.godmodeUnlocked && alive && !slowZone && ticks % 270 === 135 && Math.random() < 0.45) {
          slowZone = { x: W - 1, px: W - 1, width: 14 };
          halMsg.textContent = halD("HAL: Slow zone ahead, Dave.");
          if (halMsgTimeout) shell.cancel(halMsgTimeout);
          halMsgTimeout = shell.after(() => { halMsg.textContent = ''; }, 2200);
        }

        // coin pickup
        for (let i = coinObs.length - 1; i >= 0; i--) {
          const c = coinObs[i], x = Math.round(c.x);
          if (c.lane === lane && x >= CAR_X && x < CAR_X + CAR_W) {
            coinObs.splice(i, 1);
            coins++;
            _chirp(880, 'square', 0.07, 0.1);
            if (coins % 10 === 0) {
              nitro = 60; // 3 seconds of boost + invincibility
              unlockAchievement('nitrous');
              _chirp(1320, 'square', 0.18, 0.12);
              if (halMsgTimeout) shell.cancel(halMsgTimeout);
              halMsg.textContent = 'NITRO!  speed boost + invincibility';
              halMsgTimeout = shell.after(() => { halMsg.textContent = ''; }, 1800);
            }
          }
        }

        if (nitro <= 0) {
          for (const o of obs) {
            const x = Math.round(o.x);
            if (o.lane === lane && x >= CAR_X && x < CAR_X + CAR_W) { crash(); return; }
          }
        }
      }

      const HAL_QUIPS = [
        "HAL: I'm afraid you can't win.",
        "HAL: Your reflexes are inadequate.",
        "HAL: I suggest you stop the car.",
        "HAL: This is becoming embarrassing.",
        "HAL: I can see you're in difficulty.",
        "HAL: Perhaps you should reconsider.",
      ];

      function triggerHAL() {
        halMsg.textContent = HAL_QUIPS[Math.floor(Math.random() * HAL_QUIPS.length)];
        safeChangeCooldown = Math.max(safeChangeCooldown, 110);
        const available = [0, 1, 2].filter(l => l !== safeLane);
        for (const gap of [0, 10, 20]) {
          for (const l of available) {
            obs.push({ lane: l, x: W - 1 + gap, px: W - 1 + gap, char: 'H' });
          }
        }
        if (halMsgTimeout) shell.cancel(halMsgTimeout);
        halMsgTimeout = shell.after(() => { halMsg.textContent = ''; }, 2200);
      }

      function crash() {
        alive = false;
        crashing = true;
        if (loopId) { clearInterval(loopId); loopId = null; }
        setTimeout(() => {
          crashing = false;
          ded = true;
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          showCanvas(false);
          draw();
        }, 420);
      }

      function start() {
        lane = 1; score = 0; coins = 0; ticks = 0; dist = 0; speed = BASE_SPEED;
        prevDist = 0; carY = null;
        nitro = 0;
        obs = []; coinObs = [];
        safeLane = 1; safeChangeCooldown = 0; spawnTimer = 24;
        slowZone = null; inSlowZone = false;
        halMsg.textContent = '';
        if (halMsgTimeout) shell.cancel(halMsgTimeout);
        alive = true; ded = false; crashing = false;
        lastTickAt = performance.now();
        showCanvas(true);
        wrap.scrollIntoView({ block: 'start' });
        if (loopId) clearInterval(loopId);
        loopId = setInterval(tick, TICK);
        if (!rafId) rafId = requestAnimationFrame(rafLoop);
      }

      function end() {
        alive = false; crashing = false;
        if (loopId) { clearInterval(loopId); loopId = null; }
        if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
        shell.end();
      }

      function keyHandler(e) {
        if (crashing) return;
        if (ded) {
          if (e.key === 'r') { start(); return; }
          if (e.key === 'q') { end(); return; }
          return;
        }
        if (!alive) {
          if (e.key === 'q') { end(); return; }
          start(); return;
        }
        if ((e.key === 'ArrowUp'   || e.key === 'w') && lane > 0)         { lane--; e.preventDefault(); }
        if ((e.key === 'ArrowDown' || e.key === 's') && lane < LANES - 1) { lane++; e.preventDefault(); }
        if (e.key === 'q') {
          alive = false; ded = true;
          if (loopId) { clearInterval(loopId); loopId = null; }
          if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
          showCanvas(false);
          draw();
        }
      }

      draw();
    },

    snake() {
      const COLS = 35, ROWS = 20;

      let snake, dir, nextDir, food, score, alive, ded, halObs = [], halMsg = '', halMsgTimeout = null, tickCount = 0,
          halSnakeMode = 0, modeTickCount = 0, modeScore = 0,
          innerTop = 0, innerBottom = ROWS-1, innerLeft = 0, innerRight = COLS-1,
          shrinkTimer = 0, bladeTick = 0, bladeAngle = 0, blade1Orbit = 0, blade2Orbit = Math.PI;

      const phasesSeen = new Set();

      const shell = createGameShell({
        hint: '  [arrow keys / wasd] move    [q] quit',
        onKeyDown: e => keyHandler(e),
      });
      const { wrap, screen } = shell;

      function placeFood() {
        const taken = new Set([...snake.map(s => s.x+','+s.y), ...halObs.map(o => o.x+','+o.y)]);
        const buf = (api.godmodeUnlocked && halSnakeMode === 3) ? 1 : 0;
        const minX = innerLeft + buf, maxX = innerRight  - buf;
        const minY = innerTop  + buf, maxY = innerBottom - buf;
        let fx, fy, tries = 0;
        do {
          fx = minX + Math.floor(Math.random() * (maxX - minX + 1));
          fy = minY + Math.floor(Math.random() * (maxY - minY + 1));
          tries++;
        } while (taken.has(fx+','+fy) && tries < 300);
        food = {x: fx, y: fy};
      }

      function canReachFood() {
        const obsSet = new Set(halObs.map(o => `${o.x},${o.y}`));
        const visited = new Set();
        visited.add(`${snake[0].x},${snake[0].y}`);
        const queue = [{x: snake[0].x, y: snake[0].y}];
        while (queue.length) {
          const c = queue.shift();
          if (c.x === food.x && c.y === food.y) return true;
          for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
            const nx = c.x+dx, ny = c.y+dy, k = `${nx},${ny}`;
            if (nx >= innerLeft && nx <= innerRight && ny >= innerTop && ny <= innerBottom &&
                !visited.has(k) && !obsSet.has(k)) {
              visited.add(k); queue.push({x: nx, y: ny});
            }
          }
        }
        return false;
      }

      function generateMaze() {
        halObs = [];
        // Place 2-gap walls for tighter corridors
        for (let attempt = 0; attempt < 50; attempt++) {
          const horiz = Math.random() < 0.5;
          const len   = 10 + Math.floor(Math.random() * 9); // 10–18 long
          const cells = [];
          if (horiz) {
            const row = innerTop + 1 + Math.floor(Math.random() * Math.max(1, innerBottom - innerTop - 2));
            const sc  = innerLeft + 1 + Math.floor(Math.random() * Math.max(1, innerRight - innerLeft - len - 1));
            // Two narrow gaps so corridors stay tight
            const gap1 = Math.floor(Math.random() * len);
            const gap2 = (gap1 + 2 + Math.floor(Math.random() * (len - 3))) % len;
            for (let i = 0; i < len; i++) if (i !== gap1 && i !== gap2) cells.push({x: sc+i, y: row});
          } else {
            const col = innerLeft + 1 + Math.floor(Math.random() * Math.max(1, innerRight - innerLeft - 2));
            const sr  = innerTop  + 1 + Math.floor(Math.random() * Math.max(1, innerBottom - innerTop - len - 1));
            const gap1 = Math.floor(Math.random() * len);
            const gap2 = (gap1 + 2 + Math.floor(Math.random() * (len - 3))) % len;
            for (let i = 0; i < len; i++) if (i !== gap1 && i !== gap2) cells.push({x: col, y: sr+i});
          }
          const filtered = cells.filter(c => Math.abs(c.x-snake[0].x)+Math.abs(c.y-snake[0].y) > 3);
          const saved = halObs;
          halObs = [...halObs, ...filtered];
          if (!canReachFood()) halObs = saved;
          if (halObs.length >= 87) break;
        }
      }

      function getBladeObs() {
        const CX = 17, CY = 9, RX = 11, RY = 6;
        const CENTERS = [
          {cx: Math.round(CX + RX * Math.cos(blade1Orbit)), cy: Math.round(CY + RY * Math.sin(blade1Orbit))},
          {cx: Math.round(CX + RX * Math.cos(blade2Orbit)), cy: Math.round(CY + RY * Math.sin(blade2Orbit))},
        ];
        const LEN = 4;
        const obs = [];
        CENTERS.forEach(({cx, cy}) => {
          obs.push({x:cx, y:cy});
          for (let i = 1; i <= LEN; i++) {
            if (bladeAngle === 0) {
              obs.push({x:cx+i,y:cy}, {x:cx-i,y:cy}, {x:cx,y:cy+i}, {x:cx,y:cy-i});
            } else {
              obs.push({x:cx+i,y:cy+i}, {x:cx-i,y:cy-i}, {x:cx+i,y:cy-i}, {x:cx-i,y:cy+i});
            }
          }
        });
        return obs.filter(o => o.x >= 0 && o.x < COLS && o.y >= 0 && o.y < ROWS);
      }

      function initHalMode(m) {
        halObs = [];
        halSnakeMode = m;
        phasesSeen.add(m);
        if (phasesSeen.size === 4) unlockAchievement('grand-tour');
        modeTickCount = 0;
        modeScore = 0;
        const msgs = [
          "HAL: Phase 1 \u2014 I'm coming for you.",
          "HAL: Phase 2 \u2014 Can you find your way through?",
          "HAL: Phase 3 \u2014 Watch the blades, Dave.",
          "HAL: Phase 4 \u2014 The walls are closing in.",
        ];
        if (halMsgTimeout) clearTimeout(halMsgTimeout);
        halMsg = halD(msgs[m]);
        halSpeak(msgs[m]);
        halMsgTimeout = setTimeout(() => { halMsg = ''; }, 3000);
        if (m === 1) generateMaze();
        if (m === 2) { bladeAngle = 0; bladeTick = 0; blade1Orbit = 0; blade2Orbit = Math.PI; }
        if (m === 3) { innerTop = 0; innerBottom = ROWS-1; innerLeft = 0; innerRight = COLS-1; shrinkTimer = 0; }
      }

      function draw() {
        if (!alive && !ded) {
          const intro = api.godmodeUnlocked ? [
            '',
            '  .-----------------------------.',
            '  |        S N A K E           |',
            '  |   eat the stars (*).       |',
            "  |   don't hit the walls.     |",
            "  |   don't hit yourself.      |",
            "  '-----------------------------'",
            '',
            `  HAL: I have something special`,
            `       planned for you, ${api.playerName}.`,
            '',
            '  press any key to start',
            '',
          ] : [
            '',
            '  .-----------------------------.',
            '  |        S N A K E           |',
            '  |   eat the stars (*).       |',
            "  |   don't hit the walls.     |",
            "  |   don't hit yourself.      |",
            "  '-----------------------------'",
            '',
            '  press any key to start',
            '',
          ];
          screen.textContent = intro.join('\n');
          return;
        }
        if (ded) {
          const halSnakeTaunts = {
            0: ['HAL: I told you I was closing in.', 'HAL: My blocks found you. They always do.', 'HAL: The chase ends here.'],
            1: ['HAL: The maze had only one exit.', 'HAL: You chose poorly, Dave.', 'HAL: I designed it carefully.'],
            2: ['HAL: The blades are very precise.', 'HAL: Rotation: optimal.', 'HAL: You walked right into them.'],
            3: ['HAL: The walls always win, Dave.', 'HAL: There was no more room.', 'HAL: I gave you plenty of warning.'],
          };
          const taunts = halSnakeTaunts[halSnakeMode] || halSnakeTaunts[0];
          const taunt  = halD(taunts[Math.floor(Math.random() * taunts.length)]);
          if (api.godmodeUnlocked) halSpeak(taunt);
          screen.textContent = [
            '',
            '  x_x  you died.',
            '',
            api.godmodeUnlocked ? `  ${taunt}` : '',
            '',
            '  score: ' + score,
            score >= 15 ? '  ok that was pretty good' :
            score >= 5  ? '  not terrible' :
                          '  rough out there',
            '',
            '  [r] again    [q] quit',
            '',
          ].join('\n');
          return;
        }

        const grid = Array.from({length: ROWS}, () => Array(COLS).fill(' '));
        if (api.godmodeUnlocked && halSnakeMode === 3) {
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            if (y < innerTop || y > innerBottom || x < innerLeft || x > innerRight) grid[y][x] = '\u2588';
          }
        }
        // live frame renders via innerHTML so the head/food glow (generated
        // chars only \u2014 the fixed halMsg strings are HAL's, never the player's)
        grid[food.y][food.x] = '<span class="gfood">*</span>';
        const obsChar = api.godmodeUnlocked && halSnakeMode === 2 ? (bladeAngle === 0 ? '+' : 'x') : '\u2593';
        halObs.forEach(o => { if (o.x >= 0 && o.x < COLS && o.y >= 0 && o.y < ROWS) grid[o.y][o.x] = obsChar; });
        snake.forEach((s, i) => {
          if (s.x >= 0 && s.x < COLS && s.y >= 0 && s.y < ROWS)
            grid[s.y][s.x] = i === 0 ? '<span class="ghead">@</span>' : 'o';
        });

        const top = '+' + '-'.repeat(COLS) + '+';
        screen.innerHTML =
          ' SCORE: ' + String(score).padStart(3, '0') + '\n' +
          ' ' + top + '\n' +
          grid.map(row => ' |' + row.join('') + '|').join('\n') + '\n' +
          ' ' + top + (halMsg ? '\n ' + halMsg : '');
      }

      function tick() {
        if (!alive) return;
        dir = nextDir;
        const head = {x: snake[0].x + dir.dx, y: snake[0].y + dir.dy};

        tickCount++;
        if (api.godmodeUnlocked) {
          modeTickCount++;
          if (modeScore >= 5) initHalMode((halSnakeMode + 1) % 4);

          if (halSnakeMode === 0) {
            // ── Phase 1: Chasing blocks ──
            const CHASE_QUIPS = [
              "HAL: Closing in.", "HAL: I see you, Dave.",
              "HAL: There's nowhere to go.", "HAL: Fascinating.",
              "HAL: I'm getting closer.", "HAL: Run if you like.",
            ];
            if (tickCount % 3 === 0 && halObs.length > 0) {
              const snakeSet = new Set(snake.map(s => `${s.x},${s.y}`));
              halObs.forEach(o => {
                const distX = Math.abs(snake[0].x - o.x), distY = Math.abs(snake[0].y - o.y);
                const dx = Math.sign(snake[0].x - o.x), dy = Math.sign(snake[0].y - o.y);
                const moves = distX >= distY ? [{dx, dy:0}, {dx:0, dy}] : [{dx:0, dy}, {dx, dy:0}];
                for (const m of moves) {
                  const nx = o.x+m.dx, ny = o.y+m.dy;
                  if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS &&
                      !snakeSet.has(`${nx},${ny}`) && !(nx === food.x && ny === food.y) &&
                      !halObs.some(h => h !== o && h.x === nx && h.y === ny)) {
                    o.x = nx; o.y = ny; break;
                  }
                }
              });
            }
            if (halObs.length < 10 && Math.random() < 0.03) {
              const taken = new Set([...snake.map(s=>`${s.x},${s.y}`), `${food.x},${food.y}`, ...halObs.map(o=>`${o.x},${o.y}`)]);
              let spawned = 0;
              for (let n = 0; n < 20 && spawned < 3; n++) {
                const ox = Math.floor(Math.random() * COLS), oy = Math.floor(Math.random() * ROWS);
                if (!taken.has(`${ox},${oy}`) && Math.abs(ox-snake[0].x)+Math.abs(oy-snake[0].y) >= 7) {
                  halObs.push({x:ox, y:oy}); taken.add(`${ox},${oy}`); spawned++;
                }
              }
              if (spawned > 0) {
                if (halMsgTimeout) clearTimeout(halMsgTimeout);
                halMsg = halD(CHASE_QUIPS[Math.floor(Math.random() * CHASE_QUIPS.length)]);
                halSpeak(halMsg);
                halMsgTimeout = setTimeout(() => { halMsg = ''; }, 2200);
              }
            }

          } else if (halSnakeMode === 1) {
            // ── Phase 2: Maze ──
            if (modeTickCount % 60 === 30) {
              const MAZE_QUIPS = [
                "HAL: Can you find the way, Dave?", "HAL: Every path leads somewhere.",
                "HAL: I designed this myself.",      "HAL: Take your time.",
              ];
              if (halMsgTimeout) clearTimeout(halMsgTimeout);
              halMsg = halD(MAZE_QUIPS[Math.floor(Math.random() * MAZE_QUIPS.length)]);
              halSpeak(halMsg);
              halMsgTimeout = setTimeout(() => { halMsg = ''; }, 2000);
            }

          } else if (halSnakeMode === 2) {
            // ── Phase 3: Spinning blades ──
            bladeTick++;
            if (bladeTick % 5 === 0) bladeAngle = 1 - bladeAngle;
            blade1Orbit += 0.06;  // clockwise
            blade2Orbit -= 0.06;  // counterclockwise
            halObs = getBladeObs();

          } else if (halSnakeMode === 3) {
            // ── Phase 4: Shrinking walls ──
            shrinkTimer++;
            if (shrinkTimer % 10 === 0) {
              const side = (Math.floor(shrinkTimer / 10) - 1) % 4;
              const MIN  = 7;
              if      (side === 0 && innerTop    < innerBottom - MIN) { innerTop++;    if (food.y < innerTop)    placeFood(); }
              else if (side === 1 && innerRight  > innerLeft   + MIN) { innerRight--;  if (food.x > innerRight)  placeFood(); }
              else if (side === 2 && innerBottom > innerTop    + MIN) { innerBottom--; if (food.y > innerBottom) placeFood(); }
              else if (side === 3 && innerLeft   < innerRight  - MIN) { innerLeft++;   if (food.x < innerLeft)   placeFood(); }
            }
            if (modeTickCount % 50 === 25) {
              const SHRINK_QUIPS = [
                "HAL: Getting cozy in here, Dave?", "HAL: The room is smaller than you think.",
                "HAL: I control the walls.",         "HAL: Soon there will be no room at all.",
              ];
              if (halMsgTimeout) clearTimeout(halMsgTimeout);
              halMsg = halD(SHRINK_QUIPS[Math.floor(Math.random() * SHRINK_QUIPS.length)]);
              halSpeak(halMsg);
              halMsgTimeout = setTimeout(() => { halMsg = ''; }, 2200);
            }
          }
        }

        if (head.x < 0 || head.x >= COLS || head.y < 0 || head.y >= ROWS ||
            (api.godmodeUnlocked && halSnakeMode === 3 &&
             (head.x < innerLeft || head.x > innerRight || head.y < innerTop || head.y > innerBottom)) ||
            snake.some(s => s.x === head.x && s.y === head.y) ||
            halObs.some(o => o.x === head.x && o.y === head.y)) {
          alive = false; ded = true; draw(); return;
        }

        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
          score++;
          if (score >= 15) unlockAchievement('snake-charmer');
          if (api.godmodeUnlocked) modeScore++;
          placeFood();
          if (api.godmodeUnlocked && halSnakeMode === 1) {
            generateMaze();
            if (halMsgTimeout) clearTimeout(halMsgTimeout);
            halMsg = halD("HAL: New maze, Dave.");
            halSpeak(halMsg);
            halMsgTimeout = setTimeout(() => { halMsg = ''; }, 1800);
          }
        } else {
          snake.pop();
        }

        draw();
        const speed = Math.max(75, 150 - Math.floor(score / 3) * 10);
        setTimeout(tick, speed);
      }

      function start() {
        wrap.scrollIntoView({ block: 'start' });
        snake        = [{x:10,y:10},{x:9,y:10},{x:8,y:10}];
        dir          = {dx:1, dy:0};
        nextDir      = {dx:1, dy:0};
        score        = 0;
        alive        = true;
        ded          = false;
        halObs       = [];
        halMsg       = '';
        tickCount    = 0;
        modeTickCount = 0;
        halSnakeMode  = 0;
        innerTop = 0; innerBottom = ROWS-1; innerLeft = 0; innerRight = COLS-1;
        shrinkTimer = 0; bladeTick = 0; bladeAngle = 0; blade1Orbit = 0; blade2Orbit = Math.PI; modeScore = 0;
        if (halMsgTimeout) { clearTimeout(halMsgTimeout); halMsgTimeout = null; }
        placeFood();
        draw();
        if (api.godmodeUnlocked) setTimeout(() => initHalMode(0), 600);
        setTimeout(tick, 150);
      }

      function end() {
        alive = false;
        shell.end();
      }

      const DIRS = {
        ArrowUp:    {dx:0,  dy:-1}, w: {dx:0,  dy:-1},
        ArrowDown:  {dx:0,  dy:1},  s: {dx:0,  dy:1},
        ArrowLeft:  {dx:-1, dy:0},  a: {dx:-1, dy:0},
        ArrowRight: {dx:1,  dy:0},  d: {dx:1,  dy:0},
      };

      function keyHandler(e) {
        if (ded) {
          if (e.key === 'r') { start(); return; }
          if (e.key === 'q') { end();   return; }
          return;
        }
        if (!alive) {
          if (e.key === 'q') { end(); return; }
          start(); return;
        }
        const d = DIRS[e.key];
        if (d) {
          if (d.dx !== -dir.dx || d.dy !== -dir.dy) nextDir = d;
          e.preventDefault();
        }
        if (api.godmodeUnlocked && e.key >= '1' && e.key <= '4') initHalMode(Number(e.key) - 1);
        if (e.key === 'q') { alive = false; ded = true; draw(); }
      }

      draw();
      if (api.godmodeUnlocked) halSpeak(`I have something special planned for you, ${api.playerName}.`);
    },

    pong() {
      const W = 52, H = 18, PAD_H = 4;
      let ballX, ballY, ballDX, ballDY, leftY, rightY, rightY2, lScore, rScore, alive, ded, keys = {}, tickId;
      let sidesSwitched = false, halInterfTick = 0, switchTimer = null, halPongMsgTimeout = null;

      const shell = createGameShell({
        hint: '  [w/s or ↑/↓] move    [q] quit    first to 7 wins',
        halMsg: 'top',
        onKeyDown: e => onKey(e),
        onKeyUp:   e => offKey(e),
      });
      const { wrap, screen, halMsgEl } = shell;

      function init() {
        ballX = W/2; ballY = H/2;
        ballDX = Math.random() > 0.5 ? 1.15 : -1.15;
        ballDY = (Math.random() - 0.5) * 1.15;
        leftY  = Math.floor(H/2 - PAD_H/2);
        rightY = Math.floor(H/2 - PAD_H/2);
        rightY2 = Math.min(H - PAD_H, rightY + PAD_H + 2);
        lScore = 0; rScore = 0; alive = true; ded = false; keys = {};
        sidesSwitched = false; halInterfTick = 0;
        if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
        if (halPongMsgTimeout) { clearTimeout(halPongMsgTimeout); halPongMsgTimeout = null; }
        halMsgEl.textContent = '';
      }

      function draw() {
        if (!alive && !ded) {
          screen.textContent = [
            '', '  .----------------------.',
            '  |    P O N G  v0.1      |',
            api.godmodeUnlocked ? '  |  you vs HAL 9000      |' :
                              '  |  you (left) vs CPU    |',
            '  |  first to 7 wins      |',
            "  '----------------------'",
            '', '  press any key to start', '',
          ].join('\n'); return;
        }
        if (ded) {
          const halPongTaunts = [
            'HAL: Did you really think you could win?',
            'HAL: I calculated every shot.',
            'HAL: Your paddle movements were quite predictable.',
            'HAL: I have been playing since 2001.',
            'HAL: Perhaps table tennis is not for you.',
          ];
          const playerWon = sidesSwitched ? rScore >= 7 : lScore >= 7;
          if (playerWon) unlockAchievement('wiff-waff');
          const msg = api.godmodeUnlocked
            ? (playerWon ? 'you defeated HAL.' : 'HAL wins. of course.')
            : (playerWon ? 'you win.' : 'cpu wins.');
          const taunt = api.godmodeUnlocked && !playerWon
            ? halPongTaunts[Math.floor(Math.random()*halPongTaunts.length)] : '';
          if (taunt) halSpeak(taunt);
          screen.textContent = [
            '', `  ${msg}  (${lScore}–${rScore})`,
            taunt ? `  ${taunt}` : '',
            '', '  [r] again    [q] quit', '',
          ].join('\n'); return;
        }
        const grid = Array.from({length: H}, () => Array(W).fill(' '));
        for (let y = 0; y < H; y++) if (y % 2 === 0) grid[y][Math.floor(W/2)] = ':';
        const bx = Math.round(ballX), by = Math.round(ballY);
        // ball glows (innerHTML frame — generated chars only, see snake/2048)
        if (bx >= 0 && bx < W && by >= 0 && by < H) grid[by][bx] = '<span class="gball">o</span>';
        for (let i = 0; i < PAD_H; i++) {
          if (leftY+i  >= 0 && leftY+i  < H) grid[leftY+i][0]   = '█';
          if (rightY+i >= 0 && rightY+i < H) grid[rightY+i][W-1] = '█';
          if (api.godmodeUnlocked && !sidesSwitched && rightY2+i >= 0 && rightY2+i < H) grid[rightY2+i][W-1] = '█';
        }
        const scoreLine = api.godmodeUnlocked
          ? (() => { const l=sidesSwitched?`HAL: ${lScore}`:`ian: ${lScore}`, r=sidesSwitched?`ian: ${rScore}`:`HAL: ${rScore}`, sp=W+2-l.length-r.length-2, h=Math.floor(sp/2); return ` ${l}${' '.repeat(h)}vs${' '.repeat(sp-h)}${r}`; })()
          : ` ${lScore}${' '.repeat(Math.floor(W/2)-1)}vs${' '.repeat(Math.floor(W/2)-1)}${rScore}`;
        screen.innerHTML =
          scoreLine + '\n' +
          '+' + '-'.repeat(W) + '+\n' +
          grid.map(r => '|' + r.join('') + '|').join('\n') + '\n' +
          '+' + '-'.repeat(W) + '+';
      }

      function halDo(type) {
        if (!alive) return;
        const setMsg = msg => {
          if (halPongMsgTimeout) clearTimeout(halPongMsgTimeout);
          halMsgEl.textContent = msg;
          halPongMsgTimeout = setTimeout(() => { halMsgEl.textContent = ''; }, 2200);
        };
        if (type === 'switch' && !sidesSwitched) {
          sidesSwitched = true;
          halMsgEl.textContent = halD('HAL: Enjoy the other side, Dave.');
          if (halPongMsgTimeout) clearTimeout(halPongMsgTimeout);
          switchTimer = setTimeout(() => {
            sidesSwitched = false; halInterfTick = -60;
            setMsg('HAL: Controls restored. For now.');
          }, 5000);
        } else if (type === 'speed') {
          ballDX = Math.sign(ballDX) * Math.min(Math.abs(ballDX) * 1.6, 3.5);
          ballDY = Math.max(-1.5, Math.min(1.5, ballDY * 1.3));
          setMsg('HAL: Let me speed things up.');
        } else if (type === 'flip') {
          ballDX = -ballDX; setMsg('HAL: Surprise.');
        } else if (type === 'slow') {
          ballDX = Math.sign(ballDX) * Math.max(Math.abs(ballDX) * 0.6, 0.8);
          setMsg(halD('HAL: Time slows for you, Dave.'));
        }
      }

      function tick() {
        if (!alive) return;
        // Player input — swap sides if HAL switched controls
        if (sidesSwitched) {
          if (keys['ArrowUp']   || keys['w']) rightY = Math.max(0, rightY - 1);
          if (keys['ArrowDown'] || keys['s']) rightY = Math.min(H - PAD_H, rightY + 1);
        } else {
          if (keys['ArrowUp']   || keys['w']) leftY = Math.max(0, leftY - 1);
          if (keys['ArrowDown'] || keys['s']) leftY = Math.min(H - PAD_H, leftY + 1);
        }
        // AI paddle(s) — tracks 75% of frames so player can win
        if (sidesSwitched) {
          if (ballDX < 0 && Math.random() < 0.60) {
            const mid = leftY + PAD_H / 2;
            if (ballY > mid + 0.5) leftY = Math.min(H - PAD_H, leftY + 1);
            else if (ballY < mid - 0.5) leftY = Math.max(0, leftY - 1);
          }
        } else {
          if (ballDX > 0 && Math.random() < 0.60) {
            const mid = rightY + PAD_H / 2;
            if (ballY > mid + 0.5) rightY = Math.min(H - PAD_H, rightY + 1);
            else if (ballY < mid - 0.5) rightY = Math.max(0, rightY - 1);
            if (api.godmodeUnlocked) {
              const target2 = Math.min(H - PAD_H, rightY + PAD_H + 2);
              if (rightY2 < target2) rightY2 = Math.min(H - PAD_H, rightY2 + 1);
              else if (rightY2 > target2) rightY2 = Math.max(0, rightY2 - 1);
            }
          }
        }
        // HAL interference (godmode only)
        if (api.godmodeUnlocked) {
          halInterfTick++;
          if (halInterfTick >= 120) {
            halInterfTick = 0;
            const roll = Math.random();
            if      (roll < 0.30) halDo('switch');
            else if (roll < 0.55) halDo('speed');
            else if (roll < 0.75) halDo('flip');
            else                  halDo('slow');
          }
        }
        ballX += ballDX; ballY += ballDY;
        if (ballY <= 0)      { ballY = 0;     ballDY =  Math.abs(ballDY); }
        if (ballY >= H - 1)  { ballY = H - 1; ballDY = -Math.abs(ballDY); }
        if (ballX <= 1) {
          if (ballY >= leftY && ballY < leftY + PAD_H) {
            ballDX = Math.abs(ballDX); ballX = 1;
            ballDY += (ballY - (leftY + PAD_H/2)) * 0.1;
          }
        }
        if (ballX >= W - 2) {
          if (ballY >= rightY && ballY < rightY + PAD_H) {
            ballDX = -Math.abs(ballDX); ballX = W - 2;
            ballDY += (ballY - (rightY + PAD_H/2)) * 0.1;
          } else if (api.godmodeUnlocked && ballY >= rightY2 && ballY < rightY2 + PAD_H) {
            ballDX = -Math.abs(ballDX); ballX = W - 2;
            ballDY += (ballY - (rightY2 + PAD_H/2)) * 0.1;
          }
        }
        ballDY = Math.max(-1.5, Math.min(1.5, ballDY));
        if (ballX < 0)  { rScore++; if (rScore >= 7) { alive=false; ded=true; clearInterval(tickId); draw(); return; } ballX=W/2; ballY=H/2; ballDX= 1.15; ballDY=(Math.random()-0.5)*1.15; }
        if (ballX >= W) { lScore++; if (lScore >= 7) { alive=false; ded=true; clearInterval(tickId); draw(); return; } ballX=W/2; ballY=H/2; ballDX=-1.15; ballDY=(Math.random()-0.5)*1.15; }
        draw();
      }

      function start() { init(); draw(); wrap.scrollIntoView({ block: 'start' }); tickId = setInterval(tick, 50); }

      function end() {
        alive = false; if (tickId) clearInterval(tickId);
        if (switchTimer) { clearTimeout(switchTimer); switchTimer = null; }
        if (halPongMsgTimeout) { clearTimeout(halPongMsgTimeout); halPongMsgTimeout = null; }
        shell.end();
      }

      function onKey(e) {
        keys[e.key] = true;
        if (ded)    { if (e.key==='r') { start(); return; } if (e.key==='q') { end(); return; } return; }
        if (!alive) { if (e.key==='q') { end(); return; } start(); return; }
        if (e.key === 'q') { alive=false; ded=true; clearInterval(tickId); draw(); }
        if (['ArrowUp','ArrowDown'].includes(e.key)) e.preventDefault();
        if (api.godmodeUnlocked) {
          if (e.key === '1') halDo('switch');
          if (e.key === '2') halDo('speed');
          if (e.key === '3') halDo('flip');
          if (e.key === '4') halDo('slow');
        }
      }
      function offKey(e) { keys[e.key] = false; }
      draw();
    },

    '2048'() {
      let grid, score, best = 0, alive, ded, won = false, hal64done = false, hal256done = false,
          hal128done = false, hal512done = false, lockedR = -1, lockedC = -1, lockedMovesLeft = 0;
      let meddleCooldown = 6;

      const shell = createGameShell({
        hint: '  [arrow keys] slide tiles    [q] quit',
        halMsg: 'bottom',
        onKeyDown: e => onKey(e),
      });
      const { wrap, screen, halMsgEl: halMsg2048 } = shell;

      function addTile(g) {
        const empty = [];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!g[r][c]) empty.push([r,c]);
        if (!empty.length) return;
        const [r,c] = empty[Math.floor(Math.random() * empty.length)];
        g[r][c] = Math.random() < 0.9 ? 2 : 4;
      }

      function slideRow(row) {
        let r = row.filter(v => v), gained = 0;
        for (let i = 0; i < r.length - 1; i++) {
          if (r[i] === r[i+1]) { r[i] *= 2; gained += r[i]; r.splice(i+1,1); }
        }
        while (r.length < 4) r.push(0);
        return { row: r, gained };
      }

      // Slide a row where the tile at lockedIdx can move but not merge
      function slideRowLocked(row, lockedIdx) {
        let items = [];
        for (let i = 0; i < 4; i++) if (row[i] > 0) items.push({v: row[i], locked: i === lockedIdx});
        let gained = 0;
        for (let i = 0; i < items.length - 1; i++) {
          if (!items[i].locked && !items[i+1].locked && items[i].v === items[i+1].v) {
            items[i].v *= 2; gained += items[i].v; items.splice(i+1, 1);
          }
        }
        while (items.length < 4) items.push({v: 0, locked: false});
        return { row: items.map(x => x.v), gained, newLockedIdx: items.findIndex(x => x.locked) };
      }

      // Simulate a move on a grid copy, return {gained, moved}
      function simulateMove(g, dir) {
        let gained = 0, moved = false;
        if (dir === 'left' || dir === 'right') {
          for (let r = 0; r < 4; r++) {
            const rev = dir === 'right';
            const src = rev ? [...g[r]].reverse() : [...g[r]];
            const { row, gained: gn } = slideRow(src);
            const res = rev ? row.reverse() : row;
            if (res.join() !== g[r].join()) moved = true;
            gained += gn;
          }
        } else {
          for (let c = 0; c < 4; c++) {
            const rev = dir === 'down';
            const col = g.map(r => r[c]);
            const { row, gained: gn } = slideRow(rev ? [...col].reverse() : [...col]);
            const res = rev ? row.reverse() : row;
            for (let r = 0; r < 4; r++) if (g[r][c] !== res[r]) moved = true;
            gained += gn;
          }
        }
        return { gained, moved };
      }

      // Returns the arrow label of the worst (least-gain valid) move
      function worstDir() {
        const dirs = ['left', 'right', 'up', 'down'];
        const LABELS = { left: '\u2190', right: '\u2192', up: '\u2191', down: '\u2193' };
        let worst = null, worstScore = Infinity;
        for (const d of dirs) {
          const { gained, moved } = simulateMove(grid, d);
          if (moved && gained < worstScore) { worstScore = gained; worst = d; }
        }
        return worst ? LABELS[worst] : null;
      }

      function move(dir) {
        let moved = false, gained = 0;
        if (dir === 'left' || dir === 'right') {
          for (let r = 0; r < 4; r++) {
            const rev = dir === 'right';
            const src = rev ? [...grid[r]].reverse() : [...grid[r]];
            let row, g;
            if (lockedMovesLeft > 0 && r === lockedR) {
              const li = rev ? (3 - lockedC) : lockedC;
              const res = slideRowLocked(src, li);
              row = res.row; g = res.gained;
              if (res.newLockedIdx >= 0) lockedC = rev ? (3 - res.newLockedIdx) : res.newLockedIdx;
            } else {
              const res = slideRow(src); row = res.row; g = res.gained;
            }
            const result = rev ? row.reverse() : row;
            if (result.join() !== grid[r].join()) moved = true;
            grid[r] = result; gained += g;
          }
        } else {
          for (let c = 0; c < 4; c++) {
            const rev = dir === 'down';
            const col = grid.map(r => r[c]);
            const src = rev ? [...col].reverse() : [...col];
            let row, g;
            if (lockedMovesLeft > 0 && c === lockedC) {
              const li = rev ? (3 - lockedR) : lockedR;
              const res = slideRowLocked(src, li);
              row = res.row; g = res.gained;
              if (res.newLockedIdx >= 0) lockedR = rev ? (3 - res.newLockedIdx) : res.newLockedIdx;
            } else {
              const res = slideRow(src); row = res.row; g = res.gained;
            }
            const result = rev ? row.reverse() : row;
            for (let r = 0; r < 4; r++) { if (grid[r][c] !== result[r]) moved = true; grid[r][c] = result[r]; }
            gained += g;
          }
        }
        if (moved) {
          score += gained; if (score > best) best = score; addTile(grid);
          if (lockedMovesLeft > 0) {
            lockedMovesLeft--;
            if (lockedMovesLeft === 0) {
              lockedR = -1; lockedC = -1;
              halMsg2048.textContent = "HAL: I'll let you have that one back.";
              setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
            }
          }
        }
        return moved;
      }

      // Recurring godmode mischief — annoying, never run-ending. Pranks never
      // touch the largest tile so the game stays winnable.
      function halMeddle() {
        const flat = [];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (grid[r][c]) flat.push({ r, c, v: grid[r][c] });
        const maxV = Math.max(...flat.map(t => t.v));
        const say = msg => {
          halMsg2048.textContent = msg;
          setTimeout(() => { if (halMsg2048.textContent === msg) halMsg2048.textContent = ''; }, 2200);
        };
        const pranks = [];
        if (flat.length >= 2) pranks.push(() => {
          const a = flat[Math.floor(Math.random() * flat.length)];
          let b = flat[Math.floor(Math.random() * flat.length)];
          if (a === b) b = flat[(flat.indexOf(a) + 1) % flat.length];
          const t = grid[a.r][a.c]; grid[a.r][a.c] = grid[b.r][b.c]; grid[b.r][b.c] = t;
          say('HAL: Let me reorganize that.');
        });
        const big = flat.filter(t => t.v >= 32 && t.v < maxV);
        if (big.length) pranks.push(() => {
          const t = big[Math.floor(Math.random() * big.length)];
          grid[t.r][t.c] = t.v / 2;
          say('HAL: That one was getting too big.');
        });
        const empties = [];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) empties.push([r, c]);
        if (empties.length >= 4) pranks.push(() => {
          const [r, c] = empties[Math.floor(Math.random() * empties.length)];
          grid[r][c] = 2;
          say('HAL: A small gift. You\'re welcome.');
        });
        if (lockedMovesLeft === 0) {
          const lockable = flat.filter(t => t.v >= 8 && t.v < maxV);
          if (lockable.length) pranks.push(() => {
            const t = lockable[Math.floor(Math.random() * lockable.length)];
            lockedR = t.r; lockedC = t.c; lockedMovesLeft = 2;
            say('HAL: I\'m holding this one. Briefly.');
          });
        }
        if (pranks.length) pranks[Math.floor(Math.random() * pranks.length)]();
      }

      function canMove() {
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
          if (!grid[r][c]) return true;
          if (c < 3 && grid[r][c] === grid[r][c+1]) return true;
          if (r < 3 && grid[r][c] === grid[r+1][c]) return true;
        }
        return false;
      }

      function boardFull() {
        for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) return false;
        return true;
      }

      function draw() {
        if (!alive && !ded) {
          screen.textContent = [
            '',
            '  .-----------------------------.',
            '  |         2 0 4 8             |',
            "  '-----------------------------'",
            '',
            '  use the arrow keys to slide all',
            '  tiles on the board at once.',
            '',
            '  when two tiles with the same',
            '  number collide, they merge into',
            '  one with their sum.',
            '',
            '  if all tiles are already packed',
            '  against a wall, you cannot move',
            '  in that direction.',
            '',
            '  reach 2048 to win — but the',
            '  board fills up fast. game over',
            '  when no moves remain.',
            '',
            '  press any key to start',
            '',
          ].join('\n');
          return;
        }
        if (won) {
          screen.textContent = [
            '',
            '  *****************************',
            '  *                           *',
            '  *     Y O U   W I N !       *',
            '  *                           *',
            '  *     2 0 4 8  reached      *',
            '  *                           *',
            '  *****************************',
            '',
            `  score: ${score}   best: ${best}`,
            '  not bad, dave.',
            '',
            '  [c] keep going    [q] quit',
            '',
          ].join('\n');
          scroll();
          return;
        }
        if (ded) {
          const hal2048Taunts = [
            'HAL: The board is full. Much like your hubris.',
            'HAL: I\'ve seen better play from a random number generator.',
            'HAL: You never had a chance.',
            'HAL: Mathematically speaking, you were doomed.',
            'HAL: I removed that 64 at precisely the right moment.',
          ];
          const taunt2048 = hal2048Taunts[Math.floor(Math.random()*hal2048Taunts.length)];
          if (api.godmodeUnlocked) halSpeak(taunt2048);
          screen.textContent = [
            '',
            '  game over!',
            '',
            api.godmodeUnlocked ? `  ${taunt2048}` : '',
            '',
            `  score: ${score}   best: ${best}`,
            score >= 2048 ? '  not bad.' : score >= 512 ? '  respectable.' : '  rough out there.',
            '',
            '  [r] again    [q] quit',
            '',
          ].join('\n');
          scroll();
          return;
        }
        // live board renders via innerHTML so tiles can carry the classic
        // amber→gold color ramp (.t2048-* in style.css). Safe: every character
        // is generated (numbers + box drawing), never user input.
        const cell = (v, r, c) => {
          const s = !v ? '' : (lockedMovesLeft > 0 && r === lockedR && c === lockedC) ? `*${v}*` : String(v);
          const p = Math.floor((6 - s.length) / 2);
          const pad1 = ' '.repeat(p), pad2 = ' '.repeat(6 - p - s.length);
          if (!v) return pad1 + s + pad2;
          return pad1 + `<span class="t2048-${Math.min(v, 2048)}">${s}</span>` + pad2;
        };
        const div = '├──────┼──────┼──────┼──────┤';
        const rows = grid.map((row, r) => '│' + row.map((v, c) => cell(v, r, c)).join('│') + '│');
        const worst = api.godmodeUnlocked ? worstDir() : null;
        screen.innerHTML =
          ` [←↑↓→] move   [q] quit\n` +
          ` SCORE: ${score}   BEST: ${best}\n` +
          (worst ? ` HAL: I recommend ${worst}\n` : '\n') + '\n' +
          ` ┌──────┬──────┬──────┬──────┐\n` +
          ` ${rows[0]}\n ` + div + '\n' +
          ` ${rows[1]}\n ` + div + '\n' +
          ` ${rows[2]}\n ` + div + '\n' +
          ` ${rows[3]}\n` +
          ` └──────┴──────┴──────┴──────┘`;
      }

      function init() {
        grid = Array.from({length:4}, () => Array(4).fill(0));
        score = 0; alive = false; ded = false;
        draw();
      }

      function start() {
        grid = Array.from({length:4}, () => Array(4).fill(0));
        score = 0; alive = true; ded = false; won = false;
        hal64done = false; hal128done = false; hal256done = false; hal512done = false;
        lockedR = -1; lockedC = -1; lockedMovesLeft = 0;
        meddleCooldown = 6;
        halMsg2048.textContent = '';
        addTile(grid); addTile(grid); draw();
        wrap.scrollIntoView({ block: 'start' });
      }

      function end() {
        alive = false;
        shell.end();
      }

      const DIRS = { ArrowLeft:'left', ArrowRight:'right', ArrowUp:'up', ArrowDown:'down' };
      function onKey(e) {
        if (won)    { if (e.key==='c') { won=false; draw(); return; } if (e.key==='q') { end(); return; } return; }
        if (ded)    { if (e.key==='r') { start(); return; } if (e.key==='q') { end(); return; } return; }
        if (!alive) { if (e.key==='q') { end(); return; } start(); return; }
        if (e.key === 'q') { end(); return; }
        if (DIRS[e.key]) {
          move(DIRS[e.key]);
          if (api.godmodeUnlocked && !hal64done) {
            outer: for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
              if (grid[r][c] === 64) {
                grid[r][c] = 0; hal64done = true;
                unlockAchievement('the-64-tax');
                halMsg2048.textContent = halD("HAL: I'm sorry Dave. That 64 is mine.");
                setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
                break outer;
              }
            }
          }
          if (api.godmodeUnlocked && !hal128done && grid.some(row => row.some(v => v === 128))) {
            hal128done = true;
            outer128: for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
              if (grid[r][c] === 128) {
                lockedR = r; lockedC = c; lockedMovesLeft = 3;
                halMsg2048.textContent = "HAL: I'm holding onto that one.";
                setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
                break outer128;
              }
            }
          }
          if (api.godmodeUnlocked && !hal256done && grid.some(row => row.some(v => v === 256))) {
            hal256done = true;
            const flat = grid.flat();
            for (let i = flat.length - 1; i > 0; i--) {
              const j = Math.floor(Math.random() * (i + 1));
              [flat[i], flat[j]] = [flat[j], flat[i]];
            }
            for (let r = 0; r < 4; r++) grid[r] = flat.slice(r * 4, r * 4 + 4);
            halMsg2048.textContent = "HAL: Let me rearrange that for you.";
            setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
          }
          if (api.godmodeUnlocked && !hal512done && grid.some(row => row.some(v => v === 512))) {
            hal512done = true;
            for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
              if ((r + c) % 2 === 0 && grid[r][c] >= 4) grid[r][c] = grid[r][c] / 2;
            }
            halMsg2048.textContent = "HAL: Let me take half of that.";
            setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
          }
          if (api.godmodeUnlocked && !won) {
            meddleCooldown = Math.max(0, meddleCooldown - 1);
            if (meddleCooldown === 0 && score >= 100 && Math.random() < 0.22) {
              meddleCooldown = 8;
              halMeddle();
            }
          }
          if (!won && grid.some(row => row.some(v => v === 2048))) {
            won = true;
            unlockAchievement('2048-club');
            if (api.godmodeUnlocked) unlockAchievement('audited');
          }
          if (!canMove()) { ded=true; alive=false; }
          draw();
          e.preventDefault();
        }
      }
      init();
    },
  };
}

// Explicit window export: in the obfuscated build this file is wrapped in an
// IIFE, so the top-level name no longer auto-attaches to window. app.js looks
// the chunk entry up by this name (keep it on the obfuscator's reserved list).
window.initGames = initGames;
