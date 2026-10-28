# LOUPE: plan

## What it is
A thin dark bar at the top of your main display. It shows every Claude Code session, with Code tab sessions first. When a session needs you, the bar opens and you approve or answer in one click. The same request reaches your iPhone wherever you are.

## Your answers
- iPhone, anywhere.
- Top bar, one display.
- Keep: approve / deny, answer questions, live ticker, jump to session.
- The Claude app Code tab is the focus. Terminal sessions sit below, folded.
- Spotify yes. Cal.com later. No GitHub, Stripe or other pills.
- Little text. Straight to the point.

## How it hooks in
Same route as Coucou, kept small:
- One tiny relay exe registered in `~/.claude/settings.json` for SessionStart, UserPromptSubmit, PreToolUse, PostToolUse, PermissionRequest, Notification, Stop and SessionEnd.
- The relay passes each event to the bar over a named pipe. For PermissionRequest and AskUserQuestion it waits for your click and writes the answer back.
- Fail-open: if the bar isn't running, the relay exits at once. Claude Code never blocks.
- Code tab sessions carry `CLAUDE_CODE_ENTRYPOINT=claude-desktop`. That's how the bar ranks them first.
- Fragility fix: the bar checks its own hooks on every launch. If they're missing or a Claude update moved them, "hooks ok" in the bar turns to "hooks off · fix". One click re-merges them, after a backup and a diff.

## Phone
- A small Cloudflare Worker, your stack, plus a home-screen web app on the iPhone with Web Push.
- A request shows as a notification. Tap it, then Allow / Deny or pick an answer. First answer wins, from the bar or the phone.
- Paired once with a code. The Worker sees only the session name, tool and command. No code, no keys.
- Not in v1: Lock Screen buttons, Live Activities, Dynamic Island. Those need a native iOS app and a paid Apple developer account.

## Stack
Tauri 2 (Rust plus a small web UI). Light, transparent, always on top, never steals focus. Coucou's Windows code is MIT, so I can read it for the pipe and window tricks. I take no name, character, sound or icon from it.

## Steps (each one previewable)
1. Static mock: this file and `mock.html`. Waiting on your OK.
2. Relay plus a read-only bar with live sessions and the ticker. Check that Code tab sessions fire hooks.
3. Approve / deny and questions in the bar.
4. Jump to session: brings the Claude app forward. Focusing the exact session depends on what the app exposes, so I check that first.
5. Phone: Worker, pairing, push, answer page.
6. Spotify pill.
7. Later: Cal.com next booking.

## Open
- Name.
- Accent color. The mock uses one cold cyan.
- Sounds: none, or one quiet tick when something needs you.
