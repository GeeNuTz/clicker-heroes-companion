# Changelog

## 0.9.11 — 2026-11-28

### Fixed
- A stale relic-panel reference threw during render and aborted everything after it: the header kept its
  placeholder version and the Power Five body stayed empty. Rendering is now guarded and reports its own
  error in the warnings strip.

## 0.9.10 — 2026-11-28

### Fixed
- Header version is read from the top-level payload; it no longer shows a dash.

## 0.9.9 — 2026-11-28

### Added
- Ctrl+Shift+P toggles the Power Five panel, for overlays that cannot take mouse clicks.

## 0.9.8 — 2026-11-28

### Fixed
- Power Five toggle is delegated on the document, so it opens and closes repeatedly.

## 0.9.7 — 2026-11-28

### Added
- Relics ranked by the stated priority (primal chance, primal souls, cost, idle DPS, Kuma, idle gold) with a
  measured-gain list next to it.

## 0.9.6 — 2026-11-28

### Added
- Relics ordered by the wiki stage table and compared at level 45.

## 0.9.5 — 2026-11-28

### Changed
- Relic value comes from the game's own ancient formulas: a relic grants levels of an ancient, so the gain
  is ancientBonus(level + relicLevels) against ancientBonus(level).

## 0.9.4 — 2026-11-28

### Added
- Relic gains split into DPS, gold, souls and utility, each a relative percentage.

## 0.9.3 — 2026-11-28

### Added
- Relics tab marks the four worn slots, lists the pile, and suggests a loadout.

## 0.9.2 — 2026-11-28

### Fixed
- Power Five means the fixed wiki set (Treebeast, Ivan, Brittany, Samurai, Forest Seer) with target levels,
  not the five highest-DPS heroes.

## 0.9.1 — 2026-11-28

### Fixed
- Parsed ascension and transcension logs are returned to the panel; a pasted export now shows its rows.

## 0.9.0 — 2026-11-28

### Added
- Power Five panel with P1-P5 marks in the hero list.
- Launch when Clicker Heroes starts instead of at login, with a settings toggle.

### Fixed
- Ascension and transcension CSV parsing accepts real exports (extra columns, tabs, headers, BOM, K/M/B).

## 0.8.1 — 2026-11-28

### Fixed
- A second launch no longer dies with an EADDRINUSE dialog.

## 0.7.5 — 2026-11-23

### Fixed
- CI: the release-upload step ran under PowerShell on Windows and killed the job, so Windows and macOS assets were missing since 0.7.0. It now runs bash.

## 0.7.4 — 2026-11-23

### Changed
- Settings: progression and log fields grouped into one labelled section.

### Fixed
- CSV header matching ignores BOM, case and a plural "s".

## 0.7.3 — 2026-11-23

### Added
- The game's Export buttons put a CSV on the clipboard; the app imports it automatically within 3 s.

## 0.7.2 — 2026-11-23

### Added
- Transcension log import; the transcend marker derives the last completed transcension automatically.

## 0.7.1 — 2026-11-23

### Added
- Ascension log import; the marker compares your best payout instead of reciting the rule.

## 0.7.0 — 2026-11-23

### Added
- Progression setting for the last transcension's HS (fallback when no export exists).

## 0.6.9 — 2026-11-23

### Fixed
- In-app changelog stopped at 0.6.1; now covers every release.

## 0.6.8 — 2026-11-23

### Fixed
- App crashed on launch: `electron-updater` is CommonJS and the named ESM import threw before the window existed.

## 0.6.7 — 2026-11-23

### Fixed
- Update button in a dev checkout now falls back to the release page.

## 0.6.6 — 2026-11-23

### Added
- Auto-update via `electron-updater`; Check/Install buttons; `latest*.yml` manifests.

## 0.6.5 — 2026-11-23

### Fixed
- Hero advice names the next x10 milestone instead of "(x10 at each 1000)".

## 0.6.4 — 2026-11-23

### Fixed
- Windows test failure: `path.isAbsolute` instead of a POSIX-only check.
