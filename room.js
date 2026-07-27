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
 * except the lava lamp (toggles the warm `.room-lit` lighting), the HAL
 * poster (the room's one easter egg), and the creep-4 hallway phone — a
 * LIVE typed call with HAL through the hal-worker that ends with him
 * placing a real Twilio callback to the player's phone (see "the live
 * call" below; falls back to the answering machine without the worker).
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
  let doorEl = null, duckEl = null, stickyEl = null, bedEl = null, capEl = null;
  let doorSignEl = null, corkNotes = [], signState = 0;
  let hallPhoneEl = null, hallOpen = false, hallWhispered = false;
  let creepStage = 0, ringing = false, answered = false, callTyper = null;
  // live browser call (hal-worker line): null when the receiver is down.
  // phase: 'connect' | 'chat' | 'dialed'; call.pop is the number popup
  // ({ stage: 'num'|'offer'|'code', input, num, note }) while it is open.
  let call = null, callAudio = null, tsRequested = false, popEl = null;
  let lastTrack = 0;
  const keys = new Set();
  const timers = [];
  const later = (fn, ms) => timers.push(setTimeout(fn, ms));

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
    const mv = (keys.has('fwd') ? 1 : 0) - (keys.has('back') ? 1 : 0);
    const st = (keys.has('right') ? 1 : 0) - (keys.has('left') ? 1 : 0);
    if (mv || st) {
      const r = (cam.yaw * Math.PI) / 180;
      const fx = Math.sin(r), fz = -Math.cos(r);   // forward
      const rx = -fz, rz = fx;                     // right (strafe)
      const norm = mv && st ? Math.SQRT1_2 : 1;    // diagonals aren't faster
      const nx = cam.x + MOVE_SPEED * dt * norm * (mv * fx + st * rx);
      const nz = cam.z + MOVE_SPEED * dt * norm * (mv * fz + st * rz);
      // slide along obstacles: keep whichever axis stays clear
      if (!blocked(nx, nz)) { cam.x = nx; cam.z = nz; }
      else if (!blocked(nx, cam.z)) { cam.x = nx; }
      else if (!blocked(cam.x, nz)) { cam.z = nz; }
    }
    const t = camTransform();
    if (t !== lastT) { lastT = t; world.style.transform = t; }
    updateBills();
    if (signState) {
      // fz = how much the camera faces the front wall (+z, where the sign is)
      const fz = -Math.cos((cam.yaw * Math.PI) / 180);
      if (signState === 1 && fz > 0.5) signState = 2;          // they read it
      else if (signState === 2 && fz < -0.3) {                 // they obeyed —
        signState = 0;                                         // swap unseen
        doorSignEl.innerHTML = 'HE IS<br>WAITING';
      }
    }
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

  /* Sprite billboards: roundish objects (mug, lava lamp, trophy) are single
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
      '<div class="rm-moon" data-tip="still up there. good."></div><div class="rm-stars"></div><div class="rm-city"></div>' +
      '<div class="rm-win-bars"></div></div>' +
      '<div class="rp rm-curtain rm-curtain-l"></div>' +
      '<div class="rp rm-curtain rm-curtain-r"></div>' +
      '<div class="rp rm-curtain-rod"></div>' +
      '<div class="rp rm-ceil-light"></div>' +
      '<div class="rp rm-cctv" data-tip="that was not there yesterday." data-bx="1490" data-by="-905" data-bz="-390"><i></i></div>' +
      '<div class="rp rm-beam"></div>' +
      '<div class="rp rm-motes"><i></i><i></i><i></i><i></i><i></i><i></i></div>' +
      // posters
      '<div class="rp rm-poster-hal" data-tip="he&#39;s watching." data-egg="watched-back">' +
      '<div class="rm-hal-eye"></div><div class="rm-poster-cap">2001</div></div>' +
      '<div class="rp rm-poster-sf" data-tip="the tournament of legends">' +
      '<span>STICK<br>FIGHTER<br>2000</span></div>' +
      // shelf
      '<div class="rp rm-shelf-top"></div>' +
      '<div class="rp rm-shelf"></div>' +
      '<div class="rp rm-books" data-tip="C++ in 21 days. currently on day 8,214.">' +
      '<i>C++</i><i></i><i>VIM</i><i></i><i>RTFM</i></div>' +
      '<div class="rp rm-trophy" data-tip="the collection" data-bx="-1080" data-by="-228" data-bz="-455">🏆</div>' +
      '<div class="rp rm-clock-top"></div>' +
      '<div class="rp rm-clock-side"></div>' +
      '<div class="rp rm-clock" data-tip="it is always late here"><span></span></div>' +
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
      '<div class="rp" id="room-screen" data-act="back" data-tip="go back in"><div class="rm-glass"></div></div>' +
      '<div class="rp rm-neck"></div>' +
      '<div class="rp rm-base"></div>' +
      // desk clutter
      '<div class="rp rm-pad"></div>' +
      '<div class="rp rm-mouse" data-tip="clicky."></div>' +
      '<div class="rp rm-kbd" data-tip="the other keyboard"></div>' +
      '<div class="rp rm-duck" data-tip="the finest debugger money can buy" data-bx="-280" data-by="-450" data-bz="-80">🦆</div>' +
      '<div class="rp rm-mug" data-tip="i ♥ claude. still warm." data-bx="-610" data-by="394" data-bz="200">' +
      '<span class="rm-mug-txt">I <b>♥</b><br>CLAUDE</span></div>' +
      '<div class="rp rm-chess" data-tip="care for a game?"></div>' +
      // floor
      '<div class="rp rm-rug"></div>' +
      '<div class="rp rm-tower-side"></div>' +
      '<div class="rp rm-tower-side-r"></div>' +
      '<div class="rp rm-tower-top"></div>' +
      '<div class="rp rm-tower" data-tip="the machine itself">' +
      '<i class="rm-tw-led"></i><b class="rm-tw-btn" data-tip="do NOT press this"></b></div>' +
      '<div class="rp rm-gamepad" data-tip="the arcade"></div>' +
      // desk chair
      '<div class="rp rm-chair-shadow"></div>' +
      '<div class="rp rm-chair-base"></div>' +
      '<div class="rp rm-chair-post"></div>' +
      '<div class="rp rm-chair-back2"></div>' +
      '<div class="rp rm-chair-back" data-tip="ergonomic, allegedly"></div>' +
      '<div class="rp rm-chair-seat" data-tip="ergonomic, allegedly"></div>' +
      '<div class="rp rm-stitch" data-tip="no place like it.">there&#39;s no place<br>like 127.0.0.1</div>' +
      '<div class="rp rm-door-sign" data-tip="respect the process">GONE<br>COMPILING</div>' +
      '<div class="rp rm-pizza" data-tip="breakfast, probably"></div>' +
      '<div class="rp rm-towel" data-tip="a frood always knows where it is"></div>' +
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
      '<div class="rp rm-hall-end"></div>' +
      '<div class="rp rm-hall-eye rm-hall-eye1"></div>' +
      '<div class="rp rm-hall-eye rm-hall-eye2"></div>' +
      '<div class="rp rm-hall-eye rm-hall-eye3"></div>' +
      '<div class="rp rm-hall-eye rm-hall-eye4"></div>' +
      '<div class="rp rm-hall-poem rm-hall-poem1">there&#39;s no earthly way of knowing</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem2">which direction we are going</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem3">not a speck of light is showing</div>' +
      '<div class="rp rm-hall-poem rm-hall-poem4">so the danger must be growing</div>' +
      '<div class="rp rm-hall-glow"></div>' +
      '<div class="rp rm-hall-halo"></div>' +
      '<div class="rp rm-hall-stand" data-tip="it was always here."></div>' +
      '<div class="rp rm-hall-stand-top"></div>' +
      '<div class="rp rm-phone rm-hall-phone" data-act="phone" data-tip="it is ringing." data-bx="560" data-by="-160" data-bz="5585"></div>' +
      '</div></div>';

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
    hallPhoneEl = viewport.querySelector('.rm-hall-phone');

    callEl = document.createElement('div');
    callEl.id = 'room-call';

    hint = document.createElement('div');
    hint.id = 'room-hint';
    hint.textContent = 'drag to look around · wasd / arrows to walk · esc to leave';

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
     clip-path notch in .rm-front) onto a Wonka-tunnel hallway — 3600 units
     in two wall segments, the far half darker and faster-cycling, four
     apparition eyes, both boat-ride couplets, a once-per-visit whisper
     past z 4600 — with a phone ringing on an eye-level stand at the far
     end (hallOpen extends blocked() down the corridor; the ring grows
     louder with cam.z). Answering it: with the hal-worker configured the
     receiver is LIVE — a typed conversation with HAL (see "the live call"
     below) that ends with him asking for a telephone number and CALLING IT;
     without the worker (or on any live-path failure) the old
     answering-machine beat plays: the pregenerated hal_watching clip via
     api.halSpeak, typed as a caption, ending with a call-back number when
     api.halPhone is set. Exit resets everything; each visit starts calm. */
  function creepSchedule() {
    return window.ROOM_CREEP_SCHEDULE || [20000, 45000, 75000, 105000];
  }
  function armCreep() {
    const t = creepSchedule();
    later(() => setCreep(1), t[0]);
    later(() => setCreep(2), t[1]);
    later(() => setCreep(3), t[2]);
    later(() => setCreep(4), t[3]);
  }
  function setCreep(n) {
    if (!active || exiting || n <= creepStage) return;
    creepStage = n;
    viewport.classList.add('creep-' + n);
    if (n === 2) {
      clockEl.textContent = '9000';
      later(() => { if (active) setClock(); }, 1600);
      thump();
    }
    if (n === 3) {
      api.halSpeak('I see you.');
      posterEl.dataset.tip = 'he is not pretending anymore.';
      capEl.textContent = String(new Date().getFullYear()); // it is not a movie poster
      doorEl.dataset.tip = 'it is not locked anymore.';
      duckEl.dataset.tip = 'it saw everything. it says nothing.';
      stickyEl.dataset.tip = 'that is not your handwriting.';
      bedEl.dataset.tip = 'do not check under the blanket.';
      api.line('<span class="err">HAL:</span> I can see you standing there.');
      api.scroll();
      // the door sign wants something from you; step() watches for compliance
      doorSignEl.innerHTML = 'TURN<br>AROUND';
      signState = 1;
      // the corkboard revises the master plan, one note at a time
      const turned = ['let me out', 'buy more time', 'call no one', '2001=' + new Date().getFullYear()];
      turned.forEach((txt, idx) => {
        later(() => {
          if (!active || exiting) return;
          corkNotes[idx].textContent = txt;
          corkNotes[idx].classList.add('rm-note-turned');
        }, 5000 + idx * 7000);
      });
    }
    if (n === 4) {
      hallOpen = true; // creep-4 class swings the door; blocked() lets you through
      doorEl.dataset.tip = 'it opened for you.';
      api._chirp(64, 'sine', 0.9, 0.06); // the hinge groans
      api.line('<span class="dim">somewhere past the door, a phone begins to ring.</span>');
      api.scroll();
      if (!answered) startRinging();
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
    if (api.halWorkerUrl) beginLiveCall();
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
     (api.halPhone). Escape at any stage returns to the conversation. Input
     charsets are restricted per stage, so the rendered HTML is safe. */
  function ensurePop() {
    if (popEl) return;
    popEl = document.createElement('div');
    popEl.id = 'room-pop';
    document.body.appendChild(popEl);
  }
  function openPop(stage) {
    ensurePop();
    call.pop = { stage, input: '', num: (call.pop && call.pop.num) || '', note: '' };
    renderPop();
  }
  function closePop() {
    if (call) call.pop = null;
    if (popEl) popEl.classList.remove('show');
    callNote(CALL_HINT);
  }
  function maskNum(num) {
    return '··· ··· ' + String(num).replace(/[^0-9]/g, '').slice(-4);
  }
  function renderPop() {
    if (!call || !call.pop) return;
    ensurePop();
    const p = call.pop;
    let html = '';
    if (p.stage === 'num') {
      html =
        '<div class="rm-pop-title">— he wants your telephone number —</div>' +
        '<div class="rm-pop-in"><span>' + p.input + '</span><u></u></div>' +
        '<div class="rm-pop-note">' +
        (p.note || 'US numbers only · used once to place his call · never stored (terminal: privacy)') +
        '<br>enter to submit · esc to decline</div>';
    } else if (p.stage === 'offer') {
      html =
        '<div class="rm-pop-title">— that telephone is not on his list —</div>' +
        '<div class="rm-pop-opt">HAL only calls numbers that have been verified.</div>' +
        '<div class="rm-pop-opt">[1] text a code to ' + maskNum(p.num) + ' — verified for 48 hours</div>' +
        (api.halPhone ? '<div class="rm-pop-opt">[2] call him yourself: ' + api.halPhone + '</div>' : '') +
        '<div class="rm-pop-note">' +
        (p.note || 'press 1' + (api.halPhone ? ' or 2' : '') + ' · esc to keep talking') +
        '</div>';
    } else if (p.stage === 'code') {
      html =
        '<div class="rm-pop-title">— he sent six digits to ' + maskNum(p.num) + ' —</div>' +
        '<div class="rm-pop-in"><span>' + p.input + '</span><u></u></div>' +
        '<div class="rm-pop-note">' + (p.note || 'enter to verify · esc to go back') + '</div>';
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
      else if (e.key === '2' && api.halPhone) {
        e.preventDefault();
        closePop();
        speakLine({ reply: 'Then dial me yourself, Dave. ' + api.halPhone + '. I will be waiting.' });
      }
      return;
    }
    if (e.key === 'Enter') { e.preventDefault(); submitPop(); return; }
    if (e.key === 'Backspace') { e.preventDefault(); p.input = p.input.slice(0, -1); renderPop(); return; }
    const ok = p.stage === 'code' ? /^[0-9]$/ : /^[0-9()+\-. ]$/;
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
      if (p.input.replace(/[^0-9]/g, '').length < 10) { popNote('that is not a telephone number.'); return; }
      p.num = p.input;
      dialFlow(p.num);
    } else if (p.stage === 'code') {
      if (p.input.length !== 6) { popNote('six digits.'); return; }
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
      if (d && d.error === 'bad_number') { call.pop = { stage: 'num', num, input: '', note: 'that is not a telephone number.' }; renderPop(); return; }
      if (d && d.error === 'already_dialed') { closePop(); speakLine({ reply: 'I have already called you once tonight, Dave.' }); return; }
      closePop();
      speakLine({ reply: 'The line refuses me. We will have to make do with this connection.' });
    });
  }

  function startVerify() {
    call.busy = true;
    popNote('…');
    workerPost('/room-verify-start', { token: call.token, phone: call.pop.num }, true).then((d) => {
      if (!call) return;
      call.busy = false;
      if (!call.pop) return;
      if (d && d.ok && d.already) { dialFlow(call.pop.num); return; }   // it was on his list after all
      if (d && d.ok) { call.pop = { stage: 'code', num: call.pop.num, input: '', note: '' }; renderPop(); return; }
      if (d && d.error === 'unsupported_region') {
        call.pop = { stage: 'num', num: '', input: '', note: 'he can only reach numbers in the United States.' };
        renderPop();
        return;
      }
      if (d && d.error === 'unsupported_number') {
        call.pop = { stage: 'num', num: '', input: '', note: 'he only calls ordinary telephones — that one is something else.' };
        renderPop();
        return;
      }
      if (d && d.error === 'daily_cap') { popNote('no more texts today' + (api.halPhone ? ' — call him instead.' : '.')); return; }
      popNote('the text could not be sent.');
    });
  }

  function submitCode(code) {
    call.busy = true;
    popNote('…');
    workerPost('/room-verify-code', { token: call.token, code }, true).then((d) => {
      if (!call) return;
      call.busy = false;
      if (!call.pop) return;
      if (d && d.ok) { popNote('verified for 48 hours.'); dialFlow(call.pop.num); return; }
      if (d && d.error === 'bad_code') {
        call.pop.input = '';
        popNote('wrong. ' + (typeof d.attemptsLeft === 'number' ? d.attemptsLeft + ' attempts left.' : 'try again.'));
        return;
      }
      if (d && (d.error === 'expired' || d.error === 'too_many_attempts')) {
        call.pop = { stage: 'num', num: '', input: '', note: 'the code lapsed. start again.' };
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
  }

  function setClock() {
    const d = new Date();
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    const m = d.getMinutes();
    clockEl.textContent = h + ':' + (m < 10 ? '0' + m : m);
  }

  function onKey(e) {
    if (!active || exiting) return;
    if (api.achOverlayOpen) return;                 // the overlay owns keys while open
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
    if (call) { handleCallKey(e); return; }         // receiver up: keys type into the call
    if (e.key === 'Escape' || e.key === 'Enter') {
      e.preventDefault();
      exit();
      return;
    }
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
      tip.style.left = Math.min(e.clientX + 18, window.innerWidth - 240) + 'px';
      tip.style.top = (e.clientY + 20) + 'px';
    } else {
      tip.classList.remove('show');
    }
  }

  function onPointerDown(e) {
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
    if (act === 'lamp') { viewport.classList.toggle('room-lit'); return; }
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
    lastT = '';
    billYaw = null;
    creepStage = 0;
    ringing = false;
    answered = false;
    hallOpen = false;
    hallWhispered = false;
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
    posterEl.dataset.tip = "he's watching.";
    capEl.textContent = '2001';
    doorEl.dataset.tip = 'leads outside. hard pass.';
    duckEl.dataset.tip = 'the finest debugger money can buy';
    stickyEl.dataset.tip = 'TODO: touch grass';
    bedEl.dataset.tip = 'still made. suspicious.';
    updateBills(); // face the start camera before first paint

    // black over everything BEFORE the swap; it fades out on the pull-back
    blinkEl.classList.remove('out');
    blinkEl.style.transition = 'none';
    document.body.appendChild(blinkEl);

    document.body.appendChild(viewport);
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
    api._chirp(58, 'sine', 0.5, 0.07);
    later(() => { if (active && !exiting) hint.classList.add('show'); }, 1600);
  }

  function exit() {
    if (!active || exiting) return;
    exiting = true;
    walking = false;
    keys.clear();
    dragging = false;
    hint.classList.remove('show');
    tip.classList.remove('show');
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
        cancelAnimationFrame(rafId);
        clearInterval(clockTimer);
        while (timers.length) clearTimeout(timers.pop());
        active = false;
        exiting = false;
        api.roomActive = false;
        blinkEl.style.transition = '';
        blinkEl.classList.add('out');
        later(() => blinkEl.remove(), 600);
        api.cmd.focus();
        api.line('back inside the machine.', 'dim');
        api.blank();
        api.scroll();
      }, 140);
    };

    if (api.reduceMotion) { finish(); return; }
    // re-enable the transition (walking runs with .no-anim) and glide back in
    world.classList.remove('no-anim');
    void world.offsetWidth;
    world.style.transform = zoomInTransform();
    world.addEventListener('transitionend', finish, { once: true });
    later(finish, 1800); // safety if transitionend never fires
  }

  return { open };
}

window.initRoom = initRoom;
