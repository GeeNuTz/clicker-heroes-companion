# Changelog

## 0.6.0 — 2026-11-22
- Load a pasted save read-only (`/api/save/use`), and return to the live save with one click.
- Mercenaries: dead state read from `questResult` (was showing a countdown for dead mercs).
- Gild bonus from the in-game tooltip (+2% per Argaiv level); Heroes tab shows count and %.
- Plan ordered by when you act; merc advice moved to the Mercs tab.
- Relic bonuses mapped to the ancients that use them.
- Windows/macOS icon config, app icon, launcher WM_CLASS.

## 0.5.0 — 2026-11-22
- Renamed to **Clicker Heroes Companion**.
- Tabs: Gilds and Relics added; Ancients/Outsiders with ranks; Help tab.
- Gild bonus corrected from the in-game tooltip: +2% per Argaiv level (172% at 61).
- Relic bonuses mapped to the ancients that use them.
- Mercs: quest countdown, rarity names, humanised death timer, advice moved into the tab.
- Plan ordered by when you act; transcend labelled by its real condition.
- Breakpoint step separates TP tier from the zone where HP scaling starts.
- Save conversion: export PC/mobile, import, install with backup; the game must be
  closed first and the app offers to close it.
- Fresh-run handling (zone 1, 0 DPS) no longer says "ascend".
- Perf: ancient solver bounded to 250 ms (was 20 s and froze the server).
- Cross-platform save discovery (Steam/Proton, Windows, macOS, Waydroid) + custom path.
- Window: real zoom, pinned footer, floating level, real minimise via IPC.

## 0.4 — 2026-11-22
- Light theme, page zoom (font size) setting.
- Window buttons: reload, minimise (real `win.minimize()` via IPC), close.
- Help tab: what every panel shows, keys, data sources, changelog.
- Outsiders: rank column and an explicit note about unspent Ancient Souls.
- Footer text enlarged.

## 0.3 — 2026-11-22
- Ancient + outsider suggestions (current / suggested / diff) with buy rank.
- Gilding chart from clickerheroes.dev, keyed on gold exponent.
- Mercenary quest order re-derived from qubit64's optimisation (1.0934 rubies/day).
- Revive windows: qubit64 (narrow) and dukC2 (rarity table, HS vs ruby focus).
- `settings.json` + `/api/settings` + `/api/reload`.

## 0.2 — 2026-11-22
- Plan rewritten around McNiibot's rules (ascend 130 / boss failure, Siya+Lib pre-300,
  transcend at 300, 3-ascension cycle).
- Timeline view with ETAs; save-age footer; wider window.

## 0.1 — 2026-11-22
- Save decoder (`marker + base64 + raw deflate`), game maths ported from
  ClickerHeroesTracker, live state, minimal overlay.
