# LOUPE

A black island at the top of the main display that shows your live Claude Code sessions: what each one is doing, and a mirror of every permission and question. Click a project to open it in the Claude app. On a Mac it sits in the notch.

Prompts always show in the Claude Code thread first. LOUPE only mirrors them, unless you turn on tray "Answer prompts on LOUPE".

## Install or upgrade with Claude

Paste the prompt for your computer into Claude Code (the Claude app's Code tab or the terminal). It handles a fresh install and an upgrade of an older LOUPE, and leaves LOUPE updating itself from this repo's releases.

### Windows

```
Install or upgrade LOUPE on this Windows PC. LOUPE is a small always-on-top island that mirrors my Claude Code sessions. Repo and releases: https://github.com/gigolajulian/loupe. Use PowerShell. Ask me before anything hard to undo, never delete my files, and use no em dashes in anything you write.

1. Node: run `node -v` (needs 18 or newer, the hooks run node). If it is missing, ask me before running `winget install OpenJS.NodeJS.LTS`.
2. What is there now: if `$env:LOCALAPPDATA\Programs\LOUPE\LOUPE.exe` exists, note its version with `(Get-Item <path>).VersionInfo.ProductVersion`. Note every hook command in `~/.claude/settings.json` that mentions relay.js, loupe or coucou. If the installed version already matches the latest release, skip to step 5.
3. Download the latest installer into a new empty folder: `$d = New-Item -ItemType Directory -Force "$env:TEMP\loupe-install"`. Get the asset URL from `Invoke-RestMethod https://api.github.com/repos/gigolajulian/loupe/releases/latest` (the asset named `LOUPE-Setup-<version>.exe`), download it with `Invoke-WebRequest -OutFile`, then `Unblock-File` it.
4. Install. This upgrades an older LOUPE in place and keeps its settings: `Stop-Process -Name LOUPE -ErrorAction SilentlyContinue`, then `Start-Process -Wait <installer> -ArgumentList '/S'`. It installs per user (no admin) to `%LOCALAPPDATA%\Programs\LOUPE` and starts LOUPE. If LOUPE is not running 5 seconds later, start `LOUPE.exe`.
5. Hooks: run `& "$env:LOCALAPPDATA\Programs\LOUPE\LOUPE.exe" --fix-hooks`. LOUPE backs up `~/.claude/settings.json` to `settings.json.bak-loupe-<time>`, removes old LOUPE hooks (any old relay.js path) and Coucou hooks, and adds the 10 LOUPE hooks pointing at `~/.loupe/relay.js`, which LOUPE rewrites on every launch. Other hooks stay. A dialog says "Claude Code hooks are set". Show me the hook part of the diff against the backup. Leave any old relay.js file on disk where it is.
6. Test: `'{"hook_event_name":"UserPromptSubmit","session_id":"loupe-test","cwd":"C:/LOUPE TEST"}' | node "$HOME/.loupe/relay.js"` makes "LOUPE TEST" show "thinking" at the top centre of the main display. Clear it: `'{"hook_event_name":"SessionEnd","session_id":"loupe-test"}' | node "$HOME/.loupe/relay.js"`.
7. Report the version before and after, what changed in the hooks, and that new Claude Code sessions now show on LOUPE (running sessions show up on their next event). The tray icon (three dots) has "Check for updates", "Check Claude Code hooks" and the settings.
```

### Mac

```
Install or upgrade LOUPE on this Mac. LOUPE is a small island in the notch that mirrors my Claude Code sessions. Repo: https://github.com/gigolajulian/loupe. Ask me before anything hard to undo, never delete my files, and use no em dashes in anything you write.

1. Check `node -v` (18 or newer) and `git --version`. If Node is missing, ask me before `brew install node`.
2. What is there now: if /Applications/LOUPE.app exists, note its version (`defaults read /Applications/LOUPE.app/Contents/Info CFBundleShortVersionString`). Note every hook command in ~/.claude/settings.json that mentions relay.js, loupe or coucou.
3. Source: clone https://github.com/gigolajulian/loupe to ~/LOUPE-src, or `git -C ~/LOUPE-src pull` if it is already there. Then run `npm install` and `npx electron-builder --mac` in it. The build is unsigned on purpose, so a signing skip warning is fine.
4. Install: `pkill -x LOUPE`, then copy the app for this Mac (`uname -m`: arm64 is dist/mac-arm64/LOUPE.app, x86_64 is dist/mac/LOUPE.app) over /Applications/LOUPE.app with `ditto`. Settings live in ~/Library/Application Support/LOUPE and stay. Ad-hoc sign it: `codesign --force --deep --sign - /Applications/LOUPE.app`, clear quarantine: `xattr -dr com.apple.quarantine /Applications/LOUPE.app`, then `open /Applications/LOUPE.app`. No Dock icon is expected.
5. Hooks: `/Applications/LOUPE.app/Contents/MacOS/LOUPE --fix-hooks`. It backs up ~/.claude/settings.json, swaps old LOUPE and Coucou hooks for the 10 LOUPE hooks at ~/.loupe/relay.js, and leaves other hooks alone. Show me the hook part of the diff against the backup. If the dialog says node is not found, find it with `command -v node` and ask me before putting that absolute path in the hook commands.
6. Test: `echo '{"hook_event_name":"UserPromptSubmit","session_id":"loupe-test","cwd":"/tmp/LOUPE TEST"}' | node ~/.loupe/relay.js` grows the notch with "LOUPE TEST thinking". Take a screenshot of the top of the screen and show me. Clear it with the same command and "SessionEnd".
7. Report the version before and after and what changed in the hooks. Updates: the Mac build is unsigned, so macOS won't let it update itself. When a new release is out, LOUPE shows "LOUPE x is out", and running this prompt again upgrades it.
```

### By hand (Windows)

1. Download `LOUPE-Setup-<version>.exe` from [the latest release](https://github.com/gigolajulian/loupe/releases/latest) and run it. It is unsigned: SmartScreen shows "More info", then "Run anyway".
2. Tray icon (three dots), then "Check Claude Code hooks", then "Fix hooks".

## Updates

Windows installs from 0.2.12 on update themselves: LOUPE checks this repo's releases on launch and every 4 hours, downloads in the background and installs when LOUPE quits. Tray "Check for updates" checks now and shows the installed version. Once a download is ready it reads "Restart to update". Installs older than 0.2.12 need the prompt above once.

## Hooks

Claude Code talks to LOUPE through `relay.js`, which forwards each hook event over a named pipe (a Unix socket on the Mac). LOUPE writes its own copy to `~/.loupe/relay.js` on every launch, so updates reach it. If LOUPE is closed, the relay exits at once and Claude Code works as usual.

Tray "Check Claude Code hooks" (or `LOUPE --check-hooks`) shows whether `node` runs, whether each hook points at `~/.loupe/relay.js`, leftover Coucou or old-path hooks, and when the last event came in. "Fix hooks" (or `LOUPE --fix-hooks`, no dialog first) writes these after a backup:

```json
"hooks": {
  "SessionStart":       [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "SessionEnd":         [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "UserPromptSubmit":   [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "PreToolUse":         [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 3600 }] }],
  "PermissionRequest":  [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 3600 }] }],
  "PostToolUse":        [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "PostToolUseFailure": [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "Notification":       [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "Stop":               [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }],
  "StopFailure":        [{ "hooks": [{ "type": "command", "command": "node \"<home>/.loupe/relay.js\"", "timeout": 5 }] }]
}
```

## Prompts

By default no hook waits, so every permission, question and plan approval shows in the thread at once. LOUPE mirrors it: the command or question, "in app" to open the session, × to close the card. On a question you can pick, then "Submit in app" opens the session.

Tray "Answer prompts on LOUPE (hides them from the thread until answered)" makes permissions and questions wait for the island: Allow / Deny / Always, or pick and Submit. While one waits, the thread doesn't show it. That's why it is off by default, and why `PreToolUse` and `PermissionRequest` have the long timeout.

## Check it

- The island sits at the top centre of the main display. Hover it to open the list.
- Send a prompt in any session: its project shows "thinking", then what it's doing.
- Speaker at the top right of the open panel: click for the volume slider, right click to mute.
- Tray icon (three dots, left or right click): close delay, gooey motion, sounds, prompts on LOUPE, Start with Windows, hook check, updates, Quit.

## How it reads sessions

- **Project:** the session's folder. Worktrees count under their parent project.
- **Step:** the session's title in the Claude app. "Site - QA" shows as QA. Sessions of one project share a row: `SITE  UI › QA › RELEASE`, with what it's doing on the line under.
- The 5 most active projects show. Needs-you comes first, in cyan, with a sound.

## Dev

- `npm install`, then `npm start` runs from source. Quit the installed app first: only one copy runs at a time.
- `npm run icons` re-exports the icons from `logo/`.
- `npm run dist` builds the Windows installer into `dist\`, `npm run dist:mac` the Mac zips (on a Mac).
- `node sessions.js` and `node hooks.js` run the self-checks.
- Dev env vars: `LOUPE_SNAP=<png>` writes what the window draws every second, `LOUPE_CLICK=<file>` runs one line per second on the page (`js:` lines run as code), `LOUPE_NOTCH=WxH` fakes a notch.

## Release an update

1. Bump `version` in `package.json` (e.g. 0.2.12 to 0.2.13). Installs only update to a higher version.
2. `node sessions.js && node hooks.js`.
3. Publish. `GH_TOKEN` comes from the environment, never typed or pasted. With the GitHub CLI logged in:
   ```bash
   GH_TOKEN="$(gh auth token)" npx electron-builder --win nsis --publish always
   ```
   This builds, uploads the installer, its `.blockmap` and `latest.yml`, and publishes the release (`releaseType: release` in package.json, not a draft).
4. Commit and push the source: `git commit -am "LOUPE <version>" && git push`.
5. Check https://github.com/gigolajulian/loupe/releases/latest lists `latest.yml`. Running installs pick it up within 4 hours, or now with tray "Check for updates", and install on quit. GitHub's release feed can lag a minute or two after publishing.

Mac: on the Mac, `GH_TOKEN="$(gh auth token)" npx electron-builder --mac --publish always` adds the zips and `latest-mac.yml` to the same release. Mac installs only get a "LOUPE x is out" dialog, since unsigned apps can't update in place.

The packaged app's `package.json` has no `build` key (electron-builder strips it), so the app never reads its own publish config.
