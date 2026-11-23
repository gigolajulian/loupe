# Baseline: loupe

App: loupe
Stage: 2
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: standard
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
