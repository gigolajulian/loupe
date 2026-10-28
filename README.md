# LOUPE

A black island at the top of the main display that shows live Claude Code sessions: what each one is doing, and a mirror of every permission and question. A click opens the session in the Claude app.

This repo holds releases only.

## Install (Windows)

1. Install Node.js (the Claude Code hooks run `node`).
2. Download `LOUPE-Setup-<version>.exe` from [the latest release](https://github.com/gigolajulian/loupe/releases/latest) and run it. It is unsigned: SmartScreen shows "More info", then "Run anyway".
3. Tray icon (three dots), then "Check Claude Code hooks", then "Fix hooks". It backs up `~/.claude/settings.json` and adds the LOUPE hooks. Other hooks stay.

LOUPE updates itself from here: it checks on launch and every 4 hours, and installs when it quits.
