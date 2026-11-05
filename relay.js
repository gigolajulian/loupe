// Claude Code hook -> LOUPE. Fail-open: exits 0 with no output whenever LOUPE is closed or doesn't answer.
// AskUserQuestion waits for LOUPE's answer while you're at the PC (LOUPE releases it to the thread when you're away).
// Permissions show in the thread at once and LOUPE mirrors them, unless the tray's "Answer permissions on LOUPE" is on.
// LOUPE writes this file to ~/.loupe/relay.js on every launch. Usage in settings.json: node "<home>/.loupe/relay.js"
const net = require('net');
const os = require('os');

const MAC = process.platform === 'darwin';
const PIPE = MAC ? `/tmp/loupe-${os.userInfo().username}.sock` : `\\\\.\\pipe\\loupe-${os.userInfo().username}`;
// LOUPE's app.getPath('userData')
const CFG = MAC ? `${os.homedir()}/Library/Application Support/LOUPE/config.json` : `${process.env.APPDATA}/loupe/config.json`;
const bail = () => process.exit(0);
const answerOnIsland = () => {
  try { return JSON.parse(require('fs').readFileSync(CFG, 'utf8')).answerOnIsland === true; }
  catch { return false; }
};
const quick = setTimeout(bail, 400);

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (raw += c));
process.stdin.on('end', () => {
  let ev;
  try { ev = JSON.parse(raw); } catch { return bail(); }
  ev.orb_entry = process.env.CLAUDE_CODE_ENTRYPOINT || 'cli';
  ev.orb_host = process.env.CLAUDE_CODE_HOST_SESSION_ID || ''; // Claude app session id, for claude:// links
  ev.orb_ts = Date.now();
  // a held hook keeps its prompt out of the thread. Questions are always offered to LOUPE, which lets them go to
  // the thread at once when you're away from the PC; permissions wait only with the tray's "Answer permissions on LOUPE".
  ev.orb_wait = (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'AskUserQuestion') ||
    (ev.hook_event_name === 'PermissionRequest' && answerOnIsland());
  const sock = net.connect(PIPE, () => {
    if (!ev.orb_wait) return sock.end(JSON.stringify(ev) + '\n', bail);
    clearTimeout(quick); // the hook's own timeout bounds the wait
    sock.write(JSON.stringify(ev) + '\n');
  });
  sock.on('error', bail);
  sock.on('close', bail);
  let reply = '';
  sock.setEncoding('utf8');
  sock.on('data', c => {
    reply += c;
    const i = reply.indexOf('\n');
    if (i < 0) return;
    let out = null;
    try { out = JSON.parse(reply.slice(0, i)); } catch {}
    if (out) process.stdout.write(JSON.stringify(out), bail);
    else bail();
  });
});
