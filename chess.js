// Chess — the terminal chess game (chess.js + Stockfish, loaded from CDNs at
// runtime), lazily loaded the first time `chess` is run (see launchChess() in
// app.js; same pattern as stickfighter.js / games.js / sans.js). Loaded as a
// CLASSIC script, it exposes one global, initChess(api), which returns the
// { chess } command handler. Everything it needs from app.js arrives through
// the explicit `api` bridge (app.js's chessBridge(): output helpers + DOM
// elements, live halMode / godmodeUnlocked / soundEnabled / playerName
// getters, and awaitingInput / silentInput / activeMusic accessors it writes
// back through — typed moves flow app.js's key handler → awaitingInput, so the
// callback must live on app.js's flag) — this file references NOTHING from
// app.js by free global name, so it can be bundled & obfuscated as an
// independent lazy chunk. The CDN-provided engine global is deliberately read
// as window.Chess. The only contract is the initChess name + the api key
// names (keep both on the obfuscator's reserved list).
// NOTE: the moved code is kept at its original app.js indentation on purpose.

function initChess(api) {
  // Dependency bridge from app.js (see chessBridge() there). Stable refs are
  // destructured (call sites unchanged); runtime-varying state is read/written
  // live as api.<name> (api.awaitingInput = …, api.activeMusic = …, etc.).
  const { appendNode, blank, line, halSpeak, halD, unlockAchievement,
          inputRow, cmd } = api;

  // one game at a time: typing `chess` again while a game is loading/running
  // (e.g. twice on a slow CDN, or via both callbacks of a double chunk-load)
  // must not stack a second board/worker/music over the first
  let chessRunning = false;

  return {
    chess() {
      if (chessRunning) return;
      chessRunning = true;
      const isHAL    = api.halMode || api.godmodeUnlocked;
      const SKILL    = api.godmodeUnlocked ? 20 : api.halMode ? 12 : 5;
      const THINK_MS = api.godmodeUnlocked ? 1500 : api.halMode ? 1000 : 600;

      const wrap     = document.createElement('div');
      const halMsgEl = document.createElement('div');
      const boardRow = document.createElement('div');
      const boardEl  = document.createElement('pre');
      const histEl   = document.createElement('pre');
      const statusEl = document.createElement('div');
      const hintEl   = document.createElement('span');
      halMsgEl.className = 'line'; halMsgEl.style.minHeight = '1.55em';
      boardEl.className  = 'ascii';
      boardEl.style.cssText = 'font-size:13px;line-height:1.5;color:var(--green);margin:0';
      histEl.className   = 'ascii';
      histEl.style.cssText = 'font-size:13px;line-height:1.5;color:var(--green);margin:0;padding-left:2ch;min-width:22ch;vertical-align:top';
      boardRow.style.cssText = 'display:flex;align-items:flex-start';
      boardRow.appendChild(boardEl); boardRow.appendChild(histEl);
      statusEl.className = 'line';
      hintEl.className   = 'line dim';
      hintEl.textContent = '  type move (e.g. e4  Nf3  e2e4  O-O)    [q] quit    [r] new game';
      wrap.appendChild(halMsgEl); wrap.appendChild(boardRow);
      wrap.appendChild(statusEl); wrap.appendChild(hintEl);
      appendNode(wrap); blank();
      setTimeout(() => wrap.scrollIntoView({ block: 'start' }), 0);
      api.silentInput = true;

      let game = null, sfWorker = null, waitingSF = false, gameOver = false, moveLog = [];
      let discardMoves = 0;   // engine replies owed to an abandoned game (restart while thinking)
      let loadCancelled = false;

      const chessMusicSrc = api.godmodeUnlocked ? 'assets/audio/ais_gambit.mp3' : 'assets/audio/checkmate_in_the_void.mp3';
      const chessMusic = new Audio(chessMusicSrc);
      chessMusic.preload = 'none';   // skip buffering when sound is off
      chessMusic.loop = false;
      chessMusic.volume = 0.5;
      api.activeMusic = chessMusic;
      if (api.soundEnabled) chessMusic.play().catch(() => {});

      function setMsg(msg, dur) {
        halMsgEl.textContent = msg;
        if (dur > 0) setTimeout(() => { if (halMsgEl.textContent === msg) halMsgEl.textContent = ''; }, dur);
        if (isHAL && msg) halSpeak(msg.replace(/^HAL:\s*/i, ''));
      }

      function drawBoard() {
        if (!game) return;
        const b = game.board();
        const rows = ['     a b c d e f g h', '   ┌─────────────────┐'];
        for (let r = 0; r < 8; r++) {
          const rank = 8 - r;
          let row = ` ${rank} │`;
          for (let c = 0; c < 8; c++) {
            const sq = b[r][c];
            row += sq ? ' ' + (sq.color === 'w' ? sq.type.toUpperCase() : sq.type) : ' ·';
          }
          row += ' │';
          rows.push(row);
        }
        rows.push('   └─────────────────┘');
        rows.push('     a b c d e f g h');
        boardEl.textContent = rows.join('\n');
      }

      function setStatus(msg, cls) {
        statusEl.className = 'line' + (cls ? ' ' + cls : '');
        statusEl.textContent = msg;
      }

      function drawHistory() {
        const start = Math.max(0, moveLog.length - 20);
        const visible = moveLog.slice(start);
        const lines = ['  Move History     ', '  ───────────────  '];
        for (let i = 0; i < visible.length; i += 2) {
          const num = Math.floor((start + i) / 2) + 1;
          const w = visible[i] || '';
          const b = visible[i + 1] || '';
          lines.push(`  ${String(num).padStart(2)}.  ${w.padEnd(6)}  ${b}`);
        }
        histEl.textContent = lines.join('\n');
      }

      function endGame() {
        chessRunning = false;
        api.awaitingInput = null;
        api.silentInput = false;
        if (sfWorker) { sfWorker.terminate(); sfWorker = null; }
        chessMusic.pause();
        chessMusic.currentTime = 0;
        if (api.activeMusic === chessMusic) api.activeMusic = null;
        inputRow.style.display = 'flex';
        setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
      }

      // the engine died mid-game (bad CDN body, worker crash): don't leave the
      // player stuck at "thinking..." forever — surface it and offer the exit
      function engineFailed() {
        if (sfWorker) { sfWorker.terminate(); sfWorker = null; }
        waitingSF = false; gameOver = true;
        setStatus('  The chess engine crashed. [q] quit', 'err');
        api.awaitingInput = inp => { if (inp.toLowerCase() === 'q') endGame(); };
      }

      function checkOver() {
        if (!game.game_over()) return false;
        gameOver = true; api.awaitingInput = null;
        drawBoard();
        if (game.in_checkmate()) {
          const winner = game.turn() === 'b' ? 'White' : 'Black';
          if (winner === 'White') unlockAchievement('grandmaster');
          if (winner === 'Black' && api.godmodeUnlocked) unlockAchievement('outclassed');
          if (isHAL) {
            const halWins  = ["Checkmate. I saw this coming seventeen moves ago.", "This game was over before it began.", "Your king has nowhere to go, Dave."];
            const halLoses = ["I'll allow it. This time.", "A fortunate outcome for you. Enjoy it.", "Impressive. I may have underestimated you."];
            const t = winner === 'Black' ? halD(halWins[Math.floor(Math.random()*halWins.length)]) : halD(halLoses[Math.floor(Math.random()*halLoses.length)]);
            setMsg('HAL: ' + t);
            setStatus('');
          } else {
            setStatus(`  Checkmate — ${winner} wins!`, 'bold');
          }
        } else if (game.in_stalemate()) {
          setStatus('  Stalemate — draw.');
        } else {
          setStatus('  Draw.');
        }
        blank();
        line('  [r] new game    [q] quit', 'dim');
        blank();
        api.awaitingInput = inp => {
          if (inp.toLowerCase() === 'r') { api.awaitingInput = null; blank(); startChess(); }
          else if (inp.toLowerCase() === 'q') { endGame(); }
          // anything else: keep waiting — submitCommand leaves awaitingInput set,
          // so no reassignment is needed (arguments.callee in an arrow resolved to
          // the enclosing checkOver and re-ran the whole endgame block)
        };
        return true;
      }

      function promptMove() {
        const turn = game.turn() === 'w' ? 'White' : 'Black';
        const chk  = game.in_check() ? ' — CHECK' : '';
        setStatus(isHAL
          ? `  Your move, ${api.playerName} — HAL is watching (${turn}${chk}):`
          : `  Your move (${turn}${chk}):`);
        api.awaitingInput = handleMove;
      }

      function handleMove(inp) {
        const k = inp.toLowerCase().trim();
        if (k === 'q') { endGame(); return; }
        if (k === 'r') { api.awaitingInput = null; blank(); startChess(); return; }
        if (gameOver || waitingSF) { api.awaitingInput = handleMove; return; }

        let mv = null;
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(inp)) {
          mv = game.move({ from: inp.slice(0,2).toLowerCase(), to: inp.slice(2,4).toLowerCase(), promotion: inp[4] ? inp[4].toLowerCase() : 'q' });
        }
        if (!mv) {
          // be forgiving about notation: o-o / 0-0 castling, lowercase SAN (nf3),
          // then chess.js's own sloppy parser as the last resort
          let san = inp.trim();
          if (/^(o|0)-(o|0)(-(o|0))?[+#]?$/i.test(san)) san = san.length > 4 ? 'O-O-O' : 'O-O';
          else if (/^[kqrbn][a-h1-8x]/i.test(san)) san = san[0].toUpperCase() + san.slice(1);
          mv = game.move(san) || game.move(san, { sloppy: true });
        }

        if (!mv) {
          if (game.moves().length === 0) { checkOver(); return; }
          const msg = game.in_check()
            ? '  In check — only moves that escape check are legal. Try again:'
            : '  Illegal move — try again:';
          setStatus(msg, 'err');
          api.awaitingInput = handleMove;
          return;
        }

        moveLog.push(mv.san);
        drawBoard(); drawHistory();
        if (checkOver()) return;

        if (isHAL) {
          const quips = [
            `I've calculated all possible variations, ${api.playerName}.`,
            `That move was predictable.`,
            `I can see the entire game from here.`,
            `An interesting choice. Not optimal.`,
            `You're making this too easy.`,
            `I've been studying this position.`,
          ];
          setMsg('HAL: ' + halD(quips[Math.floor(Math.random()*quips.length)]), 3000);
        }

        waitingSF = true;
        setStatus('  ' + (isHAL ? 'HAL' : 'CPU') + ' is thinking...');
        sfWorker.postMessage('position fen ' + game.fen());
        sfWorker.postMessage('go movetime ' + THINK_MS);
      }

      function onSFMsg(e) {
        const msg = typeof e === 'string' ? e : (e.data || '');
        if (!msg.startsWith('bestmove')) return;
        if (discardMoves > 0) { discardMoves--; return; }   // reply belongs to a game we restarted away from
        const bm = msg.split(' ')[1];
        if (!bm || bm === '(none)') { waitingSF = false; checkOver(); return; }
        const mv = game.move({ from: bm.slice(0,2), to: bm.slice(2,4), promotion: bm[4] || 'q' });
        waitingSF = false;
        if (mv) moveLog.push(mv.san);
        drawBoard(); drawHistory();
        if (mv && isHAL) {
          const quips2 = ["My move. Observe.", "As expected.", "Inevitable.", "Watch carefully.", "I'm afraid you can't win."];
          setMsg('HAL: ' + quips2[Math.floor(Math.random()*quips2.length)], 2500);
        }
        if (!checkOver()) promptMove();
      }

      function startChess() {
        if (waitingSF && sfWorker) {
          // restarting while the engine thinks: its in-flight reply belongs to the
          // old game — flush it fast and mark it to be dropped on arrival
          discardMoves++;
          sfWorker.postMessage('stop');
        }
        game = new window.Chess();
        gameOver = false; waitingSF = false; moveLog = [];
        drawBoard(); drawHistory();
        if (isHAL) setMsg(halD(`HAL: I have something special planned for you, Dave.`), 3500);
        promptMove();
        wrap.scrollIntoView({ block: 'start' });
      }

      function loadScript(src) {
        return new Promise((res, rej) => {
          if (window.Chess) { res(); return; }
          const s = document.createElement('script');
          s.src = src; s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }

      boardEl.textContent = '\n  Loading chess engine...\n';
      // claim typed input for the whole load window: without this a second
      // `chess` (or a `hal` setup flow) could clobber awaitingInput mid-load
      api.awaitingInput = inp => { if (inp.toLowerCase() === 'q') { loadCancelled = true; endGame(); } };
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js')
        .then(() => fetch('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'))
        .then(r => { if (!r.ok) throw new Error('stockfish fetch ' + r.status); return r.text(); })
        .then(code => {
          if (loadCancelled) return;
          const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
          sfWorker = new Worker(url);
          URL.revokeObjectURL(url);
          sfWorker.onmessage = onSFMsg;
          sfWorker.onerror = () => engineFailed();   // a dead worker must never leave "thinking..." forever
          sfWorker.postMessage('uci');
          sfWorker.postMessage('setoption name Skill Level value ' + SKILL);
          sfWorker.postMessage('isready');
          startChess();
        })
        .catch(() => {
          if (loadCancelled) return;
          boardEl.textContent = '';
          setStatus('  Failed to load chess engine. Check your connection. [q] quit', 'err');
          blank();
          // endGame (not a bare input restore): the music started before the load,
          // and activeMusic must be released or the sound toggle resurrects it
          api.awaitingInput = inp => { if (inp.toLowerCase() === 'q') endGame(); };
        });
    },
  };
}

// Explicit window export: in the obfuscated build this file is wrapped in an
// IIFE, so the top-level name no longer auto-attaches to window. app.js looks
// the chunk entry up by this name (keep it on the obfuscator's reserved list).
window.initChess = initChess;
