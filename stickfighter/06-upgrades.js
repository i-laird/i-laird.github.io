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
];
const upCost = (u) => (u.cost || 1) + bn.toll;   // most nodes cost 1 token; capstones more; HEAVY TOLL taxes all
const TREE_COLOR = { DASH: '#80deea', ALLIES: '#caa6ff', BLADE: '#ffd24d', BOW: '#9ccc65', SORCERY: '#ce93d8', GRAVE: NECRO_COL, SKYLANCE: DRAGOON_COL };
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
  const bearers = heroesAll().filter(h => h.cls === 'caster' || h.cls === 'necro' || h.cls === 'dragoon');
  if (!bearers.length) return;
  let y = GH - 22;
  ctx.save();
  for (const h of bearers) {
    const necro = h.cls === 'necro', drag = h.cls === 'dragoon';
    const sp = necro || drag ? null : SPELLS[curSpell(h)];
    // the dragoon's gauge is MOMENTUM: current speed against the top speed, with a
    // notch per Joust tier (goblin · wolf · troll) — "am I lethal right now?"
    const pool = necro ? SOULS_MAX : drag ? DRAG_CAP * up.dragCap : up.manaMax;
    const have = necro ? h.souls : drag ? Math.hypot(h.vx, h.vy) : h.mana;
    const cost = necro ? up.raiseCost : drag ? JOUST_BAR.goblin : sp.cost;
    const ok = have >= cost && !h.down;
    const barW = 150, barH = 12, x = GW - barW - 14;
    const frac = clamp(have / pool, 0, 1);
    const who = coop ? (h === p2 ? 'P2 · ' : 'P1 · ') : '';
    const label = necro
      ? who + '💀 SOULS · raise ' + cost + '  ·  ' + '●'.repeat(minions.length) + '○'.repeat(Math.max(0, up.minionCap - minions.length))
      : drag
      ? who + '🐉 GALLOP · skewer past a notch — X flaps'
      : who + sp.icon + ' ' + sp.name + ' · ' + cost + (heroSpells().length > 1 ? '  ·  ' + (coop ? (h === p2 ? 'E' : '.') : 'C') + ' turns' : '') +
        (tick < (h.manaHoldTick || 0) ? '  ·  settling…' : '');
    ctx.textAlign = 'right';
    ctx.font = 'bold 11px Tahoma,Arial';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 4;
    ctx.fillStyle = h.down ? '#7a7a7a' : ok ? (necro ? NECRO_COL : drag ? DRAGOON_COL : sp.col) : '#8a93a5';
    ctx.fillText(label, x + barW, y - 6);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(10,16,24,0.82)';
    roundRectPath(x, y, barW, barH, 3); ctx.fill();
    if (frac > 0) {
      ctx.save();
      roundRectPath(x, y, barW, barH, 3); ctx.clip();
      const grd = ctx.createLinearGradient(x, y, x, y + barH);
      if (necro) { grd.addColorStop(0, ok ? '#7dfadf' : '#7ba8a0'); grd.addColorStop(1, ok ? '#0f9b82' : '#3a5a54'); }
      else if (drag) { grd.addColorStop(0, ok ? '#ffcc80' : '#a08a68'); grd.addColorStop(1, ok ? '#ef6c00' : '#5a4630'); }
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
    ctx.strokeStyle = ok ? (necro ? 'rgba(100,255,218,0.75)' : drag ? 'rgba(255,167,38,0.8)' : 'rgba(179,157,219,0.75)') : 'rgba(150,160,180,0.4)';
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
