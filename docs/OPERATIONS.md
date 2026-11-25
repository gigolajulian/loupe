# Running LOUPE

Drafted by Claude for the bedrock full run (2026-11-24). Julian confirms each part; BASELINE.md says which. Secrets updated 2026-11-25.

## Owner (OPS-9)

- Julian owns LOUPE: GitHub issues, CI failures and Dependabot PRs on loupedesk/loupe come to him.
- Nathan is a tester (installs releases, files issues).
- The repo moved from gigolajulian/loupe to loupedesk/loupe on 2026-11-25. Copies up to 0.3.4 still ask the old address for updates and reach the new one through GitHub's redirect. Never create or fork a repo named `loupe` under gigolajulian: that ends the redirect and those copies stop updating.

What LOUPE relies on:

| Service or part | Used for | If it breaks |
|---|---|---|
| GitHub releases (loupedesk/loupe) | installers, `latest.yml`, `.sig` files | no updates; LOUPE keeps running |
| GitHub Actions | `npm test` on Windows and macOS for each push and PR | merges go untested |
| Claude Code hooks (`~/.claude/settings.json`) | every event LOUPE shows | nothing shows; the tray hook check says so |
| Node.js on PATH | runs `~/.loupe/relay.js` for each hook | nothing shows; Claude Code works as usual |
| electron, electron-updater, koffi, thinking-orbs | the app, updates, Windows calls, the orb | caught by Dependabot and `npm audit` in CI |

## Secrets (SEC-2)

| Secret | Unlocks | Where it lives | Rotate |
|---|---|---|---|
| Release signing key, Hello (RSA-2048, everyday) | Installs accept an update signed with it | Windows Hello key `jg-release-updates` in the TPM of Julian's PC, shared with KelvinRGB, LOUPE, CREEKY and LEADS DESKTOP. Can't be exported, so there is no copy or backup; the recovery key covers its loss (a Windows reinstall, TPM clear, Hello PIN reset, maybe a BIOS update). | Make a new one (`powershell -File scripts/hello-sign.ps1 create` prints its public key), put it in `update-signature.js` `HELLO`, sign that release with the recovery key. All four apps need the same switch. |
| Release signing key, recovery (ed25519) | Same as the Hello key: installs accept an update signed with either | `~/.release-keys/updates-ed25519.enc.pem` on Julian's PC, passphrase-protected (passphrase in his Apple Passwords). Off-PC backup `D:\Dropbox\KEYS\kelvinrgb-updates-ed25519.enc.pem`, the same encrypted file. No plain copy; `scripts/release-key.js` refuses an unprotected key. | Make a new key pair, put the public half in `update-signature.js` `RECOVERY`, ship one release signed with the old key. All four apps share it. |
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
