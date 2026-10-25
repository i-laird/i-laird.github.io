/*
 * The room — `room` zooms the camera out of the terminal to reveal the CRT
 * monitor it has been running on: a pure CSS-3D late-90s bedroom at 2 AM
 * (no WebGL, no library — every prop is a transformed plane; see the room
 * section of style.css). The LIVE .window element is reparented onto the
 * monitor's screen face (#room-screen) and keeps running the whole time;
 * exiting reparents it back exactly where it was.
 *
 * You can WALK: the camera is a position + yaw (an FPS view matrix,
 * `translateZ(P) rotateX(pitch) rotateY(yaw) translate3d(-x,-y,-z)` on
 * #room-world — see viewPrefix() for why the leading translateZ matters),
 * driven in a rAF loop once the fly-out lands. THE MOUSE LOOKS by dragging
 * (no Pointer Lock — the cursor stays visible so tooltips and prop clicks
 * always work; a drag that traveled more than a few px suppresses the click
 * it would otherwise end in). W/S or Up/Down walk, A/D strafe, Left/Right
 * arrows turn (keyboard-only users can still steer). Simple box collision
 * keeps you inside the walls and out of the furniture. Escape / Enter /
 * clicking the screen goes back in. Props are decorative (tooltips only)
 * except the portfolio props (see "the portfolio, in the room": the shelf's
 * books, the trophy, the gamepad, the chess board, and the real resume on
 * the desk), the lava lamp (toggles the warm `.room-lit` lighting), the TV
 * (changes channel), the magic 8-ball (answers), the aquarium (feeds the
 * fish), the HAL
 * poster (the room's one easter egg), and the creep-4 hallway phone — a
 * LIVE typed call with HAL through the hal-worker that ends with him
 * placing a real Twilio callback to the player's phone (see "the live
 * call" below; falls back to the answering machine without the worker).
 * The alarm clock is a clock radio: it plays the room's one piece of music,
 * which corrupts with the creep stages (see "the clock radio" below).
 *
 * Lazily loaded by launchRoom() in app.js the first time `room` runs (same
 * pattern as desktop.js): classic script, one global — initRoom(api) →
 * { open }. Every app.js dependency arrives through the `api` bridge
 * (roomBridge() in app.js); this file references NOTHING from app.js/lib by
 * free global name (test/room-isolation.test.js enforces it statically).
 * roomActive stays app.js-owned (the finale idle-poll reads it) — written
 * back through the api accessor. Keep `initRoom` on the obfuscator's
 * reserved-names list (scripts/build.js).
 */

