# LOUPE on the Mac

Install or upgrade with the Mac prompt in README.md: paste it into Claude Code on the Mac. It clones this repo, builds LOUPE, installs it over any older copy and wires the hooks with `LOUPE --fix-hooks`.

## What changed for the Mac

- Named pipe -> Unix socket at `/tmp/loupe-<user>.sock` (fixed path: `$TMPDIR` can differ between the app and hook processes).
- relay.js reads `~/Library/Application Support/LOUPE/config.json`.
- The Windows overlay check (koffi + user32) and `setAppUserModelId` are skipped.
- Tray: `trayTemplate.png` / `@2x`, a 16 pt template image macOS tints for the menu bar.
- Notch: size read from `NSScreen` (`safeAreaInsets.top`, `auxiliaryTopLeftArea` / `auxiliaryTopRightArea`) through `osascript`. No notch: a 180 pt island the height of the menu bar.
- Window: `type: 'panel'`, `enableLargerThanScreen` so it sits at y=0 over the menu bar, `screen-saver` level, visible on all Spaces and over full-screen apps.
- Idle, the island is the notch itself. While a session works, orb and project sit left of the notch, the verb right. Open, the panel grows down out of the notch.
