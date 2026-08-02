// ── netplay — online co-op WAR BAND (2–4 seats): signaling, lobby, host-relayed lockstep, reconnection ──
/* ── online co-op: a host-relayed STAR for up to NET_MAX_SEATS fighters ──
   The HOST is seat 0 (P1) and every joiner links only to the host, which relays
   input frames and menu events between clients — 2-player is simply the 2-seat
   case of the same code path. One room code serves the whole band: the first
   joiner takes the minted room, later joiners fall through to derived, gen-
   stamped SLOT rooms the host re-arms after each join (the overwritable rejoin-
   room machinery — zero new worker surface). Frames are seat-tagged ({t:'f',
   p:seat}); a tick executes only when EVERY seat's frame for it is buffered
   (netCanStep), so the relay adds at most one host hop of latency. The per-tick
   feeder lives at the top of loop() beside the replay feeder. */
const NET_RTC_CONF = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
};
// connection diagnostics — candidate counts each side gathered + the state trail,
// folded into failure messages and breadcrumbed to the console ([sf-net]) so a
// "couldn't connect" report is actually debuggable
let netDiag = null;
function netCandSummary(sdp) {
  const counts = { host: 0, srflx: 0, relay: 0 };
  const re = /a=candidate:.+ typ (host|srflx|relay)/g;
  let m;
  while ((m = re.exec(sdp || ''))) counts[m[1]]++;
  return counts.host + ' host / ' + counts.srflx + ' srflx' + (counts.relay ? ' / ' + counts.relay + ' relay' : '');
}
function netLog(msg) {
  try { console.info('[sf-net] ' + msg); } catch (e) { /* no console */ }
}
/* room derivations — everything hangs off the ONE typed code:
   - slot rooms (pre-run, joiners 2..3): rejoinHash(code + ':join:' + n, 0)
   - per-seat rejoin rooms (mid-run reconnection): rejoinHash(code + ':' + seat, seed) */
function netSlotRoom(code, n) { return rejoinHash(code + ':join:' + n, 0); }
// derived from the run's FIRST seed (seed0), never the current one: a rematch
// changes netCfg.seed, and a peer that drops during the restart exchange would
// otherwise re-signal into a different room than the one being polled
function netSeatRoom(seat) { return rejoinHash(netRoomCode + ':' + seat, netCfg ? (netCfg.seed0 != null ? netCfg.seed0 : netCfg.seed) >>> 0 : 0); }
function netOpen(mode) {
  netTeardown();
  netDiag = { local: '?', remote: '?', states: [] };
  // save BEFORE the pair coercion below, so backing out restores the real pick
  netSaved = { c1: classSel, c2: classSel2, coop, daily: dailyRun, hs: hardSel,
               top: menuTop, ss: subSingle, sm: subMulti,
               gw: xp.offsetWidth, gh: xp.offsetHeight - 40 };
  // a stale paired pick can't cross into the wrong seat: the joiner never plays
  // the wyrm (they're P2+), and nobody plays the rider except through the pair
  if (classSel === PAIR_RIDER || (classSel === PAIR_WYRM && mode !== 'host')) classSel = 0;
  netIsHost = mode === 'host';
  netSeat = netIsHost ? 0 : -1;
  netConns = []; netArming = null;
  netUi = { mode, phase: mode === 'host' ? 'creating' : 'code', code: '', input: '', err: '', copiedT: 0,
            seats: netIsHost ? [{ c: classSel, r: false, on: true }] : null, myReady: false };
  netCfg = null;
  if (mode === 'host') netHostArm(null);
}
// non-trickle ICE: wait for gathering so ONE blob carries the candidates —
// signaling is a single store/fetch each way, no trickle channel needed.
function netWaitIce(pc, aliveFn) {
  return new Promise((res) => {
    if (!pc) return res();
    const t0 = Date.now();
    const poll = () => {
      if (aliveFn && !aliveFn()) return res();
      const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
      const hasCand = /a=candidate:/.test(sdp);
      const dt = Date.now() - t0;
      if (pc.iceGatheringState === 'complete' || (hasCand && dt >= 3000) || dt >= 8000) return res();
      setTimeout(poll, 200);
    };
    poll();
  });
}
/* ── link wiring — every pc/channel pair belongs to a `link`:
   the CLIENT's single { host: true } link, a HOST conn (a seated client), or the
   host's netArming placeholder. Guards compare against the link's own handles so
   a torn-down link's late events go inert. ── */
