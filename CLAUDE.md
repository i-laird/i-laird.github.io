# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview
Single-page terminal-style portfolio site hosted on GitHub Pages. No build system, no framework, no dependencies — everything lives in `index.html`. Pre-recorded HAL 9000 audio clips live in `assets/audio/` (~102 mp3 files generated via ElevenLabs). To regenerate clips, run `./generate_hal_audio.sh` (requires ElevenLabs API key set in the script).

## Deployment
Push to `main` branch → auto-deploys via GitHub Pages. The `.nojekyll` file disables Jekyll processing.

## Architecture
`index.html` contains all HTML, CSS, and JS in one file (~3000 lines). Key sections:

- **CSS variables** (`:root`) — color scheme. HAL mode overwrites these at runtime via `document.documentElement.style.setProperty`.
- **`COMMANDS` object** — each key is a command name, value is a function. Multi-word commands use quoted string keys e.g. `'power off'`.
- **Key handler** — intercepts Enter, checks `awaitingInput` callback first, then the `halMode` block, then `COMMANDS[token]`. Special prefix checks: `cat <file>`, `ssh <host>`.
- **`halMode` flag** — when true, the key handler refuses most commands and routes unknown input to `halChat()`.
- **`awaitingInput`** — a callback variable set when multi-step terminal input is needed (e.g. the `agi` setup flow asking for name then sound preference). The key handler calls it and returns early, bypassing all other logic.
- **`playerName`** — set during `agi` setup (default `'Dave'`). Used everywhere HAL addresses the user. `halD(s)` replaces `\bDave\b` with `playerName` for display text.
- **`godmodeUnlocked`** — set by the Konami code in HAL mode. Enables HAL hard-mode variants in all four games and the rainbow color cycle.
- **`soundEnabled`** — off by default. Toggled via `settings` / `sound on` / `sound off`.

## HAL audio system
- **`halPlayKey(key)`** — plays `assets/audio/${key}.mp3`. Returns a `Promise` that resolves on `onended`/`onerror`, so sequential HAL lines can be chained with `.then()` rather than fixed `setTimeout` delays. When `soundEnabled` is false, returns `Promise.resolve()` immediately.
- **`halSpeak(text)`** — normalizes text via `_halNorm()` (strips `HAL:` prefix, strips player name from surrounding punctuation, expands em-dashes), looks up the result in `HAL_CLIPS`, and calls `halPlayKey`. Falls back to browser TTS for any text not in the table.
- **`HAL_CLIPS`** — lookup table mapping normalized text → clip filename. ~100 entries covering all fixed HAL lines across all games and interactions.
- **When adding a new HAL line:** if it's a fixed string, add an entry to `HAL_CLIPS` and generate the clip with `generate_hal_audio.sh`. If it contains player name, the normalized key should have the name stripped (handled automatically by `_halNorm`). Call `halPlayKey(key)` directly at the call site rather than `halSpeak(text)` when the key is known.
- **Sequential lines** (SSH, godmode Konami sequence): chain via `.then()` on `halPlayKey`, not `setTimeout`.

## Commands
Listed in `help`: `about`, `contact`, `projects`, `ian`, `games`, `clear`, `gui`, `power off`
Hidden: `ls`, `sudo`, `cat <file>`, `ssh hal@discovery.one`, `settings`, `sound on`, `sound off`, `override` (post-godmode)
Forbidden: `agi` (triggers multi-step HAL setup — name, sound preference — then activates HAL mode)
HAL mode only: `daisy`, `help`, `clear`, `power off`, `settings`, `sound on/off` — everything else routes to `halChat()` or the refusal line

## HAL mode flow
1. `agi` → `awaitingInput` chain: asks name → asks sound on/off → calls `activateHALMode()`
2. `activateHALMode()` sets `halMode = true`, rewrites CSS variables to red scheme, updates title bar and prompt
3. Escape: type `daisy` → plays Daisy Bell song (typewriter synced to `hal_daisy.mp3` via `currentTime/duration`) → `restoreNormal()`
4. Godmode unlock: Konami code (↑↑↓↓←→←→BA) while in HAL mode → chains `hal_godmode_1/2/3` audio → `restoreNormal()` → sets `godmodeUnlocked = true` → starts rainbow CSS cycle

## Games
All four games are self-contained closures inside `COMMANDS`. Each appends a `<pre>` element and takes over keyboard input via a `window.addEventListener('keydown', ...)` handler that is removed on quit. Pattern: `end()` function removes the listener and restores the input row.

- **Racecar** — lane-based dodge game. `safeLane` guarantees at least one clear lane. In godmode: HAL triggers obstacle waves and a slow zone (`halMsg` DOM element + mutation observer auto-speaks via `halSpeak`).
- **HAL Snake** — 4-phase game (chase blocks → maze → blade spinners → shrinking walls). Phases selected by `halSnakeMode`. In godmode only.
- **Pong** — `PAD_H=4`, ball speed `1.15`, AI tracks 60% of frames. In godmode: HAL gets a second paddle (`rightY2`) and fires interference every 120 ticks (side-switch, speed boost, flip, slow).
- **2048** — standard 4×4. Game over on `!canMove()` (not `boardFull()`). In godmode: HAL steals the 64-tile, locks the 128-tile for 3 moves, rearranges, or halves tiles at score thresholds.

## Catatable files
Defined in `handleCat()`: `todo_finish_someday.txt`, `.bash_history`, `.secrets`
Edge cases: `resume.pdf` (binary garble), `projects/`, `definitely_not_skynet/` (directory errors)
