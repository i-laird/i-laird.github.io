// Stick Fighter 2000 — fantasy horde-survival game, lazily loaded on first launch
// from the gui XP desktop (see launchStickFighter() in app.js). Loaded as a CLASSIC
// script, it exposes one global, openStickFighter(xp, api). Everything it needs from
// app.js/lib arrives through the explicit `api` bridge (app.js's sfBridge():
// unlockAchievement, _chirp, makeRng, HAL_WORKER_URL, and the live soundEnabled /
// reduceMotion / activeMusic accessors) — it references NOTHING from app.js by free
// global name, so it can be bundled & obfuscated as an independent lazy chunk without
// cross-file name-mangling breaking. The only contract is openStickFighter + the api
// key names (keep both on the obfuscator's reserved list). The running game parks its
// teardown on xp._sfCleanup so the desktop's shutdown() can stop it when the XP window
// closes.
// NOTE: kept at its original (8-space) indentation on purpose — it contains multi-line
// template literals, so blanket de-indenting would corrupt them.

        function openStickFighter(xp, api) {
          if (document.getElementById('sf-canvas')) { xp._sfCleanup && xp._sfCleanup(); return; }

          // Dependency bridge from app.js (see sfBridge() there). The game references
          // NOTHING from app.js by free global name — everything external comes through
          // `api`, so this file can be obfuscated as an independent lazy chunk. Stable
          // refs are destructured here (call sites unchanged); the runtime-varying flags
          // (soundEnabled / reduceMotion) and the shared, game-mutated activeMusic are
          // read/written through `api` live (api.soundEnabled, api.activeMusic = …, etc.).
          const { unlockAchievement, _chirp, makeRng, HAL_WORKER_URL } = api;

          const GW = xp.offsetWidth;
          const GH = xp.offsetHeight - 40;

          // transparent canvas over the whole desktop
          const canvas = document.createElement('canvas');
          canvas.id = 'sf-canvas';
          canvas.width = GW; canvas.height = GH;
          canvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:calc(100% - 40px);pointer-events:none;z-index:5;';
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

          let best = parseInt(localStorage.getItem('ilaird_sf_best') || '0', 10) || 0;
          let player, enemies, warns, coins, powerups, blasts, sparks, ghosts,
              score, mult, wave, alive, started, frame, keys, rafId,
              freezeT, banner, bannerSub, bannerT, deadT, shake, newBest,
              stone, stoneCd, stoneSeen,
              meter, meterPrompted, allies, bolts, arrows, kills,
              nineActive, nineDone, wraithsLeft, waveQuota, breatherT,
              corpses, bossActive, bossRiseT, bossRiseX, bossRiseY,
              awaitExit, swActive, swState, swReadyT, swFadeT, swTroopersLeft, swStars,
              saberPickup, vaderActive, up, paused, upMenu, tokens, swFlash,
              sidiousActive, sidiousCue, sidiousIntroT, ltnBolts, ltnFlash, dlg, dlgT, sidFinale,
              jojoActive, jojoCue, jojoBg, dioStopT, dioStopFx, roadRoller, dioFinale, bossIntro, playerStand,
              ianCue, ianActive, ianChoice, ianFinale, mournful, endless, ianBg, wraithLunged, ogreSpawned;
          // online leaderboard ("hall of legends"): lbState drives the death screen
          //   off=worker down/unscored · loading · enter=typing a name · submitting · view/done=show the board
          let lbScores = null, lbState = 'off', lbName = '', lbRank = -1, lbScore = 0, lbWave = 0;
          // ── local couch co-op (chosen on the intro screen; persists across R-restarts) ──
          //   coop=false → the classic single-player game, byte-for-byte unchanged (every co-op
          //   branch is gated on `coop`, so the deterministic sim and its tests are untouched).
          //   P1 = arrows (move) · Right-Shift (dash) · '/' (swing).  P2 = WASD · Left-Shift · F.
          //   Allies/meter/upgrades are shared; a felled hero is DOWN and a partner revives them
          //   by standing close — the run only ends when both are down.
          let coop = false, coopSel = 0, p2 = null;
          const P2_COL    = '#8fe388';   // P2's stick figure — a soft green, distinct from white P1 and enemy red
          const REVIVE_T  = 150;         // frames a partner must stand by a downed hero to revive them (~2.5s)

          function init() {
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
                       swingT: 0, swingReadyTick: 0, swordT: 0, heldSaber: false, down: false, downT: 0, reviveT: 0 };
            p2 = null;
            enemies = []; warns = []; coins = []; powerups = []; blasts = []; sparks = []; ghosts = [];
            bolts = []; arrows = [];
            score = 0; mult = 1; wave = 1; alive = true; started = false; frame = 0;
            keys = {}; freezeT = 0; banner = ''; bannerSub = ''; bannerT = 0;
            deadT = 0; shake = 0; newBest = false;
            stone = null; stoneCd = 150; stoneSeen = false;
            meter = 0; meterPrompted = false; allies = []; kills = 0;
            nineActive = false; nineDone = false; wraithsLeft = 0;
            waveQuota = 11; breatherT = 0;
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
            wraithLunged = false; ogreSpawned = false;
            lbScores = null; lbState = 'off'; lbName = ''; lbRank = -1; lbScore = 0; lbWave = 0;
            up = { owned: new Set(), dashMax: 0, dashLen: 13, dashCd: DASH_CD,
                   champs: { gandalf: false, luke: false, jotaro: false },
                   champMul: 1, meterMul: 1, summonCost: METER_MAX, swingMs: SWING_MS, swingR: SWING_R, shield: false };
            paused = false; upMenu = null;
            tokens = parseInt(localStorage.getItem('ilaird_sf_tokens') || '0', 10) || 0;  // unspent tokens persist too
            applySavedUpgrades();              // unlocked upgrades are permanent — re-apply across runs
            player.dashCharges = up.dashMax; player.rechargeT = 0;
            player.shield = up.shield;         // the Aegis starts each run charged, then refreshes per wave
            if (coop) setupCoop();             // a second hero joins; both share allies, meter & upgrades
          }

          /* ── couch co-op helpers ── */
          // Build P2 and stand the two heroes apart at centre-screen. Called from init() (so R
          // restarts straight into co-op) and the moment 2-PLAYER is confirmed on the intro.
          function setupCoop() {
            player.x = GW / 2 - 48; player.y = GH / 2;
            p2 = { x: GW / 2 + 48, y: GH / 2, vx: 0, vy: 0, phase: 0, fx: -1, fy: 0,
                   dashT: 0, dashCd: 0, stunT: 0, choke: 0, chokeBreak: 0, iframe: 0,
                   shield: up.shield, dashCharges: up.dashMax, rechargeT: 0,
                   swingT: 0, swingReadyTick: 0, swordT: 0, heldSaber: false, down: false, downT: 0, reviveT: 0 };
          }
          // each hero arms independently — the blade (Excalibur / lightsaber) lives on the hero,
          // not the run. helpers for the scripted interlude transitions that arm/disarm everyone.
          function armSaberAll(v) { for (const h of heroesAll()) h.heldSaber = v; }
          function clearBlades() { for (const h of heroesAll()) { h.swordT = 0; h.swingT = 0; h.heldSaber = false; } }
          // the active heroes; in single-player this is just [player], so co-op code stays a no-op
          function heroesAll()  { return (coop && p2) ? [player, p2] : [player]; }
          function heroesLive() { return heroesAll().filter(h => !h.down); }
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
          // who a horde grunt chases. The scripted boss/set-piece foes stay locked on P1 (their
          // duels are cinematic 1-on-1s); the open-field horde splits aggro to the nearest hero.
          function hordeTarget(e) {
            if (!coop || bossActive || nineActive) return player;
            const t = e.type;
            if (t === 'wraith' || t === 'witchking' || t === 'vader' || t === 'sidious' ||
                t === 'dio' || t === 'guard' || t === 'trooper' || t === 'ian') return player;
            return nearestLiveHero(e.x, e.y);
          }

          /* unlocked upgrades persist (like achievements): saved by id in localStorage and
             re-applied on every run, so progress in the tree carries across the whole session. */
          const SF_UP_KEY = 'ilaird_sf_upgrades';
          function loadSavedUpgrades() {
            try { return new Set(JSON.parse(localStorage.getItem(SF_UP_KEY) || '[]')); } catch (_) { return new Set(); }
          }
          function saveUpgrades() {
            try { localStorage.setItem(SF_UP_KEY, JSON.stringify([...up.owned])); } catch (_) {}
          }
          function saveTokens() {
            try { localStorage.setItem('ilaird_sf_tokens', String(tokens)); } catch (_) {}
          }
          function applySavedUpgrades() {
            const saved = loadSavedUpgrades();
            for (const u of UPGRADES) {           // definition order so dependent values settle correctly
              if (saved.has(u.id)) { up.owned.add(u.id); u.apply(); }
            }
          }
          // cheat: unlock the entire upgrade tree at once (definition order so dependent values settle)
          function grantAllUpgrades() {
            for (const u of UPGRADES) { if (!up.owned.has(u.id)) { up.owned.add(u.id); u.apply(); } }
            saveUpgrades();
            banner = 'ALL UPGRADES UNLOCKED'; bannerSub = 'the full tree — dash · allies · blade'; bannerT = 150;
            if (typeof sfSfx !== 'undefined' && sfSfx.summon) sfSfx.summon();
          }
          /* a token is earned only the FIRST time a given level is beaten (highest cleared
             level persisted) — so permanent upgrades can't be farmed by replaying easy waves. */
          function grantLevelToken(level) {
            const maxW = parseInt(localStorage.getItem('ilaird_sf_maxwave') || '0', 10) || 0;
            if (level <= maxW) return false;
            tokens++; saveTokens();
            try { localStorage.setItem('ilaird_sf_maxwave', String(level)); } catch (_) {}
            return true;
          }

          /* ── upgrades: a token-based skill tree. Each cleared wave grants a token;
             spend tokens (1 each) on unlocked nodes, or save them to grab several at once. ── */
          const UPGRADES = [
            { id: 'dash',        tree: 'DASH',   name: 'Dash',            desc: 'unlock the dash — SPACE / Shift',    icon: '💨', req: null,         apply: () => { up.dashMax = 1; player.dashCharges = 1; } },
            { id: 'dash_long',   tree: 'DASH',   name: 'Longer Dash',     desc: 'dash farther, longer invincibility', icon: '📏', req: 'dash',       apply: () => { up.dashLen = 20; } },
            { id: 'dash_2',      tree: 'DASH',   name: 'Second Dash',     desc: 'a second dash charge',               icon: '✌️', req: 'dash',       apply: () => { up.dashMax = 2; player.dashCharges = up.dashMax; } },
            { id: 'dash_3',      tree: 'DASH',   name: 'Third Dash',      desc: 'a third dash charge',                icon: '🔋', req: 'dash_2',     apply: () => { up.dashMax = 3; player.dashCharges = up.dashMax; } },
            { id: 'dash_cd',     tree: 'DASH',   name: 'Quick Feet',      desc: 'dashes recharge faster',             icon: '🌀', req: 'dash_2',     apply: () => { up.dashCd = 46; } },
            { id: 'shield',      tree: 'DASH',   name: 'Aegis Shield',    desc: 'block one hit · refreshes each wave', icon: '🛡️', req: null,         apply: () => { up.shield = true; player.shield = true; } },
            { id: 'dash_master', tree: 'DASH',   name: 'Blink Master',    desc: '4th charge · far · near-instant cd',  icon: '🌌', req: 'dash_3',     cost: 3, apply: () => { up.dashMax = 4; player.dashCharges = up.dashMax; up.dashLen = 26; up.dashCd = 30; } },
            { id: 'gandalf',     tree: 'ALLIES', name: 'Summon Gandalf',  desc: 'press 1 — staff bolts',              icon: '🧙', req: null,         apply: () => { up.champs.gandalf = true; } },
            { id: 'luke',        tree: 'ALLIES', name: 'Summon Luke',     desc: 'press 2 — a green saber',            icon: '⚔️', req: 'gandalf',    apply: () => { up.champs.luke = true; } },
            { id: 'jotaro',      tree: 'ALLIES', name: 'Summon Jotaro',   desc: 'press 3 — ZA WARUDO',                icon: '👊', req: 'luke',       apply: () => { up.champs.jotaro = true; } },
            { id: 'champ_long',  tree: 'ALLIES', name: 'Lasting Allies',  desc: 'allies fight 60% longer',            icon: '⏳', req: 'gandalf',    apply: () => { up.champMul = 1.6; } },
            { id: 'champ_long2', tree: 'ALLIES', name: 'Eternal Allies',  desc: 'allies fight far longer still',      icon: '♾️', req: 'champ_long', apply: () => { up.champMul = 2.4; } },
            { id: 'champ_fast',  tree: 'ALLIES', name: 'Quick Summon',    desc: 'meter charges 50% faster',           icon: '⏩', req: 'gandalf',    apply: () => { up.meterMul = 1.5; } },
            { id: 'champ_cost',  tree: 'ALLIES', name: 'Cheap Summon',    desc: 'allies cost less meter to call',     icon: '🪙', req: 'gandalf',    apply: () => { up.summonCost = Math.round(METER_MAX * 0.7); } },
            { id: 'champ_master',tree: 'ALLIES', name: 'The Fellowship',  desc: 'allies linger · charge fast · cheap', icon: '💍', req: 'champ_long2', cost: 3, apply: () => { up.champMul = 4; up.meterMul = 2.2; up.summonCost = Math.round(METER_MAX * 0.5); } },
            { id: 'swing_fast',  tree: 'BLADE',  name: 'Swift Blade',     desc: 'swing more often',                   icon: '🗡️', req: null,         apply: () => { up.swingMs = 440; } },
            { id: 'swing_fast2', tree: 'BLADE',  name: 'Lightning Blade', desc: 'swing even more often',              icon: '⚡', req: 'swing_fast', apply: () => { up.swingMs = 300; } },
            { id: 'swing_wide',  tree: 'BLADE',  name: 'Wide Cleave',     desc: 'wider sword reach',                  icon: '↔️', req: null,         apply: () => { up.swingR = 150; } },
            { id: 'swing_wide2', tree: 'BLADE',  name: 'Great Cleave',    desc: 'even wider reach',                   icon: '⭕', req: 'swing_wide', apply: () => { up.swingR = 195; } },
            { id: 'swing_master',tree: 'BLADE',  name: 'Andúril',         desc: 'huge reach · blistering swing speed', icon: '🔥', req: 'swing_wide2', cost: 2, apply: () => { up.swingR = 250; up.swingMs = 210; } },
          ];
          const upCost = (u) => u.cost || 1;   // most nodes cost 1 token; capstones cost more
          const TREE_COLOR = { DASH: '#80deea', ALLIES: '#caa6ff', BLADE: '#ffd24d' };
          function availableUpgrades() {
            return UPGRADES.filter(u => !up.owned.has(u.id) && (!u.req || up.owned.has(u.req)));
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
          function addMeter(n) { meter = Math.min(meterCap(), meter + n * up.meterMul); }
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
            ctx.fillText(banned ? '🧙 ALLIES SEALED' : ready ? '🧙 ALLY READY' : '🧙 SUMMON CHARGING', x, y - 6);
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

          /* ── sfx (no-ops when sound is off) ── */
          const sfSfx = {
            dash:  () => _chirp(880, 'sawtooth', 0.09, 0.05),
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
              ctx.beginPath(); ctx.arc(0, -22, 8, 0, Math.PI * 2); ctx.stroke();        // head (low — kneeling)
              ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(0, 2); ctx.stroke();      // short torso
              ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(-12, -22); ctx.stroke();  // arms raised, pleading
              ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(12, -22); ctx.stroke();
              ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(-10, 4); ctx.lineTo(-12, 2); ctx.stroke();  // folded knees
              ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(8, 6); ctx.lineTo(12, 2); ctx.stroke();
            } else {
              ctx.beginPath(); ctx.arc(0, -34, 8, 0, Math.PI * 2); ctx.stroke();        // head
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
            // glasses — the dev
            ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(-3, hy, 2.4, 0, Math.PI * 2); ctx.arc(3, hy, 2.4, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(-0.6, hy); ctx.lineTo(0.6, hy); ctx.stroke();
            // a tear, while he kneels
            if (kneel && !api.reduceMotion && Math.floor((frame || 0) / 18) % 3 === 0) {
              ctx.fillStyle = '#8fd8ff';
              ctx.beginPath(); ctx.arc(5, hy + 4, 1.6, 0, Math.PI * 2); ctx.fill();
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
            ctx.restore();
          }

          function drawWolf(e, col) {
            const s = Math.sin(e.phase);
            const dir = (e.mode === 'lunge' ? e.lx : (player.x - e.x)) >= 0 ? 1 : -1;
            ctx.save(); ctx.translate(e.x, e.y);
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
              if (e.mode === 'cast' && !api.reduceMotion && prog > 0.25) {
                ctx.strokeStyle = 'rgba(220,200,255,0.8)'; ctx.lineWidth = 1.2; ctx.lineCap = 'round';
                for (let a = 0; a < 3; a++) {
                  const ar = (frame * 0.5 + a * 2.1), rr = (4 + prog * 6);
                  ctx.beginPath(); ctx.moveTo(ox, oy);
                  ctx.lineTo(ox + Math.cos(ar) * rr * 1.7 + (rnd() - 0.5) * 3, oy + Math.sin(ar) * rr * 1.7 + (rnd() - 0.5) * 3);
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
              if (!api.reduceMotion) {            // small idle sparks crawling between the fingertips
                ctx.strokeStyle = 'rgba(200,175,255,0.7)'; ctx.lineWidth = 1; ctx.lineCap = 'round';
                for (const h of [h1, h2]) {
                  const a = frame * 0.4 + h.y;
                  ctx.beginPath(); ctx.moveTo(h.x, h.y);
                  ctx.lineTo(h.x + Math.cos(a) * 5 + (rnd() - 0.5) * 2, h.y + Math.sin(a) * 5 + (rnd() - 0.5) * 2);
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
              if (!api.reduceMotion && frame % 4 === 0) {
                const t = targets[Math.floor(rnd() * targets.length)];
                sparks.push({ x: t.x + (rnd() - 0.5) * 14, y: t.y + (rnd() - 0.5) * 14, t: 8, color: '#d8c4ff', txt: '✦' });
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
            const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : rnd();
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
            if (muda && !api.reduceMotion) {
              ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
              for (let i = 0; i < 3; i++) { const r = rnd() * 15; ctx.beginPath(); ctx.arc(19 + r, -31 + (rnd() * 6 - 3), 2.6, 0, Math.PI * 2); ctx.fill(); }
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
            const jt = api.reduceMotion ? 0.5 + 0.5 * Math.sin(frame * 0.4) : rnd();
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
            if (punching && !api.reduceMotion) {
              ctx.globalAlpha = 0.28 * alpha; ctx.fillStyle = lit;
              for (let i = 0; i < 3; i++) { const r = rnd() * 17; ctx.beginPath(); ctx.arc(20 + r, -31 + (rnd() * 6 - 3), 2.8, 0, Math.PI * 2); ctx.fill(); }
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
              if (!api.reduceMotion) ctx.translate((rnd() - 0.5) * cr * 3, (rnd() - 0.5) * cr * 2);
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

          function drawEnemy(e) {
            const col = enemyColor(e);
            if (e.type === 'goblin') drawGoblin(e, col);
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
              if (e.hp < 3) {
                ctx.fillStyle = '#ffd24d'; ctx.font = 'bold 11px Tahoma,Arial'; ctx.textAlign = 'center';
                ctx.fillText('♥'.repeat(e.hp), e.x, e.y - 78); ctx.textAlign = 'left';
              }
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
            ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5;
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
              ctx.fillStyle = '#f2f2f2';                                 // fist on the hilt
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
            ctx.fillStyle = '#f2f2f2';                                  // fist on the grip
            ctx.beginPath(); ctx.arc(handX, handY, 2.8, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
          }

          // draw one hero (figure + Aegis bubble + held blade). baseColor distinguishes P1
          // (white) from P2 (green). A downed hero is drawn fallen with a revive ring instead.
          function drawHero(h, baseColor) {
            if (h.down) { drawDownedHero(h); return; }
            const lean = clamp(h.vx * 0.04, -0.3, 0.3);
            const col = h.dashT > 0 ? '#80deea' : baseColor;
            stickFigure(h.x, h.y, h.phase, col, 1, 1, lean, h.dashT > 0 ? '#80deea' : 'rgba(255,255,255,0.5)');
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
            if (h.swordT > 0 || h.heldSaber) drawHeldSword(h);
          }
          // a fallen co-op hero: a prone figure with a revive ring that fills as a partner stands by
          function drawDownedHero(h) {
            stickFigure(h.x, h.y, 0, '#7a7a7a', 1, 0.7, Math.PI / 2, 'rgba(160,160,160,0.4)');
            const p = clamp(h.reviveT / REVIVE_T, 0, 1);
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

          function killEnemy(e) {
            if (e.dead) return;
            // downing the fell beast doesn't end the Witch-king — he rises and fights on foot
            if (e.type === 'witchking' && e.mounted) {
              e.mounted = false; e.hp = e.footMax; e.kr = 22; e.spd = 1.7;
              e.mode = 'walk'; e.st = 60; e.stun = 36; e.flailAng = 0;
              banner = 'the fell beast is slain!'; bannerSub = 'the Witch-king takes up his flail'; bannerT = 130;
              sfSfx.screech(); shake = 12;
              sparks.push({ x: e.x, y: e.y - 30, t: 30, color: '#b39ddb', txt: 'SCREEEE' });
              return;
            }
            // DIO doesn't simply die — a slow crumble cutscene plays out (handled in dioFinale)
            if (e.type === 'dio' && e.mode !== 'dying') { startDioFinale(e); return; }
            e.dead = true;
            kills++;
            const pts = (e.type === 'dio' ? 500 : e.type === 'sidious' ? 400 : e.type === 'vader' ? 300 : e.type === 'witchking' ? 200 : e.type === 'ogre' ? 120 : e.type === 'troll' ? 40 : e.type === 'wraith' ? 30 : e.type === 'guard' ? 25 : e.type === 'trooper' ? 20 : 15) * mult;
            score += pts;
            addMeter(7);
            sparks.push({ x: e.x, y: e.y - 26, t: 20, color: '#ffd24d', txt: '+' + pts });
            sfSfx.killE();
            if (e.type === 'witchking') {
              unlockAchievement('witch-king');
              bossActive = false; nineDone = true; corpses = [];
              const gotTok = grantLevelToken(5);   // first Witch-king kill earns an upgrade token
              banner = 'the Witch-king is no more'; bannerSub = '+1000' + (gotTok ? '  ·  token earned' : ''); bannerT = 160;
              score += 1000;
              addMeter(40);
              shake = 16;
              awaitExit = true;  // a way out opens to the east...
              openUpgradeMenu('THE WITCH-KING FALLS');  // spend banked tokens before the road east
            } else if (e.type === 'trooper') {
              swTroopersLeft--;
            } else if (e.type === 'ogre') {
              unlockAchievement('ogre-slayer');
              // the mini-boss falls hard — extra points, a meter surge, and a guaranteed powerup drop
              banner = 'the war-ogre falls!'; bannerSub = '+200'; bannerT = 130;
              score += 200; addMeter(30); shake = 14;
              powerups.push({ x: e.x, y: e.y, kind: ['freeze', 'fire', 'bolt'][Math.floor(rnd() * 3)], t: 820 });
            } else if (e.type === 'vader') {
              unlockAchievement('dark-lord');
              // the dark lord falls — but a darker master waits in the void. keep the saber.
              vaderActive = false; swState = 'vaderdown';   // stay in the void; keep the lightsaber + starfield
              arrows = []; player.choke = 0; player.stunT = 0; swFlash = 0;  // clear in-flight saber / Force effects
              banner = 'the dark lord falls'; bannerSub = '+1500'; bannerT = 170;
              score += 1500; addMeter(40); shake = 18;
              grantLevelToken(6);                 // Vader's fall earns an upgrade before the Emperor
              // a breath, an upgrade, then the Emperor reveals himself
              if (!openUpgradeMenu('DARTH VADER FALLS')) sidiousCue = 110;
            } else if (e.type === 'sidious') {
              // he does not simply fall — Darth Vader rises and bears him into the dark,
              // the Emperor's lightning storming over them both (reward deferred to the cutscene's end)
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
            if (h.shield) {
              // the Aegis takes the blow — shatters, buys a beat of safety, and shoves attackers off
              h.shield = false; h.iframe = 44;
              shake = Math.max(shake, 12); sfSfx.shieldBreak();
              sparks.push({ x: h.x, y: h.y - 32, t: 30, color: '#7fd8ff', txt: 'SHIELD BROKEN' });
              knockback(h.x, h.y, 0, 130, 16);
              return;
            }
            downHero(h);
          }
          function downHero(h) {
            if (!coop) { endRun(); return; }               // solo: a hit is simply the end
            h.down = true; h.downT = 0; h.reviveT = 0; h.vx = 0; h.vy = 0; h.dashT = 0; h.stunT = 0;
            sfSfx.die(); shake = Math.max(shake, 12);
            sparks.push({ x: h.x, y: h.y - 30, t: 34, color: '#ff5252', txt: 'DOWN!' });
            if (heroesLive().length === 0) endRun();        // both fallen — the horde wins
            else { banner = (h === player ? 'PLAYER 1 DOWN' : 'PLAYER 2 DOWN'); bannerSub = 'a partner can revive — stand close'; bannerT = 90; }
          }
          // the run is over (solo death, or both heroes down in co-op)
          function endRun() {
            alive = false;
            if (score > best) { best = score; newBest = true; localStorage.setItem('ilaird_sf_best', String(best)); }
            sfSfx.die(); shake = 14;
            lbBegin();
          }
          function reviveHero(h) {
            h.down = false; h.reviveT = 0; h.iframe = 70;   // up again, with a beat of mercy invulnerability
            h.shield = up.shield; h.vx = 0; h.vy = 0;
            sfSfx.summon();
            sparks.push({ x: h.x, y: h.y - 32, t: 34, color: P2_COL, txt: 'REVIVED!' });
            banner = (h === player ? 'PLAYER 1' : 'PLAYER 2') + ' REVIVED'; bannerSub = ''; bannerT = 70;
          }
          // legacy name kept for the Force-choke death path (a guaranteed kill of P1)
          function slayPlayer() { strike(player); }

          /* ── online leaderboard (the "hall of legends") ──
             Backed by the same hal-worker service as the LLM-HAL game (GET /scores,
             POST /score). Reads HAL_WORKER_URL — an app.js global (both are classic
             scripts in one shared scope). Degrades silently to lbState='off' (the
             original local-best death screen) whenever the worker is absent/unreachable. */
          function lbBase() {
            try { return (typeof HAL_WORKER_URL === 'string' && HAL_WORKER_URL) ? HAL_WORKER_URL : null; }
            catch (_) { return null; }
          }
          function lbBegin() {
            lbScore = score; lbWave = wave; lbRank = -1; lbName = ''; lbScores = null;
            const base = lbBase();
            if (!base || score <= 0) { lbState = 'off'; return; }
            lbState = 'loading';
            fetch(base + '/scores', { method: 'GET' })
              .then(r => r.ok ? r.json() : Promise.reject(r.status))
              .then(d => {
                if (alive) return;                       // player already restarted — ignore the stale load
                lbScores = (d && Array.isArray(d.scores)) ? d.scores.slice(0, 10) : [];
                const lowest = lbScores.length >= 10 ? lbScores[lbScores.length - 1].score : 0;
                lbState = (lbScores.length < 10 || lbScore > lowest) ? 'enter' : 'view';
              })
              .catch(() => { if (!alive) lbState = 'off'; });
          }
          function lbSubmit() {
            const base = lbBase();
            const nm = (lbName.trim() || 'AAA').slice(0, 10);
            if (!base) { lbState = 'off'; return; }
            lbState = 'submitting';
            fetch(base + '/score', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ game: 'sf', name: nm, score: lbScore, wave: lbWave }),
            })
              .then(r => r.ok ? r.json() : Promise.reject(r.status))
              .then(d => {
                if (alive) return;                       // restarted mid-submit — drop the response
                if (d && Array.isArray(d.scores)) lbScores = d.scores.slice(0, 10);
                lbRank = (d && Number.isInteger(d.rank)) ? d.rank : -1;
                lbState = 'done';
              })
              .catch(() => { if (!alive) lbState = 'view'; });   // show the board we already have
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
          function drawDeathScreen() {
            ctx.fillStyle = 'rgba(0,0,0,0.62)';
            ctx.fillRect(0, 0, GW, GH);
            ctx.textAlign = 'center';
            ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 8;

            const cx = GW / 2;
            const board = (lbState === 'view' || lbState === 'done' || lbState === 'submitting');
            const rows = lbScores || [];
            // height-aware top so a full 10-row board stays centred and on-screen
            const blockH = board ? 150 + rows.length * 20 : lbState === 'enter' ? 230 : 150;
            let y = Math.max(46, GH / 2 - blockH / 2);

            ctx.font = 'bold 36px Tahoma,Arial'; ctx.fillStyle = 'white';
            ctx.fillText('THOU ART SLAIN', cx, y); y += 32;
            ctx.font = '18px Tahoma,Arial'; ctx.fillStyle = newBest ? '#ffd24d' : 'white';
            ctx.fillText('SCORE ' + score + (newBest ? '   ★ NEW BEST ★' : '   ·   BEST ' + best), cx, y); y += 25;
            ctx.font = '14px Tahoma,Arial'; ctx.fillStyle = '#ccc';
            ctx.fillText('you survived ' + wave + (wave === 1 ? ' wave' : ' waves') +
                         '  ·  slew ' + kills + (kills === 1 ? ' foe' : ' foes'), cx, y); y += 30;

            if (lbState === 'off' || lbState === 'error') {
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
              ctx.fillText('A NEW LEGEND IS BORN', cx, y); y += 30;
              const caret = (Math.floor(deadT / 16) % 2) ? '▍' : ' ';   // deadT, not frame (frozen while dead)
              ctx.font = 'bold 24px "Courier New",monospace'; ctx.fillStyle = '#fff';
              ctx.fillText((lbName || '') + caret, cx, y); y += 26;
              ctx.font = '12px Tahoma,Arial'; ctx.fillStyle = '#8a949a';
              ctx.fillText('type your name  ·  ENTER to enshrine it', cx, y);
            } else {
              ctx.font = '15px "Courier New",monospace';
              if (rows.length === 0) {
                ctx.fillStyle = '#bbb';
                ctx.fillText('no legends yet — be the first', cx, y); y += 22;
              }
              for (let i = 0; i < rows.length; i++) {
                const e = rows[i];
                const isMe = i === lbRank;
                ctx.fillStyle = isMe ? '#ffd24d' : i < 3 ? '#e8e8e8' : '#9aa3a8';
                const rk = String(i + 1).padStart(2, ' ');
                const nm = String(e.name || 'AAA').slice(0, 10).padEnd(10, ' ');
                const sc = String(e.score).padStart(7, ' ');
                ctx.fillText((isMe ? '▸ ' : '  ') + rk + '  ' + nm + ' ' + sc + (isMe ? ' ◂' : '  '), cx, y);
                y += 20;
              }
              y += 8;
              ctx.font = '13px Tahoma,Arial'; ctx.fillStyle = '#ccc';
              ctx.fillText(lbState === 'submitting' ? 'recording your legend…' : 'press R to rise again', cx, y);
            }
            ctx.shadowBlur = 0; ctx.textAlign = 'left';
          }

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
            const r = rnd();
            if (wave >= 4 && r < 0.15) return 'troll';
            if (wave >= 3 && r < 0.35) return 'archer';
            if (wave >= 2 && r < 0.6) return 'wolf';
            return 'goblin';
          }

          function makeEnemy(type, x, y) {
            const e = { type, x, y, vx: 0, vy: 0, phase: rnd() * Math.PI * 2,
                        grz: 0, stun: 0 };
            if (type === 'goblin') { e.spd = Math.min(2.6, 1.35 + wave * 0.15); e.kr = 14; }
            if (type === 'wolf')   { e.spd = 1.15; e.kr = 13; e.mode = 'stalk'; e.st = 70; }
            if (type === 'archer') { e.spd = 1.5; e.kr = 12; e.mode = 'approach'; e.st = 40; }
            if (type === 'troll')  { e.spd = Math.min(1.5, 0.8 + wave * 0.06); e.kr = 26; e.hp = 3; }
            if (type === 'ogre') {
              // a horde mini-boss: lumbers, telegraphs, then bull-rushes straight across the field
              e.spd = 1.25; e.kr = 30; e.hp = 8; e.maxhp = 8; e.mode = 'stalk'; e.st = 80; e.lx = 0; e.ly = 0;
            }
            if (type === 'wraith') {
              e.spd = 2.6; e.kr = 14; e.hp = 2; e.mode = 'circle';
              // keep the bearing it spawned at so the ring forms without crossing paths
              e.slot = Math.atan2(y - player.y, x - player.x) - frame * 0.004;
              e.ring = Math.hypot(x - player.x, y - player.y) || 300;
            }
            if (type === 'witchking') {
              // rises mounted on a fell beast; a few hits down the beast, then he fights on foot
              e.spd = 2.88; e.kr = 24; e.hp = 4; e.mountMax = 4; e.footMax = 6;
              e.mounted = true; e.mode = 'hover'; e.st = 80; e.flailAng = 0;
            }
            if (type === 'trooper') {
              // marches into formation, then fires; harmless to touch — only the blasters kill
              e.kr = 0; e.hp = 1; e.mode = 'march'; e.fireT = 0;
            }
            if (type === 'vader') {
              // a proper duel: advances, telegraphs, melee slashes AND Force powers; escalates at half health
              e.spd = 1.5; e.kr = 20; e.hp = 10; e.maxhp = 10;
              e.mode = 'advance'; e.st = 50; e.slashAng = 0;
              e.phase2 = false; e.power = null; e.combo = false; e.disarmed = false;
              e.intro = 50;   // a brief menacing entrance: holds position, harmless to touch — no instant spawn-kill
            }
            if (type === 'sidious') {
              // Clone Wars Sidious: fast & acrobatic, twin red sabers, a spin attack and Force lightning;
              // at half HP he stows the sabers and turns to pure lightning (e.phase2)
              e.spd = 2.7; e.kr = 17; e.hp = 14; e.maxhp = 14;
              e.mode = 'enter'; e.st = 60; e.spinAng = 0; e.lit = 0; e.hop = 0;
              e.phase2 = false; e.castKind = 'bolt';
            }
            if (type === 'guard') {
              // Royal Guard: red robe + force pike. stalks, telegraphs, lunges. contact-lethal.
              e.spd = 1.55; e.kr = 14; e.hp = 2; e.mode = 'idle'; e.st = 50; e.pike = 0;
            }
            if (type === 'dio') {
              // DIO + The World: trolls you with stopped time, then knives / MUDA rushes / the road roller
              e.spd = 1.95; e.kr = 17; e.hp = 16; e.maxhp = 16;   // a deliberate saunter — readable, not frantic
              e.mode = 'troll'; e.tstep = 0; e.tt = 0; e.st = 0; e.stand = 0; e.cape = 0; e.rollerDone = false;
            }
            if (type === 'ian') {
              // the creator: unarmed, harmless, never attacks — the fight is a choice, not a duel
              e.kr = 0; e.hp = 99; e.mode = 'idle'; e.phase = 0; e.crumble = 0; e.fade = 1;
            }
            return e;
          }

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
            if (e.phase2 && r < 0.30)                startCast(e, 'choke');  // Force choke reaches across the room
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
          // shove the player away from Vader and lock their footing briefly so the push carries
          function forcePush(e, mag) {
            const ddx = player.x - e.x, ddy = player.y - e.y, dd = Math.hypot(ddx, ddy) || 1;
            player.vx = ddx / dd * 15 * mag; player.vy = ddy / dd * 15 * mag;
            player.stunT = Math.round(14 * mag); player.choke = 0;
            swFlash = Math.max(swFlash, 14);
            sfSfx.thud();
            sparks.push({ x: player.x, y: player.y - 24, t: 16, color: '#9ec8ff', txt: 'FORCE PUSH' });
          }
          // hurl the lightsaber: a spinning blade that crosses the room then homes back to Vader (boomerang)
          function vaderThrow(e) {
            const ang = Math.atan2(player.y - (e.y - 22), player.x - e.x), sp = 6.4;
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
          // a leap target that circles the player — keeps him orbiting, not blinking to random corners
          function sidiousFlank(e) {
            const cur = Math.atan2(e.y - player.y, e.x - player.x);
            const ang = cur + (rnd() < 0.5 ? 1 : -1) * (0.7 + rnd() * 0.6);
            const rad = 155 + rnd() * 55;
            return { x: clamp(player.x + Math.cos(ang) * rad, 30, GW - 30),
                     y: clamp(player.y + Math.sin(ang) * rad, 48, GH - 22) };
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
            grantLevelToken(7);
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
            const px = player.x, py = player.y;   // knives ring the frozen hero, with spread so there are gaps to weave
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
            roadRoller = { zoneX: clamp(player.x, 40, GW - 40), zoneY: clamp(player.y, 60, GH - 16), x: clamp(player.x, 40, GW - 40), y: -80, phase: 'hover', t: 0, toy: false };
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
              if (!api.reduceMotion && f.t % 2 === 0 && e) {
                sparks.push({ x: e.x + (rnd() - 0.5) * 26, y: e.y - 6 - (e.crumble || 0) * 42 + (rnd() - 0.5) * 10, t: 22 + rnd() * 24, color: rnd() < 0.5 ? '#d8c9a4' : '#caa6ff', txt: '·' });
              }
              if (f.t >= 132) { finishDioFinale(); return; }
            }
            if (!api.reduceMotion && f.t % 8 === 0) shake = Math.max(shake, 4);
          }
          function finishDioFinale() {
            unlockAchievement('world-stopper');
            const e = enemies.find(en => en.type === 'dio'); if (e) e.dead = true;
            dioFinale = null; jojoActive = false; dioStopT = 0; dioStopFx = 0; roadRoller = null;
            arrows = []; dlg = []; dlgT = 0; player.stunT = 0;
            clearBlades();                        // the lightsaber stays behind, back to the horde
            banner = 'DIO is no more'; bannerSub = '+3000  ·  the bizarre night ends'; bannerT = 190;
            score += 3000; addMeter(50); shake = 14;
            grantLevelToken(8);
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
              try { localStorage.setItem('ilaird_sf_ending', 'kill'); } catch (_) {}
              ianFinale = { outcome: 'kill', phase: 'strike', t: 0 };
              if (e) e.mode = 'dying';
              banner = ''; bannerT = 0;
              swFlash = Math.max(swFlash, 14); shake = 18; sfSfx.saberHit();
            } else {                                         // SPARE — endless mode, as a gift
              try { localStorage.setItem('ilaird_sf_ending', 'spare'); } catch (_) {}
              ianFinale = { outcome: 'spare', phase: 'thanks', t: 0 };
              if (e) e.mode = 'rise';
              ianSay('...thank you. truly.', 150, 55);
              ianSay('then let it never end. fight on — as long as you like.', 175, 0);
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
                if (!api.reduceMotion && f.t % 3 === 0 && e) sparks.push({ x: e.x + (rnd() - 0.5) * 22, y: e.y - 18 - (e.crumble || 0) * 28, t: 26, color: '#9e9e9e', txt: '·' });
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
            endless = true; mournful = false;
            try { localStorage.setItem('ilaird_sf_endless', '1'); } catch (_) {}
            arrows = []; warns = []; dlg = []; dlgT = 0;
            banner = 'ENDLESS MODE'; bannerSub = 'the horde never ends — survive as long as you can'; bannerT = 230;
            breatherT = BREATHER;
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

          /* ── enemy AI ── */
          function updateEnemy(e) {
            if (e.grz > 0) e.grz--;
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
              if (!api.reduceMotion && rnd() < 0.005) sparks.push({ x: e.x - 4 + rnd() * 8, y: e.y - 28, t: 32, color: '#8fd8ff', txt: '·' });
              return;
            }
            const tgt = hordeTarget(e);   // P1 for bosses/set-pieces; nearest standing hero for the open-field horde
            const dx = tgt.x - e.x, dy = tgt.y - e.y, d = Math.hypot(dx, dy) || 1;

            if (e.type === 'goblin') {
              // steering with momentum so they swing wide on sharp turns
              e.vx += dx / d * 0.085; e.vy += dy / d * 0.085;
              const sp = Math.hypot(e.vx, e.vy);
              if (sp > e.spd) { e.vx = e.vx / sp * e.spd; e.vy = e.vy / sp * e.spd; }
              e.x += e.vx; e.y += e.vy; e.phase += 0.22;
            } else if (e.type === 'troll') {
              e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.1;
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
                const tx = clamp(player.x + Math.cos(a) * e.ring, 10, GW - 10);
                const ty = clamp(player.y + Math.sin(a) * e.ring, 36, GH - 6);
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
                  const ang = Math.atan2(e.y - player.y, e.x - player.x) + 0.013;
                  const tx = clamp(player.x + Math.cos(ang) * 210, 40, GW - 40);
                  const ty = clamp(player.y + Math.sin(ang) * 175, 50, GH - 40);
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
                if (d > 270) { e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.16; }
                else if (d < 180) { e.x -= dx / d * e.spd * 0.8; e.y -= dy / d * e.spd * 0.8; e.phase += 0.14; }
                if (e.st <= 0 && d < 320) { e.mode = 'aim'; e.st = 26; }
                else if (e.st <= 0) e.st = 20;
              } else if (e.mode === 'aim') {
                if (e.st <= 0) {
                  arrows.push({ x: e.x, y: e.y - 18, vx: dx / d * 4.6, vy: dy / d * 4.6, t: 240 });
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
                e.x += dx / d * e.spd; e.y += dy / d * e.spd; e.phase += 0.15;
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

          /* ── main loop ── */
          // rAF driver: advance the simulation SF_SPEED steps per frame (renders the last one)
          function frameStep() {
            rafId = requestAnimationFrame(frameStep);
            simAcc += SF_SPEED;
            const steps = Math.floor(simAcc);
            simAcc -= steps;
            for (let i = 0; i < steps; i++) loop();
          }

          function loop() {
            tick++;                          // the deterministic sim clock — advances once per logical tick

            /* intro screen — also the 1P / 2P chooser (see the onKey intro handler) */
            if (!started) {
              ctx.clearRect(0, 0, GW, GH);
              stickFigure(player.x, player.y, frame * 0.06, 'white');
              if (coopSel === 1) stickFigure(player.x + 46, player.y, frame * 0.06, P2_COL);   // a green partner joins the preview
              const modeRow = coopSel === 0
                ? ['▶ 1 PLAYER ◀      2 player', 'bold 18px Tahoma,Arial', '#ffd24d']
                : ['1 player      ▶ 2 PLAYER ◀', 'bold 18px Tahoma,Arial', P2_COL];
              const controlRows = coopSel === 0
                ? [['move: WASD / arrows   ·   dash: Space / Shift   ·   swing: X / F', '13px Tahoma,Arial', '#ccc']]
                : [['Player 1 (white):  arrows move  ·  Right-Shift dash  ·  /  swing', '13px Tahoma,Arial', '#fff'],
                   ['Player 2 (green):  WASD move  ·  Left-Shift dash  ·  F  swing', '13px Tahoma,Arial', P2_COL],
                   ['allies & upgrades are shared — revive a downed partner by standing close', '12px Tahoma,Arial', '#9fb0c0']];
              panel([
                ['STICK FIGHTER 2000', 'bold 36px Tahoma,Arial', 'white'],
                ['⚔  the horde approaches.  RUN.  (and fight)  ⚔', '15px Tahoma,Arial', '#ffd24d'],
                modeRow,
                ['◀ ▶ choose  (or 1 / 2)', '12px Tahoma,Arial', '#9fb0c0'],
                ...controlRows,
                ['run over the stone to seize the sword  ·  clear waves to earn upgrade tokens', '12px Tahoma,Arial', '#ccc'],
                ['coins raise your multiplier  ·  graze foes for bonus', '12px Tahoma,Arial', '#ccc'],
                ['▶  Z / Enter to begin  ◀', '14px Tahoma,Arial', 'white'],
              ]);
              hud.innerHTML = 'BEST: ' + best + ' · ' + (coopSel === 1 ? '2-PLAYER' : '1-PLAYER') + '<br>double-click icon to quit';
              frame++;
              return;
            }

            /* death animation + game-over screen */
            if (!alive) {
              deadT++;
              ctx.clearRect(0, 0, GW, GH);
              if (stone) drawStone();
              for (const e of enemies) drawEnemy(e);
              const fall = Math.min(1, deadT / 28);
              stickFigure(player.x, player.y, 0, 'white', 1, 1 - fall * 0.4, fall * Math.PI / 2);
              if (coop && p2) stickFigure(p2.x, p2.y, 0, P2_COL, 1, 1 - fall * 0.4, fall * Math.PI / 2);
              if (deadT > 34) {
                drawDeathScreen();
                hud.innerHTML = lbState === 'enter'      ? 'type your name · ENTER to submit'
                              : lbState === 'loading'    ? 'reaching the hall of legends…'
                              : lbState === 'submitting' ? 'recording your legend…'
                              : 'press R to play again';
              }
              return;
            }

            /* upgrade screen between waves — freeze the field, overlay the menu */
            if (paused) {
              drawUpgradePanel();
              hud.innerHTML = ((upMenu && upMenu.title) || ('WAVE ' + wave + ' CLEARED')) + '<br>spend tokens · ' + tokens + ' left';
              return;
            }

            /* boss intro card / codec entrance — freeze the field, overlay the cutscene */
            if (bossIntro) { drawBossIntro(); return; }

            frame++;

            /* input → acceleration + friction (P1) */
            let ix = 0, iy = 0;
            // P1 always reads the arrow keys; in single-player WASD also drives P1 (the classic
            // dual binding), but in co-op WASD is P2's, so it's excluded from P1 here.
            if (keys['ArrowLeft']  || (!coop && (keys['a'] || keys['A']))) ix = -1;
            if (keys['ArrowRight'] || (!coop && (keys['d'] || keys['D']))) ix =  1;
            if (keys['ArrowUp']    || (!coop && (keys['w'] || keys['W']))) iy = -1;
            if (keys['ArrowDown']  || (!coop && (keys['s'] || keys['S']))) iy =  1;
            if (ix && iy) { ix *= 0.707; iy *= 0.707; }
            if (ix || iy) { player.fx = ix; player.fy = iy; }
            if (sidFinale || dioFinale || ianActive) { ix = 0; iy = 0; } // input locked — watch the cutscene
            if (dioStopT > 0) { ix = 0; iy = 0; }           // time stopped — you cannot move
            if (player.down) { ix = 0; iy = 0; }            // a fallen hero lies still until revived
            // Force choke: held aloft, input locked — break free by struggling (handled in onKey)
            if (player.choke > 0) {
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

            /* P2 (co-op only): WASD move, sharing the same physics. P2 has no boss-only states
               (choke/stun), but the cutscene/time-stop locks freeze them too. */
            if (coop && p2 && !p2.down) {
              let jx = 0, jy = 0;
              if (keys['a'] || keys['A']) jx = -1;
              if (keys['d'] || keys['D']) jx =  1;
              if (keys['w'] || keys['W']) jy = -1;
              if (keys['s'] || keys['S']) jy =  1;
              if (jx && jy) { jx *= 0.707; jy *= 0.707; }
              if (jx || jy) { p2.fx = jx; p2.fy = jy; }
              if (sidFinale || dioFinale || ianActive || dioStopT > 0) { jx = 0; jy = 0; }
              moveHero(p2, jx, jy);
            }

            /* reviving a downed partner: stand close to one and a ring fills; let go and it drains */
            if (coop && p2) {
              for (const h of heroesAll()) {
                if (!h.down) continue;
                const helper = heroesLive().find(o => Math.hypot(o.x - h.x, o.y - h.y) < 34);
                if (helper) { if (++h.reviveT >= REVIVE_T) reviveHero(h); }
                else h.reviveT = Math.max(0, h.reviveT - 1);
              }
            }

            /* waves: the next one only begins once the field is cleared */
            if (breatherT > 0) {
              if (--breatherT === 0) {
                wave++;
                waveQuota = Math.min(30, 8 + wave * 3);
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
            const spawnEvery = Math.max(24, 92 - wave * 8);
            const maxFoes = Math.min(26, 7 + wave * 3);
            if (!nineActive && !awaitExit && !swActive && swFadeT <= 0 && breatherT <= 0 && !ianActive && ianCue <= 0 && waveQuota > 0 && frame > 50 && frame % spawnEvery === 0 && enemies.length + warns.length < maxFoes) {
              const p = edgePoint();
              warns.push({ x: p.x, y: p.y, type: rollType(), t: 45 });
              waveQuota--;
            }
            for (let i = warns.length - 1; i >= 0; i--) {
              const w = warns[i];
              if (--w.t <= 0) { enemies.push(makeEnemy(w.type, w.x, w.y)); warns.splice(i, 1); }
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
                score += 40;
                addMeter(5);
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
                const grow = b.kind === 'fire' ? FIRE_R : FROST_R;
                b.r = grow * Math.min(1, b.t / (b.kind === 'fire' ? 12 : 9));
                if (!api.reduceMotion && b.t % 2 === 0) {
                  const ang = rnd() * Math.PI * 2, rr = b.r * (0.7 + rnd() * 0.35);
                  if (b.kind === 'fire')
                    sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 16, color: rnd() < 0.5 ? '#ffb74d' : '#ff7043', txt: '✦' });
                  else
                    sparks.push({ x: b.x + Math.cos(ang) * rr, y: b.y + Math.sin(ang) * rr, t: 18, color: '#b3e5fc', txt: '❄' });
                }
              } else if (b.kind === 'chain' && !api.reduceMotion && b.t % 2 === 0 && b.pts.length > 1) {
                const seg = b.pts[Math.floor(rnd() * (b.pts.length - 1)) + 1];
                sparks.push({ x: seg.x + (rnd() * 16 - 8), y: seg.y + (rnd() * 16 - 8), t: 12, color: '#cff3ff', txt: '·' });
              }
              if (b.t >= b.life) blasts.splice(i, 1);
            }
            if (freezeT > 0) freezeT--;

            /* the sword in the stone (never during the Star Wars / JoJo interludes) */
            if (!swActive && !jojoActive && jojoCue <= 0 && !awaitExit && swFadeT <= 0 && !ianActive && ianCue <= 0 && !stone && heroesLive().some(h => h.swordT <= 0 && !h.heldSaber) && --stoneCd <= 0) {
              const p = farPoint(80);
              stone = { x: p.x, y: p.y };
              if (!stoneSeen) {
                stoneSeen = true;
                banner = 'a sword in a stone...'; bannerSub = 'run to it and claim your destiny'; bannerT = 110;
              } else {
                sparks.push({ x: p.x, y: p.y - 40, t: 30, color: '#eceff1', txt: 'the sword returns' });
              }
            }
            // only a hero who isn't already holding a blade can pull the sword (it's theirs alone)
            const stoneGrabber = stone ? heroesLive().find(h => !h.heldSaber && h.swordT <= 0 && Math.hypot(h.x - stone.x, h.y - stone.y) < PULL_R) : null;
            if (stoneGrabber) {
              stone = null; stoneCd = 150;   // a beat before the next stone (lets a co-op partner arm too, but not instantly)
              unlockAchievement('excalibur');
              stoneGrabber.swordT = SWORD_T;
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
            /* the blue lightsaber on the corridor deck — claimed by whichever hero reaches it */
            const saberGrabber = saberPickup ? heroesLive().find(h => !h.heldSaber && Math.hypot(h.x - saberPickup.x, h.y - saberPickup.y) < PULL_R) : null;
            if (saberGrabber) {
              saberPickup = null; saberGrabber.heldSaber = true;
              banner = 'A LIGHTSABER'; bannerSub = 'X — strike them down'; bannerT = 110;
              sfSfx.saber(); shake = 6;
            }
            for (const h of heroesAll()) if (h.swingT > 0) h.swingT--;

            /* the champion */
            if (frame % 90 === 0) addMeter(1);
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
                const bye = { gandalf: '"I must away."', luke: '"may the Force be with you."', jotaro: '"yare yare daze."' }[g.kind];
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
                  if (e.hp && (e.hp -= 2) > 0) { e.stun = 14; sfSfx.thud(); }
                  else killEnemy(e);
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
              // shared "this foe is harmless right now" gates (independent of which hero)
              if ((e.type === 'sidious' || e.type === 'guard') && sidiousIntroT > 0) continue;  // harmless during the reveal
              if (e.type === 'vader' && e.intro > 0) continue;   // harmless as he steps from the shadows
              if (e.type === 'dio' && (e.mode === 'troll' || e.mode === 'dying')) continue;   // intro & death are harmless
              if (dioStopT > 0) continue;                // time is stopped — you cannot be touched (nor can you act)
              if (e.frozen > 0) continue;                // an iced foe is harmless — wail on it freely
              // every standing hero is tested against this foe (in co-op the boss arcs can fell either)
              for (const h of heroesLive()) {
                if (h.dashT > 0) continue;               // i-frames: untouchable mid-dash
                const d = Math.hypot(h.x - e.x, h.y - e.y);
                if (d < e.kr + PLAYER_R) { strike(h); if (!alive) return; continue; }   // bodies overlap → struck
                if (d < e.kr + PLAYER_R + 17 && e.grz <= 0) {        // a near miss just past the body
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

            /* arrows */
            for (let i = arrows.length - 1; i >= 0; i--) {
              const a = arrows[i];
              if (dioStopT > 0) continue;                // knives hang in stopped time
              a.x += a.vx; a.y += a.vy;
              if (--a.t <= 0 || a.x < -20 || a.x > GW + 20 || a.y < -20 || a.y > GH + 20) { arrows.splice(i, 1); continue; }
              if (a.reflected) {
                // a bolt you deflected — harmless to you, kills any trooper it strikes
                let struck = false;
                for (const e of enemies) {
                  if (e.dead) continue;
                  if (Math.hypot(a.x - e.x, a.y - (e.y - 14)) < 15) {
                    if (!e.hp || --e.hp <= 0) killEnemy(e); else e.stun = 10;
                    struck = true; break;
                  }
                }
                if (struck) arrows.splice(i, 1);
                continue;  // never harms the player
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

            /* ── render ── */
            ctx.clearRect(0, 0, GW, GH);
            ctx.save();
            if (shake > 0) { shake--; if (!api.reduceMotion) ctx.translate((rnd() - 0.5) * shake, (rnd() - 0.5) * shake); }

            if (swActive) {
              // the corridor: black void + a fixed starfield
              ctx.fillStyle = '#04060a'; ctx.fillRect(0, 0, GW, GH);
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
                if (m.y < -34) { m.y = GH + 24; m.x = rnd() * GW; }
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
                  if (m.y < -20) { m.y = GH + 16; m.x = rnd() * GW; }
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
              stickFigure(g.x, g.y, g.phase, '#80deea', 1, g.t / 32);
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
                ctx.strokeStyle = '#f5f5dc'; ctx.lineWidth = 2; ctx.lineCap = 'round';
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
            for (const g of allies) drawChamp(g);
            if (jojoActive && playerStand > 0.05) {   // Star Platinum rises above and behind the hero's shoulder
              const dio = enemies.find(en => en.type === 'dio');
              const sdir = dio && dio.x < player.x ? -1 : 1;
              ctx.save();
              ctx.translate(player.x - sdir * 12, player.y - 24); ctx.scale(1.4, 1.4);
              drawStarPlatinum(sdir, playerStand, player.swingT > 0);
              ctx.restore();
            }
            if (coop && p2) drawHero(p2, P2_COL);   // P2 first so P1 reads on top when they overlap
            drawHero(player, 'white');
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
            drawSummonMeter();   // the ally charge gauge sits in the UI layer, unaffected by screen shake

            if (swFadeT > 0) {
              // cross-fade through black hides the cut to the corridor
              const half = FADE_LEN / 2;
              ctx.globalAlpha = 1 - Math.abs(swFadeT - half) / half;
              ctx.fillStyle = '#000'; ctx.fillRect(0, 0, GW, GH);
              ctx.globalAlpha = 1;
            }

            const foesLeft = enemies.length + warns.length + waveQuota;
            hud.innerHTML =
              'SCORE ' + score + ' · BEST ' + best + '<br>' +
              (mournful
                ? '<span style="color:#8fd8ff">the world mourns · they will not fight</span> · KILLS ' + kills
                : 'WAVE ' + wave + (endless ? ' · <span style="color:#ffd24d">∞ ENDLESS</span>' : '') + ' · FOES ' + foesLeft + ' · KILLS ' + kills + ' · x' + mult) + '<br>' +
              (up.dashMax === 0
                ? '<span style="color:#666">DASH 🔒 locked</span>'
                : '<span style="color:#80deea">DASH ' + '◆'.repeat(player.dashCharges) +
                  '<span style="color:#3a4a55">' + '◇'.repeat(up.dashMax - player.dashCharges) + '</span></span>') +
              (up.shield ? (player.shield
                ? '  ·  <span style="color:#7fd8ff">🛡️ AEGIS</span>'
                : '  ·  <span style="color:#5a6168">🛡️ broken · refreshes next wave</span>') : '') + '<br>' +
              (player.heldSaber
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
                  const pct = Math.round(clamp(h.reviveT / REVIVE_T, 0, 1) * 100);
                  return '<span style="color:#ff5252">' + label + ' DOWN' + (pct ? ' · reviving ' + pct + '%' : ' · stand close to revive') + '</span>';
                }
                const dash = up.dashMax === 0 ? '' : ' ◆' + h.dashCharges;
                const aeg = up.shield ? (h.shield ? ' 🛡️' : ' 🛡️✕') : '';
                const blade = h.heldSaber ? ' ⚔' : h.swordT > 0 ? ' ⚔' + Math.ceil(h.swordT / 60) + 's' : '';
                return '<span style="color:' + col + '">' + label + dash + aeg + blade + '</span>';
              };
              hud.innerHTML += '<br>' + hero(player, 'P1', '#fff') + '   ' + hero(p2, 'P2', P2_COL);
            }
            if (player.choke > 0) hud.innerHTML = '<span style="color:#ff5252;font-weight:bold">✊ FORCE CHOKE — mash X / SPACE to break free!</span><br>' + hud.innerHTML;
            if (ianActive) hud.innerHTML = ianFinale
              ? 'the creator\'s fate is sealed...'
              : ianChoice ? '<span style="color:#fff">SPARE or KILL — ← → · Z to choose</span>' : 'the creator kneels, unarmed, before you';
          }

          function enemyColor(e) {
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
            if (e.type === 'ogre')
              return e.mode === 'wind' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#a1452f' : '#6d4c41';
            if (e.type === 'troll') return '#5d4037';
            if (e.type === 'archer')
              return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : '#cfc8a0';
            if (e.type === 'wolf')
              return e.mode === 'aim' && (api.reduceMotion || Math.floor(frame / 4) % 2 === 0) ? '#fff' : '#546e7a';
            return '#1b5e20';
          }

          // shared per-hero movement physics (friction, speed cap, dash trail, charge recharge).
          // Called once per hero per tick; in single-player it's only ever player, so behaviour
          // (and RNG consumption — there is none here) is identical to the old inline block.
          function moveHero(h, ix, iy) {
            h.vx = h.vx * 0.86 + ix * 0.62;
            h.vy = h.vy * 0.86 + iy * 0.62;
            const pv = Math.hypot(h.vx, h.vy);
            // the speed cap lifts during a dash and while reeling from a Force push, so the shove carries
            if (h.dashT <= 0 && h.stunT <= 0 && (h.choke || 0) <= 0 && pv > 4.3) { h.vx *= 4.3 / pv; h.vy *= 4.3 / pv; }
            h.x = clamp(h.x + h.vx, 14, GW - 14);
            h.y = clamp(h.y + h.vy, 40, GH - 10);
            if (pv > 0.4) h.phase += 0.06 + pv * 0.045;
            if (h.dashT > 0) {
              h.dashT--;
              ghosts.push({ x: h.x, y: h.y, phase: h.phase, t: 16 });
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
              const dx = a.x - h.x, dy = a.y - h.y, d = Math.hypot(dx, dy) || 1;
              if (d < up.swingR + 20 && (dx / d) * fx + (dy / d) * fy > -0.2) {
                sparks.push({ x: a.x, y: a.y, t: 12, color: '#fff', txt: '✦' });
                if (a.kind === 'laser') {
                  // deflect the blaster bolt off in a random direction — now yours, lethal to troopers
                  const ang = rnd() * Math.PI * 2;
                  const spd = Math.hypot(a.vx, a.vy) || 5.2;
                  a.vx = Math.cos(ang) * spd; a.vy = Math.sin(ang) * spd;
                  a.reflected = true; a.t = 240;
                } else {
                  arrows.splice(i, 1);  // ordinary arrows are just batted out of the air
                }
              }
            }
          }

          function trySummon(kind) {
            if (!started || !alive || paused || champsBanned()) return;
            if (meter < up.summonCost || !up.champs[kind]) return;  // need a banked charge, and the ally unlocked
            if (allies.some(g => g.kind === kind)) return;          // one of each kind at a time
            meter -= up.summonCost; meterPrompted = false;          // spend one charge (keep the rest)
            const fromLeft = player.x > GW / 2;
            const g = { kind, t: Math.round(CHAMP_T * up.champMul), x: fromLeft ? -30 : GW + 30, y: clamp(player.y, 60, GH - 30),
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

          // the Star Wars interlude: a corridor where a squad of stormtroopers forms up, then opens fire
          function startStarWars() {
            swActive = true; swState = 'march'; swReadyT = 0; vaderActive = false;
            enemies = []; warns = []; arrows = []; bolts = []; coins = []; powerups = []; blasts = []; corpses = [];
            // no medieval steel beyond the door — Excalibur stays behind
            stone = null; clearBlades();
            saberPickup = { x: GW * 0.30, y: GH / 2 };  // a lightsaber waits on the deck
            // player has just charged through the doorway — slam them against the west wall
            player.x = 34; player.y = GH / 2; player.vx = 0; player.vy = 0;
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
            alive = false;
            stopSfMusic();
            wraithSfx.pause();
            if (rafId) cancelAnimationFrame(rafId);
            document.removeEventListener('keydown', onKey);
            document.removeEventListener('keyup',   offKey);
            canvas.remove(); hud.remove(); xp._sfCleanup = null;
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
          function onKey(e) {
            keys[e.key] = true;
            // entering a name for the leaderboard after death — capture typing, swallow
            // everything else (so letters/digits go into the name, not cheats or the R-restart)
            if (!alive && lbState === 'enter') {
              if (e.key === 'Enter') lbSubmit();
              else if (e.key === 'Backspace') lbName = lbName.slice(0, -1);
              else if (e.key.length === 1 && lbName.length < 10 && /[A-Za-z0-9._-]/.test(e.key)) lbName += e.key;
              e.preventDefault();
              return;
            }
            // ── intro screen: pick 1-PLAYER / 2-PLAYER, then begin ──
            // ←/→ (or 1/2, or ↑/↓ to flip) move the highlight; the controls for the choice are shown
            // on the panel; Z / Enter / Space begins the run in the chosen mode. (The headless
            // determinism test starts by dispatching Enter, then holds ArrowRight to move.)
            if (!started) {
              if (e.key === 'ArrowLeft' || e.key === '1') { coopSel = 0; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
              if (e.key === 'ArrowRight' || e.key === '2') { coopSel = 1; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { coopSel = coopSel ? 0 : 1; if (sfSfx.killE) sfSfx.killE(); e.preventDefault(); return; }
              if (['z', 'Z', 'Enter', ' '].includes(e.key)) {
                coop = coopSel === 1;
                if (coop) setupCoop();
                started = true; frame = 0;
                banner = coop ? 'CO-OP · WAVE 1' : 'WAVE 1'; bannerT = 90;
                startSfMusic();
              }
              e.preventDefault();
              return;
            }
            // upgrade menu between waves — input only navigates the shop while paused
            if (paused && upMenu) {
              const rows = availableUpgrades();
              const n = rows.length + 1;                       // +1 = the Continue row
              if (['ArrowUp', 'ArrowLeft', 'w', 'W'].includes(e.key))        { upMenu.sel = (upMenu.sel - 1 + n) % n; sfSfx.killE(); }
              else if (['ArrowDown', 'ArrowRight', 's', 'S'].includes(e.key)) { upMenu.sel = (upMenu.sel + 1) % n; sfSfx.killE(); }
              else if (['z', 'Z', ' ', 'Enter'].includes(e.key)) {           // select the highlighted row
                if (upMenu.sel >= rows.length) finishUpgrades();             // on Continue → leave
                else buyUpgrade(rows[upMenu.sel]);                           // on a node → unlock it
              }
              e.preventDefault();
              return;
            }
            // the final confrontation with the creator — all play is locked; only the choice responds
            if (ianActive) {
              if (ianChoice) {
                if (['ArrowLeft', 'a', 'A'].includes(e.key)) { ianChoice.sel = 0; sfSfx.killE(); }
                else if (['ArrowRight', 'd', 'D'].includes(e.key)) { ianChoice.sel = 1; sfSfx.killE(); }
                else if (!e.repeat && ['z', 'Z', ' ', 'Enter'].includes(e.key)) chooseIan(ianChoice.sel);
              }
              e.preventDefault();
              return;
            }
            // cheat: type "nine" to skip straight to the Nazgûl set piece
            if (/^[a-z]$/i.test(e.key)) {
              cheatBuf = (cheatBuf + e.key.toLowerCase()).slice(-8);
              if (cheatBuf.endsWith('nine')) { cheatBuf = ''; skipToTheNine(); }
            }
            // cheat: spam 9 — 3×=ringwraiths, 4×=Witch-king, 5×=east door, 6×=Vader, 7×=Sidious, 8×=DIO
            if (e.key === '9' && !e.repeat) {
              const now = performance.now();
              nineKeyCount = now - last9 > 1500 ? 1 : nineKeyCount + 1;
              last9 = now;
              if (nineKeyCount === 3) skipToTheNine();
              else if (nineKeyCount === 4) skipToWitchKing();
              else if (nineKeyCount === 5) skipToPreStarWars();
              else if (nineKeyCount === 6) skipToVader();
              else if (nineKeyCount === 7) skipToSidious();
              else if (nineKeyCount === 8) skipToJojo();
              else if (nineKeyCount >= 9) { nineKeyCount = 0; skipToIan(); }
            }
            // cheat: spam 8 three times to unlock the entire upgrade tree
            if (e.key === '8' && !e.repeat) {
              const now = performance.now();
              eightKeyCount = now - last8 > 1500 ? 1 : eightKeyCount + 1;
              last8 = now;
              if (eightKeyCount >= 3) { eightKeyCount = 0; grantAllUpgrades(); }
            }
            // boss intro cutscene — confirm advances the card / dialogue; the 8/9 cheats above
            // still warp through, but nothing else responds while the card is up
            if (bossIntro) {
              if (!e.repeat && ['z', 'Z', 'x', 'X', 'f', 'F', ' ', 'Enter'].includes(e.key)) advanceBossIntro();
              e.preventDefault();
              return;
            }
            // Force choke: the only escape is to struggle — mash attack/dash; nothing else responds
            if (player.choke > 0) {
              if (!e.repeat && ['x', 'X', 'f', 'F', ' ', 'Shift'].includes(e.key)) {
                player.chokeBreak++; player.swingT = 6; sfSfx.saberHit();
              }
              if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
              return;
            }
            // combat keys. Solo: Space/Shift dash, X/F swing (unchanged). Co-op splits them by
            // hand — P1 = Right-Shift dash + '/' swing, P2 = Left-Shift dash + F swing (the two
            // Shifts are told apart by e.code). Summons/champion-prompt are shared either way.
            if (!coop) {
              if (e.key === ' ' || e.key === 'Shift') tryDash(player);
              if (e.key === 'x' || e.key === 'X' || e.key === 'f' || e.key === 'F') trySwing(player);
            } else {
              if (e.code === 'ShiftRight') tryDash(player);
              if (e.code === 'Slash') trySwing(player);
              if (e.code === 'ShiftLeft') tryDash(p2);
              if (e.key === 'f' || e.key === 'F') trySwing(p2);
            }
            if (e.key === 'g' || e.key === 'G') championPrompt();
            if (e.key === '1') trySummon('gandalf');
            if (e.key === '2') trySummon('luke');
            if (e.key === '3') trySummon('jotaro');
            if ((e.key === 'r' || e.key === 'R') && !alive) {
              init();
              started = true; banner = coop ? 'CO-OP · WAVE 1' : 'WAVE 1'; bannerT = 90; startSfMusic();
            }
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key) || e.code === 'Slash') e.preventDefault();
          }
          function offKey(e) { keys[e.key] = false; }
          document.addEventListener('keydown', onKey);
          document.addEventListener('keyup',   offKey);

          init(); frameStep();
          xp._sfCleanup = stopGame;
        }

        // Public entry point. As a classic script this is already a window global, but
        // make it explicit so it survives the obfuscated build (where this file is wrapped
        // in an IIFE — top-level names no longer auto-attach to window). app.js's
        // launchStickFighter() finds the chunk through this. Keep `openStickFighter` on the
        // obfuscator's reserved-names list.
        window.openStickFighter = openStickFighter;
