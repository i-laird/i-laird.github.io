# Contributing

This is a personal portfolio site, but the codebase aims to stay tidy and
reviewable. A few ground rules keep it that way.

## Before you push

Run the same checks CI runs:

```bash
npm run check   # ESLint + Prettier --check + node --test
```

CI (`.github/workflows/ci.yml`) gates `main` and every PR on those three steps.

## The one hard rule: classic scripts stay classic

`app.js` and `stickfighter.js` are **not** ES modules and are **not** wrapped in
an IIFE. They share a single global scope on purpose — inline `onclick`
handlers in `index.html` and the lazily-loaded game both depend on top-level
declarations being globals. Do not convert them to modules, add `import` /
`export`, or wrap them in an IIFE. See `CLAUDE.md` for the full rationale.

## Where new code goes

- **Pure logic** (no DOM, no shared globals) → add it to `lib/` and write a
  test in `test/`. `lib/` files are dual-mode: top-level functions for the
  browser, plus a `module.exports` guard so Node can `require()` them. Wire new
  `lib/` files into `index.html` as a classic `<script>` _before_ `app.js`.
- **DOM / terminal behavior** → `app.js`.
- **Stick Fighter 2000** → `stickfighter.js` (keep its 8-space indentation; it
  has load-bearing multi-line template literals).

## Style

- ESLint + Prettier are configured. The two large runtime files are exempt from
  Prettier and from strict linting by design (see `.prettierignore` and
  `eslint.config.js`); everything else is formatted and linted.
- `index.html` / `404.html` are checked with `html-validate` (`npm run
lint:html`). The `no-inline-style` rule is disabled in `.htmlvalidate.json`
  on purpose — the screen-reader block is styled inline so a stale cached
  `style.css` can't reveal it (see `CLAUDE.md`).
- Match the surrounding code's naming and comment density.

## Tests

Tests use the built-in Node test runner (`node --test`) — no test framework
dependency. Prefer known-answer tests for the puzzle/codec helpers so a change
to a cipher or hash fails loudly.
