# Contributing

This is a personal portfolio site, but the codebase aims to stay tidy and
reviewable. A few ground rules keep it that way.

## Before you push

Run the same checks CI runs:

```bash
npm run check   # ESLint + html-validate + Prettier --check + node --test
```

CI (`.github/workflows/ci.yml`) runs those steps on every PR.

## The one hard rule: classic scripts stay classic

`app.js` and the eight lazy chunks (`stickfighter.js`, `games.js`, `sans.js`,
`chess.js`, `halllm.js`, `desktop.js`, `achui.js`, `room.js`) are
**not** ES modules and are **not** wrapped in an IIFE. This is on purpose —
inline `onclick` handlers in `index.html` depend on top-level declarations
being globals, and each lazily-loaded chunk exposes one global entry that
app.js calls (all other dependencies cross the boundary through an explicit
`api` bridge). Do not convert them to modules, add `import` / `export`, or wrap
them in an IIFE. See `CLAUDE.md` for the full rationale.

## Where new code goes

- **Pure logic** (no DOM, no shared globals) → add it to `lib/` and write a
  test in `test/`. `lib/` files are dual-mode: top-level functions for the
  browser, plus a `module.exports` guard so Node can `require()` them. Wire new
  `lib/` files into `index.html` as a classic `<script>` _before_ `app.js`.
- **DOM / terminal behavior** → `app.js`.
- **Stick Fighter 2000** → the `stickfighter/` part files (`stickfighter.js`
  is a generated artifact — edit the parts, run `npm run assemble`, commit
  both; see `stickfighter/CLAUDE.md`).
- **The shell games** (racecar/snake/pong/2048) → `games.js`; **sans mode** →
  `sans.js`; **chess** → `chess.js`; **the experimental LLM HAL** →
  `halllm.js`; **the XP desktop** → `desktop.js`; **the achievements
  overlay** → `achui.js`; **the room** → `room.js`. All are lazy chunks:
  reference nothing from `app.js` by free global name — take dependencies
  through the matching `api` bridge (`gamesBridge()` / `sansBridge()` /
  `chessBridge()` / `halLLMBridge()` / `desktopBridge()` / `achBridge()` /
  `roomBridge()` in `app.js`; the per-chunk isolation tests enforce this).

## Style

- ESLint + Prettier are configured. The large runtime files (`app.js` + the
  lazy chunks) are exempt from Prettier and from strict linting by design (see
  `.prettierignore` and `eslint.config.js`); everything else is formatted and
  linted.
- `index.html` / `404.html` / `privacy.html` / `terms.html` are checked with
  `html-validate` (`npm run
lint:html`). The `no-inline-style` rule is disabled in `.htmlvalidate.json`
  on purpose — the screen-reader block is styled inline so a stale cached
  `style.css` can't reveal it (see `CLAUDE.md`).
- Match the surrounding code's naming and comment density.

## Tests

Tests use the built-in Node test runner (`node --test`) — no test framework
dependency. Prefer known-answer tests for the puzzle/codec helpers so a change
to a cipher or hash fails loudly.
