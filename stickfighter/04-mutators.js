// ── mutators — the ⚗ MUTATED solo mode: three seeded run modifiers on top of the normal game ──
/* A fourth pill on the SINGLEPLAYER row. A mutated run is a NORMAL run (boons and
   all) with THREE modifiers drawn from MUTATORS by the seed — rolled inside init()
   as the seed's first draws, so an R-restart rolls a fresh set and a replay of a
   mutated run (header `mu`) re-rolls the identical one. Effects ride the same
   per-run `bn`/`up` fields the banes use, so every hook is a flag read at an
   existing site (wave quota, rollElite, the Aegis refresh, the powerup spawn,
   hero/horde speed) or render-only (the fog). Unranked by design: they change
   the difficulty in both directions, so lbBegin() skips the board like a cheat
   run — which also means the worker never sees a mutated replay and needs no new
   validation surface. Solo only (daily stays one fair sim; online is pinned by
   the cfg header). NOTHING here runs unless `mutated` is set, so an unmutated
   sim is byte-identical to before and no sim-version bump is needed. */
const MUTATORS = [
  { id: 'swarm',      name: 'SWARM',        icon: '🐜', desc: 'war bands run 30% larger',                      apply: () => { bn.quotaMul = 1.3; } },
  { id: 'blood_moon', name: 'BLOOD MOON',   icon: '🌑', desc: 'elites stalk from the first wave',              apply: () => { bn.eliteEarly = true; } },
  { id: 'fog',        name: 'FOG OF WAR',   icon: '🌫️', desc: 'the dark leans in — you see less of the field', apply: () => { bn.fog = true; } },
  { id: 'glass',      name: 'GLASS AEGIS',  icon: '🫧', desc: 'the Aegis never recharges between waves',       apply: () => { bn.noRefresh = true; } },
  { id: 'leaden',     name: 'LEADEN DASH',  icon: '⛓️', desc: 'dashes recharge 80% slower',                    apply: () => { up.dashCd = Math.round(up.dashCd * 1.8); } },
  { id: 'drought',    name: 'DROUGHT',      icon: '🏜️', desc: 'no powerups ever spawn',                        apply: () => { bn.noPowerups = true; } },
  { id: 'thin_air',   name: 'THIN AIR',     icon: '🌬️', desc: 'you run 10% slower',                            apply: () => { bn.spd *= 0.9; } },
  { id: 'hunted',     name: 'HUNTED',       icon: '👁️', desc: 'the horde walks 10% faster',                    apply: () => { bn.foeSpd *= 1.1; } },
  { id: 'feast',      name: 'FEAST',        icon: '🍖', desc: 'a gift: coins pay double meter and +25 score',  apply: () => { bn.gold = true; } },
];
let mutSel = false;      // the intro's pick (SINGLEPLAYER → ⚗ MUTATED)
let mutated = false;     // this RUN is mutated (set per run in init — daily/replay/online aware)
let activeMuts = [];     // the three rolled ids, in roll order
// called at the END of init() — the seed's first draws, before the boon offer
function rollMutators() {
  activeMuts = [];
  if (!mutated) return;
  const pool = MUTATORS.slice();
  while (activeMuts.length < 3 && pool.length) {
    const m = pool.splice(Math.floor(rnd() * pool.length), 1)[0];
    activeMuts.push(m.id);
    m.apply();
  }
  if (bn.quotaMul !== 1) waveQuota = Math.round(waveQuota * bn.quotaMul);   // the opening band too
}
function mutatorNames() { return activeMuts.map(id => { const m = MUTATORS.find(x => x.id === id); return m ? m.icon + ' ' + m.name : id; }); }
