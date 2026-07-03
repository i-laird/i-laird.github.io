// sans mode — the Undertale easter egg: the out-of-battle command set and the
// persistent turn-based battle, lazily loaded the first time it's summoned (the
// `sans` command in HAL mode, or the `sss` shortcut — see loadSansMode() in
// app.js; same pattern as stickfighter.js / games.js). Loaded as a CLASSIC
// script, it exposes one global, initSansMode(api), which returns
// { activate, command, battleCommand }. Everything it needs from app.js arrives
// through the explicit `api` bridge (app.js's sansBridge(): output/audio
// helpers, theme + mode plumbing, and live soundEnabled / playerName /
// sansBattleActive / activeMusic accessors) — this file references NOTHING from
// app.js by free global name, so it can be bundled & obfuscated as an
// independent lazy chunk without cross-file name-mangling breaking. The only
// contract is the initSansMode name + the api key names (keep both on the
// obfuscator's reserved list). The mode flags (sansMode / sansBattleActive)
// stay OWNED by app.js — this chunk reads/writes them through the bridge so
// the dispatcher, prompt, finale idle-poll, and sound toggle keep working off
// one source of truth.
// NOTE: the moved code is kept at its original app.js indentation on purpose —
// it contains multi-line template/string art, so re-indenting would corrupt it.

function initSansMode(api) {
  // Dependency bridge from app.js (see sansBridge() there). Stable refs are
  // destructured (call sites unchanged); runtime-varying state is read/written
  // live as api.<name> (api.soundEnabled, api.sansBattleActive = …, etc.).
  const { line, blank, scroll, appendNode, chirpTypeLine, sansChirp, _chirp,
          unlockAchievement, applyTheme, restoreNormal, sansMenuMusic,
          pauseMenuMusic, cmd } = api;
  const delay = (ms) => new Promise((r) => setTimeout(r, ms));

  // battle handles + death count live here — nothing outside the chunk reads them
  let sansBattle = {}, sansDeaths = 0;

  /* ── sans mode ── */
  function activateSansMode() {
    unlockAchievement('judgement');
    api.halMode = false;
    api.sansMode = true;
    api.awaitingInput = null;
    applyTheme('sans');
    if (api.soundEnabled) sansMenuMusic().play().catch(() => {});
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
      `* ${api.playerName}  LV 1  HP 20/20`,
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
    if (api.sansBattleActive) {
      blank();
      chirpTypeLine('* we\'re already doing this.', sansChirp, 50).then(() => { blank(); });
      return;
    }
    api.sansBattleActive = true;
    sansBattle = {};
    blank();
    line('  <span class="dim">[arrows] move / choose option · [z] confirm · type run to bail out</span>');
    blank();
    startPersistentFight();
  }

  function sansBattleCommand(token) {
    if (token === 'run') {
      if (sansBattle._stop) sansBattle._stop();
      api.sansBattleActive = false;
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
    appendNode(container);

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
    pauseMenuMusic();
    const battleMusic = new Audio('assets/audio/pixel_fury.mp3');
    battleMusic.preload = 'none';   // created up front but doesn't play until the first attack
    battleMusic.loop = true;
    battleMusic.volume = 0.5;
    let musicStarted = false;
    function dropTheMusic() {
      if (musicStarted) return;
      musicStarted = true;
      api.activeMusic = battleMusic;
      if (api.soundEnabled) battleMusic.play().catch(() => {});
    }

    function cleanup() {
      if (done) return; done = true;
      clearInterval(loopId);
      window.removeEventListener('keydown', onKD, true);
      window.removeEventListener('keyup',   onKU, true);
      window.removeEventListener('blur',    onBlur);
      battleMusic.pause();
      battleMusic.currentTime = 0;
      if (api.activeMusic === battleMusic) api.activeMusic = null;
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
        api.sansBattleActive = false;
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
      api.sansBattleActive = false;
      sansDeaths++;
      if (sansDeaths >= 5) unlockAchievement('determination');
      blank();
      const deathLines = dunking
        ? ['* geeettttttt dunked on!!!', '* ...', `* you cannot give up just yet, ${api.playerName}...`, '* stay determined.']
        : [`* you cannot give up just yet, ${api.playerName}...`, '* stay determined.'];
      deathLines.reduce((p, l) => p.then(() => chirpTypeLine(l, sansChirp, 50)).then(() => delay(400)),
        Promise.resolve()
      ).then(() => {
        blank();
        if (api.soundEnabled) sansMenuMusic().play().catch(() => {});
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
      lines.push(` ${api.playerName.toUpperCase().slice(0, 10)}  LV 1   HP <span style="color:${hpColor}">${'█'.repeat(filled)}${'░'.repeat(16 - filled)}</span> ${hp}/${maxHP}${krSpan}`);

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

  /* ── typed-command router (outside battle) — called by app.js's dispatch ── */
  function sansCommand(token, raw) {
    if      (token === 'help')                       { sansHelp(); }
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
    else                                             { sansUnknown(raw); }
  }

  return { activate: activateSansMode, command: sansCommand, battleCommand: sansBattleCommand };
}

// Explicit window export: in the obfuscated build this file is wrapped in an
// IIFE, so the top-level name no longer auto-attaches to window. app.js looks
// the chunk entry up by this name (keep it on the obfuscator's reserved list).
window.initSansMode = initSansMode;
