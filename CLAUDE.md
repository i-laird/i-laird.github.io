# Ian Laird Portfolio — CLAUDE.md

## Project overview
Single-page terminal-style portfolio site hosted on GitHub Pages. No build system, no framework, no dependencies — everything lives in `index.html`.

## Deployment
Push to `main` branch → auto-deploys via GitHub Pages. The `.nojekyll` file disables Jekyll processing.

## Architecture
`index.html` contains all HTML, CSS, and JS in one file. Key sections:

- **CSS variables** (`:root`) — color scheme. HAL mode overwrites these at runtime via `document.documentElement.style.setProperty`.
- **`COMMANDS` object** — each key is a command name, value is a function. Multi-word commands use quoted string keys e.g. `'power off'`.
- **Key handler** — intercepts Enter, looks up `COMMANDS[token]`. Special cases handled before the lookup: `halMode` block, `cat`/`cat <file>` prefix check.
- **`halMode` flag** — when true, the key handler refuses all commands except `help`, `clear`, `daisy`, and `power off`.

## Commands
Listed in `help`: `about`, `contact`, `projects`, `ian`, `games`, `clear`, `gui`, `power off`
Hidden (not in help): `ls`, `sudo`, `cat <file>`, `daisy` (HAL mode only)
Forbidden: `agi` (activates HAL 9000 mode — red scheme, refuses all commands)

## Catatable files
Defined in `handleCat()`: `todo_finish_someday.txt`, `.bash_history`, `.secrets`
Edge cases handled: `resume.pdf` (binary), `projects/`, `definitely_not_skynet/` (directories)

## HAL mode escape
Typing `daisy` in HAL mode plays the Daisy Bell song via typewriter effect, then calls `restoreNormal()` to reset colors, title bar, and prompt.
