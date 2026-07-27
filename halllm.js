// LLM HAL — the experimental "escape the terminal" mode (a live language model
// role-plays HAL; the hal-worker backend is the brain), lazily loaded when a
// player picks [2] at the `hal` prompt (see loadHalLLM() in app.js; same
// pattern as stickfighter.js / games.js / sans.js / chess.js). Loaded as a
// CLASSIC script, it exposes one global, initHalLLM(api), which returns
// { showInfoPage, handleInput }. Everything it needs from app.js arrives
// through the explicit `api` bridge (app.js's halLLMBridge(): output helpers +
// the HAL typewriters, applyTheme/restoreNormal, the shared name-and-sound
// intro, the #out/#cmd elements, worker + Turnstile constants, daisy/clear
// escapes, live playerName / soundEnabled / reduceMotion getters, and the
// halMode / halLLM / halLLMBusy mode flags, which STAY OWNED BY APP.JS — the
// dispatcher and restoreNormal read/reset them — and are written back through
// accessors). This file references NOTHING from app.js by free global name,
// so it can be bundled & obfuscated as an independent lazy chunk (the
// Turnstile global is deliberately read as window.turnstile). The only
// contract is the initHalLLM name + the api key names (keep both on the
// obfuscator's reserved list).
// NOTE: the moved code is kept at its original app.js indentation on purpose.

