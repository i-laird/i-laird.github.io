# ianclaird.com — terminal portfolio

[![CI](https://github.com/i-laird/i-laird.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/i-laird/i-laird.github.io/actions/workflows/ci.yml)

A single-page, terminal-style portfolio site — games, easter eggs, and one
paranoid AI. Type `help`. Live at **[ianclaird.com](https://ianclaird.com)**.

No framework, no bundler, no runtime dependencies. The site is hand-written
HTML/CSS/JS served straight off GitHub Pages. The tooling in this repo (tests,
linting, CI) exists to keep that hand-written code honest, not to build it.

Writing a site by hand means giving up everything a framework normally does for
you — and the interesting part is what you have to build to get it back. Most of
what follows is that.

## The parts worth reading

If you only look at one thing, make it one of these. Each solves a problem that
a framework would otherwise have hidden.

**A strict CSP that cannot rot.** `script-src` carries no `'unsafe-inline'` and
no `'unsafe-eval'`. The two inline `<script>` blocks the page genuinely needs
are allowed by SHA-256 hash instead — which means editing either block silently
breaks it, with no error and no visual symptom until someone notices the CRT
boot animation stopped running. So `test/csp.test.js` recomputes both hashes
from the file on every run, fails on drift, and prints the correct hash to paste
in. It also rejects any inline `on*` handler that reappears in `index.html`
(one would force `'unsafe-inline'` back into the policy) and asserts
`script-src` stays strict. GitHub Pages cannot set response headers, so the
policy ships as a `<meta>` tag; the header-only directives that costs us are
handled separately — see the clickjacking note below.

**Pinning third-party code, and the failure mode nobody plans for.** Chess is
the only feature that executes code this repo did not write: `chess.js` and
Stockfish, from public CDNs. Both are SHA-384 pinned — `chess.js` through
`<script integrity>`, and the Stockfish bytes through an explicit
`crypto.subtle.digest` check before they reach a blob `Worker`, because bytes
you fetch and blob yourself cannot be covered by SRI.

The part worth stealing is what pinning does to your failure mode: it converts a
silent **compromise** into a silent **breakage**. If a CDN ever serves different
bytes, the browser refuses the file and chess dies for every visitor — while the
URL stays reachable, 200, and roughly the right size. No uptime probe can see
that. So `.github/workflows/cdn-pins.yml` checks the property the browser
actually checks, daily, reading the pins _out of_ `chess.js` rather than
restating them so the monitor cannot drift from what ships. It opens an issue on
failure and closes it on recovery.

**Proving a game is deterministic.** Stick Fighter has online lockstep netplay
and saved replays, both of which are silently wrong if the simulation is not
bit-identical across machines. Determinism is asserted, not assumed:

- A recording canvas folds every draw call into a rolling hash, so a run's
  entire visual output is one comparable value. Same seed → identical stream;
  different seed → divergence (which proves the stream reflects RNG-driven
  gameplay rather than a fixed animation).
- 60 Hz and 120 Hz frame pumps over the same wall-clock span must produce the
  **identical tick stream** — the fixed-timestep driver's whole reason to exist.
- `reduceMotion` must not change how many `rnd()` draws the simulation makes, so
  an accessibility setting cannot desync a multiplayer run.
- `test/stickfighter-netplay.test.js` boots **two complete instances** of the
  real page, stubs WebRTC with a synchronous loopback, and runs 1,500 frames of
  divergent-input lockstep. The game's own 60-tick checksum tripwire kicks
  desynced peers back to the intro, so "both are still in the run" _is_ the
  two-machine determinism proof. A four-player variant does the same with four.

**Chunk isolation enforced by the linter.** The site lazy-loads eight feature
chunks, each reaching the core only through an explicit `api` bridge. That
boundary is worth exactly nothing if it is only a convention, so each chunk gets
a test that lints it **alone**, with `no-undef` on and browser globals only. Any
reference to a core global by free name fails CI and has to be routed through
the bridge. This is what lets each chunk be bundled and obfuscated independently.

**Supply chain.** Every GitHub Action is pinned to a full commit SHA, not a
mutable tag. The deploy workflow signs a build-provenance attestation over the
JS it publishes — necessary because the served bundle is deliberately obfuscated,
so "diff it against the repo" is not available as a check:

```bash
gh attestation verify app.js --repo i-laird/i-laird.github.io
```

`npm audit` gates both CI and deploy. That matters more than "dev dependencies"
suggests: `javascript-obfuscator` _writes_ the bundle every visitor executes, so
its dependency tree is production surface.

**A clickjacking gate on the one thing that matters.** A `<meta>` CSP cannot
express `frame-ancestors`, so this origin is embeddable. Harmless for a terminal
toy — not harmless for the `room` easter egg's phone flow, which collects a real
telephone number behind a consent tickbox and can cause a real SMS and a real
outbound call. That flow refuses to run while framed and falls back to a
decorative answering machine. Deliberately _not_ a whole-page frame-buster: the
fix belongs on the sensitive interaction, not on the site.

**Deploy-time proof that the deploy actually happened.** The build publishes an
obfuscated `dist/`, but that only takes effect once GitHub Pages is switched to
_Source: GitHub Actions_. While it reads _Deploy from a branch_, Pages serves the
clean source — every easter-egg secret with it — and the workflow runs green the
entire time. So the last deploy step fetches the **live custom domain** and fails
if plaintext source markers are present.

Security policy: [`SECURITY.md`](SECURITY.md), published as RFC 9116 at
[`/.well-known/security.txt`](https://ianclaird.com/.well-known/security.txt).

## Quick start

```bash
npm install      # dev tooling only — the site itself ships zero dependencies
npm run serve    # serve at http://localhost:8000
npm run check    # lint + format check + tests (what CI runs)
```

Or skip Node entirely and just open the site:

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

## Project layout

| Path              | What it is                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `index.html`      | Bare markup (~140 lines); all behavior is loaded scripts.                                                          |
| `style.css`       | The whole stylesheet. Theme colors are CSS variables on `:root`.                                                   |
| `app.js`          | The terminal: commands, HAL mode, dispatch, the projects overlay.                                                  |
| `stickfighter.js` | "Stick Fighter 2000," lazy-loaded on first launch (~550 KB); generated from `stickfighter/` by `npm run assemble`. |
| `stickfighter/`   | The game's source-of-truth part files (state, rendering, netplay, bosses, …).                                      |
| `games.js`        | The four shell games (racecar/snake/pong/2048), lazy-loaded.                                                       |
| `sans.js`         | The sans easter egg (command set + battle), lazy-loaded.                                                           |
| `chess.js`        | Chess (Stockfish-backed), lazy-loaded.                                                                             |
| `halllm.js`       | The experimental LLM HAL ("escape the terminal"), lazy-loaded.                                                     |
| `desktop.js`      | The `gui` XP desktop (also hosts the Stick Fighter loader), lazy-loaded.                                           |
| `achui.js`        | The achievements overlay + share card, lazy-loaded.                                                                |
| `room.js`         | The `room` CSS-3D bedroom (walkable, with a live HAL phone line), lazy-loaded.                                     |
| `sw.js`           | Service worker: repeat-visit caching (GH Pages caps max-age).                                                      |
| `lib/`            | Pure, unit-tested helpers (codec, timing alignment, text, RNG, shell parsers).                                     |
| `test/`           | Node test-runner suites: `lib/` units, boot smoke, chunk isolation, Stick Fighter determinism/netplay, compliance. |
| `assets/`         | Audio, fonts, images, and the Open Graph card.                                                                     |

### A note on architecture

`app.js` and the eight lazy chunks (`stickfighter.js` / `games.js` / `sans.js` /
`chess.js` / `halllm.js` / `desktop.js` / `achui.js` / `room.js`) are
**classic scripts** — not ES modules, not wrapped in an IIFE. This is deliberate:
each lazily-loaded chunk hands `app.js` a single global entry point, and
everything else it needs arrives through an explicit `api` bridge, so the chunks
can be bundled and obfuscated independently.

`index.html` carries **no** inline `on*` handlers — an inline handler is inline
script and would force `'unsafe-inline'` back into the CSP, so the few functions
the page chrome needs are attached in `wireChrome()` and re-exported onto
`window` explicitly. Those explicit exports are also what survives the
obfuscated build's IIFE wrap, which renames every other top-level name.

The `lib/` files preserve that contract. Each is a classic `<script>` whose
top-level functions become browser globals (loaded before `app.js`), **and**
carries a `module.exports` guard so Node can `require()` it for testing. That is
how the project gets a real test suite without taking on a build step.

### About `CLAUDE.md`

[`CLAUDE.md`](CLAUDE.md) is the long-form architecture reference — every
invariant, every "this looks wrong but here is why it is not," every trap that
cost an afternoon. It is written to brief a coding agent, which is also exactly
the format that briefs a human arriving cold, so it is the file to open when you
want the full tour rather than the highlights above. It is long because the
constraints are real, not because the codebase is unclear.

## Development

```bash
npm test                  # run the unit tests (node --test)
npm run test:coverage     # tests with a coverage report
npm run lint              # ESLint
npm run lint:fix          # ESLint with autofix
npm run lint:html         # validate index.html / 404.html (html-validate)
npm run format            # Prettier write
npm run format:check      # Prettier check (CI gate)
npm run audit             # npm audit, high and above (CI + deploy gate)
npm run gen-security-txt  # refresh the RFC 9116 Expires date
```

The large runtime files (`app.js` + the lazy chunks) are exempt from **Prettier**
— they are hand-formatted and rely on load-bearing template-literal indentation —
but they are **not** exempt from linting. They run ESLint's full recommended
ruleset plus `eqeqeq`, `no-var` and `no-throw-literal`. Exactly four rules are
switched off, and `eslint.config.js` records why each one has to be: `no-undef`
and `no-unused-vars` because these files are one shared global scope by design
(the chunk boundaries are enforced far more precisely by the per-chunk isolation
tests), `no-empty` because empty catch blocks are the feature-detection idiom
throughout, and `no-fallthrough` for the game state machines.

`prefer-const` is the interesting exclusion. The `stickfighter/` parts are
fragments of one function body assembled at build time, so a variable declared
in one part and reassigned in another looks never-reassigned when the part is
linted alone — and `--fix` would happily produce a `const` that throws at
runtime. A rule that is confidently wrong is worse than a rule that is off.

New logic that _can_ be pure should still live in `lib/` with tests.

## Deployment

Push to `main` → GitHub Pages auto-deploys. `.nojekyll` disables Jekyll
processing (it is also what lets `.well-known/` through); `CNAME` points the
custom domain.

The deploy workflow runs the full check, builds the obfuscated `dist/`, verifies
that build boots in jsdom, signs a provenance attestation over the published JS,
deploys, and then fetches the live domain to confirm what is actually being
served. Every action in it is pinned to a commit SHA; Dependabot proposes bumps
as PRs rather than tags moving underneath the pipeline.

## Security

Reporting policy: [`SECURITY.md`](SECURITY.md) — also published as RFC 9116 at
[`/.well-known/security.txt`](https://ianclaird.com/.well-known/security.txt),
whose `Expires` date is regenerated by `npm run gen-security-txt` and gated by
`test/security-txt.test.js` (an expired security.txt advertises a channel nobody
has promised to read, which is worse than not having one).

## License

There is deliberately no license on this repository at the moment. That is a
considered choice rather than an oversight, so please read it as "all rights
reserved" for now — the code is here to be read, not to be reused. If you want
to use some part of it, ask.