function netWirePc(pc, conn) {
  pc.onconnectionstatechange = () => {
    if (conn ? conn.pc !== pc : netPc !== pc) return;
    const s = pc.connectionState;
    if (netDiag) netDiag.states.push(s);
    netLog('connection' + (conn && conn.seat > 0 ? ' (P' + (conn.seat + 1) + ')' : '') + ': ' + s);
    const dT = conn || { get discoT() { return netDiscoT; }, set discoT(v) { netDiscoT = v; } };
    if (s === 'connected' && dT.discoT) { clearTimeout(dT.discoT); dT.discoT = 0; }
    // MID-RUN a dead link holds the run and re-signals (netStartRecon): `failed`
    // reconnects at once, `disconnected` after a 10s grace (browsers often recover
    // it; a lagging/tabbed-away peer is covered by the stall badge, not a re-signal)
    if (netplay) {
      if (s === 'failed') netStartRecon(conn, 'the peer link failed');
      else if (s === 'disconnected' && !(conn ? conn.recon : netRecon) && !dT.discoT) {
        dT.discoT = setTimeout(() => {
          dT.discoT = 0;
          if (netplay && !(conn ? conn.recon : netRecon) &&
              (conn ? conn.pc === pc : netPc === pc) && pc.connectionState === 'disconnected') {
            netStartRecon(conn, 'the link went quiet');
          }
        }, 10000);
      }
      return;
    }
    if (s === 'failed') {
      if (conn) { netHostDropLink(conn, 'lost a joiner mid-connect'); return; }
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      if (netUi && netUi.phase !== 'err' && netUi.phase !== 'code') {
        netAbort('no direct route could be found' + diag + ' — retry, or try a different network. VPNs and strict NATs block peer links.');
      }
    }
  };
}
function netWireChannel(dc, conn) {
  if (conn) conn.chan = dc; else netChan = dc;
  dc.onopen = () => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    netLog('data channel open' + (conn && conn.seat > 0 ? ' (P' + (conn.seat + 1) + ')' : ''));
    if (netTimeout) { clearTimeout(netTimeout); netTimeout = 0; }
    if (netUi && netUi.phase !== 'lobby') netUi.phase = netIsHost ? (netUi.phase === 'waiting' || netUi.phase === 'creating' ? netUi.phase : 'lobby') : 'handshake';
    if (netplay) {
      // mid-run reconnect — swap resume state instead of the hello handshake.
      // The CLIENT reports per-seat floors (it receives every seat through the
      // host); the HOST reports the scalar floor of that client's own frames.
      if (conn) netSendTo(conn, { t: 'resume', r: netRunId, k: tick, have: conn.have });
      else netSend({ t: 'resume', r: netRunId, k: tick, have: netHave || [] });
      return;
    }
    // a joiner opens the handshake; the host answers with a seat + the lobby
    if (!netIsHost) netSend({ t: 'hello', nv: NET_VER, sv: NET_SIM_V, cls: classSel, gw: GW, gh: GH });
  };
  dc.onmessage = (ev) => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    let m = null;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m && typeof m.t === 'string') netHandle(m, conn);
  };
  dc.onclose = () => {
    if ((conn ? conn.chan : netChan) !== dc) return;
    // mid-run, a closed channel is a DROP, not an exit — hold the run and re-signal
    // (a deliberate exit crosses as 'bye' before the close and lands in netLeave)
    if (netplay) netStartRecon(conn, 'the link closed');
    else if (conn) netHostDropLink(conn, 'a joiner left');
    else if (netUi && netUi.phase !== 'err' && !netIsHost) netAbort('the connection closed before the game began');
  };
}
// host: broadcast to every open conn · client: to the host link
function netSend(o) {
  const s = JSON.stringify(o);
  if (netIsHost) {
    for (const c of netConns) {
      try { if (c.chan && c.chan.readyState === 'open') c.chan.send(s); } catch (_) { /* that link is dying */ }
    }
  } else {
    try { if (netChan && netChan.readyState === 'open') netChan.send(s); } catch (_) { /* dying */ }
  }
}
function netSendTo(conn, o) {
  try { if (conn.chan && conn.chan.readyState === 'open') conn.chan.send(JSON.stringify(o)); } catch (_) { /* dying */ }
}
function netRelay(m, fromConn) {   // host: forward a message to every OTHER conn
  const s = JSON.stringify(m);
  for (const c of netConns) {
    if (c === fromConn) continue;
    try { if (c.chan && c.chan.readyState === 'open') c.chan.send(s); } catch (_) { /* dying */ }
  }
}
/* ── HOST: arm a room and wait for the next joiner. The first arm mints the
   typed room code; every later arm re-posts a fresh gen-stamped offer into one
   of the two derived slot rooms (alternating), which joiners try in order. ── */