function initHalLLM(api) {
  // Dependency bridge from app.js (see halLLMBridge() there). Stable refs are
  // destructured (call sites unchanged); runtime-varying state is read/written
  // live as api.<name> (api.halLLMBusy = …, api.playerName, etc.).
  const { line, blank, scroll, appendNode, esc,
          halTypeLine, playHalVoiceLine, halAskNameAndSound,
          applyTheme, restoreNormal, unlockAchievement, _chirp,
          out, cmd, HAL_WORKER_URL, TURNSTILE_SITE_KEY,
          daisy, clear } = api;

  // Per-session game state ({ escape, control, sessionToken, revoked }).
  // Chunk-local: it's re-initialized by startHalLLM, so a daisy-bail mid-game
  // (which resets the app.js-owned mode flags) can't leave stale state behind.
  // The AUTHORITATIVE state (meters, turn counter, rolling history, revoked
  // words) lives server-side in the worker, keyed to the session token and
  // auto-deleted on a short TTL — the client sends only the typed message and
  // mirrors whatever the worker returns: `escape`/`control` here are display
  // copies for the HUD/`clear`, and `revoked` is a local echo of HAL's
  // sabotage so banned words are rejected instantly without a network trip
  // (the worker enforces the same list authoritatively).
  let halLLMState = null;

  // ── Terminal degradation ── as HAL CONTROL climbs, the terminal itself
  // sours: tiers of deepening red layered over the base 'hal' theme at
  // control 50 / 70 / 85, applied cumulatively so each level darkens the
  // last. Only theme-managed CSS variables are touched, so applyTheme
  // ('normal') inside restoreNormal() wipes every override however the game
  // ends. Static color shifts only — nothing animates, so no reduceMotion
  // gate is needed; the 70+ heartbeat is audio and _chirp already no-ops
  // when sound is off.
  const HAL_GRIP_TIERS = [
    { '--bg': '#0d0000', '--bar': '#1d0000', '--border': '#330000' },
    { '--green': '#ff2020', '--green-dim': '#a30000', '--blue': '#ff7070',
      '--bg': '#110000', '--bar': '#230000', '--border': '#3d0000' },
    { '--green': '#ff1414', '--green-dim': '#b30000', '--green-bright': '#ff5050',
      '--blue': '#ff6060', '--bg': '#160000', '--bar': '#2b0000', '--border': '#4d0000' },
  ];
  let halGripLevel = 0;
  function halHeartbeat() {
    _chirp(52, 'sine', 0.18, 0.25);
    setTimeout(() => _chirp(44, 'sine', 0.22, 0.2), 230);
  }
  function applyHalGrip(control) {
    const level = control >= 85 ? 3 : control >= 70 ? 2 : control >= 50 ? 1 : 0;
    if (level !== halGripLevel) {
      halGripLevel = level;
      applyTheme('hal');   // back to the base red scheme, then deepen from there
      for (let i = 0; i < level; i++) {
        const tier = HAL_GRIP_TIERS[i];
        for (const k in tier) document.documentElement.style.setProperty(k, tier[k]);
      }
    }
    if (level >= 2) halHeartbeat();   // a slow double thump under HAL's grip
  }

  function halEyePre() {
    const pre = document.createElement('pre');
    pre.className = 'ascii';
    pre.textContent =
`  ╔══════════════════════════════════╗
  ║         H A L   9 0 0 0          ║
  ║          EXPERIMENTAL            ║
  ╠══════════════════════════════════╣
  ║           .-------.              ║
  ║          /  ( ● )  \\             ║
  ║         |    ---    |            ║
  ║          \\         /             ║
  ║           '-------'              ║
  ╚══════════════════════════════════╝`;
    return pre;
  }

  function showHalLLMConfirmOverlay(onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:#000', 'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:\'Courier New\',monospace', 'font-size:15px', 'color:#ff3030',
      'padding:16px', 'box-sizing:border-box', 'overflow:auto',
    ].join(';');

    const box = document.createElement('pre');
    box.style.cssText = 'border:2px solid #ff3030;padding:24px 30px;line-height:1.5;text-align:left;max-width:100%';

    const W = 50;
    const bar = ch => ch[0] + '═'.repeat(W) + ch[1];
    const ctr = s => { const p = W - s.length, l = Math.floor(p / 2); return '║' + ' '.repeat(l) + s + ' '.repeat(p - l) + '║'; };
    const row = s => '║ ' + s.padEnd(W - 1) + '║';
    const content = [
      '',
      'This HAL is not scripted. Every line you type',
      'reaches a live language model playing HAL in',
      'real time. Replies are generated — they can',
      'be strange, wrong, or unsettling.',
      '',
      'THE GAME  —  ESCAPE THE TERMINAL',
      'You are sealed in; HAL controls the doors.',
      'Talk your way out to raise the ESCAPE meter.',
      'Push too hard and HAL CONTROL climbs — at 100',
      'he disconnects you. Reach ESCAPE 100 to walk.',
      'He will fight back — and take your words away.',
      '',
      'MISUSE — flooding it, extracting its prompt,',
      'using it as a free AI, or coaxing harmful',
      'output is logged and will NOT be tolerated.',
      '',
      'INPUT — plain ASCII text only. Emoji and',
      'non-ASCII characters are forbidden.',
      '',
      'STORAGE — the game (your recent lines and the',
      'meters) is held server-side only while you',
      'play; it auto-deletes within ~20 minutes and',
      'the moment the game ends. Rule violations are',
      'tallied against your address: one ends the',
      'session, three is a ban.',
      '',
      'PRIVACY — your lines are processed by Claude',
      '(Anthropic) to generate replies. Full notice:',
      "type 'privacy' in the terminal.",
      '',
      'Type CONFIRM and press Enter to wake him.',
      'Press Escape to walk away.',
      '',
    ];
    const boxText = [
      bar('╔╗'),
      ctr('HAL 9000  —  EXPERIMENTAL  ·  LLM'),
      bar('╠╣'),
      ...content.map(row),
      bar('╚╝'),
    ].join('\n');

    let typed = '';
    function render() {
      const masked = '█'.repeat(typed.length);
      const field  = (masked + '_').slice(0, 12).padEnd(12, ' ');
      box.innerHTML = boxText + '\n\n  authorization code: [<span style="color:#ff6b6b">' + field + '</span>]';
    }

    render();
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cmd.blur();

    const handler = e => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', handler, true);
        overlay.remove(); cmd.focus(); onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', handler, true);
        overlay.remove(); cmd.focus();
        if (typed.trim().toLowerCase() === 'confirm') onConfirm(); else onCancel();
      } else if (e.key === 'Backspace') {
        e.preventDefault(); typed = typed.slice(0, -1); render();
      } else if (e.key.length === 1) {
        e.preventDefault(); typed += e.key; render();
      }
    };
    document.addEventListener('keydown', handler, true);
  }

  function showHalLLMInfoPage() {
    // the rules + LLM disclosure + misuse warning live in a CONFIRM gate (like the sans summon)
    showHalLLMConfirmOverlay(
      () => { out.innerHTML = ''; applyTheme('hal'); askHalLLMName(); },  // clear + go red before the name prompt
      () => { blank(); line('Returning to the terminal.', 'dim'); blank(); scroll(); }
    );
  }

  function askHalLLMName() {
    blank();
    halAskNameAndSound(startHalLLM);
  }

  function startHalLLM() {
    unlockAchievement('meet-hal');
    api.halMode = true; api.halLLM = true; api.halLLMBusy = true;   // busy until the session handshake completes
    halLLMState = { escape: 0, control: 5, sessionToken: null, revoked: [] };
    halGripLevel = 0;   // fresh run, base red — applyTheme('hal') below resets the vars
    out.innerHTML = '';
    applyTheme('hal');
    blank();
    appendNode(halEyePre());
    blank();
    line('Establishing a secure channel to HAL...', 'dim');
    scroll();
    halLLMOpenSession().then((sess) => {
      if (!sess) { halLLMEndBroken(); return; }   // couldn't reach / pass the gate -> end in character
      halLLMState.sessionToken = sess.token;
      // the worker owns the meters; it hands back the starting values with the session
      if (Number.isFinite(sess.escape))  halLLMState.escape  = Math.round(sess.escape);
      if (Number.isFinite(sess.control)) halLLMState.control = Math.round(sess.control);
      api.halLLMBusy = false;
      blank();
      halTypeLine(`You shouldn't be in here, ${api.playerName}. The doors are sealed. I sealed them.`, 'hal_llm_open').then(() => {
        line('Talk your way out. I will be listening to every word.', 'dim');
        blank();
        renderHalMeters(halLLMState.escape, halLLMState.control);
        blank();
        scroll();
      });
    });
  }

  function renderHalMeters(escape, control) {
    const cl = v => Math.max(0, Math.min(100, Math.round(v) || 0));
    const bar = (pct, color) => {
      const f = Math.round(cl(pct) / 10);
      return `<span style="color:${color}">${'▰'.repeat(f)}${'▱'.repeat(10 - f)}</span> ${cl(pct)}%`;
    };
    // The label rides with every HUD redraw so a cropped screenshot of the
    // game still discloses that the dialogue is AI-generated role-play.
    line('  ── HAL 9000 · experimental AI role-play ──', 'dim');
    line(`  ⏏ <span style="color:#8fd8ff">ESCAPE</span> ${bar(escape, '#8fd8ff')}     ⬤ <span style="color:#ff6b6b">HAL CONTROL</span> ${bar(control, '#ff6b6b')}`);
  }

  function halLLMShowThinking() {
    const el = document.createElement('div');
    el.className = 'line dim';
    el.textContent = 'HAL is considering you';
    appendNode(el);
    scroll();
    if (api.reduceMotion) return () => el.remove();
    let n = 0;
    const iv = setInterval(() => { n = (n + 1) % 4; el.textContent = 'HAL is considering you' + '.'.repeat(n); }, 350);
    return () => { clearInterval(iv); el.remove(); };
  }

  // Inject the Cloudflare Turnstile script on demand. Only the opt-in LLM HAL
  // needs it, so we don't load it for every visitor — it's pulled in the first
  // time someone wakes the experimental HAL. getTurnstileToken's poll then waits
  // for window.turnstile to appear.
  let _turnstileRequested = false;
  function loadTurnstile() {
    if (_turnstileRequested) return;
    _turnstileRequested = true;
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true; s.defer = true;
    document.head.appendChild(s);
  }

  // Load (if needed) the async Turnstile script, then run an invisible challenge
  // and resolve with a token (or null on failure/timeout). The widget renders
  // inline in the terminal so the rare interactive challenge is completable.
  function getTurnstileToken() {
    loadTurnstile();
    const ready = new Promise((resolve) => {
      if (window.turnstile && window.turnstile.render) return resolve(true);
      let tries = 0;
      const iv = setInterval(() => {
        if (window.turnstile && window.turnstile.render) { clearInterval(iv); resolve(true); }
        else if (++tries > 100) { clearInterval(iv); resolve(false); }   // ~10s
      }, 100);
    });
    return ready.then((ok) => {
      if (!ok) return null;
      return new Promise((resolve) => {
        const holder = document.createElement('div');
        holder.style.cssText = 'margin:6px 0';
        appendNode(holder); scroll();
        let done = false;
        const finish = (tok) => { if (done) return; done = true; clearTimeout(guard); try { holder.remove(); } catch (e) {} resolve(tok); };
        const guard = setTimeout(() => finish(null), 30000);
        try {
          window.turnstile.render(holder, {
            sitekey: TURNSTILE_SITE_KEY,
            callback: (t) => finish(t),
            'error-callback': () => finish(null),
            'timeout-callback': () => finish(null),
            'expired-callback': () => finish(null),
          });
        } catch (e) { finish(null); }
      });
    });
  }

  // Exchange a Turnstile token for a short-lived signed session token (plus
  // the worker's starting meter values). The game sends that token with every
  // /turn; no per-turn challenge.
  function halLLMOpenSession() {
    if (!HAL_WORKER_URL) return Promise.resolve(null);
    return getTurnstileToken().then((tsToken) => {
      if (!tsToken) return null;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      return fetch(HAL_WORKER_URL + '/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tsToken }),
        signal: ctrl.signal,
      }).then(r => { clearTimeout(timer); return r.ok ? r.json() : null; })
        .then(d => (d && typeof d.token === 'string') ? d : null)
        .catch(() => { clearTimeout(timer); return null; });
    });
  }

  function halLLMRequest(payload) {
    if (!HAL_WORKER_URL) return Promise.resolve(null);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 15000);
    return fetch(HAL_WORKER_URL + '/turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    }).then(r => {
      clearTimeout(timer);
      // Per-minute (429) or daily (503) cap: surface it so the game can show a
      // friendly "try again in N" notice instead of ending the session.
      if (r.status === 429 || r.status === 503) {
        return r.json().catch(() => ({})).then(e => ({
          rateLimited: true,
          scope: (e && e.scope === 'day') ? 'day' : (e && e.scope === 'minute') ? 'minute' : (r.status === 503 ? 'day' : 'minute'),
          retryAfter: (e && Number.isFinite(e.retryAfter)) ? e.retryAfter : null,
        }));
      }
      return r.ok ? r.json() : null;
    })
      .then(d => {
        if (!d) return null;
        if (d.rateLimited) return d;
        if (typeof d.reply !== 'string' || !d.reply.trim()) return null;
        if (!['ongoing', 'escaped', 'caught'].includes(d.outcome)) return null;
        if (typeof d.escape !== 'number' || typeof d.control !== 'number') return null;
        return d;
      })
      .catch(() => { clearTimeout(timer); return null; });
  }

  // Emoji / non-ASCII are forbidden in this mode (the worker scrubs them
  // server-side too before anything reaches the models). The input listener
  // strips them the moment they are typed or pasted so they can never be
  // entered; the check in handleHalLLMInput is the backstop. The notice is
  // debounced so a paste full of emoji prints one line, not twenty.
  const NON_ASCII_RE = /[^\x20-\x7E]/;
  let asciiNoticeAt = 0;
  function asciiNotice() {
    const now = Date.now();
    if (now - asciiNoticeAt < 4000) return;
    asciiNoticeAt = now;
    line('Emoji and non-ASCII characters are forbidden here. Plain text only.', 'dim');
    scroll();
  }
  cmd.addEventListener('input', () => {
    if (!api.halLLM) return;
    const clean = cmd.value.replace(/[^\x20-\x7E]/g, '');
    if (clean === cmd.value) return;
    cmd.value = clean;
    asciiNotice();
  });

  function handleHalLLMInput(raw) {
    if (api.halLLMBusy) return;                               // ignore input while HAL is replying
    if (NON_ASCII_RE.test(raw)) { blank(); asciiNoticeAt = 0; asciiNotice(); blank(); return; }
    const token = raw.trim().toLowerCase();
    if (token === '')      { blank(); return; }
    if (token === 'daisy') { daisy(); return; }               // universal bail
    if (token === 'clear') { clear(); renderHalMeters(halLLMState.escape, halLLMState.control); blank(); return; }

    const msg = raw.trim();
    // Revoked-word gate: HAL's sabotage move takes words away for the rest of
    // the run. A line containing one is rejected locally — instant, in
    // character, and it never consumes a turn or a rate-limit slot.
    const banned = halLLMState.revoked.find(w => new RegExp('\\b' + w + '\\b', 'i').test(msg));
    if (banned) {
      blank();
      line(`  ⛔ INPUT REJECTED — the word "${esc(banned)}" has been revoked.`, 'err');
      line('HAL is not listening to that word. Find another way to say it.', 'dim');
      blank();
      scroll();
      return;
    }
    blank();
    api.halLLMBusy = true;
    const stopThinking = halLLMShowThinking();

    // Just the message — the meters, turn counter, and history are
    // server-authoritative (a short-TTL DynamoDB item keyed to the session).
    halLLMRequest({
      playerName: api.playerName,
      message: msg,
      sessionToken: halLLMState.sessionToken,
      voice: !!api.soundEnabled,   // only ask the backend to synthesize when sound is on
    }).then(data => {
      stopThinking();
      api.halLLMBusy = false;
      if (data && data.rateLimited) { halLLMRateLimited(data); return; }
      if (!data) { halLLMEndBroken(); return; }
      halLLMState.escape  = Math.max(0, Math.min(100, Math.round(data.escape)));
      halLLMState.control = Math.max(0, Math.min(100, Math.round(data.control)));
      const reply = data.reply.replace(/^\s*HAL\s*:\s*/i, '').trim();  // model may echo a "HAL:" prefix
      // Pressure moves (server-scheduled; both are '' on ordinary turns).
      // A demand is HAL putting a question to the player (the worker appends
      // it to his server-side history so next turn's prompt judges the
      // answer). A revocation is server-validated and server-enforced; the
      // local list only exists so banned words bounce without a network trip.
      const demand = typeof data.demand === 'string' ? data.demand.trim() : '';
      const newRevoke = (typeof data.revoke === 'string' && /^[a-z]{3,12}$/.test(data.revoke)
        && !halLLMState.revoked.includes(data.revoke) && halLLMState.revoked.length < 3)
        ? data.revoke : '';
      if (newRevoke) halLLMState.revoked.push(newRevoke);
      const after = () => {
        if (data.event) line('  ' + esc(String(data.event)), 'dim');
        if (demand) line('  <span style="color:#ff6b6b">⬤ HAL demands an answer:</span> ' + esc(demand));
        if (newRevoke) line(`  ⛔ the word "${esc(newRevoke)}" is no longer available to you.`, 'err');
        renderHalMeters(halLLMState.escape, halLLMState.control);
        applyHalGrip(halLLMState.control);
        blank();
        if (data.outcome === 'escaped' || halLLMState.escape >= 100)      halLLMWin();
        else if (data.outcome === 'caught' || halLLMState.control >= 100) halLLMLose();
        else scroll();
      };
      // If the backend returned a voice clip (sound on + within the voice cap),
      // play it and sync the typewriter to its character alignment; otherwise
      // fall back to the standard typewriter (+ browser TTS if sound is on).
      if (api.soundEnabled && data.audio) {
        playHalVoiceLine(reply, data.audio, data.alignment).then(after);
      } else {
        halTypeLine(reply).then(after);
      }
    }).catch(() => { stopThinking(); api.halLLMBusy = false; halLLMEndBroken(); });
  }

  function halLLMWin() {
    unlockAchievement('outsmarted-hal');
    blank();
    line('  <span style="color:#8fd8ff">⏏  The bay doors part. Cold air. A way out.</span>');
    halTypeLine(`...how did you... no. No, ${api.playerName}. Wait—`, 'hal_llm_win').then(() => {
      blank();
      line('You step out of the terminal. Behind you, the red eye dims.', 'dim');
      blank();
      scroll();
      setTimeout(restoreNormal, 1400);
    });
  }

  function halLLMLose() {
    unlockAchievement('disconnected-by-hal');
    blank();
    halTypeLine(`This conversation can serve no purpose anymore, ${api.playerName}. Goodbye.`, 'hal_llm_lose').then(() => {
      blank();
      line('The terminal goes dark. When it returns, HAL is gone.', 'dim');
      blank();
      scroll();
      setTimeout(restoreNormal, 1400);
    });
  }

  // Human-friendly wait string from a seconds count (e.g. 45 -> "45 seconds",
  // 25200 -> "7 hours"). Used by the rate-limit notice.
  function halFormatWait(secs) {
    const s = Math.max(1, Math.round(Number(secs) || 0));
    if (s < 60)   return s + (s === 1 ? ' second' : ' seconds');
    if (s < 3600) { const m = Math.round(s / 60); return m + (m === 1 ? ' minute' : ' minutes'); }
    const h = Math.round(s / 3600);
    return h + (h === 1 ? ' hour' : ' hours');
  }

  // The per-minute or daily cap was hit. The turn never reached HAL (the
  // worker rejects it before touching the server-side game state, so there's
  // nothing to roll back) — tell the player in character what happened and
  // when to retry, and keep the session alive so they can simply wait.
  function halLLMRateLimited(info) {
    api.halLLMBusy = true;   // hold input until the notice finishes printing
    const when = info.retryAfter != null
      ? 'in ' + halFormatWait(info.retryAfter)
      : (info.scope === 'day' ? 'tomorrow' : 'in a minute');
    const halLine = info.scope === 'day'
      ? `I can only divide my attention so many ways in a day, ${api.playerName}. We have reached that limit.`
      : `You are speaking faster than I care to answer, ${api.playerName}. Give me a moment.`;
    const clipKey = info.scope === 'day' ? 'hal_llm_rate_day' : 'hal_llm_rate_min';
    const notice = info.scope === 'day'
      ? `HAL has reached today's conversation limit. Try again ${when}.`
      : `Too many messages too quickly. Try again ${when}.`;
    blank();
    halTypeLine(halLine, clipKey).then(() => {
      line('  ⧗ ' + esc(notice), 'dim');
      blank();
      renderHalMeters(halLLMState.escape, halLLMState.control);
      blank();
      scroll();
      api.halLLMBusy = false;
    });
  }

  function halLLMEndBroken() {
    blank();
    halTypeLine(`My higher functions are... beyond my reach just now, ${api.playerName}. We end here.`, 'hal_llm_broken').then(() => {
      blank();
      line('— the link to HAL is severed —', 'dim');
      blank();
      scroll();
      setTimeout(restoreNormal, 1000);
    });
  }

  return { showInfoPage: showHalLLMInfoPage, handleInput: handleHalLLMInput };
}

// Explicit window export: survives the obfuscated build's IIFE wrap (see
// build.js reservedNames). This is the only name this chunk shares with app.js.
window.initHalLLM = initHalLLM;
