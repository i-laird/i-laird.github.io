# ianclaird.com — terminal portfolio

[![CI](https://github.com/i-laird/i-laird.github.io/actions/workflows/ci.yml/badge.svg)](https://github.com/i-laird/i-laird.github.io/actions/workflows/ci.yml)

A single-page, terminal-style portfolio site — games, easter eggs, and one
paranoid AI. Type `help`. Live at **[ianclaird.com](https://ianclaird.com)**.

No framework, no bundler, no runtime dependencies. The site is hand-written
HTML/CSS/JS served straight off GitHub Pages. The tooling in this repo (tests,
linting, CI) exists to keep that hand-written code honest, not to build it.

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

| Path              | What it is                                                       |
| ----------------- | ---------------------------------------------------------------- |
| `index.html`      | Bare markup (~100 lines); all behavior is loaded scripts.        |
| `style.css`       | The whole stylesheet. Theme colors are CSS variables on `:root`. |
| `app.js`          | The terminal: commands, HAL mode, sans mode, the game shells.    |
| `stickfighter.js` | "Stick Fighter 2000," lazy-loaded on first launch (~280 KB).     |
| `lib/`            | Pure, unit-tested helpers (codec, timing alignment, text).       |
| `test/`           | Node test-runner suites for `lib/`.                              |
| `assets/`         | Audio, images, and the Open Graph card.                          |

### A note on architecture

`app.js` and `stickfighter.js` are **classic scripts that share one global
scope** — not ES modules, not wrapped in an IIFE. This is deliberate: inline
`onclick` handlers in `index.html` call top-level functions as globals, and the
lazily-loaded game reads `app.js`'s globals directly with no import wiring.

The `lib/` files preserve that contract. Each is a classic `<script>` whose
top-level functions become browser globals (loaded before `app.js`), **and**
carries a `module.exports` guard so Node can `require()` it for testing. That is
how the project gets a real test suite without taking on a build step.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture tour.

## Development

```bash
npm test              # run the unit tests (node --test)
npm run test:coverage # tests with a coverage report
npm run lint          # ESLint
npm run lint:fix      # ESLint with autofix
npm run lint:html     # validate index.html / 404.html (html-validate)
npm run format        # Prettier write
npm run format:check  # Prettier check (CI gate)
```

The two large runtime files are intentionally exempt from Prettier and from
strict linting (they are a single hand-formatted global scope; `stickfighter.js`
also relies on load-bearing template-literal indentation). New logic that _can_
be pure should live in `lib/` with tests — that is the part the linter and the
test runner guard.

## Deployment

Push to `main` → GitHub Pages auto-deploys. `.nojekyll` disables Jekyll
processing; `CNAME` points the custom domain.
