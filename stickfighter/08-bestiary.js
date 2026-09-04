// ── bestiary — the lore ledger: every foe's tell and counter, seen/kill counts, the B-panel ──
/* Six horde pieces, two elite tiers, and seven named foes — and until now the only
   place any of their rules were written down was this directory's CLAUDE.md.
   The bestiary is the trophy case's second tab (B on the title screen): one row
   per foe, masked ??? until first sighted, and a detail card with the foe's LIVE
   sprite, its tell (what it does before it hurts you), the counter, its elite
   forms, and lifetime seen / slain counts. Persisted account-wide in
   `ilaird_sf_bestiary` ({ type: { seen, kills } }), written at the end of a run
   (and on desktop shutdown), never per spawn — and noPersist()-gated at the
   increment, so a watched replay or an online run teaches the ledger nothing.
   The preview sprite is built with makeEnemy() under a CONSTANT rng (the title
   screen must stay rnd()-free — see drawIntroScreen), and the draw is wrapped:
   a render-only failure must never take the title screen down with it. */
const BESTIARY = [
  { type: 'goblin', name: 'GOBLIN', horde: true, wave: 'wave 1',
    tell: 'steers with momentum — it commits to a line and skids past a sidestep',
    counter: 'cut sideways at the last moment; it overshoots, then swing',
    elite: 'shield-bearer (bronze) blocks the first blow · warlord (gold) blocks two and runs faster' },
  { type: 'wolf', name: 'WOLF', horde: true, wave: 'wave 2',
    tell: 'stalks, then FLASHES with a dashed sight line before a straight lunge',
    counter: 'step OFF the line during the flash — never run along it',
    elite: 'frost wolf chills you on a brush (dash still works) · dire wolf carries a 90px chill aura' },
  { type: 'archer', name: 'SKELETON ARCHER', horde: true, wave: 'wave 3',
    tell: 'keeps its range, visibly nocks, then looses along the aim',
    counter: 'strafe, or bat the arrow with a swing; close the gap between volleys',
    elite: 'volley archer fans three arrows · deadeye fans five, faster' },
  { type: 'troll', name: 'TROLL', horde: true, wave: 'wave 4',
    tell: 'slow, wide club, three hearts — you can see every one it has left',
    counter: 'hit and run; never trade in its reach',
    elite: 'bull troll (five hearts) enrages below two · dread troll (eight) ROARS as it turns' },
  { type: 'shaman', name: 'GOBLIN SHAMAN', horde: true, wave: 'endless · wave 8',
    tell: 'channels a green ring that hastens and mends the pack; shrieks it into a frenzy',
    counter: 'freeze it or chase it with a dash — it blinks when you close; the ring dies with it',
    elite: 'never an elite — an empowered empowerer would be a spiral' },
  { type: 'bomber', name: 'BOMBARDIER', horde: true, wave: 'endless · wave 10',
    tell: 'hoists a keg with a lit fuse, then lobs it where you WERE standing',
    counter: 'keep moving after the throw; bait the pack into the blast — kegs hurt them too',
    elite: 'never an elite' },
  { type: 'ogre', name: 'THE WAR-OGRE', wave: 'wave 3, once',
    tell: 'winds up with a red flash and a charge line, then bull-rushes a straight line that bounces off walls',
    counter: 'leave the line before the flash ends; punish the recovery — eight hearts, no flinch' },
  { type: 'wraith', name: 'RINGWRAITH · THE NINE', wave: 'wave 5', secret: true,
    tell: 'nine orbit in a tightening ring; they flash TOGETHER, then lunge as one',
    counter: 'dash THROUGH the ring on the flash, never away from it; no champion can save you here' },
  { type: 'witchking', name: 'THE WITCH-KING', wave: 'after the Nine', secret: true,
    tell: 'mounted: dives along a purple sight line · on foot: whips a flail in a wide arc',
    counter: 'sidestep the dive; the flail reaches PAST his body — stay behind him' },
  { type: 'trooper', name: 'STORMTROOPER', wave: 'the corridor', secret: true,
    tell: 'forms up in column and holds fire until every trooper has arrived',
    counter: 'close before they form; a swing deflects the red bolts' },
  { type: 'vader', name: 'DARTH VADER', wave: 'the corridor', secret: true,
    tell: 'a grey flash and a raised saber, then a Force lunge with a lethal arc out front',
    counter: 'dash THROUGH him during the lunge — never backpedal; nine hearts, no flinch' },
  { type: 'guard', name: 'ROYAL GUARD', wave: "the Emperor's side", secret: true,
    tell: 'a telegraphed pike lunge',
    counter: 'step aside and take the two hits it has' },
  { type: 'sidious', name: 'DARTH SIDIOUS', wave: 'after Vader', secret: true,
    tell: 'a saber spin, a long-building lightning corridor, leaps to reposition; at half health, lightning only — and it RAKES',
    counter: 'leave the corridor sideways; dash i-frames beat the bolt; you can outrun the rake by circling' },
  { type: 'dio', name: 'DIO', wave: 'the night room', secret: true,
    tell: 'knife fans, a MUDA ring, ZA WARUDO barrages that fly when time resumes — the ROAD ROLLER at low health',
    counter: 'weave the knife gaps after the snap; the roller lands only inside its telegraphed zone' },
  { type: 'ian', name: 'THE CREATOR', wave: 'the end', secret: true,
    tell: 'kneels, unarmed, and weeps',
    counter: "it's your call" },
];
const BEST_KEY = 'ilaird_sf_bestiary';
let sfBestiary = {};
try {
  const raw = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
  if (raw && typeof raw === 'object') {
    for (const b of BESTIARY) {
      const r = raw[b.type];
      if (r && typeof r === 'object') sfBestiary[b.type] = { seen: Math.max(0, r.seen | 0), kills: Math.max(0, r.kills | 0) };
    }
  }
} catch (_) { /* a fresh ledger */ }
let bestiaryDirty = false;
let showBestiary = false;   // the intro's B-panel
let bestSel = 0;
function bestEntry(type) { return sfBestiary[type] || (sfBestiary[type] = { seen: 0, kills: 0 }); }
// called from makeEnemy: a sighting (nothing is read back by the sim)
function bestiarySeen(type) {
  if (noPersist() || !BESTIARY.some(b => b.type === type)) return;
  bestEntry(type).seen++;
  bestiaryDirty = true;
  if (BESTIARY.filter(b => b.horde).every(b => (sfBestiary[b.type] || {}).seen > 0)) sfUnlock('lorekeeper');
}
// called from killEnemy
function bestiaryKill(type) {
  if (noPersist() || !BESTIARY.some(b => b.type === type)) return;
  bestEntry(type).kills++;
  bestiaryDirty = true;
}
function saveBestiary() {
  if (!bestiaryDirty) return;
  bestiaryDirty = false;
  try { localStorage.setItem(BEST_KEY, JSON.stringify(sfBestiary)); } catch (_) { /* private mode */ }
}
function bestiaryKnown() { return BESTIARY.filter(b => (sfBestiary[b.type] || {}).seen > 0).length; }
// a preview sprite: the real makeEnemy under a constant rng (title frames stay
// rnd()-free), animated off `frame` so the wolf paces and the king's beast flaps
function bestiaryPreview(type, x, y) {
  const save = sfRng;
  let e = null;
  try {
    sfRng = () => 0.37;
    e = makeEnemy(type, x, y, 0);
  } catch (_) { e = null; }
  sfRng = save;
  if (!e) return;
  e.phase = frame * 0.06; e.fx = -1; e.frozen = 0; e.flashT = 0; e.dead = false;
  if (e.type === 'witchking') e.flapT = frame * 0.2;
  if (e.type === 'dio') { e.mode = 'idle'; e.cape = 0.5 + 0.5 * Math.sin(frame * 0.05); }
  if (e.type === 'sidious') e.lit = 1;
  try { drawEnemy(e); } catch (_) { /* render-only: never take the title down */ }
}
function drawBestiary() {
  ctx.save();
  ctx.fillStyle = 'rgba(2,4,8,0.9)'; ctx.fillRect(0, 0, GW, GH);
  ctx.textAlign = 'center';
  ctx.font = 'bold 22px Tahoma,Arial'; ctx.fillStyle = '#ffd24d';
  ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
  ctx.fillText('📖 BESTIARY', GW / 2, 46);
  ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText(bestiaryKnown() + ' / ' + BESTIARY.length + ' catalogued', GW / 2, 66);
  ctx.shadowBlur = 0;
  const listX = Math.max(24, GW / 2 - 330), listW = 220;
  const rowH = Math.max(20, Math.min(26, Math.floor((GH - 130) / BESTIARY.length)));
  ctx.textAlign = 'left';
  for (let i = 0; i < BESTIARY.length; i++) {
    const b = BESTIARY[i];
    const r = sfBestiary[b.type];
    const known = r && r.seen > 0;
    const hot = i === bestSel;
    const y = 96 + i * rowH;
    if (hot) { ctx.fillStyle = 'rgba(255,210,77,0.12)'; ctx.fillRect(listX - 8, y - 14, listW, rowH - 2); }
    ctx.font = (hot ? 'bold ' : '') + '12px Tahoma,Arial';
    ctx.fillStyle = known ? (hot ? '#ffe9ad' : '#c8d2da') : (hot ? '#8a949a' : '#4d5860');
    ctx.fillText((known ? '' : '🔒 ') + (known || !b.secret ? b.name : '? ? ?'), listX, y);
  }
  // the detail card
  const b = BESTIARY[bestSel];
  const r = sfBestiary[b.type] || { seen: 0, kills: 0 };
  const known = r.seen > 0;
  const cx = listX + listW + 30, cw = Math.min(400, GW - cx - 24);
  const cy = 88, ch = Math.min(GH - 120, 330);
  ctx.fillStyle = 'rgba(12,16,22,0.92)';
  roundRectPath(cx, cy, cw, ch, 10); ctx.fill();
  ctx.strokeStyle = known ? 'rgba(255,210,77,0.5)' : 'rgba(120,140,160,0.35)'; ctx.lineWidth = 1.5;
  roundRectPath(cx, cy, cw, ch, 10); ctx.stroke();
  // the sprite stands on a spotlight in the card's top-left
  const sx = cx + 70, sy = cy + 96;
  ctx.fillStyle = 'rgba(255,210,77,0.08)';
  ctx.beginPath(); ctx.ellipse(sx, sy + 6, 46, 13, 0, 0, Math.PI * 2); ctx.fill();
  if (known) {
    ctx.save(); ctx.translate(sx, sy); ctx.scale(1.5, 1.5); ctx.translate(-sx, -sy);
    bestiaryPreview(b.type, sx, sy);
    ctx.restore();
  } else {
    ctx.font = 'bold 34px Tahoma,Arial'; ctx.fillStyle = '#3a444c'; ctx.textAlign = 'center';
    ctx.fillText('?', sx, sy);
  }
  const tx = cx + 140, tw = cw - 156;
  const wrap = (text, x, y, font, color, lh) => {
    ctx.font = font; ctx.fillStyle = color; ctx.textAlign = 'left';
    const words = String(text).split(' ');
    let line = '', yy = y;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (ctx.measureText(t).width > tw && line) { ctx.fillText(line, x, yy); yy += lh; line = w; }
      else line = t;
    }
    if (line) ctx.fillText(line, x, yy);
    return yy + lh;
  };
  let y = cy + 30;
  ctx.font = 'bold 16px Tahoma,Arial'; ctx.fillStyle = known ? '#ffd24d' : '#5c6773'; ctx.textAlign = 'left';
  ctx.fillText(known || !b.secret ? b.name : '? ? ?', tx, y); y += 16;
  ctx.font = '10px Tahoma,Arial'; ctx.fillStyle = '#8494a4';
  ctx.fillText(known || !b.secret ? b.wave : 'not yet met', tx, y); y += 20;
  if (known) {
    ctx.font = 'bold 10px Tahoma,Arial'; ctx.fillStyle = '#ff8a80'; ctx.fillText('THE TELL', tx, y); y += 13;
    y = wrap(b.tell, tx, y, '11px Tahoma,Arial', '#d8e0e8', 13) + 4;
    ctx.font = 'bold 10px Tahoma,Arial'; ctx.fillStyle = '#7CFC8A'; ctx.fillText('THE COUNTER', tx, y); y += 13;
    y = wrap(b.counter, tx, y, '11px Tahoma,Arial', '#d8e0e8', 13) + 4;
    if (b.elite) {
      ctx.font = 'bold 10px Tahoma,Arial'; ctx.fillStyle = '#c9a227'; ctx.fillText('ELITE FORMS', tx, y); y += 13;
      y = wrap(b.elite, tx, y, '10px Tahoma,Arial', '#aeb9c4', 12) + 4;
    }
    ctx.font = 'bold 11px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
    ctx.fillText('seen ' + r.seen + '   ·   slain ' + r.kills, cx + 20, cy + ch - 16);
  } else {
    wrap('meet it on the field and its page fills in', tx, y, 'italic 11px Tahoma,Arial', '#6c7780', 13);
  }
  ctx.textAlign = 'center';
  ctx.font = 'bold 12px Tahoma,Arial'; ctx.fillStyle = '#9fb0c0';
  ctx.fillText('↑ ↓ — browse   ·   B / Q — close   ·   T — trophy case', GW / 2, GH - 22);
  ctx.restore(); ctx.textAlign = 'left';
}
