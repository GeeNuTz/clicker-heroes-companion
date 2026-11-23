# Changelog

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