let netArmSeq = 0;
async function netHostArm(slotCode) {
  const base = lbBase();
  if (!base) { if (!netConns.length) netAbort('online play needs the room service, and it is unreachable'); return; }
  const pend = { seat: -1, pc: null, chan: null, have: NET_DELAY, csRemote: new Map(),
                 recon: null, discoT: 0, ack: false, cls: 0, gw: GW, gh: GH, room: slotCode, pollId: 0 };
  try {
    const pc = new RTCPeerConnection(NET_RTC_CONF);
    pend.pc = pc;
    netArming = pend;
    netWirePc(pc, pend);
    netWireChannel(pc.createDataChannel('sf', { ordered: true }), pend);
    await pc.setLocalDescription(await pc.createOffer());
    await netWaitIce(pc, () => netArming === pend);
    if (netArming !== pend || !netUi || netUi.mode !== 'host') return;
    if (netDiag && !slotCode) netDiag.local = netCandSummary(pc.localDescription.sdp);
    const body = slotCode
      ? { rejoin: slotCode, offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }
      : { offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } };
    const r = await fetch(base + '/mp-host', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('mp-host ' + r.status);
    const d = await r.json();
    if (netArming !== pend || !netUi || netUi.mode !== 'host') return;
    if (!slotCode) {
      netUi.code = String(d.code || '');
      netRoomCode = netUi.code;   // every derived room hangs off this
      netUi.phase = 'waiting';
    }
    pend.room = slotCode || netUi.code;
    let polls = 0;
    pend.pollId = setInterval(async () => {
      if (netArming !== pend || !netUi) { clearInterval(pend.pollId); pend.pollId = 0; return; }
      polls++;
      if (!slotCode && !netConns.length && polls > 150) { netAbort('the room expired — nobody joined in time'); return; }  // ~5 min, first joiner only
      if (slotCode && polls % 110 === 0) {
        // slot rooms expire in 5 min — quietly re-arm a fresh offer before that
        clearInterval(pend.pollId); pend.pollId = 0;
        if (netArming === pend) { netArming = null; try { pend.pc.close(); } catch (_) {} netHostArm(slotCode); }
        return;
      }
      try {
        const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(pend.room));
        if (!rr.ok) return;
        const dd = await rr.json();
        // re-check after the awaits — a teardown/hello may have retired this pend
        // while the fetch was in flight
        if (netArming !== pend) { clearInterval(pend.pollId); pend.pollId = 0; return; }
        if (dd && dd.answer && pend.pc && pend.pc.signalingState === 'have-local-offer') {
          clearInterval(pend.pollId); pend.pollId = 0;
          if (netDiag && !slotCode) netDiag.remote = netCandSummary(dd.answer.sdp);
          netLog('answer received in ' + pend.room);
          await pend.pc.setRemoteDescription(dd.answer);
          // the channel's open → the joiner's hello seats them (netHandle)
        }
      } catch (_) { /* transient poll failure — try again next interval */ }
    }, 2000);
  } catch (_) {
    // release the arming slot — leaving netArming set would block netHostArmNext
    // forever, silently capping the band at however many had already joined
    if (netArming === pend) {
      netArming = null;
      try { if (pend.pc) pend.pc.close(); } catch (_2) { /* already dead */ }
    }
    if (!netConns.length && !slotCode) netAbort('could not create a room — check your connection and try again');
    else setTimeout(() => { netHostArmNext(); }, 5000);   // transient failure — retry the slot arm
  }
}
// a pre-run link died (or a lobby member left): free the seat, shift the ones
// above it down (seats stay contiguous), tell everyone, and re-arm a slot
function netHostDropLink(conn, why) {
  netLog(why);
  try { if (conn.pollId) clearInterval(conn.pollId); } catch (_) {}
  try { if (conn.chan) { conn.chan.onmessage = conn.chan.onopen = conn.chan.onclose = null; conn.chan.close(); } } catch (_) {}
  try { if (conn.pc) { conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch (_) {}
  const i = netConns.indexOf(conn);
  if (i < 0) { if (netArming === conn) { netArming = null; netHostArmNext(); } return; }
  netConns.splice(i, 1);
  for (const c of netConns) {
    if (c.seat > conn.seat) { c.seat--; netSendTo(c, { t: 'seat', n: c.seat, nv: NET_VER, sv: NET_SIM_V }); }
  }
  // a drop while the cfg was in flight ('starting') invalidates the header — the
  // seats just shifted and the missing ack would never arrive, wedging the lobby.
  // Fall back to an un-readied lobby and let the band confirm the new lineup.
  if (!netplay && netCfg && netUi && netUi.phase === 'starting') {
    netCfg = null;
    netUi.phase = 'lobby'; netUi.myReady = false;
    for (const c of netConns) { c.ready = false; c.ack = false; }
  }
  netLobbySync();
  netHostArmNext();
}
function netHostArmNext() {
  if (!netUi || netUi.mode !== 'host' || netplay) return;
  if (netArming || netConns.length + 1 >= NET_MAX_SEATS) return;
  netHostArm(netSlotRoom(netRoomCode, 2 + (netArmSeq++ % 2)));
}
// rebuild + broadcast the lobby's seat table (host-authoritative)
function netLobbySync() {
  if (!netIsHost || !netUi) return;
  const seats = [{ c: classSel, r: !!netUi.myReady, on: true }];
  for (const c of netConns) seats[c.seat] = { c: c.cls, r: !!c.ready, on: true };
  netUi.seats = seats;
  netSend({ t: 'lob', seats, code: netRoomCode });
}
// lobby actions shared by the key handler (23-input) — each side owns its seat
function netLobbyCls() {
  if (netIsHost) netLobbySync();
  else netSend({ t: 'cls', c: classSel });
}
function netLobbyReady(v) {
  if (netUi) netUi.myReady = v;
  if (netIsHost) { netLobbySync(); netLobbyMaybeStart(); }
  else netSend({ t: 'rdy', v: v ? 1 : 0 });
}
async function netStartJoin(code) {
  const base = lbBase();
  if (!base) { netAbort('online play needs the room service, and it is unreachable'); return; }
  netUi.phase = 'connecting'; netUi.code = code; netUi.err = '';
  netRoomCode = code;
  netIsHost = false; netSeat = -1;
  const ui = netUi;
  const candidates = [code, netSlotRoom(code, 2), netSlotRoom(code, 3)];
  const tried = new Set();   // cand+gen pairs that 409'd — don't re-answer a taken offer
  try {
    let sawRoom = false;
    for (let round = 0; round < 40 && netUi === ui && ui.phase === 'connecting'; round++) {
      for (const cand of candidates) {
        if (netUi !== ui || ui.phase !== 'connecting') return;
        let d = null;
        try {
          const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(cand));
          if (!r.ok) continue;
          d = await r.json();
        } catch (_) { continue; }
        if (!d || !d.offer) continue;
        sawRoom = true;
        const gen = d.gen ? String(d.gen) : '';
        if (tried.has(cand + '#' + gen)) continue;
        const pc = new RTCPeerConnection(NET_RTC_CONF);
        netPc = pc;
        netWirePc(pc, null);
        pc.ondatachannel = (ev) => { if (netPc === pc) netWireChannel(ev.channel, null); };
        if (netDiag) netDiag.remote = netCandSummary(d.offer.sdp);
        await pc.setRemoteDescription(d.offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await netWaitIce(pc, () => netPc === pc && netUi === ui);
        if (netUi !== ui || netPc !== pc) return;
        if (netDiag) netDiag.local = netCandSummary(pc.localDescription.sdp);
        const body = { code: cand, answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } };
        if (gen) body.gen = gen;
        let rr = null;
        try {
          rr = await fetch(base + '/mp-join', {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
          });
        } catch (_) { /* fall through to retry */ }
        if (rr && rr.ok) {
          netArmConnTimeout();
          return;   // the channel's open → hello → seat assignment drive the rest
        }
        tried.add(cand + '#' + gen);
        try { pc.close(); } catch (_) {}
        if (netPc === pc) { netPc = null; netChan = null; }
      }
      await new Promise((res) => setTimeout(res, 700));
    }
    if (netUi === ui && ui.phase === 'connecting') {
      if (sawRoom) netAbort('that war band is full (4 fighters max) — or the room went stale. ask the host for a fresh code.');
      else { ui.phase = 'code'; ui.input = ''; ui.err = 'room not found — check the code (rooms expire after 5 minutes)'; }
    }
  } catch (_) { if (netUi === ui) netAbort('could not join — check your connection and the code'); }
}
function netArmConnTimeout() {
  if (netTimeout) clearTimeout(netTimeout);
  netTimeout = setTimeout(() => {
    netTimeout = 0;
    if (!netplay && !netIsHost && netUi && netUi.phase !== 'err' && netUi.phase !== 'lobby') {
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      netAbort('could not reach the host' + diag + ' — a strict network may be blocking the path. retry, or try another network.');
    }
  }, 20000);
}
function netHandle(m, conn) {
  switch (m.t) {
    case 'hello': {   // host side: a joiner introduces itself → seat it, open the lobby
      if (!netIsHost || netplay || netCfg || !conn) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) {
        netSendTo(conn, { t: 'err', why: 'version' });
        netHostDropLink(conn, 'version-mismatched joiner turned away');
        return;
      }
      if (netConns.length + 1 >= NET_MAX_SEATS && !netConns.includes(conn)) {
        netSendTo(conn, { t: 'full' });
        netHostDropLink(conn, 'room full');
        return;
      }
      conn.seat = netConns.length + 1;
      conn.cls = clamp(m.cls | 0, 0, PAIR_WYRM - 1);   // joiners never pick the pair
      conn.gw = Math.max(320, m.gw | 0) || GW;
      conn.gh = Math.max(240, m.gh | 0) || GH;
      conn.ready = false;
      if (netArming === conn) netArming = null;
      netConns.push(conn);
      if (netUi) netUi.phase = 'lobby';
      netSendTo(conn, { t: 'seat', n: conn.seat, nv: NET_VER, sv: NET_SIM_V });
      netLobbySync();
      netHostArmNext();   // park the next offer for the rest of the band
      break;
    }
    case 'seat':      // client side: the host seated us (version-checked both ways)
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) { netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.'); return; }
      netSeat = clamp(m.n | 0, 1, NET_MAX_SEATS - 1);
      if (netUi) { netUi.phase = 'lobby'; netUi.myReady = false; }
      break;
    case 'lob':       // client side: the lobby's seat table (host-authoritative)
      if (netIsHost || netplay || !netUi) return;
      netUi.seats = Array.isArray(m.seats) ? m.seats : [];
      break;
    case 'cls':       // host side: a joiner re-picked their hero
      if (!netIsHost || netplay || !conn || conn.seat < 1) return;
      conn.cls = clamp(m.c | 0, 0, PAIR_WYRM - 1);
      netLobbySync();
      break;
    case 'rdy':       // host side: a joiner toggled ready
      if (!netIsHost || netplay || !conn || conn.seat < 1) return;
      conn.ready = !!m.v;
      netLobbySync();
      netLobbyMaybeStart();
      break;
    case 'cfg': {     // client side: adopt the host's authoritative run header
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.v !== NET_SIM_V) { netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.'); return; }
      const cs = (Array.isArray(m.cs) ? m.cs : []).slice(0, NET_MAX_SEATS).map((c) => clamp(c | 0, 0, CLASSES.length - 1));
      if (cs.length < 2) return;
      netCfg = { v: m.v, seed: m.seed >>> 0,
                 seed0: (typeof m.seed0 === 'number' ? m.seed0 : m.seed) >>> 0, cs,
                 hd: m.hd ? 1 : 0, up0: Array.isArray(m.up0) ? m.up0 : [],
                 tk0: m.tk0 | 0, mw0: m.mw0 | 0,
                 gw: Math.max(320, m.gw | 0), gh: Math.max(240, m.gh | 0) };
      netSend({ t: 'ready' });
      break;
    }
    case 'ready':     // host side: a joiner acked the cfg — go when the whole band has
      if (!netIsHost || !netCfg || netplay || !conn) return;
      conn.ack = true;
      if (netConns.every((c) => c.ack)) { netSend({ t: 'go' }); netBeginRun(); }
      break;
    case 'go':    if (!netIsHost && netCfg && !netplay) netBeginRun(); break;
    case 'f': {       // a seat-tagged input frame for tick m.k
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      const p = m.p | 0;
      if (p < 0 || p >= netFrames.length || p === netSeat) return;
      if (netIsHost && (!conn || p !== conn.seat)) return;   // a client only speaks for its own seat
      const fk = m.k | 0;
      netFrames[p].set(fk, { m: m.m | 0, e: m.e | 0, s: (typeof m.s === 'number') ? m.s | 0 : -1, h: m.h | 0 });
      if (netIsHost) { if (fk > conn.have) conn.have = fk; netRelay(m, conn); }
      else if (netHave && fk > netHave[p]) netHave[p] = fk;
      break;
    }
    case 'resume': {  // a link is back mid-run: refill whatever the drop swallowed
      if (!netplay) return;
      if (m.r !== netRunId) {
        // a returning peer that missed a rematch: hand it the CURRENT restart so
        // it netBeginRuns on the shared cfg and locksteps from the top (repeats
        // until its runId converges); dropping it silently would wedge both ends
        if (netIsHost && conn && netConns.includes(conn) && netCfg) {
          conn.recon = null;
          netSendTo(conn, { t: 'restart', seed: netCfg.seed });
        }
        return;
      }
      // EVENTS BEFORE FRAMES, both directions: frames unblock the lockstep gate,
      // and a sim that steps past an event's stamp before the event lands drops
      // it (`ek <= tick`) — a guaranteed desync. Queued events are harmless early.
      if (netIsHost && conn) {
        for (const ev of netEventLog) {
          if (ev[0] > (m.k | 0)) netSendTo(conn, { t: 'ev', r: netRunId, k: ev[0], op: ev[1], a: ev[2] });
        }
        // the client reported per-seat floors — refill EVERY seat from our buffers
        const floors = Array.isArray(m.have) ? m.have : [];
        for (let sIdx = 0; sIdx < netFrames.length; sIdx++) {
          if (sIdx === conn.seat) continue;
          const from = (floors[sIdx] | 0) + 1;
          for (let k = from; k <= tick + NET_DELAY; k++) {
            const f = netFrames[sIdx].get(k);
            if (f) netSendTo(conn, { t: 'f', r: netRunId, p: sIdx, k, m: f.m, e: f.e, s: f.s, h: f.h });
          }
        }
        conn.recon = null;
      } else if (!netIsHost) {
        for (const ev of netEventLog) {
          if (ev[0] > (m.k | 0)) netSend({ t: 'ev', r: netRunId, k: ev[0], op: ev[1], a: ev[2] });
        }
        // the host reported the scalar floor of OUR frames — resend our own
        const mine = netFrames[netSeat];
        for (let k = (m.have | 0) + 1; k <= tick + NET_DELAY; k++) {
          const f = mine.get(k);
          if (f) netSend({ t: 'f', r: netRunId, p: netSeat, k, m: f.m, e: f.e, s: f.s, h: f.h });
        }
        netRecon = null;
      }
      netStall = 0;
      netLog('resumed at tick ' + tick + (conn ? ' (P' + (conn.seat + 1) + ')' : ''));
      break;
    }
    case 'ev': {      // a tick-stamped menu event. Host-authoritative EXCEPT each
      // seat's own boon pick (op 12) and shop buys (op 7) — those cross upward
      // and the host relays them to the rest of the band.
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      const eop = m.op | 0;
      if (netIsHost && eop !== 12 && eop !== 7) return;
      const ek = m.k | 0;
      // dedupe: reconnect resumes re-send logs, so an event may arrive twice
      if (ek <= tick || netEvents.some(x => x[0] === ek && x[1] === eop && x[2] === m.a)) return;
      netEvents.push([ek, eop, m.a]);
      netEvents.sort(netEvCmp);
      if (netIsHost) {
        netEventLog.push([ek, eop, m.a]);   // the relay hub's log covers the whole band
        netRelay(m, conn);
      }
      break;
    }
    case 'cs':        // a peer's periodic sim checksum
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      if (netIsHost) {
        if (!conn) return;
        conn.csRemote.set(m.k | 0, m.h >>> 0);
        netCheckCsConn(conn, m.k | 0);
      } else {
        netCsRemote.set(m.k | 0, m.h >>> 0);
        netCheckCs(m.k | 0);
      }
      break;
    case 'restart':   // host rematch: same band & cfg, a fresh shared seed
      if (netplay && !netIsHost && netCfg && typeof m.seed === 'number') {
        netCfg.seed = m.seed >>> 0;
        netBeginRun();
        // ask the host to refill anything it sent before this restart reached us —
        // covers the drop-during-rematch path, where the host's opening frames for
        // the new run went into a dead link (without this both gates stall forever).
        // On a clean rematch this is a no-op: identical frame overwrites, deduped events.
        netSend({ t: 'resume', r: netRunId, k: tick, have: netHave || [] });
      }
      break;
    case 'bye':
      if (netplay) {
        // only a seated band member may disband the run — a stray link (e.g. a
        // stranger answering a rejoin room) must not kill four players' game
        if (conn && !netConns.includes(conn)) {
          try { if (conn.chan) conn.chan.close(); } catch (_) { /* dying anyway */ }
          return;
        }
        if (netIsHost) netSend({ t: 'bye' });   // one leaver disbands the band — tell the rest
        netLeave('A FIGHTER LEFT — the war band disbands');
      } else if (netIsHost && conn) netHostDropLink(conn, 'a joiner backed out');
      else if (netUi) netAbort('the host backed out');
      break;
    case 'full':
      if (!netplay) netAbort('that war band is full (4 fighters max)');
      break;
    case 'err':
      if (m.why === 'version') netAbort('version mismatch — you are on different builds. everyone: reload the page and retry.');
      break;
  }
}
// the whole band ready → the HOST builds the authoritative run header; each ack
// (‘ready’) is counted and ‘go’ starts every sim at once
function netLobbyMaybeStart() {
  if (!netIsHost || netplay || netCfg) return;
  if (!netUi || netUi.phase !== 'lobby' || !netUi.myReady) return;
  if (!netConns.length || !netConns.every((c) => c.ready)) return;
  const cs = [classSel === PAIR_WYRM ? PAIR_WYRM : clamp(classSel, 0, PAIR_WYRM)];
  for (const c of netConns) cs[c.seat] = clamp(c.cls | 0, 0, PAIR_WYRM - 1);
  // the WYRM & RIDER pair: the host in the beast binds SEAT 1 to the saddle
  if (cs[0] === PAIR_WYRM && cs.length > 1) cs[1] = PAIR_RIDER;
  // fresh entropy for the shared seed (the one non-deterministic input, as in init)
  const seed = (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
  // snapshot the host's own party profile (upProfile reads classSel2/coop)
  const savedC2 = classSel2, savedCoop = coop;
  classSel2 = cs[1] | 0; coop = true;
  const up0 = [...loadSavedUpgrades()];
  const tk0 = parseInt(loadProfileItem('ilaird_sf_tokens') || '0', 10) || 0;
  const mw0 = parseInt(loadProfileItem('ilaird_sf_maxwave', false) || '0', 10) || 0;
  classSel2 = savedC2; coop = savedCoop;
  let gw = GW, gh = GH;
  for (const c of netConns) { gw = Math.min(gw, c.gw || GW); gh = Math.min(gh, c.gh || GH); }
  netCfg = { v: NET_SIM_V, seed, seed0: seed, cs, hd: 0, up0, tk0, mw0, gw, gh };
  for (const c of netConns) c.ack = false;
  netUi.phase = 'starting';
  netSend({ t: 'cfg', nv: NET_VER, ...netCfg });
}
// menu picks become tick-stamped events applied by EVERY feeder. Stamped
// tick+NET_DELAY+1: no peer can run more than NET_DELAY ahead of our last-sent
// frame, and the ordered channel delivers this before any frame that would let
// it pass the stamp — so no sim can have passed it. (A client's event reaches
// the far clients one host-relay later, still inside the same bound + delay.)
// Full (tick, op, arg) order — a tick-only sort left EQUAL-tick events in
// arrival order, which differs per peer (each inserts its own first): two
// same-tick shop buys with tokens for only one completed DIFFERENT purchases
// on host and client — a guaranteed desync (caught by the tripwire, but real).
function netEvCmp(x, y) { return x[0] - y[0] || x[1] - y[1] || (x[2] | 0) - (y[2] | 0); }
function netQueueEvent(op, a) {
  const k = tick + NET_DELAY + 1;
  netEvents.push([k, op, a]);
  netEvents.sort(netEvCmp);
  netEventLog.push([k, op, a]);   // kept all run (tiny) — a resume re-sends any lost in flight
  netSend({ t: 'ev', r: netRunId, k, op, a });
}
function netBeginRun() {
  netplay = true;
  netRunId++;
  netUi = null;
  const cs = netCfg.cs;
  // impersonate the shared config (startReplay-style); netSaved restores on exit
  classSel = cs[0]; classSel2 = cs[1] | 0;
  coop = true; dailyRun = false; hardSel = false;
  sfSeedOverride = netCfg.seed >>> 0;
  setGameDims(netCfg.gw, netCfg.gh);
  netFrames = cs.map(() => new Map());
  // pre-seed the first NET_DELAY ticks with silence on every seat, so tick 1 can run
  for (let t = 1; t <= NET_DELAY; t++) {
    for (const fm of netFrames) fm.set(t, { m: 0, e: 0, s: -1, h: 0 });
  }
  netHave = cs.map(() => NET_DELAY);
  for (const c of netConns) { c.have = NET_DELAY; c.csRemote = new Map(); c.recon = null; }
  netEvents = []; netEventLog = [];
  netLocal = { dash: false, atk: false, cycle: false, summon: -1, mash: 0 };
  netMasks = [0, 0, 0, 0];
  netStall = 0; netCsLocal = new Map(); netCsRemote = new Map();
  netRecon = null;
  netRejoin = netSeatRoom(netSeat);   // my seat's reconnect rendezvous
  simAcc = 0; lastFrameTs = null;
  netLog('run begins — you are P' + (netSeat + 1) + ' of ' + cs.length +
         ' · band ' + cs.map((c) => CLASSES[c]).join(' / ') +
         ' · seed ' + (netCfg.seed >>> 0) + ' · field ' + netCfg.gw + 'x' + netCfg.gh);
  init();                              // netplay branch: state from netCfg, recorder disarmed
  started = true; frame = 0;
  banner = '🌐 ONLINE ' + (cs.length > 2 ? 'WAR BAND (' + cs.length + ')' : 'CO-OP') + ' · WAVE 1';
  bannerSub = 'you are PLAYER ' + (netSeat + 1) + ' · no scores are saved online';
  bannerT = 150;
  openBoonMenu('CHOOSE YOUR BOON');    // synchronous, the seed's first draws — identical on every sim
  startSfMusic();
}
// back to the title screen (a leaver, a desync, or a chosen exit) — restore
// everything the impersonated run changed and leave a sticky notice
function netLeave(msg) {
  netTeardown();
  netplay = false; netCfg = null; netUi = null;
  netFrames = null; netEvents = []; netLocal = null;
  netCsLocal = null; netCsRemote = null;
  netRecon = null; netEventLog = []; netRoomCode = ''; netRejoin = '';
  netConns = []; netSeat = 0; netHave = null; netMasks = [0, 0, 0, 0];
  if (netSaved) {
    classSel = netSaved.c1; classSel2 = netSaved.c2;
    coop = netSaved.coop; dailyRun = netSaved.daily; hardSel = netSaved.hs;
    menuTop = netSaved.top; subSingle = netSaved.ss; subMulti = netSaved.sm;
    setGameDims(netSaved.gw, netSaved.gh);
    netSaved = null;
  }
  sfSeedOverride = null;
  stopSfMusic();
  netNotice = msg || ''; netNoticeT = 480;
  init();                              // started=false → the intro screen
}
// a failure on the CONNECT screens (before any run): stay on them with the error
function netAbort(msg) {
  netTeardown();
  if (netUi) { netUi.phase = 'err'; netUi.err = msg; }
}
function netTeardown() {
  if (netPoll) { clearInterval(netPoll); netPoll = 0; }
  if (netTimeout) { clearTimeout(netTimeout); netTimeout = 0; }
  if (netDiscoT) { clearTimeout(netDiscoT); netDiscoT = 0; }
  netReconSeq++;   // any in-flight reconnect/join loop sees a stale token and goes inert
  const links = [...netConns];
  if (netArming) links.push(netArming);
  netConns = []; netArming = null;
  for (const c of links) {
    try { if (c.pollId) clearInterval(c.pollId); } catch (_) {}
    try { if (c.discoT) clearTimeout(c.discoT); } catch (_) {}
    try { if (c.chan) { c.chan.onmessage = c.chan.onopen = c.chan.onclose = null; c.chan.close(); } } catch (_) {}
    try { if (c.pc) { c.pc.onconnectionstatechange = null; c.pc.ondatachannel = null; c.pc.close(); } } catch (_) {}
  }
  const pc = netPc, ch = netChan;
  netPc = null; netChan = null;        // nulled FIRST so late events see a stale handle and bail
  try { if (ch) { ch.onmessage = null; ch.onopen = null; ch.onclose = null; ch.close(); } } catch (_) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.ondatachannel = null; pc.close(); } } catch (_) {}
}
/* ── mid-run reconnection (per seat) ──
   A dropped link holds the WHOLE band (the lockstep gate freezes every sim the
   moment a seat's frames stop) and re-signals through that seat's rejoin room,
   derived from (room code, seat, seed). The HOST re-posts fresh gen-stamped
   offers there; the dropped CLIENT polls for them. Retries for up to
   NET_RECON_MAX_MS (10 minutes), then the run concedes for everyone. On reopen
   both ends exchange 'resume' and refill the swallowed frames/events, and the
   gate simply unblocks — bit-exact, band-wide. */
