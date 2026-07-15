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
