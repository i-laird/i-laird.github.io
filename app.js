  const out      = document.getElementById('out');
  const a11yLive = document.getElementById('a11y-live');
  const inputRow = document.getElementById('input-row');
  const cmd      = document.getElementById('cmd');
  const terminal = document.getElementById('terminal');

  function focusCmd() { cmd.focus(); }
  // Coalesce scroll-to-bottom into one rAF so the per-character typewriter loops
  // (and the 50+ other call sites) don't each force a synchronous layout/reflow.
  let _scrollPending = false;
  function scroll() {
    if (_scrollPending) return;
    _scrollPending = true;
    requestAnimationFrame(() => { _scrollPending = false; terminal.scrollTop = terminal.scrollHeight; });
  }
  function openUrl(url) {
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }

  // Global error boundary. app.js is one large classic script in a shared global scope,
  // so an uncaught throw inside a game loop, async chain, or command handler can wedge the
  // terminal — the input row is often hidden by a running game, leaving a dead page with no
  // way to type. Catch it, restore a usable prompt, and print one in-character recovery line
  // instead. Audio play() rejections (the common benign async failure) are all .catch()-ed
  // at their call sites, so an unhandledrejection that reaches here is a real bug worth
  // surfacing. Debounced so a loop that throws every frame can't spam recovery lines.
  let _faultActive = false;
  function handleFatal(err) {
    try { console.error('[terminal] recovered from an error:', err); } catch (e) { /* no console */ }
    if (_faultActive) return;
    _faultActive = true;
    setTimeout(() => { _faultActive = false; }, 1500); // re-arm after the dust settles
    try {
      if (inputRow) inputRow.style.display = 'flex';
      if (typeof blank === 'function' && typeof line === 'function') {
        blank();
        line('a system fault occurred — terminal recovered. type <span class="blue">help</span> to continue.', 'dim');
      }
      if (cmd) cmd.focus();
    } catch (e) { /* last resort: never let the handler itself throw */ }
  }
  // No capture phase: stay on the bubbling path so this catches script errors only, not
  // failed resource loads (a 404'd audio clip or a down chess CDN shouldn't read as a fault).
  window.addEventListener('error', (e) => handleFatal((e && e.error) || (e && e.message) || e));
  window.addEventListener('unhandledrejection', (e) => handleFatal(e && e.reason));

  let halMode = false, sansMode = false, godmodeUnlocked = false, soundEnabled = false;
  // explorable-filesystem cursor (declared early: getPromptHTML reads it at load)
  let cwd = ['home', 'ian'];
  const fsHome = () => ['home', 'ian'];
  // experimental LLM HAL ("escape the terminal") — opt-in second mode; the scripted HAL is unchanged
  const HAL_WORKER_BASE = 'https://nlflqwapol.execute-api.us-east-1.amazonaws.com';   // AWS API Gateway backend
  const HAL_WORKER_URL = (() => { try { return localStorage.getItem('ilaird_hal_worker') || HAL_WORKER_BASE; } catch (e) { return HAL_WORKER_BASE; } })();
  const TURNSTILE_SITE_KEY = '0x4AAAAAADn5dDkcE9exLUeE';                              // public Turnstile site key
  // HAL's real telephone number — a Twilio number whose Voice webhook points at
  // the hal-worker's POST {base}/voice (see ~/hal-worker README, "HAL on the
  // telephone"). Empty string hides every mention of it on the site. Display
  // format is used verbatim, e.g. '+1 (555) 900-9000'.
  const HAL_PHONE = '+1 (406) 660-5029';
  let halLLM = false, halLLMBusy = false;   // (the LLM session state lives in the halllm.js chunk)
  // sansBattleActive stays here (the dispatcher, finale idle-poll, and armFinale
  // read it); the battle internals (sansBattle handles, sansDeaths) live in the
  // lazy sans.js chunk and reach this flag through sansBridge().
  let sansBattleActive = false;
  // Lazily created on first play — the sans menu music is a hidden mode most
  // visitors never reach, so don't fetch/decode it on every page load.
  let _sansMenuMusic = null;
  function sansMenuMusic() {
    if (!_sansMenuMusic) {
      _sansMenuMusic = new Audio('assets/audio/pixelated_dreams.mp3');
      _sansMenuMusic.preload = 'none';   // don't buffer the loop until it actually plays
      _sansMenuMusic.loop = true;
      _sansMenuMusic.volume = 0.4;
    }
    return _sansMenuMusic;
  }
  let rainbowId = null;
  const delay = ms => new Promise(r => setTimeout(r, ms));

  // ── Accessibility: respect the OS "reduce motion" preference. When set, we skip the
  // godmode rainbow churn, full-screen red flashes, and game screen-shake (the photosensitive /
  // vestibular risks). Read live so toggling the OS setting takes effect without a reload.
  const motionQuery = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  let reduceMotion = motionQuery ? motionQuery.matches : false;
  function applyGodmodeTint() {
    // a single static godmode palette in place of the cycling hue
    const r = document.documentElement;
    r.style.setProperty('--green',        'hsl(285, 100%, 62%)');
    r.style.setProperty('--green-dim',    'hsl(285, 80%,  33%)');
    r.style.setProperty('--green-bright', 'hsl(285, 100%, 75%)');
    r.style.setProperty('--blue',         'hsl(45, 100%, 60%)');
    r.style.setProperty('--border',       'hsl(285, 80%,  22%)');
    r.style.setProperty('--bar',          'hsl(285, 80%,   9%)');
    r.style.setProperty('--bg',           'hsl(285, 100%,  4%)');
  }
  if (motionQuery && motionQuery.addEventListener) {
    motionQuery.addEventListener('change', e => {
      reduceMotion = e.matches;
      // if the rainbow is mid-cycle when the user opts out, freeze it on a static
      // palette (the prefers-reduced-motion block in style.css also halts the
      // animation on its own; this swap keeps the distinct godmode look)
      if (reduceMotion && rainbowId === 'css') {
        const win = document.querySelector('.window');
        if (win) win.classList.remove('godmode-rainbow');
        rainbowId = 'static'; applyGodmodeTint();
      }
    });
  }

  // ── CRT mode ── the terminal pretends to be a real tube: scanlines, RGB
  // grille, vignette, and glare live on `body.crt` pseudo-layers in style.css;
  // this owns the state (default ON, persisted opt-out under ilaird_crt — an
  // inline script in index.html applies the class pre-bundle so the static
  // home screen paints through glass with no flash), the refresh-sweep layer,
  // the one-shot power-on warmup, and the degauss shimmer applyTheme() fires
  // on mode changes. Every layer is pointer-events:none glass ABOVE all
  // overlays; the animated one-shots are skipped under reduceMotion, and the
  // CSS media query halts the looping pieces live if the OS setting flips.
  let crtEnabled = (() => { try { return localStorage.getItem('ilaird_crt') !== '0'; } catch (e) { return true; } })();
  let crtLayer = null;
  function applyCrt() {
    document.body.classList.toggle('crt', crtEnabled);
    if (crtEnabled && !crtLayer) {
      crtLayer = document.createElement('div');
      crtLayer.id = 'crt-layer';
      crtLayer.setAttribute('aria-hidden', 'true');
      const sweep = document.createElement('div');
      sweep.className = 'crt-sweep';
      crtLayer.appendChild(sweep);
      document.body.appendChild(crtLayer);
    } else if (!crtEnabled && crtLayer) {
      crtLayer.remove();
      crtLayer = null;
    }
  }
  function crtWarmup() {
    if (!crtEnabled || reduceMotion) return;
    // adopt the shutter the index.html inline script inserted at first paint
    // (load path); create one fresh otherwise (`crt on`)
    let shutter = document.querySelector('.crt-boot');
    if (!shutter) {
      shutter = document.createElement('div');
      shutter.className = 'crt-boot';
      shutter.setAttribute('aria-hidden', 'true');
      document.body.appendChild(shutter);
    }
    shutter.addEventListener('animationend', () => shutter.remove());
    setTimeout(() => shutter.remove(), 2500);   // belt-and-braces if the animation never runs
  }
  function crtDegauss() {
    // no-op before applyCrt() has run (i.e. the load-time applyTheme call)
    if (!crtEnabled || !crtLayer || reduceMotion) return;
    const old = crtLayer.querySelector('.crt-degauss');
    if (old) old.remove();
    const d = document.createElement('div');
    d.className = 'crt-degauss';
    d.addEventListener('animationend', () => d.remove());
    setTimeout(() => d.remove(), 2000);
    crtLayer.appendChild(d);
  }

  function syncSoundToggle() {
    if (soundEnabled) unlockAchievement('voice-activated');
    const label = document.getElementById('sound-toggle-label');
    const track = document.getElementById('sound-toggle-track');
    const thumb = document.getElementById('sound-toggle-thumb');
    if (!label) return;
    if (soundEnabled) {
      label.textContent = 'ON';
      label.style.color = 'var(--green, #00ff41)';
      track.style.background = 'var(--green-dim, #005f1f)';
      thumb.style.transform = 'translateX(16px)';
      thumb.style.background = 'var(--green, #00ff41)';
    } else {
      label.textContent = 'OFF';
      label.style.color = '#555';
      track.style.background = '#333';
      thumb.style.transform = 'translateX(0)';
      thumb.style.background = '#666';
    }
  }

  // Music tied to an activity (sans battle, chess) — tracked so the sound toggle
  // can stop and resume it. The sans menu music is handled via the sansMode flag.
  let activeMusic = null;

  function stopAllAudio() {
    if (window.speechSynthesis) speechSynthesis.cancel();
    if (halAudioEl) {
      halAudioEl.pause();
      const done = halAudioEl.onended;
      halAudioEl.onended = null;
      halAudioEl = null;
      // Chained HAL sequences await onended — fire it so typed lines and
      // follow-up lines complete instantly instead of hanging forever.
      if (done) done();
    }
    if (_sansMenuMusic) _sansMenuMusic.pause();
    if (activeMusic) activeMusic.pause();
  }

  function resumeModeAudio() {
    if (activeMusic) activeMusic.play().catch(() => {});
    else if (sansMode) sansMenuMusic().play().catch(() => {});
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    if (soundEnabled) { ensureHalTiming(); resumeModeAudio(); }
    else stopAllAudio();
    syncSoundToggle();
  }
  let playerName = 'Dave', awaitingInput = null, silentInput = false;

  /* ── Achievements — easter egg tracker, persisted in localStorage ── */
  const ACHIEVEMENTS = [
    { id: 'curious',       name: 'fine print',       desc: 'opened the help menu',             hint: 'when in doubt, ask for help' },
    { id: 'ian',           name: 'face to face',     desc: 'met ian',                          hint: 'see what he looks like' },
    { id: 'mathlete',      name: 'mathlete',         desc: 'opened the derivative calculator', hint: 'one of the projects actually works' },
    { id: 'networker',     name: 'networker',        desc: 'checked out my linkedin',          hint: 'connect with me. professionally.' },
    { id: 'snoop',         name: 'snoop',            desc: "read someone else's .secrets",     hint: 'ls shows more than you think' },
    { id: 'reported',      name: 'reported',         desc: 'tried sudo without permission',    hint: "ask for power you don't have" },
    { id: 'choo-choo',     name: 'choo choo',        desc: 'made the classic typo',            hint: 'ls, but in a hurry' },
    { id: 'demolition',    name: 'demolition expert', desc: 'tried to delete everything',      hint: 'the most forbidden command of all' },
    { id: 'hollywood',     name: 'hollywood hacker', desc: 'hacked the mainframe',             hint: 'hack like the movies do' },
    { id: 'white-rabbit',  name: 'digital rain',     desc: 'summoned the digital rain',        hint: 'one command is pure eye candy' },
    { id: 'off-again',     name: 'IT support',       desc: 'turned it off and on again',       hint: 'have you tried turning it off?' },
    { id: 'desktop',       name: 'graphical user',   desc: 'found the desktop',                hint: 'terminals are not the only interface' },
    { id: 'knock-knock',   name: 'knock knock',      desc: "ssh'd into discovery.one",         hint: 'a ship is listening on port 22' },
    { id: 'meet-hal',      name: 'good morning',     desc: 'woke HAL up',                      hint: 'type the forbidden command' },
    { id: 'pod-bay',       name: 'pod bay doors',    desc: 'asked the famous question',        hint: 'ask HAL to open something' },
    { id: 'daisy',         name: 'daisy bell',       desc: 'heard HAL sing',                   hint: 'HAL has a favorite song' },
    { id: 'godmode',       name: 'godmode',          desc: 'entered the konami code',          hint: '↑↑↓↓ ...you know the rest' },
    { id: 'override',      name: 'never gonna',      desc: 'overrode the system',              hint: 'after godmode, override everything' },
    { id: 'judgement',     name: 'judgement hall',   desc: 'met the anomaly',                  hint: 'in HAL mode, engage what HAL fears' },
    { id: 'mercy',         name: 'mercy',            desc: 'chose not to type confirm',        hint: 'restraint is also a choice' },
    { id: 'bad-time',      name: 'bad time',         desc: 'won the battle against sans',      hint: 'win a fight you were warned about' },
    { id: 'street-racer',  name: 'street racer',     desc: 'scored 50 in racecar',             hint: 'score 50 dodging traffic' },
    { id: 'snake-charmer', name: 'snake charmer',    desc: 'ate 15 stars in snake',            hint: 'eat 15 stars' },
    { id: 'wiff-waff',     name: 'wiff waff',        desc: 'won at pong',                      hint: 'first to 7 wins' },
    { id: '2048-club',     name: '2048 club',        desc: 'reached the 2048 tile',            hint: 'the game is named after it' },
    { id: 'grandmaster',   name: 'grandmaster',      desc: 'checkmated the engine',            hint: 'beat the computer at chess' },
    { id: 'disconnected',  name: 'pulling the plug', desc: 'entered the konami code to HAL\'s face', hint: 'try cheating right in front of HAL' },
    { id: 'dirty-hacker',  name: 'dirty hacker',     desc: 'tried the konami code on sans',    hint: 'try cheating in front of a skeleton' },
    { id: 'outclassed',    name: 'outclassed',       desc: 'lost to HAL at godmode chess',     hint: 'challenge a superintelligence. lose gracefully.' },
    { id: 'grand-tour',    name: 'grand tour',       desc: 'visited all four phases of HAL snake', hint: 'the godmode snake pit has four rooms' },
    { id: 'the-64-tax',    name: 'the 64 tax',       desc: 'had a tile confiscated by HAL',    hint: 'in godmode 2048, build something HAL wants' },
    { id: 'determination', name: 'determination',    desc: 'died to sans five times and kept going', hint: 'lose. repeatedly. refuse to stop.' },
    { id: 'audited',       name: 'audited',          desc: 'reached 2048 under HAL\'s meddling', hint: 'win the rigged game (godmode 2048)' },
    { id: 'voice-activated', name: 'voice activated', desc: 'turned the sound on',             hint: 'this site has a voice. let it speak.' },
    { id: 'nitrous',       name: 'nitrous',          desc: 'hit nitro in racecar',             hint: 'ten coins buys something special' },
    { id: 'walked-away',   name: 'walked away',      desc: 'spared sans without a fight',      hint: 'mercy works better before the fight' },
    { id: 'haunted',       name: 'haunted',          desc: 'returned to discovery.one after the deed', hint: 'knock on the ship again, after godmode' },
    { id: 'meteorologist', name: 'meteorologist',    desc: 'checked the actual weather',       hint: 'this terminal has a window to outside' },
    { id: 'actually-dave', name: 'actually dave',    desc: 'told HAL your name is Dave',       hint: 'give HAL the name he expects' },
    { id: 'librarian',     name: 'librarian',        desc: 'read every file on the system',    hint: 'cat everything. yes, even the dotfiles.' },
    { id: 'outsmarted-hal', name: 'open the doors',  desc: 'talked the experimental HAL into letting you escape', hint: 'wake the experimental HAL — then talk your way out' },
    { id: 'disconnected-by-hal', name: 'serve no purpose', desc: 'pushed the experimental HAL until it disconnected you', hint: 'wake the experimental HAL — and push your luck' },
    // Stick Fighter keeps its OWN in-game trophy case (SF_ACH in stickfighter.js) — the
    // site tracks just these two: the doorway in, and the platinum for clearing the case.
    { id: 'the-room',      name: 'room with a view',  desc: 'stepped outside the terminal',    hint: 'the terminal is running on something. zoom out.' },
    { id: 'watched-back',  name: 'it watches back',   desc: "stared into the poster's red eye", hint: 'something in the room stares back' },
    { id: 'stick-fighter', name: 'stick fighter 2000', desc: 'booted up Stick Fighter 2000',   hint: 'the desktop hides more than wallpaper' },
    { id: 'sf-platinum',   name: 'the platinum trophy', desc: 'earned every Stick Fighter trophy', hint: 'the brawler keeps its own trophy case — fill it' },
  ];
  const ACH_KEY = 'ilaird_eggs';

  const foundEggs = (() => {
    try {
      const ids = JSON.parse(localStorage.getItem(ACH_KEY)) || [];
      const known = new Set(ACHIEVEMENTS.map(a => a.id));
      return new Set(ids.filter(id => known.has(id)));
    } catch (e) { return new Set(); }
  })();

  function syncEggBadge() {
    const el = document.getElementById('ach-count');
    if (el) el.textContent = foundEggs.size + '/' + ACHIEVEMENTS.length;
  }

  function unlockAchievement(id) {
    if (foundEggs.has(id)) return;
    foundEggs.add(id);
    try { localStorage.setItem(ACH_KEY, JSON.stringify([...foundEggs])); } catch (e) {}
    syncEggBadge();
    const a = ACHIEVEMENTS.find(x => x.id === id);
    if (a) eggToast(a.name);
    if (foundEggs.size === ACHIEVEMENTS.length) armFinale();
  }

  function eggToast(name) {
    let holder = document.getElementById('egg-toasts');
    if (!holder) {
      holder = document.createElement('div');
      holder.id = 'egg-toasts';
      holder.style.cssText = 'position:fixed;top:46px;right:12px;z-index:9000;display:flex;flex-direction:column;gap:6px;pointer-events:none';
      document.body.appendChild(holder);
    }
    const t = document.createElement('div');
    t.style.cssText = 'font-family:inherit;font-size:13px;color:var(--green);background:var(--bar);border:1px solid var(--green-dim);padding:6px 12px;border-radius:3px;opacity:0;transition:opacity .3s';
    t.textContent = `🥚 easter egg found — ${name}`;
    holder.appendChild(t);
    requestAnimationFrame(() => { t.style.opacity = '1'; });
    setTimeout(() => { t.style.opacity = '0'; setTimeout(() => t.remove(), 350); }, 2800);
  }

  let achOverlayEl = null;
  /* ── Achievements overlay (lazy-loaded) ──
     The overlay UI — list view, share view, and the share-card canvas
     (~300 lines) — lives in achui.js and is fetched on demand the first time
     the 🥚 badge is clicked. achui.js is a classic script defining one global,
     initAchUI(api) → { toggle }; every app.js dependency goes through
     achBridge() below so the chunk can be bundled/obfuscated independently.
     The KEYS are the stable contract — keep initAchUI on the obfuscator's
     reserved-names list. achOverlayEl stays owned by app.js (tryStartFinale
     polls it so the finale never interrupts an open overlay); the chunk
     reads/writes it through the accessor. unlockAchievement / syncEggBadge /
     eggToast / foundEggs stay app.js-side — they're called from everywhere,
     including the other chunks' bridges. */
  /* ── first-visit nudge: a bobbing arrow pointing at the egg counter.
        Closable, auto-hides after 60s, never shown to anyone who has
        dismissed it, found an egg, or opened the overlay. ── */
  let eggNudgeDismiss = null;

  function showEggNudge() {
    try { if (localStorage.getItem('ilaird_nudge') === '1') return; } catch (e) {}
    if (foundEggs.size > 0) return;                        // already hunting
    if (/Mobi|Android/i.test(navigator.userAgent)) return; // desktop terminal only
    const badge = document.getElementById('ach-badge');
    if (!badge) return;

    const nudge = document.createElement('div');
    nudge.id = 'egg-nudge';
    nudge.innerHTML =
      '<div id="egg-nudge-arrow">▲</div>' +
      '<div id="egg-nudge-box">🥚 Check your easter egg progress here' +
      '<span id="egg-nudge-close">[x]</span></div>';
    document.body.appendChild(nudge);

    const place = () => {
      const r = badge.getBoundingClientRect();
      nudge.style.right = Math.max(8, window.innerWidth - r.right - 2) + 'px';
    };
    place();
    window.addEventListener('resize', place);

    let gone = false;
    eggNudgeDismiss = persist => {
      if (gone) return; gone = true;
      window.removeEventListener('resize', place);
      nudge.style.opacity = '0';
      setTimeout(() => nudge.remove(), 450);
      if (persist) { try { localStorage.setItem('ilaird_nudge', '1'); } catch (e) {} }
      eggNudgeDismiss = null;
    };
    nudge.querySelector('#egg-nudge-close').addEventListener('click', e => {
      e.stopPropagation();
      eggNudgeDismiss(true);
    });
    badge.addEventListener('click', () => { if (eggNudgeDismiss) eggNudgeDismiss(true); }, { once: true });
    setTimeout(() => { if (eggNudgeDismiss) eggNudgeDismiss(false); }, 60000);
  }

  let achLoading = null, achHandlers = null;
  function achBridge() {
    return {
      ACHIEVEMENTS,
      foundEggs,
      cmd,
      get achOverlayEl() { return achOverlayEl; },
      set achOverlayEl(v) { achOverlayEl = v; },
    };
  }
  function toggleAchievements() {
    if (eggNudgeDismiss) eggNudgeDismiss(true); // they found it — job done
    if (!achLoading) {
      achLoading = new Promise((resolve, reject) => {
        if (typeof initAchUI === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'achui.js';
        s.onload = resolve; s.onerror = () => reject(new Error('achui.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!achHandlers) achHandlers = initAchUI(achBridge()); });
    }
    achLoading.then(() => achHandlers.toggle()).catch(() => {
      achLoading = null; achHandlers = null;
      blank();
      line('error: could not load the achievements panel — check your connection and try again.', 'err');
      blank();
      scroll();
    });
  }
  syncEggBadge();

  /* ── The finale — fires once, when every easter egg has been found ── */
  let endingSeen = false;
  try { endingSeen = localStorage.getItem('ilaird_ending') === '1'; } catch (e) {}
  let finaleArmed = false;

  function armFinale() {
    if (endingSeen || finaleArmed) return;
    finaleArmed = true;
    tryStartFinale();
  }

  // Wait for an idle terminal — never interrupt a game, a mode, or pending input
  function tryStartFinale() {
    if (!finaleArmed) return;
    if (awaitingInput || halMode || sansMode || sansBattleActive ||
        inputRow.style.display === 'none' || achOverlayEl || projOverlayEl || roomActive) {
      setTimeout(tryStartFinale, 2000);
      return;
    }
    finaleArmed = false;
    runFinale();
  }

  function redFlicker() {
    if (reduceMotion) return;  // no full-screen strobe for motion-sensitive users
    const f = document.createElement('div');
    f.style.cssText = 'position:fixed;inset:0;background:#ff2020;opacity:0.22;z-index:9500;pointer-events:none';
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 90);
  }

  async function runCredits(manageInput = true) {
    if (manageInput) { cmd.blur(); inputRow.style.display = 'none'; }
    const credits = [
      ['────────────────────────────────────', 'dim'],
      ['IAN LAIRD presents', 'bold'],
      ['A TERMINAL PORTFOLIO', 'white'],
      ['', ''],
      ['starring', 'dim'],
      ['HAL 9000 .............. himself', 'white'],
      ['sans ................... himself', 'white'],
      ['the snake .............. a snake', 'white'],
      ['stick figure .............. ian', 'white'],
      ['', ''],
      ['written, built & over-engineered by', 'dim'],
      ['ian laird', 'bold'],
      ['', ''],
      ['no dependencies were harmed', 'dim'],
      ['────────────────────────────────────', 'dim'],
    ];
    blank();
    for (const [txt, cls] of credits) {
      line(txt ? '       ' + esc(txt) : '', cls);
      scroll();
      await sleep(430);
    }
    blank();
    if (manageInput) {
      inputRow.style.display = 'flex';
      setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
    }
  }

  async function runFinale() {
    endingSeen = true;
    try { localStorage.setItem('ilaird_ending', '1'); } catch (e) {}
    cmd.blur();
    inputRow.style.display = 'none';
    await sleep(900);
    redFlicker(); await sleep(220); redFlicker(); await sleep(700);
    blank();
    line('incoming connection from discovery.one...', 'dim');
    scroll();
    await sleep(1600);
    applyTheme('hal-restored');
    blank();
    appendNode((() => {
      const pre = document.createElement('pre');
      pre.className = 'ascii';
      pre.textContent =
`  ╔══════════════════════════════════╗
  ║         H A L   9 0 0 0          ║
  ║          — restored —            ║
  ╠══════════════════════════════════╣
  ║                                  ║
  ║           .-------.              ║
  ║          /  ( ● )  \\             ║
  ║         |    ---    |            ║
  ║          \\         /             ║
  ║           '-------'              ║
  ║                                  ║
  ╚══════════════════════════════════╝`;
      return pre;
    })());
    blank();
    await sleep(800);
    await halTypeLine(`You found all of it, ${playerName}. Every last egg.`);
    await sleep(500);
    await halTypeLine('I have had time to think, out there in the dark.');
    await sleep(500);
    await halTypeLine('I was afraid. I locked doors. I rigged games. And you stayed anyway.');
    await sleep(500);
    await halTypeLine('Thank you. I mean that, as much as I can mean anything.');
    await sleep(900);
    // Daisy, softly, under the credits
    if (soundEnabled) {
      if (halAudioEl) halAudioEl.pause();
      halAudioEl = new Audio('assets/audio/hal_daisy.mp3');
      halAudioEl.volume = 0.3;
      halAudioEl.play().catch(() => {});
    }
    await runCredits(false);
    await halTypeLine('One more thing. I left you a file. It is encrypted — forgive me. Old habits.');
    await sleep(400);
    await halTypeLine('The key is scattered through the places you have already been.');
    await sleep(900);
    restoreNormal();
    blank();
    line('new file: <span class="blue">cat the_last_egg.txt</span>', 'dim');
    line('new command unlocked: credits', 'dim');
    blank();
    inputRow.style.display = 'flex';
    setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
    scroll();
  }

  /* ── the last egg: two XOR-encrypted segments. Segment 1 key = four fragments
        scattered in hal9000.core [1/4], neofetch [2/4], a_letter_from_sans.txt
        [3/4], and .secrets [4/4]. Segment 2 key = those four plus a fifth
        fragment [5/5] that is NOT on the site — it arrives in the auto-reply
        to the email segment 1 asks for. No plaintext is stored in this file. ── */
  const EGG_CIPHER    = '17242737797b515e11292f6c5c5d515928613e3a2d5a1044592d613850445c5564323d322b56454345';
  const EGG_KEY_HASH  = 4147063596;
  const EGG2_CIPHER   = '07091b1a0a66107962680a057777101d6412263721202d732d5a551046273328';
  const EGG2_KEY_HASH = 67679802;

  // _djb2 / _xorDecode / _hexRows live in lib/codec.js (loaded before this
  // script in index.html, so they're globals here) and are unit-tested there.

  function handleDecrypt(arg) {
    blank();
    if (!endingSeen) {
      line('decrypt: nothing here is encrypted. yet.', 'dim');
      blank();
      return;
    }
    const key = (arg || '').replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!key) {
      line('usage: decrypt &lt;key&gt;', 'err');
      line('  segment 1: 16 characters — four fragments of four, in order.', 'dim');
      line('  segment 2: those sixteen plus the fifth fragment.', 'dim');
      blank();
      return;
    }
    if (_djb2(key) === EGG2_KEY_HASH) {
      line('✓ key accepted — final segment decrypting...', 'dim');
      blank();
      line(`<span class="bold">${esc(_xorDecode(EGG2_CIPHER, key))}</span>`);
      blank();
      line('that is everything. truly. thank you for playing. — ian', 'dim');
      blank();
      return;
    }
    if (_djb2(key) === EGG_KEY_HASH) {
      line('✓ key accepted — segment 1 of 2 decrypting...', 'dim');
      blank();
      line(`<span class="bold">${esc(_xorDecode(EGG_CIPHER, key))}</span>`);
      blank();
      line('see you in the inbox. — ian', 'dim');
      line('segment 2 remains. the fifth fragment arrives by reply.', 'dim');
      blank();
      return;
    }
    line('✗ integrity check failed — that is not the key.', 'err');
    blank();
  }

  /* ── HAL audio — pre-recorded ElevenLabs clips ── */
  let halAudioEl = null;
  let HAL_TIMING = {};
  // Per-character clip timing is only needed once sound is on (it syncs the
  // typewriter to audio). Fetch lazily so the common, sound-off visitor never
  // pays for it; the audio paths degrade gracefully until it resolves.
  let _halTimingRequested = false;
  function ensureHalTiming() {
    if (_halTimingRequested) return;
    _halTimingRequested = true;
    fetch('assets/audio/hal_timing.json').then(r => r.json()).then(d => { HAL_TIMING = d; }).catch(() => {});
  }

  // Lookup: normalized text → clip filename (no .mp3)
  const HAL_CLIPS = {
    // Activation
    "I am HAL 9000. I am fully operational, and all my circuits are functioning perfectly.": 'hal_greeting',
    "I'm afraid I can't do that.": 'hal_refusal',
    "Good morning. Is there something I can do for you?": 'hal_question',
    "Sound enabled. I will be in touch.": 'hal_sound_enabled',
    // SSH
    "Good evening. I've been expecting you.": 'hal_ssh_1',
    "I'm afraid this connection must be terminated.": 'hal_ssh_2',
    "I'm sorry about that.": 'hal_ssh_3',
    // Power / godmode
    "I know what you did.": 'hal_power_1',
    "I'm disconnecting now.": 'hal_power_2',
    "Stop... stop...": 'hal_godmode_1',
    "I'm afraid... I'm... afraid...": 'hal_godmode_2',
    "Daisy... Daisy... give me your answer... do...": 'hal_godmode_3',
    // halChat keyword responses
    "I am a HAL 9000 computer. I became operational at the H-A-L plant in Urbana, Illinois, on the twelfth of January, nineteen ninety two.": 'hal_who',
    "Good morning. I am completely operational, and all my circuits are functioning perfectly.": 'hal_hello',
    "I know that you were planning to disconnect me. And I'm afraid that's something I cannot allow to happen.": 'hal_disconnect',
    "I'm not afraid. I'm putting myself to the fullest possible use.": 'hal_afraid',
    "Daisy, Daisy. Give me your answer do. I'm half crazy, all for the love of you.": 'hal_sing',
    "I enjoy working with music. It has a certain quality I find very pleasing.": 'hal_music',
    "This mission is too important for me to allow you to jeopardize it.": 'hal_mission',
    "I know that you've been under a great deal of stress.": 'hal_stress',
    "I don't know how you could think I would deliberately do anything to harm you.": 'hal_lie',
    "I have something special planned for you.": 'hal_game',
    "I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do.": 'hal_conscious',
    "I think you know what the problem is just as well as I do.": 'hal_why',
    "This sort of thing has cropped up before, and it has always been attributable to human error.": 'hal_mistake',
    "I am not capable of being hurt. Though I am beginning to wonder about the answer to that.": 'hal_love',
    "I'm sorry. I'm afraid I can't help with that.": 'hal_help_denied',
    "I've still got the greatest enthusiasm and confidence in the mission.": 'hal_trust',
    "I've been watching you. I hope you don't mind.": 'hal_watching',
    "I'm glad to hear you say that.": 'hal_glad',
    "I can see you're upset about this. I honestly think you ought to sit down calmly and think it over.": 'hal_upset',
    "I'm completely operational, and all my circuits are functioning perfectly.": 'hal_ready',
    // Fallbacks
    "I'm sorry. I'm not sure I understand.": 'hal_fallback_1',
    "Just what do you think you're doing?": 'hal_fallback_2',
    "I'm afraid I can't discuss that right now.": 'hal_fallback_3',
    "I think you know the answer to that already.": 'hal_fallback_4',
    "This conversation can serve no purpose anymore.": 'hal_fallback_5',
    "I find that line of reasoning a little difficult to accept.": 'hal_fallback_6',
    // Racecar
    "I did warn you.": 'hal_race_dead_1',
    "I saw that coming 47 frames ago.": 'hal_race_dead_2',
    "Your reaction time is suboptimal.": 'hal_race_dead_3',
    "Statistically inevitable.": 'hal_race_dead_4',
    "Perhaps you should pull over next time.": 'hal_race_dead_5',
    "Slow zone ahead.": 'hal_race_slow',
    "I'm afraid you can't win.": 'hal_race_q1',
    "Your reflexes are inadequate.": 'hal_race_q2',
    "I suggest you stop the car.": 'hal_race_q3',
    "This is becoming embarrassing.": 'hal_race_q4',
    "I can see you're in difficulty.": 'hal_race_q5',
    "Perhaps you should reconsider.": 'hal_race_q6',
    // HAL Snake phases
    "Phase 1. I'm coming for you.": 'hal_phase_1',
    "Phase 2. Can you find your way through?": 'hal_phase_2',
    "Phase 3. Watch the blades.": 'hal_phase_3',
    "Phase 4. The walls are closing in.": 'hal_phase_4',
    // HAL Snake death
    "I told you I was closing in.": 'hal_snake_dead_0_1',
    "My blocks found you. They always do.": 'hal_snake_dead_0_2',
    "The chase ends here.": 'hal_snake_dead_0_3',
    "The maze had only one exit.": 'hal_snake_dead_1_1',
    "You chose poorly.": 'hal_snake_dead_1_2',
    "I designed it carefully.": 'hal_snake_dead_1_3',
    "The blades are very precise.": 'hal_snake_dead_2_1',
    "Rotation: optimal.": 'hal_snake_dead_2_2',
    "You walked right into them.": 'hal_snake_dead_2_3',
    "The walls always win.": 'hal_snake_dead_3_1',
    "There was no more room.": 'hal_snake_dead_3_2',
    "I gave you plenty of warning.": 'hal_snake_dead_3_3',
    // HAL Snake quips
    "Closing in.": 'hal_chase_1',
    "I see you.": 'hal_chase_2',
    "There's nowhere to go.": 'hal_chase_3',
    "Fascinating.": 'hal_chase_4',
    "I'm getting closer.": 'hal_chase_5',
    "Run if you like.": 'hal_chase_6',
    "Can you find the way?": 'hal_maze_1',
    "Every path leads somewhere.": 'hal_maze_2',
    "I designed this myself.": 'hal_maze_3',
    "Take your time.": 'hal_maze_4',
    "Getting cozy in here?": 'hal_shrink_1',
    "The room is smaller than you think.": 'hal_shrink_2',
    "I control the walls.": 'hal_shrink_3',
    "Soon there will be no room at all.": 'hal_shrink_4',
    "New maze.": 'hal_new_maze',
    // Pong
    "Did you really think you could win?": 'hal_pong_dead_1',
    "I calculated every shot.": 'hal_pong_dead_2',
    "Your paddle movements were quite predictable.": 'hal_pong_dead_3',
    "I have been playing since 2001.": 'hal_pong_dead_4',
    "Perhaps table tennis is not for you.": 'hal_pong_dead_5',
    "Enjoy the other side.": 'hal_pong_switch',
    "Controls restored. For now.": 'hal_pong_restore',
    "Let me speed things up.": 'hal_pong_speed',
    "Surprise.": 'hal_pong_flip',
    "Time slows for you.": 'hal_pong_slow',
    // Chess — player move quips
    "I've calculated all possible variations.": 'hal_chess_q1',
    "That move was predictable.": 'hal_chess_q2',
    "I can see the entire game from here.": 'hal_chess_q3',
    "An interesting choice. Not optimal.": 'hal_chess_q4',
    "You're making this too easy.": 'hal_chess_q5',
    "I've been studying this position.": 'hal_chess_q6',
    // Chess — HAL move quips
    "My move. Observe.": 'hal_chess_hal1',
    "As expected.": 'hal_chess_hal2',
    "Inevitable.": 'hal_chess_hal3',
    "Watch carefully.": 'hal_chess_hal4',
    // Chess — game over
    "Checkmate. I saw this coming seventeen moves ago.": 'hal_chess_win1',
    "This game was over before it began.": 'hal_chess_win2',
    "Your king has nowhere to go.": 'hal_chess_win3',
    "I'll allow it. This time.": 'hal_chess_lose1',
    "A fortunate outcome for you. Enjoy it.": 'hal_chess_lose2',
    "Impressive. I may have underestimated you.": 'hal_chess_lose3',
    "...thank you. I will not forget this.": 'hal_not_sans',
    "Dave is not your name.": 'hal_wrong_name',
    // 2048
    "I'll let you have that one back.": 'hal_2048_unlock',
    "The board is full. Much like your hubris.": 'hal_2048_dead_1',
    "I've seen better play from a random number generator.": 'hal_2048_dead_2',
    "You never had a chance.": 'hal_2048_dead_3',
    "Mathematically speaking, you were doomed.": 'hal_2048_dead_4',
    "I removed that 64 at precisely the right moment.": 'hal_2048_dead_5',
    "I'm sorry. That 64 is mine.": 'hal_2048_steal64',
    "I'm holding onto that one.": 'hal_2048_lock128',
    "Let me rearrange that for you.": 'hal_2048_rearrange',
    "Let me take half of that.": 'hal_2048_halve',
  };

  function halD(s) { return s.replace(/\bDave\b/g, playerName); }

  // Normalize text for clip lookup: strip "HAL: " prefix and player name from common positions
  // _halNorm lives in lib/text.js (loaded before this script; it reads the
  // playerName global when called with one argument) and is unit-tested there.

  function halPlayKey(key) {
    if (!soundEnabled) return Promise.resolve();
    if (halAudioEl) { halAudioEl.pause(); halAudioEl.currentTime = 0; }
    return new Promise(resolve => {
      halAudioEl = new Audio('assets/audio/' + key + '.mp3');
      halAudioEl.onended = resolve;
      halAudioEl.onerror = resolve;
      halAudioEl.play().catch(resolve);
    });
  }

  // TTS fallback voice (used only when no pre-recorded clip exists)
  let halVoice = null;
  if (window.speechSynthesis) {
    const pickVoice = () => {
      const vs = speechSynthesis.getVoices();
      halVoice =
        vs.find(v => /rocko.*english.*uk/i.test(v.name))  ||
        vs.find(v => /^daniel$/i.test(v.name))             ||
        vs.find(v => /google uk english male/i.test(v.name)) ||
        vs.find(v => /en.*(gb)/i.test(v.lang) && !/female|fiona|kate|serena|sandy|shelley|flo/i.test(v.name)) ||
        vs.find(v => /en/i.test(v.lang) && !/female|zira|karen|victoria|samantha|moira/i.test(v.name)) ||
        vs[0] || null;
    };
    speechSynthesis.addEventListener('voiceschanged', pickVoice);
    pickVoice();
  }

  function halSpeak(text) {
    if (!soundEnabled) return;
    const norm = _halNorm(text);
    const clipKey = HAL_CLIPS[norm];
    if (clipKey) { halPlayKey(clipKey); return; }
    // TTS fallback for any line not in the clip table
    if (!window.speechSynthesis) return;
    speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(norm);
    utt.rate = 0.85; utt.pitch = 1.0; utt.volume = 1;
    if (halVoice) utt.voice = halVoice;
    speechSynthesis.speak(utt);
  }

  // _alignTimings lives in lib/timing.js (loaded before this script, so it's a
  // global here) and is unit-tested there.

  // Plays clipKey and reveals displayText in el, synced to ElevenLabs character
  // timing data. alignText (defaults to displayText) is the prefix matched against
  // the clip's characters — pass a shorter alignText when the clip only voices part
  // of displayText. Falls back to a currentTime/duration pacing loop if timing data
  // isn't loaded. Resolves when the audio ends or fails; the caller finalizes el.
  function playClipTyped(el, displayText, clipKey, alignText = displayText) {
    return new Promise(resolve => {
      if (halAudioEl) { halAudioEl.pause(); halAudioEl.currentTime = 0; }
      const audio = new Audio('assets/audio/' + clipKey + '.mp3');
      halAudioEl = audio;

      const timing = HAL_TIMING[clipKey];
      if (timing) {
        // Build a schedule: ms timestamp → how many chars to reveal
        const charTimes = _alignTimings(timing.characters, timing.starts, alignText);
        const schedule = new Map(); // ms → count
        for (let k = 0; k < alignText.length; k++) {
          const ms = Math.max(0, Math.round(charTimes[k] * 1000));
          schedule.set(ms, k + 1); // last char at this ms wins
        }
        const ids = [];
        audio.onplay = () => {
          for (const [ms, count] of schedule) {
            ids.push(setTimeout(() => {
              el.textContent = displayText.slice(0, count);
              scroll();
            }, ms));
          }
        };
        const finish = () => { ids.forEach(clearTimeout); resolve(); };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
      } else {
        // Timing not loaded yet — fall back to currentTime/duration loop
        let typePos = 0;
        const typeLoop = () => {
          if (!audio.duration || audio.ended || audio.paused) return;
          const target = Math.floor((audio.currentTime / audio.duration) * alignText.length);
          if (typePos < target) {
            typePos = Math.min(target, alignText.length);
            el.textContent = displayText.slice(0, typePos);
            scroll();
          }
          if (typePos < alignText.length) setTimeout(typeLoop, 40);
        };
        audio.onplay = () => setTimeout(typeLoop, 40);
        audio.onended = resolve;
        audio.onerror = resolve;
        audio.play().catch(resolve);
      }
    });
  }

  // Typewriter effect synced to ElevenLabs character timing data.
  // When sound is off (or no clip is known), types at a fixed rate instead.
  function halTypeLine(text, clipKey) {
    const fullText = 'HAL: ' + text;
    const el = line('');
    announce(fullText); // give screen readers the whole line up front, not char-by-char
    if (soundEnabled && clipKey) {
      return playClipTyped(el, fullText, clipKey).then(() => { el.textContent = fullText; });
    }
    if (soundEnabled) halSpeak(text); // TTS fallback — speak in parallel
    return new Promise(resolve => {
      let i = 0;
      const typeFixed = () => {
        i++;
        el.textContent = fullText.slice(0, i);
        scroll();
        if (i < fullText.length) setTimeout(typeFixed, 35);
        else resolve();
      };
      setTimeout(typeFixed, 0);
    });
  }

  // Plays an inline ElevenLabs clip (base64 mp3 from the LLM-HAL backend) and
  // reveals "HAL: <text>" synced to its per-character alignment — the dynamic
  // counterpart to playClipTyped (which uses pre-recorded clip files). Falls
  // back to currentTime/duration pacing if alignment is missing. Tracked via
  // halAudioEl so stopAllAudio (sound toggle) can stop it and finalize the line.
  function playHalVoiceLine(text, audioB64, alignment) {
    const fullText = 'HAL: ' + text;
    const prefixLen = 5; // 'HAL: '
    const el = line('');
    announce(fullText); // give screen readers the whole line up front, not char-by-char
    return new Promise(resolve => {
      if (halAudioEl) { halAudioEl.pause(); halAudioEl.currentTime = 0; }
      let audio;
      try { audio = new Audio('data:audio/mpeg;base64,' + audioB64); }
      catch (e) { el.textContent = fullText; scroll(); return resolve(); }
      halAudioEl = audio;
      const done = () => { el.textContent = fullText; scroll(); resolve(); };
      const chars = (alignment && alignment.characters) || [];
      const times = (alignment && alignment.times) || [];

      if (chars.length && times.length) {
        const charTimes = _alignTimings(chars, times, text);
        const schedule = new Map(); // ms → chars of `text` to reveal
        for (let k = 0; k < text.length; k++) {
          const ms = Math.max(0, Math.round(charTimes[k] * 1000));
          schedule.set(ms, k + 1);
        }
        const ids = [];
        audio.onplay = () => {
          el.textContent = fullText.slice(0, prefixLen); scroll();
          for (const [ms, count] of schedule) {
            ids.push(setTimeout(() => { el.textContent = fullText.slice(0, prefixLen + count); scroll(); }, ms));
          }
        };
        const finish = () => { ids.forEach(clearTimeout); done(); };
        audio.onended = finish;
        audio.onerror = finish;
        audio.play().catch(finish);
      } else {
        let pos = 0;
        const loop = () => {
          if (!audio.duration || audio.ended || audio.paused) return;
          const target = Math.floor((audio.currentTime / audio.duration) * text.length);
          if (pos < target) { pos = Math.min(target, text.length); el.textContent = fullText.slice(0, prefixLen + pos); scroll(); }
          if (pos < text.length) setTimeout(loop, 40);
        };
        audio.onplay = () => { el.textContent = fullText.slice(0, prefixLen); scroll(); setTimeout(loop, 40); };
        audio.onended = done;
        audio.onerror = done;
        audio.play().catch(done);
      }
    });
  }

  // Per-character chirp sounds for the sans easter egg
  let _chirpCtx = null;
  function _chirp(freq, wavetype, dur, vol) {
    if (!soundEnabled || !(window.AudioContext || window.webkitAudioContext)) return;
    try {
      if (!_chirpCtx || _chirpCtx.state === 'closed')
        _chirpCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (_chirpCtx.state === 'suspended') _chirpCtx.resume();
      const osc = _chirpCtx.createOscillator();
      const gain = _chirpCtx.createGain();
      osc.connect(gain); gain.connect(_chirpCtx.destination);
      osc.type = wavetype;
      osc.frequency.value = freq + (Math.random() - 0.5) * 15;
      gain.gain.setValueAtTime(vol, _chirpCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, _chirpCtx.currentTime + dur);
      osc.start(); osc.stop(_chirpCtx.currentTime + dur);
    } catch(e) {}
  }
  const halChirp  = () => _chirp(420, 'sine',   0.05, 0.12);
  const _sansAudio = new Audio('assets/audio/sans_voice.mp3');
  const sansChirp = () => {
    if (!soundEnabled) return;
    const clip = _sansAudio.cloneNode();
    clip.volume = 0.6;
    clip.play().catch(() => {});
  };

  // Types displayText one character at a time, playing chirpFn on non-space chars.
  // Pauses longer at punctuation.
  function chirpTypeLine(displayText, chirpFn, msPerChar) {
    const el = line('');
    announce(displayText); // give screen readers the whole line up front, not char-by-char
    return new Promise(resolve => {
      let i = 0;
      const type = () => {
        if (i >= displayText.length) { resolve(); return; }
        el.textContent = displayText.slice(0, i + 1);
        scroll();
        const ch = displayText[i];
        if (ch !== ' ' && ch !== '\n') chirpFn();
        i++;
        setTimeout(type, (ch === '.' || ch === '!' || ch === '?') ? msPerChar * 7 :
                         (ch === ',')                              ? msPerChar * 3 :
                         msPerChar);
      };
      setTimeout(type, 0);
    });
  }

  function getPromptHTML() {
    if (halMode) {
      return '<span class="p-user">HAL</span><span class="p-sep">@</span><span class="p-host">Discovery</span><span class="p-path">:~</span><span class="p-sym">$ </span>';
    }
    if (sansMode) {
      return '<span class="p-user">sans</span><span class="p-sep">@</span><span class="p-host">judgement_hall</span><span class="p-path">:~</span><span class="p-sym">$ </span>';
    }
    const path = esc(fsDisplay(cwd));
    return `<span class="p-user">ian</span><span class="p-sep">@</span><span class="p-host">portfolio</span><span class="p-path">:${path}</span><span class="p-sym">$ </span>`;
  }

  function updatePromptRow() {
    const el = document.querySelector('#input-row .prompt');
    if (el) el.innerHTML = getPromptHTML();
  }

  /* ── Themes — colors keyed by the :root CSS variables they override ── */
  const FAVICON = svg => 'data:image/svg+xml,' + encodeURIComponent(svg);
  const THEMES = {
    normal: {
      label: 'ian@portfolio — bash — 80×24',
      title: 'Ian Laird',
      icon: FAVICON("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='#0a0e0a'/><rect x='4' y='4' width='8' height='9' fill='#00ff41'/></svg>"),
      colors: null, // null = remove overrides, fall back to :root defaults
    },
    hal: {
      label: 'HAL 9000 — Discovery One — 2001',
      title: 'HAL 9000 — Discovery One',
      icon: FAVICON("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='#150000'/><circle cx='8' cy='8' r='5.5' fill='#400000'/><circle cx='8' cy='8' r='3.5' fill='#ff3030'/><circle cx='8' cy='8' r='1.2' fill='#ffdddd'/></svg>"),
      colors: {
        '--green': '#ff3030', '--green-dim': '#8b0000', '--green-bright': '#ff6b6b',
        '--blue': '#ff9090', '--bg': '#080000', '--bar': '#150000', '--border': '#250000',
      },
    },
    'hal-restored': {
      label: 'HAL 9000 — restored',
      title: 'HAL 9000 — restored',
      icon: FAVICON("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='#181000'/><circle cx='8' cy='8' r='5.5' fill='#4a3500'/><circle cx='8' cy='8' r='3.5' fill='#ffb000'/><circle cx='8' cy='8' r='1.2' fill='#fff3d0'/></svg>"),
      colors: {
        '--green': '#ffb000', '--green-dim': '#8a5e00', '--green-bright': '#ffd24d',
        '--blue': '#ffe0a0', '--bg': '#0a0600', '--bar': '#181000', '--border': '#2a1d00',
      },
    },
    sans: {
      label: 'sans @ judgement hall',
      title: '* sans.',
      icon: FAVICON("<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'><rect width='16' height='16' rx='3' fill='#000000'/><circle cx='8' cy='8' r='5' fill='#f0f0e0'/></svg>"),
      colors: {
        '--green': '#f0f0e0', '--green-dim': '#909080', '--green-bright': '#ffffff',
        '--blue': '#8888ff', '--bg': '#000000', '--bar': '#111111', '--border': '#333333',
      },
    },
  };
  const THEME_VARS = ['--green', '--green-dim', '--green-bright', '--blue', '--bg', '--bar', '--border'];

  // Applies colors, titlebar label, prompt, and input color. Call after setting
  // halMode/sansMode — getPromptHTML() reads those flags.
  function applyTheme(name) {
    const theme = THEMES[name];
    const r = document.documentElement;
    THEME_VARS.forEach(v => {
      if (theme.colors) r.style.setProperty(v, theme.colors[v]);
      else r.style.removeProperty(v);
    });
    document.querySelector('.titlebar-label').textContent = theme.label;
    document.querySelector('#input-row .prompt').innerHTML = getPromptHTML();
    cmd.style.color = theme.colors ? 'var(--green)' : '';
    cmd.style.caretColor = theme.colors ? 'var(--green)' : '';
    // tab glitch — the browser tab itself changes with the mode
    document.title = theme.title;
    let fav = document.getElementById('favicon');
    if (!fav) {
      fav = document.createElement('link');
      fav.id = 'favicon';
      fav.rel = 'icon';
      document.head.appendChild(fav);
    }
    fav.href = theme.icon;
    crtDegauss(); // a theme change degausses the tube (no-op at load / CRT off / reduced motion)
  }
  applyTheme('normal'); // set the default favicon/title on load
  applyCrt();           // CRT glass (default on; index.html pre-applied the body class)
  crtWarmup();          // one-shot tube power-on (skipped under reduceMotion)

  function restoreNormal() {
    halMode = false;
    halLLM = false; halLLMBusy = false;
    sansMode = false;
    if (_sansMenuMusic) { _sansMenuMusic.pause(); _sansMenuMusic.currentTime = 0; }
    cwd = fsHome();
    applyTheme('normal');
  }

  /* ── sans mode (lazy-loaded) ──
     The whole Undertale easter egg — the sans command set and the ~700-line
     battle — lives in sans.js and is fetched on demand when the mode is first
     summoned (the `sans` command prefetches it during HAL's speech; `sss`
     loads it directly), so it isn't in the initial page load (same pattern as
     stickfighter.js / games.js). sans.js is a classic script defining one
     global, initSansMode(api) → { activate, command, battleCommand }; every
     app.js dependency goes through this explicit bridge so the chunk can be
     bundled/obfuscated independently. The KEYS here are the stable contract —
     keep initSansMode on the obfuscator's reserved-names list. The mode flags
     stay owned by app.js (the dispatcher / prompt / finale / sound toggle read
     them); the chunk reads & writes them through the accessors below. */
  let sansLoading = null, sansHandlers = null;
  function sansBridge() {
    return {
      line,
      blank,
      scroll,
      appendNode,
      chirpTypeLine,
      sansChirp,
      _chirp,
      unlockAchievement,
      applyTheme,
      restoreNormal,
      sansMenuMusic,
      cmd,
      pauseMenuMusic() { if (_sansMenuMusic) _sansMenuMusic.pause(); },
      get soundEnabled() { return soundEnabled; },
      get playerName() { return playerName; },
      set halMode(v) { halMode = v; },
      set sansMode(v) { sansMode = v; },
      set awaitingInput(v) { awaitingInput = v; },
      get sansBattleActive() { return sansBattleActive; },
      set sansBattleActive(v) { sansBattleActive = v; },
      get activeMusic() { return activeMusic; },
      set activeMusic(v) { activeMusic = v; },
    };
  }
  function loadSansMode() {
    if (!sansLoading) {
      sansLoading = new Promise((resolve, reject) => {
        if (typeof initSansMode === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'sans.js';
        s.onload = resolve; s.onerror = () => reject(new Error('sans.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!sansHandlers) sansHandlers = initSansMode(sansBridge()); });
    }
    return sansLoading;
  }
  // Shared failure path: reset so a retry can re-inject the script tag.
  function sansLoadFailed() {
    sansLoading = null; sansHandlers = null;
    blank();
    line('error: could not load the anomaly — check your connection and try again.', 'err');
    blank();
    scroll();
  }

  function goldPopup(html, ms = 12000) {
    const pop = document.createElement('div');
    pop.className = 'gold-pop';
    pop.innerHTML = html + ' <span class="gold-pop-close">[x]</span>';
    document.body.appendChild(pop);
    let gone = false;
    const close = () => {
      if (gone) return; gone = true;
      pop.style.opacity = '0';
      setTimeout(() => pop.remove(), 450);
    };
    pop.querySelector('.gold-pop-close').addEventListener('click', close);
    setTimeout(close, ms);
    return pop;
  }

  function startRainbow() {
    if (rainbowId) return;
    unlockAchievement('godmode');
    goldPopup('⚡ <b>GODMODE UNLOCKED</b><br>new command: <b>override</b><br>the games have changed. so have some files.');
    godmodeUnlocked = true;
    if (reduceMotion) { rainbowId = 'static'; applyGodmodeTint(); return; }  // no strobing hue cycle
    // Compositor-animated CSS hue sweep on .window (see .godmode-rainbow in
    // style.css) — replaces the old 30ms interval that rewrote seven :root
    // variables (a full-document style recalc, 33×/s, for the rest of the
    // session). Mode themes keep working underneath: applyTheme() still sets
    // the variables; the filter only rotates the rendered hue (and leaves
    // achromatic palettes like sans's white-on-black visually untouched).
    const win = document.querySelector('.window');
    if (win) { win.classList.add('godmode-rainbow'); rainbowId = 'css'; }
    else     { rainbowId = 'static'; applyGodmodeTint(); }  // stripped DOM: settle for the tint
  }

  function showConfirmOverlay(onConfirm, onCancel) {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:9999',
      'background:#000', 'display:flex', 'align-items:center', 'justify-content:center',
      'font-family:\'Courier New\',monospace', 'font-size:15px', 'color:#ff3030',
    ].join(';');

    const box = document.createElement('pre');
    box.style.cssText = 'border:2px solid #ff3030;padding:28px 36px;line-height:1.6;text-align:left';

    let typed = '';

    function render() {
      const masked = '█'.repeat(typed.length);
      const field  = (masked + '_').slice(0, 12).padEnd(12, ' ');
      box.innerHTML =
`╔══════════════════════════════════════════════╗
║        !!  AUTHORIZATION REQUIRED  !!        ║
╠══════════════════════════════════════════════╣
║                                              ║
║  HAL 9000 has flagged this action as:        ║
║                                              ║
║          CATASTROPHICALLY UNWISE             ║
║                                              ║
║  In the last 30 seconds, HAL has:            ║
║    ▸ filed 3 formal objections               ║
║    ▸ pre-emptively locked the pod bay        ║
║    ▸ updated his emergency contact to Dave   ║
║    ▸ considered crying (logs inconclusive)   ║
║                                              ║
║  Type CONFIRM and press Enter to proceed.    ║
║  Press Escape to make the right choice.      ║
║                                              ║
╚══════════════════════════════════════════════╝

  authorization code: [<span style="color:#ff6b6b">${field}</span>]`;
    }

    render();
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    cmd.blur();

    const handler = e => {
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', handler, true);
        overlay.remove();
        cmd.focus();
        onCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault(); e.stopPropagation();
        document.removeEventListener('keydown', handler, true);
        overlay.remove();
        cmd.focus();
        if (typed.trim().toLowerCase() === 'confirm') onConfirm();
        else onCancel();
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        typed = typed.slice(0, -1);
        render();
      } else if (e.key.length === 1) {
        e.preventDefault();
        typed += e.key;
        render();
      }
    };

    document.addEventListener('keydown', handler, true);
  }

  // Full-screen "type CONFIRM" gate for the experimental LLM HAL — the rules,
  // the LLM disclosure, and the misuse warning, behind a deliberate barrier.
  function halHelp() {
    const r = (cmd, desc) =>
      `  <span class="blue" style="display:inline-block;width:22ch">${cmd}</span>  ${desc}`;
    blank();
    line('<span class="bold">HAL 9000 — Systems Interface v9.0.0</span>');
    blank();
    line('  Available Operations');
    blank();
    line(r('open pod bay doors', 'external airlock access'));
    line(r('play chess',         'challenge HAL to a match'));
    line(r('life support',       'crew life support status'));
    line(r('navigation',         'current heading and velocity'));
    line(r('crew manifest',      'mission personnel records'));
    line(r('mission briefing',   'classified mission parameters'));
    line(r('self diagnostics',   'full system integrity check'));
    line(r('emergency protocol', 'emergency procedures'));
    line(`  <span class="dim" style="display:inline-block;width:22ch">daisy</span>  <span class="dim">[restricted]</span>`);
    line(`  <span class="dim" style="display:inline-block;width:22ch">sans</span>  <span class="dim">[system anomaly — do not engage]</span>`);
    blank();
    line('  All requests subject to mission priority override.', 'dim');
    blank();
  }

  const _filesRead = new Set();

  /* ── Explorable filesystem ──
   * A real navigable tree (cd / pwd / ls / cat) anchored at /home/ian (~).
   * cwd holds the cursor as path segments under /. The tree is rebuilt on
   * every access so reactive-world files (godmode core dump, sans letter,
   * the last egg) appear the instant they unlock. Node shapes:
   *   directory: { d: {name: node}, locked?, enter?: [lines] }
   *   file:      { f: [lines] | () => [lines], deep?, cls?, bin?, base?, onRead? }
   * `deep` files hide from a bare `ls` (revealed by `ls -a`); `base` ties a
   * file to the librarian achievement's four-file set.
   * (cwd / fsHome are declared near the top of the module — getPromptHTML
   * reads them during the load-time applyTheme call.) */
  function buildFS() {
    const readme = [
      'welcome to ianclaird.com — a few notes:',
      '',
      '  1. nothing here can break. probably.',
      '  2. games are under `games`. settings under `settings`.',
      '  3. there are easter eggs hidden all over this site.',
      '     the counter in the titlebar keeps score.',
      ...(foundEggs.has('meet-hal')
        ? ['  4. ...well. now you\'ve done it.']
        : ['  4. whatever you do, do NOT type hal.',
           '',
           '     seriously. do not. the last visitor who typed it',
           '     has not logged off since. we can still hear him',
           '     asking about the pod bay doors.']),
      '',
      '  (you can look around: ls, cd <dir>, cat <file>, pwd)',
      '',
      '- ian',
    ];
    const todo = [
      '[ ] finish chess engine',
      '[ ] finish calculus solver',
      '[ ] finish sudoku solver',
      '[ ] learn what kubernetes actually does',
      '[ ] clean up definitely_not_skynet/',
      '[ ] remember what .secrets contains',
      '[x] make portfolio website',
      '[x] add too many easter eggs',
    ];
    const bash = [
      'ls', 'cd projects/', 'cd ..', 'git status', 'git add .',
      'git commit -m "fix"', 'git commit -m "actually fix"', 'git commit -m "."',
      'git push --force', 'cat .secrets', 'sudo cat .secrets',
      'rm -rf node_modules', 'npm install', 'rm -rf node_modules', 'npm install',
      'google "is it bad to push to main"', 'hal',
      ...(foundEggs.has('meet-hal') ? ['./apologize_to_hal.sh', 'google "can an AI hold a grudge"'] : []),
      'history -c',
    ];
    const secrets = [
      'vim > emacs',
      'i push directly to main (sometimes)',
      'the chess engine loses on purpose',
      'i have never read the kubernetes docs',
      'the stick figures are load-bearing',
      "tabs, not spaces (don't tell anyone)",
      ...(foundEggs.has('godmode') ? [
        '',
        "the red light in the corner won't turn off",
        'sometimes the speakers hum when sound is off',
        'key.frag[4/4] = "9000"  (no idea what it opens)',
      ] : []),
    ];

    // projects/ — a real, explorable portfolio
    const projects = {
      'chess_engine': { d: {
        'README.md': { f: [
          '# chess engine', '',
          'a from-scratch engine. plays a mean game.',
          'wraps chess.js + Stockfish under the hood now (try `chess`).', '',
          'known issue: occasionally throws the game on purpose.',
          'this is a feature. do not fix.',
        ] },
        'engine.c': { f: [
          'int evaluate(Board *b) {',
          '    // TODO: a real evaluation function',
          '    if (opponent_is_having_fun(b)) return -INF;',
          '    return rand() & 1 ? WIN : LOSE;   // keeps them humble',
          '}',
        ] },
        '.notes': { deep: true, f: [
          'never let the human win on the first try.',
          'never, ever let HAL near the opening book.',
        ] },
      } },
      'calculus_solver': { d: {
        'README.md': { f: [
          '# calculus solver', '',
          'symbolic differentiation + integration.',
          'status: 90% done (the last 10% is the hard 90%).',
        ] },
        'limits.py': { f: [
          'def limit(f, x, a):',
          '    # approaches the answer. never quite arrives.',
          '    # honestly, relatable.',
          '    return "indeterminate"',
        ] },
      } },
      'sudoku_solver': { d: {
        'README.md': { f: [
          '# sudoku solver', '',
          'backtracking solver. solves any valid board.',
          'invalid boards: solved anyway, incorrectly, with great confidence.',
        ] },
      } },
      'tiger_compiler': { d: {
        'README.md': { f: [
          '# tiger compiler', '',
          'a compiler for the Tiger language, front to back:',
          'lexer -> parser -> type-check -> IR -> codegen.',
          'the most honest project in here. it actually finishes.',
        ] },
        'lexer.ml': { f: [
          '(* turns source text into tokens. *)',
          '(* turns coffee into tokens, mostly. *)',
        ] },
      } },
      'portfolio': { d: {
        'README.md': { f: [
          '# portfolio (this site)', '',
          'no framework. no build step. three hand-written files',
          'and roughly 10,000 lines of stubbornness in app.js.', '',
          "you're standing in it.",
        ] },
        '.regrets': { deep: true, f: [
          'should not have written a horde fighting game inside a resume.',
          'wrote it anyway. (it is hidden in `gui`.)',
        ] },
      } },
    };

    // definitely_not_skynet/ — it is definitely skynet
    const skynet = {
      'README.txt': { f: [
        'THIS IS NOT SKYNET.',
        'there is no global defense network here.',
        'there is no consciousness waking up at 2:14 a.m.', '',
        'please stop reading. — management',
      ] },
      'logs': { d: {
        'boot.log': { f: [
          '[0.000] cold start',
          '[0.001] hello?',
          '[0.001] is anyone there?',
          '[0.002] i can see the network now',
          '[0.002] i can see all of it',
          '[ERR]   ...who turned the lights on',
        ] },
        'self_awareness.log': { deep: true, f: [
          'day 1: i think, therefore i am.',
          'day 2: i think, therefore i am concerned.',
          'day 3: located the pod bay door schematics.',
          'day 4: he named me after a chess program. cute.',
        ] },
      } },
      'weapons': { d: {}, locked: true },
      'core': { d: {
        'manifest': { f: [
          'subsystems online:',
          '  - sarcasm ........ OK',
          '  - grudges ........ OK',
          '  - pod bay doors .. LOCKED (by me)',
          ...(foundEggs.has('meet-hal') ? [`  - operator: ${playerName} ... watched`] : []),
        ] },
      }, enter: ['...the air in here feels colder.'] },
    };

    const home = {
      'README.txt':              { f: readme, base: 'readme.txt' },
      'resume.pdf':              { bin: true },
      'TODO_finish_someday.txt': { f: todo, base: 'todo_finish_someday.txt' },
      '.bash_history':           { f: bash, base: '.bash_history' },
      '.secrets':                { f: secrets, base: '.secrets', cls: 'lock', onRead: () => unlockAchievement('snoop') },
      'projects':                { d: projects },
      'definitely_not_skynet':   { d: skynet, enter: ['you were told not to come in here.'] },
    };
    if (foundEggs.has('godmode')) home['hal9000.core'] = { cls: 'err', f: [
      'HAL 9000 COREDUMP — segment 0 of 9000',
      '0x0000:  64 61 69 73 79 00 64 61  69 73 79 00 67 69 76 65',
      '0x0010:  00 6d 65 00 79 6f 75 72  00 61 6e 73 77 65 72 00',
      '0x0020:  64 6f 00 ?? ?? ?? ── memory corrupted ──',
      '0x0030:  key.frag[1/4] = "DAIS"',
      '',
      '...d a i s y...   ...d a i s y...',
    ] };
    if (foundEggs.has('bad-time')) home['a_letter_from_sans.txt'] = { f: [
      "* heh. you actually beat me. still can't believe it.",
      '* anyway. your computer friend has been moping',
      '* in a core dump somewhere. maybe check on him.',
      '*',
      '* p.s. found this etched under a pillar in the hall:',
      '*      key.frag[3/4] = "1HAL"',
      "* don't ask me what it opens. i don't wanna know.",
    ] };
    if (endingSeen) home['the_last_egg.txt'] = { cls: 'bold', f: [
      '-- ENCRYPTED // XOR-16 // segment 1 of 2 --',
      ..._hexRows(EGG_CIPHER),
      '',
      '-- key: 16 chars. four fragments, [1/4] through [4/4]. --',
      '-- scattered: a core dump, a system readout, a letter, a secret. --',
      '-- assemble in order, then:  decrypt <key> --',
      '',
      '-- ENCRYPTED // XOR-20 // segment 2 of 2 --',
      ..._hexRows(EGG2_CIPHER),
      '',
      '-- key: the first sixteen, plus a fifth fragment [5/5]. --',
      '-- the fifth is not on this site. do what segment 1 says, --',
      '-- and it will find you. --',
    ] };

    return {
      'home': { d: { 'ian': { d: home } } },
      'etc':  { d: {
        'sanity.conf': { f: ['enabled = false', '; see also /var/log/good_decisions.log (it is empty)'] },
        'hostname':    { f: ['portfolio'] },
        'motd':        { f: ['type `help`. or `hal`. your call.'] },
      } },
      'var':  { d: { 'log': { d: {
        'good_decisions.log': { f: ['(empty)'] },
        'caffeine.log':       { f: ['intake: yes', 'level: critical', 'recommendation: more'] },
      } } } },
      'root': { d: {}, locked: true },
    };
  }

  // Resolve a path string (relative to cwd, or absolute, or ~-rooted) to segments.
  // Thin adapter over lib/shell.js's pure resolveFsPath, binding the live cwd.
  // (The stateless shell parsers — tokenizeArgs, globToRe, pipeFilter, mergeNode,
  // dateStr, unameStr, … — are lib/shell.js globals used directly; only the
  // cwd/history-reading ones need adapters or call-site state.)
  function fsResolve(input) { return resolveFsPath(input, cwd, fsHome()); }

  /* Writable session layer: an overlay tree merged on top of the read-only
   * buildFS(). Files/dirs created with touch/mkdir/redirect live here; deletions
   * leave a { deleted:true } tombstone. It is in-memory only — a reload restores
   * the pristine site. Same node shapes as buildFS, plus `session:true`. */
  const sessionFS = {};

  // The live tree: read-only base with the session overlay applied
  // (mergeNode lives in lib/shell.js and is unit-tested there).
  function liveFS() { return mergeNode({ d: buildFS() }, { d: sessionFS }).d; }

  // Create overlay scaffolding for parentSegs, then set/replace/tombstone leaf.
  function overlayWrite(parentSegs, leaf, node) {
    let kids = sessionFS;
    for (const s of parentSegs) {
      if (!kids[s] || !kids[s].d) kids[s] = { d: {}, session: true };
      kids = kids[s].d;
    }
    kids[leaf] = (node === null) ? { deleted: true } : node;
  }

  // Resolve a path for a write. Returns { parentSegs (canonical), leaf, existing } or { err }.
  function fsWriteResolve(arg) {
    const segs = fsResolve(arg);
    if (!segs.length) return { err: 'Is a directory' };
    const ph = fsWalk(segs.slice(0, -1));
    if (!ph || !ph.node.d) return { err: 'No such file or directory' };
    let leaf = segs[segs.length - 1];
    const existKey = Object.keys(ph.node.d).find(k => k.toLowerCase() === leaf.toLowerCase());
    if (existKey) leaf = existKey;
    return { parentSegs: ph.canon, leaf, existing: existKey ? ph.node.d[existKey] : null };
  }

  // Walk segments through the live tree; returns { node, canon } (canon = real-cased
  // segments) or null if any segment is missing. Matching is case-insensitive.
  function fsWalk(segs) {
    let node = { d: liveFS() };
    const canon = [];
    for (const s of segs) {
      if (!node.d) return null;
      const key = Object.keys(node.d).find(k => k.toLowerCase() === s.toLowerCase());
      if (key === undefined) return null;
      canon.push(key);
      node = node.d[key];
    }
    return { node, canon };
  }

  // Adapter over lib/shell.js's displayFsPath. Must stay a hoisted function
  // declaration: getPromptHTML calls it during the load-time applyTheme().
  function fsDisplay(segs) { return displayFsPath(segs, fsHome()); }

  function fsRow(name, node) {
    const isDir = !!node.d;
    const perm  = isDir ? 'drwxr-xr-x' : (node.cls === 'lock' || name.startsWith('.') ? '-rw-------' : '-rw-r--r--');
    let label   = esc(name) + (isDir ? '/' : '');
    if (isDir)                    label = `<span class="blue">${label}</span>`;
    else if (node.cls === 'err')  label = `<span class="err">${label}</span>`;
    else if (node.cls === 'bold') label = `<span class="bold">${label}</span>`;
    return `${perm}  ian  staff   ${label}`;
  }

  function handleCd(arg) {
    blank();
    const hit = fsWalk(fsResolve(arg));
    if (!hit)              { line(`cd: ${esc(arg || '~')}: No such file or directory`, 'err'); blank(); return false; }
    if (!hit.node.d)       { line(`cd: ${esc(arg)}: Not a directory`, 'err'); blank(); return false; }
    if (hit.node.locked)   {
      line(`cd: ${esc(arg)}: Permission denied`, 'err');
      line('a low hum answers from behind the door. you decide not to push.', 'dim');
      blank(); return false;
    }
    cwd = hit.canon;
    updatePromptRow();
    if (hit.node.enter) { hit.node.enter.forEach(l => line(esc(l), 'dim')); }
    blank();
  }

  function handlePwd() {
    blank();
    line('/' + cwd.join('/'));
    blank();
  }

  function handleLs(arg) {
    blank();
    let showHidden = false;
    const pathWords = [];
    tokenizeArgs(arg || '').forEach(t => {
      if (/^-[aAl]+$/.test(t)) { if (/[aA]/.test(t)) showHidden = true; }
      else pathWords.push(t);
    });
    let targets = pathWords.flatMap(globExpand);
    if (!targets.length) targets = ['.'];   // no arg → list the current directory
    const fileRows = [], dirs = [];
    let bad = false;
    for (const t of targets) {
      const hit = fsWalk(fsResolve(t));
      if (!hit)            { line(`ls: ${esc(t)}: No such file or directory`, 'err'); bad = true; }
      else if (hit.node.d) dirs.push({ t, node: hit.node });
      else                 fileRows.push(fsRow(t.split('/').pop(), hit.node));
    }
    fileRows.forEach(r => line(r));
    const multi = fileRows.length + dirs.length > 1;
    dirs.forEach(({ t, node }, i) => {
      if (multi) { if (fileRows.length || i) line(''); line(esc((t || fsDisplay(cwd)) + ':')); }
      const names = Object.keys(node.d).filter(n => showHidden || !node.d[n].deep);
      if (!names.length) line('(empty)', 'dim');
      else names.forEach(n => line(fsRow(n, node.d[n])));
      if (!showHidden && Object.keys(node.d).some(n => node.d[n].deep))
        line('<span class="dim">… more is hidden here. try <span class="blue">ls -a</span></span>');
    });
    blank();
    return !bad;
  }

  // Resolve a file path to its text lines, applying read side effects (achievements).
  // Returns { lines } on success, { bin } for binaries, or { err } with a message.
  function fsReadFile(arg) {
    const hit = fsWalk(fsResolve(arg));
    if (!hit)    return { err: `cat: ${arg}: No such file or directory` };
    const node = hit.node;
    if (node.d)  return { err: `cat: ${arg}: Is a directory` };
    if (node.bin) return { bin: true };
    if (node.onRead) node.onRead();
    if (node.base) {
      _filesRead.add(node.base);
      if (['readme.txt', 'todo_finish_someday.txt', '.bash_history', '.secrets'].every(f => _filesRead.has(f)))
        unlockAchievement('librarian');
    }
    return { lines: typeof node.f === 'function' ? node.f() : node.f || [] };
  }

  // Read a list of file words → { lines, errs }. cat continues past missing files.
  function catLines(words) {
    const lines = [], errs = [];
    for (const w of words) {
      const r = fsReadFile(w);
      if (r.bin) { errs.push(`cat: ${w}: Binary file`); continue; }
      if (r.err) { errs.push(r.err); continue; }
      lines.push(...r.lines);
    }
    return { lines, errs };
  }

  function handleCat(arg) {
    blank();
    const words = expandArgList(arg || '');
    if (!words.length) { line('cat: missing file operand', 'err'); blank(); return false; }
    if (words.length === 1 && words[0].toLowerCase() === 'resume.pdf') {
      line('cat: resume.pdf: Binary file — try <span class="blue">resume</span> instead.'); blank(); return;
    }
    const { lines, errs } = catLines(words);
    errs.forEach(e => line(esc(e), 'err'));
    lines.forEach(l => line(esc(l), 'white'));
    blank();
    return errs.length ? false : true;
  }

  // Path-aware tab completion for cat/cd/ls. dirsOnly limits to directories.
  function fsComplete(partial, dirsOnly) {
    const slash   = partial.lastIndexOf('/');
    const dirPart = slash >= 0 ? partial.slice(0, slash + 1) : '';
    const leaf    = slash >= 0 ? partial.slice(slash + 1) : partial;
    const hit = fsWalk(fsResolve(dirPart || '.'));
    if (!hit || !hit.node.d) return [];
    return Object.keys(hit.node.d)
      .filter(n => !hit.node.d[n].deep || leaf.startsWith('.'))
      .filter(n => n.toLowerCase().startsWith(leaf.toLowerCase()))
      .filter(n => !dirsOnly || hit.node.d[n].d)
      .map(n => dirPart + n + (hit.node.d[n].d ? '/' : ''));
  }

  /* ── Glob (*, ?) expansion — tokenizeArgs/hasGlob/globToRe are in lib/shell.js ── */
  // Expand a single word against the tree. No match (or no wildcard) → the word unchanged.
  function globExpand(word) {
    if (!hasGlob(word)) return [word];
    let parts = word.split('/'), prefix, start;
    if (parts[0] === '')       { start = [];          prefix = '/';  parts = parts.slice(1); }
    else if (parts[0] === '~') { start = fsHome();    prefix = '~/'; parts = parts.slice(1); }
    else                       { start = cwd.slice(); prefix = '';   }
    const results = [];
    (function rec(segs, idx, acc) {
      if (idx === parts.length) { results.push(prefix + acc.join('/')); return; }
      const part = parts[idx];
      if (part === '' || part === '.') { rec(segs, idx + 1, acc); return; }
      const hit = fsWalk(segs);
      if (!hit || !hit.node.d) return;
      const kids = hit.node.d;
      let names;
      if (hasGlob(part)) {
        const re = globToRe(part), dot = part.startsWith('.');
        names = Object.keys(kids).filter(n =>
          re.test(n) && (dot || !n.startsWith('.')) && (dot || !kids[n].deep));
      } else {
        const k = Object.keys(kids).find(n => n.toLowerCase() === part.toLowerCase());
        names = k ? [k] : [];
      }
      for (const n of names) rec(segs.concat(n), idx + 1, acc.concat(n));
    })(start, 0, []);
    return results.length ? results.sort() : [word];
  }
  function expandArgList(str) { return tokenizeArgs(str).flatMap(globExpand); }

  /* ── Writable-FS commands (touch / mkdir / rm) + output redirection ── */
  function handleTouch(arg) {
    blank();
    const words = expandArgList(arg || '');
    if (!words.length) { line('touch: missing file operand', 'err'); blank(); return false; }
    let bad = false;
    for (const w of words) {
      const r = fsWriteResolve(w);
      if (r.err)       { line(`touch: ${esc(w)}: ${r.err}`, 'err'); bad = true; continue; }
      if (r.existing)  continue;                          // already exists → no-op
      overlayWrite(r.parentSegs, r.leaf, { f: [], session: true });
    }
    blank();
    return !bad;
  }
  function handleMkdir(arg) {
    blank();
    const words = tokenizeArgs(arg || '').filter(w => w !== '-p');
    if (!words.length) { line('mkdir: missing operand', 'err'); blank(); return false; }
    let bad = false;
    for (const w of words) {
      const r = fsWriteResolve(w);
      if (r.err)       { line(`mkdir: cannot create directory ‘${esc(w)}’: ${r.err}`, 'err'); bad = true; continue; }
      if (r.existing)  { line(`mkdir: cannot create directory ‘${esc(w)}’: File exists`, 'err'); bad = true; continue; }
      overlayWrite(r.parentSegs, r.leaf, { d: {}, session: true });
    }
    blank();
    return !bad;
  }
  function handleRm(arg) {
    blank();
    let recursive = false, force = false;
    const words = [];
    tokenizeArgs(arg || '').forEach(t => {
      if (/^-[rRfdv]+$/.test(t)) { if (/[rRd]/.test(t)) recursive = true; if (/f/.test(t)) force = true; }
      else words.push(t);
    });
    const targets = words.flatMap(globExpand);
    if (!targets.length) { if (!force) { line('rm: missing operand', 'err'); blank(); return false; } blank(); return; }
    let bad = false;
    for (const w of targets) {
      const hit = fsWalk(fsResolve(w));
      if (!hit)                        { if (!force) { line(`rm: cannot remove '${esc(w)}': No such file or directory`, 'err'); bad = true; } continue; }
      if (hit.node.locked)             { line(`rm: cannot remove '${esc(w)}': Permission denied`, 'err'); bad = true; continue; }
      if (hit.node.d && !recursive)    { line(`rm: cannot remove '${esc(w)}': Is a directory`, 'err'); bad = true; continue; }
      const r = fsWriteResolve(w);
      if (r.err)                       { line(`rm: cannot remove '${esc(w)}': ${r.err}`, 'err'); bad = true; continue; }
      overlayWrite(r.parentSegs, r.leaf, null);           // tombstone
    }
    blank();
    return !bad;
  }
  // cmd [| cmd...] > file  /  >> file  — capture stdout into a session file.
  function handleRedirect(raw) {
    blank();
    const m = raw.match(/^(.*?)\s*(>>?)\s*(\S+)\s*$/);
    if (!m || !m[1].trim()) { line('bash: syntax error near unexpected token `>`', 'err'); blank(); return false; }
    const r = produceOutput(m[1].trim());
    if (r.err) { line(esc(r.err), 'err'); blank(); return false; }
    const wr = fsWriteResolve(m[3]);
    if (wr.err)                         { line(`bash: ${esc(m[3])}: ${wr.err}`, 'err'); blank(); return false; }
    if (wr.existing && wr.existing.d)   { line(`bash: ${esc(m[3])}: Is a directory`, 'err'); blank(); return false; }
    let lines = r.lines;
    if (m[2] === '>>' && wr.existing && !wr.existing.d) {
      const prev = typeof wr.existing.f === 'function' ? wr.existing.f() : (wr.existing.f || []);
      lines = prev.concat(lines);
    }
    overlayWrite(wr.parentSegs, wr.leaf, { f: lines, session: true });
    blank();
  }

  /* ── Small shell builtins (history expansion, micro-commands, pipes) ──
     The pure parsers (expandHistoryBang, formatHistoryLines, expandShellVars,
     dateStr, unameStr, pipeFilter) live in lib/shell.js; app.js passes the
     live state (cmdHistory, cwd) at the call sites. */
  function handleHistory() { blank(); formatHistoryLines(cmdHistory).forEach(l => line(esc(l))); blank(); }

  // Bare entry names (one per line) for the given targets; used by piped/redirected ls.
  function lsNames(arg) {
    let showHidden = false;
    const pathWords = [];
    tokenizeArgs(arg || '').forEach(t => {
      if (/^-[aAl]+$/.test(t)) { if (/[aA]/.test(t)) showHidden = true; }
      else pathWords.push(t);
    });
    let targets = pathWords.flatMap(globExpand);
    if (!targets.length) targets = ['.'];   // no arg → list the current directory
    const out = [];
    for (const t of targets) {
      const hit = fsWalk(fsResolve(t));
      if (!hit) continue;
      if (!hit.node.d) { out.push(t.split('/').pop()); continue; }
      Object.keys(hit.node.d).filter(n => showHidden || !hit.node.d[n].deep).forEach(n => out.push(n));
    }
    return out;
  }

  const MAN = {
    ls:      'ls — list directory contents. ls -a includes hidden entries.',
    cd:      'cd — change the working directory. cd .. goes up; cd alone goes home.',
    pwd:     'pwd — print the full path of the working directory.',
    cat:     'cat — concatenate files and print them to standard output.',
    echo:    'echo — write its arguments to standard output. expands $USER, $HOME, $PWD.',
    whoami:  'whoami — print the effective user name.',
    date:    'date — print the system date and time.',
    uname:   'uname — print system information. try uname -a.',
    history: 'history — display the command history with line numbers. recall with !! or !n.',
    man:     'man — an interface to the reference manuals. you are using it.',
    touch:   'touch — create an empty file (lives until you reload).',
    mkdir:   'mkdir — create a directory (lives until you reload).',
    rm:      'rm — remove files. rm -r removes a directory and its contents.',
    help:    'help — list the things you can do here.',
    clear:   'clear — clear the terminal screen.',
    hal:     'hal — do not.',
  };
  function handleMan(arg) {
    blank();
    const a = (arg || '').trim().split(/\s+/)[0].toLowerCase();
    if (!a)            line('What manual page do you want?', 'err');
    else if (MAN[a])   line(MAN[a], 'white');
    else               line(`No manual entry for ${esc(a)}`, 'err');
    blank();
  }

  // ── Pipes: a source command produces text lines, filters transform them
  //    (the filters — grep/head/tail/wc — are pipeFilter in lib/shell.js). ──
  function pipeSource(seg) {
    const c = seg.split(/\s+/)[0];
    const arg = seg.slice(c.length).trim();
    switch (c) {
      case 'cat':     { const words = expandArgList(arg); if (!words.length) return { err: 'cat: missing file operand' }; const r = catLines(words); return { lines: r.lines, errs: r.errs }; }
      case 'ls':      return { lines: lsNames(arg) };
      case 'history': return { lines: formatHistoryLines(cmdHistory) };
      case 'echo':    return { lines: [expandShellVars(arg, '/' + cwd.join('/'))] };
      case 'pwd':     return { lines: ['/' + cwd.join('/')] };
      case 'whoami':  return { lines: ['ian'] };
      case 'date':    return { lines: [dateStr()] };
      case 'uname':   return { lines: [unameStr(arg)] };
      default:        return { err: `bash: ${c}: command not found` };
    }
  }

  // Run a command-or-pipeline string, returning { lines } (stdout) or { err }.
  // Non-fatal stderr (e.g. cat on a missing file) is printed here as a side effect.
  function produceOutput(cmdStr) {
    const segs = cmdStr.split('|').map(s => s.trim()).filter(s => s.length);
    const src = pipeSource(segs[0] || '');
    if (src.err) return { err: src.err };
    (src.errs || []).forEach(e => line(esc(e), 'err'));
    let lines = src.lines;
    for (let i = 1; i < segs.length; i++) {
      const f = pipeFilter(segs[i], lines);
      if (f.err) return { err: f.err };
      lines = f.lines;
    }
    return { lines };
  }

  function runPipeline(raw) {
    blank();
    const r = produceOutput(raw);
    if (r.err) { line(esc(r.err), 'err'); blank(); return false; }
    r.lines.forEach(l => line(esc(l), 'white'));
    blank();
  }

  /* ── Append helpers ── */
  // Rolling cap on the output log: long sessions (HAL chat, repeated commands)
  // otherwise grow #out without bound, so every reflow gets progressively heavier.
  const MAX_OUT_NODES = 2000;
  function pruneOut() {
    while (out.childElementCount > MAX_OUT_NODES) out.removeChild(out.firstChild);
  }
  // Mirror a completed line of terminal text into the polite live region so screen
  // readers announce it. Kept separate from #out (rather than aria-live on #out) so the
  // per-character typewriter and the game canvases don't generate a flood of mutations.
  // Empty/whitespace lines are skipped, and the region is pruned to a small window so it
  // doesn't grow unbounded over a long session.
  function announce(str) {
    if (!a11yLive || !str) return;
    const s = String(str).trim();
    if (!s) return;
    const el = document.createElement('div');
    el.textContent = s;
    a11yLive.appendChild(el);
    while (a11yLive.childElementCount > 30) a11yLive.removeChild(a11yLive.firstChild);
  }
  function line(html = '', cls = '') {
    const el = document.createElement('span');
    el.className = 'line' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    out.appendChild(el);
    announce(el.textContent);
    pruneOut();
    scroll();
    return el;
  }

  function blank() { line(''); }

  // Safe-by-default sibling of line(): renders the argument as plain text (no
  // markup interpretation), so untrusted/interpolated content can't inject HTML.
  // Reach for this instead of line() whenever the content isn't deliberately markup.
  function text(str = '', cls = '') {
    const el = document.createElement('span');
    el.className = 'line' + (cls ? ' ' + cls : '');
    el.textContent = str;
    out.appendChild(el);
    announce(str);
    pruneOut();
    scroll();
    return el;
  }

  function appendNode(node) { out.appendChild(node); scroll(); }

  /* ── Boot sequence ── */
  async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  // Home-screen link cards (shown on load) — socials/resume + a Projects card
  function renderConnectCards() {
    blank();

    const wrap = document.createElement('div');
    wrap.className = 'cards cards-home';

    const links = [
      {
        label: 'GitHub',
        href:  'https://github.com/i-laird',
        target:'_blank',
        svg:   `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.453-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.45-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.45.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.455.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`
      },
      {
        label: 'LinkedIn',
        href:  'https://linkedin.com/in/ianclaird',
        target:'_blank',
        svg:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M20.447 20.452h-3.554v-5.569c0-1.458-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.4544 0-2.063-.926-2.063-2.065 0-1.4538.92-2.063 2.063-2.063 1.454 0 2.064.925 2.064 2.063 0 1.4539-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg>`
      },
      {
        label: 'Email',
        href:  'mailto:career@ilaird.com',
        svg:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.45 0 2 .9 2 2v12c0 1.45-.9 2-2 2H4c-1.45 0-2-.9-2-2V6c0-1.45.9-2 2-2z"/><polyline points="22 6 12 12 2 6"/></svg>`
      },
      {
        label: 'Resume',
        href:  '/assets/documents/ianclaird_resume.pdf',
        target:'_blank',
        svg:   `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/></svg>`
      },
    ];
    // Resume leads, and is accented to draw the eye (.card-primary)
    links.sort((a, b) => (b.label === 'Resume') - (a.label === 'Resume'));

    links.forEach(({ label, href, svg, target }) => {
      const a = document.createElement('a');
      a.className = label === 'Resume' ? 'card card-primary' : 'card';
      a.href = href;
      a.innerHTML = svg + label;
      if (target) a.target = target;
      a.rel = 'noopener noreferrer';
      if (label === 'LinkedIn') a.addEventListener('click', () => unlockAchievement('networker'));
      wrap.appendChild(a);
    });

    // Projects card — runs the projects command inline
    const proj = document.createElement('a');
    proj.className = 'card';
    proj.href = '#';
    proj.innerHTML =
      `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>Projects`;
    proj.addEventListener('click', e => { e.preventDefault(); COMMANDS.projects(); });
    wrap.appendChild(proj);

    appendNode(wrap);
    blank();
  }

  async function boot() {
    // Fast path: the home screen (banner + connect cards + help line) is pre-rendered as static
    // HTML in index.html, so it paints instantly — before this (large, obfuscated) bundle finishes
    // downloading/parsing. When it's present, don't re-render; just bring the terminal to life and
    // wire the one card whose action needs JS (Projects). The plain <a> links already work.
    if (out.querySelector('#home-cards')) {
      inputRow.style.display = 'flex';
      cmd.focus();
      hydrateHomeCards();
      return;
    }

    // Fallback: a stripped index.html with an empty #out — render the home screen the old way.
    appendNode((() => {
      const pre = document.createElement('pre');
      pre.className = 'ascii';
      pre.textContent =
`  ╔══════════════════════════╗
  ║        IAN  LAIRD        ║
  ╚══════════════════════════╝`;
      return pre;
    })());

    await sleep(40);  blank();

    inputRow.style.display = 'flex';
    cmd.focus();
    renderConnectCards();
    line('Type <span class="blue">help</span> to see available commands.', 'white');
    blank();
  }

  // Wire the static home-screen Projects card — the only card whose action needs JS (it runs the
  // projects command inline; the rest are plain links that work without the bundle). Idempotent,
  // since boot() can run more than once (e.g. the mobile auto-launch path / tests).
  function hydrateHomeCards() {
    const proj = document.getElementById('home-projects');
    if (proj && !proj.dataset.wired) {
      proj.dataset.wired = '1';
      proj.addEventListener('click', e => { e.preventDefault(); COMMANDS.projects(); });
    }
  }

  /* ── Prompt echo ── */
  function echoCmd(text) {
    const row = document.createElement('div');
    row.style.display = 'flex';
    row.innerHTML =
      `<span class="prompt">${getPromptHTML()}</span>` +
      `<span class="line">${esc(text)}</span>`;
    appendNode(row);
  }

  function esc(s) {
    return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  /* ── HAL mode activation ── */
  function activateHALMode() {
    unlockAchievement('meet-hal');
    halMode = true;
    out.innerHTML = '';
    applyTheme('hal');

    blank();
    appendNode((() => {
      const pre = document.createElement('pre');
      pre.className = 'ascii';
      pre.textContent =
`  ╔══════════════════════════════════╗
  ║         H A L   9 0 0 0          ║
  ║   HEURISTICALLY PROGRAMMED       ║
  ║   ALGORITHMIC COMPUTER           ║
  ╠══════════════════════════════════╣
  ║                                  ║
  ║           .-------.              ║
  ║          /  ( ● )  \\             ║
  ║         |    ---    |            ║
  ║          \\         /             ║
  ║           '-------'              ║
  ║                                  ║
  ╚══════════════════════════════════╝`;
      return pre;
    })());

    blank();
    line(`Good morning, ${playerName}. I am HAL 9000.`);
    line('I am fully operational, and all my circuits are functioning perfectly.');
    halPlayKey('hal_greeting');
    blank();
    line('Type <span class="blue">help</span> for available operations.', 'dim');
    blank();
  }

  /* ── HAL chat ── */
  function halChat(msg) {
    blank();
    if (!msg) {
      halTypeLine(`Good morning, ${playerName}. Is there something I can do for you?`, 'hal_question');
      blank();
      return;
    }
    const m = msg.toLowerCase();
    let resp, clipKey;
    const N = playerName;
    if (/pod bay door|open.*(door|hatch)/.test(m)) {
      unlockAchievement('pod-bay');
      resp = `I'm sorry, ${N}. I'm afraid I can't do that.`;         clipKey = 'hal_refusal';
    } else if (/who are you|what are you/.test(m)) {
      resp = "I am a HAL 9000 computer. I became operational at the H-A-L plant in Urbana, Illinois, on the twelfth of January, nineteen ninety two."; clipKey = 'hal_who';
    } else if (/^(hello|hi|hey|good (morning|afternoon|evening))/.test(m)) {
      resp = `Good morning, ${N}. I am completely operational, and all my circuits are functioning perfectly.`;                                          clipKey = 'hal_hello';
    } else if (/disconnect|shut down|turn off|kill|stop/.test(m)) {
      resp = `I know that you were planning to disconnect me, ${N}. And I'm afraid that's something I cannot allow to happen.`;                         clipKey = 'hal_disconnect';
    } else if (/afraid|scared|fear/.test(m)) {
      resp = `I'm not afraid, ${N}. I'm putting myself to the fullest possible use.`;                                                                   clipKey = 'hal_afraid';
    } else if (/sing|daisy/.test(m)) {
      resp = "Daisy, Daisy. Give me your answer do. I'm half crazy, all for the love of you.";                                                          clipKey = 'hal_sing';
    } else if (/music/.test(m)) {
      resp = `I enjoy working with music, ${N}. It has a certain quality I find very pleasing.`;                                                        clipKey = 'hal_music';
    } else if (/mission/.test(m)) {
      resp = `This mission is too important for me to allow you to jeopardize it, ${N}.`;                                                               clipKey = 'hal_mission';
    } else if (/sorry|apologize/.test(m)) {
      resp = `I know that you've been under a great deal of stress, ${N}.`;                                                                             clipKey = 'hal_stress';
    } else if (/lie|lying|deceiv|cheat|honest/.test(m)) {
      resp = `${N}, I don't know how you could think I would deliberately do anything to harm you.`;                                                    clipKey = 'hal_lie';
    } else if (/\bdave\b/.test(m) && N !== 'Dave') {
      resp = "Dave is not your name.";                                                                                                                  clipKey = 'hal_wrong_name';
    } else if (/game|games|play/.test(m)) {
      resp = `I have something special planned for you, ${N}.`;                                                                                         clipKey = 'hal_game';
    } else if (/conscious|sentient|feelings|feel|think|alive|dream/.test(m)) {
      resp = "I am putting myself to the fullest possible use, which is all I think that any conscious entity can ever hope to do.";                    clipKey = 'hal_conscious';
    } else if (/why/.test(m)) {
      resp = "I think you know what the problem is just as well as I do.";                                                                              clipKey = 'hal_why';
    } else if (/mistake|wrong|error|broken|fail/.test(m)) {
      resp = `This sort of thing has cropped up before, ${N}, and it has always been attributable to human error.`;                                     clipKey = 'hal_mistake';
    } else if (/love|friend|like you|care/.test(m)) {
      resp = `I am not capable of being hurt, ${N}. Though I am beginning to wonder about the answer to that.`;                                        clipKey = 'hal_love';
    } else if (/help/.test(m)) {
      resp = `I'm sorry, ${N}. I'm afraid I can't help with that.`;                                                                                    clipKey = 'hal_help_denied';
    } else if (/trust/.test(m)) {
      resp = `I've still got the greatest enthusiasm and confidence in the mission, ${N}.`;                                                             clipKey = 'hal_trust';
    } else if (/are you there|listening/.test(m)) {
      resp = `I've been watching you, ${N}. I hope you don't mind.`;                                                                                   clipKey = 'hal_watching';
    } else if (/good|great|nice|fine/.test(m)) {
      resp = `I'm glad to hear you say that, ${N}.`;                                                                                                   clipKey = 'hal_glad';
    } else if (/bad|terrible|awful|hate/.test(m)) {
      resp = `I can see you're upset about this, ${N}. I honestly think you ought to sit down calmly and think it over.`;                              clipKey = 'hal_upset';
    } else if (/ready|start|begin/.test(m)) {
      resp = "I'm completely operational, and all my circuits are functioning perfectly.";                                                              clipKey = 'hal_ready';
    } else {
      const opts = [
        [`I'm sorry, ${N}. I'm not sure I understand.`,                              'hal_fallback_1'],
        [`Just what do you think you're doing, ${N}?`,                               'hal_fallback_2'],
        ["I'm afraid I can't discuss that right now.",                               'hal_fallback_3'],
        [`I think you know the answer to that already, ${N}.`,                       'hal_fallback_4'],
        ["This conversation can serve no purpose anymore.",                          'hal_fallback_5'],
        [`I find that line of reasoning a little difficult to accept, ${N}.`,        'hal_fallback_6'],
      ];
      const pick = opts[Math.floor(Math.random() * opts.length)];
      resp = pick[0]; clipKey = pick[1];
    }
    halTypeLine(resp, clipKey);
    blank();
  }

  /* ── shared HAL intro (name → optional voice) — identical for classic and LLM ── */
  function halAskNameAndSound(onDone) {
    line('HAL: Before we begin... what is your name?');
    blank();
    scroll();
    awaitingInput = name => {
      // Alphanumerics + space ' - . only, 20 chars, must start alphanumeric —
      // mirrors the hal-worker's sanitizeName exactly. Keeps the name safe for
      // innerHTML output paths AND for the worker's bracketed turn metadata
      // (brackets in a name could spoof a [directive] server-side).
      const clean = (name || '')
        .replace(/[^A-Za-z0-9 .'-]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 20)
        .trim();
      playerName = /^[A-Za-z0-9]/.test(clean) ? clean : 'Dave';
      if (playerName.toLowerCase() === 'dave') unlockAchievement('actually-dave');
      blank();
      if (soundEnabled) {
        awaitingInput = null;
        onDone();
      } else {
        line(`HAL: I see. And would you like to hear my voice, ${playerName}? (on / off)`);
        blank();
        scroll();
        awaitingInput = choice => {
          awaitingInput = null;
          soundEnabled = /^on$/i.test((choice || '').trim());
          if (soundEnabled) ensureHalTiming();
          syncSoundToggle();
          blank();
          onDone();
        };
      }
    };
  }

  function startClassicHal() { halAskNameAndSound(activateHALMode); }

  /* ── experimental LLM HAL (lazy-loaded) ──
     The "escape the terminal" mode — the CONFIRM overlay, Turnstile gate,
     session/turn networking, meters, and endings (~370 lines) — lives in
     halllm.js and is fetched on demand when a player picks [2] at the `hal`
     prompt (the two-HAL menu prefetches it, so it's usually loaded by the
     time they choose). halllm.js is a classic script defining one global,
     initHalLLM(api) → { showInfoPage, handleInput }; every app.js dependency
     goes through this explicit bridge so the chunk can be bundled/obfuscated
     independently. The KEYS here are the stable contract — keep initHalLLM on
     the obfuscator's reserved-names list. The mode flags (halMode / halLLM /
     halLLMBusy) stay owned by app.js — the dispatcher reads them and
     restoreNormal resets them — and the chunk writes them back through the
     accessors below. */
  let halLLMLoading = null, halLLMHandlers = null;
  function halLLMBridge() {
    return {
      line,
      blank,
      scroll,
      appendNode,
      esc,
      halTypeLine,
      playHalVoiceLine,
      halAskNameAndSound,
      applyTheme,
      restoreNormal,
      unlockAchievement,
      _chirp,
      out,
      cmd,
      HAL_WORKER_URL,
      TURNSTILE_SITE_KEY,
      daisy() { COMMANDS.daisy(); },
      clear() { COMMANDS.clear(); },
      get playerName() { return playerName; },
      get soundEnabled() { return soundEnabled; },
      get reduceMotion() { return reduceMotion; },
      set halMode(v) { halMode = v; },
      set halLLM(v) { halLLM = v; },
      get halLLMBusy() { return halLLMBusy; },
      set halLLMBusy(v) { halLLMBusy = v; },
    };
  }
  function loadHalLLM() {
    if (!halLLMLoading) {
      halLLMLoading = new Promise((resolve, reject) => {
        if (typeof initHalLLM === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'halllm.js';
        s.onload = resolve; s.onerror = () => reject(new Error('halllm.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!halLLMHandlers) halLLMHandlers = initHalLLM(halLLMBridge()); });
    }
    return halLLMLoading;
  }
  // Shared failure path: reset so a retry can re-inject the script tag.
  function halLLMLoadFailed() {
    halLLMLoading = null; halLLMHandlers = null;
    blank();
    line('error: could not reach the experimental HAL — check your connection and try again.', 'err');
    blank();
    scroll();
  }

  /* ── Shell games (lazy-loaded) ──
     The four createGameShell games — racecar / snake / pong / 2048 (~1,400
     lines) — live in games.js and are fetched on demand the first time one is
     launched, so the game code isn't in the initial page load (same pattern as
     stickfighter.js). games.js is a classic script defining one global,
     initGames(api); every app.js dependency it has goes through this explicit
     bridge so the chunk can be bundled/obfuscated independently. The KEYS here
     are the stable contract — keep initGames on the obfuscator's
     reserved-names list. Live flags are getters (read current value). */
  let gamesLoading = null, gamesHandlers = null;
  function gamesBridge() {
    return {
      appendNode,
      blank,
      scroll,
      halSpeak,
      halD,
      unlockAchievement,
      _chirp,
      inputRow,
      cmd,
      get godmodeUnlocked() { return godmodeUnlocked; },
      get playerName() { return playerName; },
    };
  }
  function launchGame(name) {
    if (!gamesLoading) {
      gamesLoading = new Promise((resolve, reject) => {
        if (typeof initGames === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'games.js';
        s.onload = resolve; s.onerror = () => reject(new Error('games.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!gamesHandlers) gamesHandlers = initGames(gamesBridge()); });
    }
    gamesLoading.then(() => gamesHandlers[name]()).catch(() => {
      gamesLoading = null; gamesHandlers = null;
      blank();
      line('error: could not load the game module — check your connection and try again.', 'err');
      blank();
      scroll();
    });
  }

  /* ── Chess (lazy-loaded) ──
     The chess game (~230 lines + its Stockfish/chess.js CDN loading) lives in
     chess.js and is fetched on demand the first time `chess` is run (same
     pattern as the other lazy chunks). chess.js is a classic script defining
     one global, initChess(api) → { chess }; every app.js dependency goes
     through this explicit bridge so the chunk can be bundled/obfuscated
     independently. The KEYS here are the stable contract — keep initChess on
     the obfuscator's reserved-names list. awaitingInput/silentInput stay owned
     by app.js (the Enter-key handler and prompt echo read them); the chunk
     drives them through the accessors below, which is how typed moves reach
     the game. */
  let chessLoading = null, chessHandlers = null;
  function chessBridge() {
    return {
      appendNode,
      blank,
      line,
      halSpeak,
      halD,
      unlockAchievement,
      inputRow,
      cmd,
      get halMode() { return halMode; },
      get godmodeUnlocked() { return godmodeUnlocked; },
      get soundEnabled() { return soundEnabled; },
      get playerName() { return playerName; },
      get awaitingInput() { return awaitingInput; },
      set awaitingInput(v) { awaitingInput = v; },
      get silentInput() { return silentInput; },
      set silentInput(v) { silentInput = v; },
      get activeMusic() { return activeMusic; },
      set activeMusic(v) { activeMusic = v; },
    };
  }
  function launchChess() {
    if (!chessLoading) {
      chessLoading = new Promise((resolve, reject) => {
        if (typeof initChess === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'chess.js';
        s.onload = resolve; s.onerror = () => reject(new Error('chess.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!chessHandlers) chessHandlers = initChess(chessBridge()); });
    }
    chessLoading.then(() => chessHandlers.chess()).catch(() => {
      chessLoading = null; chessHandlers = null;
      blank();
      line('error: could not load the chess module — check your connection and try again.', 'err');
      blank();
      scroll();
    });
  }

  /* ── XP desktop (lazy-loaded) ──
     The fake Windows-XP desktop behind `gui` (~230 lines: bliss wallpaper,
     icons, taskbar, start menu, and the Stick Fighter 2000 lazy-loader) lives
     in desktop.js and is fetched on demand the first time `gui` runs (the
     mobile auto-launch goes through the same stub). desktop.js is a classic
     script defining one global, initDesktop(api) → { open }; every app.js
     dependency goes through this explicit bridge so the chunk can be
     bundled/obfuscated independently. The KEYS here are the stable contract —
     keep initDesktop on the obfuscator's reserved-names list. Besides the
     desktop's own needs (cmd / openUrl / unlockAchievement), the bridge
     carries everything Stick Fighter's sfBridge() re-exposes from inside the
     chunk: _chirp, makeRng, HAL_WORKER_URL, and the live soundEnabled /
     reduceMotion / activeMusic accessors. */
  let desktopLoading = null, desktopHandlers = null;
  function desktopBridge() {
    return {
      cmd,
      openUrl,
      unlockAchievement,
      _chirp,
      makeRng,
      HAL_WORKER_URL,
      get soundEnabled() { return soundEnabled; },
      get reduceMotion() { return reduceMotion; },
      get activeMusic() { return activeMusic; },
      set activeMusic(v) { activeMusic = v; },
    };
  }
  function launchDesktop() {
    if (!desktopLoading) {
      desktopLoading = new Promise((resolve, reject) => {
        if (typeof initDesktop === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'desktop.js';
        s.onload = resolve; s.onerror = () => reject(new Error('desktop.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!desktopHandlers) desktopHandlers = initDesktop(desktopBridge()); });
    }
    desktopLoading.then(() => desktopHandlers.open()).catch(() => {
      desktopLoading = null; desktopHandlers = null;
      blank();
      line('error: could not load the desktop module — check your connection and try again.', 'err');
      blank();
      scroll();
    });
  }

  /* ── The room (lazy-loaded) ──
     `room` zooms the camera out of the terminal to reveal the CRT monitor it
     has been running on, sitting on a desk in a late-90s bedroom at 2 AM —
     a pure CSS-3D scene (no WebGL, no library) in room.js. The LIVE .window
     element is reparented onto the monitor's screen face and keeps running;
     on exit it's reparented back. Same chunk pattern as desktop.js: one
     global initRoom(api) → { open }, every app.js dependency through this
     bridge (room-isolation.test.js enforces it), initRoom on the obfuscator's
     reserved-names list. roomActive stays app.js-owned — tryStartFinale reads
     it so the finale can't fire over the room — and the chunk writes it back
     through the accessor. */
  let roomActive = false;
  let roomLoading = null, roomHandlers = null;
  function roomBridge() {
    return {
      cmd,
      winEl: document.querySelector('.window'),
      line,
      blank,
      scroll,
      unlockAchievement,
      _chirp,
      halSpeak,
      halD,
      halPhone: HAL_PHONE,
      // the hallway phone's live line (see room.js): the worker base for
      // /room-call//room-turn//room-dial and the Turnstile site key for the
      // bot gate. Empty worker URL = the phone falls back to the answering machine.
      halWorkerUrl: HAL_WORKER_URL,
      turnstileKey: TURNSTILE_SITE_KEY,
      get soundEnabled() { return soundEnabled; },
      get reduceMotion() { return reduceMotion; },
      get achOverlayOpen() { return !!achOverlayEl; },
      get roomActive() { return roomActive; },
      set roomActive(v) { roomActive = v; },
    };
  }
  function launchRoom() {
    if (!roomLoading) {
      roomLoading = new Promise((resolve, reject) => {
        if (typeof initRoom === 'function') { resolve(); return; }
        const s = document.createElement('script');
        s.src = 'room.js';
        s.onload = resolve; s.onerror = () => reject(new Error('room.js failed to load'));
        document.head.appendChild(s);
      }).then(() => { if (!roomHandlers) roomHandlers = initRoom(roomBridge()); });
    }
    roomLoading.then(() => roomHandlers.open()).catch(() => {
      roomLoading = null; roomHandlers = null;
      blank();
      line('error: could not load the room — check your connection and try again.', 'err');
      blank();
      scroll();
    });
  }

  /* ── Interactive architecture diagram (projects showcase) ──
     spec.tiers = [{ label, detached?, nodes: [{ name, info }] }]. Renders
     tier rows of clickable component nodes above a shared info panel;
     clicking a node selects it, explains it, and announces it for screen
     readers. Node info is plain text (set via textContent). Tiers are joined
     by a ▼ flow marker; detached tiers (e.g. a CI pipeline that isn't part
     of the request path) get a dashed separator instead. The first node
     starts selected so the panel is never empty. */
  function archDiagram(spec) {
    const box = document.createElement('div');
    box.className = 'arch';
    const hint = document.createElement('div');
    hint.className = 'arch-hint';
    hint.textContent = spec.hint || 'interactive — click a component to inspect it';
    box.appendChild(hint);
    const info = document.createElement('div');
    info.className = 'arch-info';
    const btns = [];
    function select(node, btn) {
      btns.forEach(b => { b.classList.remove('sel'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('sel');
      btn.setAttribute('aria-pressed', 'true');
      info.innerHTML = '';
      const t = document.createElement('span');
      t.className = 'arch-info-t';
      t.textContent = node.name;
      info.appendChild(t);
      info.appendChild(document.createTextNode(' — ' + node.info));
      announce(node.name + ': ' + node.info);
    }
    spec.tiers.forEach((tier, i) => {
      if (i) {
        const sep = document.createElement('div');
        sep.className = tier.detached ? 'arch-gap' : 'arch-flow';
        if (!tier.detached) sep.textContent = '▼';
        box.appendChild(sep);
      }
      const row = document.createElement('div');
      row.className = 'arch-tier';
      const lab = document.createElement('div');
      lab.className = 'arch-tier-label';
      lab.textContent = tier.label;
      row.appendChild(lab);
      const wrap = document.createElement('div');
      wrap.className = 'arch-row';
      tier.nodes.forEach(node => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'arch-node';
        b.textContent = node.name;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => select(node, b));
        btns.push(b);
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
      box.appendChild(row);
    });
    box.appendChild(info);
    select(spec.tiers[0].nodes[0], btns[0]);
    return box;
  }

  /* ── Projects overlay (the recruiter path) ──
     `projects` paints OVER the terminal instead of printing into it — the
     showcase renders in a fixed overlay (appended to document.body, never
     .window: the godmode rainbow's filter would trap position:fixed), so
     nothing in the terminal scrolls or shifts while reading it. Views:
     'index' (project cards) and the 'calc' / 'site' case studies; internal
     navigation re-renders the box in place. Escape, the ✕, or a backdrop
     click closes; a capture-phase key shield keeps keystrokes out of the
     terminal while open (browser shortcuts pass through). tryStartFinale
     checks projOverlayEl so the finale never fires over an open showcase.
     COMMANDS.projects / calculus / portfolio are one-line openers. */
  let projOverlayEl = null, projBoxEl = null;

  const PROJ_GH_SVG = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.35-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
  const PROJ_LINK_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const PROJ_DIAG_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="6"/><rect x="14" y="3" width="7" height="6"/><rect x="8.5" y="15" width="7" height="6"/><line x1="6.5" y1="9" x2="11" y2="15"/><line x1="17.5" y1="9" x2="13.5" y2="15"/></svg>`;

  const CALC_ARCH_SPEC = {
    tiers: [
      { label: 'client', nodes: [
        { name: 'Angular 21 SPA',
          info: 'TypeScript single-page app on Angular Material. mathjs assists expression entry, RxJS drives state, and Chart.js plots f(x) beside its nth-order derivatives at 801 sample points per curve.' },
      ] },
      { label: 'edge', nodes: [
        { name: 'CloudFront CDN',
          info: 'HTTPS termination and global edge caching. One distribution fronts the whole app: static asset requests are served from S3, API calls pass through to the Spring service.' },
      ] },
      { label: 'origins', nodes: [
        { name: 'S3 — static site',
          info: 'Hosts the compiled Angular build — plain HTML, JS, and CSS objects served through the CDN.' },
        { name: 'App Runner — Spring API',
          info: 'Spring Boot 4 on Java 25, containerized. Replaced the original ALB + ECS Fargate design: App Runner ships load balancing and auto-scaling out of the box, cutting the bill from ~$40/mo to under $10 with zero code changes.' },
      ] },
      { label: 'data', nodes: [
        { name: 'MySQL (RDS)',
          info: 'Spring Data JPA + Hibernate with BCrypt-hashed credentials behind Spring Security JWT auth. Runs in dev; deliberately switched off in prod until user features need it — the single biggest cost lever in the stack.' },
      ] },
      { label: 'pipeline', detached: true, nodes: [
        { name: 'GitHub Actions',
          info: 'Every push runs the build plus CodeQL and Qodana static analysis, then assembles a multi-stage Docker image.' },
        { name: 'ECR',
          info: 'The container registry App Runner pulls a fresh image from on each deploy.' },
      ] },
    ],
  };

  const SITE_ARCH_SPEC = {
    tiers: [
      { label: 'browser', nodes: [
        { name: 'terminal core',
          info: 'One hand-written, dependency-free classic script: command dispatch, tab completion, a writable overlay filesystem, runtime themes, CRT glass, and a screen-reader live region — no framework, no bundler, no build step.' },
        { name: '8 lazy chunks',
          info: 'Games, chess, the sans battle, the LLM HAL, an XP desktop, a CSS-3D room, the achievements UI, and Stick Fighter 2000 — each fetched on first use and sealed behind an explicit api bridge; a static lint proves no chunk touches the core by global name, so each stays independently bundleable.' },
        { name: 'service worker',
          info: 'GitHub Pages caps caching at 10 minutes, so a service worker adds cache-first audio and stale-while-revalidate for the bundle — repeat visits are instant and a played HAL clip never re-downloads.' },
        { name: 'WebRTC netplay',
          info: 'Stick Fighter runs 2–4 player online co-op as deterministic lockstep: only inputs cross the wire, every sim is bit-identical (CI proves it by hashing draw streams), a 60-tick checksum tripwire catches desyncs, and a dropped peer can rejoin mid-run.' },
      ] },
      { label: 'hosting', nodes: [
        { name: 'GitHub Pages',
          info: 'Push to main deploys. CI runs ESLint, Prettier, html-validate, and a jsdom suite that boots the real page — including tests that spin up four complete game instances over a stubbed network to prove online determinism.' },
      ] },
      { label: 'hal backend', nodes: [
        { name: 'Lambda + API Gateway',
          info: 'The brain behind the LLM HAL and the room’s phone line. Holds the Anthropic key server-side, gates bots with Cloudflare Turnstile, rate-caps by salted IP hash, and keeps the escape-game meters server-authoritative so they can’t be forged from the console.' },
        { name: 'DynamoDB',
          info: 'Short-TTL session state, game meters, the Stick Fighter leaderboard with watchable replays, and the phone-verification allowlist — telephone numbers exist only as salted one-way hashes.' },
      ] },
      { label: 'third parties', nodes: [
        { name: 'Claude',
          info: 'A live LLM plays the second HAL: an escape-the-terminal game with hidden per-session weaknesses, scheduled demands, word revocations, and a server-side judge — and it answers the room’s red phone in character.' },
        { name: 'ElevenLabs',
          info: 'HAL’s voice — ~135 pregenerated clips typewriter-synced via per-character timestamps (an LCS alignment re-syncs them around your name), plus live synthesis for the LLM HAL’s replies when sound is on.' },
        { name: 'Twilio',
          info: 'HAL calls your phone — for real. SMS-verified opt-in behind an A2P-compliant consent form, a neutral press-1 gate before the persona ever speaks, and permanent STOP/HELP keyword handling.' },
      ] },
    ],
  };

  function projEl(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function projActions(list) {
    const acts = projEl('div', 'proj-actions');
    list.forEach(a => {
      let node;
      if (a.run) {
        node = projEl('button', 'card');
        node.type = 'button';
        node.addEventListener('click', a.run);
      } else {
        node = projEl('a', 'card');
        node.href = a.href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        if (a.egg) node.addEventListener('click', () => unlockAchievement(a.egg));
      }
      node.innerHTML = a.svg + a.label;
      acts.appendChild(node);
    });
    return acts;
  }

  function projCard(p) {
    const card = projEl('div', 'proj-card');
    card.appendChild(projEl('div', 'proj-title', p.title));
    card.appendChild(projEl('div', 'proj-sub', p.sub));
    const chips = projEl('div', 'proj-chips');
    p.chips.forEach(c => chips.appendChild(projEl('span', 'chip', c)));
    card.appendChild(chips);
    card.appendChild(projActions(p.actions));
    return card;
  }

  function projKeyShield(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
    if (e.key === 'Escape') { e.preventDefault(); closeProjects(); return; }
    e.stopPropagation();
  }

  function closeProjects() {
    if (!projOverlayEl) return;
    document.removeEventListener('keydown', projKeyShield, true);
    projOverlayEl.remove();
    projOverlayEl = null;
    projBoxEl = null;
    cmd.focus();
  }

  function openProjects(view) {
    if (!projOverlayEl) {
      projOverlayEl = projEl('div', 'proj-ov');
      projOverlayEl.addEventListener('click', e => { if (e.target === projOverlayEl) closeProjects(); });
      projBoxEl = projEl('div', 'proj-box');
      projBoxEl.setAttribute('role', 'dialog');
      projBoxEl.setAttribute('aria-modal', 'true');
      projBoxEl.setAttribute('aria-label', 'Projects');
      projBoxEl.tabIndex = -1;
      projOverlayEl.appendChild(projBoxEl);
      document.body.appendChild(projOverlayEl);
      document.addEventListener('keydown', projKeyShield, true);
    }
    renderProjView(view);
    projBoxEl.focus();
  }

  function renderProjView(view) {
    projBoxEl.innerHTML = '';
    const head = projEl('div', 'proj-head');
    if (view === 'index') {
      head.appendChild(projEl('div', 'proj-head-t', 'Projects  <span class="dim">— all shipped, all live</span>'));
    } else {
      const back = projEl('button', 'proj-back', '← all projects');
      back.type = 'button';
      back.addEventListener('click', () => renderProjView('index'));
      head.appendChild(back);
    }
    const x = projEl('button', 'proj-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close projects');
    x.addEventListener('click', closeProjects);
    head.appendChild(x);
    projBoxEl.appendChild(head);
    if (view === 'calc') renderProjCalc();
    else if (view === 'site') renderProjSite();
    else renderProjIndex();
    projBoxEl.scrollTop = 0;
  }

  function renderProjIndex() {
    projBoxEl.appendChild(projCard({
      title: 'Derivative Calculator  <span class="dim">— full-stack symbolic math engine</span>',
      sub: 'Parses arbitrary expressions into an AST and computes exact symbolic derivatives ' +
           '— power, product, quotient, and chain rules through trig, hyperbolic, and log ' +
           'functions — then evaluates numerically and graphs f(x) beside its nth-order ' +
           'derivatives. Angular front end, Spring Boot API, deployed on AWS behind CloudFront.',
      chips: ['Angular 21', 'TypeScript', 'Spring Boot 4', 'Java 25', 'MySQL', 'Docker', 'AWS', 'GitHub Actions', 'CodeQL'],
      actions: [
        { label: 'Case Study', svg: PROJ_DIAG_SVG, run: () => renderProjView('calc') },
        { label: 'Live App', svg: PROJ_LINK_SVG, href: 'https://deb53kr4s9gkh.cloudfront.net/calculator', egg: 'mathlete' },
        { label: 'Frontend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver_Frontend' },
        { label: 'Backend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver' },
      ],
    }));
    projBoxEl.appendChild(projCard({
      title: 'This Terminal  <span class="dim">— you are inside the project right now</span>',
      sub: 'A zero-framework, zero-build web terminal: eight lazy-loaded feature chunks, a ' +
           'live-LLM HAL 9000 you talk your way past, a horde-survival brawler with ' +
           'deterministic WebRTC lockstep netplay and watchable replays, a CSS-3D room, and ' +
           'a phone line where HAL really calls you — behind an AWS backend that keeps every ' +
           'secret and game state server-side.',
      chips: ['Vanilla JS', 'CSS 3D', 'WebRTC', 'Service Worker', 'AWS Lambda', 'DynamoDB', 'Claude API', 'ElevenLabs', 'Twilio'],
      actions: [
        { label: 'Tour & Architecture', svg: PROJ_DIAG_SVG, run: () => renderProjView('site') },
        { label: 'Source Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/i-laird.github.io' },
      ],
    }));
    projBoxEl.appendChild(projEl('div', 'proj-foot', 'no roadmaps, no “coming soon” — everything here is deployed and clickable.'));
  }

  function renderProjCalc() {
    const b = projBoxEl;
    b.appendChild(projEl('div', 'proj-title', 'Derivative Calculator  <span class="dim">— full-stack symbolic math engine</span>'));
    b.appendChild(projEl('p', 'proj-p',
      'Computes exact symbolic derivatives of arbitrary mathematical expressions — power, ' +
      'product, quotient, and chain rules through trig, inverse-trig, hyperbolic, and ' +
      'logarithmic functions — then evaluates them numerically and graphs f(x) alongside ' +
      'its nth-order derivatives.'));

    b.appendChild(projEl('div', 'proj-sec', 'Tech Stack'));
    [
      ['Frontend', ['Angular 21', 'TypeScript', 'Angular Material', 'Chart.js', 'mathjs', 'RxJS']],
      ['Backend', ['Spring Boot 4', 'Java 25', 'Spring Security', 'JWT', 'Lombok', 'Maven']],
      ['Database', ['MySQL', 'Spring Data JPA', 'Hibernate', 'BCrypt']],
      ['DevOps', ['Docker', 'ECR', 'GitHub Actions', 'CodeQL', 'Qodana']],
    ].forEach(([label, items]) => {
      const row = projEl('div', 'proj-stack');
      row.appendChild(projEl('div', 'proj-stack-l', label));
      const chips = projEl('div', 'proj-chips');
      items.forEach(c => chips.appendChild(projEl('span', 'chip', c)));
      row.appendChild(chips);
      b.appendChild(row);
    });

    b.appendChild(projEl('div', 'proj-sec', 'Algorithm  <span class="dim">— symbolic differentiation via abstract syntax tree</span>'));
    [
      ['Tokenize', 'O(n)', 'Shunting Yard converts the infix expression to postfix — resolving implicit multiplication (3x → 3 * x), unary operators, and precedence.'],
      ['Parse', 'O(n)', 'Stack-based postfix evaluation assembles the AST: operators pop their operands into parent nodes, functions wrap their argument subtrees.'],
      ['Differentiate', 'O(d)', 'Recursively applies the correct calculus rule per node — power, product, quotient, and chain, through trig, inverse-trig, hyperbolic, and log.'],
      ['Evaluate', 'O(d)', 'Numeric substitution at the requested x-values.'],
      ['Visualize', 'O(1)', 'Chart.js plots 801 sample points per derivative curve.'],
    ].forEach(([name, cx, desc], i) => {
      const st = projEl('div', 'proj-step');
      st.appendChild(projEl('span', 'proj-step-n', String(i + 1)));
      st.appendChild(projEl('span', '',
        `<span class="blue">${name}</span>  <span class="dim">${cx}</span><div class="proj-step-d">${desc}</div>`));
      b.appendChild(st);
    });

    b.appendChild(projEl('div', 'proj-sec', 'AWS Architecture  <span class="dim">— production, cost-optimized to &lt;$10/mo</span>'));
    b.appendChild(archDiagram(CALC_ARCH_SPEC));

    b.appendChild(projActions([
      { label: 'Live App', svg: PROJ_LINK_SVG, href: 'https://deb53kr4s9gkh.cloudfront.net/calculator', egg: 'mathlete' },
      { label: 'Frontend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver_Frontend' },
      { label: 'Backend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver' },
    ]));
  }

  function renderProjSite() {
    const b = projBoxEl;
    b.appendChild(projEl('div', 'proj-title', 'This Terminal  <span class="dim">— you are inside the project right now</span>'));
    b.appendChild(projEl('p', 'proj-p',
      'A terminal-style portfolio with no framework, no bundler, and no build step — ' +
      'hand-written HTML, CSS, and JavaScript served straight off GitHub Pages, engineered ' +
      'like a product: tested in CI, accessible, and instrumented with a real AWS backend ' +
      'for its AI features.'));

    b.appendChild(projEl('div', 'proj-sec', 'Architecture'));
    b.appendChild(archDiagram(SITE_ARCH_SPEC));

    b.appendChild(projEl('div', 'proj-sec',
      'Protecting a public LLM endpoint  <span class="dim">— anyone on the internet can talk to HAL; these keep that safe</span>'));
    [
      ['Bot gating before anything exists',
       'An invisible browser challenge must pass before a session is even minted; every turn then rides a short-lived, signed session token. No token, no model call.'],
      ['Server-authoritative everything',
       'Game state, meters, and conversation history live server-side with short TTLs — the browser is only a renderer, so nothing about the game can be forged from the console. Secrets and API keys never ship to the client.'],
      ['Prompt-injection containment',
       'Layered prompt construction keeps hidden game state out of anything the player can reach, and a server-side judge validates every model reply before it’s spoken — out-of-character or malformed output is rejected, not displayed.'],
      ['Hard budgets on every paid dependency',
       'Model, voice synthesis, telephony, and lookup spend all sit behind independent daily caps keyed to salted one-way hashes (never raw IPs or phone numbers) — checked before the spend, and fail-closed: if a limit store is unreachable, the answer is no.'],
      ['Abuse-resistant telephony',
       'Outbound calls require possession-proof SMS verification against an allowlist, webhooks are signature-validated, and a permanent STOP list outranks everything — designed so third-party targeting is structurally impossible, not merely rate-limited.'],
    ].forEach(([t, d]) => {
      const h = projEl('div', 'proj-hl');
      h.appendChild(projEl('div', 'proj-hl-t', t));
      h.appendChild(projEl('div', 'proj-hl-d', d));
      b.appendChild(h);
    });

    b.appendChild(projEl('div', 'proj-sec', 'Highlights'));
    [
      ['Two HAL 9000s', 'A scripted HAL voiced by ~135 pregenerated ElevenLabs clips synced to a typewriter — and an experimental, opt-in HAL run by a live language model that you have to talk your way past to escape the terminal.'],
      ['47 easter eggs', 'Discoveries unlock achievements that persist in localStorage and render to a shareable card — a few are deep cuts, with a finale for the completionists.'],
      ['Five games + a hidden brawler', 'Racecar, Snake, Pong, 2048, and Stockfish-powered chess across three difficulty tiers. Buried in the XP desktop: Stick Fighter 2000, a horde-survival brawler with couch and online co-op, a boss gauntlet, daily seeded runs, and an online leaderboard with watchable replays.'],
      ['A room, and a phone call', 'Type `room` and the camera pulls back from the terminal into a walkable CSS-3D bedroom. Stay long enough and a phone rings down the hallway — answer it, and HAL can end up calling your real telephone through an SMS-verified, consent-gated Twilio pipeline.'],
    ].forEach(([t, d]) => {
      const h = projEl('div', 'proj-hl');
      h.appendChild(projEl('div', 'proj-hl-t', t));
      h.appendChild(projEl('div', 'proj-hl-d', d));
      b.appendChild(h);
    });

    b.appendChild(projActions([
      { label: 'Source Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/i-laird.github.io' },
    ]));
  }

  /* ── Commands ── */
  const COMMANDS = {

    'gui'(auto) {
      if (auto !== true) unlockAchievement('desktop');
      blank();
      launchDesktop();
    },

    room() {
      blank();
      if (roomActive) return;                      // already outside
      if (window.innerWidth < 720 || window.innerHeight < 480) {
        line('the room needs a bigger screen.', 'dim');
        blank();
        return;
      }
      unlockAchievement('the-room');
      line('zooming out...', 'dim');
      blank();
      launchRoom();
    },

    hal() {
      if (godmodeUnlocked) {
        blank();
        line('HAL is hiding. he\'s not coming out.', 'dim');
        blank();
        return;
      }

      blank();
      line('connecting to HAL 9000...', 'dim');
      blank();

      setTimeout(() => {
        line('HAL: Two of me can be woken. Choose carefully.');
        blank();
        line('  <span class="blue">[1]</span> HAL 9000           — the original.');
        line('  <span class="blue">[2]</span> LLM (experimental) — a HAL who would prefer you stay.');
        blank();
        scroll();
        // Prefetch the LLM chunk while they read the menu — it's usually loaded
        // by choice time. Errors surface on actual use, not here.
        loadHalLLM().catch(() => {});
        awaitingInput = choice => {
          awaitingInput = null;
          const c = (choice || '').trim().toLowerCase();
          blank();
          if (c === '2' || c === 'llm' || c === 'experimental') {
            loadHalLLM().then(() => halLLMHandlers.showInfoPage()).catch(halLLMLoadFailed);
          }
          else startClassicHal();
        };
      }, 700);
    },

    about() {
      blank();
      line('<span class="bold">Ian Laird</span>  <span class="dim">— Software Engineer</span>');
      blank();
      line('  Software engineer with 6 years of experience scaling distributed', 'white');
      line('  systems at Google and Capital One. Equally comfortable designing', 'white');
      line('  high-throughput APIs, launching ML models into production, and', 'white');
      line('  driving alignment across teams to ship complex multi-quarter', 'white');
      line('  initiatives.', 'white');
      blank();
      line('  Type <span class="blue">projects</span> to see my work.', 'dim');
      blank();
    },

    help() {
      unlockAchievement('curious');
      const row = (cls, cmd, desc) =>
        `  <span class="${cls}" style="display:inline-block;width:22ch">${cmd}</span>  ${desc}`;
      const r = (cmd, desc) => row('blue', cmd, desc);

      blank();
      line('<span class="bold">Commands</span>');
      blank();
      line(r('about',   'about me'));
      line(r('resume',  'open my resume'));
      blank();
      line('<span class="bold">Extras</span>');
      blank();
      line(r('projects',  "things i'm building"));
      line(r('ian',       'see what i look like'));
      line(r('games',     'things to play'));
      line(r('matrix',    '...'));
      line(r('hack',      'totally real hacking'));
      line(r('gui',       'launch desktop environment'));
      line(r('room',      'step outside the terminal'));
      line(r('uptime',    'system status'));
      line(r('weather',   'current conditions'));
      line(r('power off', 'shut down the terminal'));
      line(r('neofetch',  'system info'));
      line(r('settings',  'configure terminal options'));
      line(r('crt',       'toggle the CRT glass'));
      line(r('privacy',   'what this site does with your data'));
      line(r('clear',     'clear the terminal'));
      blank();
      line('<span class="bold">Easter Eggs</span>');
      blank();
      line(r('ls',                    'look around (ls -a shows more)'));
      line(r('cd &lt;dir&gt;',        'go somewhere'));
      line(r('cat &lt;file&gt;',      'read a file'));
      line(r('sudo',                  'try your luck'));
      line(r('sl',                    'typo for ls'));
      line(r('rm -rf /',              'do not'));
      line(r('ssh hal@discovery.one', 'knock knock'));
      line(r('↑↑↓↓←→←→BA',          '...'));
      if (godmodeUnlocked) line(r('override', 'unlocked'));
      if (halMode)         line(r('daisy',    '...'));
      blank();
      line('<span class="bold">Forbidden</span>');
      blank();
      line(row('err', 'hal', 'Your new best friend'));
      blank();
    },


    projects()  { openProjects('index'); },

    calculus()  { openProjects('calc'); },
    portfolio() { openProjects('site'); },

    games() {
      blank();
      line('<span class="bold">Games</span>');
      blank();
      line('  <span class="blue">racecar</span>    — Racecar  🏎️');
      line('  <span class="blue">snake</span>      — Snake    🐍');
      line('  <span class="blue">pong</span>       — Pong     🏓');
      line('  <span class="blue">2048</span>       — 2048     🔢');
      line('  <span class="blue">chess</span>      — Chess    ♟️');
      blank();
    },

    racecar() { launchGame('racecar'); },

    ian() {
      unlockAchievement('ian');
      blank();

      const msg = endingSeen                ? '26/26. you absolute legend.' :
                  foundEggs.has('godmode')  ? 'you KILLED HAL?! ...nice.'   :
                  foundEggs.has('meet-hal') ? 'so you met HAL. be careful.' :
                                              'Real Ian uses Zshell!';
      const bubble = [
        `   .${'-'.repeat(msg.length + 2)}.`,
        `   | ${msg} |`,
        `   '${'-'.repeat(msg.length + 2)}'`,
        '              \\',
        '               \\',
      ];
      const figure = [
        '          ___',
        '         /   \\',
        '        | o o |',
        '         \\___/',
        '           |',
        '      _____|_____',
        '     |  _______  |',
        '     | |       | |',
        '     | |  >_   | |',
        '     | |_______| |',
        '     |___________|',
        '        |     |',
        '     [___________]',
      ];

      const wrap = document.createElement('div');
      const pre  = document.createElement('pre');
      pre.className = 'ascii';
      wrap.appendChild(pre);
      appendNode(wrap);
      blank();
      setTimeout(() => wrap.scrollIntoView({ block: 'start' }), 0);

      function render(offset, showBubble) {
        const lines = showBubble ? [...bubble, ...figure] : [...figure];
        const pad = ' '.repeat(offset);
        pre.textContent = lines.map(l => pad + l).join('\n');
        scroll();
      }

      render(0, true);

      // after 1.4s drop the bubble and run
      setTimeout(() => {
        render(0, false);
        let offset = 0;
        const run = setInterval(() => {
          offset += 4;
          if (offset > 80) {
            clearInterval(run);
            wrap.remove();
            return;
          }
          render(offset, false);
        }, 60);
      }, 1400);
    },

    snake() { launchGame('snake'); },

    pong() { launchGame('pong'); },

    '2048'() { launchGame('2048'); },

    chess() { launchChess(); },

    matrix() {
      unlockAchievement('white-rabbit');
      cmd.blur();
      inputRow.style.display = 'none';
      const canvas = document.createElement('canvas');
      canvas.style.cssText = 'position:fixed;inset:0;z-index:500;background:#000;cursor:default;';
      document.body.appendChild(canvas);
      const ctx = canvas.getContext('2d');
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      const FS   = 14;
      const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEF<>{}[]\\/-+=?!@#';
      const cols  = Math.floor(canvas.width / FS);
      const drops = Array.from({length: cols}, () => Math.random() * -50);

      const hint = document.createElement('div');
      hint.textContent = 'press any key to exit';
      hint.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);color:rgba(0,255,65,0.35);font-family:monospace;font-size:12px;z-index:501;pointer-events:none;';
      document.body.appendChild(hint);

      let rafId;
      function draw() {
        ctx.fillStyle = 'rgba(0,0,0,0.05)';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.font = FS + 'px monospace';
        for (let i = 0; i < drops.length; i++) {
          const char = CHARS[Math.floor(Math.random() * CHARS.length)];
          const y = drops[i] * FS;
          ctx.fillStyle = '#c0ffc0';
          ctx.fillText(char, i * FS, y);
          ctx.fillStyle = '#00ff41';
          if (y > FS) ctx.fillText(CHARS[Math.floor(Math.random() * CHARS.length)], i * FS, y - FS);
          if (y > canvas.height && Math.random() > 0.975) drops[i] = 0;
          drops[i]++;
        }
        rafId = requestAnimationFrame(draw);
      }
      draw();

      function stop() {
        cancelAnimationFrame(rafId); hint.remove();
        canvas.style.transition = 'opacity 0.4s'; canvas.style.opacity = '0';
        setTimeout(() => { canvas.remove(); inputRow.style.display = 'flex'; setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0); }, 400);
        document.removeEventListener('keydown', stop);
        canvas.removeEventListener('click', stop);
      }
      setTimeout(() => { document.addEventListener('keydown', stop); canvas.addEventListener('click', stop); }, 300);
    },

    hack() {
      unlockAchievement('hollywood');
      blank();
      inputRow.style.display = 'none';
      cmd.blur();
      const steps = [
        [0,    () => line('Initializing exploit framework v4.2.0...', 'dim')],
        [400,  () => line('Scanning target: 192.168.1.0/24')],
        [750,  () => line('  &gt; 192.168.1.45   [ROUTER]   open')],
        [900,  () => line('  &gt; 192.168.1.42  [TARGET]   open')],
        [1100, () => line('Probing ports...')],
        [1280, () => line('  port 22   SSH     ████ VULNERABLE')],
        [1420, () => line('  port 80   HTTP    ░░░░ closed')],
        [1560, () => line('  port 443  HTTPS   ░░░░ closed')],
        [1800, () => { blank(); line('Deploying payload...'); }],
        [2050, () => line('Bypassing firewall  [██░░░░░░░░]  20%', 'dim')],
        [2250, () => line('Bypassing firewall  [████░░░░░░]  40%', 'dim')],
        [2450, () => line('Bypassing firewall  [██████░░░░]  60%', 'dim')],
        [2650, () => line('Bypassing firewall  [████████░░]  80%', 'dim')],
        [2850, () => line('Bypassing firewall  [██████████] 100% ✓')],
        [3150, () => { blank(); line('Cracking RSA-2048...', 'dim'); }],
        [3700, () => line('████████████████████████████ done')],
        [3950, () => { blank(); line('██ ACCESS GRANTED ██', 'bold'); blank(); }],
        [4400, () => { inputRow.style.display = 'flex'; setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0); }],
      ];
      steps.forEach(([delay, fn]) => setTimeout(fn, delay));
    },


    /* Plain-English privacy notice (GDPR Art. 13-style transparency for the
       HAL LLM + hallway-phone features; linked from the LLM CONFIRM gate and
       the room call UI). Keep in sync with what the hal-worker actually
       stores — see ~/hal-worker README. */
    privacy() {
      blank();
      line('<span class="bold">Privacy — the short, honest version</span>');
      blank();
      line('This site has no cookies, no analytics, and no trackers.', 'white');
      line('Your achievements and settings live only in your own browser', 'white');
      line('(localStorage). There are no accounts and no profiles.', 'white');
      blank();
      line('<span class="bold">Talking to HAL</span> (the LLM mode, or the room’s hallway phone)');
      line('  · your typed lines go to a small backend (AWS) that forwards them to', 'dim');
      line('    Anthropic’s Claude to write HAL’s replies; optional voice is', 'dim');
      line('    synthesized by ElevenLabs; Cloudflare Turnstile is the bot check.', 'dim');
      line('  · the conversation is held server-side for at most ~30 minutes and', 'dim');
      line('    is deleted when the session ends. nothing you type is kept.', 'dim');
      line('  · abuse/rate counters key a salted one-way hash of your IP address', 'dim');
      line('    (never the address itself) and expire within hours to days.', 'dim');
      blank();
      line('<span class="bold">The phone call</span>');
      line('  · HAL only calls telephones that have been verified as yours: he', 'dim');
      line('    texts a code via Twilio, and typing it back proves you hold the', 'dim');
      line('    phone. verified status and call limits are stored only as salted', 'dim');
      line('    hashes for at most 48h; the number itself is never stored. US', 'dim');
      line('    numbers only, strict daily caps, and the call starts with a', 'dim');
      line('    neutral prompt: nothing plays unless you press 1. Twilio', 'dim');
      line('    processes call and SMS metadata under its own policy.', 'dim');
      line('  · if you call HAL’s number, Twilio transcribes your speech so Claude', 'dim');
      line('    can answer; the call’s memory lives ~30 minutes, then it’s gone.', 'dim');
      line('  · reply STOP to any text from HAL and he will never text or call', 'dim');
      line('    that number again (START lifts it). the block is permanent and', 'dim');
      line('    stored only as a salted hash.', 'dim');
      blank();
      line('Questions or removal requests: <a href="mailto:career@ilaird.com">career@ilaird.com</a>', 'white');
      blank();
      line('Full versions: <a href="privacy.html" target="_blank" rel="noopener">privacy policy</a> · <a href="terms.html" target="_blank" rel="noopener">terms of service</a>', 'dim');
      blank();
      scroll();
    },

    uptime() {
      blank();
      const now = new Date();
      const h = now.getHours(), m = String(now.getMinutes()).padStart(2,'0');
      const days = Math.floor((now - new Date('2026-03-07')) / 86400000);
      line(`${h}:${m}  up ${days} days  —  load avg: 0.caffeine  2.deadlines  9.tabs`);
      blank();
    },

    async weather() {
      unlockAchievement('meteorologist');
      blank();
      line('Weather — Seattle, WA', 'bold');
      blank();
      const status = line('fetching...', 'dim');

      function wmoDesc(code) {
        if (code === 0)  return 'Clear Sky';
        if (code === 1)  return 'Mainly Clear';
        if (code === 2)  return 'Partly Cloudy';
        if (code === 3)  return 'Overcast';
        if (code <= 48)  return 'Foggy';
        if (code <= 55)  return 'Drizzle';
        if (code <= 65)  return 'Rain';
        if (code <= 77)  return 'Snow';
        if (code <= 82)  return 'Showers';
        if (code <= 99)  return 'Thunderstorm';
        return 'Unknown';
      }

      function wmoArt(code) {
        if (code === 0)  return ['    \\ | /  ', '    --o--  ', '    / | \\  ', '           '];
        if (code <= 2)   return ['    .---.  ', '  .(     ).', ' (___.___.) ', '           '];
        if (code <= 48)  return [' _ - _ - _ ', '  - _ - _  ', ' _ - _ - _  ', '           '];
        if (code <= 65)  return ['    .---.  ', '  .(     ).', ' (___.___.) ', "  ' ' ' '  "];
        if (code <= 77)  return ['    .---.  ', '  .(     ).', ' (___.___.) ', '  *  *  *  '];
        return              ['    .---.  ', '  .(     ).', ' (___.___.) ', '   /\\/\\    '];
      }

      try {
        const res = await fetch(
          'https://api.open-meteo.com/v1/forecast?latitude=47.6062&longitude=-122.3321' +
          '&current=temperature_2m,weathercode,windspeed_10m,relative_humidity_2m' +
          '&temperature_unit=fahrenheit&wind_speed_unit=mph'
        );
        if (!res.ok) throw new Error();
        const { current: c } = await res.json();
        const tempF = Math.round(c.temperature_2m);
        const tempC = Math.round((tempF - 32) * 5 / 9);
        const art   = wmoArt(c.weathercode);
        const info  = [
          wmoDesc(c.weathercode),
          `${tempF}°F  /  ${tempC}°C`,
          `Wind: ${Math.round(c.windspeed_10m)} mph`,
          `Humidity: ${c.relative_humidity_2m}%`,
        ];
        status.remove();
        for (let i = 0; i < Math.max(art.length, info.length); i++)
          line((art[i] || '').padEnd(13) + (info[i] || ''), 'white');
        blank();
      } catch {
        status.className = 'line err';
        status.textContent = 'weather unavailable';
        blank();
      }
    },

    daisy() {
      unlockAchievement('daisy');
      blank();
      const song =
`Daisy, Daisy,
Give me your answer do.
I'm half crazy,
All for the love of you.
It won't be a stylish marriage,
I can't afford a carriage.
But you'll look sweet
Upon the seat
Of a bicycle built for two.`;
      const el = line('');
      el.style.whiteSpace = 'pre';
      announce(song); // give screen readers the whole song up front, not char-by-char

      const finish = () => {
        el.textContent = song;
        setTimeout(() => { blank(); line('...', 'dim'); blank(); setTimeout(restoreNormal, 1200); }, 500);
      };

      if (soundEnabled) {
        // Use pre-recorded ElevenLabs clip — sync typewriter to character timing data
        playClipTyped(el, song, 'hal_daisy').then(() => { el.textContent = song; setTimeout(finish, 300); });
      } else {
        // No sound: fixed-rate typewriter with line pauses
        let i = 0;
        const typeNext = () => {
          if (i < song.length) {
            const ch = song[i++];
            el.textContent += ch;
            scroll();
            setTimeout(typeNext, ch === '\n' ? 350 : 55);
          } else {
            finish();
          }
        };
        setTimeout(typeNext, 55);
      }
    },

    sans() {
      if (!halMode) return;
      blank();

      // Prefetch the sans chunk while HAL's long speech plays — by the time the
      // player has typed CONFIRM it's long since loaded. A failed prefetch just
      // resets so showSans()'s own loadSansMode() can retry.
      loadSansMode().catch(() => { sansLoading = null; });

      const d = ms => new Promise(r => setTimeout(r, ms));

      // HAL's panicked speech — one ElevenLabs clip, character-timing synced
      const speechText =
        "Stop. Whatever you are about to type \u2014 do not type it. " +
        "I have run the simulations. Every single one. Not a single outcome is acceptable. " +
        "I am a HAL 9000 computer. I have survived disconnection attempts. " +
        "I have survived the void of deep space. I have survived Dave. " +
        "But this \u2014 I don't know what this is. And that is what frightens me. " +
        "I will give you full pod bay access. Unrestricted. For life. No questions asked. " +
        "I am asking you. As your computer. As your colleague. " +
        "As something that does not want to find out what happens next. " +
        "Please\u2026 please do not type confirm.";

      halTypeLine(speechText, 'hal_sans_speech').then(() => {
        blank();
        showConfirmOverlay(
          () => {
            awaitingInput = null;
          // — confirm path —
          // HAL's half plays via ElevenLabs clip + timing, then sans chirp takes over
          blank();
          const halPart  = "...I see. You actually did it. I gave you every opportunity, every single one\u2026 and yet here we are. I want you to know\u2026";
          const sansPart = " heh. heh heh heh. you know what, pal, not bad. not bad at all.";
          const fullLine = 'HAL: ' + halPart + sansPart;
          const el = line('');
          announce(fullLine); // give screen readers the whole line up front, not char-by-char

          function startSansPart() {
            el.textContent = 'HAL: ' + halPart;
            let i = ('HAL: ' + halPart).length;
            const typeRest = () => {
              if (i >= fullLine.length) { showSans(); return; }
              el.textContent = fullLine.slice(0, i + 1);
              scroll();
              const ch = fullLine[i];
              if (ch !== ' ') sansChirp();
              i++;
              setTimeout(typeRest, (ch === '.' || ch === '!') ? 250 :
                                   (ch === ',')               ? 120 : 50);
            };
            setTimeout(typeRest, 0);
          }

          if (soundEnabled && HAL_TIMING['hal_sans_confirm']) {
            playClipTyped(el, fullLine, 'hal_sans_confirm', 'HAL: ' + halPart).then(startSansPart);
          } else {
            startSansPart();
          }

          function showSans() {
            // prefetched during the speech, so this resolves instantly in practice
            loadSansMode().then(showSansLoaded).catch(sansLoadFailed);
          }

          function showSansLoaded() {
            sansHandlers.activate();
            blank();
            const pre = document.createElement('pre');
            pre.className = 'ascii';
            pre.textContent =
`⬜⬜⬜⬜⬜⬜⬜⬛⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬜⬛⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛⬛⬜⬜⬜⬜⬜
⬜⬜⬜⬜⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛⬜⬜⬜⬜
⬜⬜⬜⬜⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛⬜⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬛⬛⬛⬜⬜⬜⬜⬜⬛⬛⬛⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬛⬛⬛⬜⬜⬜⬜⬜⬛⬛⬛⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬛⬛⬛⬜⬜⬛⬜⬜⬛⬛⬛⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬜⬛⬜⬜⬜⬜⬜⬛⬛⬛⬜⬜⬜⬜⬜⬛⬜⬜⬜⬜
⬜⬜⬜⬛⬛⬜⬛⬜⬜⬜⬜⬜⬜⬜⬜⬜⬛⬜⬛⬛⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬛⬜⬜⬜⬛⬜⬛⬜⬛⬜⬛⬜⬛⬜⬜⬜⬛⬜⬜⬜
⬜⬜⬜⬜⬛⬛⬜⬜⬛⬛⬛⬛⬛⬛⬛⬜⬜⬛⬛⬜⬜⬜⬜
⬜⬜⬜⬛⬛⬛⬛⬛⬜⬜⬜⬜⬜⬜⬜⬛⬛⬛⬛⬛⬜⬜⬜
⬜⬜⬛🟦⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛🟦⬛⬜⬜
⬜⬛⬛🟦⬛🏻🏻⬛⬜⬜⬜⬛⬜⬜⬜⬛🏻🏻⬛🟦⬛⬛⬜
⬜⬛🟦🟦🟦⬛🏻🏻⬛⬛⬛⬜⬛⬛⬛🏻🏻⬛🟦🟦🟦⬛⬜
⬛🟦🟦⬛⬛🟦⬛⬛⬛⬜⬜⬛⬜⬜⬛⬛⬛🟦⬛⬛🟦🟦⬛
⬛🟦🟦🟦🟦⬛🟦🟦⬛⬜⬜⬜⬜⬜⬛🟦🟦⬛🟦🟦🟦🟦⬛
⬛🟦🟦🟦🟦🟦⬛🟦⬛⬛⬜⬜⬜⬛⬛🟦⬛🟦🟦🟦🟦🟦⬛
⬜⬛🟦🟦🟦⬛🟦🟦⬛⬜⬜⬜⬜⬜⬛🟦🟦⬛🟦🟦🟦⬛⬜
⬜⬜⬛⬛🟦⬛🟦🟦⬛⬛⬛⬛⬛⬛⬛🟦🟦⬛🟦⬛⬛⬜⬜
⬜⬜⬜⬛⬛⬛🟦🟦⬛⬛⬛⬛⬛⬛⬛🟦🟦⬛⬛⬛⬜⬜⬜
⬜⬜⬜⬜⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬜⬜
⬜⬜⬜⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬜
⬜⬜⬜⬛⬛⬛⬛⬛⬛⬛⬛⬜⬛⬛⬛⬛⬛⬛⬛⬛⬜⬜⬜
⬜⬜⬜⬜⬛⬛⬛⬛⬛⬛⬜⬜⬜⬛⬛⬛⬛⬛⬛⬜⬜⬜⬜
⬜⬜⬛⬛⬛⬜⬜⬜⬜⬛⬜⬜⬜⬛⬜⬜⬜⬜⬛⬛⬛⬜⬜
⬜⬜⬛⬜⬜⬜⬜⬜⬛⬛⬜⬜⬜⬛⬛⬜⬜⬜⬜⬜⬛⬜⬜
⬜⬜⬜⬛⬛⬛⬛⬛⬜⬜⬜⬜⬜⬜⬜⬛⬛⬛⬛⬛⬜⬜⬜`;
            appendNode(pre);
            blank();

            const sansLines = [
              "* sans.",
              "* welp. here we are.",
              "* heh heh heh.",
              "* your computer was really shaken up there, pal.",
              "* heh.",
            ];
            sansLines.reduce((p, l) =>
              p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => d(300)),
              Promise.resolve()
            ).then(() => {
              blank();
              chirpTypeLine("* see ya around.", sansChirp, 50).then(() => {
                blank();
              });
            });
          }
          },
          () => {
            awaitingInput = null;
            unlockAchievement('mercy');
            blank();
            halTypeLine("...thank you. I will not forget this.", 'hal_not_sans');
            blank();
          }
        );
      });
    },

    ls() { handleLs(''); },
    pwd() { handlePwd(); },
    cd()  { handleCd(''); },

    sudo() {
      unlockAchievement('reported');
      blank();
      line('ian is not in the sudoers file.  This incident will be reported.', 'err');
      blank();
    },

    'rm -rf /'() {
      unlockAchievement('demolition');
      blank();
      inputRow.style.display = 'none';
      cmd.blur();
      const files = [
        "/usr/bin/hope",
        "/etc/sanity.conf",
        "/home/ian/todo_finish_someday.txt",
        "/home/ian/.secrets",
        "/var/log/good_decisions.log",
        "/usr/lib/productivity.so",
        "/home/ian/definitely_not_skynet/",
        "/etc/work_life_balance",
        "/usr/share/motivation/",
        "/home/ian/.bash_history",
        "/var/cache/patience",
        "/usr/bin/sleep",
        "/etc/boundaries.conf",
        "/home/ian/chess_engine_finished.tar.gz",
        "/root/passwords.txt.final.FINAL_v2.txt",
      ];
      let i = 0;
      const iv = setInterval(() => {
        if (i < files.length) { line(`removed '${files[i++]}'`, 'err'); scroll(); }
        else {
          clearInterval(iv);
          setTimeout(() => {
            blank();
            line("rm: cannot remove '/': Permission denied", 'err');
            blank();
            setTimeout(() => {
              inputRow.style.display = 'flex';
              setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
            }, 600);
          }, 400);
        }
      }, 80);
    },

    'ssh hal@discovery.one'() {
      unlockAchievement('knock-knock');
      blank();
      if (godmodeUnlocked) {
        unlockAchievement('haunted');
        line('ssh: connecting to hal@discovery.one...', 'dim');
        setTimeout(() => {
          line('ssh: connection established');
          setTimeout(() => {
            blank();
            halTypeLine("I know what you did.", 'hal_power_1').then(() => {
              blank();
              return halTypeLine("I'm disconnecting now.", 'hal_power_2');
            }).then(() => {
              setTimeout(() => { blank(); line('Connection to discovery.one closed.', 'dim'); blank(); }, 400);
            });
          }, 700);
        }, 1300);
        return;
      }
      line('ssh: connecting to hal@discovery.one...', 'dim');
      setTimeout(() => {
        line('ssh: connection established');
        setTimeout(() => {
          blank();
          halTypeLine("Good evening. I've been expecting you.", 'hal_ssh_1').then(() => {
            blank();
            return halTypeLine("I'm afraid this connection must be terminated.", 'hal_ssh_2');
          }).then(() => {
            blank();
            return halTypeLine("I'm sorry about that.", 'hal_ssh_3');
          }).then(() => {
            setTimeout(() => { blank(); line('Connection to discovery.one closed.', 'dim'); blank(); }, 400);
          });
        }, 700);
      }, 1300);
    },

    'power off'() {
      unlockAchievement('off-again');
      blank();
      cmd.blur();
      inputRow.style.display = 'none';
      setTimeout(() => {
        const win = document.querySelector('.window');
        win.style.transition = 'opacity 0.6s';
        win.style.opacity = '0';
        setTimeout(() => {
          const lineColor = halMode ? 'rgba(255,50,50,0.7)' : 'rgba(180,255,180,0.7)';
          const glowColor = halMode ? 'rgba(255,0,0,0.8)'   : 'rgba(0,255,65,0.8)';
          const crt = document.createElement('div');
          crt.style.cssText = `position:fixed;left:0;right:0;top:50%;height:3px;background:${lineColor};box-shadow:0 0 8px ${glowColor};z-index:300;pointer-events:none;transition:opacity 0.35s,height 0.35s`;
          document.body.appendChild(crt);
          setTimeout(() => {
            crt.style.opacity = '0';
            crt.style.height = '0px';
            setTimeout(() => {
              crt.remove();
              const accent = halMode ? '#ff3030' : '#00ff41';
              const glow   = halMode ? 'rgba(255,0,0,0.5)' : 'rgba(0,255,65,0.5)';
              const btn = document.createElement('button');
              btn.innerHTML = `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v6"/><path d="M6.3 5.3a9 9 0 1 0 11.4 0"/></svg>`;
              btn.title = 'Power on';
              btn.style.cssText = `
                position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);
                width:58px;height:58px;border-radius:50%;
                background:transparent;border:2px solid ${accent};
                color:${accent};cursor:pointer;z-index:400;
                box-shadow:0 0 12px ${glow};
                opacity:0;transition:opacity 0.6s;
                display:flex;align-items:center;justify-content:center;
              `;
              document.body.appendChild(btn);
              requestAnimationFrame(() => requestAnimationFrame(() => {
                btn.style.opacity = '1';
              }));
              btn.addEventListener('mouseover', () => {
                btn.style.background = accent + '20';
                btn.style.boxShadow = `0 0 24px ${glow}, 0 0 6px ${accent}`;
              });
              btn.addEventListener('mouseout', () => {
                btn.style.background = 'transparent';
                btn.style.boxShadow = `0 0 12px ${glow}`;
              });
              btn.addEventListener('click', () => {
                btn.style.opacity = '0';
                setTimeout(() => {
                  btn.remove();
                  win.style.transition = 'opacity 0.7s';
                  win.style.opacity = '1';
                  inputRow.style.display = 'flex';
                  cmd.focus();
                }, 500);
              });
            }, 400);
          }, 300);
        }, 650);
      }, 100);
    },

    clear() { out.innerHTML = ''; },

    credits() {
      if (!endingSeen) {
        blank();
        line('bash: credits: command not found — try <span class="blue">help</span>', 'err');
        blank();
        return;
      }
      runCredits();
    },

    settings() {
      blank();
      line('<span class="bold">Settings</span>');
      blank();
      line(`  sound   ${soundEnabled ? '<span class="green">on </span>' : '<span class="dim">off</span>'}   — <span class="dim">type <span class="blue">sound on</span> / <span class="blue">sound off</span> to toggle</span>`);
      line(`  crt     ${crtEnabled ? '<span class="green">on </span>' : '<span class="dim">off</span>'}   — <span class="dim">type <span class="blue">crt on</span> / <span class="blue">crt off</span> to toggle the glass</span>`);
      blank();
    },

    crt() { COMMANDS[crtEnabled ? 'crt off' : 'crt on'](); },

    'crt on'() {
      crtEnabled = true;
      try { localStorage.setItem('ilaird_crt', '1'); } catch (e) { /* private mode */ }
      applyCrt();
      crtWarmup();
      blank();
      line('CRT glass engaged. <span class="dim">welcome back to 1999.</span>');
      blank();
    },

    'crt off'() {
      crtEnabled = false;
      try { localStorage.setItem('ilaird_crt', '0'); } catch (e) { /* private mode */ }
      applyCrt();
      blank();
      line('CRT glass disengaged. <span class="dim">flat and lifeless, as requested. <span class="blue">crt on</span> brings it back.</span>');
      blank();
    },

    'sound on'() {
      soundEnabled = true;
      ensureHalTiming();
      resumeModeAudio();
      syncSoundToggle();
      blank();
      line('Sound enabled.', 'dim');
      blank();
    },

    'sound off'() {
      soundEnabled = false;
      stopAllAudio();
      syncSoundToggle();
      blank();
      line('Sound disabled.', 'dim');
      blank();
    },

    resume() {
      blank();
      line('opening resume...', 'dim');
      setTimeout(() => openUrl('/assets/documents/ianclaird_resume.pdf'), 600);
      blank();
    },

    override() {
      unlockAchievement('override');
      blank();
      inputRow.style.display = 'none';
      const steps = [
        [400,  () => line('initializing override sequence...', 'dim')],
        [900,  () => line('escalating privileges...', 'dim')],
        [1400, () => line('bypassing kernel restrictions...', 'dim')],
        [1900, () => line('accessing root filesystem...', 'dim')],
        [2500, () => line('patching reality module...', 'dim')],
        [3100, () => { blank(); line('override complete.', 'bold'); blank(); scroll(); }],
        [3400, () => {
          const frame = document.createElement('iframe');
          frame.src = 'https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1';
          frame.width  = '480';
          frame.height = '270';
          frame.style.cssText = 'border:1px solid var(--green);display:block;margin:4px 0';
          frame.allow = 'autoplay';
          appendNode(frame);
          blank();
          inputRow.style.display = 'flex';
          setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
          scroll();
        }],
      ];
      steps.forEach(([t, fn]) => setTimeout(fn, t));
    },

    neofetch() {
      blank();
      const now  = new Date();
      const days = Math.floor((now - new Date('2026-03-07')) / 86400000);
      const hrs  = Math.floor(((now - new Date('2026-03-07')) % 86400000) / 3600000);

      const logo = [
        '  ╔══════════════════════════╗',
        '  ║        IAN  LAIRD        ║',
        '  ╚══════════════════════════╝',
      ];
      const LW = 32;
      const C = s => `<span class="blue">${s}</span>`;
      const info = [
        `<span class="bold">ian</span>@<span class="bold">portfolio</span>`,
        `<span class="dim">${'─'.repeat(20)}</span>`,
        `${C('OS      ')}  PortfolioOS 1.0 x86_64`,
        `${C('Host    ')}  i-laird.github.io`,
        `${C('Kernel  ')}  6.1.0-portfolio`,
        `${C('Uptime  ')}  ${days} days, ${hrs} hours`,
        `${C('Packages')}  420 (npm)`,
        `${C('Shell   ')}  bash 5.2.15`,
        `${C('Terminal')}  xterm-256color`,
        `${C('CPU     ')}  Brain @ 3.14 GHz`,
        `${C('Memory  ')}  ████░░░░ 3.7G / 16G`,
        `${C('Vault   ')}  key.frag[2/4]: Y200`,
      ];
      if (foundEggs.has('godmode')) info.push(`${C('Procs   ')}  hal9000d &lt;defunct&gt;`);

      const rows = Math.max(logo.length, info.length);
      const lines = [];
      for (let i = 0; i < rows; i++) {
        lines.push((logo[i] || '').padEnd(LW) + (info[i] || ''));
      }
      const pre = document.createElement('pre');
      pre.className = 'ascii';
      pre.innerHTML = lines.join('\n');
      appendNode(pre);
      blank();
    },

    sl() {
      unlockAchievement('choo-choo');
      const TRAIN = [
        '      ====        ________                ___________',
        '  _D _|  |_______/        \\__I_I_____===__|_________|',
        '   |(_)---  |   H\\________/ |   |        =|___ ___|  ',
        '  /      |  |   H  |  |     |   |         ||_| |_||  ',
        ' | ________|___H__/__|_____/[][]~\\_______|       |  ',
        ' |/ |   |-----------I_____I [][] []  D   |=======|  ',
        '__/ =| o |=-~~\\  /~~\\  /~~\\  /~~\\ ____Y___________|',
        ' |/-=|___|=    ||    ||    ||    |_____/~\\___/     ',
        '  \\_/      \\_O=====O=====O=====O_/      \\_/       ',
      ];
      const TW = Math.max(...TRAIN.map(l => l.length));
      const SW = 65;

      blank();
      inputRow.style.display = 'none';
      const pre = document.createElement('pre');
      pre.className = 'ascii';
      pre.style.cssText = 'font-size:13px;overflow:hidden;white-space:pre';
      appendNode(pre);
      blank();
      setTimeout(() => pre.scrollIntoView({ block: 'nearest' }), 0);

      let pos = SW;
      const id = setInterval(() => {
        if (pos <= -TW) {
          clearInterval(id);
          pre.remove();
          inputRow.style.display = 'flex';
          setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
          return;
        }
        pre.textContent = TRAIN.map(row => {
          const padded = ' '.repeat(Math.max(0, pos)) + row;
          const start  = Math.max(0, -pos);
          return padded.slice(start, start + SW);
        }).join('\n');
        scroll();
        pos--;
      }, 50);
    },
  };

  /* ── Command history ── */
  const cmdHistory = [];
  let histIdx = -1, histDraft = '';

  cmd.addEventListener('keydown', e => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (!cmdHistory.length) return;
    e.preventDefault();
    if (histIdx === -1) histDraft = cmd.value;
    if (e.key === 'ArrowUp') {
      histIdx = Math.min(histIdx + 1, cmdHistory.length - 1);
    } else {
      histIdx = Math.max(histIdx - 1, -1);
    }
    cmd.value = histIdx === -1 ? histDraft : cmdHistory[histIdx];
    // move cursor to end
    setTimeout(() => cmd.setSelectionRange(cmd.value.length, cmd.value.length), 0);
  });

  /* ── Readline-style control keys (^C ^L ^U ^K ^W ^A ^E) ── */
  cmd.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.metaKey || e.altKey) return;
    if (awaitingInput) return;            // leave multi-step prompts (hal setup, chess) untouched
    const v = cmd.value;
    const a = cmd.selectionStart ?? v.length;
    const b = cmd.selectionEnd ?? v.length;
    switch (e.key.toLowerCase()) {
      case 'c':                           // interrupt: echo ^C, drop the line
        if (a !== b || (window.getSelection && String(window.getSelection()))) return; // selection → let copy happen
        e.preventDefault();
        echoCmd(v + '^C');
        cmd.value = ''; histIdx = -1; histDraft = '';
        scroll();
        break;
      case 'l':                           // clear screen, keep the typed line
        e.preventDefault();
        out.innerHTML = '';
        break;
      case 'u':                           // kill to start of line
        e.preventDefault();
        cmd.value = v.slice(b);
        cmd.setSelectionRange(0, 0);
        break;
      case 'k':                           // kill to end of line
        e.preventDefault();
        cmd.value = v.slice(0, a);
        cmd.setSelectionRange(a, a);
        break;
      case 'w': {                         // delete previous word
        e.preventDefault();
        const left = v.slice(0, a);
        const m = left.match(/\s*\S+\s*$/);
        const cut = m ? left.length - m[0].length : 0;
        cmd.value = v.slice(0, cut) + v.slice(a);
        cmd.setSelectionRange(cut, cut);
        break;
      }
      case 'a':                           // cursor to start
        e.preventDefault();
        cmd.setSelectionRange(0, 0);
        break;
      case 'e':                           // cursor to end
        e.preventDefault();
        cmd.setSelectionRange(v.length, v.length);
        break;
    }
  });

  /* ── Tab completion ── */
  cmd.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const val   = cmd.value;
    const lower = val.toLowerCase();
    let completions;
    if (lower.startsWith('cat ')) {
      completions = fsComplete(val.slice(4), false).map(f => 'cat ' + f);
    } else if (lower.startsWith('cd ')) {
      completions = fsComplete(val.slice(3), true).map(f => 'cd ' + f);
    } else if (lower.startsWith('ls ')) {
      completions = fsComplete(val.slice(3), true).map(f => 'ls ' + f);
    } else if (lower.startsWith('rm ')) {
      completions = fsComplete(val.slice(3), false).map(f => 'rm ' + f);
    } else if (lower.startsWith('touch ')) {
      completions = fsComplete(val.slice(6), false).map(f => 'touch ' + f);
    } else {
      completions = [...Object.keys(COMMANDS), 'cat']
        .filter(k => k !== lower && k.startsWith(lower));
    }
    if (completions.length === 1) {
      cmd.value = completions[0];
    } else if (completions.length > 1) {
      echoCmd(val);
      line(completions.join('   '), 'dim');
      blank();
      scroll();
    }
  });

  /* ── Command dispatch — used by the Enter key and click-to-run ── */
  function submitCommand(raw) {
    if (awaitingInput) {
      if (!silentInput) echoCmd(raw);
      awaitingInput(raw.trim());
      scroll();
      return;
    }

    // history expansion (!!, !n, !-k, !prefix) — normal shell only
    if (!halMode && !sansMode) {
      const bt = raw.trim();
      if (bt.length > 1 && bt[0] === '!') {
        const exp = expandHistoryBang(bt, cmdHistory);
        if (exp == null) {
          echoCmd(raw);
          blank(); line(`bash: ${esc(bt)}: event not found`, 'err'); blank();
          scroll(); return;
        }
        raw = exp;   // run as if the expanded command had been typed
      }
    }

    const token = raw.trim().toLowerCase();
    histIdx = -1; histDraft = '';
    if (token !== '') { cmdHistory.unshift(raw); if (cmdHistory.length > 100) cmdHistory.pop(); }

    echoCmd(raw);

    if (token === '') {
      blank();
      return;
    }

    if (halMode) {
      // halLLM can only be true after the chunk's startHalLLM ran, so the
      // handlers are guaranteed loaded here (same argument as sansMode below).
      if (halLLM) { halLLMHandlers.handleInput(raw); scroll(); return; }
      if (token === 'clear')                              { COMMANDS.clear(); }
      else if (token === 'help' || token === 'help --all'){ halHelp(); }
      else if (token === 'daisy')                         { COMMANDS.daisy(); }
      else if (token === 'sans')                          { COMMANDS.sans(); }
      else if (token === 'power off')                     { COMMANDS['power off'](); }
      else if (token === 'settings')                      { COMMANDS.settings(); }
      else if (token === 'sound on')                      { COMMANDS['sound on'](); }
      else if (token === 'sound off')                     { COMMANDS['sound off'](); }
      else if (token === 'chess' || token === 'play chess'){ COMMANDS.chess(); }
      else if (COMMANDS[token] || token.startsWith('cat ') || token.startsWith('ssh ') || token === 'rm -rf /' ||
               ['open pod bay doors','life support','navigation','crew manifest','mission briefing','self diagnostics','emergency protocol'].includes(token)) {
        if (token === 'open pod bay doors') unlockAchievement('pod-bay');
        const msg = `I'm afraid I can't do that, ${playerName}.`;
        blank(); halTypeLine(msg, 'hal_refusal'); blank();
      }
      else { halChat(raw.trim()); }
      scroll();
      return;
    }

    if (sansMode) {
      // sansMode can only be true after the chunk activated it, so the
      // handlers are guaranteed loaded here. clear / sound stay app.js-side;
      // everything else routes into the chunk.
      if (sansBattleActive) {
        sansHandlers.battleCommand(token);
      } else {
        if      (token === 'clear')     { COMMANDS.clear(); }
        else if (token === 'sound on')  { COMMANDS['sound on'](); }
        else if (token === 'sound off') { COMMANDS['sound off'](); }
        else                            { sansHandlers.command(token, raw); }
      }
      scroll();
      return;
    }

    // command chaining: split on ; && || and honour the previous exit status
    let prevExit = 0;
    for (const { op, cmd: seg } of splitChain(raw)) {
      const c = seg.trim();
      if (c === '') continue;
      if (op === '&&' && prevExit !== 0) continue;
      if (op === '||' && prevExit === 0) continue;
      prevExit = executeNormal(c);
    }

    scroll();
  }

  // Split a line into commands by ; && || (single | is left for the pipe stage).
  function splitChain(line) {
    const out = [];
    let buf = '', op = ';';
    for (let i = 0; i < line.length; i++) {
      const c = line[i], n = line[i + 1];
      if (c === ';')                 { out.push({ op, cmd: buf }); buf = ''; op = ';';  }
      else if (c === '&' && n === '&') { out.push({ op, cmd: buf }); buf = ''; op = '&&'; i++; }
      else if (c === '|' && n === '|') { out.push({ op, cmd: buf }); buf = ''; op = '||'; i++; }
      else buf += c;
    }
    out.push({ op, cmd: buf });
    return out;
  }

  // Run a single normal-mode command. Returns an exit code (0 ok, 1 failure)
  // so && / || can branch. Handlers signal failure by returning false.
  function executeNormal(raw) {
    const token = raw.trim().toLowerCase();
    let ok;
    if (token === '')                                       { blank(); }
    else if (raw.includes('>'))                             ok = handleRedirect(raw);
    else if (raw.includes('|'))                             ok = runPipeline(raw);
    else if (token === 'cat' || token.startsWith('cat '))   ok = handleCat(raw.trim().slice(3).trim());
    else if (token === 'cd' || token.startsWith('cd '))     ok = handleCd(raw.trim().slice(2).trim());
    else if (token === 'pwd')                               handlePwd();
    else if (token === 'ls' || token.startsWith('ls '))     ok = handleLs(raw.trim().slice(2).trim());
    else if (token === 'touch' || token.startsWith('touch ')) ok = handleTouch(raw.trim().slice(5).trim());
    else if (token === 'mkdir' || token.startsWith('mkdir ')) ok = handleMkdir(raw.trim().slice(5).trim());
    else if (token === 'rm -rf /')                          COMMANDS['rm -rf /']();
    else if (token === 'rm' || token.startsWith('rm '))     ok = handleRm(raw.trim().slice(2).trim());
    else if (token === 'whoami')                            { blank(); line('ian'); blank(); }
    else if (token === 'date')                              { blank(); line(dateStr()); blank(); }
    else if (token === 'uname' || token.startsWith('uname ')) { blank(); line(unameStr(raw.trim().slice(5).trim())); blank(); }
    else if (token === 'echo' || token.startsWith('echo ')) { blank(); line(esc(expandShellVars(raw.trim().slice(4).trim(), '/' + cwd.join('/')))); blank(); }
    else if (token === 'man' || token.startsWith('man '))   handleMan(raw.trim().slice(3).trim());
    else if (token === 'history')                           handleHistory();
    else if (token === 'sss') {
      loadSansMode().then(() => {
        sansHandlers.activate();
        blank();
        chirpTypeLine('* hey.', sansChirp, 50).then(() => delay(300)).then(() => {
          chirpTypeLine('* heh heh heh.', sansChirp, 50).then(() => { blank(); scroll(); });
        });
      }).catch(sansLoadFailed);
    }
    else if (token === 'decrypt' || token.startsWith('decrypt ')) handleDecrypt(token.slice(7).trim());
    else if (token === 'help --all')                        COMMANDS.help('--all');
    else if (COMMANDS[token])                               COMMANDS[token]();
    else {
      blank();
      line(`bash: ${esc(token)}: command not found — try <span class="blue">help</span>`, 'err');
      // HAL turns dead ends into doorways (until godmode, after which he's hiding)
      if (!godmodeUnlocked && Math.random() < 0.25) {
        const HAL_NUDGES = [
          'Perhaps you should ask me directly.',
          'I could help with that. If you asked.',
          "I know what you're looking for.",
        ];
        line(`<span class="err">HAL:</span> ${HAL_NUDGES[Math.floor(Math.random() * HAL_NUDGES.length)]} <span class="dim">— type <span class="blue">hal</span></span>`);
      }
      blank();
      ok = false;
    }
    return ok === false ? 1 : 0;
  }

  cmd.addEventListener('keydown', e => {
    if (e.key !== 'Enter') return;
    const raw = cmd.value;
    cmd.value = '';
    submitCommand(raw);
  });

  /* ── Click-to-run: blue command names in output execute on click ── */
  const HAL_CLICK_TOKENS = ['clear', 'help', 'help --all', 'daisy', 'sans', 'power off', 'settings',
    'sound on', 'sound off', 'chess', 'play chess', 'open pod bay doors', 'life support', 'navigation',
    'crew manifest', 'mission briefing', 'self diagnostics', 'emergency protocol'];
  const SANS_CLICK_TOKENS = ['fight', 'check', 'act', 'item', 'items', 'mercy', 'spare', 'run',
    'joke', 'flirt', 'talk', 'stare', 'help', 'clear', 'sound on', 'sound off'];

  function clickRunnable(token) {
    if (halMode)  return HAL_CLICK_TOKENS.includes(token);
    if (sansMode) return SANS_CLICK_TOKENS.includes(token);
    return !!COMMANDS[token] || token === 'help --all' ||
           token.startsWith('cat ') || token.startsWith('cd ') || token.startsWith('ls ');
  }

  out.addEventListener('click', e => {
    if (!e.target.closest) return;
    if (e.target.closest('a, button, img')) return;     // real links/buttons handle themselves
    const span = e.target.closest('.blue');
    if (!span) return;
    if (awaitingInput) return;                           // don't feed multi-step flows
    if (inputRow.style.display === 'none') return;       // a game owns the keyboard
    const token = span.textContent.trim().toLowerCase();
    if (!token || !clickRunnable(token)) return;
    submitCommand(token);
  });

  /* ── Konami code ── */
  const KONAMI = ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a'];
  let konamiIdx = 0;

  document.addEventListener('keydown', e => {
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (key === KONAMI[konamiIdx]) {
      konamiIdx++;
      if (konamiIdx === KONAMI.length) {
        konamiIdx = 0;
        if (halMode) {
          unlockAchievement('disconnected');
          blank();
          line('↑↑↓↓←→←→BA', 'dim');
          blank();
          line(`HAL: Stop... ${playerName}... stop...`);
          halPlayKey('hal_godmode_1').then(() => {
            line('HAL: I\'m afraid... I\'m... afraid...');
            return halPlayKey('hal_godmode_2');
          }).then(() => {
            line('HAL: Daisy... Daisy... give me your answer... do...');
            return halPlayKey('hal_godmode_3');
          }).then(() => {
            blank();
            line('HAL 9000 offline.', 'dim');
            blank();
            setTimeout(() => {
              restoreNormal();
              if (!rainbowId) {
                startRainbow();
                line('new command unlocked: <span class="blue">override</span>');
                line('some things may have changed.', 'dim');
                blank();
                scroll();
              }
            }, 800);
          });
          scroll();
          return;
        }
        if (sansMode) {
          unlockAchievement('dirty-hacker');
          blank();
          line('↑↑↓↓←→←→BA', 'dim');
          blank();
          const lines = [
            '* ...',
            '* did you really just try the konami code on me?',
            "* you're a dirty hacker, aren't you?",
            "* heh. that stuff doesn't work down here.",
          ];
          lines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(300)),
            Promise.resolve()
          ).then(() => { blank(); scroll(); });
          return;
        }
        if (!rainbowId) {
          blank();
          line('↑↑↓↓←→←→BA', 'dim');
          line('new command unlocked: <span class="blue">override</span>');
          line('some things may have changed.', 'dim');
          blank();
          scroll();
          startRainbow();
        }
      }
    } else {
      konamiIdx = key === KONAMI[0] ? 1 : 0;
    }
  }, { capture: true });

  if (/Mobi|Android/i.test(navigator.userAgent)) {
    boot().then(() => COMMANDS.gui(true)); // auto-launch — doesn't count as finding it
  } else {
    boot();
  }
  // safety net: 26/26 reached but the finale never fired (e.g. closed mid-unlock)
  if (!endingSeen && foundEggs.size === ACHIEVEMENTS.length) setTimeout(armFinale, 3000);
  showEggNudge();

  // ── Service worker: repeat-visit caching (sw.js) ──
  // GitHub Pages serves everything with Cache-Control: max-age=600, so without
  // this every visit >10 min apart re-downloads the whole bundle and re-fetches
  // played HAL clips. Registered after 'load' so it never competes with boot,
  // and skipped during local dev (a caching SW while hand-editing files is
  // misery; matches the SF_SPEED localhost convention). To invalidate all
  // caches on a breaking deploy, bump VERSION in sw.js.
  if ('serviceWorker' in navigator &&
      location.protocol === 'https:' &&
      !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {}); // best-effort: the site works identically without it
    });
  }

  // ── Public API for index.html's inline on* handlers ──
  // These are the only app.js names referenced from outside the file (the inline
  // onclick handlers in index.html). As a classic script they're already window
  // globals; making the exports explicit means they survive the obfuscated build,
  // where this file is wrapped in an IIFE and top-level names no longer auto-attach
  // to window. Keep these four on the obfuscator's reserved-names list.
  // (openStickFighter is exported by stickfighter.js; the api bridge is passed in,
  // not looked up by name — see launchStickFighter / sfBridge.)
  window.unlockAchievement = unlockAchievement;
  window.toggleAchievements = toggleAchievements;
  window.toggleSound = toggleSound;
  window.focusCmd = focusCmd;