function rejoinHash(code, seed) {
  const AB = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const s = code + ':' + (seed >>> 0);
  let h = 5381 >>> 0;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) ^ s.charCodeAt(i)) >>> 0;
  let out = '';
  for (let i = 0; i < 5; i++) { out += AB[h % AB.length]; h = ((Math.imul(h, 33) >>> 0) ^ (h >>> 7)) >>> 0; }
  return 'R' + out;
}
const NET_RECON_MAX_MS = 600000;   // give reconnection 10 minutes, then concede the run
// something reconnecting? (drives the overlay + blocks the rematch key)
function netReconActive() {
  if (netRecon) return netRecon;
  for (const c of netConns) if (c.recon) return c.recon;
  return null;
}
function netReconSeat() {
  if (netRecon) return netSeat;
  for (const c of netConns) if (c.recon) return c.seat;
  return -1;
}
function netStartRecon(conn, why) {
  if (!netplay) return;
  if (conn) {
    // HOST: one seat's link died — re-signal just that seat, keep the others.
    // Only a SEATED member gets a recon loop (a stray/replaced link is just closed),
    // and each conn carries its OWN token: bumping the global netReconSeq here
    // would go inert every OTHER seat's in-flight reconnect the moment a second
    // seat dropped, stranding the first until the 10-minute concede.
    if (!netConns.includes(conn)) {
      try { if (conn.chan) conn.chan.close(); } catch (_) {}
      try { if (conn.pc) conn.pc.close(); } catch (_) {}
      return;
    }
    if (conn.recon) return;
    netLog('P' + (conn.seat + 1) + ' link lost (' + why + ') — holding the run, re-signaling');
    try { if (conn.discoT) clearTimeout(conn.discoT); conn.discoT = 0; } catch (_) {}
    try { if (conn.chan) { conn.chan.onmessage = conn.chan.onopen = conn.chan.onclose = null; conn.chan.close(); } } catch (_) {}
    try { if (conn.pc) { conn.pc.onconnectionstatechange = null; conn.pc.close(); } } catch (_) {}
    conn.pc = null; conn.chan = null;
    conn.recon = { attempt: 0, t0: performance.now(), gen: '' };
    conn.reconTok = (conn.reconTok | 0) + 1;
    netReconHostAttempt(conn, conn.reconTok);
    return;
  }
  // CLIENT: our link to the host died
  if (netRecon) return;
  netLog('link lost mid-run (' + why + ') — holding the run, re-signaling via ' + netRejoin);
  if (netDiscoT) { clearTimeout(netDiscoT); netDiscoT = 0; }
  const pc = netPc, ch = netChan;
  netPc = null; netChan = null;
  try { if (ch) { ch.onmessage = ch.onopen = ch.onclose = null; ch.close(); } } catch (_) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.ondatachannel = null; pc.close(); } } catch (_) {}
  netReconSeq++;
  netRecon = { attempt: 0, t0: performance.now(), gen: '' };
  netReconClientAttempt(netReconSeq);
}
// HOST: repost offers into the dropped seat's rejoin room until it answers
async function netReconHostAttempt(conn, tok) {
  const live = () => {
    // per-conn token: another seat's drop must not kill this loop. Teardown is
    // covered by netConns.includes (netTeardown empties the registry).
    if (!(netplay && conn.recon && tok === (conn.reconTok | 0) && netConns.includes(conn))) return false;
    if (performance.now() - conn.recon.t0 > NET_RECON_MAX_MS) {
      netLog('reconnect window exhausted — conceding the run');
      netSend({ t: 'bye' });
      netLeave('CONNECTION LOST — P' + (conn.seat + 1) + ' could not return within 10 minutes');
      return false;
    }
    return true;
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const again = (ms) => { if (live()) setTimeout(() => { if (live()) netReconHostAttempt(conn, tok); }, ms); };
  if (!live()) return;
  conn.recon.attempt++;
  const base = lbBase();
  if (!base) { again(10000); return; }
  const room = netSeatRoom(conn.seat);
  try {
    const pc = new RTCPeerConnection(NET_RTC_CONF);
    conn.pc = pc; netWirePc(pc, conn);
    netWireChannel(pc.createDataChannel('sf', { ordered: true }), conn);
    await pc.setLocalDescription(await pc.createOffer());
    await netWaitIce(pc, () => live() && conn.pc === pc);
    if (!live() || conn.pc !== pc) return;
    const r = await fetch(base + '/mp-host', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rejoin: room,
        offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
    });
    if (!r.ok) throw new Error('mp-host ' + r.status);
    if (!live() || conn.pc !== pc) return;
    for (let i = 0; i < 12 && live() && conn.pc === pc; i++) {   // ~24s of answer polling
      await wait(2000);
      if (!live() || conn.pc !== pc) return;
      try {
        const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(room));
        if (!rr.ok) continue;
        const dd = await rr.json();
        if (dd && dd.answer && pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(dd.answer);
          for (let j = 0; j < 7 && live() && conn.pc === pc && conn.recon; j++) await wait(2000);
          break;
        }
      } catch (_) { /* transient poll failure — keep polling */ }
    }
    if (!live() || conn.pc !== pc || !conn.recon) return;   // resumed or gone
    try { pc.close(); } catch (_) { /* already dead */ }
    if (conn.pc === pc) { conn.pc = null; conn.chan = null; }
    again(2000);
  } catch (_) { again(8000); }
}
// CLIENT: poll our seat's rejoin room until the host's fresh offer appears
async function netReconClientAttempt(tok) {
  const live = () => {
    if (!(netplay && netRecon && tok === netReconSeq)) return false;
    if (performance.now() - netRecon.t0 > NET_RECON_MAX_MS) {
      netLog('reconnect window exhausted — conceding the run');
      netLeave('CONNECTION LOST — could not reconnect within 10 minutes');
      return false;
    }
    return true;
  };
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const again = (ms) => { if (live()) setTimeout(() => { if (live()) netReconClientAttempt(tok); }, ms); };
  if (!live()) return;
  netRecon.attempt++;
  const base = lbBase();
  if (!base) { again(10000); return; }
  try {
    const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(netRejoin));
    if (r.ok) {
      const d = await r.json();
      const gen = d && d.gen ? String(d.gen) : '';
      if (d && d.offer && gen && gen !== netRecon.gen) {
        netRecon.gen = gen;
        const pc = new RTCPeerConnection(NET_RTC_CONF);
        netPc = pc; netWirePc(pc, null);
        pc.ondatachannel = (ev) => { if (netPc === pc) netWireChannel(ev.channel, null); };
        await pc.setRemoteDescription(d.offer);
        await pc.setLocalDescription(await pc.createAnswer());
        await netWaitIce(pc, () => live() && netPc === pc);
        if (!live() || netPc !== pc) return;
        const rr = await fetch(base + '/mp-join', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ code: netRejoin, gen,
            answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
        });
        if (rr.ok) {   // wait out ICE; onopen → 'resume' ends the recon
          for (let j = 0; j < 7 && live() && netPc === pc && netRecon; j++) await wait(2000);
        }
        if (!live() || netPc !== pc || !netRecon) return;
        try { pc.close(); } catch (_) { /* already dead */ }
        if (netPc === pc) { netPc = null; netChan = null; }
      }
    }
    again(2500);
  } catch (_) { again(8000); }
}
// the band may advance to tick T only when EVERY seat's frame for T is buffered.
// No deadlock: each sim always has its own future frames, and every other seat's
// through (thatSeatTick + NET_DELAY), so stalls only ever reflect real latency.
function netCanStep() {
  if (!netFrames) return false;
  for (const fm of netFrames) if (!fm.has(tick + 1)) return false;
  return true;
}
// the desync tripwire: every 60 ticks, fold the load-bearing sim state into a
// hash and swap it — the host checks every client's stream, the clients check
// the host's. Any mismatch means a sim silently diverged (a bug) and the run
// ends cleanly for everyone.
function netChecksum() {
  let hsh = 5381 >>> 0;
  const mix = (v) => { hsh = (((hsh << 5) + hsh) ^ (v | 0)) >>> 0; };
  mix(tick); mix(score); mix(kills); mix(wave); mix(enemies.length);
  mix(tokens); mix(Math.round(meter));
  for (const h of heroesAll()) { mix(Math.round(h.x * 8)); mix(Math.round(h.y * 8)); }
  netCsLocal.set(tick, hsh);
  netSend({ t: 'cs', r: netRunId, k: tick, h: hsh });
  if (!netIsHost) netCheckCs(tick);
  if (netCsLocal.size > 40) {          // prune — a laggy peer's checksums arrive late, not never
    const min = tick - 2400;
    for (const k of netCsLocal.keys()) if (k < min) netCsLocal.delete(k);
    if (netCsRemote) for (const k of netCsRemote.keys()) if (k < min) netCsRemote.delete(k);
    for (const c of netConns) for (const k of c.csRemote.keys()) if (k < min) c.csRemote.delete(k);
  }
}
function netCheckCs(k) {   // client: compare the host's stream against our own
  if (!netCsLocal || !netCsRemote) return;
  const a = netCsLocal.get(k), b = netCsRemote.get(k);
  if (a === undefined || b === undefined) return;
  netCsRemote.delete(k);
  if (a !== b) { netSend({ t: 'bye' }); netLeave('DESYNC — the worlds drifted apart. reconnect and try again.'); }
}
function netCheckCsConn(conn, k) {   // host: compare one client's stream (local entries stay for the others)
  if (!netCsLocal) return;
  const a = netCsLocal.get(k), b = conn.csRemote.get(k);
  if (a === undefined || b === undefined) return;
  conn.csRemote.delete(k);
  if (a !== b) { netSend({ t: 'bye' }); netLeave('DESYNC — the worlds drifted apart. reconnect and try again.'); }
}
