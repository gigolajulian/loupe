# Running LOUPE

Drafted by Claude for the bedrock full run (2026-11-24). Julian confirms each part; BASELINE.md says which. Secrets updated 2026-11-25.

## Owner (OPS-9)

- Julian owns LOUPE: GitHub issues, CI failures and Dependabot PRs on gigolajulian/loupe come to him.
- Nathan is a tester (installs releases, files issues).

What LOUPE relies on:

| Service or part | Used for | If it breaks |
|---|---|---|
| GitHub releases (gigolajulian/loupe) | installers, `latest.yml`, `.sig` files | no updates; LOUPE keeps running |
| GitHub Actions | `npm test` on Windows and macOS for each push and PR | merges go untested |
| Claude Code hooks (`~/.claude/settings.json`) | every event LOUPE shows | nothing shows; the tray hook check says so |
| Node.js on PATH | runs `~/.loupe/relay.js` for each hook | nothing shows; Claude Code works as usual |
| electron, electron-updater, koffi, thinking-orbs | the app, updates, Windows calls, the orb | caught by Dependabot and `npm audit` in CI |

## Secrets (SEC-2)

| Secret | Unlocks | Where it lives | Rotate |
|---|---|---|---|
| Update signing key (ed25519) | Installs accept an update signed by it | `~/.release-keys/updates-ed25519.enc.pem` on Julian's PC, passphrase-protected (passphrase in his Apple Passwords). Off-PC backup: `D:\Dropbox\KEYS\kelvinrgb-updates-ed25519.enc.pem`, the same encrypted file. The same key signs KelvinRGB, CREEKY and LEADS DESKTOP (their embedded public key matches `~/.release-keys/updates-ed25519.pub.pem` and `PUBKEY` in `update-signature.js`). No plain copy on disk: the plain `.pem` was deleted 2026-11-25, and `scripts/release-key.js` refuses an unprotected key (SEC-9) | Make a new key, ship one release signed by the old key whose `PUBKEY` in `update-signature.js` is the new one, then sign with the new key. KelvinRGB, CREEKY and LEADS DESKTOP need the same switch, since they share the key. A lost key means installs can't update again, so the backup matters. |
| `GH_TOKEN` | Publishing releases | Not stored: `gh auth token` at release time | `gh auth refresh`, or revoke the session in GitHub settings |

LOUPE itself keeps no secrets on users' PCs. The pipe address in `~/.loupe/pipe` is random per launch and only the user's account can read it.

## Memory, CPU and start budget (MEM-1, PERF-2)

For a modest PC (8-16 GB RAM, integrated graphics), whole process tree:

| | Budget |
|---|---|
| Private memory, idle | under 250 MB |
| Private memory, 8 busy sessions | under 350 MB, back near idle within a minute |
| CPU, idle in the tray | under 0.5% of the machine averaged over 10 min |
| Start, launch to taking hook events | under 3 s |

Measured with `node scripts/measure.js` (numbers in BASELINE.md, MEM-2 / EXIT-4 / PERF-2).
