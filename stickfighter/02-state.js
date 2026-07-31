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
const NET_SIM_V = 5;    // sim-balance version — MUST track recHdr.v (a stale sw.js build on one peer would silently desync); 5 = great-boss knockback immunity + deterministic equal-tick event order
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
