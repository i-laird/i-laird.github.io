// Projects showcase — the recruiter path.
//
// The `projects` overlay (project cards + the two case studies) and the
// interactive architecture diagram they embed. Lazily loaded the first time
// `projects` / `calculus` / `portfolio` is run; same chunk pattern as
// achui.js: one global initProjects(api) → { open }, every app.js dependency
// through the explicit `api` bridge (projects-isolation.test.js enforces it),
// initProjects on the obfuscator's reserved-names list.
//
// It lives out here because it is the largest thing in app.js that a visitor
// may never open at all: ~375 lines of case-study prose, inline SVG and
// architecture specs that used to be parsed on every single page load.
//
// projOverlayEl STAYS OWNED BY APP.JS and is read/written as api.projOverlayEl
// — tryStartFinale() and the screensaver's ssBusy() both poll it so neither
// fires over an open showcase. projBoxEl is internal and stays here.
// NOTE: the moved code keeps its original app.js indentation on purpose.

function initProjects(api) {
  // Dependency bridge from app.js (see projectsBridge() there).
  const { ACHIEVEMENTS, announce, cmd, unlockAchievement } = api;

  let projBoxEl = null;
  /* ── Interactive architecture diagram (projects showcase) ──
     spec.tiers = [{ label, detached?, nodes: [{ name, info }] }]. Renders
     tier rows of clickable component nodes above a shared info panel;
     clicking a node selects it, explains it, and announces it for screen
     readers. Node info is plain text (set via textContent). Tiers are joined
     by a ▼ flow marker; detached tiers (e.g. a CI pipeline that isn't part
     of the request path) get a dashed separator instead. The first node
     starts selected so the panel is never empty. */
  function archDiagram(spec) {
    const box = document.createElement('div');
    box.className = 'arch';
    const hint = document.createElement('div');
    hint.className = 'arch-hint';
    hint.textContent = spec.hint || 'interactive — click a component to inspect it';
    box.appendChild(hint);
    const info = document.createElement('div');
    info.className = 'arch-info';
    const btns = [];
    function select(node, btn) {
      btns.forEach(b => { b.classList.remove('sel'); b.setAttribute('aria-pressed', 'false'); });
      btn.classList.add('sel');
      btn.setAttribute('aria-pressed', 'true');
      info.innerHTML = '';
      const t = document.createElement('span');
      t.className = 'arch-info-t';
      t.textContent = node.name;
      info.appendChild(t);
      info.appendChild(document.createTextNode(' — ' + node.info));
      announce(node.name + ': ' + node.info);
    }
    spec.tiers.forEach((tier, i) => {
      if (i) {
        const sep = document.createElement('div');
        sep.className = tier.detached ? 'arch-gap' : 'arch-flow';
        if (!tier.detached) sep.textContent = '▼';
        box.appendChild(sep);
      }
      const row = document.createElement('div');
      row.className = 'arch-tier';
      const lab = document.createElement('div');
      lab.className = 'arch-tier-label';
      lab.textContent = tier.label;
      row.appendChild(lab);
      const wrap = document.createElement('div');
      wrap.className = 'arch-row';
      tier.nodes.forEach(node => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'arch-node';
        b.textContent = node.name;
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => select(node, b));
        btns.push(b);
        wrap.appendChild(b);
      });
      row.appendChild(wrap);
      box.appendChild(row);
    });
    box.appendChild(info);
    select(spec.tiers[0].nodes[0], btns[0]);
    return box;
  }

  /* ── Projects overlay (the recruiter path) ──
     `projects` paints OVER the terminal instead of printing into it — the
     showcase renders in a fixed overlay (appended to document.body, never
     .window: the godmode rainbow's filter would trap position:fixed), so
     nothing in the terminal scrolls or shifts while reading it. Views:
     'index' (project cards) and the 'calc' / 'site' case studies; internal
     navigation re-renders the box in place. Escape, the ✕, or a backdrop
     click closes; a capture-phase key shield keeps keystrokes out of the
     terminal while open (browser shortcuts pass through). tryStartFinale
     checks api.projOverlayEl so the finale never fires over an open showcase.
     COMMANDS.projects / calculus / portfolio are one-line openers. */

  const PROJ_GH_SVG = `<svg width="15" height="15" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.35-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>`;
  const PROJ_LINK_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>`;
  const PROJ_DIAG_SVG = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="6"/><rect x="14" y="3" width="7" height="6"/><rect x="8.5" y="15" width="7" height="6"/><line x1="6.5" y1="9" x2="11" y2="15"/><line x1="17.5" y1="9" x2="13.5" y2="15"/></svg>`;

  const CALC_ARCH_SPEC = {
    tiers: [
      { label: 'client', nodes: [
        { name: 'Angular 21 SPA',
          info: 'TypeScript single-page app on Angular Material. mathjs assists expression entry, RxJS drives state, and Chart.js plots f(x) beside its nth-order derivatives at 801 sample points per curve.' },
      ] },
      { label: 'edge', nodes: [
        { name: 'CloudFront CDN',
          info: 'HTTPS termination and global edge caching. One distribution fronts the whole app: static asset requests are served from S3, API calls pass through to the Spring service.' },
      ] },
      { label: 'origins', nodes: [
        { name: 'S3 — static site',
          info: 'Hosts the compiled Angular build — plain HTML, JS, and CSS objects served through the CDN.' },
        { name: 'App Runner — Spring API',
          info: 'Spring Boot 4 on Java 25, containerized. Replaced the original ALB + ECS Fargate design: App Runner ships load balancing and auto-scaling out of the box, cutting the bill from ~$40/mo to under $10 with zero code changes.' },
      ] },
      { label: 'data', nodes: [
        { name: 'MySQL (RDS)',
          info: 'Spring Data JPA + Hibernate with BCrypt-hashed credentials behind Spring Security JWT auth. Runs in dev; deliberately switched off in prod until user features need it — the single biggest cost lever in the stack.' },
      ] },
      { label: 'pipeline', detached: true, nodes: [
        { name: 'GitHub Actions',
          info: 'Every push runs the build plus CodeQL and Qodana static analysis, then assembles a multi-stage Docker image.' },
        { name: 'ECR',
          info: 'The container registry App Runner pulls a fresh image from on each deploy.' },
      ] },
    ],
  };

  const SITE_ARCH_SPEC = {
    tiers: [
      { label: 'browser', nodes: [
        { name: 'terminal core',
          info: 'One hand-written, dependency-free classic script: command dispatch, tab completion, a writable overlay filesystem, runtime themes, CRT glass, and a screen-reader live region — no framework, no bundler, no build step.' },
        { name: '8 lazy chunks',
          info: 'Games, chess, the sans battle, the LLM HAL, an XP desktop, a CSS-3D room, the achievements UI, and Stick Fighter 2000 — each fetched on first use and sealed behind an explicit api bridge; a static lint proves no chunk touches the core by global name, so each stays independently bundleable.' },
        { name: 'service worker',
          info: 'GitHub Pages caps caching at 10 minutes, so a service worker adds cache-first audio and stale-while-revalidate for the bundle — repeat visits are instant and a played HAL clip never re-downloads.' },
        { name: 'WebRTC netplay',
          info: 'Stick Fighter runs 2–4 player online co-op as deterministic lockstep: only inputs cross the wire, every sim is bit-identical (CI proves it by hashing draw streams), a 60-tick checksum tripwire catches desyncs, and a dropped peer can rejoin mid-run.' },
      ] },
      { label: 'hosting', nodes: [
        { name: 'GitHub Pages',
          info: 'Push to main deploys. CI runs ESLint, Prettier, html-validate, and a jsdom suite that boots the real page — including tests that spin up four complete game instances over a stubbed network to prove online determinism.' },
      ] },
      { label: 'hal backend', nodes: [
        { name: 'Lambda + API Gateway',
          info: 'The brain behind the LLM HAL and the room’s phone line. Holds the Anthropic key server-side, gates bots with Cloudflare Turnstile, rate-caps by salted IP hash, and keeps the escape-game meters server-authoritative so they can’t be forged from the console.' },
        { name: 'DynamoDB',
          info: 'Short-TTL session state, game meters, the Stick Fighter leaderboard with watchable replays, and the phone-verification allowlist — telephone numbers exist only as salted one-way hashes.' },
      ] },
      { label: 'third parties', nodes: [
        { name: 'Claude',
          info: 'A live LLM plays the second HAL: an escape-the-terminal game with hidden per-session weaknesses, scheduled demands, word revocations, and a server-side judge — and it answers the room’s red phone in character.' },
        { name: 'ElevenLabs',
          info: 'HAL’s voice — ~135 pregenerated clips typewriter-synced via per-character timestamps (an LCS alignment re-syncs them around your name), plus live synthesis for the LLM HAL’s replies when sound is on.' },
        { name: 'Twilio',
          info: 'HAL calls your phone — for real. SMS-verified opt-in behind an A2P-compliant consent form, a neutral press-1 gate before the persona ever speaks, and permanent STOP/HELP keyword handling.' },
      ] },
    ],
  };

  function projEl(tag, cls, html) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html !== undefined) n.innerHTML = html;
    return n;
  }

  function projActions(list) {
    const acts = projEl('div', 'proj-actions');
    list.forEach(a => {
      let node;
      if (a.run) {
        node = projEl('button', 'card');
        node.type = 'button';
        node.addEventListener('click', a.run);
      } else {
        node = projEl('a', 'card');
        node.href = a.href;
        node.target = '_blank';
        node.rel = 'noopener noreferrer';
        if (a.egg) node.addEventListener('click', () => unlockAchievement(a.egg));
      }
      node.innerHTML = a.svg + a.label;
      acts.appendChild(node);
    });
    return acts;
  }

  function projCard(p) {
    const card = projEl('div', 'proj-card');
    if (p.shot) {   // real capture of the shipped thing (lazy — the overlay may never open)
      const img = document.createElement('img');
      img.className = 'proj-shot';
      img.src = p.shot; img.alt = p.shotAlt || ''; img.loading = 'lazy';
      card.appendChild(img);
    }
    card.appendChild(projEl('div', 'proj-title', p.title));
    card.appendChild(projEl('div', 'proj-sub', p.sub));
    const chips = projEl('div', 'proj-chips');
    p.chips.forEach(c => chips.appendChild(projEl('span', 'chip', c)));
    card.appendChild(chips);
    card.appendChild(projActions(p.actions));
    return card;
  }

  function projKeyShield(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave browser shortcuts alone
    if (e.key === 'Escape') { e.preventDefault(); closeProjects(); return; }
    e.stopPropagation();
  }

  function closeProjects() {
    if (!api.projOverlayEl) return;
    document.removeEventListener('keydown', projKeyShield, true);
    api.projOverlayEl.remove();
    api.projOverlayEl = null;
    projBoxEl = null;
    cmd.focus();
  }

  function openProjects(view) {
    if (!api.projOverlayEl) {
      api.projOverlayEl = projEl('div', 'proj-ov');
      api.projOverlayEl.addEventListener('click', e => { if (e.target === api.projOverlayEl) closeProjects(); });
      projBoxEl = projEl('div', 'proj-box');
      projBoxEl.setAttribute('role', 'dialog');
      projBoxEl.setAttribute('aria-modal', 'true');
      projBoxEl.setAttribute('aria-label', 'Projects');
      projBoxEl.tabIndex = -1;
      api.projOverlayEl.appendChild(projBoxEl);
      document.body.appendChild(api.projOverlayEl);
      document.addEventListener('keydown', projKeyShield, true);
    }
    renderProjView(view);
    projBoxEl.focus();
  }

  function renderProjView(view) {
    projBoxEl.innerHTML = '';
    const head = projEl('div', 'proj-head');
    if (view === 'index') {
      head.appendChild(projEl('div', 'proj-head-t', 'Projects  <span class="dim">— all shipped, all live</span>'));
    } else {
      const back = projEl('button', 'proj-back', '← all projects');
      back.type = 'button';
      back.addEventListener('click', () => renderProjView('index'));
      head.appendChild(back);
    }
    const x = projEl('button', 'proj-close', '✕');
    x.type = 'button';
    x.setAttribute('aria-label', 'Close projects');
    x.addEventListener('click', closeProjects);
    head.appendChild(x);
    projBoxEl.appendChild(head);
    if (view === 'calc') renderProjCalc();
    else if (view === 'site') renderProjSite();
    else renderProjIndex();
    projBoxEl.scrollTop = 0;
  }

  function renderProjIndex() {
    projBoxEl.appendChild(projCard({
      shot: 'assets/proj_calc.jpg',
      shotAlt: 'The Derivative Calculator web app: equation input with a full math button pad',
      title: 'Derivative Calculator  <span class="dim">— full-stack symbolic math engine</span>',
      sub: 'Parses arbitrary expressions into an AST and computes exact symbolic derivatives ' +
           '— power, product, quotient, and chain rules through trig, hyperbolic, and log ' +
           'functions — then evaluates numerically and graphs f(x) beside its nth-order ' +
           'derivatives. Angular front end, Spring Boot API, deployed on AWS behind CloudFront.',
      chips: ['Angular 21', 'TypeScript', 'Spring Boot 4', 'Java 25', 'MySQL', 'Docker', 'AWS', 'GitHub Actions', 'CodeQL'],
      actions: [
        { label: 'Case Study', svg: PROJ_DIAG_SVG, run: () => renderProjView('calc') },
        { label: 'Live App', svg: PROJ_LINK_SVG, href: 'https://deb53kr4s9gkh.cloudfront.net/calculator', egg: 'mathlete' },
        { label: 'Frontend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver_Frontend' },
        { label: 'Backend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver' },
      ],
    }));
    projBoxEl.appendChild(projCard({
      shot: 'assets/proj_site.jpg',
      shotAlt: 'This terminal running neofetch: green phosphor text, connect cards, CRT scanlines',
      title: 'This Terminal  <span class="dim">— you are inside the project right now</span>',
      sub: 'A zero-framework, zero-build web terminal: eight lazy-loaded feature chunks, a ' +
           'live-LLM HAL 9000 you talk your way past, a horde-survival brawler with ' +
           'deterministic WebRTC lockstep netplay and watchable replays, a CSS-3D room, and ' +
           'a phone line where HAL really calls you — behind an AWS backend that keeps every ' +
           'secret and game state server-side.',
      chips: ['Vanilla JS', 'CSS 3D', 'WebRTC', 'Service Worker', 'AWS Lambda', 'DynamoDB', 'Claude API', 'ElevenLabs', 'Twilio'],
      actions: [
        { label: 'Tour & Architecture', svg: PROJ_DIAG_SVG, run: () => renderProjView('site') },
        { label: 'Source Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/i-laird.github.io' },
      ],
    }));
    projBoxEl.appendChild(projEl('div', 'proj-foot', 'no roadmaps, no “coming soon” — everything here is deployed and clickable.'));
  }

  function renderProjCalc() {
    const b = projBoxEl;
    b.appendChild(projEl('div', 'proj-title', 'Derivative Calculator  <span class="dim">— full-stack symbolic math engine</span>'));
    b.appendChild(projEl('p', 'proj-p',
      'Computes exact symbolic derivatives of arbitrary mathematical expressions — power, ' +
      'product, quotient, and chain rules through trig, inverse-trig, hyperbolic, and ' +
      'logarithmic functions — then evaluates them numerically and graphs f(x) alongside ' +
      'its nth-order derivatives.'));

    b.appendChild(projEl('div', 'proj-sec', 'Tech Stack'));
    [
      ['Frontend', ['Angular 21', 'TypeScript', 'Angular Material', 'Chart.js', 'mathjs', 'RxJS']],
      ['Backend', ['Spring Boot 4', 'Java 25', 'Spring Security', 'JWT', 'Lombok', 'Maven']],
      ['Database', ['MySQL', 'Spring Data JPA', 'Hibernate', 'BCrypt']],
      ['DevOps', ['Docker', 'ECR', 'GitHub Actions', 'CodeQL', 'Qodana']],
    ].forEach(([label, items]) => {
      const row = projEl('div', 'proj-stack');
      row.appendChild(projEl('div', 'proj-stack-l', label));
      const chips = projEl('div', 'proj-chips');
      items.forEach(c => chips.appendChild(projEl('span', 'chip', c)));
      row.appendChild(chips);
      b.appendChild(row);
    });

    b.appendChild(projEl('div', 'proj-sec', 'Algorithm  <span class="dim">— symbolic differentiation via abstract syntax tree</span>'));
    [
      ['Tokenize', 'O(n)', 'Shunting Yard converts the infix expression to postfix — resolving implicit multiplication (3x → 3 * x), unary operators, and precedence.'],
      ['Parse', 'O(n)', 'Stack-based postfix evaluation assembles the AST: operators pop their operands into parent nodes, functions wrap their argument subtrees.'],
      ['Differentiate', 'O(d)', 'Recursively applies the correct calculus rule per node — power, product, quotient, and chain, through trig, inverse-trig, hyperbolic, and log.'],
      ['Evaluate', 'O(d)', 'Numeric substitution at the requested x-values.'],
      ['Visualize', 'O(1)', 'Chart.js plots 801 sample points per derivative curve.'],
    ].forEach(([name, cx, desc], i) => {
      const st = projEl('div', 'proj-step');
      st.appendChild(projEl('span', 'proj-step-n', String(i + 1)));
      st.appendChild(projEl('span', '',
        `<span class="blue">${name}</span>  <span class="dim">${cx}</span><div class="proj-step-d">${desc}</div>`));
      b.appendChild(st);
    });

    b.appendChild(projEl('div', 'proj-sec', 'AWS Architecture  <span class="dim">— production, cost-optimized to &lt;$10/mo</span>'));
    b.appendChild(archDiagram(CALC_ARCH_SPEC));

    b.appendChild(projActions([
      { label: 'Live App', svg: PROJ_LINK_SVG, href: 'https://deb53kr4s9gkh.cloudfront.net/calculator', egg: 'mathlete' },
      { label: 'Frontend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver_Frontend' },
      { label: 'Backend Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/Derivation_Solver' },
    ]));
  }

  function renderProjSite() {
    const b = projBoxEl;
    b.appendChild(projEl('div', 'proj-title', 'This Terminal  <span class="dim">— you are inside the project right now</span>'));
    b.appendChild(projEl('p', 'proj-p',
      'A terminal-style portfolio with no framework, no bundler, and no build step — ' +
      'hand-written HTML, CSS, and JavaScript served straight off GitHub Pages, engineered ' +
      'like a product: tested in CI, accessible, and instrumented with a real AWS backend ' +
      'for its AI features.'));

    b.appendChild(projEl('div', 'proj-sec', 'Architecture'));
    b.appendChild(archDiagram(SITE_ARCH_SPEC));

    b.appendChild(projEl('div', 'proj-sec',
      'Protecting a public LLM endpoint  <span class="dim">— anyone on the internet can talk to HAL; these keep that safe</span>'));
    [
      ['Bot gating before anything exists',
       'An invisible browser challenge must pass before a session is even minted; every turn then rides a short-lived, signed session token. No token, no model call.'],
      ['Server-authoritative everything',
       'Game state, meters, and conversation history live server-side with short TTLs — the browser is only a renderer, so nothing about the game can be forged from the console. Secrets and API keys never ship to the client.'],
      ['Prompt-injection containment',
       'Layered prompt construction keeps hidden game state out of anything the player can reach, and a server-side judge validates every model reply before it’s spoken — out-of-character or malformed output is rejected, not displayed.'],
      ['Hard budgets on every paid dependency',
       'Model, voice synthesis, telephony, and lookup spend all sit behind independent daily caps keyed to salted one-way hashes (never raw IPs or phone numbers) — checked before the spend, and fail-closed: if a limit store is unreachable, the answer is no.'],
      ['Abuse-resistant telephony',
       'Outbound calls require possession-proof SMS verification against an allowlist, webhooks are signature-validated, and a permanent STOP list outranks everything — designed so third-party targeting is structurally impossible, not merely rate-limited.'],
    ].forEach(([t, d]) => {
      const h = projEl('div', 'proj-hl');
      h.appendChild(projEl('div', 'proj-hl-t', t));
      h.appendChild(projEl('div', 'proj-hl-d', d));
      b.appendChild(h);
    });

    b.appendChild(projEl('div', 'proj-sec', 'Highlights'));
    [
      ['Two HAL 9000s', 'A scripted HAL voiced by ~135 pregenerated ElevenLabs clips synced to a typewriter — and an experimental, opt-in HAL run by a live language model that you have to talk your way past to escape the terminal.'],
      [`${ACHIEVEMENTS.length} easter eggs`, 'Discoveries unlock achievements that persist in localStorage and render to a shareable card — a few are deep cuts, with a finale for the completionists.'],
      ['Five games + a hidden brawler', 'Racecar, Snake, Pong, 2048, and Stockfish-powered chess across three difficulty tiers. Buried in the XP desktop: Stick Fighter 2000, a horde-survival brawler with couch and online co-op, a boss gauntlet, daily seeded runs, and an online leaderboard with watchable replays.'],
      ['A room, and a phone call', 'Type `room` and the camera pulls back from the terminal into a walkable CSS-3D bedroom. Stay long enough and a phone rings down the hallway — answer it, and HAL can end up calling your real telephone through an SMS-verified, consent-gated Twilio pipeline.'],
    ].forEach(([t, d]) => {
      const h = projEl('div', 'proj-hl');
      h.appendChild(projEl('div', 'proj-hl-t', t));
      h.appendChild(projEl('div', 'proj-hl-d', d));
      b.appendChild(h);
    });

    b.appendChild(projActions([
      { label: 'Source Repo', svg: PROJ_GH_SVG, href: 'https://github.com/i-laird/i-laird.github.io' },
    ]));
  }

  return { open: openProjects };
}

// Survives the build's IIFE wrap — app.js looks this up by name.
window.initProjects = initProjects;
