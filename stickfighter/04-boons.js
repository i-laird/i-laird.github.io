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
