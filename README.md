# Clicker Heroes Companion

> Credits: everything this app owes to the community is listed in **[CREDITS.md](CREDITS.md)**. Overlay

Reads your Clicker Heroes save file, computes the same numbers the game does,
and tells you what to do next. It never writes to the save and never touches
the running game.

## Run

Three ways, same thing:

- **Autostart** — `~/.config/autostart/ch-overlay.desktop` starts it at login.
- **App menu** — "Clicker Heroes Companion" (`~/.local/share/applications`).
- **Terminal** — `clicker-heroes-overlay/repo/bin/ch-overlay`

`bin/ch-overlay` starts the local server (127.0.0.1:8787) if it is not up, then
opens the frameless always-on-top window. Bare `npm start` serves the same UI
for any browser.

Keys: `Ctrl+Shift+H` hide/show · `Ctrl+Shift+R` reload · `Ctrl+Shift+Q` quit.
Drag the panel by its header. `CH_OVERLAY_X` / `CH_OVERLAY_Y` / `CH_OVERLAY_W` /
`CH_OVERLAY_H` override geometry.

## Features

- Live panel: zone, DPS, gold, souls, boss timer, instakill zone.
- Plan as a timeline (NOW / zone N / after ascending) with ETAs from your own zones/hour.
- Ancients: rank, current, suggested, diff — with `skip` for build-irrelevant ones.
- Outsiders: same columns, ranked, with a note when you have no unspent Ancient Souls.
- Heroes: level, next-level gold, DPS, gilds.
- Mercs: rarity, level, days until death; quest order and revive windows from the
  published analyses (qubit64, dukC2).
- Gilding: chart row for your gold exponent, with the "level the hero first" guard.
- Settings: build, theme (dark/light), font size, solver weights; force-reload the save.
- Standalone: autostart, app-menu entry, keyboard shortcuts, real minimise.

## Install (end users)

See **[docs/INSTALL.md](docs/INSTALL.md)** — AppImage for Linux, `.exe` for Windows,
`.dmg` for macOS. No Node, no terminal.

## Install & run (development)

```sh
git clone <repo> clicker-heroes-live
cd clicker-heroes-live
npm install
npm run app        # launches the Electron window (server starts inside it)
```

Requires Node 20+ and a Clicker Heroes install. `npm start` runs the server alone at
`http://127.0.0.1:8787` if you prefer a browser.

## Download

Take the installer for your platform from the
**[latest release](https://github.com/GeeNuTz/clicker-heroes-companion/releases/latest)**:

| Platform | File |
|---|---|
| Linux | `Clicker.Heroes.Companion-<version>.AppImage` |
| Windows | `Clicker.Heroes.Companion.Setup.<version>.exe` |
| macOS | `Clicker.Heroes.Companion-<version>-arm64.dmg` |

Installed builds update themselves: **Settings → Check for updates → Install update**.
The `latest*.yml` manifests in each release are what the updater reads.

The builds are unsigned, so Windows SmartScreen and macOS Gatekeeper each warn once
("More Info → Run anyway" / right-click → Open).

## Build from source

```sh
npm ci
npm run dist:linux    # -> dist/*.AppImage
npm run dist:win      # -> dist/*.exe   (Windows, or CI)
npm run dist:mac      # -> dist/*.dmg   (macOS, or CI)
```

Windows and macOS artifacts are produced by CI on each tag — those targets cannot be
cross-built reliably from Linux. `electron-builder` is already a devDependency.

Icons: `build/icon.png` (512×512). electron-builder derives the platform formats from it.

## Standalone

Runs on its own — no terminal and no Node once installed:

- **Autostart:** `~/.config/autostart/ch-overlay.desktop`
- **App menu:** "Clicker Heroes Companion"
- **Terminal:** `repo/bin/ch-overlay` — dev launch, always current code
- **Update the working copy:** `repo/bin/ch-update` (git pull + restart)

Keys: `Ctrl+Shift+M` minimise · `Ctrl+Shift+H` hide/show · `Ctrl+Shift+R` reload ·
`Ctrl+Shift+Q` quit. The `—` in the title bar collapses the panel to a title strip.

Back to the live save after loading a pasted one: **Settings → Back to live save**.

## Where the numbers come from

**The save file, not the screen.** No OCR, no memory reading. The game writes
`playerSaveData.txt` as you play (typically every few seconds); the panel polls
its mtime every 1.5s and re-decodes only when it changes. The footer shows
`save Ns old` — if that climbs past ~2 minutes the game is paused or not
writing, and the panel says so instead of pretending.

The window is Electron with `alwaysOnTop` at screen-saver level; it stays above
normal windows. A game in true fullscreen can still cover it — run the game
windowed/borderless, or add a KWin rule for the `Clicker Heroes Companion` window.

## What it reads

`~/.local/share/Steam/steamapps/compatdata/363970/pfx/drive_c/users/steamuser/AppData/LocalLow/Playsaurus/Clicker Heroes/playerSaveData.txt`

Format: `<32-char marker><base64(raw deflate JSON)>`. Not encrypted.

## What it shows

- zone / best zone / DPS / gold / hero souls, boss kill time
- a timeline: NOW / zone N / right after ascending, each step with cost and ETA
- ancient table with next-level cost, hero and mercenary tables

## Math

Formulas ported from [dfederm/ClickerHeroesTracker](https://github.com/dfederm/ClickerHeroesTracker)
(`WebClient/src/models/*.ts`) — the same code the public tracker runs in your
browser — plus `GameData.json` from that repo for hero/ancient definitions.

Ancient suggestions are a greedy marginal-value allocator: each level is
priced by its exact soul cost and scored by the fractional improvement of the
stat it feeds, with a documented relevance factor for partial stats (chests,
primals, gilds). Weights live at the top of `src/advice.mjs`.
