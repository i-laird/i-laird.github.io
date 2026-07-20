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
 * driven in a rAF loop once the fly-out lands. THE MOUSE LOOKS: clicking
 * empty space grabs the pointer (Pointer Lock; drag-to-look is the fallback
 * when lock is unavailable or declined) and mouse movement steers yaw/pitch.
 * W/S or Up/Down walk, A/D strafe, Left/Right arrows turn (keyboard-only
 * users can still steer). Simple box collision keeps you inside the walls
 * and out of the desk, tower, dresser, and bed. Escape / Enter / clicking
 * the screen goes back in (under pointer lock the browser eats the first
 * Escape to release the pointer; the second one exits). All props are
 * decorative (tooltips only) except the lava lamp, which toggles the warm
 * `.room-lit` lighting.
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
  const BOUNDS = { minX: -1350, maxX: 1350, minZ: -1380, maxZ: 1180 };
  const BLOCKS = [
    { minX: -950, maxX: 950, minZ: -520, maxZ: 470 },    // desk + monitor
    { minX: -1330, maxX: -880, minZ: -160, maxZ: 330 },  // tower
    { minX: -1120, maxX: -440, minZ: 1090, maxZ: 1360 }, // dresser
    { minX: 860, maxX: 1510, minZ: -1140, maxZ: 130 },   // bed
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
  let dragging = false, dragX = 0, dragY = 0;
  // in this view matrix yaw+ looks RIGHT and pitch+ looks UP, so: mouse
  // right → yaw+, mouse down → pitch− (non-inverted FPS feel)
  function applyLook(dx, dy) {
    cam.yaw += dx * LOOK_SENS;
    cam.pitch = Math.max(-42, Math.min(34, cam.pitch - dy * LOOK_SENS * 0.8));
  }
  function pointerLocked() {
    return document.pointerLockElement === viewport;
  }

  function blocked(x, z) {
    if (x < BOUNDS.minX || x > BOUNDS.maxX || z < BOUNDS.minZ || z > BOUNDS.maxZ) return true;
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
  }

  /* Sprite billboards: roundish objects (mug, lava lamp, trophy) are single
     planes that would vanish edge-on, so they always face the camera — the
     element's own rotateY cancels the view rotation (net yaw 0). */
  function updateBills() {
    if (billYaw !== null && Math.abs(billYaw - cam.yaw) < 0.4) return;
    billYaw = cam.yaw;
    for (const b of bills) {
      b.style.transform =
        'translate(-50%, -50%) translate3d(' + b.dataset.bx + 'px, ' + b.dataset.by + 'px, ' +
        b.dataset.bz + 'px) rotateY(' + (-cam.yaw).toFixed(1) + 'deg)';
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
      '<div class="rm-moon" data-egg="moon-gazer" data-tip="still up there. good."></div><div class="rm-stars"></div><div class="rm-city"></div>' +
      '<div class="rm-win-bars"></div></div>' +
      '<div class="rp rm-curtain rm-curtain-l"></div>' +
      '<div class="rp rm-curtain rm-curtain-r"></div>' +
      '<div class="rp rm-curtain-rod"></div>' +
      '<div class="rp rm-ceil-light"></div>' +
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
      '<div class="rp rm-trophy" data-tip="the collection" data-bx="-1080" data-by="-228" data-bz="-1625">🏆</div>' +
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
      '<i class="rm-pillow-pad" data-egg="under-the-pillow" data-tip="lumpy."></i></div>' +
      // front wall (behind the player at start): door, dresser, posters
      '<div class="rp rm-door" data-tip="leads outside. hard pass."><i></i></div>' +
      '<div class="rp rm-dresser-top"></div>' +
      '<div class="rp rm-dresser-side"></div>' +
      '<div class="rp rm-dresser" data-tip="socks, mostly"></div>' +
      '<div class="rp rm-poster-chart" data-tip="you memorized it too">' +
      '<b>E</b><span>F P</span><span>T O Z</span><small>L P E D</small><small>P E C F D</small></div>' +
      '<div class="rp rm-cork" data-tip="the master plan">' +
      '<i>ship it</i><i>buy more RAM</i><i>call mom</i><i>P=NP?</i></div>' +
      '</div></div>';

    world = viewport.querySelector('#room-world');
    par = viewport.querySelector('#room-par');
    bills = Array.from(viewport.querySelectorAll('[data-bx]'));
    screenEl = viewport.querySelector('#room-screen');
    glassEl = viewport.querySelector('.rm-glass');
    clockEl = viewport.querySelector('.rm-clock span');

    hint = document.createElement('div');
    hint.id = 'room-hint';
    hint.textContent = 'click to grab the mouse and look · wasd / arrows to walk · esc to leave';

    tip = document.createElement('div');
    tip.id = 'room-tip';

    blinkEl = document.createElement('div');
    blinkEl.className = 'rm-blink';
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
    if (pointerLocked()) {
      tip.classList.remove('show');
      applyLook(e.movementX || 0, e.movementY || 0);
      return;
    }
    if (dragging) {
      tip.classList.remove('show');
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
    if (e.target && e.target.closest && e.target.closest('[data-act]')) return; // prop clicks act, not look
    e.preventDefault(); // no text selection while dragging the view
    dragging = true;
    dragX = e.clientX;
    dragY = e.clientY;
    // grab the pointer for true FPS look; drag already works if this is
    // unavailable or declined (the promise rejection is expected then)
    if (!pointerLocked() && viewport.requestPointerLock) {
      try {
        const r = viewport.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch (err) { /* drag fallback */ }
    }
  }

  function onPointerUp() {
    dragging = false;
  }

  function onClick(e) {
    if (!active || exiting) return;
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
    if (pointerLocked() && document.exitPointerLock) document.exitPointerLock();
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
