# Baseline: loupe

App: loupe
Stage: 1
Parts: desktop, local, web
Features: none
Checklist version: 2026.11.20.5
Level: light
Gate answer: 
Gate asked: 
Next ask after: 
Manual expiry days: 180
Stage override:
Parts override: web is the Electron renderer (index.html), not a served site; confirm with the owner
Features override:

Detected: has web pages (index.html); a project with dependencies (package.json); a tray app (main.js); a desktop window (main.js); runs a server (main.js)


| ID | Part | Status | Proof | Evidence | Break | Checked | Notes |
|---|---|---|---|---|---|---|---|
| SEC-1 | any | open | | | | | gap: no secret scanner in the repo or CI. A manual history search for private keys found none, and the release key lives outside the repo (~/.release-keys). Small. |
| SEC-3 | any | open | | | | | covered, not proven: package-lock.json is committed, but nothing enforces npm ci for release builds (no CI). Small. |
| SEC-5 | any | open | | | | | covered, not proven: the update guard fails closed (test/update-signature.test.js, 3 tests). Gaps: sessions.js reply() turns any unknown choice into allow (no test); settings.json and config.json are written in place, not temp-then-rename (a backup is taken before the hook fix). Small. |
| LOC-1 | local | open | | | | | gap: no network port (named pipe on Windows, unix socket on Mac), so loopback holds by design, but untested. Mac socket is a fixed /tmp path; if another local user owns it first, listen fails with no error handler and hooks connect to the squatter, who could answer permission prompts when Answer permissions on LOUPE is on. Windows pipe does not set reject-remote-clients (unverified). Medium. |
| INP-1 | any | open | | | | | gap: no tests. JSON from the pipe and config is parse-guarded. Unguarded: server listen error (crash), writeFileSync of config.json at first run and in tray clicks (full or read-only disk throws in main). Small. |
| MEM-3 | any | open | | | | | covered, not proven: sessions age out after 12 h, transcript reads capped at 8 MB, held prompts bounded by open sockets. Gap: the per-connection line buffer in listen() has no cap. No test. Small. |
| EXIT-1 | desktop, local | open | | | | | covered, not proven: Quit ends the app; Mac menubar helper is killed on before-quit; reap runs with a 30 s timeout; node -v with 5 s. No test or script checks for leftovers after quit. Small. |
| EXIT-5 | desktop, local | open | | | | | gap: updater.log capped at 256 KB only at launch; ~/.claude/reap.log (written by reap.ps1) never trimmed; settings.json.bak-loupe-* backups never pruned (3 on this PC). No test. Small. |
| EXIT-6 | desktop, local | open | | | | | covered, not proven: Mac helper exits when stdin closes; relay hooks exit when the pipe closes. Gap: a reap PowerShell started just before a crash runs unbounded (the 30 s timeout lives in LOUPE). No test. Small. |
| DATA-1 | any | open | | | | | gap: needs the owner. User data is only config.json (a few tray settings) and the settings.json backups; ask whether n/a is right. |
| REL-1 | any | open | | | | | gap: no CI. npm test runs 3 tests; the self-tests in sessions.js, hooks.js and reap.ps1 -SelfTest are not wired into it. Small. |
