// ── netplay — online co-op: signaling, WebRTC handshake, lockstep gate, checksums ──
/* ── online co-op: signaling, handshake, lockstep plumbing ──
   (see the netplay comment block up top for the design; the per-tick feeder
   lives at the top of loop() beside the replay feeder, and the tick gate in
   frameStep) */
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
function netOpen(mode) {
  netTeardown();
  netDiag = { local: '?', remote: '?', states: [] };
  netSaved = { c1: classSel, c2: classSel2, coop, daily: dailyRun, hs: hardSel,
               top: menuTop, ss: subSingle, sm: subMulti,
               gw: xp.offsetWidth, gh: xp.offsetHeight - 40 };
  netUi = { mode, phase: mode === 'host' ? 'creating' : 'code', code: '', input: '', err: '', copiedT: 0 };
  netCfg = null;
  if (mode === 'host') netStartHost();
}
// non-trickle ICE: wait for gathering so ONE blob carries the candidates —
// signaling is a single store/fetch each way, no trickle channel needed.
// Resolve on gathering-complete, or after 3s ONCE at least one candidate is in
// the SDP (shipping a candidate-less blob guarantees an ICE failure — better to
// wait out a slow STUN, hard-capped at 8s).
function netWaitIce() {
  return new Promise((res) => {
    const pc = netPc;
    if (!pc) return res();
    const t0 = Date.now();
    const poll = () => {
      if (netPc !== pc) return res();       // torn down / retried meanwhile
      const sdp = (pc.localDescription && pc.localDescription.sdp) || '';
      const hasCand = /a=candidate:/.test(sdp);
      const dt = Date.now() - t0;
      if (pc.iceGatheringState === 'complete' || (hasCand && dt >= 3000) || dt >= 8000) return res();
      setTimeout(poll, 200);
    };
    poll();
  });
}
function netArmConnTimeout() {
  if (netTimeout) clearTimeout(netTimeout);
  netTimeout = setTimeout(() => {
    netTimeout = 0;
    if (!netplay && netUi && netUi.phase !== 'err') {
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      netAbort('could not reach the other player' + diag + ' — a strict network may be blocking the path. both of you should retry (or try another network).');
    }
  }, 20000);
}
function netWirePc(pc) {
  pc.onconnectionstatechange = () => {
    if (netPc !== pc) return;
    const s = pc.connectionState;
    if (netDiag) netDiag.states.push(s);
    netLog('connection: ' + s);
    if (s === 'connected' && netDiscoT) { clearTimeout(netDiscoT); netDiscoT = 0; }
    // MID-RUN, a dead link no longer ends the game — the run is held and re-signaled
    // (netStartRecon): `failed` reconnects at once; `disconnected` only after a 10s
    // grace, because browsers often recover it on their own (a lagging or tabbed-away
    // peer must NOT trigger a pointless re-signal — their link is fine, they're just
    // not sending frames, and the stall badge covers that). Pre-run, `failed` still
    // aborts to the connect screen. `closed` is covered by the channel's onclose
    // (our own teardown nulls these handlers first, so it never self-trips).
    if (netplay) {
      if (s === 'failed') netStartRecon('the peer link failed');
      else if (s === 'disconnected' && !netRecon && !netDiscoT) {
        netDiscoT = setTimeout(() => {
          netDiscoT = 0;
          if (netplay && !netRecon && netPc === pc && pc.connectionState === 'disconnected') {
            netStartRecon('the link went quiet');
          }
        }, 10000);
      }
      return;
    }
    if (s === 'failed') {
      const diag = netDiag ? ' (you gathered ' + netDiag.local + ' · they sent ' + netDiag.remote + ')' : '';
      if (netUi && netUi.phase !== 'err' && netUi.phase !== 'code') {
        netAbort('no direct route between you could be found' + diag + ' — retry, or try a different network. VPNs and strict NATs block peer links.');
      }
    }
  };
}
function netWireChannel(dc) {
  netChan = dc;
  dc.onopen = () => {
    if (netChan !== dc) return;
    netLog('data channel open');
    if (netTimeout) { clearTimeout(netTimeout); netTimeout = 0; }
    // don't clobber the lobby if the peer's hello already arrived (a same-tick
    // delivery can land the message before our own open event fires)
    if (netUi && netUi.phase !== 'lobby') netUi.phase = 'handshake';
    if (netplay) {
      // mid-run reconnect — swap resume state instead of the hello handshake. The
      // client wipes its pending host-menu events first: the host's authoritative
      // log re-sends everything past our tick, so a wipe-then-resend can't lose or
      // double-apply a pick (see the 'resume' handler).
      if (!netIsHost) netEvents = [];
      netSend({ t: 'resume', r: netRunId, k: tick, have: netHaveRemote });
      return;
    }
    // the client opens the handshake; the host answers with the run config
    if (!netIsHost) netSend({ t: 'hello', nv: NET_VER, sv: NET_SIM_V, cls: classSel, gw: GW, gh: GH });
  };
  dc.onmessage = (ev) => {
    if (netChan !== dc) return;
    let m = null;
    try { m = JSON.parse(ev.data); } catch (_) { return; }
    if (m && typeof m.t === 'string') netHandle(m);
  };
  dc.onclose = () => {
    if (netChan !== dc) return;
    // mid-run, a closed channel is a DROP, not an exit — hold the run and re-signal
    // (a deliberate exit crosses as 'bye' before the close and lands in netLeave)
    if (netplay) netStartRecon('the link closed');
    else if (netUi && netUi.phase !== 'err') netAbort('the connection closed before the game began');
  };
}
function netSend(o) {
  try { if (netChan && netChan.readyState === 'open') netChan.send(JSON.stringify(o)); } catch (_) {}
}
async function netStartHost() {
  const base = lbBase();
  if (!base) { netAbort('online play needs the room service, and it is unreachable'); return; }
  try {
    netIsHost = true;
    netPc = new RTCPeerConnection(NET_RTC_CONF);
    netWirePc(netPc);
    netWireChannel(netPc.createDataChannel('sf', { ordered: true }));   // reliable+ordered: lockstep's transport
    const offer = await netPc.createOffer();
    await netPc.setLocalDescription(offer);
    await netWaitIce();
    if (!netPc || !netUi || netUi.mode !== 'host') return;   // player backed out mid-create
    if (netDiag) netDiag.local = netCandSummary(netPc.localDescription.sdp);
    netLog('offer ready — candidates: ' + netCandSummary(netPc.localDescription.sdp));
    const r = await fetch(base + '/mp-host', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ offer: { type: netPc.localDescription.type, sdp: netPc.localDescription.sdp } }),
    });
    if (!r.ok) throw new Error('mp-host ' + r.status);
    const d = await r.json();
    if (!netUi || netUi.mode !== 'host') return;
    netUi.code = String(d.code || '');
    netRoomCode = netUi.code;   // kept past the connect screen — the rejoin room derives from it
    netUi.phase = 'waiting';
    let polls = 0;
    netPoll = setInterval(async () => {
      if (!netPc || !netUi || netUi.phase !== 'waiting') { clearInterval(netPoll); netPoll = 0; return; }
      if (++polls > 150) { netAbort('the room expired — nobody joined in time'); return; }   // ~5 min
      try {
        const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(netUi.code));
        if (!rr.ok) return;
        const dd = await rr.json();
        if (dd && dd.answer && netPc && netPc.signalingState === 'have-local-offer') {
          clearInterval(netPoll); netPoll = 0;
          if (netUi) netUi.phase = 'connecting';
          if (netDiag) netDiag.remote = netCandSummary(dd.answer.sdp);
          netLog('answer received — their candidates: ' + netCandSummary(dd.answer.sdp));
          netArmConnTimeout();
          await netPc.setRemoteDescription(dd.answer);
        }
      } catch (_) { /* transient poll failure — try again next interval */ }
    }, 2000);
  } catch (_) { netAbort('could not create a room — check your connection and try again'); }
}
async function netStartJoin(code) {
  const base = lbBase();
  if (!base) { netAbort('online play needs the room service, and it is unreachable'); return; }
  netUi.phase = 'connecting'; netUi.code = code; netUi.err = '';
  netRoomCode = code;   // kept past the connect screen — the rejoin room derives from it
  try {
    netIsHost = false;
    const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(code));
    if (r.status === 404) { netUi.phase = 'code'; netUi.input = ''; netUi.err = 'room not found — check the code (rooms expire after 5 minutes)'; return; }
    if (!r.ok) throw new Error('mp-offer ' + r.status);
    const d = await r.json();
    if (!d || !d.offer) throw new Error('bad offer');
    netPc = new RTCPeerConnection(NET_RTC_CONF);
    netWirePc(netPc);
    netPc.ondatachannel = (ev) => { if (netPc) netWireChannel(ev.channel); };
    if (netDiag) netDiag.remote = netCandSummary(d.offer.sdp);
    netLog('offer fetched — their candidates: ' + netCandSummary(d.offer.sdp));
    await netPc.setRemoteDescription(d.offer);
    const ans = await netPc.createAnswer();
    await netPc.setLocalDescription(ans);
    await netWaitIce();
    if (!netPc || !netUi) return;
    if (netDiag) netDiag.local = netCandSummary(netPc.localDescription.sdp);
    netLog('answer ready — candidates: ' + netCandSummary(netPc.localDescription.sdp));
    const rr = await fetch(base + '/mp-join', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, answer: { type: netPc.localDescription.type, sdp: netPc.localDescription.sdp } }),
    });
    if (rr.status === 409) { netAbort('someone already joined that room'); return; }
    if (!rr.ok) throw new Error('mp-join ' + rr.status);
    netArmConnTimeout();
  } catch (_) { netAbort('could not join — check your connection and the code'); }
}
function netHandle(m) {
  switch (m.t) {
    case 'hello': {   // host side: the client introduces itself → open the READY LOBBY
      if (!netIsHost || netplay || netCfg) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) {
        netSend({ t: 'err', why: 'version' });
        netAbort('version mismatch — you two are on different builds. both of you: reload the page and retry.');
        return;
      }
      if (netUi) {
        netUi.phase = 'lobby';
        netUi.peerCls = clamp(m.cls | 0, 0, CLASSES.length - 1);
        netUi.peerGw = Math.max(320, m.gw | 0) || GW;
        netUi.peerGh = Math.max(240, m.gh | 0) || GH;
        netUi.myReady = false; netUi.peerReady = false;
      }
      netSend({ t: 'lobby', nv: NET_VER, sv: NET_SIM_V, cls: classSel });
      break;
    }
    case 'lobby': {   // client side: the host opened the ready lobby (version-checked both ways)
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.sv !== NET_SIM_V) { netAbort('version mismatch — you two are on different builds. both of you: reload the page and retry.'); return; }
      if (netUi) {
        netUi.phase = 'lobby';
        netUi.peerCls = clamp(m.cls | 0, 0, CLASSES.length - 1);
        netUi.myReady = false; netUi.peerReady = false;
      }
      break;
    }
    case 'cls':       // lobby: the peer re-picked their hero (live on both screens)
      if (!netplay && netUi && netUi.phase === 'lobby') netUi.peerCls = clamp(m.c | 0, 0, CLASSES.length - 1);
      break;
    case 'rdy':       // lobby: the peer toggled ready — when BOTH are, the host starts
      if (!netplay && netUi && netUi.phase === 'lobby') {
        netUi.peerReady = !!m.v;
        netLobbyMaybeStart();
      }
      break;
    case 'cfg': {     // client side: adopt the host's authoritative run header
      if (netIsHost || netplay) return;
      if (m.nv !== NET_VER || m.v !== NET_SIM_V) { netAbort('version mismatch — you two are on different builds. both of you: reload the page and retry.'); return; }
      netCfg = { v: m.v, seed: m.seed >>> 0,
                 c1: clamp(m.c1 | 0, 0, CLASSES.length - 1), c2: clamp(m.c2 | 0, 0, CLASSES.length - 1),
                 hd: m.hd ? 1 : 0, up0: Array.isArray(m.up0) ? m.up0 : [],
                 tk0: m.tk0 | 0, mw0: m.mw0 | 0,
                 gw: Math.max(320, m.gw | 0), gh: Math.max(240, m.gh | 0) };
      netSend({ t: 'ready' });
      break;
    }
    case 'ready': if (netIsHost && netCfg && !netplay) { netSend({ t: 'go' }); netBeginRun(); } break;
    case 'go':    if (!netIsHost && netCfg && !netplay) netBeginRun(); break;
    case 'f': {       // a remote input frame for tick m.k
      if (!netplay || m.r !== netRunId || typeof m.k !== 'number') return;
      const fk = m.k | 0;
      if (fk > netHaveRemote) netHaveRemote = fk;   // resume re-sends start past this
      netFrames[netIsHost ? 1 : 0].set(fk,
        { m: m.m | 0, e: m.e | 0, s: (typeof m.s === 'number') ? m.s | 0 : -1, h: m.h | 0 });
      break;
    }
    case 'resume': {  // the link is back mid-run: refill whatever the drop swallowed
      if (!netplay || m.r !== netRunId) return;
      // re-send our own staged frames the peer never received (retained in our half
      // of netFrames — the loop keeps a trailing window for exactly this)
      const mine = netFrames[netIsHost ? 0 : 1];
      for (let k = (m.have | 0) + 1; k <= tick + NET_DELAY; k++) {
        const f = mine.get(k);
        if (f) netSend({ t: 'f', r: netRunId, k, m: f.m, e: f.e, s: f.s, h: f.h });
      }
      // the host's menu-event log is authoritative: re-send everything past the
      // peer's tick (the peer wiped its pending list at reopen, so no duplicates)
      if (netIsHost) {
        for (const ev of netEventLog) {
          if (ev[0] > (m.k | 0)) netSend({ t: 'ev', r: netRunId, k: ev[0], op: ev[1], a: ev[2] });
        }
      }
      netRecon = null; netStall = 0;
      netLog('resumed at tick ' + tick + ' (peer at ' + (m.k | 0) + ', had our frames through ' + (m.have | 0) + ')');
      break;
    }
    case 'ev':        // a host menu pick, tick-stamped (client applies via its feeder)
      if (netplay && !netIsHost && m.r === netRunId && typeof m.k === 'number') {
        netEvents.push([m.k | 0, m.op | 0, m.a]);
        netEvents.sort((x, y) => x[0] - y[0]);
      }
      break;
    case 'cs':        // the remote's periodic sim checksum
      if (netplay && m.r === netRunId && typeof m.k === 'number') {
        netCsRemote.set(m.k | 0, m.h >>> 0);
        netCheckCs(m.k | 0);
      }
      break;
    case 'restart':   // host rematch: same team & cfg, a fresh shared seed
      if (netplay && !netIsHost && netCfg && typeof m.seed === 'number') { netCfg.seed = m.seed >>> 0; netBeginRun(); }
      break;
    case 'bye':
      if (netplay) netLeave('THE OTHER PLAYER LEFT');
      else if (netUi) netAbort('the other player backed out');
      break;
    case 'err':
      if (m.why === 'version') netAbort('version mismatch — you two are on different builds. both of you: reload the page and retry.');
      break;
  }
}
// both players ready → the HOST builds the authoritative run header, and the old
// cfg → ready → go handshake finishes the job (the lobby is a confirm gate in front
// of it — nobody's run starts under a class they were still deciding on)
function netLobbyMaybeStart() {
  if (!netIsHost || netplay || netCfg) return;
  if (!netUi || netUi.phase !== 'lobby' || !netUi.myReady || !netUi.peerReady) return;
  const c2 = netUi.peerCls | 0;
  // fresh entropy for the shared seed (the one non-deterministic input, as in init)
  const seed = (((Date.now() >>> 0) ^ ((Math.random() * 0x100000000) >>> 0)) >>> 0);
  // snapshot the host's own party profile for this duo (upProfile reads classSel2/coop)
  const savedC2 = classSel2, savedCoop = coop;
  classSel2 = c2; coop = true;
  const up0 = [...loadSavedUpgrades()];
  const tk0 = parseInt(loadProfileItem('ilaird_sf_tokens') || '0', 10) || 0;
  const mw0 = parseInt(loadProfileItem('ilaird_sf_maxwave', false) || '0', 10) || 0;
  classSel2 = savedC2; coop = savedCoop;
  const gw = Math.min(GW, netUi.peerGw || GW);
  const gh = Math.min(GH, netUi.peerGh || GH);
  netCfg = { v: NET_SIM_V, seed, c1: classSel, c2, hd: 0, up0, tk0, mw0, gw, gh };
  netUi.phase = 'starting';
  netSend({ t: 'cfg', nv: NET_VER, ...netCfg });
}
// host menu picks (boon / shop / boss-intro / Ian) become tick-stamped events applied
// by BOTH feeders. Stamped tick+NET_DELAY+1: the other peer can run at most NET_DELAY
// ticks ahead of our last-sent frame, and the ordered channel delivers this before any
// frame that would let it pass that stamp — so neither sim can have passed it.
function netQueueEvent(op, a) {
  const k = tick + NET_DELAY + 1;
  netEvents.push([k, op, a]);
  netEvents.sort((x, y) => x[0] - y[0]);
  netEventLog.push([k, op, a]);   // kept all run (tiny) — a resume re-sends any lost in flight
  netSend({ t: 'ev', r: netRunId, k, op, a });
}
function netBeginRun() {
  netplay = true;
  netRunId++;
  netUi = null;
  // impersonate the shared config (startReplay-style); netSaved restores on exit
  classSel = netCfg.c1; classSel2 = netCfg.c2;
  coop = true; dailyRun = false; hardSel = false;
  sfSeedOverride = netCfg.seed >>> 0;
  setGameDims(netCfg.gw, netCfg.gh);
  netFrames = [new Map(), new Map()];
  // pre-seed the first NET_DELAY ticks with silence on both sides, so tick 1 can run
  for (let t = 1; t <= NET_DELAY; t++) {
    netFrames[0].set(t, { m: 0, e: 0, s: -1, h: 0 });
    netFrames[1].set(t, { m: 0, e: 0, s: -1, h: 0 });
  }
  netEvents = []; netEventLog = [];
  netLocal = { dash: false, atk: false, cycle: false, summon: -1, mash: 0 };
  netStall = 0; netCsLocal = new Map(); netCsRemote = new Map();
  // reconnect bookkeeping: the rejoin room is a pure function of (room code, seed),
  // so both peers derive the identical rendezvous with nothing exchanged — and a
  // rematch (new seed) moves to a fresh room automatically
  netRecon = null; netHaveRemote = NET_DELAY;   // the pre-seeded silence counts as received
  netRejoin = rejoinHash(netRoomCode, netCfg.seed >>> 0);
  simAcc = 0; lastFrameTs = null;
  netLog('run begins — you are ' + (netIsHost ? 'P1 (host)' : 'P2 (client)') +
         ' · P1 ' + CLASSES[netCfg.c1] + ' / P2 ' + CLASSES[netCfg.c2] +
         ' · seed ' + (netCfg.seed >>> 0) + ' · field ' + netCfg.gw + 'x' + netCfg.gh +
         ' (desktop ' + xp.offsetWidth + 'x' + (xp.offsetHeight - 40) + ')');
  init();                              // netplay branch: state from netCfg, recorder disarmed
  started = true; frame = 0;
  banner = '🌐 ONLINE CO-OP · WAVE 1';
  bannerSub = 'you are ' + (netIsHost ? 'PLAYER 1 (white)' : 'PLAYER 2 (green)') + ' · no scores are saved online';
  bannerT = 150;
  openBoonMenu('CHOOSE YOUR BOON');    // synchronous, the seed's first draws — identical on both sims
  startSfMusic();
}
// back to the title screen (partner left, desync, or a chosen exit) — restore
// everything the impersonated run changed and leave a sticky notice
function netLeave(msg) {
  netTeardown();
  netplay = false; netCfg = null; netUi = null;
  netFrames = null; netEvents = []; netLocal = null;
  netCsLocal = null; netCsRemote = null;
  netRecon = null; netEventLog = []; netRoomCode = ''; netRejoin = '';
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
  netReconSeq++;   // any in-flight reconnect loop sees a stale token and goes inert
  const pc = netPc, ch = netChan;
  netPc = null; netChan = null;        // nulled FIRST so late events see a stale handle and bail
  try { if (ch) { ch.onmessage = null; ch.onopen = null; ch.onclose = null; ch.close(); } } catch (_) {}
  try { if (pc) { pc.onconnectionstatechange = null; pc.ondatachannel = null; pc.close(); } } catch (_) {}
}
/* ── mid-run reconnection ──
   A dropped link no longer ends the game. The lockstep gate already freezes both
   sims the moment frames stop, so the run is perfectly preserved — we tear down
   the dead transport, keep every bit of run state, and re-signal through a REJOIN
   room both peers derive from (room code, seed) with nothing exchanged. The host
   re-posts a fresh offer to it each attempt (the worker overwrites the room and
   stamps a gen so the joiner can't answer a stale offer); the joiner polls until
   a fresh offer appears. This retries for up to NET_RECON_MAX_MS (10 minutes) —
   then the run ends cleanly via netLeave; Q (or the desktop shutting down) ends
   the wait sooner. When the channel reopens, both peers send
   'resume' and refill what the drop swallowed: their own retained input frames
   past the peer's last-received tick, and (host) any menu events lost in flight —
   then the gate simply unblocks and lockstep continues bit-exact. */
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
function netStartRecon(why) {
  if (!netplay || netRecon) return;
  netLog('link lost mid-run (' + why + ') — holding the run, re-signaling via ' + netRejoin);
  netTeardown();   // closes the dead pc/channel; bumps netReconSeq (old loops go inert)
  netRecon = { attempt: 0, t0: performance.now(), gen: '' };
  netReconAttempt(netReconSeq);
}
// one signaling attempt; reschedules itself until the run resumes or the session
// ends. Cadence keeps the host under the worker's /mp-host rate limit (~2/min here).
async function netReconAttempt(tok) {
  // live() doubles as the deadline check — the attempt loops consult it every ~2s,
  // so the 10-minute cap lands promptly wherever the loop happens to be waiting
  // (netLeave tears down the in-flight pc and restores the intro)
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
  const again = (ms) => { if (live()) setTimeout(() => { if (live()) netReconAttempt(tok); }, ms); };
  if (!live()) return;
  netRecon.attempt++;
  const base = lbBase();
  if (!base) { again(10000); return; }
  try {
    if (netIsHost) {
      // host: park a fresh offer in the rejoin room, then poll for the answer
      const pc = new RTCPeerConnection(NET_RTC_CONF);
      netPc = pc; netWirePc(pc);
      netWireChannel(pc.createDataChannel('sf', { ordered: true }));
      await pc.setLocalDescription(await pc.createOffer());
      await netWaitIce();
      if (!live() || netPc !== pc) return;
      const r = await fetch(base + '/mp-host', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rejoin: netRejoin,
          offer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
      });
      if (!r.ok) throw new Error('mp-host ' + r.status);
      if (!live() || netPc !== pc) return;
      for (let i = 0; i < 12 && live() && netPc === pc; i++) {   // ~24s of answer polling
        await wait(2000);
        if (!live() || netPc !== pc) return;
        try {
          const rr = await fetch(base + '/mp-answer?code=' + encodeURIComponent(netRejoin));
          if (!rr.ok) continue;
          const dd = await rr.json();
          if (dd && dd.answer && pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(dd.answer);
            // give ICE time to land — the channel's onopen → 'resume' ends the recon
            for (let j = 0; j < 7 && live() && netPc === pc; j++) await wait(2000);
            break;
          }
        } catch (_) { /* transient poll failure — keep polling */ }
      }
      if (!live() || netPc !== pc) return;   // resumed (or session ended) — leave the live pc alone
      try { pc.close(); } catch (_) { /* already dead */ }
      if (netPc === pc) { netPc = null; netChan = null; }
      again(2000);   // this attempt aged out — re-post a fresh offer
    } else {
      // joiner: poll the rejoin room until a FRESH offer appears (gen changes on
      // every host re-post; answering the same gen twice would 409 anyway)
      const r = await fetch(base + '/mp-offer?code=' + encodeURIComponent(netRejoin));
      if (r.ok) {
        const d = await r.json();
        const gen = d && d.gen ? String(d.gen) : '';
        if (d && d.offer && gen && gen !== netRecon.gen) {
          netRecon.gen = gen;
          const pc = new RTCPeerConnection(NET_RTC_CONF);
          netPc = pc; netWirePc(pc);
          pc.ondatachannel = (ev) => { if (netPc === pc) netWireChannel(ev.channel); };
          await pc.setRemoteDescription(d.offer);
          await pc.setLocalDescription(await pc.createAnswer());
          await netWaitIce();
          if (!live() || netPc !== pc) return;
          const rr = await fetch(base + '/mp-join', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ code: netRejoin, gen,
              answer: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } }),
          });
          if (rr.ok) {   // wait out ICE; onopen → 'resume' ends the recon
            for (let j = 0; j < 7 && live() && netPc === pc; j++) await wait(2000);
          }
          if (!live() || netPc !== pc) return;
          try { pc.close(); } catch (_) { /* already dead */ }
          if (netPc === pc) { netPc = null; netChan = null; }
        }
      }
      again(2500);
    }
  } catch (_) { again(8000); }
}
// both peers may advance to tick T only when both input frames for T are buffered.
// No deadlock: each peer always has its own future frames and the remote's through
// (remoteTick + NET_DELAY), so stalls only ever reflect real latency.
function netCanStep() {
  return !!(netFrames && netFrames[0].has(tick + 1) && netFrames[1].has(tick + 1));
}
// the desync tripwire: every 60 ticks, fold the load-bearing sim state into a hash
// and swap it with the peer — a mismatch means the sims silently diverged (a bug),
// and a clean in-character failure beats two players seeing different worlds
function netChecksum() {
  let hsh = 5381 >>> 0;
  const mix = (v) => { hsh = (((hsh << 5) + hsh) ^ (v | 0)) >>> 0; };
  mix(tick); mix(score); mix(kills); mix(wave); mix(enemies.length);
  mix(tokens); mix(Math.round(meter));
  mix(Math.round(player.x * 8)); mix(Math.round(player.y * 8));
  if (p2) { mix(Math.round(p2.x * 8)); mix(Math.round(p2.y * 8)); }
  netCsLocal.set(tick, hsh);
  netSend({ t: 'cs', r: netRunId, k: tick, h: hsh });
  netCheckCs(tick);
  if (netCsLocal.size > 40) {          // prune — a laggy peer's checksums arrive late, not never
    const min = tick - 2400;
    for (const k of netCsLocal.keys()) if (k < min) netCsLocal.delete(k);
    for (const k of netCsRemote.keys()) if (k < min) netCsRemote.delete(k);
  }
}
function netCheckCs(k) {
  if (!netCsLocal || !netCsRemote) return;
  const a = netCsLocal.get(k), b = netCsRemote.get(k);
  if (a === undefined || b === undefined) return;
  netCsLocal.delete(k); netCsRemote.delete(k);
  if (a !== b) netLeave('DESYNC — the two worlds drifted apart. reconnect and try again.');
}
