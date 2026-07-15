// GENERATED FILE — assembled from stickfighter/ by scripts/assemble-sf.js.
// Do not edit directly: change the part files and run `npm run assemble`
// (test/stickfighter-assembly.test.js pins this artifact to the parts).
//
// Stick Fighter 2000 — fantasy horde-survival game, lazily loaded on first launch
// from the gui XP desktop (see launchStickFighter() in desktop.js). Loaded as a
// CLASSIC script, it exposes one global, openStickFighter(xp, api). Everything it
// needs from app.js/lib arrives through the explicit `api` bridge (desktop.js's
// sfBridge(): unlockAchievement, _chirp, makeRng, HAL_WORKER_URL, and the live
// soundEnabled / reduceMotion / activeMusic accessors) — it references NOTHING
// from app.js by free global name, so it can be bundled & obfuscated as an
// independent lazy chunk without cross-file name-mangling breaking. The only
// contract is openStickFighter + the api key names (keep both on the
// obfuscator's reserved list). The running game parks its teardown on
// xp._sfCleanup so the desktop's shutdown() can stop it when the XP window closes.

function openStickFighter(xp, api) {
// ── head — api bridge destructure, canvas/hud/audio setup, tuning constants, SF_SPEED, sim clock + seeded rnd() ──
if (document.getElementById('sf-canvas')) { xp._sfCleanup && xp._sfCleanup(); return; }

// Dependency bridge from app.js (see sfBridge() there). The game references
// NOTHING from app.js by free global name — everything external comes through
// `api`, so this file can be obfuscated as an independent lazy chunk. Stable
// refs are destructured here (call sites unchanged); the runtime-varying flags
// (soundEnabled / reduceMotion) and the shared, game-mutated activeMusic are
// read/written through `api` live (api.soundEnabled, api.activeMusic = …, etc.).
const { unlockAchievement: _unlockAch, _chirp, makeRng, HAL_WORKER_URL } = api;
// nothing persists out of a run that isn't the player's own: a watched replay
// must never unlock the WATCHER's achievements, and an online run saves nothing
// (no scores, upgrades, trophies — netplay is score-free by design for now)
const noPersist = () => replayMode || netplay;
const unlockAchievement = (id) => { if (!noPersist()) _unlockAch(id); };
_unlockAch('stick-fighter');   // the site egg for booting the game at all (raw: `replayMode` isn't initialized yet, and a boot is never a replay)

// the creator's REAL face (assets/ian_face.png) — drawn as two South Park photo-
// cutout pieces split at the lips (see drawIan). Purely progressive: until the
// image is decoded (or if it 404s / runs headless), the hand-drawn caricature
// renders instead, so tests and offline play never depend on the asset.
const ianFace = new Image();
ianFace.src = 'assets/ian_face.png';

// the sim's playfield. Local play uses the desktop's own size (as always);
// an ONLINE run negotiates min(host, client) so both peers simulate the same
// world, and the smaller field is letterboxed on the larger screen.
let GW = xp.offsetWidth;
let GH = xp.offsetHeight - 40;

// transparent canvas over the whole desktop
const canvas = document.createElement('canvas');
canvas.id = 'sf-canvas';
const SF_CANVAS_CSS = 'position:absolute;left:0;top:0;width:100%;height:calc(100% - 40px);pointer-events:none;z-index:5;background:#06080c;';
function setGameDims(w, h) {
  GW = w; GH = h;
  canvas.width = w; canvas.height = h;
  const availW = xp.offsetWidth, availH = xp.offsetHeight - 40;
  const matte = document.getElementById('sf-matte');
  if (w === availW && h === availH) {
    canvas.style.cssText = SF_CANVAS_CSS;
    if (matte) matte.remove();
    return;
  }
  // negotiated (smaller) field — a co-op band's screens rarely match, so the
  // field letterboxes to the smallest: aspect-preserving centred fit, FRAMED on
  // a battlefield-dark matte that fills the rest of the desktop (the atmosphere
  // pass promises the desktop never shows through during play — the margins of
  // a mismatched screen are part of that promise)
  if (!matte) {
    const m = document.createElement('div');
    m.id = 'sf-matte';
    m.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:calc(100% - 40px);z-index:4;pointer-events:none;' +
      'background:radial-gradient(ellipse at 50% 45%, #0c1017 0%, #07090d 55%, #020304 100%);';
    if (canvas.parentNode === xp) xp.insertBefore(m, canvas); else xp.appendChild(m);
  }
  const sc = Math.min(availW / w, availH / h);
  const cw = Math.round(w * sc), chh = Math.round(h * sc);
  canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:5;background:#06080c;' +
    'box-shadow:0 0 60px rgba(0,0,0,0.85), 0 0 0 1px rgba(120,140,170,0.28);' +
    'left:' + Math.round((availW - cw) / 2) + 'px;top:' + Math.round((availH - chh) / 2) + 'px;' +
    'width:' + cw + 'px;height:' + chh + 'px;';
}
setGameDims(GW, GH);
xp.appendChild(canvas);

// small HUD pinned to top-right
const hud = document.createElement('div');
hud.style.cssText = `
            position:absolute;top:8px;right:8px;z-index:6;pointer-events:none;
            background:rgba(0,0,0,0.45);color:white;font-size:12px;
            padding:5px 10px;border-radius:4px;text-shadow:1px 1px 2px #000;
            font-family:Tahoma,Arial,sans-serif;line-height:1.6;
          `;
xp.appendChild(hud);

const ctx = canvas.getContext('2d');

/* ── horde battle music — loops through the regular waves, then cuts
      out the moment the ringwraith set piece begins (see summonTheNine
      and the boss-skip cheats). Routed through api.activeMusic so the
      titlebar sound toggle / stopAllAudio / resumeModeAudio reach it. ── */
const sfMusic = new Audio('assets/audio/stick_fury.mp3');
sfMusic.preload = 'none';   // created at launch but not played until first movement
sfMusic.loop = true;
sfMusic.volume = 0.45;
function startSfMusic() {
  if (api.activeMusic === sfMusic) return;
  api.activeMusic = sfMusic;
  if (api.soundEnabled) { sfMusic.currentTime = 0; sfMusic.play().catch(() => {}); }
}
function stopSfMusic() {
  sfMusic.pause();
  if (api.activeMusic === sfMusic) api.activeMusic = null;
}

/* ── recorded ringwraith screech — plays once each time the Nine lunge
      together (the synchronized strike on the frame%360 cycle). ── */
const wraithSfx = new Audio('assets/audio/ringwraith.mp3');
wraithSfx.volume = 0.6;
function playWraithScreech() {
  if (!api.soundEnabled) return;
  try { wraithSfx.currentTime = 0; wraithSfx.play().catch(() => {}); } catch (_) {}
}

const KEEP_OUT   = 110;   // spawns and pickups never appear this close to the player
const PLAYER_R   = 9;     // the hero's own body radius — contact is body-to-body, not enemy-circle-vs-a-point
const BREATHER   = 200;   // frames of calm between cleared waves
const DASH_CD    = 72;    // frames between dashes
const SWORD_T    = 840;   // frames the drawn sword lasts (~14s)
const PULL_R     = 46;    // touch the stone and the sword is yours
const SWING_MS   = 600;  // ms between sword swings (wall-clock, so it's the same at any refresh rate)
const SWING_R    = 110;   // wide cleave — this is a power fantasy
const METER_MAX  = 100;
const FROST_R    = 235;   // freeze powerup: only enemies within this radius are frozen
const FROST_DUR  = 300;   // frames a caught enemy stays encased in ice (~5s)
const FIRE_R     = 215;   // fireball powerup: the flame front engulfs everything inside this
const CHAMP_T    = 600;   // frames a summoned champion fights for (~10s)
const TEXT_HOLD  = 1.9;   // banners & floating combat text linger this much longer
const FADE_LEN   = 54;    // frames for the cut to the Star Wars corridor
// run 10% faster when deployed; full speed when developing on localhost
const SF_SPEED = (() => {
  const h = location.hostname;
  const local = h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '' ||
                h.endsWith('.local') || location.protocol === 'file:';
  return local ? 1 : 1.1;
})();
let simAcc = 0;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/* ── Determinism foundation (groundwork for replays / future lockstep MP) ──
   The sim is driven by a seeded PRNG instead of Math.random(), and timing
   runs off a monotonic tick counter instead of the wall clock — so a run is
   a pure function of (seed, inputs). For now the seed is random per run, so
   single-player feels exactly as before; a future MP layer would share one
   seed across both peers and feed identical inputs. `rnd()` is the drop-in
   for Math.random() used everywhere in the simulation (audio jitter stays on
   Math.random() on purpose — it's local/cosmetic and must not advance the
   shared stream). See lib/rng.js. */
const SIM_HZ = 60;                  // logical sim ticks per second — the canonical clock rate
let tick = 0;                       // monotonic sim-tick counter; advances once per loop()
let sfSeed = 0;                     // this run's seed (random now; a shared seed enables lockstep later)
let sfSeedOverride = null;          // MP hook: set before a run to force a shared seed
let sfRng = Math.random;            // replaced with a seeded generator in init()
function rnd() { return sfRng(); }  // deterministic [0,1) — the simulation's only random source

// ── state — all run state: sim entities, leaderboard/proof, replay recorder, netplay vars, co-op, class tuning + SPELLS ──
let best = parseInt(localStorage.getItem('ilaird_sf_best') || '0', 10) || 0;
let player, enemies, warns, coins, powerups, blasts, sparks, ghosts,
    score, mult, wave, alive, started, frame, keys, rafId,
    freezeT, banner, bannerSub, bannerT, deadT, shake, newBest,
    stone, stoneCd, stoneSeen,
    meter, meterPrompted, allies, bolts, arrows, kegs, kills,
    nineActive, nineDone, wraithsLeft, waveQuota, breatherT,
    corpses, bossActive, bossRiseT, bossRiseX, bossRiseY,
    awaitExit, swActive, swState, swReadyT, swFadeT, swTroopersLeft, swStars,
    saberPickup, vaderActive, up, paused, upMenu, tokens, swFlash,
    sidiousActive, sidiousCue, sidiousIntroT, ltnBolts, ltnFlash, dlg, dlgT, sidFinale,
    jojoActive, jojoCue, jojoBg, dioStopT, dioStopFx, roadRoller, dioFinale, bossIntro, playerStand,
    ianCue, ianActive, ianChoice, ianFinale, mournful, endless, ianBg, wraithLunged, ogreSpawned, eliteSeen, dreadSeen, shamanSeen, bomberSeen,
    minions, husks;   // the necromancer's dead (see the SCYTHE block above)
// online leaderboard ("hall of legends"): lbState drives the death screen
//   off=worker down/unscored · loading · enter=typing a name · submitting · view/done=show the board
// lbScores = the all-time board; lbDaily = today's daily-challenge board (null when
// the worker predates daily boards — the daily column simply doesn't render).
// A daily run qualifies/submits against lbDaily, a normal run against lbScores;
// the death screen shows both side by side either way.
let lbScores = null, lbDaily = null, lbState = 'off', lbName = '', lbRank = -1, lbScore = 0, lbWave = 0;
// minimal proof-of-play: a worker-signed token minted when the run starts (fetched
// fire-and-forget so starting never blocks); the submit presents it + the run's
// {ticks, kills} so the worker can hold the claim against wall-clock time and the
// game's own rule invariants. `cheated` (any warp / grant-all cheat) unranks the run.
let runToken = null, cheated = false, lbTicks = 0, lbKills = 0;
// ── replay recording & playback ──
// Every live run records its complete per-tick input surface (held-direction mask
// changes, the pend actions at consumption, shop buys, boss-intro advances, the Ian
// choice) plus the initial persistent state the sim reads (seed, classes, owned
// upgrades, token balance, lifetime maxwave). A ranked submit ships it; the worker
// stores it beside the board entry; anyone can then WATCH the run — the deterministic
// sim replays it bit-exactly. Event codes: 0 mask · 1 dashP1 · 2 atkP1 · 3 dashP2 ·
// 4 atkP2 · 5 summon · 6 mash · 7 buy · 8 shop-continue · 9 intro-advance · 10 ian ·
// 11 spell-cycle (arg = hero index; the wizard's page selection is sim state) ·
// 12 boon pick (arg = boon id — offers re-roll deterministically, the pick is input).
let replayMode = false;      // watching someone else's run (read game-wide: gates saves/achievements)
let replay = null;           // { d: replay data, i: next event index, name, score }
let repMask = 0;             // the replayed held-direction mask
let repSaved = null;         // the watcher's own intro selections, restored on exit
let recEv = [], recLastM = -1, recHdr = null, recOverflow = false;
let runMaxwave = 0;          // lifetime-deepest wave, loaded per run (replay uses the recorder's)
const REC_MAX_EV = 50000;    // endless marathons stop recording rather than ballooning
function recPush(ev) {
  if (replayMode || netplay || recOverflow) return;   // replays aren't re-recorded; online runs aren't recorded at all
  if (recEv.length >= REC_MAX_EV) { recOverflow = true; return; }
  recEv.push(ev);
}
// ── online co-op (netplay) ──
// Two browsers, one deterministic sim: delay-based LOCKSTEP over a reliable-ordered
// WebRTC DataChannel. Host = P1, client = P2 (the existing coop split). Each peer
// samples its OWN input at the top of every tick, schedules it for tick+NET_DELAY,
// and sends it; a tick only executes once BOTH peers' frames for it are buffered
// (the gate lives in frameStep). Host menu picks (boon/shop/boss-intro/Ian) cross
// as tick-stamped events, applied by a feeder identical to the replay feeder — the
// sim is never mutated outside the tick-stamped input stream (mutating it any other
// way desyncs the peers, which is why the warp/grant cheats are disabled online).
// Signaling (one SDP blob each way, keyed by a short room code) goes through the
// hal-worker (/mp-host, /mp-offer, /mp-join, /mp-answer); gameplay traffic is pure
// P2P — no server ever sees it. Nothing persists out of an online run (noPersist).
const NET_VER = 2;      // wire-protocol version (handshake-checked); 2 = resume/reconnect protocol
const NET_SIM_V = 4;    // sim-balance version — MUST track recHdr.v (a stale sw.js build on one peer would silently desync); 4 = the mana-regen nerf
const NET_DELAY = 5;    // ticks of input delay (~83ms) — local input applies at tick+NET_DELAY on both sims
const NET_MAX_SEATS = 4; // the WAR BAND: up to four fighters — host = seat 0 (P1), joiners 1..3.
                         // Topology is a host-relayed STAR: every client links only to the host,
                         // which relays frames/events — 2-player is simply the 2-seat case.
let netplay = false;    // an online run is live (gates ALL persistence, like replayMode)
let netIsHost = false;
let netCfg = null;      // the authoritative run header (host-built; both sims init from it)
let netRunId = 0;       // bumps on every netBeginRun — stale frames from a previous run are dropped
let netPc = null, netChan = null, netPoll = 0, netTimeout = 0;  // the CLIENT's single link to the host
let netConns = [];      // HOST only: one conn per joined client { seat, pc, chan, have, csRemote, recon, ack, cls, gw, gh }
let netArming = null;   // HOST only: the pc currently parked in a room awaiting the next joiner
let netSeat = 0;        // my seat (0 = host/P1; joiners 1..3)
let netMasks = [0, 0, 0, 0];   // this tick's held-direction nibble per seat (fed by the frame consumer)
let netHave = null;     // CLIENT: per-seat highest frame tick received (resume tells the host where to refill)
let netUi = null;       // the connect screens: { mode:'host'|'join', phase, code, input, err }
let netSaved = null;    // the local player's own intro selections, restored on exit
let netFrames = null;   // per-seat Maps (length = party size): tick → { m: held-dir nibble, e: edge bits, s: summon, h: mash }
let netEvents = [];     // host menu picks in flight: [tick, op, arg] (same opcodes as the recorder)
let netLocal = null;    // local edge staging between ticks (the netplay `pend`)
let netMask = 0;        // the combined 8-bit held mask applied this tick (host low nibble, client high)
let netStall = 0;       // consecutive rAF frames blocked waiting on the remote
let netNotice = '';     // sticky intro-screen notice ("CONNECTION LOST" etc.)
let netNoticeT = 0;
let netCsLocal = null, netCsRemote = null;   // periodic sim checksums (the desync tripwire)
// ── mid-run reconnection (see netStartRecon in 14-netplay) — a dropped link HOLDS the
//    run (the lockstep gate freezes both sims) and re-signals through a rejoin room
//    both peers derive from (room code, seed), retrying for up to 10 minutes ──
let netRoomCode = '';   // the minted/typed room code — kept to derive the rejoin room
let netRejoin = '';     // 'R'+5 chars: the reconnect rendezvous room (recomputed each netBeginRun)
let netRecon = null;    // reconnect state { attempt, t0, gen } — non-null while the link is down
let netReconSeq = 0;    // bumped by netTeardown so an in-flight reconnect loop from a dead session goes inert
let netEventLog = [];   // every host menu event queued this run ([k,op,a], tiny) — re-sent on resume so none are lost in flight
let netDiscoT = 0;      // grace timer: pc 'disconnected' must persist ~10s before it counts as a drop
// ── local couch co-op (chosen on the intro screen; persists across R-restarts) ──
//   coop=false → the classic single-player game, byte-for-byte unchanged (every co-op
//   branch is gated on `coop`, so the deterministic sim and its tests are untouched).
//   P1 = arrows (move) · Right-Shift (dash) · '/' (swing).  P2 = WASD · Left-Shift · F.
//   Allies/meter/upgrades are shared; a felled hero is DOWN and a partner revives them
//   by standing close — the run only ends when both are down.
// The intro menu is two-level: menuTop picks SINGLEPLAYER / MULTIPLAYER, and each
// branch remembers its own sub-choice — subSingle 0=NORMAL · 1=☠ HARD (selectable
// only once hardUnlocked) · 2=☀ DAILY; subMulti 0=LOCAL (couch co-op) · 1=HOST ·
// 2=JOIN (online). coop/dailyRun stay the derived per-run flags, persisting across
// R-restarts exactly as before.
let coop = false, dailyRun = false, p2 = null, p3 = null, p4 = null;
let heat = 0;   // the wyrm & rider's shared fire gauge (reset in init; see WYRM & RIDER)
// ── the death KILL CAM (render-only): a rolling ghost tape of draw-ready entity
//    snapshots; on death the last seconds replay in slow motion, camera tight on
//    the fallen hero. Advanced once per loop call (= per sim tick) so the
//    60/120Hz draw-stream comparison holds; consumes no rnd(); skipped under
//    reduced motion and for replay watchers. ──
let camTape = [];       // ring of { heroes:[clones+tint], enemies:[clones] }, ~3.5s
let killCam = null;     // { tape, i, t, hold, fx, fy } while the cam plays
let camVictim = null;   // the hero whose fall ended it (set in downHero)
const CAM_TAPE_MAX = 210, CAM_SHOW = 110, CAM_SPEED = 0.5;
// ── the LIVING CAMERA (render-only): a soft drift toward the party's center of
//    mass, a punch-in behind boss cards, a zoom pulse on the wave's final kill,
//    and directional KICKS on heavy blows (a statement, not a wobble — distinct
//    from shake's noise). Updated once per loop call (= per sim tick, so the
//    60/120Hz cadence draw-stream comparison holds), consumes no rnd(), and is
//    skipped wholesale under reduced motion. The sim never reads it. ──
let cam = { x: 0, y: 0, kx: 0, ky: 0, zoom: 1, pulse: 0, prevBreather: 0 };
// ── HIT-STOP (sim-side, deterministic): heavy impacts hold the world for a beat.
//    Set by kills/blows with Math.max semantics (a multi-kill punctuates, never
//    stutters), capped at 14 ticks. tick still advances and the feeders keep
//    running (the `paused` precedent), so netplay lockstep and replays carry it
//    bit-exactly — it IS gameplay, folded into sim v4. ──
let hitStop = 0;
// ── ATMOSPHERE II (render-only buffers, written by sim events like camKick —
//    deterministic per tick, never read by the sim) ──
let decals = [];       // ground memory: { x, y, kind:'ash'|'scorch'|'frost', t0 } — the field remembers
const DECAL_MAX = 90;
let fieldWash = null;  // one full-field event light wash: { rgb, a, t, T } (Excalibur, powerups, a hero falling)
let dreadF = 0;        // eased 0..1 — the Nine/Witch-king snuff the field's warmth (see drawBattlefield)
let killsByType = {};
let trampleN = 0;      // this run's tramples (the TRAMPLER trophy)
// ── PLAYER OPTIONS (persisted; strictly presentation — the iron rule: options
//    change what you SEE, never what the sim DOES, same as reduceMotion) ──
let sfOpts = { shake: 1, kick: 1, flash: 1, hiVis: false };
try {
  const so = JSON.parse(localStorage.getItem('ilaird_sf_opts') || '{}');
  if (typeof so.shake === 'number') sfOpts.shake = clamp(so.shake, 0, 1);
  if (typeof so.kick === 'number') sfOpts.kick = clamp(so.kick, 0, 1);
  if (typeof so.flash === 'number') sfOpts.flash = clamp(so.flash, 0, 1);
  sfOpts.hiVis = !!so.hiVis;
} catch (_) { /* private mode */ }
function saveOpts() { try { localStorage.setItem('ilaird_sf_opts', JSON.stringify(sfOpts)); } catch (_) {} }
// the PAUSE/settings overlay: solo & couch runs truly pause (recorded as opcode
// 13, so replays hold the same beats); online it is an overlay over a live sim
let shellMenu = false, shellSel = 0;
function shellToggle() { shellMenu = !shellMenu; if (!netplay) paused = shellMenu; }  // sim state (v4): per-type kill tally — feeds the results ceremony
let hurtFlash = null;  // { dx, dy, t } — a red edge flash from the DIRECTION of the last blow (render-only)
function addDecal(x, y, kind) {
  decals.push({ x, y, kind, t0: tick });
  if (decals.length > DECAL_MAX) decals.shift();
}
function fieldWashSet(rgb, a, T) { fieldWash = { rgb, a, t: 0, T }; }
let menuTop = 0, subSingle = 0, subMulti = 0;
const isLocalMulti = () => menuTop === 1 && subMulti === 0;
const P2_COL    = '#8fe388';   // P2's stick figure — a soft green, distinct from white P1 and enemy red
const P3_COL    = '#7fd8ff';   // P3 — sky blue
const P4_COL    = '#f0a5ff';   // P4 — orchid
const SEAT_COLS = ['#ffffff', P2_COL, P3_COL, P4_COL];   // hero body color by seat
const REVIVE_T  = 150;         // frames a partner must stand by a downed hero to revive them (~2.5s)
// ── hero classes (chosen on the intro screen; persist across R-restarts & visits) ──
//   melee  = the classic kit, unchanged (sword in the stone / lightsaber pickups)
//   ranged = the bow is always strung — the attack key looses arrows at the nearest foe
//   caster = the attack key hurls arcing lightning; SORCERY adds auto-cast nova & fireball
//   Each hero picks independently in co-op; each class has its own upgrade tree.
const CLASSES   = ['melee', 'ranged', 'caster', 'necro', 'dragoon', 'wyrm', 'rider'];
const CLASS_ICON = { melee: '⚔', ranged: '🏹', caster: '✨', necro: '💀', dragoon: '🐉', wyrm: '🐲', rider: '🏇' };
// wyrm+rider are a PAIRED, CO-OP-ONLY pick (see WYRM & RIDER below): they never
// appear in solo class cycling, and picking the wyrm on P1 binds P2 to the rider.
const PAIR_WYRM = 5, PAIR_RIDER = 6;
const ARROW_SPD = 7.4;   // player arrows fly this fast (px/tick)
const ZAP_R     = 170;   // arcane bolt reaches this far — deliberately short; position matters
const ZAP_HOP   = 180;   // each chain jump reaches this far
const CAST_T    = 14;    // fallback incantation length (each spell carries its own `cast`)
const NOVA_R    = 130;   // frost nova ring (smaller than the powerup's FROST_R)
const FIREB_R   = 120;   // fireball blast (smaller than the powerup's FIRE_R)
const FIRE_TGT_R = 210;  // how far a fireball can be hurled
const STORM_R    = 240;  // the tempest's first arc reaches this far
const STORM_HOP  = 200;  // ...and leaps this far between marks
const MANA_MAX   = 100;  // the wizard's base pool
const MANA_REGEN = 0.15; // mana per tick (9/s) — casting clearly outruns it (a bolt cycle
                         // regens ~9 of its 18 cost); kill sparks / Overcharge / Font of
                         // Power are what sustain a barrage. Was 0.25, which paid for
                         // bolt-spam all by itself (sim-balance change → v4)
const MANA_HOLD  = 40;   // ticks the well HOLDS ITS BREATH after each cast (~0.7s): while
                         // chain-casting there is effectively no trickle at all — the pool
                         // and kill sparks are everything, and the regen only flows in the
                         // spaces between casts. Mana should feel precious. (v4)
/* the wizard's SPELLBOOK: the attack key casts the SELECTED page (the cycle key
   turns pages — C solo, '.' for P1 / E for P2 in co-op). Every cast drinks mana
   up front; each kill sparks +4 back, so bold play sustains itself. The deeper
   pages unlock in the SORCERY tree (nova/fireball/tempest → up.spells). */
const SPELLS = {
  bolt:  { name: 'ARCANE BOLT', icon: '⚡', cost: 18, cast: 14, col: '#ce93d8' },
  nova:  { name: 'FROST NOVA',  icon: '❄',  cost: 34, cast: 10, col: '#80deea' },
  fire:  { name: 'FIREBALL',    icon: '☄',  cost: 46, cast: 20, col: '#ff8a3c' },
  storm: { name: 'TEMPEST',     icon: '🌩', cost: 70, cast: 26, col: '#b39ddb' },
};
/* the necromancer: one key, two verbs — the soul SCYTHE reaps the living in a
   wide arc, and any HUSK caught in the sweep RISES as a minion (souls permitting).
   Grunts felled while a necromancer stands leave husks; kills feed the soul well.
   Minions hunt the horde and body-block it (hordeTarget treats them as bait);
   a boss room banishes the lot — "your dead abandon you". */
const SCYTHE_R   = 82;    // the reaping arc's reach
const RAISE_R    = 90;    // a husk this close (and in front) joins the sweep's raise
const SOULS_MAX  = 100;
const SOUL_KILL  = 6;     // souls per scythe kill (Reaper adds 3)
const SOUL_MKILL = 3;     // souls per kill a minion lands
const HUSK_T     = 620;   // ticks a husk lingers before crumbling
const MINION_T   = 1400;  // a raised minion's lifespan (~21s)
const HUSK_CAP   = 12;    // the field never drowns in husks
const NECRO_COL  = '#64ffda';  // soul-fire teal (distinct from P2's soft green)

/* the dragoon: pure arcade JOUST — your speed IS the weapon. Every foe carries a
   SKEWER BAR (px/tick); meet it inside lance reach, flying roughly AT it, and the
   lance takes it. Below the bar — or struck from the flank/behind — the ordinary
   touch-death contact rules apply untouched: you get the skewer or you die.
   The attack key is a WING FLAP (a velocity impulse, not a weapon); a foe that
   SURVIVES a lance pass (troll, boss) caroms the rider off, Joust-style, so
   momentum never carries you into a body you only wounded. */
const DRAGOON_COL = '#ffa726'; // ember-orange: wings, pennon, the momentum bar
const LANCE_R    = 26;    // lance reach past the body-contact radius (the joust window)
const FLAP_IMP   = 3.0;   // wing-flap impulse (px/tick) along the facing
const FLAP_CD    = 14;    // ticks between flaps
const DRAG_CAP   = 6.4;   // the dragoon's speed cap (everyone else caps at 4.3)
const JOUST_BAR  = {      // per-foe skewer bars — the Joust rider tiers
  goblin: 3.2, archer: 3.2, shaman: 3.2, bomber: 3.2, trooper: 3.2,
  wolf: 4.2, wraith: 4.6, guard: 4.6, troll: 5.2, ogre: 5.6,
  witchking: 4.6, vader: 4.6, sidious: 4.6, dio: 4.6,
};
const JOUST_ELITE = 0.5, JOUST_DREAD = 0.9;   // elites raise their bar; dread more

/* WYRM & RIDER — the co-op PAIR: two players, one creature. P1 IS the beast
   (wyrm): dragoon momentum physics on a bigger body, and its contact resolves by
   the same joust rules — at speed it TRAMPLES through the pack, caught slow it
   takes the hit. P2 sits the saddle (rider): their movement keys become an 8-way
   TURRET AIM (never steering), their attack key jabs a lance along the aim, and
   their spell-cycle key (E) breathes FIRE — spending the shared HEAT gauge that
   only tramples and lance kills fill. The beast earns, the rider spends; neither
   can do both, which is the whole point. Downs ride the existing model: a struck
   rider is THROWN (an on-foot hero until remounted), a felled wyrm dumps the
   rider to fight standing over the body; standing close revives/remounts. */
const WYRM_R      = 8;    // extra body radius over PLAYER_R (contact + trample reach)
const HEAT_MAX    = 100;
const HEAT_TRAMPLE = 12;  // heat per trample kill (the wyrm earns)
const HEAT_LANCE  = 6;    // heat per lance kill (the rider tops up)
const BREATH_COST = 55;   // fire breath drinks over half the gauge
const BREATH_R    = 150;  // the cone's reach
const RIDER_SADDLE = 26;  // the rider sits this far above the wyrm's center

// ── trophies — the trophy case: SF_ACH, persistence, sfUnlock, toasts, the T-panel ──
/* ── the TROPHY CASE: Stick Fighter's own in-game achievement system ──
   Persisted account-wide in `ilaird_sf_trophies` (deliberately NOT per class
   profile). sfUnlock() is idempotent, no-ops during a watched replay, queues a
   little gold toast (drawn on every screen), and when the case is FULL reports
   the single `sf-platinum` egg to the site — the portfolio tracks only the
   doorway in (`stick-fighter`, on boot) and the platinum. Trophies that spoil
   a boss or an ending are `secret` (the case shows 🔒 ??? until earned). */
const SF_ACH = [
  { id: 'first_blood', name: 'FIRST BLOOD',            desc: 'slay your first foe' },
  { id: 'wave_5',      name: 'WARBAND BROKEN',         desc: 'reach wave 5' },
  { id: 'wave_10',     name: 'DOUBLE DIGITS',          desc: 'reach wave 10' },
  { id: 'excalibur',   name: 'THE SWORD IN THE STONE', desc: 'pull Excalibur free' },
  { id: 'summoner',    name: "CHAMPION'S CALL",        desc: 'summon your first ally' },
  { id: 'fellowship',  name: 'THE FELLOWSHIP',         desc: 'three allies afield at once' },
  { id: 'capstone',    name: 'ASCENDED',               desc: 'buy a capstone upgrade' },
  { id: 'score_10k',   name: 'HIGH ROLLER',            desc: 'score 10,000 in one run' },
  { id: 'coop',        name: 'IT TAKES TWO',           desc: 'begin a co-op run' },
  { id: 'daily',       name: 'CREATURE OF HABIT',      desc: 'finish a daily challenge' },
  { id: 'tempest',     name: 'STORMCALLER',            desc: 'call down the TEMPEST' },
  { id: 'army_4',      name: 'LORD OF THE DEAD',       desc: 'field four minions at once' },
  { id: 'ogre',        name: 'OGRE-SLAYER',            desc: 'slay the War-Ogre',               secret: true },
  { id: 'witch_king',  name: 'I AM NO MAN',            desc: 'fell the Witch-king of Angmar',   secret: true },
  { id: 'vader',       name: 'THE DARK LORD FALLS',    desc: 'strike down Darth Vader',         secret: true },
  { id: 'sidious',     name: 'UNLIMITED POWER, UNPLUGGED', desc: 'end the Emperor',             secret: true },
  { id: 'dio',         name: 'ZA WARUDO',              desc: 'turn DIO to dust',                secret: true },
  { id: 'ian_spare',   name: 'MERCY',                  desc: 'spare the creator',               secret: true },
  { id: 'ian_kill',    name: 'NO MERCY',               desc: 'strike the creator down',         secret: true },
  { id: 'hard_5',      name: 'THE PRICE OF MERCY',     desc: 'reach wave 5 in hard mode',       secret: true },
  // the hard set — trophies for the players who want to bleed for them
  { id: 'unscathed',   name: 'UNSCATHED',              desc: 'break five waves without taking a single blow' },
  { id: 'swift',       name: 'SWIFT DOOM',             desc: 'reach wave 5 inside three minutes' },
  { id: 'deep_15',     name: 'INTO THE DARK',          desc: 'reach wave 15 — the endless dark stares back',                      secret: true },
  { id: 'dark_hour',   name: 'DARKEST HOUR',           desc: 'fell the Witch-king in hard mode',                                  secret: true },
  { id: 'daily_crown', name: 'LEGEND OF THE DAY',      desc: "top today's daily board" },
  { id: 'wolf_100',    name: 'WOLFSBANE',              desc: 'put down 100 frost wolves' },
  { id: 'the_weight',  name: 'THE WEIGHT OF IT',       desc: "hold the creator's fate for a full minute before deciding",         secret: true },
  { id: 'hoisted',     name: 'HOISTED',                desc: 'bait a powder keg into blowing up a goblin shaman',                 secret: true },
  { id: 'skewered',    name: 'SKEWERED',               desc: 'run a troll through at full gallop' },
  { id: 'trampler',    name: 'TRAMPLER',               desc: 'trample fifteen foes in one ride' },
  { id: 'dragonfire',  name: 'DRAGONFIRE',             desc: 'burn four foes with a single breath' },
  { id: 'pair_bond',   name: 'BEAST AND BRAVE',        desc: 'carry the pair to wave 4' },
];
const SF_ACH_KEY = 'ilaird_sf_trophies';
const sfTrophies = (() => {
  const known = new Set(SF_ACH.map(a => a.id));
  let ids = [];
  try { ids = JSON.parse(localStorage.getItem(SF_ACH_KEY) || '[]'); } catch (_) { /* a fresh case */ }
  const s = new Set(Array.isArray(ids) ? ids.filter(id => known.has(id)) : []);
  // migration: these five lived on the SITE's egg list before the case existed
  try {
    const old = JSON.parse(localStorage.getItem('ilaird_eggs') || '[]');
    const map = { excalibur: 'excalibur', 'ogre-slayer': 'ogre', 'witch-king': 'witch_king', 'dark-lord': 'vader', 'world-stopper': 'dio' };
    for (const [egg, tid] of Object.entries(map)) if (Array.isArray(old) && old.includes(egg)) s.add(tid);
  } catch (_) { /* nothing to migrate */ }
  return s;
})();
let sfToasts = [];        // {name, t} — the gold cards, drawn over every screen
let showTrophies = false; // the intro's trophy case panel (T toggles it)
let runFlawless = true;   // no blow has connected this run (reset in init; see strike)
let bn = null;            // per-run boon effects (rebuilt in init — see BOONS)
let boonMenu = null;      // an open 1-of-3 boon offer (pauses the sim while it stands)
// WOLFSBANE's lifetime ledger — replay-gated at the increment, like every save
let wolfKills = 0;
try { wolfKills = parseInt(localStorage.getItem('ilaird_sf_wolfkills') || '0', 10) || 0; } catch (_) { /* fresh hunt */ }
function sfUnlock(id) {
  if (noPersist() || sfTrophies.has(id)) return;   // a watched or online run earns nothing here
  const a = SF_ACH.find(x => x.id === id);
  if (!a) return;
  sfTrophies.add(id);
  try { localStorage.setItem(SF_ACH_KEY, JSON.stringify([...sfTrophies])); } catch (_) {}
  sfToasts.push({ name: a.name, t: 230 });
  sfSfx.coin();
  if (sfTrophies.size === SF_ACH.length) unlockAchievement('sf-platinum');   // the case is full — the site's platinum egg
}
// the toast rail: small gold cards under the HUD, fading in/out (a fade, never a
// flash — reduced-motion safe). Called from every render path, so a trophy earned
// in the same beat you die still shows over the death screen.
function drawTrophyToasts() {
  if (!sfToasts.length) return;
  ctx.save();
  ctx.textAlign = 'center';
  let ty = 74;
  for (let i = 0; i < sfToasts.length; i++) {
    const tst = sfToasts[i];
    tst.t--;
    const a = Math.max(0, Math.min(1, tst.t / 26, (230 - tst.t) / 14));
    const w = 320, x = GW / 2 - w / 2;
    ctx.globalAlpha = a * 0.92;
    ctx.fillStyle = '#141007';
    roundRectPath(x, ty, w, 34, 8); ctx.fill();
    ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 1.5;
    roundRectPath(x, ty, w, 34, 8); ctx.stroke();
    ctx.globalAlpha = a;
    ctx.font = 'bold 9px Tahoma,Arial'; ctx.fillStyle = '#c9a227';
    ctx.fillText('🏆 TROPHY EARNED', GW / 2, ty + 12);
    ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
    ctx.fillText(tst.name, GW / 2, ty + 27);
    ty += 42;
  }
  sfToasts = sfToasts.filter(t => t.t > 0);
  ctx.restore(); ctx.globalAlpha = 1; ctx.textAlign = 'left';
}
// the case itself — an overlay on the intro screen (T toggles): every trophy as a
// row, secrets masked until earned
function drawTrophyCase() {
  ctx.save();
  ctx.fillStyle = 'rgba(2,4,8,0.88)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillText('🏆 TROPHY CASE', GW / 2, 46);
  ctx.font = 'bold 12px Tahoma,Arial';
  ctx.fillStyle = sfTrophies.size === SF_ACH.length ? '#7CFC8A' : '#9fb0c0';
  ctx.fillText(sfTrophies.size + ' / ' + SF_ACH.length +
               (sfTrophies.size === SF_ACH.length ? '  —  PLATINUM' : ''), GW / 2, 66);
  ctx.shadowBlur = 0;
  const perCol = Math.ceil(SF_ACH.length / 2);
  const colW = Math.min(360, (GW - 60) / 2);
  const rowH = Math.max(24, Math.min(34, Math.floor((GH - 140) / perCol)));
  ctx.textAlign = 'left';
  for (let i = 0; i < SF_ACH.length; i++) {
    const a = SF_ACH[i];
    const got = sfTrophies.has(a.id);
    const col = Math.floor(i / perCol);
    const x = GW / 2 - colW + 10 + col * colW;
    const y = 92 + (i % perCol) * rowH;
    ctx.font = 'bold 12px Tahoma,Arial';
    ctx.fillStyle = got ? '#ffd24d' : '#5c6773';
    ctx.fillText((got ? '🏆 ' : '🔒 ') + (got || !a.secret ? a.name : '? ? ?'), x, y);
    if (got || !a.secret) {
      ctx.font = '10px Tahoma,Arial'; ctx.fillStyle = got ? '#bfae7a' : '#49525c';
      ctx.fillText(a.desc, x + 18, y + 12);
    }
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('T — close the case', GW / 2, GH - 22);
  ctx.restore(); ctx.textAlign = 'left';
}

// ── boons — per-run boons and hard-mode banes: tables, offer roll, menus, panel ──
/* ── BOONS: per-run blessings, chosen 1-of-3 at three moments — the run's start,
   the Witch-king's fall, and Ian's mercy. Ephemeral by design (nothing persists;
   `bn`, each hero's `h.bn`, and any `up` tweaks rebuild each init). IN CO-OP THE
   PICKS ARE PERSONAL: each moment runs TWO menus back-to-back — P1 picks first,
   then P2 — and each player's offer is drawn only from the shared six plus THEIR
   OWN class's boons. Personal effects (Fleet Foot, Deathward, the bn.* class
   perks) land on the picker's `h.bn`; party-economy boons (`global: true` —
   Golden Touch, War Horn, King's Tithe, Bounty) affect the whole run and are
   spent once for the party (they never re-offer once anyone holds them). Class
   boons that tune shared `up.*` fields help every hero of that class — a
   same-class duo can stack them, one pick each. Offers are rolled with rnd()
   (pure function of the seed + roll position); each PICK is sim input, recorded
   as opcode 12 in the same between-tick slot as a shop buy (two events per
   moment in co-op — the feeder replays the chain identically). ONLINE, each
   menu belongs to its seat: the host confirms P1's, the JOINER confirms P2's
   (the one client-authoritative event — see netHandle 'ev'). The run-start menu
   opens SYNCHRONOUSLY in the begin/R/startReplay handlers right after init(). */
const BOONS = [
  { id: 'fleet_foot', name: 'FLEET FOOT',    icon: '👟', desc: 'YOU run 12% faster',                    apply: (h) => { h.bn.spd = 1.12; } },
  { id: 'deathward',  name: 'DEATHWARD',     icon: '💖', desc: 'YOU cheat death once this run',         apply: (h) => { h.bn.cheatDeath = true; } },
  { id: 'gold_touch', name: 'GOLDEN TOUCH',  icon: '🪙', desc: 'coins pay double meter, +25 score',     global: true, apply: () => { bn.gold = true; } },
  { id: 'war_horn',   name: 'WAR HORN',      icon: '📯', desc: 'ally meter charges 50% faster', global: true, apply: () => { up.meterMul *= 1.5; } },
  { id: 'tithe',      name: "KING'S TITHE",  icon: '👑', desc: 'story bosses pay double tokens',        global: true, apply: () => { bn.tithe = true; } },
  { id: 'bounty',     name: 'BOUNTY',        icon: '💰', desc: 'every kill scores +5 (before multiplier)', global: true, apply: () => { bn.bounty = 5; } },
  { id: 'giants_arc', name: "GIANT'S ARC",   icon: '⭕', desc: 'the blade sweeps 25% wider',   cls: 'melee',  apply: () => { up.swingR = Math.round(up.swingR * 1.25); } },
  { id: 'berserk',    name: 'BERSERKER',     icon: '⚡', desc: 'swings come 30% faster',       cls: 'melee',  apply: () => { up.swingMs = Math.round(up.swingMs * 0.7); } },
  { id: 'keen_legacy',name: 'KEEN LEGACY',   icon: '⌛', desc: 'Excalibur burns 50% longer', cls: 'melee', apply: () => { up.swordMul *= 1.5; } },
  { id: 'twin_fang',  name: 'TWIN FANG',     icon: '🔱', desc: 'one more arrow per volley',    cls: 'ranged', apply: () => { up.shotCount += 1; } },
  { id: 'piercer',    name: 'PIERCER',       icon: '🎯', desc: 'arrows pierce one more foe',   cls: 'ranged', apply: () => { up.shotPierce += 1; } },
  { id: 'hunters_pace',name:'HUNTER\'S PACE',icon: '🏹', desc: 'loose arrows 30% faster',      cls: 'ranged', apply: () => { up.shotMs = Math.round(up.shotMs * 0.7); } },
  { id: 'bottomless', name: 'BOTTOMLESS WELL',icon:'🔮', desc: '+50 mana to the pool',         cls: 'caster', apply: () => { up.manaMax += 50; } },
  { id: 'siphon',     name: 'SIPHON',        icon: '✨', desc: 'soul sparks return double mana', cls: 'caster', apply: (h) => { h.bn.sparks2 = true; } },
  { id: 'flicker',    name: 'FLICKER CAST',  icon: '💫', desc: 'incantations 40% shorter',     cls: 'caster', apply: (h) => { h.bn.castMul = 0.6; } },
  { id: 'harvest',    name: 'GRAVE HARVEST', icon: '🌾', desc: '+3 souls from every kill',     cls: 'necro',  apply: (h) => { h.bn.soulBonus = 3; } },
  { id: 'legion',     name: 'ONE MORE',      icon: '🧟', desc: 'command one more minion',      cls: 'necro',  apply: () => { up.minionCap += 1; } },
  { id: 'restless',   name: 'RESTLESS',      icon: '⚰️', desc: 'minions endure 50% longer', cls: 'necro', apply: (h) => { h.bn.minionMul = 1.5; } },
  { id: 'gale',       name: 'GALE',          icon: '🌪️', desc: 'the wind at your back — 8% higher top speed', cls: 'dragoon', apply: () => { up.dragCap *= 1.08; } },
  { id: 'shrill_cry', name: 'SHRILL CRY',    icon: '🦅', desc: 'a skewer kill scatters the nearby pack', cls: 'dragoon', apply: (h) => { h.bn.cry = true; } },
  { id: 'broad_pennon',name:'BROAD PENNON',  icon: '🚩', desc: 'the lance reaches 10 farther',  cls: 'dragoon', apply: () => { up.lanceR += 10; } },
  { id: 'hot_blood',   name: 'HOT BLOOD',     icon: '🔥', desc: 'tramples earn +6 heat',          cls: 'wyrm',  apply: () => { up.heatTrampleB += 6; } },
  { id: 'iron_pinions',name: 'IRON PINIONS',  icon: '🪽', desc: 'the wings beat far more often',  cls: 'wyrm',  apply: () => { up.flapCd = Math.min(up.flapCd, 10); } },
  { id: 'broad_back',  name: 'BROAD BACK',    icon: '🐲', desc: 'remount from 20 farther away',   cls: 'wyrm',  apply: () => { up.remountR += 20; } },
  { id: 'kindled',     name: 'KINDLED',       icon: '🕯️', desc: 'fire breath costs 10 less heat', cls: 'rider', apply: () => { up.breathCost = Math.max(30, up.breathCost - 10); } },
  { id: 'lancers_eye', name: "LANCER'S EYE",  icon: '🎯', desc: 'the saddle jab reaches 14 farther', cls: 'rider', apply: () => { up.riderReach += 14; } },
  { id: 'fireheart',   name: 'FIREHEART',     icon: '❤️‍🔥', desc: 'the heat gauge holds 30 more', cls: 'rider', apply: () => { up.heatMax += 30; } },
];
/* BANES — hard mode's answer to boons: no gifts at all, and the run OPENS by
   choosing one burden instead (1-of-3, same menu/opcode machinery — bane ids
   live in the same pick namespace, so opcode 12 and the worker regex cover
   them unchanged). All shared, all painful, all fair. */
const BANES = [
  { id: 'lead_boots', name: 'LEAD BOOTS',     icon: '🥾', desc: 'run 12% slower',                       apply: () => { bn.spd = 0.88; } },
  { id: 'dull_arms',  name: 'DULLED ARMS',    icon: '🪨', desc: 'attacks recover 25% slower',           apply: () => { up.swingMs = Math.round(up.swingMs * 1.25); up.shotMs = Math.round(up.shotMs * 1.25); up.zapMs = Math.round(up.zapMs * 1.25); up.scytheMs = Math.round(up.scytheMs * 1.25); } },
  { id: 'heavy_toll', name: 'HEAVY TOLL',     icon: '⚖️', desc: 'every upgrade costs one more token',   apply: () => { bn.toll = 1; } },
  { id: 'marked',     name: 'MARKED',         icon: '🎯', desc: 'the horde walks 8% faster',            apply: () => { bn.foeSpd = 1.08; } },
  { id: 'blood_price',name: 'BLOOD PRICE',    icon: '🩸', desc: 'summons cost 50% more',      apply: () => { up.summonCost = Math.round(up.summonCost * 1.5); } },
  { id: 'miser',      name: "MISER'S CURSE",  icon: '🕳️', desc: 'coins feed the ally meter nothing',    apply: () => { bn.miser = true; } },
];
function rollBoonOffer(pool) {
  const opts = [];
  while (opts.length < 3 && pool.length) opts.push(pool.splice(Math.floor(rnd() * pool.length), 1)[0]);
  return opts;
}
// each hero's PERSONAL boon effects + pick history — rebuilt every init alongside
// the global (bane/party-economy) `bn`
function resetHeroBn(h) {
  h.bn = { picked: [], spd: 1, cheatDeath: false, sparks2: false, castMul: 1, soulBonus: 0, minionMul: 1, cry: false };
}
function boonPicker(who) { return heroesAll()[who | 0] || player; }
function openBoonMenu(title, who = 0) {
  const picker = boonPicker(who);
  // YOUR offer only: the shared six plus your own class's boons, no repeats.
  // Party-wide (`global`) boons are spent once for everyone; personal ones per picker.
  const taken = (b) => b.global
    ? heroesAll().some(h => h.bn.picked.includes(b.id))
    : picker.bn.picked.includes(b.id);
  const opts = rollBoonOffer(BOONS.filter(b => (!b.cls || b.cls === picker.cls) && !taken(b)));
  if (!opts.length) {                       // this picker's pool ran dry — try the next seat
    if (coop && who + 1 < heroesAll().length) openBoonMenu(title, who + 1);
    return;
  }
  boonMenu = { sel: 0, opts, title, who };
  paused = true;
  sfSfx.wave();
}
function openBaneMenu(title) {
  const opts = rollBoonOffer(BANES.filter(b => !player.bn.picked.includes(b.id)));
  if (!opts.length) return;
  boonMenu = { sel: 0, opts, title, bane: true, who: 0 };
  paused = true;
  sfSfx.charge();
}
function pickBoon(id) {
  if (!boonMenu) return;
  const b = boonMenu.opts.find(o => o.id === id);
  if (!b) return;
  const bane = !!boonMenu.bane;
  const who = boonMenu.who | 0;
  const title = boonMenu.title;
  const picker = boonPicker(who);
  picker.bn.picked.push(b.id);
  b.apply(picker);
  banner = (coop && !bane ? 'P' + (who + 1) + ' · ' : '') + b.icon + ' ' + b.name + (bane ? ' — your burden' : '');
  bannerSub = b.desc; bannerT = 110;
  boonMenu = null; paused = false; keys = {};
  bane ? sfSfx.thud() : sfSfx.sword();
  // co-op: the next seat picks — their OWN offer, their OWN confirm
  if (!bane && coop && who + 1 < heroesAll().length) openBoonMenu(title, who + 1);
}
function drawBoonPanel() {
  const m = boonMenu;
  ctx.save();
  ctx.fillStyle = m.bane ? 'rgba(8,0,0,0.85)' : 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  ctx.fillStyle = m.bane ? '#ff6e6e' : '#ffd24d'; ctx.font = 'bold 26px Tahoma,Arial';
  ctx.fillText(m.title, GW / 2, Math.round(GH * 0.24));
  ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(m.bane ? 'hard mode offers no gifts — carry one burden'
             : coop ? 'PLAYER ' + ((m.who | 0) + 1) + ' — this one is yours alone'
             : 'this run only — choose well', GW / 2, Math.round(GH * 0.24) + 24);
  ctx.shadowBlur = 0;
  const cw = Math.min(210, (GW - 80) / 3), chh = 150, gap = 18;
  const x0 = GW / 2 - (cw * m.opts.length + gap * (m.opts.length - 1)) / 2;
  const cy = Math.round(GH * 0.36);
  for (let i = 0; i < m.opts.length; i++) {
    const b = m.opts[i], hot = i === m.sel;
    const x = x0 + i * (cw + gap), y = cy - (hot ? 8 : 0);
    const accent = m.bane ? '#ff6e6e' : b.cls ? { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL }[b.cls] : '#e8eef4';
    ctx.fillStyle = hot ? 'rgba(28,24,10,0.96)' : 'rgba(12,16,22,0.92)';
    roundRectPath(x, y, cw, chh, 10); ctx.fill();
    if (hot) { ctx.shadowColor = accent; ctx.shadowBlur = api.reduceMotion ? 12 : 10 + 4 * Math.sin(frame * 0.1); }
    ctx.strokeStyle = hot ? accent : 'rgba(120,140,160,0.4)'; ctx.lineWidth = hot ? 2.5 : 1.5;
    roundRectPath(x, y, cw, chh, 10); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '34px Tahoma,Arial';
    ctx.fillText(b.icon, x + cw / 2, y + 52);
    ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = hot ? accent : '#aeb9c4';
    ctx.fillText(b.name, x + cw / 2, y + 80);
    ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = hot ? '#d8e0e8' : '#77828c';
    // wrap the one-line desc onto two centred lines if it runs long
    const words = b.desc.split(' ');
    let l1 = '', l2 = '';
    for (const w of words) { if (l2 || (l1 + ' ' + w).trim().length > 26) l2 = (l2 + ' ' + w).trim(); else l1 = (l1 + ' ' + w).trim(); }
    ctx.fillText(l1, x + cw / 2, y + 102);
    if (l2) ctx.fillText(l2, x + cw / 2, y + 116);
    if (b.cls) {
      ctx.font = 'bold 9px Tahoma,Arial'; ctx.fillStyle = accent;
      ctx.fillText(CLASS_ICON[b.cls] + ' ' + b.cls.toUpperCase(), x + cw / 2, y + chh - 12);
    }
  }
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('◀ ▶ choose   ·   Z / Enter — take it', GW / 2, cy + chh + 40);
  ctx.restore(); ctx.textAlign = 'left';
}

// ── init — init()/setupCoop(), daily seed, pend, hero/target helpers (hordeTarget, bossTarget) ──
const SHAMAN_R  = 120;   // the goblin shaman's ritual circle — haste + troll-mending reach
const KEG_R     = 42;    // the bombardier's powder-keg blast radius
const KEG_AIR   = 62;    // ticks a lobbed keg hangs in the air (the dodge window)
let classSel  = clamp(parseInt(localStorage.getItem('ilaird_sf_cls')  || '0', 10) || 0, 0, CLASSES.length - 1);
let classSel2 = clamp(parseInt(localStorage.getItem('ilaird_sf_cls2') || '0', 10) || 0, 0, CLASSES.length - 1);
// HARD MODE — unlocked forever by sparing Ian (finishIanSpare). Once earned it's a
// CHOICE on the intro (SINGLEPLAYER → ☠ HARD): enemy types arrive a wave early,
// elites stalk from wave 1, the support pieces join at 4/6. DAILY runs stay normal
// (one shared sim for the board), online runs stay normal too, and replays carry
// the flag in their header (`hd`) so they re-sim correctly.
let hardUnlocked = false;
try { hardUnlocked = localStorage.getItem('ilaird_sf_hard') === '1'; } catch (_) { /* private mode */ }
let hardMode = false;   // this RUN is hard (set per run in init — daily/replay aware)
let hardSel = false;    // the intro's difficulty pick (only honored once hardUnlocked)
let introRow = 0;   // intro chooser row: 0 = SINGLE/MULTI, 1 = the sub row, 2 = P1 class, 3 = P2 class (LOCAL only)
let introConfirm = false;   // couch co-op party sheet: begin shows it, a second Z/Enter starts (Q/Backspace backs out)
// ── per-tick input capture ──
// Edge-triggered combat inputs (dash / attack / summon / choke-mash) are QUEUED here
// by the keydown handler and consumed at the top of the next sim tick — the sim never
// mutates from inside a DOM event. Together with the held-key `keys` object (read once
// per tick in loop()), this is the sim's complete input surface for one tick: a future
// recorder captures {keys, pend} per tick; a replayer / lockstep peer injects them.
let pend = null;   // built by resetPend() in init()
function resetPend() {
  // summon2 is netplay-only (the client's summon, applied after the host's so the
  // shared meter spends in a deterministic order) — solo/replay never set it
  pend = { dashP1: false, atkP1: false, dashP2: false, atkP2: false, cycleP1: false, cycleP2: false,
           dashP3: false, atkP3: false, cycleP3: false, dashP4: false, atkP4: false, cycleP4: false,   // online war-band seats
           summon: null, summon2: null, summon3: null, summon4: null, prompt: false, mash: 0 };
}
// ── daily challenge ──
// One shared seed per UTC day: everyone who picks DAILY plays the identical run
// and competes on that day's own leaderboard (`lb#sf#<day>` in hal-worker, read
// via GET /scores?day=…, written via POST /score with a `day` field).
function dailyDayStr() { return new Date().toISOString().slice(0, 10).replace(/-/g, ''); }  // e.g. '20260712' (UTC)
function dailyDayPretty() { const d = dailyDayStr(); return d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6); }
function dailySeed() {
  const s = 'sf-daily-' + dailyDayStr();
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function init() {
  // the wyrm & rider are a co-op-only PAIR — a stale localStorage pick (or any
  // other path into a solo run) falls back to the classic kit, and a paired P1
  // always binds P2 (selection normally enforces this; this is the belt)
  if (!coop && classSel >= PAIR_WYRM) classSel = 0;
  if (classSel === PAIR_WYRM) classSel2 = PAIR_RIDER;
  else if (classSel2 >= PAIR_WYRM) classSel2 = 0;
  // Seed the run. sfSeedOverride lets a future MP handshake pin a shared seed;
  // otherwise we draw fresh entropy (Math.random/Date.now here is the ONE
  // intentional non-deterministic input — it picks the seed, then never again).
  sfSeed = (sfSeedOverride != null)
    ? (sfSeedOverride >>> 0)
    : (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
  sfRng = (typeof makeRng === 'function') ? makeRng(sfSeed) : Math.random;  // fall back if lib/rng.js failed to load
  tick = 0;
  player = { x: GW / 2, y: GH / 2, vx: 0, vy: 0, phase: 0,
             fx: 1, fy: 0, dashT: 0, dashCd: 0, stunT: 0, choke: 0, chokeBreak: 0, iframe: 0, shield: false,
             swingT: 0, swingReadyTick: 0, swordT: 0, heldSaber: false, down: false, downT: 0, reviveT: 0,
             cls: CLASSES[classSel], castT: 0, castMax: 0, casting: null, mana: 0, spellSel: 0, souls: 25, chillT: 0,
             manaHoldTick: 0, flapReadyTick: 0, flapT: -99 };
  p2 = null; p3 = null; p4 = null;
  enemies = []; warns = []; coins = []; powerups = []; blasts = []; sparks = []; ghosts = [];
  bolts = []; arrows = []; kegs = []; minions = []; husks = [];
  score = 0; mult = 1; wave = 1; alive = true; started = false; frame = 0;
  keys = {}; freezeT = 0; banner = ''; bannerSub = ''; bannerT = 0;
  deadT = 0; shake = 0; newBest = false;
  stone = null; stoneCd = 150; stoneSeen = false;
  meter = 0; meterPrompted = false; allies = []; kills = 0; heat = 0; killsByType = {}; trampleN = 0;
  camTape = []; killCam = null; camVictim = null;
  cam = { x: 0, y: 0, kx: 0, ky: 0, zoom: 1, pulse: 0, prevBreather: 0 };
  hitStop = 0;
  decals = []; fieldWash = null; dreadF = 0; hurtFlash = null;
  nineActive = false; nineDone = false; wraithsLeft = 0;
  waveQuota = bandScale(11); breatherT = 0;   // the opening war band scales with the party
  corpses = []; bossActive = false;
  bossRiseT = 0; bossRiseX = 0; bossRiseY = 0;
  awaitExit = false; swActive = false; swState = '';
  swReadyT = 0; swFadeT = 0; swTroopersLeft = 0; swStars = []; swFlash = 0;
  saberPickup = null; vaderActive = false;
  sidiousActive = false; sidiousCue = 0; sidiousIntroT = 0; ltnBolts = []; ltnFlash = 0;
  dlg = []; dlgT = 0; sidFinale = null;
  jojoActive = false; jojoCue = 0; jojoBg = []; dioStopT = 0; dioStopFx = 0; roadRoller = null; dioFinale = null;
  playerStand = 0;
  bossIntro = null;
  ianCue = 0; ianActive = false; ianChoice = null; ianFinale = null; mournful = false; endless = false; ianBg = [];
  wraithLunged = false; ogreSpawned = false; eliteSeen = false; dreadSeen = false; shamanSeen = false; bomberSeen = false;
  lbScores = null; lbDaily = null; lbState = 'off'; lbName = ''; lbRank = -1; lbScore = 0; lbWave = 0;
  cheated = false; lbTicks = 0; lbKills = 0; runFlawless = true;
  // the GLOBAL bn holds only bane + party-economy effects; each hero's personal
  // boon effects live on h.bn (resetHeroBn — co-op picks are per player)
  bn = { spd: 1, gold: false, tithe: false, bounty: 0,
         toll: 0, foeSpd: 1, miser: false };
  resetHeroBn(player);
  boonMenu = null;
  up = { owned: new Set(), dashMax: 0, dashLen: 13, dashCd: DASH_CD,
         champs: { gandalf: false, luke: false, jotaro: false },
         champMul: 1, meterMul: 1, summonCost: METER_MAX, swingMs: SWING_MS, swingR: SWING_R, shield: false,
         shotMs: 500, shotDmg: 1, shotCount: 1, shotPierce: 0,          // BOW (ranged)
         zapMs: 800, zapJumps: 1, spells: ['bolt'], manaMax: MANA_MAX, manaRegen: 1,  // SORCERY (caster)
         scytheMs: 520, minionCap: 2, raiseCost: 25, huskMul: 1,                      // GRAVE (necro)
         minionHp: 2, minionDmg: 1, minionBoom: false, trueForms: false, reaper: false,
         dashStrike: false, secondWind: false,                           // DASH extras
         vanguard: false, medic: false,                                  // ALLIES extras
         swordMul: 1, riposte: false,                                    // BLADE extras
         arrowSpd: 1, ricochet: false,                                   // BOW extras
         shatter: false, overcharge: false,                              // SORCERY extras
         lanceR: 0, joustDmg: 1, flapCd: FLAP_CD, dragCap: 1, tailwind: false,   // SKYLANCE (dragoon)
         heatMax: HEAT_MAX, heatTrampleB: 0, breathCost: BREATH_COST, breathDmg: 2,
         breathCone: 0.72, riderReach: 76, jabT: 26, remountR: 30 };               // BOND (wyrm & rider)
  paused = false; upMenu = null; shellMenu = false;
  resetPend();                       // no queued input crosses a restart
  if (replayMode && replay) {
    // the RECORDED player's persistent state, not the watcher's — the sim must
    // start exactly where the recorded run started (applied in definition order)
    tokens = replay.d.tk0 | 0;
    runMaxwave = replay.d.mw0 | 0;
    hardMode = !!replay.d.hd;        // the recording's difficulty, not the watcher's unlock
    const owned = new Set(replay.d.up0 || []);
    for (const u of UPGRADES) if (owned.has(u.id)) { up.owned.add(u.id); u.apply(); }
  } else if (netplay && netCfg) {
    // ONLINE: both sims start from the HOST's snapshot, carried in the shared cfg
    // (the client plays with the host's upgrades — one authoritative header, like
    // a replay's). Nothing persists: the recorder stays disarmed and every save
    // is noPersist()-gated.
    tokens = netCfg.tk0 | 0;
    runMaxwave = netCfg.mw0 | 0;
    hardMode = !!netCfg.hd;
    const owned = new Set(netCfg.up0 || []);
    for (const u of UPGRADES) if (owned.has(u.id)) { up.owned.add(u.id); u.apply(); }
    recHdr = null; recEv = []; recOverflow = false;
  } else {
    // the intro's difficulty pick — daily stays one fair shared sim
    hardMode = hardSel && hardUnlocked && !dailyRun;
    tokens = parseInt(loadProfileItem('ilaird_sf_tokens') || '0', 10) || 0;   // this class's own credits
    // no legacy seed here: each profile climbs its own token ladder from wave 1
    // (seeding the old global record would starve a fresh class of income)
    runMaxwave = parseInt(loadProfileItem('ilaird_sf_maxwave', false) || '0', 10) || 0;
    applySavedUpgrades();            // unlocked upgrades are permanent — re-apply across runs
    // arm the recorder: the header is every piece of persistent state the sim just
    // read. `v` is the SIM-BALANCE version — bump it on ANY gameplay-affecting
    // change (damage, speeds, AI, economy), or old replays re-simulate under new
    // rules and silently diverge from their recorded scores.
    recEv = []; recLastM = -1; recOverflow = false;
    recHdr = { v: 4, seed: sfSeed >>> 0, c1: classSel, c2: classSel2, coop, hd: hardMode ? 1 : 0,
               up0: [...up.owned], tk0: tokens, mw0: runMaxwave };
  }
  player.dashCharges = up.dashMax; player.rechargeT = 0;
  player.shield = up.shield;         // the Aegis starts each run charged, then refreshes per wave
  player.mana = up.manaMax;          // the wizard starts with a full well (after Deep Well applies)
  if (coop) { setupCoop(); sfUnlock('coop'); }   // a second hero joins; both share allies, meter & upgrades
  if (netplay && netCfg && Array.isArray(netCfg.cs) && netCfg.cs.length > 2) {
    // the ONLINE WAR BAND: seats 3 and 4 spawn flanking the pair
    p3 = makeAllyHero(netCfg.cs[2], GW / 2, GH / 2 - 48, 1);
    if (netCfg.cs.length > 3) p4 = makeAllyHero(netCfg.cs[3], GW / 2, GH / 2 + 48, -1);
  }
}

/* ── couch co-op helpers ── */
// Build P2 and stand the two heroes apart at centre-screen. Called from init() (so R
// restarts straight into co-op) and the moment 2-PLAYER is confirmed on the intro.
function makeAllyHero(clsIdx, x, y, fx) {
  const h = { x, y, vx: 0, vy: 0, phase: 0, fx, fy: 0,
              dashT: 0, dashCd: 0, stunT: 0, choke: 0, chokeBreak: 0, iframe: 0,
              shield: up.shield, dashCharges: up.dashMax, rechargeT: 0,
              swingT: 0, swingReadyTick: 0, swordT: 0, heldSaber: false, down: false, downT: 0, reviveT: 0,
              cls: CLASSES[clamp(clsIdx | 0, 0, CLASSES.length - 1)], castT: 0, castMax: 0, casting: null,
              mana: up.manaMax, spellSel: 0, souls: 25, chillT: 0,
              manaHoldTick: 0, flapReadyTick: 0, flapT: -99,
              mounted: CLASSES[clsIdx] === 'rider' };   // a rider starts in the saddle
  resetHeroBn(h);
  return h;
}
function setupCoop() {
  player.x = GW / 2 - 48; player.y = GH / 2;
  p2 = makeAllyHero(classSel2, GW / 2 + 48, GH / 2, -1);
}
// each hero arms independently — the blade (Excalibur / lightsaber) lives on the hero,
// not the run. helpers for the scripted interlude transitions that arm/disarm everyone.
function armSaberAll(v) { for (const h of heroesAll()) if (h.cls === 'melee') h.heldSaber = v; }  // blades are the melee kit; ranged/caster keep their own weapons
function clearBlades() { for (const h of heroesAll()) { h.swordT = 0; h.swingT = 0; h.heldSaber = false; } }
// the active heroes; in single-player this is just [player], so co-op code stays a no-op
// ── party-size difficulty ──
// Every fighter past the first raises the pressure: bigger war bands (wave
// quota ~+35% per extra seat, higher cap), denser spawns, and tougher named
// bosses (see makeEnemy). Derived from the run's INTENT (netCfg/coop) — never
// from live hero state — so every sim in a lockstep band and every replay
// computes the identical number.
function partySize() {
  if (!coop) return 1;
  return netplay && netCfg && Array.isArray(netCfg.cs) ? netCfg.cs.length : 2;
}
function bandScale(base) { return Math.round(base * (1 + 0.35 * (partySize() - 1))); }
function heroesAll()  {
  if (!coop || !p2) return [player];
  const a = [player, p2];
  if (p3) a.push(p3);
  if (p4) a.push(p4);
  return a;
}
function heroSeat(h) { return h === player ? 0 : h === p2 ? 1 : h === p3 ? 2 : 3; }
function heroesLive() { return heroesAll().filter(h => !h.down); }
// frames a partner must stand by to revive — halved by the Medic upgrade
function reviveNeed() { return up.medic ? Math.round(REVIVE_T * 0.5) : REVIVE_T; }
// nearest hero still standing (for horde aggro & pickups); falls back to P1
function nearestLiveHero(x, y) {
  let best = null, bd = Infinity;
  for (const h of heroesLive()) { const d = Math.hypot(h.x - x, h.y - y); if (d < bd) { bd = d; best = h; } }
  return best || player;
}
// a live hero within r of a point — used by every pickup so either player can grab it
function nearHero(x, y, r) {
  for (const h of heroesLive()) if (Math.hypot(h.x - x, h.y - y) < r) return h;
  return null;
}
// the hero a boss / set-piece foe focuses on: P1 while standing (the duel is cinematic
// 1-on-1), but the survivor if P1 has fallen — otherwise the boss would keep attacking
// P1's downed body while the other hero runs free.
function bossTarget() {
  if (!coop) return player;
  if (!player.down) return player;
  if (p2 && !p2.down) return p2;
  return player;                 // both down — the run is ending anyway
}
// the goblin shaman's ritual circle: grunts inside are hastened 1.3× — 1.55×
// while the shaman is mid frenzy-shriek. ≤2 shamans afield keeps this scan
// trivial; a frozen shaman's circle gutters out.
function shamanHaste(e) {
  let hz = 1;
  for (const s of enemies) {
    if (s.type === 'shaman' && !s.dead && !(s.frozen > 0) &&
        Math.hypot(s.x - e.x, s.y - e.y) < SHAMAN_R)
      hz = Math.max(hz, s.frenzyT > 0 ? 1.55 : 1.3);
  }
  return hz;
}
// who a horde grunt chases. The scripted boss/set-piece foes lock onto bossTarget()
// (P1, or the survivor); the open-field horde splits aggro to the nearest standing hero —
// unless Vanguard is owned and a summoned ally stands close, in which case the grunt
// turns on the ally (harmless to it, and Luke/Gandalf cut the mob down where it clusters).
function hordeTarget(e) {
  const t = e.type;
  const scripted = t === 'wraith' || t === 'witchking' || t === 'vader' || t === 'sidious' ||
                   t === 'dio' || t === 'guard' || t === 'trooper' || t === 'ian';
  if (bossActive || nineActive || scripted) return coop ? bossTarget() : player;
  // a raised minion in a grunt's face is bait — the body-block is the necromancer's point
  for (const m of minions) if (Math.hypot(m.x - e.x, m.y - e.y) < 130) return m;
  if (up.vanguard) {
    for (const g of allies) if (Math.hypot(g.x - e.x, g.y - e.y) < 200) return g;
  }
  return coop ? nearestLiveHero(e.x, e.y) : player;
}

// ── upgrades — token roguelite tree: profiles, UPGRADES, shop, summon meter + mana gauges ──
/* unlocked upgrades persist (like achievements) and re-apply every run — but the
   whole progression ledger (upgrades + tokens + the token-paying maxwave) is
   kept PER PARTY PROFILE: solo runs save under the class name, co-op under the
   sorted duo ('caster+melee'). Each class earns and spends its own credits —
   what melee buys, the caster never sees. The legacy un-suffixed keys seed a
   profile's FIRST load (so pre-split progress carries into every class once),
   then the profile diverges on its own key. Replays are untouched: the sim
   reads its start state from the recording's header, never from storage. */
const SF_UP_KEY = 'ilaird_sf_upgrades';
function upProfile() {
  const c1 = CLASSES[classSel];
  if (!coop) return c1;
  return [c1, CLASSES[classSel2]].sort().join('+');
}
const profKey = (base) => base + '_' + upProfile();
function loadProfileItem(base, legacy = true) {
  try {
    const v = localStorage.getItem(profKey(base));
    return v !== null || !legacy ? v : localStorage.getItem(base);   // legacy global value seeds the first load
  } catch (_) { return null; }
}
function loadSavedUpgrades() {
  try { return new Set(JSON.parse(loadProfileItem(SF_UP_KEY) || '[]')); } catch (_) { return new Set(); }
}
function saveUpgrades() {
  if (noPersist()) return;   // a watched or online run must never touch the local profile
  try { localStorage.setItem(profKey(SF_UP_KEY), JSON.stringify([...up.owned])); } catch (_) {}
}
function saveTokens() {
  if (noPersist()) return;
  try { localStorage.setItem(profKey('ilaird_sf_tokens'), String(tokens)); } catch (_) {}
}
function applySavedUpgrades() {
  const saved = loadSavedUpgrades();
  for (const u of UPGRADES) {           // definition order so dependent values settle correctly
    if (saved.has(u.id)) { up.owned.add(u.id); u.apply(); }
  }
}
// cheat: unlock the entire upgrade tree at once (definition order so dependent values settle)
function grantAllUpgrades() {
  // only the trees the party can use — other classes' nodes stay locked (and unsaved)
  const present = new Set(heroesAll().map(h => h.cls));
  for (const u of UPGRADES) { if ((!u.cls || present.has(u.cls)) && (!u.coopOnly || coop) && !up.owned.has(u.id)) { up.owned.add(u.id); u.apply(); } }
  saveUpgrades();
  banner = 'ALL UPGRADES UNLOCKED'; bannerSub = 'every tree your party can use'; bannerT = 150;
  if (typeof sfSfx !== 'undefined' && sfSfx.summon) sfSfx.summon();
}
/* a token is earned only the FIRST time a given level is beaten (highest cleared
   level persisted) — so permanent upgrades can't be farmed by replaying easy waves. */
function grantLevelToken(level) {
  // gated on the run's in-memory maxwave (loaded in init; a replay uses the
  // RECORDER's value so token grants re-play identically), persisted live-only
  if (level <= runMaxwave) return false;
  runMaxwave = level;
  tokens++; saveTokens();
  if (!noPersist()) try { localStorage.setItem(profKey('ilaird_sf_maxwave'), String(level)); } catch (_) {}
  return true;
}
// the story bosses (Witch-king, Vader, Sidious, DIO) pay out on EVERY kill, not just
// the first — the trees grew too deep to live off first-clears alone
function grantBossToken() { tokens += bn.tithe ? 2 : 1; saveTokens(); return true; }

/* ── upgrades: a token-based skill tree. Each cleared wave grants a token;
   spend tokens (1 each) on unlocked nodes, or save them to grab several at once. ── */
// a SORCERY node teaches a spellbook page (idempotent — saved ids re-apply every run);
// learn order = cycle order, and it's deterministic: definition order for saved ids,
// buy order (a recorded event) within a run
function learnSpell(k) { if (!up.spells.includes(k)) up.spells.push(k); }
const UPGRADES = [
  { id: 'dash',        tree: 'DASH',   name: 'Dash',            desc: 'unlock the dash — SPACE / Shift',    icon: '💨', req: null,         apply: () => { up.dashMax = 1; player.dashCharges = 1; } },
  { id: 'dash_long',   tree: 'DASH',   name: 'Longer Dash',     desc: 'dash farther, longer invincibility', icon: '📏', req: 'dash',       apply: () => { up.dashLen = 20; } },
  { id: 'dash_2',      tree: 'DASH',   name: 'Second Dash',     desc: 'a second dash charge',               icon: '✌️', req: 'dash',       apply: () => { up.dashMax = 2; player.dashCharges = up.dashMax; } },
  { id: 'dash_3',      tree: 'DASH',   name: 'Third Dash',      desc: 'a third dash charge',                icon: '🔋', req: 'dash_2',     apply: () => { up.dashMax = 3; player.dashCharges = up.dashMax; } },
  { id: 'dash_cd',     tree: 'DASH',   name: 'Quick Feet',      desc: 'dashes recharge faster',             icon: '🌀', req: 'dash_2',     apply: () => { up.dashCd = 46; } },
  { id: 'dash_strike', tree: 'DASH',   name: 'Phantom Strike', desc: 'dash through foes to stagger them',  icon: '👻', req: 'dash',       apply: () => { up.dashStrike = true; } },
  { id: 'shield',      tree: 'DASH',   name: 'Aegis Shield',    desc: 'block one hit · refreshes each wave', icon: '🛡️', req: null,         apply: () => { up.shield = true; player.shield = true; } },
  { id: 'dash_wind',   tree: 'DASH',   name: 'Second Wind',     desc: 'Aegis break refills your dashes',    icon: '🌬️', req: 'shield',     apply: () => { up.secondWind = true; } },
  { id: 'dash_master', tree: 'DASH',   name: 'Blink Master',    desc: '4th charge · far · near-instant cd',  icon: '🌌', req: 'dash_3',     cost: 3, apply: () => { up.dashMax = 4; player.dashCharges = up.dashMax; up.dashLen = 26; up.dashCd = 30; } },
  { id: 'gandalf',     tree: 'ALLIES', name: 'Summon Gandalf',  desc: 'press 1 — staff bolts',              icon: '🧙', req: null,         apply: () => { up.champs.gandalf = true; } },
  { id: 'luke',        tree: 'ALLIES', name: 'Summon Luke',     desc: 'press 2 — a green saber',            icon: '⚔️', req: 'gandalf',    apply: () => { up.champs.luke = true; } },
  { id: 'jotaro',      tree: 'ALLIES', name: 'Summon Jotaro',   desc: 'press 3 — ZA WARUDO',                icon: '👊', req: 'luke',       apply: () => { up.champs.jotaro = true; } },
  { id: 'champ_long',  tree: 'ALLIES', name: 'Lasting Allies',  desc: 'allies fight 40% longer',            icon: '⏳', req: 'gandalf',    apply: () => { up.champMul = 1.4; } },
  { id: 'champ_long2', tree: 'ALLIES', name: 'Eternal Allies',  desc: 'allies fight far longer still',      icon: '♾️', req: 'champ_long', apply: () => { up.champMul = 1.8; } },
  { id: 'champ_fast',  tree: 'ALLIES', name: 'Quick Summon',    desc: 'meter charges 50% faster',           icon: '⏩', req: 'gandalf',    apply: () => { up.meterMul = 1.5; } },
  { id: 'champ_cost',  tree: 'ALLIES', name: 'Cheap Summon',    desc: 'allies cost less meter to call',     icon: '🪙', req: 'gandalf',    apply: () => { up.summonCost = Math.round(METER_MAX * 0.7); } },
  { id: 'ally_taunt',  tree: 'ALLIES', name: 'Vanguard',        desc: 'nearby foes turn on your allies',    icon: '🚩', req: 'gandalf',    apply: () => { up.vanguard = true; } },
  { id: 'ally_medic',  tree: 'ALLIES', name: 'Medic',           desc: 'revive twice as fast · longer mercy', icon: '⛑️', req: null, coopOnly: true, apply: () => { up.medic = true; } },
  { id: 'champ_master',tree: 'ALLIES', name: 'The Fellowship',  desc: 'allies linger · charge fast · cheap', icon: '💍', req: 'champ_long2', cost: 3, apply: () => { up.champMul = 2.4; up.meterMul = 2.2; up.summonCost = Math.round(METER_MAX * 0.5); } },
  { id: 'swing_fast',  tree: 'BLADE',  cls: 'melee',  name: 'Swift Blade',     desc: 'swing more often',                   icon: '🗡️', req: null,         apply: () => { up.swingMs = 440; } },
  { id: 'swing_fast2', tree: 'BLADE',  cls: 'melee',  name: 'Lightning Blade', desc: 'swing even more often',              icon: '⚡', req: 'swing_fast', apply: () => { up.swingMs = 300; } },
  { id: 'swing_wide',  tree: 'BLADE',  cls: 'melee',  name: 'Wide Cleave',     desc: 'wider sword reach',                  icon: '↔️', req: null,         apply: () => { up.swingR = 150; } },
  { id: 'swing_wide2', tree: 'BLADE',  cls: 'melee',  name: 'Great Cleave',    desc: 'even wider reach',                   icon: '⭕', req: 'swing_wide', apply: () => { up.swingR = 195; } },
  { id: 'swing_long',  tree: 'BLADE',  cls: 'melee',  name: 'Keen Edge',       desc: 'Excalibur lasts 50% longer', icon: '⌛', req: null,         apply: () => { up.swordMul = 1.5; } },
  { id: 'swing_riposte',tree: 'BLADE', cls: 'melee',  name: 'Riposte',         desc: 'batted shots return as your own',    icon: '🔄', req: 'swing_fast', apply: () => { up.riposte = true; } },
  { id: 'swing_master',tree: 'BLADE',  cls: 'melee',  name: 'Andúril',         desc: 'huge reach · blistering swing speed', icon: '🔥', req: 'swing_wide2', cost: 2, apply: () => { up.swingR = 250; up.swingMs = 210; } },
  { id: 'bow_fast',    tree: 'BOW',    cls: 'ranged', name: 'Rapid Shot',      desc: 'loose arrows more often',            icon: '🏹', req: null,         apply: () => { up.shotMs = Math.min(up.shotMs, 360); } },
  { id: 'bow_fast2',   tree: 'BOW',    cls: 'ranged', name: 'Arrow Storm',     desc: 'a blistering rate of fire',          icon: '🌪️', req: 'bow_fast',   apply: () => { up.shotMs = Math.min(up.shotMs, 280); } },
  { id: 'bow_dmg',     tree: 'BOW',    cls: 'ranged', name: 'Power Shot',      desc: 'arrows strike twice as hard',        icon: '💪', req: null,         apply: () => { up.shotDmg = 2; } },
  { id: 'bow_multi',   tree: 'BOW',    cls: 'ranged', name: 'Split Shot',      desc: 'loose two arrows in a fan',          icon: '🔱', req: 'bow_dmg',    apply: () => { up.shotCount = Math.max(up.shotCount, 2); } },
  { id: 'bow_far',     tree: 'BOW',    cls: 'ranged', name: 'Long Draw',       desc: 'arrows fly faster and farther',      icon: '🎯', req: null,         apply: () => { up.arrowSpd = 1.35; } },
  { id: 'bow_bounce',  tree: 'BOW',    cls: 'ranged', name: 'Ricochet',        desc: 'arrows bank off the screen edge',    icon: '📐', req: 'bow_dmg',    apply: () => { up.ricochet = true; } },
  { id: 'bow_master',  tree: 'BOW',    cls: 'ranged', name: 'Legolas',         desc: 'three piercing arrows · rapid fire', icon: '🧝', req: 'bow_multi',  cost: 2, apply: () => { up.shotCount = 3; up.shotPierce = 2; up.shotMs = Math.min(up.shotMs, 250); } },
  { id: 'zap_fast',    tree: 'SORCERY', cls: 'caster', name: 'Quick Cast',     desc: 'spells come faster',                 icon: '⚡', req: null,         apply: () => { up.zapMs = Math.min(up.zapMs, 560); } },
  { id: 'zap_chain',   tree: 'SORCERY', cls: 'caster', name: 'Chain Arc',      desc: 'bolts leap to a second foe',         icon: '🔗', req: null,         apply: () => { up.zapJumps = Math.max(up.zapJumps, 2); } },
  { id: 'zap_chain2',  tree: 'SORCERY', cls: 'caster', name: 'Storm Arc',      desc: 'bolts leap to three foes',           icon: '🌩️', req: 'zap_chain',  apply: () => { up.zapJumps = Math.max(up.zapJumps, 3); } },
  { id: 'mana_pool',   tree: 'SORCERY', cls: 'caster', name: 'Deep Well',      desc: '50% more mana',            icon: '🔮', req: null,         apply: () => { up.manaMax = Math.max(up.manaMax, 150); } },
  { id: 'mana_font',   tree: 'SORCERY', cls: 'caster', name: 'Font of Power',  desc: 'mana returns much faster',           icon: '⛲', req: 'mana_pool',  apply: () => { up.manaRegen = Math.max(up.manaRegen, 1.6); } },
  { id: 'nova',        tree: 'SORCERY', cls: 'caster', name: 'Frost Nova',     desc: 'SPELL: an ice ring freezes the pack', icon: '❄️', req: null,        apply: () => { learnSpell('nova'); } },
  { id: 'fireball',    tree: 'SORCERY', cls: 'caster', name: 'Fireball',       desc: 'SPELL: hurl fire that erupts on the mob', icon: '☄️', req: 'nova',  apply: () => { learnSpell('fire'); } },
  { id: 'nova_shatter',tree: 'SORCERY', cls: 'caster', name: 'Shatter',        desc: 'frozen foes burst, freezing others', icon: '🧊', req: 'nova',       apply: () => { up.shatter = true; } },
  { id: 'zap_refund',  tree: 'SORCERY', cls: 'caster', name: 'Overcharge',     desc: 'a killing cast refunds much of its mana', icon: '🔋', req: 'zap_fast', apply: () => { up.overcharge = true; } },
  { id: 'zap_master',  tree: 'SORCERY', cls: 'caster', name: 'Archmage',       desc: 'five-fold arcs · SPELL: the TEMPEST', icon: '🧙‍♂️', req: 'zap_chain2', cost: 2, apply: () => { up.zapJumps = 5; up.zapMs = Math.min(up.zapMs, 420); learnSpell('storm'); } },
  { id: 'grave_cap',   tree: 'GRAVE',  cls: 'necro',  name: 'Restless Dead',   desc: 'command a third minion',             icon: '🧟', req: null,         apply: () => { up.minionCap = Math.max(up.minionCap, 3); } },
  { id: 'grave_cheap', tree: 'GRAVE',  cls: 'necro',  name: 'Grave Pact',      desc: 'raising costs far fewer souls',      icon: '🤝', req: null,         apply: () => { up.raiseCost = Math.min(up.raiseCost, 16); } },
  { id: 'grave_last',  tree: 'GRAVE',  cls: 'necro',  name: 'Preservation',    desc: 'husks linger 50% longer',    icon: '⚰️', req: null,         apply: () => { up.huskMul = Math.max(up.huskMul, 1.5); } },
  { id: 'grave_reap',  tree: 'GRAVE',  cls: 'necro',  name: 'Reaper',          desc: 'faster sweeps · kills feed more souls', icon: '🌾', req: null,      apply: () => { up.scytheMs = Math.min(up.scytheMs, 380); up.reaper = true; } },
  { id: 'grave_boom',  tree: 'GRAVE',  cls: 'necro',  name: 'Deathburst',      desc: 'falling minions erupt in soul-fire', icon: '💥', req: 'grave_cap',  apply: () => { up.minionBoom = true; } },
  { id: 'grave_true',  tree: 'GRAVE',  cls: 'necro',  name: 'True Forms',      desc: 'wolves lope · archers loose spectral arrows', icon: '🐺', req: 'grave_cap', apply: () => { up.trueForms = true; } },
  { id: 'grave_master',tree: 'GRAVE',  cls: 'necro',  name: 'Lord of the Fallen', desc: 'a fourth minion · the dead rise harder', icon: '👑', req: 'grave_boom', cost: 2, apply: () => { up.minionCap = Math.max(up.minionCap, 4); up.minionHp = 3; up.minionDmg = 2; } },
  { id: 'lance_wind',  tree: 'SKYLANCE', cls: 'dragoon', name: 'Windrider',   desc: 'a swifter mount — higher top speed',  icon: '💨', req: null,          apply: () => { up.dragCap = Math.max(up.dragCap, 1.12); } },
  { id: 'lance_wind2', tree: 'SKYLANCE', cls: 'dragoon', name: 'Gale Wings',  desc: 'swifter still',                       icon: '🌬️', req: 'lance_wind',  apply: () => { up.dragCap = Math.max(up.dragCap, 1.24); } },
  { id: 'lance_long',  tree: 'SKYLANCE', cls: 'dragoon', name: 'Long Lance',  desc: 'the lance reaches farther',           icon: '📏', req: null,          apply: () => { up.lanceR = Math.max(up.lanceR, 14); } },
  { id: 'lance_flap',  tree: 'SKYLANCE', cls: 'dragoon', name: 'Swift Flap',  desc: 'flap far more often',                 icon: '🪶', req: null,          apply: () => { up.flapCd = Math.min(up.flapCd, 9); } },
  { id: 'lance_dmg',   tree: 'SKYLANCE', cls: 'dragoon', name: 'Trample',     desc: 'the lance strikes twice as hard',     icon: '🐎', req: 'lance_long',  apply: () => { up.joustDmg = Math.max(up.joustDmg, 2); } },
  { id: 'lance_wind3', tree: 'SKYLANCE', cls: 'dragoon', name: 'Tailwind',    desc: 'a skewer kill feeds the gallop',      icon: '🍃', req: 'lance_wind',  apply: () => { up.tailwind = true; } },
  { id: 'lance_master',tree: 'SKYLANCE', cls: 'dragoon', name: 'Sky Lord',    desc: 'top speed soars · a longer, harder lance', icon: '🐉', req: 'lance_wind2', cost: 2, apply: () => { up.dragCap = Math.max(up.dragCap, 1.38); up.lanceR = Math.max(up.lanceR, 22); up.joustDmg = Math.max(up.joustDmg, 2); } },
  { id: 'bond_heat',   tree: 'BOND', cls: 'wyrm', name: 'Furnace Heart',  desc: 'the heat gauge holds half again more',  icon: '🔥', req: null,        apply: () => { up.heatMax = Math.max(up.heatMax, 150); } },
  { id: 'bond_breath', tree: 'BOND', cls: 'wyrm', name: 'Deep Lungs',     desc: 'fire breath drinks far less heat',      icon: '🌬️', req: null,        apply: () => { up.breathCost = Math.min(up.breathCost, 40); } },
  { id: 'bond_lance',  tree: 'BOND', cls: 'wyrm', name: 'Saddle Lance',   desc: "the rider's jab reaches farther",       icon: '📏', req: null,        apply: () => { up.riderReach = Math.max(up.riderReach, 96); } },
  { id: 'bond_jab',    tree: 'BOND', cls: 'wyrm', name: 'Quick Hands',    desc: 'the rider jabs far more often',         icon: '🤺', req: 'bond_lance', apply: () => { up.jabT = Math.min(up.jabT, 16); } },
  { id: 'bond_mount',  tree: 'BOND', cls: 'wyrm', name: 'Practiced Leap', desc: 'remount from farther away',             icon: '🏇', req: null,        apply: () => { up.remountR = Math.max(up.remountR, 52); } },
  { id: 'bond_beak',   tree: 'BOND', cls: 'wyrm', name: 'Iron Beak',      desc: 'the trample strikes twice as hard',     icon: '🐲', req: 'bond_heat',  apply: () => { up.joustDmg = Math.max(up.joustDmg, 2); } },
  { id: 'bond_master', tree: 'BOND', cls: 'wyrm', name: 'DRAGONFIRE',     desc: 'a wider, hotter breath · cheap to loose', icon: '☄️', req: 'bond_breath', cost: 2, apply: () => { up.breathDmg = Math.max(up.breathDmg, 3); up.breathCone = Math.min(up.breathCone, 0.6); up.breathCost = Math.min(up.breathCost, 40); up.heatMax = Math.max(up.heatMax, 150); } },
];
const upCost = (u) => (u.cost || 1) + bn.toll;   // most nodes cost 1 token; capstones more; HEAVY TOLL taxes all
const TREE_COLOR = { DASH: '#80deea', ALLIES: '#caa6ff', BLADE: '#ffd24d', BOW: '#9ccc65', SORCERY: '#ce93d8', GRAVE: NECRO_COL, SKYLANCE: DRAGOON_COL, BOND: '#ff8a65' };
function availableUpgrades() {
  // class trees only show for classes actually in the party (DASH/ALLIES have no cls and
  // always show); coopOnly nodes (Medic) only show in a 2-player run
  const present = new Set(heroesAll().map(h => h.cls));
  return UPGRADES.filter(u => (!u.cls || present.has(u.cls)) && (!u.coopOnly || coop) &&
                              !up.owned.has(u.id) && (!u.req || up.owned.has(u.req)));
}
// open the shop if there's actually something to spend on; returns whether it opened
function openUpgradeMenu(title) {
  if (tokens < 1 || availableUpgrades().length === 0) return false;
  upMenu = { sel: 0, title: title || null };
  paused = true;
  sfSfx.wave();
  return true;
}
function offerUpgrade() {
  grantLevelToken(wave);                   // token only the first time this wave is cleared
  if (!openUpgradeMenu()) {                // nothing to spend on — bank & continue
    banner = 'wave ' + wave + ' cleared';
    bannerSub = tokens > 0 ? (tokens + ' token' + (tokens > 1 ? 's' : '') + ' saved') : 'breathe. they regroup.';
    bannerT = 90;
    breatherT = BREATHER;
  }
}
function buyUpgrade(u) {
  if (tokens < upCost(u)) { sfSfx.thud(); return; }   // can't afford this capstone yet
  tokens -= upCost(u); up.owned.add(u.id); u.apply();
  if (upCost(u) >= 2) sfUnlock('capstone');
  saveUpgrades(); saveTokens();            // unlocked upgrades & token balance persist across runs
  sfSfx.summon();
  upMenu.sel = Math.min(upMenu.sel, availableUpgrades().length);  // clamp onto the (possibly shorter) list
}
function finishUpgrades() {
  paused = false; upMenu = null; keys = {};
  if (swState === 'vaderdown') {            // post-Vader upgrade spent — the Emperor reveals himself
    beginBossIntro('sidious', startSidious);
    return;
  }
  if (awaitExit) {                          // post Witch-king — press on east, no breather/next wave
    banner = 'the way east opens'; bannerSub = 'run east —'; bannerT = 120;
    return;
  }
  breatherT = BREATHER;
  banner = 'wave ' + wave + ' cleared';
  bannerSub = tokens > 0 ? tokens + ' token' + (tokens > 1 ? 's' : '') + ' saved' : 'breathe.';
  bannerT = 90;
}
// the meter banks up to one charge per unlocked ally, so you can save up and summon several at once
function alliesUnlocked() { return (up.champs.gandalf ? 1 : 0) + (up.champs.luke ? 1 : 0) + (up.champs.jotaro ? 1 : 0); }
function meterCap() { return METER_MAX * Math.max(1, alliesUnlocked()); }
// while a champion is afield the meter charges at HALF rate — the champions carry
// the glory, so a summon's own chaos can't chain into the next summon forever
function addMeter(n) { meter = Math.min(meterCap(), meter + n * up.meterMul * (allies.length ? 0.5 : 1)); }
function champUnlocked() { return up.champs.gandalf || up.champs.luke || up.champs.jotaro; }
// boss duels are solo — no champions while a named boss is on the field (the trooper squad is fair game)
function champsBanned() { return nineActive || bossActive || vaderActive || sidiousActive || jojoActive || sidFinale || dioFinale || ianActive || mournful; }
// dismiss any active allies — they vanish when a boss steps in
function banishAllies() {
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 30, color: '#fff', txt: '...gone.' })); allies = []; }
}
function champReadyText() {
  const p = [];
  if (up.champs.gandalf) p.push('1 gandalf');
  if (up.champs.luke)    p.push('2 luke');
  if (up.champs.jotaro)  p.push('3 jotaro');
  return p.join('  ·  ');
}
// an always-visible charge gauge (bottom-left): the bar fills as the meter builds, banks a
// glowing green segment per ready summon, and prompts the keys the moment one is available
function drawSummonMeter() {
  if (!started || !alive || paused || bossIntro || ianActive) return;
  if (!champUnlocked()) return;                       // nothing to summon yet
  const cap = alliesUnlocked();
  const banned = champsBanned();
  const stored = Math.min(Math.floor(meter / up.summonCost), cap);
  const atMax = stored >= cap || meter >= meterCap();
  const prog = atMax ? 1 : clamp((meter - stored * up.summonCost) / up.summonCost, 0, 1);
  const ready = stored > 0 && !banned;
  const x = 14, y = GH - 22, segGap = 4, barW = 150, barH = 12;
  const segW = (barW - segGap * (cap - 1)) / cap;
  const pulse = api.reduceMotion ? 1 : 0.72 + 0.28 * Math.sin(frame * 0.13);
  ctx.save();
  ctx.textAlign = 'left';
  ctx.font = 'bold 11px Tahoma,Arial';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
  ctx.fillStyle = banned ? '#e57373' : ready ? '#caffa0' : '#9fc4e8';
  ctx.fillText(banned ? '🧙 ALLIES SEALED' : ready ? '🧙 ALLY READY'
             : allies.length ? '🧙 SLOW CHARGE · ally afield' : '🧙 SUMMON CHARGING', x, y - 6);
  ctx.shadowBlur = 0;
  for (let i = 0; i < cap; i++) {
    const sx = x + i * (segW + segGap);
    ctx.fillStyle = 'rgba(10,16,24,0.82)';
    roundRectPath(sx, y, segW, barH, 3); ctx.fill();
    let f = 0;
    if (i < stored) f = 1; else if (i === stored && !atMax) f = prog;
    if (f > 0) {
      ctx.save();
      roundRectPath(sx, y, segW, barH, 3); ctx.clip();
      const banked = i < stored;
      const c1 = banned ? '#7a3a3a' : banked ? '#7CFC8A' : '#bbdefb';   // banked = green, charging = blue
      const c2 = banned ? '#4a2222' : banked ? '#22a060' : '#3f7fc0';
      const grd = ctx.createLinearGradient(sx, y, sx, y + barH);
      grd.addColorStop(0, c1); grd.addColorStop(1, c2);
      ctx.globalAlpha = (banked && ready) ? pulse : 1;
      ctx.fillStyle = grd; ctx.fillRect(sx, y, segW * f, barH);
      ctx.restore();
    }
    ctx.strokeStyle = (i < stored && ready) ? 'rgba(140,252,138,' + pulse.toFixed(2) + ')' : 'rgba(150,180,210,0.4)';
    ctx.lineWidth = 1.5;
    roundRectPath(sx, y, segW, barH, 3); ctx.stroke();
  }
  if (ready) {
    const keys = [up.champs.gandalf && '1', up.champs.luke && '2', up.champs.jotaro && '3'].filter(Boolean).join('·');
    ctx.font = 'bold 11px Tahoma,Arial'; ctx.fillStyle = '#caffa0';
    ctx.globalAlpha = pulse; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillText('press ' + keys, x + barW + 8, y + barH - 1);
    ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  }
  ctx.restore();
  ctx.textAlign = 'left';
}
// the class resource gauges (bottom-right, mirroring the summon gauge): one slim
// bar per resource hero — the wizard's MANA (selected page, its cost as a notch,
// the cycle key) and the necromancer's SOULS (raise cost notch, minion slots as
// pips). Both dim gray while the next action is unaffordable.
function drawManaGauge() {
  if (!started || !alive || paused || bossIntro || ianActive) return;
  const bearers = heroesAll().filter(h => h.cls === 'caster' || h.cls === 'necro' || h.cls === 'dragoon' || h.cls === 'rider');
  if (!bearers.length) return;
  let y = GH - 22;
  ctx.save();
  for (const h of bearers) {
    const necro = h.cls === 'necro', drag = h.cls === 'dragoon', rider = h.cls === 'rider';
    const sp = necro || drag || rider ? null : SPELLS[curSpell(h)];
    // the dragoon's gauge is MOMENTUM: current speed against the top speed, with a
    // notch per Joust tier (goblin · wolf · troll) — "am I lethal right now?"
    const pool = necro ? SOULS_MAX : drag ? DRAG_CAP * up.dragCap : rider ? up.heatMax : up.manaMax;
    const have = necro ? h.souls : drag ? Math.hypot(h.vx, h.vy) : rider ? heat : h.mana;
    const cost = necro ? up.raiseCost : drag ? JOUST_BAR.goblin : rider ? up.breathCost : sp.cost;
    const ok = have >= cost && !h.down;
    const barW = 150, barH = 12, x = GW - barW - 14;
    const frac = clamp(have / pool, 0, 1);
    const who = coop ? 'P' + (heroSeat(h) + 1) + ' · ' : '';
    const label = necro
      ? who + '💀 SOULS · raise ' + cost + '  ·  ' + '●'.repeat(minions.length) + '○'.repeat(Math.max(0, up.minionCap - minions.length))
      : drag
      ? who + '🐉 GALLOP · skewer past a notch — X flaps'
      : rider
      ? who + '🔥 HEAT · tramples & lance kills feed it — E breathes fire' + (h.mounted ? '' : '  ·  REMOUNT!')
      : who + sp.icon + ' ' + sp.name + ' · ' + cost + (heroSpells().length > 1 ? '  ·  ' + (coop ? (h === p2 ? 'E' : '.') : 'C') + ' turns' : '') +
        (tick < (h.manaHoldTick || 0) ? '  ·  settling…' : '');
    ctx.textAlign = 'right';
    ctx.font = 'bold 11px Tahoma,Arial';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = h.down ? '#7a7a7a' : ok ? (necro ? NECRO_COL : drag ? DRAGOON_COL : rider ? '#ff8a65' : sp.col) : '#8a93a5';
    ctx.fillText(label, x + barW, y - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(10,16,24,0.82)';
    roundRectPath(x, y, barW, barH, 3); ctx.fill();
    if (frac > 0) {
      ctx.save();
      roundRectPath(x, y, barW, barH, 3); ctx.clip();
      const grd = ctx.createLinearGradient(x, y, x, y + barH);
      if (necro) { grd.addColorStop(0, ok ? '#7dfadf' : '#7ba8a0'); grd.addColorStop(1, ok ? '#0f9b82' : '#3a5a54'); }
      else if (drag || rider) { grd.addColorStop(0, ok ? (rider ? '#ffab91' : '#ffcc80') : '#a08a68'); grd.addColorStop(1, ok ? (rider ? '#d84315' : '#ef6c00') : '#5a4630'); }
      else { grd.addColorStop(0, ok ? '#b39ddb' : '#8090b8'); grd.addColorStop(1, ok ? '#5e35b1' : '#3a4668'); }
      ctx.fillStyle = grd; ctx.fillRect(x, y, barW * frac, barH);
      ctx.restore();
    }
    // the price line — the dragoon shows one notch per Joust tier instead
    const notches = drag ? [JOUST_BAR.goblin, JOUST_BAR.wolf, JOUST_BAR.troll] : [cost];
    ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
    for (const nv of notches) {
      const notch = x + barW * clamp(nv / pool, 0, 1);
      ctx.beginPath(); ctx.moveTo(notch, y - 1); ctx.lineTo(notch, y + barH + 1); ctx.stroke();
    }
    ctx.strokeStyle = ok ? (necro ? 'rgba(100,255,218,0.75)' : drag ? 'rgba(255,167,38,0.8)' : rider ? 'rgba(255,138,101,0.85)' : 'rgba(179,157,219,0.75)') : 'rgba(150,160,180,0.4)';
    ctx.lineWidth = 1.5;
    roundRectPath(x, y, barW, barH, 3); ctx.stroke();
    y -= 38;
  }
  ctx.restore();
  ctx.textAlign = 'left';
}
function drawUpgradePanel() {
  const rows = availableUpgrades();
  ctx.fillStyle = 'rgba(0,0,0,0.82)'; ctx.fillRect(0, 0, GW, GH);
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 26px Tahoma,Arial';
  ctx.fillText((upMenu && upMenu.title) || ('WAVE ' + wave + ' CLEARED'), GW / 2, 46);
  // token balance as gold pips
  ctx.font = 'bold 17px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.fillText('TOKENS  ' + (tokens ? '●'.repeat(tokens) : '—'), GW / 2, 74);

  const x = GW / 2 - 235, W = 478;
  let y = 112, lastTree = null;
  ctx.textAlign = 'left';
  rows.forEach((u, i) => {
    if (u.tree !== lastTree) {                       // group heading
      lastTree = u.tree;
      ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = TREE_COLOR[u.tree] || '#888';
      ctx.fillText(u.tree, x, y); y += 20;
    }
    const cost = upCost(u);
    const afford = tokens >= cost;                  // affordability is per-node now
    const on = i === upMenu.sel;
    if (on) { ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.fillRect(x - 8, y - 16, W, 26); }
    ctx.font = '17px serif'; ctx.fillStyle = afford ? '#fff' : '#777';
    ctx.fillText(u.icon, x + 8, y + 2);              // logo
    ctx.font = (on ? 'bold ' : '') + '16px Tahoma,Arial';
    ctx.fillStyle = on ? (afford ? '#fff' : '#999') : (afford ? '#cfd6da' : '#777');
    ctx.fillText(u.name, x + 36, y);
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = afford ? '#8a949a' : '#5a6168';
    ctx.fillText(u.desc, x + 196, y);
    // cost tag at the right edge — gold pips, dimmed when unaffordable
    ctx.textAlign = 'right';
    ctx.font = 'bold 13px Tahoma,Arial';
    ctx.fillStyle = afford ? '#ffd24d' : '#6a5a2a';
    ctx.fillText(cost > 1 ? '●'.repeat(cost) : '●', x + W - 6, y);
    ctx.textAlign = 'left';
    y += 30;
  });
  // continue / save
  y += 12;
  const onC = upMenu.sel === rows.length;
  if (onC) { ctx.fillStyle = 'rgba(255,210,77,0.16)'; ctx.fillRect(x - 8, y - 16, W, 26); }
  ctx.font = (onC ? 'bold ' : '') + '16px Tahoma,Arial'; ctx.fillStyle = onC ? '#ffd24d' : '#bbb';
  ctx.fillText('▶  Continue' + (tokens > 0 ? '   (save ' + tokens + ')' : ''), x + 8, y);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#888'; ctx.font = '13px Tahoma,Arial';
  ctx.fillText('↑ ↓  move      Z / Enter  select  (● = token cost)      ▶ Continue to leave', GW / 2, GH - 34);
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

// ── sfx — WebAudio chirp sfx table ──
/* ── sfx (no-ops when sound is off) ── */
const sfSfx = {
  dash:  () => _chirp(880, 'sawtooth', 0.09, 0.05),
  flap:  () => _chirp(620, 'triangle', 0.08, 0.05),
  coin:  () => { _chirp(1100, 'square', 0.06, 0.07); setTimeout(() => _chirp(1480, 'square', 0.07, 0.07), 60); },
  graze: () => _chirp(1500, 'sine', 0.03, 0.035),
  lunge: () => _chirp(300, 'sawtooth', 0.12, 0.06),
  wave:  () => { _chirp(520, 'square', 0.08, 0.07); setTimeout(() => _chirp(780, 'square', 0.1, 0.07), 90); },
  freeze:() => _chirp(1000, 'sine', 0.3, 0.08),
  bomb:  () => { _chirp(90, 'sawtooth', 0.3, 0.14); _chirp(180, 'square', 0.2, 0.07); },
  die:   () => { _chirp(220, 'sawtooth', 0.25, 0.12); setTimeout(() => _chirp(110, 'sawtooth', 0.35, 0.12), 120); },
  sword: () => { _chirp(880, 'square', 0.1, 0.08); setTimeout(() => _chirp(1175, 'square', 0.1, 0.08), 110); setTimeout(() => _chirp(1568, 'square', 0.18, 0.09), 220); },
  swing: () => _chirp(640, 'sawtooth', 0.07, 0.06),
  killE: () => _chirp(980, 'square', 0.06, 0.07),
  thud:  () => _chirp(220, 'square', 0.09, 0.09),
  arrow: () => _chirp(1700, 'sine', 0.06, 0.05),
  summon:() => { _chirp(130, 'sawtooth', 0.4, 0.13); setTimeout(() => _chirp(520, 'sine', 0.25, 0.09), 150); setTimeout(() => _chirp(1040, 'sine', 0.3, 0.08), 320); },
  bolt:  () => _chirp(1300, 'sine', 0.05, 0.05),
  saber: () => { _chirp(220, 'sawtooth', 0.3, 0.06); setTimeout(() => _chirp(180, 'sawtooth', 0.25, 0.05), 150); },
  saberHit: () => { _chirp(900, 'sawtooth', 0.08, 0.07); _chirp(450, 'square', 0.1, 0.05); },
  ora:   () => _chirp(280 + Math.random() * 120, 'square', 0.05, 0.08),  // audio pitch jitter — kept OFF the sim RNG (local/cosmetic, may be muted per-machine)
  zawarudo: () => { _chirp(60, 'sine', 0.5, 0.14); setTimeout(() => _chirp(1200, 'sine', 0.4, 0.06), 100); },
  screech: () => { _chirp(1800, 'sawtooth', 0.35, 0.07); _chirp(1450, 'sawtooth', 0.3, 0.05); },
  blaster: () => { _chirp(1600, 'square', 0.04, 0.05); setTimeout(() => _chirp(640, 'square', 0.06, 0.05), 35); },
  zap:   () => { _chirp(2200, 'sawtooth', 0.06, 0.05); setTimeout(() => _chirp(1700, 'square', 0.09, 0.05), 45); setTimeout(() => _chirp(2500, 'sawtooth', 0.12, 0.05), 95); },
  ignite:() => { _chirp(170, 'sawtooth', 0.22, 0.06); setTimeout(() => _chirp(560, 'sine', 0.3, 0.05), 70); },
  blip:  () => _chirp(1320, 'square', 0.022, 0.025),   // codec text tick
  challenger: () => { _chirp(330, 'sawtooth', 0.2, 0.09); setTimeout(() => _chirp(494, 'sawtooth', 0.2, 0.09), 130); setTimeout(() => _chirp(660, 'square', 0.4, 0.1), 280); },  // "challenger approaching" sting
  shieldBreak: () => { _chirp(1320, 'square', 0.07, 0.07); setTimeout(() => _chirp(560, 'sawtooth', 0.18, 0.08), 50); setTimeout(() => _chirp(320, 'square', 0.22, 0.07), 120); },  // the Aegis shatters
  charge: () => { _chirp(120, 'sawtooth', 0.2, 0.1); setTimeout(() => _chirp(90, 'sawtooth', 0.3, 0.12), 90); },  // the war-ogre's bull rush
};

// ── render-horde — stick/hero figures + horde sprites: goblin, shaman, bomber, wolf, archer, troll, ogre, wraith ──
/* ── drawing ── */
function stickFigure(x, y, phase, color, scale = 1, alpha = 1, lean = 0, glow = 0) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  // grounding shadow
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 8; }   // soft rim so the hero reads against busy ground
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round';
  const s = Math.sin(phase);
  ctx.beginPath(); ctx.arc(0, -34, 8, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-14, -20 + s * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo( 14, -20 - s * 8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -6);  ctx.lineTo(-10, -6 + 18 + s * 10); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -6);  ctx.lineTo( 10, -6 + 18 - s * 10); ctx.stroke();
  ctx.restore();
}

/* a HERO body — stickFigure plus the class garb, so the three kits read at a
   glance: melee wears a gold headband (tails streaming) and a sash, ranged a
   leaf-green hood + feather with a quiver slung on the back, caster a wizard
   hat and a flowing robe in place of legs. `dir` mirrors the garb to the
   facing; `mono` draws the garb in the body color only (dash ghosts, the
   downed gray) so tinted figures keep their silhouette without color pops.
   Animation is phase/frame-driven — no rnd(), same rule as all draw code. */
function heroFigure(x, y, phase, color, cls, dir = 1, scale = 1, alpha = 1, lean = 0, glow = 0, mono = false) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12 * scale, 4 * scale, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean);
  ctx.scale(scale, scale);
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = 8; }
  ctx.strokeStyle = color;
  ctx.lineWidth = 2.5;
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  const s = Math.sin(phase);
  ctx.beginPath(); ctx.arc(0, -34, 8, 0, Math.PI * 2); ctx.stroke();       // head
  ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();    // torso
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-14, -20 + s * 8); ctx.stroke();  // arms
  ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo( 14, -20 - s * 8); ctx.stroke();
  if (cls !== 'caster' && cls !== 'necro') {                               // legs (robed classes cover them)
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-10, 12 + s * 10); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo( 10, 12 - s * 10); ctx.stroke();
  }
  // garb, drawn in facing space (+x = forward)
  ctx.scale(dir, 1);
  const gc = (c) => (mono ? color : c);
  ctx.fillStyle = cls === 'necro' && !mono ? NECRO_COL : color;            // an eye, so they face somewhere (the necro's burns soul-teal)
  ctx.beginPath(); ctx.arc(3.5, -35, cls === 'necro' ? 1.5 : 1.2, 0, Math.PI * 2); ctx.fill();
  if (cls === 'melee') {
    ctx.strokeStyle = gc('#ffd24d'); ctx.lineWidth = 2.5;                  // headband
    ctx.beginPath(); ctx.moveTo(-7.5, -37); ctx.lineTo(7.5, -37); ctx.stroke();
    const f1 = Math.sin(phase * 1.7) * 2, f2 = Math.sin(phase * 1.7 + 1.3) * 2.5;
    ctx.lineWidth = 1.8;                                                   // its two streaming tails
    ctx.beginPath(); ctx.moveTo(-7, -37); ctx.quadraticCurveTo(-13, -36 + f1, -17, -33 + f1 * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-7, -37); ctx.quadraticCurveTo(-12, -33 + f2, -16, -28 + f2 * 1.5); ctx.stroke();
    ctx.lineWidth = 2;                                                     // waist sash
    ctx.beginPath(); ctx.moveTo(-4, -8); ctx.lineTo(4, -10); ctx.stroke();
  } else if (cls === 'ranged') {
    ctx.strokeStyle = gc('#6b4a2b'); ctx.lineWidth = 4;                    // quiver on the back
    ctx.beginPath(); ctx.moveTo(-7, -25); ctx.lineTo(-11, -12); ctx.stroke();
    ctx.strokeStyle = gc('#9ccc65'); ctx.lineWidth = 1.5;                  // fletchings poking out
    ctx.beginPath(); ctx.moveTo(-7, -25); ctx.lineTo(-5.5, -30); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-8.5, -26); ctx.lineTo(-8, -31); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-6, -24); ctx.lineTo(-3.5, -28.5); ctx.stroke();
    ctx.fillStyle = gc('#7cb342');                                         // peaked hood, point trailing back
    ctx.beginPath();
    ctx.moveTo(8.5, -36);
    ctx.quadraticCurveTo(6, -45, -2, -45.5);
    ctx.quadraticCurveTo(-12, -45, -16.5, -38.5);
    ctx.quadraticCurveTo(-10.5, -40.5, -8.5, -36);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = gc('#f5f5dc'); ctx.lineWidth = 1.5;                  // a feather in it
    ctx.beginPath(); ctx.moveTo(-1, -44.5); ctx.quadraticCurveTo(3, -50, 8, -51); ctx.stroke();
  } else if (cls === 'caster') {
    const sway = Math.sin(phase) * 2.5;                                    // robe hem sways against the stride
    ctx.fillStyle = mono ? color : 'rgba(126,87,194,0.35)';
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -10);
    ctx.quadraticCurveTo(-8, 0, -10 + sway, 11);
    ctx.quadraticCurveTo(0, 14, 10 + sway * 0.5, 11);
    ctx.quadraticCurveTo(8, 0, 4.5, -10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gc('#7e57c2');                                         // the hat cone, tip swept back
    ctx.beginPath();
    ctx.moveTo(-7, -39);
    ctx.quadraticCurveTo(-7, -50, -13, -56);
    ctx.quadraticCurveTo(-2, -54, 2, -47);
    ctx.quadraticCurveTo(5, -42, 7, -39);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = gc('#7e57c2'); ctx.lineWidth = 3;                    // wide brim
    ctx.beginPath(); ctx.moveTo(-12.5, -38.5); ctx.lineTo(12.5, -38.5); ctx.stroke();
    ctx.strokeStyle = gc('#ffd24d'); ctx.lineWidth = 1.6;                  // hat band
    ctx.beginPath(); ctx.moveTo(-6.5, -40.5); ctx.lineTo(6.5, -40.5); ctx.stroke();
  } else if (cls === 'necro') {
    const sway = Math.sin(phase) * 2;                                      // ragged grave-robe, torn hem
    ctx.fillStyle = mono ? color : 'rgba(74,68,96,0.55)';
    ctx.strokeStyle = color; ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-4.5, -10);
    ctx.quadraticCurveTo(-8.5, 0, -10.5 + sway, 12);
    ctx.lineTo(-6.5 + sway, 8); ctx.lineTo(-2.5, 12.5); ctx.lineTo(1.5, 8); ctx.lineTo(5.5, 12.5); ctx.lineTo(9.5 + sway * 0.5, 8.5);
    ctx.quadraticCurveTo(8.5, 0, 4.5, -10);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = gc('#4a4458');                                         // a deep grave-cowl, drooping behind
    ctx.beginPath();
    ctx.moveTo(9, -35);
    ctx.quadraticCurveTo(7, -46, -2, -46);
    ctx.quadraticCurveTo(-13, -45.5, -18, -36);
    ctx.quadraticCurveTo(-15, -30, -9, -33);
    ctx.quadraticCurveTo(-6, -30, 0, -31);
    ctx.closePath(); ctx.fill();
  } else if (cls === 'dragoon') {
    const beat = Math.sin(phase * 1.6) * 3;                                // wingbeat rides the stride
    ctx.fillStyle = mono ? color : 'rgba(255,167,38,0.45)';
    ctx.strokeStyle = gc(DRAGOON_COL); ctx.lineWidth = 1.6;
    ctx.beginPath();                                                       // the high rider's wing
    ctx.moveTo(-4, -28);
    ctx.quadraticCurveTo(-15, -38 - beat, -23, -31 - beat * 1.6);
    ctx.quadraticCurveTo(-14, -27, -6, -23);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath();                                                       // the low wing, trailing
    ctx.moveTo(-4, -24);
    ctx.quadraticCurveTo(-14, -29 - beat * 0.6, -21, -23 - beat);
    ctx.quadraticCurveTo(-12, -21, -5, -19);
    ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = gc('#cdd8e2'); ctx.lineWidth = 2.5;                  // steel half-helm
    ctx.beginPath(); ctx.moveTo(-7.5, -37.5); ctx.lineTo(7.5, -37.5); ctx.stroke();
    ctx.strokeStyle = gc(DRAGOON_COL); ctx.lineWidth = 1.5;                // its little crest wings
    ctx.beginPath(); ctx.moveTo(-6, -38); ctx.quadraticCurveTo(-11, -43, -15, -42.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(6, -38); ctx.quadraticCurveTo(11, -43, 15, -42.5); ctx.stroke();
  } else if (cls === 'rider') {
    ctx.strokeStyle = gc('#ffab91'); ctx.lineWidth = 2.2;                  // riding cap
    ctx.beginPath(); ctx.moveTo(-7, -37.5); ctx.lineTo(7, -37.5); ctx.stroke();
    const s1 = Math.sin(phase * 1.7) * 2.5;                                // the scarf streams behind
    ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(-5, -33); ctx.quadraticCurveTo(-13, -32 + s1, -19, -28 + s1 * 1.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, -34.5); ctx.quadraticCurveTo(-12, -36 + s1, -17, -34 + s1); ctx.stroke();
  }
  ctx.restore();
}

// the creator himself — an unarmed, bespectacled stick figure. modes:
//   'plead' standing tall with both hands up (the intro card), 'idle' kneeling in plea (the scene),
//   'rise' standing in relief (spared), 'dying' kneeling as he crumbles.
// e.crumble fades him to ash, e.fade dims him out.
function drawIan(e, col) {
  const tremble = api.reduceMotion ? 0 : Math.sin((e.phase || 0)) * 0.7;
  const cr = e.crumble || 0;
  const mode = e.mode || 'idle';
  const kneel = mode === 'idle' || mode === 'dying';
  const armsUp = mode === 'idle' || mode === 'dying' || mode === 'plead';
  const wob = api.reduceMotion ? 0 : Math.sin((frame || 0) * 0.16) * 1.6;   // pleading-hand wave
  ctx.save();
  ctx.globalAlpha = (e.fade == null ? 1 : e.fade) * (1 - cr);
  ctx.translate(e.x + tremble, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  const hy = kneel ? -22 : -34;
  if (kneel) {
    ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 2); ctx.stroke();      // short torso
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-12, -22); ctx.stroke();  // arms raised, pleading
    ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(12, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-10, 4); ctx.lineTo(-12, 2); ctx.stroke();  // folded knees
    ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(8, 6); ctx.lineTo(12, 2); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(0, -26); ctx.lineTo(0, -6); ctx.stroke();     // torso
    if (armsUp) {                                                              // standing, both hands up
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(-12, -34 + wob); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(12, -34 - wob); ctx.stroke();
    } else {                                                                   // relief, arms lowered
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-11, -12); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(11, -12); ctx.stroke();
    }
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(-9, 12); ctx.stroke();     // legs
    ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(9, 12); ctx.stroke();
  }
  /* ── the creator's face: his own portrait, South Park-ized — TWO PIECES hinged
     at the lips, clapping together while his lines run (the dlg queue is live).
     When the real photo (ianFace) is decoded it's drawn as elliptical cutout
     pieces — the authentic South Park celebrity treatment; otherwise the hand-
     drawn caricature below stands in. Flap is a fade-free bob; reduced motion
     holds it slightly ajar instead. Drawn over the stick body at head height. */
  // "talking" must cover every way his words reach the screen: lines still QUEUED
  // (dlg) or in the between-line gap (dlgT), the displayed spare speech (the dlg
  // pump shifts a line into the banner while it shows, so the queue alone goes
  // empty mid-speech — the 'thanks' phase spans the whole thing), and the intro
  // card's plea (which never touches dlg; it types on the card itself).
  const talking = mode !== 'dying' &&
                  (dlg.length > 0 || dlgT > 0 ||
                   (ianFinale && ianFinale.outcome === 'spare' && ianFinale.phase === 'thanks') ||
                   (bossIntro && bossIntro.key === 'ian' && bossIntro.phase !== 'approach'));
  const flap = talking ? (api.reduceMotion ? 2 : Math.abs(Math.sin((frame || 0) * 0.3)) * 5) : 0;
  const R = 8.5, skin = '#e8c39e', hair = '#2e241c', beard = '#3a2a20';
  if (ianFace.complete && ianFace.naturalWidth > 0) {
    const iw = ianFace.naturalWidth, ih = ianFace.naturalHeight;
    const MOUTH = 0.75;                        // the lip line, as a fraction of the photo's height
    const HW = 21, HH = HW * ih / iw;          // a touch larger than the stick head — it's a cutout
    const topH = HH * MOUTH, botH = HH - topH;
    const mouthY = hy + 1;
    // a tight head-shaped ellipse — trims the photo's background corners and collar
    const ecx = 0, ecy = mouthY - topH + HH * 0.47, erx = HW * 0.44, ery = HH * 0.46;
    if (flap > 0.6) {                          // the open mouth between the pieces
      ctx.fillStyle = '#4a1518';
      ctx.beginPath(); ctx.ellipse(0, mouthY - flap / 2, HW * 0.3, flap * 0.55 + 1.4, 0, 0, Math.PI * 2); ctx.fill();
    }
    // the jaw piece: full photo drawn once, clipped to (head ellipse ∩ below the lips)
    ctx.save();
    ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(-HW / 2 - 2, mouthY, HW + 4, botH + 4); ctx.clip();
    ctx.drawImage(ianFace, -HW / 2, mouthY - topH, HW, HH);
    ctx.restore();
    // the top piece: same photo, clipped to (ellipse ∩ above the lips), lifted by the flap
    ctx.save();
    ctx.translate(0, -flap);
    ctx.beginPath(); ctx.ellipse(ecx, ecy, erx, ery, 0, 0, Math.PI * 2); ctx.clip();
    ctx.beginPath(); ctx.rect(-HW / 2 - 2, mouthY - topH - 2, HW + 4, topH + 2); ctx.clip();
    ctx.drawImage(ianFace, -HW / 2, mouthY - topH, HW, HH);
    ctx.restore();
    // a tear, while he kneels (over the photo cheek)
    if (kneel && !api.reduceMotion && Math.floor((frame || 0) / 18) % 3 === 0) {
      ctx.fillStyle = '#8fd8ff';
      ctx.beginPath(); ctx.arc(HW * 0.28, mouthY - topH * 0.4, 1.6, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
    return;
  }
  if (flap > 0.6) {                                          // the open mouth between the halves
    ctx.fillStyle = '#4a1518';
    ctx.beginPath(); ctx.ellipse(0, hy + 0.6 - flap / 2, R * 0.62, flap * 0.55 + 1.4, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the JAW half — chin wrapped in the full beard
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(0, hy + 0.8, R, 0.12 * Math.PI, 0.88 * Math.PI); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = beard; ctx.lineWidth = 3.2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, hy + 0.8, R - 1, 0.16 * Math.PI, 0.84 * Math.PI); ctx.stroke();
  // the DOME half — bald on top, short dark hair on the sides, lifted by the flap
  ctx.save();
  ctx.translate(0, hy - flap);
  ctx.fillStyle = skin;
  ctx.beginPath(); ctx.arc(-R - 1.4, -1.4, 2.1, 0, Math.PI * 2); ctx.fill();   // the ears ride the top half
  ctx.beginPath(); ctx.arc(R + 1.4, -1.4, 2.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0.8, R, Math.PI, 2 * Math.PI); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = hair; ctx.lineWidth = 2.4;               // side hair — the top stays bare
  ctx.beginPath(); ctx.arc(0, 0.8, R - 0.8, Math.PI * 1.0, Math.PI * 1.24); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0.8, R - 0.8, Math.PI * 1.76, Math.PI * 2.0); ctx.stroke();
  ctx.lineWidth = 1.7;                                        // strong brows
  ctx.beginPath(); ctx.moveTo(-5.2, -3.2); ctx.lineTo(-1.6, -3.7); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(1.6, -3.7); ctx.lineTo(5.2, -3.2); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';                                  // the eyes
  ctx.beginPath(); ctx.arc(-3.1, -1.5, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.1, -1.5, 1.1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#c99b72'; ctx.lineWidth = 1.2;           // a hint of nose
  ctx.beginPath(); ctx.moveTo(0.2, -1); ctx.lineTo(-0.7, 0.2); ctx.stroke();
  ctx.strokeStyle = beard; ctx.lineWidth = 2;                 // the mustache rides the lip edge
  ctx.beginPath(); ctx.moveTo(-3.8, 0.6); ctx.quadraticCurveTo(0, 1.8, 3.8, 0.6); ctx.stroke();
  ctx.restore();
  // a tear, while he kneels
  if (kneel && !api.reduceMotion && Math.floor((frame || 0) / 18) % 3 === 0) {
    ctx.fillStyle = '#8fd8ff';
    ctx.beginPath(); ctx.arc(5.6, hy - 0.2, 1.6, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ── enemy sprites (anchored at the feet like stickFigure) ── */
function drawGoblin(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.vx || (player.x - e.x)) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // scurrying legs
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-7, 4 + s * 5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(7, 4 - s * 5); ctx.stroke();
  // hunched spine
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(1, -18, 7, -22); ctx.stroke();
  // grasping arms reach forward
  ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(12 + s * 2, -8); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(3, -16); ctx.lineTo(11 - s * 2, -10); ctx.stroke();
  // head with pointy ears
  ctx.beginPath(); ctx.arc(10, -27, 5.5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -31); ctx.lineTo(2, -38); ctx.lineTo(9, -32); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(17, -38); ctx.lineTo(10, -32); ctx.closePath(); ctx.fill();
  // the shield-bearer's buckler on its lead arm — gone once its blocks are spent;
  // the warlord carries a taller gold-bossed tower shield instead
  if (e.elite && (e.hp || 0) >= 2) {
    if (e.elite === 2) {
      ctx.fillStyle = '#aab2bb'; ctx.strokeStyle = '#8a6d1f'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(11, -22); ctx.lineTo(18, -22); ctx.lineTo(18, -4); ctx.lineTo(14.5, 0); ctx.lineTo(11, -4);
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#c9a227';
      ctx.beginPath(); ctx.arc(14.5, -12, 2.4, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = '#aab2bb'; ctx.strokeStyle = '#5d6d7e'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(14, -11, 6.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5d6d7e';
      ctx.beginPath(); ctx.arc(14, -11, 2, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

function drawShaman(e, col) {
  ctx.save(); ctx.translate(e.x, e.y);
  // the ritual circle IS the haste zone — telegraphed exactly (gutters out while
  // iced); it flares hot while the frenzy-shriek has the pack sprinting
  if (!(e.frozen > 0)) {
    const fz = e.frenzyT > 0;
    const a = api.reduceMotion ? (fz ? 0.55 : 0.3)
      : fz ? 0.45 + 0.25 * Math.sin(frame * 0.22)
           : 0.2 + 0.12 * Math.sin(frame * 0.07);
    ctx.strokeStyle = (fz ? 'rgba(200,255,140,' : 'rgba(140,220,120,') + a.toFixed(2) + ')';
    ctx.lineWidth = fz ? 3 : 2;
    ctx.setLineDash([6, 8]);
    ctx.beginPath(); ctx.arc(0, -8, SHAMAN_R, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 9, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // a ragged cowled robe, swaying with the chant
  const sway = Math.sin(e.phase) * 1.5;
  ctx.beginPath();
  ctx.moveTo(-8 + sway * 0.4, 0); ctx.lineTo(-3, -24); ctx.lineTo(5, -28); ctx.lineTo(8 + sway * 0.4, 0);
  ctx.closePath(); ctx.fill();
  // hooded goblin head — the kin ears poke through the cowl
  ctx.beginPath(); ctx.arc(6, -30, 5, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.moveTo(3, -34); ctx.lineTo(0, -40); ctx.lineTo(6, -34); ctx.closePath(); ctx.fill();
  // gnarled staff crowned with the chant-light
  ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(12, 0); ctx.lineTo(14, -34 + sway); ctx.stroke();
  const glow = api.reduceMotion ? 0.7 : 0.5 + 0.35 * Math.sin(frame * 0.11);
  ctx.fillStyle = '#a5e88a';
  ctx.shadowColor = '#8fdc78'; ctx.shadowBlur = 8 + glow * 8;
  ctx.beginPath(); ctx.arc(14, -37 + sway, 3.2 + glow, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawBomber(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 10, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // goblin kin: scurrying legs + hunched spine, bent under the powder load
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-6, 4 + s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(6, 4 - s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.quadraticCurveTo(0, -16, 6, -20); ctx.stroke();
  // head with the pointy ears
  ctx.beginPath(); ctx.arc(9, -24, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -28); ctx.lineTo(2, -34); ctx.lineTo(8, -29); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(12, -28); ctx.lineTo(15, -34); ctx.lineTo(9, -29); ctx.closePath(); ctx.fill();
  // the keg on its back — hoisted overhead while winding up the throw
  const up = e.mode === 'wind' ? 14 : 0;
  ctx.save();
  ctx.translate(-4, -26 - up); ctx.rotate(e.mode === 'wind' ? -0.2 : 0.35);
  ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-5, -7, 10, 14);
  ctx.strokeStyle = '#3e2a17'; ctx.lineWidth = 1.5;
  ctx.strokeRect(-5, -7, 10, 14);
  ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(5, 3); ctx.stroke();
  if (e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 3) % 2 === 0)) {
    ctx.fillStyle = '#ffd24d';
    ctx.beginPath(); ctx.arc(0, -10, 2.2, 0, Math.PI * 2); ctx.fill();   // fuse lit — it's coming
  }
  ctx.restore();
  // carrying arms up to the keg
  ctx.strokeStyle = col; ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(4, -18); ctx.lineTo(-2, -24 - up); ctx.stroke();
  ctx.restore();
}

function drawWolf(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.mode === 'lunge' ? e.lx : (player.x - e.x)) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  // the dire frost wolf's chill aura — the icy ring IS the danger zone, telegraphed
  if (e.elite === 2) {
    ctx.strokeStyle = 'rgba(180,225,255,0.28)'; ctx.lineWidth = 2;
    ctx.setLineDash([5, 7]);
    ctx.beginPath(); ctx.arc(0, -8, 90, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 13, 3.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // trotting legs
  ctx.beginPath(); ctx.moveTo(8, -12);   ctx.lineTo(8 + s * 4, 0);   ctx.stroke();
  ctx.beginPath(); ctx.moveTo(11, -12);  ctx.lineTo(11 - s * 4, 0);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -12);  ctx.lineTo(-9 - s * 4, 0);  ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-12, -12); ctx.lineTo(-12 + s * 4, 0); ctx.stroke();
  // arched back
  ctx.beginPath(); ctx.moveTo(-13, -13); ctx.quadraticCurveTo(0, -17, 12, -14); ctx.stroke();
  // tail
  ctx.beginPath(); ctx.moveTo(-13, -13); ctx.quadraticCurveTo(-19, -16, -21, -21); ctx.stroke();
  // neck, snout, ear
  ctx.beginPath(); ctx.moveTo(12, -14); ctx.lineTo(16, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(16, -19); ctx.lineTo(24, -16); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(14, -21); ctx.lineTo(16, -27); ctx.lineTo(18, -21); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawArcher(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.strokeStyle = col;
  ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  // legs
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(-8, 4 + s * 4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(8, 4 - s * 4); ctx.stroke();
  // spine + pelvis
  ctx.beginPath(); ctx.moveTo(0, -8); ctx.lineTo(0, -27); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -9); ctx.lineTo(4, -9); ctx.stroke();
  // ribs
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-5, -23);   ctx.lineTo(5, -23);   ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4.5, -19); ctx.lineTo(4.5, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -15);   ctx.lineTo(4, -15);   ctx.stroke();
  ctx.lineWidth = 2.5;
  // bow arm + bow
  ctx.beginPath(); ctx.moveTo(0, -22); ctx.lineTo(13, -22); ctx.stroke();
  ctx.beginPath(); ctx.arc(13, -22, 9, -Math.PI / 2.1, Math.PI / 2.1); ctx.stroke();
  ctx.lineWidth = 1.2;
  if (e.mode === 'aim') {  // string drawn, arrow nocked
    ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(4, -22); ctx.lineTo(13, -13); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -22); ctx.lineTo(22, -22); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(13, -31); ctx.lineTo(13, -13); ctx.stroke();
    ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(0, -20); ctx.lineTo(-6 - s * 2, -10); ctx.stroke();  // idle off arm
  }
  // skull
  ctx.fillStyle = col;
  ctx.beginPath(); ctx.arc(0, -34, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.arc(2.2, -35, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(-2.2, -35, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.fillRect(-2, -30.5, 4, 1.2);
  ctx.restore();
}

function drawTroll(e, col, lean) {
  const s = Math.sin(e.phase);
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 4, 19, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.rotate(lean); ctx.scale(1.35, 1.35);
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 4.5; ctx.lineCap = 'round';
  // stumpy legs
  ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-8, 2 + s * 2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -12);  ctx.lineTo(8, 2 - s * 2);  ctx.stroke();
  // big belly
  ctx.beginPath(); ctx.ellipse(0, -24, 12, 15, 0, 0, Math.PI * 2); ctx.fill();
  // club arm
  ctx.beginPath(); ctx.moveTo(8, -32); ctx.lineTo(17, -14); ctx.stroke();
  ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 7;
  ctx.beginPath(); ctx.moveTo(17, -14); ctx.lineTo(23, -28); ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 4.5;
  // other arm
  ctx.beginPath(); ctx.moveTo(-8, -32); ctx.lineTo(-15, -16 + s * 3); ctx.stroke();
  // head + tusks
  ctx.beginPath(); ctx.arc(0, -44, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(-4, -41); ctx.lineTo(-5, -46); ctx.lineTo(-2, -42); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4, -41);  ctx.lineTo(5, -46);  ctx.lineTo(2, -42);  ctx.closePath(); ctx.fill();
  ctx.restore();
}

function drawOgre(e, col) {
  const s = Math.sin(e.phase);
  const dir = (e.lx || (player.x - e.x)) >= 0 ? 1 : -1;
  const charging = e.mode === 'charge';
  const winding = e.mode === 'wind';
  // telegraph: a dashed charge line + a swelling glow while it winds up the rush
  if (winding && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0)) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,82,82,0.6)'; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath(); ctx.moveTo(e.x, e.y - 20);
    ctx.lineTo(e.x + (e.lx || 0) * 260, e.y - 20 + (e.ly || 0) * 260); ctx.stroke();
    ctx.restore();
  }
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 6, 26, 8, 0, 0, Math.PI * 2); ctx.fill();
  const lean = charging ? dir * 0.35 : 0;
  ctx.rotate(lean); ctx.scale(dir * 1.85, 1.85);
  if (winding) { ctx.shadowColor = '#ff5252'; ctx.shadowBlur = 12; }
  ctx.strokeStyle = col; ctx.fillStyle = col;
  ctx.lineWidth = 4; ctx.lineCap = 'round';
  // tree-trunk legs
  ctx.beginPath(); ctx.moveTo(-6, -11); ctx.lineTo(-9, 3 + s * 1.5); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, -11);  ctx.lineTo(9, 3 - s * 1.5);  ctx.stroke();
  // huge hunched body
  ctx.beginPath(); ctx.ellipse(0, -22, 14, 16, 0, 0, Math.PI * 2); ctx.fill();
  // a great slab of a club, raised when charging
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(9, -30); ctx.lineTo(charging ? 20 : 17, charging ? -34 : -12); ctx.stroke();
  ctx.strokeStyle = '#3e2723'; ctx.lineWidth = 9; ctx.lineCap = 'round';
  ctx.beginPath();
  if (charging) { ctx.moveTo(20, -34); ctx.lineTo(30, -46); } else { ctx.moveTo(17, -12); ctx.lineTo(25, -30); }
  ctx.stroke();
  ctx.strokeStyle = col; ctx.lineWidth = 4;
  // off arm
  ctx.beginPath(); ctx.moveTo(-9, -30); ctx.lineTo(-16, -14 + s * 2); ctx.stroke();
  // brutish head + underbite tusks + a single horn
  ctx.beginPath(); ctx.arc(2, -40, 8, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.moveTo(-3, -36); ctx.lineTo(-4, -42); ctx.lineTo(-1, -37); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(5, -36);  ctx.lineTo(6, -42);  ctx.lineTo(3, -37);  ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#d7ccc8';
  ctx.beginPath(); ctx.moveTo(6, -46); ctx.lineTo(11, -54); ctx.lineTo(8, -45); ctx.closePath(); ctx.fill();
  // angry little eye
  ctx.fillStyle = winding ? '#ff5252' : '#1a0e0a';
  ctx.beginPath(); ctx.arc(4, -41, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawWraith(e, col) {
  const s = Math.sin(e.phase);
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.3)';
  ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  // flowing black robe with a ragged hem
  ctx.fillStyle = col; ctx.strokeStyle = '#4a3f66'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(-11, -22, -13 + s * 2, 0);
  ctx.lineTo(-6, -5 + s * 2);
  ctx.lineTo(0, 0);
  ctx.lineTo(6, -5 - s * 2);
  ctx.lineTo(13 + s * 2, 0);
  ctx.quadraticCurveTo(11, -22, 0, -40);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // hood with nothing inside but two burning eyes
  ctx.beginPath(); ctx.arc(0, -34, 7.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(1, -33, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#e53935';
  ctx.beginPath(); ctx.arc(-1, -34, 1.3, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(3.5, -34, 1.3, 0, Math.PI * 2); ctx.fill();
  // morgul blade
  ctx.strokeStyle = '#b0bec5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(8, -20); ctx.lineTo(20, -26); ctx.stroke();
  ctx.restore();
}

// a slain wraith left crumpled on the ground (drawn in world space)
function drawCorpse(c) {
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 4, 19, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(c.dir, 1);
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = '#16121e'; ctx.strokeStyle = '#3a3050'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(-20, 1);
  ctx.quadraticCurveTo(-6, -8, 4, -3);
  ctx.quadraticCurveTo(16, -7, 24, 2);
  ctx.quadraticCurveTo(6, 8, -20, 4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(-18, -2, 6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// ── render-bosses — boss & set-piece sprites: witch-king, troopers, Vader, Sidious (+finale), DIO, The World, road roller ──
// the hooded, iron-crowned king himself — drawn at a local offset (caller sets dir)
function drawKingFigure(ox, oy, scale) {
  ctx.save(); ctx.translate(ox, oy); ctx.scale(scale, scale);
  ctx.fillStyle = '#0d0a12'; ctx.strokeStyle = '#4a3f66'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, -40);
  ctx.quadraticCurveTo(-12, -22, -14, 0);
  ctx.lineTo(-6, -4); ctx.lineTo(0, 0); ctx.lineTo(6, -4); ctx.lineTo(14, 0);
  ctx.quadraticCurveTo(12, -22, 0, -40);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // hood, with a black void where a face should be
  ctx.beginPath(); ctx.arc(0, -36, 8, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#000';
  ctx.beginPath(); ctx.arc(1, -35, 5.5, 0, Math.PI * 2); ctx.fill();
  // the iron crown of Angmar
  ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath(); ctx.moveTo(i * 4, -43);
    ctx.lineTo(i * 4, -50 - (i === 0 ? 5 : Math.abs(i) === 1 ? 2 : 0)); ctx.stroke();
  }
  // two cold eyes
  ctx.fillStyle = '#e53935';
  ctx.beginPath(); ctx.arc(-2, -36, 1.4, 0, Math.PI * 2); ctx.arc(3.5, -36, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function drawWitchKing(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath(); ctx.ellipse(0, 6, e.mounted ? 32 : 16, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  if (e.mounted) {
    const f = Math.sin(e.phase) * 14;
    // sinuous tail
    ctx.strokeStyle = '#1a1622'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-24, -6);
    ctx.quadraticCurveTo(-50, -2, -58, -18); ctx.stroke();
    // membranous wings (far one offset behind the near one, flapping out of phase)
    const wing = (off, amp) => {
      ctx.beginPath();
      ctx.moveTo(-2 + off, -16);
      ctx.quadraticCurveTo(-30 + off, -40 - amp, -48 + off, -8 - amp);
      ctx.lineTo(-30 + off, -8);
      ctx.quadraticCurveTo(-18 + off, -6, -2 + off, -10);
      ctx.closePath(); ctx.fill(); ctx.stroke();
    };
    ctx.fillStyle = 'rgba(20,16,28,0.85)'; ctx.strokeStyle = '#46395e'; ctx.lineWidth = 1.5;
    wing(10, f * 0.6);
    wing(0, f);
    // body
    ctx.fillStyle = '#15111d'; ctx.strokeStyle = '#3a2f4a'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(-6, -6, 26, 12, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // neck + wedge head reaching forward
    ctx.beginPath(); ctx.moveTo(14, -10);
    ctx.quadraticCurveTo(28, -16, 30, -30); ctx.lineTo(36, -30);
    ctx.quadraticCurveTo(34, -14, 20, -6); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(30, -32); ctx.lineTo(46, -29); ctx.lineTo(40, -23); ctx.lineTo(30, -26); ctx.closePath(); ctx.fill(); ctx.stroke();
    // horns
    ctx.strokeStyle = '#2a2236'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(32, -32); ctx.lineTo(30, -41); ctx.stroke();
    // dangling clawed legs
    ctx.strokeStyle = '#1a1622'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(-4, 4); ctx.lineTo(-2, 16); ctx.moveTo(6, 4); ctx.lineTo(10, 16); ctx.stroke();
    // the rider
    drawKingFigure(-6, -28, 0.92);
  } else {
    drawKingFigure(0, 0, 1.25);
    // the flail — chain + spiked ball, lethal mid-swing
    const len = e.mode === 'swing' ? 64 : e.mode === 'wind' ? 50 : 34;
    const bx = Math.cos(e.flailAng) * len;
    const by = -32 + Math.sin(e.flailAng) * len * 0.7;
    ctx.strokeStyle = '#888'; ctx.lineWidth = 2; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(8, -32); ctx.lineTo(bx, by); ctx.stroke();
    ctx.fillStyle = '#555'; ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 1.5;
    for (let a = 0; a < 8; a++) {
      const aa = a * Math.PI / 4;
      ctx.beginPath(); ctx.moveTo(bx + Math.cos(aa) * 10, by + Math.sin(aa) * 10);
      ctx.lineTo(bx + Math.cos(aa) * 16, by + Math.sin(aa) * 16); ctx.stroke();
    }
    ctx.beginPath(); ctx.arc(bx, by, 10, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

// classic boss life bar pinned to the top of the field
function drawBossBar(b) {
  const w = 280, x = (GW - w) / 2, y = 14;
  let label, frac, fill;
  if (b.type === 'dio') {
    label = 'DIO  ·  the world is mine';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#ffd24d';
  } else if (b.type === 'sidious') {
    label = 'DARTH SIDIOUS  ·  the dark side of the Force';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#aa66ff';
  } else if (b.type === 'vader') {
    label = 'DARTH VADER  ·  dark lord of the sith';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#ff3b30';
  } else if (b.type === 'ogre') {
    label = 'THE WAR-OGRE  ·  it hungers';
    frac = Math.max(0, b.hp) / b.maxhp; fill = '#8d6e63';
  } else {
    label = 'THE WITCH-KING OF ANGMAR' + (b.mounted ? '  ·  upon his fell beast' : '  ·  on foot');
    frac = Math.max(0, b.hp) / (b.mounted ? b.mountMax : b.footMax); fill = b.mounted ? '#7e57c2' : '#e53935';
  }
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = b.type === 'dio' ? '#ffe9a8' : b.type === 'sidious' ? '#d0b3ff' : '#e57373'; ctx.font = 'bold 12px Tahoma,Arial'; ctx.textAlign = 'center';
  ctx.fillText(label, GW / 2, y);
  ctx.shadowBlur = 0;
  ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x, y + 6, w, 8);
  ctx.fillStyle = fill; ctx.fillRect(x, y + 6, w * frac, 8);
  ctx.strokeStyle = '#bbb'; ctx.lineWidth = 1; ctx.strokeRect(x, y + 6, w, 8);
  ctx.restore(); ctx.textAlign = 'left';
}

function drawTrooper(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const sw = e.mode === 'march' ? Math.sin(e.phase) : 0;
  const white = col, edge = '#aeb9c1', dark = '#15181b';
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 3, 9, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(dir, 1);
  ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // back arm (behind the torso)
  ctx.strokeStyle = white; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(-3.5, -29); ctx.lineTo(-6, -20); ctx.stroke();

  // armoured legs: white thigh/shin, dark knee gap, dark boots, marching swing
  for (const s of [-1, 1]) {
    const off = s * sw * 3;
    ctx.strokeStyle = white; ctx.lineWidth = 4.8;
    ctx.beginPath(); ctx.moveTo(s * 2, -15); ctx.lineTo(s * 2 + off, -2); ctx.stroke();
    ctx.strokeStyle = dark; ctx.lineWidth = 4.8;  // black undersuit at the knee
    ctx.beginPath(); ctx.moveTo(s * 2 + off * 0.5, -8.5); ctx.lineTo(s * 2 + off * 0.6, -7); ctx.stroke();
  }
  ctx.fillStyle = dark;  // boots
  ctx.beginPath();
  ctx.ellipse(-2 - sw * 3, -1.5, 3.4, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(2 + sw * 3, -1.5, 3.4, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();

  // abdomen plate + dark belt
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-4.6, -25); ctx.lineTo(4.6, -25); ctx.lineTo(4, -15); ctx.lineTo(-4, -15); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(-4.6, -17.5, 9.2, 2.4);

  // chest plate (broad shoulders) + collar line + dark neck
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath(); ctx.moveTo(-6, -30.5); ctx.lineTo(6, -30.5); ctx.lineTo(4.8, -25); ctx.lineTo(-4.8, -25); ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#23282c'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-4.6, -26); ctx.lineTo(4.6, -26); ctx.stroke();
  ctx.fillStyle = dark; ctx.fillRect(-2, -31.5, 4, 2.4);  // undersuit neck

  // shoulder pauldrons
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.ellipse(-5.6, -29.5, 2.4, 3, 0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.ellipse(5.6, -29.5, 2.4, 3, -0.35, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

  // helmet — domed shell with the angular black mask
  ctx.fillStyle = white; ctx.strokeStyle = edge; ctx.lineWidth = 1.3;
  ctx.beginPath();
  ctx.moveTo(-5.5, -33);
  ctx.quadraticCurveTo(-6.4, -43, 0, -43.5);
  ctx.quadraticCurveTo(6.4, -43, 5.5, -33);
  ctx.quadraticCurveTo(5, -30.8, 0, -30.8);
  ctx.quadraticCurveTo(-5, -30.8, -5.5, -33);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // black brow connecting the eye lenses
  ctx.strokeStyle = dark; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-4.8, -39.2); ctx.quadraticCurveTo(0, -40.6, 4.8, -39.2); ctx.stroke();
  // the two angled "tear" eye lenses, white nose ridge between
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-4.6, -38.6); ctx.quadraticCurveTo(-1.6, -38.4, -1.3, -36.2); ctx.quadraticCurveTo(-3.2, -36, -4.6, -37); ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(4.6, -38.6); ctx.quadraticCurveTo(1.6, -38.4, 1.3, -36.2); ctx.quadraticCurveTo(3.2, -36, 4.6, -37); ctx.closePath(); ctx.fill();
  // cheek vent dashes below the eyes
  ctx.strokeStyle = dark; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-3.7, -35.6); ctx.lineTo(-3.7, -34);
  ctx.moveTo(3.7, -35.6); ctx.lineTo(3.7, -34); ctx.stroke();
  // frown / breathing grille with vent teeth
  ctx.fillStyle = dark;
  ctx.beginPath(); ctx.moveTo(-3.4, -33.4); ctx.lineTo(3.4, -33.4); ctx.quadraticCurveTo(2.4, -30.9, 0, -31); ctx.quadraticCurveTo(-2.4, -30.9, -3.4, -33.4); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = white; ctx.lineWidth = 0.6;
  ctx.beginPath();
  ctx.moveTo(-1.6, -33.2); ctx.lineTo(-1.6, -31.4);
  ctx.moveTo(0, -33.3); ctx.lineTo(0, -31.2);
  ctx.moveTo(1.6, -33.2); ctx.lineTo(1.6, -31.4); ctx.stroke();

  // front arm + E-11 blaster levelled forward (drawn last, over the torso)
  ctx.strokeStyle = white; ctx.lineWidth = 3.4;
  ctx.beginPath(); ctx.moveTo(3, -29); ctx.lineTo(9, -23); ctx.stroke();
  ctx.strokeStyle = dark; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(6, -23.5); ctx.lineTo(20, -23.5); ctx.stroke();   // barrel
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(9, -23); ctx.lineTo(9.5, -19); ctx.stroke();      // grip
  ctx.beginPath(); ctx.moveTo(11, -25.2); ctx.lineTo(14.5, -25.2); ctx.stroke(); // scope
  ctx.restore();
}

function drawVader(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const rim = '#8b97a6';  // cool rim-light edge so the black silhouette reads against the void
  // saber angle: raised on the wind-up, sweeping across the front during the slash
  const ang = e.mode === 'slash' ? e.slashAng
            : e.mode === 'wind'  ? Math.atan2(player.y - e.y, player.x - e.x) - 1.3
            : Math.atan2(player.y - e.y, player.x - e.x) - 0.3;
  ctx.save(); ctx.translate(e.x, e.y);
  // backlight halo — separates the dark silhouette from the dark starfield
  const halo = ctx.createRadialGradient(0, -20, 3, 0, -20, 42);
  halo.addColorStop(0, 'rgba(150,180,212,0.36)');
  halo.addColorStop(0.55, 'rgba(120,150,190,0.15)');
  halo.addColorStop(1, 'rgba(120,150,190,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.ellipse(0, -20, 34, 42, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.32)';
  ctx.beginPath(); ctx.ellipse(0, 4, 14, 4, 0, 0, Math.PI * 2); ctx.fill();
  // raised Force hand telegraph (unmirrored so it points at the player) during a cast / choke
  if (e.mode === 'cast' || e.mode === 'choke') {
    const pa = Math.atan2(player.y - (e.y - 22), player.x - e.x);
    const px = Math.cos(pa), py = Math.sin(pa);
    ctx.strokeStyle = rim; ctx.lineWidth = 3; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(dir * 3, -28); ctx.lineTo(px * 13, -22 + py * 13); ctx.stroke();
    const reach = e.mode === 'choke' ? 1 : (0.5 + 0.5 * Math.abs(Math.sin(frame * 0.4)));
    ctx.fillStyle = 'rgba(150,120,210,' + (0.28 * reach).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(px * 16, -22 + py * 16, 7 + 4 * reach, 0, Math.PI * 2); ctx.fill();
    if (e.mode === 'choke') {  // a taut line of dark energy to the throttled hero
      ctx.strokeStyle = 'rgba(150,120,210,0.5)'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(px * 18, -22 + py * 18); ctx.lineTo(player.x - e.x, (player.y - 18) - e.y); ctx.stroke();
    }
  }
  // red saber drawn in unmirrored space so it tracks the player (gone while it's mid-throw)
  if (!e.disarmed) {
    const hx = dir * 9, hy = -22;
    ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 4; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + Math.cos(ang) * 8, hy + Math.sin(ang) * 8); ctx.stroke();
    ctx.shadowColor = '#ff4438'; ctx.shadowBlur = 14;
    ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(hx + Math.cos(ang) * 8, hy + Math.sin(ang) * 8);
    ctx.lineTo(hx + Math.cos(ang) * 52, hy + Math.sin(ang) * 52);
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  ctx.scale(dir, 1);
  // flowing cape
  ctx.fillStyle = '#0c0c10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-3, -38);
  ctx.quadraticCurveTo(-15, -18, -11 + Math.sin(e.phase) * 2, 2);
  ctx.lineTo(-2, -4); ctx.lineTo(4, 2);
  ctx.quadraticCurveTo(9, -18, 3, -38);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // legs (dark, but light enough to catch the backlight)
  ctx.strokeStyle = '#26292f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-4, 0); ctx.moveTo(0, -16); ctx.lineTo(4, 0); ctx.stroke();
  ctx.strokeStyle = rim; ctx.lineWidth = 1;  // rim highlight down the front of the legs
  ctx.beginPath(); ctx.moveTo(0.6, -15); ctx.lineTo(4.6, 0); ctx.stroke();
  // torso
  ctx.fillStyle = col; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(5, -16); ctx.lineTo(-5, -16); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // chest control box (blinking lights)
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-4, -32, 8, 6);
  ctx.fillStyle = frame % 40 < 20 ? '#ff5252' : '#4dd0e1'; ctx.fillRect(-3, -31, 2, 2);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(1, -31, 2, 2);
  // helmet — domed with the angular mask
  ctx.fillStyle = '#0d0d10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(0, -41, 7.5, Math.PI, 0); ctx.lineTo(6, -36); ctx.lineTo(-6, -36); ctx.closePath();
  ctx.fill(); ctx.stroke();
  // glossy glint across the dome to catch the eye
  ctx.strokeStyle = 'rgba(190,210,235,0.7)'; ctx.lineWidth = 1.4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, -41, 5.4, Math.PI * 1.12, Math.PI * 1.42); ctx.stroke();
  // mask detail: eyes + breathing grille
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-5, -41); ctx.lineTo(-2, -40); ctx.moveTo(5, -41); ctx.lineTo(2, -40); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.moveTo(-2.5, -38); ctx.lineTo(2.5, -38); ctx.lineTo(1.5, -34); ctx.lineTo(-1.5, -34); ctx.closePath(); ctx.fill();
  ctx.restore();
}

// a glowing lightsaber blade from a hilt pivot — metal hilt, colored glow, white-hot core
function _saberBlade(hx, hy, ang, len, color) {
  color = color || '#ff5347';
  const ca = Math.cos(ang), sa = Math.sin(ang);
  // hilt — a short metal cylinder with an emitter ring and a darker grip
  ctx.lineCap = 'butt';
  ctx.strokeStyle = '#c7ccd3'; ctx.lineWidth = 3.6;
  ctx.beginPath(); ctx.moveTo(hx - ca * 4, hy - sa * 4); ctx.lineTo(hx + ca * 6, hy + sa * 6); ctx.stroke();
  ctx.strokeStyle = '#4a4e55'; ctx.lineWidth = 3.6;   // grip
  ctx.beginPath(); ctx.moveTo(hx - ca * 4, hy - sa * 4); ctx.lineTo(hx - ca * 1, hy - sa * 1); ctx.stroke();
  ctx.strokeStyle = '#e6e9ee'; ctx.lineWidth = 1.6;   // emitter ring highlight
  ctx.beginPath(); ctx.moveTo(hx + ca * 5, hy + sa * 5); ctx.lineTo(hx + ca * 6.5, hy + sa * 6.5); ctx.stroke();
  if (len <= 1) return;
  const bx = hx + ca * 7, by = hy + sa * 7;
  const tx = hx + ca * (7 + len), ty = hy + sa * (7 + len);
  ctx.lineCap = 'round';
  ctx.shadowColor = color; ctx.shadowBlur = 15;       // outer bloom
  ctx.strokeStyle = color; ctx.lineWidth = 5.5;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.shadowBlur = 6;                                  // white-hot core
  ctx.strokeStyle = 'rgba(255,242,238,0.95)'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(tx, ty); ctx.stroke();
  ctx.shadowBlur = 0;
}
function drawSidious(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const rim = '#8f95a3';
  const hop = e.hop || 0;
  const casting = e.mode === 'cast' || e.mode === 'lightning';
  const bl = (e.lit || 0) * 44;   // blade length grows as the sabers ignite
  ctx.save(); ctx.translate(e.x, e.y - hop);
  ctx.lineJoin = 'round';
  // backlight — separates the dark robe from the void (violet-tinged; fiercer once he's pure lightning)
  const halo = ctx.createRadialGradient(0, -24, 3, 0, -24, e.phase2 ? 50 : 46);
  halo.addColorStop(0, e.phase2 ? 'rgba(190,150,255,0.46)' : 'rgba(170,120,220,0.34)');
  halo.addColorStop(0.55, e.phase2 ? 'rgba(150,110,230,0.2)' : 'rgba(130,90,180,0.14)');
  halo.addColorStop(1, 'rgba(130,90,180,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.ellipse(0, -24, e.phase2 ? 38 : 35, e.phase2 ? 50 : 47, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.30)';
  ctx.beginPath(); ctx.ellipse(0, 4 + hop, 13, 4, 0, 0, Math.PI * 2); ctx.fill();

  // motion-blur ghosts while moving fast — sells speed so leaps/spins read as motion, not teleport
  if (!api.reduceMotion && (e.mode === 'leap' || e.mode === 'spin')) {
    const mvx = e.mvx || 0, mvy = e.mvy || 0;
    if (Math.hypot(mvx, mvy) > 2.5) {
      for (let g = 3; g >= 1; g--) {
        ctx.save();
        ctx.globalAlpha = 0.14 * (1 - (g - 1) / 3);
        ctx.translate(-mvx * g * 1.5, -mvy * g * 1.5);
        ctx.scale(dir, 1);
        ctx.fillStyle = '#7a4fc0';
        ctx.beginPath();
        ctx.moveTo(0, -47); ctx.quadraticCurveTo(-12, -30, -11, 4);
        ctx.lineTo(11, 4); ctx.quadraticCurveTo(12, -30, 0, -47);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }

  /* ── body (mirrored to face the player) ── */
  ctx.save(); ctx.scale(dir, 1);
  const sway = Math.sin(e.phase) * 1.5;
  // heavy black cassock — hunched, rounded shoulders forward, a broad ragged hem.
  // a vertical gradient gives the cloth depth: faint violet sheen up top, pure black at the hem
  const robe = ctx.createLinearGradient(0, -48, 0, 6);
  robe.addColorStop(0, '#221c30'); robe.addColorStop(0.45, col); robe.addColorStop(1, '#040308');
  ctx.fillStyle = robe; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(0, -48);
  ctx.quadraticCurveTo(-12, -46, -14, -33);            // hunched shoulder
  ctx.quadraticCurveTo(-19, -13, -15 + sway, 5);        // sweep out to a wide hem
  ctx.lineTo(-9, 1); ctx.lineTo(-5, 5); ctx.lineTo(-1, 1);  // ragged hem
  ctx.lineTo(0, 5); ctx.lineTo(2, 1); ctx.lineTo(6, 5); ctx.lineTo(10, 1);
  ctx.lineTo(15 - sway, 5);
  ctx.quadraticCurveTo(19, -13, 14, -33);
  ctx.quadraticCurveTo(12, -46, 0, -48);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // a darker inner placket down the front + fold lines catching the violet rim
  ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(0, -33); ctx.lineTo(0, 4); ctx.stroke();
  ctx.strokeStyle = 'rgba(155,135,190,0.22)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-4, -28); ctx.lineTo(-9 + sway, 3);
  ctx.moveTo(4, -28); ctx.lineTo(9 - sway, 3);
  ctx.moveTo(-1.6, -30); ctx.lineTo(-2.4, 3);
  ctx.moveTo(1.6, -30); ctx.lineTo(2.4, 3);
  ctx.stroke();
  // deep cowl — a big peaked hood draping forward, swallowing the face in shadow
  ctx.fillStyle = '#0b0812'; ctx.strokeStyle = rim; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -55);                                   // the peak
  ctx.quadraticCurveTo(-13, -53, -12, -37);
  ctx.quadraticCurveTo(-11, -29, -4, -28);
  ctx.lineTo(4, -28);
  ctx.quadraticCurveTo(11, -29, 12, -37);
  ctx.quadraticCurveTo(13, -53, 0, -55);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // a violet rim-light down the hood's leading edge
  ctx.strokeStyle = 'rgba(180,150,235,0.4)'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(2, -54); ctx.quadraticCurveTo(12, -52, 11, -37); ctx.stroke();
  // the hollow of the hood — pure dark, the face recedes into it
  ctx.fillStyle = '#040305';
  ctx.beginPath(); ctx.ellipse(0, -39, 7.5, 9.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // face set deep in the cowl — gaunt and pale, with a hooked nose, a sneer, and sunken yellow eyes
  ctx.save();
  const fcx = dir * 0.7;
  // dim, sallow skin catching the faint backlight — gaunt and long
  ctx.fillStyle = 'rgba(196,182,152,0.82)';
  ctx.beginPath(); ctx.ellipse(fcx, -38, 3.6, 6, 0, 0, Math.PI * 2); ctx.fill();
  // heavy brow shadow across the top of the face
  ctx.fillStyle = 'rgba(14,8,14,0.7)';
  ctx.beginPath(); ctx.ellipse(fcx, -41.4, 4.2, 2.3, 0, 0, Math.PI * 2); ctx.fill();
  // angry brows angled down toward the nose — a fixed glare
  ctx.strokeStyle = 'rgba(10,6,12,0.92)'; ctx.lineWidth = 1.3; ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(fcx - 3.7, -41.4); ctx.lineTo(fcx - 0.8, -39.9);
  ctx.moveTo(fcx + 3.7, -41.4); ctx.lineTo(fcx + 0.8, -39.9);
  ctx.stroke();
  // sunken eye sockets
  ctx.fillStyle = 'rgba(22,12,18,0.85)';
  ctx.beginPath();
  ctx.ellipse(fcx - 2.2, -39.6, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.ellipse(fcx + 2.2, -39.6, 1.9, 1.7, 0, 0, Math.PI * 2);
  ctx.fill();
  // hollow cheeks
  ctx.fillStyle = 'rgba(58,38,42,0.5)';
  ctx.beginPath();
  ctx.ellipse(fcx - 3, -35.6, 1.2, 2.2, 0, 0, Math.PI * 2);
  ctx.ellipse(fcx + 3, -35.6, 1.2, 2.2, 0, 0, Math.PI * 2);
  ctx.fill();
  // hooked nose + thin sneering mouth + a furrow between the brows
  ctx.strokeStyle = 'rgba(64,42,42,0.62)'; ctx.lineWidth = 0.8; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(fcx, -39.6); ctx.quadraticCurveTo(fcx + dir * 1, -36.5, fcx, -35); ctx.stroke();
  ctx.strokeStyle = 'rgba(40,24,26,0.78)'; ctx.lineWidth = 1;   // a deeper, downturned sneer
  ctx.beginPath(); ctx.moveTo(fcx - 2.1, -33.4); ctx.quadraticCurveTo(fcx, -32.3, fcx + 2.1, -33.6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(fcx - 0.5, -42.4); ctx.lineTo(fcx - 0.9, -40.4); ctx.stroke();
  // sickly yellow eyes, glowing deep in the sockets
  ctx.shadowColor = '#ffcf4a'; ctx.shadowBlur = 5; ctx.fillStyle = '#f4d24a';
  ctx.beginPath();
  ctx.arc(fcx - 2.2, -39.6, 1.05, 0, Math.PI * 2);
  ctx.arc(fcx + 2.2, -39.6, 1.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = '#fff4c0'; ctx.shadowBlur = 2; ctx.fillStyle = '#fff0b0';  // hot catch-light
  ctx.beginPath();
  ctx.arc(fcx - 2.4, -39.9, 0.4, 0, Math.PI * 2);
  ctx.arc(fcx + 2.0, -39.9, 0.4, 0, Math.PI * 2);
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.restore();

  /* ── arms + twin sabers / lightning (unmirrored so they aim true) ── */
  const sh = { x: dir * 6, y: -33 };                   // shoulder origin
  if (e.mode === 'spin') {
    // both blades whirl into a blurred lethal ring
    for (let k = 0; k < 2; k++) _saberBlade(0, -22, e.spinAng + k * Math.PI, 46);
    ctx.globalAlpha = 0.22; ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, -22, 53, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (e.mode === 'wind') {
    // both blades raised and crossed overhead — the spin is coming
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves up
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(-3, -34); ctx.lineTo(0, -30); ctx.stroke();
    _saberBlade(0, -30, -Math.PI / 2 - 0.45, 44);
    _saberBlade(0, -30, -Math.PI / 2 + 0.45, 44);
    if (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) {
      ctx.globalAlpha = 0.3; ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, -22, 50, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
    }
  } else if (casting) {
    // gnarled hands thrust forward along the aim, violet crackle gathering between them
    const pa = Math.atan2(e.ly, e.lx);
    const h1 = { x: Math.cos(pa) * 15, y: -25 + Math.sin(pa) * 15 };
    const h2 = { x: Math.cos(pa - 0.34) * 13, y: -20 + Math.sin(pa - 0.34) * 13 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 4); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    ctx.strokeStyle = '#cfcabf'; ctx.lineWidth = 2;                          // bony hands
    ctx.beginPath(); ctx.moveTo(h1.x - Math.cos(pa) * 3, h1.y - Math.sin(pa) * 3); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2.x - Math.cos(pa) * 3, h2.y - Math.sin(pa) * 3); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    const steady = api.reduceMotion || e.mode === 'lightning';
    // the orb swells as the charge builds, so the windup is unmistakable
    const prog = e.mode === 'cast' && e.castDur ? clamp(1 - e.st / e.castDur, 0, 1) : 1;
    const ox = (h1.x + h2.x) / 2, oy = (h1.y + h2.y) / 2;
    ctx.shadowColor = '#b388ff'; ctx.shadowBlur = 10 + prog * 10;
    ctx.fillStyle = 'rgba(196,158,255,' + (steady ? 0.55 : 0.35 + 0.3 * prog + 0.2 * Math.abs(Math.sin(frame * 0.5))).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(ox, oy, 4 + prog * 6, 0, Math.PI * 2); ctx.fill();
    // little arcs spitting off the gathering orb during the windup
    if (e.mode === 'cast' && prog > 0.25) {
      ctx.strokeStyle = 'rgba(220,200,255,0.8)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
      for (let a = 0; a < 3; a++) {
        const ar = (frame * 0.5 + a * 2.1), rr = (4 + prog * 6);
        const jx = (rnd() - 0.5) * 3, jy = (rnd() - 0.5) * 3;   // consumed even under reduced motion — settings must not shift the RNG stream
        if (api.reduceMotion) continue;
        ctx.beginPath(); ctx.moveTo(ox, oy);
        ctx.lineTo(ox + Math.cos(ar) * rr * 1.7 + jx, oy + Math.sin(ar) * rr * 1.7 + jy);
        ctx.stroke();
      }
    }
    ctx.shadowBlur = 0;
  } else if (e.phase2) {
    // sabers stowed — open hands wreathed in residual Force lightning
    const base = Math.atan2(player.y - e.y, player.x - e.x);
    const h1 = { x: dir * 11 + Math.cos(base) * 4, y: -27 }, h2 = { x: dir * 12 + Math.cos(base) * 4, y: -16 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';   // sleeves to the hands
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 5); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    ctx.strokeStyle = '#cfcabf'; ctx.lineWidth = 2;                           // bony fingers
    ctx.beginPath(); ctx.moveTo(h1.x - dir * 3, h1.y); ctx.lineTo(h1.x, h1.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(h2.x - dir * 3, h2.y); ctx.lineTo(h2.x, h2.y); ctx.stroke();
    {                                   // small idle sparks crawling between the fingertips
      ctx.strokeStyle = 'rgba(200,175,255,0.7)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
      for (const h of [h1, h2]) {
        const a = frame * 0.4 + h.y;
        const jx = (rnd() - 0.5) * 2, jy = (rnd() - 0.5) * 2;  // consumed even under reduced motion
        if (api.reduceMotion) continue;
        ctx.beginPath(); ctx.moveTo(h.x, h.y);
        ctx.lineTo(h.x + Math.cos(a) * 5 + jx, h.y + Math.sin(a) * 5 + jy);
        ctx.stroke();
      }
    }
    ctx.fillStyle = 'rgba(180,150,255,0.5)';
    ctx.beginPath(); ctx.arc(h1.x, h1.y, 1.6, 0, Math.PI * 2); ctx.arc(h2.x, h2.y, 1.6, 0, Math.PI * 2); ctx.fill();
  } else {
    // resting guard: twin sabers, one high one low, tracking the player
    const base = Math.atan2(player.y - e.y, player.x - e.x);
    const hi = { x: dir * 10, y: -28 }, lo = { x: dir * 11, y: -16 };
    ctx.strokeStyle = '#11111a'; ctx.lineWidth = 4; ctx.lineCap = 'round';  // sleeves to the hilts
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hi.x, hi.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y + 5); ctx.lineTo(lo.x, lo.y); ctx.stroke();
    _saberBlade(hi.x, hi.y, base - 0.66, bl);    // splayed into a wide guard V
    _saberBlade(lo.x, lo.y, base + 0.62, bl);
  }
  ctx.restore();
}
function drawGuard(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const reach = e.mode === 'aim' || e.mode === 'lunge';
  const sw = e.mode === 'stalk' ? Math.sin(e.phase) * 3 : 0;
  ctx.save(); ctx.translate(e.x, e.y);
  ctx.lineJoin = 'round';
  ctx.fillStyle = 'rgba(0,0,0,0.28)';
  ctx.beginPath(); ctx.ellipse(0, 3, 11, 4, 0, 0, Math.PI * 2); ctx.fill();

  // force pike (unmirrored, toward the player) — dark haft, glowing vibro-tip at the business end
  ctx.lineCap = 'round';
  const grip = { x: dir * 9, y: -22 };
  const tip  = reach ? { x: dir * 31, y: -13 } : { x: dir * 14, y: -46 };
  const butt = reach ? { x: dir * 1,  y: -27 } : { x: dir * 11, y: -2 };
  ctx.strokeStyle = '#2f3034'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(butt.x, butt.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.strokeStyle = '#54565c'; ctx.lineWidth = 1;     // haft highlight
  ctx.beginPath(); ctx.moveTo(butt.x, butt.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.fillStyle = '#1f2024';                          // grip collar
  ctx.beginPath(); ctx.arc(grip.x, grip.y, 1.8, 0, Math.PI * 2); ctx.fill();
  // emitter tip — always faintly lit, flares when aiming/lunging
  const hot = reach && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0);
  ctx.shadowColor = '#ff4d4d'; ctx.shadowBlur = reach ? 10 : 5;
  ctx.strokeStyle = hot ? '#ff8a8a' : '#d23030'; ctx.lineWidth = reach ? 3.2 : 2.4;
  const ta = Math.atan2(tip.y - butt.y, tip.x - butt.x);
  ctx.beginPath();
  ctx.moveTo(tip.x - Math.cos(ta) * 7, tip.y - Math.sin(ta) * 7);
  ctx.lineTo(tip.x, tip.y); ctx.stroke();
  ctx.shadowBlur = 0;

  /* ── body (mirrored) ── */
  ctx.save(); ctx.scale(dir, 1);
  // long flowing crimson robe with a darker under-drape
  ctx.fillStyle = '#7a1414';                          // shadowed under-robe
  ctx.beginPath();
  ctx.moveTo(-2, -30); ctx.quadraticCurveTo(-12, -10, -8 + sw * 0.3, 4);
  ctx.lineTo(8 - sw * 0.3, 4); ctx.quadraticCurveTo(12, -10, 2, -30);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = col; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(0, -34);
  ctx.quadraticCurveTo(-9, -28, -10, -15);
  ctx.quadraticCurveTo(-11, -4, -8 + sw * 0.4, 3);
  ctx.lineTo(8 - sw * 0.4, 3);
  ctx.quadraticCurveTo(11, -4, 10, -15);
  ctx.quadraticCurveTo(9, -28, 0, -34);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // robe folds
  ctx.strokeStyle = 'rgba(70,8,8,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-3, -26); ctx.lineTo(-4, 3); ctx.moveTo(0, -28); ctx.lineTo(0, 3); ctx.moveTo(3, -26); ctx.lineTo(4, 3);
  ctx.stroke();
  // shoulder pauldrons
  ctx.fillStyle = '#9c1a1a'; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(-9, -31); ctx.quadraticCurveTo(-13, -29, -10, -22); ctx.lineTo(-5, -27); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(9, -31); ctx.quadraticCurveTo(13, -29, 10, -22); ctx.lineTo(5, -27); ctx.closePath(); ctx.fill(); ctx.stroke();
  // tall helmet — domed crest, angular faceplate, dark visor band
  ctx.fillStyle = '#b71c1c'; ctx.strokeStyle = '#5e0f0f'; ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-5, -33);
  ctx.lineTo(-5, -40);
  ctx.quadraticCurveTo(-5, -49, 0, -50);
  ctx.quadraticCurveTo(5, -49, 5, -40);
  ctx.lineTo(5, -33);
  ctx.quadraticCurveTo(0, -31, -5, -33);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // vertical crest ridge + sheen
  ctx.strokeStyle = '#e0534f'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(0, -49); ctx.lineTo(0, -40); ctx.stroke();
  ctx.strokeStyle = 'rgba(255,180,180,0.45)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(-1.5, -44, 3.5, Math.PI * 1.1, Math.PI * 1.5); ctx.stroke();
  // narrow dark visor
  ctx.fillStyle = '#160404';
  ctx.beginPath(); ctx.moveTo(-3.6, -41); ctx.lineTo(3.6, -41); ctx.lineTo(2.8, -36.5); ctx.lineTo(-2.8, -36.5); ctx.closePath(); ctx.fill();
  ctx.restore();
  ctx.restore();
}

/* ── death cutscene drawing: Vader, a limp Emperor, and lightning over them both ── */
function _ltnArc(x1, y1, x2, y2, segs, jit, seed) {
  const mx = x2 - x1, my = y2 - y1, len = Math.hypot(mx, my) || 1, px = -my / len, py = mx / len;
  ctx.beginPath(); ctx.moveTo(x1, y1);
  for (let s = 1; s <= segs; s++) {
    const t = s / segs;
    const j = s === segs ? 0 : (Math.sin(seed + s * 2.7) + Math.sin(seed * 0.5 + s * 5.3)) * jit;
    ctx.lineTo(x1 + mx * t + px * j, y1 + my * t + py * j);
  }
  ctx.stroke();
}
function _drawVaderFig(x, y, fd, armsUp, alpha) {
  const rim = '#8b97a6';
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(x, y);
  ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.beginPath(); ctx.ellipse(0, 2, 13, 4, 0, 0, Math.PI * 2); ctx.fill();
  ctx.scale(fd, 1);
  // cape
  ctx.fillStyle = '#0c0c10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-3, -40); ctx.quadraticCurveTo(-15, -18, -11, 2); ctx.lineTo(-2, -4); ctx.lineTo(4, 2); ctx.quadraticCurveTo(9, -18, 3, -40); ctx.closePath(); ctx.fill(); ctx.stroke();
  // legs
  ctx.strokeStyle = '#26292f'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(-4, 0); ctx.moveTo(0, -16); ctx.lineTo(4, 0); ctx.stroke();
  // torso
  ctx.fillStyle = '#0a0a0c'; ctx.strokeStyle = rim; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.moveTo(-6, -36); ctx.lineTo(6, -36); ctx.lineTo(5, -16); ctx.lineTo(-5, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
  // chest control box
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-4, -32, 8, 6);
  ctx.fillStyle = frame % 40 < 20 ? '#ff5252' : '#4dd0e1'; ctx.fillRect(-3, -31, 2, 2);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(1, -31, 2, 2);
  // arms — raised overhead to carry, else at his sides
  ctx.strokeStyle = '#15171b'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  if (armsUp) {
    ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(-7, -50); ctx.lineTo(-3, -59); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -34); ctx.lineTo(7, -50); ctx.lineTo(3, -59); ctx.stroke();
  } else {
    ctx.beginPath(); ctx.moveTo(-4, -33); ctx.lineTo(-8, -22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(4, -33); ctx.lineTo(8, -22); ctx.stroke();
  }
  // helmet + mask
  ctx.fillStyle = '#0d0d10'; ctx.strokeStyle = rim; ctx.lineWidth = 1.7;
  ctx.beginPath(); ctx.arc(0, -41, 7.5, Math.PI, 0); ctx.lineTo(6, -36); ctx.lineTo(-6, -36); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#1a1a1a'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.moveTo(-5, -41); ctx.lineTo(-2, -40); ctx.moveTo(5, -41); ctx.lineTo(2, -40); ctx.stroke();
  ctx.fillStyle = '#1a1a1a';
  ctx.beginPath(); ctx.moveTo(-2.5, -38); ctx.lineTo(2.5, -38); ctx.lineTo(1.5, -34); ctx.lineTo(-1.5, -34); ctx.closePath(); ctx.fill();
  ctx.restore();
}
// a limp, hanging Emperor held overhead — head lolled, arms and robe dangling
function _drawSidiousLimp(x, y, swing) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(swing);
  ctx.lineJoin = 'round';
  // robe draping down from where Vader grips him
  ctx.fillStyle = '#0a0a0e'; ctx.strokeStyle = '#8f95a3'; ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.moveTo(-8, -2); ctx.quadraticCurveTo(-13, 14, -6, 22);
  ctx.lineTo(7, 20); ctx.quadraticCurveTo(12, 10, 9, -2);
  ctx.quadraticCurveTo(4, -7, 0, -7); ctx.quadraticCurveTo(-4, -7, -8, -2);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // lolled hooded head
  ctx.fillStyle = '#070709'; ctx.strokeStyle = '#8f95a3'; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.ellipse(-9, -4, 6, 5.5, 0.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#9a7e22';   // dim, dying eyes
  ctx.beginPath(); ctx.arc(-10.5, -5, 0.9, 0, Math.PI * 2); ctx.arc(-8, -6, 0.9, 0, Math.PI * 2); ctx.fill();
  // dangling arms, hands still sparking
  ctx.strokeStyle = '#11111a'; ctx.lineWidth = 3; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, 4); ctx.lineTo(-14, 13); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(14, 16); ctx.stroke();
  ctx.fillStyle = 'rgba(190,150,255,0.6)';
  ctx.beginPath(); ctx.arc(-14, 13, 2, 0, Math.PI * 2); ctx.arc(14, 16, 2, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
function drawSidiousFinale() {
  const f = sidFinale;
  const grounded = f.phase === 'rise';
  const vy = f.vy;
  // Vader: slides up out of the deck during 'rise', then on his feet
  const vDrop = (1 - f.vrise) * 30;
  const armsUp = f.phase !== 'rise';
  // Emperor: slumped where he died until grabbed, then hoisted overhead and carried
  const sidX = grounded ? f.sx : f.vx + f.faceDir * 1;
  const sidY = grounded ? f.sy - 6 : vy - 61 - f.lift * 3;
  const swing = grounded ? 0 : Math.sin(frame * 0.12) * 0.06 * (f.phase === 'carry' ? 1 : 0.4);

  // a dark haze where Vader rises
  if (grounded && f.vrise < 1) {
    ctx.save(); ctx.globalAlpha = 0.4 * (1 - f.vrise);
    ctx.fillStyle = '#1a1430';
    ctx.beginPath(); ctx.ellipse(f.vx, vy + 2, 22, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  // limp Emperor (drawn behind Vader's raised arms during the lift/carry, in front during rise)
  if (grounded) _drawSidiousLimp(sidX, sidY, swing);
  // Vader, emerging then carrying
  ctx.save();
  if (vDrop > 0) { ctx.beginPath(); ctx.rect(0, 0, GW, vy + 4); ctx.clip(); }  // clip so he rises from the floor
  _drawVaderFig(f.vx, vy + vDrop, f.faceDir, armsUp, grounded ? f.vrise : 1);
  ctx.restore();
  if (!grounded) _drawSidiousLimp(sidX, sidY, swing);

  // ── the lightning: it shocks them both — arcs from the Emperor crawling all over Vader ──
  const inten = grounded ? f.vrise : 1;
  if (inten > 0.05) {
    const hands = [{ x: sidX - 13, y: sidY + 13 }, { x: sidX + 13, y: sidY + 16 }, { x: sidX, y: sidY - 2 }];
    const targets = [{ x: f.vx, y: vy + vDrop - 41 }, { x: f.vx - 5, y: vy + vDrop - 20 }, { x: f.vx + 5, y: vy + vDrop - 18 }];
    const n = api.reduceMotion ? 2 : 3 + Math.round(inten * 2);
    for (let pass = 0; pass < 2; pass++) {
      ctx.save(); ctx.lineCap = 'round';
      ctx.shadowColor = '#9a6cff'; ctx.shadowBlur = pass === 0 ? 9 : 3;
      ctx.strokeStyle = pass === 0 ? 'rgba(170,120,255,0.5)' : 'rgba(255,255,255,0.95)';
      ctx.lineWidth = pass === 0 ? 2.3 : 1;
      for (let i = 0; i < n; i++) {
        const seed = api.reduceMotion ? i * 11 : frame * 0.7 + i * 4.3;
        const a = hands[i % hands.length], b = targets[i % targets.length];
        _ltnArc(a.x, a.y, b.x, b.y, 7, 4, seed);
      }
      // one arc crawling over Vader's own frame — he's caught in it too
      _ltnArc(f.vx - 6, vy + vDrop - 36, f.vx + 6, vy + vDrop - 20, 6, 4, frame * 0.9);
      ctx.restore();
    }
    // sparks flying off
    if (frame % 4 === 0) {
      const t = targets[Math.floor(rnd() * targets.length)];
      const ox = (rnd() - 0.5) * 14, oy = (rnd() - 0.5) * 14;  // consumed even under reduced motion
      if (!api.reduceMotion) sparks.push({ x: t.x + ox, y: t.y + oy, t: 8, color: '#d8c4ff', txt: '✦' });
    }
  }
}

/* ── DIO + The World ── */
// ── Stand-sprite helpers (shared by The World / Star Platinum) ──
// a jointed arm: shoulder → bent elbow → clenched fist
function _standArm(sx, sy, fx, fy, col, edge) {
  const ex = (sx + fx) / 2 + (fx > sx ? 2.5 : -2.5), ey = (sy + fy) / 2 + 3;  // elbow bows out + down
  ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = col; ctx.strokeStyle = edge; ctx.lineWidth = 1.2;
  ctx.beginPath(); ctx.arc(fx, fy, 3.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();  // fist
}
// a small filled heart (DIO/The World motif); fill colour set by the caller
function _heart(x, y, s) {
  ctx.beginPath(); ctx.moveTo(x, y + s);
  ctx.bezierCurveTo(x - s * 1.5, y - s * 0.5, x - s * 0.5, y - s * 1.35, x, y - s * 0.4);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 1.35, x + s * 1.5, y - s * 0.5, x, y + s);
  ctx.closePath(); ctx.fill();
}
// a 5-point star (Star Platinum motif); fill colour set by the caller
function _star(x, y, s) {
  ctx.beginPath();
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + i * 2 * Math.PI / 5, a2 = a + Math.PI / 5;
    ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * s, y + Math.sin(a) * s);
    ctx.lineTo(x + Math.cos(a2) * s * 0.45, y + Math.sin(a2) * s * 0.45);
  }
  ctx.closePath(); ctx.fill();
}

// The World — DIO's golden clockwork Stand, looming behind his shoulder
function drawTheWorld(dir, alpha, mode) {
  const gold = '#e8c24a', lit = '#f6dd86', dk = '#6b5a1f', grn = '#5f9c52', pink = '#e84d8a';
  const muda = mode === 'muda';
  const jr = rnd();   // consumed even under reduced motion — settings must not shift the RNG stream
  const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : jr;
  const sway = Math.sin(frame * 0.09) * 1.2;
  ctx.save(); ctx.globalAlpha = 0.82 * alpha; ctx.scale(dir, 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // broad muscular torso
  ctx.fillStyle = gold; ctx.strokeStyle = dk; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-13, -46);
  ctx.quadraticCurveTo(-16, -33, -10, -19); ctx.lineTo(-7, -16); ctx.lineTo(7, -16); ctx.lineTo(10, -19);
  ctx.quadraticCurveTo(16, -33, 13, -46); ctx.closePath(); ctx.fill(); ctx.stroke();
  // sculpted pec + ab lines
  ctx.strokeStyle = dk; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -19); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -38); ctx.quadraticCurveTo(0, -33, 9, -38); ctx.stroke();
  // green accent flares
  ctx.strokeStyle = grn; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-10, -30); ctx.lineTo(-4, -27); ctx.moveTo(10, -30); ctx.lineTo(4, -27); ctx.stroke();

  // arms (ORA flurry blurs the fists outward in muda)
  const reach = muda ? 8 + jt * 9 : 2;
  _standArm(-13, -44, -20 - reach, -29, gold, dk);
  _standArm(13, -44, 20 + reach, -29, gold, dk);
  if (muda) {
    ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
    for (let i = 0; i < 3; i++) { const r = rnd() * 15, oy = rnd() * 6 - 3; if (api.reduceMotion) continue; ctx.beginPath(); ctx.arc(19 + r, -31 + oy, 2.6, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.82 * alpha;
  }

  // shoulder pauldrons, each stamped with a heart
  for (const sx of [-13, 13]) {
    ctx.fillStyle = lit; ctx.strokeStyle = dk; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sx, -45, 5.4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = pink; _heart(sx, -45.5, 2.3);
  }

  // head: helmet, chin guard, visor, forehead jewel + crest fins
  ctx.fillStyle = gold; ctx.strokeStyle = dk; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -54, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -49); ctx.quadraticCurveTo(0, -45, 4, -49); ctx.stroke();   // chin guard
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-2, -61); ctx.lineTo(-4, -64 + sway); ctx.moveTo(2, -61); ctx.lineTo(4, -64 - sway); ctx.stroke();  // crest
  ctx.fillStyle = '#23331c'; ctx.fillRect(-5.5, -55.5, 11, 2.6);                              // visor band
  ctx.fillStyle = '#aef0a0'; ctx.fillRect(-4.6, -55.2, 3, 1.6); ctx.fillRect(1.6, -55.2, 3, 1.6);  // glowing eyes
  ctx.fillStyle = grn; ctx.beginPath(); ctx.arc(0, -58.5, 1.7, 0, Math.PI * 2); ctx.fill();   // forehead jewel
  ctx.restore();
}
// Star Platinum — Jotaro's violet Stand, looming over his shoulder during the DIO fight
function drawStarPlatinum(dir, alpha, punching) {
  const pur = '#7d6fd6', lit = '#a99cf0', dk = '#352a63', cy = '#86f0e0', gold = '#e8c24a', skin = '#caa6ff';
  const jr = rnd();   // consumed even under reduced motion — settings must not shift the RNG stream
  const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : jr;
  const sway = Math.sin(frame * 0.08) * 1.6;
  ctx.save(); ctx.globalAlpha = 0.78 * alpha; ctx.scale(dir, 1); ctx.lineJoin = 'round'; ctx.lineCap = 'round';

  // flowing hair tails sweeping out behind the head
  ctx.strokeStyle = dk; ctx.lineWidth = 3.2;
  ctx.beginPath(); ctx.moveTo(-5, -55); ctx.quadraticCurveTo(-13, -53, -15, -45 + sway);
  ctx.moveTo(5, -55); ctx.quadraticCurveTo(13, -57, 16, -47 - sway); ctx.stroke();

  // broad muscular torso
  ctx.fillStyle = pur; ctx.strokeStyle = dk; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-14, -46);
  ctx.quadraticCurveTo(-17, -33, -10, -18); ctx.lineTo(-7, -16); ctx.lineTo(7, -16); ctx.lineTo(10, -18);
  ctx.quadraticCurveTo(17, -33, 14, -46); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = dk; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, -43); ctx.lineTo(0, -18); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-9, -38); ctx.quadraticCurveTo(0, -33, 9, -38); ctx.stroke();
  // gold collar band + chest studs
  ctx.strokeStyle = gold; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-9, -45); ctx.quadraticCurveTo(0, -42, 9, -45); ctx.stroke();
  ctx.fillStyle = gold; for (const yy of [-37, -31, -25]) { ctx.beginPath(); ctx.arc(0, yy, 1.5, 0, Math.PI * 2); ctx.fill(); }

  // arms (ORA flurry blurs the fists outward while punching)
  const reach = punching ? 9 + jt * 10 : 2;
  _standArm(-14, -44, -21 - reach, -30, pur, dk);
  _standArm(14, -44, 21 + reach, -30, pur, dk);
  if (punching) {
    ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
    for (let i = 0; i < 3; i++) { const r = rnd() * 17, oy = rnd() * 6 - 3; if (api.reduceMotion) continue; ctx.beginPath(); ctx.arc(20 + r, -31 + oy, 2.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 0.78 * alpha;
  }

  // shoulder guards, each stamped with a star
  for (const sx of [-14, 14]) {
    ctx.fillStyle = lit; ctx.strokeStyle = dk; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(sx, -45, 5.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  ctx.fillStyle = gold; _star(-14, -45, 3); _star(14, -45, 3);

  // head: face, swept-back cap, metal headband + fierce eyes, gold headband tails
  ctx.fillStyle = skin; ctx.strokeStyle = dk; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(0, -54, 7, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.fillStyle = pur; ctx.beginPath(); ctx.arc(0, -55, 7, Math.PI * 1.04, Math.PI * 1.96); ctx.fill();   // cap over the crown
  ctx.fillStyle = gold; ctx.fillRect(-6, -56.5, 12, 1.8);                                                // metal headband
  ctx.fillStyle = cy; ctx.fillRect(-5, -53.6, 3.4, 2.1); ctx.fillRect(1.6, -53.6, 3.4, 2.1);             // fierce eyes
  ctx.strokeStyle = gold; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.moveTo(-6, -54); ctx.lineTo(-15, -50 + sway); ctx.moveTo(6, -55); ctx.lineTo(15, -58 - sway); ctx.stroke();  // headband tails
  ctx.restore();
}
function drawDio(e, col) {
  const dir = (player.x - e.x) >= 0 ? 1 : -1;
  const cr = e.crumble || 0;   // 0→1 dissolve during the death cutscene
  ctx.save(); ctx.translate(e.x, e.y); ctx.lineJoin = 'round';
  // menacing aura (gold core, violet falloff) — fades as he crumbles
  const aura = ctx.createRadialGradient(0, -26, 4, 0, -26, 42);
  aura.addColorStop(0, 'rgba(255,210,90,' + (0.20 * (1 - cr)).toFixed(3) + ')'); aura.addColorStop(0.6, 'rgba(150,90,200,' + (0.12 * (1 - cr)).toFixed(3) + ')'); aura.addColorStop(1, 'rgba(150,90,200,0)');
  ctx.fillStyle = aura; ctx.beginPath(); ctx.ellipse(0, -26, 33, 44, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,' + (0.30 * (1 - cr)).toFixed(3) + ')'; ctx.beginPath(); ctx.ellipse(0, 3, 12, 4, 0, 0, Math.PI * 2); ctx.fill();
  if (cr > 0) {
    // dissolve from the feet up: clip away the lower (cr) of the body, fade the rest, jitter as ash
    ctx.globalAlpha = 1 - cr * 0.55;
    ctx.beginPath(); ctx.rect(-46, -60, 92, 63 * (1 - cr)); ctx.clip();
    const ashX = (rnd() - 0.5) * cr * 3, ashY = (rnd() - 0.5) * cr * 2;  // consumed even under reduced motion
    if (!api.reduceMotion) ctx.translate(ashX, ashY);
  }
  if ((e.stand || 0) > 0.05) {   // The World rises above and behind DIO's shoulder
    ctx.save(); ctx.translate(-dir * 12, -24); ctx.scale(1.4, 1.4);
    drawTheWorld(dir, e.stand, e.mode); ctx.restore();
  }
  ctx.scale(dir, 1);
  const s = Math.sin(e.phase) * 2.5;
  // legs (dark trousers) + heart kneepads
  ctx.strokeStyle = '#2a2533'; ctx.lineWidth = 5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-2, -16); ctx.lineTo(-5, 0); ctx.moveTo(2, -16); ctx.lineTo(5, 0); ctx.stroke();
  ctx.fillStyle = '#e84d8a'; for (const kx of [-4.5, 4.5]) { ctx.beginPath(); ctx.arc(kx - 1, -7, 1.3, 0, Math.PI * 2); ctx.arc(kx + 1, -7, 1.3, 0, Math.PI * 2); ctx.fill(); }
  // torso (dark tank top) + violet suspenders + gold studs
  ctx.fillStyle = '#1f1b29'; ctx.strokeStyle = '#3a3550'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(-7, -34); ctx.lineTo(7, -34); ctx.lineTo(6, -15); ctx.lineTo(-6, -15); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#caa6ff'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-4, -34); ctx.lineTo(-3, -16); ctx.moveTo(4, -34); ctx.lineTo(3, -16); ctx.stroke();
  ctx.fillStyle = '#ffd24d'; ctx.beginPath(); ctx.arc(0, -25, 1.7, 0, Math.PI * 2); ctx.fill();
  // pale arms — left on hip, right raised toward the player (more so while attacking)
  ctx.strokeStyle = '#e8c9a0'; ctx.lineWidth = 4; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-6, -32); ctx.lineTo(-11, -24); ctx.lineTo(-7, -19); ctx.stroke();
  const up = (e.mode === 'knives' || e.mode === 'world' || e.mode === 'muda' || e.mode === 'barrage') ? 1 : 0;
  ctx.beginPath(); ctx.moveTo(6, -32); ctx.lineTo(13, -31 - up * 4); ctx.lineTo(18, -33 - up * 9); ctx.stroke();
  // head (pale) + confident eyes
  ctx.fillStyle = '#f0d3aa'; ctx.beginPath(); ctx.arc(0, -40, 6.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1a1a'; ctx.beginPath(); ctx.arc(2.4, -41, 0.95, 0, Math.PI * 2); ctx.arc(5.2, -41, 0.95, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#caa6ff'; ctx.lineWidth = 0.8; ctx.beginPath(); ctx.moveTo(1.4, -42.6); ctx.lineTo(3.4, -42.4); ctx.moveTo(4.2, -42.4); ctx.lineTo(6.2, -42.6); ctx.stroke();
  // headband + gem
  ctx.fillStyle = '#3a3550'; ctx.fillRect(-6.5, -44.5, 13.5, 2.6);
  ctx.fillStyle = '#ffd24d'; ctx.fillRect(-1, -44.5, 2, 2.6);
  // blond spiky hair (slicked-back spikes)
  ctx.fillStyle = '#ffd24d'; ctx.strokeStyle = '#e0a93a'; ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(-7, -44);
  ctx.lineTo(-8.5, -50); ctx.lineTo(-4.5, -47);
  ctx.lineTo(-3.5, -54); ctx.lineTo(-0.5, -48);
  ctx.lineTo(1.5, -55); ctx.lineTo(3.5, -48);
  ctx.lineTo(7, -53); ctx.lineTo(7, -44.5);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
}
// a thrown knife, pointing along its flight
function drawKnife(a) {
  const k = a.scale || 1;
  ctx.save(); ctx.translate(a.x, a.y);
  ctx.rotate(Math.atan2(a.vy, a.vx));
  if (k !== 1) { ctx.scale(k, k); ctx.shadowColor = 'rgba(255,255,255,0.6)'; ctx.shadowBlur = 4; }  // a held blade catches the light
  ctx.fillStyle = '#cdd3da'; ctx.strokeStyle = '#7a828c'; ctx.lineWidth = 0.6;
  ctx.beginPath(); ctx.moveTo(-7, 0); ctx.lineTo(4, -2.2); ctx.lineTo(9, 0); ctx.lineTo(4, 2.2); ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = '#3a2f2a'; ctx.fillRect(-10, -1.4, 4, 2.8);
  ctx.restore();
}
function drawRoadRoller(r) {
  // ground danger zone — telegraph (48×18) sits just outside the lethal ellipse (46×17), so the warning never under-reads
  if (r.phase !== 'impact' || r.t < 12) {
    const warn = api.reduceMotion || Math.floor(frame / (r.phase === 'drop' ? 3 : 5)) % 2 === 0;   // flashes faster as it falls
    ctx.save();
    ctx.strokeStyle = warn ? 'rgba(255,70,70,0.95)' : 'rgba(255,70,70,0.4)';
    ctx.fillStyle = 'rgba(255,70,70,0.10)'; ctx.lineWidth = 2; ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.ellipse(r.zoneX, r.zoneY, 48, 18, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // a ring that contracts toward the zone as the roller closes in — shows exactly when impact lands
    if (r.phase === 'drop' && !api.reduceMotion) {
      const prog = clamp((r.y - (r.y0 || 0)) / Math.max(1, r.zoneY - (r.y0 || 0)), 0, 1);
      const k = 1 + (1 - prog) * 1.4;
      ctx.globalAlpha = 0.5 + 0.5 * prog; ctx.setLineDash([]); ctx.lineWidth = 2.5; ctx.strokeStyle = 'rgba(255,90,90,0.9)';
      ctx.beginPath(); ctx.ellipse(r.zoneX, r.zoneY, 48 * k, 18 * k, 0, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.save(); ctx.translate(r.x, r.y);
  // big rolling drum
  ctx.fillStyle = '#f2c200'; ctx.strokeStyle = '#3a2f00'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = '#caa000'; ctx.lineWidth = 1.4;
  for (let a = 0; a < 6; a++) { const ang = a * 1.05 + frame * 0.06; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(ang) * 20, Math.sin(ang) * 20); ctx.stroke(); }
  // cab + window + chassis
  ctx.fillStyle = '#a83a28'; ctx.fillRect(-17, -23, 34, 7);
  ctx.fillStyle = '#d94f3a'; ctx.strokeStyle = '#5e1f15'; ctx.lineWidth = 1.5;
  ctx.fillRect(-14, -42, 28, 22); ctx.strokeRect(-14, -42, 28, 22);
  ctx.fillStyle = '#23252b'; ctx.fillRect(-9, -38, 18, 12);
  ctx.restore();
}

// ── render-field — drawEnemy dispatch, champions, stone/saber pickups, held weapons, husks/minions ──
function drawEnemy(e) {
  // ── readability grammar (render-only) ──
  // ONE language for "about to strike": every telegraphing foe stands on a red
  // underglow, whatever its sprite does (steady pulse under reduced motion)
  if (!e.dead && e.frozen <= 0 && ['aim', 'wind', 'cast', 'gather'].includes(e.mode)) {
    const ua = api.reduceMotion ? 0.22 : 0.16 + 0.10 * Math.sin(frame * 0.25);
    ctx.fillStyle = 'rgba(255,60,50,' + ua.toFixed(3) + ')';
    ctx.beginPath(); ctx.ellipse(e.x, e.y + 3, 22, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // the vignette must never HIDE a live threat: foes hugging the dark rim get a
  // faint self-light so the atmosphere pass can't cost you a death
  if (!e.dead && (e.x < 70 || e.x > GW - 70 || e.y < 90 || e.y > GH - 60)) {
    ctx.fillStyle = 'rgba(255,90,70,0.10)';
    ctx.beginPath(); ctx.ellipse(e.x, e.y - 8, 26, 18, 0, 0, Math.PI * 2); ctx.fill();
  }
  const col = enemyColor(e);
  if (e.type === 'goblin') drawGoblin(e, col);
  else if (e.type === 'shaman') drawShaman(e, col);
  else if (e.type === 'bomber') drawBomber(e, col);
  else if (e.type === 'ogre') drawOgre(e, col);
  else if (e.type === 'wolf') drawWolf(e, col);
  else if (e.type === 'archer') drawArcher(e, col);
  else if (e.type === 'wraith') drawWraith(e, col);
  else if (e.type === 'witchking') drawWitchKing(e, col);
  else if (e.type === 'trooper') drawTrooper(e, col);
  else if (e.type === 'vader') drawVader(e, col);
  else if (e.type === 'sidious') drawSidious(e, col);
  else if (e.type === 'guard') drawGuard(e, col);
  else if (e.type === 'dio') drawDio(e, col);
  else if (e.type === 'ian') drawIan(e, col);
  else {
    const lean = clamp((e.vx || 0) * 0.05, -0.35, 0.35);
    drawTroll(e, col, lean);
    // hearts only for a LIVING wounded troll — a corpse can linger one frame before
    // the dead-filter sweeps it, and overkill damage can leave hp negative
    if (!e.dead && e.hp > 0 && e.hp < (e.elite === 2 ? 8 : e.elite ? 5 : 3)) {
      ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 11px Tahoma,Arial'; ctx.textAlign = 'center';
      ctx.fillText('♥'.repeat(e.hp), e.x, e.y - 78); ctx.textAlign = 'left';
    }
  }
  // HIGH-CONTRAST ELITES (accessibility option): tier as SHAPE, not just tint
  if (sfOpts.hiVis && e.elite && !e.dead) {
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 10px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText(e.elite === 2 ? '◆◆' : '◆', e.x, e.y - 60);
    ctx.textAlign = 'left';
  }
}

function drawLuke(c) {
  stickFigure(c.x, c.y, frame * 0.12, '#ffe0b2');
  const base = Math.atan2(c.fy || 0, c.fx || 1);
  const slashing = c.slashT > 0;
  const ang = slashing ? base - 1.1 + (1 - c.slashT / 8) * 2.2 : base + 0.4;
  const hx = c.x, hy = c.y - 20;
  const reach = slashing ? 62 : 38;          // the blade extends as he cleaves
  ctx.save(); ctx.lineCap = 'round';
  if (slashing) {
    // a translucent green wedge tracing the wide sweep of the cleave
    ctx.fillStyle = 'rgba(0,230,118,0.16)';
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, reach + 12, ang - 0.55, ang + 0.55); ctx.closePath(); ctx.fill();
  }
  ctx.strokeStyle = '#9e9e9e'; ctx.lineWidth = 3;  // hilt
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(ang) * 5, hy + Math.sin(ang) * 5);
  ctx.lineTo(hx + Math.cos(ang) * 10, hy + Math.sin(ang) * 10);
  ctx.stroke();
  ctx.strokeStyle = '#b9f6ca'; ctx.lineWidth = 3.5;  // the green blade
  ctx.shadowColor = '#00e676'; ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.moveTo(hx + Math.cos(ang) * 10, hy + Math.sin(ang) * 10);
  ctx.lineTo(hx + Math.cos(ang) * reach, hy + Math.sin(ang) * reach);
  ctx.stroke();
  ctx.shadowBlur = 0; ctx.restore();
}

function drawJotaro(c) {
  stickFigure(c.x, c.y, frame * 0.07, '#283593');
  ctx.save(); ctx.translate(c.x, c.y);
  ctx.fillStyle = '#10153a';  // the cap
  ctx.beginPath(); ctx.arc(0, -36, 8, Math.PI, 0); ctx.fill();
  ctx.fillRect(-8, -37, 19, 3);
  ctx.restore();
  if (c.oraT > 0 && c.target && !c.target.dead) {
    // Star Platinum manifests over the target in a flurry of fists
    const t = c.target;
    ctx.save(); ctx.globalAlpha = 0.85;
    stickFigure(t.x + 14, t.y, frame * 0.6, '#7e57c2');
    ctx.strokeStyle = '#b39ddb'; ctx.lineWidth = 3; ctx.lineCap = 'round';
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2, r = 10 + rnd() * 14;
      ctx.beginPath(); ctx.moveTo(t.x + 14, t.y - 20);
      ctx.lineTo(t.x + Math.cos(a) * r, t.y - 20 + Math.sin(a) * r); ctx.stroke();
    }
    ctx.restore();
  }
}

function drawChamp(c) {
  if (c.kind === 'gandalf') drawWizard(c);
  else if (c.kind === 'luke') drawLuke(c);
  else drawJotaro(c);
}

function drawStone() {
  const s = stone;
  ctx.save(); ctx.translate(s.x, s.y);
  ctx.fillStyle = 'rgba(0,0,0,0.25)';
  ctx.beginPath(); ctx.ellipse(0, 8, 24, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#78909c';
  ctx.beginPath(); ctx.ellipse(0, 0, 21, 14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#90a4ae';
  ctx.beginPath(); ctx.ellipse(-5, -4, 13, 8, 0, 0, Math.PI * 2); ctx.fill();
  ctx.save(); ctx.rotate(-0.12);
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#eceff1'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(0, -2); ctx.lineTo(0, -32); ctx.stroke();   // blade
  ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3.5;
  ctx.beginPath(); ctx.moveTo(-9, -32); ctx.lineTo(9, -32); ctx.stroke(); // crossguard
  ctx.beginPath(); ctx.moveTo(0, -32); ctx.lineTo(0, -43); ctx.stroke();  // grip
  ctx.restore();
  if (frame % 50 < 9) {  // glint
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Tahoma,Arial';
    ctx.fillText('✦', 4, -24);
  }
  // beckoning glow
  ctx.strokeStyle = 'rgba(255,210,77,' + (0.35 + Math.sin(frame * 0.09) * 0.25).toFixed(2) + ')';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, -14, 34 + Math.sin(frame * 0.09) * 4, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

function drawSaberPickup() {
  const s = saberPickup;
  ctx.save(); ctx.translate(s.x, s.y);
  // beckoning blue glow
  ctx.strokeStyle = 'rgba(90,200,255,' + (0.35 + Math.sin(frame * 0.12) * 0.25).toFixed(2) + ')';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.arc(0, -8, 26 + Math.sin(frame * 0.12) * 4, 0, Math.PI * 2); ctx.stroke();
  // hilt standing upright with a half-lit blade
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 5;
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -14); ctx.stroke();
  ctx.fillStyle = '#3a3f44'; ctx.fillRect(-2.5, -6, 5, 3);  // activation stud
  ctx.shadowColor = '#5ac8ff'; ctx.shadowBlur = 14;
  ctx.strokeStyle = '#bfe7ff'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, -40); ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawWizard(g) {
  stickFigure(g.x, g.y, frame * 0.08, '#f5f5f5', 1.15);
  ctx.save(); ctx.translate(g.x, g.y);
  ctx.fillStyle = '#cfd8dc';  // pointed hat
  ctx.beginPath(); ctx.moveTo(-13, -46); ctx.lineTo(13, -46); ctx.lineTo(2, -66); ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#a1887f'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(19, -2); ctx.lineTo(19, -46); ctx.stroke();  // staff
  ctx.fillStyle = '#fff';
  ctx.shadowColor = '#bbdefb'; ctx.shadowBlur = 12;
  ctx.beginPath(); ctx.arc(19, -49, 3.5 + Math.sin(frame * 0.2) * 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.restore();
}

function drawHeldSword(h) {
  const baseAng = Math.atan2(h.fy, h.fx);
  const a0 = baseAng - 1.9, sweep = (1 - h.swingT / 10) * 3.8;  // matches the ~220° cleave
  const ang = h.swingT > 0 ? a0 + sweep : baseAng + 0.3;
  const hx = h.x, hy = h.y - 20;   // swing-wedge pivot (the cleave AoE stays centred on the hero)
  // blue lightsaber vs Excalibur's gold steel
  const trail = h.heldSaber ? '90,200,255' : '255,245,157';
  const bladeLen = h.heldSaber ? 46 : 40;
  ctx.save();
  if (!h.heldSaber && !api.reduceMotion && h.swordT < 180 && Math.floor(frame / 6) % 2 === 0) ctx.globalAlpha = 0.45;  // Excalibur expiring
  ctx.lineCap = 'round';
  if (h.swingT > 0) {  // cleave wedge + sweep trail
    ctx.fillStyle = 'rgba(' + trail + ',' + (h.swingT / 34).toFixed(2) + ')';
    ctx.beginPath();
    ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, up.swingR * 0.88, a0, a0 + sweep);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(' + trail + ',' + (h.swingT / 12).toFixed(2) + ')';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.arc(hx, hy, up.swingR * 0.88, a0, a0 + sweep);
    ctx.stroke();
  }
  // the gripping hand sits out in front of the body at hand height — never on the chest
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const fxn = h.fx / fl, fyn = h.fy / fl;
  const handX = h.x + fxn * 11, handY = h.y - 13 + fyn * 5;
  // the sword-arm: a real forearm from the shoulder down to the hand (angled apart from the blade,
  // so the weapon clearly reads as held rather than sprouting from the torso)
  ctx.lineJoin = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  // the blade geometry now grows out of the hand
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -Math.sin(ang), py = Math.cos(ang);
  const at = (d) => [handX + ux * d, handY + uy * d];

  if (h.heldSaber) {
    // a brushed-metal hilt straddling the fist, then a glowing energy blade
    const [h0x, h0y] = at(-5), [h1x, h1y] = at(9);
    ctx.strokeStyle = '#33373c'; ctx.lineWidth = 6;            // dark grip body
    ctx.beginPath(); ctx.moveTo(h0x, h0y); ctx.lineTo(h1x, h1y); ctx.stroke();
    ctx.strokeStyle = '#aab2bb'; ctx.lineWidth = 2.2;          // chrome highlight down it
    ctx.beginPath(); ctx.moveTo(h0x, h0y); ctx.lineTo(h1x, h1y); ctx.stroke();
    const [emx, emy] = at(9);                                  // emitter shroud
    ctx.strokeStyle = '#d0d6dc'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(emx - px * 3, emy - py * 3); ctx.lineTo(emx + px * 3, emy + py * 3); ctx.stroke();
    const [b0x, b0y] = at(10), [b1x, b1y] = at(10 + bladeLen);
    ctx.shadowColor = '#5ac8ff'; ctx.shadowBlur = 16;
    ctx.strokeStyle = 'rgba(120,205,255,0.55)'; ctx.lineWidth = 9;   // outer plasma glow
    ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.stroke();
    ctx.strokeStyle = '#eaffff'; ctx.lineWidth = 3.4;                // white-hot core
    ctx.beginPath(); ctx.moveTo(b0x, b0y); ctx.lineTo(b1x, b1y); ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = heroTint(h);                               // fist on the hilt
    ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    return;
  }

  // Excalibur — a golden-hilted steel blade gripped in the fist
  const [pomx, pomy] = at(-6), [cgx, cgy] = at(6);
  ctx.strokeStyle = '#6b4a2b'; ctx.lineWidth = 4;             // leather-wrapped grip through the fist
  ctx.beginPath(); ctx.moveTo(pomx, pomy); ctx.lineTo(cgx, cgy); ctx.stroke();
  ctx.fillStyle = '#ffd24d';                                  // pommel knob behind the hand
  ctx.beginPath(); ctx.arc(pomx, pomy, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffd24d'; ctx.lineWidth = 3;             // crossguard just past the fist
  ctx.beginPath(); ctx.moveTo(cgx + px * 7, cgy + py * 7); ctx.lineTo(cgx - px * 7, cgy - py * 7); ctx.stroke();
  // tapered, fullered steel blade as a filled polygon
  const bb = 8, bt = 8 + bladeLen, hw = 3.2;
  ctx.shadowColor = '#fff59d'; ctx.shadowBlur = 8;
  ctx.fillStyle = '#dfe6ea';
  ctx.beginPath();
  ctx.moveTo(handX + ux * bb + px * hw, handY + uy * bb + py * hw);
  ctx.lineTo(handX + ux * (bt - 9) + px * hw * 0.8, handY + uy * (bt - 9) + py * hw * 0.8);
  ctx.lineTo(handX + ux * bt, handY + uy * bt);              // the point
  ctx.lineTo(handX + ux * (bt - 9) - px * hw * 0.8, handY + uy * (bt - 9) - py * hw * 0.8);
  ctx.lineTo(handX + ux * bb - px * hw, handY + uy * bb - py * hw);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1;   // central fuller highlight
  ctx.beginPath(); ctx.moveTo(handX + ux * bb, handY + uy * bb); ctx.lineTo(handX + ux * (bt - 4), handY + uy * (bt - 4)); ctx.stroke();
  ctx.strokeStyle = 'rgba(120,140,150,0.6)'; ctx.lineWidth = 1;   // shaded edge for depth
  ctx.beginPath();
  ctx.moveTo(handX + ux * bb - px * hw, handY + uy * bb - py * hw);
  ctx.lineTo(handX + ux * (bt - 9) - px * hw * 0.8, handY + uy * (bt - 9) - py * hw * 0.8);
  ctx.stroke();
  ctx.fillStyle = heroTint(h);                                // fist on the grip
  ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// the ranged hero's bow: a curved stave + string held out in the facing direction,
// with the string drawn back and an arrow nocked in the beat after a shot
function drawHeldBow(h) {
  // the bow points along the held direction (the facing) — where the next arrow flies
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl, uy = h.fy / fl, px = -uy, py = ux;
  const handX = h.x + ux * 12, handY = h.y - 14 + uy * 5;
  const drawn = h.swingT > 0 ? (h.swingT / 8) : 0;   // 1 = just loosed
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5; // the bow arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.strokeStyle = '#a5d6a7'; ctx.lineWidth = 3;     // the stave
  ctx.beginPath();
  ctx.moveTo(handX + px * 13, handY + py * 13);
  ctx.quadraticCurveTo(handX + ux * 9, handY + uy * 9, handX - px * 13, handY - py * 13);
  ctx.stroke();
  const pull = 3 + drawn * 6;                         // the string (pulled back right after firing)
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'; ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(handX + px * 13, handY + py * 13);
  ctx.lineTo(handX - ux * pull, handY - uy * pull);
  ctx.lineTo(handX - px * 13, handY - py * 13);
  ctx.stroke();
  if (drawn > 0.3) {                                  // the nocked arrow flashes as it looses
    ctx.strokeStyle = '#f5f5dc'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(handX - ux * pull, handY - uy * pull); ctx.lineTo(handX + ux * 12, handY + uy * 12); ctx.stroke();
  }
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(handX, handY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the unhorsed rider's dirk: short, desperate, held out front — matches the
// on-foot jab's reach so the picture tells the truth
function drawHeldDirk(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl, uy = h.fy / fl;
  const hx = h.x + ux * 9, hy = h.y - 18 + uy * 4;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(hx, hy); ctx.stroke();
  ctx.strokeStyle = '#cdd8e2'; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx + ux * 13, hy + uy * 13); ctx.stroke();
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(hx, hy, 2.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the dragoon's couched lance: it points where you FLY (the velocity), falling
// back to the facing at a standstill — so the joust reads exactly like it kills.
// The tip ignites ember-orange once you're moving fast enough to skewer the
// lightest foe (a steady glow, never a flash — reduced-motion safe by nature).
function drawHeldLance(h) {
  const vv = Math.hypot(h.vx || 0, h.vy || 0);
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = vv > 0.8 ? h.vx / vv : h.fx / fl;
  const uy = vv > 0.8 ? h.vy / vv : h.fy / fl;
  const px = -uy, py = ux;
  const handX = h.x + ux * 10, handY = h.y - 16 + uy * 5;
  const len = 34 + (up.lanceR || 0) * 0.6;
  const hot = vv >= JOUST_BAR.goblin;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;                     // the lance arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  ctx.strokeStyle = '#b0895a'; ctx.lineWidth = 3;                         // the shaft
  ctx.beginPath();
  ctx.moveTo(handX - ux * 10, handY - uy * 10);
  ctx.lineTo(handX + ux * len, handY + uy * len);
  ctx.stroke();
  if (hot) { ctx.shadowColor = DRAGOON_COL; ctx.shadowBlur = 9; }
  ctx.fillStyle = hot ? DRAGOON_COL : '#cdd8e2';                          // the tip
  ctx.beginPath();
  ctx.moveTo(handX + ux * (len + 9), handY + uy * (len + 9));
  ctx.lineTo(handX + ux * len + px * 3.4, handY + uy * len + py * 3.4);
  ctx.lineTo(handX + ux * len - px * 3.4, handY + uy * len - py * 3.4);
  ctx.closePath(); ctx.fill();
  ctx.shadowBlur = 0;
  const wave = Math.sin((h.phase || 0) * 2) * 2.5;                        // the pennon streams off the neck
  ctx.fillStyle = DRAGOON_COL;
  ctx.beginPath();
  ctx.moveTo(handX + ux * (len - 2), handY + uy * (len - 2));
  ctx.lineTo(handX + ux * (len - 13) + px * (5 + wave * 0.4), handY + uy * (len - 13) + py * (5 + wave * 0.4));
  ctx.lineTo(handX + ux * (len - 8), handY + uy * (len - 8));
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = heroTint(h);                                            // the fist on the grip
  ctx.beginPath(); ctx.arc(handX, handY, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the caster's staff: held upright with a glowing orb in the SELECTED spell's
// color — it swells through the incantation (h.castT counting down, normalized
// by the spell's own cast length) and flares as the spell looses
function drawHeldStaff(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fl;
  const side = ux >= 0 ? 1 : -1;
  const gx = h.x + side * 10, gy = h.y - 13;
  const charge = h.castT > 0 ? 1 - h.castT / (h.castMax || CAST_T) : 0;
  const flare = (h.swingT > 0 ? h.swingT / 10 : 0) + charge;
  const sp = SPELLS[h.casting || curSpell(h)] || SPELLS.bolt;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5; // the staff arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(gx, gy); ctx.stroke();
  ctx.strokeStyle = '#8d6e63'; ctx.lineWidth = 3;     // the staff itself
  ctx.beginPath(); ctx.moveTo(gx + side * 2, gy + 12); ctx.lineTo(gx + side * 5, gy - 24); ctx.stroke();
  const pulse = api.reduceMotion ? 0.5 : 0.4 + 0.25 * Math.sin(frame * 0.15);
  ctx.fillStyle = sp.col;
  ctx.shadowColor = sp.col; ctx.shadowBlur = 10 + flare * 14;
  ctx.globalAlpha = Math.min(1, pulse + 0.35 + flare * 0.6);
  ctx.beginPath(); ctx.arc(gx + side * 5.5, gy - 27, 3.4 + flare * 2.2, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1; ctx.shadowBlur = 0;
  ctx.fillStyle = heroTint(h);
  ctx.beginPath(); ctx.arc(gx, gy, 2.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// the necromancer's scythe: a long dark snath with a crescent soul-steel blade —
// rested on the shoulder at ease, whirled through a teal reaping wedge on the swing
function drawHeldScythe(h) {
  const fl = Math.hypot(h.fx, h.fy) || 1;
  const fxn = h.fx / fl, fyn = h.fy / fl;
  const baseAng = Math.atan2(fyn, fxn);
  const swinging = h.swingT > 0;
  const a0 = baseAng - 1.9, sweepA = (1 - h.swingT / 10) * 3.8;
  const ang = swinging ? a0 + sweepA : baseAng + 0.55;
  const hx = h.x, hy = h.y - 20;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (swinging) {                                   // the reaping wedge
    ctx.fillStyle = 'rgba(100,255,218,' + (h.swingT / 40).toFixed(2) + ')';
    ctx.beginPath(); ctx.moveTo(hx, hy);
    ctx.arc(hx, hy, SCYTHE_R * 0.95, a0, a0 + sweepA);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(100,255,218,' + (h.swingT / 14).toFixed(2) + ')';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(hx, hy, SCYTHE_R * 0.95, a0, a0 + sweepA); ctx.stroke();
  }
  const handX = h.x + fxn * 11, handY = h.y - 13 + fyn * 5;
  ctx.strokeStyle = heroTint(h); ctx.lineWidth = 2.5;                 // the scythe arm
  ctx.beginPath(); ctx.moveTo(h.x, h.y - 22); ctx.lineTo(handX, handY); ctx.stroke();
  const ux = Math.cos(ang), uy = Math.sin(ang), px = -Math.sin(ang), py = Math.cos(ang);
  const at = (dd) => [handX + ux * dd, handY + uy * dd];
  const [s0x, s0y] = at(-14), [s1x, s1y] = at(30);
  ctx.strokeStyle = '#3e2f23'; ctx.lineWidth = 3.2;                   // the snath
  ctx.beginPath(); ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y); ctx.stroke();
  const glow = api.reduceMotion ? 0.5 : 0.35 + 0.25 * Math.sin(frame * 0.09);
  ctx.shadowColor = NECRO_COL; ctx.shadowBlur = 6 + glow * 8;         // the crescent, soul-lit
  ctx.strokeStyle = '#cfe8e4'; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(s1x, s1y);
  ctx.quadraticCurveTo(s1x + px * 16 + ux * 4, s1y + py * 16 + uy * 4,
                       s1x + px * 24 - ux * 8, s1y + py * 24 - uy * 8);
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.fillStyle = heroTint(h);                                        // fist on the snath
  ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// a fallen grunt's husk: a bone mound with a soul wisp curling off it — fades out
// over its final beats so the raise window is legible
function drawHusk(k) {
  const fade = Math.min(1, k.t / 120) * 0.85;
  ctx.save();
  ctx.globalAlpha = fade;
  ctx.translate(k.x, k.y);
  ctx.strokeStyle = '#8a93a5'; ctx.lineWidth = 2; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(-2, -4); ctx.stroke();   // slumped bones
  ctx.beginPath(); ctx.moveTo(7, -1); ctx.lineTo(1, -4); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-4, -1); ctx.lineTo(5, -2); ctx.stroke();
  ctx.fillStyle = '#aab2bb';
  ctx.beginPath(); ctx.arc(-6, -5, 3, 0, Math.PI * 2); ctx.fill();        // the skull
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(-7.2, -5.6, 1.2, 1.2); ctx.fillRect(-4.4, -5.6, 1.2, 1.2);
  const wispA = api.reduceMotion ? 0.5 : 0.35 + 0.2 * Math.sin(frame * 0.11 + k.y);
  const bob = api.reduceMotion ? 0 : Math.sin(frame * 0.08 + k.x) * 2;    // the wisp
  ctx.fillStyle = NECRO_COL; ctx.globalAlpha = fade * wispA;
  ctx.beginPath(); ctx.arc(bob, -13 + Math.sin(frame * 0.06 + k.x * 0.7) * 3, 1.6, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
// a raised minion: its living sprite redrawn in spectral soul-teal, with a
// draining life-ring at its feet — the raise is a loan, and the ring is the clock
function drawMinion(m) {
  ctx.save();
  ctx.globalAlpha = 0.85;
  const fk = { x: m.x, y: m.y, phase: m.phase, vx: m.fx || 1, elite: 0, hp: 1,
               mode: 'lunge', lx: m.fx || 1, st: 0 };
  const col = '#57e6c4';
  if (m.src === 'wolf') drawWolf(fk, col);
  else if (m.src === 'archer') drawArcher(fk, col);
  else if (m.src === 'troll') drawTroll(fk, col, 0);
  else drawGoblin(fk, col);
  ctx.globalAlpha = 1;
  const fr = clamp(m.t / MINION_T, 0, 1);
  ctx.strokeStyle = 'rgba(100,255,218,0.55)'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(m.x, m.y + 2, 12, -Math.PI / 2, -Math.PI / 2 + fr * Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/* ── THE BATTLEFIELD (atmosphere pass) ──
   The open field used to be a transparent canvas showing the XP desktop through
   it. Now the fight happens somewhere: a scorched night field — mottled earth,
   old battle debris, fog breathing at the rim, embers rising off unseen fires —
   under a WAVE TINT that runs cold dawn-blue to blood red as the run deepens
   (grey in the mournful world). STRICTLY render-only and rnd()-free: everything
   animates off `frame` + a position hash, so the deterministic draw-stream and
   60/120Hz cadence tests hold, and no sim version bump is needed. The set-piece
   rooms (corridor / mansion / Ian) still paint their own worlds. Steady (never
   flashing) under prefers-reduced-motion. */
function drawBattlefield() {
  const RM = api.reduceMotion;
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  // ── the run's MOOD, stepped once per draw call (= per tick) ──
  // dread: the Nine (and the Witch-king after them) snuff the field's warmth —
  // embers die, fog flees outward, the tint drops to a dead grey-violet, and
  // the light pools dim to half (see drawLightPools). Eases over ~30 ticks and
  // relights the same way once the king falls.
  dreadF += (((nineActive || (bossActive && !nineDone)) ? 1 : 0) - dreadF) * 0.04;
  const dread = dreadF;
  // the gathering storm: still air early, the wind rising as the Nine draw near
  // (wave 4 is the eve), settling to a war-torn breeze after
  const wind = wave === 4 ? 1 : wave === 3 ? 0.4 : wave >= 6 ? 0.5 : 0;
  const ogreUp = enemies.some((e) => e.type === 'ogre' && !e.dead);
  // 1) the ground — deep and cold, faintly lifted at the fight's heart
  let g = ctx.createLinearGradient(0, 0, 0, GH);
  g.addColorStop(0, '#0d1119'); g.addColorStop(0.55, '#0a0e14'); g.addColorStop(1, '#06080c');
  ctx.fillStyle = g; ctx.fillRect(-30, -30, GW + 60, GH + 60);   // overscan bleed — the living camera drifts
  // 2) mottled earth: fixed hashed scorch patches and faint dead moss
  for (let i = 0; i < 32; i++) {
    const x = ih(i) * GW, y = 44 + ih(i + 51) * (GH - 54);
    const r = 26 + ih(i + 97) * 58;
    ctx.fillStyle = i % 3 ? 'rgba(0,0,0,0.15)' : 'rgba(34,46,38,0.09)';
    ctx.beginPath(); ctx.ellipse(x, y, r, r * 0.42, ih(i + 13) * 3.14, 0, Math.PI * 2); ctx.fill();
  }
  // 2b) GROUND MEMORY: the field remembers this run — ash where they fell,
  //     scorch rings where fire landed, frost blooms melting away (~40s fades;
  //     recorded by sim events via addDecal, pruned here as they expire)
  for (let i = decals.length - 1; i >= 0; i--) {
    const d = decals[i];
    const age = tick - d.t0;
    const life = d.kind === 'frost' ? 700 : 2400;
    if (age >= life) { decals.splice(i, 1); continue; }
    const a = (1 - age / life) * (d.kind === 'ash' ? 0.22 : d.kind === 'frost' ? 0.2 : 0.3);
    if (d.kind === 'scorch') {
      ctx.strokeStyle = 'rgba(10,6,4,' + a.toFixed(3) + ')'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 26, 11, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,' + (a * 0.8).toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(d.x, d.y, 16, 7, 0, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = d.kind === 'frost'
        ? 'rgba(150,200,230,' + a.toFixed(3) + ')'
        : 'rgba(20,16,14,' + a.toFixed(3) + ')';
      ctx.beginPath(); ctx.ellipse(d.x, d.y, d.kind === 'frost' ? 20 : 13, d.kind === 'frost' ? 8 : 5.5, 0, 0, Math.PI * 2); ctx.fill();
    }
  }
  // 3) the debris of older battles: half-buried skulls, snapped spears, ribs
  for (let i = 0; i < 15; i++) {
    const x = ih(i + 201) * GW, y = 62 + ih(i + 233) * (GH - 84);
    ctx.save(); ctx.translate(x, y); ctx.rotate(ih(i + 77) * Math.PI);
    ctx.globalAlpha = 0.2;
    if (i % 5 === 0) {           // a half-buried skull, staring at nothing
      ctx.fillStyle = '#9aa3a8';
      ctx.beginPath(); ctx.arc(0, 0, 3.4, Math.PI, 0); ctx.fill();
      ctx.fillRect(-2.6, -0.4, 1.4, 1.8); ctx.fillRect(1.2, -0.4, 1.4, 1.8);
    } else if (i % 5 === 1) {    // a snapped spear
      ctx.strokeStyle = '#6b5a40'; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-8, 0); ctx.lineTo(6, 0); ctx.stroke();
      ctx.fillStyle = '#8a939c';
      ctx.beginPath(); ctx.moveTo(6, -2); ctx.lineTo(11, 0); ctx.lineTo(6, 2); ctx.closePath(); ctx.fill();
    } else {                     // a rib, or just a rock
      ctx.strokeStyle = i % 2 ? '#727a82' : '#3c444d'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(0, 0, 4.6, 0.3, 2.4); ctx.stroke();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // 4) embers rising off fires just out of sight (a steady field under RM) —
  //    blown sideways by the storm wind, flushed red while the War-Ogre lives,
  //    and SNUFFED entirely as dread takes the field
  const emberA = 1 - dread;
  if (emberA > 0.02) {
    for (let i = 0; i < 22; i++) {
      const sp = 0.25 + ih(i + 301) * 0.5;
      const yy = GH - ((RM ? i * 37 : frame * sp + ih(i + 331) * GH) % (GH + 20));
      const drift = RM ? 0 : Math.sin((frame * 0.01 + i) * 1.7) * 14 + frame * 0.5 * wind;
      const xx = (((ih(i + 359) * GW + drift) % GW) + GW) % GW;
      const tw = RM ? 0.5 : 0.35 + 0.3 * Math.sin(frame * 0.11 + i * 2.1);
      const gCh = ogreUp ? 70 + ((i * 37) % 40) : 120 + ((i * 37) % 60);
      ctx.fillStyle = 'rgba(255,' + gCh + ',40,' + (Math.max(0.08, tw * 0.35) * emberA).toFixed(3) + ')';
      ctx.fillRect(xx, yy, i % 5 === 0 ? 2 : 1.4, i % 5 === 0 ? 2 : 1.4);
    }
  }
  // 5) fog banks breathing along the rim (very slow — vestibular-safe); the
  //    storm hurries them, and dread drives them outward and thin
  for (let i = 0; i < 5; i++) {
    const t = RM ? 0.5 : 0.5 + 0.5 * Math.sin(frame * 0.004 + i * 1.9);
    const spd = 0.00015 * (1 + wind * 3);
    const fx = (((i * 0.23 + 0.06) + (RM ? 0 : frame * spd * (i % 2 ? 1 : -1))) % 1 + 1) % 1 * GW;
    const fy = i % 2 ? 28 + t * 10 - dread * 40 : GH - 32 - t * 10 + dread * 40;
    const fr = (130 + ih(i + 407) * 90) * (1 + dread * 0.8);
    const fg = ctx.createRadialGradient(fx, fy, 0, fx, fy, fr);
    fg.addColorStop(0, 'rgba(120,140,170,' + (0.10 * (0.5 + t * 0.5) * (1 - dread * 0.55)).toFixed(3) + ')');
    fg.addColorStop(1, 'rgba(120,140,170,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(fx - fr, fy - fr, fr * 2, fr * 2);
  }
  // 5b) the eve of the Nine: silent lightning flickers at the field's edge
  //     (wave 4 only; skipped under reduced motion — it is a flash by nature)
  if (wave === 4 && !RM && dread < 0.2) {
    const cyc = Math.floor(frame / 380);
    const ph = frame % 380;
    if (ph < 6) {
      const side = ih(cyc + 611) < 0.5 ? 0 : GW;
      const lg = ctx.createRadialGradient(side, GH * (0.2 + ih(cyc + 613) * 0.5), 0, side, GH * 0.4, GW * 0.7);
      lg.addColorStop(0, 'rgba(200,215,255,' + (0.10 * (1 - ph / 6)).toFixed(3) + ')');
      lg.addColorStop(1, 'rgba(200,215,255,0)');
      ctx.fillStyle = lg;
      ctx.fillRect(-30, -30, GW + 60, GH + 60);
    }
  }
  // 6) the wave tint: cold blue dawn → violet dusk → blood red as the run
  //    deepens — and dread drains it all to a dead grey-violet
  const deep = Math.min(1, (wave - 1) / 9);
  const tr = Math.round((40 + deep * 160) * (1 - dread) + 70 * dread);
  const tg = Math.round((30 - deep * 14) * (1 - dread) + 60 * dread);
  const tb = Math.round((90 - deep * 60) * (1 - dread) + 90 * dread);
  const ta = (0.05 + deep * 0.07) * (1 - dread) + 0.16 * dread;
  ctx.fillStyle = mournful
    ? 'rgba(90,90,100,0.10)'
    : 'rgba(' + tr + ',' + tg + ',' + tb + ',' + ta.toFixed(3) + ')';
  ctx.fillRect(-30, -30, GW + 60, GH + 60);
  // 6b) EVENT LIGHT WASH: the big moments light the whole world for a breath —
  //     Excalibur gold, a powerup's element, the cold drain of a hero falling
  //     (a smooth eased fade, never a flash; stepped once per draw = per tick)
  if (fieldWash) {
    const w = fieldWash;
    const wa = w.a * (1 - w.t / w.T) * (1 - w.t / w.T);
    ctx.fillStyle = 'rgba(' + w.rgb + ',' + wa.toFixed(3) + ')';
    ctx.fillRect(-30, -30, GW + 60, GH + 60);
    if (++w.t >= w.T) fieldWash = null;
  }
  // 7) the dark leans in from the edges — and leans in HARDER under dread
  const v = ctx.createRadialGradient(GW / 2, GH * 0.52, Math.min(GW, GH) * (0.36 - dread * 0.09), GW / 2, GH * 0.52, Math.max(GW, GH) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,' + (0.4 + dread * 0.18).toFixed(3) + ')');
  ctx.fillStyle = v; ctx.fillRect(-30, -30, GW + 60, GH + 60);
  // 8) EYES IN THE DARK: during the breather, red glints blink open in the
  //    vignette darkness — the next wave, already watching (steady under RM);
  //    and while dread holds the field, the horde's silhouettes ring the edge
  if (breatherT > 0 && waveQuota + enemies.length === 0 && !mournful) {
    const nEyes = Math.min(8, 3 + wave);
    const edgeIn = Math.min(1, (BREATHER - breatherT) / 20, breatherT / 20);
    for (let i = 0; i < nEyes; i++) {
      const blink = RM ? 1 : (((frame + i * 37) % 90) < 72 ? 1 : 0);
      if (!blink) continue;
      const side = Math.floor(ih(wave * 13 + i) * 4);
      const along = 0.12 + ih(wave * 29 + i + 7) * 0.76;
      const ex = side === 0 ? 14 + ih(i + wave) * 10 : side === 1 ? GW - 14 - ih(i + wave) * 10 : along * GW;
      const ey = side < 2 ? 44 + along * (GH - 60) : side === 2 ? 48 + ih(i + wave) * 10 : GH - 16 - ih(i + wave) * 10;
      ctx.fillStyle = 'rgba(255,60,50,' + (0.55 * edgeIn).toFixed(3) + ')';
      ctx.fillRect(ex - 2.6, ey, 1.7, 1.7);
      ctx.fillRect(ex + 1, ey, 1.7, 1.7);
    }
  }
  if (dread > 0.5) {
    const wA = (dread - 0.5) * 0.36;
    for (let i = 0; i < 10; i++) {
      const along = ih(i + 501);
      const top = i % 2 === 0;
      const wx = 30 + along * (GW - 60);
      const wy = top ? 34 : GH - 12;
      ctx.fillStyle = 'rgba(6,8,12,' + wA.toFixed(3) + ')';
      ctx.beginPath();
      ctx.arc(wx, wy, 7 + ih(i + 531) * 4, Math.PI, 0);   // a hunched, motionless watcher
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(wx - 5, wy - 6); ctx.lineTo(wx - 8, wy - 12); ctx.lineTo(wx - 3, wy - 8);   // an ear
      ctx.closePath(); ctx.fill();
    }
  }
}
/* ── LIGHT POOLS — the fight lights the field ──
   Soft additive ground glows under everything that burns, hums, or shines:
   blades, the stone, spell orbs, powerups, blasts, keg fuses, minions, allies,
   and a cool presence glow anchoring each hero to the dark. Render-only. */
function drawLightPools() {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const dim = 1 - dreadF * 0.5;   // the Nine dim every light on the field
  const pool = (x, y, r, rgb, a) => {
    a *= dim;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(' + rgb + ',' + a.toFixed(3) + ')');
    g.addColorStop(1, 'rgba(' + rgb + ',0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const puls = api.reduceMotion ? 0.75 : 0.65 + 0.35 * Math.sin(frame * 0.07);
  for (const h of heroesLive()) {
    pool(h.x, h.y + 2, 46, '140,170,210', 0.05);
    if (h.heldSaber) pool(h.x, h.y - 6, 70, '80,160,255', 0.10 * puls);
    else if (h.swordT > 0) pool(h.x, h.y - 6, 64, '255,200,80', 0.09 * puls);
    if (h.cls === 'caster' && h.castT > 0) pool(h.x, h.y - 10, 60, '200,140,255', 0.12);
    if (h.cls === 'necro') pool(h.x, h.y, 40, '80,255,215', 0.04);
  }
  if (stone) pool(stone.x, stone.y, 80, '255,200,80', 0.10 * puls);
  if (saberPickup) pool(saberPickup.x, saberPickup.y, 70, '80,160,255', 0.10 * puls);
  for (const pu of powerups) {
    pool(pu.x, pu.y, 54, pu.kind === 'freeze' ? '120,210,255' : pu.kind === 'fire' ? '255,140,60' : '190,150,255', 0.10 * puls);
  }
  for (const b of blasts) {
    if (b.x == null) continue;   // chain-lightning blasts carry point lists, not a center
    pool(b.x, b.y, (b.rMax || 80) * 1.1, b.kind === 'frost' ? '120,210,255' : b.kind === 'fire' ? '255,120,40' : '190,150,255', 0.12);
  }
  for (const k of kegs) {        // the arcing keg's lit fuse
    const t = k.t / k.T;
    pool(k.sx + (k.tx - k.sx) * t, k.sy + (k.ty - k.sy) * t - Math.sin(t * Math.PI) * 60, 26, '255,160,60', 0.10);
  }
  for (const m of minions) pool(m.x, m.y, 34, '80,255,215', 0.05);
  for (const al of allies) {
    if (al.x == null) continue;
    pool(al.x, al.y, 50, al.kind === 'luke' ? '120,255,140' : al.kind === 'gandalf' ? '220,220,255' : '160,120,255', 0.07);
  }
  ctx.restore();
}

// ── render-intro — class-preview mannequins, the intro/title screen, drawHero/drawDownedHero ──
// the intro's living mannequin: the hero as currently built — weapon in hand, gently
// scanning — over a class-colored spotlight. `hot` marks the row being edited.
function drawClassPreview(x, y, cls, color, hot, label) {
  const cc = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL, rider: '#ffab91' }[cls];
  ctx.save();
  // light pool under the feet
  ctx.globalAlpha = hot ? 0.5 : 0.26;
  const pool = ctx.createRadialGradient(x, y + 4, 4, x, y + 4, 46);
  pool.addColorStop(0, cc); pool.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = pool;
  ctx.beginPath(); ctx.ellipse(x, y + 4, 46, 12, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // the hero at 1.3× — a fake hero object drives the same weapon draws the game uses,
  // its facing swaying slowly so the weapon reads as alive, not a museum piece
  ctx.translate(x, y); ctx.scale(1.3, 1.3); ctx.translate(-x, -y);
  const fake = { x, y, fx: 1, fy: Math.sin(frame * 0.02) * 0.22, swingT: 0, castT: 0,
                 swordT: 1e9, heldSaber: false, cls, tint: color, phase: frame * 0.05, mounted: true };
  if (cls === 'wyrm') {
    drawWyrm(fake);   // the beast IS the figure
  } else {
    heroFigure(x, y, frame * 0.05, color, cls, 1, 1, 1, 0, hot ? cc : 0);
    if (cls === 'ranged') drawHeldBow(fake);
    else if (cls === 'caster') drawHeldStaff(fake);
    else if (cls === 'necro') drawHeldScythe(fake);
    else if (cls === 'dragoon' || cls === 'rider') drawHeldLance(fake);
    else drawHeldSword(fake);
  }
  ctx.restore();
  ctx.save();
  ctx.textAlign = 'center'; ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.font = (hot ? 'bold ' : '') + '13px Tahoma,Arial'; ctx.fillStyle = hot ? cc : '#9aa3a8';
  ctx.fillText((label ? label + ' · ' : '') + CLASS_ICON[cls] + ' ' + cls.toUpperCase(), x, y + 32);
  ctx.restore(); ctx.textAlign = 'left';
}

/* the title scene: a night field with the horde marching the ridge in silhouette,
   a gold wordmark, and pill-style mode/class selectors around the mannequin stage.
   Deliberately rnd()-free — every animation runs off `frame`, so pumping title
   frames can never advance the seeded sim stream. Pulses are steady (never
   flashing) under prefers-reduced-motion. */
function drawIntroScreen() {
  const RM = api.reduceMotion;
  // deterministic per-index jitter (a hash, NOT rnd() — see the note above)
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const rr = (x, y, w, h, r) => {
    ctx.beginPath(); ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  };
  ctx.clearRect(0, 0, GW, GH);
  ctx.save();

  /* ── the night scene ── */
  const gy = Math.round(GH * 0.3);                    // the ridge line
  let g = ctx.createLinearGradient(0, 0, 0, gy);
  g.addColorStop(0, '#04060c'); g.addColorStop(0.7, '#0b1220'); g.addColorStop(1, '#151017');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, gy);
  g = ctx.createLinearGradient(0, gy, 0, GH);
  g.addColorStop(0, '#11161d'); g.addColorStop(1, '#07090d');
  ctx.fillStyle = g; ctx.fillRect(0, gy, GW, GH - gy);
  for (let i = 0; i < 46; i++) {                      // starfield (steady when RM)
    const sx = ih(i) * GW, sy = ih(i + 97) * (gy - 28) + 6;
    const tw = RM ? 0.5 : 0.35 + 0.28 * Math.sin(frame * 0.045 + i * 1.7);
    ctx.fillStyle = 'rgba(215,230,255,' + Math.max(0.12, tw).toFixed(2) + ')';
    const sz = i % 7 === 0 ? 2 : 1.4;
    ctx.fillRect(sx, sy, sz, sz);
  }
  // ember glow over the ridge — the horde's fires, just out of sight. Peaks AT the
  // ridge line and fades both ways, so the marchers read as backlit silhouettes
  g = ctx.createLinearGradient(0, gy - 56, 0, gy + 26);
  g.addColorStop(0, 'rgba(255,120,40,0)'); g.addColorStop(0.7, 'rgba(255,130,45,0.26)'); g.addColorStop(1, 'rgba(255,120,40,0)');
  ctx.fillStyle = g; ctx.fillRect(0, gy - 56, GW, 82);
  // the horde on the march — real sprites, scaled down and silhouetted (frozen when RM)
  // (no archers — drawArcher faces the live `player`, which would break the march)
  const parade = ['goblin', 'wolf', 'goblin', 'troll', 'wolf', 'goblin', 'wolf', 'goblin', 'troll'];
  const span = GW + 160, step = span / parade.length;
  const xoff = RM ? 0 : (frame * 0.32) % span;
  ctx.save(); ctx.globalAlpha = 0.85;
  for (let i = 0; i < parade.length; i++) {
    const x = ((i * step + ih(i + 41) * 44 - xoff) % span + span) % span - 80;
    const sc = 0.5 + ih(i + 13) * 0.14;
    const fk = { x: 0, y: 0, phase: RM ? ih(i + 71) * 6.28 : frame * 0.11 + i * 1.9,
                 vx: -1, mode: 'lunge', lx: -1 };    // vx/lx pin the facing to the march
    ctx.save(); ctx.translate(x, gy + 2); ctx.scale(sc, sc);
    if (parade[i] === 'goblin') drawGoblin(fk, '#0d1218');
    else if (parade[i] === 'wolf') drawWolf(fk, '#0d1218');
    else drawTroll(fk, '#0d1218', 0);
    ctx.restore();
  }
  ctx.restore();
  // vignette so the scene falls away at the edges
  g = ctx.createRadialGradient(GW / 2, GH * 0.44, Math.min(GW, GH) * 0.32, GW / 2, GH * 0.44, Math.max(GW, GH) * 0.72);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.5)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);

  /* ── the wordmark ── */
  ctx.textAlign = 'center';
  const blade = (bx, by, ang) => {                    // a crest of crossed swords behind the title
    ctx.save(); ctx.translate(bx, by); ctx.rotate(ang); ctx.globalAlpha = 0.55;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#6e7f8f'; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(0, 40); ctx.lineTo(0, -46); ctx.stroke();
    ctx.strokeStyle = '#cdd8e2'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(0, 36); ctx.lineTo(0, -42); ctx.stroke();
    ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-10, 40); ctx.lineTo(10, 40); ctx.stroke();
    ctx.fillStyle = '#c9a227';
    ctx.beginPath(); ctx.arc(0, 49, 3.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  };
  blade(GW / 2, 52, -0.62); blade(GW / 2, 52, 0.62);
  const breathe = RM ? 0 : Math.sin(frame * 0.05);    // a slow glow, not a flash
  ctx.lineJoin = 'round';
  ctx.font = 'bold ' + Math.min(44, Math.round(GW / 11)) + 'px Tahoma,Arial';
  ctx.strokeStyle = '#120d02'; ctx.lineWidth = 7;
  ctx.strokeText('STICK FIGHTER', GW / 2, 62);
  g = ctx.createLinearGradient(0, 24, 0, 66);
  g.addColorStop(0, '#fff7dc'); g.addColorStop(0.55, '#ffd24d'); g.addColorStop(1, '#9a7a1f');
  ctx.shadowColor = '#ffb300'; ctx.shadowBlur = 14 + 6 * breathe;
  ctx.fillStyle = g;
  ctx.fillText('STICK FIGHTER', GW / 2, 62);
  ctx.shadowBlur = 0;
  // the 2000 plate, knocked slightly askew — very Y2K
  ctx.save();
  ctx.translate(GW / 2, 84); ctx.rotate(-0.045);
  rr(-52, -14, 104, 27, 6);
  ctx.fillStyle = '#160a06'; ctx.fill();
  ctx.strokeStyle = '#c9a227'; ctx.lineWidth = 1.5; ctx.stroke();
  g = ctx.createLinearGradient(0, -12, 0, 12);
  g.addColorStop(0, '#ffe4b3'); g.addColorStop(0.5, '#ff8a3c'); g.addColorStop(1, '#c62828');
  ctx.font = 'bold 20px Tahoma,Arial'; ctx.fillStyle = g;
  ctx.fillText('2 0 0 0', 0, 7);
  ctx.restore();
  ctx.font = 'italic 13px Tahoma,Arial'; ctx.fillStyle = '#d9a44a';
  ctx.fillText('the horde approaches.  RUN.  (and fight)', GW / 2, 116);

  /* ── the selectors ── */
  const pill = (x, y, w, h, label, sel, active, col, font) => {
    rr(x, y, w, h, h / 2);
    if (sel) {
      if (active) { ctx.shadowColor = col; ctx.shadowBlur = RM ? 10 : 8 + 4 * Math.sin(frame * 0.09); }
      ctx.fillStyle = active ? col : '#77828c';
      ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#10141a';
    } else {
      ctx.strokeStyle = active ? '#4b5a6a' : '#333d48'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.fillStyle = active ? '#93a3b3' : '#5c6773';
    }
    ctx.font = (sel ? 'bold ' : '') + (font || '13px Tahoma,Arial');
    ctx.fillText(label, x + w / 2, y + h / 2 + 4.5);
  };
  // row 0: SINGLEPLAYER / MULTIPLAYER — row 1: the branch's own sub-choices
  const tops = ['SINGLEPLAYER', 'MULTIPLAYER'];
  const topCol = ['#ffd24d', '#7fd8ff'];
  const tw2 = 150, mh = 26, mgap = 12;
  const tx0 = GW / 2 - (tw2 * 2 + mgap) / 2;
  for (let i = 0; i < 2; i++) pill(tx0 + i * (tw2 + mgap), 128, tw2, mh, tops[i], menuTop === i, introRow === 0, topCol[i]);
  const subs = menuTop === 0
    ? [['NORMAL', '#ffd24d'], [hardUnlocked ? '☠ HARD' : '🔒 HARD', '#ff6e6e'], ['☀ DAILY', '#ffb300']]
    : [['LOCAL', P2_COL], ['🌐 HOST', '#7fd8ff'], ['🌐 JOIN', '#7fd8ff']];
  const subSel = menuTop === 0 ? subSingle : subMulti;
  const mw = 108;
  const mx0 = GW / 2 - (mw * 3 + mgap * 2) / 2;
  for (let i = 0; i < 3; i++) {
    const locked = menuTop === 0 && i === 1 && !hardUnlocked;
    pill(mx0 + i * (mw + mgap), 160, mw, mh, subs[i][0], subSel === i, introRow === 1 && !locked, locked ? '#49525c' : subs[i][1]);
  }
  // one contextual notice line under the selectors
  ctx.font = '11px Tahoma,Arial';
  if (menuTop === 0 && subSingle === 2) {
    ctx.fillStyle = '#ffb300';
    ctx.fillText('☀ ' + dailyDayPretty() + ' — one seed for everyone · today\'s own board · resets at UTC midnight', GW / 2, 200);
  } else if (menuTop === 0 && subSingle === 1 && hardUnlocked) {
    ctx.font = 'bold 11px Tahoma,Arial'; ctx.fillStyle = '#ff6e6e';
    ctx.fillText('☠ HARD MODE — earned by mercy · elites from the first wave, everything comes early', GW / 2, 200);
  } else if (menuTop === 1 && subMulti === 1) {
    ctx.fillStyle = '#7fd8ff';
    ctx.fillText('🌐 HOST — you get a room code to share · pick YOUR class below (your friend picks theirs)', GW / 2, 200);
  } else if (menuTop === 1 && subMulti === 2) {
    ctx.fillStyle = '#7fd8ff';
    ctx.fillText('🌐 JOIN — type the room code a host gave you · pick YOUR class below (the host picks theirs)', GW / 2, 200);
  } else if (netNoticeT > 0 && netNotice) {
    netNoticeT--;
    ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = '#ff8a80';
    ctx.fillText('🌐 ' + netNotice, GW / 2, 200);
  }
  // the mannequin stage: a podium per hero, then the live preview(s) on top
  const py = clamp(Math.round(GH * 0.5), 240, 300);
  const podium = (x) => {
    ctx.fillStyle = 'rgba(10,14,19,0.7)';
    ctx.beginPath(); ctx.ellipse(x, py + 7, 58, 15, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(120,140,160,0.35)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.ellipse(x, py + 7, 58, 15, 0, 0, Math.PI * 2); ctx.stroke();
  };
  if (!isLocalMulti()) {
    podium(GW / 2);
    drawClassPreview(GW / 2, py, CLASSES[classSel], 'white', introRow === 2);
  } else {
    // room to breathe: the two podiums sit as far apart as the field allows
    const podX = Math.min(140, Math.round(GW * 0.18));
    podium(GW / 2 - podX); podium(GW / 2 + podX);
    drawClassPreview(GW / 2 - podX, py, CLASSES[classSel], 'white', introRow === 2, 'P1');
    drawClassPreview(GW / 2 + podX, py, CLASSES[classSel2], P2_COL, introRow === 3, 'P2');
  }
  ctx.textAlign = 'center';
  const clsCol = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL, rider: '#ffab91' };
  // the wyrm & rider are a PAIR: the wyrm pill appears only on P1's row in couch
  // co-op, and picking it binds P2's row to the single locked rider pill
  const PICKS_SOLO = [0, 1, 2, 3, 4];
  const cgap = 10, ch = 24;
  const clsRow = (y, sel, active, lbl, lblCol, list) => {
    const n = list.length;
    const cw = Math.min(104, Math.floor((GW - 60 - cgap * (n - 1)) / n));
    const x0 = GW / 2 - (cw * n + cgap * (n - 1)) / 2;
    if (lbl) {
      ctx.textAlign = 'right'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = lblCol;
      ctx.fillText(lbl, x0 - 12, y + ch / 2 + 4.5); ctx.textAlign = 'center';
    }
    for (let i = 0; i < n; i++) {
      const ci = list[i];
      pill(x0 + i * (cw + cgap), y, cw, ch, CLASS_ICON[CLASSES[ci]] + ' ' + CLASSES[ci].toUpperCase(),
           sel === ci, active, clsCol[CLASSES[ci]], '12px Tahoma,Arial');
    }
  };
  let cy = py + 48;
  if (!isLocalMulti()) {
    clsRow(cy, classSel, introRow === 2, null, null, PICKS_SOLO);
  } else {
    clsRow(cy, classSel, introRow === 2, 'P1', '#fff', [...PICKS_SOLO, PAIR_WYRM]);
    cy += 32;
    if (classSel === PAIR_WYRM) {
      clsRow(cy, PAIR_RIDER, false, 'P2', P2_COL, [PAIR_RIDER]);   // bound to the wyrm
    } else {
      clsRow(cy, classSel2, introRow === 3, 'P2', P2_COL, PICKS_SOLO);
    }
  }
  const CLASS_BLURB = {
    melee:  'run over the stone to seize the sword — X cleaves all before you',
    ranged: 'hold a direction and X looses an arrow that way — diagonals work',
    caster: 'X casts the chosen page — C turns the spellbook · spells drink mana, kills give it back',
    necro:  'X reaps a wide arc — husks caught in the sweep RISE as minions · kills feed the soul well',
    dragoon: 'JOUST: your speed IS the lance — meet every foe at full gallop or die on its body · X flaps',
    wyrm:  'the PAIR: you ARE the beast — steer, flap, TRAMPLE at speed · your kills feed the heat',
    rider: "the PAIR: you never steer — your keys AIM the saddle lance · E breathes fire from the wyrm's heat",
  };
  ctx.font = 'italic 12px Tahoma,Arial'; ctx.fillStyle = '#aeb9c4';
  ctx.fillText(CLASS_BLURB[CLASSES[introRow === 3 ? classSel2 : classSel]], GW / 2, cy + 40);

  /* ── footer: control hints on a dimmed bar, BEGIN pulsing above it ── */
  const hints = [];
  if (isLocalMulti()) {
    hints.push(['Player 1 (white):  arrows move  ·  Right-Shift dash  ·  /  attack', '#fff']);
    hints.push(['Player 2 (green):  WASD move  ·  Left-Shift dash  ·  F  attack', P2_COL]);
    hints.push(['allies & upgrades are shared — revive a downed partner by standing close', '#9fb0c0']);
  } else if (menuTop === 1) {
    hints.push(['move: WASD / arrows   ·   dash: Space / Shift   ·   attack: X / F', '#c8d2da']);
    hints.push(['online co-op — your friend picks their own class · revive a downed partner by standing close', '#7fd8ff']);
  } else {
    hints.push(['move: WASD / arrows   ·   dash: Space / Shift   ·   attack: X / F', '#c8d2da']);
  }
  hints.push(['◀ ▶ choose   ·   ↑ ↓ switch row   ·   1 / 2 / 3 jump to a mode', '#9fb0c0']);
  hints.push(['🏆 trophy case ' + sfTrophies.size + ' / ' + SF_ACH.length + '   ·   press T', sfTrophies.size === SF_ACH.length ? '#7CFC8A' : '#c9a227']);
  hints.push(['coins raise your multiplier  ·  graze foes for bonus  ·  clear waves for tokens', '#8494a4']);
  const barH = hints.length * 17 + 14;
  ctx.fillStyle = 'rgba(5,8,12,0.55)'; ctx.fillRect(0, GH - barH, GW, barH);
  ctx.strokeStyle = 'rgba(90,110,130,0.25)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(0, GH - barH); ctx.lineTo(GW, GH - barH); ctx.stroke();
  let hy = GH - barH + 19;
  ctx.font = '12px Tahoma,Arial';
  for (const [text, color] of hints) { ctx.fillStyle = color; ctx.fillText(text, GW / 2, hy); hy += 17; }
  const pulse = RM ? 0.5 : 0.5 + 0.5 * Math.sin(frame * 0.07);   // a fade, never a flash
  const bw = 250, bh = 30, byy = GH - barH - 44;
  rr(GW / 2 - bw / 2, byy, bw, bh, bh / 2);
  ctx.fillStyle = 'rgba(255,210,77,' + (0.1 + 0.08 * pulse).toFixed(3) + ')'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,77,' + (0.55 + 0.4 * pulse).toFixed(3) + ')'; ctx.lineWidth = 2; ctx.stroke();
  ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
  ctx.fillText(menuTop === 1 && subMulti === 1 ? '🌐  Z / ENTER — CREATE A ROOM'
             : menuTop === 1 && subMulti === 2 ? '🌐  Z / ENTER — ENTER A CODE'
             : menuTop === 1 ? '⚔  Z / ENTER — READY UP'
             : '⚔  Z / ENTER — BEGIN', GW / 2, byy + 20);

  if (introConfirm) drawIntroConfirm(); // the couch co-op party sheet (confirm gate)
  if (showTrophies) drawTrophyCase();   // the case sits over the whole intro
  ctx.restore(); ctx.textAlign = 'left';
}

// the couch co-op party sheet: a confirm gate over the intro so a stray Enter
// can't launch the run while someone's still deciding. Z/Enter starts (the key
// handler falls through to the begin branch), Q/Backspace backs out.
function drawIntroConfirm() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, GW, GH);
  const w = Math.min(500, GW - 40), h = 252, x = GW / 2 - w / 2, y = GH / 2 - h / 2 - 10;
  roundRectPath(x, y, w, h, 12);
  ctx.fillStyle = 'rgba(10,16,24,0.96)'; ctx.fill();
  ctx.strokeStyle = P2_COL; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.textAlign = 'center';
  ctx.font = 'bold 17px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
  ctx.fillText('⚔  READY TO FIGHT? — COUCH CO-OP', GW / 2, y + 32);
  const px = Math.min(120, Math.round(w * 0.24));
  const py = y + 128;
  drawClassPreview(GW / 2 - px, py, CLASSES[classSel], 'white', true, 'P1');
  drawClassPreview(GW / 2 + px, py, CLASSES[classSel2], P2_COL, true, 'P2');
  ctx.textAlign = 'center';
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('P1: arrows · Right-Shift dash · / attack       P2: WASD · Left-Shift dash · F attack', GW / 2, y + h - 46);
  ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7CFC8A';
  ctx.fillText('Z / ENTER — fight!       Q / Backspace — back', GW / 2, y + h - 18);
  ctx.restore(); ctx.textAlign = 'left';
}

// the WYRM — the co-op pair's war-beast (a proud Joust lineage): big gliding body,
// long neck, snapping beak, galloping legs, and stub wings that beat on a flap.
// Drawn in place of the hero figure for cls 'wyrm'; the mounted rider is a normal
// hero drawn at the saddle right after it.
function drawWyrm(h) {
  const dir = h.fx >= 0 ? 1 : -1;
  const col = heroTint(h);
  const run = Math.hypot(h.vx || 0, h.vy || 0);
  const gait = Math.sin(h.phase || 0);
  const beat = Math.max(0, 1 - (tick - (h.flapT || -99)) / 14);   // wingbeat decays after a flap
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.scale(dir, 1);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // legs first (behind the body), scissoring with the stride
  ctx.strokeStyle = col; ctx.lineWidth = 2.6;
  ctx.beginPath(); ctx.moveTo(-4, -12); ctx.lineTo(-7 + gait * 5, -2); ctx.lineTo(-9 + gait * 7, 0); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(4, -12); ctx.lineTo(7 - gait * 5, -2); ctx.lineTo(9 - gait * 7, 0); ctx.stroke();
  // tail plume
  ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 2.2;
  ctx.beginPath(); ctx.moveTo(-14, -18); ctx.quadraticCurveTo(-24, -22 + gait * 2, -30, -16 + gait * 3); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-14, -20); ctx.quadraticCurveTo(-23, -27 + gait * 2, -28, -24 + gait * 2); ctx.stroke();
  // the body — a stout ellipse, saddle blanket over the spine
  ctx.fillStyle = 'rgba(20,26,34,0.92)';
  ctx.strokeStyle = col; ctx.lineWidth = 2.4;
  ctx.beginPath(); ctx.ellipse(0, -18, 16, 10, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(-7, -26); ctx.quadraticCurveTo(0, -30, 7, -26); ctx.stroke();   // the saddle
  // stub wing, beating on a flap (steady half-raised under reduced motion)
  const wa = api.reduceMotion ? 0.4 : beat;
  ctx.fillStyle = 'rgba(255,167,38,0.4)'; ctx.strokeStyle = DRAGOON_COL; ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(-2, -22);
  ctx.quadraticCurveTo(-12, -30 - wa * 10, -20, -26 - wa * 14);
  ctx.quadraticCurveTo(-12, -20, -3, -17);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // the neck + head, leaning into the run; the beak snaps at trample speed
  const lean = Math.min(6, run * 1.2);
  ctx.strokeStyle = col; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.moveTo(10, -22); ctx.quadraticCurveTo(16 + lean, -34, 17 + lean, -42); ctx.stroke();
  ctx.fillStyle = 'rgba(20,26,34,0.92)';
  ctx.beginPath(); ctx.ellipse(18 + lean, -44, 6, 4.5, 0.2, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
  ctx.fillStyle = DRAGOON_COL;                                      // the beak
  const snap = run >= JOUST_BAR.goblin ? (api.reduceMotion ? 1.5 : 1 + gait * 1.6) : 0.8;
  ctx.beginPath(); ctx.moveTo(23 + lean, -45); ctx.lineTo(31 + lean, -44 + snap); ctx.lineTo(23 + lean, -42); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#ffd24d';                                        // the eye
  ctx.beginPath(); ctx.arc(19 + lean, -45, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

// the hero's current body color: P1 white / P2 green, overridden by the dash
// cyan and the frost-wolf chill. The intro mannequins pass their display color
// through `h.tint`. Used by the body draw AND the weapon arms/fists, so P2's
// bow arm is green like the rest of P2.
function heroTint(h) {
  if (h.tint) return h.tint;
  const base = coop && p2 ? SEAT_COLS[heroSeat(h)] || 'white' : 'white';
  return h.dashT > 0 ? '#80deea' : h.chillT > 0 ? '#a8d8e8' : base;
}
// draw one hero (class-dressed figure + Aegis bubble + held weapon). A downed
// hero is drawn fallen with a revive ring instead.
function drawHero(h) {
  if (h.down) { drawDownedHero(h); return; }
  if (h.cls === 'wyrm') { drawWyrm(h); return; }
  const lean = clamp(h.vx * 0.04, -0.3, 0.3);
  const col = heroTint(h);
  heroFigure(h.x, h.y, h.phase, col, h.cls, h.fx >= 0 ? 1 : -1, 1, 1, lean, h.dashT > 0 ? '#80deea' : 'rgba(255,255,255,0.5)');
  // the Aegis: a soft hex-bubble around the hero while it holds; a bright flash as it breaks
  if (h.shield || h.iframe > 0) {
    const breaking = !h.shield && h.iframe > 0;
    const a = breaking ? h.iframe / 44 : (api.reduceMotion ? 0.5 : 0.42 + 0.18 * Math.sin(frame * 0.14));
    ctx.save(); ctx.translate(h.x, h.y - 14);
    ctx.strokeStyle = breaking ? 'rgba(200,240,255,' + a + ')' : 'rgba(127,216,255,' + a + ')';
    ctx.lineWidth = breaking ? 3.5 : 2.4;
    ctx.shadowColor = '#7fd8ff'; ctx.shadowBlur = breaking ? 16 : 8;
    const rad = 26 + (breaking ? (1 - h.iframe / 44) * 14 : 0);
    ctx.beginPath();
    for (let s = 0; s <= 6; s++) { const aa = s / 6 * Math.PI * 2 - Math.PI / 2; const fn = s ? 'lineTo' : 'moveTo'; ctx[fn](Math.cos(aa) * rad, Math.sin(aa) * rad * 1.18); }
    ctx.closePath(); ctx.stroke();
    ctx.shadowBlur = 0; ctx.restore();
  }
  if (h.cls === 'ranged') drawHeldBow(h);
  else if (h.cls === 'caster') drawHeldStaff(h);
  else if (h.cls === 'necro') drawHeldScythe(h);
  else if (h.cls === 'dragoon') drawHeldLance(h);
  else if (h.cls === 'rider' && h.mounted) drawHeldLance(h);   // the saddle lance rides the aim
  else if (h.cls === 'rider') drawHeldDirk(h);                 // unhorsed: a short desperate dirk
  else if (h.swordT > 0 || h.heldSaber) drawHeldSword(h);
}
// a fallen co-op hero: a prone figure with a revive ring that fills as a partner stands by
function drawDownedHero(h) {
  heroFigure(h.x, h.y, 0, '#7a7a7a', h.cls, h.fx >= 0 ? 1 : -1, 1, 0.7, Math.PI / 2, 'rgba(160,160,160,0.4)', true);
  const p = clamp(h.reviveT / reviveNeed(), 0, 1);
  ctx.save();
  ctx.translate(h.x, h.y - 18);
  ctx.strokeStyle = 'rgba(120,120,120,0.55)'; ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.stroke();
  if (p > 0) {
    ctx.strokeStyle = P2_COL; ctx.shadowColor = P2_COL; ctx.shadowBlur = 8;
    ctx.beginPath(); ctx.arc(0, 0, 15, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
  }
  ctx.shadowBlur = 0;
  ctx.fillStyle = '#ff8a80'; ctx.font = 'bold 14px Tahoma,Arial'; ctx.textAlign = 'center';
  ctx.fillText('✚', 0, -20);
  ctx.restore(); ctx.textAlign = 'left';
}

// ── combat — hit resolution: knockback, killEnemy, strike/downHero/reviveHero, endRun ──
function knockback(cx, cy, killR, push, stun) {
  for (const e of enemies) {
    const dx = e.x - cx, dy = e.y - cy, d = Math.hypot(dx, dy) || 1;
    if (killR > 0 && d < killR) {
      if (!e.hp || (e.hp -= 2) <= 0) { killEnemy(e); continue; }
    }
    const p = push * Math.max(0.25, 1 - d / 500);
    e.x = clamp(e.x + dx / d * p, -60, GW + 60);
    e.y = clamp(e.y + dy / d * p, -60, GH + 60);
    e.stun = stun; e.vx = 0; e.vy = 0;
    if (e.mode) { e.mode = e.type === 'archer' ? 'approach' : 'stalk'; e.st = 70; }
  }
  enemies = enemies.filter(e => !e.dead);
}

// heavy impacts hold the world — max semantics so a cleave punctuates, never stutters
function hitStopFor(n) { hitStop = Math.min(14, Math.max(hitStop, n)); }
function killEnemy(e) {
  if (e.dead) return;
  // downing the fell beast doesn't end the Witch-king — he rises and fights on foot
  if (e.type === 'witchking' && e.mounted) {
    hitStopFor(10);   // the fell beast crashes — the world feels it
    e.mounted = false; e.hp = e.footMax; e.kr = 22; e.spd = 1.7;
    e.mode = 'walk'; e.st = 60; e.stun = 36; e.flailAng = 0;
    banner = 'the fell beast is slain!'; bannerSub = 'the Witch-king takes up his flail'; bannerT = 130;
    sfSfx.screech(); shake = 12;
    sparks.push({ x: e.x, y: e.y - 30, t: 30, color: '#b39ddb', txt: 'SCREEEE' });
    return;
  }
  // DIO doesn't simply die — a slow crumble cutscene plays out (handled in dioFinale)
  if (e.type === 'dio' && e.mode !== 'dying') { hitStopFor(12); startDioFinale(e); return; }
  e.dead = true;
  kills++;
  killsByType[e.type] = (killsByType[e.type] || 0) + 1;
  // HIT-STOP: every kill lands with weight — a beat for a grunt, a held breath
  // for a troll or an elite, the world stopping for a boss
  hitStopFor(e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' ? 12
           : e.type === 'ogre' ? 8
           : e.type === 'troll' || e.elite ? 4 : 2);
  sfUnlock('first_blood');
  if (e.type === 'wolf' && e.elite && !noPersist()) {   // WOLFSBANE: frost + dire frost wolves, lifetime
    wolfKills++;
    try { localStorage.setItem('ilaird_sf_wolfkills', String(wolfKills)); } catch (_) {}
    if (wolfKills >= 100) sfUnlock('wolf_100');
  }
  // a necromancer in the party harvests the fallen: grunts leave husks to raise
  if ((e.type === 'goblin' || e.type === 'wolf' || e.type === 'archer' || e.type === 'troll') &&
      !champsBanned() && husks.length < HUSK_CAP && heroesAll().some(h => h.cls === 'necro')) {
    husks.push({ src: e.type, x: e.x, y: e.y, t: Math.round(HUSK_T * up.huskMul), elite: e.elite || 0 });
  }
  // Shatter: a foe killed while frozen bursts into an ice nova-let, freezing its neighbors
  if (up.shatter && e.frozen > 0) {
    sfSfx.freeze();
    blasts.push({ kind: 'frost', x: e.x, y: e.y, r: 0, t: 0, life: 20, rMax: 70 });
    let n = 0;
    for (const o of enemies) {
      if (o === e || untouchable(o) || o.frozen > 0) continue;
      if (o.type === 'witchking' || o.type === 'vader' || o.type === 'sidious' || o.type === 'dio' || o.type === 'wraith') continue;
      if (Math.hypot(o.x - e.x, o.y - e.y) < 70) { o.frozen = 180; o.vx = 0; o.vy = 0; n++; }
    }
    if (n) sparks.push({ x: e.x, y: e.y - 30, t: 18, color: '#8fd8ff', txt: 'SHATTER' });
  }
  const pts = ((e.type === 'dio' ? 500 : e.type === 'sidious' ? 400 : e.type === 'vader' ? 300 : e.type === 'witchking' ? 200 : e.type === 'ogre' ? 120 : e.type === 'troll' ? 40 : e.type === 'shaman' ? 35 : e.type === 'bomber' ? 35 : e.type === 'wraith' ? 30 : e.type === 'guard' ? 25 : e.type === 'trooper' ? 20 : 15) + bn.bounty) * mult * (e.elite === 2 ? 4 : e.elite ? 2 : 1);
  score += pts;
  if (e.kr !== 0 || e.type === 'shaman' || e.type === 'bomber') addDecal(e.x, e.y, 'ash');   // (render-only) the field remembers the fallen
  addMeter(7);
  sparks.push({ x: e.x, y: e.y - 26, t: 20, color: '#ffd24d', txt: '+' + pts });
  sfSfx.killE();
  if (e.type === 'witchking') {
    sfUnlock('witch_king');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    if (hardMode) sfUnlock('dark_hour');
    if (!hardMode) openBoonMenu('THE WITCH-KING FALLS — CHOOSE A BOON');   // hard mode: no gifts, ever
    bossActive = false; nineDone = true; corpses = [];
    const gotTok = grantBossToken();   // every Witch-king kill earns an upgrade token
    banner = 'the Witch-king is no more'; bannerSub = '+1000' + (gotTok ? '  ·  token earned' : ''); bannerT = 160;
    score += 1000;
    addMeter(40);
    shake = 16;
    awaitExit = true;  // a way out opens to the east...
    openUpgradeMenu('THE WITCH-KING FALLS');  // spend banked tokens before the road east
  } else if (e.type === 'trooper') {
    swTroopersLeft--;
  } else if (e.type === 'ogre') {
    sfUnlock('ogre');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // the mini-boss falls hard — extra points, a meter surge, and a guaranteed powerup drop
    banner = 'the war-ogre falls!'; bannerSub = '+200'; bannerT = 130;
    score += 200; addMeter(30); shake = 14;
    powerups.push({ x: e.x, y: e.y, kind: ['freeze', 'fire', 'bolt'][Math.floor(rnd() * 3)], t: 820 });
  } else if (e.type === 'vader') {
    sfUnlock('vader');
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // the dark lord falls — but a darker master waits in the void. keep the saber.
    vaderActive = false; swState = 'vaderdown';   // stay in the void; keep the lightsaber + starfield
    arrows = []; player.choke = 0; player.stunT = 0; swFlash = 0;  // clear in-flight saber / Force effects
    banner = 'the dark lord falls'; bannerSub = '+1500'; bannerT = 170;
    score += 1500; addMeter(40); shake = 18;
    grantBossToken();                   // Vader's fall earns an upgrade before the Emperor
    // a breath, an upgrade, then the Emperor reveals himself
    if (!openUpgradeMenu('DARTH VADER FALLS')) sidiousCue = 110;
  } else if (e.type === 'sidious') {
    camKick(GW / 2 - e.x, GH / 2 - e.y, 5);   // (render-only) the fall pulls the camera in
    // he does not simply fall — Darth Vader rises and bears him into the dark,
    // the Emperor's lightning storming over them both (reward deferred to the cutscene's end)
    sfUnlock('sidious');
    startSidiousFinale(e);
  } else if (e.type === 'wraith' && nineActive) {
    // every wraith's body stays on the field
    corpses.push({ x: e.x, y: e.y, dir: (player.x - e.x) >= 0 ? 1 : -1 });
    if (--wraithsLeft <= 0) {
      // the last has fallen — but one of the bodies stirs
      nineActive = false; bossActive = true;
      const c = corpses[Math.floor(rnd() * corpses.length)] || { x: player.x, y: 60 };
      bossRiseX = c.x; bossRiseY = c.y; bossRiseT = 440;
      banner = 'the Nine are fallen...'; bannerSub = 'but one will not stay dead'; bannerT = 130;
      sfSfx.screech();
    }
  }
}

// a blow lands on hero h: the Aegis eats it if charged, otherwise the hero falls.
// In single-player a fall ends the run outright; in co-op the hero is DOWN and the
// run only ends once both heroes are down (see downHero/endRun).
function strike(h) {
  if (!h || h.down || h.dashT > 0 || h.iframe > 0) return;  // mid-dash i-frames / just-shielded
  // (render-only) the living camera lurches WITH the blow — away from the likely striker
  let kdx = 0, kdy = 1, kbest = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d < kbest) { kbest = d; kdx = h.x - e.x; kdy = h.y - e.y; }
  }
  camKick(kdx, kdy, 7);
  hurtFlash = { dx: -kdx, dy: -kdy, t: 26 };   // (render-only) the screen edge flares FROM the striker's side
  hitStopFor(8);   // a blow that lands on a HERO stops the world hardest of all
  runFlawless = false;   // a blow got through the dodges (Aegis eating it still counts) — UNSCATHED is off
  if (h.shield) {
    // the Aegis takes the blow — shatters, buys a beat of safety, and shoves attackers off
    h.shield = false; h.iframe = 44;
    shake = Math.max(shake, 12); sfSfx.shieldBreak();
    sparks.push({ x: h.x, y: h.y - 32, t: 30, color: '#7fd8ff', txt: 'SHIELD BROKEN' });
    knockback(h.x, h.y, 0, 130, 16);
    if (up.secondWind && up.dashMax > 0) {   // Second Wind: the break refills every dash
      h.dashCharges = up.dashMax; h.rechargeT = 0;
      sparks.push({ x: h.x, y: h.y - 48, t: 24, color: '#80deea', txt: 'SECOND WIND' });
    }
    return;
  }
  if (h.bn.cheatDeath) {
    // DEATHWARD: the boon takes the blow that would have ended things — once.
    // Sits BELOW the Aegis on purpose: the shield refreshes every wave, this doesn't.
    h.bn.cheatDeath = false; h.iframe = 60;
    shake = Math.max(shake, 12); sfSfx.shieldBreak();
    sparks.push({ x: h.x, y: h.y - 32, t: 34, color: '#ff8ab5', txt: '💖 DEATHWARD' });
    knockback(h.x, h.y, 0, 130, 16);
    return;
  }
  downHero(h);
}
function downHero(h) {
  camVictim = h;                                 // the kill cam frames whoever just fell
  fieldWashSet('10,16,40', 0.3, 70);             // (render-only) the field drains cold as a hero falls
  if (!coop) { endRun(); return; }               // solo: a hit is simply the end
  h.down = true; h.downT = 0; h.reviveT = 0; h.vx = 0; h.vy = 0; h.dashT = 0; h.stunT = 0;
  if (h.cls === 'rider') h.mounted = false;      // a struck rider is THROWN from the saddle
  if (h.cls === 'wyrm' && p2 && p2.cls === 'rider' && p2.mounted && !p2.down) {
    // the beast falls out from under the rider — dumped standing beside the body
    p2.mounted = false;
    p2.x = clamp(h.x + 20, 14, GW - 14); p2.y = h.y;
    sparks.push({ x: p2.x, y: p2.y - 30, t: 20, color: DRAGOON_COL, txt: 'THROWN!' });
  }
  sfSfx.die(); shake = Math.max(shake, 12);
  sparks.push({ x: h.x, y: h.y - 30, t: 34, color: '#ff5252', txt: 'DOWN!' });
  if (heroesLive().length === 0) endRun();        // both fallen — the horde wins
  else { banner = 'PLAYER ' + (heroSeat(h) + 1) + ' DOWN'; bannerSub = 'a partner can revive — stand close'; bannerT = 90; }
}
// the run is over (solo death, or both heroes down in co-op)
function endRun() {
  // arm the KILL CAM: the ghost tape's last seconds replay in slow motion before
  // the death screen (render-only; any key skips; reduced motion goes straight on)
  if (!replayMode && !api.reduceMotion && camTape.length > 30) {
    const v = camVictim || player;
    killCam = { tape: camTape, i: Math.max(0, camTape.length - CAM_SHOW), t: 0, hold: 0, fx: v.x, fy: v.y };
  }
  if (replayMode) {                  // the legend falls again — nothing of the watcher's changes
    alive = false; sfSfx.die(); shake = 14; lbState = 'off';
    return;
  }
  if (netplay) {                     // online runs are score-free: no board, no best, no saves
    alive = false; sfSfx.die(); shake = 14; lbState = 'off';
    return;
  }
  alive = false;
  if (dailyRun) sfUnlock('daily');   // seeing a daily through counts, win or lose
  lbTicks = tick; lbKills = kills;   // the run's proof stats, frozen at death
  if (score > best) { best = score; newBest = true; localStorage.setItem('ilaird_sf_best', String(best)); }
  sfSfx.die(); shake = 14;
  lbBegin();
}
function reviveHero(h) {
  h.down = false; h.reviveT = 0; h.iframe = up.medic ? 120 : 70;   // up again, with a beat of mercy invulnerability (longer with a Medic)
  h.shield = up.shield; h.vx = 0; h.vy = 0; h.chillT = 0;
  sfSfx.summon();
  sparks.push({ x: h.x, y: h.y - 32, t: 34, color: P2_COL, txt: 'REVIVED!' });
  banner = (h === player ? 'PLAYER 1' : 'PLAYER 2') + ' REVIVED'; bannerSub = ''; bannerT = 70;
}
// legacy name kept for the Force-choke death path (a guaranteed kill of P1)
function slayPlayer() { strike(player); }

// ── leaderboard — hall of legends: run proof, fetch/submit, replay watch entry points ──
/* ── online leaderboard (the "hall of legends") ──
   Backed by the same hal-worker service as the LLM-HAL game (GET /scores,
   POST /score). Reads HAL_WORKER_URL — an app.js global (both are classic
   scripts in one shared scope). Degrades silently to lbState='off' (the
   original local-best death screen) whenever the worker is absent/unreachable. */
function lbBase() {
  try { return (typeof HAL_WORKER_URL === 'string' && HAL_WORKER_URL) ? HAL_WORKER_URL : null; }
  catch (_) { return null; }
}
// stamp the run's true start time with a worker-signed token (fire-and-forget —
// starting never waits on the network; no token just means the submit is refused
// by a proof-enforcing worker and the death screen stays view-only)
function beginRunProof() {
  runToken = null;
  const base = lbBase();
  if (!base || netplay) return;   // online runs never submit, so they claim no run token
  fetch(base + '/run-start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    .then(r => r.ok ? r.json() : null)
    .then(d => { if (d && typeof d.token === 'string') runToken = d.token; })
    .catch(() => {});
}
function lbBegin() {
  lbScore = score; lbWave = wave; lbRank = -1; lbName = ''; lbScores = null; lbDaily = null;
  watchSel = null; watchErr = '';
  const base = lbBase();
  if (cheated) { lbState = 'off'; return; }   // warp/grant cheats: a fine playground, not a ranked run
  if (!base || score <= 0) { lbState = 'off'; return; }
  lbState = 'loading';
  const day = dailyDayStr();
  // fetch both boards: the all-time hall is required; today's board is best-effort
  // (an old worker without daily support echoes the all-time board WITHOUT a `day`
  // field, so requiring d.day === day keeps a stale backend from faking a daily list)
  const allP = fetch(base + '/scores', { method: 'GET' })
    .then(r => r.ok ? r.json() : Promise.reject(r.status));
  const dayP = fetch(base + '/scores?day=' + day, { method: 'GET' })
    .then(r => r.ok ? r.json() : null)
    .catch(() => null);
  Promise.all([allP, dayP])
    .then(([all, dl]) => {
      if (alive) return;                       // player already restarted — ignore the stale load
      lbScores = (all && Array.isArray(all.scores)) ? all.scores.slice(0, 10) : [];
      lbDaily = (dl && dl.day === day && Array.isArray(dl.scores)) ? dl.scores.slice(0, 10) : null;
      const board = dailyRun ? lbDaily : lbScores;
      if (board === null) { lbState = 'view'; return; }   // daily run, worker has no daily boards — display only
      const lowest = board.length >= 10 ? board[board.length - 1].score : 0;
      lbState = (board.length < 10 || lbScore > lowest) ? 'enter' : 'view';
    })
    .catch(() => { if (!alive) lbState = 'off'; });
}
function lbSubmit() {
  const base = lbBase();
  const nm = (lbName.trim() || 'AAA').slice(0, 10);
  if (!base) { lbState = 'off'; return; }
  lbState = 'submitting';
  // attach the run's recording (header + per-tick events) so the board entry is
  // watchable — skipped if the recorder overflowed or the encoding is oversized
  let replayField = {};
  if (!recOverflow && recHdr) {
    const rp = { ...recHdr, ev: recEv };
    if (JSON.stringify(rp).length <= 150000) replayField = { replay: rp };
  }
  fetch(base + '/score', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // a daily run carries its day → the worker writes today's board instead;
    // token + ticks + kills are the run's minimal proof (see beginRunProof)
    body: JSON.stringify({ game: 'sf', name: nm, score: lbScore, wave: lbWave,
                           token: runToken, ticks: lbTicks, kills: lbKills,
                           ...replayField,
                           ...(dailyRun ? { day: dailyDayStr() } : {}) }),
  })
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      if (alive) return;                       // restarted mid-submit — drop the response
      if (d && Array.isArray(d.scores)) {
        if (dailyRun) lbDaily = d.scores.slice(0, 10);
        else lbScores = d.scores.slice(0, 10);
      }
      lbRank = (d && Number.isInteger(d.rank)) ? d.rank : -1;
      if (dailyRun && lbRank === 0) sfUnlock('daily_crown');   // LEGEND OF THE DAY — top of today's board
      lbState = 'done';
    })
    .catch(() => { if (!alive) lbState = 'view'; });   // show the board we already have
}

/* ── watching a legend: fetch a stored replay and re-simulate it locally ── */
let watchSel = null;    // { list: [{entry, daily}], idx } — the death-screen picker
let watchErr = '';      // sticky failure notice (the death hud repaints every tick)
function watchableEntries() {
  const list = [];
  for (const e of lbScores || []) if (e && typeof e.rp === 'string') list.push({ entry: e, daily: false });
  for (const e of lbDaily || [])  if (e && typeof e.rp === 'string') list.push({ entry: e, daily: true });
  return list;
}
function startWatch(item) {
  const base = lbBase();
  if (!base) return;
  hud.innerHTML = 'fetching the legend…';
  fetch(base + '/replay?id=' + encodeURIComponent(item.entry.rp))
    .then(r => r.ok ? r.json() : Promise.reject(r.status))
    .then(d => {
      const rd = d && d.replay;
      // v must match the CURRENT sim-balance version — an older recording would
      // re-simulate under new rules and play back a different run than it claims
      if (!rd || rd.v !== 4 || !Array.isArray(rd.ev) || typeof rd.seed !== 'number') return Promise.reject('bad');
      startReplay(rd, item.entry);
    })
    .catch(() => { watchSel = null; watchErr = 'replay unavailable — recorded on an older build, or expired'; });
}
function startReplay(d, entry) {
  // impersonate the recorded run's setup; the watcher's own selections return on exit
  repSaved = { c1: classSel, c2: classSel2, coop, daily: dailyRun, hs: hardSel,
               top: menuTop, ss: subSingle, sm: subMulti };
  watchSel = null;
  replayMode = true;
  replay = { d, i: 0, name: String(entry.name || 'AAA'), score: entry.score | 0 };
  classSel = clamp(d.c1 | 0, 0, CLASSES.length - 1); classSel2 = clamp(d.c2 | 0, 0, CLASSES.length - 1);
  coop = !!d.coop; dailyRun = false;
  sfSeedOverride = d.seed >>> 0;
  repMask = 0;
  init();                 // replayMode: init loads the RECORDER's persistent state
  started = true; frame = 0;
  // same post-init roll as live play — the feeder's opcode 12 picks (hardMode
  // came from the recording's header, so hard replays open on the bane menu)
  hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
  banner = '▶ ' + replay.name + ' — ' + replay.score;
  bannerSub = 'a legend, replayed · Q to leave'; bannerT = 150;
}
function stopReplay() {
  replayMode = false; replay = null;
  if (repSaved) {
    classSel = repSaved.c1; classSel2 = repSaved.c2;
    coop = repSaved.coop; dailyRun = repSaved.daily; hardSel = repSaved.hs;
    menuTop = repSaved.top; subSingle = repSaved.ss; subMulti = repSaved.sm;
    repSaved = null;
  }
  sfSeedOverride = null;
  init();                 // back to the title, the watcher's own setup restored
}

// ── netplay — online co-op WAR BAND (2–4 seats): signaling, lobby, host-relayed lockstep, reconnection ──
/* ── online co-op: a host-relayed STAR for up to NET_MAX_SEATS fighters ──
   The HOST is seat 0 (P1) and every joiner links only to the host, which relays
   input frames and menu events between clients — 2-player is simply the 2-seat
   case of the same code path. One room code serves the whole band: the first
   joiner takes the minted room, later joiners fall through to derived, gen-
   stamped SLOT rooms the host re-arms after each join (the overwritable rejoin-
   room machinery — zero new worker surface). Frames are seat-tagged ({t:'f',
   p:seat}); a tick executes only when EVERY seat's frame for it is buffered
   (netCanStep), so the relay adds at most one host hop of latency. The per-tick
   feeder lives at the top of loop() beside the replay feeder. */
const NET_RTC_CONF = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
// connection diagnostics — candidate counts each side gathered + the state trail,
// folded into failure messages and breadcrumbed to the console ([sf-net]) so a
// "couldn't connect" report is actually debuggable
let netDiag = null;
function netCandSummary(sdp) {
  const counts = { host: 0, srflx: 0, relay: 0 };
  const re = /a=candidate:.+ typ (host|srflx|relay)/g;
  let m;
  while ((m = re.exec(sdp || ''))) counts[m[1]]++;
  return counts.host + ' host / ' + counts.srflx + ' srflx' + (counts.relay ? ' / ' + counts.relay + ' relay' : '');
}
function netLog(msg) {
  try { console.info('[sf-net] ' + msg); } catch (e) { /* no console */ }
}
/* room derivations — everything hangs off the ONE typed code:
   - slot rooms (pre-run, joiners 2..3): rejoinHash(code + ':join:' + n, 0)
   - per-seat rejoin rooms (mid-run reconnection): rejoinHash(code + ':' + seat, seed) */
function netSlotRoom(code, n) { return rejoinHash(code + ':join:' + n, 0); }
function netSeatRoom(seat) { return rejoinHash(netRoomCode + ':' + seat, netCfg ? netCfg.seed >>> 0 : 0); }
function netOpen(mode) {
  netTeardown();
  // a stale paired pick can't cross into the wrong seat: the joiner never plays
  // the wyrm (they're P2+), and nobody plays the rider except through the pair
  if (classSel === PAIR_RIDER || (classSel === PAIR_WYRM && mode !== 'host')) classSel = 0;
  netDiag = { local: '?', remote: '?', states: [] };
  netSaved = { c1: classSel, c2: classSel2, coop, daily: dailyRun, hs: hardSel,
               top: menuTop, ss: subSingle, sm: subMulti,
               gw: xp.offsetWidth, gh: xp.offsetHeight - 40 };
  netIsHost = mode === 'host';
  netSeat = netIsHost ? 0 : -1;
  netConns = []; netArming = null;
  netUi = { mode, phase: mode === 'host' ? 'creating' : 'code', code: '', input: '', err: '', copiedT: 0,
            seats: netIsHost ? [{ c: classSel, r: false, on: true }] : null, myReady: false };
  netCfg = null;
  if (mode === 'host') netHostArm(null);
}
// non-trickle ICE: wait for gathering so ONE blob carries the candidates —
// signaling is a single store/fetch each way, no trickle channel needed.
function netWaitIce(pc, aliveFn) {
  return new Promise((res) => {
    if (!pc) return res();
    const t0 = Date.now();
    const poll = () => {
      if (aliveFn && !aliveFn()) return res();
      const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
      const hasCand = /a=candidate:/.test(sdp);
      const dt = Date.now() - t0;
      if (pc.iceGatheringState === 'complete' || (hasCand && dt >= 3000) || dt >= 8000) return res();
      setTimeout(poll, 200);
    };
    poll();
  });
}
/* ── link wiring — every pc/channel pair belongs to a `link`:
   the CLIENT's single { host: true } link, a HOST conn (a seated client), or the
   host's netArming placeholder. Guards compare against the link's own handles so
   a torn-down link's late events go inert. ── */
function netWirePc(pc, conn) {
  pc.onconnectionstatechange = () => {
    if (conn ? conn.pc !== pc : netPc !== pc) return;
    const s = pc.connectionState;
    if (netDiag) netDiag.states.push(s);
    netLog('connection' + (conn && conn.seat > 0 ? ' (P' + (conn.seat + 1) + ')' : '') + ': ' + s);
    const dT = conn || { get discoT() { return netDiscoT; }, set discoT(v) { netDiscoT = v; } };
    if (s === 'connected' && dT.discoT) { clearTimeout(dT.discoT); dT.discoT = 0; }
    // MID-RUN a dead link holds the run and re-signals (netStartRecon): `failed`
    // reconnects at once, `disconnected` after a 10s grace (browsers often recover
    // it; a lagging/tabbed-away peer is covered by the stall badge, not a re-signal)
    if (netplay) {
      if (s === 'failed') netStartRecon(conn, 'the peer link failed');
      else if (s === 'disconnected' && !(conn ? conn.recon : netRecon) && !dT.discoT) {
        dT.discoT = setTimeout(() => {
          dT.discoT = 0;
          if (netplay && !(conn ? conn.recon : netRecon) &&
              (conn ? conn.pc === pc : netPc === pc) && pc.connectionState === 'disconnected') {
            netStartRecon(conn, 'the link went quiet');
          }
        }, 10000);
      }
      return;
    }
    if (s === 'failed') {
      if (conn) { netHostDropLink(conn, 'lost a joiner mid-connect'); return; }
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      if (netUi && netUi.phase !== 'err' && netUi.phase !== 'code') {
        netAbort('no direct route could be found' + diag + ' — retry, or try a different network. VPNs and strict NATs block peer links.');
      }
    }
  };
}
function netWireChannel(dc, conn) {
  if (conn) conn.chan = dc; else netChan = dc;
  dc.onopen = () => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    netLog('data channel open' + (conn && conn.seat > 0 ? ' (P' + (conn.seat + 1) + ')' : ''));
    if (netTimeout) { clearTimeout(netTimeout); netTimeout = 0; }
    if (netUi && netUi.phase !== 'lobby') netUi.phase = netIsHost ? (netUi.phase === 'waiting' || netUi.phase === 'creating' ? netUi.phase : 'lobby') : 'handshake';
    if (netplay) {
      // mid-run reconnect — swap resume state instead of the hello handshake.
      // The CLIENT reports per-seat floors (it receives every seat through the
      // host); the HOST reports the scalar floor of that client's own frames.
      if (conn) netSendTo(conn, { t: 'resume', r: netRunId, k: tick, have: conn.have });
      else netSend({ t: 'resume', r: netRunId, k: tick, have: netHave || [] });
      return;
    }
    // a joiner opens the handshake; the host answers with a seat + the lobby
    if (!netIsHost) netSend({ t: 'hello', nv: NET_VER, sv: NET_SIM_V, cls: classSel, gw: GW, gh: GH });
  };
  dc.onmessage = (ev) => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    let m = null;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m && typeof m.t === 'string') netHandle(m, conn);
  };
  dc.onclose = () => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    // mid-run, a closed channel is a DROP, not an exit — hold the run and re-signal
    // (a deliberate exit crosses as 'bye' before the close and lands in netLeave)
    if (netplay) netStartRecon(conn, 'the link closed');
    else if (conn) netHostDropLink(conn, 'a joiner left');
    else if (netUi && netUi.phase !== 'err' && !netIsHost) netAbort('the connection closed before the game began');
  };
}
// host: broadcast to every open conn · client: to the host link
function netSend(o) {
  const s = JSON.stringify(o);
  if (netIsHost) {
    for (const c of netConns) {
      try { if (c.chan && c.chan.readyState === 'open') c.chan.send(s); } catch (_) { /* that link is dying */ }
    }
  } else {
    try { if (netChan && netChan.readyState === 'open') netChan.send(s); } catch (_) { /* dying */ }
  }
}
function netSendTo(conn, o) {
  try { if (conn.chan && conn.chan.readyState === 'open') conn.chan.send(JSON.stringify(o)); } catch (_) { /* dying */ }
}
function netRelay(m, fromConn) {   // host: forward a message to every OTHER conn
  const s = JSON.stringify(m);
  for (const c of netConns) {
    if (c === fromConn) continue;
    try { if (c.chan && c.chan.readyState === 'open') c.chan.send(s); } catch (_) { /* dying */ }
  }
}
/* ── HOST: arm a room and wait for the next joiner. The first arm mints the
   typed room code; every later arm re-posts a fresh gen-stamped offer into one
   of the two derived slot rooms (alternating), which joiners try in order. ── */
let netArmSeq = 0;
async function netHostArm(slotCode) {
  const base = lbBase();
  if (!base) { if (!netConns.length) netAbort('online play needs the room service, and it is unreachable'); return; }
  const pend = { seat: -1, pc: null, chan: null, have: NET_DELAY, csRemote: new Map(),
                 recon: null, discoT: 0, ack: false, cls: 0, gw: GW, gh: GH, room: slotCode, pollId: 0 };
  try {
    const pc = new RTCPeerConnection(NET_RTC_CONF);
    pend.pc = pc;
    netArming = pend;
    netWirePc(pc, pend);
    netWireChannel(pc.createDataChannel('sf', { ordered: true }), pend);
    await pc.setLocalDescription(await pc.createOffer());
    await netWaitIce(pc, () => netArming === pend);
    if (netArming !== pend || !netUi || netUi.mode !== 'host') return;
    if (netDiag && !slotCode) netDiag.local = netCandSummary(pc.localDescription.sdp);
    const body = slotCode
      ? { rejoin: slotCode, offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }
      : { offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } };
    const r = await fetch(base + '/mp-host', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('mp-host ' + r.status);
    const d = await r.json();
    if (netArming !== pend || !netUi || netUi.mode !== 'host') return;
    if (!slotCode) {
      netUi.code = String(d.code || '');
      netRoomCode = netUi.code;   // every derived room hangs off this
      netUi.phase = 'waiting';
    }
    pend.room = slotCode || netUi.code;
    let polls = 0;
    pend.pollId = setInterval(async () => {
      if (netArming !== pend || !netUi) { clearInterval(pend.pollId); pend.pollId = 0; return; }
      polls++;
      if (!slotCode && !netConns.length && polls > 150) { netAbort('the room expired — nobody joined in time'); return; }  // ~5 min, first joiner only
      if (slotCode && polls % 110 === 0) {
        // slot rooms expire in 5 min — quietly re-arm a fresh offer before that
        clearInterval(pend.pollId); pend.pollId = 0;
        if (netArming === pend) { netArming = null; try { pend.pc.close(); } catch (_) {} netHostArm(slotCode); }
        return;
      }
      try {
        const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(pend.room));
        if (!rr.ok) return;
        const dd = await rr.json();
        if (dd && dd.answer && pend.pc && pend.pc.signalingState === 'have-local-offer') {
          clearInterval(pend.pollId); pend.pollId = 0;
          if (netDiag && !slotCode) netDiag.remote = netCandSummary(dd.answer.sdp);
          netLog('answer received in ' + pend.room);
          await pend.pc.setRemoteDescription(dd.answer);
          // the channel's open → the joiner's hello seats them (netHandle)
        }
      } catch (_) { /* transient poll failure — try again next interval */ }
    }, 2000);
  } catch (_) {
    if (!netConns.length && !slotCode) netAbort('could not create a room — check your connection and try again');
  }
}
// a pre-run link died (or a lobby member left): free the seat, shift the ones
// above it down (seats stay contiguous), tell everyone, and re-arm a slot
function netHostDropLink(conn, why) {
  netLog(why);
  try { if (conn.pollId) clearInterval(conn.pollId); } catch (_) {}
  try { if (conn.chan) { conn.chan.onmessage = conn.chan.onopen = conn.chan.onclose = null; conn.chan.close(); } } catch (_) {}
  try { if (conn.pc) { conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch (_) {}
  const i = netConns.indexOf(conn);
  if (i < 0) { if (netArming === conn) { netArming = null; netHostArmNext(); } return; }
  netConns.splice(i, 1);
  for (const c of netConns) {
    if (c.seat > conn.seat) { c.seat--; netSendTo(c, { t: 'seat', n: c.seat, nv: NET_VER, sv: NET_SIM_V }); }
  }
  netLobbySync();
  netHostArmNext();
}
function netHostArmNext() {
  if (!netUi || netUi.mode !== 'host' || netplay) return;
  if (netArming || netConns.length + 1 >= NET_MAX_SEATS) return;
  netHostArm(netSlotRoom(netRoomCode, 2 + (netArmSeq++ % 2)));
}
// rebuild + broadcast the lobby's seat table (host-authoritative)
function netLobbySync() {
  if (!netIsHost || !netUi) return;
  const seats = [{ c: classSel, r: !!netUi.myReady, on: true }];
  for (const c of netConns) seats[c.seat] = { c: c.cls, r: !!c.ready, on: true };
  netUi.seats = seats;
  netSend({ t: 'lob', seats, code: netRoomCode });
}
// lobby actions shared by the key handler (23-input) — each side owns its seat
function netLobbyCls() {
  if (netIsHost) netLobbySync();
  else netSend({ t: 'cls', c: classSel });
}
function netLobbyReady(v) {
  if (netUi) netUi.myReady = v;
  if (netIsHost) { netLobbySync(); netLobbyMaybeStart(); }
  else netSend({ t: 'rdy', v: v ? 1 : 0 });
}
async function netStartJoin(code) {
  const base = lbBase();
  if (!base) { netAbort('online play needs the room service, and it is unreachable'); return; }
  netUi.phase = 'connecting'; netUi.code = code; netUi.err = '';
  netRoomCode = code;
  netIsHost = false; netSeat = -1;
  const ui = netUi;
  const candidates = [code, netSlotRoom(code, 2), netSlotRoom(code, 3)];
  const tried = new Set();   // cand+gen pairs that 409'd — don't re-answer a taken offer
  try {
    let sawRoom = false;
    for (let round = 0; round < 40 && netUi === ui && ui.phase === 'connecting'; round++) {
      for (const cand of candidates) {
        if (netUi !== ui || ui.phase !== 'connecting') return;
        let d = null;
        try {
          const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(cand));
          if (!r.ok) continue;
          d = await r.json();
        } catch (_) { continue; }
        if (!d || !d.offer) continue;
        sawRoom = true;
        const gen = d.gen ? String(d.gen) : '';
        if (tried.has(cand + '#' + gen)) continue;
        const pc = new RTCPeerConnection(NET_RTC_CONF);
        netPc = pc;
        netWirePc(pc, null);
        pc.ondatachannel = (ev) => { if (netPc === pc) netWireChannel(ev.channel, null); };
        if (netDiag) netDiag.remote = netCandSummary(d.offer.sdp);
        await pc.setRemoteDescription(d.offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await netWaitIce(pc, () => netPc === pc && netUi === ui);
        if (netUi !== ui || netPc !== pc) return;
        if (netDiag) netDiag.local = netCandSummary(pc.localDescription.sdp);
        const body = { code: cand, answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } };
        if (gen) body.gen = gen;
        let rr = null;
        try {
          rr = await fetch(base + '/mp-join', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          });
        } catch (_) { /* fall through to retry */ }
        if (rr && rr.ok) {
          netArmConnTimeout();
          return;   // the channel's open → hello → seat assignment drive the rest
        }
        tried.add(cand + '#' + gen);
        try { pc.close(); } catch (_) {}
        if (netPc === pc) { netPc = null; netChan = null; }
      }
      await new Promise((res) => setTimeout(res, 700));
    }
    if (netUi === ui && ui.phase === 'connecting') {
      if (sawRoom) netAbort('that war band is full (4 fighters max) — or the room went stale. ask the host for a fresh code.');
      else { ui.phase = 'code'; ui.input = ''; ui.err = 'room not found — check the code (rooms expire after 5 minutes)'; }
    }
  } catch (_) { if (netUi === ui) netAbort('could not join — check your connection and the code'); }
}
function netArmConnTimeout() {
  if (netTimeout) clearTimeout(netTimeout);
  netTimeout = setTimeout(() => {
    netTimeout = 0;
    if (!netplay && !netIsHost && netUi && netUi.phase !== 'err' && netUi.phase !== 'lobby') {
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      netAbort('could not reach the host' + diag + ' — a strict network may be blocking the path. retry, or try another network.');
    }
  }, 20000);
}
function netHandle(m, conn) {
  switch (m.t) {
    case 'hello': {   // host side: a joiner introduces itself → seat it, open the lobby
      if (!netIsHost || netplay || netCfg || !conn) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) {
        netSendTo(conn, { t: 'err', why: 'version' });
        netHostDropLink(conn, 'version-mismatched joiner turned away');
        return;
      }
      if (netConns.length + 1 >= NET_MAX_SEATS && !netConns.includes(conn)) {
        netSendTo(conn, { t: 'full' });
        netHostDropLink(conn, 'room full');
        return;
      }
      conn.seat = netConns.length + 1;
      conn.cls = clamp(m.cls | 0, 0, PAIR_WYRM - 1);   // joiners never pick the pair
      conn.gw = Math.max(320, m.gw | 0) || GW;
      conn.gh = Math.max(240, m.gh | 0) || GH;
      conn.ready = false;
      if (netArming === conn) netArming = null;
      netConns.push(conn);
      if (netUi) netUi.phase = 'lobby';
      netSendTo(conn, { t: 'seat', n: conn.seat, nv: NET_VER, sv: NET_SIM_V });
      netLobbySync();
      netHostArmNext();   // park the next offer for the rest of the band
      break;
    }
    case 'seat':      // client side: the host seated us (version-checked both ways)
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) { netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.'); return; }
      netSeat = clamp(m.n | 0, 1, NET_MAX_SEATS - 1);
      if (netUi) { netUi.phase = 'lobby'; netUi.myReady = false; }
      break;
    case 'lob':       // client side: the lobby's seat table (host-authoritative)
      if (netIsHost || netplay || !netUi) return;
      netUi.seats = Array.isArray(m.seats) ? m.seats : [];
      break;
    case 'cls':       // host side: a joiner re-picked their hero
      if (!netIsHost || netplay || !conn || conn.seat < 1) return;
      conn.cls = clamp(m.c | 0, 0, PAIR_WYRM - 1);
      netLobbySync();
      break;
    case 'rdy':       // host side: a joiner toggled ready
      if (!netIsHost || netplay || !conn || conn.seat < 1) return;
      conn.ready = !!m.v;
      netLobbySync();
      netLobbyMaybeStart();
      break;
    case 'cfg': {     // client side: adopt the host's authoritative run header
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.v !== NET_SIM_V) { netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.'); return; }
      const cs = (Array.isArray(m.cs) ? m.cs : []).slice(0, NET_MAX_SEATS).map((c) => clamp(c | 0, 0, CLASSES.length - 1));
      if (cs.length < 2) return;
      netCfg = { v: m.v, seed: m.seed >>> 0, cs,
                 hd: m.hd ? 1 : 0, up0: Array.isArray(m.up0) ? m.up0 : [],
                 tk0: m.tk0 | 0, mw0: m.mw0 | 0,
                 gw: Math.max(320, m.gw | 0), gh: Math.max(240, m.gh | 0) };
      netSend({ t: 'ready' });
      break;
    }
    case 'ready':     // host side: a joiner acked the cfg — go when the whole band has
      if (!netIsHost || !netCfg || netplay || !conn) return;
      conn.ack = true;
      if (netConns.every((c) => c.ack)) { netSend({ t: 'go' }); netBeginRun(); }
      break;
    case 'go':    if (!netIsHost && netCfg && !netplay) netBeginRun(); break;
    case 'f': {       // a seat-tagged input frame for tick m.k
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      const p = m.p | 0;
      if (p < 0 || p >= netFrames.length || p === netSeat) return;
      if (netIsHost && (!conn || p !== conn.seat)) return;   // a client only speaks for its own seat
      const fk = m.k | 0;
      netFrames[p].set(fk, { m: m.m | 0, e: m.e | 0, s: (typeof m.s === 'number') ? m.s | 0 : -1, h: m.h | 0 });
      if (netIsHost) { if (fk > conn.have) conn.have = fk; netRelay(m, conn); }
      else if (netHave && fk > netHave[p]) netHave[p] = fk;
      break;
    }
    case 'resume': {  // a link is back mid-run: refill whatever the drop swallowed
      if (!netplay || m.r !== netRunId) return;
      if (netIsHost && conn) {
        // the client reported per-seat floors — refill EVERY seat from our buffers
        const floors = Array.isArray(m.have) ? m.have : [];
        for (let sIdx = 0; sIdx < netFrames.length; sIdx++) {
          if (sIdx === conn.seat) continue;
          const from = (floors[sIdx] | 0) + 1;
          for (let k = from; k <= tick + NET_DELAY; k++) {
            const f = netFrames[sIdx].get(k);
            if (f) netSendTo(conn, { t: 'f', r: netRunId, p: sIdx, k, m: f.m, e: f.e, s: f.s, h: f.h });
          }
        }
        for (const ev of netEventLog) {
          if (ev[0] > (m.k | 0)) netSendTo(conn, { t: 'ev', r: netRunId, k: ev[0], op: ev[1], a: ev[2] });
        }
        conn.recon = null;
      } else if (!netIsHost) {
        // the host reported the scalar floor of OUR frames — resend our own
        const mine = netFrames[netSeat];
        for (let k = (m.have | 0) + 1; k <= tick + NET_DELAY; k++) {
          const f = mine.get(k);
          if (f) netSend({ t: 'f', r: netRunId, p: netSeat, k, m: f.m, e: f.e, s: f.s, h: f.h });
        }
        for (const ev of netEventLog) {
          if (ev[0] > (m.k | 0)) netSend({ t: 'ev', r: netRunId, k: ev[0], op: ev[1], a: ev[2] });
        }
        netRecon = null;
      }
      netStall = 0;
      netLog('resumed at tick ' + tick + (conn ? ' (P' + (conn.seat + 1) + ')' : ''));
      break;
    }
    case 'ev': {      // a tick-stamped menu event. Host-authoritative EXCEPT each
      // seat's own boon pick (op 12) and shop buys (op 7) — those cross upward
      // and the host relays them to the rest of the band.
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      const eop = m.op | 0;
      if (netIsHost && eop !== 12 && eop !== 7) return;
      const ek = m.k | 0;
      // dedupe: reconnect resumes re-send logs, so an event may arrive twice
      if (ek <= tick || netEvents.some(x => x[0] === ek && x[1] === eop && x[2] === m.a)) return;
      netEvents.push([ek, eop, m.a]);
      netEvents.sort((x, y) => x[0] - y[0]);
      if (netIsHost) {
        netEventLog.push([ek, eop, m.a]);   // the relay hub's log covers the whole band
        netRelay(m, conn);
      }
      break;
    }
    case 'cs':        // a peer's periodic sim checksum
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      if (netIsHost) {
        if (!conn) return;
        conn.csRemote.set(m.k | 0, m.h >>> 0);
        netCheckCsConn(conn, m.k | 0);
      } else {
        netCsRemote.set(m.k | 0, m.h >>> 0);
        netCheckCs(m.k | 0);
      }
      break;
    case 'restart':   // host rematch: same band & cfg, a fresh shared seed
      if (netplay && !netIsHost && netCfg && typeof m.seed === 'number') { netCfg.seed = m.seed >>> 0; netBeginRun(); }
      break;
    case 'bye':
      if (netplay) {
        if (netIsHost) netSend({ t: 'bye' });   // one leaver disbands the band — tell the rest
        netLeave('A FIGHTER LEFT — the war band disbands');
      } else if (netIsHost && conn) netHostDropLink(conn, 'a joiner backed out');
      else if (netUi) netAbort('the host backed out');
      break;
    case 'full':
      if (!netplay) netAbort('that war band is full (4 fighters max)');
      break;
    case 'err':
      if (m.why === 'version') netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.');
      break;
  }
}
// the whole band ready → the HOST builds the authoritative run header; each ack
// (‘ready’) is counted and ‘go’ starts every sim at once
function netLobbyMaybeStart() {
  if (!netIsHost || netplay || netCfg) return;
  if (!netUi || netUi.phase !== 'lobby' || !netUi.myReady) return;
  if (!netConns.length || !netConns.every((c) => c.ready)) return;
  const cs = [classSel === PAIR_WYRM ? PAIR_WYRM : clamp(classSel, 0, PAIR_WYRM)];
  for (const c of netConns) cs[c.seat] = clamp(c.cls | 0, 0, PAIR_WYRM - 1);
  // the WYRM & RIDER pair: the host in the beast binds SEAT 1 to the saddle
  if (cs[0] === PAIR_WYRM && cs.length > 1) cs[1] = PAIR_RIDER;
  // fresh entropy for the shared seed (the one non-deterministic input, as in init)
  const seed = (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
  // snapshot the host's own party profile (upProfile reads classSel2/coop)
  const savedC2 = classSel2, savedCoop = coop;
  classSel2 = cs[1] | 0; coop = true;
  const up0 = [...loadSavedUpgrades()];
  const tk0 = parseInt(loadProfileItem('ilaird_sf_tokens') || '0', 10) || 0;
  const mw0 = parseInt(loadProfileItem('ilaird_sf_maxwave', false) || '0', 10) || 0;
  classSel2 = savedC2; coop = savedCoop;
  let gw = GW, gh = GH;
  for (const c of netConns) { gw = Math.min(gw, c.gw || GW); gh = Math.min(gh, c.gh || GH); }
  netCfg = { v: NET_SIM_V, seed, cs, hd: 0, up0, tk0, mw0, gw, gh };
  for (const c of netConns) c.ack = false;
  netUi.phase = 'starting';
  netSend({ t: 'cfg', nv: NET_VER, ...netCfg });
}
// menu picks become tick-stamped events applied by EVERY feeder. Stamped
// tick+NET_DELAY+1: no peer can run more than NET_DELAY ahead of our last-sent
// frame, and the ordered channel delivers this before any frame that would let
// it pass the stamp — so no sim can have passed it. (A client's event reaches
// the far clients one host-relay later, still inside the same bound + delay.)
function netQueueEvent(op, a) {
  const k = tick + NET_DELAY + 1;
  netEvents.push([k, op, a]);
  netEvents.sort((x, y) => x[0] - y[0]);
  netEventLog.push([k, op, a]);   // kept all run (tiny) — a resume re-sends any lost in flight
  netSend({ t: 'ev', r: netRunId, k, op, a });
}
function netBeginRun() {
  netplay = true;
  netRunId++;
  netUi = null;
  const cs = netCfg.cs;
  // impersonate the shared config (startReplay-style); netSaved restores on exit
  classSel = cs[0]; classSel2 = cs[1] | 0;
  coop = true; dailyRun = false; hardSel = false;
  sfSeedOverride = netCfg.seed >>> 0;
  setGameDims(netCfg.gw, netCfg.gh);
  netFrames = cs.map(() => new Map());
  // pre-seed the first NET_DELAY ticks with silence on every seat, so tick 1 can run
  for (let t = 1; t <= NET_DELAY; t++) {
    for (const fm of netFrames) fm.set(t, { m: 0, e: 0, s: -1, h: 0 });
  }
  netHave = cs.map(() => NET_DELAY);
  for (const c of netConns) { c.have = NET_DELAY; c.csRemote = new Map(); c.recon = null; }
  netEvents = []; netEventLog = [];
  netLocal = { dash: false, atk: false, cycle: false, summon: -1, mash: 0 };
  netMasks = [0, 0, 0, 0];
  netStall = 0; netCsLocal = new Map(); netCsRemote = new Map();
  netRecon = null;
  netRejoin = netSeatRoom(netSeat);   // my seat's reconnect rendezvous
  simAcc = 0; lastFrameTs = null;
  netLog('run begins — you are P' + (netSeat + 1) + ' of ' + cs.length +
         ' · band ' + cs.map((c) => CLASSES[c]).join(' / ') +
         ' · seed ' + (netCfg.seed >>> 0) + ' · field ' + netCfg.gw + 'x' + netCfg.gh);
  init();                              // netplay branch: state from netCfg, recorder disarmed
  started = true; frame = 0;
  banner = '🌐 ONLINE ' + (cs.length > 2 ? 'WAR BAND (' + cs.length + ')' : 'CO-OP') + ' · WAVE 1';
  bannerSub = 'you are PLAYER ' + (netSeat + 1) + ' · no scores are saved online';
  bannerT = 150;
  openBoonMenu('CHOOSE YOUR BOON');    // synchronous, the seed's first draws — identical on every sim
  startSfMusic();
}
// back to the title screen (a leaver, a desync, or a chosen exit) — restore
// everything the impersonated run changed and leave a sticky notice
function netLeave(msg) {
  netTeardown();
  netplay = false; netCfg = null; netUi = null;
  netFrames = null; netEvents = []; netLocal = null;
  netCsLocal = null; netCsRemote = null;
  netRecon = null; netEventLog = []; netRoomCode = ''; netRejoin = '';
  netConns = []; netSeat = 0; netHave = null; netMasks = [0, 0, 0, 0];
  if (netSaved) {
    classSel = netSaved.c1; classSel2 = netSaved.c2;
    coop = netSaved.coop; dailyRun = netSaved.daily; hardSel = netSaved.hs;
    menuTop = netSaved.top; subSingle = netSaved.ss; subMulti = netSaved.sm;
    setGameDims(netSaved.gw, netSaved.gh);
    netSaved = null;
  }
  sfSeedOverride = null;
  stopSfMusic();
  netNotice = msg || ''; netNoticeT = 480;
  init();                              // started=false → the intro screen
}
// a failure on the CONNECT screens (before any run): stay on them with the error
function netAbort(msg) {
  netTeardown();
  if (netUi) { netUi.phase = 'err'; netUi.err = msg; }
}
function netTeardown() {
  if (netPoll) { clearInterval(netPoll); netPoll = 0; }
  if (netTimeout) { clearTimeout(netTimeout); netTimeout = 0; }
  if (netDiscoT) { clearTimeout(netDiscoT); netDiscoT = 0; }
  netReconSeq++;   // any in-flight reconnect/join loop sees a stale token and goes inert
  const links = [...netConns];
  if (netArming) links.push(netArming);
  netConns = []; netArming = null;
  for (const c of links) {
    try { if (c.pollId) clearInterval(c.pollId); } catch (_) {}
    try { if (c.discoT) clearTimeout(c.discoT); } catch (_) {}
    try { if (c.chan) { c.chan.onmessage = c.chan.onopen = c.chan.onclose = null; c.chan.close(); } } catch (_) {}
    try { if (c.pc) { c.pc.onconnectionstatechange = null; c.pc.ondatachannel = null; c.pc.close(); } } catch (_) {}
  }
  const pc = netPc, ch = netChan;
  netPc = null; netChan = null;        // nulled FIRST so late events see a stale handle and bail
  try { if (ch) { ch.onmessage = null; ch.onopen = null; ch.onclose = null; ch.close(); } } catch (_) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.ondatachannel = null; pc.close(); } } catch (_) {}
}
/* ── mid-run reconnection (per seat) ──
   A dropped link holds the WHOLE band (the lockstep gate freezes every sim the
   moment a seat's frames stop) and re-signals through that seat's rejoin room,
   derived from (room code, seat, seed). The HOST re-posts fresh gen-stamped
   offers there; the dropped CLIENT polls for them. Retries for up to
   NET_RECON_MAX_MS (10 minutes), then the run concedes for everyone. On reopen
   both ends exchange 'resume' and refill the swallowed frames/events, and the
   gate simply unblocks — bit-exact, band-wide. */
function rejoinHash(code, seed) {
  const AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const s = code + ':' + (seed >>> 0);
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 5; i++) { out += AB[h % AB.length]; h = ((Math.imul(h, 33) >>> 0) ^ (h >>> 7)) >>> 0; }
  return 'R' + out;
}
const NET_RECON_MAX_MS = 600000;   // give reconnection 10 minutes, then concede the run
// something reconnecting? (drives the overlay + blocks the rematch key)
function netReconActive() {
  if (netRecon) return netRecon;
  for (const c of netConns) if (c.recon) return c.recon;
  return null;
}
function netReconSeat() {
  if (netRecon) return netSeat;
  for (const c of netConns) if (c.recon) return c.seat;
  return -1;
}
function netStartRecon(conn, why) {
  if (!netplay) return;
  if (conn) {
    // HOST: one seat's link died — re-signal just that seat, keep the others
    if (conn.recon) return;
    netLog('P' + (conn.seat + 1) + ' link lost (' + why + ') — holding the run, re-signaling');
    try { if (conn.discoT) clearTimeout(conn.discoT); conn.discoT = 0; } catch (_) {}
    try { if (conn.chan) { conn.chan.onmessage = conn.chan.onopen = conn.chan.onclose = null; conn.chan.close(); } } catch (_) {}
    try { if (conn.pc) { conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch (_) {}
    conn.pc = null; conn.chan = null;
    conn.recon = { attempt: 0, t0: performance.now(), gen: '' };
    netReconSeq++;
    netReconHostAttempt(conn, netReconSeq);
    return;
  }
  // CLIENT: our link to the host died
  if (netRecon) return;
  netLog('link lost mid-run (' + why + ') — holding the run, re-signaling via ' + netRejoin);
  if (netDiscoT) { clearTimeout(netDiscoT); netDiscoT = 0; }
  const pc = netPc, ch = netChan;
  netPc = null; netChan = null;
  try { if (ch) { ch.onmessage = ch.onopen = ch.onclose = null; ch.close(); } } catch (_) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.ondatachannel = null; pc.close(); } } catch (_) {}
  netReconSeq++;
  netRecon = { attempt: 0, t0: performance.now(), gen: '' };
  netReconClientAttempt(netReconSeq);
}
// HOST: repost offers into the dropped seat's rejoin room until it answers
async function netReconHostAttempt(conn, tok) {
  const live = () => {
    if (!(netplay && conn.recon && tok === netReconSeq && netConns.includes(conn))) return false;
    if (performance.now() - conn.recon.t0 > NET_RECON_MAX_MS) {
      netLog('reconnect window exhausted — conceding the run');
      netSend({ t: 'bye' });
      netLeave('CONNECTION LOST — P' + (conn.seat + 1) + ' could not return within 10 minutes');
      return false;
    }
    return true;
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const again = (ms) => { if (live()) setTimeout(() => { if (live()) netReconHostAttempt(conn, tok); }, ms); };
  if (!live()) return;
  conn.recon.attempt++;
  const base = lbBase();
  if (!base) { again(10000); return; }
  const room = netSeatRoom(conn.seat);
  try {
    const pc = new RTCPeerConnection(NET_RTC_CONF);
    conn.pc = pc; netWirePc(pc, conn);
    netWireChannel(pc.createDataChannel('sf', { ordered: true }), conn);
    await pc.setLocalDescription(await pc.createOffer());
    await netWaitIce(pc, () => live() && conn.pc === pc);
    if (!live() || conn.pc !== pc) return;
    const r = await fetch(base + '/mp-host', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rejoin: room,
        offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
    });
    if (!r.ok) throw new Error('mp-host ' + r.status);
    if (!live() || conn.pc !== pc) return;
    for (let i = 0; i < 12 && live() && conn.pc === pc; i++) {   // ~24s of answer polling
      await wait(2000);
      if (!live() || conn.pc !== pc) return;
      try {
        const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(room));
        if (!rr.ok) continue;
        const dd = await rr.json();
        if (dd && dd.answer && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(dd.answer);
          for (let j = 0; j < 7 && live() && conn.pc === pc && conn.recon; j++) await wait(2000);
          break;
        }
      } catch (_) { /* transient poll failure — keep polling */ }
    }
    if (!live() || conn.pc !== pc || !conn.recon) return;   // resumed or gone
    try { pc.close(); } catch (_) { /* already dead */ }
    if (conn.pc === pc) { conn.pc = null; conn.chan = null; }
    again(2000);
  } catch (_) { again(8000); }
}
// CLIENT: poll our seat's rejoin room until the host's fresh offer appears
async function netReconClientAttempt(tok) {
  const live = () => {
    if (!(netplay && netRecon && tok === netReconSeq)) return false;
    if (performance.now() - netRecon.t0 > NET_RECON_MAX_MS) {
      netLog('reconnect window exhausted — conceding the run');
      netLeave('CONNECTION LOST — could not reconnect within 10 minutes');
      return false;
    }
    return true;
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const again = (ms) => { if (live()) setTimeout(() => { if (live()) netReconClientAttempt(tok); }, ms); };
  if (!live()) return;
  netRecon.attempt++;
  const base = lbBase();
  if (!base) { again(10000); return; }
  try {
    const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(netRejoin));
    if (r.ok) {
      const d = await r.json();
      const gen = d && d.gen ? String(d.gen) : '';
      if (d && d.offer && gen && gen !== netRecon.gen) {
        netRecon.gen = gen;
        const pc = new RTCPeerConnection(NET_RTC_CONF);
        netPc = pc; netWirePc(pc, null);
        pc.ondatachannel = (ev) => { if (netPc === pc) netWireChannel(ev.channel, null); };
        await pc.setRemoteDescription(d.offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await netWaitIce(pc, () => live() && netPc === pc);
        if (!live() || netPc !== pc) return;
        const rr = await fetch(base + '/mp-join', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: netRejoin, gen,
            answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
        });
        if (rr.ok) {   // wait out ICE; onopen → 'resume' ends the recon
          for (let j = 0; j < 7 && live() && netPc === pc && netRecon; j++) await wait(2000);
        }
        if (!live() || netPc !== pc || !netRecon) return;
        try { pc.close(); } catch (_) { /* already dead */ }
        if (netPc === pc) { netPc = null; netChan = null; }
      }
    }
    again(2500);
  } catch (_) { again(8000); }
}
// the band may advance to tick T only when EVERY seat's frame for T is buffered.
// No deadlock: each sim always has its own future frames, and every other seat's
// through (thatSeatTick + NET_DELAY), so stalls only ever reflect real latency.
function netCanStep() {
  if (!netFrames) return false;
  for (const fm of netFrames) if (!fm.has(tick + 1)) return false;
  return true;
}
// the desync tripwire: every 60 ticks, fold the load-bearing sim state into a
// hash and swap it — the host checks every client's stream, the clients check
// the host's. Any mismatch means a sim silently diverged (a bug) and the run
// ends cleanly for everyone.
function netChecksum() {
  let hsh = 5381 >>> 0;
  const mix = (v) => { hsh = (((hsh << 5) + hsh) ^ (v | 0)) >>> 0; };
  mix(tick); mix(score); mix(kills); mix(wave); mix(enemies.length);
  mix(tokens); mix(Math.round(meter));
  for (const h of heroesAll()) { mix(Math.round(h.x * 8)); mix(Math.round(h.y * 8)); }
  netCsLocal.set(tick, hsh);
  netSend({ t: 'cs', r: netRunId, k: tick, h: hsh });
  if (!netIsHost) netCheckCs(tick);
  if (netCsLocal.size > 40) {          // prune — a laggy peer's checksums arrive late, not never
    const min = tick - 2400;
    for (const k of netCsLocal.keys()) if (k < min) netCsLocal.delete(k);
    if (netCsRemote) for (const k of netCsRemote.keys()) if (k < min) netCsRemote.delete(k);
    for (const c of netConns) for (const k of c.csRemote.keys()) if (k < min) c.csRemote.delete(k);
  }
}
function netCheckCs(k) {   // client: compare the host's stream against our own
  if (!netCsLocal || !netCsRemote) return;
  const a = netCsLocal.get(k), b = netCsRemote.get(k);
  if (a === undefined || b === undefined) return;
  netCsRemote.delete(k);
  if (a !== b) { netSend({ t: 'bye' }); netLeave('DESYNC — the worlds drifted apart. reconnect and try again.'); }
}
function netCheckCsConn(conn, k) {   // host: compare one client's stream (local entries stay for the others)
  if (!netCsLocal) return;
  const a = netCsLocal.get(k), b = conn.csRemote.get(k);
  if (a === undefined || b === undefined) return;
  conn.csRemote.delete(k);
  if (a !== b) { netSend({ t: 'bye' }); netLeave('DESYNC — the worlds drifted apart. reconnect and try again.'); }
}

// ── screens — connect screens, net-wait badge, panel(), the death screen ──
/* the connect screens (HOST / JOIN) — drawn instead of the intro while netUi is set */
function drawNetScreen() {
  const RM = api.reduceMotion;
  const ih = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  ctx.clearRect(0, 0, GW, GH);
  ctx.save();
  let g = ctx.createLinearGradient(0, 0, 0, GH);
  g.addColorStop(0, '#04060c'); g.addColorStop(1, '#0b1220');
  ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);
  for (let i = 0; i < 40; i++) {
    const sx = ih(i) * GW, sy = ih(i + 97) * GH * 0.8 + 8;
    const tw = RM ? 0.5 : 0.35 + 0.28 * Math.sin(frame * 0.045 + i * 1.7);
    ctx.fillStyle = 'rgba(215,230,255,' + Math.max(0.12, tw).toFixed(2) + ')';
    ctx.fillRect(sx, sy, i % 7 === 0 ? 2 : 1.4, i % 7 === 0 ? 2 : 1.4);
  }
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const cy = GH / 2;
  ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
  ctx.fillText(netUi.mode === 'host' ? '🌐 HOSTING A GAME' : '🌐 JOINING A GAME', GW / 2, cy - 110);
  const dots = RM ? '…' : '.'.repeat(1 + (Math.floor(frame / 20) % 3));
  const sub = (t, y, col) => { ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = col || '#9fb0c0'; ctx.fillText(t, GW / 2, y); };
  if (netUi.phase === 'creating') {
    sub('creating a room' + dots, cy - 20);
  } else if (netUi.phase === 'waiting') {
    sub('your room code — tell your friend:', cy - 58);
    ctx.font = 'bold 54px "Courier New",monospace'; ctx.fillStyle = '#ffd24d';
    ctx.shadowColor = '#ffb300'; ctx.shadowBlur = RM ? 12 : 10 + 5 * Math.sin(frame * 0.06);
    ctx.fillText(netUi.code.split('').join(' '), GW / 2, cy);
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    if (netUi.copiedT > 0) {
      netUi.copiedT--;
      sub('✓ copied to the clipboard', cy + 42, '#caffa0');
    } else {
      sub('C — copy the code', cy + 42, '#ffe9ad');
    }
    sub('waiting for a challenger' + dots + '   (the room lives ~5 minutes)', cy + 64);
  } else if (netUi.phase === 'code') {
    sub('type the room code your friend gave you:', cy - 58);
    const bw = 44, gap = 10, x0 = GW / 2 - (bw * 5 + gap * 4) / 2;
    for (let i = 0; i < 5; i++) {
      const x = x0 + i * (bw + gap);
      ctx.fillStyle = 'rgba(10,16,24,0.85)'; ctx.fillRect(x, cy - 34, bw, 52);
      ctx.strokeStyle = i === netUi.input.length ? '#7fd8ff' : '#333d48';
      ctx.lineWidth = i === netUi.input.length ? 2.5 : 1.5;
      ctx.strokeRect(x, cy - 34, bw, 52);
      if (netUi.input[i]) {
        ctx.font = 'bold 34px "Courier New",monospace'; ctx.fillStyle = '#ffd24d';
        ctx.fillText(netUi.input[i], x + bw / 2, cy + 6);
      } else if (i === netUi.input.length && (RM || Math.floor(frame / 24) % 2)) {
        ctx.font = 'bold 34px "Courier New",monospace'; ctx.fillStyle = '#7fd8ff';
        ctx.fillText('▍', x + bw / 2, cy + 6);
      }
    }
    sub(netUi.input.length === 5 ? 'ENTER — connect' : 'type it, or paste it (⌘/Ctrl+V)', cy + 46, netUi.input.length === 5 ? '#caffa0' : '#9fb0c0');
    if (netUi.err) sub(netUi.err, cy + 72, '#ff8a80');
  } else if (netUi.phase === 'connecting') {
    sub('connecting the two of you' + dots, cy - 20);
    sub('(a direct link — the horde travels peer to peer)', cy + 6, '#69788a');
  } else if (netUi.phase === 'handshake') {
    sub('connected! agreeing on a world' + dots, cy - 20, '#caffa0');
  } else if (netUi.phase === 'err') {
    sub(netUi.err || 'something went wrong', cy - 20, '#ff8a80');
    ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
    ctx.fillText('Z — try again', GW / 2, cy + 24);
  } else if (netUi.phase === 'lobby' || netUi.phase === 'starting') {
    // ── the READY LOBBY: the whole war band side by side (2–4 seats). Everyone
    // picks freely; the run starts only when EVERY seat confirms. ──
    const starting = netUi.phase === 'starting';
    const mySeatIdx = netIsHost ? 0 : Math.max(1, netSeat);
    const seats = [];
    const raw = netUi.seats && netUi.seats.length ? netUi.seats : [];
    for (let i = 0; i < Math.max(raw.length, mySeatIdx + 1); i++) {
      seats.push(raw[i] ? { c: raw[i].c | 0, r: !!raw[i].r } : { c: 0, r: false });
    }
    // my own live pick shows immediately (the host echo can lag a beat)
    seats[mySeatIdx] = { c: classSel, r: !!netUi.myReady };
    // the WYRM & RIDER pair binds seat 1 to the saddle
    const paired = CLASSES[clamp(seats[0].c, 0, CLASSES.length - 1)] === 'wyrm';
    if (paired && seats.length > 1) seats[1] = { c: PAIR_RIDER, r: seats[1].r };
    sub(starting ? 'the whole band is ready — forging a shared world' + dots
                 : 'the fight begins when EVERY fighter readies up', cy - 84,
        starting ? '#caffa0' : '#9fb0c0');
    if (!starting && seats.length < NET_MAX_SEATS) {
      sub('room ' + (netUi.code || netRoomCode) + ' — up to four can ride; latecomers use the same code', cy - 64, '#ffd24d');
    }
    const py = cy + 2;
    const n = seats.length;
    const gap = n > 1 ? Math.min(180, (GW - 160) / (n - 1)) : 0;
    for (let i = 0; i < n; i++) {
      const x = GW / 2 + (i - (n - 1) / 2) * gap;
      const self = i === mySeatIdx;
      drawClassPreview(x, py, CLASSES[clamp(seats[i].c, 0, CLASSES.length - 1)],
                       SEAT_COLS[i] || 'white', self && !starting,
                       'P' + (i + 1) + (self ? ' · YOU' : ''));
      ctx.textAlign = 'center';
      ctx.font = 'bold 13px Tahoma,Arial';
      ctx.fillStyle = seats[i].r ? '#7CFC8A' : '#8494a4';
      ctx.fillText(seats[i].r ? '✓ READY' : 'choosing…', x, py + 54);
    }
    // your class row — every option visible (bound to the saddle when the host
    // rides the wyrm and you are seat 1: your pick is the pair's)
    if (!starting && paired && mySeatIdx === 1) {
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffab91';
      ctx.fillText('🐲 the host chose the WYRM & RIDER — you take the saddle', GW / 2, py + 92);
      ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
      ctx.fillText('your keys AIM the lance · E breathes fire from the heat your wyrm earns', GW / 2, py + 110);
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
      ctx.fillText('Z / ENTER — ' + (netUi.myReady ? 'un-ready' : 'READY UP'), GW / 2, py + 132);
    } else if (!starting) {
      const clsCol = { melee: '#ffd24d', ranged: '#9ccc65', caster: '#ce93d8', necro: NECRO_COL, dragoon: DRAGOON_COL, wyrm: DRAGOON_COL };
      const list = netIsHost ? [0, 1, 2, 3, 4, PAIR_WYRM] : [0, 1, 2, 3, 4];
      const nn = list.length, gap2 = 10, chh = 24;
      const cw2 = Math.min(104, Math.floor((GW - 60 - gap2 * (nn - 1)) / nn));
      const x0 = GW / 2 - (cw2 * nn + gap2 * (nn - 1)) / 2;
      for (let i = 0; i < nn; i++) {
        const ci = list[i];
        const sel = ci === classSel, col = clsCol[CLASSES[ci]];
        roundRectPath(x0 + i * (cw2 + gap2), py + 76, cw2, chh, chh / 2);
        if (sel) {
          ctx.shadowColor = col; ctx.shadowBlur = RM ? 10 : 8 + 4 * Math.sin(frame * 0.09);
          ctx.fillStyle = col; ctx.fill(); ctx.shadowBlur = 0;
          ctx.fillStyle = '#10141a';
        } else {
          ctx.strokeStyle = '#4b5a6a'; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.fillStyle = '#93a3b3';
        }
        ctx.font = (sel ? 'bold ' : '') + '12px Tahoma,Arial';
        ctx.fillText(CLASS_ICON[CLASSES[ci]] + ' ' + CLASSES[ci].toUpperCase(),
                     x0 + i * (cw2 + gap2) + cw2 / 2, py + 76 + chh / 2 + 4.5);
      }
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffe9ad';
      ctx.fillText('◀ ▶ — your hero   ·   Z / ENTER — ' + (netUi.myReady ? 'un-ready' : 'READY UP'),
                   GW / 2, py + 128);
    }
    ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#69788a';
    ctx.fillText('online play is score-free — nothing is saved · Q — leave', GW / 2, GH - 28);
    ctx.restore(); ctx.textAlign = 'left';
    return;
  }
  // your hero, right where you can still change it — the pick rides the handshake
  const classLocked = netUi.phase === 'connecting' || netUi.phase === 'handshake';
  const pvy = GH - 118;
  drawClassPreview(GW / 2, pvy, CLASSES[classSel], 'white', !classLocked);
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = classLocked ? '#9fb0c0' : '#ffe9ad';
  ctx.fillText((classLocked ? 'your class:  ' : '◀ ▶  your class:  ') +
               CLASS_ICON[CLASSES[classSel]] + ' ' + CLASSES[classSel].toUpperCase(), GW / 2, pvy + 34);
  ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#69788a';
  ctx.fillText('online co-op is score-free — nothing is saved · ' +
               (netUi.phase === 'code' ? 'Backspace on an empty code — back' : 'Q — back'), GW / 2, GH - 28);
  ctx.restore(); ctx.textAlign = 'left';
}
// a small "waiting on the other player" badge, drawn by frameStep while the
// lockstep gate is blocked (render-only — never touches the sim)
function drawNetWait() {
  ctx.save();
  ctx.textAlign = 'center';
  const w = 300, h = 44, x = GW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(6,10,16,0.85)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
  ctx.fillText('⏳ waiting for the other player…', GW / 2, y + 18);
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('the link is alive — they may be lagging or tabbed away · Q leaves', GW / 2, y + 34);
  ctx.restore(); ctx.textAlign = 'left';
}

// the mid-run reconnect banner (netRecon set): the run is held frozen while the
// transport re-signals — drawn over the last frame from frameStep, render-only
function drawNetRecon() {
  const rc = netReconActive();
  if (!rc) return;
  const seat = netReconSeat();
  const secs = Math.max(0, Math.floor((performance.now() - rc.t0) / 1000));
  const left = Math.max(0, Math.floor(NET_RECON_MAX_MS / 1000) - secs);
  const clock = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  ctx.save();
  ctx.textAlign = 'center';
  const w = 420, h = 58, x = GW / 2 - w / 2, y = 14;
  ctx.fillStyle = 'rgba(18,6,8,0.9)'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#ff8a80'; ctx.lineWidth = 1.5; ctx.strokeRect(x, y, w, h);
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ff8a80';
  ctx.fillText(netRecon ? '🔌 CONNECTION LOST — RECONNECTING…' : '🔌 PLAYER ' + (seat + 1) + ' DROPPED — RE-SIGNALING…', GW / 2, y + 20);
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('attempt ' + rc.attempt + ' — the run is held · gives up in ' + clock + ' · Q leaves now', GW / 2, y + 40);
  ctx.restore(); ctx.textAlign = 'left';
}

/* ── PAUSE & SETTINGS (the shell) ──
   Solo/couch runs truly pause (toggles cross the recorder as opcode 13, so a
   replay holds the same beats); online it is an overlay over the live sim.
   Every option is PRESENTATION ONLY — the iron rule from reduceMotion: options
   change what you see, never what the sim does. */
function drawShellMenu() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.72)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const y0 = Math.round(GH * 0.24);
  ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.fillText(netplay ? 'SETTINGS' : 'PAUSED', GW / 2, y0);
  ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(netplay ? 'the war band fights on — settings are yours alone' : 'the horde waits', GW / 2, y0 + 22);
  ctx.shadowBlur = 0;
  const rows = [
    ['screen shake', sfOpts.shake === 0 ? 'off' : sfOpts.shake < 1 ? 'half' : 'full'],
    ['camera kicks', sfOpts.kick > 0 ? 'on' : 'off'],
    ['impact flashes', sfOpts.flash > 0 ? 'full' : 'reduced'],
    ['high-contrast elites', sfOpts.hiVis ? 'on' : 'off'],
  ];
  for (let i = 0; i < rows.length; i++) {
    const hot = i === shellSel;
    const y = y0 + 60 + i * 30;
    ctx.font = (hot ? 'bold ' : '') + '14px Tahoma,Arial';
    ctx.fillStyle = hot ? '#ffe9ad' : '#9aa3a8'; ctx.textAlign = 'right';
    ctx.fillText(rows[i][0], GW / 2 - 16, y);
    ctx.fillStyle = hot ? '#7fd8ff' : '#77828c'; ctx.textAlign = 'left';
    ctx.fillText((hot ? '◀ ' : '') + rows[i][1] + (hot ? ' ▶' : ''), GW / 2 + 16, y);
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('↑ ↓ — choose   ·   ◀ ▶ — change   ·   P — ' + (netplay ? 'close' : 'resume'), GW / 2, y0 + 60 + rows.length * 30 + 16);
  ctx.restore(); ctx.textAlign = 'left';
}

/* ── the LIVING CAMERA (see the cam state note in 02-state) ── */
function camKick(dx, dy, mag) {
  if (api.reduceMotion) return;
  const d = Math.hypot(dx, dy) || 1;
  cam.kx += (dx / d) * mag * sfOpts.kick;
  cam.ky += (dy / d) * mag * sfOpts.kick;
}
// one camera step per loop call (= per sim tick — the cadence tests depend on it)
function camUpdate() {
  if (api.reduceMotion) {
    cam.x = cam.y = cam.kx = cam.ky = 0; cam.zoom = 1; cam.pulse = 0;
    cam.prevBreather = breatherT;
    return;
  }
  // drift toward the party's center of mass — only on the open field (the
  // battlefield draws with an overscan bleed for exactly this; the set-piece
  // rooms are framed compositions and hold still)
  const roomBound = swActive || jojoActive || ianActive;
  let tx = 0, ty = 0;
  if (!roomBound) {
    const hs = heroesLive();
    if (hs.length) {
      let ax = 0, ay = 0;
      for (const h of hs) { ax += h.x; ay += h.y; }
      tx = clamp((ax / hs.length - GW / 2) * 0.12, -14, 14);
      ty = clamp((ay / hs.length - GH / 2) * 0.12, -10, 10);
    }
  }
  cam.x += (tx - cam.x) * 0.05;
  cam.y += (ty - cam.y) * 0.05;
  // zoom: boss cards punch in; the wave's final kill breathes in and settles
  if (breatherT > 0 && cam.prevBreather <= 0) cam.pulse = 44;
  cam.prevBreather = breatherT;
  if (cam.pulse > 0) cam.pulse--;
  const zt = bossIntro ? 1.08 : cam.pulse > 0 ? 1 + 0.09 * (cam.pulse / 44) : 1;
  cam.zoom += (zt - cam.zoom) * 0.08;
  // kicks decay fast
  cam.kx *= 0.8; cam.ky *= 0.8;
}
function camApply() {
  if (api.reduceMotion) return;
  ctx.translate(GW / 2, GH / 2);
  ctx.scale(cam.zoom, cam.zoom);
  ctx.translate(-GW / 2, -GH / 2);
  ctx.translate(-cam.x + cam.kx, -cam.y + cam.ky);
}

/* ── the DEATH KILL CAM ──
   The last seconds of the run replay in slow motion off the ghost tape, the
   camera easing in tight on the fallen hero, letterboxed under a closing red
   wash, ending on the title. Strictly render-only: the sim (and netplay's
   lockstep ticks) keep running underneath; advancement happens once per loop
   call so the deterministic draw-stream and 60/120Hz cadence tests hold. */
function drawKillCam() {
  const kc = killCam;
  const N = kc.tape.length;
  const idx = Math.min(N - 1, Math.floor(kc.i));
  const snap = kc.tape[idx];
  const atEnd = idx >= N - 1;
  const p = Math.min(1, kc.t / 50);
  const ease = 1 - (1 - p) * (1 - p);
  const zoom = 1.12 + ease * 0.68;
  const fx = clamp(kc.fx, GW * 0.22, GW * 0.78);
  const fy = clamp(kc.fy, GH * 0.26, GH * 0.74);
  ctx.save();
  ctx.translate(GW / 2, GH / 2);
  ctx.scale(zoom, zoom);
  ctx.translate(-fx, -fy + ease * 8);
  if (!swActive && !jojoActive && !ianActive) drawBattlefield();
  else { ctx.fillStyle = '#04060a'; ctx.fillRect(-GW, -GH, GW * 3, GH * 3); }
  for (const e of snap.enemies) drawEnemy(e);
  for (const h of snap.heroes) drawHero(h);
  ctx.restore();
  kc.t++;
  if (!atEnd) kc.i += CAM_SPEED;
  else kc.hold++;
  // screen-space drama: letterbox bars + a red wash leaning in + the title
  const bar = Math.min(GH * 0.11, kc.t * 2.5);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, GW, bar); ctx.fillRect(0, GH - bar, GW, bar);
  const rv = ctx.createRadialGradient(GW / 2, GH / 2, Math.min(GW, GH) * 0.2, GW / 2, GH / 2, Math.max(GW, GH) * 0.7);
  rv.addColorStop(0, 'rgba(120,8,8,0)');
  rv.addColorStop(1, 'rgba(120,8,8,' + (0.12 + ease * 0.16).toFixed(3) + ')');
  ctx.fillStyle = rv; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  if (atEnd) {
    ctx.globalAlpha = Math.min(1, kc.hold / 24);
    ctx.font = 'bold 34px Tahoma,Arial';
    ctx.strokeStyle = '#2a0505'; ctx.lineWidth = 6;
    ctx.strokeText('THOU ART SLAIN', GW / 2, GH / 2 - 8);
    ctx.fillStyle = '#ff6e6e';
    ctx.fillText('THOU ART SLAIN', GW / 2, GH / 2 - 8);
    ctx.globalAlpha = 1;
  }
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = 'rgba(200,210,220,0.7)';
  ctx.fillText('the final moments · any key skips', GW / 2, GH - bar - 10);
  ctx.textAlign = 'left';
  if (kc.hold > 64) killCam = null;   // ...and the death screen takes over
}

function panel(lines) {
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  let y = GH / 2 - (lines.length - 1) * 16;
  for (const [text, font, color] of lines) {
    ctx.font = font; ctx.fillStyle = color;
    ctx.fillText(text, GW / 2, y);
    y += 34;
  }
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

/* the game-over screen: epitaph + the online "hall of legends" leaderboard.
   Off when the worker's unreachable (lbState 'off') → just the local best. */
/* ── the RESULTS CEREMONY ──
   Before the boards: the run gets a reckoning. Lines land one per beat and the
   score counts up — all deadT-driven (deterministic; any key fast-forwards
   deadT past it, see onKey). Replay watchers skip straight to their ending. */
function drawResults() {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.66)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
  const y0 = Math.round(GH * 0.2);
  ctx.font = 'bold 30px Tahoma,Arial'; ctx.fillStyle = '#ff6e6e';
  ctx.fillText('THE RECKONING', GW / 2, y0);
  // the fallen, ranked — the horde knows who did the work
  const byN = Object.entries(killsByType).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const row = (i, label, value, col) => {
    const at = 56 + i * 22;                       // each line lands on its own beat
    if (deadT < at) return;
    const a = Math.min(1, (deadT - at) / 12);
    ctx.globalAlpha = a;
    ctx.font = '14px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0'; ctx.textAlign = 'right';
    ctx.fillText(label, GW / 2 - 14, y0 + 44 + i * 27);
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = col || '#e8eef4'; ctx.textAlign = 'left';
    ctx.fillText(value, GW / 2 + 14, y0 + 44 + i * 27);
    ctx.globalAlpha = 1;
  };
  let i = 0;
  row(i++, 'waves survived', String(wave) + (hardMode ? '  ☠' : '') + (endless ? '  ∞' : ''), '#ffd24d');
  row(i++, 'the fallen', String(kills), '#ff8a80');
  if (byN.length) row(i++, 'mostly', byN.map(([t, n]) => t + ' ×' + n).join(' · '), '#c8d2da');
  row(i++, 'tokens banked', String(tokens), '#80deea');
  // the score counts up over the last stretch of the ceremony
  const sAt = 56 + i * 22;
  if (deadT >= sAt) {
    const sp = Math.min(1, (deadT - sAt) / 40);
    const shown = Math.round(score * (1 - (1 - sp) * (1 - sp)));
    ctx.font = 'bold 26px Tahoma,Arial'; ctx.fillStyle = '#ffd24d'; ctx.textAlign = 'center';
    ctx.fillText(shown.toLocaleString(), GW / 2, y0 + 60 + i * 27 + 14);
    if (sp >= 1 && newBest) {
      ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7CFC8A';
      ctx.fillText('★ A NEW LEGEND — your best ★', GW / 2, y0 + 88 + i * 27);
    }
  }
  ctx.font = '11px Tahoma,Arial'; ctx.fillStyle = 'rgba(200,210,220,0.6)'; ctx.textAlign = 'center';
  ctx.fillText('any key — the hall of legends awaits', GW / 2, GH - 44);
  ctx.restore(); ctx.textAlign = 'left';
}
function drawDeathScreen() {
  if (!replayMode && deadT < 178) { drawResults(); return; }
  ctx.fillStyle = 'rgba(0,0,0,0.62)';
  ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;

  const cx = GW / 2;
  const board = (lbState === 'view' || lbState === 'done' || lbState === 'submitting');
  // two columns when today's board exists (or this WAS a daily run): all-time + daily
  const cols = [{ title: 'ALL TIME', rows: lbScores || [], hot: !dailyRun }];
  if (lbDaily !== null || dailyRun) cols.push({ title: '☀ TODAY · ' + dailyDayPretty(), rows: lbDaily || [], hot: dailyRun });
  const rowsN = Math.max(1, ...cols.map((c) => c.rows.length));
  // height-aware top so a full 10-row board stays centred and on-screen
  const blockH = board ? 172 + rowsN * 18 : lbState === 'enter' ? 230 : 150;
  let y = Math.max(46, GH / 2 - blockH / 2);

  ctx.font = 'bold 36px Tahoma,Arial'; ctx.fillStyle = 'white';
  ctx.fillText('THOU ART SLAIN', cx, y); y += 32;
  ctx.font = '18px Tahoma,Arial'; ctx.fillStyle = newBest ? '#ffd24d' : 'white';
  ctx.fillText('SCORE ' + score + (newBest ? '   ★ NEW BEST ★' : '   ·   BEST ' + best), cx, y); y += 25;
  ctx.font = '14px Tahoma,Arial'; ctx.fillStyle = '#ccc';
  ctx.fillText('you survived ' + wave + (wave === 1 ? ' wave' : ' waves') +
               '  ·  slew ' + kills + (kills === 1 ? ' foe' : ' foes'), cx, y); y += 20;
  if (dailyRun) {
    ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = '#ffb300';
    ctx.fillText('☀ daily challenge · ' + dailyDayPretty(), cx, y); y += 20;
  }
  y += 10;

  if (lbState === 'off' || lbState === 'error') {
    if (replayMode) {
      ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
      ctx.fillText('▶ so ends the legend of ' + (replay ? replay.name : '…'), cx, y); y += 24;
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
      ctx.fillText('Q to return', cx, y);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
      return;
    }
    if (netplay) {
      ctx.font = 'bold 14px Tahoma,Arial'; ctx.fillStyle = '#7fd8ff';
      ctx.fillText('🌐 you fell together — online runs are score-free', cx, y); y += 24;
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
      ctx.fillText(netIsHost ? 'R — rematch (same team, a new world)  ·  Q — leave' : 'the host presses R to rematch  ·  Q — leave', cx, y);
      ctx.shadowBlur = 0; ctx.textAlign = 'left';
      return;
    }
    if (cheated) {
      ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#8a949a';
      ctx.fillText('cheats were used — this run is unranked', cx, y); y += 22;
    }
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
    ctx.fillText('press R to rise again', cx, y);
    ctx.shadowBlur = 0; ctx.textAlign = 'left';
    return;
  }

  ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.fillText('— THE HALL OF LEGENDS —', cx, y); y += 28;

  if (lbState === 'loading') {
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#bbb';
    ctx.fillText('ranking you among the fallen…', cx, y);
  } else if (lbState === 'enter') {
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.fillStyle = '#caffa0';
    ctx.fillText(dailyRun ? "A LEGEND OF THIS DAY IS BORN" : 'A NEW LEGEND IS BORN', cx, y); y += 30;
    const caret = (Math.floor(deadT / 16) % 2) ? '▍' : ' ';   // deadT, not frame (frozen while dead)
    ctx.font = 'bold 24px "Courier New",monospace'; ctx.fillStyle = '#fff';
    ctx.fillText((lbName || '') + caret, cx, y); y += 26;
    ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#8a949a';
    ctx.fillText('type your name  ·  ENTER to enshrine it' + (dailyRun ? "  ·  today's board" : ''), cx, y);
  } else {
    // the boards, side by side (single centred column when there's no daily board).
    // the ▸ marker highlights the player's row on the board they submitted to.
    const colX = cols.length === 1 ? [cx] : [cx - 168, cx + 168];
    const topY = y;
    let maxY = y;
    cols.forEach((col, ci) => {
      let yy = topY;
      ctx.font = 'bold 13px Tahoma,Arial'; ctx.fillStyle = col.hot ? '#ffd24d' : '#9aa3a8';
      ctx.fillText(col.title, colX[ci], yy); yy += 22;
      ctx.font = '13px "Courier New",monospace';
      if (col.rows.length === 0) {
        ctx.fillStyle = '#bbb';
        ctx.fillText(col.hot ? 'no legends yet — be the first' : 'no legends yet', colX[ci], yy); yy += 18;
      }
      for (let i = 0; i < col.rows.length; i++) {
        const e = col.rows[i];
        const isMe = col.hot && i === lbRank;
        // rows with a stored replay get a ▶; the open watch picker highlights its pick
        const wi = watchSel ? watchSel.list.findIndex((w) => w.entry === e) : -1;
        const onW = wi !== -1 && wi === watchSel.idx;
        ctx.fillStyle = onW ? '#fff' : isMe ? '#ffd24d' : i < 3 ? '#e8e8e8' : '#9aa3a8';
        const rk = String(i + 1).padStart(2, ' ');
        const nm = String(e.name || 'AAA').slice(0, 10).padEnd(10, ' ');
        const sc = String(e.score).padStart(7, ' ');
        ctx.fillText((onW ? '» ' : isMe ? '▸ ' : '  ') + rk + ' ' + nm + ' ' + sc +
                     (e.rp ? ' ▶' : '  ') + (isMe ? '◂' : ''), colX[ci], yy);
        yy += 18;
      }
      maxY = Math.max(maxY, yy);
    });
    y = maxY + 8;
    ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = watchSel ? '#ffd24d' : '#ccc';
    ctx.fillText(
      watchSel ? '↑ ↓ choose a legend  ·  ENTER to watch  ·  Q closes'
      : lbState === 'submitting' ? 'recording your legend…'
      : watchableEntries().length ? 'press R to rise again  ·  W to watch a ▶ legend'
      : 'press R to rise again', cx, y);
  }
  ctx.shadowBlur = 0; ctx.textAlign = 'left';
}

// ── spawn — spawning: edgePoint, rollType, rollElite, makeEnemy ──
/* ── spawning ── */
function edgePoint() {
  for (let i = 0; i < 8; i++) {
    const side = Math.floor(rnd() * 4);
    let x, y;
    if      (side === 0) { x = rnd() * GW; y = 30; }
    else if (side === 1) { x = GW - 30; y = rnd() * GH; }
    else if (side === 2) { x = rnd() * GW; y = GH - 30; }
    else                 { x = 30; y = rnd() * GH; }
    if (Math.hypot(x - player.x, y - player.y) > KEEP_OUT * 2) return { x, y };
  }
  return { x: 30, y: 30 };
}

function rollType() {
  // the goblin SHAMAN (endless wave 8+ / hard mode wave 4+): a rare support piece —
  // it never attacks, it makes everything else worse (see the shaman branch +
  // shamanHaste). At most two afield (counting pending warns), so it stays a
  // priority target, not a wall.
  if ((endless || hardMode) && wave >= (hardMode ? 4 : 8) &&
      enemies.filter(s => s.type === 'shaman' && !s.dead).length +
      warns.filter(w => w.type === 'shaman').length < 2 &&
      rnd() < 0.08) return 'shaman';
  // the goblin BOMBARDIER (endless wave 10+ / hard mode wave 6+): long-range area
  // denial — its kegs make the floor itself unsafe (and wound the horde too: bait
  // the shot). ≤2 afield.
  if ((endless || hardMode) && wave >= (hardMode ? 6 : 10) &&
      enemies.filter(s => s.type === 'bomber' && !s.dead).length +
      warns.filter(w => w.type === 'bomber').length < 2 &&
      rnd() < 0.07) return 'bomber';
  const r = rnd();
  // hard mode: every type phases in one wave early (wolves join the very first band)
  if (wave >= (hardMode ? 3 : 4) && r < 0.15) return 'troll';
  if (wave >= (hardMode ? 2 : 3) && r < 0.35) return 'archer';
  if (wave >= (hardMode ? 1 : 2) && r < 0.6) return 'wolf';
  return 'goblin';
}

// endless-only ELITE variants — one harder cousin per base sprite, phased in by
// depth (the roll's odds grow with wave). Returns a TIER: 0 none · 1 elite
// (double points) · 2 DREAD (rare, wave 9+, quadruple points).
//   tier 1: shield-bearer goblin (blocks one hit) · frost wolf (chills on a close
//           pass) · volley archer (three-arrow fan) · bull troll (5 HP, enrages)
//   tier 2: goblin warlord (tower shield blocks two, faster) · dire frost wolf
//           (the chill is a 90px AURA) · deadeye (five faster arrows) · dread
//           troll (8 HP, roars into a harder enrage)
function rollElite() {
  if (!endless && !hardMode) return 0;
  // hard mode runs the elite math five waves deep: elites stalk from wave 1
  // (gently), and the dread tier arrives by wave 4 instead of 9
  const w = wave + (hardMode ? 5 : 0);
  if (rnd() >= Math.min(0.5, 0.06 * (w - 5))) return 0;
  // a rolled elite may ascend to the dread tier — rarer, and only in deep waves
  return w >= 9 && rnd() < Math.min(0.25, 0.04 * (w - 8)) ? 2 : 1;
}

function makeEnemy(type, x, y, elite) {
  const e = { type, x, y, vx: 0, vy: 0, phase: rnd() * Math.PI * 2,
              grz: 0, stun: 0 };
  if (type === 'goblin') { e.spd = Math.min(2.6, 1.35 + wave * 0.15); e.kr = 14; }
  if (type === 'wolf')   { e.spd = 1.15; e.kr = 13; e.mode = 'stalk'; e.st = 70; }
  if (type === 'archer') { e.spd = 1.5; e.kr = 12; e.mode = 'approach'; e.st = 40; }
  if (type === 'troll')  { e.spd = Math.min(1.5, 0.8 + wave * 0.06); e.kr = 26; e.hp = 3; }
  // MARKED (bane): the open-field horde walks faster — the scripted bosses keep their tuned pace
  if (type === 'goblin' || type === 'wolf' || type === 'archer' || type === 'troll') e.spd *= bn.foeSpd;
  if (type === 'shaman') {
    // endless support: harmless to touch, 2 HP — it rides with the warband,
    // shrieking the pack into a frenzy and blinking clear of hunters
    e.spd = 1.35; e.kr = 0; e.hp = 2; e.st = 90;
    e.blinkCd = 0; e.frenzyT = 0; e.frenzyCd = 160;
    if (!shamanSeen) {
      shamanSeen = true;
      banner = 'a goblin SHAMAN drives the warband'; bannerSub = 'silence it, or fight a frenzied horde'; bannerT = 130;
    }
  }
  if (type === 'bomber') {
    // endless artillery: harmless to touch, shy, 2 HP — but its kegs shell the floor
    e.spd = 1.2; e.kr = 0; e.hp = 2; e.mode = 'roam'; e.st = 120;
    if (!bomberSeen) {
      bomberSeen = true;
      banner = 'a goblin BOMBARDIER wheels its kegs in'; bannerSub = 'the red ring is the landing zone — its own horde is not spared'; bannerT = 140;
    }
  }
  // endless elites (see rollElite): tinted, one behavior tweak per tier, 2×/4× points
  if (elite && (type === 'goblin' || type === 'wolf' || type === 'archer' || type === 'troll')) {
    e.elite = elite;                                // 1 = elite · 2 = dread
    if (type === 'goblin') { e.hp = elite === 2 ? 3 : 2; if (elite === 2) e.spd *= 1.25; }  // buckler eats one blow; the warlord's tower shield eats two
    if (type === 'troll') e.hp = elite === 2 ? 8 : 5;   // bull troll / dread troll — both enrage low
    if (elite === 2 && !dreadSeen) {
      dreadSeen = true;
      banner = 'a DREAD elite takes the field'; bannerSub = 'the endless dark has champions of its own'; bannerT = 140;
    } else if (!eliteSeen) {
      eliteSeen = true;
      banner = 'the endless dark breeds ELITES'; bannerSub = 'tinted foes fight back harder'; bannerT = 130;
    }
  }
  if (type === 'ogre') {
    // a horde mini-boss: lumbers, telegraphs, then bull-rushes straight across the field
    const bandO = partySize() - 1;   // the ogre toughens with the party
    e.spd = 1.25; e.kr = 30; e.hp = 8 + bandO * 3; e.maxhp = e.hp; e.mode = 'stalk'; e.st = 80; e.lx = 0; e.ly = 0;
  }
  if (type === 'wraith') {
    // the Nine harden with the party (2P/3P take 3 blows, a full band 4)
    e.spd = 2.6; e.kr = 14; e.hp = 2 + Math.ceil((partySize() - 1) / 2); e.mode = 'circle';
    // keep the bearing it spawned at so the ring forms without crossing paths
    e.slot = Math.atan2(y - player.y, x - player.x) - frame * 0.004;
    e.ring = Math.hypot(x - player.x, y - player.y) || 300;
  }
  if (type === 'witchking') {
    // rises mounted on a fell beast; a few hits down the beast, then he fights on foot
    const bandK = partySize() - 1;   // the king endures more blades
    e.spd = 2.88; e.kr = 24; e.mountMax = 4 + bandK; e.footMax = 6 + bandK * 2; e.hp = e.mountMax;
    e.mounted = true; e.mode = 'hover'; e.st = 80; e.flailAng = 0;
  }
  if (type === 'trooper') {
    // marches into formation, then fires; harmless to touch — only the blasters kill
    e.kr = 0; e.hp = 1; e.mode = 'march'; e.fireT = 0;
  }
  if (type === 'vader') {
    // a proper duel: advances, telegraphs, melee slashes AND Force powers; escalates at half health
    const bandV = partySize() - 1;
    e.spd = 1.5; e.kr = 20; e.hp = 10 + bandV * 3; e.maxhp = e.hp;
    e.mode = 'advance'; e.st = 50; e.slashAng = 0;
    e.phase2 = false; e.power = null; e.combo = false; e.disarmed = false;
    e.intro = 50;   // a brief menacing entrance: holds position, harmless to touch — no instant spawn-kill
  }
  if (type === 'sidious') {
    // Clone Wars Sidious: fast & acrobatic, twin red sabers, a spin attack and Force lightning;
    // at half HP he stows the sabers and turns to pure lightning (e.phase2)
    const bandS = partySize() - 1;
    e.spd = 2.7; e.kr = 17; e.hp = 14 + bandS * 4; e.maxhp = e.hp;
    e.mode = 'enter'; e.st = 60; e.spinAng = 0; e.lit = 0; e.hop = 0;
    e.phase2 = false; e.castKind = 'bolt';
  }
  if (type === 'guard') {
    // Royal Guard: red robe + force pike. stalks, telegraphs, lunges. contact-lethal.
    e.spd = 1.55; e.kr = 14; e.hp = 2; e.mode = 'idle'; e.st = 50; e.pike = 0;
  }
  if (type === 'dio') {
    // DIO + The World: trolls you with stopped time, then knives / MUDA rushes / the road roller
    const bandD = partySize() - 1;
    e.spd = 1.95; e.kr = 17; e.hp = 16 + bandD * 4; e.maxhp = e.hp;   // a deliberate saunter — readable, not frantic
    e.mode = 'troll'; e.tstep = 0; e.tt = 0; e.st = 0; e.stand = 0; e.cape = 0; e.rollerDone = false;
  }
  if (type === 'ian') {
    // the creator: unarmed, harmless, never attacks — the fight is a choice, not a duel
    e.kr = 0; e.hp = 99; e.mode = 'idle'; e.phase = 0; e.crumble = 0; e.fade = 1;
  }
  return e;
}

// ── bosses — boss set-piece logic: Vader, Sidious (+finale), DIO/JoJo, Ian and the choice ──
/* ── Darth Vader: Force powers & phase logic ── */
function vaderTaunt(text, t) { banner = text; bannerSub = '— Darth Vader'; bannerT = t || 110; }
// pick the next action when Vader reaches the player: melee slash, or a Force power
function vaderNextAttack(e, d) {
  const r = rnd();
  if (e.disarmed) {                                  // no blade — telekinesis only, or stalk
    if (r < 0.6 && d < 160) startCast(e, 'push');
    else e.st = 22;
    return;
  }
  if (e.phase2 && r < 0.30 && bossTarget() === player)  startCast(e, 'choke');  // Force choke is P1-only (the struggle/escape is keyed to player)
  else if (r < (e.phase2 ? 0.52 : 0.34))   startCast(e, 'throw');
  else if (r < (e.phase2 ? 0.74 : 0.58))   startCast(e, 'push');
  else { e.mode = 'wind'; e.st = e.phase2 ? 18 : 26; }  // melee slash
}
function startCast(e, power) {
  e.mode = 'cast'; e.power = power; e.st = power === 'choke' ? 28 : 22;
  sfSfx.swing();
  sparks.push({ x: e.x, y: e.y - 42, t: 14, color: '#b39ddb',
                txt: power === 'throw' ? 'SABER THROW' : power === 'choke' ? 'FORCE CHOKE' : 'THE FORCE' });
}
// shove the focused hero away from Vader and lock their footing briefly so the push carries
function forcePush(e, mag) {
  const t = bossTarget();
  const ddx = t.x - e.x, ddy = t.y - e.y, dd = Math.hypot(ddx, ddy) || 1;
  t.vx = ddx / dd * 15 * mag; t.vy = ddy / dd * 15 * mag;
  t.stunT = Math.round(14 * mag); t.choke = 0;
  swFlash = Math.max(swFlash, 14);
  sfSfx.thud();
  sparks.push({ x: t.x, y: t.y - 24, t: 16, color: '#9ec8ff', txt: 'FORCE PUSH' });
}
// hurl the lightsaber: a spinning blade that crosses the room then homes back to Vader (boomerang)
function vaderThrow(e) {
  const t = bossTarget();
  const ang = Math.atan2(t.y - (e.y - 22), t.x - e.x), sp = 6.4;
  arrows.push({ x: e.x + Math.cos(ang) * 14, y: (e.y - 22) + Math.sin(ang) * 14,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                t: 400, kind: 'vsaber', range: 340, travelled: 0, returning: false, spin: 0 });
  sfSfx.lunge();
}
function startChoke(e) {
  player.choke = 90; player.chokeBreak = 0; player.vx = 0; player.vy = 0;
  vaderTaunt('You are beaten. It is useless to resist.', 120);
  sfSfx.lunge(); swFlash = Math.max(swFlash, 16);
}
function enterVaderPhase2(e) {
  e.phase2 = true; e.spd = 2.1;
  e.mode = 'recover'; e.st = 40; e.combo = false; e.power = null;
  forcePush(e, 1.35);                                // blow the player back to open the phase
  swFlash = 34; shake = Math.max(shake, 18); sfSfx.lunge();
  vaderTaunt('You are unwise to lower your defenses!', 160);
}

/* ── Darth Sidious: the Emperor — a reveal, twin sabers, Force lightning, two Royal Guards ── */
function bossSay(text, hold, gap) {           // queue a line of the Emperor's monologue
  dlg.push({ txt: text, sub: '— Darth Sidious', hold: hold || 110, gap: gap == null ? 78 : gap });
}
function sidiousCackle(e, kind) {
  sparks.push({ x: e.x, y: e.y - 48, t: 16, color: '#d0b3ff',
                txt: kind === 'lightning' ? 'UNLIMITED POWER!' : 'THE DARK SIDE' });
  sfSfx.swing();
}
function sidiousLightning(e) {
  ltnFlash = Math.max(ltnFlash, 16);
  shake = Math.max(shake, 10);
  sfSfx.zap();
}
// a leap target that circles the focused hero — keeps him orbiting, not blinking to corners
function sidiousFlank(e) {
  const t = bossTarget();
  const cur = Math.atan2(e.y - t.y, e.x - t.x);
  const ang = cur + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6);
  const rad = 155 + rnd() * 55;
  return { x: clamp(t.x + Math.cos(ang) * rad, 30, GW - 30),
           y: clamp(t.y + Math.sin(ang) * rad, 48, GH - 22) };
}
// begin a lightning windup — 'bolt' locks a straight corridor; 'sweep' rakes a wide arc across the player
function startSidiousCast(e, kind, lx, ly) {
  e.mode = 'cast'; e.castKind = kind; e.lastCast = kind;
  e.st = kind === 'sweep' ? 58 : 56; e.castDur = e.st;   // the rake telegraphs a touch longer
  if (kind === 'sweep') {
    const pa = Math.atan2(ly, lx);
    e.sweepDir = rnd() < 0.5 ? 1 : -1;
    e.sweepArc = 0.85; e.sweepCenterA = pa;            // narrower arc → a clear side to flee toward
    const startA = pa - e.sweepDir * e.sweepArc / 2;   // begin at one edge so the rake crosses the player
    e.lx = Math.cos(startA); e.ly = Math.sin(startA);
  } else {
    e.lx = lx; e.ly = ly;
  }
  sidiousCackle(e, 'lightning');
}
// half-health turn: the sabers go dark, and from here he is nothing but lightning
function enterSidiousPhase2(e) {
  e.phase2 = true; e.lit = 0; e.spd = 3.0;
  e.mode = 'recover'; e.st = 32;
  ltnFlash = Math.max(ltnFlash, 30); swFlash = Math.max(swFlash, 18); shake = Math.max(shake, 16);
  sfSfx.zap();
  knockback(e.x, e.y, 0, 7, 0);   // a repulse wave clears the guards back; harmless flourish
  banner = 'POWER! UNLIMITED POWER!'; bannerSub = '— Darth Sidious'; bannerT = 160;
  sparks.push({ x: e.x, y: e.y - 44, t: 18, color: '#c9a9ff', txt: 'the sabers go dark' });
}
/* ── death cutscene: Vader rises, hoists the electrocuting Emperor overhead, and carries him off ── */
function startSidiousFinale(e) {
  sidiousActive = false;
  enemies.forEach(g => { if (g.type === 'guard') g.dead = true; });   // the guards fall with him
  arrows = []; ltnBolts = []; bolts = [];
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 30, color: '#fff', txt: '...gone.' })); allies = []; }
  player.choke = 0; player.stunT = 0;
  const sx = clamp(e.x, 40, GW - 40), sy = clamp(e.y, 64, GH - 24);
  const exitDir = sx > GW / 2 ? 1 : -1;                              // carried off toward the nearer edge
  sidFinale = { phase: 'rise', t: 0, sx, sy, vx: sx, vy: sy, vrise: 0, lift: 0, faceDir: exitDir, exitDir };
  banner = 'NO... NOOOO!'; bannerSub = '— Darth Sidious'; bannerT = 130;
  ltnFlash = Math.max(ltnFlash, 26); swFlash = Math.max(swFlash, 14); shake = 18; sfSfx.zap();
}
function advanceSidiousFinale() {
  const f = sidFinale; f.t++;
  if (f.phase === 'rise') {                       // Vader pulls himself up from the deck beside the Emperor
    f.vrise = clamp(f.t / 96, 0, 1);
    if (f.t >= 110) { f.phase = 'lift'; f.t = 0; sfSfx.lunge(); }   // a beat once he's risen, then the grab
  } else if (f.phase === 'lift') {                // hoists him overhead as the lightning erupts
    f.lift = clamp(f.t / 72, 0, 1);
    if (f.t % 22 === 0) sfSfx.zap();
    if (f.t >= 78) { f.phase = 'hold'; f.t = 0; banner = 'the apprentice turns on his master'; bannerSub = ''; bannerT = 150; sfSfx.zap(); }
  } else if (f.phase === 'hold') {                // holds him aloft, the storm raging — the moment to watch
    f.lift = 1;
    if (f.t % 22 === 0) sfSfx.zap();
    if (f.t >= 120) { f.phase = 'carry'; f.t = 0; }
  } else {                                        // walks into the dark, the storm raging over them both
    f.vx += f.exitDir * 1.5; f.faceDir = f.exitDir;   // a slow, deliberate march
    if (f.t % 26 === 0) sfSfx.zap();
    if (f.exitDir > 0 ? f.vx > GW + 54 : f.vx < -54) { finishSidiousFinale(); return; }
  }
  if (f.phase !== 'rise' && f.t % 10 === 0) ltnFlash = Math.max(ltnFlash, 6);  // the void strobes violet
  if (!api.reduceMotion && f.t % 8 === 0) shake = Math.max(shake, 5);    // jolts from the shocks
}
function finishSidiousFinale() {
  sidFinale = null;
  swActive = false; sidiousActive = false; swState = ''; swStars = [];
  sidiousIntroT = 0; sidiousCue = 0; dlg = []; dlgT = 0;
  clearBlades(); saberPickup = null;
  arrows = []; ltnBolts = []; ltnFlash = 0; player.choke = 0; player.stunT = 0; swFlash = 0;
  banner = 'the Emperor is no more'; bannerSub = '+3000  ·  borne into the dark'; bannerT = 190;
  score += 3000; addMeter(50); shake = 16;
  grantBossToken();
  jojoCue = 150;                                 // ...but a stranger aura gathers in the dark
}

/* ── the JoJo interlude: DIO. he trolls you with stopped time, then the real fight ── */
function dioSay(text, hold, gap) { dlg.push({ txt: text, sub: '— DIO', hold: hold || 110, gap: gap == null ? 78 : gap }); }
function startDioStop(t) {
  dioStopT = t; dioStopFx = 12;
  sfSfx.zawarudo();
  sparks.push({ x: GW / 2, y: 50, t: 24, color: '#fff', txt: 'ZA WARUDO!' });
}
function dioKnife(x, y, vx, vy, scale) { return { x, y, vx, vy, t: 360, kind: 'knife', spin: rnd() * 6, scale: scale || 1 }; }
function startJojo() {
  jojoActive = true; jojoCue = 0;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  swActive = false; swState = ''; swStars = []; vaderActive = false; sidiousActive = false; sidFinale = null;
  stone = null; clearBlades(); saberPickup = null; armSaberAll(true);   // every hero keeps a lightsaber into the duel
  dioStopT = 0; roadRoller = null; ltnFlash = 0; dlg = []; dlgT = 0; playerStand = 0; freezeT = 0;
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 30, color: '#fff', txt: '...gone.' })); allies = []; }
  player.x = GW * 0.26; player.y = GH / 2; player.vx = 0; player.vy = 0; player.choke = 0; player.stunT = 0;
  jojoBg = [];   // drifting ゴ menacing glyphs
  for (let i = 0; i < 22; i++) jojoBg.push({ x: rnd() * GW, y: rnd() * GH, s: 14 + rnd() * 34, vy: -(0.08 + rnd() * 0.30), a: 0.05 + rnd() * 0.09 });
  enemies.push(makeEnemy('dio', GW * 0.78, GH / 2));
  banner = 'KONO DIO DA!'; bannerSub = '— DIO'; bannerT = 150;
  shake = 12; sfSfx.summon();
}
// the scripted troll intro — he stops time only to mess with you
function dioTroll(e) {
  e.tt++;
  const enter = (s) => e.tstep === s && e.tt === 1;
  const done = (len) => { if (e.tt >= len) { e.tstep++; e.tt = 0; } };
  const px = player.x;
  if (e.tstep === 0) {                                   // a long beat — the Stands rise and square off (intro card already boasted)
    done(140);
  } else if (e.tstep === 1) {                            // stop time, saunter into your face, stroll back
    if (enter(1)) { startDioStop(170); e.hx = e.x; e.hy = e.y; }
    if (dioStopT > 0) {
      const tx = px + (px < GW / 2 ? 30 : -30);
      e.x += (tx - e.x) * 0.07; e.y += (player.y - e.y) * 0.07;   // a slow, unhurried stroll
      if (dioStopT === 120) dioSay('oh? you were about to attack? how rude.', 340, 0);
    } else { e.x += (e.hx - e.x) * 0.09; e.y += (e.hy - e.y) * 0.09; }
    done(420);
  } else if (e.tstep === 2) {                            // the centrepiece: a knife at your throat that slowly wilts to a rose
    const side = px < GW / 2 ? 1 : -1;
    const tx = px + side * 28, ty = player.y - 22;
    if (enter(2)) { startDioStop(260); dioSay('see this? a knife. right at your throat.', 380, 0); }
    if (dioStopT === 220 && !e.f2k) { e.f2k = true; arrows.push(dioKnife(tx, ty, -side, 0.45, 3.6)); sfSfx.arrow(); }
    if (dioStopT === 140 && !e.f2b) { e.f2b = true; dioSay('but a clean death? no... far too kind.', 380, 0); }
    if (dioStopT === 80 && !e.f2) { e.f2 = true; arrows = arrows.filter(a => a.kind !== 'knife'); sparks.push({ x: tx, y: ty, t: 260, color: '#ff5d8f', txt: '🌹', size: 56, rise: 0.05 }); dioStopFx = Math.max(dioStopFx, 9); }
    if (dioStopT === 30 && !e.f2c) { e.f2c = true; dioSay('...muda. i intend to savour this.', 380, 0); }
    done(520);
  } else if (e.tstep === 3) {                            // stop time and rearrange YOU
    if (enter(3)) startDioStop(130);
    if (dioStopT === 64) { player.x = clamp(GW - player.x, 20, GW - 20); player.y = clamp(GH - player.y, 44, GH - 12); sparks.push({ x: player.x, y: player.y - 26, t: 48, color: '#caa6ff', txt: '!?', size: 22 }); }
    if (dioStopT === 0 && !e.f3) { e.f3 = true; dioSay('did you really think YOU could choose where to stand?', 360, 0); }
    done(400);
  } else {                                               // enough games — the fight begins
    if (enter(4)) { dioSay('enough. you have amused me, JoJo.', 360, 260); dioSay('now... be erased. MUDA MUDA MUDA!', 360, 0); shake = 14; }
    if (e.tt >= 500) { e.mode = 'idle'; e.st = 36; e.cape = 1; dlg = []; dlgT = 0; banner = 'DIO'; bannerSub = 'the world is his'; bannerT = 130; sfSfx.zawarudo(); }
  }
}
function startBarrage(e) {
  e.mode = 'barrage'; e.st = 56;
  startDioStop(88);   // the synced "ZA WARUDO!" spark is the callout — no queued line to lag behind the action
  const _t = bossTarget(), px = _t.x, py = _t.y;   // knives ring the frozen hero, with spread so there are gaps to weave
  for (let i = 0; i < 15; i++) {
    const edge = i / 15 * Math.PI * 2;
    const sx = px + Math.cos(edge) * 360, sy = py + Math.sin(edge) * 320;
    const a = Math.atan2(py - sy, px - sx) + (rnd() - 0.5) * 0.55;
    arrows.push(dioKnife(clamp(sx, -16, GW + 16), clamp(sy, -16, GH + 16), Math.cos(a) * 3.3, Math.sin(a) * 3.3));
  }
}
function startRoller(e) {
  e.mode = 'roller'; e.st = 78;
  startDioStop(66);
  dlg = []; dlgT = 0; banner = 'ROAD ROLLER DA!'; bannerSub = '— DIO'; bannerT = 95;   // fire the callout in sync with the attack, bypassing the queue
  { const t = bossTarget(); roadRoller = { zoneX: clamp(t.x, 40, GW - 40), zoneY: clamp(t.y, 60, GH - 16), x: clamp(t.x, 40, GW - 40), y: -80, phase: 'hover', t: 0, toy: false }; }
  shake = 10;
}
function updateRoadRoller() {
  const r = roadRoller; r.t++;
  if (r.phase === 'hover') {                 // positioned high during stopped time
    r.y += (r.zoneY - 150 - r.y) * 0.2;
    if (dioStopT <= 0) { r.phase = 'drop'; r.t = 0; r.y0 = r.y; }   // remember the height for the telegraph
  } else if (r.phase === 'drop') {           // time resumes — it falls (the whole fall is the dodge window)
    r.y += 5.4;
    if (r.y >= r.zoneY) { r.y = r.zoneY; r.phase = 'impact'; r.t = 0; shake = 22; sfSfx.bomb(); }
  } else {                                   // impact — lethal a beat, MUDA spam, then gone
    if (r.t % 3 === 0) sparks.push({ x: r.zoneX + (rnd() - 0.5) * 80, y: r.zoneY - rnd() * 46, t: 8, color: '#ffe082', txt: 'MUDA' });
    if (r.t > 44) roadRoller = null;
  }
}
/* ── DIO's death: a slow crumble — he staggers, his time-stop fails, then he turns to dust ── */
function startDioFinale(e) {
  e.mode = 'dying'; e.hp = 1; e.crumble = 0; e.stand = 0;
  dioFinale = { phase: 'stagger', t: 0 };
  dioStopT = 0; dioStopFx = 0; roadRoller = null; arrows = []; player.stunT = 0; player.choke = 0;
  kills++; score += 500 * mult; addMeter(20);
  sparks.push({ x: e.x, y: e.y - 26, t: 22, color: '#ffd24d', txt: '+' + (500 * mult) });
  banner = 'im-impossible!'; bannerSub = '— DIO'; bannerT = 130;
  shake = 16; sfSfx.thud();
}
function advanceDioFinale() {
  const f = dioFinale; f.t++;
  playerStand *= 0.95;                                  // Star Platinum fades as the duel ends
  const e = enemies.find(en => en.type === 'dio');
  if (f.phase === 'stagger') {                          // he reels, refusing to believe it
    if (f.t >= 80) { f.phase = 'laststand'; f.t = 0; banner = 'toki yo... to... maré...?'; bannerSub = 'but time will not obey him'; bannerT = 150; sfSfx.zawarudo(); dioStopFx = 16; }
  } else if (f.phase === 'laststand') {                 // one last ZA WARUDO — and it sputters out
    if (!api.reduceMotion && f.t % 12 === 0) dioStopFx = Math.max(dioStopFx, 9);
    if (f.t >= 96) { f.phase = 'crumble'; f.t = 0; banner = 'WRYYYYYYY!'; bannerSub = ''; bannerT = 200; sfSfx.die(); shake = 22; }
  } else {                                              // he crumbles to dust from the feet up
    if (e) e.crumble = clamp(f.t / 120, 0, 1);
    if (f.t % 2 === 0 && e) {
      const ox = (rnd() - 0.5) * 26, oy = (rnd() - 0.5) * 10, tt = 22 + rnd() * 24, pale = rnd() < 0.5;  // consumed even under reduced motion
      if (!api.reduceMotion) sparks.push({ x: e.x + ox, y: e.y - 6 - (e.crumble || 0) * 42 + oy, t: tt, color: pale ? '#d8c9a4' : '#caa6ff', txt: '·' });
    }
    if (f.t >= 132) { finishDioFinale(); return; }
  }
  if (!api.reduceMotion && f.t % 8 === 0) shake = Math.max(shake, 4);
}
function finishDioFinale() {
  sfUnlock('dio');
  const e = enemies.find(en => en.type === 'dio'); if (e) e.dead = true;
  dioFinale = null; jojoActive = false; dioStopT = 0; dioStopFx = 0; roadRoller = null;
  arrows = []; dlg = []; dlgT = 0; player.stunT = 0;
  clearBlades();                        // the lightsaber stays behind, back to the horde
  banner = 'DIO is no more'; bannerSub = '+3000  ·  the bizarre night ends'; bannerT = 190;
  score += 3000; addMeter(50); shake = 14;
  grantBossToken();
  ianCue = 150;                                  // ...and one last figure remains to face: the creator
}

/* ── the final confrontation: Ian, the creator. unarmed. he begs. you choose. ── */
function ianSay(text, hold, gap) { dlg.push({ txt: text, sub: '— Ian', hold: hold || 130, gap: gap == null ? 70 : gap }); }
function startIan() {
  ianActive = true; ianCue = 0;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  swActive = false; swState = ''; swStars = []; jojoActive = false; vaderActive = false; sidiousActive = false;
  dioStopT = 0; dioStopFx = 0; roadRoller = null; ltnFlash = 0; sidFinale = null; dioFinale = null;
  stone = null; clearBlades(); saberPickup = null;
  banishAllies();
  player.x = GW * 0.32; player.y = GH / 2 + 8; player.vx = 0; player.vy = 0; player.choke = 0; player.stunT = 0;
  enemies.push(makeEnemy('ian', GW * 0.7, GH / 2 + 6));
  // the creator's cozy little room: a warm starfield with drifting hearts & code glyphs
  ianBg = [];
  for (let i = 0; i < 48; i++) ianBg.push({ kind: 'star', x: rnd() * GW, y: rnd() * GH * 0.9, r: rnd() * 1.3 + 0.3 });
  const glyphs = ['♥', '♡', '✦', '✧', '★', '{ }', '</>', '⟨⟩', '✿', '♪'];
  const cols = ['#ffd6e7', '#cdb4ff', '#b4e1ff', '#fff0b4', '#c8ffd4', '#ffc4d6'];
  for (let i = 0; i < 16; i++) ianBg.push({ kind: 'mote', x: rnd() * GW, y: rnd() * GH,
    s: 12 + rnd() * 16, vy: -(0.12 + rnd() * 0.4), a: 0.12 + rnd() * 0.18,
    ph: rnd() * 100, ch: glyphs[Math.floor(rnd() * glyphs.length)], col: cols[Math.floor(rnd() * cols.length)] });
  banner = ''; bannerSub = ''; bannerT = 0;
  dlg = []; dlgT = 72;        // the plea is delivered on the intro card — here, just a beat, then the choice
  shake = 6;
}
function chooseIan(sel) {
  if (ianFinale) return;
  ianChoice = null;
  const e = enemies.find(en => en.type === 'ian');
  dlg = []; dlgT = 0;
  if (sel === 1) {                                 // KILL — the world is left hollow and grieving
    if (!noPersist()) try { localStorage.setItem('ilaird_sf_ending', 'kill'); } catch (_) {}
    ianFinale = { outcome: 'kill', phase: 'strike', t: 0 };
    if (e) e.mode = 'dying';
    banner = ''; bannerT = 0;
    swFlash = Math.max(swFlash, 14); shake = 18; sfSfx.saberHit();
  } else {                                         // SPARE — endless mode, as a gift
    if (!noPersist()) try { localStorage.setItem('ilaird_sf_ending', 'spare'); } catch (_) {}
    ianFinale = { outcome: 'spare', phase: 'thanks', t: 0 };
    if (e) e.mode = 'rise';
    ianSay('thank you for sparing me.', 150, 55);
    ianSay('I will now throw everything I have at you.', 185, 0);
    sfSfx.summon();
  }
}
function advanceIanFinale() {
  const f = ianFinale; f.t++;
  const e = enemies.find(en => en.type === 'ian');
  if (f.outcome === 'kill') {
    if (f.phase === 'strike') {
      if (f.t === 6) { banner = 'WHY...?'; bannerSub = '— Ian'; bannerT = 110; }
      if (f.t >= 30) { f.phase = 'fall'; f.t = 0; if (e) { e.mode = 'dying'; e.crumble = 0; } sfSfx.die(); shake = 14; }
    } else {                                       // he fades to ash
      if (e) e.crumble = clamp(f.t / 90, 0, 1);
      if (f.t % 3 === 0 && e) { const ox = (rnd() - 0.5) * 22; if (!api.reduceMotion) sparks.push({ x: e.x + ox, y: e.y - 18 - (e.crumble || 0) * 28, t: 26, color: '#9e9e9e', txt: '·' }); }
      if (f.t >= 116) { finishIanKill(); return; }
    }
  } else {
    if (f.phase === 'thanks') {
      if (!dlg.length && dlgT <= 0 && bannerT < 95) { f.phase = 'leave'; f.t = 0; if (e) e.mode = 'rise'; }
    } else {                                       // he steps back into the light, grateful
      if (e) { e.x += 1.1; e.fade = clamp(1 - f.t / 80, 0, 1); }
      if (f.t >= 84) { finishIanSpare(); return; }
    }
  }
}
function finishIanKill() {
  enemies = enemies.filter(en => en.type !== 'ian');
  ianActive = false; ianFinale = null; ianChoice = null;
  sfUnlock('ian_kill');
  mournful = true; endless = false;
  arrows = []; warns = []; dlg = []; dlgT = 0;
  clearBlades(); stone = null; stoneCd = 150;   // Excalibur returns to the quiet world
  banner = 'the world goes quiet'; bannerSub = 'nothing here will raise a hand to you now'; bannerT = 230;
  shake = 6;
  breatherT = BREATHER;
}
function finishIanSpare() {
  enemies = enemies.filter(en => en.type !== 'ian');
  ianActive = false; ianFinale = null; ianChoice = null;
  sfUnlock('ian_spare');
  endless = true; mournful = false;
  if (!noPersist()) try { localStorage.setItem('ilaird_sf_endless', '1'); } catch (_) {}
  // mercy has a price (and a prize): HARD MODE unlocks forever — a new ☠ HARD
  // choice on the title screen (the flag is read per run in init)
  if (!noPersist() && !hardUnlocked) {
    hardUnlocked = true;
    try { localStorage.setItem('ilaird_sf_hard', '1'); } catch (_) {}
    banner = 'ENDLESS MODE  ·  ☠ HARD MODE UNLOCKED';
    bannerSub = 'the horde never ends — and a harder horde now waits on the title screen';
  } else {
    banner = 'ENDLESS MODE'; bannerSub = 'the horde never ends — survive as long as you can';
  }
  arrows = []; warns = []; dlg = []; dlgT = 0;
  bannerT = 230;
  breatherT = BREATHER;
  if (!hardMode) openBoonMenu('MERCY REWARDED — A FINAL BOON');   // (a hard run re-sparing earns nothing more)
}
function drawIanChoice() {
  const c = ianChoice; c.t = (c.t || 0) + 1;
  const opts = [
    { label: 'SPARE', sub: 'let him live', accent: '#5ac8ff' },
    { label: 'KILL',  sub: 'strike him down', accent: '#e23b3b' },
  ];
  const bw = 158, bh = 72, gap = 28, total = bw * 2 + gap;
  const x0 = GW / 2 - total / 2, y = GH - 116;
  ctx.save();
  ctx.textAlign = 'center';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillStyle = '#fff'; ctx.font = 'bold 17px Tahoma,Arial';
  ctx.fillText('what will you do?', GW / 2, y - 18);
  ctx.shadowBlur = 0;
  for (let i = 0; i < 2; i++) {
    const sel = c.sel === i, bx = x0 + i * (bw + gap), o = opts[i];
    const pulse = sel && !api.reduceMotion ? 0.75 + 0.25 * Math.sin(c.t * 0.18) : 1;
    ctx.globalAlpha = sel ? pulse : 0.85;
    ctx.fillStyle = sel ? hexA(o.accent, 0.22) : 'rgba(8,10,14,0.85)';
    roundRectPath(bx, y, bw, bh, 8); ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = sel ? 3 : 1.5; ctx.strokeStyle = sel ? o.accent : hexA(o.accent, 0.5);
    roundRectPath(bx, y, bw, bh, 8); ctx.stroke();
    ctx.fillStyle = sel ? '#fff' : o.accent; ctx.font = 'bold 25px Tahoma,Arial';
    ctx.fillText(o.label, bx + bw / 2, y + 36);
    ctx.fillStyle = sel ? '#e8eef5' : '#90a0b0'; ctx.font = '12px Tahoma,Arial';
    ctx.fillText(o.sub, bx + bw / 2, y + 56);
  }
  ctx.fillStyle = '#9fb3c8'; ctx.font = '12px Tahoma,Arial';
  ctx.fillText('←  →   ·   Z to choose', GW / 2, y + bh + 22);
  ctx.restore(); ctx.textAlign = 'left';
}
function startSidious() {
  swActive = true; sidiousActive = true; vaderActive = false; swState = 'sidious';
  sidiousCue = 0; sidiousIntroT = 300;            // ~5s reveal before he strikes
  arrows = []; ltnBolts = []; ltnFlash = 26;
  armSaberAll(true); saberPickup = null;           // the blue lightsaber carries into the duel
  banishAllies();                                 // face the Emperor alone
  if (!swStars.length) { for (let i = 0; i < 70; i++) swStars.push({ x: rnd() * GW, y: rnd() * GH, r: rnd() * 1.3 + 0.3 }); }
  player.choke = 0; player.stunT = 0;
  // the Emperor stands at the far side, flanked by two Royal Guards
  const sx = GW * 0.82, sy = GH / 2;
  enemies.push(makeEnemy('sidious', sx, sy));
  enemies.push(makeEnemy('guard', sx - 10, sy - 72));
  enemies.push(makeEnemy('guard', sx - 10, sy + 72));
  shake = 16;
  banner = 'DARTH SIDIOUS'; bannerSub = 'the Emperor reveals himself'; bannerT = 150;
  sfSfx.ignite();
  // a scripted reveal
  dlg = []; dlgT = 44;
  bossSay('At last we meet again.', 110, 72);
  bossSay('I have been expecting you.', 110, 72);
  bossSay('Your feeble skills are no match for the dark side.', 130, 82);
  bossSay('GUARDS. Witness the power of the Force!', 120, 0);
}

function farPoint(margin) {
  for (let i = 0; i < 12; i++) {
    const x = margin + rnd() * (GW - margin * 2);
    const y = margin + rnd() * (GH - margin * 2);
    if (Math.hypot(x - player.x, y - player.y) > KEEP_OUT) return { x, y };
  }
  return { x: GW / 2, y: 60 };
}

// ── enemy-ai — updateEnemy — the per-enemy AI state machines ──
/* ── enemy AI ── */
function updateEnemy(e) {
  if (e.grz > 0) e.grz--;
  if (e.flashT > 0) e.flashT--;   // the impact flash fades (held while hit-stop freezes this)
  if (e.stun > 0) { e.stun--; return; }
  if (e.frozen > 0) { e.frozen--; e.vx = 0; e.vy = 0; return; }  // encased in ice by the frost nova
  if (freezeT > 0) return;
  // the creator just kneels and trembles — he never moves on his own
  if (e.type === 'ian') { e.phase = (e.phase || 0) + 0.08; return; }
  // a world in mourning: the horde no longer hunts you — it just wanders, milling about aimlessly
  if (mournful && (e.type === 'goblin' || e.type === 'wolf' || e.type === 'archer' || e.type === 'troll')) {
    if (e.wt === undefined || --e.wt <= 0) {                 // pick a new gentle heading now and then
      e.wang = rnd() * Math.PI * 2;
      e.wt = 70 + rnd() * 150;
      e.wsp = 0.25 + rnd() * 0.6;
      if (rnd() < 0.25) e.wsp = 0;                   // sometimes just pause and rest
    }
    e.vx = Math.cos(e.wang) * (e.wsp || 0); e.vy = Math.sin(e.wang) * (e.wsp || 0);
    e.x += e.vx; e.y += e.vy;
    if (e.x < 22 || e.x > GW - 22) { e.wang = Math.PI - e.wang; e.x = clamp(e.x, 22, GW - 22); }  // turn at the walls
    if (e.y < 42 || e.y > GH - 14) { e.wang = -e.wang; e.y = clamp(e.y, 42, GH - 14); }
    e.phase += 0.05 + (e.wsp || 0) * 0.12;
    if (rnd() < 0.005) { const ox = rnd() * 8; if (!api.reduceMotion) sparks.push({ x: e.x - 4 + ox, y: e.y - 28, t: 32, color: '#8fd8ff', txt: '·' }); }
    return;
  }
  const tgt = hordeTarget(e);   // P1 for bosses/set-pieces; nearest standing hero for the open-field horde
  const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;

  if (e.type === 'goblin') {
    // steering with momentum so they swing wide on sharp turns
    const hz = shamanHaste(e);
    e.vx += dx / d * 0.085 * hz; e.vy += dy / d * 0.085 * hz;
    const sp = Math.hypot(e.vx, e.vy);
    if (sp > e.spd * hz) { e.vx = e.vx / sp * e.spd * hz; e.vy = e.vy / sp * e.spd * hz; }
    e.x += e.vx; e.y += e.vy; e.phase += 0.22;
  } else if (e.type === 'shaman') {
    // the shaman still never attacks, but it rides WITH the warband: it shepherds
    // the pack from just behind the front line so the ritual circle covers the
    // chase, shrieks the kin into a frenzy when enough crowd the ring, mends
    // wounded trolls (and re-raises elite bucklers), and BLINKS clear in a puff
    // of chant-light when a hero closes in — hunting it down is a real chase now
    e.st--;
    if (e.blinkCd > 0) e.blinkCd--;
    if (e.frenzyT > 0) e.frenzyT--;
    if (e.frenzyCd > 0) e.frenzyCd--;
    // the pack it wards: centroid of the live open-field grunts
    let px = 0, py = 0, pn = 0;
    for (const g of enemies) {
      if (g === e || g.dead) continue;
      if (g.type === 'goblin' || g.type === 'wolf' || g.type === 'archer' || g.type === 'troll') { px += g.x; py += g.y; pn++; }
    }
    if (d < 120 && e.blinkCd <= 0) {
      // blink: reappear behind the pack (or anywhere clear of heroes if it has none)
      let bx = e.x, by = e.y, ok = false;
      for (let i = 0; i < 8 && !ok; i++) {
        if (pn) {
          const cx = px / pn, cy = py / pn;
          const hx = tgt.x - cx, hy = tgt.y - cy, hl = Math.hypot(hx, hy) || 1;
          bx = cx - hx / hl * (60 + rnd() * 60) + (rnd() - 0.5) * 70;
          by = cy - hy / hl * (60 + rnd() * 60) + (rnd() - 0.5) * 70;
        } else {
          const a = rnd() * Math.PI * 2;
          bx = e.x + Math.cos(a) * (220 + rnd() * 80);
          by = e.y + Math.sin(a) * (220 + rnd() * 80);
        }
        bx = clamp(bx, 26, GW - 26); by = clamp(by, 48, GH - 16);
        ok = true;
        for (const h of heroesLive()) if (Math.hypot(h.x - bx, h.y - by) < 190) ok = false;
      }
      if (ok) {
        sparks.push({ x: e.x, y: e.y - 24, t: 20, color: '#a5e88a', txt: '✦' });
        e.x = bx; e.y = by;
        sparks.push({ x: e.x, y: e.y - 24, t: 20, color: '#a5e88a', txt: '✦' });
        sfSfx.zap();
        e.blinkCd = 150;
      } else e.blinkCd = 40;     // nowhere safe to land — try again shortly
    } else if (d < 190) {
      e.x -= dx / d * e.spd * 1.2; e.y -= dy / d * e.spd * 1.2; e.phase += 0.11;
    } else if (pn) {
      // shepherd: hold station just behind the pack, relative to its quarry
      const cx = px / pn, cy = py / pn;
      const hx = tgt.x - cx, hy = tgt.y - cy, hl = Math.hypot(hx, hy) || 1;
      const wx = clamp(cx - hx / hl * 70, 26, GW - 26);
      const wy = clamp(cy - hy / hl * 70, 48, GH - 16);
      const sx2 = wx - e.x, sy2 = wy - e.y, sl = Math.hypot(sx2, sy2) || 1;
      if (sl > 24) { e.x += sx2 / sl * e.spd * 1.15; e.y += sy2 / sl * e.spd * 1.15; e.phase += 0.1; }
      else e.phase += 0.07;
    } else e.phase += 0.07;
    // the frenzy shriek: three kin in the ring → whip them into a sprint
    if (e.frenzyT <= 0 && e.frenzyCd <= 0) {
      let kin = 0;
      for (const g of enemies) {
        if (g === e || g.dead || g.frozen > 0) continue;
        if ((g.type === 'goblin' || g.type === 'wolf' || g.type === 'archer' || g.type === 'troll') &&
            Math.hypot(g.x - e.x, g.y - e.y) < SHAMAN_R) kin++;
      }
      if (kin >= 3) {
        e.frenzyT = 110; e.frenzyCd = 340;
        sparks.push({ x: e.x, y: e.y - 52, t: 26, color: '#c8ff9a', txt: 'RA-KA!' });
        shake = Math.max(shake, 5); sfSfx.screech();
      }
    }
    // the mending beat: one heart per beat — wounded trolls, or an elite's broken buckler
    if (e.st <= 0) {
      e.st = 90;
      for (const t of enemies) {
        if (t.dead || !(t.hp > 0)) continue;
        let mhp = 0;
        if (t.type === 'troll') mhp = t.elite === 2 ? 8 : t.elite ? 5 : 3;
        else if (t.type === 'goblin' && t.elite) mhp = t.elite === 2 ? 3 : 2;
        if (mhp && t.hp < mhp && Math.hypot(t.x - e.x, t.y - e.y) < SHAMAN_R) {
          t.hp++;
          sparks.push({ x: t.x, y: t.y - 62, t: 22, color: '#8fdc78', txt: '✚' });
          break;                                   // one heart per beat
        }
      }
    }
  } else if (e.type === 'bomber') {
    // the bombardier: long-range artillery. Roams far out, winds up (a visible
    // fuse tell), then lobs a powder keg at the target's current spot with a
    // little seeded scatter — the shrinking red ring is the dodge. After firing
    // it scurries and re-sights. It never touches you; the floor does.
    e.st--;
    if (e.mode === 'roam') {
      if (d < 300) { e.x -= dx / d * e.spd; e.y -= dy / d * e.spd; e.phase += 0.14; }
      else if (d > 430) { e.x += dx / d * e.spd * 0.7; e.y += dy / d * e.spd * 0.7; e.phase += 0.1; }
      if (e.st <= 0 && d < 520) { e.mode = 'wind'; e.st = 34; }
      else if (e.st <= 0) e.st = 30;
    } else if (e.mode === 'wind') {
      if (e.st <= 0) {
        const sx = clamp(tgt.x + (rnd() - 0.5) * 70, 20, GW - 20);
        const sy = clamp(tgt.y + (rnd() - 0.5) * 70, 46, GH - 12);
        kegs.push({ sx: e.x, sy: e.y - 22, tx: sx, ty: sy, t: 0, T: KEG_AIR });
        sfSfx.lunge();
        e.mode = 'cool'; e.st = 150 + rnd() * 80;
      }
    } else { // cool — scurry off the counter-charge, then re-sight
      if (d < 260) { e.x -= dx / d * e.spd; e.y -= dy / d * e.spd; e.phase += 0.12; }
      if (e.st <= 0) { e.mode = 'roam'; e.st = 40; }
    }
  } else if (e.type === 'troll') {
    // the bull troll enrages below half — faster feet, faster club; the dread
    // troll enrages sooner, harder, and ROARS the moment it turns
    const raging = e.elite && e.hp <= (e.elite === 2 ? 3 : 2);
    if (raging && e.elite === 2 && !e.roared) {
      e.roared = true;
      sparks.push({ x: e.x, y: e.y - 66, t: 26, color: '#ff7043', txt: 'ROAR' });
      shake = Math.max(shake, 8); sfSfx.charge();
    }
    const sp = (raging ? e.spd * (e.elite === 2 ? 1.9 : 1.7) : e.spd) * shamanHaste(e);
    e.x += dx / d * sp; e.y += dy / d * sp; e.phase += (raging ? 0.17 : 0.1);
  } else if (e.type === 'ogre') {
    e.st--;
    if (e.mode === 'stalk') {
      e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.08;
      e.lx = dx / d; e.ly = dy / d;                  // keep its aim fresh until it commits
      if (e.st <= 0 && d < 340) { e.mode = 'wind'; e.st = 36; sfSfx.lunge(); }
      else if (e.st <= 0) e.st = 44;
    } else if (e.mode === 'wind') {
      e.lx = dx / d; e.ly = dy / d;                  // tracks during the wind-up, then locks
      e.phase += 0.04;
      if (e.st <= 0) { e.mode = 'charge'; e.st = 28; sfSfx.charge(); }
    } else { // charge — a fast, locked straight rush that bounces off the walls
      e.x += e.lx * 7.4; e.y += e.ly * 7.4; e.phase += 0.5;
      if (e.x < 18 || e.x > GW - 18) { e.lx = -e.lx; e.x = clamp(e.x, 18, GW - 18); }
      if (e.y < 44 || e.y > GH - 14) { e.ly = -e.ly; e.y = clamp(e.y, 44, GH - 14); }
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 56 + rnd() * 34; }
    }
  } else if (e.type === 'wraith') {
    // the Nine hunt as one: orbit, tighten the ring, then strike together
    e.ring = Math.max(135, e.ring - 0.12);
    const cyc = frame % 360;
    if (cyc < 280) {
      e.mode = 'circle';
      const a = e.slot + frame * 0.004;
      const tx = clamp(tgt.x + Math.cos(a) * e.ring, 10, GW - 10);
      const ty = clamp(tgt.y + Math.sin(a) * e.ring, 36, GH - 6);
      const ddx = tx - e.x, ddy = ty - e.y, dd = Math.hypot(ddx, ddy) || 1;
      if (dd > 4) { e.x += ddx / dd * Math.min(e.spd, dd); e.y += ddy / dd * Math.min(e.spd, dd); }
      e.phase += 0.12;
    } else if (cyc < 312) {
      e.mode = 'aim';  // all Nine flash + sight lines at once
    } else {
      if (e.mode !== 'lunge') {
        e.lx = dx / d; e.ly = dy / d;
        // scale the strike so it actually reaches a stationary player, even when the
        // ring is still wide: cover the gap (+overshoot) within the ~48-frame lunge window
        e.lspd = clamp((d + 30) / 42, 4.6, 9);
        if (e.slot !== undefined && enemies.find(o => o.type === 'wraith' && !o.dead) === e) {
          sfSfx.screech();
          // recorded screech: always on the first lunge, then 20% of the time
          if (!wraithLunged || rnd() < 0.2) playWraithScreech();
          wraithLunged = true;
        }
      }
      e.mode = 'lunge';
      e.x += e.lx * (e.lspd || 4.6); e.y += e.ly * (e.lspd || 4.6); e.phase += 0.4;
    }
  } else if (e.type === 'witchking') {
    e.st--;
    if (e.mounted) {
      // the fell beast: wheel at range, telegraph, then a screaming dive
      e.phase += 0.16;
      if (e.mode === 'hover') {
        const ang = Math.atan2(e.y - tgt.y, e.x - tgt.x) + 0.013;
        const tx = clamp(tgt.x + Math.cos(ang) * 210, 40, GW - 40);
        const ty = clamp(tgt.y + Math.sin(ang) * 175, 50, GH - 40);
        const ddx = tx - e.x, ddy = ty - e.y, dd = Math.hypot(ddx, ddy) || 1;
        e.x += ddx / dd * Math.min(e.spd, dd); e.y += ddy / dd * Math.min(e.spd, dd);
        if (e.st <= 0) { e.mode = 'aim'; e.st = 34; }
      } else if (e.mode === 'aim') {
        if (e.st <= 0) { e.mode = 'dive'; e.st = 30; e.lx = dx / d; e.ly = dy / d; sfSfx.screech(); }
      } else { // dive
        e.x += e.lx * 6.84; e.y += e.ly * 6.84; e.phase += 0.55;
        if (e.st <= 0) { e.mode = 'hover'; e.st = 80 + rnd() * 40; }
      }
    } else {
      // on foot: stalk, then wind up the flail and whip it round in a deadly arc
      if (e.mode === 'walk') {
        e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.13;
        e.flailAng += 0.16;
        if (e.st <= 0 && d < 150) { e.mode = 'wind'; e.st = 32; }
        else if (e.st <= 0) e.st = 40;
      } else if (e.mode === 'wind') {
        e.flailAng += 0.42;  // spins up overhead — the tell
        if (e.st <= 0) { e.mode = 'swing'; e.st = 28; sfSfx.lunge(); }
      } else { // swing
        e.flailAng += 0.5;
        e.x += dx / d * 0.6; e.y += dy / d * 0.6;
        if (e.st <= 0) { e.mode = 'walk'; e.st = 50 + rnd() * 30; }
      }
    }
  } else if (e.type === 'trooper') {
    // march straight to the assigned formation slot, hold, then fire on command
    if (e.mode === 'march') {
      e.phase += 0.22;
      if (e.x > e.slotX + 3) e.x -= 3;
      else { e.x = e.slotX; e.mode = 'set'; }
    } else {
      e.phase += 0.05;
      if (swState === 'fire' && --e.fireT <= 0) {
        // stormtroopers can't aim: wide spread keeps the volley dodgeable
        const spread = (rnd() - 0.5) * 0.5;
        const ca = Math.cos(spread), sa = Math.sin(spread);
        const ux = dx / d, uy = dy / d;
        arrows.push({ x: e.x, y: e.y - 18,
                      vx: (ux * ca - uy * sa) * 5.2, vy: (ux * sa + uy * ca) * 5.2,
                      t: 240, kind: 'laser' });
        sfSfx.blaster();
        e.fireT = 70 + rnd() * 90;
      }
    }
  } else if (e.type === 'vader') {
    // a duel: melee slashes mixed with Force powers (push / saber throw / choke); escalates at half HP
    if (e.intro > 0) { e.intro--; e.phase += 0.04; return; }  // step from the shadows, then begin the duel
    e.st--;
    e.disarmed = arrows.some(a => a.kind === 'vsaber');     // his blade is mid-flight
    if (!e.phase2 && e.hp <= 5 && e.mode !== 'slash') enterVaderPhase2(e);
    else if (e.mode === 'advance') {
      if (e.stun <= 0) { e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.12; }
      if (e.st <= 0) { if (d < 160) vaderNextAttack(e, d); else e.st = 22; }  // close, then commit
    } else if (e.mode === 'wind') {                          // melee wind-up tell
      if (e.st <= 0) {
        e.mode = 'slash'; e.st = 22;
        e.lx = dx / d; e.ly = dy / d;
        e.slashAng = Math.atan2(e.ly, e.lx) - 1.0;           // wind up to one side
        sfSfx.lunge();
      }
    } else if (e.mode === 'slash') {                         // lunge, blade sweeping an arc out front
      e.slashAng += (e.phase2 ? 2.4 : 2.0) / 22;
      e.x += e.lx * 3.0; e.y += e.ly * 3.0; e.phase += 0.2;
      if (e.st <= 0) {
        if (e.phase2 && !e.combo && rnd() < 0.5) { e.combo = true; e.mode = 'wind'; e.st = 10; }  // quick follow-up
        else { e.combo = false; e.mode = 'advance'; e.st = (e.phase2 ? 18 : 34) + rnd() * 22; }
      }
    } else if (e.mode === 'cast') {                          // hand-raised Force telegraph, then unleash
      if (e.st <= 0) {
        if (e.power === 'push')       { forcePush(e, e.phase2 ? 1.15 : 0.9); e.mode = 'recover'; e.st = 18; shake = Math.max(shake, 12); }
        else if (e.power === 'throw') { vaderThrow(e); e.mode = 'recover'; e.st = 34; }
        else if (player.dashT > 0)    { e.mode = 'recover'; e.st = 20; sparks.push({ x: e.x, y: e.y - 42, t: 12, color: '#9ec8ff', txt: 'MISSED' }); }  // dashed clear of the choke
        else                          { startChoke(e); e.mode = 'choke'; }
      }
    } else if (e.mode === 'choke') {                         // hold the player aloft until broken or it ends
      if (player.choke <= 0) { e.mode = 'recover'; e.st = 28; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'advance'; e.st = (e.phase2 ? 16 : 28) + rnd() * 20; }
    }
  } else if (e.type === 'sidious') {
    // Clone Wars Sidious: fast & acrobatic — weaving rushes, a twin-saber spin, Force lightning, telegraphed leaps
    const _px = e.x, _py = e.y;                              // remember where he was (for the motion trail)
    e.st--;
    if (e.lit < 1) e.lit = Math.min(1, e.lit + 0.04);        // both blades snap to life
    e.spinAng += 0.16;
    if (sidiousIntroT > 0) {                                 // the entrance: hover, blades igniting, no aggression
      e.mode = 'enter'; e.mvx = 0; e.mvy = 0;
      e.x += Math.sin(frame * 0.06) * 0.35; e.y += Math.cos(frame * 0.05) * 0.25;
      return;
    }
    if (e.mode === 'enter') { e.mode = 'stalk'; e.st = 36; }
    // at half health the sabers go dark — from here he fights with lightning alone
    if (!e.phase2 && e.hp <= e.maxhp / 2 && (e.mode === 'stalk' || e.mode === 'recover')) enterSidiousPhase2(e);
    if (e.mode === 'stalk') {
      const wv = Math.sin(frame * 0.13) * 0.55;              // weave so he doesn't beeline
      e.x += dx / d * e.spd + (-dy / d) * wv;
      e.y += dy / d * e.spd + ( dx / d) * wv;
      e.phase += 0.18;
      if (e.st <= 0) {
        const r = rnd();
        if (e.phase2) {
          // lightning only: a straight bolt, a sweeping rake, or a leap — but never two rakes in a row
          if (e.lastCast === 'sweep') {
            if (r < 0.62 && d < 440) startSidiousCast(e, 'bolt', dx / d, dy / d);
            else { e.mode = 'gather'; e.st = 11; e.tx = sidiousFlank(e); e.lastCast = null; }
          } else if (r < 0.46 && d < 440) startSidiousCast(e, 'bolt', dx / d, dy / d);
          else if (r < 0.72 && d < 440)   startSidiousCast(e, 'sweep', dx / d, dy / d);
          else { e.mode = 'gather'; e.st = 11; e.tx = sidiousFlank(e); e.lastCast = null; }
        } else {
          if (r < 0.38 && d < 360)       startSidiousCast(e, 'bolt', dx / d, dy / d);
          else if (r < 0.74 && d < 240)  { e.mode = 'wind'; e.st = 26; sidiousCackle(e, 'spin'); }
          else { e.mode = 'gather'; e.st = 13; e.tx = sidiousFlank(e); }  // coil before a leap
        }
      }
    } else if (e.mode === 'gather') {                        // anticipation: dip and coil, then spring
      e.crouch = (1 - Math.max(0, e.st) / 13);               // 0→1 coil
      e.hop = -e.crouch * 6;                                 // dip down before the spring
      e.x -= dx / d * 0.4; e.y -= dy / d * 0.4;              // a small recoil away — reads as winding up
      if (e.st <= 0) {
        e.mode = 'leap'; e.st = 20; e.leapDur = 20; e.crouch = 0; e.hop = 0;
        e.leapFrom = { x: e.x, y: e.y }; e.leapTo = e.tx; sfSfx.dash();
      }
    } else if (e.mode === 'leap') {                          // a smooth eased arc — accelerate then settle
      const t = clamp(1 - Math.max(0, e.st) / e.leapDur, 0, 1);
      const s = t * t * (3 - 2 * t);                         // smoothstep so it springs, not blinks
      e.x = e.leapFrom.x + (e.leapTo.x - e.leapFrom.x) * s;
      e.y = e.leapFrom.y + (e.leapTo.y - e.leapFrom.y) * s;
      e.hop = Math.sin(t * Math.PI) * 26;                    // rise and land
      e.phase += 0.16;
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 22; e.hop = 0; }
    } else if (e.mode === 'wind') {                          // gathers both sabers — the spin tell
      e.spinAng += 0.34;
      if (e.st <= 0) { e.mode = 'spin'; e.st = 42; e.lx = dx / d; e.ly = dy / d; sfSfx.lunge(); }
    } else if (e.mode === 'spin') {                          // whirls across, twin blades a lethal ring
      e.spinAng += 0.62;
      e.x += e.lx * 4.4; e.y += e.ly * 4.4; e.phase += 0.32;
      e.lx = e.lx * 0.92 + dx / d * 0.08; e.ly = e.ly * 0.92 + dy / d * 0.08;  // tracks a little
      if (e.st <= 0) { e.mode = 'recover'; e.st = 22; }
    } else if (e.mode === 'cast') {                          // hands raised — a long, building lightning telegraph
      if (e.st === e.castDur - 14) sfSfx.ignite();           // a charging whir partway in
      if (e.st <= 0) {
        if (player.dashT > 0) { e.mode = 'recover'; e.st = 18; sparks.push({ x: e.x, y: e.y - 46, t: 12, color: '#d0b3ff', txt: 'MISSED' }); }
        else {
          sidiousLightning(e); e.mode = 'lightning';
          // the rake sweeps slowly (slower than a running player) over a long window; the bolt is a quick zap
          e.lightDur = e.castKind === 'sweep' ? 42 : 26; e.st = e.lightDur;
          e.lethalW = e.castKind === 'sweep' ? 14 : 18;
        }
      }
    } else if (e.mode === 'lightning') {                     // the bolt arcs along the aim for the window
      if (e.castKind === 'sweep') {                          // rake the beam across the arc (outrunnable)
        const rot = (e.sweepDir || 1) * (e.sweepArc || 0.85) / (e.lightDur || 42);
        const ca = Math.cos(rot), sa = Math.sin(rot);
        const nx = e.lx * ca - e.ly * sa, ny = e.lx * sa + e.ly * ca;
        e.lx = nx; e.ly = ny;
      }
      if (e.st % 4 === 0) ltnFlash = Math.max(ltnFlash, 8);
      if (e.st <= 0) { e.mode = 'recover'; e.st = e.phase2 ? 22 : 24; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'stalk'; e.st = (e.phase2 ? 20 : 22) + rnd() * 20; }
    }
    e.mvx = e.x - _px; e.mvy = e.y - _py;                    // per-tick movement → motion-blur ghosts
  } else if (e.type === 'guard') {
    // Royal Guard: stalk in, plant the force pike, then lunge
    e.st--;
    if (sidiousIntroT > 0) { e.mode = 'idle'; return; }      // stand at attention during the reveal
    if (e.mode === 'idle') { e.mode = 'stalk'; e.st = 40; }
    if (e.mode === 'stalk') {
      e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.16;
      if (e.st <= 0 && d < 150) { e.mode = 'aim'; e.st = 24; }
      else if (e.st <= 0) e.st = 28;
    } else if (e.mode === 'aim') {
      e.pike += 0.2;
      if (e.st <= 0) { e.mode = 'lunge'; e.st = 18; e.lx = dx / d; e.ly = dy / d; sfSfx.lunge(); }
    } else { // lunge
      e.x += e.lx * 4.0; e.y += e.ly * 4.0; e.phase += 0.3; e.pike += 0.32;
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 34 + rnd() * 22; }
    }
  } else if (e.type === 'dio') {
    if (e.mode === 'dying') return;                        // the crumble cutscene drives him now
    e.st--; e.phase += 0.1;
    if (e.cape < 1) e.cape = Math.min(1, e.cape + 0.04);
    // both Stands manifest the moment you enter — The World looms over DIO, Star Platinum over the hero
    const standTarget = (e.mode === 'world' || e.mode === 'muda') ? 1 : 0.6;
    e.stand = (e.stand || 0) + (standTarget - (e.stand || 0)) * 0.1;
    playerStand += (0.9 - playerStand) * 0.07;
    if (e.mode === 'troll') { dioTroll(e); return; }       // the scripted taunting intro
    if (e.mode === 'idle') {                                // saunter at mid-range, then pick an attack
      if (dioStopT <= 0) {
        if (d > 230) { e.x += dx / d * e.spd; e.y += dy / d * e.spd; }
        else if (d < 160) { e.x -= dx / d * e.spd * 0.6; e.y -= dy / d * e.spd * 0.6; }
        e.x += -dy / d * Math.sin(frame * 0.035) * 0.4; e.y += dx / d * Math.sin(frame * 0.035) * 0.4;   // a slow, readable sway
      }
      if (e.st <= 0 && dioStopT <= 0) {
        const r = rnd();
        if (!e.rollerDone && e.hp <= e.maxhp * 0.45 && r < 0.45) { e.rollerDone = true; startRoller(e); }
        else if (r < 0.34) { e.mode = 'knives'; e.st = 40; }    // a longer wind-up you can read
        else if (r < 0.66) { e.mode = 'world'; e.st = 46; }
        else startBarrage(e);
      }
    } else if (e.mode === 'knives') {                       // wind-up, then loose a fan of knives
      if (e.st === 0) {
        const base = Math.atan2(dy, dx);
        for (let i = -3; i <= 3; i++) { const a = base + i * 0.13; arrows.push(dioKnife(e.x + Math.cos(a) * 14, e.y - 20 + Math.sin(a) * 14, Math.cos(a) * 4.3, Math.sin(a) * 4.3)); }
        sfSfx.arrow(); e.mode = 'recover'; e.st = 36;
      }
    } else if (e.mode === 'world') {                        // The World manifests; he lunges in to hammer
      if (e.st > 16) { e.x += dx / d * e.spd * 1.15; e.y += dy / d * e.spd * 1.15; }
      if (e.st === 16) sparks.push({ x: e.x, y: e.y - 42, t: 18, color: '#ffd24d', txt: 'THE WORLD' });
      if (e.st <= 0) { e.mode = 'muda'; e.st = 26; sfSfx.ora(); }
    } else if (e.mode === 'muda') {                         // MUDA barrage — lethal ring around him
      if (e.st % 3 === 0) { sfSfx.ora(); sparks.push({ x: e.x + (rnd() - 0.5) * 64, y: e.y - 18 - rnd() * 34, t: 8, color: '#ffe082', txt: 'MUDA' }); }
      if (e.st <= 0) { e.mode = 'recover'; e.st = 38; }
    } else if (e.mode === 'barrage') {                      // timestop knife wall (placed in startBarrage)
      if (dioStopT <= 0 && e.st <= 0) { e.mode = 'recover'; e.st = 34; }
    } else if (e.mode === 'roller') {                       // the road roller does the work
      if (!roadRoller && e.st <= 0) { e.mode = 'recover'; e.st = 44; }
    } else if (e.mode === 'recover') {
      if (e.st <= 0) { e.mode = 'idle'; e.st = 38 + rnd() * 26; }   // a real breather between attacks
    }
  } else if (e.type === 'archer') {
    // skeleton archer: keep range, telegraph, loose an arrow
    e.st--;
    if (e.mode === 'approach') {
      const hz = shamanHaste(e);
      if (d > 270) { e.x += dx / d * e.spd * hz; e.y += dy / d * e.spd * hz; e.phase += 0.16; }
      else if (d < 180) { e.x -= dx / d * e.spd * 0.8 * hz; e.y -= dy / d * e.spd * 0.8 * hz; e.phase += 0.14; }
      if (e.st <= 0 && d < 320) { e.mode = 'aim'; e.st = 26; }
      else if (e.st <= 0) e.st = 20;
    } else if (e.mode === 'aim') {
      if (e.st <= 0) {
        if (e.elite) {
          // volley archer: a three-arrow fan; the DEADEYE looses five, faster —
          // the gaps are the dodge either way
          const base = Math.atan2(dy, dx);
          const wide = e.elite === 2 ? 2 : 1;
          const spd = e.elite === 2 ? 5.4 : 4.6;
          const step = e.elite === 2 ? 0.14 : 0.17;
          for (let vi = -wide; vi <= wide; vi++) {
            const a = base + vi * step;
            arrows.push({ x: e.x, y: e.y - 18, vx: Math.cos(a) * spd, vy: Math.sin(a) * spd, t: 240 });
          }
        } else {
          arrows.push({ x: e.x, y: e.y - 18, vx: dx / d * 4.6, vy: dy / d * 4.6, t: 240 });
        }
        sfSfx.arrow();
        e.mode = 'cool'; e.st = 110 + rnd() * 60;
      }
    } else { // cool
      if (d < 170) { e.x -= dx / d * e.spd * 0.8; e.y -= dy / d * e.spd * 0.8; e.phase += 0.14; }
      if (e.st <= 0) { e.mode = 'approach'; e.st = 40; }
    }
  } else { // wolf: stalk → aim (telegraph) → lunge → rest
    e.st--;
    if (e.mode === 'stalk') {
      const hz = shamanHaste(e);   // hasted stalking — the lunge itself stays honest
      e.x += dx / d * e.spd * hz; e.y += dy / d * e.spd * hz; e.phase += 0.15;
      if (e.st <= 0) {
        if (d < 380) { e.mode = 'aim'; e.st = 30; }
        else e.st = 30;
      }
    } else if (e.mode === 'aim') {
      if (e.st <= 0) {
        e.mode = 'lunge'; e.st = 26;
        e.lx = dx / d; e.ly = dy / d;
        sfSfx.lunge();
      }
    } else if (e.mode === 'lunge') {
      e.x += e.lx * (6.2 + wave * 0.25); e.y += e.ly * (6.2 + wave * 0.25);
      e.phase += 0.55;
      if (e.st <= 0) { e.mode = 'rest'; e.st = 26; }
    } else { // rest
      if (e.st <= 0) { e.mode = 'stalk'; e.st = 70 + rnd() * 50; }
    }
  }
  e.x = clamp(e.x, -60, GW + 60);
  e.y = clamp(e.y, -60, GH + 60);
}

// ── boss-intro — BOSS_INTROS cards, codec box, small draw utils (hexA, roundRectPath, wrapText) ──
/* ── boss intros: a Smash-style "CHALLENGER APPROACHING" card, then an
   MGS-style codec entrance with a typing dialogue box, before the fight ── */
const BOSS_INTROS = {
  witchking: {
    name: 'THE WITCH-KING', title: 'LORD OF THE NAZGÛL',
    deep: '#150c1b', accent: '#7e57c2', glow: '#c3a4ff', col: '#14101c', sfx: 'screech',
    pose: () => ({ x: player.x - 100, y: 0, mounted: false, mode: 'idle', flailAng: -0.7, phase: 0 }),
    draw: (e, c) => drawWitchKing(e, c),
    lines: [
      { by: 'THE WITCH-KING', text: 'You fool. No living man may hinder me.' },
      { by: 'THE WITCH-KING', text: 'I will bear you away to a house of lamentation.' },
    ],
  },
  vader: {
    name: 'DARTH VADER', title: 'DARK LORD OF THE SITH',
    deep: '#1a0608', accent: '#e23b3b', glow: '#ff8a80', col: '#101014', sfx: 'saber',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'hover', phase: 0, disarmed: false, slashAng: 0 }),
    draw: (e, c) => drawVader(e, c),
    lines: [
      { by: 'DARTH VADER', text: 'I have been waiting for you.' },
      { by: 'DARTH VADER', text: 'When I left you, I was but the learner. Now I am the master.' },
    ],
  },
  sidious: {
    name: 'DARTH SIDIOUS', title: 'THE EMPEROR',
    deep: '#140a1c', accent: '#9a4ddb', glow: '#caa6ff', col: '#0b0b12', sfx: 'zap',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'idle', lit: 1, phase: 0, phase2: false, hop: 0 }),
    draw: (e, c) => drawSidious(e, c),
    lines: [
      { by: 'DARTH SIDIOUS', text: 'At last we meet again.' },
      { by: 'DARTH SIDIOUS', text: 'I have been expecting you. Welcome... to your end.' },
    ],
  },
  dio: {
    name: 'DIO', title: 'THE WORLD',
    deep: '#170f24', accent: '#ffc400', glow: '#fff59d', col: '#1f1b29', sfx: 'zawarudo',
    pose: () => ({ x: player.x - 100, y: 0, mode: 'idle', phase: 0, crumble: 0, stand: 0 }),
    draw: (e, c) => drawDio(e, c),
    lines: [
      { by: 'DIO', text: 'You thought you could rest, hero?' },
      { by: 'DIO', text: 'MUDA MUDA MUDA! Let me show you... THE WORLD.' },
    ],
  },
  ian: {
    name: 'IAN', title: 'THE CREATOR',
    deep: '#1a1338', accent: '#ff9ec4', glow: '#bfe6ff', col: '#e8eef5', sfx: 'blip',
    pose: () => ({ x: 0, y: 0, mode: 'plead', phase: 0, crumble: 0, fade: 1 }),
    draw: (e, c) => drawIan(e, c),
    lines: [
      { by: '???', text: 'wait — wait. please. it\'s me.' },
      { by: 'IAN', text: 'I made all of this. the goblins, the Nazgûl, DIO... you.' },
      { by: 'IAN', text: 'and I\'m not even armed. so... it\'s your call now.' },
    ],
  },
};
const eOut = (u) => 1 - (1 - u) * (1 - u);
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return 'rgba(' + ((n >> 16) & 255) + ',' + ((n >> 8) & 255) + ',' + (n & 255) + ',' + a + ')';
}
function roundRectPath(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function wrapText(text, x, y, maxW, lh) {
  const words = text.split(' ');
  let line = '';
  for (const w of words) {
    const test = line ? line + ' ' + w : w;
    if (ctx.measureText(test).width > maxW && line) { ctx.fillText(line, x, y); line = w; y += lh; }
    else line = test;
  }
  if (line) ctx.fillText(line, x, y);
}
function beginBossIntro(key, spawnFn) {
  const cfg = BOSS_INTROS[key];
  if (!cfg) { spawnFn && spawnFn(); return; }
  bossIntro = { key, cfg, spawnFn, phase: 'approach', t: 0, lineIdx: 0, chars: 0, holdT: 0 };
  shake = 0;
  sfSfx.challenger();
}
function nextBossLine() {
  const bi = bossIntro;
  bi.lineIdx++; bi.chars = 0; bi.holdT = 0;
  if (bi.lineIdx >= bi.cfg.lines.length) finishBossIntro();
}
function finishBossIntro() {
  const fn = bossIntro.spawnFn;
  bossIntro = null;
  keys = {};
  if (fn) fn();
}
// confirm key (Z / X / Space / Enter): proceed from the card, snap/advance the dialogue
function advanceBossIntro() {
  const bi = bossIntro;
  if (bi.phase === 'approach') {
    bi.phase = 'entrance'; bi.t = 0; bi.lineIdx = 0; bi.chars = 0; bi.holdT = 0;
    if (sfSfx[bi.cfg.sfx]) sfSfx[bi.cfg.sfx]();   // the boss's signature roar
    return;
  }
  const line = bi.cfg.lines[bi.lineIdx];
  if (bi.chars < line.text.length) { bi.chars = line.text.length; bi.holdT = 0; }  // snap the line in
  else nextBossLine();
}
// a large vector portrait of the boss, reusing its in-game sprite, scaled about (cx,cy=feet)
function drawBossPortrait(cfg, cx, cy, scale) {
  const e = cfg.pose();
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(scale, scale);
  ctx.translate(-e.x, -e.y);
  cfg.draw(e, cfg.col);
  ctx.restore();
}
function drawCodecBox(cfg, bi) {
  const { accent, glow } = cfg;
  const m = 22, boxX = m, boxY = 16, boxW = GW - m * 2, boxH = 94;
  ctx.save();
  ctx.fillStyle = 'rgba(6,8,12,0.93)'; roundRectPath(boxX, boxY, boxW, boxH, 6); ctx.fill();
  ctx.strokeStyle = accent; ctx.lineWidth = 2; roundRectPath(boxX, boxY, boxW, boxH, 6); ctx.stroke();
  // face chip
  const chip = boxH - 22, cx0 = boxX + 12, cy0 = boxY + 11;
  ctx.save();
  roundRectPath(cx0, cy0, chip, chip, 4); ctx.clip();
  const fg = ctx.createLinearGradient(cx0, cy0, cx0, cy0 + chip);
  fg.addColorStop(0, hexA(glow, 0.16)); fg.addColorStop(1, '#08080d');
  ctx.fillStyle = fg; ctx.fillRect(cx0, cy0, chip, chip);
  drawBossPortrait(cfg, cx0 + chip / 2, cy0 + chip * 1.5, (chip * 1.25) / 55);
  ctx.restore();
  ctx.strokeStyle = glow; ctx.lineWidth = 1.5; roundRectPath(cx0, cy0, chip, chip, 4); ctx.stroke();
  // scanline tint over the chip
  ctx.save(); roundRectPath(cx0, cy0, chip, chip, 4); ctx.clip();
  ctx.globalAlpha = 0.12; ctx.fillStyle = glow;
  for (let yy = cy0; yy < cy0 + chip; yy += 3) ctx.fillRect(cx0, yy, chip, 1);
  ctx.restore();
  // speaker + typed line
  const line = bi.cfg.lines[bi.lineIdx];
  const tx = cx0 + chip + 16, tw = boxW - (tx - boxX) - 16;
  ctx.textAlign = 'left';
  ctx.fillStyle = accent; ctx.font = 'bold 13px Tahoma,Arial';
  ctx.fillText(line.by, tx, boxY + 26);
  ctx.strokeStyle = hexA(accent, 0.5); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(tx, boxY + 32); ctx.lineTo(tx + tw, boxY + 32); ctx.stroke();
  ctx.fillStyle = '#e8eef5'; ctx.font = '15px Tahoma,Arial';
  wrapText(line.text.slice(0, Math.floor(bi.chars)), tx, boxY + 54, tw, 20);
  if (bi.chars >= line.text.length && (api.reduceMotion || Math.floor(bi.t / 16) % 2 === 0)) {
    ctx.fillStyle = glow; ctx.font = 'bold 14px Tahoma,Arial';
    ctx.fillText('▼', boxX + boxW - 24, boxY + boxH - 12);
  }
  // progress pips
  ctx.textAlign = 'right';
  ctx.fillStyle = hexA(glow, 0.8); ctx.font = '11px Tahoma,Arial';
  ctx.fillText(bi.cfg.lines.map((_, i) => i <= bi.lineIdx ? '●' : '○').join(' '), boxX + boxW - 14, boxY + 24);
  ctx.restore();
  ctx.textAlign = 'left';
}
function drawBossIntro() {
  const bi = bossIntro, cfg = bi.cfg; bi.t++;
  const { accent, glow, deep } = cfg;
  ctx.save();
  ctx.textAlign = 'left';

  if (bi.phase === 'approach') {
    const t = bi.t;
    ctx.fillStyle = deep; ctx.fillRect(0, 0, GW, GH);
    // radial vignette
    const vg = ctx.createRadialGradient(GW * 0.5, GH * 0.46, 30, GW * 0.5, GH * 0.5, GW * 0.7);
    vg.addColorStop(0, hexA(glow, 0.10)); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    // sweeping diagonal hazard stripes
    ctx.save();
    ctx.translate(GW / 2, GH / 2); ctx.rotate(-0.46);
    ctx.globalAlpha = 0.09; ctx.fillStyle = accent;
    const off = api.reduceMotion ? 0 : (t * 1.4) % 86;
    for (let x = -GW; x < GW * 1.5; x += 86) ctx.fillRect(x + off, -GH, 40, GH * 2);
    ctx.restore();

    // glow + portrait sliding in from the right with an ease-out overshoot
    const ps = eOut(Math.min(1, t / 22));
    const px = GW * 0.66 + (1 - ps) * GW * 0.55;
    const sc = (GH * 0.62) / 55 * (0.92 + 0.08 * ps);
    if (!api.reduceMotion) {
      const gl = ctx.createRadialGradient(px, GH * 0.5, 10, px, GH * 0.5, GH * 0.55);
      gl.addColorStop(0, hexA(glow, 0.4)); gl.addColorStop(1, hexA(glow, 0));
      ctx.fillStyle = gl; ctx.fillRect(0, 0, GW, GH);
    }
    ctx.save(); ctx.globalAlpha = Math.min(1, t / 9);
    drawBossPortrait(cfg, px, GH * 0.5 + GH * 0.29, sc);
    ctx.restore();

    // slanted name band sliding in from the left
    const bandY = GH * 0.60, slide = eOut(Math.min(1, t / 18));
    const bx = -GW * (1 - slide);
    ctx.save();
    ctx.globalAlpha = 0.94; ctx.fillStyle = accent;
    ctx.beginPath();
    ctx.moveTo(bx, bandY); ctx.lineTo(bx + GW + 80, bandY - 20);
    ctx.lineTo(bx + GW + 80, bandY + 60); ctx.lineTo(bx, bandY + 80);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(bx, bandY + 62, GW + 160, 4);
    // name + title on the band
    ctx.globalAlpha = 1; ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 6;
    ctx.fillStyle = '#fff'; ctx.font = 'italic bold 40px Tahoma,Arial'; ctx.textAlign = 'left';
    ctx.fillText(cfg.name, 40, bandY + 30);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(0,0,0,0.85)'; ctx.font = 'bold 15px Tahoma,Arial';
    ctx.fillText(cfg.title, 42, bandY + 54);
    ctx.restore();

    // top kicker
    const top = eOut(Math.min(1, t / 16));
    ctx.save();
    ctx.globalAlpha = top * (api.reduceMotion ? 1 : 0.7 + 0.3 * Math.sin(t * 0.12));
    ctx.fillStyle = glow; ctx.font = 'italic bold 26px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = hexA(accent, 0.9); ctx.shadowBlur = 12;
    ctx.fillText('⚠  CHALLENGER  APPROACHING  ⚠', GW / 2, 56);
    ctx.restore();

    // prompt
    ctx.save();
    ctx.globalAlpha = 0.6 + 0.4 * Math.sin(t * 0.16);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 15px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('▶  press  Z  to face them  ◀', GW / 2, GH - 22);
    ctx.restore();
    hud.innerHTML = 'CHALLENGER APPROACHING<br>press Z to begin the duel';
  } else {
    // entrance: the boss looms over a dimmed field while the codec box types
    ctx.fillStyle = 'rgba(0,0,0,0.62)'; ctx.fillRect(0, 0, GW, GH);
    const rise = eOut(Math.min(1, bi.t / 26));
    // floor glow
    ctx.save();
    const fg = ctx.createRadialGradient(GW / 2, GH * 0.94, 8, GW / 2, GH * 0.94, GW * 0.4);
    fg.addColorStop(0, hexA(glow, 0.22)); fg.addColorStop(1, hexA(glow, 0));
    ctx.fillStyle = fg; ctx.fillRect(0, GH * 0.6, GW, GH * 0.4);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = rise;
    drawBossPortrait(cfg, GW / 2, GH * 0.93 + (1 - rise) * 70, (GH * 0.52) / 55);
    ctx.restore();

    // advance the typewriter
    const line = cfg.lines[bi.lineIdx];
    if (bi.chars < line.text.length) {
      const before = Math.floor(bi.chars);
      bi.chars = Math.min(line.text.length, bi.chars + (api.reduceMotion ? 2.4 : 0.62));
      if (Math.floor(bi.chars) > before && Math.floor(bi.chars) % 2 === 0 && line.text[before] !== ' ') sfSfx.blip();
      bi.holdT = 0;
    } else {
      bi.holdT++;
      if (bi.holdT > 96) nextBossLine();
    }
    if (bossIntro) drawCodecBox(cfg, bi);   // nextBossLine() may have ended the intro
    hud.innerHTML = 'a foe steps forward...<br>Z to advance';
  }
  ctx.restore();
  ctx.textAlign = 'left';
}

// ── loop — the fixed-timestep frame driver and loop() — one sim tick + one render, fused ──
/* ── main loop ── */
// rAF driver on a FIXED TIMESTEP: the sim advances SIM_HZ × SF_SPEED ticks per
// second of wall-clock time, independent of the display's refresh rate — a 120 Hz
// monitor renders more often but simulates no faster (before this, sim speed
// scaled with refresh rate). loop() is one sim tick + a render, fused — catch-up
// ticks simply redraw, and (important for determinism) any rnd() consumed in
// render code still runs exactly once per tick. The accumulator is capped so a
// backgrounded tab doesn't fast-forward the horde on return, and a hard per-frame
// step cap drops the remainder rather than spiraling.
let lastFrameTs = null;
function frameStep(ts) {
  rafId = requestAnimationFrame(frameStep);
  const now = (typeof ts === 'number') ? ts : performance.now();
  if (lastFrameTs === null) lastFrameTs = now;
  const dt = Math.max(0, Math.min(0.25, (now - lastFrameTs) / 1000));
  lastFrameTs = now;
  simAcc += dt * SIM_HZ * SF_SPEED;
  let steps = Math.floor(simAcc);
  simAcc -= steps;
  if (steps > 5) steps = 5;   // hard cap — drop the excess, never spiral
  for (let i = 0; i < steps; i++) {
    // the LOCKSTEP gate: online, a tick only runs once BOTH peers' input frames
    // for it are buffered (this covers every tick — menus and death screen too,
    // since tick advances there and pause duration is part of determinism)
    if (netplay && started && !netCanStep()) { simAcc = 0; netStall++; break; }
    if (netplay) netStall = 0;
    loop();
  }
  // a badge over the frozen frame (render-only). netRecon = the link actually died
  // and is being re-signaled (see netStartRecon); a plain stall = the link is alive
  // but the peer is lagging or tabbed away — deliberately NOT a reconnect trigger.
  if (netplay && started) {
    if (netReconActive()) drawNetRecon();
    else if (netStall > 30) drawNetWait();
  }
}

function loop() {
  tick++;                          // the deterministic sim clock — advances once per logical tick

  /* replay feeder: apply every recorded event stamped up to this tick, BEFORE any
     game logic — pend actions land exactly where the pend consumer will eat them,
     masks land before the input sampler, and menu/cutscene events (buy / continue /
     intro-advance / Ian) land in the same between-ticks slot they were recorded in */
  if (replayMode && replay) {
    const ev = replay.d.ev;
    while (replay.i < ev.length && ev[replay.i][0] <= tick) {
      const e = ev[replay.i++];
      switch (e[1]) {
        case 0: repMask = e[2] | 0; break;
        case 1: pend.dashP1 = true; break;
        case 2: pend.atkP1 = true; break;
        case 3: pend.dashP2 = true; break;
        case 4: pend.atkP2 = true; break;
        case 5: pend.summon = ['gandalf', 'luke', 'jotaro'][e[2]] || null; break;
        case 6: pend.mash += e[2] | 0; break;
        case 7: { const u = availableUpgrades().find((x) => x.id === e[2]); if (u && upMenu) buyUpgrade(u); break; }
        case 8: if (upMenu) finishUpgrades(); break;
        case 9: if (bossIntro) advanceBossIntro(); break;
        case 10: if (ianChoice) chooseIan(e[2] ? 1 : 0); break;
        case 11: if (e[2]) pend.cycleP2 = true; else pend.cycleP1 = true; break;
        case 12: if (boonMenu) pickBoon(e[2]); break;
        case 13: shellToggle(); break;   // the recorded pause — replays hold the same beats
      }
    }
  }

  /* netplay feeder — the lockstep twin of the replay feeder above. Runs every tick
     (menus, death screen and all — frames must keep flowing or both peers stall):
     1. sample the LOCAL held-keys + staged edges into a frame for tick+NET_DELAY,
        buffer it and send it (frameStep's gate guarantees the remote does the same);
     2. apply host menu events stamped up to this tick (same opcodes as replay);
     3. apply BOTH players' buffered frames for THIS tick into pend/netMask. */
  if (netplay && started) {
    const nt = tick + NET_DELAY;
    const mine = netFrames[netSeat];
    if (!mine.has(nt)) {
      let lm = 0;   // every seat plays with the full solo bindings (arrows OR WASD)
      if (keys['ArrowLeft'] || keys['a']) lm |= 1;
      if (keys['ArrowRight'] || keys['d']) lm |= 2;
      if (keys['ArrowUp'] || keys['w']) lm |= 4;
      if (keys['ArrowDown'] || keys['s']) lm |= 8;
      const f = { m: lm,
                  e: (netLocal.dash ? 1 : 0) | (netLocal.atk ? 2 : 0) | (netLocal.cycle ? 4 : 0),
                  s: netLocal.summon, h: netLocal.mash };
      netLocal.dash = netLocal.atk = netLocal.cycle = false; netLocal.summon = -1; netLocal.mash = 0;
      mine.set(nt, f);
      netSend({ t: 'f', r: netRunId, p: netSeat, k: nt, m: f.m, e: f.e, s: f.s, h: f.h });
    }
    while (netEvents.length && netEvents[0][0] <= tick) {
      const ev = netEvents.shift();
      switch (ev[1]) {
        case 7: { const u = availableUpgrades().find((x) => x.id === ev[2]); if (u && upMenu) buyUpgrade(u); break; }
        case 8: if (upMenu) finishUpgrades(); break;
        case 9: if (bossIntro) advanceBossIntro(); break;
        case 10: if (ianChoice) chooseIan(ev[2] ? 1 : 0); break;
        case 12: if (boonMenu) pickBoon(ev[2]); break;
      }
    }
    // apply EVERY seat's frame for THIS tick (the gate guaranteed they're here)
    const fs = netFrames.map((fm) => fm.get(tick));
    if (fs.every(Boolean)) {
      netMask = (fs[0].m & 15) | (((fs[1] ? fs[1].m : 0) & 15) << 4);   // P1 low nibble, P2 high
      netMasks[2] = fs[2] ? fs[2].m & 15 : 0;   // P3/P4 movement reads these directly
      netMasks[3] = fs[3] ? fs[3].m & 15 : 0;
      const DASH = ['dashP1', 'dashP2', 'dashP3', 'dashP4'];
      const ATK  = ['atkP1', 'atkP2', 'atkP3', 'atkP4'];
      const CYC  = ['cycleP1', 'cycleP2', 'cycleP3', 'cycleP4'];
      const SUM  = ['summon', 'summon2', 'summon3', 'summon4'];
      for (let i = 0; i < fs.length; i++) {
        if (fs[i].e & 1) pend[DASH[i]] = true;
        if (fs[i].e & 2) pend[ATK[i]] = true;
        if (fs[i].e & 4) pend[CYC[i]] = true;
        if (fs[i].s >= 0) pend[SUM[i]] = ['gandalf', 'luke', 'jotaro'][fs[i].s] || null;
      }
      if (fs[0].h > 0) pend.mash += fs[0].h;   // the Force choke grips P1 — only seat 0 mashes count
      // spent frames are dropped; our OWN seat keeps a trailing 30-tick window so
      // a reconnect resume can re-send anything a drop swallowed (transport
      // bookkeeping only — never read by the sim, so determinism is untouched)
      for (let i = 0; i < netFrames.length; i++) {
        netFrames[i].delete(i === netSeat ? tick - 30 : tick);
      }
    }
    if (tick % 60 === 0) netChecksum();
  }

  /* intro screen — a proper title scene + character creation (see drawIntroScreen;
     the onKey intro handler owns the row navigation) */
  if (!started) {
    if (netUi) {   // the HOST/JOIN connect screens live where the intro would be
      drawNetScreen();
      drawTrophyToasts();
      hud.innerHTML = '🌐 ONLINE CO-OP<br>Q backs out';
      frame++;
      return;
    }
    drawIntroScreen();
    drawTrophyToasts();
    hud.innerHTML = 'BEST: ' + best + ' · ' +
      (menuTop === 1 ? (subMulti === 0 ? '2-PLAYER' : subMulti === 1 ? '🌐 HOST' : '🌐 JOIN')
                     : (subSingle === 2 ? '☀ DAILY' : subSingle === 1 ? '☠ HARD' : '1-PLAYER')) +
      '<br>double-click icon to quit';
    frame++;
    return;
  }

  /* death animation + game-over screen */
  if (!alive) {
    // the KILL CAM plays first — it advances itself once per loop call (= per
    // tick), and any key skips it; deadT holds so the fall animation still plays
    if (killCam) { drawKillCam(); return; }
    deadT++;
    ctx.clearRect(0, 0, GW, GH);
    if (started && !swActive && !jojoActive && !ianActive) drawBattlefield();
    if (stone) drawStone();
    for (const e of enemies) drawEnemy(e);
    const fall = Math.min(1, deadT / 28);
    heroFigure(player.x, player.y, 0, 'white', player.cls, player.fx >= 0 ? 1 : -1, 1, 1 - fall * 0.4, fall * Math.PI / 2);
    if (coop && p2) heroFigure(p2.x, p2.y, 0, P2_COL, p2.cls, p2.fx >= 0 ? 1 : -1, 1, 1 - fall * 0.4, fall * Math.PI / 2);
    if (deadT > 34) {
      drawDeathScreen();
      hud.innerHTML = replayMode               ? '▶ replay over · Q to return'
                    : netplay                  ? (netIsHost ? '🌐 R — rematch · Q — leave' : '🌐 the host rematches with R · Q — leave')
                    : watchSel                 ? '↑↓ choose a legend · ENTER to watch'
                    : watchErr                 ? '▶ ' + watchErr + ' · R to play'
                    : lbState === 'enter'      ? 'type your name · ENTER to submit'
                    : lbState === 'loading'    ? 'reaching the hall of legends…'
                    : lbState === 'submitting' ? 'recording your legend…'
                    : 'press R to play again';
    }
    drawTrophyToasts();   // a trophy earned in the dying beat still shows
    return;
  }

  /* a paused overlay — a boon offer, or the upgrade shop between waves */
  if (paused) {
    if (boonMenu) drawBoonPanel();
    else if (upMenu) drawUpgradePanel();
    else if (shellMenu) drawShellMenu();
    drawTrophyToasts();
    hud.innerHTML = netplay && boonMenu && (boonMenu.who | 0) !== netSeat
      ? '⏳ Player ' + ((boonMenu.who | 0) + 1) + ' is choosing…<br>(everyone picks their OWN boon)'
      : shellMenu ? 'PAUSED — settings<br>↑↓ rows · ◀ ▶ change · P resumes'
      : (boonMenu
        ? (boonMenu.bane ? 'a bane must be borne' : (coop ? 'P' + ((boonMenu.who | 0) + 1) + ' — your boon is offered' : 'a boon is offered')) + '<br>◀ ▶ choose · Z takes it'
        : ((upMenu && upMenu.title) || ('WAVE ' + wave + ' CLEARED')) + '<br>spend tokens · ' + tokens + ' left'
          + (netplay ? '<br>🌐 you both shop · Continue closes it for both' : ''));
    return;
  }

  /* boss intro card / codec entrance — freeze the field, overlay the cutscene */
  // the presentation clock still runs under the intro card (tick already does) —
  // without this, Ian's talking flap freezes mid-plea on his card
  if (bossIntro) { frame++; drawBossIntro(); return; }

  frame++;

  /* ── HIT-STOP: on a heavy impact the whole sim holds its breath for a few
     ticks and falls straight through to the render — the frozen frame IS the
     impact. The feeders above already ran (frames/events keep flowing online),
     pend edges queue up and land when the world unfreezes, and the living
     camera keeps moving over the stillness. Labeled block so the untouched
     gameplay section below needs no re-indentation. ── */
  simStep: {
  if (hitStop > 0) { hitStop--; break simStep; }

  /* per-tick input: queued edge-triggered presses enter the sim only here, on the
     tick boundary (see resetPend) — with the held-key reads just below, this is the
     sim's complete input surface for this tick (the replay/lockstep capture point) */
  if (pend.dashP1) { pend.dashP1 = false; recPush([tick, 1]); tryDash(player); }
  if (pend.atkP1)  { pend.atkP1 = false;  recPush([tick, 2]); tryAttack(player); }
  if (pend.cycleP1) { pend.cycleP1 = false; recPush([tick, 11, 0]); cycleSpell(player); }
  if (coop && p2) {
    if (pend.dashP2) { pend.dashP2 = false; recPush([tick, 3]); tryDash(p2); }
    if (pend.atkP2)  { pend.atkP2 = false;  recPush([tick, 4]); tryAttack(p2); }
    if (pend.cycleP2) { pend.cycleP2 = false; recPush([tick, 11, 1]); p2.cls === 'rider' ? tryBreath(p2) : cycleSpell(p2); }
    if (p3) {   // seats 3/4 exist only online — the recorder is disarmed there
      if (pend.dashP3) { pend.dashP3 = false; tryDash(p3); }
      if (pend.atkP3)  { pend.atkP3 = false;  tryAttack(p3); }
      if (pend.cycleP3) { pend.cycleP3 = false; cycleSpell(p3); }
    }
    if (p4) {
      if (pend.dashP4) { pend.dashP4 = false; tryDash(p4); }
      if (pend.atkP4)  { pend.atkP4 = false;  tryAttack(p4); }
      if (pend.cycleP4) { pend.cycleP4 = false; cycleSpell(p4); }
    }
  } else { pend.dashP2 = false; pend.atkP2 = false; pend.cycleP2 = false; }
  if (pend.summon) {
    const sk = pend.summon; pend.summon = null;
    recPush([tick, 5, ['gandalf', 'luke', 'jotaro'].indexOf(sk)]);
    trySummon(sk);
  }
  if (pend.summon2) {   // netplay only — the joiners' summons, after the host's, in seat order (deterministic meter spend)
    const sk = pend.summon2; pend.summon2 = null;
    trySummon(sk);
  }
  if (pend.summon3) { const sk = pend.summon3; pend.summon3 = null; trySummon(sk); }
  if (pend.summon4) { const sk = pend.summon4; pend.summon4 = null; trySummon(sk); }
  if (pend.prompt) { pend.prompt = false; championPrompt(); }   // banner only — not recorded
  if (player.choke <= 0) pend.mash = 0;   // mashes only mean anything mid-choke

  /* held-direction sampling — one mask covers every movement source, so it is the
     exact thing the recorder stores and the replayer feeds back.
     bits: 1 ← · 2 → · 4 ↑ · 8 ↓ (arrows) · 16 a · 32 d · 64 w · 128 s (WASD) */
  let im;
  if (replayMode) im = repMask;
  else if (netplay) im = netMask;   // the combined lockstep mask (fed above) — never the live keys
  else {
    im = 0;
    if (keys['ArrowLeft'])  im |= 1;
    if (keys['ArrowRight']) im |= 2;
    if (keys['ArrowUp'])    im |= 4;
    if (keys['ArrowDown'])  im |= 8;
    if (keys['a'] || keys['A']) im |= 16;
    if (keys['d'] || keys['D']) im |= 32;
    if (keys['w'] || keys['W']) im |= 64;
    if (keys['s'] || keys['S']) im |= 128;
    if (im !== recLastM) { recPush([tick, 0, im]); recLastM = im; }
  }

  /* input → acceleration + friction (P1) */
  let ix = 0, iy = 0;
  // P1 always reads the arrow keys; in single-player WASD also drives P1 (the classic
  // dual binding), but in co-op WASD is P2's, so it's excluded from P1 here.
  if ((im & 1) || (!coop && (im & 16))) ix = -1;
  if ((im & 2) || (!coop && (im & 32))) ix =  1;
  if ((im & 4) || (!coop && (im & 64))) iy = -1;
  if ((im & 8) || (!coop && (im & 128))) iy =  1;
  if (ix && iy) { ix *= 0.707; iy *= 0.707; }
  if (ix || iy) { player.fx = ix; player.fy = iy; }
  if (sidFinale || dioFinale || ianActive) { ix = 0; iy = 0; } // input locked — watch the cutscene
  if (dioStopT > 0) { ix = 0; iy = 0; }           // time stopped — you cannot move
  if (player.down) { ix = 0; iy = 0; }            // a fallen hero lies still until revived
  // Force choke: held aloft, input locked — break free by struggling (mashes queue in
  // onKey and are applied here, on the tick)
  if (player.choke > 0) {
    if (pend.mash > 0) { recPush([tick, 6, pend.mash]); player.chokeBreak += pend.mash; player.swingT = 6; sfSfx.saberHit(); pend.mash = 0; }
    ix = 0; iy = 0; player.choke--;
    if (player.chokeBreak >= 3) {                 // struggled free
      player.choke = 0; player.stunT = 0;
      const v = enemies.find(en => en.type === 'vader' && !en.dead);
      if (v) { v.stun = 26; v.mode = 'recover'; v.st = 28; }
      sparks.push({ x: player.x, y: player.y - 26, t: 18, color: '#9ec8ff', txt: 'BREAK FREE!' });
      sfSfx.saberHit();
    } else if (player.choke <= 0) { slayPlayer(); return; }  // never broke loose
    else { player.vy -= 0.35; }                   // lifted off the deck
  } else if (player.stunT > 0) { ix = 0; iy = 0; player.stunT--; }  // Force-push recoil
  moveHero(player, ix, iy);

  /* P2 (co-op only): WASD move, sharing the same physics. P2 is never Force-choked (that's
     P1-only), but a boss can Force-push it (when it's the focused target), and the
     cutscene/time-stop locks freeze it too. */
  if (coop && p2 && !p2.down) {
    let jx = 0, jy = 0;
    if (im & 16)  jx = -1;
    if (im & 32)  jx =  1;
    if (im & 64)  jy = -1;
    if (im & 128) jy =  1;
    if (jx && jy) { jx *= 0.707; jy *= 0.707; }
    if (jx || jy) { p2.fx = jx; p2.fy = jy; }
    if (sidFinale || dioFinale || ianActive || dioStopT > 0) { jx = 0; jy = 0; }
    if (p2.stunT > 0) { jx = 0; jy = 0; p2.stunT--; }   // Force-push recoil carries
    if (p2.cls === 'rider' && p2.mounted && !player.down) {
      // MOUNTED: the rider never steers — the keys above already set the turret
      // aim (p2.fx/fy); the body just rides the saddle. No moveHero at all.
      p2.x = player.x; p2.y = player.y - RIDER_SADDLE;
      p2.vx = 0; p2.vy = 0;
      if (p2.iframe > 0) p2.iframe--;
    } else {
      if (p2.cls === 'rider') p2.mounted = false;   // the wyrm fell — thrown to your feet
      moveHero(p2, jx, jy);
      // an unhorsed rider REMOUNTS by reaching the living wyrm (the revive verb's twin)
      if (p2.cls === 'rider' && !p2.mounted && !player.down && player.cls === 'wyrm' &&
          Math.hypot(p2.x - player.x, p2.y - player.y) < up.remountR) {
        p2.mounted = true;
        sparks.push({ x: player.x, y: player.y - 40, t: 14, color: DRAGOON_COL, txt: 'MOUNTED' });
      }
    }
  }

  /* seats 3 and 4 (online war band only): the same physics, masks straight from
     the lockstep frames — no local keys, no mounted-rider special cases */
  for (const [hx, mi] of [[p3, 2], [p4, 3]]) {
    if (!hx || hx.down) continue;
    let kx = 0, ky = 0;
    const hm = netMasks[mi];
    if (hm & 1) kx = -1;
    if (hm & 2) kx = 1;
    if (hm & 4) ky = -1;
    if (hm & 8) ky = 1;
    if (kx && ky) { kx *= 0.707; ky *= 0.707; }
    if (kx || ky) { hx.fx = kx; hx.fy = ky; }
    if (sidFinale || dioFinale || ianActive || dioStopT > 0) { kx = 0; ky = 0; }
    if (hx.stunT > 0) { kx = 0; ky = 0; hx.stunT--; }
    moveHero(hx, kx, ky);
  }

  /* the dragoon's lance rides its velocity — the joust resolves right after movement
     and BEFORE the contact loop below, so a skewer lands before the body would.
     The wyrm tramples by the identical rules (and feeds the heat gauge). */
  for (const h of heroesLive()) if (h.cls === 'dragoon' || h.cls === 'wyrm') joustSweep(h);

  /* reviving a downed partner: stand close to one and a ring fills; let go and it drains */
  if (coop && p2) {
    for (const h of heroesAll()) {
      if (!h.down) continue;
      const helper = heroesLive().find(o => Math.hypot(o.x - h.x, o.y - h.y) < 34);
      if (helper) { if (++h.reviveT >= reviveNeed()) reviveHero(h); }
      else h.reviveT = Math.max(0, h.reviveT - 1);
    }
  }

  /* waves: the next one only begins once the field is cleared */
  if (breatherT > 0) {
    if (--breatherT === 0) {
      wave++;
      if (wave >= 5) sfUnlock('wave_5');
      if (wave >= 4 && player.cls === 'wyrm') sfUnlock('pair_bond');
      if (wave >= 10) sfUnlock('wave_10');
      if (wave >= 15) sfUnlock('deep_15');
      if (hardMode && wave >= 5) sfUnlock('hard_5');
      if (wave >= 6 && runFlawless) sfUnlock('unscathed');       // five waves, not one blow landed
      if (wave >= 5 && tick <= 3 * 60 * SIM_HZ) sfUnlock('swift'); // tick-based, so replays agree
      waveQuota = Math.min(30 + 10 * (partySize() - 1), bandScale(8 + wave * 3));
      if (up.shield) for (const h of heroesAll()) h.shield = true;   // the Aegis recharges for every hero at the dawn of each wave
      banner = 'WAVE ' + wave;
      bannerSub = { 2: 'the wolves are loosed', 3: 'skeleton archers nock their arrows', 4: 'the trolls have come' }[wave] || '';
      bannerT = 90;
      sfSfx.wave();
      if (wave === 3 && !ogreSpawned) {             // a war-ogre lumbers in alongside the wave-3 band
        ogreSpawned = true;
        const op = edgePoint();
        warns.push({ x: op.x, y: op.y, type: 'ogre', t: 75 });   // a longer telegraph for the brute
        bannerSub = 'a WAR-OGRE lumbers from the dark'; bannerT = 120;
      }
      if (wave === 5 && !nineDone) summonTheNine();  // the Nazgûl set piece
    }
  } else if (waveQuota <= 0 && enemies.length === 0 && warns.length === 0
             && !nineActive && !bossActive && bossRiseT <= 0
             && !awaitExit && !swActive && swFadeT <= 0 && !jojoActive && jojoCue <= 0
             && !ianActive && ianCue <= 0) {
    if (wave === 5) breatherT = BREATHER;  // wave 5's send-off comes from the Witch-king fight
    else offerUpgrade();                   // every other cleared wave → pick an upgrade
  }

  /* the eastward escape → a cut to the Star Wars corridor */
  if (awaitExit && player.x > GW - 24) { awaitExit = false; swFadeT = FADE_LEN; }
  if (swFadeT > 0 && --swFadeT === Math.floor(FADE_LEN / 2)) startStarWars();
  if (swActive) {
    if (swState === 'march' && !enemies.some(e => e.type === 'trooper' && e.mode === 'march')) {
      swState = 'ready'; swReadyT = 40;
      banner = 'FORMATION SET'; bannerSub = 'they take aim...'; bannerT = 80;
    } else if (swState === 'ready' && --swReadyT <= 0) {
      swState = 'fire'; banner = 'OPEN FIRE'; bannerSub = ''; bannerT = 70; sfSfx.blaster();
    }
    if (swTroopersLeft <= 0 && !vaderActive && swState === 'fire') {
      // the squad is down — the dark lord himself steps from the shadows
      vaderActive = true; swState = 'vader'; arrows = [];
      beginBossIntro('vader', () => {
        banishAllies();                          // the duel is his alone
        const vx = player.x < GW / 2 ? GW - 70 : 70;   // step from the far side, never on top of the player
        enemies.push(makeEnemy('vader', vx, GH / 2));
        banner = 'DARTH VADER'; bannerSub = 'the dark lord bars your path'; bannerT = 150;
        score += 500; addMeter(30);
        sfSfx.saber();
      });
    }
    // Vader has fallen, the upgrade is spent — the Emperor steps from the dark
    if (sidiousCue > 0 && --sidiousCue === 0) beginBossIntro('sidious', startSidious);
    // the Emperor's reveal: monologue plays, then the duel begins
    if (sidiousIntroT > 0 && --sidiousIntroT === 0) {
      banner = 'so be it'; bannerSub = '— Darth Sidious'; bannerT = 90;
      shake = 14; ltnFlash = Math.max(ltnFlash, 18); sfSfx.zap();
    }
    if (sidFinale) advanceSidiousFinale();           // the death cutscene plays out
  }

  if (dlg.length) {                                  // scripted dialogue queue (Sidious reveal, DIO's taunts)
    if (dlgT > 0) dlgT--;
    else { const ln = dlg.shift(); banner = ln.txt; bannerSub = ln.sub; bannerT = ln.hold; dlgT = ln.gap; }
  }

  /* the JoJo interlude: a stranger steps out of the dark once the Emperor is gone */
  if (jojoCue > 0 && --jojoCue === 0) beginBossIntro('dio', startJojo);
  if (dioFinale) advanceDioFinale();             // DIO's slow crumble plays out
  if (dioStopFx > 0) dioStopFx--;

  /* the final confrontation: the creator kneels once DIO is dust */
  if (ianCue > 0 && --ianCue === 0) beginBossIntro('ian', startIan);
  if (ianActive) {
    if (ianFinale) advanceIanFinale();
    else if (!ianChoice) {                 // a short beat after the card, then present the choice
      if (dlgT > 0) dlgT--;
      else ianChoice = { sel: 0, t: 0 };
    }
  }

  /* one of the fallen wraiths rises as the Witch-king of Angmar */
  if (bossRiseT > 0 && --bossRiseT === 0) {
    beginBossIntro('witchking', () => {
      enemies.push(makeEnemy('witchking', bossRiseX, bossRiseY));
      banner = 'the Witch-king of Angmar'; bannerSub = 'no living man may hinder him'; bannerT = 150;
      sfSfx.screech(); shake = 16;
    });
  }

  /* spawn warnings → enemies (each wave is a fixed war band) */
  const band = partySize() - 1;   // extra fighters bring a denser, faster horde
  const spawnEvery = Math.max(Math.max(14, 24 - band * 3), 92 - wave * 8 - band * 10);
  const maxFoes = Math.min(26 + band * 4, 7 + wave * 3 + band * 2);
  if (!nineActive && !awaitExit && !swActive && swFadeT <= 0 && breatherT <= 0 && !ianActive && ianCue <= 0 && waveQuota > 0 && frame > 50 && frame % spawnEvery === 0 && enemies.length + warns.length < maxFoes) {
    const p = edgePoint();
    warns.push({ x: p.x, y: p.y, type: rollType(), elite: rollElite(), t: 45 });
    waveQuota--;
  }
  for (let i = warns.length - 1; i >= 0; i--) {
    const w = warns[i];
    if (--w.t <= 0) { enemies.push(makeEnemy(w.type, w.x, w.y, w.elite)); warns.splice(i, 1); }
  }

  /* pickups */
  if (frame % 200 === 0 && coins.length < 3) {
    const p = farPoint(50);
    coins.push({ x: p.x, y: p.y, t: 620 });
  }
  if (frame > 800 && frame % 660 === 0 && powerups.length < 1 && !ianActive && !mournful && !jojoActive) {
    const p = farPoint(70);
    powerups.push({ x: p.x, y: p.y, kind: ['freeze', 'fire', 'bolt'][Math.floor(rnd() * 3)], t: 700 });
  }
  for (let i = coins.length - 1; i >= 0; i--) {
    const ck = coins[i];
    if (--ck.t <= 0) { coins.splice(i, 1); continue; }
    if (nearHero(ck.x, ck.y, 22)) {
      coins.splice(i, 1);
      mult = Math.min(6, mult + 1);
      score += 40 + (bn.gold ? 25 : 0);
      addMeter(bn.miser ? 0 : bn.gold ? 10 : 5);   // Miser's Curse starves the meter
      sfSfx.coin();
      sparks.push({ x: ck.x, y: ck.y, t: 20, color: '#ffd24d', txt: 'x' + mult });
    }
  }
  for (let i = powerups.length - 1; i >= 0; i--) {
    const pu = powerups[i];
    if (--pu.t <= 0) { powerups.splice(i, 1); continue; }
    const ph = nearHero(pu.x, pu.y, 24);   // the hero who grabbed it — blasts erupt from them
    if (ph) {
      powerups.splice(i, 1);
      if (pu.kind === 'freeze') {
        // frost nova — a ring of ice snaps out and encases only the foes it reaches
        sfSfx.freeze();
        fieldWashSet('130,200,255', 0.16, 45); addDecal(ph.x, ph.y, 'frost');   // (render-only)
        blasts.push({ kind: 'frost', x: ph.x, y: ph.y, r: 0, t: 0, life: 26 });
        let n = 0;
        for (const e of enemies) {
          // the great bosses shrug off the cold; everything else freezes solid
          if (e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'wraith') continue;
          if (Math.hypot(e.x - ph.x, e.y - ph.y) < FROST_R) { e.frozen = FROST_DUR; e.vx = 0; e.vy = 0; n++; }
        }
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#8fd8ff', txt: n ? 'FROZEN x' + n : 'frost nova' });
      } else if (pu.kind === 'fire') {
        // fireball — a billowing wall of flame erupts and engulfs the nearby mob
        sfSfx.bomb(); shake = 16;
        fieldWashSet('255,120,40', 0.18, 50); addDecal(ph.x, ph.y, 'scorch');   // (render-only)
        blasts.push({ kind: 'fire', x: ph.x, y: ph.y, r: 0, t: 0, life: 30 });
        knockback(ph.x, ph.y, FIRE_R, 220, 50);
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#ff8a65', txt: 'FWOOSH' });
      } else {
        // chain lightning — a bolt leaps from foe to foe, frying the whole chain
        sfSfx.zap(); shake = 10;
        const pts = [{ x: ph.x, y: ph.y - 16 }];
        const hit = new Set();
        let from = { x: ph.x, y: ph.y }, hops = 0;
        for (let j = 0; j < 6; j++) {                 // up to 6 jumps, each reaching ~260px
          let best = null, bestD = 260;
          for (const e of enemies) {
            if (e.dead || hit.has(e)) continue;
            // the great bosses are too mighty to be chained — grunts only
            if (e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'wraith') continue;
            const dd = Math.hypot(e.x - from.x, e.y - from.y);
            if (dd < bestD) { bestD = dd; best = e; }
          }
          if (!best) break;
          hit.add(best); hops++;
          pts.push({ x: best.x, y: best.y - 14 });
          from = best;
          const dmg = best.type === 'troll' ? 3 : best.type === 'ogre' ? 4 : 99;
          if (!best.hp || (best.hp -= dmg) <= 0) killEnemy(best);
          else { best.stun = Math.max(best.stun || 0, 26); sparks.push({ x: best.x, y: best.y - 30, t: 16, color: '#b3e5fc', txt: '⚡' }); }
        }
        enemies = enemies.filter(e => !e.dead);
        fieldWashSet('170,130,255', 0.16, 45);   // (render-only) the field strobes violet — one eased lift
        blasts.push({ kind: 'chain', pts, t: 0, life: 18 });
        sparks.push({ x: pu.x, y: pu.y - 36, t: 28, color: '#80d8ff', txt: hops ? 'CHAIN x' + hops : 'ZAP' });
      }
    }
  }
  // animate the active blasts: grow fire/frost fronts (embers, ice motes) or crackle the chain
  for (let i = blasts.length - 1; i >= 0; i--) {
    const b = blasts[i];
    b.t++;
    if (b.kind === 'fire' || b.kind === 'frost') {
      const grow = b.rMax || (b.kind === 'fire' ? FIRE_R : FROST_R);  // caster spells are tighter than the powerups
      b.r = grow * Math.min(1, b.t / (b.kind === 'fire' ? 12 : 9));
      if (b.t % 2 === 0) {
        // rolls consumed even under reduced motion — settings must not shift the RNG stream
        const ang = rnd() * Math.PI * 2, rr = b.r * (0.7 + rnd() * 0.35), hot = rnd() < 0.5;
        if (!api.reduceMotion) {
          if (b.kind === 'fire')
            sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 16, color: hot ? '#ffb74d' : '#ff7043', txt: '✦' });
          else
            sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 18, color: '#b3e5fc', txt: '❄' });
        }
      }
    } else if (b.kind === 'chain' && b.t % 2 === 0 && b.pts.length > 1) {
      const seg = b.pts[Math.floor(rnd() * (b.pts.length - 1)) + 1];
      const ox = rnd() * 16 - 8, oy = rnd() * 16 - 8;
      if (!api.reduceMotion) sparks.push({ x: seg.x + ox, y: seg.y + oy, t: 12, color: '#cff3ff', txt: '·' });
    }
    if (b.t >= b.life) blasts.splice(i, 1);
  }
  if (freezeT > 0) freezeT--;

  /* the sword in the stone (never during the Star Wars / JoJo interludes) */
  if (!swActive && !jojoActive && jojoCue <= 0 && !awaitExit && swFadeT <= 0 && !ianActive && ianCue <= 0 && !stone && heroesLive().some(h => h.cls === 'melee' && h.swordT <= 0 && !h.heldSaber) && --stoneCd <= 0) {
    const p = farPoint(80);
    stone = { x: p.x, y: p.y };
    if (!stoneSeen) {
      stoneSeen = true;
      banner = 'a sword in a stone...'; bannerSub = 'run to it and claim your destiny'; bannerT = 110;
    } else {
      sparks.push({ x: p.x, y: p.y - 40, t: 30, color: '#eceff1', txt: 'the sword returns' });
    }
  }
  // only a melee hero who isn't already holding a blade can pull the sword (it's theirs alone)
  const stoneGrabber = stone ? heroesLive().find(h => h.cls === 'melee' && !h.heldSaber && h.swordT <= 0 && Math.hypot(h.x - stone.x, h.y - stone.y) < PULL_R) : null;
  if (stoneGrabber) {
    stone = null; stoneCd = 150;   // a beat before the next stone (lets a co-op partner arm too, but not instantly)
    sfUnlock('excalibur');
    stoneGrabber.swordT = Math.round(SWORD_T * up.swordMul);   // Keen Edge holds the blade longer
    fieldWashSet('255,200,80', 0.2, 60);   // (render-only) the pull washes the whole field gold
    banner = '⚔ EXCALIBUR ⚔'; bannerSub = 'X — swing the blade'; bannerT = 100;
    sfSfx.sword(); shake = 8;
    knockback(stoneGrabber.x, stoneGrabber.y, 0, 0, 30);  // a stunned beat — nobody moves, nobody is shoved
  }
  // each hero's Excalibur counts down on its own; when one fades, queue a fresh stone
  for (const h of heroesAll()) {
    if (h.swordT > 0 && --h.swordT === 0) {
      stoneCd = 300;
      sparks.push({ x: h.x, y: h.y - 46, t: 30, color: '#eceff1', txt: 'the blade fades...' });
    }
  }
  /* the blue lightsaber on the corridor deck — claimed by whichever melee hero reaches it */
  const saberGrabber = saberPickup ? heroesLive().find(h => h.cls === 'melee' && !h.heldSaber && Math.hypot(h.x - saberPickup.x, h.y - saberPickup.y) < PULL_R) : null;
  if (saberGrabber) {
    saberPickup = null; saberGrabber.heldSaber = true;
    banner = 'A LIGHTSABER'; bannerSub = 'X — strike them down'; bannerT = 110;
    sfSfx.saber(); shake = 6;
  }
  for (const h of heroesAll()) if (h.swingT > 0) h.swingT--;

  /* the caster's clock: the well refills a sip per tick (kills top it up in
     resolveCast — see soul sparks), and pending incantations resolve */
  if (!sidFinale && !dioFinale && dioStopT <= 0 && !ianActive) {
    for (const h of heroesLive()) {
      if (h.cls !== 'caster') continue;
      // the well holds its breath for MANA_HOLD ticks after every cast — the
      // trickle only flows in the spaces BETWEEN casts (kill sparks still land)
      if (tick >= (h.manaHoldTick || 0)) h.mana = Math.min(up.manaMax, h.mana + MANA_REGEN * up.manaRegen);
      if (h.castT > 0 && --h.castT === 0) resolveCast(h);
    }
  }

  /* the necromancer's dead: husks crumble on their timers; minions hunt the
     horde, claw it (rangedHit rules), soak contact in return, and fall when
     their hp or time runs out. Boss rooms banish the lot, like champions. */
  if (champsBanned()) {
    if (minions.length || husks.length) {
      if (minions.length) sparks.push({ x: player.x, y: player.y - 46, t: 28, color: NECRO_COL, txt: 'your dead abandon you' });
      minions = []; husks = [];
    }
  } else if (!sidFinale && !dioFinale && dioStopT <= 0) {
    for (let i = husks.length - 1; i >= 0; i--) if (--husks[i].t <= 0) husks.splice(i, 1);
    for (let i = minions.length - 1; i >= 0; i--) {
      const m = minions[i];
      m.t--;
      if (m.hitCd > 0) m.hitCd--;
      if (m.hurtCd > 0) m.hurtCd--;
      if (m.shotCd > 0) m.shotCd--;
      if (m.t <= 0 || m.hp <= 0) {
        if (up.minionBoom) {                       // Deathburst — soul-fire on the way out
          blasts.push({ kind: 'frost', x: m.x, y: m.y, r: 0, t: 0, life: 18, rMax: 62 });
          knockback(m.x, m.y, 58, 90, 24);
          sfSfx.freeze();
        }
        sparks.push({ x: m.x, y: m.y - 24, t: 14, color: NECRO_COL, txt: '…' });
        minions.splice(i, 1); continue;
      }
      // hunt the nearest of the horde (support pieces are fair game; bosses are not its business)
      let prey = null, pd = 1e9;
      for (const e of enemies) {
        if (e.dead || untouchable(e)) continue;
        const t2 = e.type;
        if (!(t2 === 'goblin' || t2 === 'wolf' || t2 === 'archer' || t2 === 'troll' || t2 === 'shaman' || t2 === 'bomber' || t2 === 'ogre')) continue;
        const dd = Math.hypot(e.x - m.x, e.y - m.y);
        if (dd < pd) { pd = dd; prey = e; }
      }
      if (prey) {
        const dx = prey.x - m.x, dy = prey.y - m.y, d = pd || 1;
        const lope = up.trueForms && m.src === 'wolf' ? 2.3 : 1.55;   // True Forms: wolves remember how to run
        if (d > prey.kr + 10) { m.x += dx / d * lope; m.y += dy / d * lope; m.phase += 0.16; m.fx = dx / d || 1; }
        if (d < prey.kr + 16 && m.hitCd <= 0) {                        // claw the mark
          m.hitCd = 42;
          const k0 = kills;
          rangedHit(prey, up.minionDmg, dx / d, dy / d);
          if (kills > k0) {                                            // a minion's kill still feeds the master
            const boss = heroesLive().find(hh => hh.cls === 'necro');
            if (boss) boss.souls = Math.min(SOULS_MAX, boss.souls + (SOUL_MKILL + boss.bn.soulBonus) * (kills - k0));
          }
        }
        if (up.trueForms && m.src === 'archer' && m.shotCd <= 0 && d > 60 && d < 340) {
          m.shotCd = 105;                                              // spectral arrow — hero-safe, horde-lethal
          arrows.push({ x: m.x, y: m.y - 16, kind: 'parrow', vx: dx / d * 4.4, vy: dy / d * 4.4, t: 130, dmg: 1, pierce: 0, bounces: 0, hitSet: null });
          sfSfx.arrow();
        }
      } else {                                                         // no prey — shamble home to the master
        const necro = heroesLive().find(hh => hh.cls === 'necro') || player;
        const dx = necro.x - m.x, dy = necro.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (d > 60) { m.x += dx / d * 1.3; m.y += dy / d * 1.3; m.phase += 0.12; m.fx = dx / d || 1; }
        else m.phase += 0.05;
      }
      // the horde claws back — a grunt pressing on the minion wounds it
      if (m.hurtCd <= 0) {
        for (const e of enemies) {
          if (e.dead || e.frozen > 0 || e.stun > 0 || untouchable(e) || !(e.kr > 0)) continue;
          if (Math.hypot(e.x - m.x, e.y - m.y) < e.kr + 10) {
            m.hp--; m.hurtCd = 50;
            const bx = m.x - e.x, by = m.y - e.y, bd = Math.hypot(bx, by) || 1;
            m.x = clamp(m.x + bx / bd * 26, 14, GW - 14); m.y = clamp(m.y + by / bd * 26, 44, GH - 12);
            sparks.push({ x: m.x, y: m.y - 22, t: 10, color: '#ff8a80', txt: '·' });
            break;
          }
        }
      }
      m.x = clamp(m.x, 14, GW - 14); m.y = clamp(m.y, 44, GH - 12);
    }
  }

  /* the champion */
  if (frame % 90 === 0) addMeter(1);
  if (score >= 10000) sfUnlock('score_10k');
  if (meter >= up.summonCost && !champsBanned() && !meterPrompted && champUnlocked()) {
    meterPrompted = true;
    banner = 'summon an ally'; bannerSub = champReadyText(); bannerT = 150;
  }
  const nearest = (cx, cy, rad) => {
    let bestE = null, bd = rad;
    for (const e of enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - cx, e.y - cy);
      if (d < bd) { bd = d; bestE = e; }
    }
    return bestE;
  };
  for (let ci = allies.length - 1; ci >= 0; ci--) {
    const g = allies[ci];
    g.t--;
    if (g.kind === 'gandalf') {
      const tx = player.x + g.side * 70, ty = player.y;
      g.x += clamp(tx - g.x, -2.6, 2.6);
      g.y += clamp(ty - g.y, -2.6, 2.6);
      if (!g.arrived && Math.hypot(g.x - player.x, g.y - player.y) < 150) {
        g.arrived = true;
        shake = 12; sfSfx.bomb();
        knockback(g.x, g.y, 0, 240, 55);
      }
      if (--g.shotCd <= 0) {
        const t = nearest(g.x, g.y, 1e9);
        if (t) {
          const dx = t.x - g.x, dy = (t.y - 18) - (g.y - 24), d = Math.hypot(dx, dy) || 1;
          bolts.push({ x: g.x, y: g.y - 24, vx: dx / d * 7, vy: dy / d * 7, t: 120 });
          g.shotCd = 32;
          sfSfx.bolt();
        }
      }
    } else if (g.kind === 'luke') {
      if (g.slashCd > 0) g.slashCd--;
      if (g.slashT > 0) g.slashT--;
      const LUKE_R = 74, ENGAGE = 54;
      // commit to a foe until it falls or strays from the player — no more thrashing between targets
      if (!g.target || g.target.dead || Math.hypot(g.target.x - player.x, g.target.y - player.y) > 330) {
        g.target = nearest(player.x, player.y, 300);  // guards the player, doesn't roam the map
      }
      const t = g.target;
      if (t && !t.dead) {
        const dx = t.x - g.x, dy = t.y - g.y, d = Math.hypot(dx, dy) || 1;
        g.fx = dx / d; g.fy = dy / d;
        if (d > ENGAGE) { g.x += dx / d * 4.6; g.y += dy / d * 4.6; }   // close to striking range, then hold
        if (d <= LUKE_R && g.slashCd <= 0) {
          g.slashCd = 15; g.slashT = 8;
          sfSfx.saberHit();
          // a sweeping cleave — every foe in a wide arc ahead is cut down at once
          let felled = 0;
          for (const e of enemies) {
            if (e.dead) continue;
            const ex = e.x - g.x, ey = e.y - g.y, ed = Math.hypot(ex, ey) || 1;
            if (ed > LUKE_R + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
            if ((ex / ed) * g.fx + (ey / ed) * g.fy < -0.15) continue;  // ~200° front arc
            if (e.hp && (e.hp -= 2) > 0) { e.stun = 16; sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#aaff66', txt: 'SLASH' }); }
            else { killEnemy(e); felled++; }
          }
          if (felled > 1) sparks.push({ x: g.x, y: g.y - 38, t: 20, color: '#caffa0', txt: felled + ' DOWN' });
        }
      } else {
        const tx = player.x - g.side * 60, ty = player.y;
        g.x += clamp(tx - g.x, -3, 3);
        g.y += clamp(ty - g.y, -3, 3);
      }
      for (let i = arrows.length - 1; i >= 0; i--) {  // the whirling saber bats away bolts
        const a = arrows[i];
        if (a.kind === 'parrow') continue;            // a hero's own arrows fly through
        if (Math.hypot(a.x - g.x, a.y - (g.y - 18)) < 48) {
          sparks.push({ x: a.x, y: a.y, t: 12, color: '#aaff66', txt: '✦' });
          arrows.splice(i, 1);
        }
      }
    } else { // jotaro
      const tx = player.x + g.side * 55, ty = player.y;
      g.x += clamp(tx - g.x, -3, 3);
      g.y += clamp(ty - g.y, -3, 3);
      if (g.oraT > 0) {
        g.oraT--;
        const t = g.target;
        if (!t || t.dead) { g.oraT = 0; g.target = null; }
        else {
          t.stun = 20;
          if (g.oraT % 3 === 0) {
            sfSfx.ora();
            sparks.push({ x: t.x + (rnd() - 0.5) * 26, y: t.y - 14 - rnd() * 22, t: 8, color: '#b39ddb', txt: 'ORA' });
          }
          if (g.oraT === 0) { killEnemy(t); g.target = null; }
        }
      } else if (--g.oraCd <= 0) {
        const t = nearest(g.x, g.y, 190);
        if (t) { g.target = t; g.oraT = 26; g.oraCd = 48; t.stun = 30; }
        else g.oraCd = 10;
      }
    }
    if (g.t <= 0) {
      if (g.kind === 'gandalf' && !swActive) {
        // "fly, you fools" — one final repelling nova as he goes (skipped in the
        // corridor, where a knockback would scramble the trooper formation)
        knockback(g.x, g.y, 0, 190, 40);
        shake = Math.max(shake, 10); sfSfx.bomb();
      }
      const bye = { gandalf: '"fly, you fools!"', luke: '"may the Force be with you."', jotaro: '"yare yare daze."' }[g.kind];
      sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: bye });
      allies.splice(ci, 1);
    }
  }
  for (let i = bolts.length - 1; i >= 0; i--) {
    const b = bolts[i];
    b.x += b.vx; b.y += b.vy;
    if (--b.t <= 0 || b.x < -20 || b.x > GW + 20 || b.y < -20 || b.y > GH + 20) { bolts.splice(i, 1); continue; }
    for (const e of enemies) {
      if (e.dead) continue;
      if (Math.hypot(b.x - e.x, b.y - (e.y - 18)) < 15) {
        // Gandalf REPELS, he does not slay — a heavy knockdown + shove buys you
        // the space; the kill (and its score and meter) stays yours
        if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
          e.stun = Math.max(e.stun || 0, 6);          // the no-flinch set barely notices
        } else if (e.type === 'trooper') {
          e.stun = Math.max(e.stun || 0, 20);         // staggered, but formation holds
        } else {
          const dv = Math.hypot(b.vx, b.vy) || 1;
          e.stun = Math.max(e.stun || 0, 42);
          e.x = clamp(e.x + b.vx / dv * 34, -60, GW + 60);
          e.y = clamp(e.y + b.vy / dv * 34, -60, GH + 60);
          e.vx = 0; e.vy = 0;
          sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#bbdefb', txt: 'REPELLED' });
        }
        sfSfx.thud();
        bolts.splice(i, 1);
        break;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);

  /* enemies: move, graze, kill */
  for (const e of enemies) {
    updateEnemy(e);
    if (e.type === 'ian' || mournful) continue;  // the creator & a grieving world cannot harm you
    if (e.type === 'shaman' || e.type === 'bomber') continue;  // support pieces never touch you — their horde (and kegs) do
    // shared "this foe is harmless right now" gates (independent of which hero)
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;  // harmless during the reveal
    if (e.type === 'vader' && e.intro > 0) continue;   // harmless as he steps from the shadows
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;   // intro & death are harmless
    if (dioStopT > 0) continue;                // time is stopped — you cannot be touched (nor can you act)
    if (e.frozen > 0) continue;                // an iced foe is harmless — wail on it freely
    // every standing hero is tested against this foe (in co-op the boss arcs can fell either)
    for (const h of heroesLive()) {
      if (h.dashT > 0) continue;               // i-frames: untouchable mid-dash
      // a MOUNTED rider sits above the fray: ground bodies can't touch them (the
      // named boss arcs below still can — archers and flails un-horse riders)
      const inSaddle = h.cls === 'rider' && h.mounted;
      const d = Math.hypot(h.x - e.x, h.y - e.y);
      const bodyR = e.kr + PLAYER_R + (h.cls === 'wyrm' ? WYRM_R : 0);
      if (!inSaddle && d < bodyR) { strike(h); if (!alive) return; continue; }   // bodies overlap → struck
      // the frost wolf chills a hero who brushes close; the DIRE wolf's chill is
      // a full 90px aura (drawn as an icy ring) — no brush needed
      if (!inSaddle && e.elite && e.type === 'wolf' && d < (e.elite === 2 ? 90 : e.kr + PLAYER_R + 26)) {
        if (h.chillT <= 0) sparks.push({ x: h.x, y: h.y - 34, t: 14, color: '#8fd8ff', txt: 'CHILLED' });
        h.chillT = 90;
      }
      if (!inSaddle && d < e.kr + PLAYER_R + 17 && e.grz <= 0) {        // a near miss just past the body
        e.grz = 50; score += 5 * mult;
        addMeter(1);
        sfSfx.graze();
        sparks.push({ x: (h.x + e.x) / 2, y: (h.y + e.y) / 2 - 14, t: 14, color: 'white', txt: '+' + (5 * mult) });
      }
      // the Witch-king's flail reaches well past his body mid-swing
      if (e.type === 'witchking' && !e.mounted && e.mode === 'swing') {
        const fdir = (h.x - e.x) >= 0 ? 1 : -1;
        const fx = e.x + fdir * Math.cos(e.flailAng) * 64;
        const fy = e.y - 32 + Math.sin(e.flailAng) * 64 * 0.7;
        if (Math.hypot(h.x - fx, (h.y - 18) - fy) < 26) { strike(h); if (!alive) return; continue; }
      }
      // Vader's saber sweeps a lethal arc out front during the slash
      if (e.type === 'vader' && e.mode === 'slash') {
        const tx = e.x + Math.cos(e.slashAng) * 56;
        const ty = (e.y - 22) + Math.sin(e.slashAng) * 56;
        if (Math.hypot(h.x - tx, (h.y - 18) - ty) < 24) { strike(h); if (!alive) return; continue; }
      }
      // DIO's MUDA barrage — The World pummels a lethal ring around him
      if (e.type === 'dio' && e.mode === 'muda' && d < 54) { strike(h); if (!alive) return; continue; }
      // Sidious' twin sabers carve a lethal ring while he spins
      if (e.type === 'sidious' && e.mode === 'spin' && d < 46) { strike(h); if (!alive) return; continue; }
      // Force lightning: a lethal corridor along the aim while it crackles
      if (e.type === 'sidious' && e.mode === 'lightning') {
        const ox = e.x, oy = e.y - 24;
        const px = h.x - ox, py = (h.y - 18) - oy;
        const proj = px * e.lx + py * e.ly;
        if (proj > 18 && proj < 470 && Math.abs(px * -e.ly + py * e.lx) < (e.lethalW || 18)) { strike(h); if (!alive) return; continue; }
      }
    }
  }

  /* the road roller: hovers into place during stopped time, then slams its zone on resume */
  if (roadRoller) {
    updateRoadRoller();
    const rr = roadRoller;   // lethal only as it lands (not the whole fall), and only inside the telegraphed ellipse
    if (rr && rr.phase === 'impact' && rr.t < 16) {
      for (const h of heroesLive()) {
        if (h.dashT <= 0 && ((h.x - rr.zoneX) / 46) ** 2 + ((h.y - rr.zoneY) / 17) ** 2 < 1) { strike(h); if (!alive) return; }
      }
    }
  }

  /* powder kegs: ballistic lobs — the landing ring is telegraphed from launch,
     and the blast spares nobody (heroes through strike(); the horde takes 2) */
  for (let i = kegs.length - 1; i >= 0; i--) {
    const k = kegs[i];
    k.t++;
    if (k.t < k.T) continue;
    kegs.splice(i, 1);
    sfSfx.bomb(); shake = Math.max(shake, 8);
    blasts.push({ kind: 'fire', x: k.tx, y: k.ty, r: 0, t: 0, life: 22, rMax: KEG_R + 14 });
    addDecal(k.tx, k.ty, 'scorch');   // (render-only) the ground remembers
    sparks.push({ x: k.tx, y: k.ty - 12, t: 16, color: '#ff8a65', txt: 'BOOM' });
    for (const h of heroesLive()) {
      if (h.dashT > 0) continue;                 // i-frames clear the blast
      if (Math.hypot(h.x - k.tx, (h.y - 10) - k.ty) < KEG_R) { strike(h); if (!alive) return; }
    }
    // the shrapnel reaches the horde well past the core (a pursuer walks ~72px
    // during the keg's flight — a tight radius would never touch a moving pack,
    // and baiting shots into the horde is the whole point of friendly fire)
    for (const e2 of enemies) {
      if (untouchable(e2)) continue;
      if (Math.hypot(e2.x - k.tx, e2.y - k.ty) < KEG_R + 34) {
        if (e2.hp && (e2.hp -= 2) > 0) {
          e2.stun = Math.max(e2.stun || 0, 16);
          sparks.push({ x: e2.x, y: e2.y - 30, t: 12, color: '#ffb74d', txt: 'SCORCHED' });
        } else {
          if (e2.type === 'shaman') sfUnlock('hoisted');   // its own artillery got it
          killEnemy(e2);
        }
      }
    }
    enemies = enemies.filter(e2 => !e2.dead);
  }

  /* arrows */
  for (let i = arrows.length - 1; i >= 0; i--) {
    const a = arrows[i];
    if (dioStopT > 0) continue;                // knives hang in stopped time
    a.x += a.vx; a.y += a.vy;
    // Ricochet: a player arrow with a bounce left banks off the screen edge
    if (a.kind === 'parrow' && a.bounces > 0 && (a.x < 8 || a.x > GW - 8 || a.y < 30 || a.y > GH - 8)) {
      a.bounces--;
      if (a.x < 8 || a.x > GW - 8) a.vx = -a.vx;
      if (a.y < 30 || a.y > GH - 8) a.vy = -a.vy;
      a.x = clamp(a.x, 8, GW - 8); a.y = clamp(a.y, 30, GH - 8);
      sparks.push({ x: a.x, y: a.y, t: 10, color: '#c5e1a5', txt: '✦' });
    }
    if (--a.t <= 0 || a.x < -20 || a.x > GW + 20 || a.y < -20 || a.y > GH + 20) { arrows.splice(i, 1); continue; }
    if (a.reflected) {
      // a bolt you deflected — harmless to you, kills any trooper it strikes
      let struck = false;
      const before = arrows;      // a boss kill inside killEnemy resets arrows[] wholesale
      for (const e of enemies) {
        if (e.dead) continue;
        if (Math.hypot(a.x - e.x, a.y - (e.y - 14)) < 15) {
          if (!e.hp || --e.hp <= 0) killEnemy(e); else e.stun = 10;
          struck = true; break;
        }
      }
      if (arrows !== before) break;   // the field was swept — stop iterating the stale array
      if (struck) arrows.splice(i, 1);
      continue;  // never harms the player
    }
    if (a.kind === 'parrow') {
      // a hero's arrow — harmless to heroes, strikes the first foe in its path
      let spent = false;
      const before = arrows;      // killing Vader/Sidious/DIO resets arrows[] wholesale
      for (const e of enemies) {
        if (untouchable(e) || (a.hitSet && a.hitSet.has(e))) continue;
        if (Math.hypot(a.x - e.x, a.y - (e.y - 14)) < (e.type === 'troll' || e.type === 'ogre' ? 20 : 15)) {
          (a.hitSet || (a.hitSet = new Set())).add(e);   // a piercing arrow never re-hits the same foe
          const dv = Math.hypot(a.vx, a.vy) || 1;
          rangedHit(e, a.dmg, a.vx / dv, a.vy / dv);
          if (a.pierce > 0) a.pierce--; else spent = true;
          break;
        }
      }
      if (arrows !== before) break;   // the field was swept — stop iterating the stale array
      if (spent) arrows.splice(i, 1);
      continue;
    }
    if (a.kind === 'vsaber') {                         // Vader's thrown saber: out, then home back to him
      a.spin += 0.6;
      if (!a.returning) {
        a.travelled += Math.hypot(a.vx, a.vy);
        if (a.travelled > a.range) a.returning = true;
      } else {
        const v = enemies.find(en => en.type === 'vader' && !en.dead);
        if (!v) { arrows.splice(i, 1); continue; }
        const hx = v.x - a.x, hy = (v.y - 22) - a.y, hd = Math.hypot(hx, hy) || 1;
        a.vx = hx / hd * 7.5; a.vy = hy / hd * 7.5;
        if (hd < 18) { arrows.splice(i, 1); continue; }  // caught — Vader re-arms
      }
      for (const h of heroesLive()) { if (h.dashT <= 0 && Math.hypot(a.x - h.x, a.y - (h.y - 18)) < 14) { strike(h); if (!alive) return; } }
      continue;
    }
    for (const h of heroesLive()) { if (h.dashT <= 0 && Math.hypot(a.x - h.x, a.y - (h.y - 18)) < 10) { strike(h); if (!alive) return; break; } }
  }

  /* passive score */
  if (frame % 60 === 0) score += 10 * mult;

  /* stopped time ticks down last, so the whole frame agrees it is stopped */
  if (dioStopT > 0 && --dioStopT === 0) { dioStopFx = 12; sfSfx.zawarudo(); sparks.push({ x: GW / 2, y: 50, t: 18, color: '#fff', txt: 'time resumes' }); }

  }   // ── end simStep (hit-stop falls through to here) ──

  /* the kill cam's ghost tape: one draw-ready snapshot per live tick (clones +
     baked tint so seat colors survive; render bookkeeping only — no sim reads) */
  if (started && alive && !paused && !bossIntro && !boonMenu) {
    camTape.push({
      heroes: heroesAll().map((h) => ({ ...h, tint: heroTint(h) })),
      enemies: enemies.map((e) => ({ ...e })),
    });
    if (camTape.length > CAM_TAPE_MAX) camTape.shift();
  }

  /* ── render ── */
  ctx.clearRect(0, 0, GW, GH);
  camUpdate();
  ctx.save();
  camApply();   // the living camera (render-only; identity under reduced motion)
  if (shake > 0) { shake--; const sx = (rnd() - 0.5) * shake, sy = (rnd() - 0.5) * shake; if (!api.reduceMotion) ctx.translate(sx * sfOpts.shake, sy * sfOpts.shake); }   // rnd ALWAYS drawn (stream!), option scales only the translate

  // ── the battlefield (atmosphere pass): the open field is a painted night
  // world now, not a window onto the desktop — see drawBattlefield. The
  // set-piece rooms below paint their own worlds instead.
  if (started && !swActive && !jojoActive && !ianActive) {
    drawBattlefield();
    drawLightPools();
  }

  if (swActive) {
    // the corridor: black void + a fixed starfield
    ctx.fillStyle = '#04060a'; ctx.fillRect(-30, -30, GW + 60, GH + 60);
    ctx.fillStyle = '#cdd6e0';
    for (const st of swStars) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin((frame + st.x) * 0.02));
      ctx.beginPath(); ctx.arc(st.x, st.y, st.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    if (swFlash > 0) {  // a Force surge floods the deck red (steady under reduced motion)
      const a = api.reduceMotion ? 0.16 : 0.30 * (0.55 + 0.45 * Math.abs(Math.sin(frame * 0.5)));
      ctx.fillStyle = 'rgba(122,14,14,' + a.toFixed(3) + ')'; ctx.fillRect(0, 0, GW, GH);
      swFlash--;
    }
    if (ltnFlash > 0) {  // Force-lightning floods the void violet-white (steady under reduced motion)
      const a = api.reduceMotion ? 0.12 : 0.22 * (0.5 + 0.5 * Math.abs(Math.sin(frame * 0.8)));
      ctx.fillStyle = 'rgba(150,110,255,' + a.toFixed(3) + ')'; ctx.fillRect(0, 0, GW, GH);
      ltnFlash--;
    }
  }
  if (jojoActive) {
    // ── DIO's mansion in Cairo: a sandstone arcade under a blood moon (Stardust Crusaders) ──
    const wallH = GH * 0.32;
    // pointed (keyhole) arch subpath helper
    const archSub = (cx, halfW, top, spring, bot) => {
      ctx.moveTo(cx - halfW, bot); ctx.lineTo(cx - halfW, spring);
      ctx.quadraticCurveTo(cx - halfW, top, cx, top);
      ctx.quadraticCurveTo(cx + halfW, top, cx + halfW, spring);
      ctx.lineTo(cx + halfW, bot); ctx.closePath();
    };

    // 1) the night beyond — deep gradient sky behind the arcade
    const g = ctx.createLinearGradient(0, 0, 0, GH);
    g.addColorStop(0, '#1a0e2b'); g.addColorStop(0.5, '#160a1f'); g.addColorStop(1, '#0e0608');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);

    // arcade geometry — moon framed by one of the arches
    const piers = 5, cellW = GW / piers, archHalf = cellW * 0.34;
    const archTop = GH * 0.05, archSpring = GH * 0.18, archBot = wallH - 7;
    const mArch = GW < GH * 1.4 ? 2.5 : 3.5;           // pick a right-of-centre arch for the moon
    const mx = cellW * mArch, my = GH * 0.15;

    // 2) blood moon + manga emphasis rays, seen through the arch (drawn before the wall)
    const rot = api.reduceMotion ? 0.2 : frame * 0.0015;
    const RAYS = 30, RR = Math.hypot(GW, GH);
    ctx.save(); ctx.translate(mx, my);
    for (let i = 0; i < RAYS; i++) {
      const a0 = rot + (i / RAYS) * Math.PI * 2, a1 = a0 + (Math.PI / RAYS);
      ctx.fillStyle = i % 2 === 0 ? 'rgba(168,126,228,0.05)' : 'rgba(232,194,90,0.045)';
      ctx.beginPath(); ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a0) * RR, Math.sin(a0) * RR); ctx.lineTo(Math.cos(a1) * RR, Math.sin(a1) * RR);
      ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    const halo = ctx.createRadialGradient(mx, my, 6, mx, my, 110);
    halo.addColorStop(0, 'rgba(255,228,190,0.26)'); halo.addColorStop(0.5, 'rgba(214,96,96,0.10)'); halo.addColorStop(1, 'rgba(214,96,96,0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(mx, my, 110, 0, Math.PI * 2); ctx.fill();
    const moon = ctx.createRadialGradient(mx - 11, my - 11, 4, mx, my, 44);
    moon.addColorStop(0, '#fdf3dc'); moon.addColorStop(0.7, '#ecd0a4'); moon.addColorStop(1, '#c79a72');
    ctx.fillStyle = moon; ctx.beginPath(); ctx.arc(mx, my, 39, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(150,108,86,0.18)';
    ctx.beginPath(); ctx.arc(mx - 13, my - 5, 6.5, 0, Math.PI * 2); ctx.arc(mx + 11, my + 10, 5, 0, Math.PI * 2); ctx.arc(mx + 4, my - 16, 3.8, 0, Math.PI * 2); ctx.fill();

    // 3) a shaft of moonlight spilling from the moon's arch onto the floor
    if (!api.reduceMotion) {
      const beam = ctx.createLinearGradient(0, archBot, 0, GH);
      beam.addColorStop(0, 'rgba(245,225,180,0.10)'); beam.addColorStop(1, 'rgba(245,225,180,0)');
      ctx.fillStyle = beam; ctx.beginPath();
      ctx.moveTo(mx - archHalf * 0.8, archBot); ctx.lineTo(mx + archHalf * 0.8, archBot);
      ctx.lineTo(mx + archHalf * 1.9, GH); ctx.lineTo(mx - archHalf * 1.9, GH); ctx.closePath(); ctx.fill();
    }

    // 4) the sandstone arcade wall, arch openings punched out with even-odd fill
    const wg = ctx.createLinearGradient(0, 0, 0, wallH);
    wg.addColorStop(0, '#6f5837'); wg.addColorStop(1, '#4d3c25');
    ctx.fillStyle = wg; ctx.beginPath(); ctx.rect(0, 0, GW, wallH);
    for (let i = 0; i < piers; i++) archSub((i + 0.5) * cellW, archHalf, archTop, archSpring, archBot);
    ctx.fill('evenodd');
    // ashlar mortar courses + arch outlines + keystones
    ctx.strokeStyle = 'rgba(36,24,12,0.45)'; ctx.lineWidth = 1;
    ctx.beginPath(); for (let y = 14; y < wallH - 8; y += 16) { ctx.moveTo(0, y); ctx.lineTo(GW, y); } ctx.stroke();
    ctx.strokeStyle = 'rgba(28,18,8,0.6)'; ctx.lineWidth = 2;
    for (let i = 0; i < piers; i++) { const cx = (i + 0.5) * cellW; ctx.beginPath(); archSub(cx, archHalf, archTop, archSpring, archBot); ctx.stroke();
      ctx.fillStyle = '#7d6442'; ctx.beginPath(); ctx.moveTo(cx - 6, archTop - 1); ctx.lineTo(cx + 6, archTop - 1); ctx.lineTo(cx + 9, archTop + 13); ctx.lineTo(cx - 9, archTop + 13); ctx.closePath(); ctx.fill(); ctx.stroke(); }

    // 5) cornice + an Egyptian dentil frieze along the wall's base
    ctx.fillStyle = '#5c4830'; ctx.fillRect(0, wallH - 7, GW, 9);
    ctx.fillStyle = '#876b46'; ctx.fillRect(0, wallH - 7, GW, 2);
    ctx.fillStyle = 'rgba(30,20,10,0.55)'; for (let x = 0; x < GW; x += 16) ctx.fillRect(x, wallH - 5, 8, 5);

    // 6) sandstone floor — faint tile grid + warm wash, low contrast so sprites read
    ctx.fillStyle = 'rgba(60,46,28,0.22)'; ctx.fillRect(0, wallH, GW, GH - wallH);
    ctx.strokeStyle = 'rgba(196,164,110,0.06)'; ctx.lineWidth = 1; ctx.beginPath();
    const tile = 46;
    for (let x = 0; x <= GW; x += tile) { ctx.moveTo(x, wallH); ctx.lineTo(x, GH); }
    for (let y = wallH; y <= GH; y += tile) { ctx.moveTo(0, y); ctx.lineTo(GW, y); }
    ctx.stroke();

    // 7) two foreground hall pillars framing the arena
    const drawPillar = (cx) => {
      const w = Math.max(13, GW * 0.02), top = wallH - 6;
      const pg = ctx.createLinearGradient(cx - w, 0, cx + w, 0);
      pg.addColorStop(0, '#3f3120'); pg.addColorStop(0.5, '#75603f'); pg.addColorStop(1, '#3f3120');
      ctx.fillStyle = pg; ctx.fillRect(cx - w, top, w * 2, GH - top);
      ctx.fillStyle = '#856b46'; ctx.fillRect(cx - w - 4, top - 9, w * 2 + 8, 11);
      ctx.strokeStyle = 'rgba(34,22,10,0.4)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = -2; k <= 2; k++) { ctx.moveTo(cx + k * w * 0.42, top); ctx.lineTo(cx + k * w * 0.42, GH); } ctx.stroke();
    };
    drawPillar(GW * 0.045); drawPillar(GW * 0.955);

    // 8) ben-day halftone dots in opposite corners — manga texture
    ctx.fillStyle = 'rgba(202,166,255,0.06)';
    for (let yy = 0; yy < 96; yy += 12) for (let xx = 0; xx < 120; xx += 12) {
      const r = 2.6 * (1 - xx / 140) * (1 - yy / 120); if (r > 0.3) { ctx.beginPath(); ctx.arc(xx, yy, r, 0, Math.PI * 2); ctx.fill(); }
    }
    for (let yy = GH; yy > GH - 96; yy -= 12) for (let xx = GW; xx > GW - 120; xx -= 12) {
      const r = 2.6 * (1 - (GW - xx) / 140) * (1 - (GH - yy) / 120); if (r > 0.3) { ctx.beginPath(); ctx.arc(xx, yy, r, 0, Math.PI * 2); ctx.fill(); }
    }

    // 9) roaring ゴゴゴ "menacing" onomatopoeia — bold, outlined, drifting up
    ctx.save(); ctx.textAlign = 'left'; ctx.lineJoin = 'round';
    for (const m of jojoBg) {
      if (!api.reduceMotion) m.y += m.vy;
      if (m.y < -34) { m.y = GH + 24; m.x = (m.x * 1.7 + 61) % GW; }  // rnd-free recycle — this branch only runs when motion is on
      ctx.globalAlpha = Math.min(0.32, m.a * 2.4);
      ctx.font = '900 ' + m.s.toFixed(0) + 'px serif';
      ctx.lineWidth = 2.4; ctx.strokeStyle = 'rgba(18,7,28,0.95)'; ctx.fillStyle = '#d6bcff';
      ctx.strokeText('ゴ', m.x, m.y); ctx.fillText('ゴ', m.x, m.y);
    }
    ctx.restore(); ctx.globalAlpha = 1;
  }
  if (ianActive) {
    // the creator's cozy little room — warm gradient, soft moon, twinkles & drifting cute glyphs
    const g = ctx.createLinearGradient(0, 0, 0, GH);
    g.addColorStop(0, '#181233'); g.addColorStop(0.5, '#291c41'); g.addColorStop(1, '#3c243f');
    ctx.fillStyle = g; ctx.fillRect(0, 0, GW, GH);
    const mg = ctx.createRadialGradient(GW * 0.5, GH * 0.30, 8, GW * 0.5, GH * 0.30, GW * 0.55);
    mg.addColorStop(0, 'rgba(255,228,196,0.12)'); mg.addColorStop(1, 'rgba(255,228,196,0)');
    ctx.fillStyle = mg; ctx.fillRect(0, 0, GW, GH);
    for (const m of ianBg) {
      if (m.kind === 'star') {
        ctx.globalAlpha = api.reduceMotion ? 0.6 : 0.35 + 0.45 * Math.abs(Math.sin((frame + m.x) * 0.05));
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(m.x, m.y, m.r, 0, Math.PI * 2); ctx.fill();
      } else {
        if (!api.reduceMotion) { m.y += m.vy; m.x += Math.sin((frame + m.ph) * 0.02) * 0.2; }
        if (m.y < -20) { m.y = GH + 16; m.x = (m.x * 1.7 + 53) % GW; }  // rnd-free recycle — this branch only runs when motion is on
        ctx.globalAlpha = m.a; ctx.fillStyle = m.col;
        ctx.font = m.s.toFixed(0) + 'px Tahoma,Arial'; ctx.textAlign = 'center';
        ctx.fillText(m.ch, m.x, m.y);
      }
    }
    ctx.globalAlpha = 1; ctx.textAlign = 'left';
    // a warm spotlight + glowing floor pad where the creator kneels
    const e = enemies.find(en => en.type === 'ian');
    if (e) {
      const sg = ctx.createRadialGradient(e.x, e.y - 16, 6, e.x, e.y - 16, 150);
      sg.addColorStop(0, 'rgba(255,214,170,0.20)'); sg.addColorStop(1, 'rgba(255,214,170,0)');
      ctx.fillStyle = sg; ctx.fillRect(0, 0, GW, GH);
      ctx.save();
      ctx.globalAlpha = 0.45 + 0.2 * Math.sin(frame * 0.08);
      ctx.strokeStyle = 'rgba(255,228,196,0.5)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(e.x, e.y + 4, 28, 9, 0, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }
  if (!swActive && !jojoActive && !ianActive) {
    // the open battlefield is the XP desktop itself — lay a soft vignette over it so the
    // sprites read against the busy wallpaper, plus a faint warm wash low on the ground.
    const vg = ctx.createRadialGradient(GW / 2, GH * 0.46, GH * 0.32, GW / 2, GH * 0.5, GH * 0.95);
    vg.addColorStop(0, 'rgba(6,8,14,0)'); vg.addColorStop(1, 'rgba(6,8,14,0.4)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    const gw = ctx.createLinearGradient(0, GH * 0.6, 0, GH);
    gw.addColorStop(0, 'rgba(20,14,30,0)'); gw.addColorStop(1, 'rgba(20,14,30,0.22)');
    ctx.fillStyle = gw; ctx.fillRect(0, GH * 0.6, GW, GH * 0.4);
  }

  if (stone) drawStone();
  if (saberPickup) drawSaberPickup();
  for (const c of corpses) drawCorpse(c);
  for (const k of husks) drawHusk(k);       // the necromancer's larder, under the living
  for (const m of minions) drawMinion(m);
  if (bossRiseT > 0) {
    // a fallen body stirs: a dark shape pulls itself upright in a swelling red haze
    const p = clamp(1 - bossRiseT / 90, 0, 1);  // long hold, then rise over the final ~90 frames
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.35 * Math.abs(Math.sin(frame * 0.3));
    ctx.fillStyle = '#7e1f1f';
    ctx.beginPath(); ctx.ellipse(bossRiseX, bossRiseY + 4, 18 + p * 8, 7, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = p;
    ctx.fillStyle = '#0d0a12';
    ctx.beginPath();
    ctx.moveTo(bossRiseX, bossRiseY - 52 * p);
    ctx.lineTo(bossRiseX - 12, bossRiseY + 2);
    ctx.lineTo(bossRiseX + 12, bossRiseY + 2);
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  for (const ck of coins) {
    if (ck.t < 120 && Math.floor(ck.t / 6) % 2 === 0) continue;  // blink before despawn
    const spin = api.reduceMotion ? 0.82 : Math.abs(Math.cos((frame + (ck.x | 0)) * 0.07));  // edge-on coin flip
    const w = 1.6 + 6.4 * spin;
    ctx.save(); ctx.translate(ck.x, ck.y);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';                          // contact shadow on the ground
    ctx.beginPath(); ctx.ellipse(0, 11, 6.5, 2.2, 0, 0, Math.PI * 2); ctx.fill();
    const fg = ctx.createLinearGradient(-w, -8, w, 8);          // struck-metal sheen across the face
    fg.addColorStop(0, '#c8920c'); fg.addColorStop(0.5, '#ffe98a'); fg.addColorStop(1, '#d9a417');
    ctx.fillStyle = fg;
    ctx.beginPath(); ctx.ellipse(0, 0, w, 8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#8a6508'; ctx.lineWidth = 1.5; ctx.stroke();
    if (spin > 0.42) {                                          // ¢ shows only when the coin faces us
      ctx.fillStyle = 'rgba(138,101,8,0.9)'; ctx.font = 'bold 10px Tahoma,Arial'; ctx.textAlign = 'center';
      ctx.fillText('¢', 0, 3.5); ctx.textAlign = 'left';
    }
    ctx.restore();
  }
  for (const pu of powerups) {
    const accent = pu.kind === 'freeze' ? '143,216,255' : pu.kind === 'bolt' ? '128,216,255' : '255,138,101';
    const ac = pu.kind === 'freeze' ? '#8fd8ff' : pu.kind === 'bolt' ? '#80d8ff' : '#ff8a65';
    const pulse = 1 + Math.sin(frame * 0.12) * 0.12;
    ctx.save(); ctx.translate(pu.x, pu.y);
    const halo = ctx.createRadialGradient(0, 0, 4, 0, 0, 26);    // soft breathing aura
    const ha = (api.reduceMotion ? 0.3 : 0.24 + 0.12 * Math.sin(frame * 0.12));
    halo.addColorStop(0, 'rgba(' + accent + ',' + ha.toFixed(3) + ')'); halo.addColorStop(1, 'rgba(' + accent + ',0)');
    ctx.fillStyle = halo; ctx.beginPath(); ctx.arc(0, 0, 26, 0, Math.PI * 2); ctx.fill();
    ctx.scale(pulse, pulse);
    ctx.beginPath(); ctx.arc(0, 0, 13, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(' + accent + ',0.3)'; ctx.fill();
    ctx.strokeStyle = ac; ctx.lineWidth = 2; ctx.shadowColor = ac; ctx.shadowBlur = 8; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '14px serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(pu.kind === 'freeze' ? '❄' : pu.kind === 'bolt' ? '⚡' : '🔥', 0, 1);
    ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
    ctx.restore();
    // three motes orbiting the rune
    ctx.save(); ctx.translate(pu.x, pu.y); ctx.fillStyle = ac;
    const rot = api.reduceMotion ? 0 : frame * 0.05;
    for (let s = 0; s < 3; s++) {
      const a = rot + s / 3 * Math.PI * 2;
      ctx.globalAlpha = api.reduceMotion ? 0.6 : 0.4 + 0.4 * Math.abs(Math.sin(frame * 0.1 + s));
      ctx.beginPath(); ctx.arc(Math.cos(a) * 17, Math.sin(a) * 17, 1.7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  // fire / frost blasts bloom under the enemies so they read as engulfed
  for (const b of blasts) {
    const k = b.t / b.life;                 // 0→1 over the blast's life
    if (b.kind === 'chain') {
      // a forked bolt arcing through every link of the chain
      ctx.save();
      ctx.shadowColor = '#80d8ff'; ctx.shadowBlur = 14; ctx.lineCap = 'round';
      for (let p = 0; p < b.pts.length - 1; p++) {
        const a = b.pts[p], c = b.pts[p + 1];
        ctx.strokeStyle = 'rgba(207,243,255,' + (1 - k) + ')'; ctx.lineWidth = 3.4;
        _ltnArc(a.x, a.y, c.x, c.y, 7, 6, frame * 0.7 + p * 3.1);
        ctx.strokeStyle = 'rgba(128,216,255,' + (0.55 * (1 - k)) + ')'; ctx.lineWidth = 7;
        _ltnArc(a.x, a.y, c.x, c.y, 7, 6, frame * 0.7 + p * 3.1);
      }
      ctx.shadowBlur = 0; ctx.restore();
      continue;
    }
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.kind === 'fire') {
      const g = ctx.createRadialGradient(0, 0, b.r * 0.15, 0, 0, b.r);
      g.addColorStop(0, 'rgba(255,241,170,' + (0.85 * (1 - k)) + ')');
      g.addColorStop(0.45, 'rgba(255,138,64,' + (0.7 * (1 - k)) + ')');
      g.addColorStop(1, 'rgba(183,40,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      // a few flame tongues licking outward
      ctx.strokeStyle = 'rgba(255,193,120,' + (0.6 * (1 - k)) + ')';
      ctx.lineWidth = 3;
      for (let s = 0; s < 10; s++) {
        const a = s / 10 * Math.PI * 2 + frame * 0.05;
        const r0 = b.r * 0.6, r1 = b.r * (0.9 + Math.sin(frame * 0.3 + s) * 0.1);
        ctx.beginPath(); ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
        ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); ctx.stroke();
      }
    } else {
      // frost nova: an icy shockwave ring + a soft chill fill
      ctx.fillStyle = 'rgba(143,216,255,' + (0.22 * (1 - k)) + ')';
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(225,245,255,' + (0.9 * (1 - k)) + ')';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(0, 0, b.r, 0, Math.PI * 2); ctx.stroke();
    }
    ctx.restore();
  }
  for (const w of warns) {
    if (!api.reduceMotion && Math.floor(w.t / 5) % 2 === 0) continue;  // flash (steady when reduced motion)
    ctx.beginPath(); ctx.arc(w.x, w.y, 11, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,0,0,0.25)'; ctx.fill();
    ctx.strokeStyle = '#ff5252'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ff5252'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText('!', w.x, w.y + 5); ctx.textAlign = 'left';
  }
  for (let i = ghosts.length - 1; i >= 0; i--) {
    const g = ghosts[i];
    if (--g.t <= 0) { ghosts.splice(i, 1); continue; }
    heroFigure(g.x, g.y, g.phase, '#80deea', g.cls, g.dir || 1, 1, g.t / 32, 0, 0, true);
  }
  for (const e of enemies) {
    if (e.mode === 'aim' && freezeT <= 0 && e.stun <= 0 && !(e.frozen > 0)) {
      // telegraph: dashed sight line toward the player (orange wolf, bone archer)
      ctx.save();
      ctx.strokeStyle = e.type === 'archer' ? 'rgba(245,245,220,0.6)' : 'rgba(255,152,0,0.55)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.moveTo(e.x, e.y - 18); ctx.lineTo(player.x, player.y - 18); ctx.stroke();
      ctx.restore();
    }
    drawEnemy(e);
  }
  { const boss = enemies.find(e => e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'ogre' || (e.type === 'dio' && e.mode !== 'troll' && e.mode !== 'dying')); if (boss) drawBossBar(boss); }
  // Sidious' Force lightning — telegraph line, then a jagged forked bolt down the locked corridor
  for (const e of enemies) {
    if (e.type !== 'sidious') continue;
    if (e.mode === 'cast') {
      const prog = e.castDur ? clamp(1 - e.st / e.castDur, 0, 1) : 1;
      const ox = e.x, oy = e.y - 24, len = 470;
      const blink = api.reduceMotion ? 1 : (0.5 + 0.5 * Math.abs(Math.sin(frame * (0.15 + prog * 0.45))));
      ctx.save();
      if (e.castKind === 'sweep') {
        // the whole arc the rake will cross lights up as a danger wedge
        const c = e.sweepCenterA, arc = (e.sweepArc || 0.85) / 2, dirS = e.sweepDir || 1;
        ctx.fillStyle = 'rgba(150,110,255,' + (0.04 + prog * 0.14).toFixed(3) + ')';
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.arc(ox, oy, len, c - arc, c + arc); ctx.closePath(); ctx.fill();
        // the two edges
        ctx.globalAlpha = 0.4 + 0.55 * prog * blink;
        ctx.strokeStyle = '#c9a9ff'; ctx.lineWidth = 1.5 + prog * 1.8; ctx.setLineDash([6, 5]);
        ctx.lineDashOffset = api.reduceMotion ? 0 : -frame * 1.5;
        for (const a of [c - arc, c + arc]) { ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(a) * len, oy + Math.sin(a) * len); ctx.stroke(); }
        // a bright leading line previewing the sweep direction — flee the OTHER way
        ctx.setLineDash([]);
        const t = api.reduceMotion ? 0.5 : (frame % 46) / 46;
        const lead = (c - dirS * arc) + dirS * 2 * arc * t;
        ctx.globalAlpha = 0.85; ctx.strokeStyle = '#fff0c0'; ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + Math.cos(lead) * len, oy + Math.sin(lead) * len); ctx.stroke();
        // a small curved arrow near him showing which way it rakes
        const rIn = 58, aTrail = c - dirS * arc, aLead = c + dirS * arc;
        ctx.globalAlpha = 0.9; ctx.strokeStyle = '#ffe09a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(ox, oy, rIn, Math.min(aTrail, aLead), Math.max(aTrail, aLead)); ctx.stroke();
        const hx = ox + Math.cos(aLead) * rIn, hy = oy + Math.sin(aLead) * rIn, tan = aLead + dirS * Math.PI / 2;
        ctx.fillStyle = '#ffe09a';
        ctx.beginPath();
        ctx.moveTo(hx + Math.cos(tan) * 6, hy + Math.sin(tan) * 6);
        ctx.lineTo(hx - Math.cos(tan) * 3 + Math.cos(aLead) * 5, hy - Math.sin(tan) * 3 + Math.sin(aLead) * 5);
        ctx.lineTo(hx - Math.cos(tan) * 3 - Math.cos(aLead) * 5, hy - Math.sin(tan) * 3 - Math.sin(aLead) * 5);
        ctx.closePath(); ctx.fill();
      } else {
        const px = -e.ly, py = e.lx, hw = 18;
        // the danger corridor fills in as the charge builds — shows exactly where the bolt will strike
        ctx.fillStyle = 'rgba(150,110,255,' + (0.05 + prog * 0.16).toFixed(3) + ')';
        ctx.beginPath();
        ctx.moveTo(ox + px * hw, oy + py * hw);
        ctx.lineTo(ox + e.lx * len + px * hw, oy + e.ly * len + py * hw);
        ctx.lineTo(ox + e.lx * len - px * hw, oy + e.ly * len - py * hw);
        ctx.lineTo(ox - px * hw, oy - py * hw);
        ctx.closePath(); ctx.fill();
        // bright dashed centre line, pulsing faster the nearer it is to firing
        ctx.globalAlpha = 0.4 + 0.6 * prog * blink;
        ctx.strokeStyle = '#c9a9ff'; ctx.lineWidth = 1.5 + prog * 2.2;
        ctx.setLineDash([6, 5]); ctx.lineDashOffset = api.reduceMotion ? 0 : -frame * 1.5;
        ctx.beginPath(); ctx.moveTo(ox, oy); ctx.lineTo(ox + e.lx * len, oy + e.ly * len); ctx.stroke();
      }
      ctx.restore();
    } else if (e.mode === 'lightning') {
      const ox = e.x, oy = e.y - 24, len = 470, segs = 16;
      const px = -e.ly, py = e.lx, seed = api.reduceMotion ? 7 : frame;
      for (let pass = 0; pass < 2; pass++) {   // wide violet glow, then a bright white core
        ctx.save(); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
        ctx.shadowColor = '#9a6cff'; ctx.shadowBlur = pass === 0 ? 16 : 6;
        ctx.strokeStyle = pass === 0 ? 'rgba(150,110,255,0.5)' : '#ffffff';
        ctx.lineWidth = pass === 0 ? 6 : 2;
        ctx.beginPath(); ctx.moveTo(ox, oy);
        for (let s = 1; s <= segs; s++) {
          const t = s / segs;
          const j = (Math.sin(seed * 0.7 + s * 2.3) + Math.sin(seed * 0.31 + s * 5.1)) * 11 * (1 - Math.abs(t - 0.5));
          ctx.lineTo(ox + e.lx * len * t + px * j, oy + e.ly * len * t + py * j);
        }
        ctx.stroke(); ctx.restore();
      }
    }
  }
  /* powder kegs: the shrinking landing ring (steady by design — no flashing) and
     the keg itself tumbling along its lobbed arc */
  for (const k of kegs) {
    const p = k.t / k.T;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,82,82,' + (0.35 + p * 0.45).toFixed(2) + ')';
    ctx.lineWidth = 2;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.arc(k.tx, k.ty, KEG_R + (1 - p) * 26, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(255,82,82,' + (0.08 + p * 0.15).toFixed(2) + ')';
    ctx.beginPath(); ctx.arc(k.tx, k.ty, KEG_R, 0, Math.PI * 2); ctx.fill();
    const kx = k.sx + (k.tx - k.sx) * p;
    const ky = k.sy + (k.ty - k.sy) * p - Math.sin(p * Math.PI) * 90;
    ctx.translate(kx, ky); ctx.rotate(p * 7);
    ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-5, -7, 10, 14);
    ctx.strokeStyle = '#3e2a17'; ctx.lineWidth = 1.5;
    ctx.strokeRect(-5, -7, 10, 14);
    ctx.beginPath(); ctx.moveTo(-5, -2); ctx.lineTo(5, -2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-5, 3); ctx.lineTo(5, 3); ctx.stroke();
    if (!api.reduceMotion && Math.floor(frame / 3) % 2 === 0) {
      ctx.fillStyle = '#ffd24d';
      ctx.beginPath(); ctx.arc(0, -9, 2, 0, Math.PI * 2); ctx.fill();   // the sputtering fuse
    }
    ctx.restore();
  }
  for (const a of arrows) {
    ctx.save();
    const laser = a.kind === 'laser';
    const d = Math.hypot(a.vx, a.vy) || 1;
    if (a.kind === 'knife') {
      ctx.restore(); drawKnife(a); continue;          // DIO's thrown knives
    } else if (a.kind === 'vsaber') {
      // a spinning red blade — hilt + glowing blade rotating about its centre
      ctx.translate(a.x, a.y); ctx.rotate(a.spin || 0); ctx.lineCap = 'round';
      ctx.strokeStyle = '#9a9a9a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-6, 0); ctx.lineTo(0, 0); ctx.stroke();
      ctx.shadowColor = '#ff4438'; ctx.shadowBlur = 12;
      ctx.strokeStyle = '#ff6f63'; ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(22, 0); ctx.stroke();
    } else if (laser) {
      // deflected bolts glow saber-blue (yours); incoming bolts are red
      ctx.strokeStyle = a.reflected ? '#bfe7ff' : '#ff3b30'; ctx.lineWidth = 3; ctx.lineCap = 'round';
      ctx.shadowColor = a.reflected ? '#5ac8ff' : '#ff6f60'; ctx.shadowBlur = 8;
      ctx.beginPath(); ctx.moveTo(a.x - a.vx / d * 14, a.y - a.vy / d * 14); ctx.lineTo(a.x, a.y); ctx.stroke();
    } else {
      // your own arrows fletch green so friend and foe never blur mid-horde
      ctx.strokeStyle = a.kind === 'parrow' ? '#c5e1a5' : '#f5f5dc'; ctx.lineWidth = 2; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(a.x - a.vx / d * 9, a.y - a.vy / d * 9); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath(); ctx.arc(a.x, a.y, 2, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  }
  for (const b of bolts) {
    ctx.save();
    ctx.fillStyle = '#fff'; ctx.shadowColor = '#bbdefb'; ctx.shadowBlur = 10;
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  for (const g of allies) {
    // the champion's remaining window, legible at a glance — plan around it
    if (g.t0) {
      const p = clamp(g.t / g.t0, 0, 1);
      ctx.save();
      ctx.strokeStyle = p < 0.25 ? 'rgba(255,138,101,0.85)' : 'rgba(202,255,160,0.7)';
      ctx.lineWidth = 2.5; ctx.lineCap = 'round';
      ctx.beginPath(); ctx.arc(g.x, g.y + 7, 13, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
    drawChamp(g);
  }
  if (jojoActive && playerStand > 0.05) {   // Star Platinum rises above and behind the hero's shoulder
    const dio = enemies.find(en => en.type === 'dio');
    const sdir = dio && dio.x < player.x ? -1 : 1;
    ctx.save();
    ctx.translate(player.x - sdir * 12, player.y - 24); ctx.scale(1.4, 1.4);
    drawStarPlatinum(sdir, playerStand, player.swingT > 0);
    ctx.restore();
  }
  if (coop && p2) drawHero(p2);   // P2 first so P1 reads on top when they overlap
  drawHero(player);
  if (sidFinale) drawSidiousFinale();             // the death cutscene plays over the scene
  if (roadRoller) drawRoadRoller(roadRoller);     // the road roller, on top of everything
  // stopped-time wash: a sepia overlay + a clock motif while DIO acts in frozen time
  if (dioStopT > 0) {
    ctx.save();
    ctx.fillStyle = 'rgba(70,52,28,0.34)'; ctx.fillRect(0, 0, GW, GH);
    const vg = ctx.createRadialGradient(GW / 2, GH / 2, GH * 0.3, GW / 2, GH / 2, GH * 0.75);
    vg.addColorStop(0, 'rgba(40,28,14,0)'); vg.addColorStop(1, 'rgba(20,12,4,0.5)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, GW, GH);
    ctx.globalAlpha = 0.8; ctx.fillStyle = '#f3e6c8'; ctx.font = 'bold 13px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText('「 TIME HAS STOPPED 」', GW / 2, GH - 22);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (dioStopFx > 0) {   // a sharp white snap on the stop and on resume
    ctx.save(); ctx.globalAlpha = (api.reduceMotion ? 0.25 : 0.5) * (dioStopFx / 12);
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, GW, GH); ctx.restore();
  }
  for (let i = sparks.length - 1; i >= 0; i--) {
    const s = sparks[i];
    if ((s.t -= 1 / TEXT_HOLD) <= 0) { sparks.splice(i, 1); continue; }
    ctx.globalAlpha = s.t / 24;
    ctx.fillStyle = s.color; ctx.font = 'bold ' + (s.size || 13) + 'px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.fillText(s.txt, s.x, s.y - (24 - s.t) * (s.rise == null ? 0.7 : s.rise));
    ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (bannerT > 0) {
    bannerT -= 1 / TEXT_HOLD;
    ctx.globalAlpha = Math.min(1, bannerT / 25);
    ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 30px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;
    ctx.fillText(banner, GW / 2, GH / 3);
    if (bannerSub) {
      ctx.fillStyle = '#ffe9b0'; ctx.font = '15px Tahoma,Arial';
      ctx.fillText(bannerSub, GW / 2, GH / 3 + 28);
    }
    ctx.shadowBlur = 0; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
  }
  if (meter >= up.summonCost && !champsBanned() && champUnlocked()) {
    // standing offer — stays up top until an ally is summoned
    ctx.save();
    ctx.globalAlpha = 0.8 + Math.sin(frame * 0.1) * 0.2;
    ctx.fillStyle = '#bbdefb'; ctx.font = 'bold 14px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('ally ready:   ' + champReadyText(), GW / 2, 26);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (freezeT > 0) {
    ctx.fillStyle = 'rgba(143,216,255,0.07)';
    ctx.fillRect(0, 0, GW, GH);
  }
  if (awaitExit) {
    // a pulsing chevron beckoning the player to the east edge
    const cy = GH / 2, ax = GW - 40, pulse = Math.sin(frame * 0.12) * 8;
    ctx.save();
    ctx.globalAlpha = 0.7 + 0.3 * Math.sin(frame * 0.12);
    ctx.strokeStyle = '#ffd24d'; ctx.fillStyle = '#ffd24d';
    ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const off of [-18, 6]) {
      const bx = ax + off + pulse;
      ctx.beginPath();
      ctx.moveTo(bx, cy - 22); ctx.lineTo(bx + 20, cy); ctx.lineTo(bx, cy + 22);
      ctx.stroke();
    }
    ctx.font = 'bold 15px Tahoma,Arial'; ctx.textAlign = 'center';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillText('run east', ax - 16, cy - 36);
    ctx.restore(); ctx.textAlign = 'left';
  }
  if (ianChoice) drawIanChoice();
  ctx.restore();
  // directional HURT FLASH (render-only, screen-space): the edge the blow came
  // from flares red and fades — you always know which way death was standing
  if (hurtFlash) {
    const hf2 = hurtFlash;
    const d = Math.hypot(hf2.dx, hf2.dy) || 1;
    const a = (api.reduceMotion ? 0.16 : 0.24) * (hf2.t / 26) * (0.5 + 0.5 * sfOpts.flash);
    const ex = GW / 2 + (hf2.dx / d) * GW * 0.62, ey = GH / 2 + (hf2.dy / d) * GH * 0.62;
    const fg = ctx.createRadialGradient(ex, ey, 0, ex, ey, Math.max(GW, GH) * 0.55);
    fg.addColorStop(0, 'rgba(255,40,30,' + a.toFixed(3) + ')');
    fg.addColorStop(1, 'rgba(255,40,30,0)');
    ctx.fillStyle = fg;
    ctx.fillRect(0, 0, GW, GH);
    if (--hf2.t <= 0) hurtFlash = null;   // once per loop call — cadence-safe
  }
  if (shellMenu && netplay) drawShellMenu();   // online: settings overlay over a LIVE sim (nothing pauses)
  drawSummonMeter();   // the ally charge gauge sits in the UI layer, unaffected by screen shake
  drawManaGauge();     // ...and the wizard's well mirrors it bottom-right
  drawTrophyToasts();

  if (swFadeT > 0) {
    // cross-fade through black hides the cut to the corridor
    const half = FADE_LEN / 2;
    ctx.globalAlpha = 1 - Math.abs(swFadeT - half) / half;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GW, GH);
    ctx.globalAlpha = 1;
  }

  const foesLeft = enemies.length + warns.length + waveQuota;
  hud.innerHTML =
    (replayMode && replay ? '<span style="color:#ffd24d">▶ REPLAY · ' + replay.name + ' · Q to leave</span><br>' : '') +
    'SCORE ' + score + ' · BEST ' + best + '<br>' +
    (mournful
      ? '<span style="color:#8fd8ff">the world mourns · they will not fight</span> · KILLS ' + kills
      : 'WAVE ' + wave + (netplay ? ' · <span style="color:#7fd8ff">🌐 ONLINE</span>' : '') + (dailyRun ? ' · <span style="color:#ffb300">☀ DAILY</span>' : '') + (hardMode ? ' · <span style="color:#ff6e6e">☠ HARD</span>' : '') + (endless ? ' · <span style="color:#ffd24d">∞ ENDLESS</span>' : '') + ' · FOES ' + foesLeft + ' · KILLS ' + kills + ' · x' + mult) + '<br>' +
    (up.dashMax === 0
      ? '<span style="color:#666">DASH 🔒 locked</span>'
      : '<span style="color:#80deea">DASH ' + '◆'.repeat(player.dashCharges) +
        '<span style="color:#3a4a55">' + '◇'.repeat(up.dashMax - player.dashCharges) + '</span></span>') +
    (up.shield ? (player.shield
      ? '  ·  <span style="color:#7fd8ff">🛡️ AEGIS</span>'
      : '  ·  <span style="color:#5a6168">🛡️ broken · refreshes next wave</span>') : '') + '<br>' +
    (player.cls === 'ranged'
      ? '<span style="color:#9ccc65">🏹 bow · X fires your held direction</span>'
      : player.cls === 'caster'
      ? (() => {
          const sp = SPELLS[curSpell(player)], m = Math.floor(player.mana);
          return '<span style="color:#ce93d8">' + sp.icon + ' ' + sp.name + ' · X casts' +
            (heroSpells().length > 1 ? ' · ' + (coop ? '.' : 'C') + ' turns the page' : '') +
            ' · <span style="color:' + (m >= sp.cost ? '#b39ddb' : '#e57373') + '">🔮 ' + m + '</span></span>';
        })()
      : player.cls === 'necro'
      ? '<span style="color:#64ffda">💀 scythe · X reaps & raises · souls ' + Math.floor(player.souls) +
        ' · dead ' + minions.length + '/' + up.minionCap + (husks.length ? ' · husks ' + husks.length : '') + '</span>'
      : player.heldSaber
      ? '<span style="color:#5ac8ff">⚔ lightsaber · X strikes</span>'
      : saberPickup ? '<span style="color:#5ac8ff">⚔ a lightsaber waits ahead</span>'
      : player.swordT > 0
      ? '<span style="color:#fff59d">⚔ ' + Math.ceil(player.swordT / 60) + 's · X swings</span>'
      : stone ? '<span style="color:#fff59d">⚔ a sword waits in the stone</span>' : '<span style="color:#888">⚔ —</span>') + '<br>' +
    (!champUnlocked()
      ? '<span style="color:#888">🧙 no allies unlocked yet</span>'
      : champsBanned()
        ? '<span style="color:#e57373">no ally can save you now</span>'
        : (() => {
            const charges = Math.floor(meter / up.summonCost);
            const shown = Math.min(charges, alliesUnlocked());
            const pips = '●'.repeat(shown) + '○'.repeat(Math.max(0, alliesUnlocked() - shown));
            const tail = allies.length
              ? allies.map(g => ({ gandalf: '🧙', luke: '⚔️', jotaro: '👊' }[g.kind])).join('') + ' out'
              : charges > 0 ? 'summon 1·2·3' : 'charging';
            return '<span style="color:#bbdefb">🧙 ' + pips + '  ·  ' + tail + '</span>';
          })());
  if (coop && p2) {
    // a per-hero status line: dash charges, Aegis, and the downed/reviving state
    const hero = (h, label, col) => {
      if (h.down) {
        const pct = Math.round(clamp(h.reviveT / reviveNeed(), 0, 1) * 100);
        return '<span style="color:#ff5252">' + label + ' DOWN' + (pct ? ' · reviving ' + pct + '%' : ' · stand close to revive') + '</span>';
      }
      const dash = up.dashMax === 0 ? '' : ' ◆' + h.dashCharges;
      const aeg = up.shield ? (h.shield ? ' 🛡️' : ' 🛡️✕') : '';
      const blade = h.cls === 'ranged' ? ' 🏹'
                  : h.cls === 'caster' ? ' ✨'
                  : h.heldSaber ? ' ⚔' : h.swordT > 0 ? ' ⚔' + Math.ceil(h.swordT / 60) + 's' : '';
      return '<span style="color:' + col + '">' + label + dash + aeg + blade + '</span>';
    };
    hud.innerHTML += '<br>' + hero(player, 'P1', '#fff') + '   ' + hero(p2, 'P2', P2_COL);
  }
  if (player.choke > 0) hud.innerHTML = '<span style="color:#ff5252;font-weight:bold">✊ FORCE CHOKE — mash X / SPACE to break free!</span><br>' + hud.innerHTML;
  if (ianActive) hud.innerHTML = ianFinale
    ? 'the creator\'s fate is sealed...'
    : ianChoice ? '<span style="color:#fff">SPARE or KILL — ← → · Z to choose</span>' : 'the creator kneels, unarmed, before you';
}

// ── hero-actions — enemyColor, movement, dash, swing/shoot/cast/scythe, summons, the Nine ──
function enemyColor(e) {
  if (e.flashT > 0 && sfOpts.flash > 0) return '#ffffff';   // impact frame — the flash outranks everything (player-optional)
  if (freezeT > 0 || e.stun > 0 || e.frozen > 0) return '#8fd8ff';
  if (e.type === 'wraith')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#5d4f8a' : '#16121e';
  if (e.type === 'witchking')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#7e57c2' : '#14101c';
  if (e.type === 'trooper')
    return (swState === 'fire' && e.fireT < 10 && (api.reduceMotion || Math.floor(frame / 3) % 2 === 0)) ? '#ffd0d0' : '#f4f7f9';
  if (e.type === 'vader') {
    const tell = api.reduceMotion || Math.floor(frame / 4) % 2 === 0;
    if ((e.mode === 'cast' || e.mode === 'choke') && tell) return '#3a2d4a';  // Force telegraph (violet)
    if (e.mode === 'wind' && tell) return '#3a3a3a';                          // melee tell (grey)
    return e.phase2 ? '#140a0a' : '#0a0a0a';
  }
  if (e.type === 'sidious') {
    const tell = api.reduceMotion || Math.floor(frame / 4) % 2 === 0;
    if (e.mode === 'cast' && tell) return '#3a2750';   // lightning telegraph (violet)
    if (e.mode === 'wind' && tell) return '#2f2f33';   // spin tell (grey)
    return '#0a0a10';
  }
  if (e.type === 'guard') {
    if (e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0)) return '#ff6b6b';
    return '#9b1c1c';
  }
  if (e.type === 'dio') return '#1f1b29';   // drawDio uses its own palette
  if (e.type === 'shaman') return '#7a9a52'; // sickly moss — the chanting robe
  if (e.type === 'bomber')
    return e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#ffb3a0' : '#a1662f';  // powder-brown; flushes as the fuse burns
  if (e.type === 'ogre')
    return e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#a1452f' : '#6d4c41';
  if (e.type === 'troll') {
    if (e.elite) {
      // bull troll: rust hide; dread troll: near-black — both pulse furnace-red
      // once enraged (steady when reduced motion)
      const raging = e.hp <= (e.elite === 2 ? 3 : 2) && (api.reduceMotion || Math.floor(frame / 5) % 2 === 0);
      if (raging) return e.elite === 2 ? '#e64a19' : '#c0392b';
      return e.elite === 2 ? '#3e2723' : '#7f3b30';
    }
    return '#5d4037';
  }
  if (e.type === 'archer')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : e.elite === 2 ? '#b06858' : e.elite ? '#d8a89a' : '#cfc8a0';
  if (e.type === 'wolf')
    return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : e.elite === 2 ? '#e8f4fb' : e.elite ? '#8fc7e8' : '#546e7a';
  // shield-bearer goblins are bronze; the warlord gleams brass-gold
  return e.elite === 2 ? '#c9a227' : e.elite ? '#8d6e63' : '#1b5e20';
}

// shared per-hero movement physics (friction, speed cap, dash trail, charge recharge).
// Called once per hero per tick; in single-player it's only ever player, so behaviour
// (and RNG consumption — there is none here) is identical to the old inline block.
function moveHero(h, ix, iy) {
  // a frost-wolf chill drags the hero's acceleration and top speed (dash unaffected — the escape valve)
  const chill = (h.chillT > 0 ? 0.55 : 1) * bn.spd * h.bn.spd;   // banes are global, Fleet Foot is the picker's own
  if (h.chillT > 0) h.chillT--;
  // the dragoon rides Joust physics: heavy glide (little friction), sluggish
  // steering, and a far higher ceiling — momentum is the class's whole weapon.
  // The wyrm (the co-op pair's beast) shares them wholesale.
  const drag = h.cls === 'dragoon' || h.cls === 'wyrm';
  const fr = drag ? 0.93 : 0.86, ac = drag ? 0.3 : 0.62;
  h.vx = h.vx * fr + ix * ac * chill;
  h.vy = h.vy * fr + iy * ac * chill;
  const pv = Math.hypot(h.vx, h.vy);
  const cap = (drag ? DRAG_CAP * up.dragCap : 4.3) * chill;
  // the speed cap lifts during a dash and while reeling from a Force push, so the shove carries
  if (h.dashT <= 0 && h.stunT <= 0 && (h.choke || 0) <= 0 && pv > cap) { h.vx *= cap / pv; h.vy *= cap / pv; }
  h.x = clamp(h.x + h.vx, 14, GW - 14);
  h.y = clamp(h.y + h.vy, 40, GH - 10);
  if (pv > 0.4) h.phase += 0.06 + pv * 0.045;
  if (h.dashT > 0) {
    h.dashT--;
    if (h.cls !== 'wyrm') ghosts.push({ x: h.x, y: h.y, phase: h.phase, t: 16, cls: h.cls, dir: h.fx >= 0 ? 1 : -1 });   // the beast leaves dust, not afterimages
    // Phantom Strike: dashing through a foe staggers it (the no-flinch bosses shrug it off)
    if (up.dashStrike) {
      for (const e of enemies) {
        if (untouchable(e) || e.frozen > 0 || e.stun > 0) continue;
        if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') continue;
        if (Math.hypot(e.x - h.x, e.y - h.y) < 22) {
          e.stun = 20; e.vx = 0; e.vy = 0;
          sparks.push({ x: e.x, y: e.y - 28, t: 12, color: '#80deea', txt: '✦' });
        }
      }
    }
  }
  if (h.iframe > 0) h.iframe--;   // post-shield invulnerability beat
  if (h.dashCharges < up.dashMax && h.rechargeT > 0 && --h.rechargeT <= 0) {
    h.dashCharges++;
    if (h.dashCharges < up.dashMax) h.rechargeT = up.dashCd;  // chain refills
  }
}

function tryDash(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.choke || 0) > 0 || h.dashT > 0 || h.dashCharges <= 0) return;
  const d = Math.hypot(h.fx, h.fy) || 1;
  h.vx = h.fx / d * 11;
  h.vy = h.fy / d * 11;
  h.dashT = up.dashLen;
  h.dashCharges--;
  if (h.rechargeT <= 0) h.rechargeT = up.dashCd;  // start refilling
  sfSfx.dash();
}

function trySwing(h) {
  // Cooldown is gated on the sim tick (not performance.now) so it's part of the
  // deterministic state. up.swingMs stays in ms for the upgrade defs; convert here.
  // The blade (Excalibur / lightsaber) is the run's shared resource — in co-op either
  // hero may wield it, each on their own swing timer (h.swingT / h.swingReadyTick).
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.swordT <= 0 && !h.heldSaber) || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.swingMs * SIM_HZ / 1000); h.swingT = 10;
  h.heldSaber ? sfSfx.saberHit() : sfSfx.swing();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const fx = h.fx / fd, fy = h.fy / fd;
  const kills0 = kills;
  for (const e of enemies) {
    // bosses are untouchable while they run a scripted, non-aggressive intro — no cheesing them first
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > up.swingR + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
    if ((dx / d) * fx + (dy / d) * fy < -0.2) continue;  // ~220° cleave in front
    if (e.hp && --e.hp > 0) {
      e.flashT = 2;   // impact frames (see rangedHit)
      if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
        // bosses / the war-ogre don't flinch — a brief parry stagger, no stunlock
        e.stun = Math.max(e.stun || 0, e.type === 'ogre' ? 10 : 6);
        sparks.push({ x: e.x, y: e.y - 34, t: 14, color: '#ff8a80', txt: e.type === 'dio' ? 'CLANG' : 'CLASH' });
        sfSfx.saberHit();
      } else {
        e.stun = 18; sfSfx.thud();
        e.x = clamp(e.x + dx / d * 50, -60, GW + 60);
        e.y = clamp(e.y + dy / d * 50, -60, GH + 60);
        sparks.push({ x: e.x, y: e.y - 30, t: 14, color: '#fff', txt: (e.type === 'wraith' || e.type === 'witchking') ? 'SCREECH' : 'CLANG' });
      }
    } else killEnemy(e);
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain > 0) shake = Math.max(shake, Math.min(10, 2 + slain * 2));
  for (let i = arrows.length - 1; i >= 0; i--) {  // the blade meets the bolts
    const a = arrows[i];
    if (a.kind === 'parrow') continue;            // never bat a partner's arrows out of the air
    const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d < up.swingR + 20 && (dx / d) * fx + (dy / d) * fy > -0.2) {
      sparks.push({ x: a.x, y: a.y, t: 12, color: '#fff', txt: '✦' });
      if (a.kind === 'laser') {
        // deflect the blaster bolt off in a random direction — now yours, lethal to troopers
        const ang = rnd() * Math.PI * 2;
        const spd = Math.hypot(a.vx, a.vy) || 5.2;
        a.vx = Math.cos(ang) * spd; a.vy = Math.sin(ang) * spd;
        a.reflected = true; a.t = 240;
      } else if (up.riposte && a.kind !== 'vsaber') {
        // Riposte: the batted shot is yours now — it flies on away from you
        a.kind = 'parrow'; a.dmg = 1; a.pierce = 0; a.hitSet = null;
        a.bounces = up.ricochet ? 1 : 0;
        a.vx = dx / d * 6.5; a.vy = dy / d * 6.5; a.t = 120;
      } else {
        arrows.splice(i, 1);  // ordinary arrows are just batted out of the air
      }
    }
  }
}

/* ── the other class kits: the attack key dispatches by h.cls ── */
function tryAttack(h) {
  if (!h) return;
  if (h.cls === 'ranged') return tryShoot(h);
  if (h.cls === 'caster') return tryCast(h);
  if (h.cls === 'necro') return tryScythe(h);
  if (h.cls === 'dragoon' || h.cls === 'wyrm') return tryFlap(h);
  if (h.cls === 'rider') return tryLance(h);
  return trySwing(h);
}
/* ── the rider (the co-op pair's saddle seat) ──
   Mounted, the rider never steers — their movement keys are an 8-way TURRET AIM
   (set in the loop's P2 block) and the attack key JABS a lance along it: the
   nearest foe in a narrow cone takes a rangedHit. Thrown/dismounted, the same
   key is a short desperate stab. Lance kills top up the shared heat gauge. */
function tryLance(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.max(8, Math.round(up.jabT)); h.swingT = 8;
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  const reach = h.mounted ? up.riderReach : 34;
  let best = null, bd = Infinity;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > e.kr + reach) continue;
    if ((dx / d) * ux + (dy / d) * uy < 0.6) continue;   // a jab, not a sweep
    if (d < bd) { bd = d; best = e; }
  }
  if (!best) { sfSfx.blip(); return; }
  sfSfx.thud();
  if (rangedHit(best, 1, ux, uy) && p2 && p2.cls === 'rider') heat = Math.min(up.heatMax, heat + HEAT_LANCE);
  enemies = enemies.filter(e => !e.dead);
}
// FIRE BREATH — the rider's spender (the spell-cycle key, E): drinks BREATH_COST
// from the shared heat gauge and rakes a cone along the aim. Bosses stagger by
// the usual no-flinch rules; the pack burns. Only tramples and lance kills
// refill the gauge — the beast earns, the rider spends.
function tryBreath(h) {
  if (!h || h.down || !h.mounted || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0) return;
  if (heat < up.breathCost) {
    sparks.push({ x: h.x, y: h.y - 20, t: 12, color: '#ff8a65', txt: 'no heat' });
    sfSfx.blip();
    return;
  }
  heat -= up.breathCost;
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  fieldWashSet('255,120,40', 0.12, 32);   // (render-only)
  addDecal(h.x + ux * BREATH_R * 0.5, h.y + uy * BREATH_R * 0.5, 'scorch');
  sfSfx.bomb(); shake = Math.max(shake, 6);
  blasts.push({ kind: 'fire', x: h.x + ux * BREATH_R * 0.45, y: h.y + uy * BREATH_R * 0.45, r: 0, t: 0, life: 22, rMax: BREATH_R * 0.6 });
  const kills0 = kills;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > BREATH_R + e.kr) continue;
    if ((dx / d) * ux + (dy / d) * uy < up.breathCone) continue;   // a tight cone along the aim
    rangedHit(e, up.breathDmg, ux, uy);
    if (!e.dead && e.hp > 0) e.stun = Math.max(e.stun || 0, 24);   // scorched
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain >= 4) sfUnlock('dragonfire');
  if (slain > 1) sparks.push({ x: h.x + ux * 60, y: h.y - 30, t: 16, color: '#ff8a65', txt: slain + ' BURNED' });
}
/* ── the dragoon (arcade JOUST) ──
   The attack key carries no weapon at all — it's a WING FLAP, an impulse along the
   facing that buys speed and direction changes on a short tick cooldown. The lance
   does all the killing, and the lance IS your velocity (see joustSweep). */
function tryFlap(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || (h.choke || 0) > 0 || tick < (h.flapReadyTick || 0)) return;
  h.flapReadyTick = tick + Math.max(6, Math.round(up.flapCd));
  h.flapT = tick;
  const d = Math.hypot(h.fx, h.fy) || 1;
  h.vx += h.fx / d * FLAP_IMP;
  h.vy += h.fy / d * FLAP_IMP;
  if (h.cls !== 'wyrm') ghosts.push({ x: h.x, y: h.y, phase: h.phase, t: 12, cls: h.cls, dir: h.fx >= 0 ? 1 : -1 });
  sfSfx.flap();
}
// a foe's skewer bar: how fast the lance must fly to take it (null = unjoustable)
function joustBar(e) {
  const b = JOUST_BAR[e.type];
  if (b === undefined) return null;   // ian — the choice is not made with a lance
  return b + (e.elite === 2 ? JOUST_DREAD : e.elite ? JOUST_ELITE : 0);
}
/* the JOUST itself: runs every tick per mounted hero, BEFORE the contact loop.
   Any foe inside lance reach, roughly ahead of the velocity, with the rider at or
   above its skewer bar, takes a lance hit (rangedHit rules — bosses stagger and
   never die to a pass; grunts are skewered clean). A SURVIVOR caroms the rider off
   Joust-style — reflect off the contact normal — so momentum never carries you
   into a body you only wounded. Below the bar (or hit from the flank) nothing
   happens here, and the ordinary touch-death contact loop right after this is the
   "or you die" half of the rule. Consumes no rnd(); safe for lockstep and replays. */
function joustSweep(h) {
  if (dioStopT > 0 || ianActive) return;              // stopped time / the choice — no lance
  const pv = Math.hypot(h.vx, h.vy);
  if (pv < 2) return;                                 // barely moving — the lance hangs slack
  const ux = h.vx / pv, uy = h.vy / pv;
  for (const e of enemies) {
    if (untouchable(e) || e.type === 'ian') continue;
    if (tick < (e.joustTick || 0)) continue;          // one hit per pass
    const bar = joustBar(e);
    if (bar === null || pv < bar) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > e.kr + PLAYER_R + LANCE_R + up.lanceR + (h.cls === 'wyrm' ? WYRM_R : 0)) continue;
    if ((dx / d) * ux + (dy / d) * uy < 0.35) continue;   // the lance points where you fly
    e.joustTick = tick + 26;
    const survived = !rangedHit(e, up.joustDmg, ux, uy);
    sparks.push({ x: (h.x + e.x) / 2, y: (h.y + e.y) / 2 - 20, t: 14, color: DRAGOON_COL, txt: h.cls === 'wyrm' ? 'TRAMPLE' : 'SKEWER' });
    if (!survived && h.cls === 'wyrm') {
      heat = Math.min(up.heatMax, heat + HEAT_TRAMPLE + up.heatTrampleB);   // the beast earns
      trampleN++;
      if (trampleN >= 15) sfUnlock('trampler');
    }
    if (!survived && h.cls === 'dragoon' && e.type === 'troll') sfUnlock('skewered');
    if (survived) {
      // carom: bounce off the contact normal, keep most of the speed
      const nx = dx / d, ny = dy / d;
      const vn = h.vx * nx + h.vy * ny;
      if (vn > 0) { h.vx -= 2 * vn * nx; h.vy -= 2 * vn * ny; }
      h.vx *= 0.9; h.vy *= 0.9;
      h.x = clamp(h.x - nx * 6, 14, GW - 14);
      h.y = clamp(h.y - ny * 6, 40, GH - 10);
    } else {
      if (h.bn.cry) knockback(e.x, e.y, 0, 60, 12);   // SHRILL CRY: the picker's kills scatter the pack
      if (up.tailwind) {                              // Tailwind: a kill feeds the gallop
        const s = Math.min(1.15, (DRAG_CAP * up.dragCap) / Math.max(pv, 0.1));
        h.vx *= s; h.vy *= s;
      }
    }
  }
  enemies = enemies.filter(e => !e.dead);
}
// foes the player cannot damage yet (scripted intros) — mirrors trySwing's skip rules
function untouchable(e) {
  return e.dead ||
         (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) ||
         ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0);
}
// an arrow/bolt lands on e: the blade's no-flinch rules, with a gentler shove
function rangedHit(e, dmg, ux, uy) {
  if (e.hp && (e.hp -= dmg) > 0) {
    e.flashT = 2;   // impact frames: the survivor blazes white for a beat (persists through hit-stop)
    if (e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'ogre') {
      e.stun = Math.max(e.stun || 0, e.type === 'ogre' ? 10 : 6);
      sparks.push({ x: e.x, y: e.y - 34, t: 14, color: '#ff8a80', txt: 'TSSS' });
      sfSfx.saberHit();
    } else {
      e.stun = 14; sfSfx.thud();
      e.x = clamp(e.x + ux * 16, -60, GW + 60);
      e.y = clamp(e.y + uy * 16, -60, GH + 60);
      sparks.push({ x: e.x, y: e.y - 30, t: 12, color: '#fff', txt: (e.type === 'wraith' || e.type === 'witchking') ? 'SCREECH' : 'THUNK' });
    }
    return false;
  }
  killEnemy(e);
  return true;
}
// ranged: the bow is always strung — a skill shot, not a homing one. The arrow
// flies in the direction being held (8-way, diagonals included); release the keys
// and it fires along the last facing. Aim by footwork.
function tryShoot(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.shotMs * SIM_HZ / 1000); h.swingT = 8;
  sfSfx.arrow();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const ux = h.fx / fd, uy = h.fy / fd;
  const n = up.shotCount, spread = 0.16;
  const spd = ARROW_SPD * up.arrowSpd;                       // Long Draw: faster, farther
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * spread;
    const ca = Math.cos(off), sa = Math.sin(off);
    arrows.push({ x: h.x + ux * 12, y: h.y - 18 + uy * 12, kind: 'parrow',
                  vx: (ux * ca - uy * sa) * spd, vy: (ux * sa + uy * ca) * spd,
                  t: Math.round(110 * up.arrowSpd), dmg: up.shotDmg, pierce: up.shotPierce,
                  bounces: up.ricochet ? 1 : 0, hitSet: null });
  }
}
/* ── the wizard's spellbook (see SPELLS) ──
   The attack key casts the SELECTED page: a deliberate incantation — mana is
   drunk up front, the staff orb swells in the spell's color for `cast` ticks,
   then resolveCast() fires it. A press with no mana or no mark in reach fizzles
   free (no cooldown, no mana); a cast whose mark dies mid-incantation refunds
   half. Kills spark +4 mana each (Overcharge refunds much of a killing cast),
   so bold play sustains itself where hiding runs dry. */
function heroSpells() { return up.spells; }     // the party's known pages, in learn order
function curSpell(h) { return heroSpells()[(h.spellSel || 0) % heroSpells().length] || 'bolt'; }
// the cycle key turns the page — queued through pend like every combat input,
// recorded as opcode 11 (the selection changes what the attack key DOES)
function cycleSpell(h) {
  if (!h || h.cls !== 'caster' || h.down || !started || !alive || paused ||
      sidFinale || dioFinale || dioStopT > 0 || ianActive || h.castT > 0) return;
  const n = heroSpells().length;
  if (n < 2) { sparks.push({ x: h.x, y: h.y - 42, t: 14, color: '#ce93d8', txt: 'one page…' }); return; }
  h.spellSel = ((h.spellSel || 0) + 1) % n;
  const sp = SPELLS[curSpell(h)];
  sparks.push({ x: h.x, y: h.y - 44, t: 20, color: sp.col, txt: sp.icon + ' ' + sp.name });
  sfSfx.blip();
}
function nearestFoe(h, r) {
  let t = null, bd = r;
  for (const e of enemies) {
    if (untouchable(e)) continue;
    const d = Math.hypot(e.x - h.x, e.y - h.y);
    if (d < bd) { bd = d; t = e; }
  }
  return t;
}
function tryCast(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || h.castT > 0 || tick < h.swingReadyTick) return;
  const key = curSpell(h), sp = SPELLS[key];
  if (h.mana < sp.cost) {                       // the well is dry — fizzle free
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 12, color: '#7986cb', txt: 'no mana' });
    sfSfx.blip();
    return;
  }
  // every page but the nova needs a mark in reach at the moment of the press
  const reach = key === 'bolt' ? ZAP_R : key === 'fire' ? FIRE_TGT_R : STORM_R;
  if (key !== 'nova' && !nearestFoe(h, reach)) {
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 10, color: '#ce93d8', txt: '·' });
    return;
  }
  h.mana -= sp.cost;                            // committed — the incantation drinks up front
  h.manaHoldTick = tick + MANA_HOLD;            // ...and the well holds its breath (no regen for a beat)
  h.swingReadyTick = tick + Math.round(up.zapMs * SIM_HZ / 1000);
  const castT = Math.max(4, Math.round(sp.cast * h.bn.castMul));   // Flicker Cast trims the picker's wind-up
  h.castT = castT; h.castMax = castT; h.casting = key;
  sfSfx.bolt();
}
// the wind-up completes: the spell resolves against the field as it is NOW
// (each targeted page re-marks with a little grace, since foes had `cast`
// ticks to drift). Returns are routed so a slipped mark refunds half.
function resolveCast(h) {
  const key = h.casting || 'bolt', sp = SPELLS[key];
  h.casting = null;
  const kills0 = kills;
  let landed = true;
  if (key === 'nova') castNova(h);
  else if (key === 'fire') landed = castFire(h);
  else if (key === 'storm') landed = castStorm(h);
  else landed = castBolt(h);
  if (!landed) {                                // the mark slipped away mid-incantation
    h.mana = Math.min(up.manaMax, h.mana + Math.round(sp.cost / 2));
    sparks.push({ x: h.x + h.fx * 16, y: h.y - 24, t: 10, color: '#ce93d8', txt: 'fzzt' });
    return;
  }
  h.swingT = 10;
  const slain = kills - kills0;                 // soul sparks: kills feed the well (Siphon doubles them)
  if (slain > 0) {
    const back = slain * (h.bn.sparks2 ? 10 : 5) + (up.overcharge ? Math.round(sp.cost * 0.3) : 0);
    h.mana = Math.min(up.manaMax, h.mana + back);
    sparks.push({ x: h.x, y: h.y - 34, t: 12, color: '#b39ddb', txt: '🔮+' + back });
  }
}
// ARCANE BOLT — the signature: arcs to the nearest foe and chains up.zapJumps hops
function castBolt(h) {
  const t = nearestFoe(h, ZAP_R + 40);
  if (!t) return false;
  sfSfx.zap();
  const pts = [{ x: h.x, y: h.y - 16 }];
  const hit = new Set();
  let from = t;
  for (let j = 0; j < up.zapJumps && from; j++) {
    hit.add(from);
    const prev = pts[pts.length - 1];
    const dv = Math.hypot(from.x - prev.x, (from.y - 14) - prev.y) || 1;
    pts.push({ x: from.x, y: from.y - 14 });
    rangedHit(from, 1, (from.x - prev.x) / dv, ((from.y - 14) - prev.y) / dv);
    let nx = null, nd = ZAP_HOP;                // the arc leaps on to the next foe
    for (const e of enemies) {
      if (untouchable(e) || hit.has(e)) continue;
      const dd = Math.hypot(e.x - from.x, e.y - from.y);
      if (dd < nd) { nd = dd; nx = e; }
    }
    from = nx;
  }
  blasts.push({ kind: 'chain', pts, t: 0, life: 16 });
  return true;
}
// FROST NOVA — an ice ring around the caster; always erupts (positioning IS the aim)
function castNova(h) {
  sfSfx.freeze();
  addDecal(h.x, h.y, 'frost');   // (render-only) a bloom the field remembers
  blasts.push({ kind: 'frost', x: h.x, y: h.y, r: 0, t: 0, life: 26, rMax: NOVA_R });
  let n = 0;
  for (const e of enemies) {
    // same immunities as the frost powerup — the great bosses shrug off the cold
    if (e.type === 'witchking' || e.type === 'vader' || e.type === 'sidious' || e.type === 'dio' || e.type === 'wraith') continue;
    if (untouchable(e)) continue;
    if (Math.hypot(e.x - h.x, e.y - h.y) < NOVA_R) { e.frozen = 240; e.vx = 0; e.vy = 0; n++; }  // briefer than the powerup's FROST_DUR
  }
  sparks.push({ x: h.x, y: h.y - 36, t: 24, color: '#8fd8ff', txt: n ? 'FROZEN x' + n : 'frost nova' });
}
// FIREBALL — hurled at the nearest mark; erupts THERE (kill + shove, like the powerup)
function castFire(h) {
  const t = nearestFoe(h, FIRE_TGT_R + 40);
  if (!t) return false;
  const cx = t.x, cy = t.y;                     // the eruption outlives its mark
  sfSfx.bomb(); shake = Math.max(shake, 10);
  addDecal(cx, cy, 'scorch');   // (render-only)
  blasts.push({ kind: 'fire', x: cx, y: cy, r: 0, t: 0, life: 30, rMax: FIREB_R });
  knockback(cx, cy, FIREB_R, 180, 40);
  sparks.push({ x: cx, y: cy - 36, t: 24, color: '#ff8a65', txt: 'FWOOSH' });
  return true;
}
// TEMPEST — the Archmage's page: a great arc that leaps six marks, striking twice as hard
function castStorm(h) {
  const t0 = nearestFoe(h, STORM_R + 40);
  if (!t0) return false;
  sfSfx.zap(); shake = Math.max(shake, 8);
  const pts = [{ x: h.x, y: h.y - 16 }];
  const hit = new Set();
  let from = t0;
  for (let j = 0; j < 6 && from; j++) {
    hit.add(from);
    const prev = pts[pts.length - 1];
    const dv = Math.hypot(from.x - prev.x, (from.y - 14) - prev.y) || 1;
    pts.push({ x: from.x, y: from.y - 14 });
    rangedHit(from, 2, (from.x - prev.x) / dv, ((from.y - 14) - prev.y) / dv);
    let nx = null, nd = STORM_HOP;
    for (const e of enemies) {
      if (untouchable(e) || hit.has(e)) continue;
      const dd = Math.hypot(e.x - from.x, e.y - from.y);
      if (dd < nd) { nd = dd; nx = e; }
    }
    from = nx;
  }
  blasts.push({ kind: 'chain', pts, t: 0, life: 20 });
  sfUnlock('tempest');
  return true;
}
/* ── the necromancer's soul scythe ──
   One press, two verbs. First the REAP: a wide arc in front (rangedHit rules —
   bosses stagger, grunts shove), every kill feeding the soul well. Then the
   RAISE: husks caught in the sweep stand up as minions while souls and the
   cap allow (banned wherever champions are banned — boss rooms are yours alone). */
function tryScythe(h) {
  if (!h || h.down || !started || !alive || paused || sidFinale || dioFinale || dioStopT > 0 || tick < h.swingReadyTick) return;
  h.swingReadyTick = tick + Math.round(up.scytheMs * SIM_HZ / 1000);
  h.swingT = 10;
  sfSfx.swing();
  const fd = Math.hypot(h.fx, h.fy) || 1;
  const fx = h.fx / fd, fy = h.fy / fd;
  const kills0 = kills;
  for (const e of enemies) {
    // the same scripted-intro protections as the blade
    if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;
    if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;
    const dx = e.x - h.x, dy = e.y - h.y, d = Math.hypot(dx, dy) || 1;
    if (d > SCYTHE_R + (e.type === 'troll' ? 14 : e.type === 'ogre' ? 20 : 0)) continue;
    if ((dx / d) * fx + (dy / d) * fy < -0.1) continue;   // a wide reaping arc in front
    rangedHit(e, 1, dx / d, dy / d);
  }
  enemies = enemies.filter(e => !e.dead);
  const slain = kills - kills0;
  if (slain > 0) {
    const gain = slain * (SOUL_KILL + (up.reaper ? 3 : 0) + h.bn.soulBonus);
    h.souls = Math.min(SOULS_MAX, h.souls + gain);
    sparks.push({ x: h.x, y: h.y - 36, t: 14, color: NECRO_COL, txt: '+' + gain + ' souls' });
    shake = Math.max(shake, Math.min(8, 2 + slain * 2));
  }
  // the raise — nearest-pushed-last order doesn't matter; any husk in the sweep rises
  if (!champsBanned()) {
    for (let i = husks.length - 1; i >= 0; i--) {
      if (minions.length >= up.minionCap || h.souls < up.raiseCost) break;
      const k = husks[i];
      const dx = k.x - h.x, dy = k.y - h.y, d = Math.hypot(dx, dy) || 1;
      if (d > RAISE_R || (dx / d) * fx + (dy / d) * fy < -0.3) continue;
      husks.splice(i, 1);
      h.souls -= up.raiseCost;
      minions.push({ src: k.src, x: k.x, y: k.y, hp: up.minionHp + (k.elite ? 1 : 0),
                     t: Math.round(MINION_T * h.bn.minionMul),   // Restless: the picker's loans run longer
                     phase: 0, fx: 1, hitCd: 20, hurtCd: 30, shotCd: 60, elite: k.elite });
      if (minions.length >= 4) sfUnlock('army_4');
      blasts.push({ kind: 'frost', x: k.x, y: k.y, r: 0, t: 0, life: 16, rMax: 44 });
      sparks.push({ x: k.x, y: k.y - 30, t: 22, color: NECRO_COL, txt: 'RISE' });
      sfSfx.ignite();
    }
  }
}

function trySummon(kind) {
  if (!started || !alive || paused || champsBanned()) return;
  if (meter < up.summonCost || !up.champs[kind]) return;  // need a banked charge, and the ally unlocked
  if (allies.some(g => g.kind === kind)) return;          // one of each kind at a time
  meter -= up.summonCost; meterPrompted = false;          // spend one charge (keep the rest)
  const fromLeft = player.x > GW / 2;
  const champT = Math.round(CHAMP_T * up.champMul);
  const g = { kind, t: champT, t0: champT, x: fromLeft ? -30 : GW + 30, y: clamp(player.y, 60, GH - 30),
              side: fromLeft ? -1 : 1, shotCd: 40, arrived: false,
              slashCd: 0, slashT: 0, fx: 1, fy: 0, oraT: 0, oraCd: 30, target: null };
  if (kind === 'gandalf') {
    banner = 'YOU SHALL NOT PASS!'; bannerSub = 'the white wizard fights beside you';
    sfSfx.summon();
  } else if (kind === 'luke') {
    banner = '"I am a Jedi, like my father before me."'; bannerSub = 'a green blade hums to life';
    sfSfx.saber();
  } else {
    g.x = player.x + 50; g.y = player.y;  // Star Platinum needs no entrance — time stops instead
    banner = 'ZA WARUDO!'; bannerSub = 'time has stopped';
    freezeT = 130;
    sfSfx.zawarudo();
  }
  bannerT = 110;
  allies.push(g);
  sfUnlock('summoner');
  if (allies.length >= 3) sfUnlock('fellowship');
}

function championPrompt() {
  if (!started || !alive || paused || champsBanned() || meter < up.summonCost || !champUnlocked()) return;
  banner = 'summon an ally'; bannerSub = champReadyText(); bannerT = 150;
}

// the Nazgûl set piece: all nine at once, in a ring — and no champion to hide behind
function summonTheNine() {
  stopSfMusic();   // the horde theme dies here — the Nine arrive in silence
  wave = 5; nineActive = true; nineDone = false; wraithsLeft = 9; waveQuota = 0;
  bossActive = false; bossRiseT = 0;
  banner = 'the Nine'; bannerSub = 'they hunt as one — no champion can save you now'; bannerT = 140;
  sfSfx.screech();
  if (allies.length) {
    allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: '...gone.' }));
    allies = [];
  }
  for (let i = 0; i < 9; i++) {
    const a = i * Math.PI * 2 / 9;
    warns.push({ x: clamp(player.x + Math.cos(a) * 330, 30, GW - 30),
                 y: clamp(player.y + Math.sin(a) * 330, 50, GH - 20),
                 type: 'wraith', t: 60 });
  }
}

// ── flow — startStarWars, stopGame, the 9-spam warp cheats ──
// the Star Wars interlude: a corridor where a squad of stormtroopers forms up, then opens fire
function startStarWars() {
  swActive = true; swState = 'march'; swReadyT = 0; vaderActive = false;
  enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
  // no medieval steel beyond the door — Excalibur stays behind
  stone = null; clearBlades();
  // a lightsaber waits on the deck — but only a melee hero has any use for it
  saberPickup = heroesAll().some(h => h.cls === 'melee') ? { x: GW * 0.30, y: GH / 2 } : null;
  // player has just charged through the doorway — slam them against the west wall
  player.x = 34; player.y = GH / 2; player.vx = 0; player.vy = 0;
  // co-op: P2 lands beside P1, and both arm up — a single floor saber can't equip two,
  // and both heroes need a blade to deflect bolts and duel Vader. (Skip the lone pickup.)
  // A fresh set-piece also revives a fallen partner so nobody's stuck down through the duel.
  if (coop && p2) {
    for (const h of heroesAll()) { h.down = false; h.reviveT = 0; h.shield = up.shield; }
    p2.x = 34; p2.y = GH / 2 + 42; p2.vx = 0; p2.vy = 0;
    saberPickup = null; armSaberAll(true);
  }
  // a fixed starfield so it doesn't flicker frame to frame
  swStars = [];
  for (let i = 0; i < 70; i++) {
    swStars.push({ x: rnd() * GW, y: rnd() * GH, r: rnd() * 1.3 + 0.3 });
  }
  const cols = 4, rows = 4;
  // tight formation, pushed to the right of the room
  const baseX = GW * 0.75, dx = (GW * 0.92 - baseX) / (cols - 1);
  const baseY = GH * 0.32, dy = (GH * 0.74 - baseY) / (rows - 1);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slotX = baseX + c * dx, slotY = baseY + r * dy;
      // enter from off the east edge in a marching column — front rank (right column) leads
      // (spawn x stays within updateEnemy's GW+60 clamp so the ranks don't bunch up)
      const e = makeEnemy('trooper', GW + 16 + (cols - 1 - c) * 14, slotY);
      e.slotX = slotX; e.slotY = slotY;
      e.fireT = 50 + rnd() * 150;   // staggered so the volley isn't a single wall
      enemies.push(e);
    }
  }
  swTroopersLeft = rows * cols;
  banner = 'IMPERIAL CORRIDOR'; bannerSub = 'a squad marches in — cut them down'; bannerT = 150;
  sfSfx.wave();
}

function stopGame() {
  if (netplay || netUi) netSend({ t: 'bye' });   // the desktop is shutting down — tell the partner
  netTeardown();
  alive = false;
  stopSfMusic();
  wraithSfx.pause();
  if (rafId) cancelAnimationFrame(rafId);
  document.removeEventListener('keydown', onKey);
  document.removeEventListener('keyup',   offKey);
  document.removeEventListener('paste',   onPaste);
  window.removeEventListener('blur', dropKeys);
  canvas.remove(); hud.remove(); xp._sfCleanup = null;
  const matte = document.getElementById('sf-matte');
  if (matte) matte.remove();   // the letterbox backdrop must never outlive the game
}

let cheatBuf = '', nineKeyCount = 0, last9 = 0, eightKeyCount = 0, last8 = 0;
function skipToTheNine() {
  if (!alive || nineActive || bossActive || bossRiseT > 0) return;
  bossIntro = null;
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; breatherT = 0;
  summonTheNine();
}
function skipToWitchKing() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; corpses = []; breatherT = 0;
  nineActive = false; bossRiseT = 0; awaitExit = false; swActive = false; swState = ''; swFadeT = 0;
  wave = 5; nineDone = true; bossActive = true; waveQuota = 0;
  if (allies.length) { allies.forEach(g => sparks.push({ x: g.x, y: g.y - 50, t: 36, color: '#fff', txt: '...gone.' })); allies = []; }
  beginBossIntro('witchking', () => {
    enemies.push(makeEnemy('witchking', GW / 2, 60));
    banner = 'the Witch-king of Angmar'; bannerSub = 'no living man may hinder him'; bannerT = 150;
    sfSfx.screech(); shake = 16;
  });
}
function skipToPreStarWars() {
  if (!alive) return;
  stopSfMusic();
  bossIntro = null;
  if (!started) { started = true; frame = 60; }
  enemies = []; warns = []; arrows = []; bolts = []; corpses = []; breatherT = 0;
  nineActive = false; bossActive = false; bossRiseT = 0; swActive = false; swState = ''; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0; awaitExit = true;
  banner = 'the Witch-king is no more'; bannerSub = 'run east —'; bannerT = 120;
}
function skipToVader() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0;
  startStarWars();                          // build the corridor (starfield, west-wall spawn)
  enemies = []; arrows = []; swTroopersLeft = 0;  // skip the trooper squad entirely
  armSaberAll(true); saberPickup = null;     // hand the heroes the lightsaber outright
  vaderActive = true; swState = 'vader';
  beginBossIntro('vader', () => {
    banishAllies();                          // the duel is his alone
    const vx = player.x < GW / 2 ? GW - 70 : 70;
    enemies.push(makeEnemy('vader', vx, GH / 2));
    banner = 'DARTH VADER'; bannerSub = 'the dark lord bars your path'; bannerT = 150;
    score += 500; addMeter(30); sfSfx.saber();
  });
}
function skipToSidious() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  wave = 5; nineDone = true; waveQuota = 0;
  startStarWars();                          // build the void, then drop straight to the Emperor
  enemies = []; arrows = []; warns = []; swTroopersLeft = 0; vaderActive = false;
  beginBossIntro('sidious', startSidious);
}
function skipToJojo() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0; sidFinale = null;
  wave = 5; nineDone = true; waveQuota = 0;
  beginBossIntro('dio', startJojo);
}
function skipToIan() {
  if (!alive) return;
  stopSfMusic();
  if (!started) { started = true; frame = 60; }
  nineActive = false; bossActive = false; bossRiseT = 0; awaitExit = false; swFadeT = 0;
  sidFinale = null; dioFinale = null; jojoActive = false; swActive = false;
  wave = 5; nineDone = true; waveQuota = 0;
  enemies = []; arrows = []; warns = []; mournful = false; endless = false;
  beginBossIntro('ian', startIan);
}

// ── input — onKey (~300 lines), key-name normalization, listener wiring, boot ──
// The key map is keyed by a Shift-invariant name: single characters are lowercased so a
// letter released while Shift is held (keyup fires as 'D', not 'd') still clears the same
// entry that keydown set. Without this, P2's WASD keys stick when dashing (Left-Shift) —
// e.g. holding 'd' to run right + tapping Shift leaves keys['d'] true forever. (Arrow keys
// aren't case-sensitive, which is why only P2's letter movement was affected.)
const keyName = (k) => (k.length === 1 ? k.toLowerCase() : k);
function onKey(e) {
  keys[keyName(e.key)] = true;
  // watching a replay: Q leaves; every other key belongs to the legend, not you
  if (replayMode) {
    if (!e.repeat && (e.key === 'q' || e.key === 'Q')) stopReplay();
    e.preventDefault();
    return;
  }
  // the pause/settings shell owns the keys while it is up (and un-holds them:
  // online the sim runs underneath, and menu arrows must not steer your hero)
  if (shellMenu) {
    keys[keyName(e.key)] = false;
    if (e.key === 'ArrowUp') shellSel = (shellSel + 3) % 4;
    else if (e.key === 'ArrowDown') shellSel = (shellSel + 1) % 4;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (shellSel === 0) sfOpts.shake = sfOpts.shake === 1 ? 0.5 : sfOpts.shake === 0.5 ? 0 : 1;
      else if (shellSel === 1) sfOpts.kick = sfOpts.kick > 0 ? 0 : 1;
      else if (shellSel === 2) sfOpts.flash = sfOpts.flash > 0 ? 0 : 1;
      else sfOpts.hiVis = !sfOpts.hiVis;
      saveOpts();
      if (sfSfx.killE) sfSfx.killE();
    } else if (!e.repeat && ['p', 'P', 'q', 'Q', 'Enter', 'z', 'Z'].includes(e.key)) {
      if (!netplay) recPush([tick + 1, 13, 0]);   // the unpause is a sim beat too
      shellToggle();
    }
    e.preventDefault();
    return;
  }
  // P — pause & settings (solo/couch truly pause, recorded as opcode 13 so
  // replays hold the beats; online it overlays a live sim and records nothing)
  if ((e.key === 'p' || e.key === 'P') && !e.repeat && started && alive && !bossIntro && !killCam && !paused) {
    if (!netplay) recPush([tick + 1, 13, 0]);
    shellToggle();
    e.preventDefault();
    return;
  }
  // an online run: Q leaves cleanly at any point (tell the partner first)
  if (netplay && !e.repeat && (e.key === 'q' || e.key === 'Q')) {
    netSend({ t: 'bye' });
    netLeave('you left the game');
    e.preventDefault();
    return;
  }
  // the kill cam holds the stage — any key skips straight to the death screen
  if (!alive && killCam) {
    if (!e.repeat) killCam = null;
    e.preventDefault();
    return;
  }
  // the results ceremony: any key fast-forwards to the hall of legends
  if (!alive && !killCam && !replayMode && deadT > 34 && deadT < 176) {
    if (!e.repeat) deadT = 176;
    e.preventDefault();
    return;
  }
  // death-screen watch picker: ↑↓ choose a legend, Enter watches, Q/W closes
  if (!alive && watchSel) {
    const n = watchSel.list.length;
    if (e.key === 'ArrowUp')        watchSel.idx = (watchSel.idx + n - 1) % n;
    else if (e.key === 'ArrowDown') watchSel.idx = (watchSel.idx + 1) % n;
    else if (e.key === 'Enter' && !e.repeat) startWatch(watchSel.list[watchSel.idx]);
    else if (['q', 'Q', 'w', 'W', 'Escape'].includes(e.key)) watchSel = null;
    e.preventDefault();
    return;
  }
  // W on the board view opens the picker (only when some entry has a stored replay)
  if (!alive && (e.key === 'w' || e.key === 'W') && (lbState === 'view' || lbState === 'done')) {
    const list = watchableEntries();
    if (list.length) { watchSel = { list, idx: 0 }; watchErr = ''; e.preventDefault(); return; }
  }
  // entering a name for the leaderboard after death — capture typing, swallow
  // everything else (so letters/digits go into the name, not cheats or the R-restart)
  if (!alive && lbState === 'enter') {
    if (e.key === 'Enter') lbSubmit();
    else if (e.key === 'Backspace') lbName = lbName.slice(0, -1);
    else if (e.key.length === 1 && lbName.length < 10 && /[A-Za-z0-9._-]/.test(e.key)) lbName += e.key;
    e.preventDefault();
    return;
  }
  // ── intro screen: pick 1P/2P on the mode row and a class per hero, then begin ──
  // ↑/↓ switch rows (mode · P1 class · P2 class in 2P), ←/→ change the value on the
  // active row (1/2 still jump the mode directly); Z / Enter / Space begins. Defaults
  // (1-PLAYER · MELEE) keep the classic run one Enter away. (The headless determinism
  // test starts by dispatching Enter, then holds ArrowRight to move.)
  if (!started) {
    // the HOST/JOIN connect screens own the keys while they're up
    if (netUi) {
      const backOut = () => {
        netSend({ t: 'bye' });
        netTeardown();
        netUi = null; netSaved = null; netCfg = null;
      };
      // class is still changeable on the connect screens (◀ ▶) right up until
      // the link opens — the host's cfg reads classSel when the hello arrives,
      // the joiner's hello reads it at channel-open
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
          ['creating', 'waiting', 'code', 'err', 'lobby'].includes(netUi.phase)) {
        const d = e.key === 'ArrowRight' ? 1 : -1;
        // only the HOST (P1) may pick the WYRM & RIDER pair — the joiner is the
        // saddle seat by definition, so their cycle never reaches it
        const list = netUi.mode === 'host' ? [0, 1, 2, 3, 4, PAIR_WYRM] : [0, 1, 2, 3, 4];
        let ci = list.indexOf(classSel); if (ci < 0) ci = 0;
        classSel = list[(ci + d + list.length) % list.length];
        try { localStorage.setItem('ilaird_sf_cls', String(classSel)); } catch (err) { /* private mode */ }
        if (netUi.phase === 'lobby') {
          // re-picking un-readies you (the run must never start under a stale pick)
          if (netUi.myReady) netLobbyReady(false);
          netLobbyCls();
        }
        if (sfSfx.killE) sfSfx.killE();
        e.preventDefault();
        return;
      }
      if (netUi.phase === 'code') {
        // code entry first: Q is a valid room-code character, so here it TYPES —
        // Backspace on an empty code is the back-out (Escape is the desktop's)
        if (e.key === 'Enter' && netUi.input.length === 5) netStartJoin(netUi.input);
        else if (e.key === 'Backspace') {
          if (netUi.input.length === 0) backOut();
          else netUi.input = netUi.input.slice(0, -1);
        } else if (e.key.length === 1 && /[a-z0-9]/i.test(e.key) && netUi.input.length < 5) {
          netUi.input += e.key.toUpperCase();
        }
      } else if (netUi.phase === 'lobby' && !e.repeat && ['z', 'Z', 'Enter', ' '].includes(e.key)) {
        // the READY gate: the run starts only when the WHOLE band has confirmed
        netLobbyReady(!netUi.myReady);
        if (sfSfx.killE) sfSfx.killE();
      } else if (!e.repeat && (e.key === 'q' || e.key === 'Q')) {
        backOut();
      } else if (netUi.phase === 'waiting' && !e.repeat && (e.key === 'c' || e.key === 'C')) {
        // the code is canvas-drawn (unselectable) — C puts it on the clipboard
        try {
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(netUi.code).then(
              () => { if (netUi) netUi.copiedT = 150; },
              () => {},
            );
          }
        } catch (err) { /* clipboard unavailable — the code stays typeable */ }
      } else if (netUi.phase === 'err' && !e.repeat && ['z', 'Z', 'Enter'].includes(e.key)) {
        if (netUi.mode === 'host') netOpen('host');           // roll a fresh room
        else { netUi.phase = 'code'; netUi.input = ''; netUi.err = ''; }
      }
      e.preventDefault();
      return;
    }
    // the trophy case: T toggles it; while open it swallows the intro keys
    // (Escape is avoided on purpose — that's the XP desktop's shutdown key)
    // the couch co-op party sheet: Z/Enter falls through to the begin branch below;
    // Q/Backspace/X backs out; every other intro key is swallowed while it's up
    if (introConfirm && !['z', 'Z', 'Enter', ' '].includes(e.key)) {
      if (!e.repeat && ['q', 'Q', 'Backspace', 'x', 'X'].includes(e.key)) {
        introConfirm = false;
        if (sfSfx.killE) sfSfx.killE();
      }
      e.preventDefault();
      return;
    }
    if (e.key === 't' || e.key === 'T') { showTrophies = !showTrophies; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (showTrophies) { e.preventDefault(); return; }
    const nRows = isLocalMulti() ? 4 : 3;   // top · sub · class (· P2 class in LOCAL)
    if (e.key === 'ArrowUp')   { introRow = (introRow + nRows - 1) % nRows; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === 'ArrowDown') { introRow = (introRow + 1) % nRows; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    // 1/2/3 quick-jumps keep their old muscle memory: solo · couch co-op · daily
    if (e.key === '1') { menuTop = 0; subSingle = 0; if (introRow === 3) introRow = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === '2') { menuTop = 1; subMulti = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === '3') { menuTop = 0; subSingle = 2; if (introRow === 3) introRow = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowRight' ? 1 : -1;
      const nc = CLASSES.length;
      if (introRow === 0) menuTop = (menuTop + 1) % 2;
      else if (introRow === 1) {
        if (menuTop === 0) {
          do { subSingle = (subSingle + d + 3) % 3; } while (subSingle === 1 && !hardUnlocked);   // HARD is skipped until earned
        } else {
          subMulti = (subMulti + d + 3) % 3;
        }
      }
      else if (introRow === 2) {
        // P1 cycles the five solo classes, plus the WYRM & RIDER pair in couch
        // co-op; picking the wyrm binds P2 to the rider (and unbinds on leaving)
        const list = isLocalMulti() ? [0, 1, 2, 3, 4, PAIR_WYRM] : [0, 1, 2, 3, 4];
        let ci = list.indexOf(classSel); if (ci < 0) ci = 0;
        classSel = list[(ci + d + list.length) % list.length];
        if (classSel === PAIR_WYRM) classSel2 = PAIR_RIDER;
        else if (classSel2 >= PAIR_WYRM) classSel2 = 0;
      }
      else if (classSel !== PAIR_WYRM) {   // the rider's seat isn't negotiable
        const list = [0, 1, 2, 3, 4];
        let ci = list.indexOf(classSel2); if (ci < 0) ci = 0;
        classSel2 = list[(ci + d + list.length) % list.length];
      }
      if (sfSfx.killE) sfSfx.killE();
      e.preventDefault(); return;
    }
    if (['z', 'Z', 'Enter', ' '].includes(e.key)) {
      try { localStorage.setItem('ilaird_sf_cls', String(classSel)); localStorage.setItem('ilaird_sf_cls2', String(classSel2)); } catch (_) {}
      if (menuTop === 1 && subMulti !== 0) {
        // online: hand off to the connect flow — the run starts only after BOTH
        // players ready up in the lobby (see the 'lobby' phase)
        netOpen(subMulti === 1 ? 'host' : 'join');
        e.preventDefault();
        return;
      }
      if (menuTop === 1 && subMulti === 0 && !introConfirm) {
        // couch co-op: show the party sheet first — a second Z/Enter starts
        introConfirm = true;
        if (sfSfx.killE) sfSfx.killE();
        e.preventDefault();
        return;
      }
      introConfirm = false;
      coop = menuTop === 1;                                  // LOCAL couch co-op
      dailyRun = menuTop === 0 && subSingle === 2;
      hardSel = menuTop === 0 && subSingle === 1;            // only reachable once hardUnlocked
      // daily pins the shared per-day seed through the existing MP/replay hook;
      // a normal run clears it back to fresh entropy
      sfSeedOverride = dailyRun ? dailySeed() : null;
      init();                     // fresh state on the chosen seed (init reads classSel/coop/hardSel)
      beginRunProof();            // stamp the start time for the leaderboard's proof check
      started = true; frame = 0;
      banner = (dailyRun ? '☀ DAILY CHALLENGE' : coop ? 'CO-OP · WAVE 1' : 'WAVE 1') + (hardMode ? ' · ☠ HARD' : '');
      bannerSub = dailyRun ? dailyDayPretty() + ' — same seed for everyone' : hardMode ? 'the horde remembers your mercy' : '';
      // synchronous: the seed's first draws, live and in replay alike.
      // Hard mode gets no gifts — the run opens on a BANE instead.
      hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
      bannerT = 90;
      startSfMusic();
    }
    e.preventDefault();
    return;
  }
  // a boon offer on the table — nothing else responds until one is taken.
  // ONLINE, the host drives every shared menu: its confirm becomes a tick-stamped
  // event (netQueueEvent) applied by BOTH feeders at the same tick — never a direct
  // call, which would fire it on one sim only and desync. The client just watches.
  if (paused && boonMenu) {
    // each seat confirms its OWN boon — everyone else just watches
    // (locally the players share the keyboard, so no gate is needed)
    if (netplay && (boonMenu.who | 0) !== netSeat) { e.preventDefault(); return; }
    const n = boonMenu.opts.length;
    if (['ArrowLeft', 'a', 'A'].includes(e.key))       { boonMenu.sel = (boonMenu.sel + n - 1) % n; sfSfx.killE(); }
    else if (['ArrowRight', 'd', 'D'].includes(e.key)) { boonMenu.sel = (boonMenu.sel + 1) % n; sfSfx.killE(); }
    else if (!e.repeat && ['z', 'Z', ' ', 'Enter'].includes(e.key)) {
      // stamped tick+1 like every between-tick UI event (see the shop below)
      if (netplay) netQueueEvent(12, boonMenu.opts[boonMenu.sel].id);
      else { recPush([tick + 1, 12, boonMenu.opts[boonMenu.sel].id]); pickBoon(boonMenu.opts[boonMenu.sel].id); }
    }
    e.preventDefault();
    return;
  }
  // upgrade menu between waves — input only navigates the shop while paused.
  // ONLINE both players shop at once: each navigates their OWN cursor (sel is
  // view-local — never sim-read), and a confirm crosses as a tick-stamped BUY
  // event carrying the node id, so simultaneous picks resolve deterministically
  // (first event wins; a second buy of the same id no-ops in the feeder).
  if (paused && upMenu) {
    const rows = availableUpgrades();
    const n = rows.length + 1;                       // +1 = the Continue row
    if (['ArrowUp', 'ArrowLeft', 'w', 'W'].includes(e.key))        { upMenu.sel = (upMenu.sel - 1 + n) % n; sfSfx.killE(); }
    else if (['ArrowDown', 'ArrowRight', 's', 'S'].includes(e.key)) { upMenu.sel = (upMenu.sel + 1) % n; sfSfx.killE(); }
    else if (['z', 'Z', ' ', 'Enter'].includes(e.key)) {           // select the highlighted row
      // UI events happen BETWEEN ticks, so they're stamped tick+1: the replay
      // feeder applies them at the top of the next tick — the exact same slot
      if (upMenu.sel >= rows.length) {
        if (netplay) netQueueEvent(8, 0);
        else { recPush([tick + 1, 8]); finishUpgrades(); }        // on Continue → leave
      } else if (netplay) netQueueEvent(7, rows[upMenu.sel].id);
      else { recPush([tick + 1, 7, rows[upMenu.sel].id]); buyUpgrade(rows[upMenu.sel]); }  // on a node → unlock it
    }
    e.preventDefault();
    return;
  }
  // the final confrontation with the creator — all play is locked; only the choice responds
  if (ianActive) {
    if (ianChoice && !(netplay && !netIsHost)) {
      if (['ArrowLeft', 'a', 'A'].includes(e.key)) { ianChoice.sel = 0; sfSfx.killE(); }
      else if (['ArrowRight', 'd', 'D'].includes(e.key)) { ianChoice.sel = 1; sfSfx.killE(); }
      else if (!e.repeat && ['z', 'Z', ' ', 'Enter'].includes(e.key)) {
        if (ianChoice.t >= 60 * SIM_HZ) sfUnlock('the_weight');   // a full minute holding his fate
        if (netplay) netQueueEvent(10, ianChoice.sel);
        else { recPush([tick + 1, 10, ianChoice.sel]); chooseIan(ianChoice.sel); }
      }
    }
    e.preventDefault();
    return;
  }
  // cheat: type "nine" to skip straight to the Nazgûl set piece.
  // Every cheat marks the run `cheated` — still a playground, never ranked.
  // ALL warp/grant cheats are disabled online: they mutate the sim outside the
  // tick-stamped input stream, which would desync the two peers instantly.
  if (!netplay && /^[a-z]$/i.test(e.key)) {
    cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-8);
    if (cheatBuf.endsWith('nine')) { cheatBuf = ''; cheated = true; skipToTheNine(); }
  }
  // cheat: spam 9 — 3×=ringwraiths, 4×=Witch-king, 5×=east door, 6×=Vader, 7×=Sidious, 8×=DIO
  if (!netplay && e.key === '9' && !e.repeat) {
    const now = performance.now();
    nineKeyCount = now - last9 > 1500 ? 1 : nineKeyCount + 1;
    last9 = now;
    if (nineKeyCount >= 3) cheated = true;
    if (nineKeyCount === 3) skipToTheNine();
    else if (nineKeyCount === 4) skipToWitchKing();
    else if (nineKeyCount === 5) skipToPreStarWars();
    else if (nineKeyCount === 6) skipToVader();
    else if (nineKeyCount === 7) skipToSidious();
    else if (nineKeyCount === 8) skipToJojo();
    else if (nineKeyCount >= 9) { nineKeyCount = 0; skipToIan(); }
  }
  // cheat: spam 8 three times to unlock the entire upgrade tree
  if (!netplay && e.key === '8' && !e.repeat) {
    const now = performance.now();
    eightKeyCount = now - last8 > 1500 ? 1 : eightKeyCount + 1;
    last8 = now;
    if (eightKeyCount >= 3) { eightKeyCount = 0; cheated = true; grantAllUpgrades(); }
  }
  // boss intro cutscene — confirm advances the card / dialogue; the 8/9 cheats above
  // still warp through, but nothing else responds while the card is up
  if (bossIntro) {
    if (!e.repeat && ['z', 'Z', 'x', 'X', 'f', 'F', ' ', 'Enter'].includes(e.key)) {
      if (netplay) { if (netIsHost) netQueueEvent(9, 0); }   // the host turns the page for both
      else { recPush([tick + 1, 9]); advanceBossIntro(); }
    }
    e.preventDefault();
    return;
  }
  // Force choke: the only escape is to struggle — mash attack/dash; nothing else responds.
  // Mashes queue like every other combat input and land on the next tick.
  if (player.choke > 0) {
    if (!e.repeat && ['x', 'X', 'f', 'F', ' ', 'Shift'].includes(e.key)) {
      if (netplay) { if (netIsHost) netLocal.mash++; }   // the choke grips P1 = the host
      else pend.mash++;
    }
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    return;
  }
  // combat keys. Solo: Space/Shift dash, X/F swing (unchanged). Co-op splits them by
  // hand — P1 = Right-Shift dash + '/' swing, P2 = Left-Shift dash + F swing (the two
  // Shifts are told apart by e.code). Summons/champion-prompt are shared either way.
  // All of these QUEUE into `pend` and apply at the next sim tick (per-tick input
  // capture) — never mutate the sim from inside the event handler.
  if (netplay) {
    // ONLINE both peers get the full solo bindings; edges stage into netLocal and
    // ride the next outgoing input frame (never straight into pend — the frame is
    // the sim's only input path online, identical on both machines)
    if (e.key === ' ' || e.key === 'Shift') netLocal.dash = true;
    if (e.key === 'x' || e.key === 'X' || e.key === 'f' || e.key === 'F') netLocal.atk = true;
    if (e.key === 'c' || e.key === 'C' || e.key === 'e' || e.key === 'E') netLocal.cycle = true;
    if (e.key === '1') netLocal.summon = 0;
    if (e.key === '2') netLocal.summon = 1;
    if (e.key === '3') netLocal.summon = 2;
  } else if (!coop) {
    if (e.key === ' ' || e.key === 'Shift') pend.dashP1 = true;
    if (e.key === 'x' || e.key === 'X' || e.key === 'f' || e.key === 'F') pend.atkP1 = true;
    if (e.key === 'c' || e.key === 'C' || e.key === 'e' || e.key === 'E') pend.cycleP1 = true;  // the wizard turns a spellbook page
  } else {
    if (e.code === 'ShiftRight') pend.dashP1 = true;
    if (e.code === 'Slash') pend.atkP1 = true;
    if (e.code === 'Period') pend.cycleP1 = true;      // beside '/' — P1's spell page
    if (e.code === 'ShiftLeft') pend.dashP2 = true;
    if (e.key === 'f' || e.key === 'F') pend.atkP2 = true;
    if (e.key === 'e' || e.key === 'E') pend.cycleP2 = true;  // beside F — P2's spell page
  }
  if (e.key === 'g' || e.key === 'G') pend.prompt = true;   // banner only — local & unrecorded
  if (!netplay) {
    if (e.key === '1') pend.summon = 'gandalf';
    if (e.key === '2') pend.summon = 'luke';
    if (e.key === '3') pend.summon = 'jotaro';
  }
  if ((e.key === 'r' || e.key === 'R') && !alive) {
    if (netplay) {
      // rematch is host-authoritative: a fresh shared seed, same team & snapshot
      // (blocked while reconnecting — a restart the peer can't hear would desync)
      if (netIsHost && netCfg && !netReconActive() && !e.repeat) {
        const seed = (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
        netCfg.seed = seed;
        netSend({ t: 'restart', seed });
        netBeginRun();
      }
      e.preventDefault();
      return;
    }
    sfSeedOverride = dailyRun ? dailySeed() : null;   // re-pin today's seed (recomputed in case midnight passed)
    init();
    beginRunProof();
    started = true;
    banner = (dailyRun ? '☀ DAILY CHALLENGE' : coop ? 'CO-OP · WAVE 1' : 'WAVE 1') + (hardMode ? ' · ☠ HARD' : '');
    bannerSub = dailyRun ? dailyDayPretty() + ' — same seed for everyone' : hardMode ? 'the horde remembers your mercy' : '';
    bannerT = 90; startSfMusic();
    hardMode ? openBaneMenu('CHOOSE YOUR BANE') : openBoonMenu('CHOOSE YOUR BOON');
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) || e.code === 'Slash') e.preventDefault();
}
function offKey(e) { keys[keyName(e.key)] = false; }
function dropKeys() { keys = {}; }   // release everything (focus loss → missed keyups)
// ⌘/Ctrl+V fills the JOIN code entry (the paste event carries the clipboard without
// any permission prompt; only listened to on the code screen)
function onPaste(e) {
  if (started || !netUi || netUi.phase !== 'code') return;
  const txt = (e.clipboardData && e.clipboardData.getData('text')) || '';
  const code = txt.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
  if (code) { netUi.input = code; e.preventDefault(); }
}
document.addEventListener('keydown', onKey);
document.addEventListener('keyup',   offKey);
document.addEventListener('paste',   onPaste);
// Safety net for stuck movement: if the window loses focus (alt-tab, a click into the
// devtools, etc.) the keyup may never arrive, leaving a key "held". Drop all held keys on
// blur so a hero can't run off on its own.
window.addEventListener('blur', dropKeys);

init(); frameStep();
xp._sfCleanup = stopGame;
}

// Public entry point. As a classic script this is already a window global, but
// make it explicit so it survives the obfuscated build (where this file is wrapped
// in an IIFE — top-level names no longer auto-attach to window). desktop.js's
// launchStickFighter() finds the chunk through this. Keep `openStickFighter` on the
// obfuscator's reserved-names list.
window.openStickFighter = openStickFighter;
