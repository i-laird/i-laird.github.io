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
const SF_CANVAS_CSS = 'position:absolute;left:0;top:0;width:100%;height:calc(100% - 40px);pointer-events:none;z-index:5;';
function setGameDims(w, h) {
  GW = w; GH = h;
  canvas.width = w; canvas.height = h;
  const availW = xp.offsetWidth, availH = xp.offsetHeight - 40;
  if (w === availW && h === availH) { canvas.style.cssText = SF_CANVAS_CSS; return; }
  // negotiated (smaller) field: aspect-preserving centred fit on a black matte
  const sc = Math.min(availW / w, availH / h);
  const cw = Math.round(w * sc), chh = Math.round(h * sc);
  canvas.style.cssText = 'position:absolute;pointer-events:none;z-index:5;background:#000;' +
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
