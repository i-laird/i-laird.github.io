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