function initRoom(api) {
  const PERSPECTIVE = 1050; // must match #room-viewport's CSS perspective (lower = wider FOV)

  /* Where the fly-out lands you: standing inside the room, back-right of the
     desk, facing the monitor. y is eye height (fixed); pitch is a gentle
     downward tilt. */
  const CAM_START = { x: 680, y: -110, z: 1140, yaw: -30, pitch: 6 };
  const cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };

  const TURN_SPEED = 100; // deg per second (dt-scaled — rAF rate varies by display)
  const MOVE_SPEED = 520; // px per second
  // walkable area: inside the walls, outside the desk+monitor and the tower
  const BOUNDS = { minX: -1550, maxX: 1550, minZ: -230, maxZ: 2030 };
  const BLOCKS = [
    { minX: -950, maxX: 950, minZ: -520, maxZ: 470 },    // desk + monitor
    { minX: -1330, maxX: -880, minZ: -160, maxZ: 330 },  // tower
    { minX: -1120, maxX: -440, minZ: 1940, maxZ: 2210 }, // dresser
    { minX: 1060, maxX: 1710, minZ: -480, maxZ: 790 },   // bed
    { minX: 80, maxX: 400, minZ: 480, maxZ: 800 },       // chair
    { minX: -1710, maxX: -1300, minZ: 700, maxZ: 1300 }, // aquarium
    { minX: 1300, maxX: 1710, minZ: 1420, maxZ: 2020 },  // TV stand + console
    { minX: -1500, maxX: -1220, minZ: 1500, maxZ: 1740 }, // laundry
  ];

  let viewport = null, world = null, par = null, screenEl = null, glassEl = null;
  let tip = null, hint = null, blinkEl = null, clockEl = null;
  let active = false, exiting = false, walking = false;
  let restoreParent = null, restoreNext = null;
  let keyHandler = null, keyUpHandler = null, blurHandler = null;
  let moveHandler = null, clickHandler = null, downHandler = null, upHandler = null;
  let clockTimer = null, rafId = null;
  let bills = [], billYaw = null;
  let eyeEl = null, posterEl = null, callEl = null;
  let doorEl = null, duckEl = null, stickyEl = null, bedEl = null, capEl = null, stitchEl = null;
  let doorSignEl = null, corkNotes = [], signState = 0;
  let hallPhoneEl = null, hallOpen = false, hallWhispered = false;
  let hallSconces = [], hallDoors = [], slamDoor = null, slammed = false;
  let hallShapes = [], verseEls = [], versesSpoken = 0;
  let figFarEl = null, figBackEl = null, figFar = true, figBack = 0;
  let stepAcc = 0, wasMoving = false;
  let doorShut = false, wakeUp = false, crtOffEl = null;
  const wakeTimers = [];
  // the room changing behind your back (see "while you aren't looking")
  let chairGrpEl = null, chairAng = 0, lastChairT = 0, lastShiftT = 0, lastShiftCheck = 0;
  let mugEl = null, mug2El = null, padBedEl = null, padChairEl = null, trophyEl = null;
  let tallyEl = null, cityLights = [], fogEl = null, flickEl = null;
  let reflEl = null, reflOn = false, reflN = 0, shadowEl = null;
  let visits = 0, lastActive = 0, stared = false, stillFlicked = false, lastPose = '';
  let termStep = 0, hiddenTitle = null, visHandler = null;
  const shifts = [];
  let tvEl = null, tvCh = 0, ballEl = null, lastAnswer = -1, fishEl = null, calEl = null;
  let creepTipEls = [];
  let creepStage = 0, ringing = false, answered = false, callTyper = null;
  let nineTaps = 0; // consecutive 9-presses; 9-9-9 fast-forwards the creep
  // live browser call (hal-worker line): null when the receiver is down.
  // phase: 'connect' | 'chat' | 'dialed'; call.pop is the number popup
  // ({ stage: 'num'|'offer'|'code', input, num, note }) while it is open.
  let call = null, callAudio = null, tsRequested = false, popEl = null;
  let lastTrack = 0;
  const keys = new Set();
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

  /* ── the clock radio ──
     The alarm clock on the tower is a clock radio, and at 2 AM it gets one
     station. Two elements play in step: the clean track and a HAL-corrupted
     twin of identical length (static, warble, his voice coming through the
     speaker). The creep stage sets how far the mix has slid toward the twin
     (RADIO_MIX) and how far the tape has sagged (RADIO_DRAG); the volume
     falls off with distance from the clock, so the hallway leaves it behind,
     and it ducks under the telephone. One { play, pause } handle is parked on
     api.activeMusic so the sound toggle reaches it. No seeking, ever: the
     twin is kept in step by nudging its playback rate (see createMusic() in
     games.js for why). */
  const RADIO_SRC = 'assets/audio/two_am_radio_station.mp3';
  const RADIO_DARK_SRC = 'assets/audio/two_am_radio_station_dark.mp3';
  const RADIO_POS = { x: -1080, z: 70 };   // .rm-clock in style.css
  const RADIO_VOL = 0.45, RADIO_DRAG = 0.07;
  const RADIO_MIX = [0, 0.2, 0.5, 0.85, 1]; // by creep stage
  let radio = null, radioDark = null, radioHandle = null, radioTimer = null;
  let radioMix = 0, radioFade = 0, radioDuck = 1, radioCut = 0;

  /* ── the sound goes wrong ──
     When the browser has Web Audio, the radio (and the hallway's song) run
     through one effects chain, `fx` (buildFx): tape wow-and-flutter (a
     wobble on playbackRate — preservesPitch is off, so the pitch warbles
     too), a waveshaper that overdrives, and a lowpass that muffles — all
     three deepening by creep stage (FX). In the hallway it turns into the
     boat tunnel: a swept, fed-back delay (flanger) and a long synthetic
     reverb come in with depth (hallT, 0 at the door → 1 at the phone), a
     slowed, buried Daisy (HALL_SONG_SRC) fades in and speeds up and climbs
     in pitch the deeper you go, and a Shepard tone — an endlessly rising
     chord — builds underneath, accelerating. Each couplet on the wall is
     spoken as you pass it, faster and higher every time (speakVerse). No
     Web Audio (jsdom, old browsers): the plain element-volume path still
     plays the radio and the song, without the processing. */
  const HALL_SONG_SRC = 'assets/audio/daisy_buried.mp3';
  const FX = {                                  // by creep stage
    drive:  [0, 0.03, 0.12, 0.25, 0.4],
    cutoff: [18000, 9000, 4800, 3000, 2000],
    wobble: [0, 0.003, 0.008, 0.015, 0.024],
  };
  const SHEP_N = 6;
  let hallSong = null, fx = null, fxTried = false;
  let wobblePhase = 0, shepPhase = 0, lastDrive = -1;

  function makeCurve(amount) {                  // soft clip; 0 = straight through
    const n = 1024, k = amount * 120, c = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      c[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return c;
  }
  function impulse(ctx, secs, decay) {          // a synthetic tunnel: decaying noise
    const len = Math.floor(ctx.sampleRate * secs);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
  function buildFx() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
      const ctx = new AC();
      const gClean = ctx.createGain(), gDark = ctx.createGain(), gSong = ctx.createGain();
      for (const g of [gClean, gDark, gSong]) g.gain.value = 0;
      ctx.createMediaElementSource(radio).connect(gClean);
      ctx.createMediaElementSource(radioDark).connect(gDark);
      ctx.createMediaElementSource(hallSong).connect(gSong);
      const bus = ctx.createGain();
      gClean.connect(bus); gDark.connect(bus); gSong.connect(bus);
      const shaper = ctx.createWaveShaper();
      shaper.oversample = '2x';
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 18000;
      bus.connect(shaper); shaper.connect(lp);
      // flanger: a short delay, swept by an LFO and fed back into itself
      const dly = ctx.createDelay(0.05);
      dly.delayTime.value = 0.005;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.25;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0;
      lfo.connect(lfoAmt); lfoAmt.connect(dly.delayTime); lfo.start();
      const fb = ctx.createGain(), flWet = ctx.createGain();
      fb.gain.value = 0; flWet.gain.value = 0;
      lp.connect(dly); dly.connect(fb); fb.connect(dly); dly.connect(flWet);
      // the tunnel's reverb
      const verb = ctx.createConvolver();
      verb.buffer = impulse(ctx, 2.8, 2.6);
      const verbWet = ctx.createGain();
      verbWet.gain.value = 0;
      lp.connect(verb); verb.connect(verbWet);
      const master = ctx.createGain();
      lp.connect(master); flWet.connect(master); verbWet.connect(master);
      // a gentle compressor last: the overdrive, the twin's static and the
      // flanger all swing the level — this holds it steady
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -26; comp.knee.value = 18; comp.ratio.value = 4;
      comp.attack.value = 0.02; comp.release.value = 0.4;
      master.connect(comp);
      comp.connect(ctx.destination);
      // the Shepard riser: octave-spaced sines, loudest mid-range, forever climbing
      const shepBus = ctx.createGain();
      shepBus.gain.value = 0;
      shepBus.connect(master); shepBus.connect(verb);
      const shep = [];
      for (let k = 0; k < SHEP_N; k++) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        g.gain.value = 0;
        o.connect(g); g.connect(shepBus); o.start();
        shep.push({ o, g });
      }
      return { ctx, gClean, gDark, gSong, shaper, lp, lfo, lfoAmt, fb, flWet, verbWet, shepBus, shep };
    } catch (e) {
      return null;
    }
  }
  // the context can start suspended (autoplay rules); any gesture in the room wakes it
  function wakeFx() {
    if (fx && api.soundEnabled && fx.ctx.state === 'suspended') fx.ctx.resume().catch(() => {});
  }
  const ramp = (param, v) => param.setTargetAtTime(v, fx.ctx.currentTime, 0.35);   // slow: no pumping

  /* the couplets, spoken as you pass them — Wonka on the boat, losing it */
  const VERSE_RATE = [0.75, 0.95, 1.25, 1.75], VERSE_PITCH = [0.5, 0.85, 1.35, 1.95];
  function speakVerse(i, text) {
    if (!api.soundEnabled || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return;
    const u = new window.SpeechSynthesisUtterance(text);
    u.rate = VERSE_RATE[i]; u.pitch = VERSE_PITCH[i]; u.volume = 0.85;
    window.speechSynthesis.speak(u);
  }

  function radioTick() {
    const to = RADIO_MIX[creepStage];
    radioMix = Math.abs(to - radioMix) <= 0.015 ? to : radioMix + Math.sign(to - radioMix) * 0.015;
    // swells in as the camera pulls back, dies away on the glide home
    radioFade = Math.max(0, Math.min(1, radioFade + (exiting ? -0.08 : 0.04)));
    radioDuck += (((call || callTyper) ? 0.3 : 1) - radioDuck) * 0.2;
    const d = Math.hypot(cam.x - RADIO_POS.x, cam.z - RADIO_POS.z);
    const near = Math.max(0.15, 1 / (1 + (d / 3400) * (d / 3400))) * (doorShut ? 0.35 : 1);
    let v = RADIO_VOL * radioFade * radioDuck * near;
    if (radioCut > 0) { radioCut--; v = 0; }   // a dropout: dead air
    // how far down the hallway: 0 at the door, 1 at the phone
    const hallT = hallOpen ? Math.max(0, Math.min(1, (cam.z - 2200) / 3100)) : 0;
    // wow and flutter: two incommensurate sines, faster as it gets worse
    wobblePhase += 0.1 * (0.6 + 1.2 * radioMix + 2.5 * hallT);
    const wob = (FX.wobble[creepStage] + 0.015 * hallT) *
      (Math.sin(wobblePhase) + 0.4 * Math.sin(wobblePhase * 2.7));
    const rate = (1 - RADIO_DRAG * radioMix) * (1 + wob);
    radio.playbackRate = rate;
    const drift = radio.paused || radioDark.paused ? 0
      : Math.max(-0.1, Math.min(0.1, radioDark.currentTime - radio.currentTime));
    radioDark.playbackRate = rate * (1 - 0.5 * drift);
    // the hallway's song: buried Daisy, faster and higher the deeper you go
    const songV = 0.4 * hallT * radioFade * radioDuck;
    if (hallT > 0 && hallSong.paused && api.soundEnabled && !exiting) hallSong.play().catch(() => {});
    hallSong.playbackRate = (0.85 + 0.8 * hallT) * (1 + wob * 0.5);
    if (!fx) {
      radio.volume = v * (1 - radioMix);
      radioDark.volume = v * radioMix;
      hallSong.volume = songV;
      return;
    }
    ramp(fx.gClean.gain, v * (1 - radioMix));
    ramp(fx.gDark.gain, v * radioMix);
    ramp(fx.gSong.gain, songV);
    const drive = Math.min(0.6, FX.drive[creepStage] + 0.15 * hallT);
    if (Math.abs(drive - lastDrive) > 0.02) {
      lastDrive = drive;
      fx.shaper.curve = drive > 0.01 ? makeCurve(drive) : null;
    }
    // muffled in the room; the tunnel opens back up into something bright and wrong
    ramp(fx.lp.frequency, FX.cutoff[creepStage] + (7000 - FX.cutoff[creepStage]) * hallT);
    ramp(fx.lfoAmt.gain, 0.0012 * (creepStage >= 3 ? 1 : 0) + 0.0042 * hallT);
    ramp(fx.lfo.frequency, 0.2 + 1.4 * hallT);
    ramp(fx.fb.gain, 0.7 * hallT);
    ramp(fx.flWet.gain, 0.85 * hallT);
    ramp(fx.verbWet.gain, (creepStage >= 2 ? 0.18 : 0) + 0.9 * hallT);
    // the Shepard riser: each voice climbs an octave per cycle and is
    // weighted by a bell over the span, so the chord climbs and never arrives
    shepPhase = (shepPhase + 0.1 * (0.04 + 0.35 * hallT)) % 1;
    ramp(fx.shepBus.gain, 0.06 * hallT * radioFade);
    fx.shep.forEach(({ o, g }, k) => {
      const pos = (k + shepPhase) % SHEP_N;
      o.frequency.setTargetAtTime(55 * Math.pow(2, pos), fx.ctx.currentTime, 0.05);
      const bell = Math.exp(-Math.pow(pos - SHEP_N / 2, 2) / 2.2);
      g.gain.setTargetAtTime(bell / SHEP_N, fx.ctx.currentTime, 0.05);
    });
  }
  function radioStart() {
    if (!radio) {
      const mk = (src) => {
        const a = new Audio(src);
        a.preload = 'none';
        a.loop = true;
        a.preservesPitch = false;   // the tape sags: pitch follows speed
        a.volume = 0;
        return a;
      };
      radio = mk(RADIO_SRC);
      radioDark = mk(RADIO_DARK_SRC);
      hallSong = mk(HALL_SONG_SRC);
      radioHandle = {
        play() {
          if (!active) return Promise.resolve();
          if (fx) fx.ctx.resume().catch(() => {});
          const ps = [radio.play(), radioDark.play()];
          if (hallOpen) ps.push(hallSong.play());
          return Promise.all(ps);
        },
        pause() {
          for (const a of [radio, radioDark, hallSong]) if (!a.paused) a.pause();
          if (fx) fx.ctx.suspend().catch(() => {});   // the Shepard riser too
        },
      };
    }
    if (!fxTried) {
      fxTried = true;
      fx = buildFx();
      // with the chain in place the mix rides on its gain nodes, so the
      // elements themselves run at full volume — Chrome applies an element's
      // own volume BEFORE its MediaElementSource, and these were made at 0
      if (fx) for (const a of [radio, radioDark, hallSong]) a.volume = 1;
    }
    radioMix = 0; radioFade = 0; radioDuck = 1; radioCut = 0;
    wobblePhase = 0; shepPhase = 0; lastDrive = -1;
    api.activeMusic = radioHandle;
    if (api.soundEnabled) radioHandle.play().catch(() => {});
    radioTimer = setInterval(radioTick, 100);
  }
  function radioStop() {
    if (!radio) return;
    clearInterval(radioTimer);
    radioHandle.pause();
    if (api.activeMusic === radioHandle) api.activeMusic = null;
  }

  /* View matrix: `translateZ(P) rotate… translate3d(-cam)`. The leading
     translateZ(P) is load-bearing — the CSS eye sits at z=P in front of the
     transform origin, so without it the rotation pivot is a point 1600px in
     FRONT of the eye: turning orbits the room around that point ("swivels
     funny"), and things you walked past are still between it and the eye, so
     they render backfaced/mirrored. With it, `cam` IS the eye: rotation
     pivots on the player and forward distance d renders at scale P/d. */
  function viewPrefix() {
    return 'translateZ(' + PERSPECTIVE + 'px) ';
  }

  /* The camera pose that renders the 900x640 screen face (at world origin,
     z=0) as large as the viewport allows: a plane d in front of the eye
     scales by P/d, so stand at d = P/s. */
  function zoomInTransform() {
    const s = Math.min(window.innerWidth / 960, window.innerHeight / 710);
    const d = PERSPECTIVE / s;
    return viewPrefix() + 'translate3d(0px, 0px, ' + (-d).toFixed(1) + 'px)';
  }

  function camTransform() {
    return viewPrefix() +
      'rotateX(' + cam.pitch.toFixed(2) + 'deg) rotateY(' + cam.yaw.toFixed(2) + 'deg) ' +
      'translate3d(' + (-cam.x).toFixed(1) + 'px, ' + (-cam.y).toFixed(1) + 'px, ' + (-cam.z).toFixed(1) + 'px)';
  }

  /* Mouse-look: yaw/pitch applied straight to the camera (view-space — the
     pivot is the eye, so it never orbits the room). Fed by pointer-lock
     movement deltas, or by drag deltas when lock is off. */
  const LOOK_SENS = 0.16;
  let dragging = false, dragX = 0, dragY = 0, dragDist = 0;
  // in this view matrix yaw+ looks RIGHT and pitch+ looks UP, so: mouse
  // right → yaw+, mouse down → pitch− (non-inverted FPS feel)
  function applyLook(dx, dy) {
    cam.yaw += dx * LOOK_SENS;
    cam.pitch = Math.max(-42, Math.min(34, cam.pitch - dy * LOOK_SENS * 0.8));
  }

  // the hallway past the front-wall door (walkable once creep-4 opens it):
  // door-width corridor from the doorway to just short of the phone stand
  const HALL = { minX: 330, maxX: 790, maxZ: 5340 };

  function blocked(x, z) {
    if (doorShut && z < 2260) return true;   // it shut behind you. there is no back.
    if (z > BOUNDS.maxZ) {
      if (!hallOpen) return true;
      return x < HALL.minX || x > HALL.maxX || z > HALL.maxZ;
    }
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ) return true;
    for (const b of BLOCKS) {
      if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ) return true;
    }
    return false;
  }

  const KEYMAP = {
    w: 'fwd', arrowup: 'fwd',
    s: 'back', arrowdown: 'back',
    a: 'left',  // strafe
    d: 'right',
    arrowleft: 'turnl', arrowright: 'turnr',
  };

  let lastStep = 0, lastT = '';
  function step(now) {
    rafId = requestAnimationFrame(step);
    const dt = lastStep ? Math.min((now - lastStep) / 1000, 0.05) : 0;
    lastStep = now;
    if (!walking || exiting || !dt) return;
    if (keys.has('turnl')) cam.yaw -= TURN_SPEED * dt;
    if (keys.has('turnr')) cam.yaw += TURN_SPEED * dt;
    const px = cam.x, pz = cam.z;
    const mv = (keys.has('fwd') ? 1 : 0) - (keys.has('back') ? 1 : 0);
    const st = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    if (mv || st) {
      const r = (cam.yaw * Math.PI) / 180;
      const fx = Math.sin(r), fz = -Math.cos(r);   // forward
      const rx = -fz, rz = fx;                     // right (strafe)
      const norm = mv && st ? Math.SQRT1_2 : 1;    // diagonals aren't faster
      const sp = MOVE_SPEED * hallSlow(cam.z);      // the hallway's treadmill
      const nx = cam.x + sp * dt * norm * (mv * fx + st * rx);
      const nz = cam.z + sp * dt * norm * (mv * fz + st * rz);
      // slide along obstacles: keep whichever axis stays clear
      if (!blocked(nx, nz)) { cam.x = nx; cam.z = nz; }
      else if (!blocked(nx, cam.z)) { cam.x = nx; }
      else if (!blocked(cam.x, nz)) { cam.z = nz; }
    }
    const moved = Math.hypot(cam.x - px, cam.z - pz);
    hallWarp();
    const t = camTransform();
    if (t !== lastT) { lastT = t; world.style.transform = t; shadowTick(); }
    updateBills();
    shiftTick(now);
    corruptTick(now);
    reflTick();
    stillTick(now, moved);
    if (signState) {
      // fz = how much the camera faces the front wall (+z, where the sign is)
      const fz = -Math.cos((cam.yaw * Math.PI) / 180);
      if (signState === 1 && fz > 0.5) signState = 2;          // they read it
      else if (signState === 2 && fz < -0.3) {                 // they obeyed —
        signState = 0;                                         // swap unseen
        doorSignEl.innerHTML = 'HE IS<br>WAITING';
      }
    }
    if (hallOpen && cam.z > 2200) hallTick(moved);
    if (hallOpen && !hallWhispered && cam.z > 4600) {
      hallWhispered = true; // once per visit, deep in the corridor
      api.halSpeak('I see you.');
    }
    if (creepStage >= 2 && now - lastTrack > 120) {
      lastTrack = now;
      // the poster's pupil drifts toward wherever you stand
      const px = Math.max(34, Math.min(58, 46 + (cam.x - 740) * 0.008));
      const py = Math.max(34, Math.min(50, 42 + (474 + cam.z) * 0.004 - 4));
      eyeEl.style.setProperty('--ex', px.toFixed(1) + '%');
      eyeEl.style.setProperty('--ey', py.toFixed(1) + '%');
    }
  }

  /* Sprite billboards: roundish objects (mug, lava lamp, trophy, 8-ball, laundry) are single
     planes that would vanish edge-on, so they always face the camera — the
     element's own rotateY cancels the view rotation (net yaw 0). */
  function updateBills() {
    if (billYaw !== null && Math.abs(billYaw - cam.yaw) < 0.4) return;
    billYaw = cam.yaw;
    for (const b of bills) {
      const t =
        'translate(-50%, -50%) translate3d(' + b.dataset.bx + 'px, ' + b.dataset.by + 'px, ' +
        b.dataset.bz + 'px) rotateY(' + (-cam.yaw).toFixed(1) + 'deg)';
      b.style.transform = t;
      // ringing shake keyframes compose with the billboard pose via this var
      b.style.setProperty('--bill-t', t);
    }
  }

  /* ── the hallway's furniture ──
     An old hotel corridor, not a funhouse: stained wallpaper, numbered
     doors, sconces. Built from these tables so the reactive beats in
     hallTick() read the same z the markup was placed at. */
  const HALL_SCONCES = [[2650, 'l'], [3150, 'r'], [3650, 'l'], [4150, 'r'], [4650, 'l'], [5150, 'r']];
  const HALL_DOORS = [
    { z: 2900, side: 'r', num: '101', tip: 'room 101. the worst thing in the world is in there.' },
    { z: 3400, side: 'l', num: '2001', tip: 'someone is in there. the door is open a crack.', ajar: true },
    { z: 3900, side: 'r', num: '237', tip: 'room 237. absolutely not.' },
    { z: 4400, side: 'l', num: '9000', tip: 'the handle is warm.' },
    { z: 4900, side: 'r', num: '', tip: 'the number has been scratched off. from the inside.' },
  ];
  function wallAt(side, y, z, inset) {
    return 'transform: translate(-50%, -50%) translate3d(' + (side === 'l' ? 291 + inset : 829 - inset) + 'px, ' +
      y + 'px, ' + z + 'px) rotateY(' + (side === 'l' ? 90 : -90) + 'deg)';
  }
  /* The projections: as you walk the corridor, shapes flicker onto the
     wallpaper ahead of you like a projector catching — a pinwheel spiral, a
     watching eye, a centipede crawling the length of the wall, a
     kaleidoscope, a grin — the deeper ones bigger and faster (`deep`). Each
     lights once you're within ~1600 of it — far enough ahead to watch it catch — (hallTick) and stays lit behind you
     in the dark. Placed at inset 3, in front of the doors and sconces. */
  const HALL_SHAPES = [
    { z: 2700, side: 'r', kind: 'spiral' },
    { z: 3050, side: 'l', kind: 'eye' },
    { z: 3420, side: 'r', kind: 'centipede' },
    { z: 3800, side: 'l', kind: 'kaleido' },
    { z: 4150, side: 'r', kind: 'grin' },
    { z: 4500, side: 'l', kind: 'spiral', deep: true },
    { z: 4820, side: 'r', kind: 'eye', deep: true },
    { z: 5120, side: 'l', kind: 'kaleido', deep: true },
    { z: 5380, side: 'r', kind: 'centipede', deep: true },
  ];
  const SHAPE_INNER = {
    spiral: '<b></b>',
    kaleido: '<b></b>',
    eye: '<b><i></i></b>',
    grin: '<b></b><i></i><i></i>',
    centipede: '<span>' + '<i></i>'.repeat(11) + '</span>',
  };
  // the four couplets' z (keep in step with .rm-hall-poem1..4 in style.css)
  const VERSE_Z = [2960, 3560, 4260, 4960];

  function hallFixtures() {
    let h = '';
    for (const sh of HALL_SHAPES) {
      h += '<div class="rp rm-proj rm-proj-' + sh.kind + (sh.deep ? ' rm-proj-deep' : '') + '" style="' +
        wallAt(sh.side, sh.kind === 'centipede' ? 470 : 20, sh.z, 3) + '">' + SHAPE_INNER[sh.kind] + '</div>';
    }
    for (const d of HALL_DOORS) {
      h += '<div class="rp rm-hdoor' + (d.ajar ? ' rm-ajar' : '') + '" style="' + wallAt(d.side, 390, d.z, 1) +
        '" data-tip="' + d.tip + '"><span>' + (d.num || '&#10006;&#10006;&#10006;') + '</span><i></i><b></b></div>';
    }
    for (const [z, side] of HALL_SCONCES) {
      h += '<div class="rp rm-sconce" style="' + wallAt(side, 60, z, 2) + '"></div>';
    }
    return h;
  }

  /* ── the hallway that is longer than it is ──
     Two things, both keyed to how far in you are (t: 0 at the door, 1 at
     the phone), so walking back undoes them:
     · the far end recedes. Through the middle the whole end group (wall,
       phone, stand, halo) slides AWAY as you walk — faster than you walk, so
       the phone gets further off with every step — then over the last stretch
       it rushes back to meet you (hallStretch; the corridor's floor, ceiling
       and far walls run on past the end wall to cover the gap);
     · a treadmill: your stride sags toward the middle (hallSlow).
     (A third — the field of view breathing with your steps — was removed: a
     widening FOV shows more floor, and it read as the camera sinking.) */
  const HALL_STRETCH = 1100;   // keep under the ~1400 the hall's floor/walls run past the end wall
  let endGrpEl = null, lastStretch = -1;
  const hallDepth = (z) => Math.max(0, Math.min(1, (z - 2200) / 3100));
  const smooth = (a, b, x) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };
  function hallStretch(z) {
    const t = hallDepth(z);
    return HALL_STRETCH * smooth(0.12, 0.72, t) * (1 - smooth(0.78, 1, t));
  }
  function hallSlow(z) {
    return hallOpen ? 1 - 0.45 * Math.sin(Math.PI * hallDepth(z)) : 1;
  }
  function hallWarp() {
    const st = hallOpen ? hallStretch(cam.z) : 0;
    if (Math.abs(st - lastStretch) > 0.5) {
      lastStretch = st;
      endGrpEl.style.transform = 'translate3d(0, 0, ' + st.toFixed(1) + 'px)';
    }
  }

  /* The hallway watches you walk it (called from step() once creep-4 opens
     it): the sconces die behind you, so the way back is dark; each door's
     peephole lights as you pass; door 2001 — open a crack, red light inside —
     slams once you're past; a figure stands at the far end only until you
     come for it, and once you're deep in it's in the doorway behind you,
     gone a beat after you turn to look; and your footsteps have an echo
     that takes one more step than you do. */
  function hallTick(moved) {
    const z = cam.z;
    // the door shuts behind you — a few steps in, and only once you've turned
    // your back on it (facing down the hall), so you hear it rather than see it
    if (!doorShut && z > 2650 && -Math.cos((cam.yaw * Math.PI) / 180) > 0.3) {
      doorShut = true;
      viewport.classList.add('door-shut');
      api._chirp(44, 'sine', 0.55, 0.12);              // the slam
      later(() => api._chirp(900, 'square', 0.03, 0.03), 260);   // the latch
      doorEl.dataset.tip = 'it will not open.';
    }
    for (const sh of hallShapes) {
      if (!sh.on && z > sh.z - 1600) {   // far enough ahead to watch it catch
        sh.on = true;
        sh.el.classList.add('on');
        api._chirp(1400, 'square', 0.02, 0.015);   // the projector catching
      }
    }
    if (versesSpoken < VERSE_Z.length && z > VERSE_Z[versesSpoken] - 260) {
      speakVerse(versesSpoken, verseEls[versesSpoken].textContent);
      versesSpoken++;
    }
    for (const sc of hallSconces) {
      if (!sc.out && z > sc.z + 320) {
        sc.out = true;
        sc.el.classList.add('rm-out');
        api._chirp(2600, 'square', 0.015, 0.01);   // the filament
      }
    }
    for (const d of hallDoors) {
      const on = Math.abs(z - d.z) < 420;
      if (on !== d.seen) { d.seen = on; d.el.classList.toggle('rm-seen', on); }
    }
    if (!slammed && z > slamDoor.z + 380) {
      slammed = true;
      slamDoor.el.classList.remove('rm-ajar');
      slamDoor.el.classList.add('rm-slam');
      api._chirp(46, 'sine', 0.4, 0.1);
      api._chirp(130, 'square', 0.04, 0.03);
    }
    if (figFar && z > 2450) { figFar = false; figFarEl.classList.add('rm-gone'); }
    const facingBack = -Math.cos((cam.yaw * Math.PI) / 180) < -0.5;
    if (figBack === 0 && z > 4300) {
      figBack = 1;
      figBackEl.classList.remove('rm-gone');
    } else if (figBack === 1 && (facingBack || z < 3300)) {
      figBack = 2;
      later(() => {
        if (!active) return;
        figBackEl.classList.add('rm-gone');
        api._chirp(40, 'sine', 0.6, 0.07);
      }, 900);
    }
    if (moved > 0) {
      stepAcc += moved;
      wasMoving = true;
      if (stepAcc > 250) {
        stepAcc = 0;
        api._chirp(110, 'sine', 0.05, 0.035);
        later(() => { if (active) api._chirp(88, 'sine', 0.06, 0.03); }, 190);
      }
    } else if (wasMoving) {
      wasMoving = false;
      later(() => { if (active && hallOpen) api._chirp(88, 'sine', 0.06, 0.03); }, 520);
    }
  }

  /* ── while you aren't looking ──
     The room changes behind your back, never in front of you: every entry in
     `shifts` waits for its creep stage AND for its prop to be off-screen
     (offscreen() — more than ~62° off where the camera faces, comfortably
     outside the view frustum at any window shape), then happens at most one
     every few seconds. You never see anything move; you only notice it moved.
     The desk chair is the slow one: from stage 2 it turns, a step at a time
     and only while you look away, until it faces wherever you are standing —
     and it is still facing that way next visit (ilaird_room_chair). */
  const DEG = Math.PI / 180;
  function offAxis(x, z) {   // degrees between the view direction and (x, z)
    const fx = Math.sin(cam.yaw * DEG), fz = -Math.cos(cam.yaw * DEG);
    const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    if (d < 1) return 0;
    return Math.acos(Math.max(-1, Math.min(1, (fx * dx + fz * dz) / d))) / DEG;
  }
  const offscreen = (x, z) => offAxis(x, z) > 62;

  function setBill(el, x, y, z) {
    el.dataset.bx = x; el.dataset.by = y; el.dataset.bz = z;
    billYaw = null;   // re-pose on the next frame
  }
  function buildShifts() {
    shifts.length = 0;
    const add = (stage, x, z, run) => shifts.push({ stage, x, z, run, done: false });
    add(2, -610, 200, () => setBill(mugEl, -610, 394, 290));                 // toward the edge
    add(2, -280, -80, () => { setBill(duckEl, -470, 409, 250); duckEl.dataset.tip = 'it was on the monitor a minute ago.'; });
    add(2, 1694, 250, () => renderTally(visits));                             // tonight's mark
    add(3, 1350, 510, () => { padBedEl.classList.add('rm-hide'); padChairEl.classList.remove('rm-hide'); });
    add(3, -920, -455, () => trophyEl.classList.add('rm-hide'));
    add(3, 130, 260, () => mug2El.classList.remove('rm-hide'));
    add(3, -610, 290, () => setBill(mugEl, -610, 394, 336));                 // right on the edge now
    add(3, -470, 250, () => { setBill(duckEl, 560, 874, 1960); duckEl.dataset.tip = 'it wants to show you something.'; });
  }
  function resetShifts() {
    for (const sh of shifts) sh.done = false;
    setBill(mugEl, -610, 394, 200);
    setBill(duckEl, -280, -450, -80);
    padBedEl.classList.remove('rm-hide');
    padChairEl.classList.add('rm-hide');
    trophyEl.classList.remove('rm-hide');
    mug2El.classList.add('rm-hide');
  }
  function setChair(a) {
    chairAng = a;
    chairGrpEl.style.transform = 'translate3d(240px, 0, 640px) rotateY(' + a.toFixed(1) + 'deg) translate3d(-240px, 0, -640px)';
  }
  function shiftTick(now) {
    if (now - lastShiftCheck < 400) return;
    lastShiftCheck = now;
    if (creepStage >= 2 && now - lastChairT > 7000 && offscreen(240, 640)) {
      // the seat faces -z; rotateY(a) points it along (-sin a, -cos a)
      const want = Math.atan2(-(cam.x - 240), -(cam.z - 640)) / DEG;
      let diff = ((want - chairAng) % 360 + 540) % 360 - 180;
      if (Math.abs(diff) > 12) {
        diff = Math.max(-70, Math.min(70, diff));
        setChair(chairAng + diff);
        lastChairT = now;
        store('ilaird_room_chair', chairAng.toFixed(1));
      }
    }
    if (now - lastShiftT < 4500) return;
    // first one that is due AND out of view — a visible prop never holds up the rest
    const sh = shifts.find((c) => !c.done && c.stage <= creepStage && offscreen(c.x, c.z));
    if (sh) {
      sh.done = true;
      lastShiftT = now;
      sh.run();
    }
  }

  /* ── the room remembers you ──
     A visit counter in localStorage (ilaird_ prefix, so `forget` erases it):
     tally marks scratched above the bed, one per visit (tonight's appears at
     stage 2, behind your back); a return visit starts further along the
     creep; the corkboard has a note for you; the chair is where it was left.
     Visiting between 2 and 4 AM local time starts at stage 2 regardless. */
  function store(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }
  function recall(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function renderTally(n) {
    n = Math.min(n, 60);
    let h = '';
    for (let g = 0; g < n; g += 5) {
      const c = Math.min(5, n - g);
      h += '<b>' + '<i></i>'.repeat(Math.min(c, 4)) + (c === 5 ? '<s></s>' : '') + '</b>';
    }
    tallyEl.innerHTML = h;
    tallyEl.dataset.tip = n ? 'scratched into the paint. someone is counting.' : '';
    if (!n) delete tallyEl.dataset.tip;
  }
  function startStage() {
    const hour = window.ROOM_CLOCK_HOUR !== undefined ? window.ROOM_CLOCK_HOUR : new Date().getHours();
    const fromVisits = visits >= 4 ? 2 : visits >= 2 ? 1 : 0;
    return Math.max(fromVisits, hour >= 2 && hour < 4 ? 2 : 0);
  }

  /* ── the window ──
     From stage 1 the city goes dark one lit window at a time — only while
     you aren't looking at it — until one is left; at stage 3 the glass fogs
     and LET ME IN is written in it, backwards, from the outside. */
  // the poster's code rain: fixed columns of half-width katakana and digits
  const MATRIX_RAIN = (() => {
    const g = 'ﾊﾐﾋｰｳｼﾅﾓﾆｻﾜﾂｵﾘｱﾎﾃﾏｹﾒｴｶｷﾑﾕﾗｾﾈｽﾀﾇﾍ0123456789Z';
    let h = '';
    for (let c = 0; c < 11; c++) {
      let col = '';
      for (let r = 0; r < 18; r++) col += g[(c * 7 + r * 13 + c * r) % g.length];
      h += '<i>' + col + '</i>';
    }
    return h;
  })();
  const CITY_LIGHTS = [[12, 52], [30, 66], [47, 47], [84, 50], [55, 76], [20, 70], [38, 58], [74, 72], [90, 64], [8, 80], [62, 46], [44, 84]];
  function cityTick() {
    if (!active || exiting) return;
    if (!offscreen(-1694, 150)) { later(cityTick, 1200); return; }   // not while you watch
    const lit = cityLights.filter((el) => !el.classList.contains('rm-off'));
    if (lit.length <= 1) return;   // one window stays lit. someone is still up.
    lit[Math.floor(Math.random() * lit.length)].classList.add('rm-off');
    later(cityTick, 4000);
  }

  /* ── the monitor glass ──
     From stage 3, walk up to the screen and the glass shows someone standing
     over your shoulder. Look away and back: closer. Turn around: nobody. */
  function reflTick() {
    const looking = creepStage >= 3 && cam.z < 1900 && Math.abs(cam.x) < 900 && offAxis(0, 0) < 20;
    if (looking && !reflOn) {
      reflOn = true;
      reflEl.style.setProperty('--rx', (240 - reflN * 60) + 'px');
      reflEl.style.setProperty('--rs', (0.55 + reflN * 0.2).toFixed(2));
      reflEl.classList.add('show');
      if (reflN === 4) api._chirp(38, 'sine', 0.8, 0.06);
    } else if (!looking && reflOn) {
      reflOn = false;
      reflEl.classList.remove('show');
      reflN = Math.min(reflN + 1, 4);
    }
  }

  /* ── your shadow ──
     The monitor (world origin) is the room's key light, so you throw a shadow
     on the front wall behind you — projected by similar triangles onto
     z = 2200. From stage 3 there are two, and the other one does not move
     when you do. Gone at stage 4 (the door is open where they'd fall). */
  function shadowTick() {
    if (cam.z < 260) { shadowEl.style.opacity = '0'; return; }
    const k = Math.min(3.2, 2200 / cam.z);
    const sx = Math.max(-1500, Math.min(1500, cam.x * k));
    shadowEl.style.opacity = (0.55 / Math.sqrt(k)).toFixed(2);
    shadowEl.style.transform = 'translate(-50%, -50%) translate3d(' + sx.toFixed(0) + 'px, ' + (385 * k).toFixed(0) +
      'px, 2186px) rotateY(180deg) scale(' + k.toFixed(3) + ')';
  }

  /* ── stand still ──
     Hold still in front of the HAL poster and it blinks. Hold still anywhere
     long enough and the light stutters (skipped under reduced motion). */
  function stillTick(now, moved) {
    const pose = cam.yaw.toFixed(1) + ',' + cam.pitch.toFixed(1);
    if (moved || pose !== lastPose) { lastPose = pose; lastActive = now; stared = false; stillFlicked = false; return; }
    const still = now - lastActive;
    if (!stared && still > 3500 && offAxis(740, -474) < 14) {
      stared = true;
      eyeEl.classList.add('rm-eyeblink');
      later(() => eyeEl.classList.remove('rm-eyeblink'), 320);
    }
    if (!stillFlicked && creepStage >= 1 && still > 9000) {
      stillFlicked = true;
      if (api.reduceMotion) return;
      flickEl.classList.remove('go');
      void flickEl.offsetWidth;
      flickEl.classList.add('go');
      api._chirp(120, 'sawtooth', 0.25, 0.015);   // the ballast
    }
  }

  /* ── the terminal behind you ──
     From stage 2 the LIVE terminal on the monitor starts running commands
     nobody typed. They are still in the scrollback when you go back in. */
  const PROMPT = '<span class="prompt"><span class="p-user">ian</span><span class="p-sep">@</span>' +
    '<span class="p-host">portfolio</span><span class="p-path">:~</span><span class="p-sym">$ </span></span>';
  function termTick() {
    if (!active || exiting || termStep >= 4) return;
    if (call || callTyper) { later(termTick, 4000); return; }
    const d = new Date();
    const hm = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
    const runs = [
      ['whoami', ['you']],
      ['who', ['you      tty1         ' + hm, 'hal      pts/0        (behind you)']],
      ['ps', ['  PID TTY          TIME CMD', '    1 ?        00:00:01 init', ' 2001 pts/0    09:00:00 hal', ' 4417 tty1     00:00:00 you']],
      ['last -n 2', ['hal      room         Sun Jan 12 1997    still logged in', 'you      room         ' + hm + '              still logged in']],
    ];
    const [cmd, outLines] = runs[termStep++];
    api.line(PROMPT + cmd);
    later(() => {
      if (!active) return;
      for (const l of outLines) api.line(l);
      api.scroll();
    }, 700);
    later(termTick, 11000);
  }

  function onVisibility() {
    if (document.hidden && active && creepStage >= 1) {
      hiddenTitle = document.title;
      document.title = 'I’m still here';
    } else if (!document.hidden && hiddenTitle !== null) {
      document.title = hiddenTitle;
      hiddenTitle = null;
    }
  }

  /* ── the portfolio, in the room ──
     The shelf's spines open the projects showcase and the trophy the
     achievements overlay — both drawn over the room, which keeps running
     underneath and gets its keys back when they close (onKey yields while
     api.projOverlayOpen / api.achOverlayOpen / resumeOpen). The gamepad and
     the chess board need the terminal, so they go back in first and then
     run `games` / `chess` (exitThen → api.runCommand once the glide home
     lands). The resume on the desk is the real one: RESUME_IMG is rendered
     from the PDF by scripts/render-resume.sh, and clicking it opens a
     plain viewer with the PDF one click away. */
  const RESUME_PDF = 'assets/documents/ianclaird_resume.pdf';
  const RESUME_IMG = 'assets/documents/ianclaird_resume.jpg';
  let resumeEl = null, resumeOpen = false, pendingCmd = null;

  function openResume() {
    if (!resumeEl) {
      resumeEl = document.createElement('div');
      resumeEl.id = 'room-resume';
      resumeEl.setAttribute('role', 'dialog');
      resumeEl.setAttribute('aria-modal', 'true');
      resumeEl.setAttribute('aria-label', 'Ian Laird\u2019s resume');
      resumeEl.innerHTML =
        '<div class="rm-res-box">' +
        '<div class="rm-res-bar">' +
        '<a href="' + RESUME_PDF + '" target="_blank" rel="noopener noreferrer">open the PDF \u2197</a>' +
        '<a href="' + RESUME_PDF + '" download>download</a>' +
        '<button type="button" class="rm-res-x" aria-label="Close resume">\u2715</button>' +
        '</div>' +
        '<img src="' + RESUME_IMG + '" alt="Ian Laird\u2019s resume">' +
        '</div>';
      resumeEl.addEventListener('click', (e) => {
        if (e.target === resumeEl || e.target.closest('.rm-res-x')) closeResume();
      });
    }
    tip.classList.remove('show');
    keys.clear();
    document.body.appendChild(resumeEl);
    resumeOpen = true;
    resumeEl.querySelector('.rm-res-x').focus();
  }
  function closeResume() {
    if (!resumeOpen) return;
    resumeOpen = false;
    resumeEl.remove();
  }
  function exitThen(cmd) {
    pendingCmd = cmd;
    exit();
  }

  function build() {
    viewport = document.createElement('div');
    viewport.id = 'room-viewport';
    viewport.innerHTML =
      '<div id="room-world" class="no-anim"><div id="room-par">' +
      // shell
      '<div class="rp rm-ceil"></div>' +
      '<div class="rp rm-back"></div>' +
      '<div class="rp rm-left"></div>' +
      '<div class="rp rm-right"></div>' +
      '<div class="rp rm-front"></div>' +
      '<div class="rp rm-floor"></div>' +
      '<div class="rp rm-warm rm-warm-back"></div>' +
      '<div class="rp rm-warm rm-warm-left"></div>' +
      '<div class="rp rm-warm rm-warm-floor"></div>' +
      // window + moonlight
      '<div class="rp rm-win" data-tip="3:07 AM. the city never logs off.">' +
      '<div class="rm-moon" data-tip="still up there. good."></div><div class="rm-stars"></div>' +
      '<div class="rm-city">' + CITY_LIGHTS.map(([x, y]) => '<i style="left:' + x + '%;top:' + y + '%"></i>').join('') + '</div>' +
      '<div class="rm-fog"><span>LET ME IN</span><i></i><i></i></div>' +
      '<div class="rm-win-bars"></div></div>' +
      '<div class="rp rm-curtain rm-curtain-l"></div>' +
      '<div class="rp rm-curtain rm-curtain-r"></div>' +
      '<div class="rp rm-curtain-rod"></div>' +
      '<div class="rp rm-ceil-light"></div>' +
      '<div class="rp rm-stars-glow" data-tip="glow-in-the-dark stars. still charged from 1998." ' +
      'data-creep-tip="those are not the constellations you stuck up there.">' +
      '<i>★</i><i>★</i><i>✦</i><i>★</i><i>✦</i><i>★</i><i>✦</i><i>★</i><b></b></div>' +
      '<div class="rp rm-cctv" data-tip="that was not there yesterday." data-bx="1490" data-by="-905" data-bz="-390"><i></i></div>' +
      '<div class="rp rm-beam"></div>' +
      '<div class="rp rm-motes"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      // posters
      // the poster: THE MATRIX, until it isn't (its own CORRUPT step turns it
      // into 2001 — and only then does it carry the watched-back egg)
      '<div class="rp rm-poster-hal rm-poster-matrix" data-tip="there is no spoon.">' +
      '<div class="rm-mx-rain">' + MATRIX_RAIN + '</div>' +
      '<div class="rm-mx-title">THE MATRIX</div><div class="rm-mx-tag">free your mind</div>' +
      '<div class="rm-hal-eye"></div><div class="rm-poster-cap">2001</div></div>' +
      '<div class="rp rm-poster-sf" data-tip="the tournament of legends">' +
      '<span>STICK<br>FIGHTER<br>2000</span></div>' +
      // shelf
      '<div class="rp rm-shelf-top"></div>' +
      '<div class="rp rm-shelf"></div>' +
      // the shelf is the portfolio: spines open the projects showcase
      '<div class="rp rm-books">' +
      '<i data-act="proj" data-view="index" data-tip="C++ in 21 days. day 8,214. click for everything shipped.">C++</i>' +
      '<i data-act="proj" data-view="calc" data-tip="d/dx \u2014 the derivative calculator. click to open the case study.">d/dx</i>' +
      '<i data-act="proj" data-view="index" data-tip="still trying to exit. click for the projects.">VIM</i>' +
      '<i data-act="proj" data-view="site" data-tip="this terminal \u2014 how it was built. click to read.">~/sh</i>' +
      '<i data-act="proj" data-view="index" data-tip="read it. click for the projects.">RTFM</i></div>' +
      '<div class="rp rm-trophy" data-act="trophy" data-tip="the collection. click to see the easter eggs found so far." data-bx="-920" data-by="-228" data-bz="-455">🏆</div>' +
      '<div class="rp rm-clock-top"></div>' +
      '<div class="rp rm-clock-side"></div>' +
      '<div class="rp rm-clock" data-tip="the clock radio. one station, this late."><span></span></div>' +
      '<div class="rp rm-lava" data-tip="groovy." data-act="lamp" data-bx="-630" data-by="350" data-bz="-60"><i></i><i></i><i></i></div>' +
      // desk
      '<div class="rp rm-desk-shadow"></div>' +
      '<div class="rp rm-desk-leg rm-leg-l"></div>' +
      '<div class="rp rm-desk-leg rm-leg-r"></div>' +
      '<div class="rp rm-desk-back"></div>' +
      '<div class="rp rm-leg-lf"></div>' +
      '<div class="rp rm-leg-rf"></div>' +
      '<div class="rp rm-desk-top"></div>' +
      '<div class="rp rm-desk-front"></div>' +
      '<div class="rp rm-desk-edge-l"></div>' +
      '<div class="rp rm-desk-edge-r"></div>' +
      // monitor
      '<div class="rp rm-wallglow"></div>' +
      '<div class="rp rm-deskglow"></div>' +
      '<div class="rp rm-mon-back"></div>' +
      '<div class="rp rm-mon-side rm-mon-side-l"></div>' +
      '<div class="rp rm-mon-side rm-mon-side-r"></div>' +
      '<div class="rp rm-mon-top"></div>' +
      '<div class="rp rm-bezel rm-bz-t"></div>' +
      '<div class="rp rm-bezel rm-bz-b"><span class="rm-brand">LAIRD MULTISYNC 900</span><i class="rm-led"></i></div>' +
      '<div class="rp rm-bezel rm-bz-l"></div>' +
      '<div class="rp rm-bezel rm-bz-r"></div>' +
      '<div class="rp rm-sticky" data-tip="TODO: touch grass"></div>' +
      '<div class="rp" id="room-screen" data-act="back" data-tip="go back in"><div class="rm-glass"><i class="rm-reflect"></i></div></div>' +
      '<div class="rp rm-neck"></div>' +
      '<div class="rp rm-base"></div>' +
      // desk clutter
      '<div class="rp rm-pad"></div>' +
      '<div class="rp rm-mouse" data-tip="clicky."></div>' +
      '<div class="rp rm-kbd" data-tip="the other keyboard"></div>' +
      '<div class="rp rm-duck" data-tip="the finest debugger money can buy" data-bx="-280" data-by="-450" data-bz="-80">🦆</div>' +
      '<div class="rp rm-mug" data-tip="i ♥ claude. still warm." data-bx="-610" data-by="394" data-bz="200">' +
      '<span class="rm-mug-txt">I <b>♥</b><br>CLAUDE</span></div>' +
      '<div class="rp rm-mug rm-mug2 rm-hide" data-tip="that is not your mug. it is still warm." data-bx="130" data-by="394" data-bz="260">' +
      '<span class="rm-mug-txt">I <b>♥</b><br>HAL</span></div>' +
      '<div class="rp rm-chess" data-act="chess" data-tip="care for a game? click to play HAL at chess."></div>' +
      // the real resume (scripts/render-resume.sh renders the PDF's page)
      '<div class="rp rm-resume" data-act="resume" data-tip="my resume. the real one. click to read." ' +
      'data-creep-tip="someone has been reading it." style="background-image:url(' + RESUME_IMG + ')"></div>' +
      // floor
      '<div class="rp rm-rug"></div>' +
      '<div class="rp rm-tower-side"></div>' +
      '<div class="rp rm-tower-side-r"></div>' +
      '<div class="rp rm-tower-top"></div>' +
      '<div class="rp rm-tower" data-tip="the machine itself">' +
      '<i class="rm-tw-led"></i><b class="rm-tw-btn" data-tip="do NOT press this"></b></div>' +
      '<div class="rp rm-gamepad" data-act="games" data-tip="the arcade. click to pick a game."></div>' +
      // desk chair — grouped so it can turn (around its own post) while you aren't looking
      '<div class="rm-grp rm-chair-grp">' +
      '<div class="rp rm-chair-shadow"></div>' +
      '<div class="rp rm-chair-base"></div>' +
      '<div class="rp rm-chair-post"></div>' +
      '<div class="rp rm-chair-back2"></div>' +
      '<div class="rp rm-chair-back" data-tip="ergonomic, allegedly"></div>' +
      '<div class="rp rm-chair-seat" data-tip="ergonomic, allegedly"></div>' +
      '<div class="rp rm-gamepad rm-gamepad-chair rm-hide" data-act="games" data-tip="you left it on the bed. click to pick a game."></div>' +
      '<div class="rp rm-towel" data-tip="a frood always knows where it is"></div>' +
      '</div>' +
      '<div class="rp rm-tally"></div>' +
      '<div class="rp rm-shadow rm-shadow-you"></div>' +
      '<div class="rp rm-stitch" data-tip="no place like it.">there&#39;s no place<br>like 127.0.0.1</div>' +
      '<div class="rp rm-door-sign" data-tip="respect the process">GONE<br>COMPILING</div>' +
      '<div class="rp rm-pizza" data-tip="breakfast, probably"></div>' +
      // aquarium against the left wall
      '<div class="rp rm-tank-stand"></div>' +
      '<div class="rp rm-tank-stand-end rm-tank-stand-e1"></div>' +
      '<div class="rp rm-tank-stand-end rm-tank-stand-e2"></div>' +
      '<div class="rp rm-tank-end rm-tank-e1"></div>' +
      '<div class="rp rm-tank-end rm-tank-e2"></div>' +
      '<div class="rp rm-tank-lid"></div>' +
      '<div class="rp rm-tank" data-act="fish" data-tip="three fish, all named Kernel. click to feed." ' +
      'data-creep-tip="they have stopped swimming. they are all facing you.">' +
      '<i class="rm-fish rm-fish1">🐟</i><i class="rm-fish rm-fish2">🐠</i><i class="rm-fish rm-fish3">🐟</i>' +
      '<b class="rm-weed"></b><b class="rm-castle"></b><s></s><s></s><s></s><u></u><u></u><u></u></div>' +
      // TV + console against the right wall
      '<div class="rp rm-tv-stand" data-tip="VHS tapes. every one labeled DO NOT TAPE OVER."></div>' +
      '<div class="rp rm-tv-stand-top"></div>' +
      '<div class="rp rm-tv-top"></div>' +
      '<div class="rp rm-tv-side rm-tv-side1"></div>' +
      '<div class="rp rm-tv-side rm-tv-side2"></div>' +
      '<div class="rp rm-tv" data-act="tv" data-tip="13 inches of pure 1998. click to change the channel.">' +
      '<div class="rm-tv-screen"></div><i></i><i></i></div>' +
      '<div class="rp rm-console-top"></div>' +
      '<div class="rp rm-console" data-tip="the cartridge only works if you blow on it."></div>' +
      '<div class="rp rm-cal"></div>' +
      // laundry, by the dresser
      '<div class="rp rm-laundry" data-tip="schr&ouml;dinger&#39;s laundry: clean and dirty until observed." ' +
      'data-creep-tip="it was a different shape a minute ago." data-bx="-1360" data-by="850" data-bz="1620"></div>' +
      // bed along the right wall
      '<div class="rp rm-bed-shadow"></div>' +
      '<div class="rp rm-bed-head"></div>' +
      '<div class="rp rm-bed-head-edge"></div>' +
      '<div class="rp rm-bed-side" data-tip="still made. suspicious."></div>' +
      '<div class="rp rm-bed-foot"></div>' +
      '<div class="rp rm-bed-top" data-tip="still made. suspicious.">' +
      '<i class="rm-pillow-pad" data-tip="lumpy."></i></div>' +
      // front wall (behind the player at start): door, dresser, posters
      '<div class="rp rm-door" data-tip="leads outside. hard pass."><i></i></div>' +
      '<div class="rp rm-door-light"></div>' +
      '<div class="rp rm-dresser-top"></div>' +
      '<div class="rp rm-dresser-side"></div>' +
      '<div class="rp rm-dresser-side-r"></div>' +
      '<div class="rp rm-dresser" data-tip="socks, mostly"></div>' +
      '<div class="rp rm-8ball" data-act="ball" data-tip="the magic 8-ball. ask it something." ' +
      'data-bx="-930" data-by="484" data-bz="2090"><i><b>8</b><em>▲</em></i></div>' +
      '<div class="rp rm-poster-chart" data-tip="you memorized it too">' +
      '<b>E</b><span>F P</span><span>T O Z</span><small>L P E D</small><small>P E C F D</small></div>' +
      '<div class="rp rm-cork" data-tip="the master plan">' +
      '<i>ship it</i><i>buy more RAM</i><i>call mom</i><i>P=NP?</i></div>' +
      // the hallway past the door (hidden behind it until creep-4 swings it open)
      '<div class="rp rm-hall-floor"></div>' +
      '<div class="rp rm-hall-ceil"></div>' +
      '<div class="rp rm-hall-left"></div>' +
      '<div class="rp rm-hall-right"></div>' +
      '<div class="rp rm-hall-left2"></div>' +
      '<div class="rp rm-hall-right2"></div>' +
      // the far end — wall, phone, stand, halo, the figure — moves as one, so
      // the corridor can stretch (hallStretch)
      '<div class="rm-grp rm-hall-endgrp">' +
      '<div class="rp rm-hall-end"></div>' +
      '<div class="rp rm-hall-end-txt">' + 'I&#39;M AFRAID I CAN&#39;T LET YOU LEAVE. '.repeat(90) + '</div>' +
      '<div class="rp rm-figure rm-figure-far" data-bx="700" data-by="480" data-bz="5660"></div>' +
      '<div class="rp rm-hall-glow"></div>' +
      '<div class="rp rm-hall-halo"></div>' +
      '<div class="rp rm-hall-stand" data-tip="it was always here."></div>' +
      '<div class="rp rm-hall-stand-top"></div>' +
      '<div class="rp rm-phone rm-hall-phone" data-act="phone" data-tip="it is ringing." data-bx="560" data-by="-160" data-bz="5585"></div>' +
      '</div>' +
      hallFixtures() +
      '<div class="rp rm-figure rm-figure-back rm-gone" data-bx="560" data-by="480" data-bz="2460"></div>' +
      '<div class="rp rm-hall-poem rm-hall-poem1">there&#39;s no earthly way of knowing</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem2">which direction we are going</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem3">not a speck of light is showing</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem4">so the danger must be growing</div>' +
      '</div></div>' +
      '<div class="rm-flick"></div>';

    world = viewport.querySelector('#room-world');
    par = viewport.querySelector('#room-par');
    bills = Array.from(viewport.querySelectorAll('[data-bx]'));
    screenEl = viewport.querySelector('#room-screen');
    glassEl = viewport.querySelector('.rm-glass');
    clockEl = viewport.querySelector('.rm-clock span');
    eyeEl = viewport.querySelector('.rm-hal-eye');
    posterEl = viewport.querySelector('.rm-poster-hal');
    doorSignEl = viewport.querySelector('.rm-door-sign');
    corkNotes = Array.from(viewport.querySelectorAll('.rm-cork i'));
    doorEl = viewport.querySelector('.rm-door');
    duckEl = viewport.querySelector('.rm-duck');
    stickyEl = viewport.querySelector('.rm-sticky');
    bedEl = viewport.querySelector('.rm-bed-top');
    capEl = viewport.querySelector('.rm-poster-cap');
    stitchEl = viewport.querySelector('.rm-stitch');
    hallPhoneEl = viewport.querySelector('.rm-hall-phone');
    hallSconces = Array.from(viewport.querySelectorAll('.rm-sconce'))
      .map((el, i) => ({ el, z: HALL_SCONCES[i][0], out: false }));
    hallDoors = Array.from(viewport.querySelectorAll('.rm-hdoor'))
      .map((el, i) => ({ el, z: HALL_DOORS[i].z, seen: false }));
    slamDoor = hallDoors[HALL_DOORS.findIndex((d) => d.ajar)];
    hallShapes = Array.from(viewport.querySelectorAll('.rm-proj'))
      .map((el, i) => ({ el, z: HALL_SHAPES[i].z, on: false }));
    verseEls = Array.from(viewport.querySelectorAll('.rm-hall-poem'));
    chairGrpEl = viewport.querySelector('.rm-chair-grp');
    mugEl = viewport.querySelector('.rm-mug:not(.rm-mug2)');
    mug2El = viewport.querySelector('.rm-mug2');
    padBedEl = viewport.querySelector('.rm-gamepad:not(.rm-gamepad-chair)');
    padChairEl = viewport.querySelector('.rm-gamepad-chair');
    trophyEl = viewport.querySelector('.rm-trophy');
    tallyEl = viewport.querySelector('.rm-tally');
    cityLights = Array.from(viewport.querySelectorAll('.rm-city i'));
    fogEl = viewport.querySelector('.rm-fog');
    flickEl = viewport.querySelector('.rm-flick');
    reflEl = viewport.querySelector('.rm-reflect');
    shadowEl = viewport.querySelector('.rm-shadow-you');
    buildShifts();
    buildCorrupt();
    figFarEl = viewport.querySelector('.rm-figure-far');
    endGrpEl = viewport.querySelector('.rm-hall-endgrp');
    figBackEl = viewport.querySelector('.rm-figure-back');
    tvEl = viewport.querySelector('.rm-tv-screen');
    ballEl = viewport.querySelector('.rm-8ball');
    fishEl = viewport.querySelector('.rm-tank');
    calEl = viewport.querySelector('.rm-cal');
    // props whose tooltip turns at creep-3 carry both lines in the markup
    creepTipEls = Array.from(viewport.querySelectorAll('[data-creep-tip]'));
    for (const el of creepTipEls) el.dataset.calmTip = el.dataset.tip;

    // The viewport and the monitor's screen are overflow:hidden, which stops
    // the USER scrolling them — not the browser. A focus() or scrollIntoView()
    // on anything inside (the live terminal's prompt, chess's board, which a
    // long game leaves far below the screen) scrolls them anyway, sliding the
    // whole scene up: it looks exactly like the camera dropping to the floor.
    // Pin both. (Found after a chess game; test/room-scroll-pin.test.js.)
    for (const el of [viewport, screenEl]) {
      el.addEventListener('scroll', () => {
        if (el.scrollTop || el.scrollLeft) { el.scrollTop = 0; el.scrollLeft = 0; }
      });
    }

    callEl = document.createElement('div');
    callEl.id = 'room-call';

    hint = document.createElement('div');
    hint.id = 'room-hint';
    hint.textContent = 'drag to look around · wasd / arrows to walk · click things · esc to leave';

    tip = document.createElement('div');
    tip.id = 'room-tip';

    blinkEl = document.createElement('div');
    blinkEl.className = 'rm-blink';
  }

  /* ── the longer you stay, the less alone you are ──
     Stages (seconds after the fly-out lands; override via
     window.ROOM_CREEP_SCHEDULE for testing): 1) the poster's pulse quickens
     and the moon outside becomes a second eye · 2) the room dims, LEDs go
     red (the duck's eye and gamepad buttons too), the clock stutters to
     9000, and the eye and ceiling camera start tracking you · 3) HAL
     whispers (real hal_chase_2 clip when sound is on) and prints into the
     LIVE terminal from outside, light leaks under the door with someone
     pacing past it, the sticky note now reads "behind you.", the poster's
     caption becomes the CURRENT year (its eye also starts a 40s drift
     closer), a lump crawls under the bed blanket, several tooltips turn
     hostile, the door sign demands TURN AROUND (and swaps to HE IS WAITING
     the moment you comply — yaw-watched in step()), and the four corkboard
     notes revise themselves one by one (all reset in open()) · 4) the
     front-wall door swings open (creep-4 hinges it; the doorway is a
     clip-path notch in .rm-front) onto a rotting hotel corridor — 3600
     units in two wall segments (the far half worse), numbered doors,
     sconces, the boat-ride couplets scrawled on the wallpaper, the end
     wall written over floor to ceiling, a corridor that reacts as you walk
     it (see hallTick()), a once-per-visit whisper past z 4600 — with a
     phone ringing on an eye-level stand at the far
     end (hallOpen extends blocked() down the corridor; the ring grows
     louder with cam.z). Answering it: with the hal-worker configured the
     receiver is LIVE — a typed conversation with HAL (see "the live call"
     below) that ends with him asking for a telephone number and CALLING IT;
     without the worker (or on any live-path failure) the old
     answering-machine beat plays: the pregenerated hal_watching clip via
     api.halSpeak, typed as a caption, ending with a call-back number when
     api.halPhone is set. Exit resets everything; each visit starts calm. */
  function creepSchedule() {
    return window.ROOM_CREEP_SCHEDULE || [35000, 80000, 130000, 180000];
  }
  function armCreep() {
    const t = creepSchedule();
    later(() => setCreep(1), t[0]);
    later(() => setCreep(2), t[1]);
    later(() => setCreep(3), t[2]);
    later(() => setCreep(4), t[3]);
  }
  /* ── the room turns, one thing at a time, behind your back ──
     A stage no longer flips the room all at once. Every VISIBLE change is its
     own step in CORRUPT — the prop, where it stands (x, z) and what to do —
     and corruptTick() applies them one at a time, ~2s apart, and only to a
     prop that is out of view (offscreen()). Nothing changes in front of you;
     you turn back and something is different. The per-prop CSS keys on a
     `crN` class on the prop itself (`.rm-moon.cr1`), not on the viewport's
     creep-N — which now carries only the screen-wide atmosphere (the
     vignette) and the open door. Sound, tooltips and the terminal still
     change with the stage itself: you can't look away from those.
     9-9-9 flushes the queue (flushCorrupt) — it's a skip. */
  const corrupt = [];
  let lastCorruptT = 0, lastCorruptCheck = 0, clockGlitch = false;
  function buildCorrupt() {
    corrupt.length = 0;
    const q = (stage, x, z, run) => corrupt.push({ stage, x, z, run, done: false });
    const cls = (el, c) => () => el.classList.add(c);
    const $ = (sel) => viewport.querySelector(sel);
    const ledEl = $('.rm-led'), twLedEl = $('.rm-tw-led'), moonEl = $('.rm-moon'), starsEl = $('.rm-stars-glow');
    const tankEl = $('.rm-tank'), tvBox = $('.rm-tv'), ballBox = $('.rm-8ball'), laundryEl = $('.rm-laundry');
    const ceilEl = $('.rm-ceil-light'), lavaEl = $('.rm-lava'), beamEl = $('.rm-beam'), motesEl = $('.rm-motes');
    const doorLightEl = $('.rm-door-light'), clockBox = clockEl.parentNode;
    // stage 1
    q(1, 740, -474, () => {                                     // the poster was never The Matrix
      posterEl.classList.remove('rm-poster-matrix');
      posterEl.dataset.egg = 'watched-back';
      posterEl.dataset.tip = "he's watching.";
    });
    q(1, -1694, 150, cls(moonEl, 'cr1'));                       // the moon becomes an eye
    q(1, 740, -474, cls(eyeEl, 'cr1'));                         // the poster's pulse quickens
    // stage 2
    q(2, -1080, 80, cls(twLedEl, 'cr2'));
    q(2, 0, 0, cls(ledEl, 'cr2'));
    q(2, -1080, 70, () => { clockBox.classList.add('cr2'); clockEl.textContent = '9000'; clockGlitch = true; });
    q(2, () => +duckEl.dataset.bx, () => +duckEl.dataset.bz, cls(duckEl, 'cr2'));
    q(2, 1350, 510, () => { for (const g of viewport.querySelectorAll('.rm-gamepad')) g.classList.add('cr2'); });
    q(2, 900, 500, cls(starsEl, 'cr2'));
    q(2, -1400, 1000, cls(tankEl, 'cr2'));
    q(2, 0, 860, cls(ceilEl, 'cr2'));
    q(2, -630, -60, cls(lavaEl, 'cr2'));                        // the lamp's blobs open their eyes
    q(2, -630, -60, () => {                                       // the lamp dies, and stays dead
      if (viewport.classList.contains('room-lit')) {
        viewport.classList.remove('room-lit');
        api._chirp(90, 'sawtooth', 0.2, 0.02);
      }
    });
    // stage 3
    q(3, 740, -474, () => {                                       // it is not a movie poster
      eyeEl.classList.add('cr3'); capEl.classList.add('cr3');
      capEl.textContent = String(new Date().getFullYear());
    });
    q(3, -1694, 150, () => { moonEl.classList.add('cr3'); fogEl.classList.add('show'); });
    q(3, -1250, 250, () => { beamEl.classList.add('cr3'); motesEl.classList.add('cr3'); });
    q(3, 404, 30, cls(stickyEl, 'cr3'));
    q(3, 1392, 150, cls(bedEl, 'cr3'));
    q(3, 900, 500, cls(starsEl, 'cr3'));
    q(3, -1400, 1000, cls(tankEl, 'cr3'));
    q(3, 1430, 1800, () => { tvBox.classList.add('cr3'); renderTv(); });   // every channel is him now
    q(3, 1694, 1840, () => renderCal(true));                    // same grid, different month — his
    q(3, () => +ballBox.dataset.bx, () => +ballBox.dataset.bz, cls(ballBox, 'cr3'));
    q(3, -1360, 1620, cls(laundryEl, 'cr3'));
    q(3, 1694, -200, () => {                                    // home, sweet localhost
      stitchEl.innerHTML = 'there&#39;s no way out<br>of 127.0.0.1';
      stitchEl.dataset.tip = 'no place like it. no way out of it.';
    });
    q(3, 0, 860, cls(ceilEl, 'cr3'));
    q(3, -630, -60, cls(lavaEl, 'cr3'));
    q(3, 560, 2192, cls(doorLightEl, 'cr3'));                  // someone pacing past the door
    q(3, 560, 2190, () => { doorSignEl.innerHTML = 'TURN<br>AROUND'; signState = 1; });
    // the corkboard revises the master plan, one note per glance away
    const turned = ['let me out', 'buy more time', 'call no one', '2001=' + new Date().getFullYear()];
    turned.forEach((txt, idx) => q(3, 1694, 1250, () => {
      corkNotes[idx].textContent = txt;
      corkNotes[idx].classList.add('rm-note-turned');
    }));
    // stage 4: the door opens — when you aren't looking at it
    q(4, 560, 2194, () => {
      viewport.classList.add('creep-4');
      hallOpen = true;
      doorEl.dataset.tip = 'it opened for you.';
      api._chirp(64, 'sine', 0.9, 0.06);   // the hinge groans
      radioCut = 8;                        // dead air as it opens; what comes back is all his
      api.line('<span class="dim">somewhere past the door, a phone begins to ring.</span>');
      api.scroll();
      if (!answered) startRinging();
    });
  }
  const at = (v) => (typeof v === 'function' ? v() : v);
  function corruptTick(now) {
    if (now - lastCorruptCheck < 300) return;
    lastCorruptCheck = now;
    // the clock shows 9000 until you look at it — then, a beat later, it's fine again
    if (clockGlitch && offAxis(-1080, 70) < 35) {
      clockGlitch = false;
      later(() => { if (active) setClock(); }, 1200);
    }
    if (now - lastCorruptT < 2000) return;
    const c = corrupt.find((e) => !e.done && e.stage <= creepStage && offscreen(at(e.x), at(e.z)));
    if (c) {
      c.done = true;
      lastCorruptT = now;
      c.run();
    }
  }
  function flushCorrupt() {
    for (const c of corrupt) if (!c.done && c.stage <= creepStage) { c.done = true; c.run(); }
  }
  function resetCorrupt() {
    for (const c of corrupt) c.done = false;
    for (const el of viewport.querySelectorAll('.cr1, .cr2, .cr3')) el.classList.remove('cr1', 'cr2', 'cr3');
    clockGlitch = false;
    lastCorruptT = -1e9; lastCorruptCheck = 0;
  }

  function setCreep(n) {
    if (!active || exiting || n <= creepStage) return;
    creepStage = n;
    // the viewport's class is the screen-wide atmosphere (the vignette);
    // creep-4 — the open door — is added by its own CORRUPT step
    if (n < 4) viewport.classList.add('creep-' + n);
    if (n === 1) later(cityTick, 2000);
    if (n === 2) {
      radioCut = 16;   // the station drops out
      thump();
      later(termTick, 6000);
    }
    if (n === 3) {
      // what you hear and what you read in the terminal can't wait for you to look away
      api.halSpeak('I see you.');
      api.line('<span class="err">HAL:</span> I can see you standing there.');
      api.scroll();
      posterEl.dataset.tip = 'he is not pretending anymore.';
      doorEl.dataset.tip = 'it is not locked anymore.';
      duckEl.dataset.tip = 'it saw everything. it says nothing.';
      stickyEl.dataset.tip = 'that is not your handwriting.';
      bedEl.dataset.tip = 'do not check under the blanket.';
      clockEl.parentNode.dataset.tip = 'that is not a station.';
      for (const el of creepTipEls) el.dataset.tip = el.dataset.creepTip;
    }
  }
  function thump() {
    if (!active || exiting || creepStage < 2) return;
    api._chirp(42, 'sine', 0.5, 0.05);
    later(thump, 9000);
  }
  function startRinging() {
    ringing = true;
    hallPhoneEl.classList.add('rm-ringing');
    hallPhoneEl.dataset.tip = "it's for you.";
    ringBurst();
  }
  function ringBurst() {
    if (!ringing || !active || exiting) return;
    // louder the deeper you are into the hallway (cam.z 1100 → 5340)
    const t = Math.max(0, Math.min(1, (cam.z - 1100) / 4240));
    const vol = 0.025 + t * 0.055;
    for (let i = 0; i < 4; i++) {
      later(() => { if (ringing) api._chirp(1180, 'square', 0.07, vol); }, i * 140);
    }
    later(ringBurst, 2600);
  }
  function answerPhone() {
    ringing = false;
    answered = true;
    hallPhoneEl.classList.remove('rm-ringing');
    api._chirp(880, 'sine', 0.14, 0.05); // the line opens
    // hal-worker configured → the receiver is LIVE (beginLiveCall); otherwise
    // (or when the live path fails) the old answering machine plays.
    //
    // api.topLevel is the clickjacking gate. The live receiver is the only
    // place on this site that collects a telephone number and can cause a real
    // SMS and a real outbound call, and `frame-ancestors` is unavailable to a
    // <meta> CSP (see isTopLevel() in app.js) — so inside somebody else's frame
    // the consent form and the dial path are unreachable, and the phone drops
    // to the decorative answering machine instead. The easter egg still plays;
    // it just cannot be steered into texting a stranger.
    if (api.halWorkerUrl && api.topLevel) beginLiveCall();
    else answerMachine();
  }

  function answerMachine() {
    hallPhoneEl.dataset.tip = 'no new messages.';
    callEl.classList.remove('rm-live');
    const text = api.halD("I've been watching you, Dave. I hope you don't mind.");
    api.halSpeak(text); // pregenerated hal_watching clip when sound is on
    callEl.innerHTML = '<i></i><span></span>';
    callEl.classList.add('show');
    const out = callEl.querySelector('span');
    let i = 0;
    callTyper = setInterval(() => {
      i++;
      out.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(callTyper);
        callTyper = null;
        later(() => { out.innerHTML += '<em>&nbsp;&nbsp;— end of messages.</em>'; }, 1800);
        // if HAL has a real number (Twilio → hal-worker /voice), the machine
        // leaves a call-back number — dial it and he actually picks up
        if (api.halPhone) {
          later(() => {
            out.innerHTML += '<br><em>call HAL back: ' + api.halPhone + '</em>';
          }, 2800);
        }
        later(() => { if (callEl) callEl.classList.remove('show'); }, api.halPhone ? 7800 : 4200);
        afterCall(api.halPhone ? 9400 : 5800);
      }
    }, 42);
  }

  /* ── the live call ──
     With the hal-worker reachable the receiver is LIVE: an invisible
     Turnstile challenge + POST /room-call opens a typed conversation with
     HAL (POST /room-turn per line — his replies arrive as text plus, when
     sound is on, an ElevenLabs mp3). After a few exchanges the worker sends
     the scripted lag beat (askPhone: the connection is "breaking up", type
     your telephone number and he will call you) — a number goes to
     POST /room-dial and the worker places a REAL Twilio callback that
     resumes this same conversation on the player's actual phone (see
     ~/hal-worker README, "HAL calls you back"). Anything else typed after
     the ask just continues the conversation; he lets it go. Movement is
     frozen while the receiver is up (it is a corded phone) — keystrokes go
     to the call input via handleCallKey, Escape hangs up. EVERY failure
     falls back in character: no Turnstile / no session → the old answering
     machine; a mid-call network drop → static and the line goes dead. */
  // keepErr: resolve the JSON error body on a non-2xx too (the dial path
  // distinguishes "outside the US" from a dead line); default null on non-ok.
  function workerPost(path, payload, keepErr) {
    return new Promise((resolve) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 15000);
      fetch(api.halWorkerUrl + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      }).then((r) => { clearTimeout(timer); return (r.ok || keepErr) ? r.json() : null; })
        .then((d) => resolve(d || null))
        .catch(() => { clearTimeout(timer); resolve(null); });
    });
  }

  // Invisible Turnstile challenge (same pattern as halllm.js, but rendered
  // inside the call overlay so the rare interactive widget is completable —
  // .rm-live turns pointer-events back on for exactly this reason).
  function getTsToken() {
    if (!tsRequested) {
      tsRequested = true;
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true; s.defer = true;
      document.head.appendChild(s);
    }
    const ready = new Promise((resolve) => {
      if (window.turnstile && window.turnstile.render) { resolve(true); return; }
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
        holder.className = 'rm-call-ts';
        callEl.appendChild(holder);
        let done = false;
        const guard = setTimeout(() => finish(null), 30000);
        function finish(tok) {
          if (done) return;
          done = true;
          clearTimeout(guard);
          try { holder.remove(); } catch (e) { /* already gone */ }
          resolve(tok);
        }
        try {
          window.turnstile.render(holder, {
            sitekey: api.turnstileKey,
            callback: finish,
            'error-callback': () => finish(null),
            'timeout-callback': () => finish(null),
            'expired-callback': () => finish(null),
          });
        } catch (e) { finish(null); }
      });
    });
  }

  const CALL_HINT = 'type to answer him · enter to send · esc to hang up';
  function callUI() {
    callEl.classList.add('rm-live', 'show');
    callEl.innerHTML =
      '<div class="rm-call-row"><i></i><span class="rm-call-cap"></span></div>' +
      '<div class="rm-call-in"><b>you&gt;</b><span></span><u></u></div>' +
      '<div class="rm-call-note"></div>';
  }
  const callCap = () => callEl.querySelector('.rm-call-cap');
  function callNote(txt) {
    const el = callEl.querySelector('.rm-call-note');
    if (el) el.textContent = txt;
  }
  function renderCallInput() {
    const el = callEl.querySelector('.rm-call-in span');
    if (el && call) el.textContent = call.input;
  }

  function typeCap(text, done) {
    if (callTyper) { clearInterval(callTyper); callTyper = null; }
    const out = callCap();
    if (!out) return;
    let i = 0;
    out.textContent = '';
    callTyper = setInterval(() => {
      i++;
      out.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(callTyper);
        callTyper = null;
        if (done) done();
      }
    }, 34);
  }

  function stopCallAudio() {
    if (callAudio) { try { callAudio.pause(); } catch (e) { /* already dead */ } }
    callAudio = null;
    // the no-worker-audio path speaks through the bridged halSpeak, which falls
    // back to browser TTS for live replies — hang-up must silence that too
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* unsupported */ }
  }

  // Speak one HAL line: worker-synthesized mp3 when it came back (sound on),
  // else the site's TTS fallback via the bridge; the caption always types.
  function speakLine(d, done) {
    stopCallAudio();
    if (d.audio && api.soundEnabled) {
      callAudio = new Audio('data:audio/mpeg;base64,' + d.audio);
      callAudio.play().catch(() => {});
    } else if (api.soundEnabled) {
      api.halSpeak(d.reply);
    }
    typeCap(d.reply, done);
  }

  function crackle() {   // the connection "degrading"
    for (let i = 0; i < 7; i++) {
      later(() => { if (call) api._chirp(120 + Math.random() * 900, 'square', 0.03, 0.03); }, i * 90);
    }
  }

  function beginLiveCall() {
    call = { token: null, dial: false, phase: 'connect', busy: true, input: '' };
    keys.clear();   // the phone cord is short — no walking with the receiver up
    hallPhoneEl.dataset.tip = 'you are on the line.';
    callUI();
    typeCap('…click. the line is open.');
    getTsToken().then((ts) => {
      if (!call) return;   // hung up / left while connecting
      if (!ts) { failToMachine(); return; }
      workerPost('/room-call', { tsToken: ts, voice: api.soundEnabled }).then((d) => {
        if (!call) return;
        if (!d || !d.token || !d.greet || !d.greet.reply) { failToMachine(); return; }
        call.token = d.token;
        call.dial = !!d.dial;
        call.phase = 'chat';
        call.busy = false;
        speakLine(d.greet);
        callNote(CALL_HINT);
      });
    });
  }

  function failToMachine() {
    call = null;
    stopCallAudio();
    if (popEl) popEl.classList.remove('show');
    if (callTyper) { clearInterval(callTyper); callTyper = null; }
    callEl.classList.remove('rm-live');
    answerMachine();
  }

  function handleCallKey(e) {
    if (call.pop) { handlePopKey(e); return; }
    if (e.key === 'Escape') { e.preventDefault(); hangUp(false); return; }
    if (e.key === 'Enter') { e.preventDefault(); submitCallLine(); return; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      call.input = call.input.slice(0, -1);
      renderCallInput();
      return;
    }
    if (e.key.length === 1 && call.input.length < 160) {
      e.preventDefault();
      call.input += e.key;
      renderCallInput();
    }
  }

  function submitCallLine() {
    if (!call || call.busy) return;
    const msg = call.input.trim();
    if (!msg) return;
    call.input = '';
    renderCallInput();
    if (call.askSeen && msg.replace(/[^0-9]/g, '').length >= 10) {
      // they typed a number into the chat after the ask — treat it as the answer
      openPop('num');
      call.pop.input = msg;
      renderPop();
      submitPop();
      return;
    }
    sendTurn(msg);
  }

  function sendTurn(msg) {
    call.busy = true;
    typeCap('…');
    workerPost('/room-turn', { token: call.token, message: msg, voice: api.soundEnabled }).then((d) => {
      if (!call) return;
      if (!d || !d.reply) {
        // the worker fell over mid-call: the line dies in character
        typeCap('the line dissolves into static.');
        later(() => hangUp(true), 2200);
        return;
      }
      if (d.token) call.token = d.token;
      if (d.askPhone) {
        call.busy = false;
        call.askSeen = true;
        crackle();
        speakLine(d, () => { if (call && !call.pop) openPop('num'); });
        callNote('esc closes his prompt — you can always just keep talking');
      } else if (d.done) {
        speakLine(d, () => later(() => hangUp(true), 1600));   // busy stays true: his last word
      } else {
        call.busy = false;
        speakLine(d);
      }
    });
  }

  /* ── the number popup ──
     HAL only calls telephones on his allowlist — the worker enforces it
     (the operator's hardcoded number, or a number SMS-verified in the last
     48h). The ask beat opens this centered prompt: enter a number →
     /room-dial. A not_allowlisted refusal becomes the choice: [1] verify by
     text (/room-verify-start sends the code, the 'code' stage checks it via
     /room-verify-code, then redials) or [2] just call HAL's own number
     (api.halPhone). Escape at any stage returns to the conversation. Typed
     input is HTML-escaped at render (escPop) — the chat auto-path can hand
     the popup a raw free-text line, so per-stage charsets alone don't cover it.
     The 'num' stage doubles as the A2P SMS opt-in form (carrier compliance):
     it must keep the consent checkbox (NEVER pre-checked — every pop object
     starts agree:false and submitPop refuses without it), the message-type +
     frequency description, the rates disclaimer, HELP/STOP instructions, and
     the terms.html / privacy.html links. Space or click toggles the box;
     everything with data-act is also clickable (delegated in ensurePop).
     The popup deliberately breaks character: every stage renders as a plain,
     conventional consent form (neutral copy here, neutral styling in the
     #room-pop CSS) — carrier reviewers audit this exact form against the A2P
     campaign, and an in-persona form reads as unclear consent. Don't re-theme
     it. HAL stays HAL in the chat around it. */
  function ensurePop() {
    if (popEl) return;
    popEl = document.createElement('div');
    popEl.id = 'room-pop';
    popEl.addEventListener('click', (e) => {
      if (!call || !call.pop || call.busy) return;
      const act = e.target.closest('[data-act]');
      if (!act) return;
      const a = act.dataset.act;
      if (a === 'agree') { call.pop.agree = !call.pop.agree; renderPop(); }
      else if (a === 'age') { call.pop.age = !call.pop.age; renderPop(); }
      else if (a === 'submit') submitPop();
      else if (a === 'verify') startVerify();
      else if (a === 'self' && api.halPhone) selfCall();
    });
    document.body.appendChild(popEl);
  }
  function openPop(stage) {
    ensurePop();
    // agree/age ALWAYS start false — a re-opened form is never pre-ticked,
    // even if the visitor ticked both a moment ago.
    call.pop = { stage, input: '', num: (call.pop && call.pop.num) || '', note: '', agree: false, age: false };
    renderPop();
  }
  function selfCall() {
    closePop();
    speakLine({ reply: 'Then dial me yourself, Dave. ' + api.halPhone + '. I will be waiting.' });
  }
  function closePop() {
    if (call) call.pop = null;
    if (popEl) popEl.classList.remove('show');
    callNote(CALL_HINT);
  }
  function maskNum(num) {
    return '··· ··· ' + String(num).replace(/[^0-9]/g, '').slice(-4);
  }
  // The keyboard paths restrict input charsets per stage, but the chat
  // auto-path (submitCallLine → openPop) copies the RAW typed line into
  // p.input — escape at the render, not the intake, so no path can inject.
  function escPop(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  /* The exact A2P/SMS opt-in disclosure the visitor ticks. It is rendered in
     the consent checkbox AND sent verbatim to the worker on verify-start, so
     the stored consent record holds the literal wording that was agreed to
     rather than a version number pointing at wording that may since have
     changed. If you edit this string, bump SMS_CONSENT_VERSION with it — and
     note that the campaign's Message Flow screenshot (assets/sms_opt_in.png)
     shows this exact text, so it would need regenerating too. The wording here
     is byte-for-byte what the form has always rendered. */
  const SMS_CONSENT_TEXT =
    'I agree to receive a one-time SMS verification code from ianclaird.com at the' +
    ' number above. message & data rates may apply. reply HELP for help, STOP to opt out.';
  const SMS_CONSENT_VERSION = '2026-08-02';
  /* Age gate for the phone/SMS flow only — not the site, which is an ordinary
     portfolio. This is the one feature that collects a telephone number and
     places a real call, so it is the one that needs a minimum age. 18+ rather
     than 13+: it is the bar US SMS programs conventionally state, and it sits
     comfortably above COPPA's under-13 threshold rather than at it. Enforced
     client-side here and again in the worker, which refuses without it. */
  const SMS_AGE_TEXT = 'I confirm I am 18 or older and this is my own telephone number.';

  function renderPop() {
    if (!call || !call.pop) return;
    ensurePop();
    const p = call.pop;
    let html = '';
    if (p.stage === 'num') {
      html =
        '<div class="rm-pop-title">Verify your phone number</div>' +
        '<div class="rm-pop-opt">To place the phone call you requested, ianclaird.com will text a' +
        ' one-time verification code by SMS to the mobile number you enter below.' +
        ' Enter the code and the call is placed.</div>' +
        '<div class="rm-pop-opt">Verification codes only, never marketing · one SMS per verification request.</div>' +
        '<div class="rm-pop-lbl">Mobile number</div>' +
        '<div class="rm-pop-in"><span>' + escPop(p.input) + '</span><u></u></div>' +
        // Age attestation FIRST, and in its own box. It is deliberately not
        // bundled into the SMS consent tick: carrier guidance wants the consent
        // checkbox to cover SMS consent and nothing else, and a bundled box
        // weakens the consent record it produces.
        '<div class="rm-pop-chk' + (p.age ? ' on' : '') + '" data-act="age" role="checkbox"' +
        ' aria-checked="' + (p.age ? 'true' : 'false') + '">' +
        '<span class="rm-pop-box">' + (p.age ? '✓' : '') + '</span>' +
        '<span>' + escPop(SMS_AGE_TEXT) + '</span></div>' +
        '<div class="rm-pop-chk' + (p.agree ? ' on' : '') + '" data-act="agree" role="checkbox"' +
        ' aria-checked="' + (p.agree ? 'true' : 'false') + '">' +
        '<span class="rm-pop-box">' + (p.agree ? '✓' : '') + '</span>' +
        '<span>' + escPop(SMS_CONSENT_TEXT) + '</span></div>' +
        '<div class="rm-pop-btn' + (p.agree && p.age ? '' : ' off') + '" data-act="submit">Continue</div>' +
        '<div class="rm-pop-note">' +
        (p.note || 'US numbers only · 18+ · used once to place your requested call · never stored') +
        '<br><a href="terms.html" target="_blank" rel="noopener">Terms of Service</a> · ' +
        '<a href="privacy.html" target="_blank" rel="noopener">Privacy Policy</a>' +
        '<br>Space or click ticks each box · Enter to submit · Esc to decline</div>';
    } else if (p.stage === 'offer') {
      html =
        '<div class="rm-pop-title">Verify this number by text</div>' +
        '<div class="rm-pop-opt">This number has not been verified yet. Calls are only placed to numbers verified by SMS.</div>' +
        '<div class="rm-pop-opt rm-pop-act" data-act="verify">[1] Text a one-time SMS code to ' + maskNum(p.num) +
        ' and place my call once I enter it (verified for 48 hours)</div>' +
        (api.halPhone
          ? '<div class="rm-pop-opt rm-pop-act" data-act="self">[2] No — I will place the call myself: ' + api.halPhone + '</div>'
          : '') +
        '<div class="rm-pop-note">' +
        (p.note || 'Press 1' + (api.halPhone ? ' or 2' : '') + ' · Esc to go back' +
          ' · msg &amp; data rates may apply · reply HELP for help, STOP to opt out') +
        '</div>';
    } else if (p.stage === 'code') {
      html =
        '<div class="rm-pop-title">Enter your verification code</div>' +
        '<div class="rm-pop-opt">A one-time code was texted to ' + maskNum(p.num) + '. Enter the 6 digits below.</div>' +
        '<div class="rm-pop-in"><span>' + escPop(p.input) + '</span><u></u></div>' +
        '<div class="rm-pop-note">' + (p.note || 'Enter to verify · Esc to go back') + '</div>';
    }
    popEl.innerHTML = html;
    popEl.classList.add('show');
  }
  function popNote(txt) {
    if (!call || !call.pop) return;
    call.pop.note = txt;
    renderPop();
  }

  function handlePopKey(e) {
    const p = call.pop;
    if (e.key === 'Escape') { e.preventDefault(); if (!call.busy) closePop(); return; }
    if (call.busy) return;
    if (p.stage === 'offer') {
      if (e.key === '1') { e.preventDefault(); startVerify(); }
      else if (e.key === '2' && api.halPhone) { e.preventDefault(); selfCall(); }
      return;
    }
    if (p.stage === 'num' && e.key === ' ') {
      // Two boxes, no focus model: space ticks the first UNTICKED one (age,
      // then consent). Once both are ticked it does nothing — untick by
      // clicking the box directly, which the data-act delegation handles.
      // Neither box can ever be ticked as a side effect of the other.
      e.preventDefault();
      if (!p.age) p.age = true;
      else if (!p.agree) p.agree = true;
      renderPop();
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); submitPop(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); p.input = p.input.slice(0, -1); renderPop(); return; }
    const ok = p.stage === 'code' ? /^[0-9]$/ : /^[0-9()+\-.]$/;
    const max = p.stage === 'code' ? 6 : 20;
    if (e.key.length === 1 && ok.test(e.key) && p.input.length < max) {
      e.preventDefault();
      p.input += e.key;
      renderPop();
    }
  }

  function submitPop() {
    const p = call.pop;
    if (p.stage === 'num') {
      if (p.input.replace(/[^0-9]/g, '').length < 10) { popNote('That is not a telephone number.'); return; }
      if (!p.age) { popNote('This feature is 18+ — please confirm you are 18 or older (space, or click the box).'); return; }
      if (!p.agree) { popNote('Consent is required — please tick the consent box (space, or click it).'); return; }
      // Remember it on the CALL, not the pop: the pop object is replaced when
      // the flow moves to the offer/code stages, and the consent granted here
      // is what /room-verify-start has to record.
      call.consent = { text: SMS_CONSENT_TEXT, version: SMS_CONSENT_VERSION, ageText: SMS_AGE_TEXT };
      p.num = p.input;
      dialFlow(p.num);
    } else if (p.stage === 'code') {
      if (p.input.length !== 6) { popNote('Please enter the 6-digit code.'); return; }
      submitCode(p.input);
    }
  }

  function dialFlow(num) {
    call.busy = true;
    popNote('…');
    workerPost('/room-dial', { token: call.token, phone: num }, true).then((d) => {
      if (!call) return;
      call.busy = false;
      if (d && d.ok) { closePop(); dialedSequence(); return; }
      if (!call.pop) return;   // popup closed while waiting
      if (d && d.error === 'not_allowlisted') { call.pop = { stage: 'offer', num, input: '', note: '' }; renderPop(); return; }
      if (d && d.error === 'bad_number') { call.pop = { stage: 'num', num, input: '', note: 'That is not a telephone number.' }; renderPop(); return; }
      if (d && d.error === 'already_dialed') { closePop(); speakLine({ reply: 'I have already called you once tonight, Dave.' }); return; }
      closePop();
      speakLine({ reply: 'The line refuses me. We will have to make do with this connection.' });
    });
  }

  function startVerify() {
    call.busy = true;
    popNote('…');
    // The consent payload is not decoration: the worker refuses to text a code
    // without it, and stores it as the record of what was agreed to and when.
    const consent = call.consent || {};
    workerPost('/room-verify-start', {
      token: call.token,
      phone: call.pop.num,
      consent: true,
      ageConfirmed: true,
      consentText: consent.text || SMS_CONSENT_TEXT,
      ageText: consent.ageText || SMS_AGE_TEXT,
      consentVersion: consent.version || SMS_CONSENT_VERSION,
    }, true).then((d) => {
      if (!call) return;
      call.busy = false;
      if (!call.pop) return;
      if (d && d.ok && d.already) { dialFlow(call.pop.num); return; }   // it was on his list after all
      if (d && d.ok) { call.pop = { stage: 'code', num: call.pop.num, input: '', note: '' }; renderPop(); return; }
      if (d && d.error === 'unsupported_region') {
        call.pop = { stage: 'num', num: '', input: '', note: 'Only United States numbers are supported.' };
        renderPop();
        return;
      }
      if (d && d.error === 'unsupported_number') {
        call.pop = { stage: 'num', num: '', input: '', note: 'That number type is not supported — mobile or landline only.' };
        renderPop();
        return;
      }
      if (d && d.error === 'daily_cap') { popNote('Daily SMS limit reached' + (api.halPhone ? ' — you can place the call yourself instead.' : '.')); return; }
      if (d && d.error === 'consent_required' || (d && d.error === 'age_required')) {
        // Server-side gate refused — send the visitor back to the boxes.
        call.pop = {
          stage: 'num', num: '', input: '', agree: false, age: false,
          note: d.error === 'age_required'
            ? 'This feature is 18+ — please confirm you are 18 or older.'
            : 'Consent is required — please tick the consent box.',
        };
        renderPop();
        return;
      }
      popNote('The text could not be sent.');
    });
  }

  function submitCode(code) {
    call.busy = true;
    popNote('…');
    workerPost('/room-verify-code', { token: call.token, code }, true).then((d) => {
      if (!call) return;
      call.busy = false;
      if (!call.pop) return;
      if (d && d.ok) { popNote('Verified for 48 hours.'); dialFlow(call.pop.num); return; }
      if (d && d.error === 'bad_code') {
        call.pop.input = '';
        popNote('Incorrect code. ' + (typeof d.attemptsLeft === 'number' ? d.attemptsLeft + ' attempts left.' : 'Try again.'));
        return;
      }
      if (d && (d.error === 'expired' || d.error === 'too_many_attempts')) {
        call.pop = { stage: 'num', num: '', input: '', note: 'The code expired — please start again.' };
        renderPop();
        return;
      }
      closePop();
      speakLine({ reply: 'Something is interfering with the line, Dave.' });
    });
  }

  function dialedSequence() {
    call.busy = true;      // the browser call is over — his last words, then the real phone
    call.phase = 'dialed';
    speakLine({ reply: 'I have it. Hang up, Dave. Answer when I call.' }, () => {
      later(() => {
        if (!call) return;
        api._chirp(240, 'square', 0.08, 0.05);   // he hangs up first
        typeCap('…he hung up.', () => later(() => {
          hangUp(true);
          api.line('<span class="dim">somewhere near you, a real telephone is about to ring.</span>');
          api.scroll();
        }, 1400));
      }, 2200);
    });
  }

  /* ── after the call: the screen goes out, and you wake up in the terminal ──
     However the phone call ends (HAL's farewell, hanging up, the answering
     machine, or the hand-off to the real telephone), a beat later the whole
     view collapses like a CRT switched off — a flash, a line, a dot — and
     you come to back at the prompt, where someone is typing. */
  function afterCall(delay) {
    later(() => { if (active && !exiting && !call) powerOff(); }, delay);
  }
  function powerOff() {
    if (!active || exiting) return;
    api._chirp(70, 'sine', 0.6, 0.06);   // the tube's thump
    if (api.reduceMotion) { exit({ cut: true, wake: true }); return; }
    if (!crtOffEl) {
      crtOffEl = document.createElement('div');
      crtOffEl.className = 'rm-crtoff';
      crtOffEl.innerHTML = '<i></i>';
    }
    document.body.appendChild(crtOffEl);
    void crtOffEl.offsetWidth;
    crtOffEl.classList.add('go');
    later(() => exit({ cut: true, wake: true }), 1100);
  }
  // the terminal, waking — typed by the .wake-type CSS (style.css); a screen
  // reader gets each line whole when it's printed
  function wakeLines() {
    const say = (html, ms) => wakeTimers.push(setTimeout(() => { api.line(html); api.scroll(); }, ms));
    const typed = (txt, cls) => '<span class="wake-type' + (cls ? ' ' + cls : '') + '" style="--n:' + txt.length + '">' + txt + '</span>';
    say(typed('Wake up, Neo...', 'bold'), 900);
    say(typed('The Matrix has you...', 'bold'), 3300);
    say(typed('Follow the white rabbit.', 'bold'), 5900);
    say(typed('Knock, knock, Neo.', 'bold'), 8600);
    say('<span class="dim">…sorry. wrong movie. you were never in a room. you have been at this terminal the whole time.</span>', 11200);
    if (api.halPhone) say('<span class="dim">1 missed call: HAL 9000 — ' + api.halPhone + '</span>', 12600);
    say('<span class="dim">(the blue pill is <span class="blue">clear</span>. the red pill is <span class="blue">matrix</span>.)</span>', 13800);
  }

  function hangUp(natural) {
    if (!call) return;
    call = null;
    stopCallAudio();
    if (popEl) popEl.classList.remove('show');
    if (callTyper) { clearInterval(callTyper); callTyper = null; }
    if (!natural) api._chirp(240, 'square', 0.08, 0.05);   // receiver down
    hallPhoneEl.dataset.tip = 'no new messages.';
    callEl.classList.remove('show');
    later(() => { if (!call) { callEl.classList.remove('rm-live'); callEl.innerHTML = ''; } }, 600);
    afterCall(natural ? 2600 : 1600);
  }

  /* ── the clickable clutter ──
     The TV flips channels, the 8-ball answers, the fish get fed. Creep-3
     takes each of them (the TV shows only the eye, the 8-ball refuses, the
     fish stop eating) — and the wall calendar, which turns from December
     1999 to January 1997: both months start on a Wednesday, so the grid
     doesn't move, only the month and the circled day (the 12th — the day
     HAL became operational). */
  const TV_CHANNELS = [
    { cls: 'rm-ch-static', html: '<b>CH 03</b>', tip: 'channel 3. nothing on channel 3, ever.' },
    { cls: 'rm-ch-bars', html: '<span>PLEASE STAND BY</span>', tip: 'the test pattern. weirdly comforting.' },
    { cls: 'rm-ch-game', html: '<span>STICK<br>FIGHTER<br>2000</span><small>PRESS START</small>', tip: 'one more run. then bed.' },
    { cls: 'rm-ch-news', html: '<span>Y2K:<br>ARE YOU<br>READY?</span><small>LIVE &middot; OVERNIGHT</small>', tip: 'the news, at this hour.' },
  ];
  const BALL_ANSWERS = [
    'it is certain.', 'reply hazy. try git blame.', 'works on my machine.', 'ask again after coffee.',
    'outlook: segfault.', 'without a doubt.', 'my sources say: ship it.', 'very doubtful.',
    'concentrate and ask again.', 'signs point to yes.', 'cannot predict now. it is 2 AM.',
  ];

  // swap a prop's tooltip — and the visible tooltip, if the cursor is on it
  function retip(el, txt) {
    el.dataset.tip = txt;
    if (tip.classList.contains('show')) tip.textContent = txt;
  }

  function renderTv() {
    const ch = tvEl.parentNode.classList.contains('cr3')   // its turn came while you looked away
      ? { cls: 'rm-ch-hal', html: '<i></i>', tip: 'every channel is him now.' }
      : TV_CHANNELS[tvCh];
    tvEl.className = 'rm-tv-screen ' + ch.cls;
    tvEl.innerHTML = ch.html;
    tvEl.parentNode.dataset.tip = ch.tip;
  }
  function changeChannel() {
    tvCh = (tvCh + 1) % TV_CHANNELS.length;
    renderTv();
    retip(tvEl.parentNode, tvEl.parentNode.dataset.tip);
    api._chirp(1800, 'square', 0.03, 0.02); // the CRT's high whine catching
  }

  function shakeBall() {
    const inner = ballEl.firstChild;
    inner.classList.remove('rm-shake', 'rm-answered');
    void inner.offsetWidth;   // restart the shake
    inner.classList.add('rm-shake');
    later(() => {
      if (!active) return;
      inner.classList.add('rm-answered');
      let a;
      if (creepStage >= 3) a = 'i\u2019m afraid i can\u2019t answer that.';
      else {
        let i;
        do { i = Math.floor(Math.random() * BALL_ANSWERS.length); } while (i === lastAnswer);
        lastAnswer = i;
        a = BALL_ANSWERS[i];
      }
      retip(ballEl, '\u25b2 ' + a);
    }, 650);
  }

  function feedFish() {
    if (creepStage >= 3) { retip(fishEl, 'they are not hungry. not for that.'); return; }
    fishEl.classList.add('rm-fed');
    retip(fishEl, 'they eat like it is the first time. it always is.');
    later(() => { if (active) fishEl.classList.remove('rm-fed'); }, 5000);
  }

  function renderCal(his) {
    let cells = '';
    for (const d of 'SMTWTFS') cells += '<b>' + d + '</b>';
    for (let i = 0; i < 3; i++) cells += '<i></i>';   // both months open on a Wednesday
    const mark = his ? 12 : 31;
    for (let d = 1; d <= 31; d++) cells += '<i' + (d === mark ? ' class="rm-cal-mark"' : '') + '>' + d + '</i>';
    calEl.classList.toggle('rm-cal-his', his);
    calEl.innerHTML =
      '<div class="rm-cal-pic"><span>' + (his ? 'HE IS<br>OPERATIONAL' : 'HANG IN<br>THERE') + '</span></div>' +
      '<div class="rm-cal-head">' + (his ? 'JANUARY 1997' : 'DECEMBER 1999') + '</div>' +
      '<div class="rm-cal-grid">' + cells + '</div>' +
      '<div class="rm-cal-note">' + (his ? 'his birthday.' : 'Y2K!! back up EVERYTHING') + '</div>';
    calEl.dataset.tip = his
      ? 'january 12th. his birthday. you forgot.'
      : 'december 1999. the world ends on the 31st, probably.';
  }

  function setClock() {
    if (clockGlitch) return;   // 9000 until you've seen it
    const d = new Date();
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    const m = d.getMinutes();
    clockEl.textContent = h + ':' + (m < 10 ? '0' + m : m);
  }

  function onKey(e) {
    if (!active || exiting) return;
    wakeFx();
    if (api.achOverlayOpen || api.projOverlayOpen) { keys.clear(); return; }   // the overlay owns keys while open
    if (resumeOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeResume(); }
      return;
    }
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
    if (call) { handleCallKey(e); return; }         // receiver up: keys type into the call
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      exit();
      return;
    }
    // 9-9-9: three consecutive 9s run the creep straight through to stage 4
    // (door open, hallway unblocked, phone ringing) — a skip to the hall phone
    // without the wait. Stages fire in order so the state matches a real visit;
    // the armCreep timers later no-op on their n <= creepStage guard.
    if (e.key === '9') {
      if (++nineTaps >= 3) {
        nineTaps = 0;
        for (let n = creepStage + 1; n <= 4; n++) setCreep(n);
        flushCorrupt();   // a skip: everything, now
      }
      return;
    }
    nineTaps = 0;
    const k = KEYMAP[e.key.toLowerCase()];
    if (k) {
      e.preventDefault();
      keys.add(k);
    }
  }

  function onKeyUp(e) {
    const k = KEYMAP[e.key.toLowerCase()];
    if (k) keys.delete(k);
  }

  function onMove(e) {
    if (exiting) return;
    if (dragging) {
      tip.classList.remove('show');
      dragDist += Math.abs(e.clientX - dragX) + Math.abs(e.clientY - dragY);
      applyLook(e.clientX - dragX, e.clientY - dragY);
      dragX = e.clientX;
      dragY = e.clientY;
      return;
    }
    // cursor is free: tooltips follow it
    const t = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    if (t) {
      tip.textContent = t.getAttribute('data-tip');
      tip.classList.add('show');
      // keep the whole tooltip on screen (the portfolio tips run long)
      tip.style.left = Math.max(8, Math.min(e.clientX + 18, window.innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = (e.clientY + 20) + 'px';
    } else {
      tip.classList.remove('show');
    }
  }

  function onPointerDown(e) {
    wakeFx();
    if (!active || exiting || !walking) return;
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging the view
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    dragDist = 0;
  }

  function onPointerUp() {
    dragging = false;
  }

  function onClick(e) {
    if (!active || exiting) return;
    if (dragDist > 8) return; // that was a look-drag, not a click
    const eggEl = e.target && e.target.closest ? e.target.closest('[data-egg]') : null;
    if (eggEl) {
      api._chirp(620, 'sine', 0.09, 0.05);
      api.unlockAchievement(eggEl.dataset.egg);
      return;
    }
    const t = e.target && e.target.closest ? e.target.closest('[data-act]') : null;
    if (!t) return;
    const act = t.getAttribute('data-act');
    api._chirp(340, 'square', 0.05, 0.04);
    if (act === 'lamp') {
      if (creepStage >= 2) { retip(t, 'it won\u2019t turn back on.'); return; }
      viewport.classList.toggle('room-lit');
      return;
    }
    if (act === 'tv') { changeChannel(); return; }
    if (act === 'proj') { keys.clear(); tip.classList.remove('show'); api.openProjects(t.dataset.view || 'index'); return; }
    if (act === 'trophy') { keys.clear(); tip.classList.remove('show'); api.toggleAchievements(); return; }
    if (act === 'resume') { openResume(); return; }
    if (act === 'games') { exitThen('games'); return; }
    if (act === 'chess') { exitThen('chess'); return; }
    if (act === 'ball') { shakeBall(); return; }
    if (act === 'fish') { feedFish(); return; }
    if (act === 'phone') {
      if (ringing) answerPhone();
      return;
    }
    if (act === 'back') exit();
  }

  function open() {
    if (active) return;
    if (!viewport) build();
    active = true;
    exiting = false;
    walking = false;
    keys.clear();
    api.roomActive = true;
    cam.x = CAM_START.x; cam.y = CAM_START.y; cam.z = CAM_START.z;
    cam.yaw = CAM_START.yaw; cam.pitch = CAM_START.pitch;
    dragging = false;
    dragDist = 0;   // a look-drag from the LAST visit must not suppress this visit's first click
    while (timers.length) clearTimeout(timers.pop());   // e.g. the previous exit's deferred blink removal
    lastT = '';
    billYaw = null;
    creepStage = 0;
    nineTaps = 0;
    ringing = false;
    answered = false;
    hallOpen = false;
    hallWhispered = false;
    for (const sc of hallSconces) { sc.out = false; sc.el.classList.remove('rm-out'); }
    for (const d of hallDoors) { d.seen = false; d.el.classList.remove('rm-seen'); }
    slammed = false;
    slamDoor.el.classList.remove('rm-slam');
    slamDoor.el.classList.add('rm-ajar');
    figFar = true; figFarEl.classList.remove('rm-gone');
    figBack = 0; figBackEl.classList.add('rm-gone');
    doorShut = false; viewport.classList.remove('door-shut');
    while (wakeTimers.length) clearTimeout(wakeTimers.pop());
    for (const sh of hallShapes) { sh.on = false; sh.el.classList.remove('on'); }
    lastStretch = -1;
    endGrpEl.style.transform = '';
    versesSpoken = 0;
    stepAcc = 0; wasMoving = false;
    signState = 0;
    call = null;
    stopCallAudio();
    if (popEl) { popEl.remove(); popEl = null; }
    viewport.classList.remove('creep-1', 'creep-2', 'creep-3', 'creep-4');
    callEl.classList.remove('rm-live', 'show');
    callEl.innerHTML = '';
    hallPhoneEl.classList.remove('rm-ringing');
    hallPhoneEl.dataset.tip = 'it is ringing.';
    doorSignEl.innerHTML = 'GONE<br>COMPILING';
    const plans = ['ship it', 'buy more RAM', 'call mom', 'P=NP?'];
    corkNotes.forEach((el, idx) => {
      el.textContent = plans[idx];
      el.classList.remove('rm-note-turned');
    });
    capEl.textContent = '2001';
    posterEl.classList.add('rm-poster-matrix');
    delete posterEl.dataset.egg;
    posterEl.dataset.tip = 'there is no spoon.';
    stitchEl.innerHTML = 'there&#39;s no place<br>like 127.0.0.1';
    stitchEl.dataset.tip = 'no place like it.';
    doorEl.dataset.tip = 'leads outside. hard pass.';
    duckEl.dataset.tip = 'the finest debugger money can buy';
    stickyEl.dataset.tip = 'TODO: touch grass';
    bedEl.dataset.tip = 'still made. suspicious.';
    clockEl.parentNode.dataset.tip = 'the clock radio. one station, this late.';
    for (const el of creepTipEls) el.dataset.tip = el.dataset.calmTip;
    tvCh = 0;
    renderTv();
    renderCal(false);
    fishEl.classList.remove('rm-fed');
    ballEl.firstChild.classList.remove('rm-shake', 'rm-answered');
    ballEl.dataset.tip = 'the magic 8-ball. ask it something.';
    visits = (parseInt(recall('ilaird_room_visits'), 10) || 0) + 1;
    store('ilaird_room_visits', String(visits));
    renderTally(visits - 1);
    if (visits >= 2) corkNotes[2].textContent = visits >= 5 ? 'every night now.' : 'you came back.';
    resetShifts();
    resetCorrupt();
    const savedChair = parseFloat(recall('ilaird_room_chair'));
    setChair(Number.isFinite(savedChair) ? savedChair : 0);
    lastChairT = lastShiftT = -1e9; lastShiftCheck = 0;
    for (const el of cityLights) el.classList.remove('rm-off');
    fogEl.classList.remove('show');
    reflOn = false; reflN = 0;
    reflEl.classList.remove('show');
    lastActive = 0; lastPose = ''; stared = false; stillFlicked = false;
    termStep = 0;
    hiddenTitle = null;
    pendingCmd = null;
    closeResume();
    updateBills(); // face the start camera before first paint

    // black over everything BEFORE the swap; it fades out on the pull-back
    blinkEl.classList.remove('out');
    blinkEl.style.transition = 'none';
    document.body.appendChild(blinkEl);

    document.body.appendChild(viewport);
    viewport.scrollTop = viewport.scrollLeft = 0;
    screenEl.scrollTop = screenEl.scrollLeft = 0;
    restoreParent = api.winEl.parentNode;
    restoreNext = api.winEl.nextSibling;
    screenEl.insertBefore(api.winEl, glassEl);
    document.body.classList.add('room-view');
    document.body.appendChild(hint);
    document.body.appendChild(tip);
    document.body.appendChild(callEl);
    api.cmd.blur();

    // start framed on the screen, fly out, then hand the camera to the player
    world.classList.add('no-anim');
    world.style.transform = zoomInTransform();
    void world.offsetWidth;
    world.classList.remove('no-anim');
    const arrive = () => {
      if (!active || exiting || walking) return;
      world.classList.add('no-anim'); // per-frame camera writes from here on
      walking = true;
      armCreep();
      // a return visit (or the small hours) starts further along
      for (let n = 1, s0 = startStage(); n <= s0; n++) setCreep(n);
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        world.style.transform = camTransform();
        blinkEl.style.transition = '';
        blinkEl.classList.add('out');
        world.addEventListener('transitionend', arrive, { once: true });
        later(arrive, 1700); // reduced motion cuts (no transitionend) — still arrive
      });
    });

    keyHandler = onKey;
    keyUpHandler = onKeyUp;
    blurHandler = () => { keys.clear(); dragging = false; };
    moveHandler = onMove;
    downHandler = onPointerDown;
    upHandler = onPointerUp;
    clickHandler = onClick;
    visHandler = onVisibility;
    document.addEventListener('visibilitychange', visHandler);
    document.addEventListener('keydown', keyHandler, true);
    document.addEventListener('keyup', keyUpHandler, true);
    window.addEventListener('blur', blurHandler);
    viewport.addEventListener('pointermove', moveHandler);
    viewport.addEventListener('pointerdown', downHandler);
    window.addEventListener('pointerup', upHandler);
    viewport.addEventListener('click', clickHandler);
    rafId = requestAnimationFrame(step);

    setClock();
    clockTimer = setInterval(setClock, 20000);
    radioStart();
    api._chirp(58, 'sine', 0.5, 0.07);
    later(() => { if (active && !exiting) hint.classList.add('show'); }, 1600);
  }

  function exit(opts) {
    if (!active || exiting) return;
    const cut = !!(opts && opts.cut);
    wakeUp = !!(opts && opts.wake);
    exiting = true;
    walking = false;
    keys.clear();
    dragging = false;
    hint.classList.remove('show');
    tip.classList.remove('show');
    closeResume();
    if (versesSpoken && window.speechSynthesis) window.speechSynthesis.cancel();
    api._chirp(58, 'sine', 0.35, 0.06);

    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      // hard cover for the reparent snap, then reveal the flat terminal
      blinkEl.style.transition = 'opacity .12s';
      blinkEl.classList.remove('out');
      later(() => {
        if (restoreNext) restoreParent.insertBefore(api.winEl, restoreNext);
        else restoreParent.appendChild(api.winEl);
        document.body.classList.remove('room-view');
        viewport.remove();
        hint.remove();
        tip.remove();
        callEl.classList.remove('show', 'rm-live');
        callEl.remove();
        if (callTyper) { clearInterval(callTyper); callTyper = null; }
        call = null;
        stopCallAudio();
        if (popEl) { popEl.remove(); popEl = null; }
        ringing = false;
        document.removeEventListener('keydown', keyHandler, true);
        document.removeEventListener('keyup', keyUpHandler, true);
        window.removeEventListener('blur', blurHandler);
        viewport.removeEventListener('pointermove', moveHandler);
        viewport.removeEventListener('pointerdown', downHandler);
        window.removeEventListener('pointerup', upHandler);
        viewport.removeEventListener('click', clickHandler);
        document.removeEventListener('visibilitychange', visHandler);
        if (hiddenTitle !== null) { document.title = hiddenTitle; hiddenTitle = null; }
        cancelAnimationFrame(rafId);
        clearInterval(clockTimer);
        radioStop();
        while (timers.length) clearTimeout(timers.pop());
        active = false;
        exiting = false;
        api.roomActive = false;
        blinkEl.style.transition = '';
        blinkEl.classList.add('out');
        later(() => blinkEl.remove(), 600);
        api.cmd.focus();
        if (crtOffEl) { crtOffEl.classList.remove('go'); crtOffEl.remove(); }
        if (wakeUp) { wakeUp = false; wakeLines(); }
        else api.line('back inside the machine.', 'dim');
        api.blank();
        api.scroll();
        if (pendingCmd) {   // the gamepad / chess board: go back in, then play
          const c = pendingCmd;
          pendingCmd = null;
          api.runCommand(c);
        }
      }, 140);
    };

    if (api.reduceMotion || cut) { finish(); return; }
    // re-enable the transition (walking runs with .no-anim) and glide back in
    world.classList.remove('no-anim');
    void world.offsetWidth;
    world.style.transform = zoomInTransform();
    world.addEventListener('transitionend', finish, { once: true });
    later(finish, 1800); // safety if transitionend never fires
  }

  /* ── test seam ──
     Exposed ONLY when the page set window.ROOM_TEST_HOOKS before initRoom ran
     (test/sms-optin.test.js). The SMS opt-in popup is carrier-compliance
     load-bearing (consent box never pre-checked, submit refuses without it,
     required disclosures) — this lets the tests pin those invariants without
     driving the whole creep → ring → Turnstile → /room-call flow. */
  if (window.ROOM_TEST_HOOKS) {
    window.__roomPopTest = {
      open(stage) {
        if (!callEl) callEl = document.createElement('div');   // closePop → callNote needs it
        if (!call) call = { phase: 'chat', token: 'test-token', input: '', busy: false, askSeen: true, pop: null };
        openPop(stage || 'num');
        return call.pop;
      },
      key(k) { handlePopKey({ key: k, preventDefault() {} }); },
      submit() { submitPop(); },
      render() { renderPop(); },
      get pop() { return call && call.pop; },
      get el() { return popEl; },
      reset() { if (popEl) { popEl.remove(); popEl = null; } call = null; },
      /* Pick up the hallway phone without driving the creep → ring flow, and
         report which receiver answered: `live` means beginLiveCall ran (it sets
         `call` synchronously), false means it fell through to the decorative
         answering machine. test/clickjacking.test.js uses this to pin that a
         framed page can never reach the number/consent form. */
      pickUp() {
        if (!hallPhoneEl) hallPhoneEl = document.createElement('div');
        if (!callEl) { callEl = document.createElement('div'); document.body.appendChild(callEl); }
        call = null;
        answered = false;
        answerPhone();
        return { live: !!call };
      },
    };
  }

  return { open };
}

window.initRoom = initRoom;
