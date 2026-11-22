# Install — Linux, Windows, macOS

## Linux

**AppImage (no install, no Node):**
```sh
chmod +x "Clicker Heroes Companion-0.5.0.AppImage"
./"Clicker Heroes Companion-0.5.0.AppImage"
```
If it refuses to start (FUSE missing), run it with `--appimage-extract-and-run`.

**Desktop entry:**
```sh
cp ch-overlay.desktop ~/.local/share/applications/
cp ch-overlay.desktop ~/.config/autostart/     # optional: start at login
```

## Windows

Run `Clicker Heroes Companion Setup 0.5.0.exe`. It installs per-user, no admin needed.
The app finds the save at `%LOCALAPPDATA%\Playsaurus\Clicker Heroes\playerSaveData.txt`.

SmartScreen will warn because the build is unsigned — "More info → Run anyway".
Code signing needs a certificate; that is the only difference from a "trusted" installer.

## macOS

Open the `.dmg`, drag the app to Applications. First launch: right-click → Open
(the app is unsigned, so Gatekeeper blocks a plain double-click once).

Save location: `~/Library/Application Support/Playsaurus/Clicker Heroes/playerSaveData.txt`.

## Any platform: custom save path

```sh
CH_SAVE_FILE=/path/to/playerSaveData.txt ./"Clicker Heroes Companion"
```

## Building the installers yourself

```sh
npm ci
npm run dist:linux    # -> ../dist/*.AppImage
npm run dist:win      # -> ../dist/*.exe   (needs Windows or wine)
npm run dist:mac      # -> ../dist/*.dmg   (needs macOS)
```

Or push a tag and let CI build all three:
`git tag v0.5.0 && git push --tags` → the workflow attaches the installers to the release.
