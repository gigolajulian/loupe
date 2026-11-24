// LOC-1: hooks reach LOUPE only at the private address LOUPE wrote, never at a name another program could take first.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { open } = require('../pipe');

const RELAY = path.join(__dirname, '..', 'relay.js');
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'loupe-home-'));
// the relay in a scratch home, so it reads the test's address and never the real ~/.loupe
const relay = (home, ev) => new Promise(res => {
  const p = spawn(process.execPath, [RELAY], { env: { ...process.env, USERPROFILE: home, HOME: home } });
  p.on('exit', code => res(code));
  p.stdin.on('error', () => {}); // the relay may exit before reading (no LOUPE): EPIPE on macOS
  p.stdin.end(JSON.stringify(ev));
});
const EV = { session_id: 'loupe-test', hook_event_name: 'UserPromptSubmit', cwd: 'C:/LOUPE TEST' }; // clears itself in 10 s

test('the address is random per launch and written whole', { skip: process.platform === 'darwin' }, () => {
  const dir = path.join(tmpHome(), '.loupe');
  const a = open(dir, false), b = open(dir, false);
  assert.match(a, /^\\\\\.\\pipe\\loupe-[0-9a-f]{32}$/);
  assert.notStrictEqual(a, b);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'pipe'), 'utf8'), b);
  assert.deepStrictEqual(fs.readdirSync(dir), ['pipe']); // no temp file left behind
});

test('the Mac socket sits in a folder only this account can open', { skip: process.platform === 'win32' }, () => {
  const dir = path.join(tmpHome(), '.loupe');
  fs.mkdirSync(dir, { mode: 0o755 });
  assert.strictEqual(open(dir, true), path.join(dir, 'loupe.sock'));
  assert.strictEqual(fs.statSync(dir).mode & 0o777, 0o700);
});

test('the relay sends to the address LOUPE wrote', async () => {
  const home = tmpHome();
  const addr = open(path.join(home, '.loupe'));
  if (process.platform === 'darwin') try { fs.unlinkSync(addr); } catch {}
  let got = '';
  const server = net.createServer(s => { s.setEncoding('utf8'); s.on('data', c => { got += c; }); });
  await new Promise(r => server.listen(addr, r));
  try {
    assert.strictEqual(await relay(home, EV), 0);
    await new Promise(r => setTimeout(r, 100));
    assert.ok(got, 'the relay sent nothing to the address LOUPE wrote');
    const ev = JSON.parse(got.trim());
    assert.strictEqual(ev.session_id, 'loupe-test');
    assert.ok(ev.orb_ts > 0);
  } finally { server.close(); }
});

test('no address file: the relay exits at once and sends nothing', async () => {
  const t0 = Date.now();
  assert.strictEqual(await relay(tmpHome(), EV), 0);
  assert.ok(Date.now() - t0 < 2000);
});
