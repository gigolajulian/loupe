# Baseline: loupe

App: loupe
Stage: 2
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: full
Gate answer: 
Gate asked: 
Next ask after: 
Manual expiry days: 180
Stage override: Julian, 2026-11-22: stage 2, Nathan installs and uses it and the repo is public
Parts override: web is the Electron renderer (index.html), not a served site; confirm with the owner
Features override:

Detected: has web pages (index.html); a project with dependencies (package.json); a tray app (main.js); a desktop window (main.js); runs a server (main.js)


| ID | Part | Status | Proof | Evidence | Break | Checked | Notes |
|---|---|---|---|---|---|---|---|
| SEC-1 | any | open | | | | | gap: no secret scanner in the repo or CI. A manual history search for private keys found none, and the release key lives outside the repo (~/.release-keys). Small. |
| SEC-3 | any | open | | | | | gap: no test. In code: package-lock.json is committed, but nothing enforces npm ci for release builds (no CI). Small. |
| SEC-5 | any | open | | `npm test` (update guard only) | | | covered, not proven: the update guard fails closed (test/update-signature.test.js, 3 tests). Gaps: sessions.js reply() turns any unknown choice into allow (no test); settings.json and config.json are written in place, not temp-then-rename (a backup is taken before the hook fix). Small. |
| LOC-1 | local | pass | test | `node --test test/pipe.test.js` | .bedrock/breaks/LOC-1.patch | | Private address: random pipe name per launch (Mac: socket in ~/.loupe, 0700), written to ~/.loupe/pipe; the relay reads only that. Listen errors no longer crash. Mac path untested here (no Mac). |
| INP-1 | any | open | | | | | gap: no tests. JSON from the pipe and config is parse-guarded. Unguarded: server listen error (crash), writeFileSync of config.json at first run and in tray clicks (full or read-only disk throws in main). Small. |
| MEM-3 | any | open | | | | | gap: no test. In code: sessions age out after 12 h, transcript reads capped at 8 MB, held prompts bounded by open sockets. Gap: the per-connection line buffer in listen() has no cap. No test. Small. |
| EXIT-1 | desktop, local | open | | | | | gap: no test. In code: Quit ends the app; Mac menubar helper is killed on before-quit; reap runs with a 30 s timeout; node -v with 5 s. No test or script checks for leftovers after quit. Small. |
| EXIT-5 | desktop, local | open | | | | | gap: updater.log capped at 256 KB only at launch; ~/.claude/reap.log (written by reap.ps1) never trimmed; settings.json.bak-loupe-* backups never pruned (3 on this PC). No test. Small. |
| EXIT-6 | desktop, local | open | | | | | gap: no test. In code: Mac helper exits when stdin closes; relay hooks exit when the pipe closes. Gap: a reap PowerShell started just before a crash runs unbounded (the 30 s timeout lives in LOUPE). No test. Small. |
| DATA-1 | any | open | | | | | gap: needs the owner. User data is only config.json (a few tray settings) and the settings.json backups; ask whether n/a is right. |
| REL-1 | any | pass | ci | `npm test` | .bedrock/breaks/REL-1.patch | | .github/workflows/test.yml runs npm test on Windows for every push to main and every PR (actions pinned by SHA, read-only token). npm test includes the sessions.js and hooks.js self-tests. |
| PRIV-2 | any | open | | | | | gap: no test. reap.ps1 writes each killed command line in full to ~/.claude/reap.log, and a command line can carry a token or a private path. updater.log holds versions and URLs only. Small. |
| OBS-1 | web | open | | | | | gap: web part only, n/a if the web part is dropped (no public endpoint). Desktop errors: updater.log only, no crash log. |
| COST-1 | any | open | | | | | gap: likely n/a, no paid service (GitHub releases, no cloud, no AI API, no CI). Owner to confirm. |
| WEB-3 | web | open | | | | | gap: web part only, n/a if the web part is dropped (no cookies, no sessions, no HTTP server). |
| WEB-5 | desktop, local | open | | | | | gap: likely n/a, no uploads or imports. The only file it reads from outside is the session transcript, capped at 8 MB per read. |
| WEB-7 | web | open | | | | | gap: no test. In code: the renderer escapes session text (esc in renderer.js) and index.html sets CSP default-src self. Small. |
| WEB-8 | desktop, local | open | | | | | gap: no test. In code: reap runs through execFile with an argument array (no shell), Kill PIDs are regex-checked, shell.openExternal only gets claude:// with a checked session id. Small. |
| WEB-9 | web | open | | | | | gap: web part only, n/a if the web part is dropped. Update and signature fetches use https to GitHub. |
| DEV-1 | any | open | | | | | Reuse a running dev server; stop every server you start before ending the turn; nothing left running in worktrees |
| SEC-2 | any | open | | | | | Secrets inventory: what each unlocks, its scope, where it's stored, how to rotate it in minutes |
| SEC-4 | any | open | | | | | Known-vulnerable dependencies are flagged automatically, and update proposals arrive on their own (OWASP A03 supply chain) |
| LOC-2 | local | open | | | | | If exposed beyond the machine, the firewall allows private networks only |
| INP-2 | any | open | | | | | User data is written atomically (temp file, then rename), so a crash never corrupts it |
| MEM-1 | any | open | | | | | Memory budget written for a modest device (8-16 GB, integrated graphics): idle and working |
| MEM-2 | desktop, local | open | | | | | Measured against the budget: commit and working set, 10 min idle and 10 min in use |
| MEM-4 | any | open | | | | | Big files and bodies are streamed, never loaded whole; byte budgets on anything that streams or stores |
| MEM-5 | desktop, local | open | | | | | Heavy models and runtimes load only when needed and are released; thread pools and arenas capped |
| MEM-6 | desktop, local, web | open | | | | | A memory-ceiling regression test in the suite |
| EXIT-2 | desktop, local | open | | | | | Nothing starts at login unless the user turned it on; uninstall removes everything it added |
| EXIT-3 | desktop, local | open | | | | | No leftovers: when the app moves, is renamed or a part is retired, its own cleanup removes every startup entry, scheduled task, service and handler it registered; nothing at login points into a dev folder or a .venv |
| EXIT-4 | desktop, local | open | | | | | Quiet when idle: in the background or tray it averages under 0.5% CPU and no graphics use over 10 min, waking on events or timers of a minute or more, never busy-polling |
| OPS-8 | local | open | | | | | Data survives a restart: nothing users rely on lives only in memory; processes are stateless or persist state durably |
| DATA-2 | any | open | | | | | Crashes and errors reach the developer (a local log at least; any remote reporting opt-in) |
| REL-2 | desktop | open | | | | | The app's auto-updates are signed and size-checked, and never restart in the middle of the user's work |
| PLAT-1 | desktop, local | open | | | | | Paths work on every supported OS: long paths, spaces, non-ASCII, case differences |
| PLAT-2 | desktop, web | open | | | | | High-DPI: 125-200% scaling and 4K render sharp, nothing clipped |
| LIC-1 | any | open | | | | | Own licence chosen; third-party licences compatible and credited |
| SEC-8 | any | open | | | | | Operator accounts (code host, cloud, registrar, email, stores) use 2FA or passkeys; tokens are least-privilege and expire |
| SEC-9 | any | open | | | | | Config lives outside code; development, staging and production are separate; production secrets never on a dev machine's disk in plain text |
| SEC-10 | any | open | | | | | No homemade crypto; random values for tokens and codes come from a cryptographic source |
| NET-1 | any | open | | | | | Every outbound call has a timeout, retries with backoff and jitter, and stops after repeated failures |
| DATA-3 | desktop, local | open | | | | | Stored data and schemas are versioned with forward migrations; data from older versions still opens |
| TIME-1 | any | open | | | | | Times stored in UTC, or deliberately local with the reason written down (a camera's local day); time zones, daylight-saving changes and clock skew tested where dates matter |
| DOC-1 | any | open | | | | | A README says how to run, test and release it; big decisions recorded (short decision notes) |
| PERF-2 | desktop, local | open | | | | | Cold start and main actions timed on a modest device, with a written budget |
| DIST-1 | desktop, local | open | | | | | Ships as its own app: a named executable with the app's icon, version and publisher (code-signed by stage 3), so Task Manager, Startup apps and the firewall show the app's name, never python, node or a script host |
| ABU-10 | web | open | | | | | Public pages are cached at the edge, so a flood of page loads costs nothing |
| ABU-13 | any | open | | | | | No client-side limit is counted as protection; the server enforces each one |
| WEB-1 | web | open | | | | | Security headers and a Content Security Policy, tested |
| PRIV-1 | any | open | | | | | No third-party trackers or pixels; any analytics opt-in, numbers only, and disclosed |
| PRIV-3 | any | open | | | | | A data retention schedule, and a user can export their data |
| PRIV-4 | any | open | | | | | Sensitive personal data encrypted at rest |
| REL-3 | any | open | | | | | Tests must pass before a merge |
| UX-2 | desktop, web | open | | | | | Contrast 4.5:1 body, 3:1 large text and control edges |
| UX-3 | desktop, web | open | | | | | Slow actions answer at once, show the wait, confirm in place; empty, error and offline states written |
| A11Y-1 | desktop, web | open | | | | | WCAG 2.2 AA keyboard: everything works by keyboard, focus is visible and never hidden behind sticky bars |
| A11Y-2 | desktop, web | open | | | | | Reduced motion respected; nothing flashes more than three times a second |
| RANGE-1 | web | open | | | | | Phones 360-430 px, tablets and desktop: no sideways scroll, inputs don't zoom, 44 px tap targets |
| RANGE-3 | desktop, web | open | | | | | Light and dark, slow network and offline all work |
| WEB-6 | web | open | | | | | No open redirects: return URLs are checked against an allow-list |
| SEC-13 | desktop, local | open | | | | | Secrets the app keeps on the user's device live in the OS keychain or a file only the user can read; never in logs or plain config |
| A11Y-3 | desktop, web | open | | | | | Every control has a name and label; meaningful images have alt text; status messages are announced |
| A11Y-4 | desktop, web | open | | | | | A screen-reader pass on the main flows (NVDA, VoiceOver or TalkBack) |
| A11Y-5 | web | open | | | | | Targets at least 24 by 24 px (44 for primary touch); dragging has a non-drag alternative; sign-in allows paste and passkeys |
| DATA-4 | any | open | | | | | Backups are monitored: a failed or missing backup alerts someone |
| REL-10 | any | open | | | | | Tested on every platform it ships to, on every change: each operating system a desktop app is sold for, each browser engine (Chromium, WebKit, Firefox) for a web app, an iOS and Android build for a phone app |
| REL-9 | any | open | | | | | One version and one customer notes file: the version shown in the app, the store and the executable all come from one place, and each release has a plain-language entry (see ops-release.md) |
| REL-7 | any | open | | | | | CI is hardened: least-privilege tokens, actions and images pinned by digest, no secrets in pull-request builds from forks |
| A11Y-6 | desktop, web | open | | | | | Forms: labels and instructions, errors identified in text next to the field, and how to fix them (WCAG 3.3.1-3.3.3) |
| A11Y-7 | web | open | | | | | Reflows at 320 px and 200% text without loss; page language set; captions for audio and video |
| OPS-9 | any | open | | | | | Someone owns it: who gets alerts and answers them, and an inventory of the services and dependencies it relies on |
