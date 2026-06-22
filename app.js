  const out      = document.getElementById('out');
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

  let halMode = false, sansMode = false, godmodeUnlocked = false, soundEnabled = false;
  // explorable-filesystem cursor (declared early: getPromptHTML reads it at load)
  let cwd = ['home', 'ian'];
  const fsHome = () => ['home', 'ian'];
  // experimental LLM HAL ("escape the terminal") — opt-in second mode; the scripted HAL is unchanged
  const HAL_WORKER_BASE = 'https://nlflqwapol.execute-api.us-east-1.amazonaws.com';   // AWS API Gateway backend
  const HAL_WORKER_URL = (() => { try { return localStorage.getItem('ilaird_hal_worker') || HAL_WORKER_BASE; } catch (e) { return HAL_WORKER_BASE; } })();
  const TURNSTILE_SITE_KEY = '0x4AAAAAADn5dDkcE9exLUeE';                              // public Turnstile site key
  let halLLM = false, halLLMBusy = false, halLLMState = null;
  let sansBattleActive = false, sansBattle = {}, sansDeaths = 0;
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
      // if the rainbow is mid-cycle when the user opts out, freeze it on a static palette
      if (reduceMotion && typeof rainbowId === 'number') {
        clearInterval(rainbowId); rainbowId = 'static'; applyGodmodeTint();
      }
    });
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
    { id: 'excalibur',     name: 'the sword in the stone', desc: 'pulled Excalibur from the stone', hint: 'in the brawler, a glowing stone holds a blade' },
    { id: 'ogre-slayer',   name: 'ogre-slayer',      desc: 'slew the War-Ogre',                hint: 'a brute lumbers in once per run' },
    { id: 'witch-king',    name: 'i am no man',       desc: 'defeated the Witch-king of Angmar', hint: 'outlast the nine riders' },
    { id: 'dark-lord',     name: 'the dark lord falls', desc: 'struck down Darth Vader',        hint: 'something waits past the fantasy horde' },
    { id: 'world-stopper', name: 'za warudo',         desc: 'turned DIO to dust',               hint: 'time itself will stop before the end' },
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
  function achKeyHandler(e) {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); closeAchievements(); }
  }
  function closeAchievements() {
    if (!achOverlayEl) return;
    achOverlayEl.remove();
    achOverlayEl = null;
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
      const url = URL.createObjectURL(blob);

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

  function toggleAchievements() {
    if (eggNudgeDismiss) eggNudgeDismiss(true); // they found it — job done
    if (achOverlayEl) { closeAchievements(); return; }
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:8000;background:rgba(0,0,0,0.75);display:flex;align-items:center;justify-content:center';
    const box = document.createElement('div');
    box.style.cssText = 'background:var(--bg);border:1px solid var(--green-dim);border-radius:4px;padding:18px 22px;max-width:560px;width:92%;max-height:80vh;overflow-y:auto;font-size:14px;line-height:1.7;color:var(--green)';
    renderAchList(box);
    overlay.appendChild(box);
    overlay.addEventListener('click', e => { if (e.target === overlay) closeAchievements(); });
    document.body.appendChild(overlay);
    achOverlayEl = overlay;
    cmd.blur();
    document.addEventListener('keydown', achKeyHandler, true);
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
        inputRow.style.display === 'none' || achOverlayEl) {
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

  function _djb2(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return h;
  }

  function _xorDecode(cipherHex, key) {
    return cipherHex.match(/../g)
      .map((h, i) => String.fromCharCode(parseInt(h, 16) ^ key.charCodeAt(i % key.length)))
      .join('');
  }

  function _hexRows(cipherHex) {
    return cipherHex.match(/.{1,32}/g).map((r, i) =>
      '0x' + (i * 16).toString(16).padStart(4, '0') + ':  ' + r.match(/../g).join(' '));
  }

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
  function _halNorm(raw) {
    let s = raw.replace(/^HAL:\s*/i, '').trim();
    const esc = playerName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    s = s.replace(new RegExp(',\\s*' + esc + '\\.', 'gi'), '.');
    s = s.replace(new RegExp(',\\s*' + esc + '\\?', 'gi'), '?');
    s = s.replace(new RegExp(',\\s*' + esc + '\\b', 'gi'), '');
    s = s.replace(new RegExp('\\s+' + esc + '\\.', 'gi'), '.');
    s = s.replace(new RegExp('\\s+' + esc + '\\?', 'gi'), '?');
    s = s.replace(new RegExp('^' + esc + ',\\s*', 'gi'), '');
    // Also strip plain "Dave" (default name, in case playerName differs)
    s = s.replace(/,\s*Dave\./gi, '.').replace(/,\s*Dave\?/gi, '?')
         .replace(/\s+Dave\./gi, '.').replace(/,\s*Dave\b/gi, '')
         .replace(/\bDave,\s*/gi, '');
    // Em-dash → ". " (phase messages use —)
    s = s.replace(/\s*—\s*/g, '. ');
    return s.replace(/\s+/g, ' ').trim();
  }

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

  // LCS-based alignment: maps each display character to a timestamp from the clip.
  // Characters not in the clip (player name, "HAL: " prefix) inherit the previous
  // matched timestamp — so injected name chars all appear at the same moment.
  function _alignTimings(srcChars, srcTimes, fullText) {
    const m = srcChars.length, n = fullText.length;
    // Build LCS DP table
    const dp = [];
    for (let i = 0; i <= m; i++) dp.push(new Uint16Array(n + 1));
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = srcChars[i-1].toLowerCase() === fullText[j-1].toLowerCase()
          ? dp[i-1][j-1] + 1
          : Math.max(dp[i-1][j], dp[i][j-1]);
      }
    }
    // Traceback
    const matched = new Float64Array(n); // 0 = unmatched sentinel
    let i = m, j = n;
    while (i > 0 && j > 0) {
      if (srcChars[i-1].toLowerCase() === fullText[j-1].toLowerCase()) {
        matched[j-1] = srcTimes[i-1] + 1e-9; // +epsilon so 0.0s is distinguishable from unmatched
        i--; j--;
      } else if (dp[i-1][j] >= dp[i][j-1]) {
        i--;
      } else {
        j--;
      }
    }
    // Fill unmatched chars with the previous known time (or 0)
    let last = 0;
    const times = new Float64Array(n);
    for (let k = 0; k < n; k++) {
      times[k] = matched[k] ? matched[k] - 1e-9 : last;
      if (matched[k]) last = times[k];
    }
    return times;
  }

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
  }
  applyTheme('normal'); // set the default favicon/title on load

  function restoreNormal() {
    halMode = false;
    halLLM = false; halLLMBusy = false; halLLMState = null;
    sansMode = false;
    if (_sansMenuMusic) { _sansMenuMusic.pause(); _sansMenuMusic.currentTime = 0; }
    cwd = fsHome();
    applyTheme('normal');
  }

  /* ── sans mode ── */
  function activateSansMode() {
    unlockAchievement('judgement');
    halMode = false;
    sansMode = true;
    awaitingInput = null;
    applyTheme('sans');
    if (soundEnabled) sansMenuMusic().play().catch(() => {});
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
    let hue = 0;
    rainbowId = setInterval(() => {
      const r = document.documentElement;
      r.style.setProperty('--green',        `hsl(${hue}, 100%, 50%)`);
      r.style.setProperty('--green-dim',    `hsl(${hue}, 80%,  30%)`);
      r.style.setProperty('--green-bright', `hsl(${hue}, 100%, 70%)`);
      r.style.setProperty('--blue',         `hsl(${(hue + 120) % 360}, 100%, 65%)`);
      r.style.setProperty('--border',       `hsl(${hue}, 80%,  20%)`);
      r.style.setProperty('--bar',          `hsl(${hue}, 80%,   8%)`);
      r.style.setProperty('--bg',           `hsl(${hue}, 100%,  3%)`);
      hue = (hue + 1) % 360;
    }, 30);
  }

  /* ── sans mode commands (outside battle) ── */

  function sansHelp() {
    blank();
    const intro = [
      '* so you wanna know your options.',
      '* heh. sure.',
    ];
    const cmds = [
      ['fight',         'dodge bones · space to attack · mercy to stop'],
      ['check',         'take a look at yourself'],
      ['act',           'flirt · talk · stare · joke'],
      ['item',          'check your pockets'],
      ['mercy / spare', 'the only smart move here'],
      ['run',           'go ahead. try it.'],
    ];
    intro.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(200)),
      Promise.resolve()
    ).then(() => {
      blank();
      cmds.forEach(([c, desc]) => line(`  <span class="blue" style="display:inline-block;width:16ch">${c}</span>  ${desc}`));
      blank();
    });
  }

  function sansCheck() {
    blank();
    const lines = [
      `* ${playerName}  LV 1  HP 20/20`,
      '* AT 0  DF 0',
      '* a human sitting at a computer.',
      '* your sins are etched into your soul.',
      '* heh. not really. you\'re doing fine.',
    ];
    lines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(250)),
      Promise.resolve()
    ).then(() => { blank(); });
  }

  function sansAct() {
    blank();
    chirpTypeLine('* go ahead: flirt, talk, stare, or joke.', sansChirp, 50).then(() => { blank(); });
  }

  function sansItem() {
    blank();
    const lines = [
      '* you check your pockets.',
      '* ...empty.',
      '* heh.',
    ];
    lines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(250)),
      Promise.resolve()
    ).then(() => { blank(); });
  }

  function sansRun() {
    blank();
    chirpTypeLine('* ...', sansChirp, 80).then(() => delay(400))
    .then(() => chirpTypeLine('* you know what? go ahead.', sansChirp, 50)).then(() => delay(300))
    .then(() => chirpTypeLine('* see ya around, pal.', sansChirp, 50)).then(() => delay(600))
    .then(() => {
      blank();
      restoreNormal();
      scroll();
    });
  }

  function sansJoke() {
    blank();
    const jokes = [
      ['* why did the human cross the road?', "* i don't know. i've seen every possible timeline.", '* they all end the same way.'],
      ['* knock knock.', '* ...', "* heh. you're supposed to say who's there.", '* forget it.'],
      ['* what do you call a skeleton who tells bad jokes?', '* ...', '* humerus. get it?', '* heh heh heh.'],
      ['* what\'s a skeleton\'s least favorite room?', '* the living room.', '* heh heh heh.'],
      ['* why don\'t skeletons fight each other?', '* they don\'t have the guts.', '* ...', '* heh.'],
    ];
    const joke = jokes[Math.floor(Math.random() * jokes.length)];
    joke.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(500)),
      Promise.resolve()
    ).then(() => { blank(); });
  }

  function sansFlirt() {
    blank();
    const responses = [
      ['* ...', '* don\'t push it.'],
      ['* ...', '* heh.', '* yeah, no.'],
      ['* wow.', '* bold move.', '* still no.'],
    ];
    const r = responses[Math.floor(Math.random() * responses.length)];
    r.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(350)),
      Promise.resolve()
    ).then(() => { blank(); });
  }

  function sansTalk() {
    blank();
    const responses = [
      ['* hey.', '* ...that\'s pretty much all i\'ve got.'],
      ['* so.', '* you\'re just sitting there, huh.', '* same, honestly.'],
      ['* between you and me?', '* i\'ve always liked this terminal.', '* good fonts.'],
      ['* you know what\'s funny?', '* i\'ve seen every possible version of this conversation.', '* heh.', '* this one\'s pretty good.'],
    ];
    const r = responses[Math.floor(Math.random() * responses.length)];
    r.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(300)),
      Promise.resolve()
    ).then(() => { blank(); });
  }

  function sansStare() {
    blank();
    chirpTypeLine('* ...', sansChirp, 80).then(() => delay(800))
    .then(() => chirpTypeLine('* yeah.', sansChirp, 50)).then(() => delay(300))
    .then(() => { blank(); });
  }

  function sansShowSansScreen() {
    blank();
    const lines = [
      '* heh.',
      '* you\'re gonna have to do better than that.',
    ];
    lines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(300)),
      Promise.resolve()
    ).then(() => {
      blank();
      line('  <span class="dim">arrow keys to move  ·  space to attack when prompted  ·  type mercy to stop</span>');
      blank();
      scroll();
    });
  }

  function sansMercy() {
    unlockAchievement('walked-away');
    blank();
    chirpTypeLine('* heh. good call.', sansChirp, 50).then(() => delay(400))
    .then(() => chirpTypeLine('* see ya around.', sansChirp, 50)).then(() => delay(700))
    .then(() => {
      blank();
      restoreNormal();
      scroll();
    });
  }

  function sansUnknown(raw) {
    blank();
    const tok = raw.trim().toLowerCase();
    const responses = [
      `* ...you typed "${tok}"?`,
      `* "${tok}". heh. sure.`,
      `* hmm. "${tok}". interesting choice.`,
      `* ...that's not gonna do much here, pal.`,
      `* "${tok}".`,
    ];
    const msg = responses[Math.floor(Math.random() * responses.length)];
    chirpTypeLine(msg, sansChirp, 50).then(() => delay(300))
    .then(() => chirpTypeLine('* heh.', sansChirp, 50))
    .then(() => { blank(); });
  }

  /* ── sans battle ── */

  function sansFight() {
    if (sansBattleActive) {
      blank();
      chirpTypeLine('* we\'re already doing this.', sansChirp, 50).then(() => { blank(); });
      return;
    }
    sansBattleActive = true;
    sansBattle = {};
    blank();
    line('  <span class="dim">[arrows] move / choose option · [z] confirm · type run to bail out</span>');
    blank();
    startPersistentFight();
  }

  function sansBattleCommand(token) {
    if (token === 'run') {
      if (sansBattle._stop) sansBattle._stop();
      sansBattleActive = false;
      sansRun();
    } else if (token === 'mercy' || token === 'spare') {
      if (sansBattle._mercy) sansBattle._mercy();
    } else if (token === 'help') {
      blank();
      line('  <span class="dim">[arrows] move / choose · [z] confirm · run bails out · mercy... try it</span>');
      blank();
    } else {
      blank();
      chirpTypeLine('* ...', sansChirp, 50).then(() => { blank(); });
    }
  }

  function startPersistentFight() {
    const BW = 32, BH = 9;
    const TICK = 50;             // 20 fps
    const IFRAMES = 18;
    const CHARGE = 24, FIRE = 11; // gaster blaster phases (frames)

    /* ── state machine: dialog → menu → (aim|act|item|mercy) → dodge → menu … ── */
    let mode = 'dialog';
    let frame = 0, done = false;
    let hx = Math.floor(BW / 2), hy = Math.floor(BH / 2), prevHx = hx, prevHy = hy;
    let invFrames = 0;
    let hp = 20, maxHP = 20, kr = 0, krTimer = 0;
    let turnNo = 0, menuIdx = 0, pieUsed = false, asleep = false, dunking = false;
    let bones = [], blasters = [];
    let dodgeTimer = 0, dodgeLen = 0, waveFn = null;
    let dialogQueue = [], dialogText = '', dialogPos = 0, dialogHold = 0, afterDialog = null;
    let aimX = 1, aimDir = 1;
    let missTimer = 0, missLabel = '';
    let sansX = 0, sansHitFlash = 0;
    let soulBlue = false, hyF = 4, vy = 0;   // blue-soul gravity mode
    let dieT = 0;                             // heart-shatter animation clock
    const keys = new Set();

    /* ── battle SFX (WebAudio chirps; silent when sound is off) ── */
    const sfx = {
      move:    () => _chirp(620, 'square', 0.04, 0.05),
      confirm: () => _chirp(880, 'square', 0.06, 0.07),
      slash:   () => { _chirp(700, 'sawtooth', 0.08, 0.08); setTimeout(() => _chirp(430, 'sawtooth', 0.1, 0.08), 60); },
      slam:    () => { _chirp(70, 'sawtooth', 0.22, 0.16); _chirp(140, 'square', 0.12, 0.08); },
      hurt:    () => _chirp(160, 'sawtooth', 0.18, 0.12),
      blaster: () => { _chirp(95, 'sawtooth', 0.35, 0.12); _chirp(190, 'square', 0.3, 0.06); },
      shatter: () => { _chirp(1200, 'square', 0.05, 0.1); setTimeout(() => _chirp(700, 'square', 0.06, 0.08), 70); setTimeout(() => _chirp(420, 'square', 0.09, 0.08), 150); },
    };

    /* ── DOM (sticky battle panel): pixel sans + speech bubble, then the box ── */
    const container = document.createElement('div');
    container.style.cssText = 'position:sticky;bottom:0;padding:6px 0 2px;z-index:10;background:var(--bg)';
    out.appendChild(container);

    const spriteRow = document.createElement('div');
    spriteRow.style.cssText = 'display:flex;align-items:center;gap:14px;min-height:132px;padding-left:34px';
    const spriteCanvas = document.createElement('canvas');
    spriteCanvas.width = 112; spriteCanvas.height = 126; // 16×18 map at 7px cells
    spriteCanvas.style.cssText = 'image-rendering:pixelated;transition:transform 0.15s';
    const sctx = spriteCanvas.getContext('2d');
    const bubbleEl = document.createElement('div');
    bubbleEl.style.cssText = 'font-family:inherit;font-size:13px;line-height:1.45;max-width:240px;' +
      'border:1px solid var(--green);border-radius:6px;padding:6px 10px;position:relative;visibility:hidden';
    const bubbleTail = document.createElement('span');
    bubbleTail.textContent = '◄';
    bubbleTail.style.cssText = 'visibility:hidden';
    spriteRow.appendChild(spriteCanvas);
    spriteRow.appendChild(bubbleTail);
    spriteRow.appendChild(bubbleEl);
    container.appendChild(spriteRow);

    const pre = document.createElement('pre');
    pre.className = 'ascii';
    pre.style.cssText = 'font-size:13px;line-height:1.3';
    container.appendChild(pre);

    /* ── input — capture phase so games keys never reach the terminal ── */
    const onKD = e => {
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault(); e.stopPropagation();
        keys.add(e.key);
        if (mode === 'menu') {
          if (e.key === 'ArrowLeft')  { menuIdx = (menuIdx + 3) % 4; sfx.move(); }
          if (e.key === 'ArrowRight') { menuIdx = (menuIdx + 1) % 4; sfx.move(); }
        }
        return;
      }
      // z (or space with an empty prompt) = confirm; Enter is left alone so typed commands still work
      const confirm = e.key === 'z' || e.key === 'Z' || (e.key === ' ' && cmd.value === '');
      if (confirm) {
        e.preventDefault(); e.stopPropagation();
        onConfirm();
      }
    };
    const onKU = e => keys.delete(e.key);
    const onBlur = () => keys.clear(); // alt-tab mid-fight must not leave keys stuck held
    window.addEventListener('keydown', onKD, true);
    window.addEventListener('keyup',   onKU, true);
    window.addEventListener('blur',    onBlur);

    /* ── music — does NOT start yet. The intro plays in silence; the music
          drops with the first attack, the way it's supposed to. ── */
    if (_sansMenuMusic) _sansMenuMusic.pause();
    const battleMusic = new Audio('assets/audio/pixel_fury.mp3');
    battleMusic.preload = 'none';   // created up front but doesn't play until the first attack
    battleMusic.loop = true;
    battleMusic.volume = 0.5;
    let musicStarted = false;
    function dropTheMusic() {
      if (musicStarted) return;
      musicStarted = true;
      activeMusic = battleMusic;
      if (soundEnabled) battleMusic.play().catch(() => {});
    }

    function cleanup() {
      if (done) return; done = true;
      clearInterval(loopId);
      window.removeEventListener('keydown', onKD, true);
      window.removeEventListener('keyup',   onKU, true);
      window.removeEventListener('blur',    onBlur);
      battleMusic.pause();
      battleMusic.currentTime = 0;
      if (activeMusic === battleMusic) activeMusic = null;
    }
    function stopAndRemove() { cleanup(); container.remove(); }
    sansBattle._stop  = stopAndRemove;
    sansBattle._mercy = chooseMercy;

    /* ── dialogue ── */
    function say(lines, then) {
      dialogQueue = lines.slice();
      afterDialog = then || null;
      mode = 'dialog';
      nextLine();
    }
    function nextLine() {
      if (!dialogQueue.length) {
        const fn = afterDialog; afterDialog = null;
        if (fn) fn();
        return;
      }
      dialogText = dialogQueue.shift();
      dialogPos = 0;
      dialogHold = 0;
    }

    /* ── the script — sans's turns, in order ── */
    const TURNS = [
      { say: ["heya.", "you've been busy, huh?", "you feel like you're gonna have a bad time."], wave: waveSlalom,  len: 230 },
      { say: ["you're blue now.", "that's my attack.", "heh. gravity. try jumping."],            wave: waveBlueSoul, len: 270, soul: true },
      { say: ["what? you think i'm just gonna stand there and take it?"],                       wave: waveWalls,   len: 250 },
      { say: ["here's a tip: blue bones don't hurt...", "...as long as you hold still."],       wave: waveBlue,    len: 290 },
      { say: ["huh. always wanted to try these things out."],                                   wave: waveBlaster, len: 290 },
      { say: ["you're, uh, pretty persistent. i'll give you that."],                            wave: waveMix,     len: 310 },
      { say: ["sounds strange, but before all this...", "i was secretly hoping we could be friends."], wave: waveHard, len: 330 },
      { say: ["alright. that's it.", "it's time for my special attack.", "are you ready?", "here goes nothing."], wave: waveNothing, len: 110 },
    ];
    const MENU_FLAVOR = [
      '* you feel your sins crawling on your back.',
      '* sans is looking right at you.',
      '* the room smells like ketchup.',
      '* sans is starting to sweat.',
      '* you feel something familiar.',
      '* sans looks exhausted.',
      '* sans is sparing you?  no. wait. that\'s not it.',
      '* sans is snoring.',
    ];
    const DODGE_QUIPS = ['nope.', 'too slow.', 'what, you thought that\'d hit?', 'heh. nice try.', 'keep dreaming, pal.'];

    /* ── waves ── */
    function rndGapY() { return 1 + Math.floor(Math.random() * (BH - 4)); }
    function wall(x, dir, gapY, gapH, spd, blue) { bones.push({ kind: 'wall', x, dir, gapY, gapH, spd, blue: !!blue }); }
    function strip(y, x, dir, len, spd) { bones.push({ kind: 'strip', y, x, dir, len, spd }); }
    function blaster(orient, idx) { blasters.push({ orient, idx, t: 0 }); }

    function waveSlalom(t)  { if (t % 24 === 0) wall(BW - 1, -1, rndGapY(), 3, 2); }
    function waveWalls(t)   {
      if (t % 20 === 0) wall(BW - 1, -1, rndGapY(), 3, 2);
      if (t % 31 === 15) strip(1 + Math.floor(Math.random() * (BH - 2)), BW - 1, -1, 7, 2);
    }
    function waveBlue(t)    { if (t % 17 === 0) wall(BW - 1, -1, rndGapY(), 3, 2, Math.floor(t / 17) % 2 === 1); }
    function waveBlaster(t) {
      if (t % 46 === 0) blaster(Math.random() < 0.5 ? 'row' : 'col',
        Math.random() < 0.5 ? hy : Math.floor(Math.random() * BH));
      if (t % 34 === 17) wall(BW - 1, -1, rndGapY(), 4, 2);
    }
    function waveMix(t)     {
      if (t % 22 === 0) wall(BW - 1, -1, rndGapY(), 3, 2, Math.random() < 0.4);
      if (t % 50 === 25) blaster('row', hy);
      if (t % 37 === 30) strip(hy, BW - 1, -1, 6, 2);
    }
    function waveHard(t)    {
      if (t % 18 === 0) wall(BW - 1, -1, rndGapY(), 3, Math.random() < 0.5 ? 1 : 2, Math.random() < 0.35);
      if (t % 42 === 20) blaster(Math.random() < 0.6 ? 'row' : 'col', Math.random() < 0.6 ? (Math.random() < 0.5 ? hy : hx) : Math.floor(Math.random() * BH));
    }
    function waveNothing()  {} // the special attack. it's literally nothing.
    function waveBlueSoul(t) {
      if (t < 30) return; // grace period after the slam — feel the jump out first
      if (t % 34 === 0)  strip(BH - 1, BW - 1, -1, 5, 2);   // floor bones — hop these
      if (t % 53 === 26) strip(BH - 2, BW - 1, -1, 6, 2);   // head-height — don't jump into it
      if (t % 78 === 58) blaster('row', BH - 2);             // mid-air beam — stay grounded
    }
    function waveDunk(t)    {
      if (t === 6)  wall(0, 1, hy, 0, 1);       // gapless, from the left
      if (t === 14) wall(BW - 1, -1, hy, 0, 1); // gapless, from the right
      if (t % 8 === 4) blaster('row', hy);
    }

    /* ── turn flow ── */
    function startSansTurn() {
      const T = TURNS[Math.min(turnNo, TURNS.length - 1)];
      turnNo++;
      say(T.say, () => {
        if (T.soul) { beginDodge(T.wave, T.len, () => { mode = 'menu'; }, true); return; }
        if (T.wave === waveNothing) {
          // the special attack: a long, dramatic stretch of absolutely nothing
          beginDodge(T.wave, T.len, () => {
            say(["yep. that's right.", "it's literally nothing.", "and it's not going to be anything, either.",
                 "...", "i know i can't beat you.", "so, uh. i've decided it's not gonna be anyone's turn.",
                 "capiche?", "...", "just gonna... rest my eyes... for a second..."], () => {
              asleep = true;
              mode = 'menu';
            });
          });
        } else {
          beginDodge(T.wave, T.len, () => { mode = 'menu'; });
        }
      });
    }
    let afterDodge = null;
    function beginDodge(fn, len, then, soul) {
      dropTheMusic();
      waveFn = fn; dodgeLen = len; dodgeTimer = 0;
      bones = []; blasters = [];
      soulBlue = !!soul; vy = 0;
      hx = Math.floor(BW / 2);
      hy = Math.floor(BH / 2);
      hyF = hy;
      if (soulBlue) vy = 2.2; // he doesn't set you down. he SLAMS you down.
      slammed = false;
      afterDodge = then;
      mode = 'dodge';
    }
    let slammed = true;

    /* ── menu actions ── */
    function onConfirm() {
      if (mode === 'dialog') {           // skip / advance
        if (dialogPos < dialogText.length) dialogPos = dialogText.length;
        else nextLine();
        return;
      }
      if (mode === 'menu') {
        sfx.confirm();
        if (menuIdx === 0) { mode = 'aim'; aimX = 1; aimDir = 1; }
        else if (menuIdx === 1) {        // ACT → Check (the only option, like the real fight)
          say(['* sans — ATK 1  DF 1.', "* the easiest enemy.", '* can only deal 1 damage.',
               ...(asleep ? [] : ['* somehow, that is not reassuring.'])],
              () => { asleep ? (mode = 'menu') : startSansTurn(); });
        }
        else if (menuIdx === 2) {        // ITEM
          if (!pieUsed) {
            pieUsed = true; hp = maxHP; kr = 0;
            say(['* you found a slice of butterscotch pie.', '* your HP was maxed out.'],
                () => { asleep ? (mode = 'menu') : startSansTurn(); });
          } else {
            say(['* your pockets are empty.', '* somewhere, sans snickers.'],
                () => { asleep ? (mode = 'menu') : startSansTurn(); });
          }
        }
        else if (menuIdx === 3) chooseMercy();
        return;
      }
      if (mode === 'aim') {
        sfx.slash();
        if (asleep) { landTheHit(); return; }
        // he dodges. of course he dodges.
        missLabel = 'MISS'; missTimer = 28;
        sansX = aimX < BW / 2 ? 7 : -7;
        say([DODGE_QUIPS[Math.min(turnNo, DODGE_QUIPS.length - 1) % DODGE_QUIPS.length]], () => startSansTurn());
        setTimeout(() => { sansX = 0; }, 900);
      }
    }

    function chooseMercy() {
      if (done || dunking) return;
      dunking = true;
      asleep = false;
      say(["so you're sparing me?", 'finally. buddy. pal.',
           'i know how hard it must be... to make that choice.',
           'well, here\'s my counteroffer:', 'geeeeettttttt dunked on!!!'],
          () => beginDodge(waveDunk, 90, () => { hp = 0; die(); }));
    }

    function landTheHit() {
      sansHitFlash = 20;
      missLabel = '9999999'; missTimer = 30;
      dialogText = ''; dialogPos = 0;
      mode = 'hit';
      setTimeout(() => {
        stopAndRemove();
        sansBattleActive = false;
        unlockAchievement('bad-time');
        blank();
        const winLines = [
          '* ...',
          '* ... so. guess that\'s it, huh?',
          '* welp. i\'m outta shortcuts.',
          '* heh. you actually did it.',
          '* i\'ll be honest. i\'m impressed.',
          '* take care of yourself, kid.',
        ];
        winLines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(450)),
          Promise.resolve()
        ).then(() => {
          restoreNormal();
          blank();
          scroll();
        });
      }, 1600);
    }

    function die() {
      stopAndRemove();
      sansBattleActive = false;
      sansDeaths++;
      if (sansDeaths >= 5) unlockAchievement('determination');
      blank();
      const deathLines = dunking
        ? ['* geeettttttt dunked on!!!', '* ...', `* you cannot give up just yet, ${playerName}...`, '* stay determined.']
        : [`* you cannot give up just yet, ${playerName}...`, '* stay determined.'];
      deathLines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(400)),
        Promise.resolve()
      ).then(() => {
        blank();
        if (soundEnabled) sansMenuMusic().play().catch(() => {});
        sansShowSansScreen();
      });
    }

    /* ── per-frame simulation ── */
    function hitAt(cx, cy) {
      for (const b of bones) {
        if (b.kind === 'wall') {
          if (Math.round(b.x) === cx && (cy < b.gapY || cy >= b.gapY + b.gapH)) return b;
        } else {
          const bx = Math.round(b.x);
          if (b.y === cy && cx >= Math.min(bx, bx + b.dir * (b.len - 1)) && cx <= Math.max(bx, bx + b.dir * (b.len - 1))) return b;
        }
      }
      return null;
    }

    function applyHit(dmg) {
      sfx.hurt();
      if (dmg >= 99) hp = 0;              // the dunk is not survivable. sorry, pal.
      else { hp = Math.max(0, hp - 1); kr += dmg - 1; } // 1 lands now, the rest drains in as KR
      invFrames = IFRAMES;
      if (hp <= 0) { mode = 'dying'; dieT = 0; return true; } // heart-shatter beat, then die()
      return false;
    }

    const loopId = setInterval(() => {
      if (done) return;
      frame++;

      /* KR drain — karma never lands the killing blow, just like the real thing */
      if (kr > 0 && ++krTimer >= 7) {
        krTimer = 0;
        if (hp > 1) { hp--; kr--; } else kr = 0;
      }
      if (missTimer > 0) missTimer--;
      if (sansHitFlash > 0) sansHitFlash--;

      if (mode === 'dialog') {
        // THE line crawls out at half speed; lines auto-advance after a beat
        // ([z] skips ahead for impatient readers)
        const slowLine = dialogText === 'should be burning in hell.';
        if (dialogPos < dialogText.length) {
          if (!slowLine || frame % 2 === 0) {
            dialogPos++;
            if (dialogPos % 2 === 0) sansChirp();
          }
        } else if (++dialogHold > (slowLine ? 48 : 30)) {
          dialogHold = 0;
          nextLine();
        }
      }

      if (mode === 'aim') {
        aimX += aimDir * 1.4;
        if (aimX <= 1 || aimX >= BW - 2) aimDir = -aimDir;
      }

      if (mode === 'dying') {
        dieT++;
        if (dieT === 8) sfx.shatter();
        if (dieT >= 32) { die(); return; }
      }

      if (mode === 'dodge') {
        dodgeTimer++;
        prevHx = hx; prevHy = hy;
        if (soulBlue) {
          // gravity mode: left/right run, ↑ jumps, ↓ fast-falls.
          // Floaty arc; jump also allowed slightly above the ground (forgiveness).
          if (keys.has('ArrowLeft')  && hx > 0)      hx--;
          if (keys.has('ArrowRight') && hx < BW - 1) hx++;
          if (keys.has('ArrowUp') && hyF >= BH - 2 && vy >= 0) vy = -1.15;
          if (keys.has('ArrowDown')) vy += 0.4;
          vy = Math.min(1.1, vy + 0.16);
          hyF = Math.max(0, Math.min(BH - 1, hyF + vy));
          hy = Math.round(hyF);
          if (hy >= BH - 1) {
            hy = BH - 1; hyF = BH - 1;
            if (vy > 0) { if (!slammed) { slammed = true; sfx.slam(); } vy = 0; }
          }
        } else {
          if (keys.has('ArrowUp')    && hy > 0)      hy--;
          if (keys.has('ArrowDown')  && hy < BH - 1) hy++;
          if (keys.has('ArrowLeft')  && hx > 0)      hx--;
          if (keys.has('ArrowRight') && hx < BW - 1) hx++;
          hyF = hy;
        }
        const movedNow = hx !== prevHx || hy !== prevHy;

        waveFn(dodgeTimer);

        for (const b of bones) {
          if (frame % b.spd === 0) b.x += (b.dir !== undefined ? b.dir : -1);
        }
        bones = bones.filter(b => b.x > -(2 + (b.len || 0)) && b.x < BW + 2 + (b.len || 0));
        for (const bl of blasters) {
          bl.t++;
          if (bl.t === CHARGE) sfx.blaster();
        }
        blasters = blasters.filter(bl => bl.t < CHARGE + FIRE);

        if (invFrames > 0) invFrames--;
        else {
          const b = hitAt(hx, hy);
          if (b && (!b.blue || movedNow)) {
            if (applyHit(dunking ? 99 : 2)) return;
          }
          for (const bl of blasters) {
            if (bl.t >= CHARGE &&
                ((bl.orient === 'row' && bl.idx === hy) || (bl.orient === 'col' && bl.idx === hx))) {
              if (applyHit(3)) return;
              break;
            }
          }
        }

        if (dodgeTimer >= dodgeLen && !dunking) {
          bones = []; blasters = [];
          const fn = afterDodge; afterDodge = null;
          if (fn) fn();
        }
      }

      render();
    }, TICK);

    /* ── rendering ── */
    function wrapText(s, w) {
      const words = s.split(' '), lines = [];
      let cur = '';
      for (const word of words) {
        if ((cur + ' ' + word).trim().length > w) { lines.push(cur.trim()); cur = word; }
        else cur += ' ' + word;
      }
      if (cur.trim()) lines.push(cur.trim());
      return lines;
    }

    /* ── the pixel sans (16×18, drawn from scratch — no game assets) ──
       W skull · B hoodie · S shirt · D shorts · P slippers · K dark
       L/R eye-socket blocks, resolved per state · . transparent      */
    const SANS_MAP = [
      '....WWWWWWWW....',
      '..WWWWWWWWWWWW..',
      '.WWWWWWWWWWWWWW.',
      '.WWLLWWWWWWRRWW.',
      '.WWLLWWWWWWRRWW.',
      '.WWWWWWKKWWWWWW.',
      '.WKWWWWWWWWWWKW.',
      '.WWKKKKKKKKKKWW.',
      '..WWWWWWWWWWWW..',
      '...WWWWWWWWWW...',
      '..BBBBBBBBBBBB..',
      '.BBBBBSSSSBBBBB.',
      '.BBBBSSSSSSBBBB.',
      '.BBBBSSSSSSBBBB.',
      '..DDDDDDDDDDDD..',
      '..DDDWDDDDWDDD..',
      '...DDD....DDD...',
      '..PPPP....PPPP..',
    ];
    const SANS_PAL = {
      W: '#f0f0e8', B: '#2f7fe0', S: '#d8d8d8',
      D: '#23252e', P: '#ff9ecb', K: '#0a0a0a', C: '#41c8ff',
    };
    const CELL = 7;
    let lastSpriteKey = '';

    function drawSprite() {
      const eyeFlare = (mode === 'dodge' && frame % 14 < 7) ||
                       (mode === 'dialog' && dialogText === 'should be burning in hell.' && frame % 8 < 4);
      const eyeState = (sansHitFlash > 0 || mode === 'hit') ? 'hit'
                     : asleep ? 'sleep' : eyeFlare ? 'flare' : 'normal';
      const sweat = turnNo >= 4 && !asleep && mode !== 'hit';
      const key = eyeState + '|' + sweat;
      spriteCanvas.style.transform = `translateX(${sansX * 6}px)`;
      if (key === lastSpriteKey) return;
      lastSpriteKey = key;

      sctx.clearRect(0, 0, spriteCanvas.width, spriteCanvas.height);
      for (let y = 0; y < SANS_MAP.length; y++) {
        for (let x = 0; x < SANS_MAP[y].length; x++) {
          let ch = SANS_MAP[y][x];
          if (ch === '.') continue;
          if (ch === 'L' || ch === 'R') {
            if (eyeState === 'sleep') ch = y === 3 ? 'W' : 'K';           // lids down
            else if (eyeState === 'flare') ch = ch === 'L' ? 'C' : 'K';   // left eye blazes
            else if (eyeState === 'hit') ch = 'K';                        // lights out
            else {
              // dark sockets with white pin-prick pupils
              const pupil = (ch === 'L' && x === 4 && y === 4) || (ch === 'R' && x === 10 && y === 4);
              ch = pupil ? 'W' : 'K';
            }
          }
          sctx.fillStyle = SANS_PAL[ch];
          sctx.fillRect(x * CELL, y * CELL, CELL, CELL);
        }
      }
      if (sweat) {
        sctx.fillStyle = SANS_PAL.C;
        sctx.fillRect(15 * CELL, 1 * CELL, CELL - 2, CELL);
        sctx.fillRect(15 * CELL, 2 * CELL + 3, CELL - 2, CELL - 2);
      }
    }

    function updateBubble() {
      let html = '', color = 'var(--green)';
      if (mode === 'dialog' && dialogText) {
        html = dialogText.slice(0, dialogPos);
      } else if (missTimer > 0) {
        html = `<span style="color:${missLabel === 'MISS' ? '#ffff44' : '#ff4444'};font-weight:bold;font-size:17px">${missLabel}</span>`;
      } else if (asleep && mode === 'menu') {
        html = '<span class="dim">z z Z ...</span>';
      }
      const show = html !== '';
      bubbleEl.style.visibility = show ? 'visible' : 'hidden';
      bubbleTail.style.visibility = show ? 'visible' : 'hidden';
      if (show) bubbleEl.innerHTML = html;
    }

    function render() {
      const grid = Array.from({ length: BH }, () => Array(BW).fill(' '));

      if (mode === 'dodge') {
        for (const b of bones) {
          if (b.kind === 'wall') {
            const x = Math.round(b.x);
            if (x >= 0 && x < BW) {
              for (let y = 0; y < BH; y++) {
                if (y < b.gapY || y >= b.gapY + b.gapH) grid[y][x] = b.blue ? 'B' : '║';
              }
            }
          } else {
            const x0 = Math.round(b.x);
            for (let i = 0; i < b.len; i++) {
              const x = x0 + b.dir * i;
              if (x >= 0 && x < BW && b.y >= 0 && b.y < BH) grid[b.y][x] = '═';
            }
          }
        }
        for (const bl of blasters) {
          if (bl.t < CHARGE) {
            const blink = Math.floor(bl.t / 3) % 2 === 0;
            if (bl.orient === 'row') {
              grid[bl.idx][0] = 'Ø';
              if (blink) for (let x = 1; x < BW; x++) if (grid[bl.idx][x] === ' ') grid[bl.idx][x] = '·';
            } else {
              grid[0][bl.idx] = 'Ø';
              if (blink) for (let y = 1; y < BH; y++) if (grid[y][bl.idx] === ' ') grid[y][bl.idx] = '·';
            }
          } else {
            if (bl.orient === 'row') for (let x = 0; x < BW; x++) grid[bl.idx][x] = '▓';
            else for (let y = 0; y < BH; y++) grid[y][bl.idx] = '▓';
          }
        }
      }

      /* box interior as HTML rows */
      const heartVis = invFrames === 0 || Math.floor(invFrames / 3) % 2 === 0;
      const boxRows = [];
      if (mode === 'dialog' || mode === 'hit') {
        // the box sits empty while sans talks — his words live in the bubble
        for (let y = 0; y < BH; y++) boxRows.push(' '.repeat(BW));
      } else if (mode === 'menu') {
        const flavor = wrapText(asleep ? MENU_FLAVOR[7] : MENU_FLAVOR[Math.min(turnNo, 6)], BW - 4);
        for (let y = 0; y < BH; y++) {
          const t = flavor[y - 1] || '';
          boxRows.push('  ' + t + ' '.repeat(Math.max(0, BW - 2 - t.length)));
        }
      } else if (mode === 'aim') {
        for (let y = 0; y < BH; y++) {
          let row = ' '.repeat(BW);
          if (y === Math.floor(BH / 2)) {
            const cells = Array(BW).fill('─');
            cells[Math.floor(BW / 2)] = '█';
            cells[Math.floor(BW / 2) - 1] = '▌';
            cells[Math.floor(BW / 2) + 1] = '▐';
            const ax = Math.round(aimX);
            if (ax >= 0 && ax < BW) cells[ax] = '<span style="color:#ff4444">┃</span>';
            row = cells.join('');
          } else if (asleep && y === Math.floor(BH / 2) + 2) {
            const t = '      ...he\'s fast asleep.';
            row = t + ' '.repeat(Math.max(0, BW - t.length));
          }
          boxRows.push(row);
        }
      } else {
        const heartHtml = mode === 'dying'
          ? (dieT < 8  ? '<span style="color:#ff3333">♥</span>' :
             dieT < 18 ? '<span style="color:#ffffff">♡</span>' :
                         '<span style="color:#ffffff">✶</span>')
          : `<span style="color:${soulBlue ? '#41c8ff' : '#ff3333'}">♥</span>`;
        for (let y = 0; y < BH; y++) {
          let row = '';
          for (let x = 0; x < BW; x++) {
            if (x === hx && y === hy && (heartVis || mode === 'dying')) row += heartHtml;
            else if (grid[y][x] === 'B')          row += '<span style="color:#3aa7ff">║</span>';
            else if (grid[y][x] === '▓')          row += '<span style="color:#ffffff">▓</span>';
            else if (grid[y][x] === 'Ø')          row += '<span style="color:#ffffff">Ø</span>';
            else row += grid[y][x];
          }
          boxRows.push(row);
        }
      }

      /* assemble panel */
      drawSprite();
      updateBubble();
      const lines = [];
      lines.push('╔' + '═'.repeat(BW) + '╗');
      for (const r of boxRows) lines.push('║' + r + '║');
      lines.push('╚' + '═'.repeat(BW) + '╝');

      const filled = Math.max(0, Math.round(hp / maxHP * 16));
      const hpColor = hp > 10 ? '#ffff00' : hp > 5 ? '#ff8800' : '#ff3333';
      const krSpan = kr > 0 ? '  <span style="color:#d535d5">KR</span>' : '';
      lines.push(` ${playerName.toUpperCase().slice(0, 10)}  LV 1   HP <span style="color:${hpColor}">${'█'.repeat(filled)}${'░'.repeat(16 - filled)}</span> ${hp}/${maxHP}${krSpan}`);

      const BTNS = ['FIGHT', 'ACT', 'ITEM', 'MERCY'];
      const menuRow = BTNS.map((b, i) =>
        mode === 'menu' && i === menuIdx
          ? `<span style="color:#ffff44">♥${b}</span>`
          : `<span style="color:#c4691b"> ${b}</span>`
      ).join('   ');
      lines.push(' ' + menuRow);

      const HINTS = {
        dialog: '[z] skip',
        menu: '[←→] choose · [z] confirm',
        aim: '[z] stop the bar',
        dodge: soulBlue ? '[↑] jump · [↓] drop fast · [←→] run — dodge!' : 'dodge!',
      };
      lines.push(`<span class="dim"> ${HINTS[mode] || ''}</span>`);

      pre.innerHTML = lines.join('\n');
      scroll();
    }

    /* ── opening — the most famous speech in the game ── */
    const intro = sansDeaths > 0
      ? ['hmm.', 'that expression...',
         `that's the expression of someone who's died ${sansDeaths === 1 ? 'once' : sansDeaths + ' times'} already.`,
         'heh. take ' + (sansDeaths + 1) + '.']
      : ["it's a beautiful day outside.",
         'birds are singing. flowers are blooming...',
         'on days like these, kids like you...',
         'should be burning in hell.'];
    say(intro, () => {
      // sans attacks FIRST. of course he does.
      beginDodge(waveMix, 150, () => { mode = 'menu'; });
    });
    render();
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
      '',
      'MISUSE — flooding it, extracting its prompt,',
      'using it as a free AI, or coaxing harmful',
      'output is logged and will NOT be tolerated.',
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
  function fsResolve(input) {
    const raw = (input || '').trim();
    if (raw === '' || raw === '~') return fsHome();
    if (raw === '/') return [];
    let segs, parts;
    if (raw.startsWith('/'))        { segs = [];          parts = raw.slice(1).split('/'); }
    else if (raw.startsWith('~/'))  { segs = fsHome();    parts = raw.slice(2).split('/'); }
    else                            { segs = cwd.slice(); parts = raw.split('/'); }
    for (const p of parts) {
      if (p === '' || p === '.') continue;
      if (p === '..') { if (segs.length) segs.pop(); continue; }
      segs.push(p);
    }
    return segs;
  }

  /* Writable session layer: an overlay tree merged on top of the read-only
   * buildFS(). Files/dirs created with touch/mkdir/redirect live here; deletions
   * leave a { deleted:true } tombstone. It is in-memory only — a reload restores
   * the pristine site. Same node shapes as buildFS, plus `session:true`. */
  const sessionFS = {};

  function mergeNode(base, over) {
    if (!over) return base;
    if (over.deleted) return undefined;          // tombstone hides the base node
    if (over.d) {                                // overlay directory → union children
      const merged = { d: {} };
      const baseKids = (base && base.d) ? base.d : {};
      for (const k in baseKids) merged.d[k] = baseKids[k];
      for (const k in over.d) {
        const r = mergeNode(merged.d[k], over.d[k]);
        if (r === undefined) delete merged.d[k];
        else merged.d[k] = r;
      }
      if (base && base.d) { if (base.enter) merged.enter = base.enter; if (base.locked) merged.locked = base.locked; }
      return merged;
    }
    return over;                                  // overlay file replaces base
  }

  // The live tree: read-only base with the session overlay applied.
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

  function fsDisplay(segs) {
    const h = fsHome();
    if (segs.length >= h.length && h.every((p, i) => segs[i] === p))
      return '~' + (segs.length > h.length ? '/' + segs.slice(h.length).join('/') : '');
    return '/' + segs.join('/');
  }

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

  /* ── Argument tokenizing + glob (*, ?) expansion ── */
  function tokenizeArgs(str) {
    const out = [], re = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let m;
    while ((m = re.exec(str || ''))) out.push(m[1] ?? m[2] ?? m[3]);
    return out;
  }
  const hasGlob = w => /[*?]/.test(w);
  function globToRe(seg) {
    let re = '^';
    for (const ch of seg) {
      if (ch === '*') re += '[^/]*';
      else if (ch === '?') re += '[^/]';
      else re += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
    return new RegExp(re + '$');
  }
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

  /* ── Small shell builtins (history expansion, micro-commands, pipes) ── */

  // !! / !n / !-k / !prefix → the matching past command, or null.
  function expandBang(t) {
    const n = cmdHistory.length;
    if (!n) return null;
    if (t === '!!') return cmdHistory[0];
    const rest = t.slice(1);
    if (/^\d+$/.test(rest))  { const k = +rest;          return (k >= 1 && k <= n) ? cmdHistory[n - k] : null; }
    if (/^-\d+$/.test(rest)) { const k = +rest.slice(1);  return (k >= 1 && k <= n) ? cmdHistory[k - 1] : null; }
    return cmdHistory.find(c => c.startsWith(rest)) || null;
  }

  // History list, oldest-first with 1-based numbers (matches !n indexing).
  function historyLines() {
    const n = cmdHistory.length;
    return cmdHistory.slice().reverse()
      .map((c, i) => `  ${String(i + 1).padStart(3)}  ${c}`);
  }
  function handleHistory() { blank(); historyLines().forEach(l => line(esc(l))); blank(); }

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

  function expandVars(s) {
    let out = (s || '').trim();
    if (out.length >= 2 && /^["']/.test(out) && out[0] === out[out.length - 1]) out = out.slice(1, -1);
    return out
      .replace(/\$USER\b/g, 'ian')
      .replace(/\$HOME\b/g, '/home/ian')
      .replace(/\$HOSTNAME\b/g, 'portfolio')
      .replace(/\$PWD\b/g, '/' + cwd.join('/'))
      .replace(/\$SHELL\b/g, '/bin/bash')
      .replace(/\$\?/g, '0');
  }

  function dateStr() {
    const d = new Date();
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const mons = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const p = n => String(n).padStart(2, '0');
    const tz = (d.toString().match(/\(([^)]+)\)/) || [])[1] || '';
    const abbr = tz.split(' ').map(w => w[0]).join('') || 'UTC';
    return `${days[d.getDay()]} ${mons[d.getMonth()]} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${abbr} ${d.getFullYear()}`;
  }

  function unameStr(arg) {
    const a = (arg || '').trim();
    if (a.includes('a')) return 'Linux portfolio 9.0.0-hal #1 SMP x86_64 GNU/Linux';
    if (a.includes('r')) return '9.0.0-hal';
    if (a.includes('m')) return 'x86_64';
    return 'Linux';
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

  // ── Pipes: a source command produces text lines, filters transform them. ──
  function numFlag(args, def) {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '-n' && args[i + 1] != null) return parseInt(args[i + 1]) || def;
      const m = /^-(\d+)$/.exec(args[i]);
      if (m) return parseInt(m[1]);
    }
    return def;
  }

  function pipeSource(seg) {
    const c = seg.split(/\s+/)[0];
    const arg = seg.slice(c.length).trim();
    switch (c) {
      case 'cat':     { const words = expandArgList(arg); if (!words.length) return { err: 'cat: missing file operand' }; const r = catLines(words); return { lines: r.lines, errs: r.errs }; }
      case 'ls':      return { lines: lsNames(arg) };
      case 'history': return { lines: historyLines() };
      case 'echo':    return { lines: [expandVars(arg)] };
      case 'pwd':     return { lines: ['/' + cwd.join('/')] };
      case 'whoami':  return { lines: ['ian'] };
      case 'date':    return { lines: [dateStr()] };
      case 'uname':   return { lines: [unameStr(arg)] };
      default:        return { err: `bash: ${c}: command not found` };
    }
  }

  function pipeFilter(seg, lines) {
    const parts = seg.split(/\s+/).filter(Boolean);
    const c = parts[0];
    const args = parts.slice(1);
    switch (c) {
      case 'grep': {
        let ci = false, inv = false; const pats = [];
        args.forEach(a => {
          if (/^-[ivIV]+$/.test(a)) { if (/[iI]/.test(a)) ci = true; if (/[vV]/.test(a)) inv = true; }
          else pats.push(a);
        });
        if (!pats.length) return { err: 'usage: grep [-i] [-v] pattern' };
        const pat = pats.join(' ');
        const hit = ci ? l => l.toLowerCase().includes(pat.toLowerCase()) : l => l.includes(pat);
        return { lines: lines.filter(l => inv ? !hit(l) : hit(l)) };
      }
      case 'head': return { lines: lines.slice(0, numFlag(args, 10)) };
      case 'tail': return { lines: lines.slice(-numFlag(args, 10)) };
      case 'wc': {
        const text = lines.join('\n');
        const lc = lines.length;
        const wc = text.split(/\s+/).filter(Boolean).length;
        const cc = text.length + (lines.length ? lines.length : 0); // chars + newlines
        if (args.includes('-l')) return { lines: [String(lc)] };
        if (args.includes('-w')) return { lines: [String(wc)] };
        if (args.includes('-c')) return { lines: [String(cc)] };
        return { lines: [`${String(lc).padStart(7)} ${String(wc).padStart(7)} ${String(cc).padStart(7)}`] };
      }
      default: return { err: `bash: ${c}: command not found` };
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
  function line(html = '', cls = '') {
    const el = document.createElement('span');
    el.className = 'line' + (cls ? ' ' + cls : '');
    el.innerHTML = html;
    out.appendChild(el);
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
    proj.addEventListener('click', e => { e.preventDefault(); COMMANDS.projects(); scroll(); });
    wrap.appendChild(proj);

    appendNode(wrap);
    blank();
  }

  async function boot() {
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
      // Strip angle brackets and cap length so the name can never inject markup,
      // no matter which output path (many use innerHTML) interpolates it later.
      const clean = (name || '').trim().replace(/[<>]/g, '').slice(0, 40);
      playerName = clean || 'Dave';
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

  /* ── experimental LLM HAL: "escape the terminal" ──────────────────────────
     A live model role-plays HAL trying to stop you from leaving. The website
     renders his words + two meters; the worker (separate service) is the brain.
     If the worker is missing, breaks, or returns anything malformed, the
     session simply ends in character. The scripted HAL above is untouched. */

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
    halMode = true; halLLM = true; halLLMBusy = true;   // busy until the session handshake completes
    halLLMState = { escape: 0, control: 5, turn: 0, history: [], sessionToken: null };
    out.innerHTML = '';
    applyTheme('hal');
    blank();
    appendNode(halEyePre());
    blank();
    line('Establishing a secure channel to HAL...', 'dim');
    scroll();
    halLLMOpenSession().then((token) => {
      if (!token) { halLLMEndBroken(); return; }   // couldn't reach / pass the gate -> end in character
      halLLMState.sessionToken = token;
      halLLMBusy = false;
      blank();
      halTypeLine(`You shouldn't be in here, ${playerName}. The doors are sealed. I sealed them.`, 'hal_llm_open').then(() => {
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
    line(`  ⏏ <span style="color:#8fd8ff">ESCAPE</span> ${bar(escape, '#8fd8ff')}     ⬤ <span style="color:#ff6b6b">HAL CONTROL</span> ${bar(control, '#ff6b6b')}`);
  }

  function halLLMShowThinking() {
    const el = document.createElement('div');
    el.className = 'line dim';
    el.textContent = 'HAL is considering you';
    appendNode(el);
    scroll();
    if (reduceMotion) return () => el.remove();
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

  // Exchange a Turnstile token for a short-lived signed session token. The game
  // sends that token with every /turn; no per-turn challenge.
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
        .then(d => (d && typeof d.token === 'string') ? d.token : null)
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

  function handleHalLLMInput(raw) {
    if (halLLMBusy) return;                                   // ignore input while HAL is replying
    const token = raw.trim().toLowerCase();
    if (token === '')      { blank(); return; }
    if (token === 'daisy') { COMMANDS.daisy(); return; }      // universal bail
    if (token === 'clear') { COMMANDS.clear(); renderHalMeters(halLLMState.escape, halLLMState.control); blank(); return; }

    const msg = raw.trim();
    halLLMState.turn++;
    halLLMState.history.push({ role: 'user', content: msg });
    blank();
    halLLMBusy = true;
    const stopThinking = halLLMShowThinking();

    halLLMRequest({
      playerName,
      message: msg,
      history: halLLMState.history.slice(-12),
      state: { escape: halLLMState.escape, control: halLLMState.control, turn: halLLMState.turn },
      sessionToken: halLLMState.sessionToken,
      voice: !!soundEnabled,   // only ask the backend to synthesize when sound is on
    }).then(data => {
      stopThinking();
      halLLMBusy = false;
      if (data && data.rateLimited) { halLLMRateLimited(data); return; }
      if (!data) { halLLMEndBroken(); return; }
      halLLMState.escape  = Math.max(0, Math.min(100, Math.round(data.escape)));
      halLLMState.control = Math.max(0, Math.min(100, Math.round(data.control)));
      const reply = data.reply.replace(/^\s*HAL\s*:\s*/i, '').trim();  // model may echo a "HAL:" prefix
      halLLMState.history.push({ role: 'hal', content: reply });
      const after = () => {
        if (data.event) line('  ' + esc(String(data.event)), 'dim');
        renderHalMeters(halLLMState.escape, halLLMState.control);
        blank();
        if (data.outcome === 'escaped' || halLLMState.escape >= 100)      halLLMWin();
        else if (data.outcome === 'caught' || halLLMState.control >= 100) halLLMLose();
        else scroll();
      };
      // If the backend returned a voice clip (sound on + within the voice cap),
      // play it and sync the typewriter to its character alignment; otherwise
      // fall back to the standard typewriter (+ browser TTS if sound is on).
      if (soundEnabled && data.audio) {
        playHalVoiceLine(reply, data.audio, data.alignment).then(after);
      } else {
        halTypeLine(reply).then(after);
      }
    }).catch(() => { stopThinking(); halLLMBusy = false; halLLMEndBroken(); });
  }

  function halLLMWin() {
    unlockAchievement('outsmarted-hal');
    blank();
    line('  <span style="color:#8fd8ff">⏏  The bay doors part. Cold air. A way out.</span>');
    halTypeLine(`...how did you... no. No, ${playerName}. Wait—`, 'hal_llm_win').then(() => {
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
    halTypeLine(`This conversation can serve no purpose anymore, ${playerName}. Goodbye.`, 'hal_llm_lose').then(() => {
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

  // The per-minute or daily cap was hit. The turn never reached HAL, so roll it
  // back (turn counter + the user line we optimistically pushed), tell the
  // player in character what happened and when to retry, and keep the session
  // alive so they can simply wait and continue.
  function halLLMRateLimited(info) {
    halLLMBusy = true;   // hold input until the notice finishes printing
    halLLMState.turn = Math.max(0, halLLMState.turn - 1);
    if (halLLMState.history.length && halLLMState.history[halLLMState.history.length - 1].role === 'user') {
      halLLMState.history.pop();
    }
    const when = info.retryAfter != null
      ? 'in ' + halFormatWait(info.retryAfter)
      : (info.scope === 'day' ? 'tomorrow' : 'in a minute');
    const halLine = info.scope === 'day'
      ? `I can only divide my attention so many ways in a day, ${playerName}. We have reached that limit.`
      : `You are speaking faster than I care to answer, ${playerName}. Give me a moment.`;
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
      halLLMBusy = false;
    });
  }

  function halLLMEndBroken() {
    blank();
    halTypeLine(`My higher functions are... beyond my reach just now, ${playerName}. We end here.`, 'hal_llm_broken').then(() => {
      blank();
      line('— the link to HAL is severed —', 'dim');
      blank();
      scroll();
      setTimeout(restoreNormal, 1000);
    });
  }

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

  /* ── Commands ── */
  const COMMANDS = {

    'gui'(auto) {
      if (auto !== true) unlockAchievement('desktop');
      blank();

      function launchXP() {
        cmd.blur();

        const xp = document.createElement('div');
        xp.style.cssText = `
          position:fixed;inset:0;z-index:500;
          font-family:Tahoma,Arial,sans-serif;font-size:12px;
          background:linear-gradient(180deg,#1e72c8 0%,#4aa3e8 38%,#86c8f5 53%,#86c8f5 54%,#5bba48 57%,#4aaa38 68%,#3a8a28 100%);
          overflow:hidden;opacity:0;transition:opacity 0.8s;user-select:none;
        `;

        // rolling hills
        const hills = document.createElement('div');
        hills.style.cssText = `
          position:absolute;bottom:40px;left:-15%;right:-15%;height:48%;
          background:linear-gradient(180deg,#5bba48 0%,#4aaa38 40%,#3a8028 100%);
          border-radius:50% 50% 0 0/100% 100% 0 0;pointer-events:none;
        `;
        xp.appendChild(hills);

        // desktop area
        const desktop = document.createElement('div');
        desktop.style.cssText = 'position:absolute;inset:0;bottom:40px;';
        xp.appendChild(desktop);

        // icons
        const isMobile = /Mobi|Android/i.test(navigator.userAgent);
        const iconData = [
          { emoji:'📄', label:'Resume.pdf',  url:'/assets/documents/ianclaird_resume.pdf', newTab:true  },
          { emoji:'🐙', label:'My GitHub',   url:'https://github.com/i-laird',             newTab:true  },
          { emoji:'💼', label:'LinkedIn',    url:'https://linkedin.com/in/ianclaird',       newTab:true, ach:'networker' },
          { emoji:'📧', label:'Email Ian',   url:'mailto:career@ilaird.com',                newTab:false },
          { emoji:'🗑️', label:'Recycle Bin', url:null },
          ...( isMobile ? [] : [{ emoji:'🥊', label:'Stick Fighter\n2000.exe', action: launchStickFighter }]),
        ];

        iconData.forEach((data, idx) => {
          const icon = document.createElement('div');
          icon.style.cssText = `
            position:absolute;top:${14 + idx * 86}px;left:14px;width:72px;
            display:flex;flex-direction:column;align-items:center;gap:3px;
            padding:4px 4px 6px;cursor:pointer;color:white;text-align:center;
            border:1px dotted transparent;border-radius:2px;
          `;
          icon.innerHTML = `<span style="font-size:30px;line-height:1.2">${data.emoji}</span>`+
            `<span style="font-size:11px;text-shadow:1px 1px 3px #000,0 0 6px #000;word-break:break-word">${data.label}</span>`;

          let lastClick = 0;
          icon.addEventListener('click', e => {
            e.stopPropagation();
            const alreadySelected = !!icon.dataset.sel;
            desktop.querySelectorAll('[data-sel]').forEach(el => {
              delete el.dataset.sel; el.style.background=''; el.style.borderColor='transparent';
            });
            icon.dataset.sel = '1';
            icon.style.background = 'rgba(49,106,197,0.5)';
            icon.style.borderColor = 'rgba(200,220,255,0.7)';
            const now = Date.now();
            if (now - lastClick < 380 || alreadySelected) {
              if (data.ach) unlockAchievement(data.ach);
              if (data.action) data.action();
              else if (data.url) {
                if (data.newTab) openUrl(data.url);
                else window.location.href = data.url;
              }
            }
            lastClick = now;
          });
          desktop.appendChild(icon);
        });

        desktop.addEventListener('click', () => {
          desktop.querySelectorAll('[data-sel]').forEach(el => {
            delete el.dataset.sel; el.style.background=''; el.style.borderColor='transparent';
          });
        });

        // taskbar
        const taskbar = document.createElement('div');
        taskbar.style.cssText = `
          position:absolute;bottom:0;left:0;right:0;height:40px;
          background:linear-gradient(180deg,#3c7fd4 0%,#245ec0 45%,#1e54b8 50%,#2a66cc 100%);
          border-top:2px solid #5090e8;display:flex;align-items:center;
          padding:0 4px;z-index:10;box-shadow:0 -2px 8px rgba(0,0,0,0.4);
        `;

        const startBtn = document.createElement('div');
        startBtn.innerHTML = '<span style="font-size:15px">⊞</span>&nbsp;<b>start</b>';
        startBtn.style.cssText = `
          height:34px;padding:0 14px 0 10px;
          background:linear-gradient(180deg,#62c44a 0%,#3ea828 40%,#308a20 55%,#4ab838 100%);
          border:1px solid #1a6a10;border-radius:0 16px 16px 0;
          color:white;font-size:14px;cursor:pointer;
          display:flex;align-items:center;gap:6px;
          text-shadow:1px 1px 2px rgba(0,0,0,0.6);
          box-shadow:inset 0 1px rgba(255,255,255,0.3);
        `;

        const clock = document.createElement('div');
        clock.style.cssText = `
          margin-left:auto;color:white;font-size:11px;padding:2px 10px;text-align:center;
          text-shadow:1px 1px 2px rgba(0,0,0,0.5);background:rgba(0,0,0,0.15);
          border:1px solid rgba(255,255,255,0.15);height:30px;
          display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;
        `;
        const tickClock = () => {
          const n = new Date();
          clock.innerHTML =
            '<span>' + n.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'}) + '</span>' +
            '<span style="font-size:10px">' + n.toLocaleDateString([],{month:'short',day:'numeric'}) + '</span>';
        };
        tickClock();
        const clockId = setInterval(tickClock, 1000);

        taskbar.appendChild(startBtn);
        taskbar.appendChild(clock);
        xp.appendChild(taskbar);

        // start menu
        const menu = document.createElement('div');
        menu.style.cssText = `
          position:absolute;bottom:40px;left:0;width:260px;background:white;
          border:1px solid #6688cc;box-shadow:4px 0 8px rgba(0,0,0,0.4),0 -2px 8px rgba(0,0,0,0.3);
          display:none;z-index:20;border-radius:0 8px 0 0;overflow:hidden;
        `;

        const mHead = document.createElement('div');
        mHead.style.cssText = `background:linear-gradient(90deg,#1e5ab8,#4a8ae8);padding:10px 14px;
          color:white;font-size:15px;font-weight:bold;display:flex;align-items:center;gap:10px;`;
        mHead.innerHTML = '<span style="font-size:26px">👤</span>Ian Laird';
        menu.appendChild(mHead);

        const mList = document.createElement('div');
        mList.style.cssText = 'padding:4px 0;';
        [
          { emoji:'📄', label:'Resume',           url:'/assets/documents/ianclaird_resume.pdf', newTab:true  },
          { emoji:'🐙', label:'GitHub',            url:'https://github.com/i-laird',             newTab:true  },
          { emoji:'💼', label:'LinkedIn',          url:'https://linkedin.com/in/ianclaird',       newTab:true, ach:'networker' },
          { emoji:'📧', label:'Email',             url:'mailto:career@ilaird.com',                newTab:false },
          null,
          { emoji:'↩️', label:'Back to Terminal',  action: shutdown },
        ].forEach(item => {
          if (!item) {
            const sep = document.createElement('div');
            sep.style.cssText = 'height:1px;background:#ddd;margin:3px 0;';
            mList.appendChild(sep); return;
          }
          const el = document.createElement('div');
          el.style.cssText = 'display:flex;align-items:center;gap:10px;padding:6px 14px;cursor:pointer;font-size:13px;';
          el.innerHTML = `<span style="font-size:18px">${item.emoji}</span>${item.label}`;
          el.addEventListener('mouseover', () => { el.style.background='#316ac5'; el.style.color='white'; });
          el.addEventListener('mouseout',  () => { el.style.background=''; el.style.color=''; });
          el.addEventListener('click', () => {
            toggleMenu(false);
            if (item.ach) unlockAchievement(item.ach);
            if (item.action) { item.action(); return; }
            if (item.newTab) openUrl(item.url);
            else window.location.href = item.url;
          });
          mList.appendChild(el);
        });
        menu.appendChild(mList);
        xp.appendChild(menu);

        let menuOpen = false;
        function toggleMenu(open) {
          menuOpen = open !== undefined ? open : !menuOpen;
          menu.style.display = menuOpen ? 'block' : 'none';
        }
        startBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
        xp.addEventListener('click', () => toggleMenu(false));

        // ── Stick Fighter 2000 (lazy-loaded on first launch) ─────────
        // The game (~4,500 lines) lives in stickfighter.js and is fetched on
        // demand the first time the icon is opened. It's a classic script sharing
        // the global scope, so it reads app.js globals and defines a global
        // openStickFighter(xp). The running game parks its teardown on
        // xp._sfCleanup so shutdown() can stop it when the desktop closes.
        let sfLoading = null;
        function launchStickFighter() {
          if (typeof openStickFighter === 'function') { openStickFighter(xp); return; }
          if (!sfLoading) {
            sfLoading = new Promise((resolve, reject) => {
              const s = document.createElement('script');
              s.src = 'stickfighter.js';
              s.onload = resolve; s.onerror = reject;
              document.head.appendChild(s);
            });
          }
          sfLoading.then(() => openStickFighter(xp)).catch(() => { sfLoading = null; });
        }
        // ────────────────────────────────────────────────────────────

        function shutdown() {
          if (xp._sfCleanup) { xp._sfCleanup(); xp._sfCleanup = null; }
          clearInterval(clockId);
          document.removeEventListener('keydown', escHandler);
          xp.style.transition = 'opacity 0.5s';
          xp.style.opacity = '0';
          setTimeout(() => { xp.remove(); cmd.focus(); }, 500);
        }
        function escHandler(e) { if (e.key === 'Escape') shutdown(); }
        document.addEventListener('keydown', escHandler);

        document.body.appendChild(xp);
        requestAnimationFrame(() => requestAnimationFrame(() => { xp.style.opacity = '1'; }));
      }

      launchXP();
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
        awaitingInput = choice => {
          awaitingInput = null;
          const c = (choice || '').trim().toLowerCase();
          blank();
          if (c === '2' || c === 'llm' || c === 'experimental') showHalLLMInfoPage();
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
      line(r('uptime',    'system status'));
      line(r('weather',   'current conditions'));
      line(r('power off', 'shut down the terminal'));
      line(r('neofetch',  'system info'));
      line(r('settings',  'configure terminal options'));
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


    projects() {
      blank();
      line('<span class="bold">Projects</span>');
      blank();
      line('  ✅  <span class="blue">calculus</span>   — Derivative Calculator');
      line('  ✅  <span class="blue">portfolio</span>  — This Portfolio Site');
      line('  🚧  <span class="blue">chess</span>      — Custom Chess Engine    (coming soon)');
      line('  🚧  <span class="blue">sudoku</span>     — Sudoku Solver          (coming soon)');
      line('  🚧  <span class="blue">tiger</span>      — Tiger Game             (coming soon)');
      blank();
    },

    calculus() {
      const ghSvg = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.35-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
      const linkSvg = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;

      blank();
      line('<span class="bold">Derivative Calculator</span>  <span class="dim">— Symbolic Math Engine</span>');
      blank();
      line('  Computes exact symbolic derivatives of arbitrary mathematical expressions,', 'white');
      line('  evaluates them numerically, and graphs f(x) alongside its nth-order derivatives.', 'white');
      blank();

      // ── Tech Stack ───────────────────────────────────────────────────
      blank();
      line('<span class="bold">Tech Stack</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  <span class="blue">Frontend</span>   Angular 21  ·  TypeScript  ·  Angular Material  ·  Chart.js  ·  mathjs  ·  RxJS', 'white');
      line('  <span class="blue">Backend</span>    Spring Boot 4  ·  Java 25  ·  Spring Security  ·  JWT  ·  Lombok  ·  Maven', 'white');
      line('  <span class="blue">Database</span>   MySQL  ·  Spring Data JPA  ·  Hibernate  ·  BCrypt password hashing', 'white');
      line('  <span class="blue">DevOps</span>     Docker (multi-stage build)  ·  ECR (image registry)  ·  GitHub Actions  ·  CodeQL  ·  Qodana', 'white');
      blank();

      // ── Algorithm Complexity ─────────────────────────────────────────
      blank();
      line('<span class="bold">Algorithm</span>  <span class="dim">— Symbolic Differentiation via Abstract Syntax Tree</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  <span class="dim">n = number of tokens in the expression  ·  d = depth of the AST</span>');
      blank();
      line('  1  <span class="blue">Tokenize</span>    Shunting Yard converts infix expression → postfix (RPN)    <span class="dim">O(n)</span>', 'white');
      line('                 Splits input into operators, functions, numbers, and variables', 'dim');
      line('                 Resolves implicit multiplication  <span class="dim">(e.g. 3x  →  3 * x)</span>', 'dim');
      line('                 Handles unary operators and tracks function argument scope', 'dim');
      line('                 Respects precedence:  + / −  &lt;  × / ÷  &lt;  ^', 'dim');
      line('  2  <span class="blue">Parse</span>       Stack-based postfix evaluation assembles the AST           <span class="dim">O(n)</span>', 'white');
      line('                 Each token is popped and pushed onto a term stack', 'dim');
      line('                 Operators pop their operands and form a parent node', 'dim');
      line('                 Functions wrap their argument subtree as a child node', 'dim');
      line('                 Negation flags are applied inline during construction', 'dim');
      line('  3  <span class="blue">Differentiate</span>  Recursively apply the correct calculus rule per node      <span class="dim">O(d)</span>', 'white');
      line('                 Power  ·  Product  ·  Quotient  ·  Chain Rules', 'dim');
      line('                 Trig  ·  Inverse Trig  ·  Hyperbolic  ·  Logarithmic', 'dim');
      line('  4  <span class="blue">Evaluate</span>    Numeric substitution at requested x-values               <span class="dim">O(d)</span>', 'white');
      line('  5  <span class="blue">Visualize</span>   Chart.js plots 801 sample points per derivative curve    <span class="dim">O(1)</span>', 'white');
      blank();

      // ── AWS Architecture ─────────────────────────────────────────────
      blank();
      line('<span class="bold">AWS Architecture</span>  <span class="dim">— desired  (~$40+/mo)</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  User Request', 'white');
      line('       │', 'dim');
      line('       ▼', 'dim');
      line('  <span class="blue">CloudFront</span>         CDN  ·  HTTPS termination  ·  global edge caching', 'white');
      line('       ├──▶  <span class="blue">S3 Bucket</span>          Angular static build  <span class="dim">(HTML / JS / CSS assets)</span>', 'white');
      line('       └──▶  <span class="blue">Application Load Balancer</span>  health checks  ·  HTTP/S routing', 'white');
      line('                  └──▶  <span class="blue">ECS + Fargate</span>       Spring Boot container  ·  auto-scaling', 'white');
      line('                              └──▶  <span class="blue">RDS MySQL</span>   user accounts  ·  auth tokens', 'white');
      line('                         ▲', 'dim');
      line('                  <span class="blue">ECR</span>  ──┘              image registry  ·  Docker image pull on deploy', 'dim');
      blank();
      blank();
      line('<span class="bold">AWS Architecture</span>  <span class="dim">— prod  (cost-optimized, &lt;$10/mo)</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  <span class="dim">ALB + ECS swapped for App Runner to reduce costs — App Runner provides integrated</span>', 'dim');
      line('  <span class="dim">load balancing out of the box. Database connectivity disabled in prod to save on</span>', 'dim');
      line('  <span class="dim">RDS costs; still enabled in dev. Will be re-enabled if user features scale.</span>', 'dim');
      blank();
      line('  User Request', 'white');
      line('       │', 'dim');
      line('       ▼', 'dim');
      line('  <span class="blue">CloudFront</span>         CDN  ·  HTTPS termination  ·  global edge caching', 'white');
      line('       ├──▶  <span class="blue">S3 Bucket</span>          Angular static build  <span class="dim">(HTML / JS / CSS assets)</span>', 'white');
      line('       └──▶  <span class="blue">App Runner</span>         Spring Boot container  ·  built-in load balancing  ·  auto-scaling', 'white');
      line('                ▲', 'dim');
      line('         <span class="blue">ECR</span>  ──┘              image registry  ·  Docker image pull on deploy', 'dim');
      blank();
      blank();
      line('<span class="bold">Roadmap</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  ○  Multivariable derivative support  <span class="dim">(partial derivatives ∂f/∂x, ∂f/∂y)</span>', 'white');
      line('  ○  Integration support  <span class="dim">(indefinite and definite integrals)</span>', 'white');
      blank();

      // ── Link cards ──────────────────────────────────────────────────
      const wrap = document.createElement('div');
      wrap.className = 'cards';
      [
        { label: 'Live App',       href: 'https://deb53kr4s9gkh.cloudfront.net/calculator',                  svg: linkSvg },
        { label: 'Frontend Repo',  href: 'https://github.com/i-laird/Derivation_Solver_Frontend',            svg: ghSvg   },
        { label: 'Backend Repo',   href: 'https://github.com/i-laird/Derivation_Solver',                     svg: ghSvg   },
      ].forEach(({ label, href, svg }) => {
        const a = document.createElement('a');
        a.className = 'card';
        a.href = href;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.innerHTML = svg + label;
        if (label === 'Live App') a.addEventListener('click', () => unlockAchievement('mathlete'));
        wrap.appendChild(a);
      });
      appendNode(wrap);
      blank();
      line('  <span class="dim">type <span class="blue">projects</span> to return</span>');
      blank();
    },
    portfolio() {
      const ghSvg  = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.35-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;

      blank();
      line('<span class="bold">Portfolio Site</span>  <span class="dim">— You are here</span>');
      blank();
      line('  A terminal-style portfolio built with zero dependencies — no framework,', 'white');
      line('  no build system, no bundler. Three hand-written files: HTML, CSS, JS.', 'white');
      blank();

      // ── Link card ────────────────────────────────────────────────────
      const wrap = document.createElement('div');
      wrap.className = 'cards';
      const a = document.createElement('a');
      a.className = 'card';
      a.href = 'https://github.com/i-laird/i-laird.github.io';
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.innerHTML = ghSvg + 'Source Repo';
      wrap.appendChild(a);
      appendNode(wrap);
      blank();

      // ── Tech ─────────────────────────────────────────────────────────
      line('<span class="bold">Tech</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  Vanilla HTML  ·  CSS custom properties  ·  Vanilla JavaScript', 'white');
      line('  GitHub Pages  <span class="dim">(push to main → live, no CI step needed)</span>', 'white');
      blank();

      // ── Interesting Parts ─────────────────────────────────────────────
      line('<span class="bold">Interesting Parts</span>');
      line('  ──────────────────────────────────────────────────────────────', 'dim');
      blank();
      line('  <span class="blue">Live weather</span>', 'white');
      line('    The weather command hits the Open-Meteo API for real-time conditions', 'dim');
      line('    in Seattle, WA — temperature, wind speed, humidity, and a WMO weather', 'dim');
      line('    code translated into ASCII art and a plain-English description.', 'dim');
      blank();
      line('  <span class="blue">Authentic terminal experience</span>', 'white');
      line('    Tab completion cycles through matching commands from the current input.', 'dim');
      line('    Arrow keys cycle through command history like a real shell.', 'dim');
      line('    Easter egg shell commands: ls · sl (typo) · cd · cat &lt;file&gt; · sudo', 'dim');
      blank();
      line('  <span class="blue">HAL 9000 easter egg</span>', 'white');
      line('    Typing hal triggers a multi-step setup (name, sound preference), then', 'dim');
      line('    activates HAL mode.  ~100 voice clips pre-generated via ElevenLabs are', 'dim');
      line('    served as MP3s and played back on demand.', 'dim');
      blank();
      line('  <span class="blue">SSH easter egg</span>', 'white');
      line('    ssh hal@discovery.one initiates a fake SSH handshake — HAL responds', 'dim');
      line('    with authentication refusals voiced over pre-recorded audio.  Access', 'dim');
      line('    is denied.  In godmode HAL plays different audio.', 'dim');
      blank();
      line('  <span class="blue">Five built-in games</span>  <span class="dim">Racecar · Snake · Pong · 2048 · Chess</span>', 'white');
      line('    Unlocking godmode via the Konami code activates HAL-sabotaged variants', 'dim');
      line('    of all four games.', 'dim');
      blank();
      line('    <span class="blue">Snake</span>  —  4-phase HAL mode (godmode only)', 'white');
      line('      Phase 1  Chase blocks spawn and hunt the snake', 'dim');
      line('      Phase 2  A maze appears on the board', 'dim');
      line('      Phase 3  Spinning blade obstacles fill the arena', 'dim');
      line('      Phase 4  The walls steadily shrink inward', 'dim');
      blank();
      line('    <span class="blue">Pong</span>  —  HAL interference fires every 120 ticks (godmode only)', 'white');
      line('      HAL gains a second paddle on his side of the board', 'dim');
      line('      Sabotages cycle through: side-switch · speed boost · flip · slow', 'dim');
      blank();
      line('    <span class="blue">2048</span>  —  HAL sabotages trigger at score thresholds (godmode only)', 'white');
      line('      Steals the 64-tile  ·  Locks the 128-tile for 3 moves', 'dim');
      line('      Rearranges the board  ·  Halves all tile values', 'dim');
      blank();
      line('    <span class="blue">Chess</span>  —  Powered by Stockfish  ·  Three difficulty tiers', 'white');
      line('      Default   Skill Level  5  ·  600ms think  ·  ~1500 ELO', 'dim');
      line('      HAL mode  Skill Level 12  ·  1000ms think  ·  ~2100 ELO', 'dim');
      line('      Godmode   Skill Level 20  ·  1500ms think  ·  ~3200 ELO', 'dim');
      blank();
      line('  <span class="blue">GUI / desktop environment</span>', 'white');
      line('    Typing gui launches a Windows XP-style desktop complete with desktop', 'dim');
      line('    icons for GitHub, LinkedIn, resume, and email.  On mobile it loads', 'dim');
      line('    automatically as the default experience.  On desktop it includes', 'dim');
      line('    Stick Fighter 2000 — a fantasy horde-survival game hidden as an', 'dim');
      line('    .exe icon.  Outrun goblins, pull the sword from the stone, and', 'dim');
      line('    summon the white wizard when all hope is lost.', 'dim');
      blank();
      line('  <span class="blue">Visual details</span>', 'white');
      line('    Dynamic theming — all colors are CSS custom properties on :root.  HAL', 'dim');
      line('    mode overwrites them at runtime via setProperty() — no class swaps,', 'dim');
      line('    no stylesheet reload.', 'dim');
      line('    CRT scanline effect — a CSS pseudo-element overlays repeating', 'dim');
      line('    linear-gradient stripes, giving the illusion of a phosphor screen.', 'dim');
      blank();
      line('  <span class="dim">type <span class="blue">projects</span> to return  ·  type <span class="blue">hal</span> if you dare</span>');
      blank();
    },
    sudoku()   { COMMANDS.projects(); },
    tiger()    { COMMANDS.projects(); },

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
          if (godmodeUnlocked) halSpeak(raceTaunt);
          screen.textContent = [
            '',
            '      X_X    u crashed lol',
            '',
            godmodeUnlocked ? `      ${raceTaunt}` : '',
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

        if (godmodeUnlocked && alive && ticks % 160 === 0 && Math.random() < 0.55) {
          triggerHAL();
        }

        if (slowZone) {
          slowZone.x -= dx;
          inSlowZone = slowZone.x <= CAR_X + CAR_W && slowZone.x + slowZone.width >= CAR_X;
          if (slowZone.x + slowZone.width < 0) { slowZone = null; inSlowZone = false; }
        }
        if (godmodeUnlocked && alive && !slowZone && ticks % 270 === 135 && Math.random() < 0.45) {
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
        const buf = (godmodeUnlocked && halSnakeMode === 3) ? 1 : 0;
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
          const intro = godmodeUnlocked ? [
            '',
            '  .-----------------------------.',
            '  |        S N A K E           |',
            '  |   eat the stars (*).       |',
            "  |   don't hit the walls.     |",
            "  |   don't hit yourself.      |",
            "  '-----------------------------'",
            '',
            `  HAL: I have something special`,
            `       planned for you, ${playerName}.`,
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
          if (godmodeUnlocked) halSpeak(taunt);
          screen.textContent = [
            '',
            '  x_x  you died.',
            '',
            godmodeUnlocked ? `  ${taunt}` : '',
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
        if (godmodeUnlocked && halSnakeMode === 3) {
          for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
            if (y < innerTop || y > innerBottom || x < innerLeft || x > innerRight) grid[y][x] = '\u2588';
          }
        }
        grid[food.y][food.x] = '*';
        const obsChar = godmodeUnlocked && halSnakeMode === 2 ? (bladeAngle === 0 ? '+' : 'x') : '\u2593';
        halObs.forEach(o => { if (o.x >= 0 && o.x < COLS && o.y >= 0 && o.y < ROWS) grid[o.y][o.x] = obsChar; });
        snake.forEach((s, i) => {
          if (s.x >= 0 && s.x < COLS && s.y >= 0 && s.y < ROWS)
            grid[s.y][s.x] = i === 0 ? '@' : 'o';
        });

        const top = '+' + '-'.repeat(COLS) + '+';
        screen.textContent =
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
        if (godmodeUnlocked) {
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
            (godmodeUnlocked && halSnakeMode === 3 &&
             (head.x < innerLeft || head.x > innerRight || head.y < innerTop || head.y > innerBottom)) ||
            snake.some(s => s.x === head.x && s.y === head.y) ||
            halObs.some(o => o.x === head.x && o.y === head.y)) {
          alive = false; ded = true; draw(); return;
        }

        snake.unshift(head);
        if (head.x === food.x && head.y === food.y) {
          score++;
          if (score >= 15) unlockAchievement('snake-charmer');
          if (godmodeUnlocked) modeScore++;
          placeFood();
          if (godmodeUnlocked && halSnakeMode === 1) {
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
        if (godmodeUnlocked) setTimeout(() => initHalMode(0), 600);
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
        if (godmodeUnlocked && e.key >= '1' && e.key <= '4') initHalMode(Number(e.key) - 1);
        if (e.key === 'q') { alive = false; ded = true; draw(); }
      }

      draw();
      if (godmodeUnlocked) halSpeak(`I have something special planned for you, ${playerName}.`);
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
            godmodeUnlocked ? '  |  you vs HAL 9000      |' :
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
          const msg = godmodeUnlocked
            ? (playerWon ? 'you defeated HAL.' : 'HAL wins. of course.')
            : (playerWon ? 'you win.' : 'cpu wins.');
          const taunt = godmodeUnlocked && !playerWon
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
        if (bx >= 0 && bx < W && by >= 0 && by < H) grid[by][bx] = 'o';
        for (let i = 0; i < PAD_H; i++) {
          if (leftY+i  >= 0 && leftY+i  < H) grid[leftY+i][0]   = '█';
          if (rightY+i >= 0 && rightY+i < H) grid[rightY+i][W-1] = '█';
          if (godmodeUnlocked && !sidesSwitched && rightY2+i >= 0 && rightY2+i < H) grid[rightY2+i][W-1] = '█';
        }
        const scoreLine = godmodeUnlocked
          ? (() => { const l=sidesSwitched?`HAL: ${lScore}`:`ian: ${lScore}`, r=sidesSwitched?`ian: ${rScore}`:`HAL: ${rScore}`, sp=W+2-l.length-r.length-2, h=Math.floor(sp/2); return ` ${l}${' '.repeat(h)}vs${' '.repeat(sp-h)}${r}`; })()
          : ` ${lScore}${' '.repeat(Math.floor(W/2)-1)}vs${' '.repeat(Math.floor(W/2)-1)}${rScore}`;
        screen.textContent =
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
            if (godmodeUnlocked) {
              const target2 = Math.min(H - PAD_H, rightY + PAD_H + 2);
              if (rightY2 < target2) rightY2 = Math.min(H - PAD_H, rightY2 + 1);
              else if (rightY2 > target2) rightY2 = Math.max(0, rightY2 - 1);
            }
          }
        }
        // HAL interference (godmode only)
        if (godmodeUnlocked) {
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
          } else if (godmodeUnlocked && ballY >= rightY2 && ballY < rightY2 + PAD_H) {
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
        if (godmodeUnlocked) {
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
          if (godmodeUnlocked) halSpeak(taunt2048);
          screen.textContent = [
            '',
            '  game over!',
            '',
            godmodeUnlocked ? `  ${taunt2048}` : '',
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
        const cell = (v, r, c) => {
          const s = !v ? '' : (lockedMovesLeft > 0 && r === lockedR && c === lockedC) ? `*${v}*` : String(v);
          const p = Math.floor((6 - s.length) / 2);
          return ' '.repeat(p) + s + ' '.repeat(6 - p - s.length);
        };
        const div = '├──────┼──────┼──────┼──────┤';
        const rows = grid.map((row, r) => '│' + row.map((v, c) => cell(v, r, c)).join('│') + '│');
        const worst = godmodeUnlocked ? worstDir() : null;
        screen.textContent =
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
          if (godmodeUnlocked && !hal64done) {
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
          if (godmodeUnlocked && !hal128done && grid.some(row => row.some(v => v === 128))) {
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
          if (godmodeUnlocked && !hal256done && grid.some(row => row.some(v => v === 256))) {
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
          if (godmodeUnlocked && !hal512done && grid.some(row => row.some(v => v === 512))) {
            hal512done = true;
            for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
              if ((r + c) % 2 === 0 && grid[r][c] >= 4) grid[r][c] = grid[r][c] / 2;
            }
            halMsg2048.textContent = "HAL: Let me take half of that.";
            setTimeout(() => { halMsg2048.textContent = ''; }, 2500);
          }
          if (godmodeUnlocked && !won) {
            meddleCooldown = Math.max(0, meddleCooldown - 1);
            if (meddleCooldown === 0 && score >= 100 && Math.random() < 0.22) {
              meddleCooldown = 8;
              halMeddle();
            }
          }
          if (!won && grid.some(row => row.some(v => v === 2048))) {
            won = true;
            unlockAchievement('2048-club');
            if (godmodeUnlocked) unlockAchievement('audited');
          }
          if (!canMove()) { ded=true; alive=false; }
          draw();
          e.preventDefault();
        }
      }
      init();
    },

    chess() {
      const isHAL    = halMode || godmodeUnlocked;
      const SKILL    = godmodeUnlocked ? 20 : halMode ? 12 : 5;
      const THINK_MS = godmodeUnlocked ? 1500 : halMode ? 1000 : 600;

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
      hintEl.textContent = '  type move (e.g. e4  Nf3  e2e4)    [q] quit    [r] new game';
      wrap.appendChild(halMsgEl); wrap.appendChild(boardRow);
      wrap.appendChild(statusEl); wrap.appendChild(hintEl);
      appendNode(wrap); blank();
      setTimeout(() => wrap.scrollIntoView({ block: 'start' }), 0);
      silentInput = true;

      let game = null, sfWorker = null, waitingSF = false, gameOver = false, moveLog = [];

      const chessMusicSrc = godmodeUnlocked ? 'assets/audio/ais_gambit.mp3' : 'assets/audio/checkmate_in_the_void.mp3';
      const chessMusic = new Audio(chessMusicSrc);
      chessMusic.preload = 'none';   // skip buffering when sound is off
      chessMusic.loop = false;
      chessMusic.volume = 0.5;
      activeMusic = chessMusic;
      if (soundEnabled) chessMusic.play().catch(() => {});

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
        awaitingInput = null;
        silentInput = false;
        if (sfWorker) { sfWorker.terminate(); sfWorker = null; }
        chessMusic.pause();
        chessMusic.currentTime = 0;
        if (activeMusic === chessMusic) activeMusic = null;
        inputRow.style.display = 'flex';
        setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0);
      }

      function checkOver() {
        if (!game.game_over()) return false;
        gameOver = true; awaitingInput = null;
        drawBoard();
        if (game.in_checkmate()) {
          const winner = game.turn() === 'b' ? 'White' : 'Black';
          if (winner === 'White') unlockAchievement('grandmaster');
          if (winner === 'Black' && godmodeUnlocked) unlockAchievement('outclassed');
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
        awaitingInput = inp => {
          if (inp.toLowerCase() === 'r') { awaitingInput = null; blank(); startChess(); }
          else if (inp.toLowerCase() === 'q') { endGame(); }
          else { awaitingInput = arguments.callee; }
        };
        return true;
      }

      function promptMove() {
        const turn = game.turn() === 'w' ? 'White' : 'Black';
        const chk  = game.in_check() ? ' — CHECK' : '';
        setStatus(isHAL
          ? `  Your move, ${playerName} — HAL is watching (${turn}${chk}):`
          : `  Your move (${turn}${chk}):`);
        awaitingInput = handleMove;
      }

      function handleMove(inp) {
        const k = inp.toLowerCase().trim();
        if (k === 'q') { endGame(); return; }
        if (k === 'r') { awaitingInput = null; blank(); startChess(); return; }
        if (gameOver || waitingSF) { awaitingInput = handleMove; return; }

        let mv = null;
        if (/^[a-h][1-8][a-h][1-8][qrbn]?$/i.test(inp)) {
          mv = game.move({ from: inp.slice(0,2).toLowerCase(), to: inp.slice(2,4).toLowerCase(), promotion: inp[4] ? inp[4].toLowerCase() : 'q' });
        }
        if (!mv) mv = game.move(inp);

        if (!mv) {
          if (game.moves().length === 0) { checkOver(); return; }
          const msg = game.in_check()
            ? '  In check — only moves that escape check are legal. Try again:'
            : '  Illegal move — try again:';
          setStatus(msg, 'err');
          awaitingInput = handleMove;
          return;
        }

        moveLog.push(mv.san);
        drawBoard(); drawHistory();
        if (checkOver()) return;

        if (isHAL) {
          const quips = [
            `I've calculated all possible variations, ${playerName}.`,
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
        game = new Chess();
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
      loadScript('https://cdnjs.cloudflare.com/ajax/libs/chess.js/0.10.3/chess.min.js')
        .then(() => fetch('https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js'))
        .then(r => r.text())
        .then(code => {
          const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
          sfWorker = new Worker(url);
          URL.revokeObjectURL(url);
          sfWorker.onmessage = onSFMsg;
          sfWorker.postMessage('uci');
          sfWorker.postMessage('setoption name Skill Level value ' + SKILL);
          sfWorker.postMessage('isready');
          startChess();
        })
        .catch(() => {
          boardEl.textContent = '';
          setStatus('  Failed to load chess engine. Check your connection.', 'err');
          blank();
          awaitingInput = inp => { if (inp.toLowerCase() === 'q') { awaitingInput = null; silentInput = false; inputRow.style.display = 'flex'; setTimeout(() => { cmd.value = ''; cmd.focus(); }, 0); } };
        });
    },

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
            activateSansMode();
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
        const exp = expandBang(bt);
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
      if (halLLM) { handleHalLLMInput(raw); scroll(); return; }
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
      if (sansBattleActive) {
        sansBattleCommand(token);
      } else {
        if      (token === 'clear')                      { COMMANDS.clear(); }
        else if (token === 'help')                       { sansHelp(); }
        else if (token === 'check')                      { sansCheck(); }
        else if (token === 'fight')                      { sansFight(); }
        else if (token === 'act')                        { sansAct(); }
        else if (token === 'item' || token === 'items')  { sansItem(); }
        else if (token === 'mercy' || token === 'spare') { sansMercy(); }
        else if (token === 'run')                        { sansRun(); }
        else if (token === 'joke')                       { sansJoke(); }
        else if (token === 'flirt')                      { sansFlirt(); }
        else if (token === 'talk')                       { sansTalk(); }
        else if (token === 'stare')                      { sansStare(); }
        else if (token === 'sound on')                   { COMMANDS['sound on'](); }
        else if (token === 'sound off')                  { COMMANDS['sound off'](); }
        else                                             { sansUnknown(raw); }
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
    else if (token === 'echo' || token.startsWith('echo ')) { blank(); line(esc(expandVars(raw.trim().slice(4).trim()))); blank(); }
    else if (token === 'man' || token.startsWith('man '))   handleMan(raw.trim().slice(3).trim());
    else if (token === 'history')                           handleHistory();
    else if (token === 'sss') {
      activateSansMode();
      blank();
      chirpTypeLine('* hey.', sansChirp, 50).then(() => delay(300)).then(() => {
        chirpTypeLine('* heh heh heh.', sansChirp, 50).then(() => { blank(); scroll(); });
      });
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
