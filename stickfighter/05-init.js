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
    recHdr = { v: 5, seed: sfSeed >>> 0, c1: classSel, c2: classSel2, coop, hd: hardMode ? 1 : 0,
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
